// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { HUB_HOST } from "./launcher.js";

export interface PortHolder {
  build: string | null;
  dataDir: string | null;
  pid: number | null;
  url: string;
}

export type Claim<T> =
  | { kind: "bound"; server: T }
  | { kind: "ours"; holder: PortHolder }
  | { kind: "foreign"; holder: PortHolder }
  | { kind: "busy"; silentMs: number };

export interface ClaimOptions<T> {
  bind: () => Promise<T>;
  ask: () => Promise<PortHolder | null>;
  ours: (holder: PortHolder) => boolean;
  onOurs?: "attach" | "wait";
  patienceMs?: number;
  stepMs?: number;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function claimPort<T>(options: ClaimOptions<T>): Promise<Claim<T>> {
  const { bind, ask, ours, onOurs = "attach", patienceMs = 15_000, stepMs = 500, wait = sleep, now = Date.now } = options;
  const started = now();
  let lastOurs: PortHolder | null = null;
  for (;;) {
    try {
      return { kind: "bound", server: await bind() };
    } catch (error) {
      if ((error as { code?: string }).code !== "EADDRINUSE") throw error;
    }
    const holder = await ask();
    if (holder && !ours(holder)) return { kind: "foreign", holder };
    if (holder) {
      if (onOurs === "attach") return { kind: "ours", holder };
      lastOurs = holder;
    }
    if (now() - started >= patienceMs) {
      return lastOurs ? { kind: "ours", holder: lastOurs } : { kind: "busy", silentMs: now() - started };
    }
    await wait(stepMs);
  }
}

export function busyMessage(port: number, silentMs: number): string {
  return `port ${port} is held by something that does not answer as viberoom (asked for ${Math.round(silentMs / 1000)} s). If a room is starting there, give it a moment; otherwise pick another port: viberoom --port ${port + 1}`;
}

export function portAddress(port: number): string {
  return `${HUB_HOST}:${port}`;
}
