// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Logger } from "./log.js";

export const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
export const SKILL_FILE = "SKILL.md";
export const BUILTIN_AUTHOR = "viberoom";
export const HUMAN_AUTHOR = "human";
const DESCRIPTION_MAX = 300;
const DESCRIPTION_MIN_USEFUL = 15;
const BODY_MAX = 20_000;
const KNOWN_FIELDS = new Set([
  "name",
  "description",
  "argument-hint",
  "user-invocable",
  "disable-agent-invocation",
  "author",
  "created",
  "reviewed",
  "draft",
  "metadata",
  "license",
  "compatibility",
  "when_to_use",
]);

export interface SkillMeta {
  name: string;
  description: string;
  argumentHint: string;
  userInvocable: boolean;
  agentInvocable: boolean;
  author: string;
  created: string;
  reviewed: boolean;
  draft: boolean;
  dir: string;
  file: string;
  extraFiles: string[];
  mtime: number;
  problems: string[];
  warnings: string[];
}

export interface Skill extends SkillMeta {
  body: string;
}

export interface SkillDraft {
  name: string;
  description: string;
  argumentHint?: string;
  body: string;
  userInvocable?: boolean;
  agentInvocable?: boolean;
  author?: string;
  reviewed?: boolean;
  draft?: boolean;
}

export interface LintIssue {
  code: string;
  message: string;
}

export interface LintResult {
  errors: LintIssue[];
  warnings: LintIssue[];
}

export function lintSkill(input: {
  name: string;
  folder?: string;
  description: string;
  argumentHint?: string;
  body: string;
  unknownFields?: string[];
}): LintResult {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const name = input.name.trim();
  const description = input.description.trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  const hint = (input.argumentHint ?? "").trim();
  if (!SKILL_NAME_PATTERN.test(name)) errors.push({ code: "name-invalid", message: `name "${name}" must be 1-32 letters, digits, _ or -` });
  if (input.folder && name.toLowerCase() !== input.folder.toLowerCase()) {
    errors.push({ code: "name-folder-mismatch", message: `name "${name}" differs from the folder "${input.folder}"` });
  }
  if (!description) errors.push({ code: "description-missing", message: "description is required: it is what tells an agent when to use the skill" });
  else if (description.length > DESCRIPTION_MAX) errors.push({ code: "description-too-long", message: `description must be at most ${DESCRIPTION_MAX} characters` });
  else if (description.length < DESCRIPTION_MIN_USEFUL || description.toLowerCase() === name.toLowerCase()) {
    warnings.push({ code: "description-thin", message: "description should say what the skill does and when to use it, not just its name" });
  }
  if (!body) errors.push({ code: "body-empty", message: "the instructions are empty" });
  else if (body.length > BODY_MAX) errors.push({ code: "body-too-long", message: `the instructions must be at most ${BODY_MAX} characters` });
  if (/\[skill:/i.test(body) || /<\/?skill[\s>]/i.test(body)) {
    errors.push({ code: "body-contains-delivery-syntax", message: "the instructions must not contain [skill:…] or <skill> tags (they are the hub's delivery syntax)" });
  }
  const usesArguments = /(^|[^\\])\$ARGUMENTS/.test(body);
  if (usesArguments && !hint) warnings.push({ code: "arguments-without-hint", message: "the instructions use $ARGUMENTS but there is no argument hint for the / menu" });
  if (!usesArguments && hint) warnings.push({ code: "hint-without-arguments", message: "there is an argument hint but the instructions never use $ARGUMENTS" });
  for (const field of input.unknownFields ?? []) warnings.push({ code: "unknown-field", message: `unknown frontmatter field "${field}" is ignored` });
  return { errors, warnings };
}

export const SKILL_WRITER: SkillDraft = {
  name: "skill-writer",
  description: "How to write a good skill for this library. Load it before creating or updating a skill with create_skill / update_skill.",
  argumentHint: "",
  body: [
    "A skill is a reusable set of instructions for one kind of task. Another agent (or you, later, in another room) will get only this text when the skill is invoked, so it must stand on its own.",
    "",
    "Write it like this:",
    "- name: short, lowercase, hyphenated (e.g. pr-review, daily-summary). It becomes the /command.",
    "- description: one or two sentences that say WHAT the skill does and WHEN to use it. This is the only thing agents see before loading it, so it must let them decide (e.g. \"Review a pull request for correctness and post findings as a numbered list. Use when someone asks for a code review.\").",
    "- instructions: imperative, concrete steps or a format. Say what the reply should contain, in what order, how long. Include an example when the format is non-obvious. Write \\$ARGUMENTS where the caller's text (what follows /name) belongs; give an argument hint like [PR number] when you use it. To mention the placeholder without filling it in, put a backslash before it.",
    "- Do not put chat greetings, room rules or secrets in a skill, and do not write the hub's own delivery markers (the bracketed skill marker or skill tags) in it.",
    "- Keep it under ~300 words; put long reference material in separate files in the skill's folder instead.",
    "",
    "Before creating: check that no existing skill already covers the task (your brief lists the skills you have). Prefer updating an agent-made skill over creating a near-duplicate.",
    "After creating: attach it to yourself (attach_skill) if you will use it, and to other agents only when they need it; say in the room what you created and why.",
  ].join("\n"),
  userInvocable: true,
  agentInvocable: true,
  author: BUILTIN_AUTHOR,
  reviewed: true,
  draft: false,
};

interface CacheEntry {
  mtime: number;
  skill: Skill;
}

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: normalized };
  const meta: Record<string, string> = {};
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    meta[key] = value;
  }
  return { meta, body: match[2] };
}

