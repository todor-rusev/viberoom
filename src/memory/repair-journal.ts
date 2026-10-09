// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { SQLOutputValue } from "node:sqlite";
import type { SqliteConnection } from "../sqlite-capabilities.js";
import type { RecoveryScope } from "./recovery-sources.js";
import { recoveryFingerprint } from "./recovery-sources.js";
import { randomUUID } from "node:crypto";
import { isAsyncFunction } from "node:util/types";
import { freezeSelective, selectiveDigest, validateSelectiveIntent, validateSelectivePlan, validateSelectiveScope,
  type SelectiveRepairIntent, type SelectiveRepairPlan, type SelectiveRepairScope } from "./selective-repair-intent.js";
import { MemorySelectiveReview, type SelectiveReviewPorts } from "./selective-repair-review.js";
import { SqlReadOnlyFence, SqlReadOnlyViolation, sqliteTotalChanges } from "./sql-read-only-fence.js";

export interface RecoveryRepairReceipt {
  scope: RecoveryScope & { graphId: string };
  jobId: string; switchId: string; at: number; repairRevision: number;
  quoteFingerprint: string; reportFingerprint: string; sourceFingerprint: string;
  knowledgeFingerprint: string; reviewFingerprint: string; repairFingerprint: string;
}
const hash = (v: string) => /^sha256:[a-f0-9]{64}$/.test(v);
const freeze = <T>(v: T): T => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
type SelectiveWrite = (statement: () => { changes: number | bigint }) => void;

