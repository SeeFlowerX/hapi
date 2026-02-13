import type { AttachmentMetadata } from '@/types/api'
import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FileIcon } from '@/components/FileIcon'
import { isImageMimeType } from '@/lib/fileAttachments'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { encodeBase64 } from '@/lib/utils'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

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

function ImageAttachment(props: { attachment: AttachmentMetadata; onDownload?: () => void; downloadLabel?: string }) {
    const { attachment, onDownload, downloadLabel } = props
    return (
        <div className="relative overflow-hidden rounded-lg">
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
    const { api, sessionId } = useHappyChatContext()
    const { addToast } = useToast()
    const { t } = useTranslation()
    const navigate = useNavigate()
    if (!attachments || attachments.length === 0) return null

    const images = attachments.filter(a => isImageMimeType(a.mimeType) && a.previewUrl)
    const files = attachments.filter(a => !isImageMimeType(a.mimeType) || !a.previewUrl)
    const openLabel = t('misc.openFile')
    const downloadLabel = t('misc.download')

    const handleOpen = useCallback((attachment: AttachmentMetadata) => {
        if (!enableActions) return
        if (!attachment.path) return
        navigate({
            to: '/sessions/$sessionId/file',
            params: { sessionId },
            search: { path: encodeBase64(attachment.path) }
        })
    }, [enableActions, navigate, sessionId])

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

    return (
        <div className="mt-2 flex flex-col gap-2">
            {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {images.map(attachment => (
                        <ImageAttachment
                            key={attachment.id}
                            attachment={attachment}
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
                            onOpen={enableActions ? () => handleOpen(attachment) : undefined}
                            onDownload={enableActions ? () => handleDownload(attachment) : undefined}
                            openLabel={openLabel}
                            downloadLabel={downloadLabel}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
