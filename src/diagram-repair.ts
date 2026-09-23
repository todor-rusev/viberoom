// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { Marked, type Token } from "marked";
import { DIAGRAM_SOURCE_MAX } from "./tool-spec.js";

export interface DiagramRepair {
  block: number;
  state: "repairing" | "fixed" | "failed";
  error: string;
  attempts: number;
  previous: string[];
  since: number;
}

export const DIAGRAM_REPAIR_ATTEMPTS = 2;
export const DIAGRAM_REPAIR_WINDOW_MS = 15 * 60_000;
export const DIAGRAM_ERROR_MAX = 2000;

export interface MermaidBlock {
  block: number;
  source: string;
  span: { start: number; end: number } | null;
}

const markdown = new Marked({ gfm: true, breaks: true });
const MERMAID_LANG = /^\s*mermaid\b/i;

const lf = (text: string) => text.replace(/\r\n?/g, "\n");
const isMermaid = (token: Token): token is Token & { type: "code"; text: string; raw: string } =>
  token.type === "code" && MERMAID_LANG.test(String((token as { lang?: string }).lang ?? ""));

export function mermaidBlocks(text: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  let offset = 0;
  for (const token of markdown.lexer(lf(text))) {
    if (isMermaid(token)) blocks.push({ block: blocks.length + 1, source: token.text.trim(), span: { start: offset, end: offset + token.raw.length } });
    else markdown.walkTokens([token], (inner) => {
      if (inner !== token && isMermaid(inner)) blocks.push({ block: blocks.length + 1, source: inner.text.trim(), span: null });
    });
    offset += token.raw.length;
  }
  return blocks;
}

export function diagramSourceProblem(source: string): string | null {
  if (!source.trim()) return "the diagram's code is empty";
  if (source.length > DIAGRAM_SOURCE_MAX) return `the diagram's code is longer than ${DIAGRAM_SOURCE_MAX} characters`;
  if (/^\s*(```|~~~)/.test(source)) return "send the diagram's code alone, without the ``` fence around it";
  return null;
}

export function fenceFor(source: string, fence = "```"): string {
  const mark = fence[0];
  let length = fence.length;
  for (const line of source.split("\n")) {
    const run = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (run && run[1][0] === mark) length = Math.max(length, run[1].length + 1);
  }
  return mark.repeat(length);
}

export function replaceDiagramSource(text: string, block: MermaidBlock, source: string): string {
  if (!block.span) throw new Error(`diagram ${block.block} sits inside a list or a quote, and the room can replace only a diagram at the top level of a message`);
  const whole = lf(text);
  const raw = whole.slice(block.span.start, block.span.end);
  const open = /^( {0,3})(`{3,}|~{3,})([^\n]*)/.exec(raw);
  if (!open) throw new Error(`diagram ${block.block} is not a fenced block`);
  const [, indent, fence, info] = open;
  const tail = /\n*$/.exec(raw)![0];
  const code = lf(source).trim().split("\n").map((line) => (line ? indent + line : line)).join("\n");
  const mark = fenceFor(lf(source).trim(), fence);
  return `${whole.slice(0, block.span.start)}${indent}${mark}${info}\n${code}\n${indent}${mark}${tail}${whole.slice(block.span.end)}`;
}

export const boundedError = (error: string) => {
  const text = lf(error).replace(/\s+$/, "");
  return text.length > DIAGRAM_ERROR_MAX ? `${text.slice(0, DIAGRAM_ERROR_MAX - 1)}…` : text;
};

export type FailureOutcome = "repairing" | "failed" | "unchanged";

export function recordFailure(repairs: DiagramRepair[], block: number, error: string, canRepair: boolean, now: number): FailureOutcome {
  const known = repairs.find((r) => r.block === block);
  if (known ? known.state !== "fixed" : !canRepair) return "unchanged";
  const state = canRepair && (known?.attempts ?? 0) < DIAGRAM_REPAIR_ATTEMPTS ? "repairing" : "failed";
  if (known) Object.assign(known, { state, error: boundedError(error), since: now });
  else repairs.push({ block, state, error: boundedError(error), attempts: 0, previous: [], since: now });
  return state;
}

export function recordFix(repairs: DiagramRepair[], block: number, replaced: string, now: number): void {
  const known = repairs.find((r) => r.block === block);
  if (!known || known.state !== "repairing") throw new Error(`diagram ${block} is not waiting for a fix`);
  Object.assign(known, { state: "fixed", attempts: known.attempts + 1, since: now });
  known.previous.push(replaced);
}

export function giveUp(repairs: DiagramRepair[] | undefined, block: number, now: number): boolean {
  const known = repairs?.find((r) => r.block === block);
  if (!known || known.state !== "repairing") return false;
  Object.assign(known, { state: "failed", since: now });
  return true;
}
