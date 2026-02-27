import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, readlink, stat, writeFile } from 'node:fs/promises'
import spawn from 'cross-spawn'

import { ApiClient } from '@/api/api'
import type { ApiSessionClient } from '@/api/apiSession'
import type { Metadata } from '@/api/types'
import { configuration } from '@/configuration'
import { buildMachineMetadata } from '@/agent/sessionFactory'
import { AsyncLock } from '@/utils/lock'
import { isWindows } from '@/utils/process'
import { convertCodexEvent, type CodexSessionEvent } from './utils/codexEventConverter'
import { extractContextLimitTokens, normalizeTokenUsage } from './utils/normalizeTokenUsage'

const CODEX_SYNC_STATE_VERSION = 1
const MESSAGE_BATCH_SIZE = 200
const MESSAGE_BATCH_DELAY_MS = 50
const MESSAGE_FLUSH_SIZE = 100
const MESSAGE_FLUSH_TIMEOUT_MS = 10_000

export type CodexSyncParams = {
    mode: 'full' | 'session'
    codexSessionId?: string
}

type CodexSyncCursor = {
    filePath: string
    lastLineIndex: number
    lastMtimeMs?: number
}

type CodexSyncState = {
    version: number
    sessions: Record<string, CodexSyncCursor>
}

type CodexSessionMeta = {
    id: string
    cwd?: string
    timestamp?: string
}

type CodexSessionFileEntry = {
    event: CodexSessionEvent
    lineIndex: number
}

type CodexSessionScan = {
    meta: CodexSessionMeta | null
    events: CodexSessionFileEntry[]
    totalLines: number
}

type RunningSessionInfo = {
    sessionId: string
    filePath?: string
    source: string
}

type ExistingCodexSession = {
    sessionId: string
    metadata: Metadata | null
}

const CODX_SESSION_ID_REGEX = /([0-9a-fA-F-]{36})/g

function getCodexSessionsRoot(): string {
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
    return join(codexHome, 'sessions')
}

function shortSleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null
    }
    return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function extractSessionIdFromPath(filePath: string): string | null {
    const matches = filePath.match(CODX_SESSION_ID_REGEX)
    if (!matches || matches.length === 0) {
        return null
    }
    return matches[matches.length - 1]
}

async function listSessionFiles(root: string): Promise<string[]> {
    try {
        const entries = await readdir(root, { withFileTypes: true })
        const results: string[] = []
        for (const entry of entries) {
            const full = join(root, entry.name)
            if (entry.isDirectory()) {
                results.push(...await listSessionFiles(full))
            } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                results.push(full)
            }
        }
        return results
    } catch {
        return []
    }
}

async function readSessionFile(filePath: string, startLine: number): Promise<CodexSessionScan> {
    let content: string
    try {
        content = await readFile(filePath, 'utf-8')
    } catch {
        return { meta: null, events: [], totalLines: startLine }
    }

    const events: CodexSessionFileEntry[] = []
    const lines = content.split('\n')
    const hasTrailingEmpty = lines.length > 0 && lines[lines.length - 1] === ''
    const totalLines = hasTrailingEmpty ? lines.length - 1 : lines.length
    let effectiveStart = startLine
    if (effectiveStart > totalLines) {
        effectiveStart = 0
    }

    let meta: CodexSessionMeta | null = null

    for (let index = 0; index < lines.length; index += 1) {
        const trimmed = lines[index].trim()
        if (!trimmed) {
            continue
        }
        try {
            const parsed = JSON.parse(trimmed) as CodexSessionEvent
            if (parsed?.type === 'session_meta') {
                const payload = asRecord(parsed.payload)
                const sessionId = payload ? asString(payload.id) : null
                if (sessionId && !meta) {
                    meta = {
                        id: sessionId,
                        cwd: payload ? asString(payload.cwd) ?? undefined : undefined,
                        timestamp: payload ? asString(payload.timestamp) ?? undefined : undefined
                    }
                }
            }
            if (index >= effectiveStart) {
                events.push({ event: parsed, lineIndex: index })
            }
        } catch {
            continue
        }
    }

    if (!meta) {
        const fallbackId = extractSessionIdFromPath(filePath)
        if (fallbackId) {
            meta = { id: fallbackId }
        }
    }

    return { meta, events, totalLines }
}

