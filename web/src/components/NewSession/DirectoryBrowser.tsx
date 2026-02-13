import { useEffect, useMemo, useState } from 'react'
import type { ApiClient } from '@/api/client'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { useMachineDirectory } from '@/hooks/queries/useMachineDirectory'
import { useTranslation } from '@/lib/use-translation'

function FolderIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
    )
}

function normalizePath(path: string): string {
    if (!path) return ''
    const trimmed = path.trim()
    if (!trimmed) return ''
    if (trimmed === '/' || trimmed === '\\') return trimmed
    if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`
    if (/^[A-Za-z]:[\\/]+$/.test(trimmed)) {
        return `${trimmed[0].toUpperCase()}:\\`
    }
    return trimmed.replace(/[\\/]+$/, '')
}

function getSeparator(path: string): '/' | '\\' {
    return path.includes('\\') && !path.includes('/') ? '\\' : '/'
}

function joinPath(base: string, name: string): string {
    const trimmedBase = normalizePath(base)
    if (!trimmedBase) return name
    const separator = getSeparator(trimmedBase)
    return `${trimmedBase}${separator}${name}`
}

function getParentPath(path: string): string {
    const normalized = normalizePath(path)
    if (!normalized) return ''
    const separator = getSeparator(normalized)
    const parts = normalized.split(separator).filter((part) => part.length > 0)
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join(separator)
}

export function DirectoryBrowser(props: {
    api: ApiClient | null
    machineId: string | null
    path: string
    isDisabled: boolean
    onPathChange: (path: string) => void
    onSelectPath: (path: string) => void
}) {
    const { t } = useTranslation()
    const [newFolderName, setNewFolderName] = useState('')
    const [createError, setCreateError] = useState<string | null>(null)
    const [isCreating, setIsCreating] = useState(false)

    const { entries, error, isLoading, refetch, path: resolvedPath } = useMachineDirectory(props.api, props.machineId, props.path, {
        enabled: Boolean(props.machineId)
    })

    const directories = useMemo(
        () => entries.filter((entry) => entry.type === 'directory'),
        [entries]
    )

    useEffect(() => {
        setCreateError(null)
    }, [props.path])

    useEffect(() => {
        if (resolvedPath && resolvedPath !== props.path) {
            props.onPathChange(resolvedPath)
        }
    }, [resolvedPath, props.path, props.onPathChange])

    const effectivePath = normalizePath(resolvedPath ?? props.path)
    const currentPathLabel = effectivePath || '.'
    const canGoUp = getParentPath(effectivePath) !== ''

    async function handleCreateFolder() {
        if (!props.api || !props.machineId) return
        const trimmed = newFolderName.trim()
        if (!trimmed || !effectivePath) return

        setIsCreating(true)
        setCreateError(null)
        try {
            const fullPath = joinPath(effectivePath, trimmed)
            const result = await props.api.createMachineDirectory(props.machineId, fullPath)
            if (!result.success) {
                setCreateError(result.error ?? 'Failed to create directory')
                return
            }
            setNewFolderName('')
            await refetch()
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : 'Failed to create directory')
        } finally {
            setIsCreating(false)
        }
    }

    if (!props.machineId) {
        return (
            <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-xs text-[var(--app-hint)]">
                {t('newSession.browse.noMachine')}
            </div>
        )
    }

    return (
        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-[var(--app-hint)]">
                    {t('newSession.browse.current')}
                </div>
                <button
                    type="button"
                    onClick={() => props.onPathChange(getParentPath(effectivePath))}
                    disabled={props.isDisabled || !canGoUp}
                    className="text-xs font-medium text-[var(--app-link)] disabled:opacity-50"
                >
                    {t('newSession.browse.up')}
                </button>
            </div>
            <div className="mt-1 truncate rounded bg-[var(--app-subtle-bg)] px-2 py-1 text-xs font-mono">
                {currentPathLabel}
            </div>

            <div className="mt-2 max-h-48 overflow-y-auto rounded border border-[var(--app-border)]">
                {isLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--app-hint)]">
                        <Spinner size="sm" label={null} />
                        {t('newSession.browse.loading')}
                    </div>
                ) : error ? (
                    <div className="px-3 py-2 text-xs text-red-600">
                        {error}
                    </div>
                ) : directories.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                        {t('newSession.browse.empty')}
                    </div>
                ) : (
                    directories.map((entry) => {
                        const nextPath = joinPath(effectivePath, entry.name)
                        return (
                            <button
                                key={nextPath}
                                type="button"
                                onClick={() => props.onPathChange(nextPath)}
                                disabled={props.isDisabled}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                            >
                                <FolderIcon className="text-[var(--app-link)]" />
                                <span className="truncate">{entry.name}</span>
                            </button>
                        )
                    })
                )}
            </div>

            <div className="mt-3 flex flex-col gap-2">
                <label className="text-xs font-medium text-[var(--app-hint)]">
                    {t('newSession.browse.newFolder')}
                </label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newFolderName}
                        onChange={(event) => setNewFolderName(event.target.value)}
                        placeholder={t('newSession.browse.newFolder.placeholder')}
                        disabled={props.isDisabled || isCreating}
                        className="flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                    />
                    <Button
                        variant="secondary"
                        onClick={handleCreateFolder}
                        disabled={props.isDisabled || isCreating || !newFolderName.trim() || !effectivePath}
                    >
                        {t('newSession.browse.newFolder.create')}
                    </Button>
                </div>
                {createError ? (
                    <div className="text-xs text-red-600">
                        {createError}
                    </div>
                ) : null}
            </div>

            <div className="mt-3">
                <Button
                    onClick={() => props.onSelectPath(effectivePath)}
                    disabled={props.isDisabled || !effectivePath}
                    className="w-full"
                >
                    {t('newSession.browse.use')}
                </Button>
            </div>
        </div>
    )
}
