// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { types } from "node:util";
import { lstatSync, fstatSync, openSync, readSync, writeFileSync, fsyncSync, closeSync, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Hub } from "../hub.js";
import { createPrivateTrialEntry } from "./private-trial-entry.js";
import { validateResidentDeployment, PRIVATE_TRIAL_DEPLOYMENT_OUTDATED } from "./private-trial-deployment.js";
import { chatCompletionsUrl } from "./chat-endpoint.js";
import type { ResidentDeployment, ResidentSelection, TrialBudgetSubject } from "./private-trial-types.js";

export const PRIVATE_TRIAL_STARTUP_FILE = "private-trial-startup.json";
export const PRIVATE_TRIAL_STARTUP_BYTES = 8192;
export const PRIVATE_TRIAL_STARTUP_SCHEMA = "viberoom-private-trial-startup-v2";
export interface PrivateTrialStartup {
  schema: typeof PRIVATE_TRIAL_STARTUP_SCHEMA;
  deployment: Readonly<ResidentDeployment>;
  selection: Readonly<ResidentSelection>;
}
export type ProductionStartupOutcome =
  | { readonly state: "OFFERED"; readonly cardId: string }
  | { readonly state: "REFUSED"; readonly reason: "deployment_outdated" | "refused" };
const refusedWith = (error: unknown): ProductionStartupOutcome => Object.freeze({ state: "REFUSED" as const,
  reason: String((error as { message?: unknown } | null)?.message ?? "").startsWith("private_trial_deployment_outdated") ? "deployment_outdated" as const : "refused" as const });
