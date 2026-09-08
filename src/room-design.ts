// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { AGENT_SETTINGS, DEFAULT_ROOM_SETTINGS, NAME_PATTERN, ROOM_SETTINGS_SPEC, SILENT_MARKER, REQUEST_BRIEF_MARKER, buildBrief, coerceSetting, type Persona, type RoomSettings, type RosterEntry, type SkillsForPrompt } from "./persona.js";
import type { LintIssue, LintResult } from "./skills.js";
import type { TemplateVibemate } from "./templates.js";

export const TAGLINE_MAX = 80;
export const ROLE_MAX = 4000;
export const AVATAR_MAX = 8;
export const RULES_SOFT_MAX = 12;
export const ROLE_SOFT_MAX = 1200;
export const RULES_NEAR_LIMIT = 3000;

export interface RoomDesign {
  name?: string;
  description?: string;
  emoji?: string;
  settings?: Record<string, unknown>;
  vibemates?: TemplateVibemate[];
}

export interface RoomDesignContext {
  kind: "template" | "room";
  humanName: string;
  roomName?: string;
  base?: RoomSettings;
  knownSkills?: string[];
  changedVibemates?: string[];
  skills?: { library: { name: string; description: string }[]; channel: SkillsForPrompt["channel"]; canCreate: boolean };
}

export interface RoomDesignLint extends LintResult {
  settings?: RoomSettings;
  preview?: string;
}

export function ruleLines(customRules: string): string[] {
  return customRules
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*•]\s*/, ""))
    .filter((l) => l.length > 0);
}

export const BRIEF_MECHANICS: { pattern: RegExp; what: string }[] = [
  { pattern: /\[silent\]/i, what: `the ${SILENT_MARKER} reply` },
  { pattern: /\[request-brief\]/i, what: `the ${REQUEST_BRIEF_MARKER} reply` },
  { pattern: /\bmarkdown\b|\bmermaid\b/i, what: "the Markdown / mermaid format" },
  { pattern: /\buse @\w*\s*to address\b|\baddress .{0,20}with @/i, what: "how @Name addressing works" },
  { pattern: /\bstay in character\b/i, what: "staying in character" },
];

