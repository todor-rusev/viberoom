// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { IncomingHttpHeaders } from "node:http";

export type DoorKind = "key" | "token" | "public";

export const PUBLIC_ROUTES: { path: string; why: string }[] = [
  {
    path: "/api/version",
    why: "`viberoom stop` and `viberoom status` must recognise a hub they do not own before touching it",
  },
];

const TOKEN_PREFIX = "/api/mcp/";

const SHELL_FILE = /^\/(?:[a-z0-9_-]+\.(?:js|css|html|svg|json|png|ico|woff2)|styleguide|guide)$/i;
const SHELL_FOLDERS = ["/fonts/", "/vendor/", "/vendor-icons/", "/vendor/prism-lang/", "/connection-logos/", "/faces/", "/page/"];
const NOT_SHELL = ["/looks-custom.css"];

export function isShell(path: string): boolean {
  if (path === "/") return true;
  if (NOT_SHELL.includes(path)) return false;
  if (SHELL_FOLDERS.some((folder) => path.startsWith(folder))) return true;
  return SHELL_FILE.test(path);
}

export function doorOf(path: string): DoorKind {
  if (PUBLIC_ROUTES.some((route) => route.path === path)) return "public";
  if (path === TOKEN_PREFIX.slice(0, -1) || path.startsWith(TOKEN_PREFIX)) return "token";
  if (isShell(path)) return "public";
  return "key";
}

export function originAllowed(origin: string | undefined, port: number): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  return loopback && url.port === String(port);
}

export function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const at = host.lastIndexOf(":");
  const name = (at > host.lastIndexOf("]") ? host.slice(0, at) : host).toLowerCase();
  const given = at > host.lastIndexOf("]") ? host.slice(at + 1) : "";
  if (given && given !== String(port)) return false;
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

export const KEY_HEADER = "x-viberoom-key";
export const KEY_COOKIE = "viberoom_key";

export function keyCookie(port: number): string {
  return `${KEY_COOKIE}_${port}`;
}

export const OPENING_PARAM = "open";

export type KeySource = "header" | "cookie" | "legacy-cookie";

export function keySource(headers: IncomingHttpHeaders, port?: number): { value: string; from: KeySource } | null {
  const header = headers[KEY_HEADER];
  if (typeof header === "string" && header) return { value: header, from: "header" };
  const cookie = headers.cookie;
  if (typeof cookie !== "string") return null;
  const cookies = new Map<string, string>();
  for (const part of cookie.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(at + 1).trim());
  }
  const decoded = (raw: string | undefined): string | null => {
    if (raw === undefined) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return "";
    }
  };
  const own = port === undefined ? null : decoded(cookies.get(keyCookie(port)));
  if (own !== null) return own ? { value: own, from: "cookie" } : null;
  const legacy = decoded(cookies.get(KEY_COOKIE));
  return legacy ? { value: legacy, from: port === undefined ? "cookie" : "legacy-cookie" } : null;
}

export function keyFrom(headers: IncomingHttpHeaders, port?: number): string | null {
  const carried = keySource(headers, port);
  return carried ? carried.value : null;
}

function windowCookie(port: number, key: string): string {
  return `${keyCookie(port)}=${encodeURIComponent(key)}; Path=/; SameSite=Strict; HttpOnly`;
}

export type GateOutcome =
  | { ok: true; setCookie?: string }
  | { ok: false; status: number; message: string };

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function checkGate(request: { method: string; path: string; opening: string | null; headers: IncomingHttpHeaders },
  expected: string, port: number, sameKey: (expected: string, given: string | null | undefined) => boolean,
  spend: (opening: string) => boolean = () => false): GateOutcome {
  const door = doorOf(request.path);
  const host = typeof request.headers.host === "string" ? request.headers.host : undefined;
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
  const foreign = { ok: false as const, status: 403, message: "That request came from another page, not from this room's window." };
  if (request.opening && hostAllowed(host, port) && (!origin || originAllowed(origin, port)) && spend(request.opening)) {
    return { ok: true, setCookie: windowCookie(port, expected) };
  }
  if (door !== "key") return { ok: true };
  if (!hostAllowed(host, port)) return { ok: false, status: 403, message: "This room answers only on this machine's own address." };
  if (origin && !originAllowed(origin, port)) return foreign;
  const carried = keySource(request.headers, port);
  if (!carried || !sameKey(expected, carried.value)) return { ok: false, status: 401, message: KEY_MISSING };
  if (!origin && WRITES.has(request.method) && carried.from !== "header") return foreign;
  if (carried.from === "legacy-cookie") return { ok: true, setCookie: windowCookie(port, expected) };
  return { ok: true };
}

export const KEY_MISSING = "This request has no local key. Open viberoom from its icon; a window opened that way carries one.";
