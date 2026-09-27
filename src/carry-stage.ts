// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash, randomUUID, type Hash } from "node:crypto";
import { closeSync, createReadStream, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HistoryStore } from "./history-store.js";
import { CarryHistory, carryHash, carryRevision, type CarryAlternative, type CarryHead, type CarryRevision } from "./carry-history.js";
import { readCarry, writeCarry } from "./carry-format.js";
import { readExport, validateExportContents, type ExportContents, type ExportPartName } from "./export-file.js";
import { roomForExport, type ExportChoice } from "./export-room.js";
import { isIdentity } from "./identity.js";
import { canonicalResourceFile, isRoomResourceName, isStoredFileName, messageAttachments, withAttachmentLists } from "./files.js";
import type { ChatMessage } from "./room.js";
import type { CarryState, MergeInput } from "./carry-merge.js";
import { validateDependencies } from "./carry-dependencies.js";
import { portableMemory, validatePortableMemory, type PortableMemory } from "./shared-memory.js";

export interface PortableRoom {
  uuid: string; id: string; name: string; aliases: string[]; workspaceHint?: string;
  parts: (ExportPartName | "memory")[];
  memory?: PortableMemory;
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
const copyNumbers = (v: unknown): boolean => object(v) && Object.keys(v).length <= 256 && Object.entries(v).every(([source, seq]) => isIdentity(source) && Number.isSafeInteger(seq) && Number(seq) > 0);
export const resourceName = isRoomResourceName;
export const canonicalResourceName = canonicalResourceFile;
function digest(data: Buffer): string { return createHash("sha256").update(data).digest("hex"); }

export const PART_BYTES = 8 * 1024 * 1024;

async function digestFile(path: string): Promise<{ hash: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk as Buffer); bytes += (chunk as Buffer).length; }
  return { hash: hash.digest("hex"), bytes };
}

interface Receiving { room: string; file: string; bytes: number; sha256: string; parts: number; next: number; written: number; hash: Hash; fd: number; temp: string; sourcePath?: string }
function checkedBytes(value: Record<string, unknown>): Buffer {
  if (typeof value.data !== "string" || value.data.length > 40 * 1024 * 1024 || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 0 || !/^[0-9a-f]{64}$/.test(String(value.sha256))) throw new Error("An archive resource has invalid metadata.");
  const bytes = Buffer.from(value.data, "base64");
  if (bytes.length !== value.bytes || bytes.toString("base64") !== value.data || digest(bytes) !== value.sha256) throw new Error("An archive resource does not match its content hash or size.");
  return bytes;
}

