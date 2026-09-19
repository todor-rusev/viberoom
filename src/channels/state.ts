// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, parse, resolve, sep } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import type { Platform } from "./types.js";

export interface TelegramConfig {
  enabled: boolean;
  token: string;
  apiBase?: string;
  name?: string;
}

export interface ChatBinding {
  roomId: string;
  cursorSeq: number;
  since: number;
  live?: { messageId: string; roomMessageId: string };
  wedge?: { messageId: string; turnId: string };
}

export interface Pairing {
  platform: Platform;
  senderId: string;
  name: string;
  role: "owner";
  pairedAt: number;
  unpairedAt?: number;
}

export interface DetachedNote {
  roomName: string;
  why: "switched-off" | "removed";
  at: number;
}

export interface FileRoot {
  path: string;
  subfolders: boolean;
}

export interface ChannelsState {
  version: 1;
  telegram?: TelegramConfig;
  bindings: Record<string, ChatBinding>;
  detached: Record<string, DetachedNote>;
  fileRoots: FileRoot[];
  phoneApprovals?: boolean;
  pairings: Pairing[];
}

const EMPTY: ChannelsState = { version: 1, bindings: {}, pairings: [], detached: {}, fileRoots: [] };

export class ChannelsStore {
  private state: ChannelsState;

  constructor(readonly path: string) {
    this.state = load(path);
  }

  get(): ChannelsState {
    return this.state;
  }

  update(change: (state: ChannelsState) => void): void {
    change(this.state);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileAtomic(this.path, JSON.stringify(this.state, null, 2) + "\n");
    if (process.platform !== "win32") chmodSync(this.path, 0o600);
  }

  describe(): { telegram: { enabled: boolean; tokenSet: boolean } | null; bindings: number; paired: number } {
    const t = this.state.telegram;
    return { telegram: t ? { enabled: t.enabled, tokenSet: !!t.token } : null, bindings: Object.keys(this.state.bindings).length, paired: this.activePairings().length };
  }

  allowed(platform: Platform, senderId: string): boolean {
    return this.activePairings().some((p) => p.platform === platform && p.senderId === senderId);
  }

  activePairings(): Pairing[] {
    return this.state.pairings.filter((p) => !p.unpairedAt);
  }

  reload(): void {
    this.state = load(this.path);
  }
}

export function pathInside(child: string, root: string): boolean {
  const [c, r] = process.platform === "linux" ? [child, root] : [child.toLowerCase(), root.toLowerCase()];
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

export function fileRootRefusal(root: string, dataDir: string, home: string = homedir()): string | null {
  const full = resolve(root);
  if (full === parse(full).root) return `${root} is the whole disk: too wide for the phone`;
  if (pathInside(resolve(home), full)) return `${root} holds your home folder: too wide for the phone`;
  const data = resolve(dataDir);
  if (pathInside(data, full) || pathInside(full, data)) return `${root} holds viberoom's own data (the record and the bot token): not for the phone`;
  return null;
}

export function maskToken(token: string): string {
  return token ? `${token.slice(0, 4)}…(${token.length} chars)` : "";
}

function load(path: string): ChannelsState {
  if (!existsSync(path)) return structuredClone(EMPTY);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ChannelsState>;
  const state: ChannelsState = { version: 1, bindings: {}, pairings: [], detached: {}, fileRoots: [] };
  if (Array.isArray(raw.fileRoots)) {
    for (const r of raw.fileRoots as unknown[]) {
      if (typeof r === "string" && r.trim()) state.fileRoots.push({ path: r, subfolders: true });
      else if (r && typeof r === "object" && typeof (r as { path?: unknown }).path === "string" && (r as { path: string }).path.trim()) state.fileRoots.push({ path: (r as { path: string }).path, subfolders: (r as { subfolders?: unknown }).subfolders !== false });
    }
  }
  if (Array.isArray(raw.pairings)) {
    for (const p of raw.pairings as Partial<Pairing>[]) {
      if (!p || (p.platform !== "telegram" && p.platform !== "discord") || typeof p.senderId !== "string") continue;
      state.pairings.push({ platform: p.platform, senderId: p.senderId, name: typeof p.name === "string" ? p.name : "", role: "owner", pairedAt: Number(p.pairedAt) || 0, unpairedAt: p.unpairedAt ? Number(p.unpairedAt) : undefined });
    }
  }
  if (raw.telegram && typeof raw.telegram === "object") {
    const t = raw.telegram as Partial<TelegramConfig>;
    state.telegram = {
      enabled: t.enabled === true,
      token: typeof t.token === "string" ? t.token : "",
      apiBase: typeof t.apiBase === "string" && t.apiBase ? t.apiBase : undefined,
      name: typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 64) : undefined,
    };
  }
  if (raw.bindings && typeof raw.bindings === "object") {
    for (const [key, value] of Object.entries(raw.bindings as Record<string, Partial<ChatBinding>>)) {
      if (!value || typeof value.roomId !== "string") continue;
      state.bindings[key] = { roomId: value.roomId, cursorSeq: Number.isFinite(value.cursorSeq) ? Number(value.cursorSeq) : 0, since: Number.isFinite(value.since) ? Number(value.since) : 0 };
      const live = value.live;
      if (live && typeof live.messageId === "string" && typeof live.roomMessageId === "string") state.bindings[key].live = { messageId: live.messageId, roomMessageId: live.roomMessageId };
    }
  }
  if (raw.detached && typeof raw.detached === "object") {
    for (const [key, value] of Object.entries(raw.detached as Record<string, Partial<DetachedNote>>)) {
      if (!value || typeof value.roomName !== "string" || (value.why !== "switched-off" && value.why !== "removed")) continue;
      state.detached[key] = { roomName: value.roomName, why: value.why, at: Number(value.at) || 0 };
    }
  }
  return state;
}
