// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { readFileSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.js";
import { join } from "node:path";
import { asRecord, type Shape, type Value } from "./record-fields.js";

export const FINDINGS_FILE = "findings.jsonl";

export const FINDINGS_KEPT = 500;

export interface Finding {
  kind: string;
  key: string;
  [fact: string]: unknown;
}

export function findingsPath(dataDir: string): string {
  return join(dataDir, FINDINGS_FILE);
}

const WITNESS_KINDS = new Set(["blank-fragment", "held-live", "end-jump"]);

export function recordWitness(dataDir: string, witness: { kind: string; key: string; ours: Record<string, Value>; shape: Shape; said: unknown }, keep = FINDINGS_KEPT): Finding {
  if (!WITNESS_KINDS.has(witness.kind)) throw new Error(`"${witness.kind}" is not a witness: an instrument kept for everybody waits for a known fault, and this one is on no list`);
  const finding: Finding = {
    ...asRecord(witness.shape, witness.said),
    kind: witness.kind,
    key: witness.key,
    at: new Date().toISOString(),
    ...witness.ours,
  };
  recordFinding(dataDir, finding, keep);
  return finding;
}

export function readFindings(dataDir: string): Finding[] {
  let text = "";
  try {
    text = readFileSync(findingsPath(dataDir), "utf8");
  } catch {
    return [];
  }
  const out: Finding[] = [];
  for (const line of text.split(String.fromCharCode(10))) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Finding);
    } catch {
    }
  }
  return out;
}

export function recordFinding(dataDir: string, finding: Finding, keep = FINDINGS_KEPT): Finding[] {
  const kept = readFindings(dataDir).filter((one) => one.key !== finding.key);
  kept.push(finding);
  const lines = kept.slice(-keep);
  const text = lines.map((one) => JSON.stringify(one)).join(String.fromCharCode(10)) + String.fromCharCode(10);
  writeFileAtomic(findingsPath(dataDir), text, { write: (path, data) => writeFileSync(path, data as string, { mode: 0o600 }) });
  return lines;
}

export function findingReading(window: { heldBy?: string; lastStreamSequence?: number }, ended: { streamSequence: number } | null): string {
  if (window.heldBy === "screen") return "the window's own record had this turn finished; only the bubble on screen still offered Stop: drawing, not delivery";
  if (!ended) return "the hub does not remember this turn ending (older than the last hundred it keeps, or it never ended here)";
  const seen = Number(window.lastStreamSequence);
  if (!Number.isFinite(seen)) return "the window did not say how far it had read, so the two halves cannot be put together";
  return ended.streamSequence <= seen
    ? "the end went out before the window's last read: it arrived and was passed over"
    : "the end went out after the window's last read: the window never got that far";
}
