// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { renameWithRetry, type RenameOptions } from "./atomic.js";
import type { HistoryStore } from "./history-store.js";

export type FileChange = { path: string; data: string | Buffer | null } | { path: string; directory: { path: string; data: Buffer }[] };
interface JournalEntry { path: string; existed: boolean; directory?: boolean; after?: string | null }
interface Journal { version?: 2; id: string; files: JournalEntry[]; createdDirectories?: string[] }
export type FileOps = RenameOptions & { write?: (path: string, data: Buffer) => void };
const JOURNALS = "file-transactions";
const STARTED = "started";

export function safeDataFile(root: string, name: string): string {
  if (!name || isAbsolute(name) || name.includes("\0")) throw new Error("The import contains an invalid destination path.");
  const path = resolve(root, name), rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("The import destination leaves the data folder.");
  for (let at = path; at !== root; at = dirname(at)) {
    if (existsSync(at) && lstatSync(at).isSymbolicLink()) throw new Error("An import destination is a link. Move it inside the data folder first.");
  }
  return path;
}
const inside = safeDataFile;

function durable(path: string, data: string | Buffer): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
const sentence = (text: string) => /[.!?]$/.test(text) ? text : `${text}.`;
const restoring = (target: string, id: string, i: number) => join(dirname(target), `.viberoom-restore-${id}-${i}`);

function fileHash(path: string): string | null {
  return existsSync(path) && lstatSync(path).isFile() ? sha256(readFileSync(path)) : null;
}

function treeStamp(path: string): string | null {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) return null;
  const lines: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else lines.push(`${relative(path, full).split(sep).join("/")}\0${entry.isFile() ? sha256(readFileSync(full)) : "not a file"}`);
    }
  };
  walk(path);
  return sha256(lines.sort().join("\n"));
}

function mark(path: string): void {
  if (!existsSync(path)) durable(path, "");
}

function writeInPlace(path: string, data: Buffer, ops: FileOps): void {
  if (ops.write) return ops.write(path, data);
  const fd = openSync(path, "w", 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
}

class Steps {
  private readonly refusing = new Set<string>();
  constructor(private readonly ops: FileOps) {}

  private renamed(from: string, to: string): boolean {
    const folder = dirname(to).toLowerCase();
    if (this.refusing.has(folder)) return false;
    if (renameWithRetry(from, to, this.ops)) return true;
    this.refusing.add(folder);
    return false;
  }

  file(from: string, to: string, marker: string): void {
    if (this.renamed(from, to)) return;
    mark(marker);
    writeInPlace(to, readFileSync(from), this.ops);
    rmSync(from, { force: true });
    rmSync(marker, { force: true });
  }

  directory(from: string, to: string, old: string | null, marker: string): void {
    if ((!old || !existsSync(to) || this.renamed(to, old)) && this.renamed(from, to)) return;
    mark(marker);
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
    rmSync(marker, { force: true });
  }
}

function touched(root: string, dir: string, journal: Journal, i: number): boolean {
  const entry = journal.files[i], target = inside(root, entry.path);
  if (existsSync(join(dir, `${i}.writing`))) return true;
  if (journal.version !== 2) return !!entry.directory || !existsSync(join(dir, `${i}.after`));
  if (entry.directory) return entry.existed && !existsSync(target) || treeStamp(target) === entry.after;
  if (entry.after === null) return entry.existed && !existsSync(target);
  if (existsSync(join(dir, `${i}.after`))) return false;
  return fileHash(target) === entry.after;
}

function undo(root: string, dir: string, journal: Journal, i: number, steps: Steps): void {
  if (!touched(root, dir, journal, i)) return;
  const entry = journal.files[i], target = inside(root, entry.path), marker = join(dir, `${i}.writing`);
  if (entry.directory) {
    mark(marker);
    rmSync(target, { recursive: true, force: true });
    if (entry.existed) cpSync(join(dir, `${i}.before`), target, { recursive: true });
  } else if (entry.existed) {
    const temporary = restoring(target, journal.id, i);
    copyFileSync(join(dir, `${i}.before`), temporary);
    steps.file(temporary, target, marker);
  } else rmSync(target, { force: true });
  rmSync(marker, { force: true });
}

function restore(root: string, dir: string, journal: Journal, steps: Steps): void {
  const failed: string[] = [];
  for (let i = journal.files.length - 1; i >= 0; i--) {
    try { undo(root, dir, journal, i, steps); } catch (error) { failed.push(`${journal.files[i].path} (${reason(error)})`); }
  }
  if (failed.length) throw new Error(failed.join(", "));
  for (const name of [...(journal.createdDirectories ?? [])].sort((a, b) => b.length - a.length)) {
    const path = inside(root, name);
    try { rmdirSync(path); } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
    }
  }
}

function clean(root: string, id: string, journal: Journal | null): void {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid import recovery identifier.");
  const parent = resolve(root, JOURNALS), dir = resolve(parent, id);
  if (dirname(dir) !== parent) throw new Error("Invalid import recovery directory.");
  inside(root, join(JOURNALS, id));
  for (const [i, entry] of (journal?.files ?? []).entries()) if (!entry.directory) rmSync(restoring(inside(root, entry.path), id, i), { force: true });
  rmSync(dir, { recursive: true, force: true });
}

