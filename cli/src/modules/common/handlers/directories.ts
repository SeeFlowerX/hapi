import { logger } from '@/ui/logger'
import { statSync } from 'fs'
import { mkdir, readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { getErrorMessage, rpcError } from '../rpcResponses'

interface ListDirectoryRequest {
    path: string
}

interface DirectoryEntry {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

interface ListDirectoryResponse {
    success: boolean
    entries?: DirectoryEntry[]
    path?: string
    pathType?: DirectoryPathType
    error?: string
}

interface CreateDirectoryRequest {
    path: string
}

interface CreateDirectoryResponse {
    success: boolean
    error?: string
}

interface GetDirectoryTreeRequest {
    path: string
    maxDepth: number
}

interface TreeNode {
    name: string
    path: string
    type: 'file' | 'directory'
    size?: number
    modified?: number
    children?: TreeNode[]
}

interface GetDirectoryTreeResponse {
    success: boolean
    tree?: TreeNode
    error?: string
}

type DirectoryHandlerOptions = {
    allowOutsideWorkingDirectory?: boolean
    defaultPath?: string
}

type DirectoryPathType = 'directory' | 'file' | 'other' | 'missing'

function expandHomePath(value: string): string {
    const trimmed = value.trim()
    if (trimmed === '~') {
        return homedir()
    }
    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
        return join(homedir(), trimmed.slice(2))
    }
    return trimmed
}

function resolveTargetPath(
    targetPath: string,
    workingDirectory: string,
    options?: DirectoryHandlerOptions
): { resolvedPath: string; error?: string } {
    const expandedPath = expandHomePath(targetPath)
    if (!options?.allowOutsideWorkingDirectory) {
        const validation = validatePath(expandedPath, workingDirectory)
        if (!validation.valid) {
            return { resolvedPath: '', error: validation.error ?? 'Invalid directory path' }
        }
        return { resolvedPath: resolve(workingDirectory, expandedPath) }
    }
    return { resolvedPath: resolve(expandedPath) }
}

function getDefaultDirectoryPath(workingDirectory: string, options?: DirectoryHandlerOptions): string {
    if (options?.defaultPath) {
        return options.defaultPath
    }

    if (options?.allowOutsideWorkingDirectory) {
        const desktopPath = join(homedir(), 'Desktop')
        try {
            if (statSync(desktopPath).isDirectory()) {
                return desktopPath
            }
        } catch {
            // ignore
        }
        return homedir()
    }

    return workingDirectory || '.'
}

export function registerDirectoryHandlers(
    rpcHandlerManager: RpcHandlerManager,
    workingDirectory: string,
    options?: DirectoryHandlerOptions
): void {
    rpcHandlerManager.registerHandler<ListDirectoryRequest, ListDirectoryResponse>('listDirectory', async (data) => {
        logger.debug('List directory request:', data.path)

        const fallbackPath = getDefaultDirectoryPath(workingDirectory, options)
        const targetPath = data.path?.trim() || fallbackPath
        const resolved = resolveTargetPath(targetPath, workingDirectory, options)
        if (resolved.error) {
            return rpcError(resolved.error)
        }

        try {
            let stats
            try {
                stats = await stat(resolved.resolvedPath)
            } catch (error) {
                if (error && typeof error === 'object' && 'code' in error) {
                    const code = (error as { code?: string }).code
                    if (code === 'ENOENT') {
                        return rpcError('Path does not exist', {
                            path: resolved.resolvedPath,
                            pathType: 'missing' as DirectoryPathType
                        })
                    }
                }
                return rpcError(getErrorMessage(error, 'Failed to access directory'), {
                    path: resolved.resolvedPath
                })
            }

            if (!stats.isDirectory()) {
                const pathType: DirectoryPathType = stats.isFile() ? 'file' : 'other'
                return rpcError(stats.isFile() ? 'Path is a file' : 'Path is not a directory', {
                    path: resolved.resolvedPath,
                    pathType
                })
            }

            const entries = await readdir(resolved.resolvedPath, { withFileTypes: true })

            const directoryEntries: DirectoryEntry[] = await Promise.all(
                entries.map(async (entry) => {
                    const fullPath = join(resolved.resolvedPath, entry.name)
                    let type: 'file' | 'directory' | 'other' = 'other'
                    let size: number | undefined
                    let modified: number | undefined

                    if (entry.isDirectory()) {
                        type = 'directory'
                    } else if (entry.isFile()) {
                        type = 'file'
                    } else if (entry.isSymbolicLink()) {
                        type = 'other'
                    }

                    if (!entry.isSymbolicLink()) {
                        try {
                            const stats = await stat(fullPath)
                            size = stats.size
                            modified = stats.mtime.getTime()
                        } catch (error) {
                            logger.debug(`Failed to stat ${fullPath}:`, error)
                        }
                    }

                    return {
                        name: entry.name,
                        type,
                        size,
                        modified
                    }
                })
            )

            directoryEntries.sort((a, b) => {
                if (a.type === 'directory' && b.type !== 'directory') return -1
                if (a.type !== 'directory' && b.type === 'directory') return 1
                return a.name.localeCompare(b.name)
            })

            return {
                success: true,
                entries: directoryEntries,
                path: resolved.resolvedPath,
                pathType: 'directory'
            }
        } catch (error) {
            logger.debug('Failed to list directory:', error)
            return rpcError(getErrorMessage(error, 'Failed to list directory'))
        }
    })

    rpcHandlerManager.registerHandler<CreateDirectoryRequest, CreateDirectoryResponse>('createDirectory', async (data) => {
        logger.debug('Create directory request:', data.path)

        const targetPath = data.path?.trim()
        if (!targetPath) {
            return rpcError('Directory path is required')
        }

        const resolved = resolveTargetPath(targetPath, workingDirectory, options)
        if (resolved.error) {
            return rpcError(resolved.error)
        }

        try {
            await mkdir(resolved.resolvedPath, { recursive: true })
            return { success: true }
        } catch (error) {
            logger.debug('Failed to create directory:', error)
            return rpcError(getErrorMessage(error, 'Failed to create directory'))
        }
    })

    rpcHandlerManager.registerHandler<GetDirectoryTreeRequest, GetDirectoryTreeResponse>('getDirectoryTree', async (data) => {
        logger.debug('Get directory tree request:', data.path, 'maxDepth:', data.maxDepth)

        const targetPath = data.path || '.'

        const validation = validatePath(targetPath, workingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid directory path')
        }

        const resolvedRoot = resolve(workingDirectory, targetPath)

        async function buildTree(path: string, name: string, currentDepth: number): Promise<TreeNode | null> {
            try {
                const stats = await stat(path)

                const node: TreeNode = {
                    name,
                    path,
                    type: stats.isDirectory() ? 'directory' : 'file',
                    size: stats.size,
                    modified: stats.mtime.getTime()
                }

                if (stats.isDirectory() && currentDepth < data.maxDepth) {
                    const entries = await readdir(path, { withFileTypes: true })
                    const children: TreeNode[] = []

                    await Promise.all(
                        entries.map(async (entry) => {
                            if (entry.isSymbolicLink()) {
                                logger.debug(`Skipping symlink: ${join(path, entry.name)}`)
                                return
                            }

                            const childPath = join(path, entry.name)
                            const childNode = await buildTree(childPath, entry.name, currentDepth + 1)
                            if (childNode) {
                                children.push(childNode)
                            }
                        })
                    )

                    children.sort((a, b) => {
                        if (a.type === 'directory' && b.type !== 'directory') return -1
                        if (a.type !== 'directory' && b.type === 'directory') return 1
                        return a.name.localeCompare(b.name)
                    })

                    node.children = children
                }

                return node
            } catch (error) {
                logger.debug(`Failed to process ${path}:`, error instanceof Error ? error.message : String(error))
                return null
            }
        }

        try {
            if (data.maxDepth < 0) {
                return rpcError('maxDepth must be non-negative')
            }

            const baseName = resolvedRoot === '/' ? '/' : basename(resolvedRoot) || resolvedRoot
            const tree = await buildTree(resolvedRoot, baseName, 0)

            if (!tree) {
                return rpcError('Failed to access the specified path')
            }

            return { success: true, tree }
        } catch (error) {
            logger.debug('Failed to get directory tree:', error)
            return rpcError(getErrorMessage(error, 'Failed to get directory tree'))
        }
    })
}
