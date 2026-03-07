export const CODEX_MODEL_OPTIONS = [
    { value: 'auto', label: 'Auto' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
    { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
] as const

export type CodexModelValue = typeof CODEX_MODEL_OPTIONS[number]['value']
export type ConcreteCodexModelValue = Exclude<CodexModelValue, 'auto'>

const CODEX_MODEL_VALUES = new Set(
    CODEX_MODEL_OPTIONS
        .map((option) => option.value)
        .filter((value): value is ConcreteCodexModelValue => value !== 'auto')
)

export function normalizeCodexModel(value: string | null | undefined): ConcreteCodexModelValue | null {
    if (!value) return null
    const trimmed = value.trim()
    if (!trimmed || trimmed === 'auto') return null
    return CODEX_MODEL_VALUES.has(trimmed as ConcreteCodexModelValue)
        ? (trimmed as ConcreteCodexModelValue)
        : null
}

export function getCodexModelLabel(value: string | null | undefined): string {
    const normalized = normalizeCodexModel(value)
    if (!normalized) return 'Auto'
    const match = CODEX_MODEL_OPTIONS.find((option) => option.value === normalized)
    return match?.label ?? normalized
}

export function isCodexModelValue(value: string | null | undefined): boolean {
    return normalizeCodexModel(value) !== null
}
