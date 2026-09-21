// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { whoElseCanReach, type PathAccess } from "./private-path.js";
import { createPrivateKey, readPrivateKey } from "./key-creation.js";
export { MAKE_PATIENCE_MS } from "./key-creation.js";


export const KEY_FILE = "local-key";
export interface LocalKey {
  value: string;
  path: string;
  access: PathAccess;
  fresh: boolean;
}

export function loadOrCreateKey(dataDir: string, options: { patienceMs?: number } = {}): LocalKey {
  const path = join(dataDir, KEY_FILE);
  const made = createPrivateKey(path, options);
  return { ...made, path, access: whoElseCanReach(path) };
}

const OPENING_MS = 5 * 60_000;

export function mintOpening(key: string, now: number = Date.now(), lifetimeMs: number = OPENING_MS): string {
  const nonce = randomBytes(12).toString("hex");
  const until = now + lifetimeMs;
  return `${nonce}.${until}.${signOpening(key, nonce, until)}`;
}

export function openingValid(key: string, value: string, now: number = Date.now()): boolean {
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [nonce, until, mac] = parts;
  if (!/^[0-9a-f]{24}$/.test(nonce) || !/^\d{1,15}$/.test(until) || Number(until) < now) return false;
  const want = signOpening(key, nonce, Number(until));
  return mac.length === want.length && timingSafeEqual(Buffer.from(mac, "utf8"), Buffer.from(want, "utf8"));
}

export function openingNonce(value: string): string {
  return value.split(".")[0] ?? "";
}

function signOpening(key: string, nonce: string, until: number): string {
  return createHmac("sha256", key).update(`${nonce}.${until}`).digest("hex");
}

export function readKey(dataDir: string): string | null {
  return readPrivateKey(join(dataDir, KEY_FILE));
}

export function keyMatches(expected: string, given: string | undefined | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
