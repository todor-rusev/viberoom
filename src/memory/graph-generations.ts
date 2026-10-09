// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import { isAsyncFunction } from "node:util/types";
import type { SqliteConnection } from "../sqlite-capabilities.js";
import { MemoryProviderError } from "./provider.js";

export const GENERATION_SETTLE_MS = 20_000;
export const GENERATION_RETIRE_MS = 7 * 24 * 60 * 60_000;
export interface GenerationNamespace { provider: string; account: string; uuid: string }
export interface GenerationRoute { graphId: string; epoch: number; copy: string | null }
export interface GenerationHead {
  revision: string; route: GenerationRoute | null; checkedAt: number | null; reason: string | null; followPending: boolean;
}
export interface GenerationRecord {
  graphId: string; firstSeenAt: number; unnamedSince: number | null;
  deletion: "idle" | "started" | "blocked" | "failed" | "confirmed"; reason: string | null;
}
export interface GenerationSwitch {
  id: string; wanted: GenerationRoute; previous: GenerationRoute; sourceFingerprint: string; approvalId: string;
  createdAt: number; state: "prepared" | "dispatched" | "waiting" | "uncertain" | "confirmed" | "superseded" | "blocked";
  settleAt: number | null; reason: string | null;
}
export interface GenerationTransport {
  readonly account: string;
  readAnchor(uuid: string, signal?: AbortSignal): Promise<{ description: string | null } | null>;
  present(graphId: string, signal?: AbortSignal): Promise<boolean>;
  list(uuid: string, signal?: AbortSignal): Promise<string[]>;
  point(uuid: string, route: GenerationRoute, signal?: AbortSignal): Promise<void>;
  readonly retirement?: {
    remove(uuid: string, graphId: string, expected: GenerationRoute, signal?: AbortSignal): Promise<"removed" | "pointer_changed">;
  };
}

