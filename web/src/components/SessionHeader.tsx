import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { useMachines } from '@/hooks/queries/useMachines'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'
import { usePlatform } from '@/hooks/usePlatform'
import { useToast } from '@/lib/toast-context'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { PlusCircleIcon } from '@/components/icons'
import { queryKeys } from '@/lib/query-keys'
import { isKnownFlavor } from '@/lib/agentFlavorUtils'
import { fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'
import { getMachineLabel } from '@/lib/machineLabel'
import { ReadOnlyBadge } from '@/components/ReadOnlyBadge'
import type { LatestUsage } from '@/chat/reducer'

function getSessionTitle(session: Session): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function FilesIcon(props: { className?: string }) {
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
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    )
}

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
        </svg>
    )
}

export function SessionHeader(props: {
    session: Session
    codexModelLabel?: string | null
    latestUsage?: LatestUsage | null
    onBack: () => void
    onViewFiles?: () => void
    api: ApiClient | null
    onSessionDeleted?: () => void
    onRefresh?: () => void
}) {
    const { t } = useTranslation()
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { copied: worktreeCopied, copy: copyWorktree } = useCopyToClipboard()
    const { copied: codexCopied, copy: copyCodex } = useCopyToClipboard()
    const { session, api, onSessionDeleted } = props
    const title = useMemo(() => getSessionTitle(session), [session])
    const worktreeBranch = session.metadata?.worktree?.branch
    const codexSessionId = session.metadata?.codexSessionId
    const isReadOnly = Boolean(session.metadata?.readOnly)
    const { machines } = useMachines(api, true)
    const machineLabel = useMemo(() => {
        const machineId = session.metadata?.machineId ?? null
        const machine = machineId ? machines.find(item => item.id === machineId) ?? null : null
        if (!session.metadata) {
            return null
        }
        return getMachineLabel({
            machine,
            metadata: {
                path: session.metadata.path,
                host: session.metadata.host,
                os: session.metadata.os,
                machineId: session.metadata.machineId
            }
        })
    }, [
        machines,
        session.metadata?.machineId,
        session.metadata?.host,
        session.metadata?.os,
        session.metadata?.path
    ])

    const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false)
    const [worktreeName, setWorktreeName] = useState('')
    const [worktreeError, setWorktreeError] = useState<string | null>(null)
    const worktreeInputRef = useRef<HTMLInputElement | null>(null)

    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const menuId = useId()
    const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [activatePending, setActivatePending] = useState(false)
    const [statusOpen, setStatusOpen] = useState(false)

    const { archiveSession, renameSession, deleteSession, isPending } = useSessionActions(
        api,
        session.id,
        session.metadata?.flavor ?? null
    )
    const { spawnSession, isPending: spawnPending } = useSpawnSession(api)

    const gitStatusQuery = useQuery({
        queryKey: queryKeys.gitStatus(session.id),
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getGitStatus(session.id)
        },
        enabled: Boolean(api && session.id),
        staleTime: 10_000
    })

    useEffect(() => {
        if (worktreeDialogOpen) {
            setWorktreeName('')
            setWorktreeError(null)
            setTimeout(() => {
                worktreeInputRef.current?.focus()
            }, 100)
        }
    }, [worktreeDialogOpen])

    const handleActivate = useCallback(async () => {
        if (!api || activatePending) return
        if (isReadOnly) return
        if (session.active) {
            addToast({
                title: t('session.activate.already.title'),
                body: t('session.activate.already.body'),
                sessionId: session.id,
                url: ''
            })
            return
        }
        setActivatePending(true)
        try {
            const resumedSessionId = await api.resumeSession(session.id)
            haptic.notification('success')
            void (async () => {
                if (api) {
                    if (resumedSessionId !== session.id) {
                        seedMessageWindowFromSession(session.id, resumedSessionId)
                        queryClient.setQueryData(queryKeys.session(resumedSessionId), {
                            session: { ...session, id: resumedSessionId, active: true }
                        })
                    }
                    try {
                        await Promise.all([
                            queryClient.prefetchQuery({
                                queryKey: queryKeys.session(resumedSessionId),
                                queryFn: () => api.getSession(resumedSessionId),
                            }),
                            fetchLatestMessages(api, resumedSessionId),
                        ])
                    } catch {
                    }
                }
                navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: resumedSessionId },
                    replace: true
                })
            })()
        } catch (error) {
            haptic.notification('error')
            const message = error instanceof Error ? error.message : 'Resume failed'
            addToast({
                title: 'Resume failed',
                body: message,
                sessionId: session.id,
                url: ''
            })
        } finally {
            setActivatePending(false)
        }
    }, [
        api,
        session,
        haptic,
        addToast,
        activatePending,
        t,
        navigate,
        queryClient,
        isReadOnly
    ])

    const handleDelete = async () => {
        await deleteSession()
        onSessionDeleted?.()
    }

    const handleMenuToggle = () => {
        if (!menuOpen && menuAnchorRef.current) {
            const rect = menuAnchorRef.current.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.right, y: rect.bottom })
        }
        setMenuOpen((open) => !open)
    }

    const handleCompact = useCallback(async () => {
        if (!api) {
            addToast({
                title: t('dialog.error.default'),
                body: t('worktree.create.unavailable.api'),
                sessionId: session.id,
                url: ''
            })
            return
        }
        try {
            await api.sendMessage(session.id, '/compact')
        } catch (error) {
            const message = error instanceof Error ? error.message : t('dialog.error.default')
            addToast({
                title: t('dialog.error.default'),
                body: message,
                sessionId: session.id,
                url: ''
            })
        }
    }, [api, addToast, session.id, t])

    const handleWorktreeCopy = useCallback(() => {
        if (!worktreeBranch) return
        void (async () => {
            const ok = await copyWorktree(worktreeBranch)
            if (!ok) {
                addToast({
                    title: t('toast.copyFailed.title'),
                    body: t('toast.copyFailed.body'),
                    sessionId: session.id,
                    url: ''
                })
                return
            }
            addToast({
                title: t('toast.copy.title'),
                body: t('toast.copy.body'),
                sessionId: session.id,
                url: ''
            })
        })()
    }, [copyWorktree, worktreeBranch, addToast, t, session.id])

    const baseDirectory = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? null
    const isWorktreeSession = Boolean(session.metadata?.worktree)
    const hasMachine = Boolean(session.metadata?.machineId)
    const gitStatusResult = gitStatusQuery.data
    const flavor = session.metadata?.flavor ?? null
    const hasKnownFlavor = isKnownFlavor(flavor)
    const canCompact = flavor === 'codex'
    const isGitRepo = gitStatusResult?.success === true
    const isGitLoading = gitStatusQuery.isLoading
    const gitFailed = Boolean(gitStatusQuery.error) || gitStatusResult?.success === false

    const worktreeStatus = (() => {
        if (!api) return 'no-api'
        if (!hasMachine) return 'missing-machine'
        if (!baseDirectory) return 'missing-path'
        if (!hasKnownFlavor) return 'invalid-flavor'
        if (isWorktreeSession) return 'already-worktree'
        if (isGitLoading) return 'checking'
        if (!isGitRepo || gitFailed) return 'not-git'
        return 'ready'
    })()

    const runtimeModeLabel = useMemo(() => {
        const controlled = session.agentState?.controlledByUser
        if (controlled === true) return t('session.status.mode.local')
        if (controlled === false) return t('session.status.mode.remote')
        return '-'
    }, [session.agentState?.controlledByUser, t])

    const activeLabel = session.active ? t('session.status.active.yes') : t('session.status.active.no')
    const thinkingLabel = session.thinking ? t('session.status.thinking.yes') : t('session.status.thinking.no')
    const usageFromAgent = useMemo<LatestUsage | null>(() => {
        const tokenUsage = session.agentState?.tokenUsage
        if (!tokenUsage) {
            return null
        }
        const inputTokens = tokenUsage.inputTokens ?? null
        const outputTokens = tokenUsage.outputTokens ?? null
        const totalTokens = tokenUsage.totalTokens ?? null
        if (inputTokens === null && outputTokens === null && totalTokens === null) {
            return null
        }
        const resolvedInput = inputTokens ?? totalTokens ?? 0
        const resolvedOutput = outputTokens ?? 0
        const cacheCreation = tokenUsage.cacheCreationInputTokens ?? 0
        const cacheRead = tokenUsage.cacheReadInputTokens ?? 0
        return {
            inputTokens: resolvedInput,
            outputTokens: resolvedOutput,
            cacheCreation,
            cacheRead,
            contextSize: resolvedInput + cacheCreation + cacheRead,
            timestamp: tokenUsage.updatedAt ?? Date.now()
        }
    }, [session.agentState?.tokenUsage])

    const usage = props.latestUsage ?? usageFromAgent
    const usageTimestamp = usage?.timestamp ? new Date(usage.timestamp).toLocaleString() : '-'

    const handleWorktreeClick = () => {
        if (worktreeStatus === 'ready') {
            setWorktreeDialogOpen(true)
            return
        }

        const body = (() => {
            switch (worktreeStatus) {
                case 'no-api':
                    return t('worktree.create.unavailable.api')
                case 'missing-machine':
                    return t('worktree.create.unavailable.machine')
                case 'missing-path':
                    return t('worktree.create.unavailable.path')
                case 'invalid-flavor':
                    return t('worktree.create.unavailable.flavor')
                case 'already-worktree':
                    return t('worktree.create.unavailable.worktree')
                case 'checking':
                    return t('worktree.create.unavailable.checking')
                case 'not-git':
                default:
                    return t('worktree.create.unavailable.notGit')
            }
        })()

        addToast({
            title: t('worktree.create.unavailable.title'),
            body,
            sessionId: session.id,
            url: ''
        })
    }

    const handleWorktreeSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        const trimmed = worktreeName.trim()
        if (!trimmed) {
            return
        }
        if (!api || !baseDirectory || !session.metadata?.machineId || !hasKnownFlavor) {
            setWorktreeError(hasKnownFlavor ? t('dialog.error.default') : t('worktree.create.unavailable.flavor'))
            return
        }
        setWorktreeError(null)
        try {
            const result = await spawnSession({
                machineId: session.metadata.machineId,
                directory: baseDirectory,
                sessionType: 'worktree',
                worktreeName: trimmed,
                agent: hasKnownFlavor ? (session.metadata?.flavor ?? undefined) : undefined,
                model: session.codexModel ?? undefined
            })
            if (result.type !== 'success') {
                throw new Error(result.message)
            }
            haptic.notification('success')
            setWorktreeDialogOpen(false)
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: result.sessionId }
            })
        } catch (error) {
            haptic.notification('error')
            setWorktreeError(error instanceof Error ? error.message : t('dialog.error.default'))
        }
    }

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    return (
        <>
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3">
                    {/* Back button */}
                    <button
                        type="button"
                        onClick={props.onBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
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
                        >
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>

                    {/* Session info - two lines: title and path */}
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="truncate font-semibold">
                                {title}
                            </div>
                            {isReadOnly ? (
                                <ReadOnlyBadge reason={session.metadata?.readOnlyReason} />
                            ) : null}
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--app-hint)]">
                            {machineLabel ? (
                                <span className="min-w-0">
                                    {machineLabel}
                                </span>
                            ) : null}
                            <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true">❖</span>
                                {session.metadata?.flavor?.trim() || 'unknown'}
                            </span>
                            {session.metadata?.flavor === 'codex' && props.codexModelLabel ? (
                                <span>
                                    {t('session.item.modelMode')}: {props.codexModelLabel}
                                </span>
                            ) : (
                                <span>
                                    {t('session.item.modelMode')}: {session.modelMode || 'default'}
                                </span>
                            )}
                            {codexSessionId ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void copyCodex(codexSessionId)
                                    }}
                                    className="min-w-0 inline-flex items-center gap-1 text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors"
                                    title={t('button.copy')}
                                >
                                    <span className="shrink-0">{t('session.item.codexSession')}:</span>
                                    <span className="min-w-0 truncate">{codexSessionId}</span>
                                    {codexCopied ? (
                                        <span className="shrink-0 rounded-full bg-[var(--app-secondary-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--app-link)]">
                                            {t('toast.copy.title')}
                                        </span>
                                    ) : null}
                                </button>
                            ) : null}
                            {worktreeBranch ? (
                                <button
                                    type="button"
                                    onClick={handleWorktreeCopy}
                                    className="inline-flex items-center gap-1 text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors"
                                    title={t('button.copy')}
                                >
                                    <span className="shrink-0">{t('session.item.worktree')}:</span>
                                    <span className="min-w-0 truncate">{worktreeBranch}</span>
                                    {worktreeCopied ? (
                                        <span className="shrink-0 rounded-full bg-[var(--app-secondary-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--app-link)]">
                                            {t('toast.copy.title')}
                                        </span>
                                    ) : null}
                                </button>
                            ) : null}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleWorktreeClick}
                        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                            worktreeStatus === 'ready'
                                ? 'text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'
                                : 'text-[var(--app-hint)] opacity-50'
                        }`}
                        title={t('worktree.create.button')}
                        aria-label={t('worktree.create.button')}
                        aria-disabled={worktreeStatus !== 'ready'}
                    >
                        <PlusCircleIcon className="h-4 w-4" />
                    </button>

                    {props.onViewFiles ? (
                        <button
                            type="button"
                            onClick={props.onViewFiles}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.title')}
                        >
                            <FilesIcon />
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={handleMenuToggle}
                        onPointerDown={(e) => e.stopPropagation()}
                        ref={menuAnchorRef}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? menuId : undefined}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.more')}
                    >
                        <MoreVerticalIcon />
                    </button>
                </div>
            </div>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={session.active}
                onActivate={handleActivate}
                activateDisabled={activatePending || isPending || isReadOnly}
                onStatus={() => setStatusOpen(true)}
                onCompact={canCompact ? handleCompact : undefined}
                onRename={() => setRenameOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onDelete={() => setDeleteOpen(true)}
                deleteDisabled={isPending || isReadOnly}
                anchorPoint={menuAnchorPoint}
                menuId={menuId}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={title}
                onRename={renameSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: title })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: title })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={handleDelete}
                isPending={isPending}
                destructive
            />

            <Dialog open={worktreeDialogOpen} onOpenChange={(open) => !open && setWorktreeDialogOpen(false)}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{t('worktree.create.title')}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleWorktreeSubmit} className="mt-4 flex flex-col gap-4">
                        <input
                            ref={worktreeInputRef}
                            type="text"
                            value={worktreeName}
                            onChange={(event) => setWorktreeName(event.target.value)}
                            placeholder={t('worktree.create.placeholder')}
                            className="w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)] focus:border-transparent"
                            disabled={spawnPending}
                            maxLength={255}
                        />

                        {worktreeError ? (
                            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                {worktreeError}
                            </div>
                        ) : null}

                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setWorktreeDialogOpen(false)}
                                disabled={spawnPending}
                            >
                                {t('button.cancel')}
                            </Button>
                            <Button
                                type="submit"
                                disabled={spawnPending || !worktreeName.trim()}
                            >
                                {spawnPending ? t('worktree.create.submitting') : t('worktree.create.submit')}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={statusOpen} onOpenChange={(open) => setStatusOpen(open)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{t('session.status.title')}</DialogTitle>
                    </DialogHeader>
                    <div className="mt-3 space-y-4 text-sm text-[var(--app-fg)]">
                        <div>
                            <div className="mb-2 text-xs font-semibold uppercase text-[var(--app-hint)]">
                                {t('session.status.section.session')}
                            </div>
                            <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-sm">
                                <div className="text-[var(--app-hint)]">{t('session.status.sessionId')}</div>
                                <div className="break-all">{session.id}</div>
                                {session.metadata?.codexSessionId ? (
                                    <>
                                        <div className="text-[var(--app-hint)]">{t('session.status.codexSessionId')}</div>
                                        <div className="break-all">{session.metadata.codexSessionId}</div>
                                    </>
                                ) : null}
                                <div className="text-[var(--app-hint)]">{t('session.status.machine')}</div>
                                <div className="break-all">{machineLabel ?? '-'}</div>
                                <div className="text-[var(--app-hint)]">{t('session.status.machineId')}</div>
                                <div className="break-all">{session.metadata?.machineId ?? '-'}</div>
                                <div className="text-[var(--app-hint)]">{t('session.status.path')}</div>
                                <div className="break-all">{session.metadata?.path ?? '-'}</div>
                                <div className="text-[var(--app-hint)]">{t('session.status.flavor')}</div>
                                <div>{session.metadata?.flavor?.trim() || '-'}</div>
                                <div className="text-[var(--app-hint)]">{t('session.status.model')}</div>
                                <div>{props.codexModelLabel || session.modelMode || '-'}</div>
                                <div className="text-[var(--app-hint)]">{t('session.status.permissionMode')}</div>
                                <div>{session.permissionMode || '-'}</div>
                                {session.metadata?.readOnly ? (
                                    <>
                                        <div className="text-[var(--app-hint)]">{t('session.status.readOnly')}</div>
                                        <div>
                                            {t('session.readOnly.badge')}
                                            {session.metadata?.readOnlyReason ? ` (${session.metadata.readOnlyReason})` : ''}
                                        </div>
                                    </>
                                ) : null}
                            </div>
                        </div>

                        <div>
                            <div className="mb-2 text-xs font-semibold uppercase text-[var(--app-hint)]">
                                {t('session.status.section.runtime')}
                            </div>
                            <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-sm">
                                <div className="text-[var(--app-hint)]">{t('session.status.mode')}</div>
                                <div>{runtimeModeLabel}</div>
                                <div className="text-[var(--app-hint)]">{t('session.status.active')}</div>
                                <div>{activeLabel}</div>
                                <div className="text-[var(--app-hint)]">{t('session.status.thinking')}</div>
                                <div>{thinkingLabel}</div>
                                {session.metadata?.lifecycleState ? (
                                    <>
                                        <div className="text-[var(--app-hint)]">{t('session.status.lifecycle')}</div>
                                        <div>{session.metadata.lifecycleState}</div>
                                    </>
                                ) : null}
                            </div>
                        </div>

                        <div>
                            <div className="mb-2 text-xs font-semibold uppercase text-[var(--app-hint)]">
                                {t('session.status.section.usage')}
                            </div>
                            {usage ? (
                                <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-sm">
                                    <div className="text-[var(--app-hint)]">{t('session.status.usage.context')}</div>
                                    <div>{usage.contextSize}</div>
                                    <div className="text-[var(--app-hint)]">{t('session.status.usage.input')}</div>
                                    <div>{usage.inputTokens}</div>
                                    <div className="text-[var(--app-hint)]">{t('session.status.usage.output')}</div>
                                    <div>{usage.outputTokens}</div>
                                    <div className="text-[var(--app-hint)]">{t('session.status.usage.cacheCreate')}</div>
                                    <div>{usage.cacheCreation}</div>
                                    <div className="text-[var(--app-hint)]">{t('session.status.usage.cacheRead')}</div>
                                    <div>{usage.cacheRead}</div>
                                    <div className="text-[var(--app-hint)]">{t('session.status.usage.updatedAt')}</div>
                                    <div>{usageTimestamp}</div>
                                </div>
                            ) : (
                                <div className="text-xs text-[var(--app-hint)]">
                                    {t('session.status.usage.empty')}
                                </div>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
