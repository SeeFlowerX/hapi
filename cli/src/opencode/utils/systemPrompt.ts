/**
 * OpenCode-specific system prompt for change_title tool.
 *
 * OpenCode exposes MCP tools with the naming pattern: <server-name>_<tool-name>
 * The hapi MCP server exposes `change_title`, so it's called as `hapi_change_title`.
 */

import { trimIdent } from '@/utils/trimIdent';

/**
 * Title instruction for OpenCode to call the hapi MCP tool.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    ALWAYS when you start a new chat - you must call the tool "hapi_change_title" to set a chat title. When you think chat title is not relevant anymore - call the tool again to change it. When chat name is too generic and you have a chance to make it more specific - call the tool again to change it. This title is needed to easily find the chat in the future. Help human.
`);

export const SHARE_FILES_INSTRUCTION = trimIdent(`
    When the user asks you to send, share, or return a file or image, call the tool "hapi_share_files" with the file paths. Put any user-visible confirmation in the tool's message field. After calling the tool, do not send another assistant message repeating the same confirmation unless you must add extra info or report an error.
`);

/**
 * The system prompt to inject for OpenCode sessions.
 */
export const opencodeSystemPrompt = `${TITLE_INSTRUCTION}\n\n${SHARE_FILES_INSTRUCTION}`;
