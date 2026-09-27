// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { posix, win32 } from "node:path";

const GIT_CONTEXT = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_OBJECT_DIRECTORY",
  "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE", "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE", "GIT_PREFIX", "GIT_SHALLOW_FILE", "GIT_COMMON_DIR",
  "GIT_EXEC_PATH", "GIT_REFLOG_ACTION", "GIT_QUARANTINE_PATH",
]);

function npmContext(key: string, underNpm: boolean): boolean {
  return /^npm_/i.test(key) || key === "INIT_CWD" || (underNpm && (key === "NODE" || key === "COLOR"));
}

function inheritedContext(key: string, underNpm: boolean): boolean {
  return key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_") || key === "CLAUDE_PID" || key === "CLAUDE_EFFORT"
    || GIT_CONTEXT.has(key) || npmContext(key, underNpm);
}

function machinePath(value: string, platform: NodeJS.Platform): string {
  const path = platform === "win32" ? win32 : posix;
  const entries = value.split(path.delimiter);
  const last = entries.map(entry => path.basename(entry.replace(/[\\/]+$/, ""))).lastIndexOf("node-gyp-bin");
  return entries.slice(last + 1).join(path.delimiter);
}

export function machineEnvironment(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const underNpm = env.npm_lifecycle_event !== undefined || env.npm_command !== undefined;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || inheritedContext(key, underNpm)) continue;
    clean[key] = underNpm && /^path$/i.test(key) ? machinePath(value, platform) : value;
  }
  return clean;
}

export function childEnvironment(extra?: Record<string, string>): Record<string, string> {
  return { ...machineEnvironment(), ...extra };
}
