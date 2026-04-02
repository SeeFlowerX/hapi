import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import type { FileSearchItem, GitFileStatus } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useGitStatusFiles } from '@/hooks/queries/useGitStatusFiles'
import { useSession } from '@/hooks/queries/useSession'
import { useSessionFileSearch } from '@/hooks/queries/useSessionFileSearch'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { parseGitLog, type GitLogEntry } from '@/lib/gitParsers'
import { decodeBase64, encodeBase64 } from '@/lib/utils'
import { queryKeys } from '@/lib/query-keys'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, CopyIcon } from '@/components/icons'

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function RefreshIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
        </svg>
    )
}

function SearchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    )
}

function GitBranchIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
    )
}

function FolderIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
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

function StatusBadge(props: { status: GitFileStatus['status'] }) {
    const { label, color } = useMemo(() => {
        switch (props.status) {
            case 'added':
                return { label: 'A', color: 'var(--app-git-staged-color)' }
            case 'deleted':
                return { label: 'D', color: 'var(--app-git-deleted-color)' }
            case 'renamed':
                return { label: 'R', color: 'var(--app-git-renamed-color)' }
            case 'untracked':
                return { label: '?', color: 'var(--app-git-untracked-color)' }
            case 'conflicted':
                return { label: 'U', color: 'var(--app-git-deleted-color)' }
            default:
                return { label: 'M', color: 'var(--app-git-unstaged-color)' }
        }
    }, [props.status])

    return (
        <span
            className="inline-flex items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ color, borderColor: color }}
        >
            {label}
        </span>
    )
}

function LineChanges(props: { added: number; removed: number }) {
    if (!props.added && !props.removed) return null

    return (
        <span className="flex items-center gap-1 text-[11px] font-mono">
            {props.added ? (
                <span className="text-[var(--app-diff-added-text)]">+{props.added}</span>
            ) : null}
            {props.removed ? (
                <span className="text-[var(--app-diff-removed-text)]">-{props.removed}</span>
            ) : null}
        </span>
    )
}

