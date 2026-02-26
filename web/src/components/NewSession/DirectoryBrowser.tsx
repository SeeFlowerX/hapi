import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { ApiClient } from '@/api/client'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { useMachineDirectory } from '@/hooks/queries/useMachineDirectory'
import { useTranslation } from '@/lib/use-translation'

function FolderIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
    )
}

function normalizePath(path: string): string {
    if (!path) return ''
    const trimmed = path.trim()
    if (!trimmed) return ''
    if (trimmed === '/' || trimmed === '\\') return trimmed
    if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`
    if (/^[A-Za-z]:[\\/]+$/.test(trimmed)) {
        return `${trimmed[0].toUpperCase()}:\\`
    }
    return trimmed.replace(/[\\/]+$/, '')
}

function getSeparator(path: string): '/' | '\\' {
    return path.includes('\\') && !path.includes('/') ? '\\' : '/'
}

function joinPath(base: string, name: string): string {
    const trimmedBase = normalizePath(base)
    if (!trimmedBase) return name
    const separator = getSeparator(trimmedBase)
    return `${trimmedBase}${separator}${name}`
}

function getParentPath(path: string): string {
    const normalized = normalizePath(path)
    if (!normalized) return ''
    const separator = getSeparator(normalized)
    const parts = normalized.split(separator).filter((part) => part.length > 0)
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join(separator)
}

export function DirectoryBrowser(props: {
    api: ApiClient | null
    machineId: string | null
    path: string
    isDisabled: boolean
    onPathChange: (path: string) => void
    onSelectPath: (path: string) => void
}) {
    const { t } = useTranslation()
    const [createError, setCreateError] = useState<string | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [isInputFocused, setIsInputFocused] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const { entries, error, isLoading, refetch, path: resolvedPath, pathType } = useMachineDirectory(props.api, props.machineId, props.path, {
        enabled: Boolean(props.machineId)
    })

    const directories = useMemo(
        () => entries.filter((entry) => entry.type === 'directory'),
        [entries]
    )

    useEffect(() => {
        setCreateError(null)
    }, [props.path])

    useEffect(() => {
        if (props.isDisabled) return
        inputRef.current?.focus()
    }, [props.isDisabled])

    useEffect(() => {
        if (!resolvedPath) return
        if (isInputFocused) return
        if (!props.path.trim() || resolvedPath !== props.path) {
            props.onPathChange(resolvedPath)
        }
    }, [resolvedPath, props.path, props.onPathChange, isInputFocused])

    const effectivePath = normalizePath(props.path || resolvedPath || '')
    const canGoUp = pathType === 'directory' && getParentPath(effectivePath) !== ''
    const isDirectory = pathType === 'directory'
    const isMissing = pathType === 'missing'
    const isFile = pathType === 'file'
    const isOther = pathType === 'other'
    const showGenericError = Boolean(error && !isMissing && !isFile && !isOther)
    const hasEntries = isDirectory && (directories.length > 0 || canGoUp)

    const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        props.onPathChange(event.target.value)
    }, [props.onPathChange])

    async function handleCreateFolder() {
        if (!props.api || !props.machineId) return
        if (!effectivePath) return

        setIsCreating(true)
        setCreateError(null)
        try {
            const result = await props.api.createMachineDirectory(props.machineId, effectivePath)
            if (!result.success) {
                setCreateError(result.error ?? 'Failed to create directory')
                return
            }
            await refetch()
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : 'Failed to create directory')
        } finally {
            setIsCreating(false)
        }
    }

    if (!props.machineId) {
        return (
            <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-xs text-[var(--app-hint)]">
                {t('newSession.browse.noMachine')}
            </div>
        )
    }

    return (
        <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-sm">
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start gap-2">
                    <div className="relative min-w-[180px] flex-1">
                        <input
                            ref={inputRef}
                            type="text"
                            value={props.path}
                            onChange={handleInputChange}
                            onFocus={() => setIsInputFocused(true)}
                            onBlur={() => setIsInputFocused(false)}
                            placeholder={t('newSession.placeholder')}
                            disabled={props.isDisabled}
                            className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>
                    {isMissing ? (
                        <Button
                            variant="secondary"
                            onClick={handleCreateFolder}
                            disabled={props.isDisabled || isCreating || isLoading || !effectivePath}
                        >
                            {t('newSession.browse.create')}
                        </Button>
                    ) : null}
                    <Button
                        onClick={() => props.onSelectPath(effectivePath)}
                        disabled={props.isDisabled || isLoading || !effectivePath || !isDirectory}
                    >
                        {t('newSession.browse.ok')}
                    </Button>
                </div>

                {isFile ? (
                    <div className="text-xs text-red-600">
                        {t('newSession.browse.file')}
                    </div>
                ) : null}
                {isOther ? (
                    <div className="text-xs text-red-600">
                        {t('newSession.browse.invalid')}
                    </div>
                ) : null}
                {isMissing ? (
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('newSession.browse.missing')}
                    </div>
                ) : null}
                {showGenericError ? (
                    <div className="text-xs text-red-600">
                        {error}
                    </div>
                ) : null}
                {createError ? (
                    <div className="text-xs text-red-600">
                        {createError}
                    </div>
                ) : null}
            </div>

            <div className="mt-3 max-h-48 overflow-y-auto rounded border border-[var(--app-border)]">
                {isLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--app-hint)]">
                        <Spinner size="sm" label={null} />
                        {t('newSession.browse.loading')}
                    </div>
                ) : !isDirectory ? (
                    <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                        {t('newSession.browse.empty')}
                    </div>
                ) : !hasEntries ? (
                    <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
                        {t('newSession.browse.empty')}
                    </div>
                ) : (
                    <>
                        {canGoUp ? (
                            <button
                                type="button"
                                onClick={() => props.onPathChange(getParentPath(effectivePath))}
                                disabled={props.isDisabled}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                            >
                                <FolderIcon className="text-[var(--app-link)]" />
                                <span className="truncate">..</span>
                            </button>
                        ) : null}
                        {directories.map((entry) => {
                            const nextPath = joinPath(effectivePath, entry.name)
                            return (
                                <button
                                    key={nextPath}
                                    type="button"
                                    onClick={() => props.onPathChange(nextPath)}
                                    disabled={props.isDisabled}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--app-subtle-bg)] disabled:opacity-50"
                                >
                                    <FolderIcon className="text-[var(--app-link)]" />
                                    <span className="truncate">{entry.name}</span>
                                </button>
                            )
                        })}
                    </>
                )}
            </div>
        </div>
    )
}
