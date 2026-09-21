// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { mkdirSync } from "node:fs";
import { narrowToOwner } from "./private-path.js";

export function ensureDataRoot(directory: string, mkdir: typeof mkdirSync = mkdirSync, narrow: typeof narrowToOwner = narrowToOwner): void {
  const created = mkdir(directory, { recursive: true, mode: 0o700 });
  if (created) narrow(directory, "dir");
}

export function networkFolderNotice(directory: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== "win32") return null;
  const slash = String.fromCharCode(92);
  const unc = directory.startsWith(slash + slash) || directory.startsWith("//");
  if (!unc) return null;
  const longForm = `${slash}${slash}?${slash}UNC${slash}`;
  const where = directory.toLowerCase().startsWith(longForm.toLowerCase()) ? slash + slash + directory.slice(longForm.length) : directory;
  return `the rooms are kept on another machine (${where}). viberoom has not been tried on a network folder: its conversation store leans on file locking, which is where shares are least reliable. To keep them on this computer instead: viberoom --data-dir "%LOCALAPPDATA%${slash}viberoom"`;
}
