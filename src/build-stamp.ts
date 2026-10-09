// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BUILD_STAMP = "build.json";

export function writeBuildStamp(distDir: string, at = new Date()): string {
  const built = at.toISOString();
  writeFileSync(join(distDir, BUILD_STAMP), `${JSON.stringify({ built })}\n`);
  return built;
}

export function readBuildStamp(distDir: string): string | null {
  try {
    const { built } = JSON.parse(readFileSync(join(distDir, BUILD_STAMP), "utf8")) as { built?: unknown };
    return typeof built === "string" && Number.isFinite(Date.parse(built)) ? built : null;
  } catch {
    return null;
  }
}

export function buildStamp(distDir: string): string {
  const built = readBuildStamp(distDir);
  if (built) return built;
  throw new Error(`this viberoom build has no record of when it was built (${join(distDir, BUILD_STAMP)}); build it with "npm run build"`);
}
