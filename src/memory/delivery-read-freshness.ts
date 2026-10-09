// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export const DELIVERY_FRESH_READ_MAX_AGE_MS = 1000;

export function freshCompleteReadTimes(scan: unknown, now: number, minimumStarts: readonly number[] = []): boolean {
  if (!scan || typeof scan !== "object" || !Number.isSafeInteger(now) || now < 0) return false;
  const { startedAt, finishedAt } = scan as { startedAt: number; finishedAt: number };
  return Number.isSafeInteger(startedAt) && startedAt >= 0 && Number.isSafeInteger(finishedAt) &&
    finishedAt >= startedAt && finishedAt <= now && now - finishedAt <= DELIVERY_FRESH_READ_MAX_AGE_MS &&
    minimumStarts.every(at => Number.isSafeInteger(at) && at >= 0 && at <= startedAt);
}
