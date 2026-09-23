// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
const GIT_CONTEXT = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_OBJECT_DIRECTORY",
  "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE", "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE", "GIT_PREFIX", "GIT_SHALLOW_FILE", "GIT_COMMON_DIR",
  "GIT_EXEC_PATH", "GIT_REFLOG_ACTION", "GIT_QUARANTINE_PATH",
]);

function inheritedContext(key: string): boolean {
  return key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_") || key === "CLAUDE_PID" || key === "CLAUDE_EFFORT" || GIT_CONTEXT.has(key);
}

export function machineEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined && !inheritedContext(key)) clean[key] = value;
  return clean;
}

export function childEnvironment(extra?: Record<string, string>): Record<string, string> {
  return { ...machineEnvironment(), ...extra };
}
