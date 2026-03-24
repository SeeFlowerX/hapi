import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type {
    AttachmentMetadata,
    DecryptedMessage,
    ModelMode,
    PermissionMode,
    Session,
    SlashCommand
} from '@/types/api'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { HappyComposer } from '@/components/AssistantChat/HappyComposer'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { ImagePreviewDialog } from '@/components/AssistantChat/ImagePreviewDialog'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { findUnsupportedCodexBuiltinSlashCommand } from '@/lib/codexSlashCommands'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { SessionHeader } from '@/components/SessionHeader'
import { TeamPanel } from '@/components/TeamPanel'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useVoiceOptional } from '@/lib/voice-context'
import { RealtimeVoiceSession, registerSessionStore, registerVoiceHooksStore, voiceHooks } from '@/realtime'
import { getCodexModelLabel, normalizeCodexModel } from '@/lib/codexModels'
import { clearPendingCodexModel, getPendingCodexModel, setPendingCodexModel } from '@/lib/pendingCodexModel'
import { useDefaultCodexModel } from '@/hooks/useDefaultCodexModel'
import { isCodexAutoSession, setCodexAutoSession } from '@/lib/codexSessionAuto'
import { isImageMimeType } from '@/lib/fileAttachments'
import { isRemoteTerminalSupported } from '@/utils/terminalSupport'

