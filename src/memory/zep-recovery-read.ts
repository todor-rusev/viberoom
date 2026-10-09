// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { ZepClient, type Zep } from "@getzep/zep-cloud";
import { zepPageCursorMissing } from "./zep-pagination.js";

export interface RecoveryReadLimits { timeoutMs: number; maxPages: number; pageSize: number; maxBytes?: number }
export const RECOVERY_INVENTORY_LIMITS: Readonly<RecoveryReadLimits> = Object.freeze({ timeoutMs: 60_000, maxPages: 100, pageSize: 100, maxBytes: 16 * 1024 * 1024 });
export function recoveryReadSession(signal: AbortSignal, limits: RecoveryReadLimits) {
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid recovery inventory limit");
  if (limits.pageSize > 100) throw new Error("Recovery inventory page limit exceeds the adapter limit");
  const abort = AbortSignal.any([signal, AbortSignal.timeout(limits.timeoutMs)]);
  return { abort, options: { maxRetries: 0, timeoutInSeconds: Math.min(20, limits.timeoutMs / 1000), abortSignal: abort },
    bytes: 0, maxBytes: limits.maxBytes ?? RECOVERY_INVENTORY_LIMITS.maxBytes! };
}

export async function readRecoveryPages(client: ZepClient, graphId: string, kind: "episode" | "edge" | "node",
  limits: RecoveryReadLimits, session: ReturnType<typeof recoveryReadSession>): Promise<Array<Zep.Episode | Zep.EntityEdge | Zep.EntityNode>> {
  const ids = new Set<string>(), cursors = new Set<string>(), items: Array<Zep.Episode | Zep.EntityEdge | Zep.EntityNode> = [];
  let cursor: string | undefined;
  for (let page = 0; page < limits.maxPages; page++) {
    session.abort.throwIfAborted();
    const request = { orderBy: "uuid", direction: "asc", ...(cursor ? { cursor } : {}) };
    const response = await (kind === "episode" ? client.graph.episode.listByGraphId(graphId, request, session.options)
      : kind === "edge" ? client.graph.edge.getByGraphId(graphId, { ...request, limit: limits.pageSize }, session.options)
        : client.graph.node.getByGraphId(graphId, { ...request, limit: limits.pageSize }, session.options)).withRawResponse();
    session.abort.throwIfAborted();
    const fail = (reason: string): never => { throw new Error(`${kind}_listing_${reason}`); };
    const truncated = response.rawResponse.headers.get("zep-truncated");
    if (truncated && !["false", "0"].includes(truncated.toLowerCase())) fail("truncated");
    if (!Array.isArray(response.data) || response.data.length > limits.pageSize) fail("invalid");
    session.bytes += Buffer.byteLength(JSON.stringify(response.data));
    if (session.bytes > session.maxBytes) fail("size_limit");
    for (const item of response.data) {
      if (!item || typeof item.uuid !== "string" || !item.uuid || ids.has(item.uuid)) fail("unstable");
      ids.add(item.uuid); items.push(item);
    }
    const next = response.rawResponse.headers.get("zep-next-cursor");
    if (zepPageCursorMissing(response.data.length, limits.pageSize, next)) fail("cursor_missing");
    if (!next) return items;
    if (cursors.has(next)) fail("cursor_loop");
    cursors.add(next); cursor = next;
  }
  throw new Error(`${kind}_listing_page_limit`);
}
