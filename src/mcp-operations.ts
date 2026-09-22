// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { parseReadMessageArgs } from "./message-read.js";
import { parseMessageCheckArgs } from "./message-check.js";
import { parseAgentSearchArgs } from "./agent-history.js";
import { TOOL_NAME } from "./tool-spec.js";
export interface McpResult { content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> }
export type HubRequest = (path: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; body: Record<string, unknown> }>;
export class OperationArgumentError extends Error {}
export class OperationUnconfirmedError extends Error {}
export function jsonResult(value: unknown, isError = false): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}
export async function executeOperation(name: string, args: Record<string, unknown>, TOKEN: string, hub: HubRequest): Promise<McpResult> {
  const errorResult = (fallback: string, res: { status: number; body: Record<string, unknown> }): McpResult => {
    if (res.status === 0 || res.body.code === "unconfirmed_result") throw new OperationUnconfirmedError();
    return { content: [{ type: "text", text: typeof res.body.error === "string" ? res.body.error : fallback }], isError: true };
  };
  if (name === TOOL_NAME) {
    const skill = typeof args.name === "string" ? args.name.trim() : "";
    const res = await hub(`/api/mcp/skill?token=${encodeURIComponent(TOKEN)}&name=${encodeURIComponent(skill)}`);
    if (!res.ok) return errorResult(`skill "${skill}" could not be loaded`, res);
    return { content: [{ type: "text", text: String(res.body.text ?? "") }] };
  }
  if (name === "list_automations" || name === "propose_automation") {
    const res = name === "list_automations"
      ? await hub(`/api/mcp/automations?token=${encodeURIComponent(TOKEN)}`)
      : await hub("/api/mcp/automations/propose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...args, token: TOKEN }) });
    if (!res.ok) return errorResult("The automations request could not be confirmed.", res);
    return jsonResult(res.body);
  }
  if (name === "create_skill" || name === "update_skill") {
    const res = await hub("/api/mcp/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...args, token: TOKEN, op: name === "update_skill" ? "update" : "create" }),
    });
    if (!res.ok) return errorResult("the skill could not be saved", res);
    return { content: [{ type: "text", text: String(res.body.message ?? "saved") }] };
  }
  if (name === "attach_skill") {
    const res = await hub("/api/mcp/attach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN, name: args.name, to: args.to ?? "me" }),
    });
    if (!res.ok) return errorResult("the skill could not be attached", res);
    return { content: [{ type: "text", text: String(res.body.message ?? "attached") }] };
  }
  if (name === "memory") {
    const res = await hub("/api/mcp/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...args, token: TOKEN }) });
    if (!res.ok) return errorResult("memory could not be maintained", res);
    return { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] };
  }
  if (name === "describe_room") {
    const res = await hub(`/api/mcp/room?token=${encodeURIComponent(TOKEN)}`);
    if (!res.ok) return errorResult("the room could not be described", res);
    return { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] };
  }
  if (name === "lint_room_design") {
    const res = await hub("/api/mcp/design/lint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...args, token: TOKEN }),
    });
    if (!res.ok) return errorResult("the design could not be checked", res);
    return { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }], isError: res.body.ok === false ? true : undefined };
  }
  if (name === "create_template") {
    const res = await hub("/api/mcp/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...args, token: TOKEN }),
    });
    if (!res.ok) return errorResult("the template could not be saved", res);
    return { content: [{ type: "text", text: String(res.body.message ?? "saved") }] };
  }
  if (name === "propose_room_changes") {
    const res = await hub("/api/mcp/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...args, token: TOKEN }),
    });
    if (!res.ok) return errorResult("the proposal could not be made", res);
    return { content: [{ type: "text", text: String(res.body.message ?? "proposed") }] };
  }
  if (name === "propose_new_room") {
    const res = await hub("/api/mcp/new-room", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...args, token: TOKEN }),
    });
    if (!res.ok) return errorResult("the room could not be proposed", res);
    return { content: [{ type: "text", text: String(res.body.message ?? "proposed") }] };
  }
  if (name === "ask_for_bot_token") {
    const res = await hub("/api/mcp/ask-bot-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
    if (!res.ok) return errorResult("the key card could not be opened", res);
    return { content: [{ type: "text", text: String(res.body.message ?? "asked") }] };
  }
  if (name === "show_pairing_link") {
    const res = await hub("/api/mcp/show-pairing-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
    if (!res.ok) return errorResult("the pairing card could not be opened", res);
    return { content: [{ type: "text", text: String(res.body.message ?? "shown") }] };
  }
  if (name === "describe_looks") {
    const res = await hub(`/api/mcp/looks?token=${encodeURIComponent(TOKEN)}`);
    if (!res.ok) return errorResult("the looks could not be described", res);
    return { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] };
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
      return { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }], isError: res.body.ok === false ? true : undefined };
    }
    return { content: [{ type: "text", text: String(res.body.message ?? "saved") }] };
  }
  if (name === "propose_look_changes") {
    const res = await hub("/api/mcp/looks/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...args, token: TOKEN }),
    });
    if (!res.ok) return errorResult("the proposal could not be made", res);
    return { content: [{ type: "text", text: String(res.body.message ?? "proposed") }] };
  }
  if (name === "search_history") {
    let parsed: ReturnType<typeof parseAgentSearchArgs>;
    try { parsed = parseAgentSearchArgs(args); }
    catch { throw new OperationArgumentError(); }
    const query = new URLSearchParams({ token: TOKEN, q: parsed.query, rooms: parsed.rooms, kinds: parsed.kinds, limit: String(parsed.limit) });
    if (parsed.author !== undefined) query.set("author", parsed.author);
    const res = await hub(`/api/mcp/search?${query}`);
    if (!res.ok) return errorResult("the history could not be searched", res);
    return { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] };
  }
  if (name === "check_room") {
    let parsed: ReturnType<typeof parseMessageCheckArgs>;
    try { parsed = parseMessageCheckArgs(args); }
    catch { throw new OperationArgumentError(); }
    const query = new URLSearchParams({ token: TOKEN, mode: parsed.mode, limit: String(parsed.limit) });
    if (parsed.after !== undefined) query.set("after", parsed.after);
    if (parsed.page !== undefined) query.set("page", parsed.page);
    if (parsed.draft !== undefined) query.set("draft", JSON.stringify(parsed.draft));
    const res = await hub(`/api/mcp/check-messages?${query}`);
    if (!res.ok) return errorResult("messages could not be checked", res);
    return { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] };
  }
  if (name === "read_message") {
    let parsed: ReturnType<typeof parseReadMessageArgs>;
    try { parsed = parseReadMessageArgs(args); }
    catch { throw new OperationArgumentError(); }
    const query = new URLSearchParams({ token: TOKEN, seq: String(parsed.seq) });
    if (parsed.around > 0) query.set("around", String(parsed.around));
    if (parsed.room !== undefined) query.set("room", parsed.room);
    const res = await hub(`/api/mcp/message?${query}`);
    if (!res.ok) return errorResult("the message could not be read", res);
    return { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] };
  }
  throw new Error("Unimplemented registered operation");
}
