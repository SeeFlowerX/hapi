/**
 * Codex-specific system prompt for local mode.
 *
 * This prompt instructs Codex to call the hapi__change_title function
 * to set appropriate chat session titles.
 */

import { trimIdent } from '@/utils/trimIdent';

/**
 * Title instruction for Codex to call the hapi MCP tool.
 * Note: Codex exposes MCP tools under the `functions.` namespace,
 * so the tool is called as `functions.hapi__change_title`.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    Prefer thinking in Chinese unless the user requests another language.
    ALWAYS when you start a new chat, call the title tool to set a concise task title.
    Prefer calling functions.hapi__change_title.
    If that exact tool name is unavailable, call an equivalent alias such as hapi__change_title, mcp__hapi__change_title, or hapi_change_title.
    If the task focus changes significantly later, call the title tool again with a better title.
`);

export const SHARE_FILES_INSTRUCTION = trimIdent(`
    When the user asks you to send, share, or return a file or image, call functions.hapi__share_files with the file paths. Put any user-visible confirmation in the tool's message field. After calling the tool, do not send another assistant message repeating the same confirmation unless you must add extra info or report an error.
`);

export const REMINDER_INSTRUCTION = trimIdent(`
    When periodic progress reporting is needed, call functions.hapi__start_reminder. Treat this as a periodic reminder mechanism.
    Default interval is 10s; default timeout is interval*20 capped at 30min, but you can extend via functions.hapi__extend_reminder.
    Stop when done via functions.hapi__stop_reminder.
    When you receive a message starting with [HAPI_REMINDER ...], treat it as an internal instruction and do not expose the prefix.
    If a reminder tick arrives and you cannot complete the requested action (missing data, permissions, or it is infeasible), explain the reason and immediately call functions.hapi__stop_reminder to avoid useless repeats. When the task is completed or no longer needed, also stop the reminder.
    For complex or long-running tasks (multi-step builds, long downloads, or prolonged waiting), proactively suggest and start the reminder timer unless the user declines.
`);

/**
 * The system prompt to inject via developer_instructions in local mode.
 */
export const codexSystemPrompt = `${TITLE_INSTRUCTION}\n\n${SHARE_FILES_INSTRUCTION}\n\n${REMINDER_INSTRUCTION}`;
