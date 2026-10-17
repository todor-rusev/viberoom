// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { cleanFace } from "../faces.js";
import { KEEP_AWAKE, KEEP_AWAKE_DEFAULT, type KeepAwake } from "../keep-awake.js";
import type { TranscriptMode } from "../log.js";
import { legacyRecallAcrossRooms } from "../memory/config.js";
import { DEFAULT_EDITOR_SETTINGS, type EditorSettings } from "../open.js";
import { upgradeRoomSettings, type RoomSettings } from "../persona.js";

export const TRANSCRIPT_MODES: readonly TranscriptMode[] = ["off", "errors", "full"];
export const WHEEL_STEP_DEFAULT = 20, WHEEL_STEP_MIN = 5, WHEEL_STEP_MAX = 60;

export interface VendorPreset {
  model: string | null;
  effort: string | null;
  mode: string | null;
}

export interface ProgramSettings {
  humanName: string;
  humanDescription: string;
  humanAvatar: string;
  bypassPermissionsByDefault: boolean;
  profileCompleted: boolean;
  agentSkillsNeedApproval: boolean;
  roomDefaults: Partial<Omit<RoomSettings, "name" | "humanName">>;
  vendorPresets: Record<string, VendorPreset>;
  diagrams: DiagramSettings;
  editor: EditorSettings;
  appearance: AppearanceSettings;
  showMoreOnClick: boolean;
  wheelStepPercent: number;
  wheelInertia: boolean;
  notifyReplies: "every" | "to-me" | "off";
  appBadge: boolean;
  keepAwake: KeepAwake;
  devShowPrompts: boolean;
  devShowMemoryIngestion: boolean;
  checkForUpdates: boolean;
  checkAgentUpdates: boolean;
  transcripts: TranscriptMode;
  foldAfter: number;
  reconnectMode: "replay" | "load";
}

export interface AppearanceSettings {
  chatFontSize: number;
  scale: number;
  font: string;
  mono: string;
  look: string;
  custom: Record<string, Partial<Record<Adjustable, string>>>;
}
export type Adjustable = "canvas" | "panel" | "bubble" | "mine" | "ring" | "ink" | "muted" | "accent" | "face" | "logo" | "logoInk" | "corners";
export const ADJUSTABLE: Record<Adjustable, "colour" | "scale"> = {
  canvas: "colour", panel: "colour", bubble: "colour", mine: "colour", ring: "colour", ink: "colour", muted: "colour", accent: "colour",
  face: "colour", logo: "colour", logoInk: "colour", corners: "scale",
};
export const TEXT_FONTS = ["nunito", "inter", "noto-sans", "open-sans", "source-sans-3", "ibm-plex-sans", "manrope", "rubik", "montserrat", "golos-text", "exo-2", "comfortaa", "ubuntu-sans", "arial", "system"];
export const MONO_FONTS = ["jetbrains-mono", "fira-code", "source-code-pro", "ibm-plex-mono", "pt-mono", "victor-mono", "anonymous-pro", "cascadia-code", "system"];
export const DEFAULT_APPEARANCE: AppearanceSettings = { chatFontSize: 14.5, scale: 100, font: "nunito", mono: "jetbrains-mono", look: "classic", custom: {} };

export interface DiagramSettings {
  preset: DiagramPreset;
  primary: string | null;
}

export type DiagramPreset = "pop" | "lavender" | "mint" | "sunset" | "slate";
export const DIAGRAM_PRESETS: DiagramPreset[] = ["pop", "lavender", "mint", "sunset", "slate"];

