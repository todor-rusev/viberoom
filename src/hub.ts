// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.js";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Logger } from "./log.js";
import { DEFAULT_EDITOR_SETTINGS, type EditorSettings } from "./open.js";
import { listRecipes, type AgentTypeId } from "./recipes.js";
import { DEFAULT_ROOM_SETTINGS, type RoomSettings } from "./persona.js";
import { Room, type DiscoveredOptions, type RoomEvent, type SkillsBridge, type StoredParticipant } from "./room.js";
import { SkillLibrary, type SkillDraft, type SkillMeta } from "./skills.js";
import { TemplateLibrary, roomSettingsFromTemplate, type RoomTemplate } from "./templates.js";
import { LookLibrary, checkLookSpec, loadTokens, type LookCheck, type LookSpec } from "./looks.js";

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
  checkForUpdates: boolean;
  reconnectMode: "replay" | "load";
}

export interface AppearanceSettings {
  chatFontSize: number;
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
export const DEFAULT_APPEARANCE: AppearanceSettings = { chatFontSize: 14.5, font: "nunito", mono: "jetbrains-mono", look: "classic", custom: {} };

export interface DiagramSettings {
  preset: DiagramPreset;
  primary: string | null;
}

export type DiagramPreset = "pop" | "lavender" | "mint" | "sunset" | "slate";
export const DIAGRAM_PRESETS: DiagramPreset[] = ["pop", "lavender", "mint", "sunset", "slate"];

interface StoredRoom {
  id: string;
  name: string;
  dir: string;
  createdAt: number;
  settings: Partial<RoomSettings>;
  participants: StoredParticipant[];
}

interface RoomsFile {
  version: 1;
  rooms: StoredRoom[];
}

import type { UpdateInfo } from "./update.js";

export type HubEvent =
  | { type: "update"; update: UpdateInfo }
  | { type: "room.event"; roomId: string; event: RoomEvent }
  | { type: "room.created"; room: unknown }
  | { type: "room.removed"; roomId: string }
  | { type: "rooms.opened"; roomIds: string[] }
  | { type: "settings"; settings: ProgramSettings }
  | { type: "skills"; skills: SkillMeta[] }
  | { type: "templates" }
  | { type: "looks"; looks: LookSpec[] }
  | { type: "reset" };

interface McpTokenEntry {
  roomId: string;
  participantId: string;
}

const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursorrules"];

export function nextAppearance(current: AppearanceSettings, a: Record<string, unknown>): AppearanceSettings {
  const chatFontSize = Number(a.chatFontSize ?? current.chatFontSize ?? DEFAULT_APPEARANCE.chatFontSize);
  if (!Number.isFinite(chatFontSize) || chatFontSize < 12 || chatFontSize > 24) throw new Error("appearance.chatFontSize must be between 12 and 24");
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
  return { chatFontSize: Math.round(chatFontSize * 2) / 2, font, mono, look, custom };
}

export class Hub extends EventEmitter {
  readonly dataDir: string;
  readonly rooms = new Map<string, Room>();
  readonly skills: SkillLibrary;
  readonly templates: TemplateLibrary;
  readonly looks: LookLibrary;
  settings: ProgramSettings;
  private readonly log: Logger;
  private readonly optionCache = new Map<string, DiscoveredOptions>();
  private readonly mcpTokens = new Map<string, McpTokenEntry>();
  private hubUrl: string | null = null;
  private readonly skillsBridge: SkillsBridge;

