// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { z } from "zod";
import { askSieve, type SieveEndpoint } from "./sieve.js";

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
}

export type FilterEndpoint = SieveEndpoint;

export const CONDENSE_OVER_CHARS = 700;
export const EPISODE_MAX_CHARS = 1200;
export const FILTER_BATCH = 12;

const MARKERS = new Set(["[silent]", "[request-brief]"]);

export function screen(text: string): "drop" | "pass" {
  const trimmed = text.trim();
  if (!trimmed || MARKERS.has(trimmed)) return "drop";
  return "pass";
}

export function heuristicEpisode(text: string): string {
  const trimmed = text.trim();
  if ([...trimmed].length <= EPISODE_MAX_CHARS) return trimmed;
  const head = [...trimmed].slice(0, EPISODE_MAX_CHARS).join("");
  const lastBreak = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(". "));
  return (lastBreak > EPISODE_MAX_CHARS / 2 ? head.slice(0, lastBreak + 1) : head).trimEnd() + " […]";
}

const VERDICTS = z.object({
  verdicts: z.array(z.object({
    id: z.number(),
    keep: z.boolean(),
    episode: z.string().nullable().optional(),
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
        required: ["id", "keep", "episode"],
        properties: {
          id: { type: "integer" },
          keep: { type: "boolean" },
          episode: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  "You curate the long-term memory of a group chat room where one human and several AI agents work together.",
  "The room can be about anything: software, investing, video production, daily assistance. You receive a batch of messages.",
  "For each message decide whether it contains anything worth remembering months from now, and if so, condense it.",
  "",
  "KEEP (keep=true): decisions and their reasons; facts about the work, the project, the people and the tools;",
  "tasks — created, taken, finished, abandoned; bugs and their fixes; preferences and constraints the human states;",
  "corrections of earlier beliefs; names, renames and relations between things; numbers that will still matter later.",
  "DROP (keep=false): greetings, acknowledgements, thanks; questions answered immediately in the same batch (keep the answer);",
  "progress narration with no outcome; tool logs and command output; restatements of what is already kept from an earlier message.",
  "",
  "For kept messages longer than a few lines, write `episode`: the remembered substance in complete sentences,",
  `at most ${EPISODE_MAX_CHARS} characters. Start it with "SpeakerName: " exactly as given. Keep concrete names, dates and numbers.`,
  "Write the episode in the language the message is written in. Never translate, never add facts that are not in the message.",
  "For short kept messages, and for dropped messages, set `episode` to null. Answer for every message id, in the given order, as JSON.",
].join("\n");

type RawVerdict = { keep: boolean; episode?: string | null };

export async function condense(endpoint: FilterEndpoint, items: FilterItem[], context: string): Promise<FilterVerdict[]> {
  const answers = await judgeOnce(endpoint, items, context);
  const missing = items.map((item, at) => ({ item, at })).filter(({ at }) => !answers.has(at));
  if (missing.length) {
    const repair = await judgeOnce(endpoint, missing.map(m => m.item), context);
    for (const [at, verdict] of repair) answers.set(missing[at].at, verdict);
  }
  return items.map((item, at) => {
    const verdict = answers.get(at);
    if (!verdict) throw new Error(`memory filter: no verdict for message ${item.sourceId}`);
    const episode = verdict.episode?.trim();
    return {
      sourceId: item.sourceId,
      keep: verdict.keep,
      ...(verdict.keep && (episode || [...item.text].length > CONDENSE_OVER_CHARS)
        ? { episode: episode ? [...episode].slice(0, EPISODE_MAX_CHARS).join("") : heuristicEpisode(item.text) }
        : {}),
    };
  });
}

async function judgeOnce(endpoint: FilterEndpoint, items: FilterItem[], context: string): Promise<Map<number, RawVerdict>> {
  const user = [
    context ? `Earlier in the room (context only, do not judge these):\n${context}\n` : "",
    "Messages to judge:",
    JSON.stringify(items.map((i, at) => ({ id: at + 1, speaker: i.authorName, role: i.authorKind, text: i.text })), null, 1),
  ].join("\n");
  const answer = await askSieve(endpoint, {
    label: "memory filter", system: SYSTEM, user,
    schemaName: "memory_verdicts", shapeName: "verdict shape", schema: RESPONSE_SCHEMA, parse: VERDICTS,
  });
  const byIndex = new Map<number, RawVerdict>();
  for (const v of answer.verdicts) if (Number.isInteger(v.id) && v.id >= 1 && v.id <= items.length) byIndex.set(v.id - 1, v);
  return byIndex;
}
