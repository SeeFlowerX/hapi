import { useCallback, useEffect, useState } from 'react'
import { normalizeCodexModel } from '@/lib/codexModels'

const STORAGE_KEY = 'hapi:codex-default-model'
const EVENT_NAME = 'hapi:codex-default-model-change'

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function readStoredModel(): string | null {
    if (!isBrowser()) return null
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return normalizeCodexModel(raw)
    } catch {
        return null
    }
}

function writeStoredModel(model: string | null): void {
    if (!isBrowser()) return
    try {
        if (!model) {
            localStorage.removeItem(STORAGE_KEY)
        } else {
            localStorage.setItem(STORAGE_KEY, model)
        }
    } catch {
        // ignore storage errors
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function useDefaultCodexModel(): {
    defaultCodexModel: string | null
    setDefaultCodexModel: (model: string | null) => void
} {
    const [defaultCodexModel, setDefaultCodexModelState] = useState<string | null>(readStoredModel)

    useEffect(() => {
        if (!isBrowser()) return

        const handleStorage = (event: StorageEvent) => {
            if (event.key !== STORAGE_KEY) return
            setDefaultCodexModelState(readStoredModel())
        }

        const handleCustom = () => {
            setDefaultCodexModelState(readStoredModel())
        }

        window.addEventListener('storage', handleStorage)
        window.addEventListener(EVENT_NAME, handleCustom)
        return () => {
            window.removeEventListener('storage', handleStorage)
            window.removeEventListener(EVENT_NAME, handleCustom)
        }
    }, [])

    const setDefaultCodexModel = useCallback((model: string | null) => {
        const normalized = normalizeCodexModel(model)
        setDefaultCodexModelState(normalized)
        writeStoredModel(normalized)
    }, [])

    return { defaultCodexModel, setDefaultCodexModel }
}
