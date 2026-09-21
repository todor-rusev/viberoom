// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HistoryStore } from "./history-store.js";
import { CarryHistory, carryHash, carryRevision, type CarryAlternative, type CarryHead, type CarryRevision } from "./carry-history.js";
import { readCarry, writeCarry } from "./carry-format.js";
import { readExport, validateExportContents, type ExportContents, type ExportPartName } from "./export-file.js";
import { roomForExport, type ExportChoice } from "./export-room.js";
import { isIdentity } from "./identity.js";
import { canonicalResourceFile, isRoomResourceName, isStoredFileName } from "./files.js";
import type { ChatMessage } from "./room.js";
import type { CarryState, MergeInput } from "./carry-merge.js";
import { validateDependencies } from "./carry-dependencies.js";

export interface PortableRoom {
  uuid: string; id: string; name: string; aliases: string[]; workspaceHint?: string;
  parts: ExportPartName[];
  settings?: Record<string, unknown>; participants?: Record<string, unknown>[];
  counts: { messages: number; graves: number; files: number };
  missing: string[];
  missingSkills?: string[];
}
export interface CarrySource { uuid: string; label: string }
export interface CarryResource { room: string; file: string; bytes: number; sha256: string; sourcePath?: string; blob: string }
export interface CarryDependency { kind: "skill" | "look"; id: string; files: { path: string; data: string; bytes: number; sha256: string }[] }
export interface ExportJob {
  snapshot: string; dataDir: string; output: string; product: string; source: CarrySource; choice: ExportChoice;
  rooms: { uuid: string; id: string; name: string; dir: string; settings: Record<string, unknown>; participants: Record<string, unknown>[]; missingSkills?: string[] }[];
  dependencies: CarryDependency[];
  passphrase?: string;
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const resourceName = isRoomResourceName;
export const canonicalResourceName = canonicalResourceFile;
function digest(data: Buffer): string { return createHash("sha256").update(data).digest("hex"); }
function checkedBytes(value: Record<string, unknown>): Buffer {
  if (typeof value.data !== "string" || value.data.length > 40 * 1024 * 1024 || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 0 || !/^[0-9a-f]{64}$/.test(String(value.sha256))) throw new Error("An archive resource has invalid metadata.");
  const bytes = Buffer.from(value.data, "base64");
  if (bytes.length !== value.bytes || bytes.toString("base64") !== value.data || digest(bytes) !== value.sha256) throw new Error("An archive resource does not match its content hash or size.");
  return bytes;
}

export class CarryStage {
  readonly db: DatabaseSync;
  constructor(readonly dir: string) {
    mkdirSync(join(dir, "blobs"), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, "stage.sqlite"));
    this.db.exec(`
      create table if not exists meta(key text primary key,value text not null);
      create table if not exists rooms(uuid text primary key,body text not null);
      create table if not exists states(room text not null,id text not null,body text not null,primary key(room,id));
      create table if not exists revisions(room text not null,id text not null,body text not null,primary key(room,id));
      create table if not exists alternatives(room text not null,id text not null,body text not null,primary key(room,id));
      create table if not exists resources(room text not null,file text not null,body text not null,primary key(room,file));
      create table if not exists dependencies(kind text not null,id text not null,body text not null,primary key(kind,id));
    `);
  }
  close(): void { this.db.close(); }
  meta<T>(key: string): T | undefined { const row = this.db.prepare("select value from meta where key=?").get(key); return row ? JSON.parse(String(row.value)) as T : undefined; }
  setMeta(key: string, value: unknown): void { this.db.prepare("insert into meta(key,value) values(?,?) on conflict(key) do update set value=excluded.value").run(key, JSON.stringify(value)); }
  rooms(): PortableRoom[] { return this.db.prepare("select body from rooms").all().map(r => JSON.parse(String(r.body))); }
  room(uuid: string): PortableRoom | undefined { const r = this.db.prepare("select body from rooms where uuid=?").get(uuid); return r ? JSON.parse(String(r.body)) : undefined; }
  values<T>(table: "states" | "revisions" | "alternatives" | "resources", room: string): T[] { return this.db.prepare(`select body from ${table} where room=?`).all(room).map(r => JSON.parse(String(r.body))); }
  dependencies(): CarryDependency[] { return this.db.prepare("select body from dependencies").all().map(r => JSON.parse(String(r.body))); }
  input(uuid: string): MergeInput { return { source: this.meta<CarrySource>("source")!.uuid, states: this.values<CarryState>("states", uuid), revisions: this.values<CarryRevision>("revisions", uuid), alternatives: this.values<CarryAlternative>("alternatives", uuid) }; }

