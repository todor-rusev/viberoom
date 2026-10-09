// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import type { SqliteConnection } from "../sqlite-capabilities.js";
import { DeliveryBudgetError, MemoryDeliveryWriter, isPreparedDelivery, type Delivery, type PreparedDelivery } from "./delivery.js";
import type { MemoryOutbox } from "./outbox.js";
import type { MemoryProvider, MemoryWriteAdapter } from "./provider.js";
import { newGenerationId } from "./graph-generations.js";
import { recoveryFingerprint, type RecoveryInventory, type RecoveryScope, type RecoverySourcePlan } from "./recovery-sources.js";

export interface RecoveryItem {
  opId: string; sourceId: string; version: string; part: string; kind: "message" | "note" | "fact";
  payloadFingerprint: string; credits: number;
}
export interface RecoveryQuote {
  scope: RecoveryScope; graphId: string; copyId: string; roomName: string; sourceFingerprint: string;
  estimatedCredits: number; maxCredits: number; items: RecoveryItem[];
}
export interface RecoveryJob {
  id: string; quote: RecoveryQuote; quoteFingerprint: string; createdAt: number; updatedAt: number;
  state: "prepared" | "approved" | "building" | "paused" | "inputs_processed" | "cancelled";
  approval: { id: string; at: number } | null; reason: string | null;
}
const HASH = /^sha256:[a-f0-9]{64}$/;
const MAX_ITEMS = 10_000, MAX_BYTES = 16 * 1024 * 1024;
const time = (n: number) => { if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid recovery time"); };
function frozen<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(frozen); Object.freeze(v); } return v; }

