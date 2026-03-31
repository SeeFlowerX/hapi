type Quote = '\'' | '"' | '`'

function tokenizeCommand(command: string): { segments: string[]; operators: string[] } {
    const segments: string[] = []
    const operators: string[] = []

    let quote: Quote | null = null
    let escaped = false
    let segmentStart = 0

    for (let i = 0; i < command.length; i++) {
        const ch = command[i]

        if (escaped) {
            escaped = false
            continue
        }

        if (ch === '\\') {
            escaped = true
            continue
        }

        if (quote) {
            if (ch === quote) {
                quote = null
            }
            continue
        }

        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch
            continue
        }

        const next = command[i + 1]
        if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
            segments.push(command.slice(segmentStart, i))
            operators.push(ch + next)
            i += 1
            segmentStart = i + 1
            continue
        }

        if (ch === '|') {
            segments.push(command.slice(segmentStart, i))
            operators.push(ch)
            segmentStart = i + 1
            continue
        }
    }

    segments.push(command.slice(segmentStart))
    return { segments, operators }
}

export function formatShellCommandForDisplay(command: string): string {
    if (!command || command.includes('\n')) {
        return command
    }

    if (!command.includes('&&') && !command.includes('||') && !command.includes('|')) {
        return command
    }

    const { segments, operators } = tokenizeCommand(command)
    if (operators.length === 0 || segments.length === 0) {
        return command
    }

    const lines: string[] = []
    let current = segments[0].trim()

    for (let i = 0; i < operators.length; i++) {
        const operator = operators[i]
        const nextSegment = (segments[i + 1] ?? '').trim()

        if (!current) {
            current = nextSegment
            continue
        }

        lines.push(`${current} ${operator} \\`)
        current = nextSegment ? `  ${nextSegment}` : '  '
    }

    if (current) {
        lines.push(current)
    }

    const formatted = lines.join('\n')
    return formatted.length > 0 ? formatted : command
}
