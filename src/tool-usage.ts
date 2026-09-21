// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { OPERATIONS, DISCOVERY_SCHEMA_VERSION } from "./tool-spec.js";
const names = new Set([...OPERATIONS.map(op => op.name), "tool_search", "tool_call", "unknown"]);
const outcomes = ["attempt", "ok", "invalid_arguments", "refused", "unknown_operation", "no_match", "internal_error", "unconfirmed_result"] as const;
export interface ToolUsage {
  callId: string;
  schemaVersion: number;
  operation: string;
  route: "direct" | "wrapped" | "search";
  outcome: typeof outcomes[number];
  durationMs: number;
}
export function parseToolUsage(input: Record<string, unknown>): ToolUsage | undefined {
  if (typeof input.callId !== "string" || !/^[a-f0-9-]{36}$/.test(input.callId) || input.schemaVersion !== DISCOVERY_SCHEMA_VERSION ||
      typeof input.operation !== "string" || !names.has(input.operation) ||
      !["direct", "wrapped", "search"].includes(String(input.route)) || !outcomes.includes(input.outcome as ToolUsage["outcome"]) ||
      typeof input.durationMs !== "number" || !Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 86_400_000) return undefined;
  return { callId: input.callId, schemaVersion: DISCOVERY_SCHEMA_VERSION, operation: input.operation,
    route: input.route as ToolUsage["route"], outcome: input.outcome as ToolUsage["outcome"], durationMs: Math.round(input.durationMs) };
}