  accept(record: Record<string, unknown>): void {
    if (record.type === "manifest") {
      if (this.meta("source") || !object(record.source) || !isIdentity(record.source.uuid) || typeof record.source.label !== "string" || record.source.label.length > 100) throw new Error("The archive has an invalid or repeated source manifest.");
      this.setMeta("source", record.source); this.setMeta("product", record.product); this.setMeta("at", record.at);
    } else if (record.type === "source") {
      if (!isIdentity(record.uuid) || typeof record.label !== "string" || record.label.length > 100) throw new Error("The archive has an invalid source label.");
      this.setMeta(`source:${record.uuid}`, { uuid: record.uuid, label: record.label });
    } else if (record.type === "room") {
      const room = record.value as PortableRoom;
      if (!object(room) || !isIdentity(room.uuid) || typeof room.id !== "string" || typeof room.name !== "string" || !room.name.trim() || room.name.length > 60 || !Array.isArray(room.aliases) || room.aliases.some(x => !isIdentity(x)) || !Array.isArray(room.parts) || room.parts.some(p => !["conversation", "settings", "resources"].includes(p)) || !object(room.counts) || !Array.isArray(room.missing) || room.missing.some(x => typeof x !== "string") || room.missingSkills !== undefined && (!Array.isArray(room.missingSkills) || room.missingSkills.some(x => typeof x !== "string"))) throw new Error("The archive has invalid room metadata.");
      for (const count of Object.values(room.counts)) if (!Number.isSafeInteger(count) || Number(count) < 0) throw new Error("The archive has invalid room counts.");
      if (room.settings !== undefined || room.participants !== undefined) {
        const portable = roomForExport({ settings: room.settings, participants: room.participants });
        room.settings = portable.settings; room.participants = portable.participants;
      }
      this.db.prepare("insert into rooms(uuid,body) values(?,?)").run(room.uuid, JSON.stringify(room));
    } else if (["state", "revision", "alternative"].includes(String(record.type))) {
      if (!isIdentity(record.room) || !this.room(record.room)) throw new Error("An archive record refers to an unknown room.");
      const table = record.type === "state" ? "states" : record.type === "revision" ? "revisions" : "alternatives";
      const value = record.value as Record<string, unknown>;
      if (!object(value)) throw new Error("An archive record has no body.");
      const id = record.type === "state" ? (value.message as ChatMessage)?.id : value.revision;
      if (typeof id !== "string" || !id) throw new Error("An archive record has no identity.");
      this.db.prepare(`insert into ${table}(room,id,body) values(?,?,?)`).run(record.room, id, JSON.stringify(value));
    } else if (record.type === "resource") {
      if (!isIdentity(record.room) || !this.room(record.room) || !resourceName(record.file)) throw new Error("The archive has an invalid resource destination.");
      const bytes = checkedBytes(record), hash = String(record.sha256);
      const blob = join(this.dir, "blobs", hash);
      if (!existsSync(blob)) writeFileSync(blob, bytes, { flag: "wx", mode: 0o600 });
      const resource: CarryResource = { room: record.room, file: record.file, bytes: bytes.length, sha256: hash, blob: hash, ...(typeof record.sourcePath === "string" ? { sourcePath: record.sourcePath } : {}) };
      this.db.prepare("insert into resources(room,file,body) values(?,?,?)").run(record.room, record.file, JSON.stringify(resource));
    } else if (record.type === "dependency") {
      const value = record.value as CarryDependency;
      if (!object(value) || !["skill", "look"].includes(value.kind) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value.id) || !Array.isArray(value.files)) throw new Error("The archive has an invalid dependency.");
      if (this.db.prepare("select 1 from dependencies where kind=? and lower(id)=lower(?)").get(value.kind, value.id)) throw new Error("The archive repeats a shared definition's name.");
      const names = new Set<string>();
      for (const file of value.files) {
        if (!object(file) || typeof file.path !== "string" || !file.path || /[\\:\u0000-\u001f]/.test(file.path) || file.path.startsWith("/") || file.path.split("/").some(p => !p || p === "." || p === "..") || names.has(file.path.toLowerCase())) throw new Error("A dependency contains an invalid or repeated file path.");
        names.add(file.path.toLowerCase()); checkedBytes(file as unknown as Record<string, unknown>);
      }
      this.db.prepare("insert into dependencies(kind,id,body) values(?,?,?)").run(value.kind, value.id, JSON.stringify(value));
    } else throw new Error("This archive includes an unsupported record type. Update viberoom before opening it.");
  }

  validate(): void {
    const source = this.meta<CarrySource>("source");
    if (!source || !this.rooms().length) throw new Error("The archive contains no source or rooms.");
    for (const room of this.rooms()) {
      const input = this.input(room.uuid), files = this.values<CarryResource>("resources", room.uuid);
      const messages = input.states.filter(s => s.deletedAt === null).map(s => s.message);
      const graves = input.states.filter(s => s.deletedAt !== null).map(s => ({ message: s.message, deletedAt: s.deletedAt! }));
      if (room.counts.messages !== messages.length || room.counts.graves !== graves.length || room.counts.files !== files.length) throw new Error("The archive's room counts do not match its contents.");
      validateExportContents({ manifest: { schema: 2, product: this.meta<string>("product") ?? "", at: this.meta<string>("at") ?? "", range: { firstSeq: null, lastSeq: null, firstAt: null, lastAt: null }, checksum: "", room, folder: source.uuid, counts: { ...room.counts, participants: room.participants?.length ?? 0, files: 0 }, parts: room.parts }, messages: messages as unknown as Record<string, unknown>[], graves: graves as unknown as ExportContents["graves"], settings: room.settings ?? null, participants: room.participants ?? [], files: [], unknownParts: 0 });
      const db = new DatabaseSync(":memory:"), history = new CarryHistory(db);
      try {
        history.importRevisions(room.uuid, input.revisions);
        for (const state of input.states) {
          if (!object(state.head) || state.head.hash !== carryHash(state.message, state.deletedAt) || state.head.id !== state.message.id) throw new Error("A carried message does not match its revision.");
          history.acceptHead(room.uuid, state.head);
        }
        for (const variant of input.alternatives) {
          const revision = input.revisions.find(r => r.revision === variant.revision);
          if (!revision || revision.id !== variant.message?.id || revision.hash !== carryHash(variant.message, variant.deletedAt)) throw new Error("An archived alternative does not match its revision.");
        }
      } finally { db.close(); }
    }
    this.setMeta("ready", true);
  }
}

