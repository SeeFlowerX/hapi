function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        if (key in record) {
            const value = asNumber(record[key]);
            if (value !== null) {
                return value;
            }
        }
    }
    return null;
}

export type NormalizedTokenUsage = {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    totalTokens?: number;
    updatedAt?: number;
};

export function normalizeTokenUsage(info: Record<string, unknown> | null): NormalizedTokenUsage | null {
    if (!info) {
        return null;
    }

    const baseUsage = asRecord(info.tokenUsage ?? info.token_usage ?? info.usage ?? info) ?? info;
    const totalUsage = asRecord(
        baseUsage.total
            ?? baseUsage.total_usage
            ?? baseUsage.totalTokenUsage
            ?? baseUsage.total_token_usage
    );
    const lastUsage = asRecord(
        baseUsage.last
            ?? baseUsage.last_usage
            ?? baseUsage.lastTokenUsage
            ?? baseUsage.last_token_usage
    );
    const usage = lastUsage ?? totalUsage ?? baseUsage;

    const inputTokens = pickNumber(usage, [
        'input_tokens',
        'inputTokens',
        'prompt_tokens',
        'promptTokens'
    ]);

    const outputTokens = pickNumber(usage, [
        'output_tokens',
        'outputTokens',
        'completion_tokens',
        'completionTokens'
    ]);

    const cacheCreationInputTokens = pickNumber(usage, [
        'cache_creation_input_tokens',
        'cacheCreationInputTokens',
        'cache_creation_tokens',
        'cacheCreationTokens'
    ]);

    const cacheReadInputTokens = pickNumber(usage, [
        'cache_read_input_tokens',
        'cacheReadInputTokens',
        'cache_read_tokens',
        'cacheReadTokens',
        'cached_input_tokens',
        'cachedInputTokens'
    ]);

    const totalTokens = pickNumber(totalUsage ?? usage, [
        'total_tokens',
        'totalTokens',
        'tokens'
    ]);

    const updatedAt = pickNumber(usage, [
        'updated_at',
        'updatedAt',
        'timestamp',
        'time'
    ]) ?? Date.now();

    if (
        inputTokens === null &&
        outputTokens === null &&
        cacheCreationInputTokens === null &&
        cacheReadInputTokens === null &&
        totalTokens === null
    ) {
        return null;
    }

    return {
        ...(inputTokens !== null ? { inputTokens } : {}),
        ...(outputTokens !== null ? { outputTokens } : {}),
        ...(cacheCreationInputTokens !== null ? { cacheCreationInputTokens } : {}),
        ...(cacheReadInputTokens !== null ? { cacheReadInputTokens } : {}),
        ...(totalTokens !== null ? { totalTokens } : {}),
        updatedAt
    };
}
