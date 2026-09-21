// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import { closeSync, copyFileSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { HistoryStore } from "./history-store.js";

export type FileChange = { path: string; data: string | Buffer | null } | { path: string; directory: { path: string; data: Buffer }[] };
interface Journal { id: string; files: { path: string; existed: boolean; directory?: boolean }[]; createdDirectories?: string[] }
const JOURNALS = "file-transactions";

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

function restore(root: string, dir: string, journal: Journal): void {
  for (let i = journal.files.length - 1; i >= 0; i--) {
    const entry = journal.files[i], target = inside(root, entry.path);
    if (entry.directory) {
      const displaced = join(dir, `${i}.displaced`);
      if (entry.existed) {
        const restored = join(dir, `${i}.restored`);
        if (existsSync(restored)) rmSync(restored, { recursive: true, force: true });
        cpSync(join(dir, `${i}.before`), restored, { recursive: true });
        if (existsSync(target)) {
          if (existsSync(displaced)) rmSync(displaced, { recursive: true, force: true });
          renameSync(target, displaced);
        }
        renameSync(restored, target);
      } else if (existsSync(target)) {
        if (existsSync(displaced)) rmSync(displaced, { recursive: true, force: true });
        renameSync(target, displaced);
      }
      continue;
    }
    if (entry.existed) {
      const temporary = join(dirname(target), `.viberoom-restore-${journal.id}-${i}`);
      copyFileSync(join(dir, `${i}.before`), temporary);
      renameSync(temporary, target);
    } else rmSync(target, { force: true });
  }
  for (const name of [...(journal.createdDirectories ?? [])].sort((a, b) => b.length - a.length)) {
    const path = inside(root, name);
    try { rmdirSync(path); } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
    }
  }
}

function clean(root: string, id: string): void {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid import recovery identifier.");
  const parent = resolve(root, JOURNALS), dir = resolve(parent, id);
  if (dirname(dir) !== parent) throw new Error("Invalid import recovery directory.");
  inside(root, join(JOURNALS, id));
  rmSync(dir, { recursive: true, force: true });
}

export function commitFiles(rootPath: string, store: HistoryStore, changes: FileChange[], writeRecord: () => void): void {
  const root = resolve(rootPath), id = randomUUID(), dir = inside(root, join(JOURNALS, id));
  const seen = new Set<string>();
  for (const change of changes) {
    const path = inside(root, change.path).toLowerCase();
    if ([...seen].some(old => old === path || path.startsWith(old + sep) || old.startsWith(path + sep))) throw new Error("The import writes the same destination twice, or overlaps a directory replacement.");
    seen.add(path);
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const directories = new Set<string>();
  for (const change of changes) for (let at = dirname(inside(root, change.path)); at !== root && !existsSync(at); at = dirname(at)) directories.add(relative(root, at));
  const journal: Journal = { id, files: [], createdDirectories: [...directories] };
  let prepared = false, committed = false;
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
        journal.files.push({ path: relative(root, target), existed, directory: true });
        return;
      }
      if (existed) {
        if (!lstatSync(target).isFile()) throw new Error("An import destination is not a file.");
        durable(join(dir, `${i}.before`), readFileSync(target));
      }
      if (change.data !== null) durable(join(dir, `${i}.after`), change.data);
      journal.files.push({ path: relative(root, target), existed });
    });
    durable(join(dir, "journal.ready"), JSON.stringify(journal));
    renameSync(join(dir, "journal.ready"), join(dir, "journal.json"));
    prepared = true;
    store.transaction(() => {
      journal.files.forEach((entry, i) => {
        const target = inside(root, entry.path);
        mkdirSync(dirname(target), { recursive: true });
        const change = changes[i];
        if (entry.directory) {
          if (entry.existed) renameSync(target, join(dir, `${i}.old`));
          renameSync(join(dir, `${i}.after`), target);
        } else if ("data" in change && change.data === null) rmSync(target, { force: true });
        else renameSync(join(dir, `${i}.after`), target);
      });
      writeRecord();
      store.markFileTransaction(id);
    });
    committed = true;
  } catch (error) {
    if (prepared) restore(root, dir, journal);
    clean(root, id);
    throw error;
  }
  if (committed) {
    try { clean(root, id); store.forgetFileTransaction(id); } catch { }
  }
}

export function recoverFileTransactions(rootPath: string, store: HistoryStore): number {
  const root = resolve(rootPath), parent = join(root, JOURNALS);
  if (!existsSync(parent)) return 0;
  let recovered = 0;
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
    const dir = inside(root, join(JOURNALS, entry.name)), path = join(dir, "journal.json");
    if (existsSync(path)) {
      const journal = JSON.parse(readFileSync(path, "utf8")) as Journal;
      if (journal.id !== entry.name || !Array.isArray(journal.files) || journal.files.some(f => !f || typeof f.path !== "string" || typeof f.existed !== "boolean" || f.directory !== undefined && typeof f.directory !== "boolean") || journal.createdDirectories !== undefined && (!Array.isArray(journal.createdDirectories) || journal.createdDirectories.some(p => typeof p !== "string"))) throw new Error("An interrupted import has a damaged recovery journal. Its backups were kept.");
      for (const file of journal.files) inside(root, file.path);
      if (!store.hasFileTransaction(journal.id)) restore(root, dir, journal);
      recovered++;
    }
    clean(root, entry.name);
    store.forgetFileTransaction(entry.name);
  }
  return recovered;
}
