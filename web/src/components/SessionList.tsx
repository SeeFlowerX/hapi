import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { Machine, SessionSummary } from '@/types/api'
import { getCodexModelLabel, normalizeCodexModel } from '@/lib/codexModels'
import { getModelModeLabel } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useDefaultCodexModel } from '@/hooks/useDefaultCodexModel'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'
import { queryKeys } from '@/lib/query-keys'
import { getMachineLabel } from '@/lib/machineLabel'
import { ReadOnlyBadge } from '@/components/ReadOnlyBadge'
import { isCodexAutoSession } from '@/lib/codexSessionAuto'

type SessionGroup = {
    directory: string
    displayName: string
    sessions: SessionSummary[]
    latestUpdatedAt: number
    hasActiveSession: boolean
}

type MachineGroup = {
    machineId: string
    label: string
    machine?: Machine | null
    online: boolean
    sessions: SessionSummary[]
    directoryGroups: SessionGroup[]
    latestUpdatedAt: number
    hasActiveSession: boolean
}

function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

function groupSessionsByDirectory(sessions: SessionSummary[]): SessionGroup[] {
    const groups = new Map<string, SessionSummary[]>()

    sessions.forEach(session => {
        const path = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
        if (!groups.has(path)) {
            groups.set(path, [])
        }
        groups.get(path)!.push(session)
    })

    return Array.from(groups.entries())
        .map(([directory, groupSessions]) => {
            const sortedSessions = [...groupSessions].sort((a, b) => {
                const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
                const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
                if (rankA !== rankB) return rankA - rankB
                return b.updatedAt - a.updatedAt
            })
            const latestUpdatedAt = groupSessions.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                -Infinity
            )
            const hasActiveSession = groupSessions.some(s => s.active)
            const displayName = getGroupDisplayName(directory)

            return { directory, displayName, sessions: sortedSessions, latestUpdatedAt, hasActiveSession }
        })
        .sort((a, b) => {
            if (a.directory === 'Other' && b.directory !== 'Other') return 1
            if (a.directory !== 'Other' && b.directory === 'Other') return -1
            return a.directory.localeCompare(b.directory)
        })
}

function groupSessionsByMachine(sessions: SessionSummary[], machines: Map<string, Machine>): MachineGroup[] {
    const groups = new Map<string, SessionSummary[]>()

    sessions.forEach(session => {
        const machineId = session.metadata?.machineId ?? 'unknown'
        if (!groups.has(machineId)) {
            groups.set(machineId, [])
        }
        groups.get(machineId)!.push(session)
    })

    return Array.from(groups.entries())
        .map(([machineId, groupSessions]) => {
            const machine = machines.get(machineId) ?? null
            const latestUpdatedAt = groupSessions.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                -Infinity
            )
            const hasActiveSession = groupSessions.some(s => s.active)
            const directoryGroups = groupSessionsByDirectory(groupSessions)
            const label = getMachineLabel({
                machine,
                metadata: groupSessions[0]?.metadata ?? null,
                machineId
            })

            return {
                machineId,
                label,
                machine,
                online: Boolean(machine),
                sessions: groupSessions,
                directoryGroups,
                latestUpdatedAt,
                hasActiveSession
            }
        })
        .sort((a, b) => {
            const aUnknown = a.machineId === 'unknown'
            const bUnknown = b.machineId === 'unknown'
            if (aUnknown !== bUnknown) return aUnknown ? 1 : -1
            const labelA = a.label.toLowerCase()
            const labelB = b.label.toLowerCase()
            if (labelA !== labelB) return labelA.localeCompare(labelB)
            return a.machineId.localeCompare(b.machineId)
        })
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function BulbIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.2 1 2h6c0-.8.4-1.4 1-2a7 7 0 0 0-4-12Z" />
        </svg>
    )
}

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
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
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

type DirectoryMenuTarget = {
    machineId: string
    directory: string
}

type MenuPosition = {
    top: number
    left: number
    transformOrigin: string
}