function refused(): never { throw new Error("private_trial_startup_refused"); }
function fields(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) refused();
  if (Reflect.ownKeys(value).some(k => typeof k !== "string") || Reflect.ownKeys(value).sort().join(",") !== [...names].sort().join(",")) refused();
  for (const name of names) {
    const d = Object.getOwnPropertyDescriptor(value, name);
    if (!d?.enumerable || !Object.hasOwn(d, "value")) refused();
  }
}
function endpoint(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) refused();
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.href !== value) refused();
  return url.href;
}
export function validatePrivateTrialStartup(value: unknown): Readonly<PrivateTrialStartup> {
  fields(value, ["schema", "deployment", "selection"]);
  if (value.schema === "viberoom-private-trial-startup-v1") throw new Error(PRIVATE_TRIAL_DEPLOYMENT_OUTDATED);
  if (value.schema !== PRIVATE_TRIAL_STARTUP_SCHEMA) refused();
  const deployment = validateResidentDeployment(value.deployment);
  fields(value.selection, ["answerKeyOwner", "answerEndpoint", "answerModel"]);
  if (value.selection.answerKeyOwner !== "memory.filter.apiKey" || typeof value.selection.answerModel !== "string" ||
    value.selection.answerModel.length === 0 || value.selection.answerModel.length > 256) refused();
  const selection = Object.freeze({ answerKeyOwner: "memory.filter.apiKey" as const,
    answerEndpoint: endpoint(value.selection.answerEndpoint), answerModel: value.selection.answerModel });
  return Object.freeze({ schema: PRIVATE_TRIAL_STARTUP_SCHEMA, deployment: Object.freeze({ reviewSha256: deployment.reviewSha256 }), selection });
}
export function privateTrialStartupBytes(input: unknown): Buffer {
  const v = validatePrivateTrialStartup(input);
  const bytes = Buffer.from(JSON.stringify({ deployment: { reviewSha256: v.deployment.reviewSha256 }, schema: v.schema, selection: { answerEndpoint: v.selection.answerEndpoint,
    answerKeyOwner: v.selection.answerKeyOwner, answerModel: v.selection.answerModel } }) + "\n", "utf8");
  if (bytes.length > PRIVATE_TRIAL_STARTUP_BYTES) refused();
  return bytes;
}
function rootPath(dataDir: string): string {
  if (typeof dataDir !== "string" || !isAbsolute(dataDir) || resolve(dataDir) !== dataDir) refused();
  return dataDir;
}
function sameNode(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs && a.ino > 0n;
}
function roots(dataDir: string): { path: string; stat: BigIntStats }[] {
  const parts: string[] = []; let part = rootPath(dataDir);
  for (;;) { parts.push(part); const parent = dirname(part); if (parent === part) break; part = parent; }
  return parts.map(path => {
    const stat = lstatSync(path, { bigint: true }); if (!stat.isDirectory() || stat.isSymbolicLink()) refused();
    return { path, stat };
  });
}
function recheckRoots(before: { path: string; stat: BigIntStats }[]): void {
  for (const row of before) {
    const now = lstatSync(row.path, { bigint: true }); if (!now.isDirectory() || now.isSymbolicLink() || !sameNode(row.stat, now)) refused();
  }
}
export function readPrivateTrialStartup(dataDir: string): Readonly<PrivateTrialStartup> | null {
  const file = join(rootPath(dataDir), PRIVATE_TRIAL_STARTUP_FILE); let first: BigIntStats;
  try { first = lstatSync(file, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!first.isFile() || first.isSymbolicLink() || first.size > BigInt(PRIVATE_TRIAL_STARTUP_BYTES)) refused();
  const parents = roots(dataDir), fd = openSync(file, "r");
  try {
    const opened = fstatSync(fd, { bigint: true }); if (!opened.isFile() || !sameNode(first, opened) || opened.size !== first.size) refused();
    const buffer = Buffer.alloc(PRIVATE_TRIAL_STARTUP_BYTES + 1), count = readSync(fd, buffer, 0, buffer.length, 0);
    if (BigInt(count) !== opened.size || count > PRIVATE_TRIAL_STARTUP_BYTES) refused();
    const bytes = buffer.subarray(0, count), text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) refused();
    const checked = validatePrivateTrialStartup(JSON.parse(text));
    if (!privateTrialStartupBytes(checked).equals(bytes)) refused();
    const final = fstatSync(fd, { bigint: true }), named = lstatSync(file, { bigint: true });
    if (!final.isFile() || !named.isFile() || named.isSymbolicLink() || !sameNode(opened, final) || !sameNode(opened, named) ||
      final.size !== BigInt(count) || named.size !== BigInt(count) || opened.mtimeNs !== final.mtimeNs || final.mtimeNs !== named.mtimeNs) refused();
    recheckRoots(parents); return checked;
  } finally { closeSync(fd); }
}
export function installPrivateTrialStartup(dataDir: string, input: unknown): void {
  const bytes = privateTrialStartupBytes(input), parents = roots(dataDir), file = join(dataDir, PRIVATE_TRIAL_STARTUP_FILE);
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, bytes); fsyncSync(fd);
    const opened = fstatSync(fd, { bigint: true }), named = lstatSync(file, { bigint: true });
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || !sameNode(opened, named) || opened.size !== BigInt(bytes.length)) refused();
    recheckRoots(parents);
  } finally { closeSync(fd); }
}
export function matchPrivateTrialStartupSelection(input: unknown, filter: { baseUrl: string; model: string }): Readonly<ResidentSelection> {
  const checked = validatePrivateTrialStartup(input);
  const selected = validatePrivateTrialStartup({ ...checked, selection: { answerKeyOwner: "memory.filter.apiKey",
    answerEndpoint: chatCompletionsUrl(filter.baseUrl).href, answerModel: filter.model } }).selection;
  if (JSON.stringify(selected) !== JSON.stringify(checked.selection)) refused();
  return selected;
}
interface StartupLifetime {
  closed: boolean; subject: TrialBudgetSubject | null;
  result: Promise<ProductionStartupOutcome> | null;
}
const lifetimes = new WeakMap<Hub, StartupLifetime>();
export function startProductionPrivateTrial(hub: Hub): Promise<ProductionStartupOutcome> | null {
  const prior = lifetimes.get(hub); if (prior) return prior.closed ? null : prior.result;
  const state: StartupLifetime = { closed: false, subject: null, result: null }; lifetimes.set(hub, state);
  let input: Readonly<PrivateTrialStartup> | null;
  try { input = readPrivateTrialStartup(hub.dataDir); }
  catch (error) { return state.result = Promise.resolve(refusedWith(error)); }
  if (input === null) return null;
  const instruction = input;
  const filter = () => { const f = hub.memoryStore.get().filter; return { baseUrl: f.baseUrl, model: f.model }; };
  return state.result = (async () => {
    try {
      if (state.closed) return refusedWith(null);
      matchPrivateTrialStartupSelection(instruction, filter());
      const entry = await createPrivateTrialEntry(hub, instruction.deployment);
      if (state.closed) return refusedWith(null);
      const selection = matchPrivateTrialStartupSelection(instruction, filter());
      const status = entry.status(selection);
      if (status.state !== "PAID_PREPARATION_READY") return refusedWith(null);
      if (state.closed) return refusedWith(null);
      const prepared = entry.prepare(selection);
      if (prepared.state !== "PREPARED" || state.closed) return refusedWith(null);
      state.subject = entry.budgetSubject();
      if (state.closed) { state.subject.revoke(); return refusedWith(null); }
      const card = hub.askTrialBudget(state.subject);
      if (state.closed) { state.subject.revoke(); return refusedWith(null); }
      return Object.freeze({ state: "OFFERED" as const, cardId: card.id });
    } catch (error) {
      state.closed = true;
      try { state.subject?.revoke(); } catch { }
      return refusedWith(error);
    }
  })();
}
export function stopProductionPrivateTrial(hub: Hub): void {
  const state = lifetimes.get(hub);
  if (!state) { lifetimes.set(hub, { closed: true, subject: null, result: null }); return; }
  state.closed = true;
  try { state.subject?.revoke(); } catch { refused(); }
}
