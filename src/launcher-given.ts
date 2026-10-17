// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.js";

export const LAUNCHER_GIVEN_FILE = join("launcher", "given-up.json");

export interface LauncherGiven {
  shortcuts: boolean;
  signIn: boolean;
}

export function readLauncherGiven(dataDir: string, read: (path: string) => string = (path) => readFileSync(path, "utf8")): LauncherGiven | null {
  try {
    const value = JSON.parse(read(join(dataDir, LAUNCHER_GIVEN_FILE))) as Partial<LauncherGiven>;
    const given = { shortcuts: value.shortcuts === true, signIn: value.signIn === true };
    return given.shortcuts || given.signIn ? given : null;
  } catch {
    return null;
  }
}

export function recordLauncherGiven(dataDir: string, now: LauncherGiven, o: { read?: (path: string) => string; write?: (path: string, data: string) => void } = {}): LauncherGiven | null {
  const before = readLauncherGiven(dataDir, o.read);
  const given = { shortcuts: now.shortcuts || !!before?.shortcuts, signIn: now.signIn || !!before?.signIn };
  if (!given.shortcuts && !given.signIn) return null;
  if (before && before.shortcuts === given.shortcuts && before.signIn === given.signIn) return given;
  (o.write ?? ((path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileAtomic(path, data); }))(join(dataDir, LAUNCHER_GIVEN_FILE), `${JSON.stringify(given, null, 2)}\n`);
  return given;
}

export function forgetLauncherGiven(dataDir: string, remove: (path: string) => void = (path) => rmSync(path, { force: true })): void {
  remove(join(dataDir, LAUNCHER_GIVEN_FILE));
}
