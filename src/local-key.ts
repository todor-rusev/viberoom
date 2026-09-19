// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { narrowToOwner, whoElseCanReach, type PathAccess } from "./private-path.js";


export const KEY_FILE = "local-key";
const KEY_BYTES = 32;
const KEY_PATTERN = /^[0-9a-f]{64}$/;

export interface LocalKey {
  value: string;
  path: string;
  access: PathAccess;
  fresh: boolean;
}

export function loadOrCreateKey(dataDir: string): LocalKey {
  const path = join(dataDir, KEY_FILE);
  if (existsSync(path)) {
    const value = readFileSync(path, "utf8").trim();
    if (KEY_PATTERN.test(value)) return { value, path, access: whoElseCanReach(path), fresh: false };
  }
  const value = randomBytes(KEY_BYTES).toString("hex");
  writeFileSync(path, "", { mode: 0o600 });
  narrowToOwner(path, "file");
  writeFileSync(path, value, { mode: 0o600 });
  return { value, path, access: whoElseCanReach(path), fresh: true };
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
  try {
    const value = readFileSync(join(dataDir, KEY_FILE), "utf8").trim();
    return KEY_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function keyMatches(expected: string, given: string | undefined | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

