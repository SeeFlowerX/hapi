const STORAGE_KEY = 'hapi:pendingCodexModels'

type PendingCodexModelMap = Record<string, string>

function safeParseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

function readPendingMap(): PendingCodexModelMap {
    if (typeof window === 'undefined') return {}
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return {}
        const parsed = safeParseJson(raw)
        if (!parsed || typeof parsed !== 'object') return {}
        const record = parsed as Record<string, unknown>
        const result: PendingCodexModelMap = {}
        for (const [key, value] of Object.entries(record)) {
            if (typeof key !== 'string' || key.trim().length === 0) continue
            if (typeof value !== 'string' || value.trim().length === 0) continue
            result[key] = value
        }
        return result
    } catch {
        return {}
    }
}

function writePendingMap(map: PendingCodexModelMap): void {
    if (typeof window === 'undefined') return
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    } catch {
        // ignore storage errors
    }
}

export function getPendingCodexModel(sessionId: string): string | null {
    if (!sessionId) return null
    const map = readPendingMap()
    return map[sessionId] ?? null
}

export function setPendingCodexModel(sessionId: string, model: string): void {
    if (!sessionId || !model) return
    const map = readPendingMap()
    map[sessionId] = model
    writePendingMap(map)
}

export function clearPendingCodexModel(sessionId: string): void {
    if (!sessionId) return
    const map = readPendingMap()
    if (!(sessionId in map)) return
    delete map[sessionId]
    writePendingMap(map)
}
