import type { Machine, SessionSummaryMetadata } from '@/types/api'

export function formatPlatform(platform?: string | null): string {
    if (!platform) {
        return 'Unknown'
    }
    if (platform === 'darwin') {
        return 'macOS'
    }
    if (platform === 'win32') {
        return 'Windows'
    }
    if (platform === 'linux') {
        return 'Linux'
    }
    return platform
}

export function getShortMachineId(machineId?: string | null): string {
    if (!machineId) {
        return 'unknown'
    }
    return machineId.slice(0, 6)
}

export function getMachineLabel(options: {
    machine?: Machine | null
    metadata?: SessionSummaryMetadata | null
    machineId?: string | null
}): string {
    const { machine, metadata, machineId } = options
    const displayName = machine?.metadata?.displayName
        || machine?.metadata?.host
        || metadata?.host
        || 'Unknown'
    const platform = formatPlatform(machine?.metadata?.platform ?? metadata?.os ?? null)
    const shortId = getShortMachineId(machine?.id ?? metadata?.machineId ?? machineId ?? null)
    return `${displayName} · ${platform} · ${shortId}`
}
