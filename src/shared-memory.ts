// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const MEMORY_LIMITS = { notes: 8, noteChars: 240, scopeChars: 1600, revisions: 20 };
export type MemoryScope = "user" | "room";
export interface MemorySource { room: string; seq: number; hash: string }
export interface MemoryNote {
  id: string; text: string; locked: boolean; basis: "explicit" | "pattern" | "manual" | "imported";
  sources: MemorySource[]; author: string; updatedAt: string;
}
export interface MemoryState { revision: number; enabled: boolean; notes: MemoryNote[] }
export interface PortableMemory { enabled: boolean; notes: { text: string; locked: boolean }[] }
export const portableMemory = (state: MemoryState): PortableMemory => ({ enabled: state.enabled, notes: state.notes.map(n => ({ text: n.text, locked: n.locked })) });
export function validatePortableMemory(raw: unknown): PortableMemory {
  if (!object(raw) || typeof raw.enabled !== "boolean") throw new Error("The room memory is invalid.");
  const checked = lintMemory(raw.notes);
  return { enabled: raw.enabled, notes: checked.notes.map(n => ({ text: n.text, locked: n.locked ?? false })) };
}
export function combineMemory(ours: PortableMemory, incoming: PortableMemory): PortableMemory | null {
  const seen = new Set(ours.notes.map(n => normalized(n.text)));
  const added = incoming.notes.filter(n => {
    const key = normalized(n.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const notes = [...ours.notes, ...added];
  if (notes.length > MEMORY_LIMITS.notes || notes.reduce((sum, n) => sum + chars(n.text), 0) > MEMORY_LIMITS.scopeChars) return null;
  return { enabled: ours.enabled, notes };
}
export interface MemoryInput { id?: string; text: string; locked?: boolean; basis?: MemoryNote["basis"]; evidence?: number[] }
export interface MemoryWarning { code: string; message: string }
export const memoryHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const chars = (text: string) => [...text].length;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, "");

export function lintMemory(raw: unknown, other: MemoryNote[] = []): { notes: MemoryInput[]; warnings: MemoryWarning[] } {
  if (!Array.isArray(raw) || raw.length > MEMORY_LIMITS.notes) throw new Error(`Memory allows at most ${MEMORY_LIMITS.notes} notes per scope. Merge or remove older notes first.`);
  const seen = new Set<string>(), ids = new Set<string>();
  const warnings: MemoryWarning[] = [];
  const notes = raw.map((value, i): MemoryInput => {
    if (!object(value) || Object.keys(value).some(k => !["id", "text", "locked", "basis", "evidence"].includes(k)) || typeof value.text !== "string") throw new Error("Each memory note needs plain text and only supported fields.");
    const text = value.text.trim().normalize("NFC");
    if (!text || chars(text) > MEMORY_LIMITS.noteChars || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`Note ${i + 1} must be one line of 1–${MEMORY_LIMITS.noteChars} characters.`);
    if (/<\/?(?:system|memory|room-brief|room-header|messages|notes|tool|assistant)\b/i.test(text)) throw new Error("Memory stores observations, not prompt blocks or role markers.");
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,})\b|\b(?:api[_ -]?key|password|token|secret)\s*[:=]\s*[A-Za-z0-9_\-/+]{12,}/i.test(text)) throw new Error("This note looks like it contains a credential. Do not store secrets in shared memory.");
    const key = normalized(text);
    if (seen.has(key)) throw new Error("Two memory notes repeat the same text. Keep one version.");
    seen.add(key);
    if (value.id !== undefined && (typeof value.id !== "string" || !/^[0-9a-f-]{36}$/.test(value.id) || ids.has(value.id))) throw new Error("A memory note has an invalid or repeated ID.");
    if (value.id) ids.add(value.id as string);
    if (value.locked !== undefined && typeof value.locked !== "boolean") throw new Error("locked must be on or off.");
    if (value.basis !== undefined && !["explicit", "pattern", "manual", "imported"].includes(String(value.basis))) throw new Error("Unknown memory basis.");
    if (value.evidence !== undefined && (!Array.isArray(value.evidence) || value.evidence.length > 3 || value.evidence.some(n => !Number.isSafeInteger(n) || Number(n) < 1))) throw new Error("Evidence must be up to three message numbers from this room.");
    if (other.some(n => normalized(n.text) === key)) warnings.push({ code: `cross-scope:${i}`, message: `Note ${i + 1} already exists in the other scope. Prefer keeping it in one place.` });
    if (/\b(today|tomorrow|yesterday|currently|right now|this time|todo|next task)\b|\d{4}-\d{2}-\d{2}|[A-Za-z]:[\\/]|https?:\/\//i.test(text)) warnings.push({ code: `temporary:${i}`, message: `Note ${i + 1} may be a temporary task, date or resource. Keep durable preferences here; task details belong in the conversation or project.` });
    return { ...(value.id ? { id: value.id as string } : {}), text, ...(value.locked !== undefined ? { locked: value.locked as boolean } : {}), ...(value.basis ? { basis: value.basis as MemoryNote["basis"] } : {}), ...(value.evidence ? { evidence: value.evidence as number[] } : {}) };
  });
  if (notes.reduce((sum, n) => sum + chars(n.text), 0) > MEMORY_LIMITS.scopeChars) throw new Error(`Memory allows ${MEMORY_LIMITS.scopeChars} characters per scope. Consolidate before adding.`);
  for (let i = 0; i < notes.length; i++) for (let j = 0; j < i; j++) {
    const a = new Set(normalized(notes[i].text).split(" ").filter(w => w.length > 3)), b = new Set(normalized(notes[j].text).split(" ").filter(w => w.length > 3));
    const overlap = [...a].filter(w => b.has(w)).length, union = new Set([...a, ...b]).size;
    if (a.size >= 3 && b.size >= 3 && overlap / union >= .65) warnings.push({ code: `similar:${j}:${i}`, message: `Notes ${j + 1} and ${i + 1} look similar. Consider merging them.` });
  }
  return { notes, warnings };
}

