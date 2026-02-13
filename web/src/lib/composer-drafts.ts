const drafts = new Map<string, string>()

export function getComposerDraft(sessionId: string): string | null {
    const draft = drafts.get(sessionId)
    return draft ?? null
}

export function setComposerDraft(sessionId: string, text: string): void {
    if (text.length === 0) {
        drafts.delete(sessionId)
        return
    }
    drafts.set(sessionId, text)
}

export function clearComposerDraft(sessionId: string): void {
    drafts.delete(sessionId)
}
