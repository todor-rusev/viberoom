// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

let sink: (line: string) => void = (line) => void process.stderr.write(line);

export class Logger {
  constructor(private readonly scope: string) {}

  info(message: string): void {
    sink(`[${timestamp()}] [${this.scope}] ${message}\n`);
  }

  warn(message: string): void {
    sink(`[${timestamp()}] [${this.scope}] WARN ${message}\n`);
  }

  error(message: string): void {
    sink(`[${timestamp()}] [${this.scope}] ERROR ${message}\n`);
  }

  child(scope: string): Logger {
    return new Logger(`${this.scope}/${scope}`);
  }
}

const LOG_MAX_BYTES = 5 * 1024 * 1024;

interface OpenLog { fd: number; path: string; written: number; limit: number; alsoStderr: boolean }
let file: OpenLog | null = null;

export function logToFile(path: string, options: { limit?: number; alsoStderr?: boolean } = {}): void {
  closeLogFile();
  const limit = options.limit ?? LOG_MAX_BYTES;
  file = {
    fd: openSync(path, "a"),
    path,
    written: existsSync(path) ? statSync(path).size : 0,
    limit,
    alsoStderr: options.alsoStderr ?? false,
  };
  sink = (line) => {
    if (file && file.alsoStderr) process.stderr.write(line);
    writeLine(line);
  };
}

export function closeLogFile(): void {
  if (file) {
    try {
      closeSync(file.fd);
    } catch {
    }
    file = null;
  }
  sink = (line) => void process.stderr.write(line);
}

function writeLine(line: string): void {
  if (!file) return;
  const bytes = Buffer.byteLength(line);
  if (file.written + bytes > file.limit) rotate();
  try {
    writeSync(file.fd, line);
    file.written += bytes;
  } catch {
  }
}

function rotate(): void {
  if (!file) return;
  const { path, limit, alsoStderr } = file;
  const aside = `${path}.rotating`;
  try {
    closeSync(file.fd);
    rmSync(aside, { force: true });
    renameSync(path, aside);
    rmSync(`${path}.1`, { force: true });
    renameSync(aside, `${path}.1`);
  } catch {
  }
  try {
    file = { fd: openSync(path, "a"), path, written: existsSync(path) ? statSync(path).size : 0, limit, alsoStderr };
  } catch {
    closeLogFile();
  }
}
const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

function offset(at: Date): string {
  const minutes = -at.getTimezoneOffset();
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

export function logTime(at = new Date()): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}${offset(at)}`;
}

export function logDateTime(at = new Date()): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${logTime(at)}`;
}

function timestamp(): string {
  return logTime();
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
    this.append({ t: Date.now(), dir: direction === "out" ? "C->A" : "A->C", msg: message });
  }

  note(text: string): void {
    if (this.mode === "off") return;
    this.append({ t: Date.now(), dir: "note", msg: { note: text } });
  }

  private append(entry: unknown): void {
    this.forgetClearedBuffer();
    const line = JSON.stringify(entry) + "\n";
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
