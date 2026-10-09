// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { SqliteConnection } from "../sqlite-capabilities.js";
import type { MemoryOutbox } from "./outbox.js";
import type { RecoveryJob } from "./recovery-jobs.js";
import type { RecoveryKnowledge } from "./recovery-knowledge.js";
import { recoveryFingerprint, type RecoveryIssue, type RecoverySourcePlan } from "./recovery-sources.js";
import type { RecoveryScope } from "./recovery-sources.js";
import type { RecoveryRepairReceipt } from "./repair-journal.js";

type CompleteKnowledge = Extract<RecoveryKnowledge, { state: "complete" }>;
export interface RecoveryReviewItem {
  id: string; kind: "fact" | "node" | "source" | "repair"; sourceIds: string[];
  dimensions: string[];
}
export interface RecoveryReviewDecision {
  id: string; verdict: "accepted" | "rejected" | "unresolved"; explanation: string; sourceIds: string[];
}
export interface RecoveryReviewReceipt {
  jobId: string; reviewId: string; at: number; quoteFingerprint: string; reportFingerprint: string;
  sourceFingerprint: string; knowledgeFingerprint: string; repairFingerprint: string; decisionsFingerprint: string;
}
export interface RecoveryVerificationReport {
  state: "blocked" | "review_required"; jobId: string; quoteFingerprint: string; fingerprint: string;
  sources: RecoverySourcePlan | null; knowledge: CompleteKnowledge | null;
  repair: ReturnType<MemoryOutbox["repairContext"]> | null;
  blockers: RecoveryIssue[]; items: RecoveryReviewItem[];
}
const sorted = (ids: string[]) => [...new Set(ids)].sort();
const equal = (a: unknown, b: unknown) => recoveryFingerprint(a) === recoveryFingerprint(b);
const freeze = <T>(v: T): T => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
function instant(value: string): bigint | null {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const check = new Date(0); check.setUTCFullYear(year, month - 1, day); check.setUTCHours(hour, minute, second, 0);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || check.getUTCHours() !== hour
    || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second || match[8] !== "Z" && (+match[8].slice(1, 3) > 23 || +match[8].slice(4) > 59)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? BigInt(parsed) * 1_000_000n + BigInt((match[7] ?? "").padEnd(9, "0").slice(3)) : null;
}

