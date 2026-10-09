// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { createServer, Server, type RequestListener, type ServerOptions } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { writeFileSync, readFileSync, realpathSync, statSync, lstatSync } from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";

type Kind = "sqlite" | "http";
export interface NativeTestResourceRow {
  id: string; kind: Kind; path: string | null;
  constructorAttempted: boolean; constructorReturned: boolean;
  openAfterConstructor: boolean | null; startAttempts: number; startReturned: boolean;
  closeAttempts: number; closeCallReturned: boolean; closeEventObserved: boolean | null;
  openAfterClose: boolean | null; restored: boolean;
  fileLifetimes?: readonly NativeTestHttpLifetime[];
}
export interface NativeTestHttpLifetime {
  id: string; listenAttempted: boolean; listenReturned: boolean;
  closeAttempts: number; closeCallReturned: boolean; closeEvents: number;
  openAfterClose: boolean | null;
}
interface MethodObservation { name: "close" | "listen"; original: Function; descriptor: PropertyDescriptor | undefined; wrapper: Function }
interface Entry { row: NativeTestResourceRow; actual: DatabaseSync | Server | null; methods: MethodObservation[]; close: Promise<void> | null;
  lifetimes: NativeTestHttpLifetime[]; activeLifetime: NativeTestHttpLifetime | null;
  resolveClose: (() => void) | null; closeListener: (() => void) | null }
export interface NativeTestObservationIdentity { scopeId: string; selector: string; evidenceRoot: string | null; mode?: "file" }
export interface NativeTestObservationSnapshot {
  schema: "resident-owned-native-test-observation-v1"; scopeId: string; selector: string;
  writer: { processId: number; parentProcessId: number }; observerPin: { path: string; bytes: number; sha256: string };
  rows: readonly NativeTestResourceRow[]; acquisitionPins: ReadonlyArray<{ path: string; bytes: number; sha256: string }>;
  unknowns: ReadonlyArray<{ id: string; category: string }>; traceComplete: boolean;
}
const current = new AsyncLocalStorage<OwnedNativeTestObservation | undefined>();
const beginAcquisition = Symbol("native-test-begin");
const returnedAcquisition = Symbol("native-test-returned");
const maximum = 4096;
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const modulePath = fileURLToPath(import.meta.url);
function sorted(value: unknown): unknown { return Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(Reflect.get(value, key))])) : value; }
const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(sorted(value)) + "\n");
function filePin(path: string) { const bytes = readFileSync(path); return { path, bytes: bytes.length, sha256: sha(bytes) }; }
function physicalDirectory(path: string): string {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) throw new Error("native-test-evidence-root-refused");
  let at = path;
  for (;;) { if (lstatSync(at).isSymbolicLink()) throw new Error("native-test-evidence-link-refused"); const parent = dirname(at); if (parent === at) break; at = parent; }
  if (!statSync(path).isDirectory()) throw new Error("native-test-evidence-directory-required");
  return path;
}

export class OwnedNativeTestObservation {
  readonly id = randomUUID();
  readonly identity: Readonly<NativeTestObservationIdentity>;
  private readonly entries: Entry[] = [];
  private readonly unknowns: Array<{ id: string; category: string }> = [];
  private readonly acquisitionPins: Array<{ path: string; bytes: number; sha256: string }> = [];
  private retainedLifetimeCount = 0;
  private traceComplete = true;
  private finalizing = false;
  private lateMarkerWritten = false;
  private readonly lateIntentPins: Array<{ path: string; bytes: number; sha256: string }> = [];
  private finishPromise: Promise<NativeTestObservationSnapshot> | null = null;
  private readonly observerPin = filePin(modulePath);
  private readonly evidenceIdentity: { device: string; inode: string; birthtimeNs: string } | null;

  constructor(identity: NativeTestObservationIdentity) {
    if (!identity || !["evidenceRoot,scopeId,selector", "evidenceRoot,mode,scopeId,selector"].includes(Object.keys(identity).sort().join(",")) ||
      typeof identity.scopeId !== "string" || !identity.scopeId || typeof identity.selector !== "string" || !identity.selector ||
      !(identity.evidenceRoot === null || typeof identity.evidenceRoot === "string") ||
      (Object.hasOwn(identity, "mode") && identity.mode !== "file")) throw new Error("native-test-identity-refused");
    this.identity = Object.freeze({ ...identity });
    if (identity.evidenceRoot === null) this.evidenceIdentity = null;
    else { const root = physicalDirectory(identity.evidenceRoot), state = statSync(root, { bigint: true });
      this.evidenceIdentity = { device: String(state.dev), inode: String(state.ino), birthtimeNs: String(state.birthtimeNs) }; }
  }