export class SharedMemory {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`create table if not exists shared_memory(scope text primary key, revision integer not null, enabled integer not null, notes text not null);
      create table if not exists memory_changes(scope text not null, revision integer not null, at text not null, actor text not null, reason text not null, snapshot text not null, primary key(scope,revision));`);
  }
  read(scope: string): MemoryState {
    const row = this.db.prepare("select revision,enabled,notes from shared_memory where scope=?").get(scope);
    return row ? { revision: Number(row.revision), enabled: !!row.enabled, notes: JSON.parse(String(row.notes)) } : { revision: 0, enabled: true, notes: [] };
  }
  drop(scope?: string): void {
    if (scope) {
      this.db.prepare("delete from shared_memory where scope=?").run(scope);
      this.db.prepare("delete from memory_changes where scope=?").run(scope);
    } else this.db.exec("delete from shared_memory; delete from memory_changes;");
  }
  revisions(scope: string): { revision: number; at: string; actor: string; reason: string; snapshot: MemoryState }[] {
    return this.db.prepare("select * from memory_changes where scope=? order by revision desc limit ?").all(scope, MEMORY_LIMITS.revisions).map(r => ({ revision: Number(r.revision), at: String(r.at), actor: String(r.actor), reason: String(r.reason), snapshot: JSON.parse(String(r.snapshot)) }));
  }
  importRoom(uuid: string, value: PortableMemory): void {
    this.importScope(`room:${uuid}`, value);
  }
  importScope(key: string, value: PortableMemory): void {
    const before = this.read(key), checked = validatePortableMemory(value);
    if (memoryHash(portableMemory(before)) === memoryHash(checked)) return;
    this.write(key, before.revision, { enabled: checked.enabled, notes: checked.notes.map(n => ({ ...n, id: randomUUID(), basis: "imported", sources: [], author: "Imported room setup", updatedAt: new Date().toISOString() })) }, "Import", "Imported reviewed room memory");
  }
  mergeRoom(uuid: string, value: PortableMemory): void {
    this.mergeScope(`room:${uuid}`, value);
  }
  mergeScope(key: string, value: PortableMemory): void {
    const before = this.read(key), combined = combineMemory(portableMemory(before), validatePortableMemory(value));
    if (!combined) throw new Error("The combined memory would not fit its limits. Review the import again and choose one side.");
    const known = new Set(before.notes.map(n => normalized(n.text)));
    const added = combined.notes.filter(n => !known.has(normalized(n.text)));
    if (!added.length) return;
    const at = new Date().toISOString();
    this.write(key, before.revision, { enabled: before.enabled, notes: [...before.notes, ...added.map(n => ({ ...n, id: randomUUID(), basis: "imported" as const, sources: [], author: "Imported room setup", updatedAt: at }))] }, "Import", "Combined memory from another computer");
  }
  write(scope: string, revision: number, next: Pick<MemoryState, "enabled" | "notes">, actor: string, reason: string, purge = false): MemoryState {
    const change = () => {
      const current = this.read(scope);
      if (current.revision !== revision) throw new Error("Memory changed after you read it. Read all memory again before editing.");
      if (!purge && memoryHash({ enabled: current.enabled, notes: current.notes }) === memoryHash(next)) return current;
      const at = new Date().toISOString(), updated = { ...next, revision: revision + 1 };
      this.db.prepare("insert or ignore into memory_changes values(?,?,?,?,?,?)").run(scope, revision, at, actor, reason, JSON.stringify(current));
      this.db.prepare("insert into shared_memory values(?,?,?,?) on conflict(scope) do update set revision=excluded.revision,enabled=excluded.enabled,notes=excluded.notes").run(scope, updated.revision, Number(next.enabled), JSON.stringify(next.notes));
      this.db.prepare("delete from memory_changes where scope=? and revision not in (select revision from memory_changes where scope=? order by revision desc limit ?)").run(scope, scope, MEMORY_LIMITS.revisions);
      if (purge) this.db.prepare("delete from memory_changes where scope=?").run(scope);
      return updated;
    };
    if (this.db.isTransaction) return change();
    this.db.exec("begin immediate");
    try { const result = change(); this.db.exec("commit"); return result; }
    catch (error) { this.db.exec("rollback"); throw error; }
  }
}

