// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from "node:assert/strict";
import { after, type TestContext } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";
import type { RequestListener, Server } from "node:http";
import { mkdtempSync, rmSync, realpathSync, lstatSync, statSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, basename, join, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { OwnedNativeTestObservation, openObservedTestDatabase, createObservedTestServer, type NativeTestObservationSnapshot } from "./owned-native-test-resources.js";
import { HistoryStore, readDataFormat } from "./history-store.js";
import { Logger } from "./log.js";
import { TimedDatabase } from "./timed-db.js";
import { ZepDouble } from "./memory/zep-double.js";

const supportedSelectors = [
  "dist/history-store.test.js",
  "dist/memory/carry.test.js",
  "dist/memory/config.test.js",
  "dist/memory/copies.test.js",
  "dist/memory/delivery-maintenance.test.js",
  "dist/memory/delivery-pipeline.test.js",
  "dist/memory/delivery-watch.test.js",
  "dist/memory/delivery.test.js",
  "dist/memory/episode-index.test.js",
  "dist/memory/filter.test.js",
  "dist/memory/generation-routing.test.js",
  "dist/memory/graph-addresses.test.js",
  "dist/memory/graph-generations.test.js",
  "dist/memory/group-preflight.test.js",
  "dist/memory/hub-wiring.test.js",
  "dist/memory/impact.test.js",
  "dist/memory/import-boundary.test.js",
  "dist/memory/ingestion-debug.test.js",
  "dist/memory/operation-drain.test.js",
  "dist/memory/original-product-input.test.js",
  "dist/memory/original-receipt-observation-wire.test.js",
  "dist/memory/original-receipt-observation.test.js",
  "dist/memory/original-rollout-wiring.test.js",
  "dist/memory/original-source-binding.test.js",
  "dist/memory/original-source-preselection-wire.test.js",
  "dist/memory/original-source-preselection.test.js",
  "dist/memory/original-source-sql-fence.test.js",
  "dist/memory/outbox.test.js",
  "dist/memory/part-group-adoption.test.js",
  "dist/memory/part-group-handoff.test.js",
  "dist/memory/part-group.test.js",
  "dist/memory/private-trial-startup.test.js",
  "dist/memory/provenance.test.js",
  "dist/memory/provider-contract.test.js",
  "dist/memory/questions.test.js",
  "dist/memory/recalled-kinds.test.js",
  "dist/memory/recovery-jobs.test.js",
  "dist/memory/recovery-sources.test.js",
  "dist/memory/recovery-verification.test.js",
  "dist/memory/selection.test.js",
  "dist/memory/selective-repair-draft.test.js",
  "dist/memory/selective-repair-intent.test.js",
  "dist/memory/selective-repair-pipeline.test.js",
  "dist/memory/selective-repair-review.test.js",
  "dist/memory/service-group-preflight.test.js",
  "dist/memory/service.test.js",
  "dist/memory/source-body-proof.test.js",
  "dist/memory/version-duplicates.test.js",
  "dist/memory/zep-delivery.test.js",
  "dist/memory/zep-generations.test.js",
  "dist/memory/zep-impact.test.js",
  "dist/memory/zep-original-message-preparation.test.js",
  "dist/memory/zep-recovery-knowledge.test.js",
  "dist/memory/zep-recovery-sources.test.js",
  "dist/memory/zep-source-body-proof.test.js",
  "dist/memory/zep.test.js",
  "dist/test-file-resource-scope.test.js",
  "dist/test-resource-scope.test.js",
] as const;
export type NativeTestSelector = typeof supportedSelectors[number];
interface NativeTestProfile { selector: NativeTestSelector; source: string; mode: "test" | "file"; control: boolean; prefixes: readonly string[]; filesystemOnly: boolean; prefix: string }
const fileModeToken = Symbol("source-owned-file-native-scope");
const fileReceipt = Symbol("source-owned-file-scope-receipt");
const directoryCall = Symbol("source-owned-directory-call");
const removalCall = Symbol("source-owned-removal-call");
const fileContext = new AsyncLocalStorage<NativeTestFileRoster | undefined>();
let fileSession: NativeTestFileRoster | null = null;
interface DirectoryIdentity { path: string; device: string; inode: string; birthtimeNs: string; platform: string }
interface DirectoryRow { id: string; initial: DirectoryIdentity; beforeRemoval: DirectoryIdentity | null; removed: boolean; afterRemoval: "absent" | "present" | "unknown"; ownershipPin: FilePin | null; originalRemovalAttempts?: number }
interface FilePin { path: string; bytes: number; sha256: string }
export interface NativeTestScopeTerminal {
  schema: "resident-owned-native-test-scope-terminal-v2"; scopeId: string; selector: NativeTestSelector;
  nodeVersion: string; profilePin: FilePin; scopeRegistrationPin: FilePin | null;
  scopeOwnerPin: FilePin; selectorPin: FilePin; observer: NativeTestObservationSnapshot;
  directories: readonly DirectoryRow[]; unknowns: ReadonlyArray<{ id: string; category: string }>;
  traceComplete: boolean; status: "closed" | "unknown"; originAccepted: false;
}
const hash = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
function sorted(value: unknown): unknown { return Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(Reflect.get(value, key))])) : value; }
const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(sorted(value)) + "\n");
const modulePath = fileURLToPath(import.meta.url), appRoot = dirname(dirname(modulePath));
function pin(path: string): FilePin { const bytes = readFileSync(path); return { path, bytes: bytes.length, sha256: hash(bytes) }; }
function identity(path: string): DirectoryIdentity {
  assert.ok(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path);
  let at = path;
  for (;;) { assert.equal(lstatSync(at).isSymbolicLink(), false, "native-scope-link-refused"); const parent = dirname(at); if (parent === at) break; at = parent; }
  const state = statSync(path, { bigint: true }); assert.ok(state.isDirectory());
  return { path, device: String(state.dev), inode: String(state.ino), birthtimeNs: String(state.birthtimeNs), platform: process.platform };
}
function inside(child: string, parent: string): boolean { const name = relative(parent, child); return name !== "" && name !== ".." && !name.startsWith(".." + sep) && !isAbsolute(name); }
const same = (a: unknown, b: unknown): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
function frozenCopy<T>(value: T): T {
  const copy: T = JSON.parse(JSON.stringify(value));
  const freeze = (v: unknown): void => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(copy); return copy;
}

