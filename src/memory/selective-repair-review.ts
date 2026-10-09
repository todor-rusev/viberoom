// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { hasExactFields as fields, hasDenseDataItems } from "./exact-fields.js";
import { projectSelectiveDraft, validateSelectiveJSON, type SelectiveJSON, type SelectiveArtifactObservation, type SelectiveRepairDraft } from "./selective-repair-draft.js";
import { freezeSelective, validateSelectiveScope, type SelectiveRepairPlan, type SelectiveRepairScope } from "./selective-repair-intent.js";
import { recoveryFingerprint, type MemoryRecoverySources, type RecoverySourcePlan } from "./recovery-sources.js";
import type { RecoveryKnowledgeReader, RecoveryKnowledge } from "./recovery-knowledge.js";
import type { MemoryRepairJournal } from "./repair-journal.js";

type Reference = Pick<SelectiveArtifactObservation, "kind" | "id">;
export interface SelectiveReviewRequest {
  schema: "selective-repair-review-request-v1"; scope: SelectiveRepairScope;
  changes: Array<Reference & { patch: Record<string, SelectiveJSON>; sourceIds: string[] }>;
  controls: Reference[]; context: SelectiveJSON;
}
export interface SelectiveReviewItem { id: string; sourceIds: string[]; dimensions: string[] }
export interface SelectiveReviewReport {
  draft: SelectiveRepairDraft; plan: SelectiveRepairPlan; items: SelectiveReviewItem[];
  fingerprint: string; observedAt: number; expiresAt: number;
}
export interface SelectiveReviewDecision { id: string; verdict: "accepted" | "rejected" | "unresolved"; sourceIds: string[]; explanation: string }
export interface SelectiveReviewPorts {
  knowledge: RecoveryKnowledgeReader; sources: MemoryRecoverySources;
  current(scope: SelectiveRepairScope): boolean; now(): number;
}
const MAX_AGE_MS = 60_000;
const key = (kind: string, id: string) => JSON.stringify([kind, id]);
const equal = (a: unknown, b: unknown) => recoveryFingerprint(a) === recoveryFingerprint(b);
const strings = (value: unknown): value is string[] => hasDenseDataItems(value) && value.every(v => typeof v === "string" && !!v);
const object = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === "string" && !!v && v.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(v);
type Capture = { draft: SelectiveRepairDraft; plan: SelectiveRepairPlan; sources: RecoverySourcePlan; knowledgeFingerprint: string; observedAt: number };
type Lease = { request: SelectiveReviewRequest; capture: Capture; token: object; scopeKey: string; observedAt: number; expired: boolean };

