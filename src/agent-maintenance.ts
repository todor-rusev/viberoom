// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
const owners = new Map<string, symbol>();
const readers = new Map<string, number>();
export function useAgent(vendor: string): () => void {
  assertAgentAvailable(vendor);
  readers.set(vendor, (readers.get(vendor) ?? 0) + 1);
  let released = false;
  return () => { if (!released) { released = true; readers.set(vendor, Math.max(0, (readers.get(vendor) ?? 1) - 1)); } };
}
export function assertAgentAvailable(vendor: string): void {
  if (owners.has(vendor)) throw new Error(`${vendor}'s installation is being changed. Wait for it to finish, then try again.`);
}
export function holdAgent(vendor: string): () => void {
  assertAgentAvailable(vendor);
  if (readers.get(vendor)) throw new Error(`${vendor} is still being checked. Wait for that check to finish before updating.`);
  const token = Symbol(vendor); owners.set(vendor, token);
  return () => { if (owners.get(vendor) === token) owners.delete(vendor); };
}