export class MemoryRecoveryVerification {
  private readonly issued = new WeakMap<RecoveryVerificationReport, () => boolean>();
  private readonly latest = new Map<string, object>();
  constructor(private readonly db: SqliteConnection, private readonly outbox: MemoryOutbox) {
    db.exec("create table if not exists memory_recovery_review(job_id text primary key,receipt text not null)");
  }
  private repair(job: RecoveryJob): NonNullable<RecoveryVerificationReport["repair"]> {
    return this.outbox.repairContext(job.quote.scope.provider, job.quote.scope.uuid);
  }
  private issue(report: RecoveryVerificationReport, current: () => boolean): RecoveryVerificationReport {
    const token = {}; this.latest.set(report.jobId, token);
    this.issued.set(report, () => this.latest.get(report.jobId) === token && current()); return report;
  }
  inspect(job: RecoveryJob, plan: RecoverySourcePlan, knowledge: RecoveryKnowledge, current: () => boolean): RecoveryVerificationReport {
    if (current() !== true) {
      const contents = { jobId: job.id, quoteFingerprint: job.quoteFingerprint, sources: null, knowledge: null, repair: null,
        blockers: [{ reason: "attachment_permission_or_job_changed" }], items: [] };
      return this.issue(freeze({ ...contents, state: "blocked", fingerprint: recoveryFingerprint(contents) }), () => false);
    }
    const blockers: RecoveryIssue[] = [], items: RecoveryReviewItem[] = [];
    const block = (reason: string, externalId?: string) => blockers.push({ reason, ...(externalId ? { externalId } : {}) });
    const repair = this.repair(job), repairFingerprint = recoveryFingerprint(repair);
    const rowSnapshot = () => job.quote.items.map(i => this.outbox.deliveries.get(i.opId));
    const rows = rowSnapshot(), rowsFingerprint = recoveryFingerprint(rows);
    const localCurrent = () => current() === true && equal(this.outbox.recovery.get(job.id), job)
      && recoveryFingerprint(rowSnapshot()) === rowsFingerprint && recoveryFingerprint(this.repair(job)) === repairFingerprint;
    const finish = (): RecoveryVerificationReport => {
      const denied = !localCurrent();
      if (denied) block("attachment_permission_or_job_changed");
      const contents = { jobId: job.id, quoteFingerprint: job.quoteFingerprint, sources: denied ? null : plan,
        knowledge: denied || knowledge.state !== "complete" ? null : knowledge, repair: denied ? null : repair,
        blockers, items: denied || blockers.length ? [] : items };
      const { knowledge: snapshot, ...rest } = contents;
      const material = snapshot ? { graphId: snapshot.graphId, fingerprint: snapshot.fingerprint } : null;
      const report = freeze(structuredClone({ ...contents, state: blockers.length ? "blocked" as const : "review_required" as const,
        fingerprint: recoveryFingerprint({ ...rest, knowledge: material }) }));
      return this.issue(report, localCurrent);
    };
    if (!localCurrent()) return finish();
    if (job.state !== "inputs_processed" || !job.approval) block("candidate_inputs_not_completed");
    if (plan.state !== "ready" || plan.fingerprint !== job.quote.sourceFingerprint || !equal(plan.scope, job.quote.scope)) block("source_plan_changed_or_blocked");
    if (repair.captures.state === "unknown") block(repair.captures.reason);
    if (knowledge.state === "unknown") { block(`knowledge_${knowledge.reason}`); return finish(); }
    if (knowledge.graphId !== job.quote.graphId) block("candidate_graph_mismatch");
    if (knowledge.fingerprint !== recoveryFingerprint({ graphId: knowledge.graphId, episodes: knowledge.episodes, edges: knowledge.edges, nodes: knowledge.nodes }))
      block("knowledge_fingerprint_mismatch");
    const episodeSources = new Map<string, string>(), episodes = new Map(knowledge.episodes.map(e => [e.id, e]));
    const nodes = new Map(knowledge.nodes.map(n => [n.id, n])), edges = new Map(knowledge.edges.map(e => [e.id, e]));
    const entries = [...knowledge.inventory.episodes, ...knowledge.inventory.facts];
    const byOp = new Map(job.quote.items.map((item, index) => [item.opId, { item, row: rows[index] }]));
    if (knowledge.episodes.length > 10000 || knowledge.edges.length > 10000 || knowledge.nodes.length > 10000) block("knowledge_item_limit");
    if (episodes.size !== knowledge.episodes.length || nodes.size !== knowledge.nodes.length || edges.size !== knowledge.edges.length) block("knowledge_identity_repeated");
    if (knowledge.inventory.unexplained.length || entries.length !== job.quote.items.length || episodes.size !== entries.length) block("candidate_inputs_unexplained_or_missing");
    const seen = new Set<string>();
    for (const entry of entries) {
      const { item, row } = byOp.get(entry.opId ?? "") ?? {}, episode = episodes.get(entry.id);
      if (!item || seen.has(item.opId) || !row || !this.outbox.recovery.owns(job, row) || row.state !== "processed" || !row.attempts || row.retiredAt !== null
        || entry.copyId !== job.quote.copyId || entry.sourceId !== item.sourceId || entry.version !== item.version || entry.part !== item.part
        || ("kind" in entry ? entry.kind : "fact") !== item.kind || !entry.processed || !episode?.processed) {
        block("candidate_input_identity_or_delivery", entry.id); continue;
      }
      seen.add(item.opId); episodeSources.set(entry.id, item.sourceId);
      if (!equal(episode.metadata, row.payload!.request.metadata)) block("candidate_input_metadata_changed", entry.id);
      if (item.kind !== "fact" && (episode.content !== row.payload!.request.data || episode.source !== row.payload!.request.type)) block("candidate_original_changed", entry.id);
      const receipts = "receiptIds" in entry ? entry.receiptIds : [entry.id];
      if (!row.externalIds.length || row.externalIds.some(id => !receipts.includes(id))) block("candidate_receipt_missing", entry.id);
    }
    if (seen.size !== job.quote.items.length) block("candidate_parts_missing");
    for (const episode of knowledge.episodes) if (instant(episode.createdAt) === null) block("episode_time_invalid", episode.id);
    const nodeSupport = new Map<string, Set<string>>();
    for (const edge of knowledge.edges) {
      if (!edge.fact.trim() || !edge.name.trim() || !nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) block("fact_or_endpoints_invalid", edge.id);
      if (!edge.episodeIds.length || edge.episodeIds.some(id => !episodeSources.has(id)) || sorted(edge.episodeIds).length !== edge.episodeIds.length) block("fact_provenance_invalid", edge.id);
      if (instant(edge.createdAt) === null || [edge.validAt, edge.invalidAt, edge.expiredAt].some(v => v !== null && instant(v) === null)) block("fact_time_invalid", edge.id);
      if (edge.validAt !== null && edge.invalidAt !== null && instant(edge.validAt)! > instant(edge.invalidAt)!) block("fact_interval_reversed", edge.id);
      const sourceIds = sorted(edge.episodeIds.map(id => episodeSources.get(id)!).filter(Boolean));
      for (const id of [edge.sourceNodeId, edge.targetNodeId]) {
        const group = nodeSupport.get(id) ?? new Set<string>(); sourceIds.forEach(s => group.add(s)); nodeSupport.set(id, group);
      }
      items.push({ id: `fact:${edge.id}`, kind: "fact", sourceIds,
        dimensions: ["assertion", "validity_start_end_expiry", "supporting_originals", "attributes"] });
    }
    for (const node of knowledge.nodes) {
      if (!node.name.trim() || instant(node.createdAt) === null) block("node_identity_or_time_invalid", node.id);
      items.push({ id: `node:${node.id}`, kind: "node", sourceIds: [...nodeSupport.get(node.id) ?? []].sort(),
        dimensions: ["entity_identity", "summary", "labels_and_attributes", "support_not_proved_by_incident_edges"] });
    }
    for (const source of plan.sources) items.push({ id: `source:${source.sourceId}`, kind: "source", sourceIds: [source.sourceId],
      dimensions: ["coverage_and_omissions", "contradictions_and_temporal_changes", "explicit_no_knowledge_if_applicable"] });
    items.push({ id: "repair:whole_graph", kind: "repair", sourceIds: plan.sources.map(s => s.sourceId),
      dimensions: ["all_captured_impacts", "unknown_or_unscoped_impacts", "excluded_source_residue", "no_old_new_uuid_equivalence"] });
    return finish();
  }

