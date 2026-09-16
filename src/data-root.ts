// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { mkdirSync } from "node:fs";

export function ensureDataRoot(directory: string, mkdir: typeof mkdirSync = mkdirSync): void {
  mkdir(directory, { recursive: true, mode: 0o700 });
}
