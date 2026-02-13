import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useSearch } from '@tanstack/react-router'
import type { GitCommandResponse } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { queryKeys } from '@/lib/query-keys'

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

function DiffDisplay(props: { diffContent: string }) {
    const lines = props.diffContent.split('\n')

    return (
        <div className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-bg)]">
            {lines.map((line, index) => {
                const isAdd = line.startsWith('+') && !line.startsWith('+++')
                const isRemove = line.startsWith('-') && !line.startsWith('---')
                const isHunk = line.startsWith('@@')
                const isHeader = line.startsWith('+++') || line.startsWith('---')

                const className = [
                    'whitespace-pre-wrap px-3 py-0.5 text-xs font-mono',
                    isAdd ? 'bg-[var(--app-diff-added-bg)] text-[var(--app-diff-added-text)]' : '',
                    isRemove ? 'bg-[var(--app-diff-removed-bg)] text-[var(--app-diff-removed-text)]' : '',
                    isHunk ? 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] font-semibold' : '',
                    isHeader ? 'text-[var(--app-hint)] font-semibold' : ''
                ].filter(Boolean).join(' ')

                const style = isAdd
                    ? { borderLeft: '2px solid var(--app-git-staged-color)' }
                    : isRemove
                        ? { borderLeft: '2px solid var(--app-git-deleted-color)' }
                        : undefined

                return (
                    <div key={`${index}-${line}`} className={className} style={style}>
                        {line || ' '}
                    </div>
                )
            })}
        </div>
    )
}

function extractCommandError(result: GitCommandResponse | undefined): string | null {
    if (!result) return null
    if (result.success) return null
    return result.error ?? result.stderr ?? 'Failed to load diff'
}

function extractDiffContent(output: string): string {
    const marker = 'diff --git'
    const index = output.indexOf(marker)
    if (index >= 0) {
        return output.slice(index)
    }
    return output
}

export default function CommitPage() {
    const { api } = useAppContext()
    const goBack = useAppGoBack()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/commit' })
    const search = useSearch({ from: '/sessions/$sessionId/commit' })
    const commit = typeof search.sha === 'string' ? search.sha : ''
    const shortCommit = commit ? commit.slice(0, 8) : 'Commit'

    const diffQuery = useQuery({
        queryKey: queryKeys.gitShow(sessionId, commit),
        queryFn: async () => {
            if (!api || !sessionId || !commit) {
                throw new Error('Missing session or commit')
            }
            return await api.getGitShow(sessionId, commit)
        },
        enabled: Boolean(api && sessionId && commit)
    })

    const diffError = extractCommandError(diffQuery.data)
    const diffContent = diffQuery.data?.success ? extractDiffContent(diffQuery.data.stdout ?? '') : ''

    const errorMessage = useMemo(() => {
        if (!commit) return 'No commit selected.'
        return diffError
    }, [commit, diffError])

    return (
        <div className="flex h-full flex-col">
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
                        <div className="truncate font-semibold">Commit {shortCommit}</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{commit || 'Unknown commit'}</div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content p-4">
                    {errorMessage ? (
                        <div className="text-sm text-[var(--app-hint)]">{errorMessage}</div>
                    ) : diffQuery.isLoading ? (
                        <div className="text-sm text-[var(--app-hint)]">Loading commit diff…</div>
                    ) : diffContent ? (
                        <DiffDisplay diffContent={diffContent} />
                    ) : (
                        <div className="text-sm text-[var(--app-hint)]">No diff to display.</div>
                    )}
                </div>
            </div>
        </div>
    )
}