async function readCodexSyncState(): Promise<CodexSyncState> {
    try {
        if (!existsSync(configuration.codexSyncStateFile)) {
            return { version: CODEX_SYNC_STATE_VERSION, sessions: {} }
        }
        const content = await readFile(configuration.codexSyncStateFile, 'utf-8')
        const parsed = JSON.parse(content) as CodexSyncState
        if (!parsed || typeof parsed !== 'object' || !parsed.sessions) {
            return { version: CODEX_SYNC_STATE_VERSION, sessions: {} }
        }
        return {
            version: parsed.version ?? CODEX_SYNC_STATE_VERSION,
            sessions: parsed.sessions ?? {}
        }
    } catch {
        return { version: CODEX_SYNC_STATE_VERSION, sessions: {} }
    }
}

async function writeCodexSyncState(state: CodexSyncState): Promise<void> {
    if (!existsSync(configuration.happyHomeDir)) {
        await mkdir(configuration.happyHomeDir, { recursive: true })
    }
    const payload = JSON.stringify(state, null, 2)
    await writeFile(configuration.codexSyncStateFile, payload, 'utf-8')
}

async function loadExistingCodexSessions(api: ApiClient): Promise<Map<string, ExistingCodexSession>> {
    try {
        const sessions = await api.listSessions({ flavor: 'codex' })
        const map = new Map<string, ExistingCodexSession>()
        for (const session of sessions) {
            const codexSessionId = session.metadata?.codexSessionId
            if (!codexSessionId) {
                continue
            }
            map.set(codexSessionId, {
                sessionId: session.id,
                metadata: session.metadata
            })
        }
        return map
    } catch {
        return new Map()
    }
}

function findCursorForFile(
    sessions: Record<string, CodexSyncCursor | undefined>,
    filePath: string,
    fallbackSessionId?: string | null
): CodexSyncCursor | null {
    if (fallbackSessionId) {
        const direct = sessions[fallbackSessionId] ?? null
        if (direct?.filePath === filePath) {
            return direct
        }
    }
    for (const cursor of Object.values(sessions)) {
        if (cursor?.filePath === filePath) {
            return cursor
        }
    }
    return fallbackSessionId ? sessions[fallbackSessionId] ?? null : null
}

async function detectRunningCodexSessions(): Promise<RunningSessionInfo[]> {
    if (isWindows()) {
        return []
    }
    if (process.platform === 'darwin') {
        return detectRunningCodexSessionsMac()
    }
    return detectRunningCodexSessionsLinux()
}

async function detectRunningCodexSessionsLinux(): Promise<RunningSessionInfo[]> {
    const results: RunningSessionInfo[] = []
    const sessionsRoot = getCodexSessionsRoot()
    let entries: string[] = []
    try {
        entries = await readdir('/proc')
    } catch {
        return results
    }

    for (const entry of entries) {
        if (!/^\d+$/.test(entry)) {
            continue
        }
        const pid = Number(entry)
        if (!Number.isFinite(pid)) {
            continue
        }
        let cmdline = ''
        try {
            cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf-8')
        } catch {
            continue
        }
        if (!cmdline.includes('codex')) {
            continue
        }
        let fdEntries: string[] = []
        try {
            fdEntries = await readdir(`/proc/${pid}/fd`)
        } catch {
            continue
        }
        for (const fd of fdEntries) {
            let target: string
            try {
                target = await readlink(`/proc/${pid}/fd/${fd}`)
            } catch {
                continue
            }
            if (!target.includes(sessionsRoot) || !target.endsWith('.jsonl')) {
                continue
            }
            const sessionId = extractSessionIdFromPath(target)
            if (!sessionId) {
                continue
            }
            results.push({ sessionId, filePath: target, source: 'proc-fd' })
            break
        }
    }

    return results
}

