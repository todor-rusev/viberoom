// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { hash, stable, verifyPreparedRoot, writeExclusive } from "./plan.mjs";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const options = { maxRetries: 0, timeoutInSeconds: 20 };
export class Journal {
  static async claim(root, plan) {
    const approvedRoot = await verifyPreparedRoot(root, plan);
    await writeExclusive(resolve(approvedRoot, "started.json"), { schema: plan.schema, planSha256: hash(plan),
      preparedRootSha256: hash(plan.preparedRoot), state: "one-shot-claimed" });
    const file = await open(resolve(approvedRoot, "journal.jsonl"), "wx");
    const journal = new Journal(file); journal.root = approvedRoot;
    try { await journal.append({ kind: "claimed", planSha256: hash(plan), preparedRootSha256: hash(plan.preparedRoot) }); }
    catch (error) { await file.close(); throw error; }
    return journal;
  }
  constructor(file) { this.file = file; this.sequence = 0; }
  async append(value) {
    await this.file.writeFile(JSON.stringify({ sequence: ++this.sequence, ...value }) + "\n"); await this.file.sync();
  }
  async close() { await this.file.close(); }
}
export class Wire {
  constructor(plan, journal, baseUrl, clock, progress = () => {}) {
    this.plan = plan; this.journal = journal; this.baseUrl = baseUrl; this.clock = clock; this.progress = progress;
    this.started = clock.now(); this.reads = 0; this.writes = 0; this.episodes = new Map(); this.attempts = new Set();
    this.phase = "project"; this.halted = false;
  }
  checkTime() { if (this.clock.now() - this.started >= this.plan.limits.totalWallMs) throw new Error("wall_budget_exhausted"); }
  async wait(ms) {
    const until = this.clock.now() + ms;
    while (this.clock.now() < until) { this.checkTime(); await this.clock.sleep(Math.min(10000, until - this.clock.now())); this.progress("waiting"); }
  }
  request(source) {
    return { graphId: this.plan.graphId, type: "message", data: source.text, createdAt: source.at,
      sourceDescription: "B18d synthetic observation", metadata: { schema: this.plan.schema, run_id: this.plan.runId,
        source_id: source.key, version: source.version, source_at: source.at, op_id: source.opId } };
  }
  classify(args) {
    this.checkTime();
    if (this.halted) throw new Error("wire_halted_no_further_requests");
    if (args.maxRetries !== 0 || args.timeoutMs !== this.plan.limits.requestTimeoutMs) throw new Error("sdk_retry_or_timeout_changed");
    const url = new URL(args.url), base = new URL(this.baseUrl);
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(base.pathname + "/")
      || Object.keys(args.queryParameters ?? {}).length) throw new Error("target_outside_owned_endpoint");
    const path = url.pathname.slice(base.pathname.length), graph = encodeURIComponent(this.plan.graphId);
    const body = args.body, method = args.method;
    if (method === "GET" && path === "/projects/info" && this.phase === "project" && !body) return { kind: "read" };
    if (method === "GET" && path === `/graph/${graph}` && !body) return { kind: "read" };
    const episodeMatch = /^\/graph\/episodes\/([a-f0-9-]+)$/.exec(path);
    if (episodeMatch && this.episodes.has(episodeMatch[1]) && !body) {
      if (method === "GET") return { kind: "read" };
      if (method === "DELETE" && this.phase === "delete" && this.episodes.get(episodeMatch[1]) === this.plan.deleteSource)
        return { kind: "write", op: "delete-b" };
    }
    const listing = ["episodes", "edge", "node"].some(kind => path === `/graph/${kind}/graph/${graph}`);
    if (method === "POST" && listing && ["inventory", "observe"].includes(this.phase)) {
      const allowed = ["limit", "order_by", "direction", "cursor"];
      if (!body || body.limit !== 50 || body.order_by !== "uuid" || body.direction !== "asc" || Object.keys(body).some(k => !allowed.includes(k))) throw new Error("unbounded_inventory_request");
      return { kind: "read" };
    }
    if (method === "POST" && path === "/graph/create" && this.phase === "create") {
      const expected = { graph_id: this.plan.graphId, name: "B18d synthetic deletion observation", description: this.plan.description, time_zone: "UTC" };
      if (stable(body) !== stable(expected)) throw new Error("graph_payload_changed");
      return { kind: "write", op: "create" };
    }
    if (method === "POST" && path === "/graph" && this.phase.startsWith("ingest:")) {
      const source = this.plan.sources.find(s => this.phase === `ingest:${s.key}`);
      const req = this.request(source);
      const expected = { graph_id: req.graphId, type: req.type, data: req.data, created_at: req.createdAt,
        source_description: req.sourceDescription, metadata: req.metadata };
      if (stable(body) !== stable(expected)) throw new Error("episode_payload_changed");
      return { kind: "write", op: `episode:${source.key}` };
    }
    throw new Error("route_or_phase_not_authorized");
  }
  fetcher = async args => {
    const action = this.classify(args);
    if (this.reads + this.writes >= this.plan.limits.wireRequests || action.kind === "read" && this.reads >= this.plan.limits.reads) throw new Error("request_budget_exhausted");
    if (action.kind === "write") {
      if (this.attempts.has(action.op) || this.writes >= 8) throw new Error("write_already_reserved_no_retry");
      this.attempts.add(action.op); this.writes++;
    } else this.reads++;
    const number = this.reads + this.writes;
    const url = new URL(args.url);
    for (const [key, value] of Object.entries(args.queryParameters ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    await this.journal.append({ kind: "intent", number, action, method: args.method, path: url.pathname,
      body: args.body ?? null, bodySha256: hash(args.body ?? null), elapsedMs: this.clock.now() - this.started });
    const headers = {};
    for (const [key, raw] of Object.entries(args.headers ?? {})) {
      const value = typeof raw === "function" ? await raw() : raw;
      if (value !== undefined) headers[key] = value;
    }
    if (args.contentType) headers["content-type"] = args.contentType;
    let response;
    try {
      this.checkTime();
      const remaining = this.plan.limits.totalWallMs - (this.clock.now() - this.started);
      response = await fetch(url, { method: args.method, headers, body: args.body === undefined ? undefined : JSON.stringify(args.body),
        redirect: "manual", signal: AbortSignal.timeout(Math.min(args.timeoutMs, remaining)) });
      if (response.status >= 300 && response.status < 400) throw new Error("redirect_refused");
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body ?? []) {
        bytes += chunk.byteLength;
        if (bytes > this.plan.limits.responseBytes) throw new Error("response_too_large");
        chunks.push(Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString("utf8");
      const body = text ? JSON.parse(text) : {};
      const rawResponse = { headers: response.headers, status: response.status, statusText: response.statusText, url: response.url,
        redirected: response.redirected, type: response.type };
      await this.journal.append({ kind: "result", number, status: response.status, elapsedMs: this.clock.now() - this.started,
        response: response.ok ? body : { withheld: true }, nextCursor: response.headers.get("zep-next-cursor") });
      this.progress(`HTTP ${response.status}; ${this.reads} reads, ${this.writes} mutations`);
      if (response.ok) return { ok: true, body, rawResponse };
      return { ok: false, error: { reason: "status-code", statusCode: response.status, body: { message: "upstream_request_failed" } }, rawResponse };
    } catch {
      this.halted = true;
      await this.journal.append({ kind: "unknown-result-stop", number, action, elapsedMs: this.clock.now() - this.started });
      throw new Error("transport_or_response_unknown_no_retry");
    }
  };
}
export function makeClient(sdkRoot, wire, key) {
  const { ZepClient } = createRequire(import.meta.url)(resolve(sdkRoot));
  return new ZepClient({ apiKey: key, baseUrl: wire.baseUrl, fetcher: wire.fetcher });
}
function sourceMetadata(source, plan) {
  return { schema: plan.schema, run_id: plan.runId, source_id: source.key,
    version: source.version, source_at: source.at, op_id: source.opId };
}
function verifyAcknowledgement(value, source, plan) {
  if (!uuid.test(value?.uuid ?? "") || value.content !== source.text
    || value.metadata !== undefined && stable(value.metadata) !== stable(sourceMetadata(source, plan)))
    throw new Error("episode_identity_or_original_changed");
}
function eventInstant(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[0] !== value) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone, sign, offsetHourText, offsetMinuteText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const months = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > months[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (offsetHour > 23 || offsetMinute > 59) return null;
  const days = 365 * year + Math.floor((year + 3) / 4) - Math.floor((year + 99) / 100) + Math.floor((year + 399) / 400)
    + months.slice(0, month - 1).reduce((sum, length) => sum + length, 0) + day - 1;
  const offset = /^[Zz]$/.test(zone) ? 0 : (sign === "+" ? 1 : -1) * (offsetHour * 60 + offsetMinute) * 60;
  return { seconds: days * 86400 + hour * 3600 + minute * 60 + second - offset, fraction: fraction.replace(/0+$/, "") };
}
export function sameEventInstant(left, right) {
  const a = eventInstant(left), b = eventInstant(right);
  return a !== null && b !== null && a.seconds === b.seconds && a.fraction === b.fraction;
}
function verifyEpisodeIdentity(value, source, plan, knownId) {
  if (!uuid.test(value?.uuid ?? "") || knownId && value.uuid !== knownId || value.content !== source.text
    || stable(value.metadata) !== stable(sourceMetadata(source, plan))) throw new Error("episode_identity_or_original_changed");
}
function verifyPersistedEpisode(value, source, plan, knownId) {
  verifyEpisodeIdentity(value, source, plan, knownId);
  if (!sameEventInstant(value.createdAt, source.at))
    throw new Error("episode_event_time_changed");
}
function verifyListedEpisode(value, source, plan, knownId) {
  verifyEpisodeIdentity(value, source, plan, knownId);
  if (!sameEventInstant(value.createdAt, value.createdAt)) throw new Error("inventory_episode_time_invalid");
  if (value.processed !== true) throw new Error("inventory_unprocessed_source");
}
async function recordVerification(wire, source, value) {
  await wire.journal.append({ kind: "episode-verified", key: source.key, uuid: value.uuid, createdAt: value.createdAt, processed: true });
}
async function processed(client, wire, source, episodeId) {
  const started = wire.clock.now();
  for (let n = 0; n < wire.plan.limits.processPollsPerEpisode; n++) {
    if (wire.clock.now() - started >= wire.plan.limits.processWaitMs) break;
    const value = await client.graph.episode.get(episodeId, options);
    verifyEpisodeIdentity(value, source, wire.plan, episodeId);
    if (wire.clock.now() - started > wire.plan.limits.processWaitMs) break;
    if (value.processed === true) {
      verifyPersistedEpisode(value, source, wire.plan, episodeId);
      await recordVerification(wire, source, value);
      return;
    }
    if (value.processed !== false || !sameEventInstant(value.createdAt, value.createdAt))
      throw new Error("episode_processing_response_invalid");
    await wire.journal.append({ kind: "episode-processing-pending", key: source.key, uuid: value.uuid,
      observedCreatedAt: value.createdAt, expectedEventTime: source.at, processed: false });
    if (wire.clock.now() - started >= wire.plan.limits.processWaitMs) break;
    await wire.wait(wire.plan.limits.processPollIntervalMs);
  }
  throw new Error("episode_processing_unconfirmed");
}
export async function inventory(client, wire, sources) {
  const lists = {}, listingReads = [], sourceReads = [];
  for (const kind of ["episode", "edge", "node"]) {
    let cursor; const seen = new Set(), cursors = new Set(), items = [];
    for (let page = 0; page < wire.plan.limits.pagesPerKind; page++) {
      const request = { limit: 50, orderBy: "uuid", direction: "asc", ...(cursor ? { cursor } : {}) };
      const startedMs = wire.clock.now();
      const response = await (kind === "episode" ? client.graph.episode.listByGraphId(wire.plan.graphId, request, options)
        : client.graph[kind].getByGraphId(wire.plan.graphId, request, options)).withRawResponse();
      listingReads.push({ kind, page, requestNumber: wire.reads + wire.writes, startedMs, endedMs: wire.clock.now() });
      const truncated = response.rawResponse.headers.get("zep-truncated");
      if (truncated && !["false", "0"].includes(truncated.toLowerCase())) throw new Error("inventory_truncated");
      if (!Array.isArray(response.data) || response.data.length > 50) throw new Error("inventory_invalid_page");
      for (const value of response.data) {
        if (!uuid.test(value.uuid ?? "") || seen.has(value.uuid)) throw new Error("inventory_duplicate_or_invalid_id");
        if (value.graphId !== undefined && value.graphId !== wire.plan.graphId) throw new Error("inventory_foreign_graph");
        seen.add(value.uuid); items.push(value);
      }
      const next = response.rawResponse.headers.get("zep-next-cursor");
      if (response.data.length === 50 && !next) throw new Error("inventory_full_page_without_cursor");
      if (!next) { lists[kind] = items.sort((a, b) => a.uuid.localeCompare(b.uuid)); break; }
      if (cursors.has(next)) throw new Error("inventory_cursor_loop");
      cursors.add(next); cursor = next;
    }
    if (!lists[kind]) throw new Error("inventory_page_limit");
  }
  if (lists.episode.length !== sources.length) throw new Error("unexpected_or_missing_source");
  for (const source of sources) {
    const ids = [...wire.episodes].filter(([, key]) => key === source.key).map(([id]) => id);
    const value = lists.episode.find(v => v.uuid === ids[0]);
    verifyListedEpisode(value, source, wire.plan, ids[0]);
  }
  const allowedSources = new Set([...wire.episodes.keys()]);
  const nodes = new Set(lists.node.map(n => n.uuid));
  for (const edge of lists.edge) {
    if (!nodes.has(edge.sourceNodeUuid) || !nodes.has(edge.targetNodeUuid)) throw new Error("inventory_endpoint_missing");
    if (!Array.isArray(edge.episodes) || edge.episodes.some(id => !allowedSources.has(id))) throw new Error("unexpected_edge_support");
  }
  for (const source of sources) {
    const listed = lists.episode.find(value => value.metadata.source_id === source.key);
    const startedMs = wire.clock.now();
    const value = await client.graph.episode.get(listed.uuid, options);
    verifyPersistedEpisode(value, source, wire.plan, listed.uuid);
    if (value.processed !== true) throw new Error("inventory_get_processing_unconfirmed");
    const read = { key: source.key, uuid: listed.uuid, listedCreatedAt: listed.createdAt, episode: value,
      requestNumber: wire.reads + wire.writes, startedMs, endedMs: wire.clock.now() };
    sourceReads.push(read);
    await wire.journal.append({ kind: "inventory-source-verified", ...read });
  }
  return { episodes: lists.episode, edges: lists.edge, nodes: lists.node, listingReads, sourceReads };
}
function signals(snapshot) {
  const talmera = snapshot.nodes.filter(n => /Talmera/i.test(n.name ?? "")).map(n => ({ uuid: n.uuid, summary: n.summary ?? "" }));
  return { talmera, summariesSha256: hash(talmera), southforgeMentioned: talmera.some(n => /Southforge/i.test(n.summary)),
    northbeamMentioned: talmera.some(n => /Northbeam/i.test(n.summary)), indigoVaultMentioned: talmera.some(n => /IndigoVault/i.test(n.summary)),
    endedAssignmentEdges: snapshot.edges.filter(e => /Helion|Orbit/i.test(e.fact ?? "")),
    independentEdges: snapshot.edges.filter(e => /Zircona|Cedarport/i.test(e.fact ?? "")), paymentEdges: snapshot.edges.filter(e => /Talmera/i.test(e.fact ?? "")) };
}
export async function observe(client, wire, retained = null) {
  const plan = wire.plan, remaining = plan.sources.filter(s => s.key !== plan.deleteSource);
  const capture = async (stage, at, sources) => {
    const startedMs = wire.clock.now(); const snapshot = await inventory(client, wire, sources);
    const sample = { stage, scheduledOffsetMs: at, startedMs, endedMs: wire.clock.now(), snapshot, signals: signals(snapshot) };
    await wire.journal.append({ kind: "sample", ...sample }); return sample;
  };
  let report = { schema: wire.executionPlan?.schema ?? plan.schema, planSha256: hash(wire.executionPlan ?? plan), graphId: plan.graphId,
    ...(wire.executionPlan ? { executionId: wire.executionPlan.executionId, originalSourcePlanSha256: hash(wire.executionPlan.sourcePlan), originalRunRestarted: false } : {}),
    outcome: "not_started", samples: [],
    boundary: { observationOnly: true, semanticReviewRequired: true, automaticRefreshCompletionProven: false,
      writerFenceProven: false, workerDrainProven: false, productRepairCompleted: false, noAutomaticGraphCleanup: true } };
  try {
    const retainedList = retained === null ? [] : Array.isArray(retained) ? retained : [retained];
    const retainedKeys = new Set(), retainedIds = new Set();
    if (retained !== null && (!retainedList.length || retainedList.length > remaining.length)) throw new Error("retained_source_identity_invalid");
    for (const [at, handle] of retainedList.entries()) {
      if (handle?.key !== remaining[at].key || !uuid.test(handle.uuid ?? "") || retainedIds.has(handle.uuid))
        throw new Error("retained_source_identity_invalid");
      retainedKeys.add(handle.key); retainedIds.add(handle.uuid);
    }
    const project = await client.project.get(options);
    if (project.project?.uuid !== plan.projectUuid) throw new Error("project_identity_mismatch");
    if (!retained) {
      wire.phase = "precreate";
      try { await client.graph.get(plan.graphId, options); throw new Error("graph_already_exists"); }
      catch (error) { if (error.statusCode !== 404) throw error; }
      wire.phase = "create";
      await client.graph.create({ graphId: plan.graphId, name: "B18d synthetic deletion observation", description: plan.description, timeZone: "UTC" }, options);
    }
    const graph = await client.graph.get(plan.graphId, options);
    if (graph.graphId !== plan.graphId || graph.description !== plan.description || graph.projectUuid !== plan.projectUuid) throw new Error("created_graph_identity_mismatch");
    if (retained) {
      for (const handle of retainedList) {
        const source = plan.sources.find(s => s.key === handle.key);
        wire.episodes.set(handle.uuid, source.key);
        await wire.journal.append({ kind: "retained-episode-bound", key: source.key, uuid: handle.uuid });
        const value = await client.graph.episode.get(handle.uuid, options);
        verifyPersistedEpisode(value, source, plan, handle.uuid);
        if (value.processed !== true) throw new Error("episode_processing_unconfirmed");
        await recordVerification(wire, source, value);
      }
      wire.phase = "inventory";
      const snapshot = await inventory(client, wire, remaining.filter(source => retainedKeys.has(source.key)));
      await wire.journal.append({ kind: "retained-preflight", snapshot });
      report.retainedPreflight = { ...(retainedList.length === 1 ? retainedList[0] : { sources: retainedList }), inventorySha256: hash(snapshot), verifiedBeforeNewWrites: true };
    }
    const ingest = async source => {
      wire.phase = `ingest:${source.key}`;
      const value = await client.graph.add(wire.request(source), options);
      if (!uuid.test(value?.uuid ?? "")) throw new Error("episode_identity_or_original_changed");
      if (wire.episodes.has(value.uuid)) throw new Error("reused_episode_id");
      await wire.journal.append({ kind: "episode-acknowledged", key: source.key, uuid: value.uuid });
      verifyAcknowledgement(value, source, plan);
      wire.episodes.set(value.uuid, source.key);
      await wire.journal.append({ kind: "episode-bound", key: source.key, uuid: value.uuid });
      await processed(client, wire, source, value.uuid);
    };
    for (const source of remaining) if (!retainedKeys.has(source.key)) await ingest(source);
    wire.phase = "inventory"; report.samples.push(await capture("baseline", null, remaining));
    await ingest(plan.sources.find(s => s.key === plan.deleteSource));
    wire.phase = "inventory"; report.samples.push(await capture("before-delete", null, plan.sources));
    const deletedId = [...wire.episodes].find(([, key]) => key === plan.deleteSource)[0];
    report.deleteStartedMs = wire.clock.now();
    wire.phase = "delete"; await client.graph.episode.delete(deletedId, options);
    report.deleteAcknowledgedMs = wire.clock.now();
    let absent = false;
    for (let n = 0; n < plan.limits.absencePolls; n++) {
      try { await client.graph.episode.get(deletedId, options); }
      catch (error) { if (error.statusCode !== 404) throw error; absent = true; break; }
      await wire.wait(5000);
    }
    if (!absent) throw new Error("deleted_episode_absence_unconfirmed");
    const origin = wire.clock.now(); report.deletionAbsenceObservedMs = origin;
    wire.phase = "observe";
    for (const offset of plan.limits.observationOffsetsMs) {
      await wire.wait(Math.max(0, origin + offset - wire.clock.now()));
      report.samples.push(await capture("after-delete", offset, remaining));
    }
    const before = report.samples.find(s => s.stage === "before-delete").signals;
    const after = report.samples.filter(s => s.stage === "after-delete");
    report.lexicalObservation = !before.southforgeMentioned ? "summary-effect-inconclusive-before-delete"
      : after.some(s => !s.signals.southforgeMentioned) ? "removed-name-disappeared-human-review-required" : "removed-name-still-observed-within-window";
    report.outcome = "observation_window_complete_no_vendor_completion_receipt";
  } catch (error) {
    report.outcome = "stopped-retained-no-retry";
    report.stopReason = /^[a-z0-9_-]+$/.test(error.message ?? "") ? error.message : "sdk_operation_failed_or_unknown";
  }
  wire.halted = true;
  report.requests = { reads: wire.reads, mutations: wire.writes, attempts: [...wire.attempts] };
  report.graphCreationAttemptReserved = wire.attempts.has("create");
  await wire.journal.append({ kind: "terminal", report });
  return report;
}
export async function readJournal(root) {
  const text = await readFile(resolve(root, "journal.jsonl"), "utf8");
  return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}
