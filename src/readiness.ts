// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export type Readiness = { ready: true } | { ready: false; reason: string; missing: string };

export function readinessView(readiness: Readiness): { ready: boolean; reason?: string; missing?: string } {
  return readiness.ready ? { ready: true } : { ready: false, reason: readiness.reason, missing: readiness.missing };
}
