import type { AttachmentMetadata } from '@/types/api'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileIcon } from '@/components/FileIcon'
import { CloseIcon } from '@/components/icons'
import { Spinner } from '@/components/Spinner'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { isImageMimeType } from '@/lib/fileAttachments'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { decodeBase64 } from '@/lib/utils'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { langAlias, useShikiHighlighter } from '@/lib/shiki'

const MAX_TEXT_PREVIEW_BYTES = 10 * 1024 * 1024

const TEXT_MIME_TYPES = new Set<string>([
    'application/json',
    'application/xml',
    'application/xhtml+xml',
    'application/javascript',
    'application/x-javascript',
    'application/typescript',
    'application/x-typescript',
    'application/x-shellscript',
    'application/x-sh',
    'application/x-yaml',
    'application/yaml',
    'application/toml',
    'application/x-toml',
    'application/markdown',
    'application/x-markdown'
])

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i += 1) {
        bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: mimeType })
}

function estimateBase64Bytes(base64: string): number {
    const len = base64.length
    if (len === 0) return 0
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    return Math.floor((len * 3) / 4) - padding
}

function limitBase64ForBytes(base64: string, maxBytes: number): { value: string; truncated: boolean } {
    const estimated = estimateBase64Bytes(base64)
    if (estimated <= maxBytes) {
        return { value: base64, truncated: false }
    }
    const maxBase64Length = Math.floor(maxBytes / 3) * 4
    if (maxBase64Length <= 0) {
        return { value: '', truncated: true }
    }
    const trimmedLength = maxBase64Length - (maxBase64Length % 4)
    return { value: base64.slice(0, trimmedLength), truncated: true }
}

function isTextMimeType(mimeType: string): boolean {
    if (!mimeType) return false
    const normalized = mimeType.toLowerCase()
    if (normalized.startsWith('text/')) return true
    if (normalized.includes('+json')) return true
    if (normalized.includes('+xml')) return true
    return TEXT_MIME_TYPES.has(normalized)
}

function resolveLanguage(path: string): string | undefined {
    const parts = path.split('.')
    if (parts.length <= 1) return undefined
    const ext = parts[parts.length - 1]?.toLowerCase()
    if (!ext) return undefined
    return langAlias[ext] ?? ext
}

function ImageAttachment(props: {
    attachment: AttachmentMetadata
    onOpen?: () => void
    onDownload?: () => void
    downloadLabel?: string
}) {
    const { attachment, onOpen, onDownload, downloadLabel } = props
    const interactive = Boolean(onOpen)
    return (
        <div
            className={`relative overflow-hidden rounded-lg ${interactive ? 'cursor-pointer' : ''}`}
            onClick={onOpen}
            onKeyDown={(event) => {
                if (!interactive) return
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpen?.()
                }
            }}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
        >
            <img
                src={attachment.previewUrl}
                alt={attachment.filename}
                className="max-h-48 max-w-full object-contain"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-white/90 line-clamp-1">
                        {attachment.filename}
                    </span>
                    {onDownload ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation()
                                onDownload()
                            }}
                            className="shrink-0 rounded bg-white/20 px-2 py-0.5 text-[10px] text-white/90 hover:bg-white/30"
                        >
                            {downloadLabel}
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    )
}

function FileAttachment(props: {
    attachment: AttachmentMetadata
    onOpen?: () => void
    onDownload?: () => void
    openLabel?: string
    downloadLabel?: string
}) {
    const { attachment, onOpen, onDownload, openLabel, downloadLabel } = props
    return (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--app-bg)] px-3 py-2">
            <FileIcon fileName={attachment.filename} size={24} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-base font-medium text-[var(--app-fg)]">
                    {attachment.filename}
                </div>
                <div className="text-xs text-[var(--app-hint)]">
                    {formatFileSize(attachment.size)}
                </div>
            </div>
            {onOpen ? (
                <button
                    type="button"
                    onClick={onOpen}
                    className="rounded border border-[var(--app-border)] px-2 py-1 text-[10px] font-semibold text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                >
                    {openLabel}
                </button>
            ) : null}
            {onDownload ? (
                <button
                    type="button"
                    onClick={onDownload}
                    className="rounded border border-[var(--app-border)] px-2 py-1 text-[10px] font-semibold text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                >
                    {downloadLabel}
                </button>
            ) : null}
        </div>
    )
}