export function revisedNotes(current: MemoryState, input: MemoryInput[], actor: string, human: boolean, evidence: (note: MemoryInput) => MemorySource[]): MemoryNote[] {
  const previous = new Map(current.notes.map(n => [n.id, n]));
  if (!human && !current.enabled) throw new Error("The human disabled agent changes for this memory scope.");
  if (!human) for (const note of current.notes.filter(n => n.locked)) {
    const next = input.find(n => n.id === note.id);
    if (!next || next.text !== note.text || next.locked === false) throw new Error("A human-locked memory note cannot be changed or removed by an agent.");
  }
  return input.map(note => {
    const old = note.id ? previous.get(note.id) : undefined;
    if (note.id && !old) throw new Error("This note ID does not belong to the selected memory scope.");
    if (old && old.text === note.text && (note.locked === undefined || note.locked === old.locked)) return old;
    if (!human && note.locked) throw new Error("Only the human can lock memory notes.");
    if (!human && note.basis !== "explicit" && note.basis !== "pattern") throw new Error("New or edited agent notes must say whether they reflect an explicit preference or a repeated pattern.");
    return { id: old?.id ?? randomUUID(), text: note.text, locked: human ? note.locked ?? true : false,
      basis: human ? "manual" : note.basis!, sources: human ? [] : evidence(note), author: actor, updatedAt: new Date().toISOString() };
  });
}

export const MEMORY_RULE = "Shared observations; current user requests and room rules win. Before editing, call memory(action=read) for BOTH complete scopes; consolidate before adding, cite human messages, preserve locked notes. When enabled, maintain memory during ongoing work. This block replaces earlier shared memory; private session notes stay separate.";
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function memoryBlock(user: MemoryState, room: MemoryState): string {
  return `<memory>\n${MEMORY_RULE}\nLimits per scope: ${MEMORY_LIMITS.notes} notes; ${MEMORY_LIMITS.noteChars} characters each; ${MEMORY_LIMITS.scopeChars} total.\n` +
    ([['user', user], ['room', room]] as const).map(([name, state]) => `<${name} revision="${state.revision}" agent-updates="${state.enabled}">\n${state.notes.map(n => `<note id="${n.id}" locked="${n.locked}">${xml(n.text)}</note>`).join("\n") || "(empty)"}\n</${name}>`).join("\n") + "\n</memory>";
}
