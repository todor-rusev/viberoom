// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, mkdir, open, realpath, stat } from "node:fs/promises";
import { resolve, dirname, normalize, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
export const here = dirname(fileURLToPath(import.meta.url));
export const stable = value => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}` : JSON.stringify(value);
export const hash = value => createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex");
export const normalizedHash = bytes => hash(bytes.toString("utf8").replace(/\r\n/g, "\n"));
export const cloudBase = "https://api.getzep.com/api/v2";
export const corpus = [
  { key: "a", at: "2026-09-10T10:00:00Z", text: "Talmera uses Northbeam for payments from 10 September 2026." },
  { key: "r", at: "2026-09-11T10:00:00Z", text: "Talmera still uses Northbeam for payments. Talmera archives invoices in IndigoVault." },
  { key: "t0", at: "2026-09-01T10:00:00Z", text: "Helion is assigned to Orbit from 1 September 2026." },
  { key: "t1", at: "2026-09-15T10:00:00Z", text: "Helion's assignment to Orbit ended on 15 September 2026." },
  { key: "c", at: "2026-09-09T10:00:00Z", text: "Zircona stores its archive in Cedarport from 9 September 2026." },
  { key: "b", at: "2026-09-12T10:00:00Z", text: "Talmera moved all payments to Southforge on 12 September 2026." },
];
export const limits = Object.freeze({ graphs: 1, episodeAttempts: 6, estimatedEpisodeCredits: 6,
  episodeDeletes: 1, patches: 0, graphDeletes: 0, reads: 650, wireRequests: 658,
  pagesPerKind: 8, pageSize: 50, processPollsPerEpisode: 60, processPollIntervalMs: 5000,
  processWaitMs: 300000, absencePolls: 20, observationOffsetsMs: [0, 15000, 30000, 60000, 90000, 120000, 180000, 300000, 600000],
  totalWallMs: 2700000, requestTimeoutMs: 20000, responseBytes: 2000000, sdkRetries: 0 });
export async function codeProof() {
  const files = {};
  for (const name of ["plan.mjs", "core.mjs", "runner.mjs"]) files[name] = normalizedHash(await readFile(resolve(here, name)));
  return { files, sha256: hash(files) };
}
export async function sdkProof(root) {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  if (pkg.name !== "@getzep/zep-cloud" || pkg.version !== "3.28.0") throw new Error("sdk_version_unreviewed");
  const paths = ["package.json"];
  const walk = async (relative) => {
    for (const item of await readdir(resolve(root, relative), { withFileTypes: true })) {
      const path = `${relative}/${item.name}`;
      if (item.isSymbolicLink()) throw new Error("sdk_symlink_unreviewed");
      if (item.isDirectory()) await walk(path); else if (item.isFile()) paths.push(path);
    }
  };
  await walk("dist/cjs"); paths.sort();
  const files = {};
  for (const path of paths) files[path] = normalizedHash(await readFile(resolve(root, path)));
  return { version: pkg.version, fileCount: paths.length, sha256: hash(files) };
}
export async function canonicalRoot(root) {
  const path = normalize(await realpath(resolve(root))), info = await stat(path, { bigint: true });
  if (!info.isDirectory()) throw new Error("prepared_root_not_directory");
  return { path, device: String(info.dev), inode: String(info.ino), platform: process.platform };
}
export async function verifyPreparedRoot(root, plan) {
  validatePlan(plan);
  const actual = await canonicalRoot(root);
  const comparable = value => ({ ...value, path: process.platform === "win32" ? value.path.toLowerCase() : value.path });
  if (stable(comparable(actual)) !== stable(comparable(plan.preparedRoot))) throw new Error("approved_prepared_root_mismatch");
  return actual.path;
}
export function makePlan(projectUuid, sdk, code, runId = randomUUID(), preparedRoot) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!uuid.test(projectUuid) || !uuid.test(runId)) throw new Error("invalid_project_or_run_id");
  if (!preparedRoot || !isAbsolute(preparedRoot.path ?? "") || preparedRoot.path !== normalize(preparedRoot.path)
    || !/^\d+$/.test(preparedRoot.device) || !/^\d+$/.test(preparedRoot.inode) || preparedRoot.platform !== process.platform
    || Object.keys(preparedRoot).sort().join() !== "device,inode,path,platform") throw new Error("invalid_prepared_root_binding");
  const graphId = `viberoom-b18d-${runId}`;
  const sources = corpus.map((source, index) => ({ ...source, bytes: Buffer.byteLength(source.text),
    credits: Math.ceil(Buffer.byteLength(source.text) / 350), opId: hash(`${runId}:${index}`).slice(0, 32), version: hash(source.text) }));
  return { schema: "B18d-v2", base: "d9ca2b07cf0ea407fb41e3aa8499dc55a21794b7", cloudBase,
    projectUuid, runId, graphId, preparedRoot: structuredClone(preparedRoot), description: `B18d isolated synthetic observation; owner ${runId}; retain for review`,
    sdk: structuredClone(sdk), code: structuredClone(code), sources, limits: structuredClone(limits), deleteSource: "b", cleanup: "retain-no-graph-delete",
    authority: "separate-human-approval-required", result: "observation-only-human-semantic-review-required" };
}
export function validatePlan(plan) {
  const expected = makePlan(plan.projectUuid, plan.sdk, plan.code, plan.runId, plan.preparedRoot);
  if (stable(plan) !== stable(expected)) throw new Error("plan_changed_or_unbounded");
  if (plan.sources.reduce((sum, s) => sum + s.credits, 0) !== limits.estimatedEpisodeCredits) throw new Error("credit_estimate_changed");
}
export function verifyPermit(plan, permit) {
  validatePlan(plan);
  if (permit.authorized !== true || permit.planSha256 !== hash(plan) || permit.codeSha256 !== plan.code.sha256
    || permit.projectUuid !== plan.projectUuid || permit.graphId !== plan.graphId || permit.budgetSha256 !== hash(plan.limits)
    || permit.preparedRootSha256 !== hash(plan.preparedRoot)
    || typeof permit.humanApproval !== "string" || permit.humanApproval.trim().length < 5
    || !Number.isFinite(Date.parse(permit.expiresAt)) || Date.parse(permit.expiresAt) <= Date.now()) throw new Error("separate_human_permission_missing_or_mismatched");
}
export async function writeExclusive(path, value) {
  const file = await open(path, "wx");
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
}
export async function prepare(root, sdkRoot, projectUuid) {
  const sdk = await sdkProof(sdkRoot), code = await codeProof();
  await mkdir(root);
  const preparedRoot = await canonicalRoot(root), plan = makePlan(projectUuid, sdk, code, randomUUID(), preparedRoot);
  await writeExclusive(resolve(preparedRoot.path, "plan.json"), plan);
  await writeExclusive(resolve(preparedRoot.path, "permit-template.json"), { authorized: false, planSha256: hash(plan),
    codeSha256: plan.code.sha256, projectUuid, graphId: plan.graphId, budgetSha256: hash(plan.limits),
    preparedRootSha256: hash(preparedRoot),
    expiresAt: null, humanApproval: null });
  return { planSha256: hash(plan), graphId: plan.graphId, cloudRequests: 0, authorized: false };
}