  accept(report: RecoveryVerificationReport, reviewId: string, decisions: RecoveryReviewDecision[], now: number,
    authorized: (report: RecoveryVerificationReport, reviewId: string, decisionsFingerprint: string) => boolean): RecoveryReviewReceipt {
    const current = this.issued.get(report);
    if (!current || !current() || report.state !== "review_required" || !/^[A-Za-z0-9_-]{1,100}$/.test(reviewId)
      || !Number.isSafeInteger(now) || now < 0) throw new Error("Recovery review is not authorized or current");
    decisions = freeze(structuredClone(decisions));
    const byId = new Map(decisions.map(d => [d.id, d])), sources = new Set(report.sources!.sources.map(s => s.sourceId));
    if (decisions.length !== report.items.length || byId.size !== decisions.length || Buffer.byteLength(JSON.stringify(decisions)) > 16 * 1024 * 1024
      || report.items.some(item => {
        const d = byId.get(item.id);
        return !d || d.verdict !== "accepted" || typeof d.explanation !== "string" || !d.explanation.trim() || d.explanation.length > 4000
          || !Array.isArray(d.sourceIds) || sorted(d.sourceIds).length !== d.sourceIds.length || d.sourceIds.some(id => !sources.has(id))
          || item.sourceIds.some(id => !d.sourceIds.includes(id)) || item.kind === "node" && !d.sourceIds.length;
      })) throw new Error("Every recovery review item needs an explicit supported decision");
    const receipt: RecoveryReviewReceipt = { jobId: report.jobId, reviewId, at: now, quoteFingerprint: report.quoteFingerprint,
      reportFingerprint: report.fingerprint, sourceFingerprint: report.sources!.fingerprint, knowledgeFingerprint: report.knowledge!.fingerprint,
      repairFingerprint: recoveryFingerprint(report.repair), decisionsFingerprint: recoveryFingerprint([...decisions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
    if (authorized(report, reviewId, receipt.decisionsFingerprint) !== true) throw new Error("Recovery review is not authorized or current");
    if (!current() || authorized(report, reviewId, receipt.decisionsFingerprint) !== true || !current()) throw new Error("Recovery review lease changed");
    this.db.prepare("insert into memory_recovery_review values(?,?) on conflict(job_id) do update set receipt=excluded.receipt").run(report.jobId, JSON.stringify(receipt));
    return freeze(receipt);
  }
  current(report: RecoveryVerificationReport): boolean { return this.issued.get(report)?.() === true; }
  matchingReview(report: RecoveryVerificationReport): RecoveryReviewReceipt | null {
    if (report.state !== "review_required" || this.issued.get(report)?.() !== true) return null;
    const receipt = this.receipt(report.jobId);
    if (!receipt) return null;
    return receipt.jobId === report.jobId && receipt.reportFingerprint === report.fingerprint && receipt.quoteFingerprint === report.quoteFingerprint
      && receipt.sourceFingerprint === report.sources?.fingerprint && receipt.knowledgeFingerprint === report.knowledge?.fingerprint
      && receipt.repairFingerprint === recoveryFingerprint(report.repair) ? freeze(receipt) : null;
  }
  receipt(jobId: string): RecoveryReviewReceipt | null {
    const row = this.db.prepare("select receipt from memory_recovery_review where job_id=?").get(jobId);
    return row ? freeze(JSON.parse(String(row.receipt)) as RecoveryReviewReceipt) : null;
  }

  complete(report: RecoveryVerificationReport, scope: RecoveryScope & { graphId: string }, switchId: string, now: number,
    current: () => boolean): RecoveryRepairReceipt {
    const review = this.matchingReview(report), job = this.outbox.recovery.get(report.jobId);
    if (!review || !job || !report.knowledge || !report.repair || scope.provider !== job.quote.scope.provider || scope.account !== job.quote.scope.account
      || scope.room !== job.quote.scope.room || scope.uuid !== job.quote.scope.uuid || scope.graphId !== job.quote.graphId)
      throw new Error("A fresh accepted recovery review is required.");
    const receipt: RecoveryRepairReceipt = { scope, jobId: job.id, switchId, at: now, repairRevision: report.repair.revision,
      quoteFingerprint: job.quoteFingerprint, reportFingerprint: report.fingerprint, sourceFingerprint: review.sourceFingerprint,
      knowledgeFingerprint: review.knowledgeFingerprint, reviewFingerprint: recoveryFingerprint(review), repairFingerprint: review.repairFingerprint };
    return this.outbox.repairs.record(receipt, () => current() === true && recoveryFingerprint(this.matchingReview(report)) === receipt.reviewFingerprint
      && recoveryFingerprint(this.repair(job)) === receipt.repairFingerprint);
  }
}
