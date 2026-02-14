import type { AttachmentMetadata } from '@/types/api'
import { MessageAttachments } from '@/components/AssistantChat/messages/MessageAttachments'
import { parseAttachmentPart } from '@/lib/attachmentParts'

type FilePartProps = {
    data?: string
    mimeType?: string
    filename?: string
}

function getAttachmentsFromPart(part: FilePartProps): AttachmentMetadata[] | null {
    return parseAttachmentPart(part)
}

export function AttachmentFilePart(props: FilePartProps & { enableActions?: boolean }) {
    const attachments = getAttachmentsFromPart(props)
    if (!attachments || attachments.length === 0) {
        return null
    }
    return (
        <div className="mt-2">
            <MessageAttachments attachments={attachments} enableActions={props.enableActions} />
        </div>
    )
}