async function detectRunningCodexSessionsMac(): Promise<RunningSessionInfo[]> {
    const results: RunningSessionInfo[] = []
    const sessionsRoot = getCodexSessionsRoot()
    const psResult = spawn.sync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' })
    if (psResult.error || typeof psResult.stdout !== 'string') {
        return results
    }
    const lines = psResult.stdout.split('\n')
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
            continue
        }
        const match = trimmed.match(/^(\d+)\s+(.*)$/)
        if (!match) {
            continue
        }
        const pid = Number(match[1])
        const command = match[2] ?? ''
        if (!Number.isFinite(pid) || !command.includes('codex')) {
            continue
        }
        const lsofResult = spawn.sync('lsof', ['-p', String(pid)], { encoding: 'utf8' })
        if (lsofResult.error || typeof lsofResult.stdout !== 'string') {
            continue
        }
        const lsofLines = lsofResult.stdout.split('\n')
        for (const lsofLine of lsofLines) {
            if (!lsofLine.includes('.jsonl') || !lsofLine.includes(sessionsRoot)) {
                continue
            }
            const parts = lsofLine.trim().split(/\s+/)
            const filePath = parts[parts.length - 1]
            if (!filePath || !filePath.endsWith('.jsonl')) {
                continue
            }
            const sessionId = extractSessionIdFromPath(filePath)
            if (!sessionId) {
                continue
            }
            results.push({ sessionId, filePath, source: 'lsof' })
            break
        }
    }

    return results
}

function buildCodexMetadata(options: {
    cwd: string
    machineId: string
    codexSessionId: string
    readOnly: boolean
    readOnlyReason?: string
    external?: { running?: boolean; detectedAt?: number; source?: string }
}): Metadata {
    const base = buildMachineMetadata()
    const happyLibDir = base.happyLibDir

    return {
        path: options.cwd,
        host: base.host,
        version: base.happyCliVersion,
        os: base.platform,
        machineId: options.machineId,
        homeDir: base.homeDir,
        happyHomeDir: base.happyHomeDir,
        happyLibDir: happyLibDir,
        happyToolsDir: join(happyLibDir, 'tools', 'unpacked'),
        startedFromRunner: false,
        startedBy: 'terminal',
        flavor: 'codex',
        codexSessionId: options.codexSessionId,
        readOnly: options.readOnly,
        readOnlyReason: options.readOnlyReason,
        external: options.external
    }
}

function mergeMetadata(existing: Metadata | null, updates: Metadata): Metadata {
    return {
        ...(existing ?? {}),
        ...updates
    }
}

function needsMetadataUpdate(existing: Metadata | null, desired: Metadata): boolean {
    if (!existing) {
        return true
    }
    const keys: Array<keyof Metadata> = ['path', 'machineId', 'codexSessionId', 'readOnly', 'readOnlyReason']
    for (const key of keys) {
        if (existing[key] !== desired[key]) {
            return true
        }
    }
    const existingExternal = existing.external ?? null
    const desiredExternal = desired.external ?? null
    if (JSON.stringify(existingExternal) !== JSON.stringify(desiredExternal)) {
        return true
    }
    return false
}

