// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.js";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Logger } from "./log.js";
import { DEFAULT_EDITOR_SETTINGS, type EditorSettings } from "./open.js";
import { listRecipes } from "./recipes.js";
import { DEFAULT_ROOM_SETTINGS, type RoomSettings } from "./persona.js";
import { Room, type DiscoveredOptions, type RoomEvent, type SkillsBridge, type StoredParticipant } from "./room.js";
import { SkillLibrary, type SkillDraft, type SkillMeta } from "./skills.js";

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
}

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

export type HubEvent =
  | { type: "room.event"; roomId: string; event: RoomEvent }
  | { type: "room.created"; room: unknown }
  | { type: "room.removed"; roomId: string }
  | { type: "settings"; settings: ProgramSettings }
  | { type: "skills"; skills: SkillMeta[] }
  | { type: "reset" };

interface McpTokenEntry {
  roomId: string;
  participantId: string;
}

const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursorrules"];

export class Hub extends EventEmitter {
  readonly dataDir: string;
  readonly rooms = new Map<string, Room>();
  readonly skills: SkillLibrary;
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
    try {
      this.skills.seedBuiltins();
    } catch (error) {
      log.warn(`built-in skills could not be seeded: ${String(error)}`);
    }
    this.skillsBridge = {
      library: this.skills,
      serverScript: fileURLToPath(new URL("./mcp-skills-server.js", import.meta.url)),
      hubUrl: () => this.hubUrl,
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
    if (patch.editor !== undefined && typeof patch.editor === "object" && patch.editor) {
      const e = patch.editor as Record<string, unknown>;
      const mode = String(e.mode ?? next.editor?.mode ?? "auto");
      if (mode !== "auto" && mode !== "default-app" && mode !== "custom") throw new Error("editor.mode must be auto, default-app or custom");
      const command = String(e.command ?? next.editor?.command ?? "").trim().slice(0, 500);
      if (mode === "custom" && !command.includes("{file}")) throw new Error("editor.command must mention {file} (and usually {line})");
      next.editor = { mode, command };
    }
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

  getRoom(id: string): Room {
    const room = this.rooms.get(id);
    if (!room) throw new Error(`no such room: ${id}`);
    return room;
  }

  async removeRoom(id: string): Promise<void> {
    const room = this.getRoom(id);
    await room.shutdown();
    this.rooms.delete(id);
    this.saveRooms();
    this.emit("event", { type: "room.removed", roomId: id } satisfies HubEvent);
    this.log.info(`removed room ${id} (history kept on disk)`);
  }

  snapshot(): unknown {
    return {
      settings: this.settings,
      recipes: listRecipes().map(({ build: _b, ...r }) => r),
      skills: this.skills.list(),
      roomDefaults: { ...DEFAULT_ROOM_SETTINGS, ...this.settings.roomDefaults },
      rooms: [...this.rooms.values()].map((room) => room.snapshot()),
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
