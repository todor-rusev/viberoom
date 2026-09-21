// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.js";


export function newIdentity(): string {
  return randomUUID();
}

export function isIdentity(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export const FOLDER_ID_FILE = "folder-id.json";

interface FolderId {
  id: string;
  at: number;
}

export function folderIdentity(dataDir: string, make: () => string = newIdentity): string {
  const path = join(dataDir, FOLDER_ID_FILE);
  if (existsSync(path)) {
    try {
      const held = JSON.parse(readFileSync(path, "utf8")) as Partial<FolderId>;
      if (isIdentity(held.id)) return held.id;
    } catch {
    }
  }
  const made: FolderId = { id: make(), at: Date.now() };
  writeFileAtomic(path, `${JSON.stringify(made, null, 2)}\n`);
  return made.id;
}
