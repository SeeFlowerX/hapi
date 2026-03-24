import { getModelModeLabel, MODEL_MODES } from '@hapi/protocol'
import { describe, expect, it } from 'vitest'
import { CLAUDE_EFFORT_OPTIONS, MODEL_OPTIONS } from './types'

describe('Claude model options', () => {
    it('includes 1m model options in the expected order', () => {
        expect(MODEL_OPTIONS.claude).toEqual([
            { value: 'auto', label: 'Auto' },
            { value: 'opus', label: 'Opus' },
            { value: 'opus[1m]', label: 'Opus 1M' },
            { value: 'sonnet', label: 'Sonnet' },
            { value: 'sonnet[1m]', label: 'Sonnet 1M' },
        ])
    })

    it('exposes friendly labels for session model modes', () => {
        expect(MODEL_MODES).toEqual(['default', 'sonnet', 'sonnet[1m]', 'opus', 'opus[1m]'])
        expect(getModelModeLabel('sonnet[1m]')).toBe('Sonnet 1M')
        expect(getModelModeLabel('opus[1m]')).toBe('Opus 1M')
    })
})

describe('Claude effort options', () => {
    it('matches supported effort presets in expected order', () => {
        expect(CLAUDE_EFFORT_OPTIONS).toEqual([
            { value: 'auto', label: 'Auto' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'max', label: 'Max' },
        ])
    })
})
