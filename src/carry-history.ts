// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ChatMessage } from "./room.js";
import { canonicalResourceFile } from "./files.js";

export interface CarryRevision { revision: string; id: string; hash: string; parents: string[] }
export interface CarryHead { id: string; revision: string; hash: string }
export interface CarryAlternative { revision: string; message: ChatMessage; deletedAt: number | null }

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => [k, stable((value as Record<string, unknown>)[k])]));
  return value;
}

export function carryHash(message: ChatMessage, deletedAt: number | null = null): string {
  const { seq: _seq, displayOrder: _order, bodyDelivery: _delivery, bodyEdit: _edit, streaming: _streaming, branch: _branch, resourceRefs, ...content } = message;
  if (content.quotes) content.quotes = content.quotes.map(({ originSeq, id: _id, ...quote }) => ({ ...quote, seq: originSeq ?? quote.seq }));
  if (content.images) content.images = content.images.map(({ sha256, ...image }) => sha256 ? { ...image, file: canonicalResourceFile(image.file, sha256) } : image);
  const overrides = (resourceRefs ?? []).map(ref => ({ source: ref.source, file: ref.sha256 ? canonicalResourceFile(ref.file, ref.sha256) : ref.file }))
    .filter(ref => ref.file !== ref.source.split(/[\\/]/).at(-1)).sort((a, b) => a.source.localeCompare(b.source));
  return createHash("sha256").update(JSON.stringify(stable({ content: { ...content, ...(overrides.length ? { resourceRefs: overrides } : {}) }, deleted: deletedAt !== null }))).digest("hex");
}

export function carryRevision(id: string, hash: string, parents: string[] = []): CarryRevision {
  parents = [...new Set(parents)].sort();
  const h = createHash("sha256").update(JSON.stringify(["viberoom-state-v1", id, hash, parents])).digest("hex");
  return { revision: `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`, id, hash, parents };
}

