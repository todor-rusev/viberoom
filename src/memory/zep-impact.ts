// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { ZepClient, ZepError } from "@getzep/zep-cloud";
import { MemoryProviderError, type MemoryRoom } from "./provider.js";
import type { EpisodeImpact } from "./impact.js";
import { zepRoomGraphId } from "./zep-payload.js";
import { zepPageCursorMissing } from "./zep-pagination.js";

interface ImpactLimits { pageSize: number; maxPages: number; timeoutMs: number }
export const IMPACT_LIMITS: Readonly<ImpactLimits> = Object.freeze({ pageSize: 100, maxPages: 100, timeoutMs: 60000 });

export async function captureZepImpact(client: ZepClient, room: MemoryRoom, episodeId: string, signal?: AbortSignal, limits = IMPACT_LIMITS): Promise<EpisodeImpact> {
  const graphId = zepRoomGraphId(room);
  const controller = new AbortController(), cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs); timer.unref?.();
  const options = { maxRetries: 0, timeoutInSeconds: Math.min(20, limits.timeoutMs / 1000), abortSignal: controller.signal };
  const incomplete = (reason: string): never => { throw new MemoryProviderError(`Zep impact capture incomplete: ${reason}`, false); };
  try {
    controller.signal.throwIfAborted();
    let episode;
    try { episode = await client.graph.episode.get(episodeId, options); }
    catch (error) { if (error instanceof ZepError && error.statusCode === 404) { controller.signal.throwIfAborted(); return { state: "absent" }; } throw error; }
    controller.signal.throwIfAborted();
    if (episode.uuid !== episodeId) return incomplete("episode_identity_changed");
    if (episode.processed !== true) return { state: "pending" };
    const list = async (kind: "edge" | "node"): Promise<string[]> => {
      const ids = new Set<string>(), cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < limits.maxPages; page++) {
        controller.signal.throwIfAborted();
        const request = { limit: limits.pageSize, orderBy: "uuid", direction: "asc", filters: { episodeUuids: [episodeId] }, ...(cursor ? { cursor } : {}) };
        const response = await client.graph[kind].getByGraphId(graphId, request, options).withRawResponse();
        controller.signal.throwIfAborted();
        const truncated = response.rawResponse.headers.get("zep-truncated");
        if (truncated && !["false", "0"].includes(truncated.toLowerCase())) return incomplete("listing_truncated");
        if (!Array.isArray(response.data) || response.data.length > limits.pageSize) return incomplete("listing_invalid");
        for (const item of response.data) {
          if (!item.uuid || ids.has(item.uuid)) return incomplete("listing_unstable");
          if (kind === "edge" && (!("episodes" in item) || !Array.isArray(item.episodes) || !item.episodes.includes(episodeId))) return incomplete("edge_filter_mismatch");
          ids.add(item.uuid);
        }
        const next = response.rawResponse.headers.get("zep-next-cursor");
        if (zepPageCursorMissing(response.data.length, limits.pageSize, next)) return incomplete(`${kind}_listing_cursor_missing`);
        if (!next) return [...ids];
        if (cursors.has(next)) return incomplete("listing_cursor_loop");
        cursors.add(next); cursor = next;
      }
      return incomplete("listing_page_limit");
    };
    const edgeIds = await list("edge"), nodeIds = await list("node");
    controller.signal.throwIfAborted();
    return { state: "processed", edgeIds, nodeIds };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof MemoryProviderError) throw error;
    const status = error instanceof ZepError ? error.statusCode : undefined;
    throw new MemoryProviderError(`Zep impact capture incomplete: ${controller.signal.aborted ? "capture_deadline" : status ? `read_failed_${status}` : "read_failed"}`,
      !controller.signal.aborted && (!status || status === 408 || status === 429 || status >= 500), { cause: error });
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}
