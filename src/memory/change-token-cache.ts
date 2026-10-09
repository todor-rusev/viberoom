// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

export class ChangeTokenCache<T> {
  #kept: { token: string; key: string; value: T } | null = null;
  #computations = 0;

  read(token: string, key: string, compute: () => T): T {
    const kept = this.#kept;
    if (kept !== null && kept.token === token && kept.key === key) return kept.value;
    this.#kept = null;
    this.#computations++;
    const value = deepFreeze(compute());
    this.#kept = { token, key, value };
    return value;
  }

  computations(): number {
    return this.#computations;
  }
}