export async function stageCarry(input: string, stageDir: string, passphrase?: string): Promise<{ rooms: PortableRoom[]; source: CarrySource; encrypted: boolean }> {
  const stage = new CarryStage(stageDir);
  try {
    const prefix = Buffer.alloc(4096), fd = openSync(input, "r");
    let read: number;
    try { read = readSync(fd, prefix, 0, prefix.length, 0); } finally { closeSync(fd); }
    const first = prefix.subarray(0, read).toString("utf8").split("\n")[0];
    let header: { schema?: number; format?: string };
    try { header = JSON.parse(first); } catch { throw new Error("This is not a readable viberoom archive."); }
    let encrypted = false;
    stage.db.exec("begin");
    if (header.schema === 1 || header.schema === 2) {
      if (statSync(input).size > 512 * 1024 * 1024) throw new Error("This legacy JSONL file exceeds 512 MiB. Export it again with a current viberoom to use the streaming format.");
      const old = readExport(readFileSync(input, "utf8"));
      if (old.unknownParts) throw new Error("This file contains unsupported parts. Update viberoom before opening it.");
      const room = old.manifest.room, source = { uuid: old.manifest.folder, label: "Unnamed source" };
      stage.accept({ type: "manifest", source, product: old.manifest.product, at: old.manifest.at });
      stage.accept({ type: "room", value: { uuid: room.uuid, id: room.id, name: room.name, aliases: [], parts: old.manifest.parts, ...(old.manifest.parts.includes("settings") ? { settings: old.settings ?? {}, participants: old.participants } : {}), counts: { messages: old.messages.length, graves: old.graves.length, files: old.files.length }, missing: [] } });
      for (const row of [...old.messages.map(message => ({ message, deletedAt: null })), ...old.graves]) {
        const message = { kind: "chat", fromName: String(row.message.from), to: [], toNames: [], ...row.message } as unknown as ChatMessage;
        const node = carryRevision(message.id, carryHash(message, row.deletedAt));
        stage.accept({ type: "revision", room: room.uuid, value: node });
        stage.accept({ type: "state", room: room.uuid, value: { message, deletedAt: row.deletedAt, head: { id: node.id, revision: node.revision, hash: node.hash } } });
      }
      for (const file of old.files) stage.accept({ type: "resource", room: room.uuid, ...file, sha256: digest(Buffer.from(file.data, "base64")) });
    } else {
      const read = await readCarry(input, record => stage.accept(record), passphrase);
      encrypted = !!read.cipher;
    }
    stage.validate();
    await validateDependencies(stage.dir, stage.dependencies());
    stage.db.exec("commit");
    return { rooms: stage.rooms(), source: stage.meta<CarrySource>("source")!, encrypted };
  } catch (error) {
    try { stage.db.exec("rollback"); } catch { }
    throw error;
  } finally { stage.close(); }
}

