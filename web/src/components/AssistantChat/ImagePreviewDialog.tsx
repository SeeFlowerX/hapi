import { useCallback, useMemo } from 'react'
import type { AttachmentMetadata } from '@/types/api'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { CloseIcon } from '@/components/icons'

function ChevronLeftIcon(props: { className?: string }) {
    return (
        <svg
            className={props.className ?? 'h-5 w-5'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function ChevronRightIcon(props: { className?: string }) {
    return (
        <svg
            className={props.className ?? 'h-5 w-5'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

export function ImagePreviewDialog(props: {
    images: AttachmentMetadata[]
    activeId: string | null
    onClose: () => void
    onSelectId: (id: string) => void
}) {
    const hasImages = props.images.length > 0
    const indexById = useMemo(() => {
        const map = new Map<string, number>()
        props.images.forEach((attachment, index) => {
            map.set(attachment.id, index)
        })
        return map
    }, [props.images])
    const activeIndex = props.activeId ? indexById.get(props.activeId) : undefined
    const currentIndex = activeIndex ?? 0
    const open = props.activeId !== null && hasImages && activeIndex !== undefined
    const image = useMemo(() => {
        if (!hasImages) return null
        const safeIndex = Math.min(Math.max(currentIndex, 0), props.images.length - 1)
        return props.images[safeIndex] ?? null
    }, [hasImages, currentIndex, props.images])

    const handlePrev = useCallback(() => {
        if (!hasImages) return
        const nextIndex = (currentIndex - 1 + props.images.length) % props.images.length
        const nextImage = props.images[nextIndex]
        if (nextImage) {
            props.onSelectId(nextImage.id)
        }
    }, [hasImages, currentIndex, props.images, props.onSelectId])

    const handleNext = useCallback(() => {
        if (!hasImages) return
        const nextIndex = (currentIndex + 1) % props.images.length
        const nextImage = props.images[nextIndex]
        if (nextImage) {
            props.onSelectId(nextImage.id)
        }
    }, [hasImages, currentIndex, props.images, props.onSelectId])

    const handleOpenChange = useCallback((nextOpen: boolean) => {
        if (!nextOpen) {
            props.onClose()
        }
    }, [props.onClose])

    if (!hasImages) {
        return null
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-5xl w-[calc(100vw-24px)] p-0 overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[var(--app-divider)] px-3 py-2 bg-[var(--app-secondary-bg)]">
                    <div className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--app-fg)]">
                        {image?.filename ?? 'Image'}
                    </div>
                    <div className="text-xs text-[var(--app-hint)]">
                        {currentIndex + 1}/{props.images.length}
                    </div>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        aria-label="Close"
                    >
                        <CloseIcon className="h-4 w-4" />
                    </button>
                </div>
                <div className="relative flex items-center justify-center bg-black/90 p-3">
                    {image?.previewUrl ? (
                        <img
                            src={image.previewUrl}
                            alt={image.filename}
                            className="max-h-[75vh] max-w-full object-contain"
                        />
                    ) : (
                        <div className="text-sm text-[var(--app-hint)]">Image preview unavailable.</div>
                    )}
                    {props.images.length > 1 ? (
                        <>
                            <button
                                type="button"
                                onClick={handlePrev}
                                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
                                aria-label="Previous image"
                            >
                                <ChevronLeftIcon />
                            </button>
                            <button
                                type="button"
                                onClick={handleNext}
                                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
                                aria-label="Next image"
                            >
                                <ChevronRightIcon />
                            </button>
                        </>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    )
}
