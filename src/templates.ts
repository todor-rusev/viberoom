// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
}

export interface RoomTemplate {
  id: string;
  name: string;
  description: string;
  order?: number;
  emoji?: string;
  recommended?: boolean;
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
    return out;
  });
  const settings = (t.settings && typeof t.settings === "object" ? t.settings : {}) as Partial<RoomSettings>;
  const out: RoomTemplate = { id, name, description: String(t.description ?? "").trim(), settings, vibemates };
  if (typeof t.order === "number" && Number.isFinite(t.order)) out.order = t.order;
  if (typeof t.emoji === "string" && t.emoji.trim()) out.emoji = t.emoji.trim().slice(0, 8);
  if (t.recommended === true) out.recommended = true;
  return out;
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
  return out.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));
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
    return [...readTemplates(this.shippedDir, this.log, true).filter((t) => !taken.has(t.id)), ...own];
  }

  get(id: string): RoomTemplate | undefined {
    return this.list().find((t) => t.id === id);
  }
}