export function lintRoomDesign(design: RoomDesign, context: RoomDesignContext): RoomDesignLint {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const error = (code: string, message: string) => errors.push({ code, message });
  const warn = (code: string, message: string) => warnings.push({ code, message });

  const base: RoomSettings = context.base ?? { ...DEFAULT_ROOM_SETTINGS, name: (design.name ?? context.roomName ?? "Room").trim() || "Room", humanName: context.humanName };
  const settings: RoomSettings = { ...base };
  const raw = design.settings ?? {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (!(key in ROOM_SETTINGS_SPEC)) {
      error("unknown-setting", `unknown setting "${key}" (known: ${AGENT_SETTINGS.join(", ")})`);
      continue;
    }
    const k = key as keyof RoomSettings;
    if (!AGENT_SETTINGS.includes(k)) {
      error("setting-not-yours", `"${key}" is set by the human, not through a design`);
      continue;
    }
    try {
      (settings as unknown as Record<string, unknown>)[k] = coerceSetting(k, value);
    } catch (e) {
      error("invalid-setting", e instanceof Error ? e.message : String(e));
    }
  }
  if (design.emoji !== undefined && !settings.emoji) settings.emoji = String(design.emoji).trim().slice(0, AVATAR_MAX);

  const vibemates = design.vibemates ?? [];
  if (context.kind === "template") {
    if (!(design.name ?? "").trim()) error("template-no-name", "a template needs a name");
    if (!(design.description ?? "").trim()) warn("template-no-description", "a template without a description is a blank card in the picker: say what the room is for and how it feels");
    if (!vibemates.length) error("template-no-vibemates", "a template needs at least one vibemate");
  }

  const seen = new Map<string, number>();
  const touched = context.changedVibemates ? new Set(context.changedVibemates.map((n) => n.trim().toLowerCase())) : null;
  for (const [i, v] of vibemates.entries()) {
    const who = v?.name?.trim() ? `"${v.name.trim()}"` : `vibemate ${i + 1}`;
    const name = (v?.name ?? "").trim();
    const soft = !touched || touched.has(name.toLowerCase());
    if (!name) error("vibemate-no-name", `${who} has no name`);
    else if (!NAME_PATTERN.test(name)) error("vibemate-bad-name", `${who}: a name is 1-24 letters, digits, _ or -, no spaces`);
    else {
      const lower = name.toLowerCase();
      if (seen.has(lower)) error("vibemate-duplicate-name", `two vibemates are named ${who}`);
      seen.set(lower, i);
      if (lower === context.humanName.trim().toLowerCase()) error("vibemate-human-name", `${who} is the human's name`);
    }
    if ((v?.tagline ?? "").length > TAGLINE_MAX) error("tagline-too-long", `${who}: the tagline is at most ${TAGLINE_MAX} characters (it is the one line the others see)`);
    else if (soft && !(v?.tagline ?? "").trim()) warn("vibemate-no-tagline", `${who} has no tagline: the others read it in the roster to know what this one leans to`);
    if ((v?.role ?? "").length > ROLE_MAX) error("role-too-long", `${who}: the role is at most ${ROLE_MAX} characters`);
    else if (soft && !(v?.role ?? "").trim()) warn("vibemate-no-role", `${who} has no role: without one it is the agent's default self, not a character`);
    else if (soft && (v.role ?? "").length > ROLE_SOFT_MAX) warn("role-restates-rules", `${who}: a role of ${v.role!.length} characters is probably restating the protocol; a role says who this one is and which way it leans, the rules say how they work together`);
    if ((v?.avatar ?? "").length > AVATAR_MAX) error("avatar-too-long", `${who}: the avatar is one emoji`);
    if (context.knownSkills) {
      for (const skill of v?.skills ?? []) if (!context.knownSkills.includes(skill)) error("unknown-skill", `${who}: no skill named "${skill}" in the library`);
    }
    if (context.kind === "template" && (v?.agentType || v?.model)) warn("vendor-pinned", `${who} names an agent or model: a template cannot know what this machine has, so they are suggestions at best; leave them out unless the design depends on a capability tier`);
  }
  const initials = new Map<string, string[]>();
  for (const v of vibemates) {
    const name = (v?.name ?? "").trim();
    if (!name) continue;
    const initial = name[0].toLowerCase();
    initials.set(initial, [...(initials.get(initial) ?? []), name]);
  }
  for (const names of initials.values()) if (names.length > 1) warn("names-share-initial", `${names.join(" and ")} start with the same letter: @-autocomplete and the human's eye tell them apart slower`);

  const rules = ruleLines(settings.customRules);
  if (rules.length > RULES_SOFT_MAX) warn("too-many-rules", `${rules.length} rules: every vibemate carries them on every turn; ${RULES_SOFT_MAX} is a full protocol, longer belongs in a skill`);
  if (settings.customRules.length > RULES_NEAR_LIMIT) warn("rules-near-limit", `the rules are ${settings.customRules.length} characters; the hub stores at most 4000`);
  for (const rule of rules) {
    for (const m of BRIEF_MECHANICS) if (m.pattern.test(rule)) warn("rule-repeats-brief", `the brief already explains ${m.what}; the rule "${rule.slice(0, 60)}${rule.length > 60 ? "…" : ""}" repeats it`);
  }
  if (vibemates.length >= 2 && !rules.length) warn("no-rules", "two or more vibemates and no rules: name the situations this room will meet and answer them, for example who takes a task that names nobody, and when one of them stays quiet");
  if (vibemates.length >= 2 && settings.agentsWakeEachOther && settings.hopLimit < 3 * vibemates.length) warn("hop-limit-low", `hopLimit ${settings.hopLimit} with ${vibemates.length} vibemates who wake each other: one exchange around the room already uses ${vibemates.length}; about ${3 * vibemates.length} or more lets a handoff finish`);

  if (errors.length) return { errors, warnings };

  const first = vibemates[0];
  const persona: Persona = first ? { name: first.name.trim(), tagline: (first.tagline ?? "").trim(), role: (first.role ?? "").trim() } : { name: "Vibemate", tagline: "", role: "" };
  const roster: RosterEntry[] = [{ name: context.humanName, kind: "human" }, ...vibemates.map((v) => ({ name: v.name.trim(), kind: "agent" as const, tagline: (v.tagline ?? "").trim() || undefined }))];
  const skills: SkillsForPrompt | undefined = context.skills && {
    items: (first?.skills ?? []).map((name) => context.skills!.library.find((s) => s.name === name)).filter((s): s is { name: string; description: string } => !!s),
    channel: context.skills.channel,
    canCreate: context.skills.canCreate,
  };
  return { errors, warnings, settings, preview: buildBrief(settings, persona, roster, undefined, skills) };
}


