// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { DatabaseSync } from "node:sqlite";

export type CardKind = "proposal" | "new-room";
export interface StoredCard { kind: CardKind; key: string; body: unknown }

export class RoomCards {
  constructor(private readonly db: DatabaseSync) {
    db.exec("create table if not exists room_cards(room text not null, key text not null, kind text not null, ts integer not null, body text not null, primary key(room, key))");
  }

  save(roomId: string, kind: CardKind, key: string, ts: number, body: unknown): void {
    this.db.prepare(
      `insert into room_cards(room, key, kind, ts, body) values (?, ?, ?, ?, ?)
       on conflict(room, key) do update set kind = excluded.kind, ts = excluded.ts, body = excluded.body`,
    ).run(roomId, key, kind, ts, JSON.stringify(body));
  }

  list(roomId: string): StoredCard[] {
    return (this.db.prepare("select kind, key, body from room_cards where room = ? order by ts, key").all(roomId) as Record<string, unknown>[])
      .map((r) => ({ kind: String(r.kind) as CardKind, key: String(r.key), body: JSON.parse(String(r.body)) }));
  }

  drop(roomId: string): void {
    this.db.prepare("delete from room_cards where room = ?").run(roomId);
  }
}
