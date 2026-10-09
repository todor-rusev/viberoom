// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { SqliteConnection } from "../sqlite-capabilities.js";

export interface DeliveryWatchPolicy { firstMs: number; intervalsMs: readonly number[]; horizonMs: number }
export const DELIVERY_WATCH_POLICY: Readonly<DeliveryWatchPolicy> = Object.freeze({
  firstMs: 60_000,
  intervalsMs: Object.freeze([5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000]),
  horizonMs: 7 * 24 * 60 * 60_000,
});

export type DeliveryWatchState = "active" | "expired" | "resolved";
export interface DeliveryWatch {
  state: DeliveryWatchState;
  startedAt: number;
  deadlineAt: number;
  checks: number;
  nextAt: number | null;
  requested: boolean;
  lastCheckAt: number | null;
  lastResult: string | null;
}

export class MemoryDeliveryWatch {
  constructor(private readonly db: SqliteConnection, readonly policy: Readonly<DeliveryWatchPolicy> = DELIVERY_WATCH_POLICY) {
    if (![policy.firstMs, policy.horizonMs, ...policy.intervalsMs].every(ms => Number.isSafeInteger(ms) && ms > 0) || !policy.intervalsMs.length)
      throw new Error("Invalid delivery watch policy");
    db.exec(`create table if not exists memory_delivery_watch(
      op_id text primary key, started_at integer not null, deadline_at integer not null,
      state text not null, checks integer not null default 0, next_at integer,
      requested integer not null default 0, last_check_at integer, last_result text);
      create index if not exists memory_delivery_watch_due on memory_delivery_watch(state,next_at);`);
  }

  get(opId: string): DeliveryWatch | null {
    const r = this.db.prepare("select * from memory_delivery_watch where op_id=?").get(opId);
    return r ? { state: String(r.state) as DeliveryWatchState, startedAt: Number(r.started_at), deadlineAt: Number(r.deadline_at),
      checks: Number(r.checks), nextAt: r.next_at === null ? null : Number(r.next_at), requested: r.requested === 1,
      lastCheckAt: r.last_check_at === null ? null : Number(r.last_check_at), lastResult: r.last_result === null ? null : String(r.last_result) } : null;
  }

  start(opId: string, at: number, firstAt = at + this.policy.firstMs): void {
    this.db.prepare(`insert into memory_delivery_watch(op_id,started_at,deadline_at,state,checks,next_at,requested,last_check_at,last_result)
      values(?,?,?,'active',0,?,0,null,null) on conflict(op_id) do update set started_at=excluded.started_at,deadline_at=excluded.deadline_at,
      state='active',checks=0,next_at=excluded.next_at,requested=0,last_check_at=null,last_result=null`)
      .run(opId, at, at + this.policy.horizonMs, firstAt);
  }

  ensure(opId: string, anchor: number, now: number): void {
    const deadline = anchor + this.policy.horizonMs, expired = now >= deadline;
    this.db.prepare("insert or ignore into memory_delivery_watch(op_id,started_at,deadline_at,state,next_at) values(?,?,?,?,?)")
      .run(opId, anchor, deadline, expired ? "expired" : "active", expired ? null : anchor + this.policy.firstMs);
  }

  request(opId: string): boolean {
    return this.db.prepare("update memory_delivery_watch set requested=1 where op_id=?").run(opId).changes === 1;
  }

  begin(opId: string, now: number): boolean {
    const w = this.get(opId);
    if (!w) return false;
    const scheduled = w.state === "active" && w.nextAt !== null && w.nextAt <= now;
    if (!scheduled && !w.requested) return false;
    let { state, nextAt, checks } = w;
    if (scheduled) {
      const last = w.nextAt! >= w.deadlineAt || now >= w.deadlineAt;
      const gap = this.policy.intervalsMs[Math.min(w.checks, this.policy.intervalsMs.length - 1)];
      state = last ? "expired" : "active"; nextAt = last ? null : Math.min(w.deadlineAt, now + gap); checks++;
    }
    this.db.prepare("update memory_delivery_watch set state=?,next_at=?,checks=?,requested=0,last_check_at=?,last_result='check_interrupted' where op_id=?")
      .run(state, nextAt, checks, now, opId);
    return true;
  }

  result(opId: string, result: string, now: number): void {
    this.db.prepare("update memory_delivery_watch set last_check_at=?,last_result=? where op_id=?").run(now, result.slice(0, 500), opId);
  }

  continueAt(opId: string, at: number): void {
    if (!Number.isSafeInteger(at)) throw new Error("Invalid continuation time");
    this.db.prepare("update memory_delivery_watch set next_at=min(next_at,deadline_at,?) where op_id=? and state='active' and next_at is not null")
      .run(at, opId);
  }

  close(opId: string): void {
    this.db.prepare("update memory_delivery_watch set state='resolved',next_at=null,requested=0 where op_id=?").run(opId);
  }
}
