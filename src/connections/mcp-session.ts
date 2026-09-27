// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export const PROTOCOL_VERSION = "2025-11-25";
const KNOWN_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26"]);

export class McpError extends Error {
  constructor(message: string, readonly kind: "protocol" | "server" | "unreachable") { super(message); }
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
}

export interface ToolResult {
  content: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface JsonRpcResponse { jsonrpc: "2.0"; id: number | string; result?: unknown; error?: { code: number; message: string; data?: unknown } }

export function parseMessage(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function declined(request: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "viberoom does not serve this request" } };
}

export abstract class McpSession {
  private initialized: Promise<void> | null = null;
  protected protocolVersion = PROTOCOL_VERSION;

  constructor(protected readonly clientVersion: string) {}

  serverInfo: { name?: string; version?: string } = {};

  protected abstract request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  protected abstract notify(method: string): Promise<void>;
  abstract close(): Promise<void>;

  protected forget(): void {
    this.initialized = null;
  }

  ready(): Promise<void> {
    this.initialized ??= (async () => {
      const result = await this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "viberoom", version: this.clientVersion },
      }, 30_000) as { protocolVersion?: unknown; serverInfo?: { name?: unknown; version?: unknown } } | undefined;
      const version = typeof result?.protocolVersion === "string" ? result.protocolVersion : "";
      if (!KNOWN_VERSIONS.has(version)) throw new McpError(`the server speaks MCP ${version || "of no named revision"}, which viberoom does not`, "protocol");
      this.protocolVersion = version;
      this.serverInfo = { name: typeof result?.serverInfo?.name === "string" ? result.serverInfo.name : undefined, version: typeof result?.serverInfo?.version === "string" ? result.serverInfo.version : undefined };
      await this.notify("notifications/initialized");
    })().catch((error) => { this.initialized = null; throw error; });
    return this.initialized;
  }

  async listTools(): Promise<McpTool[]> {
    await this.ready();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const result = await this.request("tools/list", cursor ? { cursor } : {}, 30_000) as { tools?: unknown; nextCursor?: unknown } | undefined;
      for (const tool of Array.isArray(result?.tools) ? result.tools : []) {
        if (tool && typeof tool === "object" && typeof (tool as McpTool).name === "string" && (tool as McpTool).inputSchema && typeof (tool as McpTool).inputSchema === "object") tools.push(tool as McpTool);
      }
      cursor = typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) return tools;
    }
    throw new McpError("the server's tool list does not end", "protocol");
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 120_000): Promise<ToolResult> {
    await this.ready();
    const result = await this.request("tools/call", { name, arguments: args }, timeoutMs) as ToolResult | undefined;
    if (!result || !Array.isArray(result.content)) throw new McpError("the server's answer to the call has no content", "protocol");
    return result;
  }
}