  within<T>(operation: () => T): T { return current.run(this, operation); }
  enterFileContext(): Readonly<{ restore(): boolean }> {
    if (this.finalizing) throw new Error("native-test-file-context-closed");
    const before = current.getStore(); current.enterWith(this); let restored = false;
    return Object.freeze({ restore: (): boolean => {
      if (restored) return true;
      if (current.getStore() !== this) { this.issue("context", "file-context-restoration-unknown"); return false; }
      current.enterWith(before); restored = true; return true;
    } });
  }
  issue(id: string, category: string): void {
    if (this.unknowns.length < maximum) this.unknowns.push({ id, category }); else this.traceComplete = false;
  }
  [beginAcquisition](kind: Kind, path: string | null): Entry | null {
    if (this.finalizing) {
      this.issue("context", "acquisition-after-finalization");
      if (!this.lateMarkerWritten && this.identity.evidenceRoot !== null) {
        try {
          const root = physicalDirectory(this.identity.evidenceRoot), state = statSync(root, { bigint: true });
          const observed = { device: String(state.dev), inode: String(state.ino), birthtimeNs: String(state.birthtimeNs) };
          if (JSON.stringify(observed) !== JSON.stringify(this.evidenceIdentity)) throw new Error("changed");
          const bytes = encode({ schema: "resident-owned-native-test-late-intent-v1", scopeId: this.identity.scopeId,
            observerId: this.id, selector: this.identity.selector, writer: { processId: process.pid, parentProcessId: process.ppid },
            observerPin: this.observerPin, category: "acquisition-after-finalization", kind, path,
            constructorAttempted: false, constructorReturned: false });
          const lateIntentPath = join(root, `native-test-${this.id}-late-intent.json`);
          writeFileSync(lateIntentPath, bytes, { flag: "wx" });
          this.lateIntentPins.push({ path: lateIntentPath, bytes: bytes.length, sha256: sha(bytes) });
          this.lateMarkerWritten = true;
        } catch { this.issue("context", "late-acquisition-provenance-unknown"); }
      }
      throw new Error("native-test-acquisition-after-finalization");
    }
    if (this.entries.length >= maximum) { this.traceComplete = false; this.issue("context", "acquisition-trace-bound"); return null; }
    const row: NativeTestResourceRow = { id: `${kind}:${this.entries.length + 1}`, kind, path,
      constructorAttempted: true, constructorReturned: false, openAfterConstructor: null,
      startAttempts: 0, startReturned: false, closeAttempts: 0, closeCallReturned: false,
      closeEventObserved: kind === "http" ? false : null, openAfterClose: null, restored: false };
    const entry: Entry = { row, actual: null, methods: [], close: null, lifetimes: [], activeLifetime: null, resolveClose: null, closeListener: null }; this.entries.push(entry);
    try {
      if (this.identity.evidenceRoot !== null) {
        const root = physicalDirectory(this.identity.evidenceRoot), state = statSync(root, { bigint: true });
        const observed = { device: String(state.dev), inode: String(state.ino), birthtimeNs: String(state.birthtimeNs) };
        if (JSON.stringify(observed) !== JSON.stringify(this.evidenceIdentity)) throw new Error("changed");
        const path = join(root, `native-test-${this.id}-${row.id.replace(":", "-")}-acquire.json`);
        const bytes = encode({ schema: "resident-owned-native-test-acquisition-v1", scopeId: this.identity.scopeId,
          observerId: this.id, selector: this.identity.selector, writer: { processId: process.pid, parentProcessId: process.ppid },
          observerPin: this.observerPin, id: row.id, kind, path: row.path });
        writeFileSync(path, bytes, { flag: "wx" }); this.acquisitionPins.push({ path, bytes: bytes.length, sha256: sha(bytes) });
      }
    } catch { this.issue(row.id, "acquisition-provenance-unknown"); }
    return entry;
  }
  [returnedAcquisition](entry: Entry | null, actual: DatabaseSync | Server): void {
    if (!entry) return;
    entry.actual = actual; entry.row.constructorReturned = true; this.openState(entry, "openAfterConstructor");
    if (actual instanceof Server) {
      if (this.identity.mode === "file") {
        entry.closeListener = () => {
          entry.row.closeEventObserved = true; this.openState(entry, "openAfterClose");
          const lifetime = entry.activeLifetime;
          if (!lifetime) this.issue(entry.row.id, "native-file-http-close-without-lifetime");
          else { lifetime.closeEvents++; lifetime.openAfterClose = entry.row.openAfterClose; }
          entry.resolveClose?.();
        };
        actual.on("close", entry.closeListener);
      } else entry.close = new Promise<void>(resolve => {
        actual.once("close", () => { entry.row.closeEventObserved = true; this.openState(entry, "openAfterClose"); resolve(); });
      });
      this.observeMethod(entry, "listen");
    }
    this.observeMethod(entry, "close");
  }
  private openState(entry: Entry, field: "openAfterConstructor" | "openAfterClose"): void {
    try { const actual = entry.actual;
      const value = actual instanceof DatabaseSync ? actual.isOpen : actual instanceof Server ? actual.listening : null;
      if (typeof value !== "boolean") throw new Error("unknown"); entry.row[field] = value;
    } catch { entry.row[field] = null; this.issue(entry.row.id, "native-open-state-unknown"); }
  }
  private observeMethod(entry: Entry, name: "close" | "listen"): void {
    const actual = entry.actual; if (!actual) return;
    try {
      const original = Reflect.get(actual, name), descriptor = Object.getOwnPropertyDescriptor(actual, name);
      if (typeof original !== "function") throw new Error("method");
      const owner = this;
      const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        if (this !== actual) owner.issue(entry.row.id, "native-method-receiver-changed");
        if (name === "close") entry.row.closeAttempts++; else entry.row.startAttempts++;
        const lifetime = owner.identity.mode === "file" && actual instanceof Server
          ? owner.fileLifetime(entry, name) : null;
        try { const result = Reflect.apply(original, this, args);
          if (this === actual) { if (name === "close") { entry.row.closeCallReturned = true; if (lifetime) lifetime.closeCallReturned = true; }
            else { entry.row.startReturned = true; if (lifetime) lifetime.listenReturned = true; } }
          return result;
        } catch (error) { owner.issue(entry.row.id, name === "close" ? "native-close-refused" : "native-start-refused"); throw error; }
        finally { owner.openState(entry, "openAfterClose"); }
      };
      Object.defineProperty(actual, name, { configurable: true, enumerable: descriptor?.enumerable ?? false, writable: true, value: wrapper });
      entry.methods.push({ name, original, descriptor, wrapper });
    } catch { this.issue(entry.row.id, "native-method-observation-unknown"); }
  }
  private fileLifetime(entry: Entry, name: "close" | "listen"): NativeTestHttpLifetime {
    let latest = entry.activeLifetime ?? undefined;
    if (name === "listen") {
      if (latest && (latest.closeEvents !== 1 || latest.openAfterClose !== false)) this.issue(entry.row.id, "native-file-http-relisten-before-known-close");
      latest = undefined;
    }
    if (!latest) {
      latest = { id: `${entry.row.id}:lifetime:${entry.lifetimes.length + 1}`, listenAttempted: name === "listen", listenReturned: false,
        closeAttempts: 0, closeCallReturned: false, closeEvents: 0, openAfterClose: null };
      if (this.retainedLifetimeCount < maximum) { entry.lifetimes.push(latest); this.retainedLifetimeCount++; }
      else { this.traceComplete = false; this.issue(entry.row.id, "native-file-http-lifetime-trace-bound"); }
      entry.activeLifetime = latest; entry.row.closeEventObserved = false;
      entry.close = new Promise<void>(resolve => { entry.resolveClose = resolve; });
    }
    if (name === "close") latest.closeAttempts++;
    return latest;
  }
  private restore(entry: Entry): void {
    const actual = entry.actual; if (!actual) return;
    let restored = true;
    for (const method of entry.methods) {
      try { if (Reflect.get(actual, method.name) !== method.wrapper) throw new Error("changed");
        if (method.descriptor) Object.defineProperty(actual, method.name, method.descriptor);
        else if (!Reflect.deleteProperty(actual, method.name)) throw new Error("delete");
      } catch { restored = false; this.issue(entry.row.id, "native-method-restoration-unknown"); }
    }
    entry.row.restored = restored && entry.methods.length === (actual instanceof Server ? 2 : 1);
    if (actual instanceof Server && entry.closeListener) {
      try { actual.off("close", entry.closeListener); } catch { entry.row.restored = false; this.issue(entry.row.id, "native-file-http-event-restoration-unknown"); }
    }
  }

  finish(): Promise<NativeTestObservationSnapshot> {
    if (this.finishPromise === null) this.finishPromise = this.finishOwned();
    return this.finishPromise;
  }
  private async finishOwned(): Promise<NativeTestObservationSnapshot> {
    this.finalizing = true;
    for (const entry of this.entries) {
      const actual = entry.actual;
      if (!actual) continue;
      this.openState(entry, "openAfterClose");
      const priorCloseAttempts = this.identity.mode === "file" && actual instanceof Server
        ? entry.activeLifetime?.closeAttempts ?? 0 : entry.row.closeAttempts;
      if (priorCloseAttempts === 0) {
        try {
          if (actual instanceof Server) actual.closeAllConnections();
          Reflect.apply(Reflect.get(actual, "close"), actual, []);
        } catch { this.issue(entry.row.id, "owner-first-close-refused"); }
      }
      if (actual instanceof Server && !entry.row.closeEventObserved && entry.close) {
        let timer: NodeJS.Timeout | undefined;
        try { await Promise.race([entry.close, new Promise<void>(resolve => { timer = setTimeout(() => { this.issue(entry.row.id, "native-http-close-unconfirmed"); resolve(); }, 5000); })]); }
        finally { if (timer) clearTimeout(timer); }
      }
      this.openState(entry, "openAfterClose"); this.restore(entry);
    }
    return this.snapshot();
  }
  snapshot(): NativeTestObservationSnapshot {
    return Object.freeze({ schema: "resident-owned-native-test-observation-v1", scopeId: this.identity.scopeId, selector: this.identity.selector,
      writer: Object.freeze({ processId: process.pid, parentProcessId: process.ppid }), observerPin: Object.freeze({ ...this.observerPin }),
      rows: Object.freeze(this.entries.map(entry => Object.freeze({ ...entry.row,
        ...(this.identity.mode === "file" && entry.row.kind === "http" ? { fileLifetimes: Object.freeze(entry.lifetimes.map(lifetime => Object.freeze({ ...lifetime }))) } : {}) }))), acquisitionPins: Object.freeze(this.acquisitionPins.map(pin => Object.freeze({ ...pin }))),
      unknowns: Object.freeze(this.unknowns.map(issue => Object.freeze({ ...issue }))), traceComplete: this.traceComplete });
  }
  lateIntents(): ReadonlyArray<{ path: string; bytes: number; sha256: string }> {
    return Object.freeze(this.lateIntentPins.map(pin => Object.freeze({ ...pin })));
  }
}

