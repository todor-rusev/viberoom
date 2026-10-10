// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { policyAssert as assert, fileChanged } from "./policy-refusal.js";
import { readFileSync, lstatSync } from "node:fs";
import { isAbsolute, join, resolve, win32 } from "node:path";
import { createHash } from "node:crypto";
import { types } from "node:util";
import type { ResidentDeployment } from "./private-trial-types.js";

export const PRIVATE_TRIAL_REVIEW_FILE = "private-trial-review.json";
export const PRIVATE_TRIAL_REVIEW_SCHEMA = "resident-private-trial-review-v2";
export const PRIVATE_TRIAL_DEPLOYMENT_OUTDATED = "private_trial_deployment_outdated: recreate the deployment (node scripts/private-trial-deploy.mjs)";

const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
function input<T>(read: () => T): T {
  try { return read(); }
  catch (error) { if (fileChanged(error) || error instanceof SyntaxError) assert.fail("private_trial_deployment_refused"); throw error; }
}
const lstat = (file: string) => input(() => lstatSync(file));
const readBytes = (file: string): Buffer => input(() => readFileSync(file));
const parse = (bytes: Buffer): unknown => input(() => JSON.parse(bytes.toString("utf8")));
export const TRIAL_PURPOSES = Object.freeze(["approved-paid-trial", "local-fixture", "approved-paid-answers-only"] as const);
export type TrialPurpose = (typeof TRIAL_PURPOSES)[number];
export interface TrialReview {
  schema: typeof PRIVATE_TRIAL_REVIEW_SCHEMA;
  decision: "RUN_TRIAL";
  purpose: TrialPurpose;
  reviewer: { name: string; kind: "human" | "agent" };
}
export interface ClosedResidentDeployment { deployment: Readonly<ResidentDeployment>; review: Readonly<TrialReview>; reviewFile: string }
function fields(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value), "private_trial_deployment_refused");
  assert.ok([Object.prototype, null].includes(Object.getPrototypeOf(value)), "private_trial_deployment_refused");
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...names].sort(), "private_trial_deployment_refused");
  for (const name of names) {
    const d = Object.getOwnPropertyDescriptor(value, name);
    assert.ok(d?.enumerable && Object.hasOwn(d, "value"), "private_trial_deployment_refused");
  }
}
function digest(value: unknown): asserts value is string { assert.ok(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "private_trial_deployment_refused"); }
export function validateResidentDeployment(value: unknown): Readonly<ResidentDeployment> {
  assert.ok(value && typeof value === "object" && !types.isProxy(value), "private_trial_deployment_refused");
  assert.ok(!Object.hasOwn(value, "budgetReviewSha256"), PRIVATE_TRIAL_DEPLOYMENT_OUTDATED);
  fields(value, ["reviewSha256"]);
  digest(value.reviewSha256);
  return Object.freeze({ reviewSha256: value.reviewSha256 });
}
function relativeName(name: unknown): asserts name is string {
  assert.ok(typeof name === "string" && name.length > 0 && !name.includes("\\") && !isAbsolute(name) && !win32.isAbsolute(name) &&
    name.split("/").every(p => p !== "" && p !== "." && p !== ".." && !p.includes(":")), "private_trial_deployment_refused");
}
function closedFile(root: string, name: unknown): string {
  relativeName(name); let file = resolve(root);
  assert.ok(lstat(file).isDirectory() && !lstat(file).isSymbolicLink(), "private_trial_deployment_refused");
  for (const part of name.split("/")) { file = join(file, part); assert.ok(!lstat(file).isSymbolicLink(), "private_trial_deployment_refused"); }
  assert.ok(lstat(file).isFile(), "private_trial_deployment_refused"); return file;
}
function pinnedBytes(file: string, sha256: unknown): Buffer {
  digest(sha256); const stat = lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), "private_trial_deployment_refused");
  const bytes = readBytes(file); assert.equal(hash(bytes), sha256, "private_trial_deployment_refused"); return bytes;
}
export function validateTrialReview(value: unknown): Readonly<TrialReview> {
  assert.ok(!(value && typeof value === "object" && (value as { schema?: unknown }).schema === "resident-private-local-preparation-review-v1"),
    PRIVATE_TRIAL_DEPLOYMENT_OUTDATED);
  fields(value, ["schema", "decision", "purpose", "reviewer"]);
  assert.equal(value.schema, PRIVATE_TRIAL_REVIEW_SCHEMA, "private_trial_deployment_refused");
  assert.equal(value.decision, "RUN_TRIAL", "private_trial_deployment_refused");
  assert.ok((TRIAL_PURPOSES as readonly unknown[]).includes(value.purpose), "private_trial_deployment_refused");
  fields(value.reviewer, ["name", "kind"]);
  assert.ok(typeof value.reviewer.name === "string" && value.reviewer.name.length > 0 && value.reviewer.name.length <= 200 &&
    ["human", "agent"].includes(String(value.reviewer.kind)), "private_trial_deployment_refused");
  return Object.freeze({ schema: PRIVATE_TRIAL_REVIEW_SCHEMA, decision: "RUN_TRIAL", purpose: value.purpose as TrialPurpose,
    reviewer: Object.freeze({ name: value.reviewer.name, kind: value.reviewer.kind as "human" | "agent" }) });
}
export const trialReviewBytes = (review: unknown): Buffer => {
  const v = validateTrialReview(review);
  return Buffer.from(JSON.stringify({ decision: v.decision, purpose: v.purpose, reviewer: { kind: v.reviewer.kind, name: v.reviewer.name }, schema: v.schema }) + "\n", "utf8");
};
export function readPrivateTrialDeployment(hub: { readonly dataDir: string }, value: ResidentDeployment): ClosedResidentDeployment {
  const deployment = validateResidentDeployment(value);
  const reviewFile = closedFile(hub.dataDir, PRIVATE_TRIAL_REVIEW_FILE);
  const review = validateTrialReview(parse(pinnedBytes(reviewFile, deployment.reviewSha256)));
  return Object.freeze({ deployment, review, reviewFile });
}
