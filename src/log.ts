// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export class Logger {
  constructor(private readonly scope: string) {}

  info(message: string): void {
    process.stderr.write(`[${timestamp()}] [${this.scope}] ${message}\n`);
  }

  warn(message: string): void {
    process.stderr.write(`[${timestamp()}] [${this.scope}] WARN ${message}\n`);
  }

  error(message: string): void {
    process.stderr.write(`[${timestamp()}] [${this.scope}] ERROR ${message}\n`);
  }

  child(scope: string): Logger {
    return new Logger(`${this.scope}/${scope}`);
  }
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export type TranscriptMode = "off" | "errors" | "full";

const ERROR_BUFFER = 200;
const clearedDirectories = new Map<string, number>();
const directoryKey = (directory: string): string => process.platform === "win32" ? resolve(directory).toLowerCase() : resolve(directory);

export class Transcript {
  readonly path: string;
  private readonly mode: TranscriptMode;
  private readonly recent: string[] = [];
  private opened = false;
  private readonly directory: string;
  private generation: number;

  static forgetDirectory(directory: string): void {
    const key = directoryKey(directory);
    clearedDirectories.set(key, (clearedDirectories.get(key) ?? 0) + 1);
  }

  private forgetClearedBuffer(): void {
    const generation = clearedDirectories.get(this.directory) ?? 0;
    if (generation === this.generation) return;
    this.recent.length = 0;
    this.opened = false;
    this.generation = generation;
  }

  constructor(directory: string, name: string, mode: TranscriptMode = "full") {
    this.mode = mode;
    this.directory = directoryKey(directory);
    this.generation = clearedDirectories.get(this.directory) ?? 0;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (mode !== "off") mkdirSync(directory, { recursive: true });
    this.path = join(directory, `${name}-${stamp}.jsonl`);
  }

  record(direction: "in" | "out", message: unknown): void {
    if (this.mode === "off") return;
    this.forgetClearedBuffer();
    const line = JSON.stringify({ t: Date.now(), dir: direction === "out" ? "C->A" : "A->C", msg: message }) + "\n";
    if (this.mode === "full" || this.opened) {
      appendFileSync(this.path, line);
      return;
    }
    this.recent.push(line);
    if (this.recent.length > ERROR_BUFFER) this.recent.shift();
  }

  dump(reason: string): string | null {
    this.forgetClearedBuffer();
    if (this.mode !== "errors" || this.opened || !this.recent.length) return null;
    const head = JSON.stringify({ t: Date.now(), dir: "note", msg: { note: `kept because: ${reason}`, held: this.recent.length } }) + "\n";
    appendFileSync(this.path, head + this.recent.join(""));
    this.recent.length = 0;
    this.opened = true;
    return this.path;
  }
}

export function requestLogPath(raw: string | undefined): string {
  try { return new URL(raw ?? "/", "http://localhost").pathname; }
  catch { return "[invalid request URL]"; }
}
