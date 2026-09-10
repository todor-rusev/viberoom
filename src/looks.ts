// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileAtomic } from "./atomic.js";
import type { Logger } from "./log.js";
import { lintLook, type LookData, type LookLintResult } from "./look-lint.js";

export const LOOK_ID = /^[a-z][a-z0-9-]{0,30}$/;
export const DEFAULT_BASE = "classic";

export interface LookSpec {
  id: string;
  label: string;
  scheme?: "light" | "dark";
  extends?: string;
  author?: string;
  created?: string;
  updatedAt?: string;
  palette?: Record<string, string>;
  shape?: Record<string, string>;
  type?: Record<string, string>;
  motion?: Record<string, string>;
  elevation?: Record<string, string>;
  canvas?: Record<string, string>;
  elements?: Record<string, Record<string, string>>;
}

const SPEC_SECTIONS = ["palette", "shape", "type", "motion", "elevation", "canvas"] as const;

export interface BuiltLook extends LookData {
  custom: boolean;
  extends: string;
  author: string;
}

export interface LookTokens {
  looks: Record<string, LookData & { custom?: boolean }>;
  adjustables: { key: string; group: string; label: string; hint?: string; kind: "colour" | "scale"; min?: number; max?: number; step?: number; of: (look: LookData) => string }[];
  make: (spec: Record<string, unknown>) => BuiltLook;
  cssGroups: (look: LookData) => { title: string; entries: [string, string][] }[];
  describe: () => Record<string, unknown>;
  fonts: { text: Record<string, { label: string; stack: string }>; mono: Record<string, { label: string; stack: string }> };
}

let tokensPromise: Promise<LookTokens> | null = null;
export function loadTokens(): Promise<LookTokens> {
  if (!tokensPromise) {
    const file = fileURLToPath(new URL("../ui/tokens.js", import.meta.url));
    tokensPromise = import(pathToFileURL(file).href).then(() => {
      const tokens = (globalThis as { VIBEROOM_TOKENS?: LookTokens }).VIBEROOM_TOKENS;
      if (!tokens) throw new Error("ui/tokens.js did not register VIBEROOM_TOKENS");
      return tokens;
    });
  }
  return tokensPromise;
}

export function cleanLookSpec(raw: unknown): LookSpec {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: LookSpec = { id: String(r.id ?? "").trim().toLowerCase(), label: String(r.label ?? "").trim() };
  if (typeof r.scheme === "string" && r.scheme.trim()) out.scheme = r.scheme.trim() as LookSpec["scheme"];
  if (typeof r.extends === "string" && r.extends.trim()) out.extends = r.extends.trim();
  if (typeof r.author === "string" && r.author.trim()) out.author = r.author.trim().slice(0, 40);
  if (typeof r.created === "string" && r.created.trim()) out.created = r.created.trim();
  if (typeof r.updatedAt === "string" && r.updatedAt.trim()) out.updatedAt = r.updatedAt.trim();
  const flat = (v: unknown): Record<string, string> | undefined => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const o: Record<string, string> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "string") o[k] = x;
    return Object.keys(o).length ? o : undefined;
  };
  for (const section of SPEC_SECTIONS) {
    const v = flat(r[section]);
    if (v) out[section] = v;
  }
  if (r.elements && typeof r.elements === "object" && !Array.isArray(r.elements)) {
    const groups: Record<string, Record<string, string>> = {};
    for (const [group, parts] of Object.entries(r.elements as Record<string, unknown>)) {
      const v = flat(parts);
      if (v) groups[group] = v;
    }
    if (Object.keys(groups).length) out.elements = groups;
  }
  return out;
}

export interface LookCheck {
  spec: LookSpec;
  look: BuiltLook;
  lint: LookLintResult;
}

export async function checkLookSpec(raw: unknown): Promise<LookCheck> {
  const tokens = await loadTokens();
  const spec = cleanLookSpec(raw);
  const look = tokens.make(spec as unknown as Record<string, unknown>);
  return { spec, look, lint: lintLook(look) };
}

export class LookLibrary {
  constructor(
    readonly dir: string,
    private readonly log: Logger,
  ) {}

  list(): LookSpec[] {
    const out: LookSpec[] = [];
    if (!existsSync(this.dir)) return out;
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      if (!LOOK_ID.test(id)) continue;
      try {
        const spec = cleanLookSpec(JSON.parse(readFileSync(join(this.dir, entry.name), "utf8")));
        if (spec.id !== id) throw new Error(`the file says id "${spec.id}"`);
        out.push(spec);
      } catch (error) {
        this.log.warn(`look ${id} skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return out.sort((a, b) => (a.created ?? "").localeCompare(b.created ?? "") || a.label.localeCompare(b.label));
  }

  get(id: string): LookSpec | undefined {
    return this.list().find((l) => l.id === id);
  }

  async save(raw: unknown, options: { author: string; replace?: boolean }): Promise<LookCheck> {
    const checked = await checkLookSpec({ ...(raw as Record<string, unknown>), author: options.author });
    if (!checked.lint.ok) throw new Error(`the look does not read: ${checked.lint.errors.map((e) => e.message).join("; ")}`);
    const existing = this.get(checked.spec.id);
    if (existing && !options.replace) throw new Error(`a look "${checked.spec.id}" exists already; say replace to overwrite it`);
    const now = new Date().toISOString();
    const spec: LookSpec = { ...checked.spec, author: options.author, created: existing?.created ?? now, updatedAt: now };
    mkdirSync(this.dir, { recursive: true });
    writeFileAtomic(join(this.dir, `${spec.id}.json`), `${JSON.stringify(spec, null, 2)}\n`);
    this.log.info(`${existing ? "replaced" : "saved"} look "${spec.label}" (${spec.id}) by ${options.author}`);
    return { ...checked, spec };
  }

  remove(id: string): boolean {
    if (!LOOK_ID.test(id)) return false;
    const file = join(this.dir, `${id}.json`);
    if (!existsSync(file)) return false;
    rmSync(file, { force: true });
    this.log.info(`removed look ${id}`);
    return true;
  }

  async css(): Promise<string> {
    const tokens = await loadTokens();
    const lines = ["/* the looks of this hub's human (<dataDir>/looks/*.json), generated by the hub; a window picks one with data-look on <html> */"];
    for (const spec of this.list()) {
      let look: BuiltLook;
      try {
        look = tokens.make(spec as unknown as Record<string, unknown>);
      } catch (error) {
        this.log.warn(`look ${spec.id} does not build: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      lines.push(`:root[data-look="${look.id}"] {`);
      for (const group of tokens.cssGroups(look)) {
        lines.push(`  /* ${group.title} */`);
        for (const [name, value] of group.entries) lines.push(`  ${name}: ${value};`);
      }
      lines.push("}");
    }
    return `${lines.join("\n")}\n`;
  }

  async describe(): Promise<Record<string, unknown>> {
    const tokens = await loadTokens();
    const own = this.list().map((l) => ({ id: l.id, label: l.label, scheme: l.scheme ?? null, extends: l.extends ?? DEFAULT_BASE, author: l.author ?? "human", updatedAt: l.updatedAt ?? null }));
    return { ...tokens.describe(), ownLooks: own };
  }
}