const profilePath = join(appRoot, "private-trial", "typed-native-test-resource-profiles.json");
function checkedProfileBytes(): Buffer {
  assert.ok(isAbsolute(profilePath) && realpathSync(profilePath) === profilePath, "native-profile-physical-path");
  let at = profilePath;
  for (;;) { const state = lstatSync(at); assert.equal(state.isSymbolicLink(), false, "native-profile-link");
    const parent = dirname(at); if (parent === at) break; at = parent; }
  const before = profileFileIdentity();
  const bytes = readFileSync(profilePath); assert.ok(bytes.length <= 65536 && Buffer.from(bytes.toString("utf8")).equals(bytes), "native-profile-utf8-bound");
  assert.ok(same(before, profileFileIdentity()), "native-profile-read-identity-drift"); return bytes;
}
function profileFileIdentity() {
  const state = lstatSync(profilePath, { bigint: true });
  assert.ok(state.isFile() && !state.isSymbolicLink() && state.nlink === 1n && state.size <= 65536n, "native-profile-regular-bound");
  return { device: String(state.dev), inode: String(state.ino), birthtimeNs: String(state.birthtimeNs), bytes: String(state.size) };
}
export function inspectNativeTestResourceProfileData(bytes: Buffer): Readonly<Record<NativeTestSelector, NativeTestProfile>> {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 65536 && Buffer.from(bytes.toString("utf8")).equals(bytes), "native-profile-data-bound");
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  const record = (input: unknown, fields: string): Record<string, unknown> => {
    assert.ok(input && typeof input === "object" && !Array.isArray(input) && Object.getPrototypeOf(input) === Object.prototype);
    assert.equal(Object.keys(input).sort().join(","), fields); return input as Record<string, unknown>;
  };
  const top = record(value, "rows,schema"); assert.equal(top.schema, "resident-owned-typed-native-test-resource-profiles-v1");
  assert.ok(Array.isArray(top.rows)); const rows: NativeTestProfile[] = [];
  for (const input of top.rows) {
    const row = record(input, "control,filesystemOnly,mode,prefixes,selector,source");
    assert.ok(typeof row.selector === "string" && (supportedSelectors as readonly string[]).includes(row.selector));
    assert.equal(row.source, "src" + row.selector.slice(4, -3) + ".ts");
    assert.ok(row.mode === "test" || row.mode === "file"); assert.equal(typeof row.control, "boolean"); assert.equal(typeof row.filesystemOnly, "boolean");
    assert.ok(Array.isArray(row.prefixes) && row.prefixes.every(prefix => typeof prefix === "string" && /^[a-zA-Z0-9_-]+-$/.test(prefix)));
    assert.equal(new Set(row.prefixes).size, row.prefixes.length);
    assert.ok(row.mode !== "test" || row.prefixes.length === 1 && !row.filesystemOnly);
    assert.ok(!row.filesystemOnly || row.prefixes.length > 0 && row.mode === "file");
    rows.push(Object.freeze({ selector: row.selector as NativeTestSelector, source: row.source as string, mode: row.mode,
      control: row.control as boolean, filesystemOnly: row.filesystemOnly as boolean,
      prefixes: Object.freeze([...row.prefixes]) as readonly string[], prefix: row.prefixes[0] ?? "unused-native-file-" }));
  }
  assert.deepEqual(rows.map(row => row.selector), [...supportedSelectors]); assert.ok(encode(value).equals(bytes), "native-profile-canonical-text");
  return Object.freeze(Object.fromEntries(rows.map(row => [row.selector, row]))) as Readonly<Record<NativeTestSelector, NativeTestProfile>>;
}
function readProfiles() {
  const physicalIdentity = profileFileIdentity(), bytes = checkedProfileBytes();
  assert.ok(same(physicalIdentity, profileFileIdentity()), "native-profile-load-identity-drift");
  return Object.freeze({ pin: Object.freeze({ path: profilePath, bytes: bytes.length, sha256: hash(bytes) }),
    physicalIdentity: Object.freeze(physicalIdentity), rows: inspectNativeTestResourceProfileData(bytes) });
}
const profiles = readProfiles(), descriptors = profiles.rows;
function profileCurrent(): void { const bytes = checkedProfileBytes(); assert.ok(same(profiles.physicalIdentity, profileFileIdentity()), "native-profile-current-identity-drift");
  assert.equal(bytes.length, profiles.pin.bytes); assert.equal(hash(bytes), profiles.pin.sha256, "native-profile-current-drift"); }

