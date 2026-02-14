import { isObject } from '@hapi/protocol'
import type { AttachmentMetadata } from '@/types/api'

export const ATTACHMENT_PART_MIME = 'application/hapi-attachments+json'
export const ATTACHMENT_PART_FILENAME = 'attachments.json'

type AttachmentPartPayload = {
    attachments: AttachmentMetadata[]
}

export function createAttachmentPart(attachments: AttachmentMetadata[]) {
    const payload: AttachmentPartPayload = { attachments }
    return {
        type: 'file' as const,
        data: JSON.stringify(payload),
        mimeType: ATTACHMENT_PART_MIME,
        filename: ATTACHMENT_PART_FILENAME
    }
}

export function parseAttachmentPart(part: { data?: string; mimeType?: string }): AttachmentMetadata[] | null {
    if (!part || part.mimeType !== ATTACHMENT_PART_MIME || typeof part.data !== 'string') {
        return null
    }
    try {
        const parsed = JSON.parse(part.data) as unknown
        if (!isObject(parsed) || !Array.isArray((parsed as AttachmentPartPayload).attachments)) {
            return null
        }
        const attachments = (parsed as AttachmentPartPayload).attachments.filter((item) => {
            if (!isObject(item)) return false
            return typeof item.id === 'string'
                && typeof item.filename === 'string'
                && typeof item.mimeType === 'string'
                && typeof item.size === 'number'
                && typeof item.path === 'string'
        }) as AttachmentMetadata[]
        return attachments.length > 0 ? attachments : null
    } catch {
        return null
    }
}