function DirectoryActionMenu(props: {
    isOpen: boolean
    onClose: () => void
    anchorPoint: { x: number; y: number }
    onNewSession: () => void
}) {
    const { t } = useTranslation()
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)

    const updatePosition = useCallback(() => {
        const menuEl = menuRef.current
        if (!menuEl) return

        const menuRect = menuEl.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const padding = 8
        const gap = 8

        const spaceBelow = viewportHeight - props.anchorPoint.y
        const spaceAbove = props.anchorPoint.y
        const openAbove = spaceBelow < menuRect.height + gap && spaceAbove > spaceBelow

        let top = openAbove ? props.anchorPoint.y - menuRect.height - gap : props.anchorPoint.y + gap
        let left = props.anchorPoint.x - menuRect.width / 2
        const transformOrigin = openAbove ? 'bottom center' : 'top center'

        top = Math.min(Math.max(top, padding), viewportHeight - menuRect.height - padding)
        left = Math.min(Math.max(left, padding), viewportWidth - menuRect.width - padding)

        setMenuPosition({ top, left, transformOrigin })
    }, [props.anchorPoint])

    useLayoutEffect(() => {
        if (!props.isOpen) return
        updatePosition()
    }, [props.isOpen, updatePosition])

    useEffect(() => {
        if (!props.isOpen) {
            setMenuPosition(null)
            return
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (menuRef.current?.contains(target)) return
            props.onClose()
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                props.onClose()
            }
        }

        const handleReflow = () => {
            updatePosition()
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('resize', handleReflow)
        window.addEventListener('scroll', handleReflow, true)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('resize', handleReflow)
            window.removeEventListener('scroll', handleReflow, true)
        }
    }, [props.isOpen, props.onClose, updatePosition])

    if (!props.isOpen) return null

    const menuStyle: CSSProperties | undefined = menuPosition
        ? {
            top: menuPosition.top,
            left: menuPosition.left,
            transformOrigin: menuPosition.transformOrigin
        }
        : undefined

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
            style={menuStyle}
            role="menu"
        >
            <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-base transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                onClick={() => {
                    props.onClose()
                    props.onNewSession()
                }}
            >
                <PlusIcon className="h-4 w-4 text-[var(--app-hint)]" />
                {t('sessions.new')}
            </button>
        </div>
    )
}

function getSessionTitle(session: SessionSummary): string {
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

function getTodoProgress(session: SessionSummary): { completed: number; total: number } | null {
    if (!session.todoProgress) return null
    if (session.todoProgress.completed === session.todoProgress.total) return null
    return session.todoProgress
}

function getAgentLabel(session: SessionSummary): string {
    const flavor = session.metadata?.flavor?.trim()
    if (flavor) return flavor
    return 'unknown'
}

function formatRelativeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.daysAgo', { n: days })
    return new Date(ms).toLocaleDateString()
}

function SessionItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
    onRefresh: () => void
    showPath?: boolean
    api: ApiClient | null
    selected?: boolean
    resolvedDefaultCodexModel: string | null
}) {
    const { t } = useTranslation()
    const { session: s, onSelect, onRefresh, showPath = true, api, selected = false, resolvedDefaultCodexModel } = props
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [activatePending, setActivatePending] = useState(false)
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const { archiveSession, renameSession, deleteSession, isPending } = useSessionActions(
        api,
        s.id,
        s.metadata?.flavor ?? null
    )

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const isReadOnly = Boolean(s.metadata?.readOnly)
    const modelModeLabel = getModelModeLabel(s.modelMode ?? 'default')
    const statusDotClass = s.active
        ? (s.thinking ? 'bg-[#007AFF]' : 'bg-[var(--app-badge-success-text)]')
        : 'bg-[var(--app-hint)]'

    const handleActivate = async () => {
        if (!api || activatePending) return
        if (isReadOnly) {
            return
        }
        if (s.active) {
            addToast({
                title: t('session.activate.already.title'),
                body: t('session.activate.already.body'),
                sessionId: s.id,
                url: ''
            })
            return
        }
        setActivatePending(true)
        try {
            const resumedSessionId = await api.resumeSession(s.id)
            haptic.notification('success')
            void (async () => {
                if (api) {
                    if (resumedSessionId !== s.id) {
                        seedMessageWindowFromSession(s.id, resumedSessionId)
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
                onRefresh()
                if (selected && resumedSessionId !== s.id) {
                    navigate({
                        to: '/sessions/$sessionId',
                        params: { sessionId: resumedSessionId },
                        replace: true
                    })
                }
            })()
        } catch (error) {
            haptic.notification('error')
            const message = error instanceof Error ? error.message : 'Resume failed'
            addToast({
                title: 'Resume failed',
                body: message,
                sessionId: s.id,
                url: ''
            })
        } finally {
            setActivatePending(false)
        }
    }

    return (
        <>
            <button
                type="button"
                {...longPressHandlers}
                className={`session-list-item flex w-full flex-col gap-1.5 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none ${selected ? 'bg-[var(--app-secondary-bg)]' : ''}`}
                style={{ WebkitTouchCallout: 'none' }}
                aria-current={selected ? 'page' : undefined}
            >
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                            <span
                                className={`h-2 w-2 rounded-full ${statusDotClass}`}
                            />
                        </span>
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="truncate text-base font-medium">
                                {sessionName}
                            </div>
                            {isReadOnly ? (
                                <ReadOnlyBadge reason={s.metadata?.readOnlyReason} />
                            ) : null}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                        {s.thinking ? (
                            <span className="text-[#007AFF] animate-pulse">
                                {t('session.item.thinking')}
                            </span>
                        ) : null}
                        {(() => {
                            const progress = getTodoProgress(s)
                            if (!progress) return null
                            return (
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <BulbIcon className="h-3 w-3" />
                                    {progress.completed}/{progress.total}
                                </span>
                            )
                        })()}
                        {s.pendingRequestsCount > 0 ? (
                            <span className="text-[var(--app-badge-warning-text)]">
                                {t('session.item.pending')} {s.pendingRequestsCount}
                            </span>
                        ) : null}
                        <span className="text-[var(--app-hint)]">
                            {formatRelativeTime(s.updatedAt, t)}
                        </span>
                    </div>
                </div>
                {showPath ? (
                    <div className="truncate text-xs text-[var(--app-hint)]">
                        {s.metadata?.path ?? s.id}
                    </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--app-hint)] min-w-0">
                    <span className="inline-flex items-center gap-2">
                        <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                            ❖
                        </span>
                        {getAgentLabel(s)}
                    </span>
                    <span>
                        {t('session.item.modelMode')}: {s.metadata?.flavor === 'codex'
                            ? (() => {
                                const resolved = normalizeCodexModel(s.codexModel)
                                const fallback = isCodexAutoSession(s.id) ? null : resolvedDefaultCodexModel
                                return getCodexModelLabel(resolved ?? fallback)
                            })()
                            : modelModeLabel}
                    </span>
                    {s.metadata?.worktree?.branch ? (
                        <span className="inline-flex min-w-0 flex-1 items-center gap-1">
                            <span className="shrink-0">{t('session.item.worktree')}:</span>
                            <span
                                className="min-w-0 truncate"
                                title={s.metadata.worktree.branch}
                            >
                                {s.metadata.worktree.branch}
                            </span>
                        </span>
                    ) : null}
                </div>
            </button>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={s.active}
                onActivate={handleActivate}
                activateDisabled={activatePending || isPending || isReadOnly}
                onRename={() => setRenameOpen(true)}
                onArchive={() => setArchiveOpen(true)}
                onDelete={() => setDeleteOpen(true)}
                deleteDisabled={isPending || isReadOnly}
                anchorPoint={menuAnchorPoint}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={sessionName}
                onRename={renameSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: sessionName })}
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
                description={t('dialog.delete.description', { name: sessionName })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={deleteSession}
                isPending={isPending}
                destructive
            />
        </>
    )
}

function DirectoryGroupRow(props: {
    machineId: string
    directory: string
    displayName: string
    sessionCount: number
    isCollapsed: boolean
    onToggle: () => void
    onOpenMenu: (point: { x: number; y: number }) => void
    menuEnabled: boolean
}) {
    const { haptic, isTouch } = usePlatform()

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            if (!props.menuEnabled) return
            haptic.impact('medium')
            props.onOpenMenu(point)
        },
        onClick: () => {
            props.onToggle()
        },
        threshold: 500,
        disabled: !props.menuEnabled
    })

    return (
        <div className="group flex min-w-0 flex-1 items-center">
            <button
                type="button"
                {...longPressHandlers}
                onContextMenu={(event) => {
                    if (!props.menuEnabled) return
                    event.preventDefault()
                    if (isTouch) return
                    props.onOpenMenu({ x: event.clientX, y: event.clientY })
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:bg-[var(--app-secondary-bg)] touch-pan-y"
            >
                <ChevronIcon
                    className="h-4 w-4 text-[var(--app-hint)]"
                    collapsed={props.isCollapsed}
                />
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-medium text-base break-words" title={props.directory}>
                        {props.displayName}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--app-hint)]">
                        ({props.sessionCount})
                    </span>
                </div>
            </button>
        </div>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
    machines: Machine[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onRefresh: () => void
    isLoading: boolean
    renderHeader?: boolean
    api: ApiClient | null
    selectedSessionId?: string | null
    filterText?: string
    onFilterTextChange?: (value: string) => void
}) {
    const { t } = useTranslation()
    const { renderHeader = true, api, selectedSessionId } = props
    const { addToast } = useToast()
    const navigate = useNavigate()
    const { defaultCodexModel } = useDefaultCodexModel()
    const resolvedDefaultCodexModel = normalizeCodexModel(defaultCodexModel)
    const machineMap = useMemo(
        () => new Map(props.machines.map(machine => [machine.id, machine])),
        [props.machines]
    )
    const groups = useMemo(
        () => groupSessionsByMachine(props.sessions, machineMap),
        [props.sessions, machineMap]
    )
    const [internalFilterText, setInternalFilterText] = useState('')
    const filterText = props.filterText ?? internalFilterText
    const setFilterText = (value: string) => {
        if (props.onFilterTextChange) {
            props.onFilterTextChange(value)
            return
        }
        setInternalFilterText(value)
    }
    const normalizedFilter = filterText.trim().toLowerCase()
    const filteredGroups = useMemo(() => {
        if (!normalizedFilter) return groups
        return groups
            .map(group => {
                const directoryGroups = group.directoryGroups.filter(directoryGroup => {
                    const candidate = directoryGroup.directory.toLowerCase()
                    return candidate.includes(normalizedFilter)
                })
                return { ...group, directoryGroups }
            })
            .filter(group => group.directoryGroups.length > 0)
    }, [groups, normalizedFilter])
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const [directoryMenuOpen, setDirectoryMenuOpen] = useState(false)
    const [directoryMenuAnchorPoint, setDirectoryMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [directoryMenuTarget, setDirectoryMenuTarget] = useState<DirectoryMenuTarget | null>(null)
    const isGroupCollapsed = (machineId: string, group: SessionGroup): boolean => {
        const key = `${machineId}:${group.directory}`
        const override = collapseOverrides.get(key)
        if (override !== undefined) return override
        return !group.hasActiveSession
    }

    const toggleGroup = (machineId: string, directory: string, isCollapsed: boolean) => {
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(`${machineId}:${directory}`, !isCollapsed)
            return next
        })
    }

    useEffect(() => {
        setCollapseOverrides(prev => {
            if (prev.size === 0) return prev
            const next = new Map(prev)
            const knownGroups = new Set(
                groups.flatMap(group => group.directoryGroups.map(directoryGroup => `${group.machineId}:${directoryGroup.directory}`))
            )
            let changed = false
            for (const directory of next.keys()) {
                if (!knownGroups.has(directory)) {
                    next.delete(directory)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [groups])

    const directoryCount = filteredGroups.reduce((count, group) => count + group.directoryGroups.length, 0)
    const [syncingMachineId, setSyncingMachineId] = useState<string | null>(null)

    const handleNewSession = (machineId: string, path?: string | null) => {
        const search: Record<string, string> = { machineId }
        if (path && path !== 'Other') {
            search.path = path
        }
        navigate({ to: '/sessions/new', search })
    }

    const handleMachineSync = async (machine: MachineGroup) => {
        if (!api) return
        if (!machine.online) {
            addToast({
                title: t('session.machine.sync.offline.title'),
                body: t('session.machine.sync.offline.body'),
                sessionId: '',
                url: ''
            })
            return
        }
        if (syncingMachineId === machine.machineId) return
        setSyncingMachineId(machine.machineId)
        try {
            await api.codexSyncMachine(machine.machineId)
            addToast({
                title: t('session.machine.sync.success.title'),
                body: t('session.machine.sync.success.body'),
                sessionId: '',
                url: ''
            })
            props.onRefresh()
        } catch (error) {
            const message = error instanceof Error ? error.message : t('dialog.error.default')
            addToast({
                title: t('session.machine.sync.error.title'),
                body: message,
                sessionId: '',
                url: ''
            })
        } finally {
            setSyncingMachineId(null)
        }
    }

    const handleDirectoryMenuOpen = (point: { x: number; y: number }, target: DirectoryMenuTarget) => {
        setDirectoryMenuAnchorPoint(point)
        setDirectoryMenuTarget(target)
        setDirectoryMenuOpen(true)
    }

    const handleDirectoryMenuClose = () => {
        setDirectoryMenuOpen(false)
    }

    return (
        <div className="mx-auto w-full max-w-content flex flex-col">
            {renderHeader ? (
                <div className="flex flex-col gap-2 px-3 py-1">
                    <div className="flex items-center justify-between">
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('sessions.count', { n: props.sessions.length, m: directoryCount })}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={props.onNewSession}
                                className="session-list-new-button p-1.5 rounded-full text-[var(--app-link)] transition-colors"
                                title={t('sessions.new')}
                            >
                                <PlusIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center">
                        <div className="relative w-full">
                            <input
                                value={filterText}
                                onChange={(event) => setFilterText(event.target.value)}
                                placeholder={t('sessions.filter.placeholder')}
                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-2 py-1 pr-7 text-xs text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                            />
                            {normalizedFilter ? (
                                <button
                                    type="button"
                                    onClick={() => setFilterText('')}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                                    aria-label={t('sessions.filter.clear')}
                                >
                                    ✕
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="flex flex-col">
                {filteredGroups.map((machineGroup) => (
                    <div key={machineGroup.machineId} className="border-b border-[var(--app-divider)]">
                        <div className="sticky top-0 z-20 flex w-full items-center justify-between gap-3 px-3 py-2 bg-[var(--app-bg)] border-b border-[var(--app-divider)]">
                            <div className="flex items-center gap-2 min-w-0">
                                <span
                                    className={`h-2 w-2 rounded-full ${machineGroup.online ? 'bg-[var(--app-badge-success-text)]' : 'bg-[var(--app-hint)]'}`}
                                />
                                <span className="truncate text-xs font-semibold" title={machineGroup.label}>
                                    {machineGroup.label}
                                </span>
                                {!machineGroup.online ? (
                                    <span className="text-[10px] text-[var(--app-hint)]">
                                        {t('session.machine.offline')}
                                    </span>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                                {machineGroup.machineId !== 'unknown' ? (
                                    <button
                                        type="button"
                                        onClick={() => handleNewSession(machineGroup.machineId)}
                                        className="rounded-full border px-2 py-1 text-[10px] font-semibold text-[var(--app-link)] transition-colors border-[var(--app-border)] hover:bg-[var(--app-secondary-bg)]"
                                        title={t('sessions.new')}
                                    >
                                        <PlusIcon className="h-3.5 w-3.5" />
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => handleMachineSync(machineGroup)}
                                    disabled={!machineGroup.online || syncingMachineId === machineGroup.machineId}
                                    className={`rounded-full border px-2 py-1 text-[10px] font-semibold transition-colors ${machineGroup.online ? 'border-[var(--app-border)] text-[var(--app-link)] hover:bg-[var(--app-secondary-bg)]' : 'border-[var(--app-divider)] text-[var(--app-hint)]'}`}
                                    title={machineGroup.online ? t('session.machine.sync') : t('session.machine.sync.offline.body')}
                                >
                                    {syncingMachineId === machineGroup.machineId ? t('session.machine.syncing') : t('session.machine.sync')}
                                </button>
                            </div>
                        </div>

                        {machineGroup.directoryGroups.map((group) => {
                            const isCollapsed = isGroupCollapsed(machineGroup.machineId, group)
                            const menuEnabled = machineGroup.machineId !== 'unknown'
                            return (
                                <div key={`${machineGroup.machineId}:${group.directory}`}>
                                    <div className="sticky top-0 z-10 flex w-full items-center gap-2 px-3 py-2 bg-[var(--app-bg)] border-b border-[var(--app-divider)]">
                                        <DirectoryGroupRow
                                            machineId={machineGroup.machineId}
                                            directory={group.directory}
                                            displayName={group.displayName}
                                            sessionCount={group.sessions.length}
                                            isCollapsed={isCollapsed}
                                            onToggle={() => toggleGroup(machineGroup.machineId, group.directory, isCollapsed)}
                                            onOpenMenu={(point) => handleDirectoryMenuOpen(point, {
                                                machineId: machineGroup.machineId,
                                                directory: group.directory
                                            })}
                                            menuEnabled={menuEnabled}
                                        />
                                    </div>
                                    {!isCollapsed ? (
                                        <div className="flex flex-col divide-y divide-[var(--app-divider)]">
                                            {group.sessions.map((s) => (
                                                <SessionItem
                                                    key={s.id}
                                                    session={s}
                                                    onSelect={props.onSelect}
                                                    onRefresh={props.onRefresh}
                                                    showPath={false}
                                                    api={api}
                                                    selected={s.id === selectedSessionId}
                                                    resolvedDefaultCodexModel={resolvedDefaultCodexModel}
                                                />
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            )
                        })}
                    </div>
                ))}
            </div>
            <DirectoryActionMenu
                isOpen={directoryMenuOpen && Boolean(directoryMenuTarget)}
                onClose={handleDirectoryMenuClose}
                anchorPoint={directoryMenuAnchorPoint}
                onNewSession={() => {
                    if (!directoryMenuTarget) return
                    handleNewSession(directoryMenuTarget.machineId, directoryMenuTarget.directory)
                }}
            />
        </div>
    )
}
