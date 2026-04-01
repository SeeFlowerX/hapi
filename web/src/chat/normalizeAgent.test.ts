import { describe, expect, it } from 'vitest'
import { normalizeAgentRecord } from '@/chat/normalizeAgent'

describe('normalizeAgentRecord', () => {
    it('preserves codex tool result error state', () => {
        const normalized = normalizeAgentRecord(
            'msg-1',
            null,
            1,
            {
                type: 'codex',
                data: {
                    type: 'tool-call-result',
                    callId: 'call-1',
                    output: 'failed',
                    is_error: true
                }
            }
        )

        expect(normalized?.role).toBe('agent')
        expect(Array.isArray(normalized?.content)).toBe(true)
        const first = Array.isArray(normalized?.content) ? normalized.content[0] : null
        expect(first).toMatchObject({
            type: 'tool-result',
            tool_use_id: 'call-1',
            content: 'failed',
            is_error: true
        })
    })
})
