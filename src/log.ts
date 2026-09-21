// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { forgetTranscriptBudgets, reserveTranscript, TRANSCRIPT_LIMITS } from "./transcript-budget.js";

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
export const OPERATIONAL_LOG_KEEP = { ms: 7 * 24 * 60 * 60 * 1000, bytes: LOG_MAX_BYTES };
const ROLL_RETRY_MS = 5_000;

interface OpenLog { fd: number; path: string; written: number; limit: number; alsoStderr: boolean; retryAt: number }
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
    retryAt: 0,
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
  if (file.written + bytes > file.limit && Date.now() >= file.retryAt) rotate();
  try {
    writeSync(file.fd, line);
    file.written += bytes;
  } catch {
  }
}

function rotate(): void {
  if (!file) return;
  const { path, limit, alsoStderr } = file;
  try {
    closeSync(file.fd);
  } catch {
  }
  const moved = rollAside(path, OPERATIONAL_LOG_KEEP);
  try {
    file = { fd: openSync(path, "a"), path, written: existsSync(path) ? statSync(path).size : 0, limit, alsoStderr, retryAt: moved ? 0 : Date.now() + ROLL_RETRY_MS };
  } catch {
    closeLogFile();
  }
}

export function rollAside(path: string, keep: { ms?: number | null; bytes: number }): boolean {
  let moved = false;
  try {
    if (existsSync(path)) {
      renameSync(path, archiveName(path, new Date()));
      moved = true;
    }
  } catch {
  }
  prune(path, keep.ms ?? null, keep.bytes);
  return moved;
}