export type PlanRowKind = "state" | "head" | "revision" | "alternative" | "resource" | "number";

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
      create table if not exists plan_rows(room text not null,kind text not null,n integer not null,body text not null,primary key(room,kind,n));
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
  transaction<T>(work: () => T): T {
    this.db.exec("begin");
    try { const result = work(); this.db.exec("commit"); return result; }
    catch (error) { this.db.exec("rollback"); throw error; }
  }

  clearPlanRows(): void { this.db.exec("delete from plan_rows"); }
  setPlanRows(room: string, kind: PlanRowKind, rows: readonly unknown[]): void {
    const insert = this.db.prepare("insert into plan_rows(room,kind,n,body) values(?,?,?,?)");
    rows.forEach((row, n) => insert.run(room, kind, n, JSON.stringify(row)));
  }
  planRows<T>(room: string, kind: PlanRowKind, from = 0, limit = -1): T[] {
    return this.db.prepare("select body from plan_rows where room=? and kind=? and n>=? order by n limit ?").all(room, kind, from, limit).map(r => JSON.parse(String(r.body)) as T);
  }

  private receiving: Receiving | null = null;

  accept(record: Record<string, unknown>): void {
    if (this.receiving && record.type !== "resource-part") throw new Error("An archive resource is incomplete: its parts were interrupted.");
    if (record.type === "manifest") {
      if (this.meta("source") || !object(record.source) || !isIdentity(record.source.uuid) || typeof record.source.label !== "string" || record.source.label.length > 100) throw new Error("The archive has an invalid or repeated source manifest.");
      this.setMeta("source", record.source); this.setMeta("product", record.product); this.setMeta("at", record.at);
    } else if (record.type === "user-memory") {
      if (this.meta("userMemory")) throw new Error("The archive repeats user memory.");
      this.setMeta("userMemory", validatePortableMemory(record.value));
    } else if (record.type === "source") {
      if (!isIdentity(record.uuid) || typeof record.label !== "string" || record.label.length > 100) throw new Error("The archive has an invalid source label.");
      this.setMeta(`source:${record.uuid}`, { uuid: record.uuid, label: record.label });
    } else if (record.type === "room") {
      const room = record.value as PortableRoom;
      if (!object(room) || !isIdentity(room.uuid) || typeof room.id !== "string" || typeof room.name !== "string" || !room.name.trim() || room.name.length > 60 || !Array.isArray(room.aliases) || room.aliases.some(x => !isIdentity(x)) || !Array.isArray(room.parts) || room.parts.some(p => !["conversation", "settings", "resources", "memory"].includes(p)) || !object(room.counts) || !Array.isArray(room.missing) || room.missing.some(x => typeof x !== "string") || room.missingSkills !== undefined && (!Array.isArray(room.missingSkills) || room.missingSkills.some(x => typeof x !== "string"))) throw new Error("The archive has invalid room metadata.");
      for (const count of Object.values(room.counts)) if (!Number.isSafeInteger(count) || Number(count) < 0) throw new Error("The archive has invalid room counts.");
      if (room.settings !== undefined || room.participants !== undefined) {
        const portable = roomForExport({ settings: room.settings, participants: room.participants });
        room.settings = portable.settings; room.participants = portable.participants;
      }
      if (room.memory !== undefined) {
        if (!room.parts.includes("memory")) throw new Error("Room memory must be declared in the archive.");
        room.memory = validatePortableMemory(room.memory);
      } else if (room.parts.includes("memory")) throw new Error("The declared room memory is missing.");
      this.db.prepare("insert into rooms(uuid,body) values(?,?)").run(room.uuid, JSON.stringify(room));
    } else if (["state", "revision", "alternative"].includes(String(record.type))) {
      if (!isIdentity(record.room) || !this.room(record.room)) throw new Error("An archive record refers to an unknown room.");
      const table = record.type === "state" ? "states" : record.type === "revision" ? "revisions" : "alternatives";
      const value = record.value as Record<string, unknown>;
      if (!object(value)) throw new Error("An archive record has no body.");
      const id = record.type === "state" ? (value.message as ChatMessage)?.id : value.revision;
      if (typeof id !== "string" || !id) throw new Error("An archive record has no identity.");
      if (record.type === "state" && value.numbers !== undefined && !copyNumbers(value.numbers)) throw new Error("An archive record has invalid message numbers.");
      this.db.prepare(`insert into ${table}(room,id,body) values(?,?,?)`).run(record.room, id, JSON.stringify(value));
    } else if (record.type === "resource" && record.parts !== undefined) {
      if (!isIdentity(record.room) || !this.room(record.room) || !resourceName(record.file)) throw new Error("The archive has an invalid resource destination.");
      if (!Number.isSafeInteger(record.parts) || Number(record.parts) < 1 || !Number.isSafeInteger(record.bytes) || Number(record.bytes) < 1 || !/^[0-9a-f]{64}$/.test(String(record.sha256)) || record.data !== undefined) throw new Error("An archive resource has invalid metadata.");
      const temp = join(this.dir, "blobs", `.receiving-${randomUUID()}`);
      this.receiving = { room: String(record.room), file: String(record.file), bytes: Number(record.bytes), sha256: String(record.sha256), parts: Number(record.parts), next: 0, written: 0, hash: createHash("sha256"), fd: openSync(temp, "wx", 0o600), temp, ...(typeof record.sourcePath === "string" ? { sourcePath: record.sourcePath } : {}) };
    } else if (record.type === "resource-part") {
      const at = this.receiving;
      if (!at || record.room !== at.room || record.file !== at.file || record.index !== at.next) throw new Error("An archive resource part is out of place.");
      if (typeof record.data !== "string" || record.data.length > 40 * 1024 * 1024) throw new Error("An archive resource part is invalid.");
      const part = Buffer.from(record.data, "base64");
      if (!part.length || part.toString("base64") !== record.data || at.written + part.length > at.bytes) throw new Error("An archive resource part does not match its resource.");
      writeSync(at.fd, part);
      at.hash.update(part);
      at.written += part.length;
      if (++at.next < at.parts) return;
      closeSync(at.fd);
      this.receiving = null;
      if (at.written !== at.bytes || at.hash.digest("hex") !== at.sha256) {
        rmSync(at.temp, { force: true });
        throw new Error("An archive resource does not match its content hash or size.");
      }
      const blob = join(this.dir, "blobs", at.sha256);
      if (existsSync(blob)) rmSync(at.temp, { force: true });
      else renameSync(at.temp, blob);
      const resource: CarryResource = { room: at.room, file: at.file, bytes: at.bytes, sha256: at.sha256, blob: at.sha256, ...(at.sourcePath ? { sourcePath: at.sourcePath } : {}) };
      this.db.prepare("insert into resources(room,file,body) values(?,?,?)").run(at.room, at.file, JSON.stringify(resource));
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
    if (this.receiving) throw new Error("An archive resource is incomplete: the archive ended before its last part.");
    const source = this.meta<CarrySource>("source");
    if (!source || !this.rooms().length && !this.meta("userMemory")) throw new Error("The archive contains no source, rooms or user memory.");
    for (const room of this.rooms()) {
      const input = this.input(room.uuid), files = this.values<CarryResource>("resources", room.uuid);
      const messages = input.states.filter(s => s.deletedAt === null).map(s => s.message);
      const graves = input.states.filter(s => s.deletedAt !== null).map(s => ({ message: s.message, deletedAt: s.deletedAt! }));
      if (room.counts.messages !== messages.length || room.counts.graves !== graves.length || room.counts.files !== files.length) throw new Error("The archive's room counts do not match its contents.");
      validateExportContents({ manifest: { schema: 2, product: this.meta<string>("product") ?? "", at: this.meta<string>("at") ?? "", range: { firstSeq: null, lastSeq: null, firstAt: null, lastAt: null }, checksum: "", room, folder: source.uuid, counts: { ...room.counts, participants: room.participants?.length ?? 0, files: 0 }, parts: room.parts.filter((p): p is ExportPartName => p !== "memory") }, messages: messages as unknown as Record<string, unknown>[], graves: graves as unknown as ExportContents["graves"], settings: room.settings ?? null, participants: room.participants ?? [], files: [], unknownParts: 0 });
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

export async function stageCarry(input: string, stageDir: string, passphrase?: string): Promise<{ rooms: PortableRoom[]; source: CarrySource; encrypted: boolean; userMemory?: PortableMemory }> {
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
    return { rooms: stage.rooms(), source: stage.meta<CarrySource>("source")!, encrypted, userMemory: stage.meta<PortableMemory>("userMemory") };
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
    if (job.choice.userMemory) yield { type: "user-memory", value: portableMemory(store.memory.read("user")) };
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
        assets.set(file, await digestFile(path));
      }
      const wanted = new Set(all.flatMap(s => messageAttachments(s.message).map(a => a.file)));
      const bySeq = new Map<number, ChatMessage[]>();
      for (const { message } of all) bySeq.set(message.seq, [...(bySeq.get(message.seq) ?? []), message]);
      for (const state of all) {
        state.message = withAttachmentLists(state.message, list => list.map(file => {
          const asset = assets.get(file.file);
          return asset ? { ...file, sha256: asset.hash, bytes: asset.bytes } : file;
        }));
        if (state.message.quotes) state.message = { ...state.message, quotes: state.message.quotes.map(q => {
          if (q.id || q.seq === undefined) return q;
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
      const parts: PortableRoom["parts"] = [];
      if (job.choice.conversation !== false) parts.push("conversation");
      if (job.choice.settings !== false) parts.push("settings");
      if (job.choice.resources !== false) parts.push("resources");
      const memory = portableMemory(store.memory.read(`room:${held.uuid}`));
      if (job.choice.memory) parts.push("memory");
      const metadata: PortableRoom = { uuid: held.uuid, id: held.id, name: held.name, aliases: store.carry.aliases(held.id), workspaceHint: held.dir, parts,
        ...(job.choice.settings !== false ? portable : {}),
        ...(parts.includes("memory") ? { memory } : {}),
        counts: { messages: parts.includes("conversation") ? all.filter(s => s.deletedAt === null).length : 0, graves: parts.includes("conversation") ? all.filter(s => s.deletedAt !== null).length : 0, files: files.length },
        missing: [...wanted].filter(file => !allFiles.includes(file)),
        ...(job.choice.settings !== false ? { missingSkills: held.missingSkills ?? [] } : {}),
      };
      if (job.choice.resources !== false && metadata.missing.length || metadata.missingSkills?.length) warnings.push({ room: held.name, missing: job.choice.resources !== false ? metadata.missing : [], missingSkills: metadata.missingSkills ?? [] });
      yield { type: "room", value: metadata };
      if (parts.includes("conversation")) {
        const heads = store.transaction(() => new Map(all.map(state => [state.message.id, store.carry.ensure(held.id, state.message, state.deletedAt)])));
        const numbered = new Map<string, Record<string, number>>();
        for (const n of store.carry.numbers(held.id)) numbered.set(n.id, { ...numbered.get(n.id), [n.source]: n.seq });
        for (const state of all) {
          const head = heads.get(state.message.id)!, numbers = numbered.get(state.message.id);
          if (state.message.origin) origins.add(state.message.origin);
          if (state.message.branch) origins.add(state.message.branch.source);
          for (const source of Object.keys(numbers ?? {})) origins.add(source);
          yield { type: "state", room: held.uuid, value: { ...state, head, ...(numbers ? { numbers } : {}) } };
        }
        for (const revision of store.carry.revisions(held.id)) yield { type: "revision", room: held.uuid, value: revision };
        for (const alternative of store.carry.alternatives(held.id)) yield { type: "alternative", room: held.uuid, value: alternative };
      }
      for (const file of files) {
        const path = join(dir, file), stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`The resource ${file} is a link or not a file. It was not exported.`);
        const known = assets.get(file)!;
        const changed = () => new Error(`The resource ${file} changed while the copy was being prepared. Prepare the copy again.`);
        if (stat.size !== known.bytes) throw changed();
        if (stat.size <= PART_BYTES) {
          const data = readFileSync(path);
          if (digest(data) !== known.hash) throw changed();
          yield { type: "resource", room: held.uuid, file, sourcePath: resolve(path), bytes: data.length, sha256: known.hash, data: data.toString("base64") };
          continue;
        }
        const parts = Math.ceil(stat.size / PART_BYTES);
        yield { type: "resource", room: held.uuid, file, sourcePath: resolve(path), bytes: stat.size, sha256: known.hash, parts };
        const fd = openSync(path, "r"), hash = createHash("sha256");
        try {
          for (let index = 0; index < parts; index++) {
            const part = Buffer.alloc(Math.min(PART_BYTES, stat.size - index * PART_BYTES));
            if (readSync(fd, part, 0, part.length, index * PART_BYTES) !== part.length) throw changed();
            hash.update(part);
            yield { type: "resource-part", room: held.uuid, file, index, data: part.toString("base64") };
          }
        } finally { closeSync(fd); }
        if (hash.digest("hex") !== known.hash) throw changed();
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