  constructor(dataDir: string, log: Logger, initialHumanName?: string) {
    super();
    this.dataDir = resolve(dataDir);
    this.log = log;
    mkdirSync(join(this.dataDir, "rooms"), { recursive: true });
    this.skills = new SkillLibrary(join(this.dataDir, "skills"), log.child("skills"));
    this.templates = new TemplateLibrary(join(this.dataDir, "templates"), log.child("templates"));
    this.looks = new LookLibrary(join(this.dataDir, "looks"), log.child("looks"));
    try {
      this.skills.seedBuiltins();
    } catch (error) {
      log.warn(`built-in skills could not be seeded: ${String(error)}`);
    }
    this.skillsBridge = {
      library: this.skills,
      serverScript: fileURLToPath(new URL("./mcp-skills-server.js", import.meta.url)),
      hubUrl: () => this.hubUrl,
      templates: this.templates,
      templatesChanged: () => this.emit("event", { type: "templates" } satisfies HubEvent),
      looks: {
        list: () => this.looks.list(),
        describe: () => this.looks.describe(),
        check: (raw) => checkLookSpec(raw),
        save: (raw, options) => this.saveLook(raw, options),
      },
      appearance: {
        current: () => ({ ...this.settings.appearance, custom: { ...(this.settings.appearance.custom ?? {}) } }),
        preview: (patch) => nextAppearance(this.settings.appearance, patch),
        apply: (patch) => {
          this.updateSettings({ appearance: patch });
        },
        ownAdjustments: async (lookId) => {
          const tokens = await loadTokens();
          let look = tokens.looks[lookId];
          if (!look) {
            const spec = this.looks.get(lookId);
            if (!spec) return null;
            look = tokens.make(spec as unknown as Record<string, unknown>);
          }
          return { label: look.label, values: Object.fromEntries(tokens.adjustables.map((f) => [f.key, String(f.of(look))])) };
        },
      },
      needApproval: () => this.settings.agentSkillsNeedApproval === true,
      save: (draft) => {
        const { body: _b, ...meta } = this.saveSkillInternal(draft);
        return meta;
      },
      issueToken: (roomId, participantId) => {
        const token = randomBytes(18).toString("base64url");
        this.mcpTokens.set(token, { roomId, participantId });
        return token;
      },
      revokeToken: (token) => {
        this.mcpTokens.delete(token);
      },
    };
    this.settings = this.loadSettings(initialHumanName);
    this.loadRooms();
  }

  setHubUrl(url: string): void {
    this.hubUrl = url.replace(/\/+$/, "");
  }

  resolveMcpToken(token: string): { room: Room; participantId: string } | null {
    const entry = this.mcpTokens.get(token);
    if (!entry) return null;
    const room = this.rooms.get(entry.roomId);
    return room ? { room, participantId: entry.participantId } : null;
  }


  listSkills(): SkillMeta[] {
    return this.skills.list();
  }

  saveSkill(draft: SkillDraft): SkillMeta {
    const { body: _b, ...meta } = this.saveSkillInternal({ ...draft, reviewed: true, draft: false });
    return meta;
  }

  private saveSkillInternal(draft: SkillDraft) {
    const skill = this.skills.save(draft);
    this.skillsChanged(skill.name);
    return skill;
  }

  approveSkill(name: string): SkillMeta {
    const skill = this.skills.approve(name);
    this.skillsChanged(skill.name);
    const { body: _b, ...meta } = skill;
    return meta;
  }

  removeSkill(name: string): void {
    this.skills.remove(name);
    this.skillsChanged(name);
  }

  private skillsChanged(name: string): void {
    for (const room of this.rooms.values()) room.skillChanged(name);
    this.emit("event", { type: "skills", skills: this.skills.list() } satisfies HubEvent);
  }


  private settingsPath(): string {
    return join(this.dataDir, "settings.json");
  }

  private loadSettings(initialHumanName?: string): ProgramSettings {
    const defaults: ProgramSettings = {
      humanName: initialHumanName ?? "Human",
      humanDescription: "",
      humanAvatar: "",
      bypassPermissionsByDefault: true,
      profileCompleted: !!initialHumanName,
      agentSkillsNeedApproval: false,
      diagrams: { preset: "pop", primary: null },
      editor: { ...DEFAULT_EDITOR_SETTINGS },
      appearance: { ...DEFAULT_APPEARANCE },
      checkForUpdates: true,
      reconnectMode: "replay",
      roomDefaults: {},
      vendorPresets: {},
    };
    if (!existsSync(this.settingsPath())) {
      writeJson(this.settingsPath(), defaults);
      return defaults;
    }
    try {
      const raw = JSON.parse(readFileSync(this.settingsPath(), "utf8")) as Partial<ProgramSettings>;
      return { ...defaults, ...raw, roomDefaults: raw.roomDefaults ?? {}, vendorPresets: raw.vendorPresets ?? {} };
    } catch (error) {
      this.log.warn(`settings.json unreadable (${String(error)}); using defaults`);
      return defaults;
    }
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
    writeJson(join(this.dataDir, "window.json"), record);
  }