export class NativeTestResourceScope {
  readonly scopeId = randomUUID();
  private readonly observer: OwnedNativeTestObservation;
  private readonly roots: DirectoryRow[] = [];
  private readonly unknowns: Array<{ id: string; category: string }> = [];
  private readonly tempIdentity: DirectoryIdentity;
  private readonly evidenceRoot: string | null;
  private readonly evidenceIdentity: DirectoryIdentity | null;
  private readonly scopeOwnerPin = pin(modulePath);
  private readonly selectorPin: FilePin;
  private readonly scopeRegistrationPin: FilePin | null;
  private finishPromise: Promise<NativeTestScopeTerminal> | null = null;
  private traceComplete = true;
  private initialized = false;
  private finalizing = false;
  readonly scopeMode: "test" | "file";
  private writtenTerminal: NativeTestScopeTerminal | null = null;
  private terminalPin: FilePin | null = null;
  private readonly directoryIntentPins: FilePin[] = [];
  private directoryAttempts = 0;
  private readonly removalAttempts = new Map<DirectoryRow, number>();
  private readonly returnedDirectoryPaths = new Map<DirectoryRow, string>();
  constructor(t: Pick<TestContext, "after">, readonly selector: NativeTestSelector, token?: typeof fileModeToken) {
    assert.ok(typeof selector === "string" && Object.hasOwn(descriptors, selector), "native-scope-selector-not-implemented");
    assert.equal(typeof t.after, "function"); profileCurrent();
    this.scopeMode = token === fileModeToken ? "file" : "test";
    assert.equal(this.scopeMode, descriptors[selector].mode, "native-scope-source-mode-drift");
    const roster = fileContext.getStore(); roster?.beginScope(this);
    if (this.scopeMode === "file") assert.ok(roster, "native-file-roster-required");
    else t.after(async () => { assert.equal(this.initialized, true, "native-scope-initialization-unknown");
      const terminal = await this.finish(); assert.equal(terminal.status, "closed", "native-scope-cleanup-unconfirmed"); });
    this.tempIdentity = identity(realpathSync(tmpdir()));
    this.evidenceRoot = process.env.VIBEROOM_GRAPH_RESOURCE_EVIDENCE ?? null;
    this.evidenceIdentity = this.evidenceRoot === null ? null : identity(this.evidenceRoot);
    this.selectorPin = pin(join(appRoot, selector));
    this.observer = new OwnedNativeTestObservation({ scopeId: this.scopeId, selector, evidenceRoot: this.evidenceRoot,
      ...(this.scopeMode === "file" ? { mode: "file" as const } : {}) });
    this.scopeRegistrationPin = this.evidenceFile(`native-test-${this.scopeId}-scope-own.json`,
      { schema: "resident-owned-native-test-scope-registration-v1", scopeId: this.scopeId, selector,
        nodeVersion: process.version, writer: { processId: process.pid, parentProcessId: process.ppid },
        observerId: this.observer.id, observerPin: this.observer.snapshot().observerPin,
        scopeOwnerPin: this.scopeOwnerPin, selectorPin: this.selectorPin, profilePin: profiles.pin });
    this.initialized = true; roster?.scopeInitialized(this);
  }
  private issue(id: string, category: string): void {
    if (this.unknowns.length < 4096) this.unknowns.push({ id, category }); else this.traceComplete = false;
  }
  private available(): void { profileCurrent(); assert.equal(this.initialized, true, "native-scope-initialization-unknown"); assert.equal(this.finalizing, false, "native-scope-acquisition-after-finish"); }
  private evidenceFile(name: string, value: unknown): FilePin | null {
    if (this.evidenceRoot === null) return null;
    assert.ok(same(identity(this.evidenceRoot), this.evidenceIdentity), "native-scope-evidence-drift");
    const path = join(this.evidenceRoot, name), bytes = encode(value); writeFileSync(path, bytes, { flag: "wx" });
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  }
  directory(): string {
    const result = this[directoryCall](undefined, [join(this.tempIdentity.path, descriptors[this.selector].prefix)]);
    if (typeof result !== "string") throw new Error("native-scope-directory-result-unknown"); return result;
  }
  [directoryCall](receiver: unknown, args: unknown[]): unknown {
    this.available(); assert.ok(same(identity(this.tempIdentity.path), this.tempIdentity), "native-scope-temp-root-drift");
    assert.ok(this.directoryAttempts < 4096, "native-file-directory-bound");
    const descriptor = descriptors[this.selector];
    const prefixes: readonly string[] = descriptor.prefixes;
    assert.ok(typeof args[0] === "string" && isAbsolute(args[0]) &&
      realpathSync(dirname(args[0])) === this.tempIdentity.path && prefixes.includes(basename(args[0])), "native-file-directory-prefix-refused");
    const intent = this.evidenceFile(`native-test-${this.scopeId}-directory-intent-${++this.directoryAttempts}.json`,
      { schema: "resident-owned-native-test-directory-intent-v1", scopeId: this.scopeId, selector: this.selector,
        writer: { processId: process.pid, parentProcessId: process.ppid }, scopeOwnerPin: this.scopeOwnerPin,
        parent: this.tempIdentity, prefix: args[0], constructorAttempted: false });
    if (intent) this.directoryIntentPins.push(intent);
    let result: unknown;
    try { result = Reflect.apply(mkdtempSync, receiver, args); }
    catch (error) { this.issue("directory", "native-scope-directory-constructor-unknown"); throw error; }
    try {
      if (typeof result !== "string") throw new Error("native-directory-result-type");
      const initial = identity(realpathSync(result)); assert.ok(inside(initial.path, this.tempIdentity.path) && !inside(appRoot, initial.path) && !inside(initial.path, appRoot));
      const row: DirectoryRow = { id: `directory:${this.roots.length + 1}`, initial, beforeRemoval: null, removed: false, afterRemoval: "unknown", ownershipPin: null };
      this.roots.push(row);
      this.returnedDirectoryPaths.set(row, result);
      row.ownershipPin = this.evidenceFile(`native-test-${this.scopeId}-${row.id.replace(":", "-")}-own.json`,
        { schema: this.scopeMode === "file" ? "resident-owned-native-test-directory-v2" : "resident-owned-native-test-directory-v1",
          scopeId: this.scopeId, selector: this.selector, writer: { processId: process.pid, parentProcessId: process.ppid }, scopeOwnerPin: this.scopeOwnerPin,
          ...(this.scopeMode === "file" ? { requestedPrefix: args[0], returnedPath: result } : {}), initial });
    } catch { this.issue("directory", "native-scope-directory-provenance-unknown"); }
    return result;
  }
  [removalCall](receiver: unknown, args: unknown[]): unknown {
    this.available(); const target = args[0];
    const row = typeof target === "string" ? this.roots.find(row => resolve(target) === row.initial.path || resolve(target) === resolve(this.returnedDirectoryPaths.get(row) ?? row.initial.path)) : undefined;
    if (!row) {
      const containing = typeof target === "string" ? this.roots.find(row => inside(resolve(target), row.initial.path) || inside(resolve(target), resolve(this.returnedDirectoryPaths.get(row) ?? row.initial.path))) : undefined;
      if (!containing) this.issue("directory", "native-file-removal-root-not-owned");
      return Reflect.apply(rmSync, receiver, args);
    }
    this.removalAttempts.set(row, (this.removalAttempts.get(row) ?? 0) + 1);
    if (this.scopeMode === "file") row.originalRemovalAttempts = this.removalAttempts.get(row);
    try {
      assert.ok(same(identity(this.tempIdentity.path), this.tempIdentity), "native-scope-temp-parent-drift");
      if (row.removed) assert.equal(existsSync(row.initial.path), false, "native-file-directory-recreated");
      else { row.beforeRemoval = identity(row.initial.path); assert.ok(same(row.beforeRemoval, row.initial), "native-scope-directory-drift"); }
    } catch (error) { this.issue(row.id, "native-file-removal-identity-unknown"); throw error; }
    try {
      const result = Reflect.apply(rmSync, receiver, args);
      row.afterRemoval = existsSync(row.initial.path) ? "present" : "absent"; row.removed = row.afterRemoval === "absent";
      if (!row.removed) this.issue(row.id, "native-file-removal-not-complete"); return result;
    } catch (error) { this.issue(row.id, "native-file-original-removal-refused"); throw error; }
  }
  [fileReceipt](): unknown {
    return frozenCopy({ scopeMode: this.scopeMode, scopeId: this.scopeId, selector: this.selector, initialized: this.initialized,
      registrationPin: this.scopeRegistrationPin ?? null, terminalPin: this.terminalPin, terminal: this.writtenTerminal,
      latestObserver: this.observer?.snapshot() ?? null, lateIntentPins: this.observer?.lateIntents() ?? [], directoryIntentPins: this.directoryIntentPins,
      directoryPins: this.roots.map(row => row.ownershipPin), latestDirectories: this.roots, latestUnknowns: this.unknowns, traceComplete: this.traceComplete });
  }
  enterFileContext(): Readonly<{ restore(): boolean }> {
    assert.equal(this.scopeMode, "file"); this.available(); return this.observer.enterFileContext();
  }
  private databasePath(file: unknown): void {
    if (file !== ":memory:") {
      assert.ok(typeof file === "string" && isAbsolute(file) && resolve(file) === file, "native-scope-database-path-refused");
      assert.ok(this.roots.some(row => inside(file, row.initial.path) && same(identity(row.initial.path), row.initial)), "native-scope-database-not-owned");
      identity(dirname(file));
      if (existsSync(file)) { const state = lstatSync(file); assert.ok(state.isFile()); assert.equal(state.isSymbolicLink(), false); }
    }
  }
  database(...args: ConstructorParameters<typeof DatabaseSync>): DatabaseSync {
    this.available(); this.databasePath(args[0]);
    return this.observer.within(() => openObservedTestDatabase(...args));
  }
  timedDatabase(file: string, now?: () => number): TimedDatabase {
    this.available(); this.databasePath(file);
    return this.observer.within(() => TimedDatabase.open(file, now));
  }
  server(listener?: RequestListener): Server {
    this.available(); return this.observer.within(() => createObservedTestServer(listener));
  }
  history(file: string = join(this.directory(), "history.db")): HistoryStore {
    this.available(); this.databasePath(file);
    const scope = this;
    const log = new class extends Logger {
      override warn(_message: string): void { scope.issue("history", "native-scope-history-log-warn"); }
      override error(_message: string): void { scope.issue("history", "native-scope-history-log-error"); }
    }("owned-native-test-history");
    return this.observer.within(() => new HistoryStore(file, log));
  }
  historyFormat(directory: string): number {
    this.available(); assert.ok(this.roots.some(row => directory === row.initial.path && same(identity(directory), row.initial)), "native-scope-history-directory-not-owned");
    return this.observer.within(() => readDataFormat(directory));
  }
  zep(): ZepDouble {
    this.available(); return this.observer.within(() => new ZepDouble());
  }
  observation(): NativeTestObservationSnapshot { return this.observer.snapshot(); }
  finish(): Promise<NativeTestScopeTerminal> {
    assert.equal(this.initialized, true, "native-scope-initialization-unknown");
    if (this.finishPromise === null) { this.finalizing = true; this.finishPromise = this.finishOwned(); }
    return this.finishPromise;
  }
  private async finishOwned(): Promise<NativeTestScopeTerminal> {
    const observed = await this.observer.finish();
    const descriptor = descriptors[this.selector];
    const filesystemOnly = this.scopeMode === "file" && "filesystemOnly" in descriptor && descriptor.filesystemOnly;
    const nonempty = filesystemOnly ? observed.rows.length === 0 && this.roots.length > 0 : observed.rows.length > 0;
    const closed = nonempty && observed.traceComplete && observed.unknowns.length === 0 && observed.rows.every(row =>
      row.constructorAttempted && row.constructorReturned && row.closeCallReturned && row.openAfterClose === false && row.restored &&
      (this.scopeMode === "file" && row.kind === "http"
        ? row.closeEventObserved === true && row.fileLifetimes && row.fileLifetimes.length > 0 &&
          row.fileLifetimes.every(life => (!life.listenAttempted || life.listenReturned) && life.closeAttempts === 1 && life.closeCallReturned && life.closeEvents === 1 && life.openAfterClose === false) &&
          row.fileLifetimes.filter(life => life.listenAttempted).length === row.startAttempts && row.fileLifetimes.length === row.closeAttempts
        : row.closeAttempts === 1 && (row.kind === "sqlite" ? row.closeEventObserved === null : row.closeEventObserved === true)));
    if (!closed) this.issue("resources", "native-scope-resource-closure-unknown");
    for (const row of this.roots) {
      if (!closed || this.unknowns.length > 0 || !this.traceComplete) continue;
      if (row.removed) {
        if (existsSync(row.initial.path)) this.issue(row.id, "native-file-directory-recreated");
        continue;
      }
      if ((this.removalAttempts.get(row) ?? 0) > 0) { this.issue(row.id, "native-file-original-removal-unconfirmed"); continue; }
      try {
        assert.ok(same(identity(this.tempIdentity.path), this.tempIdentity), "native-scope-temp-parent-drift");
        row.beforeRemoval = identity(row.initial.path); assert.ok(same(row.beforeRemoval, row.initial), "native-scope-directory-drift");
        const target = resolve(row.initial.path); assert.ok(target !== this.tempIdentity.path && inside(target, this.tempIdentity.path) && !inside(appRoot, target) && !inside(target, appRoot));
        rmSync(target, { recursive: true, force: false }); row.removed = true;
        row.afterRemoval = existsSync(target) ? "present" : "absent"; assert.equal(row.afterRemoval, "absent");
      } catch { this.issue(row.id, "native-scope-directory-removal-unknown"); }
    }
    const terminal: NativeTestScopeTerminal = { schema: "resident-owned-native-test-scope-terminal-v2", scopeId: this.scopeId, selector: this.selector,
      nodeVersion: process.version, profilePin: profiles.pin, scopeRegistrationPin: this.scopeRegistrationPin,
      scopeOwnerPin: this.scopeOwnerPin, selectorPin: this.selectorPin, observer: observed, directories: this.roots,
      unknowns: this.unknowns, traceComplete: this.traceComplete, status: closed && this.unknowns.length === 0 && this.traceComplete && this.roots.every(row => row.removed && row.afterRemoval === "absent") ? "closed" : "unknown", originAccepted: false };
    try { this.terminalPin = this.evidenceFile(`native-test-${this.scopeId}-terminal.json`, terminal); }
    catch { this.issue("terminal", "native-scope-terminal-write-unknown"); terminal.status = "unknown"; }
    this.writtenTerminal = frozenCopy(terminal); return this.writtenTerminal;
  }
}
export const createTestResourceScope = (t: Pick<TestContext, "after">, selector: NativeTestSelector): NativeTestResourceScope => new NativeTestResourceScope(t, selector);