async function sendCodexEvents(client: ApiSessionClient, entries: CodexSessionFileEntry[], sessionId: string): Promise<void> {
    let counter = 0
    let preferResponseItems = false
    if (entries.length > 0) {
        await client.flush({ timeoutMs: MESSAGE_FLUSH_TIMEOUT_MS })
    }
    for (const entry of entries) {
        if (!preferResponseItems) {
            const raw = entry.event as Record<string, unknown> | null
            if (raw && typeof raw === 'object' && raw.type === 'response_item') {
                const payload = raw.payload as Record<string, unknown> | null
                const itemType = typeof payload?.type === 'string' ? payload.type : null
                if (itemType === 'message' || itemType === 'reasoning') {
                    preferResponseItems = true
                }
            }
        }

        if (preferResponseItems) {
            const raw = entry.event as Record<string, unknown> | null
            if (raw && typeof raw === 'object' && raw.type === 'event_msg') {
                const payload = raw.payload as Record<string, unknown> | null
                const eventType = typeof payload?.type === 'string' ? payload.type : null
                if (eventType === 'user_message' || eventType === 'agent_message' || eventType === 'agent_reasoning' || eventType === 'agent_reasoning_delta') {
                    continue
                }
            }
        }

        const rawEvent = entry.event as Record<string, unknown> | null
        if (rawEvent && typeof rawEvent === 'object') {
            const rawType = typeof rawEvent.type === 'string' ? rawEvent.type : null
            if (rawType === 'context_compacted') {
                await client.updateAgentState((currentState) => {
                    const { tokenUsage, ...rest } = currentState ?? {}
                    return { ...rest }
                })
                continue
            }
            if (rawType === 'event_msg') {
                const payload = rawEvent.payload as Record<string, unknown> | null
                const eventType = typeof payload?.type === 'string' ? payload.type : null
                if (eventType === 'context_compacted') {
                    await client.updateAgentState((currentState) => {
                        const { tokenUsage, ...rest } = currentState ?? {}
                        return { ...rest }
                    })
                    continue
                }
            }
        }

        const converted = convertCodexEvent(entry.event)
        if (!converted) {
            continue
        }
        const localId = `codex:${sessionId}:${entry.lineIndex}`
        if (converted.userMessage) {
            client.sendMessageContent({
                role: 'user',
                content: {
                    type: 'text',
                    text: converted.userMessage
                },
                meta: { sentFrom: 'cli' }
            }, localId)
        }
        if (converted.message) {
            if (converted.message.type === 'token_count') {
                const info = converted.message.info
                const usage = normalizeTokenUsage(info)
                const contextLimitTokens = extractContextLimitTokens(info)
                if (usage || contextLimitTokens !== null) {
                    await client.updateAgentState((currentState) => ({
                        ...(currentState ?? {}),
                        ...(contextLimitTokens !== null ? { contextLimitTokens } : {}),
                        tokenUsage: usage
                            ? {
                                ...(currentState?.tokenUsage ?? {}),
                                ...usage
                            }
                            : currentState?.tokenUsage
                    }))
                }
                continue
            }
            client.sendMessageContent({
                role: 'agent',
                content: {
                    type: 'codex',
                    data: converted.message
                },
                meta: { sentFrom: 'cli' }
            }, localId)
        }
        counter += 1
        if (counter % MESSAGE_FLUSH_SIZE === 0) {
            await client.flush({ timeoutMs: MESSAGE_FLUSH_TIMEOUT_MS })
        }
        if (counter % MESSAGE_BATCH_SIZE === 0) {
            await shortSleep(MESSAGE_BATCH_DELAY_MS)
        }
    }
    if (counter % MESSAGE_FLUSH_SIZE !== 0) {
        await client.flush({ timeoutMs: MESSAGE_FLUSH_TIMEOUT_MS })
    }
}

async function ensureSessionSynced(options: {
    api: ApiClient
    machineId: string
    sessionId: string
    filePath: string
    cursor: CodexSyncCursor | null
    scan?: CodexSessionScan
    readOnlyInfo: { readOnly: boolean; readOnlyReason?: string; external?: { running?: boolean; detectedAt?: number; source?: string } }
    updateReadOnly: boolean
    existingSessionId?: string
    skipImport?: boolean
}): Promise<CodexSyncCursor | null> {
    const { api, machineId, sessionId, filePath, cursor, readOnlyInfo, updateReadOnly } = options
    if (options.skipImport) {
        return cursor ?? { filePath, lastLineIndex: 0 }
    }
    const startLine = cursor?.lastLineIndex ?? 0
    const scan = options.scan ?? await readSessionFile(filePath, startLine)
    const meta = scan.meta

    if (!meta || !meta.id) {
        return null
    }
    const cwd = meta.cwd
    if (!cwd || !cwd.trim()) {
        return null
    }

    const metadata = buildCodexMetadata({
        cwd,
        machineId,
        codexSessionId: sessionId,
        readOnly: readOnlyInfo.readOnly,
        readOnlyReason: readOnlyInfo.readOnlyReason,
        external: readOnlyInfo.external
    })

    const session = options.existingSessionId
        ? await api.getSessionById(options.existingSessionId)
        : await api.getOrCreateSession({
            tag: `codex:${machineId}:${sessionId}`,
            metadata,
            state: null
        })

    const client = api.sessionSyncClient(session)
    try {
        if (updateReadOnly && needsMetadataUpdate(session.metadata, metadata)) {
            const merged = mergeMetadata(session.metadata, metadata)
            await client.updateMetadata(() => merged)
        }
        if (scan.events.length > 0) {
            await sendCodexEvents(client, scan.events, sessionId)
        }
    } finally {
        client.close()
    }

    let mtimeMs: number | undefined
    try {
        const stats = await stat(filePath)
        mtimeMs = stats.mtimeMs
    } catch {
        mtimeMs = cursor?.lastMtimeMs
    }

    return {
        filePath,
        lastLineIndex: scan.totalLines,
        lastMtimeMs: mtimeMs
    }
}