function GitFileRow(props: {
    file: GitFileStatus
    onOpen: () => void
    showDivider: boolean
}) {
    const { copied, copy } = useCopyToClipboard()
    const subtitle = props.file.filePath || 'project root'
    const copyPath = props.file.fullPath

    return (
        <div
            className={`flex w-full items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--app-subtle-bg)] ${props.showDivider ? 'border-b border-[var(--app-divider)]' : ''}`}
        >
            <button
                type="button"
                onClick={props.onOpen}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
                <FileIcon fileName={props.file.fileName} size={22} />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{props.file.fileName}</div>
                    <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
                </div>
                <div className="flex items-center gap-2">
                    <LineChanges added={props.file.linesAdded} removed={props.file.linesRemoved} />
                    <StatusBadge status={props.file.status} />
                </div>
            </button>
            <button
                type="button"
                onClick={() => copy(copyPath)}
                className="shrink-0 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] transition-colors"
                title="Copy path"
            >
                {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
        </div>
    )
}

function SearchResultRow(props: {
    file: FileSearchItem
    onOpen: () => void
    showDivider: boolean
}) {
    const subtitle = props.file.filePath || 'project root'
    const icon = props.file.fileType === 'file'
        ? <FileIcon fileName={props.file.fileName} size={22} />
        : <FolderIcon className="text-[var(--app-link)]" />

    return (
        <button
            type="button"
            onClick={props.onOpen}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--app-subtle-bg)] transition-colors ${props.showDivider ? 'border-b border-[var(--app-divider)]' : ''}`}
        >
            {icon}
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{props.file.fileName}</div>
                <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
            </div>
        </button>
    )
}

function FileListSkeleton(props: { label: string; rows?: number }) {
    const titleWidths = ['w-1/3', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5']
    const subtitleWidths = ['w-1/2', 'w-2/3', 'w-3/4', 'w-1/3']
    const rows = props.rows ?? 6

    return (
        <div className="p-3 animate-pulse space-y-3" role="status" aria-live="polite">
            <span className="sr-only">{props.label}</span>
            {Array.from({ length: rows }).map((_, index) => (
                <div key={`skeleton-row-${index}`} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded bg-[var(--app-subtle-bg)]" />
                    <div className="flex-1 space-y-2">
                        <div className={`h-3 ${titleWidths[index % titleWidths.length]} rounded bg-[var(--app-subtle-bg)]`} />
                        <div className={`h-2 ${subtitleWidths[index % subtitleWidths.length]} rounded bg-[var(--app-subtle-bg)]`} />
                    </div>
                </div>
            ))}
        </div>
    )
}

function formatCommitTime(value: string): string {
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) return value
    const delta = Date.now() - ms
    if (delta < 60_000) return 'just now'
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return new Date(ms).toLocaleDateString()
}

function CommitRow(props: {
    entry: GitLogEntry
    onOpen: () => void
}) {
    const shortHash = props.entry.hash.slice(0, 8)
    return (
        <button
            type="button"
            onClick={props.onOpen}
            className="flex w-full flex-col gap-1 px-3 py-3 text-left hover:bg-[var(--app-subtle-bg)] transition-colors"
        >
            <div className="flex items-center justify-between gap-3">
                <div
                    className="truncate text-sm font-medium"
                    title={props.entry.message || 'No message'}
                >
                    {props.entry.message || 'No message'}
                </div>
                <span className="shrink-0 text-xs text-[var(--app-hint)]">{shortHash}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-[var(--app-hint)]">
                <span className="truncate">{props.entry.author || 'Unknown'}</span>
                <span className="shrink-0">{formatCommitTime(props.entry.date)}</span>
            </div>
        </button>
    )
}

function decodeExpandedDirectories(value: unknown): Set<string> {
    if (typeof value !== 'string' || !value) {
        return new Set([''])
    }

    const decoded = decodeBase64(value)
    if (!decoded.ok) {
        return new Set([''])
    }

    try {
        const parsed = JSON.parse(decoded.text)
        if (!Array.isArray(parsed)) {
            return new Set([''])
        }

        const next = new Set<string>()
        for (const entry of parsed) {
            if (typeof entry === 'string') {
                next.add(entry)
            }
        }
        if (!next.has('')) {
            next.add('')
        }
        return next
    } catch {
        return new Set([''])
    }
}

function encodeExpandedDirectories(value: Set<string>): string {
    return encodeBase64(JSON.stringify(Array.from(value)))
}

export default function FilesPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const goBack = useAppGoBack()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/files' })
    const search = useSearch({ from: '/sessions/$sessionId/files' })
    const { session } = useSession(api, sessionId)
    const [searchQuery, setSearchQuery] = useState('')

    const initialTab = search.tab === 'directories'
        ? 'directories'
        : search.tab === 'history'
            ? 'history'
            : 'changes'
    const [activeTab, setActiveTab] = useState<'changes' | 'directories' | 'history'>(initialTab)
    const expandedDirectories = useMemo(() => decodeExpandedDirectories(search.expanded), [search.expanded])

    const {
        status: gitStatus,
        error: gitError,
        isLoading: gitLoading,
        refetch: refetchGit
    } = useGitStatusFiles(api, sessionId)

    const isSearchDisabled = activeTab === 'history'
    const shouldSearch = Boolean(searchQuery) && !isSearchDisabled

    const searchResults = useSessionFileSearch(api, sessionId, searchQuery, {
        enabled: shouldSearch
    })

    const logLimit = 50
    const gitLogQuery = useQuery({
        queryKey: queryKeys.gitLog(sessionId, logLimit, 0),
        queryFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Missing session')
            }
            return await api.getGitLog(sessionId, { limit: logLimit })
        },
        enabled: Boolean(api && sessionId && activeTab === 'history')
    })

    const gitLogError = gitLogQuery.data && !gitLogQuery.data.success
        ? (gitLogQuery.data.error ?? gitLogQuery.data.stderr ?? 'Failed to load history')
        : gitLogQuery.error instanceof Error
            ? gitLogQuery.error.message
            : gitLogQuery.error
                ? 'Failed to load history'
                : null
    const gitLogEntries = useMemo(() => {
        if (!gitLogQuery.data?.success) return []
        return parseGitLog(gitLogQuery.data.stdout ?? '')
    }, [gitLogQuery.data])

    const handleOpenFile = useCallback((path: string, staged?: boolean) => {
        const expanded = encodeExpandedDirectories(expandedDirectories)
        const fileSearch = staged === undefined
            ? (activeTab === 'directories'
                ? { path: encodeBase64(path), tab: 'directories' as const, expanded }
                : { path: encodeBase64(path) })
            : (activeTab === 'directories'
                ? { path: encodeBase64(path), staged, tab: 'directories' as const, expanded }
                : { path: encodeBase64(path), staged })
        navigate({
            to: '/sessions/$sessionId/file',
            params: { sessionId },
            search: fileSearch
        })
    }, [activeTab, expandedDirectories, navigate, sessionId])

    const handleOpenCommit = useCallback((hash: string) => {
        navigate({
            to: '/sessions/$sessionId/commit',
            params: { sessionId },
            search: { sha: hash, tab: 'history' }
        })
    }, [navigate, sessionId])

    const branchLabel = gitStatus?.branch ?? 'detached'
    const subtitle = session?.metadata?.path ?? sessionId
    const showGitErrorBanner = Boolean(gitError)
    const rootLabel = useMemo(() => {
        const base = session?.metadata?.path ?? sessionId
        const parts = base.split(/[/\\]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : base
    }, [session?.metadata?.path, sessionId])

    const handleRefresh = useCallback(() => {
        if (activeTab === 'history') {
            void queryClient.invalidateQueries({
                queryKey: queryKeys.gitLog(sessionId, logLimit, 0)
            })
            return
        }

        if (searchQuery && !isSearchDisabled) {
            void queryClient.invalidateQueries({
                queryKey: queryKeys.sessionFiles(sessionId, searchQuery)
            })
            return
        }

        if (activeTab === 'directories') {
            void queryClient.invalidateQueries({
                queryKey: ['session-directory', sessionId]
            })
            return
        }

        void refetchGit()
    }, [activeTab, queryClient, refetchGit, searchQuery, sessionId, logLimit, isSearchDisabled])

    const handleTabChange = useCallback((nextTab: 'changes' | 'directories' | 'history') => {
        setActiveTab(nextTab)
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId },
            search: nextTab === 'changes'
                ? {}
                : nextTab === 'directories'
                    ? { tab: nextTab, ...(search.expanded ? { expanded: search.expanded } : {}) }
                    : { tab: nextTab },
            replace: true,
        })
    }, [navigate, search.expanded, sessionId])

    const handleToggleDirectory = useCallback((path: string) => {
        const next = new Set(expandedDirectories)
        if (next.has(path)) {
            next.delete(path)
        } else {
            next.add(path)
        }

        const expanded = encodeExpandedDirectories(next)
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId },
            search: {
                tab: 'directories',
                expanded
            },
            replace: true,
        })
    }, [expandedDirectories, navigate, sessionId])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3 border-b border-[var(--app-border)]">
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">Files</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
                    </div>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title="Refresh"
                    >
                        <RefreshIcon />
                    </button>
                </div>
            </div>

            <div className="bg-[var(--app-bg)]">
                <div className="mx-auto w-full max-w-content p-3 border-b border-[var(--app-border)]">
                    <div className="flex items-center gap-2 rounded-md bg-[var(--app-subtle-bg)] px-3 py-2">
                        <SearchIcon className="text-[var(--app-hint)]" />
                        <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search files"
                            className="w-full bg-transparent text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none"
                            autoCapitalize="none"
                            autoCorrect="off"
                            disabled={isSearchDisabled}
                        />
                    </div>
                </div>
            </div>

            <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)]" role="tablist">
                <div className="mx-auto w-full max-w-content grid grid-cols-3">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'changes'}
                        onClick={() => handleTabChange('changes')}
                        className={`relative py-3 text-center text-sm font-semibold transition-colors hover:bg-[var(--app-subtle-bg)] ${activeTab === 'changes' ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}
                    >
                        Changes
                        <span
                            className={`absolute bottom-0 left-1/2 h-0.5 w-10 -translate-x-1/2 rounded-full ${activeTab === 'changes' ? 'bg-[var(--app-link)]' : 'bg-transparent'}`}
                        />
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'history'}
                        onClick={() => handleTabChange('history')}
                        className={`relative py-3 text-center text-sm font-semibold transition-colors hover:bg-[var(--app-subtle-bg)] ${activeTab === 'history' ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}
                    >
                        History
                        <span
                            className={`absolute bottom-0 left-1/2 h-0.5 w-10 -translate-x-1/2 rounded-full ${activeTab === 'history' ? 'bg-[var(--app-link)]' : 'bg-transparent'}`}
                        />
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'directories'}
                        onClick={() => handleTabChange('directories')}
                        className={`relative py-3 text-center text-sm font-semibold transition-colors hover:bg-[var(--app-subtle-bg)] ${activeTab === 'directories' ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'}`}
                    >
                        Directories
                        <span
                            className={`absolute bottom-0 left-1/2 h-0.5 w-10 -translate-x-1/2 rounded-full ${activeTab === 'directories' ? 'bg-[var(--app-link)]' : 'bg-transparent'}`}
                        />
                    </button>
                </div>
            </div>

            {!gitLoading && gitStatus && !searchQuery && activeTab === 'changes' ? (
                <div className="bg-[var(--app-bg)]">
                    <div className="mx-auto w-full max-w-content px-3 py-2 border-b border-[var(--app-divider)]">
                        <div className="flex items-center gap-2 text-sm">
                            <GitBranchIcon className="text-[var(--app-hint)]" />
                            <span className="font-semibold">{branchLabel}</span>
                        </div>
                        <div className="text-xs text-[var(--app-hint)]">
                            {gitStatus.totalStaged} staged, {gitStatus.totalUnstaged} unstaged
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="app-scroll-y flex-1 min-h-0">
                <div className="mx-auto w-full max-w-content">
                    {showGitErrorBanner && activeTab === 'changes' ? (
                        <div className="border-b border-[var(--app-divider)] bg-amber-500/10 px-3 py-2 text-xs text-[var(--app-hint)]">
                            {gitError}
                        </div>
                    ) : null}
                    {activeTab === 'history' ? (
                        gitLogQuery.isLoading ? (
                            <FileListSkeleton label="Loading history…" />
                        ) : gitLogError ? (
                            <div className="p-6 text-sm text-[var(--app-hint)]">{gitLogError}</div>
                        ) : gitLogEntries.length === 0 ? (
                            <div className="p-6 text-sm text-[var(--app-hint)]">No commits found.</div>
                        ) : (
                            <div className="border-t border-[var(--app-divider)]">
                                {gitLogEntries.map((entry) => (
                                    <CommitRow
                                        key={entry.hash}
                                        entry={entry}
                                        onOpen={() => handleOpenCommit(entry.hash)}
                                    />
                                ))}
                            </div>
                        )
                    ) : shouldSearch ? (
                        searchResults.isLoading ? (
                            <FileListSkeleton label="Loading files…" />
                        ) : searchResults.error ? (
                            <div className="p-6 text-sm text-[var(--app-hint)]">{searchResults.error}</div>
                        ) : searchResults.files.length === 0 ? (
                            <div className="p-6 text-sm text-[var(--app-hint)]">
                                {searchQuery ? 'No files match your search.' : 'No files found in this project.'}
                            </div>
                        ) : (
                            <div className="border-t border-[var(--app-divider)]">
                                {searchResults.files.map((file, index) => (
                                    <SearchResultRow
                                        key={`${file.fullPath}-${index}`}
                                        file={file}
                                        onOpen={() => handleOpenFile(file.fullPath)}
                                        showDivider={index < searchResults.files.length - 1}
                                    />
                                ))}
                            </div>
                        )
                    ) : activeTab === 'directories' ? (
                        <DirectoryTree
                            api={api}
                            sessionId={sessionId}
                            rootLabel={rootLabel}
                            onOpenFile={(path) => handleOpenFile(path)}
                            expanded={expandedDirectories}
                            onToggle={handleToggleDirectory}
                        />
                    ) : gitLoading ? (
                        <FileListSkeleton label="Loading Git status…" />
                    ) : (
                        <div>
                            {gitStatus?.stagedFiles.length ? (
                                <div>
                                    <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs font-semibold text-[var(--app-git-staged-color)]">
                                        Staged Changes ({gitStatus.stagedFiles.length})
                                    </div>
                                    {gitStatus.stagedFiles.map((file, index) => (
                                        <GitFileRow
                                            key={`staged-${file.fullPath}-${index}`}
                                            file={file}
                                            onOpen={() => handleOpenFile(file.fullPath, file.isStaged)}
                                            showDivider={index < gitStatus.stagedFiles.length - 1 || gitStatus.unstagedFiles.length > 0}
                                        />
                                    ))}
                                </div>
                            ) : null}

                            {gitStatus?.unstagedFiles.length ? (
                                <div>
                                    <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs font-semibold text-[var(--app-git-unstaged-color)]">
                                        Unstaged Changes ({gitStatus.unstagedFiles.length})
                                    </div>
                                    {gitStatus.unstagedFiles.map((file, index) => (
                                        <GitFileRow
                                            key={`unstaged-${file.fullPath}-${index}`}
                                            file={file}
                                            onOpen={() => handleOpenFile(file.fullPath, file.isStaged)}
                                            showDivider={index < gitStatus.unstagedFiles.length - 1}
                                        />
                                    ))}
                                </div>
                            ) : null}

                            {!gitStatus ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">
                                    Git status unavailable. Use Directories to browse all files, or search.
                                </div>
                            ) : null}

                            {gitStatus && gitStatus.stagedFiles.length === 0 && gitStatus.unstagedFiles.length === 0 ? (
                                <div className="p-6 text-sm text-[var(--app-hint)]">
                                    No changes detected. Use Directories to browse all files, or search.
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
