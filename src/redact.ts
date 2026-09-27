// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

const SHAPES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bz_[A-Za-z0-9+/=._-]{40,}/g,
  /\bhch-[A-Za-z0-9_-]{20,}/g,
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}/g,
];

const MASK = "‹secret›";
const MIN_GUARDED_LENGTH = 8;

const guarded = new Set<string>();

export function guardSecret(value: string): void {
  if (typeof value === "string" && value.length >= MIN_GUARDED_LENGTH) guarded.add(value);
}

export function unguardSecret(value: string): void {
  guarded.delete(value);
}

export function forgetGuardedSecrets(): void {
  guarded.clear();
}

export function redact(text: string): string {
  let out = text;
  for (const value of guarded) {
    if (out.includes(value)) out = out.split(value).join(MASK);
  }
  for (const shape of SHAPES) {
    shape.lastIndex = 0;
    out = out.replace(shape, MASK);
  }
  return out;
}