export class MemoryRepairJournal {
  private selectiveChanging = false;
  private readonly selectiveReads: SqlReadOnlyFence;
  selectiveReview(ports: SelectiveReviewPorts): MemorySelectiveReview { return new MemorySelectiveReview(this, ports); }
  selectiveScopeReadable(scope: SelectiveRepairScope): boolean {
    validateSelectiveScope(scope); return this.selectiveScopeCurrent(scope) === true;
  }
  constructor(private readonly db: SqliteConnection, private readonly current: (receipt: RecoveryRepairReceipt) => boolean,
    private readonly selectiveScopeCurrent: (scope: SelectiveRepairScope) => boolean = () => false) {
    this.selectiveReads = new SqlReadOnlyFence(db);
    db.exec(`create table if not exists memory_repair_revision(provider text not null,uuid text not null,revision integer not null,
      primary key(provider,uuid));
      create table if not exists memory_recovery_repair(provider text not null,account text not null,room text not null,uuid text not null,
      graph_id text not null,revision text not null,receipt text not null,primary key(provider,account,room,uuid,graph_id,revision));`);
    db.exec(`create table if not exists memory_selective_repair_intent(
      id text primary key,provider text not null,account text not null,room text not null,uuid text not null,
      graph_id text not null,revision text not null,plan_fingerprint text not null,checkpoint integer not null,
      state text not null,state_fingerprint text not null,
      unique(provider,account,room,uuid,graph_id,revision,plan_fingerprint));
      create index if not exists memory_selective_repair_room on memory_selective_repair_intent(provider,room);
      create unique index if not exists memory_selective_repair_plan on memory_selective_repair_intent(plan_fingerprint);`);
    for (const table of ["memory_graph_repair", "memory_episode_impact", "memory_artifact_repair"]) {
      const tick = (row: "old" | "new") => `insert into memory_repair_revision values(${row}.provider,${row}.uuid,1)
        on conflict(provider,uuid) do update set revision=revision+1;`;
      db.exec(`create trigger if not exists ${table}_repair_insert before insert on ${table} begin ${tick("new")} end;
        create trigger if not exists ${table}_repair_delete after delete on ${table} begin ${tick("old")} end;
        create trigger if not exists ${table}_repair_update after update on ${table} begin ${tick("old")} end;
        create trigger if not exists ${table}_repair_move after update on ${table}
        when old.provider!=new.provider or old.uuid!=new.uuid begin ${tick("new")} end;`);
    }
  }
  selectiveRead<R>(callback: () => R): R {
    try { return this.selectiveReads.read(callback); }
    catch (error) {
      if (error instanceof SqlReadOnlyViolation) throw new Error("Unexpected selective repair SQL changes", { cause: error });
      throw error;
    }
  }
  private selectiveTransaction<T>(work: (write: SelectiveWrite, read: <R>(callback: () => R) => R) => T): T {
    if (this.selectiveChanging) throw new Error("Selective repair change is already running");
    this.selectiveChanging = true;
    try {
      return this.selectiveReads.preserveConnection(ownerCurrent => {
        let opened = false;
        try {
          this.db.exec("savepoint memory_selective_repair_change"); opened = true;
          const changes = () => sqliteTotalChanges(this.db);
          const schema = () => [this.db.prepare("pragma main.schema_version").get()!.schema_version,
            this.db.prepare("pragma temp.schema_version").get()!.schema_version];
          const before = changes(), versions = schema(); let expected = 0n;
          const fence = () => {
            if (changes() !== before + expected || schema().some((v, i) => v !== versions[i]))
              throw new Error("Unexpected selective repair SQL changes");
          };
          const write: SelectiveWrite = statement => {
            fence();
            if (expected !== 0n) throw new Error("Unexpected additional selective repair write");
            const { changes: affected } = statement();
            if (affected !== 1 && affected !== 1n) throw new Error("Selective repair checkpoint changed");
            expected = 1n; fence();
          };
          const read = <R>(callback: () => R): R => { fence(); const answer = this.selectiveRead(callback); fence(); return answer; };
          const result = work(write, read); fence();
          if (!ownerCurrent()) throw new Error("Unexpected selective repair SQL state before local commit");
          this.db.exec("release memory_selective_repair_change"); opened = false; return result;
        } catch (error) {
          if (opened) this.db.exec("rollback to memory_selective_repair_change; release memory_selective_repair_change");
          throw error;
        }
      });
    } finally { this.selectiveChanging = false; }
  }
  private selectiveCurrent(plan: SelectiveRepairPlan, current: (plan: Readonly<SelectiveRepairPlan>) => boolean): boolean {
    if (typeof current !== "function" || isAsyncFunction(current) || current(plan) !== true) return false;
    return this.selectiveScopeCurrent(plan.scope) === true && plan.repairRevision === this.revision(plan.scope.provider, plan.scope.uuid);
  }
  private selectiveWrite(value: SelectiveRepairIntent, expected: number, write: SelectiveWrite): SelectiveRepairIntent {
    validateSelectiveIntent(value);
    write(() => this.db.prepare(`update memory_selective_repair_intent set checkpoint=?,state=?,state_fingerprint=? where id=? and checkpoint=?`)
      .run(value.checkpoint, JSON.stringify(value), recoveryFingerprint(value), value.id, expected));
    return freezeSelective(structuredClone(value));
  }
  private selectiveUnchanged(value: SelectiveRepairIntent): void {
    const saved = this.selectiveIntent(value.id);
    if (!saved || recoveryFingerprint(saved) !== recoveryFingerprint(value)) throw new Error("Selective repair checkpoint changed before local commit");
  }
  selectiveIntent(id: string): SelectiveRepairIntent | null {
    const row = this.db.prepare("select * from memory_selective_repair_intent where id=?").get(id);
    if (!row) return null;
    return this.decodeSelectiveRow(row);
  }
  private decodeSelectiveRow(row: Record<string, SQLOutputValue>): SelectiveRepairIntent {
    const value = JSON.parse(String(row.state)) as SelectiveRepairIntent; validateSelectiveIntent(value);
    const s = value.plan.scope;
    if (row.id !== value.id || row.provider !== s.provider || row.account !== s.account || row.room !== s.room || row.uuid !== s.uuid ||
        row.graph_id !== s.graphId || row.revision !== s.revision || row.plan_fingerprint !== value.planFingerprint ||
        row.checkpoint !== value.checkpoint || row.state_fingerprint !== recoveryFingerprint(value))
      throw new Error("Selective repair intent integrity check failed");
    return freezeSelective(value);
  }
  private findSelectivePlan(fingerprint: string): SelectiveRepairIntent | null {
    let existing: SelectiveRepairIntent | null = null;
    for (const row of this.db.prepare("select * from memory_selective_repair_intent").iterate()) {
      const saved = this.decodeSelectiveRow(row);
      if (saved.planFingerprint === fingerprint) {
        if (existing) throw new Error("Duplicate selective repair plan");
        existing = saved;
      }
    }
    return existing;
  }
  prepareSelective(plan: SelectiveRepairPlan, at: number, current: (plan: Readonly<SelectiveRepairPlan>) => boolean): SelectiveRepairIntent {
    validateSelectivePlan(plan);
    const snapshot = freezeSelective(structuredClone(plan)); validateSelectivePlan(snapshot);
    if (!Number.isSafeInteger(at) || at < 0) throw new Error("Invalid selective preparation time");
    return this.selectiveTransaction((write, read) => {
      const valid = () => read(() => this.selectiveCurrent(snapshot, current));
      if (!valid()) throw new Error("Selective repair source, scope or revision changed");
      const s = snapshot.scope, fingerprint = recoveryFingerprint(snapshot);
      const existing = this.findSelectivePlan(fingerprint);
      if (existing) {
        if (!valid()) throw new Error("Selective repair changed"); this.selectiveUnchanged(existing); return existing;
      }
      const value: SelectiveRepairIntent = { id: randomUUID(), plan: snapshot, planFingerprint: fingerprint,
        checkpoint: 0, createdAt: at, updatedAt: at, cancelledAt: null, semantic: { state: "pending" },
        admission: { state: "not_requested" }, completion: { state: "not_started" } };
      validateSelectiveIntent(value);
      write(() => this.db.prepare("insert into memory_selective_repair_intent values(?,?,?,?,?,?,?,?,?,?,?)")
        .run(value.id, s.provider, s.account, s.room, s.uuid, s.graphId, s.revision, fingerprint, 0, JSON.stringify(value), recoveryFingerprint(value)));
      if (!valid()) throw new Error("Selective repair changed before local commit");
      this.selectiveUnchanged(value);
      return freezeSelective(structuredClone(value));
    });
  }
  private changeSelective(id: string, expected: number, at: number, current: (plan: Readonly<SelectiveRepairPlan>) => boolean,
    change: (saved: SelectiveRepairIntent) => SelectiveRepairIntent): SelectiveRepairIntent {
    return this.selectiveTransaction((write, read) => {
      const saved = this.selectiveIntent(id);
      if (!saved || saved.checkpoint !== expected || saved.cancelledAt !== null || !Number.isSafeInteger(at) || at < saved.updatedAt)
        throw new Error("Selective repair is missing, cancelled or changed");
      const valid = () => read(() => this.selectiveCurrent(saved.plan, current));
      if (!valid()) throw new Error("Selective repair source, scope or revision changed");
      const next = change(saved);
      const result = next === saved ? saved : this.selectiveWrite({ ...next, checkpoint: saved.checkpoint + 1, updatedAt: at }, saved.checkpoint, write);
      if (!valid()) throw new Error("Selective repair changed before local commit");
      this.selectiveUnchanged(result);
      return result;
    });
  }
  acceptSelectiveReview(id: string, expected: number, draftFingerprint: string, receiptFingerprint: string, at: number,
    current: (plan: Readonly<SelectiveRepairPlan>) => boolean): SelectiveRepairIntent {
    if (!selectiveDigest(receiptFingerprint)) throw new Error("Invalid selective review fingerprint");
    return this.changeSelective(id, expected, at, current, saved => {
      if (saved.plan.draftFingerprint !== draftFingerprint) throw new Error("Selective review names another draft");
      if (saved.semantic.state === "accepted") {
        if (saved.semantic.receiptFingerprint !== receiptFingerprint) throw new Error("Selective review already recorded");
        return saved;
      }
      return { ...saved, semantic: { state: "accepted", receiptFingerprint, at }, admission: { state: "not_requested" } };
    });
  }
  requestSelectiveAdmission(id: string, expected: number, at: number,
    current: (plan: Readonly<SelectiveRepairPlan>) => boolean): SelectiveRepairIntent {
    return this.changeSelective(id, expected, at, current, saved => {
      const reason = saved.semantic.state === "accepted" ? "native_conditional_write_and_worker_barrier_unverified" : "exact_semantic_review_missing";
      return saved.admission.state === "held" && saved.admission.reason === reason ? saved : { ...saved, admission: { state: "held", reason } };
    });
  }
  inspectSelective(id: string, current: (plan: Readonly<SelectiveRepairPlan>) => boolean) {
    const saved = this.selectiveIntent(id);
    const reason = !saved ? "intent_missing" : saved.cancelledAt !== null ? "intent_cancelled" :
      !this.selectiveRead(() => this.selectiveCurrent(saved.plan, current)) ? "local_scope_source_or_revision_changed" :
      saved.semantic.state !== "accepted" ? "exact_semantic_review_missing" : "native_conditional_write_and_worker_barrier_unverified";
    return freezeSelective({ intent: saved, executionAllowed: false as const, completionAllowed: false as const, reason });
  }
  cancelSelective(id: string, expected: number, at: number): SelectiveRepairIntent {
    return this.selectiveTransaction(write => {
      const saved = this.selectiveIntent(id);
      if (!saved || saved.checkpoint !== expected || !Number.isSafeInteger(at) || at < saved.updatedAt) throw new Error("Selective cancellation changed");
      const result = saved.cancelledAt !== null ? saved : this.selectiveWrite({ ...saved, checkpoint: saved.checkpoint + 1, updatedAt: at, cancelledAt: at }, expected, write);
      this.selectiveUnchanged(result); return result;
    });
  }
  dropSelectiveRoom(provider: string, room: string): void {
    this.db.prepare("delete from memory_selective_repair_intent where provider=? and room=?").run(provider, room);
  }
  dropSelectiveGraph(provider: string, uuid: string, account: string | null | undefined): void {
    if (!selectiveDigest(account)) return;
    this.db.prepare("delete from memory_selective_repair_intent where provider=? and uuid=? and account=?").run(provider, uuid, account);
  }
  revision(provider: string, uuid: string): number {
    const row = this.db.prepare("select revision from memory_repair_revision where provider=? and uuid=?").get(provider, uuid);
    const value = row ? Number(row.revision) : 0;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("The repair revision is unavailable.");
    return value;
  }
  private keys(scope: RecoveryScope): [string, string, string, string, string, string] {
    return [scope.provider, scope.account, scope.room, scope.uuid, scope.graphId ?? "", scope.revision];
  }
  receipt(scope: RecoveryScope): RecoveryRepairReceipt | null {
    const row = this.db.prepare(`select receipt from memory_recovery_repair where provider=? and account=? and room=? and uuid=? and graph_id=? and revision=?`)
      .get(...this.keys(scope));
    return row ? freeze(JSON.parse(String(row.receipt)) as RecoveryRepairReceipt) : null;
  }
  covered(scope: RecoveryScope): boolean {
    const r = this.receipt(scope);
    return !!r && recoveryFingerprint(r.scope) === recoveryFingerprint(scope) && r.repairRevision === this.revision(scope.provider, scope.uuid)
      && this.current(r) === true;
  }
  record(receipt: RecoveryRepairReceipt, current: () => boolean): RecoveryRepairReceipt {
    const r = freeze(structuredClone(receipt));
    if (!Object.values(r.scope).every(v => typeof v === "string" && !!v) || !hash(r.scope.account) || !r.scope.graphId
      || !Number.isSafeInteger(r.at) || r.at < 0 || !Number.isSafeInteger(r.repairRevision) || r.repairRevision < 0
      || !r.jobId || !r.switchId || [r.quoteFingerprint, r.reportFingerprint, r.sourceFingerprint, r.knowledgeFingerprint, r.reviewFingerprint, r.repairFingerprint].some(v => !hash(v)))
      throw new Error("Invalid recovery repair receipt.");
    const valid = () => current() === true && this.current(r) === true && r.repairRevision === this.revision(r.scope.provider, r.scope.uuid);
    this.db.exec("savepoint memory_repair_completion");
    try {
      if (!valid()) throw new Error("The reviewed recovery or repair revision changed.");
      this.db.prepare(`insert into memory_recovery_repair values(?,?,?,?,?,?,?)
        on conflict(provider,account,room,uuid,graph_id,revision) do update set receipt=excluded.receipt`).run(...this.keys(r.scope), JSON.stringify(r));
      if (!valid()) throw new Error("The reviewed recovery or repair revision changed.");
      this.db.exec("release memory_repair_completion"); return r;
    } catch (e) { this.db.exec("rollback to memory_repair_completion; release memory_repair_completion"); throw e; }
  }
}
