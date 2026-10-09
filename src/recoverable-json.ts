// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.js";

const RECOVERY_SUFFIX = /^[1-9]\d*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bak$/;

export class RecoverableJsonFile {
  private broken: Buffer | null = null;
  private unreadable = false;
  private problemText: string | null = null;
  private copy: string | null = null;

  constructor(readonly path: string, private readonly label: string, private readonly report?: (message: string) => void,
    private readonly io: { preserve?: (path: string, bytes: Buffer) => void; replace?: (path: string, text: string) => void } = {}) {}

  get problem(): string | null { return this.problemText; }
  get recoveryCopy(): string | null { return this.copy; }

  read(valid?: (value: Record<string, unknown>) => boolean): Record<string, unknown> | null {
    this.broken = null;
    this.unreadable = false;
    this.problemText = null;
    this.copy = null;
    let bytes: Buffer;
    try { bytes = readFileSync(this.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      this.unreadable = true;
      this.problemText = `${this.label} could not be read. The file was left unchanged at ${this.path}. Check access to it and restart viberoom.`;
      this.report?.(this.problemText);
      return null;
    }
    try {
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Settings must be an object");
      if (valid && !valid(value as Record<string, unknown>)) throw new Error("Settings have an invalid shape");
      return value as Record<string, unknown>;
    } catch {
      this.broken = bytes;
      this.problemText = `${this.label} could not be read. The original file is kept at ${this.path}. Restore it and restart, or set up the feature again; a recovery copy will be kept before new settings replace it.`;
      this.report?.(this.problemText);
      return null;
    }
  }

  prepareWrite(): void {
    if (this.unreadable) throw new Error(`${this.label} cannot be saved until the existing file can be read: ${this.path}`);
    if (this.broken !== null) {
      let current: Buffer;
      try { current = readFileSync(this.path); }
      catch { throw new Error(`${this.label} changed on disk. Restart viberoom before saving new settings.`); }
      if (!current.equals(this.broken)) throw new Error(`${this.label} changed on disk. Restart viberoom before saving new settings.`);
      if (!this.copy) {
        const copy = `${this.path}.unreadable-${Date.now()}-${randomUUID()}.bak`;
        try {
          if (this.io.preserve) this.io.preserve(copy, this.broken);
          else writeFileSync(copy, this.broken, { flag: "wx", mode: 0o600, flush: true });
        }
        catch { throw new Error(`${this.label} could not be preserved. The original file was left unchanged at ${this.path}.`); }
        this.copy = copy;
        this.report?.(`The unreadable ${this.label.toLowerCase()} were preserved at ${copy}.`);
      }
    }
  }

  write(value: unknown): void {
    const text = JSON.stringify(value, null, 2) + "\n";
    this.prepareWrite();
    try { (this.io.replace ?? writeFileAtomic)(this.path, text); }
    catch (error) {
      if (this.copy) this.problemText = `${this.label} could not be saved. The previous file is preserved at ${this.copy}.`;
      throw error;
    }
    this.broken = null;
    this.problemText = null;
  }

  clear(): void {
    rmSync(this.path, { force: true });
    const prefix = `${basename(this.path)}.unreadable-`;
    for (const entry of readdirSync(dirname(this.path), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith(prefix) && RECOVERY_SUFFIX.test(entry.name.slice(prefix.length))) {
        rmSync(join(dirname(this.path), entry.name));
      }
    }
    this.broken = null;
    this.unreadable = false;
    this.problemText = null;
    this.copy = null;
  }
}
