// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export interface FolderEntry {
  name: string;
  path: string;
  hidden: boolean;
}

export interface FolderListing {
  path: string;
  parent: string | null;
  dirs: FolderEntry[];
}

export function listRoots(platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): FolderEntry[] {
  if (platform !== "win32") return [{ name: "/", path: "/", hidden: false }];
  const roots: FolderEntry[] = [];
  for (let code = "C".charCodeAt(0); code <= "Z".charCodeAt(0); code++) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (exists(drive)) roots.push({ name: drive.slice(0, 2), path: drive, hidden: false });
  }
  return roots;
}

export function homeFolder(): string {
  return homedir();
}

export function normalizeFolder(input: string): string {
  let trimmed = input.trim().replace(/^["']|["']$/g, "");
  if (/^[A-Za-z]:$/.test(trimmed)) trimmed += "\\";
  if (!trimmed || !isAbsolute(trimmed)) throw new Error("an absolute folder path is needed");
  const full = resolve(trimmed);
  return /^[A-Za-z]:\\?$/.test(full) ? `${full.slice(0, 2)}\\` : full.replace(new RegExp(`\\${sep}+$`), "") || sep;
}

function isRoot(path: string): boolean {
  return path === sep || /^[A-Za-z]:\\?$/.test(path);
}

export async function listFolders(input: string): Promise<FolderListing> {
  const path = normalizeFolder(input);
  const entries = await readdir(path, { withFileTypes: true });
  const dirs: FolderEntry[] = [];
  for (const entry of entries) {
    let isDir = entry.isDirectory();
    if (!isDir && entry.isSymbolicLink()) {
      try {
        isDir = (await readdir(join(path, entry.name), { withFileTypes: true })) !== undefined;
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    dirs.push({ name: entry.name, path: join(path, entry.name), hidden: entry.name.startsWith(".") || entry.name.startsWith("$") });
  }
  dirs.sort((a, b) => (a.hidden === b.hidden ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.hidden ? 1 : -1));
  return { path, parent: isRoot(path) ? null : dirname(path), dirs };
}

export function validFolderName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= 120 && n !== "." && n !== ".." && !/[\\/:*?"<>|\u0000-\u001f]/.test(n) && !/[. ]$/.test(n);
}

export async function createFolder(parent: string, name: string): Promise<string> {
  if (!validFolderName(name)) throw new Error("a folder name cannot contain \\ / : * ? \" < > | and cannot end with a dot or a space");
  const path = join(normalizeFolder(parent), name.trim());
  if (existsSync(path)) throw new Error(`"${basename(path)}" already exists here`);
  await mkdir(path);
  return path;
}
