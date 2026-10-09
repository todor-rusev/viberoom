// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { z } from "zod";
import { askSieve, type SieveEndpoint } from "./sieve.js";
import { observe, type IngestionObserver } from "./ingestion-debug.js";
import { assembleExcerpts, type ExcerptOutcome } from "./excerpts.js";

export type FilterMode = "off" | "heuristic" | "llm";

export interface FilterItem {
  sourceId: string;
  authorName: string;
  authorKind: "human" | "agent";
  text: string;
  ts: number;
}

export interface FilterVerdict {
  sourceId: string;
  keep: boolean;
  episode?: string;
  excerpts?: ExcerptOutcome;
}

export type FilterEndpoint = SieveEndpoint;

export const EXCERPTS_OVER_CHARS = 700;
export const EPISODE_MAX_CHARS = 1200;
export const FILTER_BATCH = 12;

const MARKERS = new Set(["[silent]", "[request-brief]"]);

export function screen(text: string): "drop" | "pass" {
  const trimmed = text.trim();
  if (!trimmed || MARKERS.has(trimmed)) return "drop";
  return "pass";
}

export function judgeWithoutModel(items: readonly FilterItem[], mode: Exclude<FilterMode, "llm">): FilterVerdict[] {
  return items.map(item => {
    const keep = mode === "off" || item.authorKind === "human";
    if (!keep || [...item.text].length <= EXCERPTS_OVER_CHARS) return { sourceId: item.sourceId, keep };
    return { sourceId: item.sourceId, keep, excerpts: { kind: "whole", reason: "no_model", accepted: [], rejected: [], coverage: 0 } };
  });
}

const VERDICTS = z.object({
  verdicts: z.array(z.object({
    id: z.number(),
    keep: z.boolean(),
    excerpts: z.array(z.string()).nullable().optional(),
  })),
});

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "keep", "excerpts"],
        properties: {
          id: { type: "integer" },
          keep: { type: "boolean" },
          excerpts: { type: ["array", "null"], items: { type: "string" } },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  "You curate the long-term memory of a group chat room where one human and several AI agents work together.",
  "The room can be about anything: software, investing, video production, daily assistance. You receive a batch of messages.",
  "For each message decide whether it contains anything worth remembering months from now, and if so, which of its words carry it.",
  "",
  "KEEP (keep=true): decisions and their reasons; facts about the work, the project, the people and the tools;",
  "tasks — created, taken, finished, abandoned; bugs and their fixes; preferences and constraints the human states;",
  "corrections of earlier beliefs; names, renames and relations between things; numbers that will still matter later.",
  "DROP (keep=false): greetings, acknowledgements, thanks; questions answered immediately in the same batch (keep the answer);",
  "progress narration with no outcome; tool logs and command output; restatements of what is already kept from an earlier message.",
  "",
  "For kept messages longer than a few lines, set `excerpts`: the parts of the message that carry what is worth remembering,",
  "copied from the message letter for letter: whole sentences, whole paragraphs or whole list items (with the line that introduces",
  "the list), in the order they appear in the message. Never rewrite, shorten, merge or translate a fragment; never add a word of your own.",
  "Leave out greetings, narration of progress, repetition and what is already kept from an earlier message. A sentence that refers",
  "to the one before it (this, it, that) goes together with it. Keep concrete names, dates and numbers inside their sentences.",
  "If nearly all of the message matters, set `excerpts` to null: the message is then kept whole.",
  "For short kept messages, and for dropped messages, set `excerpts` to null. Answer for every message id, in the given order, as JSON.",
].join("\n");

export type RawVerdict = { keep: boolean; excerpts?: string[] | null };

export async function judge(endpoint: FilterEndpoint, items: FilterItem[], context: string, observer?: IngestionObserver): Promise<FilterVerdict[]> {
  const answers = await judgeOnce(endpoint, items, context, observer);
  const missing = items.map((item, at) => ({ item, at })).filter(({ at }) => !answers.has(at));
  if (missing.length) {
    const repair = await judgeOnce(endpoint, missing.map(m => m.item), context, observer);
    for (const [at, verdict] of repair) answers.set(missing[at].at, verdict);
  }
  return items.map((item, at) => {
    const verdict = answers.get(at);
    if (!verdict) throw new Error(`memory filter: no verdict for message ${item.sourceId}`);
    return verdictFor(item, verdict, observer);
  });
}

export function verdictFor(item: FilterItem, raw: RawVerdict, observer?: IngestionObserver): FilterVerdict {
  if (!raw.keep || [...item.text].length <= EXCERPTS_OVER_CHARS) return { sourceId: item.sourceId, keep: raw.keep };
  const outcome = assembleExcerpts(item.text, raw.excerpts, { maxChars: EPISODE_MAX_CHARS });
  observe(observer, { kind: "excerpts.checked", sourceId: item.sourceId, data: outcome });
  return { sourceId: item.sourceId, keep: true, excerpts: outcome, ...(outcome.kind === "excerpts" ? { episode: outcome.episode } : {}) };
}

async function judgeOnce(endpoint: FilterEndpoint, items: FilterItem[], context: string, observer?: IngestionObserver): Promise<Map<number, RawVerdict>> {
  const user = [
    context ? `Earlier in the room (context only, do not judge these):\n${context}\n` : "",
    "Messages to judge:",
    JSON.stringify(items.map((i, at) => ({ id: at + 1, speaker: i.authorName, role: i.authorKind, text: i.text })), null, 1),
  ].join("\n");
  observe(observer, { kind: "sieve.mapping", data: items.map((item, at) => ({ id: at + 1, sourceId: item.sourceId })) });
  const answer = await askSieve(endpoint, {
    label: "memory filter", system: SYSTEM, user,
    schemaName: "memory_verdicts", shapeName: "verdict shape", schema: RESPONSE_SCHEMA, parse: VERDICTS,
    observe: observer,
  });
  const byIndex = new Map<number, RawVerdict>();
  for (const v of answer.verdicts) if (Number.isInteger(v.id) && v.id >= 1 && v.id <= items.length) byIndex.set(v.id - 1, v);
  return byIndex;
}
