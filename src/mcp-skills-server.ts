#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { parseReadMessageArgs } from "./message-read.js";
import { parseMessageCheckArgs } from "./message-check.js";
import { parseAgentSearchArgs } from "./agent-history.js";
import { McpHttpClient } from "./mcp-http.js";
import { OLD_TOOL_NAMES, TOOLS, TOOL_NAME } from "./tool-spec.js";

const HUB = (process.env.VIBEROOM_HUB ?? "").replace(/\/+$/, "");
const TOKEN = process.env.VIBEROOM_TOKEN ?? "";
const http = new McpHttpClient(HUB, TOKEN);
const VERSION = "0.2.0";

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

const MISS_NOTE_MS = 2_000;

function missed(tool: string, reason: "unknown-tool" | "bad-arguments" | "refused" | "old-name"): void {
  if (!HUB || !TOKEN) return;
  void fetch(`${HUB}/api/mcp/miss`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    signal: AbortSignal.timeout(MISS_NOTE_MS),
    body: JSON.stringify({ token: TOKEN, tool, reason }),
  }).catch(() => undefined);
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
      const name = OLD_TOOL_NAMES[asked] ?? asked;
      if (name !== asked) missed(asked, "old-name");
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const errorResult = (fallback: string, res: { body: Record<string, unknown> }): void => {
        const text = typeof res.body.error === "string" ? res.body.error : fallback;
        missed(name, "refused");
        reply(id, { content: [{ type: "text", text }], isError: true });
      };
      if (name === TOOL_NAME) {
        const skill = typeof args.name === "string" ? args.name.trim() : "";
        const res = await hub(`/api/mcp/skill?token=${encodeURIComponent(TOKEN)}&name=${encodeURIComponent(skill)}`);
        if (!res.ok) return errorResult(`skill "${skill}" could not be loaded`, res);
        reply(id, { content: [{ type: "text", text: String(res.body.text ?? "") }] });
        return;
      }
      if (name === "create_skill" || name === "update_skill") {
        const res = await hub("/api/mcp/skills", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, op: name === "update_skill" ? "update" : "create", ...args }),
        });
        if (!res.ok) return errorResult("the skill could not be saved", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "saved") }] });
        return;
      }
      if (name === "attach_skill") {
        const res = await hub("/api/mcp/attach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, name: args.name, to: args.to ?? "me" }),
        });
        if (!res.ok) return errorResult("the skill could not be attached", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "attached") }] });
        return;
      }
      if (name === "memory") {
        const res = await hub("/api/mcp/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...args, token: TOKEN }) });
        if (!res.ok) return errorResult("memory could not be maintained", res);
        reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] });
        return;
      }
      if (name === "describe_room") {
        const res = await hub(`/api/mcp/room?token=${encodeURIComponent(TOKEN)}`);
        if (!res.ok) return errorResult("the room could not be described", res);
        reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] });
        return;
      }
      if (name === "lint_room_design") {
        const res = await hub("/api/mcp/design/lint", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, ...args }),
        });
        if (!res.ok) return errorResult("the design could not be checked", res);
        reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }], isError: res.body.ok === false ? true : undefined });
        return;
      }
      if (name === "create_template") {
        const res = await hub("/api/mcp/templates", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, ...args }),
        });
        if (!res.ok) return errorResult("the template could not be saved", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "saved") }] });
        return;
      }
      if (name === "propose_room_changes") {
        const res = await hub("/api/mcp/propose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, ...args }),
        });
        if (!res.ok) return errorResult("the proposal could not be made", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "proposed") }] });
        return;
      }
      if (name === "propose_new_room") {
        const res = await hub("/api/mcp/new-room", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, ...args }),
        });
        if (!res.ok) return errorResult("the room could not be proposed", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "proposed") }] });
        return;
      }
      if (name === "ask_for_bot_token") {
        const res = await hub("/api/mcp/ask-bot-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
        if (!res.ok) return errorResult("the key card could not be opened", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "asked") }] });
        return;
      }
      if (name === "show_pairing_link") {
        const res = await hub("/api/mcp/show-pairing-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
        if (!res.ok) return errorResult("the pairing card could not be opened", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "shown") }] });
        return;
      }
      if (name === "describe_looks") {
        const res = await hub(`/api/mcp/looks?token=${encodeURIComponent(TOKEN)}`);
        if (!res.ok) return errorResult("the looks could not be described", res);
        reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] });
        return;
      }
      if (name === "lint_look" || name === "create_look") {
        const { replace, ...spec } = args;
        const res = await hub(name === "lint_look" ? "/api/mcp/looks/lint" : "/api/mcp/looks/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, spec, replace }),
        });
        if (!res.ok) return errorResult(name === "lint_look" ? "the look could not be checked" : "the look could not be saved", res);
        if (name === "lint_look") {
          reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }], isError: res.body.ok === false ? true : undefined });
          return;
        }
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "saved") }] });
        return;
      }
      if (name === "propose_look_changes") {
        const res = await hub("/api/mcp/looks/propose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, ...args }),
        });
        if (!res.ok) return errorResult("the proposal could not be made", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "proposed") }] });
        return;
      }
      if (name === "search_history") {
        let parsed: ReturnType<typeof parseAgentSearchArgs>;
        try { parsed = parseAgentSearchArgs(args); }
        catch (error) { missed(name, "bad-arguments"); return fail(id, -32602, error instanceof Error ? error.message : String(error)); }
        const query = new URLSearchParams({ token: TOKEN, q: parsed.query, rooms: parsed.rooms, kinds: parsed.kinds, limit: String(parsed.limit) });
        if (parsed.author !== undefined) query.set("author", parsed.author);
        const res = await hub(`/api/mcp/search?${query}`);
        if (!res.ok) return errorResult("the history could not be searched", res);
        reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] });
        return;
      }
      if (name === "check_room") {
        let parsed: ReturnType<typeof parseMessageCheckArgs>;
        try { parsed = parseMessageCheckArgs(args); }
        catch (error) { missed(name, "bad-arguments"); return fail(id, -32602, error instanceof Error ? error.message : String(error)); }
        const query = new URLSearchParams({ token: TOKEN, mode: parsed.mode, limit: String(parsed.limit) });
        if (parsed.after !== undefined) query.set("after", parsed.after);
        if (parsed.page !== undefined) query.set("page", parsed.page);
        if (parsed.draft !== undefined) query.set("draft", JSON.stringify(parsed.draft));
        const res = await hub(`/api/mcp/check-messages?${query}`);
        if (!res.ok) return errorResult("messages could not be checked", res);
        reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] });
        return;
      }
      if (name === "read_message") {
        let parsed: ReturnType<typeof parseReadMessageArgs>;
        try { parsed = parseReadMessageArgs(args); }
        catch (error) { missed(name, "bad-arguments"); return fail(id, -32602, error instanceof Error ? error.message : String(error)); }
        const query = new URLSearchParams({ token: TOKEN, seq: String(parsed.seq) });
        if (parsed.around > 0) query.set("around", String(parsed.around));
        if (parsed.room !== undefined) query.set("room", parsed.room);
        const res = await hub(`/api/mcp/message?${query}`);
        if (!res.ok) return errorResult("the message could not be read", res);
        reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] });
        return;
      }
      missed(name, "unknown-tool");
      fail(id, -32602, `unknown tool: ${name}`);
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
    void handle(message);
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