export function SessionChat(props: {
    api: ApiClient
    session: Session
    messages: DecryptedMessage[]
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMessages: boolean
    isLoadingMoreMessages: boolean
    isSending: boolean
    pendingCount: number
    messagesVersion: number
    onBack: () => void
    onRefresh: () => void
    onLoadMore: () => Promise<unknown>
    onSend: (text: string, attachments?: AttachmentMetadata[]) => void
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    onRetryMessage?: (localId: string) => void
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    availableSlashCommands?: readonly SlashCommand[]
}) {
    const { haptic } = usePlatform()
    const { addToast } = useToast()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const sessionInactive = !props.session.active
    const isReadOnly = Boolean(props.session.metadata?.readOnly)
    const terminalSupported = isRemoteTerminalSupported(props.session.metadata)
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const [forceScrollToken, setForceScrollToken] = useState(0)
    const agentFlavor = props.session.metadata?.flavor ?? null
    const { abortSession, switchSession, setPermissionMode, setModelMode, setCodexModel, setEffort } = useSessionActions(
        props.api,
        props.session.id,
        agentFlavor
    )
    const { defaultCodexModel } = useDefaultCodexModel()
    const isCodex = agentFlavor === 'codex'
    const resolvedDefaultCodexModel = normalizeCodexModel(defaultCodexModel)
    const autoCodexSession = isCodex ? isCodexAutoSession(props.session.id) : false
    const resolvedCodexModel = normalizeCodexModel(props.session.codexModel)
    const effectiveCodexModel = resolvedCodexModel ?? (autoCodexSession ? null : resolvedDefaultCodexModel)
    const [codexModel, setCodexModelState] = useState<string | null>(() => (
        isCodex ? effectiveCodexModel : null
    ))

    // Voice assistant integration
    const voice = useVoiceOptional()

    // Register session store for voice client tools
    useEffect(() => {
        registerSessionStore({
            getSession: () => props.session as { agentState?: { requests?: Record<string, unknown> } } | null,
            sendMessage: (_sessionId: string, message: string) => props.onSend(message),
            approvePermission: async (_sessionId: string, requestId: string) => {
                await props.api.approvePermission(props.session.id, requestId)
                props.onRefresh()
            },
            denyPermission: async (_sessionId: string, requestId: string) => {
                await props.api.denyPermission(props.session.id, requestId)
                props.onRefresh()
            }
        })
    }, [props.session, props.api, props.onSend, props.onRefresh])

    useEffect(() => {
        registerVoiceHooksStore(
            (sessionId) => (sessionId === props.session.id ? props.session : null),
            (sessionId) => (sessionId === props.session.id ? props.messages : [])
        )
    }, [props.session, props.messages])

    // Track and report new messages to voice assistant
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevMessagesRef = useRef<DecryptedMessage[]>([])

    useEffect(() => {
        const prevIds = new Set(prevMessagesRef.current.map(m => m.id))
        const newMessages = props.messages.filter(m => !prevIds.has(m.id))

        if (newMessages.length > 0) {
            voiceHooks.onMessages(props.session.id, newMessages)
        }

        prevMessagesRef.current = props.messages
    }, [props.messages, props.session.id])

    // Report ready event when thinking stops
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevThinkingRef = useRef(props.session.thinking)

    useEffect(() => {
        // Detect transition: thinking → not thinking
        if (prevThinkingRef.current && !props.session.thinking) {
            voiceHooks.onReady(props.session.id)
        }

        prevThinkingRef.current = props.session.thinking
    }, [props.session.thinking, props.session.id])

    // Report permission requests to voice assistant
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevRequestIdsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        const requests = props.session.agentState?.requests ?? {}
        const currentIds = new Set(Object.keys(requests))

        for (const [requestId, request] of Object.entries(requests)) {
            if (!prevRequestIdsRef.current.has(requestId)) {
                voiceHooks.onPermissionRequested(
                    props.session.id,
                    requestId,
                    (request as { tool?: string }).tool ?? 'unknown',
                    (request as { arguments?: unknown }).arguments
                )
            }
        }

        prevRequestIdsRef.current = currentIds
    }, [props.session.agentState?.requests, props.session.id])

    const handleVoiceToggle = useCallback(async () => {
        if (!voice) return
        if (voice.status === 'connected' || voice.status === 'connecting') {
            await voice.stopVoice()
        } else {
            await voice.startVoice(props.session.id)
        }
    }, [voice, props.session.id])

    const handleVoiceMicToggle = useCallback(() => {
        if (!voice) return
        voice.toggleMic()
    }, [voice])

    // Track session id to clear caches when it changes
    const prevSessionIdRef = useRef<string | null>(null)

    useEffect(() => {
        normalizedCacheRef.current.clear()
        blocksByIdRef.current.clear()
    }, [props.session.id])

    useEffect(() => {
        if (!isCodex) {
            setCodexModelState(null)
            return
        }
        setCodexModelState(effectiveCodexModel)
    }, [props.session.id, props.session.codexModel, isCodex, effectiveCodexModel])

    useEffect(() => {
        if (!isCodex || !props.session.active) return
        if (resolvedCodexModel) return
        if (!resolvedDefaultCodexModel || autoCodexSession) return
        if (getPendingCodexModel(props.session.id)) return

        let cancelled = false
        void (async () => {
            try {
                await setCodexModel(resolvedDefaultCodexModel)
            } catch (error) {
                if (!cancelled) {
                    setPendingCodexModel(props.session.id, resolvedDefaultCodexModel)
                }
                console.warn('Failed to apply default Codex model:', error)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [
        isCodex,
        props.session.active,
        props.session.id,
        resolvedCodexModel,
        resolvedDefaultCodexModel,
        autoCodexSession,
        setCodexModel
    ])

    useEffect(() => {
        if (!isCodex || !props.session.active) return
        const pendingModel = getPendingCodexModel(props.session.id)
        if (!pendingModel) return
        const currentModel = normalizeCodexModel(props.session.codexModel)
        if (currentModel) {
            clearPendingCodexModel(props.session.id)
            return
        }

        let cancelled = false
        void (async () => {
            try {
                await setCodexModel(pendingModel)
            } catch (error) {
                console.warn('Failed to apply pending Codex model:', error)
            } finally {
                if (!cancelled) {
                    clearPendingCodexModel(props.session.id)
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [isCodex, props.session.active, props.session.id, props.session.codexModel, setCodexModel])

    const normalizedMessages: NormalizedMessage[] = useMemo(() => {
        // Clear caches immediately when session changes (before useEffect runs)
        if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== props.session.id) {
            normalizedCacheRef.current.clear()
            blocksByIdRef.current.clear()
        }
        prevSessionIdRef.current = props.session.id

        const cache = normalizedCacheRef.current
        const normalized: NormalizedMessage[] = []
        const seen = new Set<string>()
        for (const message of props.messages) {
            seen.add(message.id)
            const cached = cache.get(message.id)
            if (cached && cached.source === message) {
                if (cached.normalized) normalized.push(cached.normalized)
                continue
            }
            const next = normalizeDecryptedMessage(message)
            cache.set(message.id, { source: message, normalized: next })
            if (next) normalized.push(next)
        }
        for (const id of cache.keys()) {
            if (!seen.has(id)) {
                cache.delete(id)
            }
        }
        return normalized
    }, [props.messages])

    const reduced = useMemo(
        () => reduceChatBlocks(normalizedMessages, props.session.agentState),
        [normalizedMessages, props.session.agentState]
    )
    const contextSize = useMemo(() => {
        if (reduced.latestUsage?.contextSize !== undefined) {
            return reduced.latestUsage.contextSize
        }
        const tokenUsage = props.session.agentState?.tokenUsage
        if (!tokenUsage) {
            return undefined
        }
        const inputTokens = tokenUsage.inputTokens ?? null
        if (inputTokens === null) {
            return undefined
        }
        return inputTokens
    }, [reduced.latestUsage?.contextSize, props.session.agentState?.tokenUsage])
    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, blocksByIdRef.current),
        [reduced.blocks]
    )

    const imageGallery = useMemo(() => {
        const images: AttachmentMetadata[] = []
        for (const block of reconciled.blocks) {
            if (block.kind !== 'user-text' && block.kind !== 'agent-text') {
                continue
            }
            const attachments = block.attachments ?? []
            for (const attachment of attachments) {
                if (isImageMimeType(attachment.mimeType) && attachment.previewUrl) {
                    images.push(attachment)
                }
            }
        }
        return images
    }, [reconciled.blocks])

    const imageIndexById = useMemo(() => {
        const map = new Map<string, number>()
        imageGallery.forEach((attachment, index) => {
            map.set(attachment.id, index)
        })
        return map
    }, [imageGallery])

    const [imagePreviewId, setImagePreviewId] = useState<string | null>(null)

    const handleOpenImagePreview = useCallback((attachmentId: string) => {
        if (!imageIndexById.has(attachmentId)) return
        setImagePreviewId(attachmentId)
    }, [imageIndexById])

    useEffect(() => {
        if (imagePreviewId === null) {
            return
        }
        if (!imageIndexById.has(imagePreviewId)) {
            setImagePreviewId(null)
        }
    }, [imagePreviewId, imageIndexById])

    useEffect(() => {
        blocksByIdRef.current = reconciled.byId
    }, [reconciled.byId])

    // Permission mode change handler
    const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
        try {
            await setPermissionMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set permission mode:', e)
        }
    }, [setPermissionMode, props.onRefresh, haptic])

    // Model mode change handler
    const handleModelModeChange = useCallback(async (mode: ModelMode) => {
        try {
            await setModelMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set model mode:', e)
        }
    }, [setModelMode, props.onRefresh, haptic])

    const handleCodexModelChange = useCallback(async (model: string | null) => {
        if (!isCodex) return
        const normalized = normalizeCodexModel(model)
        try {
            setCodexAutoSession(props.session.id, normalized === null)
            if (!normalized) {
                clearPendingCodexModel(props.session.id)
            }
            await setCodexModel(normalized)
            setCodexModelState(normalized)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set codex model:', e)
            if (normalized) {
                setPendingCodexModel(props.session.id, normalized)
            }
        }
    }, [isCodex, setCodexModel, props.session.id, props.onRefresh, haptic])

    const handleEffortChange = useCallback(async (effort: string | null) => {
        try {
            await setEffort(effort)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set effort:', e)
        }
    }, [setEffort, props.onRefresh, haptic])

    // Abort handler
    const handleAbort = useCallback(async () => {
        await abortSession()
        props.onRefresh()
    }, [abortSession, props.onRefresh])

    const handleAbortSafe = useCallback(async () => {
        if (isReadOnly) {
            return
        }
        await handleAbort()
    }, [handleAbort, isReadOnly])

    // Switch to remote handler
    const handleSwitchToRemote = useCallback(async () => {
        await switchSession()
        props.onRefresh()
    }, [switchSession, props.onRefresh])

    const handleViewFiles = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleViewTerminal = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/terminal',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleSend = useCallback((text: string, attachments?: AttachmentMetadata[]) => {
        if (isReadOnly) {
            return
        }
        if (agentFlavor === 'codex') {
            const unsupportedCommand = findUnsupportedCodexBuiltinSlashCommand(
                text,
                props.availableSlashCommands ?? []
            )
            if (unsupportedCommand) {
                haptic.notification('error')
                addToast({
                    title: t('composer.codexSlashUnsupported.title'),
                    body: t('composer.codexSlashUnsupported.body', { command: `/${unsupportedCommand}` }),
                    sessionId: props.session.id,
                    url: `/sessions/${props.session.id}`
                })
                return
            }
        }

        props.onSend(text, attachments)
        setForceScrollToken((token) => token + 1)
    }, [agentFlavor, props.availableSlashCommands, props.onSend, props.session.id, addToast, haptic, isReadOnly, t])

    const attachmentAdapter = useMemo(() => {
        if (!props.session.active || isReadOnly) {
            return undefined
        }
        return createAttachmentAdapter(props.api, props.session.id)
    }, [props.api, props.session.id, props.session.active, isReadOnly])

    const runtime = useHappyRuntime({
        session: props.session,
        blocks: reconciled.blocks,
        isSending: props.isSending || isReadOnly,
        onSendMessage: handleSend,
        onAbort: handleAbortSafe,
        attachmentAdapter,
        allowSendWhenInactive: true
    })

    return (
        <div className="flex h-full min-h-0 flex-col">
            <SessionHeader
                session={props.session}
                codexModelLabel={isCodex ? getCodexModelLabel(codexModel) : null}
                latestUsage={reduced.latestUsage}
                onBack={props.onBack}
                onViewFiles={props.session.metadata?.path ? handleViewFiles : undefined}
                api={props.api}
                onRefresh={props.onRefresh}
                onSessionDeleted={props.onBack}
            />

            {props.session.teamState && (
                <TeamPanel teamState={props.session.teamState} />
            )}

            {sessionInactive ? (
                <div className="px-3 pt-3">
                    <div className="mx-auto w-full max-w-content rounded-md bg-[var(--app-subtle-bg)] p-3 text-sm text-[var(--app-hint)]">
                        Session is inactive. Sending will resume it automatically.
                    </div>
                </div>
            ) : null}

            <AssistantRuntimeProvider runtime={runtime}>
                <div className="relative flex min-h-0 flex-1 flex-col">
                    <HappyThread
                        key={props.session.id}
                        api={props.api}
                        sessionId={props.session.id}
                        metadata={props.session.metadata}
                        disabled={sessionInactive}
                        onRefresh={props.onRefresh}
                        onRetryMessage={props.onRetryMessage}
                        imageGallery={imageGallery}
                        onOpenImagePreview={handleOpenImagePreview}
                        onFlushPending={props.onFlushPending}
                        onAtBottomChange={props.onAtBottomChange}
                        isLoadingMessages={props.isLoadingMessages}
                        messagesWarning={props.messagesWarning}
                        hasMoreMessages={props.hasMoreMessages}
                        isLoadingMoreMessages={props.isLoadingMoreMessages}
                        onLoadMore={props.onLoadMore}
                        pendingCount={props.pendingCount}
                        rawMessagesCount={props.messages.length}
                        normalizedMessagesCount={normalizedMessages.length}
                        messagesVersion={props.messagesVersion}
                        forceScrollToken={forceScrollToken}
                    />

                    <ImagePreviewDialog
                        images={imageGallery}
                        activeId={imagePreviewId}
                        onClose={() => setImagePreviewId(null)}
                        onSelectId={setImagePreviewId}
                    />

                    <HappyComposer
                        sessionId={props.session.id}
                        disabled={props.isSending || isReadOnly}
                        permissionMode={props.session.permissionMode}
                        modelMode={props.session.modelMode}
                        codexModel={codexModel}
                        effort={props.session.effort}
                        agentFlavor={agentFlavor}
                        active={props.session.active}
                        allowSendWhenInactive
                        thinking={props.session.thinking}
                        agentState={props.session.agentState}
                        contextSize={contextSize}
                        controlledByUser={props.session.agentState?.controlledByUser === true}
                        onPermissionModeChange={isReadOnly ? undefined : handlePermissionModeChange}
                        onModelModeChange={isReadOnly ? undefined : handleModelModeChange}
                        onCodexModelChange={isReadOnly ? undefined : handleCodexModelChange}
                        onEffortChange={isReadOnly ? undefined : handleEffortChange}
                        onSwitchToRemote={isReadOnly ? undefined : handleSwitchToRemote}
                        onTerminal={props.session.active && !isReadOnly && terminalSupported ? handleViewTerminal : undefined}
                        terminalUnsupported={props.session.active && !terminalSupported}
                        autocompleteSuggestions={props.autocompleteSuggestions}
                        voiceStatus={voice?.status}
                        voiceMicMuted={voice?.micMuted}
                        onVoiceToggle={voice ? handleVoiceToggle : undefined}
                        onVoiceMicToggle={voice ? handleVoiceMicToggle : undefined}
                    />
                </div>
            </AssistantRuntimeProvider>

            {/* Voice session component - renders nothing but initializes ElevenLabs */}
            {voice && (
                <RealtimeVoiceSession
                    api={props.api}
                    micMuted={voice.micMuted}
                    onStatusChange={voice.setStatus}
                />
            )}
        </div>
    )
}
