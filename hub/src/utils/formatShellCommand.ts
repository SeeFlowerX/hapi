import { isObject } from '@hapi/protocol'
import type { Plugin } from 'prettier'

let prettierModulePromise: Promise<typeof import('prettier')> | null = null
let prettierPluginPromise: Promise<unknown> | null = null
const formatCache = new Map<string, string>()
const MAX_CACHE = 200

async function loadPrettier() {
    if (!prettierModulePromise) {
        prettierModulePromise = import('prettier')
    }
    return prettierModulePromise
}

async function loadPlugin() {
    if (!prettierPluginPromise) {
        prettierPluginPromise = import('prettier-plugin-sh')
            .then((mod) => (mod as { default?: unknown }).default ?? mod)
    }
    return prettierPluginPromise
}

export async function formatShellCommand(command: string): Promise<string | null> {
    const trimmed = command.trim()
    if (!trimmed) return null
    if (formatCache.has(command)) {
        return formatCache.get(command) ?? null
    }

    try {
        const prettier = await loadPrettier()
        const plugin = await loadPlugin() as Plugin
        const formatted = await prettier.format(command, {
            parser: 'sh',
            plugins: [plugin]
        })
        const result = formatted.trimEnd()
        if (!result) return null

        if (formatCache.size >= MAX_CACHE) {
            const first = formatCache.keys().next().value
            if (first) formatCache.delete(first)
        }
        formatCache.set(command, result)
        return result
    } catch {
        return null
    }
}

function extractCommand(input: Record<string, unknown>): string | null {
    const direct = input.command
    if (typeof direct === 'string') return direct
    if (Array.isArray(direct)) {
        const parts = direct.filter((part): part is string => typeof part === 'string')
        if (parts.length > 0) return parts.join(' ')
    }

    const cmd = input.cmd
    if (typeof cmd === 'string') return cmd
    return null
}

export async function formatToolInput(input: unknown): Promise<unknown> {
    if (!isObject(input)) return input
    const command = extractCommand(input)
    if (!command) return input
    const formatted = await formatShellCommand(command)
    if (!formatted || formatted === command) return input
    return {
        ...input,
        commandFormatted: formatted
    }
}

export async function formatMessageContentForWeb(content: unknown): Promise<unknown> {
    const walk = async (node: unknown, depth: number): Promise<unknown> => {
        if (depth > 20) return node
        if (Array.isArray(node)) {
            let changed = false
            const next = await Promise.all(node.map(async (item) => {
                const updated = await walk(item, depth + 1)
                if (updated !== item) changed = true
                return updated
            }))
            return changed ? next : node
        }
        if (!isObject(node)) return node

        let changed = false
        let next: Record<string, unknown> | null = null

        const nodeType = node.type
        if ((nodeType === 'tool_use' || nodeType === 'tool-call') && 'input' in node) {
            const formattedInput = await formatToolInput(node.input)
            if (formattedInput !== node.input) {
                next = { ...node, input: formattedInput }
                changed = true
            }
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'input') continue
            if (!isObject(value) && !Array.isArray(value)) continue
            const updated = await walk(value, depth + 1)
            if (updated === value) continue
            if (!next) {
                next = { ...node }
            }
            next[key] = updated
            changed = true
        }

        return changed ? (next as Record<string, unknown>) : node
    }

    return walk(content, 0)
}
