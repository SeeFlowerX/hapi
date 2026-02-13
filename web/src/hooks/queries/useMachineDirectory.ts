import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { DirectoryEntry } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useMachineDirectory(
    api: ApiClient | null,
    machineId: string | null,
    path: string,
    options?: { enabled?: boolean }
): {
    entries: DirectoryEntry[]
    error: string | null
    isLoading: boolean
    path: string | null
    refetch: () => Promise<unknown>
} {
    const resolvedMachineId = machineId ?? 'unknown'
    const enabled = Boolean(api && machineId) && (options?.enabled ?? true)

    const query = useQuery({
        queryKey: queryKeys.machineDirectory(resolvedMachineId, path),
        queryFn: async () => {
            if (!api || !machineId) {
                throw new Error('Machine unavailable')
            }

            const response = await api.listMachineDirectory(machineId, path)
            if (!response.success) {
                return { entries: [], error: response.error ?? 'Failed to list directory', path: null }
            }

            return { entries: response.entries ?? [], error: null, path: response.path ?? null }
        },
        enabled
    })

    const queryError = query.error instanceof Error
        ? query.error.message
        : query.error
            ? 'Failed to list directory'
            : null

    return {
        entries: query.data?.entries ?? [],
        error: queryError ?? query.data?.error ?? null,
        isLoading: query.isLoading,
        path: query.data?.path ?? null,
        refetch: query.refetch
    }
}