async function findSessionFileById(sessionId: string): Promise<string | null> {
    const root = getCodexSessionsRoot()
    const files = await listSessionFiles(root)
    for (const filePath of files) {
        if (filePath.includes(sessionId)) {
            return filePath
        }
    }
    return null
}

export function createCodexSyncManager(options: { api: ApiClient; machineId: string }) {
    const lock = new AsyncLock()

    const runSync = async (params: CodexSyncParams): Promise<void> => {
        await lock.inLock(async () => {
            if (params.mode === 'session') {
                const codexSessionId = params.codexSessionId
                if (!codexSessionId) {
                    return
                }
                const state = await readCodexSyncState()
                const cursor = state.sessions[codexSessionId] ?? null
                const filePath = cursor?.filePath ?? await findSessionFileById(codexSessionId)
                if (!filePath) {
                    return
                }
                const updated = await ensureSessionSynced({
                    api: options.api,
                    machineId: options.machineId,
                    sessionId: codexSessionId,
                    filePath,
                    cursor,
                    readOnlyInfo: { readOnly: false },
                    updateReadOnly: false
                })
                if (updated) {
                    state.sessions[codexSessionId] = updated
                    await writeCodexSyncState(state)
                }
                return
            }

            const sessionsRoot = getCodexSessionsRoot()
            const files = await listSessionFiles(sessionsRoot)
            const running = await detectRunningCodexSessions()
            const runningMap = new Map<string, RunningSessionInfo>()
            for (const entry of running) {
                runningMap.set(entry.sessionId, entry)
            }
            const existingSessions = await loadExistingCodexSessions(options.api)

            const state = await readCodexSyncState()
            const nextState: CodexSyncState = {
                version: CODEX_SYNC_STATE_VERSION,
                sessions: { ...state.sessions }
            }

            for (const filePath of files) {
                const extractedSessionId = extractSessionIdFromPath(filePath)
                const cursorForFile = findCursorForFile(state.sessions, filePath, extractedSessionId)
                const scan = await readSessionFile(filePath, cursorForFile?.lastLineIndex ?? 0)
                const resolvedSessionId = scan.meta?.id ?? extractedSessionId
                if (!resolvedSessionId) {
                    continue
                }
                const cursor = state.sessions[resolvedSessionId] ?? cursorForFile ?? null
                const runningInfo = runningMap.get(resolvedSessionId)
                    ?? (extractedSessionId && extractedSessionId !== resolvedSessionId
                        ? runningMap.get(extractedSessionId)
                        : undefined)
                const existingCandidate = existingSessions.get(resolvedSessionId)
                    ?? (extractedSessionId && extractedSessionId !== resolvedSessionId
                        ? existingSessions.get(extractedSessionId)
                        : undefined)
                const candidateMetadata = existingCandidate?.metadata ?? null
                const matchesMachine = !candidateMetadata?.machineId || candidateMetadata.machineId === options.machineId
                const existing = matchesMachine ? existingCandidate : undefined
                const existingMetadata = existing?.metadata ?? null
                const isOwnedByHapi = Boolean(existingMetadata?.startedFromRunner)
                    || typeof existingMetadata?.hostPid === 'number'
                const skipImport = Boolean(existing) && isOwnedByHapi
                const existingSessionId = !skipImport && existing ? existing.sessionId : undefined

                const readOnlyInfo = (() => {
                    if (isWindows()) {
                        return {
                            readOnly: true,
                            readOnlyReason: 'windows-external',
                            external: undefined
                        }
                    }
                    if (runningInfo) {
                        return {
                            readOnly: true,
                            readOnlyReason: 'external-running',
                            external: {
                                running: true,
                                detectedAt: Date.now(),
                                source: runningInfo.source
                            }
                        }
                    }
                    return { readOnly: false }
                })()

                const updated = await ensureSessionSynced({
                    api: options.api,
                    machineId: options.machineId,
                    sessionId: resolvedSessionId,
                    filePath,
                    cursor,
                    scan,
                    readOnlyInfo,
                    updateReadOnly: true,
                    existingSessionId,
                    skipImport
                })

                if (updated) {
                    nextState.sessions[resolvedSessionId] = updated
                    if (extractedSessionId && extractedSessionId !== resolvedSessionId) {
                        delete nextState.sessions[extractedSessionId]
                    }
                }
            }

            await writeCodexSyncState(nextState)
        })
    }

    return { runSync }
}
