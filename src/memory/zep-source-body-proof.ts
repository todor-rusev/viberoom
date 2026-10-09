// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { ZepClient, type Zep } from "@getzep/zep-cloud";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readZepMetadata, ZEP_CARRY_HASH } from "./zep-metadata.js";
import { zepPhysicalGraphId } from "./zep-payload.js";
import { zepPageCursorMissing } from "./zep-pagination.js";
import type { SourceBodyAccounting, SourceBodyEpisode, SourceBodyProof, SourceBodyRequest, OriginalSourceClassification } from "./source-body-proof.js";
import { validSourceBodyCreatedAt, validOriginalClassificationMetadata } from "./source-body-proof.js";
import { systemClock, type MemoryClock } from "./clock.js";

type Fetcher = NonNullable<NonNullable<ConstructorParameters<typeof ZepClient>[0]>["fetcher"]>;
class BodyProofError extends Error {}
function fail(reason: string): never { throw new BodyProofError(reason); }
const part = (value: unknown) => typeof value === "string" && !/[\r\n]/.test(value) && /^([1-9]\d*)\/([1-9]\d*)$/.test(value) &&
  Number(value.split("/")[0]) <= Number(value.split("/")[1]) && Number(value.split("/")[1]) <= 64;
const presentString = (value: unknown): value is string => typeof value === "string" && !!value && !/[\u0000-\u001f\u007f]/u.test(value);
const immutable = <T>(value: T): T => {
  if (value && typeof value === "object") { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
};

function observed(episode: Zep.Episode, request: SourceBodyRequest): SourceBodyEpisode {
  const m = readZepMetadata(episode.metadata), scope = request.scope;
  if (!m || m.room_id !== scope.roomUuid || m.source_id !== scope.sourceId || m.version !== scope.version || m.source_kind !== "message" ||
    !presentString(m.op_id) || !presentString(m.copy_id) || !presentString(m.author_id) || !presentString(m.source_at) || !part(m.part))
    return fail("source_body_metadata_invalid");
  if (typeof episode.uuid !== "string" || !episode.uuid || typeof episode.content !== "string" ||
    !validSourceBodyCreatedAt(episode.createdAt) || typeof episode.processed !== "boolean" || episode.source !== undefined && episode.source !== "message" ||
    episode.sourceDescription !== undefined && (typeof episode.sourceDescription !== "string" ||
      /[\r\n]/.test(episode.sourceDescription) || !/^viberoom room "[^\r\n]*"(?:, message [1-9]\d*|, explicit note)$/.test(episode.sourceDescription)))
    return fail("source_body_native_episode_invalid");
  const carryHash = m.schema === 2 ? String(m.version) : m.carry_hash;
  if (typeof carryHash !== "string" || !ZEP_CARRY_HASH.test(carryHash)) return fail("source_body_carry_identity_invalid");
  return immutable({ id: episode.uuid, processed: episode.processed, sourceId: scope.sourceId, version: scope.version,
    part: String(m.part), kind: "message", opId: m.op_id, copyId: m.copy_id, carryHash,
    ...(m.schema === 2 ? { legacy: true as const } : {}), schema: m.schema, authorId: m.author_id, sourceAt: m.source_at,
    content: episode.content, metadata: structuredClone(episode.metadata!), createdAt: episode.createdAt,
    ...(episode.source === undefined ? {} : { source: episode.source }),
    ...(episode.sourceDescription === undefined ? {} : { sourceDescription: episode.sourceDescription }) });
}

export class ZepSourceBodyReader {
  readonly account: string;
  private readonly endpoint: string;
  private readonly settings: Readonly<{ apiKey: string; baseUrl: string }>;
  constructor(settings: { apiKey: string; baseUrl?: string }, private readonly fetchFn: typeof fetch = fetch, private readonly clock: MemoryClock = systemClock) {
    this.endpoint = settings.baseUrl ?? "https://api.getzep.com/api/v2";
    this.settings = Object.freeze({ apiKey: settings.apiKey, baseUrl: this.endpoint });
    this.account = `sha256:${createHash("sha256").update(JSON.stringify([this.endpoint, settings.apiKey])).digest("hex")}`;
  }

  read(input: SourceBodyRequest, signal: AbortSignal, current: () => boolean): Promise<SourceBodyProof> {
    return this.readNative(input, signal, current, false);
  }
  readOriginal(input: SourceBodyRequest, signal: AbortSignal, current: () => boolean): Promise<SourceBodyProof> {
    return this.readNative(input, signal, current, true);
  }
  async classify(input: SourceBodyRequest, signal: AbortSignal, current: () => boolean): Promise<OriginalSourceClassification> {
    const proof = await this.readNative(input, signal, current, true);
    if (proof.state === "unknown") return proof;
    return immutable({ state: "complete", scope: proof.scope, bySource: new Map([[proof.scope.sourceId, proof.episodes]]),
      startedAt: proof.scan.startedAt, finishedAt: proof.scan.finishedAt, accounting: proof.accounting });
  }
  private async readNative(input: SourceBodyRequest, signal: AbortSignal, current: () => boolean, allVersions: boolean): Promise<SourceBodyProof> {
    const accounting: SourceBodyAccounting = { pages: 0, episodes: 0, candidates: 0, gets: 0, responseBytes: 0 };
    const unknown = (reason: string): SourceBodyProof => ({ state: "unknown", reason, accounting: { ...accounting } });
    let request: SourceBodyRequest;
    try { request = immutable(structuredClone(input)); } catch { return unknown("source_body_request_invalid"); }
    const limits = request?.limits, scope = request?.scope;
    const caps = { maxPages: 100, maxEpisodes: 10_000, maxCandidates: 512, maxGets: 512, maxResponseBytes: 64 * 1024 * 1024, timeoutMs: 20_000 };
    if (!limits || !scope || Object.keys(limits).length !== Object.keys(caps).length ||
      Object.entries(caps).some(([key, cap]) => { const n = limits[key as keyof typeof caps]; return !Number.isSafeInteger(n) || n <= 0 || n > cap; }) ||
      scope.provider !== "zep" || scope.account !== this.account || !presentString(scope.roomUuid) || !presentString(scope.sourceId) ||
      !ZEP_CARRY_HASH.test(scope.version) || typeof current !== "function") return unknown("source_body_request_invalid");
    const startedAt = this.clock.wall(), begun = this.clock.now(), controller = new AbortController(), cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel();
    const timer = this.clock.setTimeout(cancel, limits.timeoutMs); timer.unref?.();
    const fence = () => {
      if (controller.signal.aborted || this.clock.now() - begun >= limits.timeoutMs) fail("source_body_read_interrupted");
      if (current() !== true) fail("source_body_authority_changed");
    };
    const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
      fence(); let rejectAbort!: () => void;
      const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(new BodyProofError("source_body_read_interrupted")); });
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      try { const value = await Promise.race([work(), interrupted]); fence(); return value; }
      finally { controller.signal.removeEventListener("abort", rejectAbort); }
    };
    let expectedUrl = "", expectedMethod = "", expectedBody: unknown;
    const fetcher: Fetcher = async <R>(args: Parameters<Fetcher>[0]) => {
      fence();
      if (args.url !== expectedUrl || args.method !== expectedMethod || args.maxRetries !== 0 || !isDeepStrictEqual(args.body, expectedBody) ||
        args.queryParameters && Object.keys(args.queryParameters).length)
        return fail("source_body_sdk_request_mismatch");
      const headers = new Headers();
      const headerEntries = Object.entries(args.headers ?? {});
      if (headerEntries.length > 0 && headerEntries.every(([, value]) => typeof value === "string" || value === undefined)) {
        const values = await guarded(async () => headerEntries as Array<[string, string | undefined]>);
        for (const [key, value] of values) if (value !== undefined) headers.set(key, value);
      } else for (const [key, supplier] of headerEntries) {
        const value = await guarded(async () => typeof supplier === "function" ? supplier() : supplier);
        if (value !== undefined) headers.set(key, value);
      }
      if (args.body !== undefined) headers.set("content-type", "application/json");
      const response = await guarded(() => this.fetchFn(args.url, { method: args.method, headers, signal: controller.signal,
        redirect: "manual", ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }) }));
      const chunks: Uint8Array[] = [], reader = response.body?.getReader();
      try {
        if (reader) for (;;) {
          const chunk = await guarded(() => reader.read());
          if (chunk.done) break;
          accounting.responseBytes += chunk.value.byteLength;
          if (accounting.responseBytes > limits.maxResponseBytes) fail("source_body_response_budget_exhausted");
          chunks.push(chunk.value);
        }
      } finally { void reader?.cancel().catch(() => {}); }
      fence();
      if (!response.ok) return fail("source_body_http_failed");
      let body: unknown;
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return fail("source_body_json_invalid"); }
      return { ok: true, body: body as R, rawResponse: response };
    };
    try {
      fence();
      const graphId = zepPhysicalGraphId({ uuid: scope.roomUuid, graphId: scope.graphId });
      const client = new ZepClient({ ...this.settings, fetcher });
      const options = { maxRetries: 0, timeoutInSeconds: limits.timeoutMs / 1000, abortSignal: controller.signal };
      const base = this.endpoint.replace(/\/$/, ""), ids = new Set<string>(), cursors = new Set<string>();
      const candidates: Zep.Episode[] = []; let cursor: string | undefined, complete = false;
      for (let n = 0; n < limits.maxPages; n++) {
        expectedUrl = `${base}/graph/episodes/graph/${encodeURIComponent(graphId)}`; expectedMethod = "POST";
        expectedBody = { order_by: "uuid", direction: "asc", limit: 50, ...(cursor ? { cursor } : {}) };
        accounting.pages++;
        const response = await guarded(() => client.graph.episode.listByGraphId(graphId,
          { orderBy: "uuid", direction: "asc", limit: 50, ...(cursor ? { cursor } : {}) }, options).withRawResponse());
        const truncated = response.rawResponse.headers.get("zep-truncated");
        if (truncated && !["false", "0"].includes(truncated.toLowerCase())) fail("source_body_listing_truncated");
        if (!Array.isArray(response.data) || response.data.length > 50) fail("source_body_listing_invalid");
        for (const episode of response.data) {
          accounting.episodes++;
          if (accounting.episodes > limits.maxEpisodes) fail("source_body_episode_budget_exhausted");
          if (typeof episode.uuid !== "string" || !episode.uuid || ids.has(episode.uuid)) fail("source_body_listing_unstable");
          ids.add(episode.uuid);
          const raw = episode.metadata;
          if (raw?.source_id !== scope.sourceId) continue;
          const metadata = readZepMetadata(raw);
          if (!metadata || metadata.room_id !== scope.roomUuid || typeof metadata.version !== "string" || !metadata.version)
            fail("source_body_same_source_metadata_invalid");
          if (allVersions && !validOriginalClassificationMetadata(raw)) fail("source_body_classification_metadata_invalid");
          if (!allVersions && metadata.version !== scope.version) continue;
          accounting.candidates++;
          if (accounting.candidates > limits.maxCandidates) fail("source_body_candidate_budget_exhausted");
          candidates.push(episode);
        }
        const next = response.rawResponse.headers.get("zep-next-cursor");
        if (zepPageCursorMissing(response.data.length, 50, next)) fail("source_body_listing_cursor_missing");
        if (!next) { complete = true; break; }
        if (cursors.has(next)) fail("source_body_listing_cursor_loop");
        cursors.add(next); cursor = next;
      }
      if (!complete) fail("source_body_page_budget_exhausted");
      const episodes: SourceBodyEpisode[] = [];
      for (const listed of candidates) {
        if (accounting.gets >= limits.maxGets) fail("source_body_get_budget_exhausted");
        accounting.gets++;
        expectedUrl = `${base}/graph/episodes/${encodeURIComponent(listed.uuid)}`; expectedMethod = "GET";
        expectedBody = undefined;
        const fresh = await guarded(() => client.graph.episode.get(listed.uuid, options));
        if (fresh.uuid !== listed.uuid || !isDeepStrictEqual(fresh.metadata, listed.metadata)) fail("source_body_candidate_identity_changed");
        const metadata = readZepMetadata(fresh.metadata)!;
        episodes.push(observed(fresh, allVersions ? { ...request, scope: { ...scope, version: String(metadata.version) } } : request)); fence();
      }
      fence();
      return immutable({ state: "complete", scope, episodes, scan: { startedAt, finishedAt: this.clock.wall() }, accounting: { ...accounting } });
    } catch (error) {
      return unknown(error instanceof BodyProofError ? error.message : controller.signal.aborted ? "source_body_read_interrupted" : "source_body_read_failed");
    } finally { this.clock.clearTimeout(timer); signal.removeEventListener("abort", cancel); }
  }
}