function constructObservedDatabase(args: unknown[], newTarget: Function): DatabaseSync {
  const owner = current.getStore(), file = args[0], name = typeof file === "string" ? file : null;
  const entry = owner?.[beginAcquisition]("sqlite", name) ?? null;
  let actual: DatabaseSync;
  try { actual = Reflect.construct(DatabaseSync, args, newTarget); }
  catch (error) { if (owner && entry) owner.issue(entry.row.id, "native-sqlite-constructor-unknown"); throw error; }
  try { owner?.[returnedAcquisition](entry, actual); } catch { if (owner && entry) owner.issue(entry.row.id, "native-return-observation-unknown"); }
  return actual;
}
export function openObservedTestDatabase(...args: ConstructorParameters<typeof DatabaseSync>): DatabaseSync {
  return constructObservedDatabase(args, DatabaseSync);
}
export const ObservedTestDatabaseSync = new Proxy(DatabaseSync, {
  construct(_target, args, newTarget) { return constructObservedDatabase(args, newTarget); },
});
export type ObservedTestDatabaseSync = DatabaseSync;
export function createObservedTestServer(listener?: RequestListener): Server;
export function createObservedTestServer(options: ServerOptions, listener?: RequestListener): Server;
export function createObservedTestServer(...args: unknown[]): Server {
  const owner = current.getStore(), entry = owner?.[beginAcquisition]("http", null) ?? null;
  let actual: Server;
  try { actual = Reflect.apply(createServer, undefined, args); }
  catch (error) { if (owner && entry) owner.issue(entry.row.id, "native-http-constructor-unknown"); throw error; }
  try { owner?.[returnedAcquisition](entry, actual); } catch { if (owner && entry) owner.issue(entry.row.id, "native-return-observation-unknown"); }
  return actual;
}