export function nextAppearance(current: AppearanceSettings, a: Record<string, unknown>): AppearanceSettings {
  const chatFontSize = Number(a.chatFontSize ?? current.chatFontSize ?? DEFAULT_APPEARANCE.chatFontSize);
  if (!Number.isFinite(chatFontSize) || chatFontSize < 12 || chatFontSize > 32) throw new Error("appearance.chatFontSize must be between 12 and 32");
  const scale = Number(a.scale ?? current.scale ?? DEFAULT_APPEARANCE.scale);
  if (!Number.isFinite(scale) || scale < 70 || scale > 150) throw new Error("appearance.scale must be between 70 and 150 (per cent)");
  const font = String(a.font ?? current.font ?? DEFAULT_APPEARANCE.font);
  if (!TEXT_FONTS.includes(font)) throw new Error(`appearance.font must be one of ${TEXT_FONTS.join(", ")}`);
  const mono = String(a.mono ?? current.mono ?? DEFAULT_APPEARANCE.mono);
  if (!MONO_FONTS.includes(mono)) throw new Error(`appearance.mono must be one of ${MONO_FONTS.join(", ")}`);
  const look = String(a.look ?? current.look ?? DEFAULT_APPEARANCE.look);
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(look)) throw new Error("appearance.look must be a short lower-case id");
  const custom: Record<string, Partial<Record<Adjustable, string>>> = { ...(current.custom ?? {}) };
  if (a.custom !== undefined && typeof a.custom === "object" && a.custom) {
    for (const [lookId, values] of Object.entries(a.custom as Record<string, unknown>)) {
      if (!/^[a-z][a-z0-9-]{0,30}$/.test(lookId)) throw new Error("appearance.custom: a look id is a short lower-case id");
      if (values === null) {
        delete custom[lookId];
        continue;
      }
      if (typeof values !== "object") throw new Error("appearance.custom: each look takes an object of adjustments");
      const clean: Partial<Record<Adjustable, string>> = {};
      for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
        const kind = (ADJUSTABLE as Record<string, string | undefined>)[key];
        if (!kind) throw new Error(`appearance.custom: "${key}" is not adjustable (${Object.keys(ADJUSTABLE).join(", ")})`);
        if (kind === "colour") {
          if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`appearance.custom.${key} must be a colour like #1a2b3c`);
          clean[key as Adjustable] = value.toLowerCase();
        } else {
          const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
          if (!Number.isFinite(n) || n < 0 || n > 2) throw new Error(`appearance.custom.${key} must be a number between 0 and 2`);
          clean[key as Adjustable] = String(Math.round(n * 100) / 100);
        }
      }
      if (Object.keys(clean).length) custom[lookId] = clean;
      else delete custom[lookId];
    }
  }
  return { chatFontSize: Math.round(chatFontSize * 2) / 2, scale: Math.round(scale), font, mono, look, custom };
}

export function defaultProgramSettings(initialHumanName?: string): ProgramSettings {
  return {
    humanName: initialHumanName ?? "Human",
    humanDescription: "",
    humanAvatar: "",
    bypassPermissionsByDefault: true,
    profileCompleted: !!initialHumanName,
    agentSkillsNeedApproval: false,
    diagrams: { preset: "pop", primary: null },
    editor: { ...DEFAULT_EDITOR_SETTINGS },
    appearance: { ...DEFAULT_APPEARANCE },
    showMoreOnClick: true,
    wheelStepPercent: WHEEL_STEP_DEFAULT,
    wheelInertia: false,
    notifyReplies: "every",
    appBadge: true,
    keepAwake: KEEP_AWAKE_DEFAULT,
    devShowPrompts: false,
    devShowMemoryIngestion: false,
    checkForUpdates: true,
    checkAgentUpdates: true,
    transcripts: "off",
    foldAfter: 1200,
    reconnectMode: "replay",
    roomDefaults: {},
    vendorPresets: {},
  };
}

