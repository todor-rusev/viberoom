// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export function hostOf(baseUrl: string): string {
  try { return new URL(baseUrl).host || baseUrl; } catch { return baseUrl; }
}

export function isThisComputer(host: string): boolean {
  return /^(localhost|127\.|\[::1\])/i.test(host);
}