export async function exportCarry(job: ExportJob): Promise<{ bytes: number; encrypted: boolean; warnings: { room: string; missing: string[]; missingSkills: string[] }[] }> {
  const store = new HistoryStore(job.snapshot);
  const origins = new Set<string>([job.source.uuid]);
  const warnings: { room: string; missing: string[]; missingSkills: string[] }[] = [];
  async function* records(): AsyncGenerator<Record<string, unknown>> {
    yield { type: "manifest", source: job.source, product: job.product, at: new Date().toISOString() };
    for (const held of job.rooms) {
      const portable = roomForExport(held as unknown as Record<string, unknown>);
      const all = [...store.all(held.id).map(message => ({ message, deletedAt: null as number | null })), ...store.deleted(held.id).map(g => ({ message: g.message, deletedAt: g.deletedAt }))];
      const dir = join(job.dataDir, "rooms", held.id, "files");
      const allFiles = (job.choice.resources !== false || job.choice.conversation !== false) && existsSync(dir) ? readdirSync(dir).filter(name => resourceName(name)).sort() : [];
      const files = job.choice.resources !== false ? allFiles : [];
      const assets = new Map<string, { hash: string; bytes: number }>();
      for (const file of allFiles) {
        const path = join(dir, file), stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`The resource ${file} is a link or not a file. It was not exported.`);
        if (stat.size > 20 * 1024 * 1024) throw new Error(`The resource ${file} exceeds the 20 MiB attachment limit.`);
        const data = readFileSync(path); assets.set(file, { hash: digest(data), bytes: data.length });
      }
      const wanted = new Set(all.flatMap(s => s.message.images?.map(i => i.file) ?? []));
      const bySeq = new Map<number, ChatMessage[]>();
      for (const { message } of all) bySeq.set(message.seq, [...(bySeq.get(message.seq) ?? []), message]);
      for (const state of all) {
        if (state.message.images) state.message = { ...state.message, images: state.message.images.map(image => {
          const asset = assets.get(image.file);
          return asset ? { ...image, sha256: asset.hash, bytes: asset.bytes } : image;
        }) };
        if (state.message.quotes) state.message = { ...state.message, quotes: state.message.quotes.map(q => {
          if (q.id) return q;
          const matches = (bySeq.get(q.seq) ?? []).filter(m => m.from === q.from && m.ts === q.ts);
          return matches.length === 1 ? { ...q, id: matches[0].id } : q;
        }) };
        const refs = new Map((state.message.resourceRefs ?? []).map(r => [r.source, r]));
        for (const file of allFiles) {
          const source = resolve(dir, file);
          for (const path of new Set([source, source.replace(/\\/g, "/")])) if (state.message.text.includes(path) && !refs.has(path)) refs.set(path, { source: path, file });
        }
        if (refs.size) state.message = { ...state.message, resourceRefs: [...refs.values()].map(ref => assets.has(ref.file) ? { ...ref, sha256: assets.get(ref.file)!.hash } : ref) };
      }
      const parts: ExportPartName[] = [];
      if (job.choice.conversation !== false) parts.push("conversation");
      if (job.choice.settings !== false) parts.push("settings");
      if (job.choice.resources !== false) parts.push("resources");
      const metadata: PortableRoom = { uuid: held.uuid, id: held.id, name: held.name, aliases: store.carry.aliases(held.id), workspaceHint: held.dir, parts,
        ...(job.choice.settings !== false ? portable : {}),
        counts: { messages: parts.includes("conversation") ? all.filter(s => s.deletedAt === null).length : 0, graves: parts.includes("conversation") ? all.filter(s => s.deletedAt !== null).length : 0, files: files.length },
        missing: [...wanted].filter(file => !allFiles.includes(file)),
        ...(job.choice.settings !== false ? { missingSkills: held.missingSkills ?? [] } : {}),
      };
      if (job.choice.resources !== false && metadata.missing.length || metadata.missingSkills?.length) warnings.push({ room: held.name, missing: job.choice.resources !== false ? metadata.missing : [], missingSkills: metadata.missingSkills ?? [] });
      yield { type: "room", value: metadata };
      if (parts.includes("conversation")) {
        const heads = store.transaction(() => new Map(all.map(state => [state.message.id, store.carry.ensure(held.id, state.message, state.deletedAt)])));
        for (const state of all) {
          const head = heads.get(state.message.id)!;
          if (state.message.origin) origins.add(state.message.origin);
          if (state.message.branch) origins.add(state.message.branch.source);
          yield { type: "state", room: held.uuid, value: { ...state, head } };
        }
        for (const revision of store.carry.revisions(held.id)) yield { type: "revision", room: held.uuid, value: revision };
        for (const alternative of store.carry.alternatives(held.id)) yield { type: "alternative", room: held.uuid, value: alternative };
      }
      for (const file of files) {
        const path = join(dir, file), stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`The resource ${file} is a link or not a file. It was not exported.`);
        if (stat.size > 20 * 1024 * 1024) throw new Error(`The resource ${file} exceeds the 20 MiB attachment limit.`);
        const data = readFileSync(path);
        if (digest(data) !== assets.get(file)!.hash) throw new Error(`The resource ${file} changed while the copy was being prepared. Prepare the copy again.`);
        yield { type: "resource", room: held.uuid, file, sourcePath: resolve(path), bytes: data.length, sha256: digest(data), data: data.toString("base64") };
      }
    }
    if (job.choice.settings !== false) for (const dependency of job.dependencies) yield { type: "dependency", value: dependency };
    for (const source of store.carry.sources()) if (origins.has(source.uuid) && source.uuid !== job.source.uuid) yield { type: "source", ...source };
  }
  try {
    const result = await writeCarry(job.output, records(), job.passphrase);
    return { bytes: result.bytes, encrypted: !!result.header.cipher, warnings };
  } finally { store.close(); }
}
