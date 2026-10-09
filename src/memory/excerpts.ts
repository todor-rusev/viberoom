// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export const EXCERPT_COVERAGE_LIMIT = 2 / 3;
export const EXCERPT_GAP = " […] ";

export interface AcceptedExcerpt { text: string; start: number; end: number }
export type ExcerptRejection = "empty" | "missing" | "out_of_order" | "overlapping" | "partial_sentence";
export interface RejectedExcerpt { text: string; reason: ExcerptRejection }

export type ExcerptOutcome =
  | { kind: "excerpts"; episode: string; accepted: AcceptedExcerpt[]; rejected: []; coverage: number }
  | { kind: "whole"; reason: WholeReason; accepted: AcceptedExcerpt[]; rejected: RejectedExcerpt[]; coverage: number };

export type WholeReason =
  | "no_excerpts"
  | "rejected"
  | "coverage"
  | "too_long"
  | "no_model";

export interface ExcerptLimits {
  maxChars: number;
  coverageLimit?: number;
}

const codePoints = (s: string): number => [...s].length;

const SENTENCE_END = /[.!?…:;][\s"'“”’»)\]]*$/u;
const LIST_MARKER = /^\s*(?:[-*•–—]|\d{1,3}[.)]|\p{L}[.)])\s+$/u;
const ADJACENT = /^\s*(?:(?:[-*•–—]|\d{1,3}[.)]|\p{L}[.)])\s+)?$/u;

function startsWhole(text: string, start: number): boolean {
  if (start === 0) return true;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const before = text.slice(lineStart, start);
  if (before.trim() === "" || LIST_MARKER.test(before)) return true;
  return SENTENCE_END.test(before.trimEnd()) || /^["'„“‘«(\[]$/u.test(text.slice(start - 1, start)) && startsWhole(text, start - 1);
}

function endsWhole(text: string, excerpt: string, end: number): boolean {
  if (end === text.length || SENTENCE_END.test(excerpt)) return true;
  const rest = text.slice(end, text.indexOf("\n", end) < 0 ? text.length : text.indexOf("\n", end));
  return rest.trim() === "";
}

export function assembleExcerpts(text: string, excerpts: readonly string[] | null | undefined, limits: ExcerptLimits): ExcerptOutcome {
  const coverageLimit = limits.coverageLimit ?? EXCERPT_COVERAGE_LIMIT;
  const accepted: AcceptedExcerpt[] = [], rejected: RejectedExcerpt[] = [];
  if (!excerpts || excerpts.length === 0) return { kind: "whole", reason: "no_excerpts", accepted, rejected, coverage: 0 };
  let cursor = 0;
  for (const raw of excerpts) {
    const excerpt = typeof raw === "string" ? raw.trim() : "";
    if (!excerpt) { rejected.push({ text: typeof raw === "string" ? raw : String(raw), reason: "empty" }); continue; }
    const at = text.indexOf(excerpt, cursor);
    if (at < 0) {
      const anywhere = text.indexOf(excerpt);
      if (anywhere < 0) rejected.push({ text: excerpt, reason: "missing" });
      else if (anywhere + excerpt.length > cursor && anywhere < cursor) rejected.push({ text: excerpt, reason: "overlapping" });
      else rejected.push({ text: excerpt, reason: "out_of_order" });
      continue;
    }
    if (!startsWhole(text, at) || !endsWhole(text, excerpt, at + excerpt.length)) { rejected.push({ text: excerpt, reason: "partial_sentence" }); cursor = at + excerpt.length; continue; }
    accepted.push({ text: excerpt, start: at, end: at + excerpt.length });
    cursor = at + excerpt.length;
  }
  const covered = accepted.reduce((sum, a) => sum + codePoints(a.text), 0), total = codePoints(text);
  const coverage = total === 0 ? 0 : covered / total;
  if (rejected.length) return { kind: "whole", reason: "rejected", accepted, rejected, coverage };
  if (coverage > coverageLimit) return { kind: "whole", reason: "coverage", accepted, rejected: [], coverage };
  let episode = "";
  for (const [index, a] of accepted.entries()) {
    if (index === 0) { episode = a.text; continue; }
    const between = text.slice(accepted[index - 1].end, a.start);
    episode += ADJACENT.test(between) ? (between.includes("\n") ? "\n" : " ") + a.text : EXCERPT_GAP + a.text;
  }
  if (text.slice(0, accepted[0].start).trim() !== "") episode = EXCERPT_GAP.trimStart() + episode;
  if (text.slice(accepted[accepted.length - 1].end).trim() !== "") episode += EXCERPT_GAP.trimEnd();
  if (codePoints(episode) > limits.maxChars) return { kind: "whole", reason: "too_long", accepted, rejected: [], coverage };
  return { kind: "excerpts", episode, accepted, rejected: [], coverage };
}