export function renderFrontmatter(meta: Record<string, string | boolean | undefined>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === "") continue;
    const text = typeof value === "boolean" ? String(value) : /[:#"'\n]/.test(value) ? JSON.stringify(value) : value;
    lines.push(`${key}: ${text}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function listExtraFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name !== SKILL_FILE)
      .map((d) => join(dir, d.name))
      .sort();
  } catch {
    return [];
  }
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "yes") return true;
  if (v === "false" || v === "no") return false;
  return fallback;
}

export interface SkillInvocation {
  name: string;
  args: string;
}

export function parseSkillInvocation(text: string): SkillInvocation | null {
  const match = text.match(/^(?:@[\p{L}\p{N}][\p{L}\p{N}_-]*\s+)*\/([A-Za-z0-9][A-Za-z0-9_-]{0,31})(?:\s+([\s\S]*))?$/u);
  if (!match) return null;
  return { name: match[1], args: (match[2] ?? "").trim() };
}

export function renderSkillBody(body: string, args: string): string {
  const trimmedArgs = args.trim();
  return body
    .replace(/\\\$ARGUMENTS|\$ARGUMENTS/g, (m) => (m.startsWith("\\") ? "$ARGUMENTS" : trimmedArgs))
    .replace(/\r\n/g, "\n")
    .trim();
}

export function isBuiltinSkill(name: string): boolean {
  return name.trim().toLowerCase() === SKILL_WRITER.name;
}

export class SkillLibrary {
  readonly dir: string;
  private readonly log: Logger;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(dir: string, log: Logger) {
    this.dir = resolve(dir);
    this.log = log;
    mkdirSync(this.dir, { recursive: true });
  }

  list(): SkillMeta[] {
    const out: SkillMeta[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(this.dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      this.log.warn(`skills folder unreadable: ${String(error)}`);
      return out;
    }
    const seen = new Set<string>();
    for (const folder of entries) {
      const skill = this.load(folder);
      if (!skill) continue;
      seen.add(folder);
      const { body: _body, ...meta } = skill;
      out.push(meta);
    }
    for (const key of [...this.cache.keys()]) if (!seen.has(key)) this.cache.delete(key);
    return out;
  }

  get(name: string): Skill | undefined {
    if (!SKILL_NAME_PATTERN.test(name)) return undefined;
    const folder = this.folderFor(name);
    return folder ? this.load(folder) : undefined;
  }

  lint(draft: SkillDraft): LintResult {
    return lintSkill({ name: draft.name, description: draft.description, argumentHint: draft.argumentHint, body: draft.body });
  }

  save(draft: SkillDraft): Skill {
    const name = draft.name.trim();
    if (isBuiltinSkill(name) && draft.author !== BUILTIN_AUTHOR) throw new Error(`${name} is built into viberoom and read-only; create your own skill instead`);
    const description = draft.description.trim();
    const body = draft.body.replace(/\r\n/g, "\n").trim();
    const lint = this.lint({ ...draft, name, description, body });
    if (lint.errors.length) throw new Error(lint.errors.map((e) => e.message).join("; "));
    const existingFolder = this.folderFor(name);
    const existing = existingFolder ? this.load(existingFolder) : undefined;
    const folder = existingFolder ?? name;
    const dir = join(this.dir, folder);
    mkdirSync(dir, { recursive: true });
    const author = draft.author ?? existing?.author ?? HUMAN_AUTHOR;
    const created = existing?.created || new Date().toISOString();
    const reviewed = draft.reviewed ?? (author === HUMAN_AUTHOR || author === BUILTIN_AUTHOR ? true : (existing?.reviewed ?? false));
    const isDraft = draft.draft ?? (existing?.draft ?? false);
    const text = `${renderFrontmatter({
      name,
      description,
      "argument-hint": draft.argumentHint?.trim() || undefined,
      "user-invocable": draft.userInvocable === false ? false : undefined,
      "disable-agent-invocation": draft.agentInvocable === false ? true : undefined,
      author: author === HUMAN_AUTHOR ? undefined : author,
      created,
      reviewed: reviewed ? undefined : false,
      draft: isDraft ? true : undefined,
    })}\n\n${body}\n`;
    writeFileSync(join(dir, SKILL_FILE), text);
    this.cache.delete(folder);
    const skill = this.load(folder);
    if (!skill) throw new Error("the skill could not be read back");
    this.log.info(`skill "${name}" saved (${skill.file}; author ${author}${isDraft ? "; draft" : ""})`);
    return skill;
  }

  approve(name: string): Skill {
    const skill = this.get(name);
    if (!skill) throw new Error(`no such skill: ${name}`);
    return this.save({
      name: skill.name,
      description: skill.description,
      argumentHint: skill.argumentHint,
      body: skill.body,
      userInvocable: skill.userInvocable,
      agentInvocable: skill.agentInvocable,
      author: skill.author,
      reviewed: true,
      draft: false,
    });
  }

  seedBuiltins(): void {
    for (const builtin of [SKILL_WRITER]) {
      const folder = this.folderFor(builtin.name);
      const current = folder ? this.load(folder) : undefined;
      if (current && current.description === builtin.description && current.body === builtin.body && (current.argumentHint ?? "") === (builtin.argumentHint ?? "")) continue;
      this.save(builtin);
      if (current) this.log.info(`built-in skill "${builtin.name}" updated to the shipped text`);
    }
  }

  remove(name: string): void {
    if (isBuiltinSkill(name)) throw new Error(`${name.trim()} is built into viberoom and cannot be deleted; detach it from a vibemate if it should not use it`);
    const folder = this.folderFor(name);
    if (!folder) throw new Error(`no such skill: ${name}`);
    rmSync(join(this.dir, folder), { recursive: true, force: true });
    this.cache.delete(folder);
    this.log.info(`skill "${name}" removed`);
  }

  private folderFor(name: string): string | null {
    if (existsSync(join(this.dir, name, SKILL_FILE))) return name;
    const lower = name.toLowerCase();
    try {
      for (const d of readdirSync(this.dir, { withFileTypes: true })) {
        if (d.isDirectory() && d.name.toLowerCase() === lower && existsSync(join(this.dir, d.name, SKILL_FILE))) return d.name;
      }
    } catch {
    }
    return null;
  }

  private load(folder: string): Skill | undefined {
    const dir = join(this.dir, folder);
    const file = join(dir, SKILL_FILE);
    let mtime: number;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      return undefined;
    }
    const cached = this.cache.get(folder);
    if (cached && cached.mtime === mtime) {
      cached.skill.extraFiles = listExtraFiles(dir);
      return cached.skill;
    }
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      this.log.warn(`skill ${folder}: unreadable (${String(error)})`);
      return undefined;
    }
    const { meta, body } = parseFrontmatter(text);
    const name = (meta.name ?? folder).trim();
    const description = (meta.description ?? "").trim();
    const argumentHint = (meta["argument-hint"] ?? "").trim();
    const lint = lintSkill({
      name,
      folder,
      description,
      argumentHint,
      body,
      unknownFields: Object.keys(meta).filter((k) => !KNOWN_FIELDS.has(k)),
    });
    const extraFiles = listExtraFiles(dir);
    const author = (meta.author ?? "").trim() || HUMAN_AUTHOR;
    const skill: Skill = {
      name,
      description: description.slice(0, DESCRIPTION_MAX),
      argumentHint,
      userInvocable: parseBool(meta["user-invocable"], true),
      agentInvocable: !parseBool(meta["disable-agent-invocation"], false),
      author,
      created: (meta.created ?? "").trim(),
      reviewed: parseBool(meta.reviewed, true),
      draft: parseBool(meta.draft, false),
      dir,
      file,
      extraFiles,
      mtime,
      problems: lint.errors.map((e) => e.message),
      warnings: lint.warnings.map((w) => w.message),
      body: body.replace(/\r\n/g, "\n").trim(),
    };
    this.cache.set(folder, { mtime, skill });
    return skill;
  }
}
