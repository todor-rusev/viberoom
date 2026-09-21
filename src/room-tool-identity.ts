// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { canonicalOperationName } from "./tool-spec.js";
import { validArguments } from "./tool-validation.js";
const PREFIXES = ["mcp__viberoom__", "viberoom.", "viberoom/", "viberoom: ", "viberoom:", "viberoom_", "mcp::viberoom::"];

function localRoomTool(name: string | null | undefined): string | undefined {
  if (typeof name !== "string") return undefined;
  const prefix = PREFIXES.find(prefix => name.startsWith(prefix));
  if (prefix) return name.slice(prefix.length);
  return /^viberoom-([a-z][a-z0-9_]*): \1$/.exec(name)?.[1]
    ?? /^([a-z][a-z0-9_]*) \(viberoom MCP Server\)$/.exec(name)?.[1];
}
export function isDirectRoomTool(name: string | null | undefined, tool: string): boolean {
  return localRoomTool(name) === tool;
}

export type ToolIdentity = { name?: string | null; title?: string | null; rawInput?: unknown };

export function roomOperation(call: ToolIdentity, known?: ToolIdentity): { name: string; arguments: Record<string, unknown>; wrapped: boolean } | undefined {
  const name = call.name ?? known?.name ?? call.title ?? known?.title;
  const local = localRoomTool(name);
  if (!local) return undefined;
  const input = call.rawInput !== undefined ? call.rawInput : known?.rawInput;
  if (local === "tool_call") {
    if (!validArguments("tool_call", input)) return undefined;
    const canonical = canonicalOperationName(input.name as string);
    if (!canonical) return undefined;
    return { name: canonical, arguments: input.arguments as Record<string, unknown>, wrapped: true };
  }
  const canonical = canonicalOperationName(local) ?? (local === "tool_search" ? local : undefined);
  if (!canonical || !input || typeof input !== "object" || Array.isArray(input)) return undefined;
  return { name: canonical, arguments: input as Record<string, unknown>, wrapped: false };
}

export function isWrappedRoomCall(call: ToolIdentity, known?: ToolIdentity): boolean {
  return isDirectRoomTool(call.name ?? known?.name ?? call.title ?? known?.title, "tool_call");
}

export function roomToolTitle(call: ToolIdentity, known?: ToolIdentity): string | undefined {
  const operation = roomOperation(call, known);
  return operation?.wrapped ? `${operation.name} (via tool_call)` : undefined;
}

export function canAutoApproveRoomTool(
  call: ToolIdentity, known: ToolIdentity | undefined, tool: string,
  validInput: (input: Record<string, unknown>) => boolean,
): boolean {
  const name = call.name ?? known?.name;
  const identity = name ?? call.title ?? known?.title;
  if (isDirectRoomTool(identity, "tool_call")) {
    const operation = roomOperation(call, known);
    return !!operation?.wrapped && operation.name === (canonicalOperationName(tool) ?? tool) && validArguments(operation.name, operation.arguments) && validInput(operation.arguments);
  }
  if (name !== undefined && name !== null) return isDirectRoomTool(name, tool);
  if (!isDirectRoomTool(identity, tool)) return false;
  const input = call.rawInput !== undefined ? call.rawInput : known?.rawInput;
  return !!input && typeof input === "object" && !Array.isArray(input) && validInput(input as Record<string, unknown>);
}

export function cursorPermissionInput<T extends ToolIdentity & { content?: unknown }>(call: T): T {
  if (call.rawInput !== undefined || call.name != null || typeof call.title !== "string") return call;
  const match = /^viberoom-([a-z][a-z0-9_]*): \1$/.exec(call.title);
  if (!match || !Array.isArray(call.content) || call.content.length !== 1) return call;
  const block = call.content[0];
  if (block?.type !== "content" || block.content?.type !== "text" || typeof block.content.text !== "string" || block.content.text.length > 64 * 1024) return call;
  const json = /^```json\r?\n([\s\S]*)\r?\n```$/.exec(block.content.text);
  if (!json) return call;
  try {
    const input: unknown = JSON.parse(json[1]);
    if (!input || typeof input !== "object" || Array.isArray(input)) return call;
    return { ...call, name: `viberoom.${match[1]}`, rawInput: input };
  } catch { return call; }
}
