// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { lstatSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Transcript } from "./log.js";

export interface DiagnosticLogStats { files: number; bytes: number; skipped: number; unavailable: number }
export interface DiagnosticLogClear {
  removedFiles: number; removedBytes: number; failedFiles: number;
  skipped: number; unavailable: number; remaining: DiagnosticLogStats;
}
interface Inventory extends DiagnosticLogStats { directories: string[]; paths: string[] }
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const same = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

function safeDirectory(root: string, directory: string): boolean {
  const part = relative(root, directory);
  if (!part || part === ".." || part.startsWith("../") || part.startsWith("..\\") || isAbsolute(part)) return false;
  let current = root;
  for (const name of part.split(/[\\/]/)) {
    current = join(current, name);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() || !same(realpathSync(current), current)) return false;
  }
  return true;
}

function inventory(dataDir: string): Inventory {
  const found: Inventory = { files: 0, bytes: 0, skipped: 0, unavailable: 0, directories: [], paths: [] };
  let root: string;
  try { root = realpathSync(resolve(dataDir)); }
  catch (error) { if (!missing(error)) found.unavailable++; return found; }
  for (const area of ["rooms", "trash"]) {
    const base = join(root, area);
    try {
      if (!safeDirectory(root, base)) { found.skipped++; continue; }
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const parent = join(base, entry.name), directory = join(parent, "transcripts");
        try {
          if (!safeDirectory(root, parent)) { found.skipped++; continue; }
          if (!safeDirectory(root, directory)) { found.skipped++; continue; }
          found.directories.push(directory);
          for (const name of readdirSync(directory)) {
            if (!name.endsWith(".jsonl")) continue;
            const path = join(directory, name);
            try {
              const stat = lstatSync(path);
              if (!stat.isFile() || stat.isSymbolicLink()) { found.skipped++; continue; }
              found.paths.push(path); found.files++; found.bytes += stat.size;
            } catch (error) { if (!missing(error)) found.unavailable++; }
          }
        } catch (error) { if (!missing(error)) found.unavailable++; }
      }
    } catch (error) { if (!missing(error)) found.unavailable++; }
  }
  return found;
}

export function diagnosticLogStats(dataDir: string): DiagnosticLogStats {
  const { files, bytes, skipped, unavailable } = inventory(dataDir);
  return { files, bytes, skipped, unavailable };
}

export function clearDiagnosticLogs(dataDir: string, remove: (path: string) => void = unlinkSync): DiagnosticLogClear {
  const found = inventory(dataDir);
  const result = { removedFiles: 0, removedBytes: 0, failedFiles: 0, skipped: found.skipped, unavailable: found.unavailable };
  if (!found.directories.length) return { ...result, remaining: diagnosticLogStats(dataDir) };
  const root = realpathSync(resolve(dataDir));
  for (const directory of found.directories) {
    try {
      if (!safeDirectory(root, directory)) { result.skipped++; continue; }
      Transcript.forgetDirectory(directory);
      Transcript.forgetDirectory(join(resolve(dataDir), relative(root, directory)));
      for (const path of found.paths.filter(path => path.startsWith(directory + "/") || path.startsWith(directory + "\\"))) {
        try {
          if (!safeDirectory(root, directory)) { result.skipped++; continue; }
          const stat = lstatSync(path);
          if (!stat.isFile() || stat.isSymbolicLink()) { result.skipped++; continue; }
          remove(path); result.removedFiles++; result.removedBytes += stat.size;
        } catch (error) { if (!missing(error)) result.failedFiles++; }
      }
    } catch (error) { if (!missing(error)) result.unavailable++; }
  }
  return { ...result, remaining: diagnosticLogStats(dataDir) };
}
