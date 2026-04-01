import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { usePlatform } from '@/hooks/usePlatform'
import { useMachinePathsExists } from '@/hooks/useMachinePathsExists'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { normalizeCodexModel } from '@/lib/codexModels'
import { setPendingCodexModel } from '@/lib/pendingCodexModel'
import { useDefaultCodexModel } from '@/hooks/useDefaultCodexModel'
import { setCodexAutoSession } from '@/lib/codexSessionAuto'
import { useTranslation } from '@/lib/use-translation'
import type { AgentType, ClaudeEffort, CodexReasoningEffort, SessionType } from './types'
import { ActionButtons } from './ActionButtons'
import { AgentSelector } from './AgentSelector'
import { DirectoryBrowser } from './DirectoryBrowser'
import { DirectorySection } from './DirectorySection'
import { MachineSelector } from './MachineSelector'
import { ModelSelector } from './ModelSelector'
import { ClaudeEffortSelector } from './ClaudeEffortSelector'
import { ReasoningEffortSelector } from './ReasoningEffortSelector'
import {
    loadPreferredAgent,
    loadPreferredYoloMode,
    savePreferredAgent,
    savePreferredYoloMode,
} from './preferences'
import { SessionTypeSelector } from './SessionTypeSelector'
import { YoloToggle } from './YoloToggle'
import { formatRunnerSpawnError } from '../../utils/formatRunnerSpawnError'

