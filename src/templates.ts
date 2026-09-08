// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.js";
import { fileURLToPath } from "node:url";
import type { Logger } from "./log.js";
import type { RoomSettings } from "./persona.js";

export interface TemplateVibemate {
  name: string;
  tagline?: string;
  role?: string;
  avatar?: string;
  skills?: string[];
  agentType?: string;
  model?: string;
  effort?: string;
  mode?: string;
  replyDelay?: number;
}

export interface RoomTemplate {
  id: string;
  name: string;
  description: string;
  order?: number;
  emoji?: string;
  recommended?: boolean;
  dir?: string;
  created?: string;
  settings: Partial<RoomSettings>;
  vibemates: TemplateVibemate[];
  builtin?: boolean;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const SHIPPED_TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

export function cleanTemplate(raw: unknown, id: string): RoomTemplate {
  const t = (raw ?? {}) as Record<string, unknown>;
  const name = String(t.name ?? "").trim();
  if (!name) throw new Error("name is required");
  const list = Array.isArray(t.vibemates) ? t.vibemates : [];
  const vibemates: TemplateVibemate[] = list.map((v, i) => {
    const o = (v ?? {}) as Record<string, unknown>;
    const vname = String(o.name ?? "").trim();
    if (!vname) throw new Error(`vibemate ${i + 1} has no name`);
    const out: TemplateVibemate = { name: vname };
    for (const key of ["tagline", "role", "avatar", "agentType", "model", "effort", "mode"] as const) {
      if (typeof o[key] === "string" && (o[key] as string).trim()) out[key] = (o[key] as string).trim();
    }
    if (Array.isArray(o.skills)) out.skills = o.skills.map((s) => String(s).trim()).filter(Boolean);
    if (typeof o.replyDelay === "number" && Number.isFinite(o.replyDelay)) out.replyDelay = o.replyDelay;
    return out;
  });
  const settings = (t.settings && typeof t.settings === "object" ? t.settings : {}) as Partial<RoomSettings>;
  const out: RoomTemplate = { id, name, description: String(t.description ?? "").trim(), settings, vibemates };
  if (typeof t.order === "number" && Number.isFinite(t.order)) out.order = t.order;
  if (typeof t.emoji === "string" && t.emoji.trim()) out.emoji = t.emoji.trim().slice(0, 8);
  if (t.recommended === true) out.recommended = true;
  if (typeof t.dir === "string" && t.dir.trim()) out.dir = t.dir.trim();
  if (typeof t.created === "string" && t.created.trim()) out.created = t.created.trim();
  return out;
}

export function roomSettingsFromTemplate(template: RoomTemplate): Partial<RoomSettings> {
  const settings: Partial<RoomSettings> = { ...template.settings };
  if (!settings.emoji && template.emoji) settings.emoji = template.emoji;
  return settings;
}

export function templateId(name: string): string {
  const id = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return ID_PATTERN.test(id) ? id : "template";
}

function readTemplates(dir: string, log: Logger, builtin: boolean): RoomTemplate[] {
  const out: RoomTemplate[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
    const file = join(dir, entry.name, "template.json");
    if (!existsSync(file)) continue;
    try {
      const t = cleanTemplate(JSON.parse(readFileSync(file, "utf8")), entry.name);
      if (builtin) t.builtin = true;
      out.push(t);
    } catch (error) {
      log.warn(`template ${entry.name} in ${dir} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || (b.created ?? "").localeCompare(a.created ?? "") || a.name.localeCompare(b.name));
}

export class TemplateLibrary {
  constructor(
    readonly dir: string,
    private readonly log: Logger,
    private readonly shippedDir: string = SHIPPED_TEMPLATES_DIR,
  ) {}

  list(): RoomTemplate[] {
    const own = readTemplates(this.dir, this.log, false);
    const taken = new Set(own.map((t) => t.id));
    return [...own, ...readTemplates(this.shippedDir, this.log, true).filter((t) => !taken.has(t.id))];
  }

  get(id: string): RoomTemplate | undefined {
    return this.list().find((t) => t.id === id);
  }

  save(template: Omit<RoomTemplate, "id" | "builtin">): RoomTemplate {
    const taken = new Set(this.list().map((t) => t.id));
    const base = templateId(template.name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 40 - String(n).length - 1)}-${n}`;
    const clean = cleanTemplate({ ...template, created: new Date().toISOString() }, id);
    const folder = join(this.dir, id);
    mkdirSync(folder, { recursive: true });
    writeFileAtomic(join(folder, "template.json"), JSON.stringify(clean, null, 2) + "\n");
    this.log.info(`saved template "${clean.name}" (${id})`);
    return clean;
  }

  overwrite(id: string, template: Omit<RoomTemplate, "id" | "builtin">): RoomTemplate {
    if (!ID_PATTERN.test(id)) throw new Error(`bad template id "${id}"`);
    const own = readTemplates(this.dir, this.log, false).find((t) => t.id === id);
    if (!own) throw new Error(`no own template "${id}" to overwrite`);
    const clean = cleanTemplate({ ...template, created: own.created ?? new Date().toISOString() }, id);
    writeFileAtomic(join(this.dir, id, "template.json"), `${JSON.stringify(clean, null, 2)}\n`);
    this.log.info(`overwrote template "${clean.name}" (${id})`);
    return clean;
  }
}
