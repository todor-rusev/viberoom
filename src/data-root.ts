// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { mkdirSync } from "node:fs";
import { narrowToOwner } from "./private-path.js";

export function ensureDataRoot(directory: string, mkdir: typeof mkdirSync = mkdirSync, narrow: typeof narrowToOwner = narrowToOwner): void {
  const created = mkdir(directory, { recursive: true, mode: 0o700 });
  if (created) narrow(directory, "dir");
}
