// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { realpathSync, statSync } from "node:fs";
import { join } from "node:path";

export interface StampHost {
  real(path: string): string;
  stat(path: string): { size: number; mtimeMs: number } | null;
}

const fsHost: StampHost = {
  real: path => realpathSync(path),
  stat: path => { try { const s = statSync(path); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } },
};

export interface StampSource {
  executable: string;
  packageRoot?: string;
}

export function installStamp(source: StampSource | null | undefined, host: StampHost = fsHost): string | null {
  if (!source?.executable) return null;
  let resolved: string;
  try { resolved = host.real(source.executable); } catch { return null; }
  const binary = host.stat(resolved);
  if (!binary) return null;
  const parts = [resolved, binary.size, Math.trunc(binary.mtimeMs)];
  if (source.packageRoot) {
    const manifest = host.stat(join(source.packageRoot, "package.json"));
    if (manifest) parts.push(manifest.size, Math.trunc(manifest.mtimeMs));
  }
  return parts.join("|");
}

export function recipeStamp(recipe: { installation?: StampSource; installedAt: string | null }, host: StampHost = fsHost): string | null {
  return installStamp(recipe.installation ?? (recipe.installedAt ? { executable: recipe.installedAt } : null), host);
}
