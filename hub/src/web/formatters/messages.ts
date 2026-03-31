import type { DecryptedMessage, SyncEvent } from '@hapi/protocol/types'
import { formatMessageContentForWeb } from '../../utils/formatShellCommand'

export async function formatDecryptedMessageForWeb(message: DecryptedMessage): Promise<DecryptedMessage> {
    const formattedContent = await formatMessageContentForWeb(message.content)
    if (formattedContent === message.content) {
        return message
    }
    return {
        ...message,
        content: formattedContent
    }
}

export async function formatMessagesPageForWeb(page: {
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}): Promise<{
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}> {
    const messages = await Promise.all(page.messages.map((message) => formatDecryptedMessageForWeb(message)))
    return { ...page, messages }
}

export async function formatSyncEventForWeb(event: SyncEvent): Promise<SyncEvent> {
    if (event.type !== 'message-received' || !event.message) {
        return event
    }
    const formatted = await formatDecryptedMessageForWeb(event.message)
    if (formatted === event.message) {
        return event
    }
    return {
        ...event,
        message: formatted
    }
}