export interface RoomChangeSet {
  settings?: Record<string, unknown>;
  vibemates?: {
    add?: TemplateVibemate[];
    update?: ({ name: string } & Partial<Omit<TemplateVibemate, "name">> & { newName?: string })[];
    remove?: string[];
  };
}

export interface VibemateChange {
  op: "add" | "update" | "remove";
  name: string;
  fields?: { field: string; from: string; to: string }[];
}

export interface SettingChange {
  key: string;
  from: unknown;
  to: unknown;
}

export function applyVibemateChanges(current: TemplateVibemate[], changes: RoomChangeSet["vibemates"]): { next: TemplateVibemate[]; ops: VibemateChange[]; errors: string[] } {
  const next: TemplateVibemate[] = current.map((v) => ({ ...v }));
  const ops: VibemateChange[] = [];
  const errors: string[] = [];
  const find = (name: string) => next.findIndex((v) => v.name.toLowerCase() === name.trim().toLowerCase());
  for (const name of changes?.remove ?? []) {
    const i = find(String(name));
    if (i < 0) errors.push(`no vibemate named "${name}" to remove`);
    else {
      ops.push({ op: "remove", name: next[i].name });
      next.splice(i, 1);
    }
  }
  for (const u of changes?.update ?? []) {
    const i = find(String(u?.name ?? ""));
    if (i < 0) {
      errors.push(`no vibemate named "${u?.name}" to update`);
      continue;
    }
    const before = next[i];
    const after: TemplateVibemate = { ...before };
    const fields: VibemateChange["fields"] = [];
    const set = (field: keyof TemplateVibemate, value: unknown) => {
      if (value === undefined) return;
      const from = before[field];
      const fromText = Array.isArray(from) ? from.join(", ") : String(from ?? "");
      const toText = Array.isArray(value) ? value.join(", ") : String(value ?? "");
      if (fromText === toText) return;
      (after as unknown as Record<string, unknown>)[field] = value;
      fields.push({ field, from: fromText, to: toText });
    };
    if (u.newName !== undefined) set("name", String(u.newName).trim());
    set("tagline", u.tagline);
    set("role", u.role);
    set("avatar", u.avatar);
    set("skills", u.skills);
    set("replyDelay", u.replyDelay);
    if (fields.length) {
      next[i] = after;
      ops.push({ op: "update", name: before.name, fields });
    }
  }
  for (const a of changes?.add ?? []) {
    const v: TemplateVibemate = { name: String(a?.name ?? "").trim() };
    if (a?.tagline) v.tagline = a.tagline;
    if (a?.role) v.role = a.role;
    if (a?.avatar) v.avatar = a.avatar;
    if (a?.skills) v.skills = a.skills;
    if (typeof a?.replyDelay === "number") v.replyDelay = a.replyDelay;
    next.push(v);
    ops.push({ op: "add", name: v.name });
  }
  return { next, ops, errors };
}

export function diffSettings(current: RoomSettings, next: RoomSettings): SettingChange[] {
  const out: SettingChange[] = [];
  for (const key of AGENT_SETTINGS) {
    if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) out.push({ key, from: current[key], to: next[key] });
  }
  return out;
}