export class MemoryRecoveryJobs {
  constructor(private readonly db: SqliteConnection, private readonly outbox: MemoryOutbox) {
    db.exec(`create table if not exists memory_recovery_job(id text primary key, provider text not null,
      room text not null, account text not null, state text not null);
      create table if not exists memory_recovery_item(job_id text not null,op_id text not null unique,primary key(job_id,op_id));`);
  }
  get(id: string): RecoveryJob | null {
    const row = this.db.prepare("select state from memory_recovery_job where id=?").get(id);
    if (!row) return null;
    const job = JSON.parse(String(row.state)) as RecoveryJob;
    if (job.id !== id || recoveryFingerprint(job.quote) !== job.quoteFingerprint) throw new Error("Recovery quote integrity check failed");
    return frozen(job);
  }
  list(room: string, after = ""): { jobs: RecoveryJob[]; next: string | null } {
    const rows = this.db.prepare("select id from memory_recovery_job where room=? and id>? order by id limit 51").all(room, after);
    const jobs = rows.slice(0, 50).map(row => this.get(String(row.id))!);
    return { jobs, next: rows.length > 50 ? jobs.at(-1)!.id : null };
  }
  private save(job: RecoveryJob): void {
    this.db.prepare("insert into memory_recovery_job values(?,?,?,?,?) on conflict(id) do update set state=excluded.state")
      .run(job.id, job.quote.scope.provider, job.quote.scope.room, job.quote.scope.account, JSON.stringify(job));
  }
  private transaction<T>(work: () => T): T {
    this.db.exec("savepoint memory_recovery_change");
    try { const result = work(); this.db.exec("release memory_recovery_change"); return result; }
    catch (error) { this.db.exec("rollback to memory_recovery_change; release memory_recovery_change"); throw error; }
  }
  prepare(plan: RecoverySourcePlan, writes: MemoryWriteAdapter, roomName: string, maxCredits: number, now: number, current: () => boolean): RecoveryJob {
    time(now);
    if (current() !== true) throw new Error("Recovery source lease changed");
    if (plan.state !== "ready" || !plan.inventoryFingerprint || !HASH.test(plan.fingerprint) || !HASH.test(plan.scope.account)
      || plan.scope.provider !== writes.transport.provider || !Number.isSafeInteger(maxCredits) || maxCredits < 1)
      throw new Error("Recovery requires a ready source plan and a positive credit limit");
    if (!Number.isSafeInteger(writes.episodeTextLimit) || writes.episodeTextLimit! < 1 || writes.episodeTextLimit! > MAX_BYTES)
      throw new Error("The provider has no lossless episode splitting contract");
    return this.transaction(() => {
      const id = randomUUID(), copyId = randomUUID(), graphId = newGenerationId(plan.scope.uuid, copyId);
      const room = { uuid: plan.scope.uuid, name: roomName, graphId }, items: RecoveryItem[] = [];
      let bytes = 0, estimatedCredits = 0;
      const seen = new Set<string>();
      this.outbox.deliveries.bindAccount({ provider: plan.scope.provider, roomId: plan.scope.room, roomUuid: plan.scope.uuid, copyId }, plan.scope.account);
      for (const source of plan.sources) {
        if (seen.has(source.sourceId)) throw new Error("Recovery source identity repeated");
        seen.add(source.sourceId);
        const body = source.kind === "fact" ? JSON.stringify(source.fact) : source.episode.text;
        if (Buffer.byteLength(body) > MAX_BYTES) throw new Error("Recovery source exceeds quotation size limit");
        const chars = source.kind === "fact" ? [] : [...body], size = writes.episodeTextLimit!;
        const count = source.kind === "fact" ? 1 : Math.max(1, Math.ceil(chars.length / size));
        if (items.length + count > MAX_ITEMS) throw new Error("Recovery exceeds item limit");
        for (let part = 0; part < count; part++) {
          const identity = { provider: plan.scope.provider, roomId: plan.scope.room, roomUuid: plan.scope.uuid, graphId, copyId,
            maintenanceId: id, sourceId: source.sourceId, version: source.version, part: `${part + 1}/${count}`, kind: source.kind === "fact" ? "fact" as const : "episode" as const };
          const row = this.outbox.deliveries.prepare(identity, opId => {
            if (source.kind === "fact") return { ...writes.fact(identity, opId, room, source.fact), binding: { original: { kind: "fact", fact: source.fact } } };
            const wire = writes.episode(identity, opId, room, { ...source.episode, text: chars.slice(part * size, (part + 1) * size).join("") }, source.kind);
            return { ...wire, binding: { source: { kind: source.kind, graphId, version: source.version, authorId: source.episode.authorId,
              authorName: source.episode.authorName, ts: source.episode.ts }, ...(source.kind === "note" ? { original: { kind: "note" as const, episode: source.episode } }
                : source.episode.seq === undefined ? {} : { seq: source.episode.seq }) } };
          }, now);
          if (!isPreparedDelivery(row)) throw new Error("Recovery input was erased");
          writes.transport.validate(row);
          bytes += Buffer.byteLength(JSON.stringify(row.payload)); estimatedCredits += row.payload.estimatedCredits;
          if (bytes > MAX_BYTES || !Number.isSafeInteger(estimatedCredits) || estimatedCredits > maxCredits) throw new Error("Recovery exceeds its reviewed size or credit limit");
          items.push({ opId: row.opId, sourceId: source.sourceId, version: source.version, part: identity.part, kind: source.kind,
            payloadFingerprint: recoveryFingerprint(row.payload), credits: row.payload.estimatedCredits });
          this.db.prepare("insert into memory_recovery_item values(?,?)").run(id, row.opId);
        }
      }
      const quote: RecoveryQuote = { scope: structuredClone(plan.scope), graphId, copyId, roomName,
        sourceFingerprint: plan.fingerprint, estimatedCredits, maxCredits, items };
      const job: RecoveryJob = { id, quote, quoteFingerprint: recoveryFingerprint(quote), createdAt: now, updatedAt: now,
        state: "prepared", approval: null, reason: null };
      if (current() !== true) throw new Error("Recovery source lease changed");
      this.save(job); return this.get(id)!;
    });
  }
  approve(id: string, fingerprint: string, approvalId: string, now: number): RecoveryJob {
    time(now);
    return this.transaction(() => {
      const job = this.get(id);
      if (!job || job.quoteFingerprint !== fingerprint || !/^[A-Za-z0-9_-]{1,100}$/.test(approvalId) || job.state === "cancelled"
        || job.approval && job.approval.id !== approvalId) throw new Error("Recovery approval does not match this immutable quote");
      if (!job.approval) this.save({ ...job, state: "approved", approval: { id: approvalId, at: now }, updatedAt: now });
      return this.get(id)!;
    });
  }
  spent(id: string): number {
    return Number(this.db.prepare(`select coalesce(sum(a.estimated_credits),0) credits from memory_delivery_attempt a
      join memory_recovery_item i on i.op_id=a.op_id where i.job_id=? and a.reserved=1`).get(id)!.credits);
  }
  canClaim(id: string, row: PreparedDelivery): boolean {
    const job = this.get(id), item = job?.quote.items.find(i => i.opId === row.opId);
    return !!job?.approval && job.state !== "cancelled" && !!item && this.owns(job, row) &&
      this.spent(id) + row.payload.estimatedCredits <= job.quote.maxCredits;
  }
  owns(job: RecoveryJob, row: Delivery): boolean {
    const q = job.quote, i = row.identity, item = q.items.find(item => item.opId === row.opId);
    return !!item && i.maintenanceId === job.id && i.provider === q.scope.provider && i.roomId === q.scope.room && i.roomUuid === q.scope.uuid
      && i.graphId === q.graphId && i.copyId === q.copyId && i.sourceId === item.sourceId && i.version === item.version && i.part === item.part
      && i.kind === (item.kind === "fact" ? "fact" : "episode") &&
      !!this.db.prepare("select 1 from memory_recovery_item where job_id=? and op_id=?").get(job.id, row.opId) &&
      this.outbox.deliveries.copyAccount(i) === q.scope.account && !!row.payload && row.payload.estimatedCredits === item.credits &&
      recoveryFingerprint(row.payload) === item.payloadFingerprint;
  }
  status(id: string, state: RecoveryJob["state"], reason: string | null, now: number): RecoveryJob {
    time(now);
    return this.transaction(() => {
      const job = this.get(id); if (!job) throw new Error("Recovery job not found");
      if (job.state !== "cancelled" && job.approval) this.save({ ...job, state, reason, updatedAt: now });
      return this.get(id)!;
    });
  }
  cancel(id: string, now: number): void {
    time(now);
    this.transaction(() => {
      const job = this.get(id); if (!job || job.state === "cancelled") return;
      for (const item of job.quote.items) this.outbox.deliveries.retire(item.opId, "recovery_cancelled", now);
      this.save({ ...job, state: "cancelled", reason: "cancelled", updatedAt: now });
    });
  }
  cancelRoom(room: string, provider?: string): void {
    for (const row of this.db.prepare(`select id from memory_recovery_job where room=?${provider === undefined ? "" : " and provider=?"}`)
      .all(room, ...(provider === undefined ? [] : [provider]))) this.cancel(String(row.id), Date.now());
  }
}