export class CarryHistory {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      create table if not exists carry_revisions(room text not null, revision text not null, id text not null, hash text not null, parents text not null, primary key(room, revision));
      create index if not exists carry_revision_message on carry_revisions(room, id);
      create table if not exists carry_heads(room text not null, id text not null, revision text not null, hash text not null, primary key(room,id));
      create table if not exists carry_alternatives(room text not null, revision text not null, body text not null, deleted_at integer, primary key(room,revision));
      create table if not exists carry_room_aliases(room text not null, uuid text not null unique, primary key(room,uuid));
      create table if not exists carry_sources(uuid text primary key, label text not null);
      create table if not exists carry_resources(room text not null,file text not null,hash text not null,primary key(room,file));
    `);
  }

  head(room: string, id: string): CarryHead | undefined {
    return this.db.prepare("select id, revision, hash from carry_heads where room=? and id=?").get(room, id) as unknown as CarryHead | undefined;
  }
  heads(room: string): CarryHead[] { return this.db.prepare("select id,revision,hash from carry_heads where room=?").all(room) as unknown as CarryHead[]; }

  private putRevision(room: string, revision: CarryRevision): void {
    const existing = this.db.prepare("select id,hash,parents from carry_revisions where room=? and revision=?").get(room, revision.revision);
    const parents = JSON.stringify([...new Set(revision.parents)].sort());
    if (existing && (existing.id !== revision.id || existing.hash !== revision.hash || existing.parents !== parents)) throw new Error("The archive reuses a revision identity for different content.");
    this.db.prepare("insert or ignore into carry_revisions(room,revision,id,hash,parents) values(?,?,?,?,?)").run(room, revision.revision, revision.id, revision.hash, parents);
  }

  acceptHead(room: string, head: CarryHead): void {
    const revision = this.db.prepare("select id,hash from carry_revisions where room=? and revision=?").get(room, head.revision);
    if (!revision || revision.id !== head.id || revision.hash !== head.hash) throw new Error("The archive has a head without its matching revision.");
    this.db.prepare("insert into carry_heads(room,id,revision,hash) values(?,?,?,?) on conflict(room,id) do update set revision=excluded.revision,hash=excluded.hash").run(room, head.id, head.revision, head.hash);
  }

  record(room: string, message: ChatMessage, deletedAt: number | null = null, parents?: string[]): CarryHead {
    const hash = carryHash(message, deletedAt), held = this.head(room, message.id);
    if (parents === undefined && held?.hash === hash) return held;
    const node = carryRevision(message.id, hash, parents ?? (held ? [held.revision] : []));
    const { parents: _parents, ...head } = node;
    this.putRevision(room, node);
    this.acceptHead(room, head);
    return head;
  }

  ensure(room: string, message: ChatMessage, deletedAt: number | null = null): CarryHead { return this.record(room, message, deletedAt); }

  revisions(room: string): CarryRevision[] {
    return this.db.prepare("select revision,id,hash,parents from carry_revisions where room=?").all(room).map(r => ({ revision: String(r.revision), id: String(r.id), hash: String(r.hash), parents: JSON.parse(String(r.parents)) }));
  }

  importRevisions(room: string, revisions: CarryRevision[]): void {
    const all = new Map(this.revisions(room).map(r => [r.revision, r]));
    for (const r of revisions) {
      if (!r || !/^[0-9a-f-]{36}$/.test(r.revision) || typeof r.id !== "string" || !r.id || !/^[0-9a-f]{64}$/.test(r.hash) || !Array.isArray(r.parents) || r.parents.some(p => typeof p !== "string") || r.parents.length > 32) throw new Error("The archive has an invalid revision.");
      const old = all.get(r.revision);
      if (old && (old.id !== r.id || old.hash !== r.hash || JSON.stringify([...old.parents].sort()) !== JSON.stringify([...r.parents].sort()))) throw new Error("The archive reuses a revision identity for different content.");
      all.set(r.revision, r);
    }
    const done = new Set<string>(), active = new Set<string>();
    for (const r of all.values()) {
      const stack: { id: string; leave: boolean }[] = [{ id: r.revision, leave: false }];
      while (stack.length) {
        const step = stack.pop()!;
        if (step.leave) { active.delete(step.id); done.add(step.id); continue; }
        if (done.has(step.id)) continue;
        if (active.has(step.id)) throw new Error("The archive has a cycle in its revision history.");
        const node = all.get(step.id)!;
        active.add(step.id);
        stack.push({ id: step.id, leave: true });
        for (const parent of node.parents) {
          if (!all.has(parent) || all.get(parent)!.id !== node.id) throw new Error("The archive has a missing or unrelated revision parent.");
          stack.push({ id: parent, leave: false });
        }
      }
    }
    for (const revision of revisions) this.putRevision(room, revision);
  }

  archive(room: string, alternative: CarryAlternative): void {
    this.db.prepare("insert into carry_alternatives(room,revision,body,deleted_at) values(?,?,?,?) on conflict(room,revision) do update set body=excluded.body,deleted_at=excluded.deleted_at").run(room, alternative.revision, JSON.stringify(alternative.message), alternative.deletedAt);
  }

  alternatives(room: string): CarryAlternative[] {
    return this.db.prepare("select revision,body,deleted_at from carry_alternatives where room=? order by rowid").all(room).map(r => ({ revision: String(r.revision), message: JSON.parse(String(r.body)), deletedAt: r.deleted_at === null ? null : Number(r.deleted_at) }));
  }

  removedPage(room: string, offset: number): { items: { key: string; fromName: string; ts: number; text: string }[]; more: boolean } {
    const items = this.db.prepare(`select * from (
      select 'grave:' || id as key, author_name as fromName, ts, substr(text,1,200) as text from messages where room=? and deleted_at is not null
      union all
      select 'variant:' || revision as key, json_extract(body,'$.fromName') as fromName, json_extract(body,'$.ts') as ts, substr(json_extract(body,'$.text'),1,200) as text from carry_alternatives where room=?
    ) order by ts desc,key limit 51 offset ?`).all(room, room, offset) as unknown as { key: string; fromName: string; ts: number; text: string }[];
    return { items: items.slice(0, 50), more: items.length > 50 };
  }

  removedRecord(room: string, key: string): { message: ChatMessage; deletedAt: number | null } | null {
    const grave = key.startsWith("grave:"), variant = key.startsWith("variant:");
    if (!grave && !variant) return null;
    const row = grave
      ? this.db.prepare("select body,deleted_at from messages where room=? and id=? and deleted_at is not null").get(room, key.slice(6))
      : this.db.prepare("select body,deleted_at from carry_alternatives where room=? and revision=?").get(room, key.slice(8));
    return row ? { message: JSON.parse(String(row.body)), deletedAt: row.deleted_at === null ? null : Number(row.deleted_at) } : null;
  }

  aliases(room: string): string[] { return this.db.prepare("select uuid from carry_room_aliases where room=?").all(room).map(r => String(r.uuid)); }
  addAliases(room: string, ids: string[]): void {
    for (const id of ids) {
      const owner = this.db.prepare("select room from carry_room_aliases where uuid=?").get(id);
      if (owner && owner.room !== room) throw new Error("This identity already belongs to another room. Choose that room instead.");
      this.db.prepare("insert or ignore into carry_room_aliases(room,uuid) values(?,?)").run(room, id);
    }
  }
  sources(): { uuid: string; label: string }[] { return this.db.prepare("select uuid,label from carry_sources").all() as unknown as { uuid: string; label: string }[]; }
  source(uuid: string, label: string): void { this.db.prepare("insert into carry_sources(uuid,label) values(?,?) on conflict(uuid) do update set label=excluded.label").run(uuid, label); }
  resource(room: string, file: string, hash: string): void { this.db.prepare("insert into carry_resources(room,file,hash) values(?,?,?) on conflict(room,file) do update set hash=excluded.hash").run(room, file, hash); }
  resources(room: string): Record<string, string> { return Object.fromEntries(this.db.prepare("select file,hash from carry_resources where room=?").all(room).map(r => [String(r.file), String(r.hash)])); }
  drop(room: string): void { for (const table of ["carry_revisions", "carry_heads", "carry_alternatives", "carry_room_aliases", "carry_resources"]) this.db.prepare(`delete from ${table} where room=?`).run(room); }
}

export function ancestor(revisions: ReadonlyMap<string, CarryRevision>, older: string, newer: string): boolean {
  const seen = new Set<string>(), pending = [newer];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === older) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const parent of revisions.get(id)?.parents ?? []) pending.push(parent);
  }
  return false;
}