export function NewSession(props: {
    api: ApiClient
    machines: Machine[]
    isLoading?: boolean
    initialMachineId?: string | null
    initialDirectory?: string | null
    onSuccess: (sessionId: string) => void
    onCancel: () => void
}) {
    const { haptic } = usePlatform()
    const { t } = useTranslation()
    const { spawnSession, isPending, error: spawnError } = useSpawnSession(props.api)
    const isFormDisabled = Boolean(isPending || props.isLoading)
    const { getRecentPaths, addRecentPath, getLastUsedMachineId, setLastUsedMachineId } = useRecentPaths()
    const { defaultCodexModel } = useDefaultCodexModel()
    const resolvedDefaultCodexModel = normalizeCodexModel(defaultCodexModel)

    const initialAgent = loadPreferredAgent()
    const [machineId, setMachineId] = useState<string | null>(null)
    const [directory, setDirectory] = useState('')
    const [browserPath, setBrowserPath] = useState('')
    const [isBrowserOpen, setIsBrowserOpen] = useState(false)
    const [agent, setAgent] = useState<AgentType>(initialAgent)
    const [model, setModel] = useState(() => (
        initialAgent === 'codex'
            ? (resolvedDefaultCodexModel ?? 'auto')
            : 'auto'
    ))
    const [effort, setEffort] = useState<ClaudeEffort>('auto')
    const [modelReasoningEffort, setModelReasoningEffort] = useState<CodexReasoningEffort>('high')
    const [yoloMode, setYoloMode] = useState(loadPreferredYoloMode)
    const [sessionType, setSessionType] = useState<SessionType>('simple')
    const [worktreeName, setWorktreeName] = useState('')
    const [directoryCreationConfirmed, setDirectoryCreationConfirmed] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const worktreeInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (sessionType === 'worktree') {
            worktreeInputRef.current?.focus()
        }
    }, [sessionType])

    useEffect(() => {
        if (agent === 'codex') {
            setModel(resolvedDefaultCodexModel ?? 'auto')
            return
        }
        setModel('auto')
        setEffort('auto')
    }, [agent, resolvedDefaultCodexModel])

    useEffect(() => {
        savePreferredAgent(agent)
    }, [agent])

    useEffect(() => {
        savePreferredYoloMode(yoloMode)
    }, [yoloMode])

    useEffect(() => {
        if (props.machines.length === 0) return
        if (machineId && props.machines.find((m) => m.id === machineId)) return

        if (props.initialMachineId) {
            const initial = props.machines.find((m) => m.id === props.initialMachineId)
            if (initial) {
                setMachineId(initial.id)
                const initialPath = props.initialDirectory?.trim()
                if (initialPath) {
                    setDirectory(initialPath)
                } else {
                    const paths = getRecentPaths(initial.id)
                    if (paths[0]) setDirectory(paths[0])
                }
                return
            }
        }

        const lastUsed = getLastUsedMachineId()
        const foundLast = lastUsed ? props.machines.find((m) => m.id === lastUsed) : null

        if (foundLast) {
            setMachineId(foundLast.id)
            const paths = getRecentPaths(foundLast.id)
            if (paths[0]) setDirectory(paths[0])
        } else if (props.machines[0]) {
            setMachineId(props.machines[0].id)
        }
    }, [
        props.machines,
        props.initialMachineId,
        props.initialDirectory,
        machineId,
        getLastUsedMachineId,
        getRecentPaths
    ])

    useEffect(() => {
        if (!machineId) {
            setBrowserPath('')
            setIsBrowserOpen(false)
            return
        }
        setBrowserPath('')
        setIsBrowserOpen(false)
    }, [machineId, getRecentPaths])

    const selectedMachine = useMemo(
        () => (machineId ? props.machines.find((machine) => machine.id === machineId) ?? null : null),
        [machineId, props.machines]
    )
    const runnerSpawnError = useMemo(
        () => formatRunnerSpawnError(selectedMachine),
        [selectedMachine]
    )

    const recentPaths = useMemo(
        () => getRecentPaths(machineId),
        [getRecentPaths, machineId]
    )

    const trimmedDirectory = directory.trim()
    const pathsToCheck = useMemo(
        () => (trimmedDirectory ? [trimmedDirectory] : []),
        [trimmedDirectory]
    )

    const { pathExistence, checkPathsExists } = useMachinePathsExists(props.api, machineId, pathsToCheck)

    const currentDirectoryExists = trimmedDirectory ? pathExistence[trimmedDirectory] : undefined
    const needsDirectoryCreationWarning = sessionType === 'simple' && trimmedDirectory !== '' && currentDirectoryExists === false
    const missingWorktreeDirectory = sessionType === 'worktree' && trimmedDirectory !== '' && currentDirectoryExists === false
    const directoryStatusMessage = missingWorktreeDirectory
        ? t('session.directoryMissingWorktree')
        : needsDirectoryCreationWarning
            ? (
                directoryCreationConfirmed
                    ? t('session.directoryMissingSimpleConfirm')
                    : t('session.directoryMissingSimple')
            )
            : null
    const directoryStatusTone = missingWorktreeDirectory ? 'error' : needsDirectoryCreationWarning ? 'warning' : null
    const createLabel = needsDirectoryCreationWarning && directoryCreationConfirmed
        ? t('session.createAndCreateDirectory')
        : undefined

    useEffect(() => {
        setDirectoryCreationConfirmed(false)
    }, [machineId, sessionType, trimmedDirectory])
    const handleMachineChange = useCallback((newMachineId: string) => {
        setMachineId(newMachineId)
        const paths = getRecentPaths(newMachineId)
        if (paths[0]) {
            setDirectory(paths[0])
        } else {
            setDirectory('')
        }
    }, [getRecentPaths])

    const handlePathClick = useCallback((path: string) => {
        setDirectory(path)
    }, [])

    const handleBrowserOpenChange = useCallback((open: boolean) => {
        if (!open) {
            setIsBrowserOpen(false)
            return
        }

        const fallback = directory.trim() || (machineId ? getRecentPaths(machineId)[0] ?? '' : '')
        setBrowserPath(fallback)
        setIsBrowserOpen(true)
    }, [directory, machineId, getRecentPaths])

    const handleBrowserSelect = useCallback((path: string) => {
        setDirectory(path)
        setIsBrowserOpen(false)
    }, [])

    const handleDirectoryClick = useCallback(() => {
        if (isFormDisabled || !machineId) return
        handleBrowserOpenChange(true)
    }, [handleBrowserOpenChange, isFormDisabled, machineId])

    async function handleCreate() {
        if (!machineId || !trimmedDirectory) return

        setError(null)
        try {
            const existsResult = await checkPathsExists([trimmedDirectory])
            const directoryExists = existsResult[trimmedDirectory]

            if (sessionType === 'worktree' && directoryExists === false) {
                haptic.notification('error')
                setError(t('session.directoryMissingWorktree'))
                return
            }

            if (sessionType === 'simple' && directoryExists === false && !directoryCreationConfirmed) {
                setDirectoryCreationConfirmed(true)
                return
            }

            const resolvedModel = model !== 'auto' && agent !== 'opencode' ? model : undefined
            const resolvedModelReasoningEffort = agent === 'codex' && modelReasoningEffort !== 'default'
                ? modelReasoningEffort
                : undefined
            const result = await spawnSession({
                machineId,
                directory: trimmedDirectory,
                agent,
                model: resolvedModel,
                modelReasoningEffort: resolvedModelReasoningEffort,
                yolo: yoloMode,
                sessionType,
                worktreeName: sessionType === 'worktree' ? (worktreeName.trim() || undefined) : undefined
            })

            if (result.type === 'success') {
                haptic.notification('success')
                if (agent === 'codex') {
                    const resolvedModel = normalizeCodexModel(model)
                    if (!resolvedModel && resolvedDefaultCodexModel) {
                        setCodexAutoSession(result.sessionId, true)
                    } else {
                        setCodexAutoSession(result.sessionId, false)
                    }
                    try {
                        await props.api.setCodexModel(result.sessionId, resolvedModel)
                    } catch (error) {
                        console.error('Failed to sync Codex model to session cache:', error)
                        if (resolvedModel) {
                            setPendingCodexModel(result.sessionId, resolvedModel)
                        }
                    }
                }
                setLastUsedMachineId(machineId)
                addRecentPath(machineId, trimmedDirectory)
                props.onSuccess(result.sessionId)
                return
            }

            haptic.notification('error')
            setError(result.message)
        } catch (e) {
            haptic.notification('error')
            setError(e instanceof Error ? e.message : 'Failed to create session')
        }
    }

    const canCreate = Boolean(machineId && trimmedDirectory && !isFormDisabled && !missingWorktreeDirectory)

    return (
        <div className="flex flex-col divide-y divide-[var(--app-divider)]">
            <MachineSelector
                machines={props.machines}
                machineId={machineId}
                isLoading={props.isLoading}
                isDisabled={isFormDisabled}
                onChange={handleMachineChange}
            />
            {runnerSpawnError ? (
                <div className="px-3 py-2 text-xs text-red-600">
                    Runner last spawn error: {runnerSpawnError}
                </div>
            ) : null}
            <DirectorySection
                directory={directory}
                isDisabled={isFormDisabled}
                recentPaths={recentPaths}
                isBrowserOpen={isBrowserOpen}
                onBrowserOpenChange={handleBrowserOpenChange}
                browser={(
                    <DirectoryBrowser
                        api={props.api}
                        machineId={machineId}
                        path={browserPath}
                        isDisabled={isFormDisabled}
                        onPathChange={setBrowserPath}
                        onSelectPath={handleBrowserSelect}
                    />
                )}
                onDirectoryClick={handleDirectoryClick}
                statusMessage={directoryStatusMessage}
                statusTone={directoryStatusTone}
                onPathClick={handlePathClick}
            />
            <SessionTypeSelector
                sessionType={sessionType}
                worktreeName={worktreeName}
                worktreeInputRef={worktreeInputRef}
                isDisabled={isFormDisabled}
                onSessionTypeChange={setSessionType}
                onWorktreeNameChange={setWorktreeName}
            />
            <AgentSelector
                agent={agent}
                isDisabled={isFormDisabled}
                onAgentChange={setAgent}
            />
            <ModelSelector
                agent={agent}
                model={model}
                isDisabled={isFormDisabled}
                onModelChange={setModel}
            />
            <ClaudeEffortSelector
                agent={agent}
                effort={effort}
                isDisabled={isFormDisabled}
                onEffortChange={setEffort}
            />
            <ReasoningEffortSelector
                agent={agent}
                value={modelReasoningEffort}
                isDisabled={isFormDisabled}
                onChange={setModelReasoningEffort}
            />
            <YoloToggle
                yoloMode={yoloMode}
                isDisabled={isFormDisabled}
                onToggle={setYoloMode}
            />

            {(error ?? spawnError) ? (
                <div className="px-3 py-2 text-sm text-red-600">
                    {error ?? spawnError}
                </div>
            ) : null}

            <ActionButtons
                isPending={isPending}
                canCreate={canCreate}
                isDisabled={isFormDisabled}
                createLabel={createLabel}
                onCancel={props.onCancel}
                onCreate={handleCreate}
            />
        </div>
    )
}
