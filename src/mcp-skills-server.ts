#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { McpHttpClient } from "./mcp-http.js";
import { OLD_TOOL_NAMES, TOOLS, DISCOVERY_INSTRUCTIONS } from "./tool-spec.js";
import { ToolRouter } from "./tool-router.js";

const HUB = (process.env.VIBEROOM_HUB ?? "").replace(/\/+$/, "");
const TOKEN = process.env.VIBEROOM_TOKEN ?? "";
const http = new McpHttpClient(HUB, TOKEN);
const VERSION = "0.3.0";
const router = new ToolRouter(TOKEN, (path, init) => http.request(path, init), reportUsage);

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

let readySent = false;

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: number | string | null | undefined, result: unknown): void {
  send({ jsonrpc: "2.0", id: id ?? null, result });
}

function fail(id: number | string | null | undefined, code: number, message: string): void {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function missed(tool: string, reason: "old-name"): void {
  if (!HUB || !TOKEN) return;
  void fetch(`${HUB}/api/mcp/miss`, {
    method: "POST", headers: { "content-type": "application/json", connection: "close" },
    signal: AbortSignal.timeout(2_000), body: JSON.stringify({ token: TOKEN, tool, reason }),
  }).then(response => response.body?.cancel()).catch(() => undefined);
}

function reportUsage(event: import("./tool-usage.js").ToolUsage): void {
  if (!HUB || !TOKEN) return;
  void fetch(`${HUB}/api/mcp/tool-usage`, {
    method: "POST", headers: { "content-type": "application/json", connection: "close" },
    signal: AbortSignal.timeout(2_000), body: JSON.stringify({ token: TOKEN, ...event }),
  }).then(response => response.body?.cancel()).catch(() => undefined);
}

async function hub(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  return http.request(path, init);
}

function announceReady(): void {
  if (readySent) return;
  readySent = true;
  void hub("/api/mcp/ready", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
}

async function handle(message: JsonRpcMessage): Promise<void> {
  const { id, method, params } = message;
  if (!method) return;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "viberoom", version: VERSION },
        instructions: DISCOVERY_INSTRUCTIONS,
      });
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return;
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS });
      announceReady();
      return;
    case "tools/call": {
      const asked = typeof params?.name === "string" ? params.name : "";
      if (Object.hasOwn(OLD_TOOL_NAMES, asked)) missed(asked, "old-name");
      reply(id, await router.call(asked, params?.arguments ?? {}));
      return;
    }
    default:
      if (id !== undefined) fail(id, -32601, `method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newline: number;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      continue;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) { fail(null, -32600, "Invalid request"); continue; }
    void handle(message).catch(() => fail(message.id, -32603, "Internal tool dispatch error"));
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
