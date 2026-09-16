// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
const PREFIXES = ["mcp__viberoom__", "viberoom.", "viberoom/", "viberoom:", "viberoom_", "mcp::viberoom::"];

export function isDirectRoomTool(name: string | null | undefined, tool: string): boolean {
  return typeof name === "string" && PREFIXES.some(prefix => name === prefix + tool);
}

export type ToolIdentity = { name?: string | null; title?: string | null; rawInput?: unknown };

export function canAutoApproveRoomTool(
  call: ToolIdentity, known: ToolIdentity | undefined, tool: string,
  validInput: (input: Record<string, unknown>) => boolean,
): boolean {
  const name = call.name ?? known?.name;
  if (name !== undefined && name !== null) return isDirectRoomTool(name, tool);
  if (!isDirectRoomTool(call.title ?? known?.title, tool)) return false;
  const input = call.rawInput !== undefined ? call.rawInput : known?.rawInput;
  return !!input && typeof input === "object" && !Array.isArray(input) && validInput(input as Record<string, unknown>);
}