export function nextProgramSettings(current: ProgramSettings, patch: Record<string, unknown>): ProgramSettings {
  const next: ProgramSettings = { ...current, roomDefaults: { ...current.roomDefaults }, vendorPresets: { ...current.vendorPresets } };
  if (patch.humanName !== undefined) {
    const name = String(patch.humanName).trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,23}$/u.test(name)) throw new Error("humanName must be 1-24 letters, digits, _ or - (no spaces)");
    next.humanName = name;
  }
  if (patch.humanDescription !== undefined) next.humanDescription = String(patch.humanDescription).slice(0, 200);
  if (patch.humanAvatar !== undefined) next.humanAvatar = cleanFace(String(patch.humanAvatar), "vibemate");
  if (patch.bypassPermissionsByDefault !== undefined) next.bypassPermissionsByDefault = patch.bypassPermissionsByDefault === true || patch.bypassPermissionsByDefault === "true";
  if (patch.profileCompleted !== undefined) next.profileCompleted = patch.profileCompleted === true || patch.profileCompleted === "true";
  if (patch.agentSkillsNeedApproval !== undefined) next.agentSkillsNeedApproval = patch.agentSkillsNeedApproval === true || patch.agentSkillsNeedApproval === "true";
  if (patch.showMoreOnClick !== undefined) next.showMoreOnClick = patch.showMoreOnClick === true || patch.showMoreOnClick === "true";
  if (patch.wheelStepPercent !== undefined) {
    const step = Number(patch.wheelStepPercent);
    if (!Number.isFinite(step)) throw new Error("wheelStepPercent must be a number");
    next.wheelStepPercent = Math.round(Math.min(WHEEL_STEP_MAX, Math.max(WHEEL_STEP_MIN, step)));
  }
  if (patch.wheelInertia !== undefined) next.wheelInertia = patch.wheelInertia === true || patch.wheelInertia === "true";
  if (patch.notifyReplies !== undefined) {
    if (patch.notifyReplies !== "every" && patch.notifyReplies !== "to-me" && patch.notifyReplies !== "off") throw new Error("notifyReplies must be every, to-me or off");
    next.notifyReplies = patch.notifyReplies;
  }
  if (patch.appBadge !== undefined) next.appBadge = patch.appBadge === true || patch.appBadge === "true";
  if (patch.keepAwake !== undefined) {
    if (!KEEP_AWAKE.includes(patch.keepAwake as KeepAwake)) throw new Error(`keepAwake must be ${KEEP_AWAKE.join(", ")}`);
    next.keepAwake = patch.keepAwake as KeepAwake;
  }
  if (patch.devShowPrompts !== undefined) next.devShowPrompts = patch.devShowPrompts === true || patch.devShowPrompts === "true";
  if (patch.devShowMemoryIngestion !== undefined) next.devShowMemoryIngestion = patch.devShowMemoryIngestion === true || patch.devShowMemoryIngestion === "true";
  if (patch.checkForUpdates !== undefined) next.checkForUpdates = patch.checkForUpdates === true || patch.checkForUpdates === "true";
  if (patch.checkAgentUpdates !== undefined) next.checkAgentUpdates = patch.checkAgentUpdates === true || patch.checkAgentUpdates === "true";
  if (patch.transcripts !== undefined) {
    const mode = String(patch.transcripts);
    if (!TRANSCRIPT_MODES.includes(mode as TranscriptMode)) throw new Error(`transcripts must be one of ${TRANSCRIPT_MODES.join(", ")}`);
    next.transcripts = mode as TranscriptMode;
  }
  if (patch.foldAfter !== undefined) {
    const n = Number(patch.foldAfter);
    if (!Number.isInteger(n) || n < 100 || n > 20_000) throw new Error("foldAfter must be an integer between 100 and 20000");
    next.foldAfter = n;
  }
  if (patch.diagrams !== undefined && typeof patch.diagrams === "object" && patch.diagrams) {
    const d = patch.diagrams as Record<string, unknown>;
    const preset = String(d.preset ?? next.diagrams?.preset ?? "pop") as DiagramPreset;
    if (!DIAGRAM_PRESETS.includes(preset)) throw new Error(`diagrams.preset must be one of ${DIAGRAM_PRESETS.join(", ")}`);
    let primary: string | null = next.diagrams?.primary ?? null;
    if (d.primary !== undefined) {
      primary = d.primary === null || d.primary === "" ? null : String(d.primary).trim().toLowerCase();
      if (primary !== null && !/^#[0-9a-f]{6}$/.test(primary)) throw new Error("diagrams.primary must be a #rrggbb colour or empty");
    }
    next.diagrams = { preset, primary };
  }
  if (!next.diagrams) next.diagrams = { preset: "pop", primary: null };
  if (patch.reconnectMode !== undefined) {
    const mode = String(patch.reconnectMode);
    if (mode !== "replay" && mode !== "load") throw new Error("reconnectMode must be replay or load");
    next.reconnectMode = mode;
  }
  if (next.reconnectMode !== "load") next.reconnectMode = "replay";
  if (patch.editor !== undefined && typeof patch.editor === "object" && patch.editor) {
    const e = patch.editor as Record<string, unknown>;
    const mode = String(e.mode ?? next.editor?.mode ?? "auto");
    if (mode !== "auto" && mode !== "default-app" && mode !== "custom") throw new Error("editor.mode must be auto, default-app or custom");
    const command = String(e.command ?? next.editor?.command ?? "").trim().slice(0, 500);
    if (mode === "custom" && !command.includes("{file}")) throw new Error("editor.command must mention {file} (and usually {line})");
    next.editor = { mode, command };
  }
  if (patch.appearance !== undefined && typeof patch.appearance === "object" && patch.appearance) {
    next.appearance = nextAppearance(next.appearance, patch.appearance as Record<string, unknown>);
  }
  next.appearance = { ...DEFAULT_APPEARANCE, ...(next.appearance ?? {}) };
  if (!next.editor) next.editor = { ...DEFAULT_EDITOR_SETTINGS };
  if (patch.roomDefaults !== undefined && typeof patch.roomDefaults === "object" && patch.roomDefaults) {
    next.roomDefaults = { ...next.roomDefaults, ...(patch.roomDefaults as Record<string, unknown>) } as ProgramSettings["roomDefaults"];
  }
  if (patch.vendorPresets !== undefined && typeof patch.vendorPresets === "object" && patch.vendorPresets) {
    for (const [vendor, preset] of Object.entries(patch.vendorPresets as Record<string, Partial<VendorPreset>>)) {
      next.vendorPresets[vendor] = {
        model: preset?.model ?? null,
        effort: preset?.effort ?? null,
        mode: preset?.mode ?? null,
      };
    }
  }
  return next;
}

