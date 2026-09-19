// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { execFileSync } from "node:child_process";
import { chmodSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";

const ACL_TIMEOUT_MS = 10_000;
const ALWAYS_ALLOWED = ["*S-1-5-18", "*S-1-5-32-544"];
const ALWAYS_ALLOWED_NAMES = [/^NT AUTHORITY\\SYSTEM$/i, /^BUILTIN\\Administrators$/i];

export interface PathAccess {
  others: string[];
  known: boolean;
}

function windowsTool(name: string): string {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return join(root, "System32", name);
}

function ownerId(): string {
  if (process.platform !== "win32") return userInfo().username;
  try {
    const line = execFileSync(windowsTool("whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", timeout: ACL_TIMEOUT_MS });
    const sid = /"[^"]*","(S-1-[0-9-]+)"/.exec(line.trim());
    if (sid) return `*${sid[1]}`;
  } catch {
  }
  return userInfo().username;
}

export function narrowToOwner(path: string, kind: "dir" | "file"): void {
  try {
    if (process.platform !== "win32") {
      chmodSync(path, kind === "dir" ? 0o700 : 0o600);
      return;
    }
    const grants = [ownerId(), ...ALWAYS_ALLOWED].flatMap((who) => ["/grant:r", `${who}:${kind === "dir" ? "(OI)(CI)F" : "F"}`]);
    execFileSync(windowsTool("icacls.exe"), [path, "/inheritance:r", ...grants], { encoding: "utf8", timeout: ACL_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
  }
}

function principalsOf(listing: string, path: string): string[] {
  return listing.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/Successfully processed|Failed processing/i.test(line))
    .map((line) => (line.startsWith(path) ? line.slice(path.length).trim() : line))
    .filter((line) => line.includes(":"))
    .map((line) => line.slice(0, line.lastIndexOf(":")).trim())
    .filter(Boolean);
}

export function whoElseCanReach(path: string): PathAccess {
  if (process.platform !== "win32") {
    try {
      const mode = statSync(path).mode & 0o777;
      const others: string[] = [];
      if (mode & 0o070) others.push("the file's group");
      if (mode & 0o007) others.push("everyone else on this machine");
      return { others, known: true };
    } catch {
      return { others: [], known: false };
    }
  }
  try {
    const listing = execFileSync(windowsTool("icacls.exe"), [path], { encoding: "utf8", timeout: ACL_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
    const me = userInfo().username;
    const mine = new RegExp(`(^|\\\\)${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const others = principalsOf(listing, path).filter((who) => !mine.test(who) && !ALWAYS_ALLOWED_NAMES.some((r) => r.test(who)));
    return { others: [...new Set(others)], known: true };
  } catch {
    return { others: [], known: false };
  }
}

export function wideOpenNotice(path: string, access: PathAccess): string | null {
  if (!access.known || !access.others.length) return null;
  const who = access.others.join(", ");
  const how = process.platform === "win32"
    ? `icacls "${path}" /inheritance:r /grant:r "%USERNAME%":(OI)(CI)F /grant:r *S-1-5-18:(OI)(CI)F /grant:r *S-1-5-32-544:(OI)(CI)F`
    : `chmod -R go-rwx "${path}"`;
  return `${path} can also be opened by ${who}. Everything viberoom keeps is in there: every room's record and the keys of any messenger you paired. To close it: ${how}`;
}