  updateSettings(patch: Record<string, unknown>): ProgramSettings {
    const next: ProgramSettings = { ...this.settings, roomDefaults: { ...this.settings.roomDefaults }, vendorPresets: { ...this.settings.vendorPresets } };
    if (patch.humanName !== undefined) {
      const name = String(patch.humanName).trim();
      if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,23}$/u.test(name)) throw new Error("humanName must be 1-24 letters, digits, _ or - (no spaces)");
      next.humanName = name;
    }
    if (patch.humanDescription !== undefined) next.humanDescription = String(patch.humanDescription).slice(0, 200);
    if (patch.humanAvatar !== undefined) next.humanAvatar = String(patch.humanAvatar).slice(0, 8);
    if (patch.bypassPermissionsByDefault !== undefined) next.bypassPermissionsByDefault = patch.bypassPermissionsByDefault === true || patch.bypassPermissionsByDefault === "true";
    if (patch.profileCompleted !== undefined) next.profileCompleted = patch.profileCompleted === true || patch.profileCompleted === "true";
    if (patch.agentSkillsNeedApproval !== undefined) next.agentSkillsNeedApproval = patch.agentSkillsNeedApproval === true || patch.agentSkillsNeedApproval === "true";
    if (patch.checkForUpdates !== undefined) next.checkForUpdates = patch.checkForUpdates === true || patch.checkForUpdates === "true";
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
    this.settings = next;
    writeJson(this.settingsPath(), this.settings);
    for (const room of this.rooms.values()) {
      room.applyProgramSettings({
        humanName: next.humanName,
        humanDescription: next.humanDescription,
        bypassPermissionsByDefault: next.bypassPermissionsByDefault,
      });
    }
    this.emit("event", { type: "settings", settings: this.settings } satisfies HubEvent);
    this.saveRooms();
    return this.settings;
  }


  private roomsPath(): string {
    return join(this.dataDir, "rooms.json");
  }

  private loadRooms(): void {
    if (!existsSync(this.roomsPath())) return;
    let file: RoomsFile;
    try {
      file = JSON.parse(readFileSync(this.roomsPath(), "utf8")) as RoomsFile;
    } catch (error) {
      this.log.warn(`rooms.json unreadable (${String(error)}); starting with no rooms`);
      return;
    }
    for (const stored of file.rooms ?? []) {
      try {
        const room = this.instantiate(stored.id, stored.name, stored.dir, stored.settings, stored.createdAt);
        room.restore(stored.participants ?? []);
        this.log.info(`restored room "${stored.name}" (${stored.id}): ${room.messages.length} messages, ${stored.participants?.length ?? 0} participants offline`);
      } catch (error) {
        this.log.error(`could not restore room ${stored.id}: ${String(error)}`);
      }
    }
  }

  saveRooms(): void {
    const file: RoomsFile = {
      version: 1,
      rooms: [...this.rooms.values()].map((room) => room.toStored()),
    };
    writeJson(this.roomsPath(), file);
  }

  private instantiate(id: string, name: string, dir: string, settings: Partial<RoomSettings>, createdAt: number): Room {
    const room = new Room({
      id,
      name,
      dir,
      dataDir: join(this.dataDir, "rooms", id),
      createdAt,
      humanName: this.settings.humanName,
      programHumanDescription: this.settings.humanDescription,
      bypassPermissionsByDefault: this.settings.bypassPermissionsByDefault,
      settings: { ...this.settings.roomDefaults, ...settings },
      log: this.log.child(`room:${id}`),
      optionCache: this.optionCache,
      skills: this.skillsBridge,
    });
    room.on("event", (event: RoomEvent) => {
      this.emit("event", { type: "room.event", roomId: id, event } satisfies HubEvent);
      if (event.type === "participant" || event.type === "participant.removed" || event.type === "room") this.saveRooms();
    });
    this.rooms.set(id, room);
    return room;
  }

  workspaceNotice(dir: string): string | null {
    const found = INSTRUCTION_FILES.filter((f) => existsSync(join(dir, f)));
    if (existsSync(join(dir, ".cursor", "rules"))) found.push(".cursor/rules");
    return found.length ? `The working directory contains ${found.join(", ")}; agents will read these by their own conventions in addition to the room brief.` : null;
  }

  createRoom(input: { name: string; dir?: string | null; settings?: Partial<RoomSettings> }): { room: Room; notices: string[] } {
    const name = input.name.trim();
    if (!name || name.length > 60) throw new Error("room name must be 1-60 characters");
    let id = slugify(name);
    if (!ROOM_ID_PATTERN.test(id)) id = `room-${Date.now().toString(36)}`;
    let candidate = id;
    for (let n = 2; this.rooms.has(candidate); n++) candidate = `${id}-${n}`;
    id = candidate;

    const notices: string[] = [];
    let dir: string;
    if (input.dir && input.dir.trim()) {
      dir = resolve(input.dir.trim());
      if (!existsSync(dir)) throw new Error(`working directory does not exist: ${dir}`);
      const notice = this.workspaceNotice(dir);
      if (notice) notices.push(notice);
    } else {
      dir = join(this.dataDir, "rooms", id, "workspace");
      mkdirSync(dir, { recursive: true });
    }

    const room = this.instantiate(id, name, dir, input.settings ?? {}, Date.now());
    for (const notice of notices) room.postNotice(notice);
    this.saveRooms();
    this.emit("event", { type: "room.created", room: room.snapshot() } satisfies HubEvent);
    this.log.info(`created room "${name}" (${id}) with workspace ${dir}`);
    return { room, notices };
  }

  async createRoomFromTemplate(input: {
    templateId: string;
    name: string;
    dir?: string | null;
    vibemates: { name: string; agentType: string; model?: string | null; effort?: string | null; mode?: string | null }[];
  }): Promise<{ room: Room; notices: string[] }> {
    const template: RoomTemplate | undefined = this.templates.get(input.templateId);
    if (!template) throw new Error(`no such template: ${input.templateId}`);
    const { room, notices } = this.createRoom({ name: input.name, dir: input.dir || template.dir || null, settings: roomSettingsFromTemplate(template) });
    const installed = new Set(listRecipes().filter((r) => !r.unavailableReason).map((r) => r.id));
    for (const [i, tv] of template.vibemates.entries()) {
      const choice = { ...(input.vibemates[i] ?? { name: tv.name, agentType: "" }) };
      if (!choice.agentType && tv.agentType) {
        if (installed.has(tv.agentType as AgentTypeId)) choice.agentType = tv.agentType;
        else notices.push(`${choice.name || tv.name}: the template runs it on ${tv.agentType}, which is not installed here; pick another agent in the roster.`);
      }
      const skills = (tv.skills ?? []).filter((name) => {
        const ok = !!this.skills.get(name);
        if (!ok) notices.push(`${choice.name || tv.name}: skill "${name}" is not in the library; not attached.`);
        return ok;
      });
      if (!choice.agentType) {
        try {
          room.addUnstaffed({ name: choice.name || tv.name, tagline: tv.tagline, role: tv.role, avatar: tv.avatar, skills, textCheck: "notice" });
        } catch (error) {
          notices.push(`${choice.name || tv.name} could not be added: ${error instanceof Error ? error.message : String(error)}`);
        }
        continue;
      }
      try {
        await room.inviteAgent({
          agentType: choice.agentType,
          name: choice.name || tv.name,
          tagline: tv.tagline,
          role: tv.role,
          avatar: tv.avatar,
          skills,
          replyDelay: tv.replyDelay,
          model: choice.model ?? tv.model,
          effort: choice.effort ?? tv.effort,
          mode: choice.mode ?? tv.mode,
          textCheck: "notice",
        });
      } catch (error) {
        notices.push(`${choice.name || tv.name} could not be summoned: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (room.settings.customRules.length > room.settings.briefTextLimit) notices.push(`The room rules from the template are ${room.settings.customRules.length} characters, over this room's limit of ${room.settings.briefTextLimit}; kept as they are, but the next edit has to fit.`);
    this.saveRooms();
    return { room, notices };
  }

  saveRoomAsTemplate(roomId: string, input: { name: string; description: string; emoji?: string; template?: Partial<Pick<RoomTemplate, "dir" | "settings" | "vibemates">> }): RoomTemplate {
    const name = input.name.trim();
    if (!name) throw new Error("the template needs a name");
    const room = this.getRoom(roomId);
    const base = room.templateOf();
    const edited = input.template ?? {};
    const saved = this.templates.save({
      name,
      description: input.description.trim(),
      emoji: (input.emoji ?? room.settings.emoji) || undefined,
      dir: edited.dir?.trim() || base.dir,
      settings: { ...base.settings, ...(edited.settings ?? {}) },
      vibemates: edited.vibemates ?? base.vibemates,
    });
    this.emit("event", { type: "templates" } satisfies HubEvent);
    return saved;
  }

  getRoom(id: string): Room {
    const room = this.rooms.get(id);
    if (!room) throw new Error(`no such room: ${id}`);
    return room;
  }

  readonly openRooms: string[] = [];

  markOpened(id: string): void {
    this.getRoom(id);
    if (this.openRooms.includes(id)) return;
    this.openRooms.push(id);
    this.emit("event", { type: "rooms.opened", roomIds: [...this.openRooms] } satisfies HubEvent);
  }

  async removeRoom(id: string): Promise<void> {
    const room = this.getRoom(id);
    await room.shutdown();
    this.rooms.delete(id);
    const at = this.openRooms.indexOf(id);
    if (at >= 0) this.openRooms.splice(at, 1);
    this.saveRooms();
    this.emit("event", { type: "room.removed", roomId: id } satisfies HubEvent);
    const folder = join(this.dataDir, "rooms", id);
    if (existsSync(folder)) {
      const trash = join(this.dataDir, "trash");
      mkdirSync(trash, { recursive: true });
      const target = join(trash, `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      try {
        renameSync(folder, target);
        this.log.info(`removed room ${id}; its folder is in ${target}`);
      } catch (error) {
        this.log.warn(`removed room ${id}, but its folder could not be moved to trash: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else this.log.info(`removed room ${id}`);
  }

  update: UpdateInfo | null = null;
  setUpdate(update: UpdateInfo): void {
    this.update = update;
    this.emit("event", { type: "update", update } satisfies HubEvent);
  }

  async saveLook(raw: unknown, options: { author: string; replace?: boolean }): Promise<LookCheck> {
    const saved = await this.looks.save(raw, options);
    this.emit("event", { type: "looks", looks: this.looks.list() } satisfies HubEvent);
    return saved;
  }

  removeLook(id: string): boolean {
    const removed = this.looks.remove(id);
    if (!removed) return false;
    if (this.settings.appearance?.look === id || this.settings.appearance?.custom?.[id]) {
      this.updateSettings({ appearance: { look: this.settings.appearance.look === id ? DEFAULT_APPEARANCE.look : this.settings.appearance.look, custom: { [id]: null } } });
    }
    this.emit("event", { type: "looks", looks: this.looks.list() } satisfies HubEvent);
    return true;
  }

  snapshot(): unknown {
    return {
      settings: this.settings,
      update: this.update,
      recipes: listRecipes().map(({ build: _b, ...r }) => r),
      skills: this.skills.list(),
      looks: this.looks.list(),
      roomDefaults: { ...DEFAULT_ROOM_SETTINGS, ...this.settings.roomDefaults },
      rooms: [...this.rooms.values()].map((room) => room.snapshot()),
      openRooms: [...this.openRooms],
    };
  }

  async shutdown(): Promise<void> {
    for (const room of this.rooms.values()) await room.shutdown();
    this.saveRooms();
  }

  async reset(): Promise<void> {
    this.log.warn("erasing the whole data folder on the human's request");
    for (const room of this.rooms.values()) await room.shutdown();
    this.rooms.clear();
    for (const token of this.mcpTokens.keys()) this.mcpTokens.delete(token);
    rmSync(join(this.dataDir, "rooms"), { recursive: true, force: true });
    rmSync(this.roomsPath(), { force: true });
    rmSync(this.skills.dir, { recursive: true, force: true });
    rmSync(this.looks.dir, { recursive: true, force: true });
    mkdirSync(join(this.dataDir, "rooms"), { recursive: true });
    mkdirSync(this.skills.dir, { recursive: true });
    this.skills.list();
    this.skills.seedBuiltins();
    rmSync(this.settingsPath(), { force: true });
    this.settings = this.loadSettings();
    this.emit("event", { type: "reset" } satisfies HubEvent);
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function writeJson(path: string, value: unknown): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2));
}