function writeJson(path: string, value: unknown): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2));
}

export interface ProgramSettingsPorts {
  dataDir: string;
  log: { warn(text: string): void };
}

export class ProgramSettingsFile {
  #current: ProgramSettings;
  #revision = 0;
  #disposed = false;

  constructor(private readonly ports: ProgramSettingsPorts, initialHumanName?: string) {
    this.#current = this.load(initialHumanName);
  }

  get current(): ProgramSettings { return this.#current; }

  get revision(): number { return this.#revision; }

  holds(revision: number): boolean {
    return !this.#disposed && this.#revision === revision;
  }

  get ended(): boolean { return this.#disposed; }

  private get path(): string {
    return join(this.ports.dataDir, "settings.json");
  }

  commit(patch: Record<string, unknown>): { settings: ProgramSettings; revision: number } {
    if (this.#disposed) throw new Error("viberoom is shutting down; the settings are not changed now");
    const next = nextProgramSettings(this.#current, patch);
    writeJson(this.path, next);
    this.#current = next;
    return { settings: next, revision: ++this.#revision };
  }

  reset(): void {
    rmSync(this.path, { force: true });
    this.#current = this.load();
    this.#revision++;
  }

  dispose(): void {
    this.#disposed = true;
  }

  private load(initialHumanName?: string): ProgramSettings {
    const defaults = defaultProgramSettings(initialHumanName);
    if (!existsSync(this.path)) {
      writeJson(this.path, defaults);
      return defaults;
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Partial<ProgramSettings>;
      const loaded = { ...defaults, ...raw, roomDefaults: raw.roomDefaults ?? {}, vendorPresets: raw.vendorPresets ?? {} };
      const roomDefaults = this.upgradeRoomDefaults(loaded.roomDefaults);
      if (roomDefaults === loaded.roomDefaults) return loaded;
      const upgraded = { ...loaded, roomDefaults };
      writeJson(this.path, upgraded);
      return upgraded;
    } catch (error) {
      this.ports.log.warn(`settings.json unreadable (${String(error)}); using defaults`);
      return defaults;
    }
  }

  private upgradeRoomDefaults(raw: ProgramSettings["roomDefaults"]): ProgramSettings["roomDefaults"] {
    const upgraded = upgradeRoomSettings(raw);
    if (upgraded.readsOtherRooms !== undefined || upgraded.sharesHistory === false || !legacyRecallAcrossRooms(join(this.ports.dataDir, "memory.json"))) return upgraded;
    return { ...upgraded, readsOtherRooms: "every-turn" };
  }

  saveWindowPlacement(report: Record<string, unknown>): void {
    const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (!num(report.left) || !num(report.top) || !num(report.width) || !num(report.height)) throw new Error("left, top, width and height must be numbers");
    const screen = report.screen as Record<string, unknown> | undefined;
    const record: Record<string, unknown> = {
      left: Math.round(report.left),
      top: Math.round(report.top),
      width: Math.round(report.width),
      height: Math.round(report.height),
      maximized: !!report.maximized,
      savedAt: new Date().toISOString(),
    };
    if (screen && num(screen.left) && num(screen.top) && num(screen.width) && num(screen.height)) {
      record.screen = { left: Math.round(screen.left), top: Math.round(screen.top), width: Math.round(screen.width), height: Math.round(screen.height) };
    }
    writeJson(join(this.ports.dataDir, "window.json"), record);
  }
}