export class MemorySelectiveReview {
  private readonly issued = new WeakMap<SelectiveReviewReport, Lease>();
  private readonly latest = new Map<string, object>();
  private lastTime = -1;
  constructor(private readonly journal: MemoryRepairJournal, private readonly ports: SelectiveReviewPorts) {}
  private time(): number {
    const at = this.journal.selectiveRead(() => this.ports.now());
    if (!Number.isSafeInteger(at) || at < this.lastTime || at < 0 || at > Number.MAX_SAFE_INTEGER - MAX_AGE_MS) {
      this.latest.clear(); throw new Error("Selective review clock changed");
    }
    this.lastTime = at; return at;
  }
  private current(scope: SelectiveRepairScope, revision: number): boolean {
    return this.journal.selectiveRead(() => this.ports.current(scope) === true && this.journal.selectiveScopeReadable(scope) &&
      this.journal.revision(scope.provider, scope.uuid) === revision);
  }
  static snapshotRequest(value: SelectiveReviewRequest): SelectiveReviewRequest {
    validateSelectiveJSON(value);
    if (!fields(value, ["schema", "scope", "changes", "controls", "context"]) || value.schema !== "selective-repair-review-request-v1" ||
        !hasDenseDataItems(value.changes) || !hasDenseDataItems(value.controls)) throw new Error("Invalid selective review request");
    validateSelectiveScope(value.scope);
    const ids = new Set<string>();
    for (const change of value.changes) {
      if (!fields(change, ["kind", "id", "patch", "sourceIds"]) || !strings(change.sourceIds)) throw new Error("Invalid selective review change");
      change.sourceIds.forEach(id => ids.add(id));
    }
    for (const control of value.controls) if (!fields(control, ["kind", "id"])) throw new Error("Invalid selective review control");
    projectSelectiveDraft({ schema: "selective-repair-draft-v1", scope: value.scope, repairRevision: 0,
      sources: [...ids].map(id => ({ id, original: null })), changes: value.changes.map(c => ({ before: { kind: c.kind, id: c.id, value: null }, patch: c.patch, sourceIds: c.sourceIds })),
      controls: value.controls.map(c => ({ ...c, value: null })), context: value.context });
    return freezeSelective(structuredClone(value));
  }
  private async capture(request: SelectiveReviewRequest, revision: number, signal: AbortSignal): Promise<Capture> {
    const valid = () => !signal.aborted && this.current(request.scope, revision);
    if (!valid()) throw new Error("Selective review scope changed");
    const started = this.time(), abort = AbortSignal.any([signal, AbortSignal.timeout(MAX_AGE_MS)]);
    let cancel: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new Error("Selective review read cancelled")); abort.addEventListener("abort", cancel, { once: true }); if (abort.aborted) cancel(); });
    let raw: RecoveryKnowledge;
    try { raw = await Promise.race([this.ports.knowledge.recoveryKnowledge(request.scope.uuid, request.scope.graphId, abort, () => this.time()), cancelled]); }
    catch { throw new Error("Selective review read failed"); }
    finally { abort.removeEventListener("abort", cancel); }
    validateSelectiveJSON(raw);
    if (!fields(raw, ["state", "graphId", "inventory", "episodes", "edges", "nodes", "fingerprint", "startedAt", "finishedAt"]) ||
        raw.state !== "complete" || raw.graphId !== request.scope.graphId || !Number.isSafeInteger(raw.startedAt) || !Number.isSafeInteger(raw.finishedAt) ||
        raw.startedAt < started || raw.finishedAt < raw.startedAt ||
        !hasDenseDataItems(raw.episodes) || !hasDenseDataItems(raw.edges) || !hasDenseDataItems(raw.nodes)) throw new Error("Selective review read incomplete");
    const knowledge = freezeSelective(structuredClone(raw)) as Extract<RecoveryKnowledge, { state: "complete" }>;
    if (!fields(knowledge.inventory, ["state", "episodes", "facts", "unexplained", "fingerprint", "startedAt", "finishedAt"]) ||
        knowledge.inventory.state !== "complete" || !hasDenseDataItems(knowledge.inventory.episodes) || !hasDenseDataItems(knowledge.inventory.facts) ||
        !strings(knowledge.inventory.unexplained) || knowledge.inventory.startedAt !== knowledge.startedAt || knowledge.inventory.finishedAt !== knowledge.finishedAt)
      throw new Error("Selective review inventory incomplete");
    for (const episode of knowledge.episodes) {
      if (!fields(episode, ["id", "content", "createdAt", "metadata", "processed", ...("source" in episode ? ["source"] : []), ...("sourceDescription" in episode ? ["sourceDescription"] : [])]) ||
          !identifier(episode.id) || typeof episode.content !== "string" || typeof episode.createdAt !== "string" || typeof episode.processed !== "boolean" ||
          episode.metadata !== null && !object(episode.metadata) || episode.source !== undefined && typeof episode.source !== "string" ||
          episode.sourceDescription !== undefined && typeof episode.sourceDescription !== "string") throw new Error("Selective review episode shape");
    }
    for (const node of knowledge.nodes) if (!fields(node, ["id", "name", "summary", "createdAt", "labels", "attributes"]) ||
      !identifier(node.id) || typeof node.name !== "string" || typeof node.summary !== "string" || typeof node.createdAt !== "string" ||
      !strings(node.labels) || !object(node.attributes)) throw new Error("Selective review node shape");
    for (const edge of knowledge.edges) if (!fields(edge, ["id", "fact", "name", "createdAt", "sourceNodeId", "targetNodeId", "episodeIds", "validAt", "invalidAt", "expiredAt", "attributes", "scope"]) ||
      !identifier(edge.id) || !identifier(edge.sourceNodeId) || !identifier(edge.targetNodeId) || typeof edge.fact !== "string" || typeof edge.name !== "string" ||
      typeof edge.createdAt !== "string" || !strings(edge.episodeIds) || !object(edge.attributes) ||
      [edge.validAt, edge.invalidAt, edge.expiredAt, edge.scope].some(v => v !== null && typeof v !== "string")) throw new Error("Selective review edge shape");
    if (!equal(knowledge.fingerprint, recoveryFingerprint({ graphId: knowledge.graphId, episodes: knowledge.episodes, edges: knowledge.edges, nodes: knowledge.nodes })))
      throw new Error("Selective review knowledge fingerprint changed");
    abort.throwIfAborted(); if (!valid()) throw new Error("Selective review scope changed");
    const finished = this.time();
    if (knowledge.finishedAt > finished || finished - started >= MAX_AGE_MS) throw new Error("Selective review read incomplete");
    const sources = this.journal.selectiveRead(() => this.ports.sources.plan(request.scope, knowledge.inventory));
    if (sources.state !== "ready" || !this.journal.selectiveRead(() => this.ports.sources.locallyCurrent(sources)) || !valid()) throw new Error("Selective review originals unavailable");
    const originals = sources.sources.map(s => ({ id: s.sourceId, original: (s.kind === "fact" ? s.fact : s.episode) as unknown as SelectiveJSON }));
    const support = new Map<string, string>();
    for (const source of sources.sources) for (const id of source.episodeIds) {
      if (support.has(id)) throw new Error("Selective review source identity repeated"); support.set(id, source.sourceId);
    }
    const artifacts = new Map<string, SelectiveArtifactObservation>(), nodes = new Set<string>(), episodes = new Set<string>();
    for (const episode of knowledge.episodes) {
      if (!episode.id || episodes.has(episode.id) || !episode.processed) throw new Error("Selective review episode invalid"); episodes.add(episode.id);
    }
    const add = (kind: "edge" | "node", value: { id: string }) => {
      const id = key(kind, value.id);
      if (!value.id || artifacts.has(id)) throw new Error("Selective review artifact identity repeated");
      artifacts.set(id, { kind, id: value.id, value: value as unknown as SelectiveJSON });
    };
    for (const node of knowledge.nodes) { add("node", node); nodes.add(node.id); }
    for (const edge of knowledge.edges) {
      if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId) || !strings(edge.episodeIds) || !edge.episodeIds.length ||
          new Set(edge.episodeIds).size !== edge.episodeIds.length || edge.episodeIds.some(id => !episodes.has(id) || !support.has(id)))
        throw new Error("Selective review provenance unavailable");
      add("edge", edge);
    }
    const find = (r: Reference) => {
      const observed = artifacts.get(key(r.kind, r.id)); if (!observed) throw new Error("Selective review artifact missing"); return observed;
    };
    for (const change of request.changes) {
      const related = knowledge.edges.filter(e => change.kind === "edge" ? e.id === change.id : e.sourceNodeId === change.id || e.targetNodeId === change.id);
      if (related.flatMap(e => e.episodeIds).some(id => !change.sourceIds.includes(support.get(id)!))) throw new Error("Selective review support omitted");
    }
    const projected = projectSelectiveDraft({ schema: "selective-repair-draft-v1", scope: request.scope, repairRevision: revision, sources: originals,
      changes: request.changes.map(change => ({ before: find(change), patch: change.patch, sourceIds: change.sourceIds })),
      controls: request.controls.map(find), context: { requested: request.context, sourcePlanFingerprint: sources.fingerprint,
        native: { graphId: knowledge.graphId, episodes: knowledge.episodes, edges: knowledge.edges, nodes: knowledge.nodes } as unknown as SelectiveJSON } });
    if (!valid() || !this.journal.selectiveRead(() => this.ports.sources.locallyCurrent(sources))) throw new Error("Selective review originals changed");
    return { ...projected, sources, knowledgeFingerprint: knowledge.fingerprint, observedAt: started };
  }
  private lease(report: SelectiveReviewReport): Lease {
    const lease = this.issued.get(report);
    if (!lease || lease.expired) throw new Error("Selective review was not issued by this owner");
    const valid = this.current(report.plan.scope, report.plan.repairRevision) && this.journal.selectiveRead(() => this.ports.sources.locallyCurrent(lease.capture.sources));
    const at = this.time();
    if (!valid || at >= lease.observedAt + MAX_AGE_MS || this.latest.get(lease.scopeKey) !== lease.token) {
      lease.expired = true; throw new Error("Selective review expired or changed");
    }
    return lease;
  }
  async inspect(input: SelectiveReviewRequest, signal: AbortSignal): Promise<SelectiveReviewReport> {
    const request = MemorySelectiveReview.snapshotRequest(input), scopeKey = recoveryFingerprint(request.scope), token = {};
    this.latest.set(scopeKey, token);
    const revision = this.journal.revision(request.scope.provider, request.scope.uuid), capture = await this.capture(request, revision, signal);
    if (this.latest.get(scopeKey) !== token) throw new Error("Selective review superseded");
    const ids = capture.draft.sources.map(s => s.id).sort();
    const items: SelectiveReviewItem[] = [
      ...ids.map(id => ({ id: key("source", id), sourceIds: [id], dimensions: ["exact_original_version_and_time", "coverage_and_omissions"] })),
      ...capture.draft.changes.map(c => ({ id: key(`change:${c.before.kind}`, c.before.id), sourceIds: [...c.sourceIds].sort(), dimensions: ["assertion", "validity", "summary", "patch", "all_supporting_originals"] })),
      ...capture.draft.controls.map(c => ({ id: key(`control:${c.kind}`, c.id), sourceIds: ids, dimensions: ["unchanged_exact_control", "original_support"] })),
      { id: key("context", "whole_read"), sourceIds: ids, dimensions: ["full_inventory", "excluded_sources", "no_server_fence_or_completion"] }
    ];
    const observedAt = capture.observedAt, material = { draft: capture.draft, plan: capture.plan, items };
    const report = freezeSelective({ ...material, fingerprint: recoveryFingerprint(material), observedAt, expiresAt: observedAt + MAX_AGE_MS });
    this.issued.set(report, { request, capture, token, scopeKey, observedAt, expired: false });
    this.lease(report); return report;
  }
  prepareIntent(report: SelectiveReviewReport, signal?: AbortSignal) {
    const current = () => { signal?.throwIfAborted(); this.lease(report); };
    current();
    return this.journal.prepareSelective(report.plan, this.time(), plan => { current(); return equal(plan, report.plan); });
  }
  async accept(report: SelectiveReviewReport, intentId: string, expected: number, reviewId: string, input: SelectiveReviewDecision[],
    authorized: (report: SelectiveReviewReport, reviewId: string, decisionsFingerprint: string) => boolean, signal: AbortSignal) {
    validateSelectiveJSON(input);
    const lease = this.lease(report);
    if (!hasDenseDataItems(input) || input.length !== report.items.length || typeof reviewId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(reviewId) ||
        typeof authorized !== "function" || !identifier(intentId) || !Number.isSafeInteger(expected) || expected < 0) throw new Error("Invalid selective semantic review");
    const decisions = freezeSelective(structuredClone(input));
    const byId = new Map<string, SelectiveReviewDecision>();
    for (const d of decisions) {
      if (!fields(d, ["id", "verdict", "sourceIds", "explanation"]) || typeof d.id !== "string" || byId.has(d.id) || d.verdict !== "accepted" ||
          typeof d.explanation !== "string" || !d.explanation.trim() || d.explanation.length > 4000 || !strings(d.sourceIds) ||
          new Set(d.sourceIds).size !== d.sourceIds.length) throw new Error("Every selective item needs an explicit accepted decision");
      byId.set(d.id, d);
    }
    for (const item of report.items) if (!byId.has(item.id) || !equal([...byId.get(item.id)!.sourceIds].sort(), item.sourceIds))
      throw new Error("Selective semantic review support differs");
    const decisionsFingerprint = recoveryFingerprint(decisions.map(d => ({ ...d, sourceIds: [...d.sourceIds].sort() })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const permitted = () => this.journal.selectiveRead(() => {
      this.lease(report);
      if (signal.aborted || authorized(report, reviewId, decisionsFingerprint) !== true) return false;
      this.lease(report); return !signal.aborted;
    });
    if (!permitted()) throw new Error("Selective semantic review unauthorized");
    let fresh: Capture;
    try { fresh = await this.capture(lease.request, report.plan.repairRevision, signal); }
    catch (error) { lease.expired = true; throw error; }
    if (!equal(fresh.plan, report.plan) || fresh.knowledgeFingerprint !== lease.capture.knowledgeFingerprint || fresh.sources.fingerprint !== lease.capture.sources.fingerprint) {
      lease.expired = true; throw new Error("Selective review fresh inputs changed");
    }
    if (!permitted()) throw new Error("Selective semantic review unauthorized");
    const receiptFingerprint = recoveryFingerprint({ schema: "selective-semantic-review-v1", reviewId, planFingerprint: recoveryFingerprint(report.plan),
      knowledgeFingerprint: fresh.knowledgeFingerprint, sourcePlanFingerprint: fresh.sources.fingerprint, decisionsFingerprint });
    const result = this.journal.acceptSelectiveReview(intentId, expected, report.plan.draftFingerprint, receiptFingerprint, this.time(), plan =>
      equal(plan, report.plan) && this.ports.sources.locallyCurrent(fresh.sources) && permitted());
    return result;
  }
}
