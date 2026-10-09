// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { configuredHubWorld } from "./configured-hub-fixture.mjs";
import { encode } from "../memory-retrieval-comparison-d3/contracts.mjs";
import { prepareWritePermits } from "./profile.mjs";

const app = fileURLToPath(new URL("../../", import.meta.url));
export const WHOLE_CODE_PATHS = Object.freeze([
  "experiments/memory-retrieval-comparison-d3/answer-profile.mjs", "experiments/memory-retrieval-comparison-d3/contracts.mjs",
  "experiments/memory-retrieval-comparison-d3/entity-projection.mjs", "experiments/memory-retrieval-comparison-d3/envelope-projection.mjs",
  "experiments/memory-retrieval-comparison-d3/episode-projection.mjs", "experiments/memory-retrieval-comparison-d3/lineage.mjs",
  "experiments/memory-retrieval-comparison-d3/native-projection.mjs", "experiments/memory-retrieval-comparison-d3/ports.mjs",
  "experiments/memory-retrieval-comparison-d3/prepare.mjs", "experiments/memory-retrieval-comparison-d3/run.mjs",
  "experiments/memory-retrieval-comparison-d3/wire-projection.mjs", "experiments/memory-retrieval-trial-d5/profile.mjs",
  "experiments/memory-retrieval-trial-d5/whole-profile.mjs", "experiments/memory-retrieval-trial-d5/whole-executor.mjs",
  "experiments/memory-retrieval-trial-d5/comparison-bridge.mjs", "experiments/memory-retrieval-trial-d5/budget-recorder.mjs",
  "experiments/trial-journal/journal.mjs", "experiments/trial-journal/data.mjs", "experiments/trial-journal/policy-assert.mjs",
  "experiments/memory-deletion-refresh-b18d/core.mjs", "experiments/memory-deletion-refresh-b18d/plan.mjs",
  "dist/memory/sql-read-only-fence.js", "dist/memory/zep.js", "dist/memory/original-product-input.js", "dist/memory/service.js",
  "dist/memory/zep-sdk-fetch.js", "dist/memory/delivery.js", "dist/memory/change-token-cache.js", "dist/memory/policy-refusal.js",
]);
export const WHOLE_FIXTURE_PROJECT = "LOCAL_UNVERIFIED_PROJECT";
export const PAID_SHAPE_ORIGINS = Object.freeze({ readBase: "https://memory.invalid/v2", answerEndpoint: "https://answers.invalid/v1/chat/completions" });

export async function wholeInputDocuments(context) {
  const w = await configuredHubWorld(context, {});
  const profile = JSON.parse(JSON.stringify(w.profile)), scope = JSON.parse(JSON.stringify(w.scope));
  profile.codePins = WHOLE_CODE_PATHS.map(rel => ({ path: rel, sha256: createHash("sha256").update(fs.readFileSync(path.join(app, rel))).digest("hex") }));
  profile.manifest.codePins = profile.codePins;
  profile.purpose = "approved-paid-trial";
  profile.origins = { ...PAID_SHAPE_ORIGINS };
  profile.writePermits = prepareWritePermits(profile.payloads, profile.origins.readBase);
  for (const graph of scope.graphs) graph.authority.projectId = WHOLE_FIXTURE_PROJECT;
  return { profile, scope, preparation: JSON.parse(JSON.stringify(w.preparation)) };
}

export async function writeWholeInput(out, context) {
  const documents = await wholeInputDocuments(context);
  fs.mkdirSync(out, { recursive: false });
  fs.writeFileSync(path.join(out, "PREPARED-PROFILE.json"), encode(documents.profile), { flag: "wx" });
  fs.writeFileSync(path.join(out, "FRESH-SCOPE.json"), encode(documents.scope), { flag: "wx" });
  fs.writeFileSync(path.join(out, "BOUND-PREPARATION.json"), encode(documents.preparation), { flag: "wx" });
  return documents;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--out"), out = at >= 0 ? process.argv[at + 1] : undefined;
  if (!out) { console.error("usage: node experiments/memory-retrieval-trial-d5/whole-input.mjs --out <new dir>"); process.exit(2); }
  const cleanups = [], context = { name: "whole-input", after(fn) { cleanups.push(fn); } };
  try {
    const { profile, scope } = await writeWholeInput(path.resolve(out), context);
    console.log(`${path.resolve(out)}: ${profile.manifest.topology.length} graphs, ${profile.writePermits.filter(p => p.kind === "episode").length} episodes, ${profile.manifest.jobs.length} jobs, ${scope.members.length} members; purpose ${profile.purpose}`);
  } finally {
    for (const fn of cleanups.reverse()) { try { await fn(); } catch (error) { console.error("cleanup:", error.message); } }
  }
}
