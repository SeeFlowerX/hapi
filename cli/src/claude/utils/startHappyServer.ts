/**
 * HAPI MCP server
 * Provides HAPI CLI specific tools including chat session title management
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import { basename, extname, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { readFile, stat } from "node:fs/promises";
import { validatePath } from "@/modules/common/pathSecurity";
import type { AttachmentMetadata } from "@hapi/protocol/types";

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".xml": "application/xml",
    ".xhtml": "application/xhtml+xml",
};

function expandHomePath(value: string): string {
    const trimmed = value.trim();
    if (trimmed === "~") {
        return homedir();
    }
    if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
        return resolve(homedir(), trimmed.slice(2));
    }
    return trimmed;
}

function inferMimeType(path: string, explicit?: string | null): string {
    if (explicit && explicit.trim().length > 0) {
        return explicit.trim();
    }
    const ext = extname(path).toLowerCase();
    return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

async function buildAttachment(
    sessionPath: string,
    input: { path: string; filename?: string; mimeType?: string }
): Promise<AttachmentMetadata> {
    const rawPath = expandHomePath(input.path);
    const validation = validatePath(rawPath, sessionPath);
    if (!validation.valid) {
        throw new Error(validation.error ?? "Invalid file path");
    }

    const resolvedPath = resolve(sessionPath, rawPath);
    const stats = await stat(resolvedPath);
    if (!stats.isFile()) {
        throw new Error(`Not a file: ${input.path}`);
    }

    const filename = input.filename?.trim() || basename(resolvedPath);
    const mimeType = inferMimeType(resolvedPath, input.mimeType ?? null);
    const relativePath = relative(sessionPath, resolvedPath) || basename(resolvedPath);
    let previewUrl: string | undefined;

    if (mimeType.startsWith("image/") && stats.size <= MAX_PREVIEW_BYTES) {
        const buffer = await readFile(resolvedPath);
        const base64 = buffer.toString("base64");
        previewUrl = `data:${mimeType};base64,${base64}`;
    }

    return {
        id: randomUUID(),
        filename,
        mimeType,
        size: stats.size,
        path: relativePath,
        previewUrl,
    };
}

export async function startHappyServer(client: ApiSessionClient) {
    // Handler that sends title updates via the client
    const handler = async (title: string) => {
        logger.debug('[hapiMCP] Changing title to:', title);
        try {
            // Send title as a summary message, similar to title generator
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });
            
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    //
    // Create the MCP server
    //

    const mcp = new McpServer({
        name: "HAPI MCP",
        version: "1.0.0",
    });

    // Avoid TS instantiation depth issues by widening the schema type.
    const changeTitleInputSchema: z.ZodTypeAny = z.object({
        title: z.string().describe('The new title for the chat session'),
    });

    const shareFilesInputSchema: z.ZodTypeAny = z.object({
        files: z.array(z.object({
            path: z.string(),
            filename: z.string().optional(),
            mimeType: z.string().optional(),
            title: z.string().optional(),
        })).min(1),
        message: z.string().optional(),
    });

    mcp.registerTool<any, any>('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: changeTitleInputSchema,
    }, async (args: { title: string }) => {
        const response = await handler(args.title);
        logger.debug('[hapiMCP] Response:', response);
        
        if (response.success) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Successfully changed chat title to: "${args.title}"`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool<any, any>('share_files', {
        description: 'Share files or images with the user',
        title: 'Share Files',
        inputSchema: shareFilesInputSchema,
    }, async (args: { files: Array<{ path: string; filename?: string; mimeType?: string; title?: string }>; message?: string }) => {
        try {
            const sessionPath = client.getSessionPath();
            if (!sessionPath) {
                const errorMessage = 'Session path is unavailable.';
                client.sendClaudeSessionMessage({
                    type: 'assistant',
                    uuid: randomUUID(),
                    message: {
                        content: [{
                            type: 'text',
                            text: errorMessage,
                        }],
                    },
                });
                return {
                    content: [{ type: 'text' as const, text: errorMessage }],
                    isError: true,
                };
            }

            const attachments: AttachmentMetadata[] = [];
            for (const file of args.files) {
                const attachment = await buildAttachment(sessionPath, file);
                attachments.push(attachment);
            }

            const messageText = args.message?.trim() ?? '';
            const payload = {
                type: 'assistant' as const,
                uuid: randomUUID(),
                message: {
                    content: [{
                        type: 'text' as const,
                        text: messageText,
                        attachments,
                    }],
                },
            };

            try {
                await client.sendClaudeSessionMessageViaRest(payload);
            } catch (error) {
                logger.debug('[hapiMCP] Failed to send share_files message via REST; falling back to socket', error);
                client.sendClaudeSessionMessage(payload);
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: `Shared ${attachments.length} file(s).`,
                }],
                isError: false,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            client.sendClaudeSessionMessage({
                type: 'assistant',
                uuid: randomUUID(),
                message: {
                    content: [{
                        type: 'text',
                        text: `Failed to share files: ${message}`,
                    }],
                },
            });
            return {
                content: [{
                    type: 'text' as const,
                    text: `Failed to share files: ${message}`,
                }],
                isError: true,
            };
        }
    });

    const transport = new StreamableHTTPServerTransport({
        // NOTE: Returning session id here will result in claude
        // sdk spawn to fail with `Invalid Request: Server already initialized`
        sessionIdGenerator: undefined
    });
    await mcp.connect(transport);

    //
    // Create the HTTP server
    //

    const server = createServer(async (req, res) => {
        try {
            await transport.handleRequest(req, res);
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    return {
        url: baseUrl.toString(),
        toolNames: ['change_title', 'share_files'],
        stop: () => {
            logger.debug('[hapiMCP] Stopping server');
            mcp.close();
            server.close();
        }
    }
}
