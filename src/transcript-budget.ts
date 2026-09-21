// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { existsSync, lstatSync, readdirSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const TRANSCRIPT_LIMITS = {
  recordBytes: 64 * 1024, bufferBytes: 512 * 1024, fileBytes: 5 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024, files: 256, ageMs: 7 * 24 * 60 * 60 * 1000,
};
interface Entry { path: string; bytes: number; modified: number }
interface Budget { entries: Map<string, Entry>; scanned: number; blockedUntil: number }
const budgets = new Map<string, Budget>();
let serial = 0;
const same = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";

function safe(root: string, path: string): boolean {
  const part = relative(root, path);
  if (isAbsolute(part) || part === ".." || part.startsWith("..\\") || part.startsWith("../")) return false;
  let here = root;
  for (const name of part.split(/[\\/]/).filter(Boolean)) {
    here = join(here, name);
    const stat = lstatSync(here);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !same(realpathSync(here), here)) return false;
  }
  return true;
}
function scan(root: string, application: boolean): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  const inspect = (directory: string) => {
    try {
      if (!safe(root, directory)) return;
      for (const name of readdirSync(directory)) {
        if (!name.endsWith(".jsonl")) continue;
        const path = join(directory, name), stat = lstatSync(path);
        if (stat.isFile() && !stat.isSymbolicLink()) entries.set(path, { path, bytes: stat.size, modified: stat.mtimeMs });
      }
    } catch (e) { if (!missing(e)) throw e; }
  };
  if (!application) inspect(root);
  else for (const area of ["rooms", "trash"]) {
    const base = join(root, area);
    if (!existsSync(base) || !safe(root, base)) continue;
    for (const item of readdirSync(base, { withFileTypes: true })) if (item.isDirectory()) inspect(join(base, item.name, "transcripts"));
  }
  return entries;
}
export function forgetTranscriptBudgets(): void { budgets.clear(); }

export function reserveTranscript(path: string, added: number, applicationRoot?: string): { commit: () => void; pruned: number } {
  const configured = resolve(applicationRoot ?? dirname(path));
  const root = realpathSync(configured);
  const directory = realpathSync(dirname(path));
  const part = relative(configured, resolve(dirname(path)));
  if (isAbsolute(part) || part === ".." || part.startsWith("..\\") || part.startsWith("../") || !safe(root, join(root, part))) throw new Error("linked transcript directory refused");
  const target = join(directory, basename(path));
  const key = `${root}|${applicationRoot ? "app" : "dir"}`;
  const now = Date.now();
  let budget = budgets.get(key);
  if (!budget || now - budget.scanned > 60_000) {
    budget = { entries: scan(root, !!applicationRoot), scanned: now, blockedUntil: 0 };
    budgets.set(key, budget);
  }
  if (budget.blockedUntil > now) throw new Error("diagnostic budget is full; waiting before retrying locked files");
  let bytes = 0;
  try {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error("non-private transcript file refused");
    bytes = stat.size;
    budget.entries.set(target, { path: target, bytes, modified: stat.mtimeMs });
  } catch (e) { if (!missing(e)) throw e; else budget.entries.delete(target); }
  if (bytes + added > TRANSCRIPT_LIMITS.fileBytes) {
    const archived = target.replace(/\.jsonl$/, `.part-${now}-${++serial}.jsonl`);
    renameSync(target, archived);
    budget.entries.delete(target);
    budget.entries.set(archived, { path: archived, bytes, modified: now });
    bytes = 0;
  }
  let total = [...budget.entries.values()].reduce((n, e) => n + e.bytes, 0);
  let pruned = 0;
  const needsSpace = () => total + added > TRANSCRIPT_LIMITS.totalBytes || budget!.entries.size + (budget!.entries.has(target) ? 0 : 1) > TRANSCRIPT_LIMITS.files;
  for (const entry of [...budget.entries.values()].sort((a, b) => a.modified - b.modified || a.path.localeCompare(b.path))) {
    if (entry.path === target) continue;
    if (!needsSpace() && entry.bytes <= TRANSCRIPT_LIMITS.fileBytes && now - entry.modified <= TRANSCRIPT_LIMITS.ageMs) continue;
    try {
      if (!safe(root, dirname(entry.path))) continue;
      const stat = lstatSync(entry.path);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      unlinkSync(entry.path);
    } catch (e) { if (!missing(e)) continue; }
    budget.entries.delete(entry.path); total -= entry.bytes; pruned++;
  }
  if (needsSpace()) { budget.blockedUntil = now + 5000; throw new Error("diagnostic retention budget is full and old files cannot be removed"); }
  return { pruned, commit: () => budget!.entries.set(target, { path: target, bytes: bytes + added, modified: now }) };
}
