// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { TemplateVibemate } from "./templates.js";

export const NEW_ROOM_VIBEMATE_MAX = 6;
export const NEW_ROOM_NAME_MAX = 40;
export const NEW_ROOM_WHY_MAX = 600;

export interface NewRoomContext {
  proposerWasCreated: boolean;
  openCard: boolean;
  proposerName: string;
}

export interface NewRoomPlan {
  name: string;
  why: string;
  vibemates: TemplateVibemate[];
  dir: null;
  reachableFromMessengers: false;
  price: { sessions: number; byModel: { model: string; sessions: number }[] };
}

const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u;
const VIBEMATE_NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,23}$/u;

const text = (value: unknown, max: number): string => (typeof value === "string" ? value : "").trim().slice(0, max);

function onlyKnown(value: Record<string, unknown>, known: string[], what: string): void {
  const stray = Object.keys(value).filter((key) => !known.includes(key));
  if (stray.length) throw new Error(`not proposed: ${what} has nothing called ${stray.map((k) => `"${k}"`).join(", ")}; it would have been dropped without a word`);
}

const ROOM_FIELDS = ["name", "why", "vibemates"];
const VIBEMATE_FIELDS = ["name", "tagline", "role", "avatar", "agentType", "model", "effort", "mode"];

export const CREATED_MODE = "ask";

export function planNewRoom(request: Record<string, unknown>, context: NewRoomContext): NewRoomPlan {
  if (context.proposerWasCreated) throw new Error("not proposed: a vibemate created by a vibemate cannot propose rooms of its own");
  if (context.openCard) throw new Error("not proposed: this room already has a proposal waiting for an answer; it is one at a time");

  const name = text(request.name, NEW_ROOM_NAME_MAX);
  if (!NAME_OK.test(name)) throw new Error(`not proposed: "${name}" is not a room name (1-${NEW_ROOM_NAME_MAX} letters, digits, spaces, _ or -)`);
  if (request.dir !== undefined) throw new Error("not proposed: a working folder is the human's to choose; the card offers the room without one");
  onlyKnown(request, ROOM_FIELDS, "a proposed room");

  const asked = Array.isArray(request.vibemates) ? (request.vibemates as Record<string, unknown>[]) : [];
  if (!asked.length) throw new Error("not proposed: a room with nobody in it is a folder; name at least one vibemate");
  if (asked.length > NEW_ROOM_VIBEMATE_MAX) throw new Error(`not proposed: ${asked.length} vibemates at one press is more than a person can weigh; ${NEW_ROOM_VIBEMATE_MAX} at most`);

  const seen = new Set<string>();
  const vibemates: TemplateVibemate[] = asked.map((one) => {
    onlyKnown(one ?? {}, VIBEMATE_FIELDS, "a proposed vibemate");
    const vibeName = text(one?.name, 24);
    if (!VIBEMATE_NAME_OK.test(vibeName)) throw new Error(`not proposed: "${vibeName}" is not a vibemate name (1-24 letters, digits, _ or -)`);
    if (seen.has(vibeName.toLowerCase())) throw new Error(`not proposed: ${vibeName} is named twice`);
    seen.add(vibeName.toLowerCase());
    if (one?.mode !== undefined && one.mode !== CREATED_MODE) throw new Error(`not proposed: ${vibeName} would start in a mode that asks before it acts; that is not the proposer's to set`);
    return {
      name: vibeName,
      ...(one?.tagline !== undefined ? { tagline: text(one.tagline, 80) } : {}),
      ...(one?.role !== undefined ? { role: text(one.role, 8000) } : {}),
      ...(one?.avatar !== undefined ? { avatar: text(one.avatar, 8) } : {}),
      ...(one?.agentType !== undefined ? { agentType: text(one.agentType, 40) } : {}),
      ...(one?.model !== undefined ? { model: text(one.model, 60) } : {}),
      ...(one?.effort !== undefined ? { effort: text(one.effort, 20) } : {}),
      mode: CREATED_MODE,
    };
  });

  const byModel = new Map<string, number>();
  for (const one of vibemates) byModel.set(one.model || "its vibemate's default", (byModel.get(one.model || "its vibemate's default") ?? 0) + 1);

  return {
    name,
    why: text(request.why, NEW_ROOM_WHY_MAX),
    vibemates,
    dir: null,
    reachableFromMessengers: false,
    price: { sessions: vibemates.length, byModel: [...byModel].map(([model, sessions]) => ({ model, sessions })) },
  };
}
