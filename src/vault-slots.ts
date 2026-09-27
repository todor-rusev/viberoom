// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { isVaultRef, vaultRef, type Vault } from "./vault.js";

export interface SecretSlot {
  name: string;
  get(): unknown;
  set(value: string): void;
}

export function adoptSecrets(slots: SecretSlot[], vault: () => Vault | null): boolean {
  const set = slots.filter((slot) => { const v = slot.get(); return typeof v === "string" && v; });
  if (!set.length) return false;
  const opened = vault();
  if (!opened) return false;
  let plaintextFound = false;
  for (const slot of set) {
    const value = slot.get();
    if (isVaultRef(value)) slot.set(opened.resolve(value));
    else plaintextFound = true;
  }
  return plaintextFound;
}

export function withReferences<T>(state: T, slotsOf: (state: T) => SecretSlot[], vault: () => Vault | null): T {
  const secret = slotsOf(state).filter((slot) => { const v = slot.get(); return typeof v === "string" && v && !isVaultRef(v); });
  if (!secret.length) return state;
  const opened = vault();
  if (!opened) return state;
  for (const slot of secret) {
    const value = slot.get() as string;
    if (opened.get(slot.name) !== value) opened.set(slot.name, value);
  }
  const copy = structuredClone(state);
  for (const slot of slotsOf(copy)) {
    const value = slot.get();
    if (typeof value === "string" && value && !isVaultRef(value)) slot.set(vaultRef(slot.name));
  }
  return copy;
}