function archiveName(path: string, at: Date): string {
  const { directory, base, ext } = nameParts(path);
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
    + `_${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
  return join(directory, `${base}-${stamp}${ext}`);
}

function nameParts(path: string): { directory: string; base: string; ext: string } {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return { directory: dirname(path), base: dot > 0 ? name.slice(0, dot) : name, ext: dot > 0 ? name.slice(dot) : "" };
}

const ARCHIVE_STAMP = /^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)\.(\d{3})$/;

function archivesOf(path: string): { path: string; at: number; size: number }[] {
  const { directory, base, ext } = nameParts(path);
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  const found: { path: string; at: number; size: number }[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(`${base}-`) || !entry.endsWith(ext)) continue;
    const middle = entry.slice(base.length + 1, entry.length - ext.length);
    const parts = ARCHIVE_STAMP.exec(middle);
    if (!parts) continue;
    const at = new Date(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], +parts[6], +parts[7]).getTime();
    try {
      found.push({ path: join(directory, entry), at, size: statSync(join(directory, entry)).size });
    } catch {
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

function prune(path: string, keepMs: number | null, keepBytes: number): void {
  const archives = archivesOf(path);
  let total = archives.reduce((sum, archive) => sum + archive.size, 0);
  const now = Date.now();
  for (const archive of archives) {
    const tooOld = keepMs !== null && now - archive.at > keepMs;
    if (!tooOld && total <= keepBytes) break;
    try {
      rmSync(archive.path, { force: true });
      total -= archive.size;
    } catch {
    }
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

const transcriptTrouble = new Logger("transcript");

export class Transcript {
  readonly path: string;
  private mode: TranscriptMode;
  private readonly recent: string[] = [];
  private recentBytes = 0;
  private omitted = 0;
  private opened = false;
  private lost = 0;
  private told = false;
  private readonly directory: string;
  private generation: number;

  static forgetDirectory(directory: string): void {
    const key = directoryKey(directory);
    clearedDirectories.set(key, (clearedDirectories.get(key) ?? 0) + 1);
    forgetTranscriptBudgets();
  }

  private forgetClearedBuffer(): void {
    const generation = clearedDirectories.get(this.directory) ?? 0;
    if (generation === this.generation) return;
    this.recent.length = 0;
    this.recentBytes = 0;
    this.omitted = 0;
    this.opened = false;
    this.generation = generation;
  }

  constructor(directory: string, name: string, mode: TranscriptMode = "full", private readonly budgetRoot?: string) {
    this.mode = mode;
    this.directory = directoryKey(directory);
    this.generation = clearedDirectories.get(this.directory) ?? 0;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.path = join(directory, `${name}-${stamp}.jsonl`);
    if (mode !== "off") {
      try { mkdirSync(directory, { recursive: true }); }
      catch { }
    }
  }

  record(direction: "in" | "out", message: unknown): void {
    if (this.mode === "off") return;
    this.append({ t: Date.now(), dir: direction === "out" ? "C->A" : "A->C", msg: message });
  }

  setMode(mode: TranscriptMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.recent.length = 0;
    this.recentBytes = 0;
    this.omitted = 0;
    this.opened = false;
    if (mode !== "off") {
      try { mkdirSync(dirname(this.path), { recursive: true }); }
      catch { }
    }
  }

  note(text: string): void {
    if (this.mode === "off") return;
    this.append({ t: Date.now(), dir: "note", msg: { note: text } });
  }

  private append(entry: unknown): void {
    this.forgetClearedBuffer();
    let line: string;
    try { line = JSON.stringify(entry) + "\n"; }
    catch { line = JSON.stringify({ t: Date.now(), dir: "note", msg: { note: "A diagnostic record could not be serialized." } }) + "\n"; }
    const bytes = Buffer.byteLength(line);
    if (bytes > TRANSCRIPT_LIMITS.recordBytes) {
      line = JSON.stringify({ t: Date.now(), dir: "note", msg: { note: "Diagnostic record shortened to its preview; the conversation is unchanged.", originalBytes: bytes, preview: line.slice(0, TRANSCRIPT_LIMITS.recordBytes / 8) } }) + "\n";
    }
    if (this.mode === "full" || this.opened) {
      this.write(line);
      return;
    }
    this.recent.push(line);
    this.recentBytes += Buffer.byteLength(line);
    while (this.recent.length > ERROR_BUFFER || this.recentBytes > TRANSCRIPT_LIMITS.bufferBytes) {
      this.recentBytes -= Buffer.byteLength(this.recent.shift()!);
      this.omitted++;
    }
  }

  private write(line: string): void {
    try {
      const missed = this.lost;
      const prefix = missed ? JSON.stringify({ t: Date.now(), dir: "note", msg: { note: `${missed} line${missed === 1 ? "" : "s"} could not be written here: the file was busy.` } }) + "\n" : "";
      const text = prefix + line;
      const reservation = reserveTranscript(this.path, Buffer.byteLength(text), this.budgetRoot);
      appendFileSync(this.path, text);
      reservation.commit();
      if (reservation.pruned) transcriptTrouble.info(`removed ${reservation.pruned} old diagnostic file(s) to keep the retention budget`);
      this.lost = 0;
      this.told = false;
    } catch (error) {
      this.lost++;
      if (this.told) return;
      this.told = true;
      const why = error instanceof Error ? error.message : String(error);
      transcriptTrouble.warn(`a transcript could not be written (${why}); its lines are dropped while that lasts. The conversation itself is in the store and is not affected: ${this.path}`);
    }
  }

  get droppedLines(): number {
    return this.lost;
  }

  dump(reason: string): string | null {
    this.forgetClearedBuffer();
    if (this.mode !== "errors" || this.opened || !this.recent.length) return null;
    const head = JSON.stringify({ t: Date.now(), dir: "note", msg: { note: `kept because: ${reason.slice(0, 1000)}`, held: this.recent.length, ...(this.omitted ? { omittedOlderRecords: this.omitted } : {}) } }) + "\n";
    this.write(head + this.recent.join(""));
    this.recent.length = 0;
    this.recentBytes = 0;
    this.omitted = 0;
    this.opened = true;
    return this.path;
  }
}

export function requestLogPath(raw: string | undefined): string {
  try { return new URL(raw ?? "/", "http://localhost").pathname; }
  catch { return "[invalid request URL]"; }
}

export function sayTheLastWord(options: { scope?: string; also?: (message: string, reason: string) => void; exit?: (code: number) => void; remember?: () => string | null | undefined; witness?: () => string[] | undefined } = {}): void {
  const log = new Logger(options.scope ?? "hub");
  const end = options.exit ?? ((code: number) => process.exit(code));
  const die = (what: string) => (error: unknown) => {
    const reason = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const message = `viberoom is stopping: something ${what} and nobody caught it. Your conversations are in the store and are not affected; start viberoom again when you are ready.`;
    log.error(message + String.fromCharCode(10) + reason);
    const folder = options.remember?.();
    if (folder) {
      let writing: string[] | undefined;
      try {
        writing = options.witness?.();
      } catch {
      }
      try {
        writeFileSync(join(folder, "last-fault.json"), JSON.stringify({ at: Date.now(), reason: reason.split(String.fromCharCode(10))[0].slice(0, 300), ...(writing ? { writing } : {}) }));
      } catch {
      }
    }
    if (options.also) {
      try {
        options.also(message, reason);
      } catch {
      }
    }
    end(1);
  };
  process.on("uncaughtException", die("went wrong"));
  process.on("unhandledRejection", die("failed without being waited for"));
}
