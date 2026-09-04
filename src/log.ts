// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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

export class Transcript {
  readonly path: string;

  constructor(directory: string, name: string) {
    mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.path = join(directory, `${name}-${stamp}.jsonl`);
  }

  record(direction: "in" | "out", message: unknown): void {
    appendFileSync(this.path, JSON.stringify({ t: Date.now(), dir: direction === "out" ? "C->A" : "A->C", msg: message }) + "\n");
  }
}