interface FileScopeEntry {
  readonly scope: NativeTestResourceScope; readonly order: number;
  readonly registrationPin: FilePin | null; initialized: boolean;
}
class NativeTestFileRoster {
  readonly fileId = randomUUID();
  private readonly entries: FileScopeEntry[] = [];
  private readonly unknowns: Array<{ id: string; category: string }> = [];
  private readonly evidenceRoot: string | null;
  private readonly evidenceIdentity: DirectoryIdentity | null;
  private readonly ownerPin = pin(modulePath);
  private readonly selectorPin: FilePin;
  private readonly registrationPin: FilePin | null;
  private finalHookPin: FilePin | null = null;
  private terminalPin: FilePin | null = null;
  private initialized = false;
  private hookRegistered = false;
  private enrollmentClosed = false;
  private traceComplete = true;
  private finishPromise: Promise<void> | null = null;
  private ambient: NativeTestResourceScope | null = null;
  private nativeContext: Readonly<{ restore(): boolean }> | null = null;
  private readonly previousContext = fileContext.getStore();
  constructor(readonly selector: NativeTestSelector) {
    assert.ok(Object.hasOwn(descriptors, selector), "native-file-selector-not-implemented"); profileCurrent();
    this.evidenceRoot = process.env.VIBEROOM_GRAPH_RESOURCE_EVIDENCE ?? null;
    this.evidenceIdentity = this.evidenceRoot === null ? null : identity(this.evidenceRoot);
    this.selectorPin = pin(join(appRoot, selector));
    after(() => { assert.equal(this.initialized, true, "native-file-initialization-unknown");
      assert.equal(this.hookRegistered, true, "native-file-eof-hook-missing"); });
    this.registrationPin = this.write(`native-file-${this.fileId}-own.json`, {
      schema: "resident-owned-native-test-file-registration-v1", fileId: this.fileId,
      selector, mode: descriptors[selector].mode, nodeVersion: process.version,
      writer: { processId: process.pid, parentProcessId: process.ppid },
      ownerPin: this.ownerPin, selectorPin: this.selectorPin, profilePin: profiles.pin,
    });
    fileContext.enterWith(this);
    if (descriptors[selector].mode === "file") {
      this.ambient = new NativeTestResourceScope({ after: () => { throw new Error("native-file-early-cleanup-refused"); } }, selector, fileModeToken);
      this.nativeContext = this.ambient.enterFileContext();
    }
    this.initialized = true;
  }
  private issue(id: string, category: string): void {
    if (this.unknowns.length < 4096) this.unknowns.push({ id, category }); else this.traceComplete = false;
  }
  private write(name: string, value: unknown): FilePin | null {
    if (this.evidenceRoot === null) return null;
    assert.ok(same(identity(this.evidenceRoot), this.evidenceIdentity), "native-file-evidence-drift");
    const path = join(this.evidenceRoot, name), bytes = encode(value); writeFileSync(path, bytes, { flag: "wx" });
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  }
  beginScope(scope: NativeTestResourceScope): void {
    if (this.enrollmentClosed) { this.issue("roster", "scope-after-file-finalization"); throw new Error("native-file-scope-after-finalization"); }
    assert.equal(scope.selector, this.selector, "native-file-scope-selector-drift");
    assert.equal(scope.scopeMode, descriptors[this.selector].mode, "native-file-scope-mode-drift");
    assert.ok(!this.entries.some(entry => entry.scope === scope), "native-file-duplicate-scope");
    if (this.entries.length >= 4096) { this.traceComplete = false; throw new Error("native-file-roster-bound"); }
    const entry: FileScopeEntry = { scope, order: this.entries.length + 1, registrationPin: null, initialized: false };
    this.entries.push(entry);
    const registrationPin = this.write(`native-file-${this.fileId}-scope-${entry.order}-own.json`, {
      schema: "resident-owned-native-test-file-scope-registration-v1", fileId: this.fileId,
      selector: this.selector, mode: scope.scopeMode, scopeId: scope.scopeId, order: entry.order,
      writer: { processId: process.pid, parentProcessId: process.ppid }, ownerPin: this.ownerPin,
      selectorPin: this.selectorPin, profilePin: profiles.pin, fileRegistrationPin: this.registrationPin,
    });
    this.entries[this.entries.length - 1] = { ...entry, registrationPin };
  }
  scopeInitialized(scope: NativeTestResourceScope): void {
    const entry = this.entries.find(entry => entry.scope === scope);
    assert.ok(entry && !this.enrollmentClosed, "native-file-unregistered-scope"); entry.initialized = true;
  }
  directory(receiver: unknown, args: unknown[]): unknown {
    assert.ok(this.ambient && !this.enrollmentClosed, "native-file-directory-owner-unavailable");
    return this.ambient[directoryCall](receiver, args);
  }
  remove(receiver: unknown, args: unknown[]): unknown {
    assert.ok(this.ambient && !this.enrollmentClosed, "native-file-directory-owner-unavailable");
    return this.ambient[removalCall](receiver, args);
  }
  seal(): void {
    assert.ok(this.initialized && !this.hookRegistered && !this.enrollmentClosed, "native-file-eof-hook-refused");
    this.finalHookPin = this.write(`native-file-${this.fileId}-eof-hook.json`, {
      schema: "resident-owned-native-test-file-final-hook-v1", fileId: this.fileId, selector: this.selector,
      mode: descriptors[this.selector].mode, writer: { processId: process.pid, parentProcessId: process.ppid },
      ownerPin: this.ownerPin, selectorPin: this.selectorPin, profilePin: profiles.pin, fileRegistrationPin: this.registrationPin,
    });
    after(() => this.finish()); this.hookRegistered = true;
  }
  private finish(): Promise<void> {
    if (this.finishPromise === null) { this.enrollmentClosed = true; this.finishPromise = this.finishOwned(); }
    return this.finishPromise;
  }
  observation() {
    return frozenCopy({ schema: "resident-owned-native-test-file-observation-v1", fileId: this.fileId,
      selector: this.selector, mode: descriptors[this.selector].mode, nodeVersion: process.version,
      writer: { processId: process.pid, parentProcessId: process.ppid }, ownerPin: this.ownerPin,
      selectorPin: this.selectorPin, profilePin: profiles.pin, fileRegistrationPin: this.registrationPin, finalHookPin: this.finalHookPin,
      scopes: this.entries.map(entry => ({ order: entry.order, registrationPin: entry.registrationPin,
        initialized: entry.initialized, receipt: entry.scope[fileReceipt]() })),
      unknowns: this.unknowns, traceComplete: this.traceComplete, enrollmentClosed: this.enrollmentClosed,
      originAccepted: false });
  }
  private async finishOwned(): Promise<void> {
    try { profileCurrent(); } catch { this.issue("profile", "native-file-profile-current-unknown"); }
    for (const entry of this.entries) {
      if (!entry.initialized) { this.issue(entry.scope.scopeId, "scope-initialization-unknown"); continue; }
      try { await entry.scope.finish(); } catch { this.issue(entry.scope.scopeId, "scope-finalization-unknown"); }
    }
    if (this.nativeContext && !this.nativeContext.restore()) this.issue("context", "native-file-context-restoration-unknown");
    if (fileContext.getStore() === this) fileContext.enterWith(this.previousContext);
    else this.issue("context", "native-file-roster-context-restoration-unknown");
    const scopes = this.entries.map(entry => ({ order: entry.order, registrationPin: entry.registrationPin,
      initialized: entry.initialized, receipt: entry.scope[fileReceipt]() }));
    const value = { schema: "resident-owned-native-test-file-terminal-v1", fileId: this.fileId,
      selector: this.selector, mode: descriptors[this.selector].mode, nodeVersion: process.version,
      writer: { processId: process.pid, parentProcessId: process.ppid }, ownerPin: this.ownerPin,
      selectorPin: this.selectorPin, profilePin: profiles.pin, fileRegistrationPin: this.registrationPin, finalHookPin: this.finalHookPin,
      scopes, unknowns: this.unknowns, traceComplete: this.traceComplete, originAccepted: false };
    try { this.terminalPin = this.write(`native-file-${this.fileId}-terminal.json`, value); }
    catch { this.issue("terminal", "native-file-terminal-write-unknown"); throw new Error("native-file-terminal-write-unknown"); }
  }
}

export const observedTestMkdtempSync: typeof mkdtempSync = new Proxy(mkdtempSync, {
  apply(target, receiver, args) { const owner = fileContext.getStore();
    return owner ? owner.directory(receiver, args) : Reflect.apply(target, receiver, args); },
});
export const observedTestRmSync: typeof rmSync = new Proxy(rmSync, {
  apply(target, receiver, args) { const owner = fileContext.getStore();
    return owner ? owner.remove(receiver, args) : Reflect.apply(target, receiver, args); },
});
export function beginTestFileResources(selector: NativeTestSelector): Readonly<{ seal(): void; observation(): ReturnType<NativeTestFileRoster["observation"]> }> {
  assert.equal(fileSession, null, "native-file-single-selector-process-required");
  const roster = new NativeTestFileRoster(selector); fileSession = roster;
  return Object.freeze({ seal: () => roster.seal(), observation: () => roster.observation() });
}
