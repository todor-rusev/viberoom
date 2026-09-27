// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { DatabaseSync } from "node:sqlite";
import type { AskedQuestions } from "./questions.js";

export type MemoryOpKind = "fact" | "note" | "forget" | "reingest" | "forget-room";

export interface MemoryOp {
  id: number;
  provider: string;
  room: string;
  kind: MemoryOpKind;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
}

export const OP_ATTEMPT_LIMIT = 8;

export class MemoryOutbox {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`create table if not exists memory_cursor(
        provider text not null, room text not null, seq integer not null,
        primary key(provider, room));
      create table if not exists memory_episode_map(
        provider text not null, room text not null, source_id text not null, external_id text not null,
        primary key(provider, room, source_id, external_id));
      create table if not exists memory_ops(
        id integer primary key, provider text not null, room text not null, kind text not null,
        payload text not null, created_at integer not null, attempts integer not null default 0);
      create index if not exists idx_memory_ops_provider on memory_ops(provider, id);
      create table if not exists memory_usage(
        provider text not null, month text not null, credits integer not null,
        primary key(provider, month));
      create table if not exists memory_message_brief(
        provider text not null, room text not null, seq integer not null, lines text not null, asked text not null,
        primary key(provider, room, seq));
      drop table if exists memory_brief;
      drop table if exists memory_brief_asked;`);
  }

  addUsage(provider: string, month: string, credits: number): void {
    if (credits <= 0) return;
    this.db.prepare(`insert into memory_usage values(?,?,?)
      on conflict(provider, month) do update set credits = credits + excluded.credits`).run(provider, month, credits);
  }

  usage(provider: string, month: string): number {
    const row = this.db.prepare("select credits from memory_usage where provider=? and month=?").get(provider, month);
    return row ? Number(row.credits) : 0;
  }

  cursor(provider: string, room: string): number {
    const row = this.db.prepare("select seq from memory_cursor where provider=? and room=?").get(provider, room);
    return row ? Number(row.seq) : 0;
  }

  hasCursor(provider: string, room: string): boolean {
    return !!this.db.prepare("select 1 from memory_cursor where provider=? and room=?").get(provider, room);
  }

  advance(provider: string, room: string, seq: number): void {
    this.db.prepare(`insert into memory_cursor values(?,?,?)
      on conflict(provider, room) do update set seq=excluded.seq where excluded.seq > memory_cursor.seq`).run(provider, room, seq);
  }

  resetCursor(provider: string, room: string, seq = 0): void {
    this.db.prepare(`insert into memory_cursor values(?,?,?)
      on conflict(provider, room) do update set seq=excluded.seq`).run(provider, room, seq);
  }

  mapEpisode(provider: string, room: string, sourceId: string, externalId: string): void {
    this.db.prepare("insert or ignore into memory_episode_map values(?,?,?,?)").run(provider, room, sourceId, externalId);
  }

  episodeIds(provider: string, room: string, sourceId: string): string[] {
    return this.db.prepare("select external_id from memory_episode_map where provider=? and room=? and source_id=?")
      .all(provider, room, sourceId).map(r => String(r.external_id));
  }

  dropEpisodes(provider: string, room: string, sourceId: string): void {
    this.db.prepare("delete from memory_episode_map where provider=? and room=? and source_id=?").run(provider, room, sourceId);
  }

  enqueue(provider: string, room: string, kind: MemoryOpKind, payload: Record<string, unknown>): void {
    this.db.prepare("insert into memory_ops(provider, room, kind, payload, created_at) values(?,?,?,?,?)")
      .run(provider, room, kind, JSON.stringify(payload), Date.now());
  }

  ops(provider: string, limit = 16): MemoryOp[] {
    return this.db.prepare("select * from memory_ops where provider=? order by id limit ?").all(provider, limit).map(r => ({
      id: Number(r.id), provider: String(r.provider), room: String(r.room), kind: String(r.kind) as MemoryOpKind,
      payload: JSON.parse(String(r.payload)) as Record<string, unknown>, createdAt: Number(r.created_at), attempts: Number(r.attempts),
    }));
  }

  opDone(id: number): void {
    this.db.prepare("delete from memory_ops where id=?").run(id);
  }

  opFailed(id: number): boolean {
    this.db.prepare("update memory_ops set attempts = attempts + 1 where id=?").run(id);
    const row = this.db.prepare("select attempts from memory_ops where id=?").get(id);
    if (!row || Number(row.attempts) < OP_ATTEMPT_LIMIT) return false;
    this.db.prepare("delete from memory_ops where id=?").run(id);
    return true;
  }

  pending(provider: string): { ops: number } {
    const row = this.db.prepare("select count(*) as n from memory_ops where provider=?").get(provider);
    return { ops: row ? Number(row.n) : 0 };
  }

  saveBrief(provider: string, room: string, seq: number, lines: string[], asked: AskedQuestions, keep: number): void {
    this.db.prepare(`insert into memory_message_brief values(?,?,?,?,?)
      on conflict(provider, room, seq) do update set lines=excluded.lines, asked=excluded.asked`).run(provider, room, seq, JSON.stringify(lines), JSON.stringify(asked));
    this.db.prepare(`delete from memory_message_brief where provider=? and room=? and seq not in
      (select seq from memory_message_brief where provider=? and room=? order by seq desc limit ?)`).run(provider, room, provider, room, keep);
  }

  brief(provider: string, room: string, seq: number): { lines: string[]; asked: AskedQuestions } | null {
    const row = this.db.prepare("select lines, asked from memory_message_brief where provider=? and room=? and seq=?").get(provider, room, seq);
    if (!row) return null;
    try {
      return { lines: (JSON.parse(String(row.lines)) as string[]).map(String), asked: JSON.parse(String(row.asked)) as AskedQuestions };
    } catch { return null; }
  }

  clearRoomData(provider: string, room: string): void {
    this.db.prepare("delete from memory_cursor where provider=? and room=?").run(provider, room);
    this.db.prepare("delete from memory_episode_map where provider=? and room=?").run(provider, room);
    this.db.prepare("delete from memory_message_brief where provider=? and room=?").run(provider, room);
  }

  dropRoom(provider: string, room: string): void {
    this.clearRoomData(provider, room);
    this.db.prepare("delete from memory_ops where provider=? and room=?").run(provider, room);
  }
}
