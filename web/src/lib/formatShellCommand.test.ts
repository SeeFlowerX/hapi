import { describe, expect, it } from 'vitest'
import { formatShellCommandForDisplay } from '@/lib/formatShellCommand'

describe('formatShellCommandForDisplay', () => {
    it('formats chained operators into multi-line display', () => {
        const input = 'cd /tmp && echo ok || echo fail'
        const output = formatShellCommandForDisplay(input)

        expect(output).toContain('&& \\')
        expect(output).toContain('|| \\')
        expect(output.split('\n').length).toBeGreaterThan(1)
    })

    it('keeps operators inside quotes untouched', () => {
        const input = "echo 'a && b' && echo done"
        const output = formatShellCommandForDisplay(input)

        expect(output).toContain("'a && b'")
        expect(output).toContain('echo done')
    })

    it('returns original string when no chain operator exists', () => {
        const input = 'echo hello'
        expect(formatShellCommandForDisplay(input)).toBe(input)
    })
})
