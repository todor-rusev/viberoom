// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { machineEnvironment } from "./child-environment.js";

export const RUN_AS_NODE: Readonly<Record<string, string>> = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};

export function runAsNodeEntries(): { name: string; value: string }[] {
  return Object.entries(RUN_AS_NODE).map(([name, value]) => ({ name, value }));
}

export function withRunAsNode(extra?: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...machineEnvironment(), ...extra })) if (value !== undefined) env[name] = value;
  return { ...env, ...RUN_AS_NODE };
}