export function MessageAttachments(props: { attachments: AttachmentMetadata[]; enableActions?: boolean }) {
    const { attachments, enableActions = false } = props
    const { api, sessionId, onOpenImagePreview } = useHappyChatContext()
    const { addToast } = useToast()
    const { t } = useTranslation()
    const [filePreviewAttachment, setFilePreviewAttachment] = useState<AttachmentMetadata | null>(null)
    const [pendingLargeFile, setPendingLargeFile] = useState<AttachmentMetadata | null>(null)
    const [filePreviewState, setFilePreviewState] = useState<{
        status: 'idle' | 'loading' | 'ready' | 'error'
        content: string
        error?: string
        truncated: boolean
        binary: boolean
    }>({
        status: 'idle',
        content: '',
        truncated: false,
        binary: false
    })
    if (!attachments || attachments.length === 0) return null

    const images = attachments.filter(a => isImageMimeType(a.mimeType) && a.previewUrl)
    const files = attachments.filter(a => !isImageMimeType(a.mimeType) || !a.previewUrl)
    const openLabel = t('misc.openFile')
    const downloadLabel = t('misc.download')

    const handleOpen = useCallback((attachment: AttachmentMetadata) => {
        if (isTextMimeType(attachment.mimeType) && attachment.size > MAX_TEXT_PREVIEW_BYTES) {
            setPendingLargeFile(attachment)
            return
        }
        setFilePreviewAttachment(attachment)
    }, [])

    const handleImageOpen = useCallback((attachment: AttachmentMetadata) => {
        if (onOpenImagePreview) {
            onOpenImagePreview(attachment.id)
        }
    }, [onOpenImagePreview])

    const handleDownload = useCallback(async (attachment: AttachmentMetadata) => {
        if (!enableActions) return
        try {
            const result = await api.readSessionFile(sessionId, attachment.path)
            if (!result.success || !result.content) {
                throw new Error(result.error ?? 'Failed to read file')
            }
            const blob = base64ToBlob(result.content, attachment.mimeType)
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = attachment.filename || 'download'
            link.click()
            URL.revokeObjectURL(url)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            addToast({
                title: t('misc.downloadFailed'),
                body: message,
                sessionId,
                url: ''
            })
        }
    }, [enableActions, api, sessionId, addToast, t])

    const filePreviewPath = filePreviewAttachment?.path ?? ''
    const filePreviewName = filePreviewAttachment?.filename ?? ''
    const previewLanguage = useMemo(
        () => resolveLanguage(filePreviewPath || filePreviewName),
        [filePreviewPath, filePreviewName]
    )
    const highlighted = useShikiHighlighter(
        filePreviewState.status === 'ready' && !filePreviewState.binary ? filePreviewState.content : '',
        previewLanguage
    )

    useEffect(() => {
        let cancelled = false
        if (!filePreviewAttachment) {
            setFilePreviewState({
                status: 'idle',
                content: '',
                truncated: false,
                binary: false
            })
            return () => {
                cancelled = true
            }
        }

        const path = filePreviewAttachment.path
        if (!path) {
            setFilePreviewState({
                status: 'error',
                content: '',
                error: t('misc.openFileError'),
                truncated: false,
                binary: false
            })
            return () => {
                cancelled = true
            }
        }

        const textLike = isTextMimeType(filePreviewAttachment.mimeType)
        if (!textLike) {
            setFilePreviewState({
                status: 'ready',
                content: '',
                truncated: false,
                binary: true
            })
            return () => {
                cancelled = true
            }
        }

        setFilePreviewState({
            status: 'loading',
            content: '',
            truncated: false,
            binary: false
        })

        void (async () => {
            try {
                const result = await api.readSessionFile(sessionId, path)
                if (cancelled) return
                if (!result.success || !result.content) {
                    throw new Error(result.error ?? 'Failed to read file')
                }
                const limited = limitBase64ForBytes(result.content, MAX_TEXT_PREVIEW_BYTES)
                const decoded = decodeBase64(limited.value)
                if (!decoded.ok) {
                    setFilePreviewState({
                        status: 'ready',
                        content: '',
                        truncated: limited.truncated,
                        binary: true
                    })
                    return
                }
                const text = decoded.text
                setFilePreviewState({
                    status: 'ready',
                    content: text,
                    truncated: limited.truncated,
                    binary: false
                })
            } catch (error) {
                if (cancelled) return
                const message = error instanceof Error ? error.message : String(error)
                setFilePreviewState({
                    status: 'error',
                    content: '',
                    error: message,
                    truncated: false,
                    binary: false
                })
            }
        })()

        return () => {
            cancelled = true
        }
    }, [filePreviewAttachment, api, sessionId, t])

    return (
        <div className="mt-2 flex flex-col gap-2">
            {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {images.map(attachment => (
                        <ImageAttachment
                            key={attachment.id}
                            attachment={attachment}
                            onOpen={() => handleImageOpen(attachment)}
                            onDownload={enableActions ? () => handleDownload(attachment) : undefined}
                            downloadLabel={downloadLabel}
                        />
                    ))}
                </div>
            )}
            {files.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    {files.map(attachment => (
                        <FileAttachment
                            key={attachment.id}
                            attachment={attachment}
                            onOpen={() => handleOpen(attachment)}
                            onDownload={enableActions ? () => handleDownload(attachment) : undefined}
                            openLabel={openLabel}
                            downloadLabel={downloadLabel}
                        />
                    ))}
                </div>
            )}

            <Dialog
                open={filePreviewAttachment !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setFilePreviewAttachment(null)
                    }
                }}
            >
                <DialogContent className="max-w-4xl w-[calc(100vw-24px)] p-0 overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-[var(--app-divider)] px-3 py-2 bg-[var(--app-secondary-bg)]">
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-[var(--app-fg)]">
                                {filePreviewName || t('misc.openFile')}
                            </div>
                            <div className="truncate text-xs text-[var(--app-hint)]">
                                {filePreviewPath || ''}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFilePreviewAttachment(null)}
                            className="rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                            aria-label="Close"
                        >
                            <CloseIcon className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="max-h-[70vh] overflow-auto p-4">
                        {filePreviewState.status === 'loading' ? (
                            <div className="flex items-center justify-center py-10">
                                <Spinner />
                            </div>
                        ) : filePreviewState.status === 'error' ? (
                            <div className="text-sm text-[var(--app-hint)]">
                                {filePreviewState.error ?? t('misc.openFileError')}
                            </div>
                        ) : filePreviewState.binary ? (
                            <div className="text-sm text-[var(--app-hint)]">
                                {t('misc.binaryFile')}
                            </div>
                        ) : filePreviewState.status === 'ready' ? (
                            <>
                                {filePreviewState.truncated ? (
                                    <div className="mb-2 text-xs text-[var(--app-hint)]">
                                        {t('misc.previewTruncated')}
                                    </div>
                                ) : null}
                                {filePreviewState.content ? (
                                    <pre className="shiki overflow-auto rounded-md bg-[var(--app-code-bg)] p-3 text-xs font-mono">
                                        <code>{highlighted ?? filePreviewState.content}</code>
                                    </pre>
                                ) : (
                                    <div className="text-sm text-[var(--app-hint)]">
                                        {t('misc.emptyFile')}
                                    </div>
                                )}
                            </>
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog
                open={pendingLargeFile !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingLargeFile(null)
                    }
                }}
            >
                <DialogContent className="max-w-sm">
                    <div className="text-base font-semibold">{t('misc.previewLargeFileTitle')}</div>
                    <div className="mt-2 text-sm text-[var(--app-hint)]">
                        {t('misc.previewLargeFileBody')}
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setPendingLargeFile(null)}
                        >
                            {t('button.cancel')}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                                if (pendingLargeFile) {
                                    setFilePreviewAttachment(pendingLargeFile)
                                }
                                setPendingLargeFile(null)
                            }}
                        >
                            {t('misc.previewLargeFileConfirm')}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