interface BuildPorts {
  outbox: MemoryOutbox; provider: MemoryProvider; now(): number; monthlyCap(): number;
  authorized(job: RecoveryJob): boolean;
  inspect(job: RecoveryJob, signal: AbortSignal): Promise<RecoverySourcePlan>;
  current(plan: RecoverySourcePlan): boolean;
}
export class MemoryRecoveryBuilder {
  private readonly running = new Set<string>();
  constructor(private readonly ports: BuildPorts) {}
  async run(id: string, signal: AbortSignal, maxItems = 16): Promise<RecoveryJob> {
    if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 100) throw new Error("Invalid recovery batch size");
    const requestedSignal = signal;
    signal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    const { outbox, provider, now } = this.ports, jobs = outbox.recovery;
    let job = jobs.get(id); if (!job) throw new Error("Recovery job not found");
    if (this.running.has(id)) return job;
    const eligible = () => {
      const saved = jobs.get(id);
      return !!saved && saved.state !== "cancelled" && !!saved.approval && saved.quoteFingerprint === job!.quoteFingerprint &&
        provider.id === saved.quote.scope.provider && provider.generations?.account === saved.quote.scope.account && this.ports.authorized(saved) === true;
    };
    const pause = (reason: string) => jobs.status(id, "paused", reason, now());
    let plan: RecoverySourcePlan | null = null;
    const guard = () => !signal.aborted && eligible() && !!plan && this.ports.current(plan) === true;
    const fresh = async () => {
      if (signal.aborted || !eligible()) return false;
      plan = await this.ports.inspect(job!, signal);
      if (!guard() || plan.state !== "ready") return false;
      if (plan.fingerprint !== job!.quote.sourceFingerprint || recoveryFingerprint(plan.scope) !== recoveryFingerprint(job!.quote.scope)) {
        jobs.cancel(id, now()); return false;
      }
      return true;
    };
    if (!eligible() || !provider.writes?.transport.recoveryInventory || !provider.recovery) return pause("authorization_or_adapter_unavailable");
    this.running.add(id);
    try {
      if (!await fresh()) return pause("sources_or_attachment_unavailable");
      const writer = new MemoryDeliveryWriter(outbox.deliveries, now, () => false,
        row => guard() && jobs.owns(job!, row), undefined, row => guard() && jobs.canClaim(id, row));
      jobs.status(id, "building", null, now());
      await provider.recovery.ensureCandidate({ uuid: job.quote.scope.uuid, name: job.quote.roomName, graphId: job.quote.graphId }, signal, guard);
      if (!await fresh()) return pause("sources_or_attachment_changed");
      const inventory = async () => {
        const found = await provider.writes!.transport.recoveryInventory!(job!.quote.scope.uuid, signal, now, job!.quote.graphId);
        if (!guard() || !await this.observeCandidate(job!, found, signal, guard)) return false;
        return true;
      };
      if (!await inventory()) return pause("candidate_inventory_unverified");
      let count = 0;
      for (const item of job.quote.items) {
        let row = outbox.deliveries.get(item.opId)!;
        if (row.state === "unknown") row = outbox.deliveries.releaseUndispatched(row.opId, row.attempts, now())!;
        if (row.state === "processed" && jobs.owns(job, row)) continue;
        if (++count > maxItems) break;
        if (!await fresh() || !await inventory()) return pause("source_or_candidate_changed");
        if (!guard() || !jobs.owns(job, row)) return pause("input_erased_or_permission_changed");
        await writer.deliver(item.opId, provider.writes.transport, { signal, creditCap: this.ports.monthlyCap() });
        if (!guard()) return pause("permission_or_sources_changed");
        const saved = outbox.deliveries.get(item.opId)!;
        if (["conflict", "duplicates", "rejected"].includes(saved.state)) return pause(`delivery_${saved.state}`);
        if (saved.state === "unknown") return pause("delivery_uncertain");
        if (saved.state === "prepared") return pause("delivery_not_claimed");
      }
      if (!await fresh() || !await inventory()) return pause("final_input_observation_unverified");
      const processed = job.quote.items.every(item => outbox.deliveries.get(item.opId)?.state === "processed");
      return jobs.status(id, processed ? "inputs_processed" : "building", processed ? "derived_knowledge_not_verified" : "inputs_pending", now());
    } catch (error) { return pause(signal.aborted ? requestedSignal.aborted ? "interrupted" : "build_deadline" : error instanceof DeliveryBudgetError ? "monthly_budget_reached" : "build_io_failed"); }
    finally { this.running.delete(id); }
  }
  private async observeCandidate(job: RecoveryJob, inventory: RecoveryInventory, signal: AbortSignal, guard: () => boolean): Promise<boolean> {
    if (inventory.state !== "complete" || inventory.unexplained.length) return false;
    const { outbox, now } = this.ports, byOp = new Map(job.quote.items.map(item => [item.opId, item]));
    const seen = new Set<string>();
    for (const entry of [...inventory.episodes, ...inventory.facts]) {
      const item = entry.opId && byOp.get(entry.opId);
      if (!item || seen.has(item.opId) || entry.copyId !== job.quote.copyId || entry.sourceId !== item.sourceId || entry.version !== item.version
        || entry.part !== item.part || ("kind" in entry ? entry.kind !== item.kind || entry.legacy : item.kind !== "fact")) return false;
      seen.add(item.opId);
    }
    for (const entry of [...inventory.episodes, ...inventory.facts]) {
      const row = outbox.deliveries.get(entry.opId!)!;
      if (!outbox.recovery.owns(job, row) || row.attempts < 1) return false;
      let ids = "receiptIds" in entry ? entry.receiptIds : [entry.id];
      if ("receiptIds" in entry) {
        if (row.externalIds.length) {
          if (row.externalIds.some(id => !ids.includes(id))) return false;
          ids = [...row.externalIds];
        } else if (ids.length > 1) return false;
      }
      if (row.state === "processed") {
        if (!entry.processed || row.externalIds.some(id => !ids.includes(id))) return false;
        continue;
      }
      if (entry.processed && ids.length) {
        const transport = this.ports.provider.writes!.transport;
        if (!transport.episodePresence || await transport.episodePresence(entry.id, signal) !== "present" || !guard()) return false;
        if ("receiptIds" in entry) for (const id of ids)
          if (!transport.factPresence || await transport.factPresence(id, signal) !== "present" || !guard()) return false;
        const latest = outbox.deliveries.get(row.opId)!;
        if (!outbox.recovery.owns(job, latest) || latest.attempts !== row.attempts) return false;
        outbox.deliveries.observe(row.opId, { state: "processed", externalIds: ids }, now(), row.attempts);
      }
    }
    return job.quote.items.every(item => {
      const row = outbox.deliveries.get(item.opId)!;
      return row.state !== "processed" || seen.has(item.opId);
    });
  }
}