export class GenerationError extends MemoryProviderError {
  constructor(readonly reason: string, retryable = false) { super(`Memory graph coordination: ${reason}`, retryable); this.name = "GenerationError"; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const component = (value: string) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
function namespace(n: GenerationNamespace): void {
  if (!component(n.provider) || !/^sha256:[0-9a-f]{64}$/.test(n.account) || !component(n.uuid)) throw new GenerationError("invalid_namespace");
}
export function baseGenerationId(uuid: string): string {
  if (!component(uuid)) throw new GenerationError("invalid_room_uuid");
  return `viberoom-${uuid}`;
}
export function generationOwner(uuid: string, graphId: string): string | null {
  const prefix = `${baseGenerationId(uuid)}-g-`;
  if (typeof graphId !== "string" || !graphId.startsWith(prefix)) return null;
  const rest = graphId.slice(prefix.length), nonce = rest.slice(-36), copy = rest.slice(0, -37);
  return UUID.test(nonce) && rest.at(-37) === "-" && component(copy) ? copy : null;
}
export function newGenerationId(uuid: string, copy: string): string {
  if (!component(copy)) throw new GenerationError("invalid_copy_id");
  return `${baseGenerationId(uuid)}-g-${copy}-${randomUUID()}`;
}
export const sameGenerationRoute = (a: GenerationRoute | null, b: GenerationRoute | null): boolean =>
  a === b || !!a && !!b && a.graphId === b.graphId && a.epoch === b.epoch && a.copy === b.copy;
function routeValid(uuid: string, route: GenerationRoute, legacy = true): boolean {
  if (!route || !Number.isSafeInteger(route.epoch)) return false;
  if (legacy && route.epoch === 0 && route.copy === null && route.graphId === baseGenerationId(uuid)) return true;
  return route.epoch > 0 && route.copy !== null && generationOwner(uuid, route.graphId) === route.copy;
}
export function parseGenerationPointer(uuid: string, description: string | null): GenerationRoute {
  const text = (description ?? "").trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return { graphId: baseGenerationId(uuid), epoch: 0, copy: null };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new GenerationError("invalid_generation_pointer"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || !("viberoom" in parsed)) throw new GenerationError("invalid_generation_pointer");
  const p = parsed.viberoom as Record<string, unknown>;
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== "copy,epoch,generation") throw new GenerationError("invalid_generation_pointer");
  const route = { graphId: p.generation, epoch: p.epoch, copy: p.copy } as GenerationRoute;
  if (!routeValid(uuid, route, false)) throw new GenerationError("invalid_generation_pointer");
  return route;
}
export function generationPointer(uuid: string, route: GenerationRoute): string {
  if (!routeValid(uuid, route, false)) throw new GenerationError("invalid_generation_pointer");
  return JSON.stringify({ viberoom: { generation: route.graphId, epoch: route.epoch, copy: route.copy } });
}
const clockValid = (now: number) => { if (!Number.isSafeInteger(now) || now < 0) throw new GenerationError("invalid_clock"); };
function synchronous<T>(work: () => T): T {
  if (isAsyncFunction(work)) throw new GenerationError("async_generation_transaction");
  const value = work();
  if (value && typeof (value as { then?: unknown }).then === "function") throw new GenerationError("async_generation_transaction");
  return value;
}

export class MemoryGenerationStore {
  constructor(private readonly db: SqliteConnection) {
    db.exec(`create table if not exists memory_graph_generation_head(provider text not null, account text not null, uuid text not null, state text not null, primary key(provider,account,uuid));
      create table if not exists memory_graph_generation(provider text not null, account text not null, uuid text not null, graph_id text not null, state text not null, primary key(provider,account,uuid,graph_id));
      create table if not exists memory_graph_generation_switch(provider text not null, account text not null, uuid text not null, id text not null, state text not null, primary key(provider,account,uuid,id));`);
  }
  private keys(n: GenerationNamespace): [string, string, string] { namespace(n); return [n.provider, n.account, n.uuid]; }
  transaction<T>(work: () => T): T {
    this.db.exec("savepoint memory_generation_change");
    try { const value = synchronous(work); this.db.exec("release memory_generation_change"); return value; }
    catch (error) { this.db.exec("rollback to memory_generation_change; release memory_generation_change"); throw error; }
  }
  head(n: GenerationNamespace): GenerationHead {
    const row = this.db.prepare("select state from memory_graph_generation_head where provider=? and account=? and uuid=?").get(...this.keys(n));
    return row ? JSON.parse(String(row.state)) as GenerationHead : { revision: "", route: null, checkedAt: null, reason: null, followPending: false };
  }
  private saveHead(n: GenerationNamespace, head: GenerationHead, expected: string): void {
    if (this.db.prepare(`insert into memory_graph_generation_head values(?,?,?,?) on conflict(provider,account,uuid) do update set state=excluded.state
      where json_extract(memory_graph_generation_head.state,'$.revision')=?`).run(...this.keys(n), JSON.stringify(head), expected).changes !== 1) throw new GenerationError("generation_observation_changed", true);
  }
  record(n: GenerationNamespace, graphId: string): GenerationRecord | null {
    const row = this.db.prepare("select state from memory_graph_generation where provider=? and account=? and uuid=? and graph_id=?").get(...this.keys(n), graphId);
    return row ? JSON.parse(String(row.state)) as GenerationRecord : null;
  }
  saveRecord(n: GenerationNamespace, record: GenerationRecord): void {
    if (!generationOwner(n.uuid, record.graphId)) throw new GenerationError("not_a_room_generation");
    this.db.prepare(`insert into memory_graph_generation values(?,?,?,?,?) on conflict(provider,account,uuid,graph_id) do update set state=excluded.state`)
      .run(...this.keys(n), record.graphId, JSON.stringify(record));
  }
  track(n: GenerationNamespace, graphId: string, now: number): void {
    clockValid(now); const current = this.head(n);
    if (!generationOwner(n.uuid, graphId)) throw new GenerationError("not_a_room_generation");
    if (!this.record(n, graphId)) this.saveRecord(n, { graphId, firstSeenAt: now, unnamedSince: current.route?.graphId === graphId ? null : now, deletion: "idle", reason: null });
  }
  records(n: GenerationNamespace): GenerationRecord[] {
    return this.db.prepare("select state from memory_graph_generation where provider=? and account=? and uuid=? order by graph_id").all(...this.keys(n)).map(r => JSON.parse(String(r.state)) as GenerationRecord);
  }
  observe(n: GenerationNamespace, route: GenerationRoute, now: number, onChange?: (previous: GenerationRoute | null, current: GenerationRoute) => void): GenerationHead {
    clockValid(now); if (!routeValid(n.uuid, route)) throw new GenerationError("invalid_generation_pointer");
    return this.transaction(() => {
      const prior = this.head(n), changed = !sameGenerationRoute(prior.route, route);
      const head: GenerationHead = { route, revision: changed ? randomUUID() : prior.revision, checkedAt: now, reason: null,
        followPending: prior.followPending || changed && (prior.route !== null || route.epoch !== 0) };
      if (route.epoch !== 0) this.track(n, route.graphId, now);
      for (const r of this.records(n)) {
        if (r.graphId === route.graphId) r.unnamedSince = null;
        else if (r.unnamedSince === null) r.unnamedSince = now;
        this.saveRecord(n, r);
      }
      if (changed && onChange) {
        if (isAsyncFunction(onChange)) throw new GenerationError("async_generation_transaction");
        synchronous(() => onChange(prior.route, route));
      }
      this.saveHead(n, head, prior.revision); return head;
    });
  }
  failedRead(n: GenerationNamespace, reason: string, now: number): void {
    clockValid(now); const prior = this.head(n);
    this.saveHead(n, { ...prior, checkedAt: now, reason }, prior.revision);
  }
  completeFollow(n: GenerationNamespace, revision: string, work: () => void): boolean {
    return this.transaction(() => {
      const head = this.head(n);
      if (!head.route || head.reason || head.revision !== revision || !head.followPending) return false;
      synchronous(work); this.saveHead(n, { ...head, followPending: false }, revision); return true;
    });
  }
  saveSwitch(n: GenerationNamespace, job: GenerationSwitch): void {
    if (!routeValid(n.uuid, job.wanted, false) || !routeValid(n.uuid, job.previous) || !UUID.test(job.id) || !/^sha256:[0-9a-f]{64}$/.test(job.sourceFingerprint) || !component(job.approvalId))
      throw new GenerationError("invalid_generation_switch");
    const old = this.switch(n, job.id);
    if (old && (!sameGenerationRoute(old.wanted, job.wanted) || !sameGenerationRoute(old.previous, job.previous) || old.approvalId !== job.approvalId || old.sourceFingerprint !== job.sourceFingerprint || old.createdAt !== job.createdAt))
      throw new GenerationError("generation_switch_identity_changed");
    this.db.prepare(`insert into memory_graph_generation_switch values(?,?,?,?,?) on conflict(provider,account,uuid,id) do update set state=excluded.state`)
      .run(...this.keys(n), job.id, JSON.stringify(job));
  }
  switch(n: GenerationNamespace, id: string): GenerationSwitch | null {
    const row = this.db.prepare("select state from memory_graph_generation_switch where provider=? and account=? and uuid=? and id=?").get(...this.keys(n), id);
    return row ? JSON.parse(String(row.state)) as GenerationSwitch : null;
  }
  switches(n: GenerationNamespace, graphId: string): { entries: GenerationSwitch[]; truncated: boolean } {
    const rows = this.db.prepare(`select state from memory_graph_generation_switch where provider=? and account=? and uuid=?
      and json_extract(state,'$.wanted.graphId')=? order by json_extract(state,'$.createdAt') desc,id desc limit 51`).all(...this.keys(n), graphId);
    return { entries: rows.slice(0, 50).map(row => JSON.parse(String(row.state)) as GenerationSwitch), truncated: rows.length > 50 };
  }
  claimSwitch(n: GenerationNamespace, id: string): boolean {
    return this.transaction(() => {
      if (this.switch(n, id)?.state !== "prepared") return false;
      if (this.db.prepare(`select 1 from memory_graph_generation_switch where provider=? and account=? and uuid=?
        and json_extract(state,'$.state') in ('dispatched','waiting','uncertain') limit 1`).get(...this.keys(n)))
        throw new GenerationError("generation_publication_pending", true);
      const claimed = this.db.prepare(`update memory_graph_generation_switch set state=json_set(state,'$.state','dispatched')
        where provider=? and account=? and uuid=? and id=? and json_extract(state,'$.state')='prepared'`).run(...this.keys(n), id).changes === 1;
      if (claimed) this.db.prepare(`update memory_graph_generation_switch set state=json_set(state,'$.state','blocked','$.reason','another_local_publication')
        where provider=? and account=? and uuid=? and id<>? and json_extract(state,'$.state')='prepared'`).run(...this.keys(n), id);
      return claimed;
    });
  }
  blockPrepared(n: GenerationNamespace, id: string, reason: string): boolean {
    return this.db.prepare(`update memory_graph_generation_switch set state=json_set(state,'$.state','blocked','$.reason',?)
      where provider=? and account=? and uuid=? and id=? and json_extract(state,'$.state')='prepared'`).run(reason, ...this.keys(n), id).changes === 1;
  }
}

export interface GenerationSwitchGate {
  authorized(job: GenerationSwitch, scope: GenerationNamespace): boolean;
  verified(job: GenerationSwitch, scope: GenerationNamespace, signal?: AbortSignal): Promise<boolean>;
  current(job: GenerationSwitch, scope: GenerationNamespace): boolean;
  observing?(job: GenerationSwitch, scope: GenerationNamespace): boolean;
}
export class MemoryGraphCoordinator {
  readonly scope: GenerationNamespace;
  private readonly pauses = new Map<string, { started: number; required: number }>();
  constructor(private readonly store: MemoryGenerationStore, private readonly transport: GenerationTransport,
    provider: string, uuid: string, private readonly now = Date.now,
    private readonly onChange?: (previous: GenerationRoute | null, current: GenerationRoute) => void,
    private readonly monotonic = () => performance.now()) {
    this.scope = Object.freeze({ provider, account: transport.account, uuid }); namespace(this.scope);
  }
  private pause(job: GenerationSwitch, required: number): void {
    this.pauses.set(job.id, { started: this.monotonic(), required });
    job.settleAt = this.now() + required; this.store.saveSwitch(this.scope, job);
  }
  async refresh(signal?: AbortSignal): Promise<GenerationHead> {
    try {
      signal?.throwIfAborted(); const anchor = await this.transport.readAnchor(this.scope.uuid, signal); signal?.throwIfAborted();
      if (!anchor) throw new GenerationError("generation_anchor_missing", true);
      const route = parseGenerationPointer(this.scope.uuid, anchor.description);
      if (route.epoch !== 0 && !await this.transport.present(route.graphId, signal)) throw new GenerationError("active_generation_missing", true);
      signal?.throwIfAborted();
      return this.store.observe(this.scope, route, this.now(), this.onChange);
    } catch (error) {
      this.store.failedRead(this.scope, error instanceof GenerationError ? error.reason : "generation_read_failed", this.now());
      throw error;
    }
  }
  async prepareSwitch(graphId: string, sourceFingerprint: string, approvalId: string, gate: GenerationSwitchGate, signal?: AbortSignal): Promise<GenerationSwitch> {
    const copy = generationOwner(this.scope.uuid, graphId);
    if (!copy) throw new GenerationError("not_a_room_generation");
    const head = await this.refresh(signal), previous = head.route!;
    if (previous.epoch === Number.MAX_SAFE_INTEGER) throw new GenerationError("generation_epoch_exhausted");
    const job: GenerationSwitch = { id: randomUUID(), previous, wanted: { graphId, epoch: previous.epoch + 1, copy }, sourceFingerprint, approvalId,
      createdAt: this.now(), state: "prepared", settleAt: null, reason: null };
    if (previous.graphId === graphId) throw new GenerationError("generation_already_active");
    const record = this.store.record(this.scope, graphId);
    if (record && (record.deletion !== "idle" || record.unnamedSince !== null && this.now() - record.unnamedSince >= GENERATION_RETIRE_MS)) throw new GenerationError("generation_is_retiring");
    if (!gate.authorized(job, this.scope) || !await gate.verified(job, this.scope, signal) || !gate.authorized(job, this.scope)) throw new GenerationError("generation_switch_not_authorized_or_verified");
    if (!await this.transport.present(graphId, signal)) throw new GenerationError("candidate_generation_missing");
    signal?.throwIfAborted();
    const final = await this.refresh(signal);
    if (!sameGenerationRoute(final.route, previous)) throw new GenerationError("generation_pointer_changed", true);
    if (!gate.authorized(job, this.scope) || !gate.current(job, this.scope)) throw new GenerationError("generation_switch_not_authorized_or_verified");
    this.store.transaction(() => { this.store.track(this.scope, graphId, this.now()); this.store.saveSwitch(this.scope, job); });
    return job;
  }
  async advanceSwitch(id: string, gate: GenerationSwitchGate, signal?: AbortSignal): Promise<GenerationSwitch> {
    const job = this.store.switch(this.scope, id);
    if (!job) throw new GenerationError("generation_switch_missing");
    if (["confirmed", "superseded", "blocked"].includes(job.state)) return job;
    if (job.state === "prepared") {
      try {
        if (!gate.authorized(job, this.scope)) throw new GenerationError("generation_switch_not_authorized_or_verified");
        if (!await this.transport.present(job.wanted.graphId, signal)) throw new GenerationError("candidate_generation_missing");
        const head = await this.refresh(signal);
        if (!sameGenerationRoute(head.route, job.previous)) throw new GenerationError("generation_pointer_changed");
        const record = this.store.record(this.scope, job.wanted.graphId);
        if (!record || record.deletion !== "idle" || record.unnamedSince !== null && this.now() - record.unnamedSince >= GENERATION_RETIRE_MS) throw new GenerationError("generation_is_retiring");
        if (!gate.authorized(job, this.scope) || !await gate.verified(job, this.scope, signal)) throw new GenerationError("generation_switch_not_authorized_or_verified");
        const final = await this.refresh(signal);
        if (!sameGenerationRoute(final.route, job.previous)) throw new GenerationError("generation_pointer_changed");
        if (!gate.authorized(job, this.scope) || !gate.current(job, this.scope)) throw new GenerationError("generation_switch_not_authorized_or_verified");
        signal?.throwIfAborted();
      } catch (error) {
        const reason = error instanceof GenerationError ? error.reason : "generation_preflight_failed";
        if (!this.store.blockPrepared(this.scope, job.id, reason)) return this.store.switch(this.scope, job.id)!;
        throw error;
      }
      if (this.store.switch(this.scope, job.id)?.state !== "prepared") return this.store.switch(this.scope, job.id)!;
      if (!this.store.claimSwitch(this.scope, job.id)) return this.store.switch(this.scope, job.id)!;
      job.state = "dispatched";
      try { await this.transport.point(this.scope.uuid, job.wanted, signal); job.state = "waiting"; }
      catch { job.state = "uncertain"; job.reason = "generation_pointer_write_uncertain"; }
      const saved = this.store.switch(this.scope, job.id)!;
      if (["confirmed", "superseded", "blocked"].includes(saved.state)) return saved;
      this.pause(job, GENERATION_SETTLE_MS); return job;
    }
    if (gate.observing?.(job, this.scope) === false) throw new GenerationError("generation_attachment_changed", true);
    if (!this.pauses.has(job.id)) {
      const required = job.settleAt === null ? 2 * GENERATION_SETTLE_MS : GENERATION_SETTLE_MS;
      if (job.state === "dispatched") job.state = "uncertain";
      this.pause(job, required); return job;
    }
    const pause = this.pauses.get(job.id)!, remaining = pause.required - (this.monotonic() - pause.started);
    if (remaining > 0) { job.settleAt = this.now() + Math.ceil(remaining); this.store.saveSwitch(this.scope, job); return job; }
    const head = await this.refresh(signal);
    if (gate.observing?.(job, this.scope) === false) throw new GenerationError("generation_attachment_changed", true);
    const latest = this.store.switch(this.scope, job.id)!;
    if (["confirmed", "superseded", "blocked"].includes(latest.state)) return latest;
    job.state = sameGenerationRoute(head.route, job.wanted) ? "confirmed" : "superseded";
    job.reason = job.state === "confirmed" ? null : "generation_pointer_changed";
    this.store.saveSwitch(this.scope, job);
    this.pauses.delete(job.id);
    return job;
  }
  async discover(signal?: AbortSignal): Promise<void> {
    await this.refresh(signal);
    const graphs = await this.transport.list(this.scope.uuid, signal); signal?.throwIfAborted();
    this.store.transaction(() => { for (const id of graphs) if (generationOwner(this.scope.uuid, id)) this.store.track(this.scope, id, this.now()); });
  }
  async retire(graphId: string, signal?: AbortSignal): Promise<GenerationRecord> {
    if (!generationOwner(this.scope.uuid, graphId)) throw new GenerationError("not_a_room_generation");
    const head = await this.refresh(signal), record = this.store.record(this.scope, graphId);
    if (!record) throw new GenerationError("generation_not_observed");
    if (head.route!.graphId === graphId || record.unnamedSince === null || this.now() < record.unnamedSince || this.now() - record.unnamedSince < GENERATION_RETIRE_MS)
      throw new GenerationError("generation_retirement_not_due");
    if (record.deletion === "confirmed") return record;
    if (!this.transport.retirement) {
      record.deletion = "blocked"; record.reason = "generation_retirement_protocol_unavailable";
      this.store.saveRecord(this.scope, record); throw new GenerationError(record.reason);
    }
    try {
      if (!await this.transport.present(graphId, signal)) {
        const fresh = await this.refresh(signal); signal?.throwIfAborted();
        if (fresh.route!.graphId === graphId) throw new GenerationError("generation_retirement_not_due");
        const current = this.store.record(this.scope, graphId)!;
        current.deletion = "confirmed"; current.reason = null; this.store.saveRecord(this.scope, current); return current;
      }
      const final = await this.refresh(signal); signal?.throwIfAborted();
      const current = this.store.record(this.scope, graphId)!;
      if (final.route!.graphId === graphId || current.unnamedSince === null || this.now() - current.unnamedSince < GENERATION_RETIRE_MS) throw new GenerationError("generation_retirement_not_due");
      record.deletion = "started"; this.store.saveRecord(this.scope, record);
      const removed = await this.transport.retirement.remove(this.scope.uuid, graphId, final.route!, signal);
      if (removed === "pointer_changed") throw new GenerationError("generation_retirement_pointer_raced", true);
      if (await this.transport.present(graphId, signal)) throw new GenerationError("generation_delete_unconfirmed", true);
      const after = await this.refresh(signal); signal?.throwIfAborted();
      if (after.route!.graphId === graphId) throw new GenerationError("generation_retirement_pointer_raced", true);
      record.deletion = "confirmed"; record.reason = null; this.store.saveRecord(this.scope, record); return record;
    } catch (error) {
      const latest = this.store.record(this.scope, graphId)!;
      latest.deletion = latest.unnamedSince === null && latest.deletion === "idle" ? "idle" : "failed";
      latest.reason = error instanceof GenerationError ? error.reason : "generation_delete_unconfirmed";
      this.store.saveRecord(this.scope, latest); throw error;
    }
  }
}
