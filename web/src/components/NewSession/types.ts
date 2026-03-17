export type AgentType = 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
export type SessionType = 'simple' | 'worktree'
export type CodexReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh'

import { CODEX_MODEL_OPTIONS } from '@/lib/codexModels'

export const MODEL_OPTIONS: Record<AgentType, { value: string; label: string }[]> = {
    claude: [
        { value: 'auto', label: 'Auto' },
        { value: 'opus', label: 'Opus' },
        { value: 'opus[1m]', label: 'Opus 1M' },
        { value: 'sonnet', label: 'Sonnet' },
        { value: 'sonnet[1m]', label: 'Sonnet 1M' },
    ],
    codex: [...CODEX_MODEL_OPTIONS],
    cursor: [],
    gemini: [
        { value: 'auto', label: 'Auto' },
        { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
        { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    ],
    opencode: [],
}

export const CODEX_REASONING_EFFORT_OPTIONS: { value: CodexReasoningEffort; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'XHigh' },
]