function readJournal(dir: string, id: string): Journal | null {
  const path = join(dir, "journal.json"), started = existsSync(join(dir, STARTED));
  if (!existsSync(path)) return null;
  let journal: Journal;
  try {
    journal = JSON.parse(readFileSync(path, "utf8")) as Journal;
  } catch {
    if (!started) return null;
    throw new Error("An interrupted import has a damaged recovery journal. Its backups were kept.");
  }
  if (journal?.version === 2 && !started) return null;
  if (!journal || journal.id !== id || !Array.isArray(journal.files) || journal.files.some(f => !f || typeof f.path !== "string" || typeof f.existed !== "boolean" || f.directory !== undefined && typeof f.directory !== "boolean" || f.after !== undefined && f.after !== null && typeof f.after !== "string") || journal.createdDirectories !== undefined && (!Array.isArray(journal.createdDirectories) || journal.createdDirectories.some(p => typeof p !== "string"))) throw new Error("An interrupted import has a damaged recovery journal. Its backups were kept.");
  return journal;
}

function unsettled(root: string): boolean {
  const parent = join(root, JOURNALS);
  return existsSync(parent) && readdirSync(parent, { withFileTypes: true }).some(entry => entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name));
}

function notImported(error: unknown, undoError?: unknown): Error {
  const rest = undoError === undefined ? "" : ` viberoom could not put back ${reason(undoError)} yet; it finishes that before the next import and when it starts.`;
  return new Error(`Nothing was imported: ${sentence(reason(error))}${rest}`, { cause: error });
}

export function commitFiles(rootPath: string, store: HistoryStore, changes: FileChange[], writeRecord: () => void, ops: FileOps = {}): void {
  const root = resolve(rootPath), id = randomUUID(), dir = inside(root, join(JOURNALS, id));
  const seen = new Set<string>();
  for (const change of changes) {
    const path = inside(root, change.path).toLowerCase();
    if ([...seen].some(old => old === path || path.startsWith(old + sep) || old.startsWith(path + sep))) throw new Error("The import writes the same destination twice, or overlaps a directory replacement.");
    seen.add(path);
  }
  if (unsettled(root)) throw new Error("An earlier import has not been put back completely yet, so nothing was imported. Look at this import again: viberoom finishes the earlier one first.");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const directories = new Set<string>();
  for (const change of changes) for (let at = dirname(inside(root, change.path)); at !== root && !existsSync(at); at = dirname(at)) directories.add(relative(root, at));
  const journal: Journal = { version: 2, id, files: [], createdDirectories: [...directories] };
  const steps = new Steps(ops);
  let started = false, committed = false;
  try {
    changes.forEach((change, i) => {
      const target = inside(root, change.path), existed = existsSync(target);
      if ("directory" in change) {
        if (existed) {
          if (!lstatSync(target).isDirectory()) throw new Error("A skill destination is not a directory.");
          const check = (path: string) => { for (const entry of readdirSync(path, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) throw new Error("A replaced directory contains a link.");
            if (entry.isDirectory()) check(join(path, entry.name));
            else if (!entry.isFile()) throw new Error("A replaced directory contains a non-file entry.");
          } };
          check(target); cpSync(target, join(dir, `${i}.before`), { recursive: true });
        }
        const after = join(dir, `${i}.after`); mkdirSync(after);
        for (const file of change.directory) {
          const path = inside(after, file.path); mkdirSync(dirname(path), { recursive: true }); durable(path, file.data);
        }
        journal.files.push({ path: relative(root, target), existed, directory: true, after: treeStamp(after) });
        return;
      }
      if (existed) {
        if (!lstatSync(target).isFile()) throw new Error("An import destination is not a file.");
        durable(join(dir, `${i}.before`), readFileSync(target));
      }
      if (change.data !== null) durable(join(dir, `${i}.after`), change.data);
      journal.files.push({ path: relative(root, target), existed, after: change.data === null ? null : sha256(change.data) });
    });
    durable(join(dir, "journal.json"), JSON.stringify(journal));
    durable(join(dir, STARTED), "");
    started = true;
    store.transaction(() => {
      journal.files.forEach((entry, i) => {
        const target = inside(root, entry.path), after = join(dir, `${i}.after`), marker = join(dir, `${i}.writing`);
        mkdirSync(dirname(target), { recursive: true });
        const change = changes[i];
        if (entry.directory) steps.directory(after, target, entry.existed ? join(dir, `${i}.old`) : null, marker);
        else if ("data" in change && change.data === null) rmSync(target, { force: true });
        else steps.file(after, target, marker);
      });
      writeRecord();
      store.markFileTransaction(id);
    });
    committed = true;
  } catch (error) {
    if (!started) {
      try { clean(root, id, null); } catch { }
      throw error;
    }
    try { restore(root, dir, journal, steps); } catch (undoError) { throw notImported(error, undoError); }
    try { clean(root, id, journal); } catch { }
    throw notImported(error);
  }
  if (committed) {
    try { clean(root, id, journal); store.forgetFileTransaction(id); } catch { }
  }
}

export function recoverFileTransactions(rootPath: string, store: HistoryStore, ops: FileOps = {}): number {
  const root = resolve(rootPath), parent = join(root, JOURNALS);
  if (!existsSync(parent)) return 0;
  let recovered = 0;
  const waiting: string[] = [];
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
    const dir = inside(root, join(JOURNALS, entry.name));
    try {
      const journal = readJournal(dir, entry.name);
      if (journal) {
        for (const file of journal.files) inside(root, file.path);
        if (!store.hasFileTransaction(journal.id)) {
          try { restore(root, dir, journal, new Steps(ops)); } catch (error) { throw new Error(`viberoom could not put back ${reason(error)} yet`); }
        }
        recovered++;
      }
      clean(root, entry.name, journal);
      store.forgetFileTransaction(entry.name);
    } catch (error) {
      waiting.push(`${sentence(reason(error))} (${dir})`);
    }
  }
  if (waiting.length) throw new Error(`An earlier import is not finished: ${waiting.join(" ")}`);
  return recovered;
}
