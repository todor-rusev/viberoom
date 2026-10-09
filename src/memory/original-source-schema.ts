// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { SqliteConnection } from "../sqlite-capabilities.js";
import { isDeepStrictEqual } from "node:util";
import { baseGenerationId } from "./graph-generations.js";

export interface OriginalReceiptNamespace {
  provider: string; account: string | null; roomId: string; roomUuid: string;
  copyId: string; sourceId: string; version: string; graphId?: string;
}
export function ensureOriginalSourceSchema(db: SqliteConnection): void {
  db.exec(`create table if not exists memory_original_source_receipt(
    receipt_id text primary key, namespace_key text not null unique,
    provider text not null, account text not null, room text not null, uuid text not null,
    graph_id text not null, copy_id text not null, source_id text not null, version text not null,
    descriptor text not null, descriptor_hash text not null, state text not null,
    reason text, committed_at integer not null, updated_at integer not null);
    create table if not exists memory_original_source_member(
      receipt_id text not null, namespace_key text not null, external_id text not null,
      descriptor text not null, descriptor_hash text not null,
      primary key(receipt_id,external_id));
    create index if not exists memory_original_source_scope on memory_original_source_receipt(provider,room,source_id);
    create index if not exists memory_original_source_member_scope on memory_original_source_member(namespace_key);
    create table if not exists memory_original_source_selection(room text not null,source_id text not null,revision integer not null,
      primary key(room,source_id));
    create table if not exists memory_original_observation_claim(
      receipt_id text primary key, claim_id text not null, claimed_at integer not null, deadline_at integer not null,
      finished_at integer, outcome text);`);
}
export function originalSourceSelected(db: SqliteConnection, room: string, sourceId: string): void {
  db.prepare(`insert into memory_original_source_selection values(?,?,1) on conflict(room,source_id)
    do update set revision=revision+1`).run(room, sourceId);
}
export function originalNamespaceKey(scope: OriginalReceiptNamespace): string {
  return JSON.stringify([scope.provider, scope.account, scope.roomId, scope.roomUuid,
    scope.graphId ?? baseGenerationId(scope.roomUuid), scope.copyId, scope.sourceId, scope.version]);
}
export function originalReceiptOccupied(db: SqliteConnection, scope: OriginalReceiptNamespace): boolean {
  const key = originalNamespaceKey(scope);
  return !!db.prepare(`select 1 from memory_original_source_receipt where namespace_key=?
    or (provider=? and room=? and uuid=? and source_id=?) union all
    select 1 from memory_original_source_member where namespace_key=? or
    (json_extract(namespace_key,'$[0]')=? and json_extract(namespace_key,'$[2]')=? and
      json_extract(namespace_key,'$[3]')=? and json_extract(namespace_key,'$[6]')=?) limit 1`)
    .get(key, scope.provider, scope.roomId, scope.roomUuid, scope.sourceId,
      key, scope.provider, scope.roomId, scope.roomUuid, scope.sourceId);
}
export function invalidateOriginalSourceReceipts(db: SqliteConnection, where: { room: string; provider?: string;
  sourceId?: string; account?: string; externalIds?: readonly string[] }, reason: string, now = Date.now()): void {
  let condition = "room=?"; const values: Array<string | number> = [where.room];
  if (where.provider !== undefined) { condition += " and provider=?"; values.push(where.provider); }
  if (where.sourceId !== undefined) { condition += " and source_id=?"; values.push(where.sourceId); }
  if (where.account !== undefined) { condition += " and account=?"; values.push(where.account); }
  if (where.externalIds) {
    if (!where.externalIds.length) return;
    condition += ` and receipt_id in (select receipt_id from memory_original_source_member where external_id in (${where.externalIds.map(() => "?").join(",")}))`;
    values.push(...where.externalIds);
  }
  db.exec("savepoint memory_original_invalidation");
  try {
    const receipts = db.prepare(`select * from memory_original_source_receipt where ${condition}`).all(...values);
    const active = receipts.filter(row => row.state === "active");
    const watches = active.map(row => ({ id: `original:${String(row.receipt_id)}`,
      before: db.prepare("select * from memory_delivery_watch where op_id=?").get(`original:${String(row.receipt_id)}`) }));
    const watchById = new Map(watches.map(watch => [watch.id, watch]));
    const claims = db.prepare(`select receipt_id from memory_original_observation_claim where receipt_id in
      (select receipt_id from memory_original_source_receipt where ${condition})`).all(...values);
    const before = Number(db.prepare("select total_changes() n").get()!.n);
    const removedClaims = db.prepare(`delete from memory_original_observation_claim where receipt_id in
      (select receipt_id from memory_original_source_receipt where ${condition})`).run(...values).changes;
    if (Number(removedClaims) !== claims.length) throw new Error("original_observation_invalidation_claim_delta");
    for (const row of active) {
      const id = String(row.receipt_id);
      if (Number(db.prepare("update memory_original_source_receipt set state='invalidated',reason=?,updated_at=? where receipt_id=? and state='active'")
        .run(reason, now, id).changes) !== 1) throw new Error("original_observation_invalidation_receipt_delta");
      const watch = watchById.get(`original:${id}`)!;
      if (Number(db.prepare("update memory_delivery_watch set state='resolved',next_at=null,requested=0 where op_id=?")
        .run(watch.id).changes) !== (watch.before ? 1 : 0)) throw new Error("original_observation_invalidation_watch_delta");
    }
    const expectedChanges = claims.length + active.length + watches.filter(watch => watch.before !== undefined).length;
    if (Number(db.prepare("select total_changes() n").get()!.n) !== before + expectedChanges)
      throw new Error("original_observation_invalidation_sql_delta");
    for (const row of receipts) {
      const expected = { ...row, ...(row.state === "active" ? { state: "invalidated", reason, updated_at: now } : {}) };
      const actual = db.prepare("select * from memory_original_source_receipt where receipt_id=?").get(String(row.receipt_id));
      if (!actual || !isDeepStrictEqual({ ...actual }, expected)) throw new Error("original_observation_invalidation_receipt_state");
      if (db.prepare("select 1 from memory_original_observation_claim where receipt_id=?").get(String(row.receipt_id)))
        throw new Error("original_observation_invalidation_claim_state");
    }
    for (const watch of watches) {
      const actual = db.prepare("select * from memory_delivery_watch where op_id=?").get(watch.id);
      const expected = watch.before ? { ...watch.before, state: "resolved", next_at: null, requested: 0 } : undefined;
      if (!isDeepStrictEqual(actual ? { ...actual } : undefined, expected)) throw new Error("original_observation_invalidation_watch_state");
    }
    db.exec("release memory_original_invalidation");
  } catch (error) { db.exec("rollback to memory_original_invalidation; release memory_original_invalidation"); throw error; }
}
