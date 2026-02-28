const STORAGE_KEY = 'hapi:codex-auto-sessions'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function readAutoSessions(): Set<string> {
    if (!isBrowser()) return new Set()
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return new Set()
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return new Set()
        return new Set(parsed.filter((entry) => typeof entry === 'string' && entry.trim().length > 0))
    } catch {
        return new Set()
    }
}

function writeAutoSessions(sessions: Set<string>): void {
    if (!isBrowser()) return
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(sessions)))
    } catch {
        // ignore storage errors
    }
}

export function isCodexAutoSession(sessionId: string): boolean {
    if (!sessionId) return false
    return readAutoSessions().has(sessionId)
}

export function setCodexAutoSession(sessionId: string, enabled: boolean): void {
    if (!sessionId) return
    const sessions = readAutoSessions()
    if (enabled) {
        sessions.add(sessionId)
    } else {
        sessions.delete(sessionId)
    }
    writeAutoSessions(sessions)
}
