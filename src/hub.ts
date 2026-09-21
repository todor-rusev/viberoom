// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.js";
import { commitFiles, recoverFileTransactions, type FileChange } from "./file-transaction.js";
import { folderIdentity, isIdentity, newIdentity } from "./identity.js";
import { qrSvg } from "./qr.js";
import { pickBotKey } from "./bot-key.js";
import { ensureDataRoot } from "./data-root.js";
import { RequestTraceRing } from "./mcp-diagnostics.js";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, type TranscriptMode } from "./log.js";
import { HISTORY_DB_FILE, HistoryStore, type SearchHit, type SearchQuery } from "./history-store.js";

const TRANSCRIPT_MODES: readonly TranscriptMode[] = ["off", "errors", "full"];
import { DEFAULT_EDITOR_SETTINGS, type EditorSettings } from "./open.js";
import { listRecipes, loginCheckOf, markLoginChecking, publicRecipes, rememberLoginCheck, rescanRecipes, type AgentTypeId } from "./recipes.js";
import { checkLogin } from "./login-status.js";
import { LoginFlows, type LoginFlow } from "./login-flow.js";
import { openTerminal } from "./terminal.js";
import { DEFAULT_ROOM_SETTINGS, type RoomSettings } from "./persona.js";
import { CREATED_MODE, type NewRoomPlan } from "./new-room.js";
import { Room, type ChatMessage, type DiscoveredOptions, type RoomEvent, type SkillsBridge, type StoredParticipant, type RoomRecovery } from "./room.js";
import { SkillLibrary, type SkillDraft, type SkillMeta } from "./skills.js";
import { TemplateLibrary, roomSettingsFromTemplate, type RoomTemplate } from "./templates.js";
import { LookLibrary, checkLookSpec, loadTokens, type LookCheck, type LookSpec } from "./looks.js";
import { ChannelRouter, type ChannelsView } from "./channels/router.js";
import { ChannelsStore, fileRootRefusal, type FileRoot } from "./channels/state.js";
import { TelegramAdapter, TelegramApiError } from "./channels/telegram.js";

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
  transcripts: TranscriptMode;
  foldAfter: number;
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

export interface StoredRoom {
  id: string;
  uuid?: string;
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

export const SECRET_CARD_MS = 10 * 60_000;

export interface SecretRequest {
  id: string;
  purpose: "telegram-token" | "telegram-pair";
  askedBy: { kind: "window" } | { kind: "vibemate"; roomId: string; participantId: string; name: string };
  askedAt: number;
  expiresAt: number;
  state: "open" | "done" | "closed" | "expired";
  outcome?: string;
  refusal?: string;
  link?: { url: string; expiresAt: number; svg: string };
}

export type HubEvent =
  | { type: "update"; update: UpdateInfo }
  | { type: "room.event"; roomId: string; event: RoomEvent }
  | { type: "room.created"; room: unknown }
  | { type: "room.removed"; roomId: string }
  | { type: "rooms.opened"; roomIds: string[] }
  | { type: "secret"; request: SecretRequest }
  | { type: "settings"; settings: ProgramSettings }
  | { type: "skills"; skills: SkillMeta[] }
  | { type: "templates" }
  | { type: "looks"; looks: LookSpec[] }
  | { type: "recipes"; recipes: unknown[] }
  | { type: "login"; flow: LoginFlow }
  | { type: "restart"; restart: RestartView | null }
  | { type: "reset" }
  | { type: "channels"; channels: ChannelsView };

export interface RestartView {
  askedBy: string;
  from: "window" | "telegram" | "discord";
  waitingFor: string[];
  since: number;
  quietSince?: number;
  sessions?: "load" | "replay";
}

interface McpTokenEntry {
  roomId: string;
  participantId: string;
}

const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursorrules"];

export function nextAppearance(current: AppearanceSettings, a: Record<string, unknown>): AppearanceSettings {
  const chatFontSize = Number(a.chatFontSize ?? current.chatFontSize ?? DEFAULT_APPEARANCE.chatFontSize);
  if (!Number.isFinite(chatFontSize) || chatFontSize < 12 || chatFontSize > 32) throw new Error("appearance.chatFontSize must be between 12 and 32");
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

const CHANNEL_RETRY_MS = [5_000, 15_000, 60_000, 300_000];
const RESTART_POLL_MS = 2_000;
const RESTART_GIVE_UP_MS = 30_000;
const RESTART_QUIET_MS = 5 * 60_000;

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface ShutdownStep {
  stage: string;
  ms: number;
  timedOut: boolean;
}

const SHUTDOWN_STAGE_MS = 5_000;
const ROOM_AGENT_MS = 1_000;

export class Hub extends EventEmitter {
  readonly dataDir: string;
  readonly requestDiagnostics = new RequestTraceRing();
  readonly rooms = new Map<string, Room>();
  readonly skills: SkillLibrary;
  readonly templates: TemplateLibrary;
  readonly looks: LookLibrary;
  readonly history: HistoryStore;
  private readonly staleHistoryRooms = new Set<string>();
  settings: ProgramSettings;
  private readonly log: Logger;
  private readonly optionCache = new Map<string, DiscoveredOptions>();
  private readonly mcpTokens = new Map<string, McpTokenEntry>();
  private hubUrl: string | null = null;
  private run: { id: string; build: string } | null = null;
  private readonly renamedSkills = new Map<string, string>();
  private renamedAttachments = false;
  private readonly skillsBridge: SkillsBridge;

  readonly folderId: string;

  constructor(dataDir: string, log: Logger, initialHumanName?: string) {
    super();
    this.dataDir = resolve(dataDir);
    this.log = log;
    ensureDataRoot(this.dataDir);
    mkdirSync(join(this.dataDir, "rooms"), { recursive: true });
    this.folderId = folderIdentity(this.dataDir);
    this.skills = new SkillLibrary(join(this.dataDir, "skills"), log.child("skills"));
    this.templates = new TemplateLibrary(join(this.dataDir, "templates"), log.child("templates"));
    this.looks = new LookLibrary(join(this.dataDir, "looks"), log.child("looks"));
    this.history = this.openHistory();
    recoverFileTransactions(this.dataDir, this.history);
    setTimeout(() => void this.checkLogins().catch((error) => log.warn(`login checks: ${String(error)}`)), 2500).unref();
    this.logins.on("change", (flow: LoginFlow) => {
      this.emit("event", { type: "login", flow } satisfies HubEvent);
      if (flow.state === "done" && flow.purpose === "install" && !flow.looked) {
        void this.rescan([flow.recipeId]).catch((error) => log.warn(`rescan after install: ${String(error)}`));
      } else if (flow.state === "done") {
        void this.checkLogins([flow.recipeId], 0)
          .then(() => {
            if (loginCheckOf(flow.recipeId)?.state === "ok") for (const room of this.rooms.values()) room.retryAfterLogin(flow.recipeId);
          })
          .catch((error) => log.warn(`login check after sign-in: ${String(error)}`));
      }
    });
    try {
      for (const { name, kept } of this.skills.seedBuiltins()) this.renamedSkills.set(name.toLowerCase(), kept);
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
    this.tellRoomsWhatEndedTheLastRun();
    if (this.renamedAttachments) this.saveRooms();
    this.channelsStore = new ChannelsStore(join(this.dataDir, "channels.json"));
    this.channels = new ChannelRouter(
      {
        rooms: () => [...this.rooms.values()],
        room: (id) => this.rooms.get(id),
        markOpened: (id) => this.markOpened(id),
        reconnectOptions: () => ({ mode: this.settings.reconnectMode }),
        dataDir: () => this.dataDir,
        onRoomEvent: (handler) => this.on("event", (event: HubEvent) => { if (event.type === "room.event") handler(event.roomId, event.event); }),
        channelsChanged: () => this.emit("event", { type: "channels", channels: this.channels.view() } satisfies HubEvent),
        paired: (_platform, name) => this.settlePairingCards(name),
        restart: {
          writingNow: () => this.writingNow(),
          request: (input) => this.requestRestart(input),
          now: (by) => this.restartNow(by),
          cancel: (by) => this.cancelRestart(by),
          pending: () => !!this.restartPending(),
        },
      },
      this.channelsStore,
      log.child("channels"),
    );
  }

  async setTelegram(patch: { enabled?: unknown; token?: unknown; fileRoots?: unknown; name?: unknown; phoneApprovals?: unknown }): Promise<ChannelsView> {
    if (patch.name !== undefined && (typeof patch.name !== "string" || patch.name.length > 64)) throw new Error("the bot's name is up to 64 characters");
    if (patch.phoneApprovals !== undefined && typeof patch.phoneApprovals !== "boolean") throw new Error("phoneApprovals must be true or false");
    if (typeof patch.token === "string" && patch.token.trim()) patch = { ...patch, token: pickBotKey(patch.token) };
    if (patch.token !== undefined && (typeof patch.token !== "string" || (patch.token && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(patch.token)))) throw new Error("that does not look like a bot token from BotFather (digits, a colon, then the secret)");
    if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") throw new Error("enabled must be true or false");
    let roots: FileRoot[] | undefined;
    if (patch.fileRoots !== undefined) {
      if (!Array.isArray(patch.fileRoots)) throw new Error("fileRoots must be a list of folders");
      roots = [];
      for (const item of patch.fileRoots as unknown[]) {
        const path = typeof item === "string" ? item.trim() : item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string" ? (item as { path: string }).path.trim() : null;
        if (path === null) throw new Error("fileRoots must be a list of folders");
        if (!path) continue;
        const subfolders = item && typeof item === "object" && typeof (item as { subfolders?: unknown }).subfolders === "boolean" ? (item as { subfolders: boolean }).subfolders : true;
        if (!isAbsolute(path)) throw new Error(`a folder the phone may receive files from must be an absolute path: ${path}`);
        const refusal = fileRootRefusal(path, this.dataDir);
        if (refusal) throw new Error(refusal);
        roots.push({ path, subfolders });
      }
    }
    this.channelsStore.update((s) => {
      const current = s.telegram ?? { enabled: false, token: "" };
      s.telegram = { ...current, enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled, token: patch.token !== undefined ? (patch.token as string) : current.token, name: patch.name !== undefined ? ((patch.name as string).trim() || undefined) : current.name };
      if (roots) s.fileRoots = roots;
      if (typeof patch.phoneApprovals === "boolean") s.phoneApprovals = patch.phoneApprovals;
    });
    if (patch.enabled !== undefined || patch.token !== undefined || patch.name !== undefined) {
      await this.channels.stop();
      await this.startChannels();
    }
    const view = this.channels.view();
    this.emit("event", { type: "channels", channels: view } satisfies HubEvent);
    return view;
  }

  pairLink(): { url: string; expiresAt: number; svg: string } {
    const { url, link } = this.channels.pairLink("telegram");
    return { url, expiresAt: link.expiresAt, svg: qrSvg(url) };
  }

  cancelPairLink(): void {
    this.channels.cancelPairLink("telegram");
    for (const request of this.openSecrets()) {
      if (request.purpose !== "telegram-pair") continue;
      request.outcome = "closed: the link was withdrawn";
      this.settleSecret(request, "closed");
    }
  }

  unpair(senderId: string, stopTurns = false): boolean {
    return this.channels.unpair("telegram", senderId, { stopTurns });
  }

  readonly channelsStore: ChannelsStore;
  reconnectModeFor(room: Room): "load" | "replay" {
    const own = room.settings.reconnectMode;
    return own === "load" || own === "replay" ? own : this.settings.reconnectMode;
  }

  private bootRooms: Promise<string[]> | null = null;

  startRoomsAtBoot(reconnect: (room: Room, id: string) => Promise<unknown> = (room, id) => room.reconnect(id, { mode: this.reconnectModeFor(room) }), options: { afterRestart?: boolean } = {}): Promise<string[]> {
    return this.bootRooms ??= this.restoreRoomsAtBoot(reconnect, options.afterRestart === true);
  }

  private async restoreRoomsAtBoot(reconnect: (room: Room, id: string) => Promise<unknown>, afterRestart: boolean): Promise<string[]> {
    const started: string[] = [];
    for (const room of this.rooms.values()) {
      if (!room.settings.startWithHub) continue;
      const offline = [...room.participants.values()].filter((p) => p.kind === "agent" && p.status === "offline");
      if (!offline.length) continue;
      this.markOpened(room.id);
      room.noteStartingWithHub(true);
      const restored: string[] = [];
      try {
        for (const p of offline) {
          try {
            await reconnect(room, p.id);
            restored.push(p.id);
          } catch (error) {
            this.log.warn(`room ${room.id}: ${p.name} did not start with viberoom: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } finally {
        room.noteStartingWithHub(false);
      }
      room.noteStartedWithHub(this.reconnectModeFor(room));
      if (afterRestart) room.wakeAfterRestart(restored);
      started.push(room.id);
    }
    return started;
  }


  restartWith: ((sessions?: "load" | "replay") => void) | null = null;
  private restart: (RestartView & { timer: NodeJS.Timeout | null; marks: string; quietSince: number; toldOfWait: boolean }) | null = null;

  get canRestart(): boolean {
    return !!this.restartWith;
  }

  writingNow(): string[] {
    const names: string[] = [];
    for (const room of this.rooms.values()) {
      for (const p of room.participants.values()) if (p.kind === "agent" && (p.status === "thinking" || p.status === "queued")) names.push(p.name);
    }
    return names;
  }

  restartPending(): RestartView | null {
    if (!this.restart) return null;
    const { timer: _timer, marks: _marks, quietSince, toldOfWait: _told, ...view } = this.restart;
    return { ...view, ...(view.waitingFor.length ? { quietSince } : {}) };
  }

  private writingMarks(): string {
    const marks: string[] = [];
    for (const room of this.rooms.values()) {
      for (const p of room.participants.values()) {
        if (p.kind !== "agent" || (p.status !== "thinking" && p.status !== "queued")) continue;
        marks.push(`${room.id}:${p.id}:${p.status}:${room.turnProgressMark(p.id)}`);
      }
    }
    return marks.join("|");
  }

  requestRestart(input: { askedBy: string; from: RestartView["from"]; sessions?: "load" | "replay"; when: "now" | "idle" }): RestartView {
    if (!this.restartWith) throw new Error("this viberoom cannot restart itself");
    if (this.restart) return this.restartPending()!;
    const waiting = input.when === "idle" ? this.writingNow() : [];
    this.restart = { askedBy: input.askedBy, from: input.from, ...(input.sessions ? { sessions: input.sessions } : {}), since: Date.now(), waitingFor: waiting, timer: null, marks: this.writingMarks(), quietSince: Date.now(), toldOfWait: false };
    const where = input.from === "window" ? "" : ` from ${input.from === "telegram" ? "Telegram" : "Discord"}`;
    this.recordEverywhere(waiting.length
      ? `${input.askedBy} asked${where} for viberoom to restart when ${nameList(waiting)} ${waiting.length > 1 ? "finish" : "finishes"}.`
      : `${input.askedBy} asked${where} for viberoom to restart now; a reply being written this moment is cut short.`);
    this.announceRestart();
    if (waiting.length) this.restart.timer = setInterval(() => this.checkRestart(), RESTART_POLL_MS).unref();
    else this.goRestart();
    return this.restartPending()!;
  }

  restartNow(by: string): void {
    if (!this.restart || !this.restart.waitingFor.length) return;
    this.recordEverywhere(`${by} chose not to wait: a reply being written this moment is cut short.`);
    this.goRestart();
  }

  cancelRestart(by: string): void {
    if (!this.restart) return;
    this.clearRestart();
    this.recordEverywhere(`${by} called off the restart of viberoom.`);
    this.announceRestart();
  }

  private restartFailed(): void {
    if (!this.restart) return;
    this.clearRestart();
    this.recordEverywhere("The restart did not happen: this viberoom is still the one running. Its log says why.");
    this.announceRestart();
  }

  private clearRestart(): void {
    if (this.restart?.timer) clearInterval(this.restart.timer);
    this.restart = null;
  }

  private checkRestart(): void {
    const req = this.restart;
    if (!req) return;
    const writing = this.writingNow();
    if (!writing.length) return this.goRestart();
    const marks = this.writingMarks();
    const changed = writing.join("|") !== req.waitingFor.join("|");
    if (marks !== req.marks) {
      req.marks = marks;
      req.quietSince = Date.now();
    }
    req.waitingFor = writing;
    if (changed) this.announceRestart();
    if (!req.toldOfWait && Date.now() - req.quietSince >= RESTART_QUIET_MS) {
      req.toldOfWait = true;
      const minutes = Math.round((Date.now() - req.quietSince) / 60_000);
      const words = `Nothing new from ${nameList(writing)} for ${minutes} minutes; viberoom is still waiting to restart.`;
      this.recordEverywhere(words);
      if (req.from !== "window") void this.channels.restartStillWaiting(`<b>Still waiting.</b> ${words}`).catch(() => undefined);
      this.announceRestart();
    }
  }

  private goRestart(): void {
    const req = this.restart;
    if (!req || !this.restartWith) return;
    if (req.timer) clearInterval(req.timer);
    req.waitingFor = [];
    req.timer = setTimeout(() => this.restartFailed(), RESTART_GIVE_UP_MS).unref();
    this.recordEverywhere("viberoom is restarting; it comes back in a few seconds.");
    this.announceRestart();
    this.restartWith(req.sessions);
  }

  private announceRestart(): void {
    this.emit("event", { type: "restart", restart: this.restartPending() } satisfies HubEvent);
  }

  noteBackAfterRestart(build: string): void {
    this.recordEverywhere(`viberoom is back (build ${build}).`);
  }

  private recordEverywhere(text: string): void {
    for (const room of this.rooms.values()) room.hubRecord(text);
  }

  readonly channels: ChannelRouter;

  async startChannels(): Promise<void> {
    if (this.channelsRetry) {
      clearTimeout(this.channelsRetry);
      this.channelsRetry = null;
    }
    const telegram = this.channelsStore.get().telegram;
    if (!telegram?.enabled || !telegram.token) return;
    for (const room of this.rooms.values()) if (room.historyDiverted) this.log.warn(`room ${room.id}: the divert journal is still waiting; messages from messengers will queue behind it until the store answers`);
    try {
      await this.channels.start(new TelegramAdapter({ token: telegram.token, apiBase: telegram.apiBase, name: telegram.name, log: this.log.child("telegram") }));
      this.channelsRetryAttempt = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof TelegramApiError && (error.code === 401 || error.code === 404)) {
        this.log.error(`telegram channel not started: ${message}; the bot token is not accepted, paste a new one in Settings → Channels`);
        this.channels.noteStartFailure("telegram", "Telegram did not accept the bot token: check it at BotFather (after /revoke, paste the new one), or paste the key on a line of its own");
        return;
      }
      const delay = CHANNEL_RETRY_MS[Math.min(this.channelsRetryAttempt++, CHANNEL_RETRY_MS.length - 1)];
      this.log.error(`telegram channel not started: ${message}; again in ${Math.round(delay / 1000)} s`);
      this.channels.noteStartFailure("telegram", `viberoom could not reach Telegram (${message}); trying again in ${Math.round(delay / 1000)} s`);
      this.channelsRetry = setTimeout(() => {
        this.channelsRetry = null;
        void this.startChannels();
      }, delay);
      this.channelsRetry.unref?.();
    }
  }

  private channelsRetry: NodeJS.Timeout | null = null;
  private channelsRetryAttempt = 0;


  private readonly secrets = new Map<string, SecretRequest>();

  openSecrets(): SecretRequest[] {
    return [...this.secrets.values()].filter((r) => r.state === "open");
  }

  askSecret(purpose: SecretRequest["purpose"], askedBy: SecretRequest["askedBy"]): SecretRequest {
    const open = this.openSecrets().find((r) => r.purpose === purpose);
    if (open) return open;
    const now = Date.now();
    const request: SecretRequest = { id: randomBytes(9).toString("base64url"), purpose, askedBy, askedAt: now, expiresAt: now + SECRET_CARD_MS, state: "open" };
    if (purpose === "telegram-pair") {
      const { url, link } = this.channels.pairLink("telegram");
      request.link = { url, expiresAt: link.expiresAt, svg: qrSvg(url) };
      request.expiresAt = link.expiresAt;
    }
    this.secrets.set(request.id, request);
    this.log.info(`secret card ${request.id} (${purpose}) asked by ${askedBy.kind === "window" ? "the window" : `${askedBy.name} in room ${askedBy.roomId}`}`);
    this.emit("event", { type: "secret", request } satisfies HubEvent);
    if (askedBy.kind === "vibemate") {
      const room = this.rooms.get(askedBy.roomId);
      const human = room?.settings.humanName;
      if (room) room.channelRecord(purpose === "telegram-pair"
        ? `${askedBy.name} asked to pair a phone: a card with the link and its QR code is on ${human}'s screen.`
        : `${askedBy.name} asked for the Telegram bot key: a card is on ${human}'s screen.`);
    }
    const timer = setTimeout(() => this.expireSecrets(), request.expiresAt - now + 50);
    timer.unref();
    return request;
  }

  async answerSecret(id: string, value: string): Promise<SecretRequest> {
    const request = this.secrets.get(id);
    if (!request || request.state !== "open") throw new Error("that card is no longer open");
    if (request.purpose !== "telegram-token") throw new Error("that card takes no value");
    try {
      const view = await this.setTelegram({ token: value, enabled: true });
      const tg = view.telegram;
      if (!tg || (tg.state !== "connected" && tg.state !== "listening")) throw new Error(tg?.detail || "the bot did not start");
      request.outcome = `connected as @${tg.account}`;
    } catch (error) {
      request.refusal = error instanceof Error ? error.message : String(error);
      this.emit("event", { type: "secret", request } satisfies HubEvent);
      throw error;
    }
    request.refusal = undefined;
    this.settleSecret(request, "done");
    return request;
  }

  closeSecret(id: string, options: { copied?: boolean } = {}): SecretRequest {
    const request = this.secrets.get(id);
    if (!request) throw new Error("no such card");
    if (request.state !== "open") return request;
    if (request.purpose === "telegram-pair") {
      request.outcome = options.copied ? "closed: the link was copied and stays good until it runs out" : "closed without pairing";
      this.settleSecret(request, "closed");
      if (!options.copied) this.channels.cancelPairLink("telegram");
      return request;
    }
    request.outcome = "closed without a key";
    this.settleSecret(request, "closed");
    return request;
  }

  private settlePairingCards(name: string): void {
    for (const request of this.openSecrets()) {
      if (request.purpose !== "telegram-pair") continue;
      request.outcome = `paired: ${name}`;
      this.settleSecret(request, "done");
    }
  }

  expireSecrets(now = Date.now()): void {
    for (const request of this.openSecrets()) {
      if (request.expiresAt > now) continue;
      request.outcome = request.purpose === "telegram-pair" ? "expired: not used within ten minutes" : "not answered within ten minutes";
      this.settleSecret(request, "expired");
    }
  }

  private settleSecret(request: SecretRequest, state: "done" | "closed" | "expired"): void {
    request.state = state;
    this.log.info(`secret card ${request.id}: ${state} (${request.outcome})`);
    this.emit("event", { type: "secret", request } satisfies HubEvent);
    if (request.askedBy.kind !== "vibemate") return;
    const room = this.rooms.get(request.askedBy.roomId);
    if (!room) return;
    const human = room.settings.humanName;
    if (request.purpose === "telegram-pair") {
      room.channelRecord(
        state === "done" ? `${human} paired the phone from the card: ${request.outcome}.`
          : state === "closed" ? `${human}'s pairing card closed: ${request.outcome}.`
          : "The pairing card was not used within ten minutes and closed by itself.",
      );
      return;
    }
    room.channelRecord(
      state === "done" ? `${human} entered the Telegram bot key on the card: ${request.outcome}.`
        : state === "closed" ? `${human} closed the key card without a key.`
        : "The key card was not answered within ten minutes and closed by itself.",
    );
  }

  setRun(run: { id: string; build: string }): void {
    this.run = run;
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

  skillsChanged(name: string): void {
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
      transcripts: "off",
      foldAfter: 1200,
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
    this.settings = next;
    writeJson(this.settingsPath(), this.settings);
    for (const room of this.rooms.values()) {
      room.applyProgramSettings({
        humanName: next.humanName,
        humanDescription: next.humanDescription,
        bypassPermissionsByDefault: next.bypassPermissionsByDefault,
        transcripts: next.transcripts,
        foldAfter: next.foldAfter,
      });
    }
    this.emit("event", { type: "settings", settings: this.settings } satisfies HubEvent);
    this.saveRooms();
    return this.settings;
  }


  private roomsPath(): string {
    return join(this.dataDir, "rooms.json");
  }

  private keepAttachments(participants: StoredParticipant[]): StoredParticipant[] {
    if (!this.renamedSkills.size) return participants;
    return participants.map((p) => {
      const skills = p.skills?.map((s) => this.renamedSkills.get(s.toLowerCase()) ?? s);
      if (!skills || skills.every((s, i) => s === p.skills![i])) return p;
      this.log.info(`${p.name}: attached skills follow the renamed copy (${skills.join(", ")})`);
      this.renamedAttachments = true;
      return { ...p, skills };
    });
  }

  private tellRoomsWhatEndedTheLastRun(): void {
    const mark = join(this.dataDir, "last-fault.json");
    if (!existsSync(mark)) return;
    let ended: { at?: number; reason?: string; writing?: string[] } = {};
    try {
      ended = JSON.parse(readFileSync(mark, "utf8")) as typeof ended;
    } catch {
    }
    const at = typeof ended.at === "number" ? new Date(ended.at) : null;
    const sameDay = at ? new Date().toDateString() === at.toDateString() : false;
    const when = !at
      ? "the last time it ran"
      : sameDay
        ? `at ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : `on ${at.toLocaleDateString()} at ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const why = ended.reason ? ` What stopped it: ${ended.reason}` : "";
    const lost = ended.writing === undefined
      ? " A reply that was being written at that moment would not have survived it — ask for it again if something is missing."
      : ended.writing.length
        ? ` A reply from ${ended.writing.join(" and ")} was being written at that moment and did not survive it — ask for it again.`
        : "";
    for (const room of this.rooms.values()) {
      room.hubRecord(`viberoom stopped unexpectedly ${when} and has started again. Everything said here is kept on this computer and is safe.${lost}${why}`);
    }
    try {
      rmSync(mark, { force: true });
    } catch {
    }
  }

  private loadRooms(): void {
    if (!existsSync(this.roomsPath())) return;
    let backfilled = 0;
    let file: RoomsFile;
    try {
      file = JSON.parse(readFileSync(this.roomsPath(), "utf8")) as RoomsFile;
    } catch (error) {
      this.log.warn(`rooms.json unreadable (${String(error)}); starting with no rooms`);
      return;
    }
    for (const stored of file.rooms ?? []) {
      try {
        const room = this.instantiate(stored.id, stored.name, stored.dir, stored.settings, stored.createdAt, isIdentity(stored.uuid) ? stored.uuid : newIdentity());
        if (!isIdentity(stored.uuid)) backfilled++;
        room.restore(this.keepAttachments(stored.participants ?? []));
        this.log.info(`restored room "${stored.name}" (${stored.id}): ${room.messages.length} messages, ${stored.participants?.length ?? 0} participants offline`);
      } catch (error) {
        this.log.error(`could not restore room ${stored.id}: ${String(error)}`);
      }
    }
    if (backfilled) {
      this.saveRooms();
      this.log.info(`${backfilled} room(s) had no identity of their own and were given one on this machine`);
    }
  }

  saveRooms(): void {
    const file: RoomsFile = {
      version: 1,
      rooms: [...this.rooms.values()].map((room) => room.toStored()),
    };
    writeJson(this.roomsPath(), file);
  }

  importedRoomAddress(name: string, reserved: ReadonlySet<string> = new Set()): string {
    let base = slugify(name);
    if (!ROOM_ID_PATTERN.test(base)) base = `room-${randomBytes(6).toString("hex")}`;
    let id = base;
    for (let n = 2; this.rooms.has(id) || reserved.has(id) || existsSync(join(this.dataDir, "rooms", id)); n++) id = `${base.slice(0, 32)}-${n}`;
    return id;
  }

  commitRoomTransfer(changes: { stored: StoredRoom; setup: boolean }[], files: FileChange[], writeRecord: () => void): void {
    const changed = new Map(changes.map(c => [c.stored.id, c]));
    if (changed.size !== changes.length) throw new Error("The import targets a room more than once.");
    for (const { stored, setup } of changes) {
      if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(stored.id) || !isIdentity(stored.uuid) || !stored.name.trim() || stored.name.length > 60) throw new Error("The import has invalid room metadata.");
      const room = this.rooms.get(stored.id);
      if (room && room.uuid !== stored.uuid) throw new Error("The target room changed. Preview the import again.");
      if (!room && resolve(stored.dir) !== resolve(this.dataDir, "rooms", stored.id, "workspace")) throw new Error("A carried room must start with its own local working folder.");
      if (room?.historyDiverted) throw new Error(`The conversation in ${room.name} has unsaved writes. Let those finish before importing.`);
      if (setup && room?.hasConnectedAgents) throw new Error(`Disconnect the agents in ${room.name} before replacing their setup, then preview the import again.`);
    }
    const rooms = [...this.rooms.values()].map(room => changed.get(room.id)?.stored ?? room.toStored());
    for (const change of changes) if (!this.rooms.has(change.stored.id)) rooms.push(change.stored as ReturnType<Room["toStored"]>);
    const workspaces: FileChange[] = changes.filter(c => !this.rooms.has(c.stored.id)).map(c => ({ path: join("rooms", c.stored.id, "workspace"), directory: [] }));
    commitFiles(this.dataDir, this.history, [...workspaces, ...files, { path: "rooms.json", data: JSON.stringify({ version: 1, rooms }, null, 2) + "\n" }], () => {
      for (const { stored } of changes) if (!this.history.migration(stored.id)) this.history.adoptMirror(stored.id);
      writeRecord();
    });
    for (const { stored, setup } of changes) {
      let room = this.rooms.get(stored.id);
      if (!room || setup) {
        room?.removeAllListeners();
        room = this.instantiate(stored.id, stored.name, stored.dir, stored.settings, stored.createdAt, stored.uuid);
        room.restore(stored.participants, { quiet: true });
        this.emit("event", { type: "room.created", room: room.snapshot() } satisfies HubEvent);
      } else room.importCommitted();
    }
  }

  searchHistory(params: { q?: string; rooms?: string; kinds?: string; author?: string; sort?: string; limit?: string; offset?: string; perRoom?: string; deleted?: string }): HistorySearchResponse {
    if (!this.history) return { hits: [], query: "", usedTrigram: false, unavailable: "the conversation store is off (SQLite is not available in this Node)" };
    const kinds = (params.kinds ?? "chat").split(",").map((k) => k.trim()).filter((k): k is "chat" | "system" => k === "chat" || k === "system");
    const rooms = params.rooms && params.rooms !== "all" ? params.rooms.split(",").map((r) => r.trim()).filter((r) => this.rooms.has(r)) : undefined;
    const sort = params.sort === "newest" || params.sort === "oldest" ? params.sort : "rank";
    const query: SearchQuery = {
      text: params.q ?? "",
      rooms,
      kinds: kinds.length ? kinds : ["chat"],
      author: params.author?.trim() || undefined,
      sort,
      limit: clampInt(params.limit, 40, 1, 200),
      offset: clampInt(params.offset, 0, 0, 100_000),
      perRoom: params.perRoom ? clampInt(params.perRoom, 10, 1, 200) : undefined,
      includeDeleted: params.deleted === "1",
    };
    const stale = this.staleHistoryRoomsAfterRetry(rooms ?? this.rooms.keys()).map((id) => this.rooms.get(id)?.name ?? id);
    const result = this.history.search(query);
    return {
      ...result,
      hits: result.hits.map((h) => ({ ...h, roomName: this.rooms.get(h.roomId)?.name ?? h.roomId })),
      roomsSearched: rooms ? rooms.length : this.rooms.size,
      ...(stale.length ? { stale } : {}),
    };
  }

  private openHistory(): HistoryStore {
    try {
      return new HistoryStore(join(this.dataDir, HISTORY_DB_FILE), this.log.child("history"));
    } catch (error) {
      throw new Error(`the conversation store could not be opened (${error instanceof Error ? error.message : String(error)}); viberoom needs Node 22.16 or newer with node:sqlite`);
    }
  }

  historyBackupEveryMs = 10 * 60_000;
  historyBackupKeep = 5;
  private backupTimer: NodeJS.Timeout | null = null;

  startBackups(): void {
    if (this.backupTimer) return;
    this.backupTimer = setInterval(() => {
      void this.backupHistory().catch((error) => this.log.warn(`history backup failed: ${error instanceof Error ? error.message : String(error)}`));
      for (const room of this.rooms.values()) room.purgeAcceptReceipts();
    }, this.historyBackupEveryMs);
    this.backupTimer.unref();
  }

  adoptRoomCopy(id: string): Promise<RoomRecovery> {
    const room = this.getRoom(id);
    return room.adoptCopy(() => this.backupHistory(), () => this.rooms.get(id) === room);
  }

  async backupHistory(): Promise<string> {
    const dir = join(this.dataDir, "backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `history-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    const part = `${file}.part`;
    try {
      await this.history.backup(part);
      renameSync(part, file);
    } catch (error) {
      rmSync(part, { force: true });
      throw error;
    }
    const older = readdirSync(dir).filter((f) => /^history-.*\.db$/.test(f)).sort();
    for (const f of older.slice(0, Math.max(0, older.length - this.historyBackupKeep))) rmSync(join(dir, f), { force: true });
    return file;
  }

  historyRetryMs = 30_000;
  private readonly historyRetriedAt = new Map<string, number>();

  private retryStaleMirror(roomId: string): void {
    if (!this.staleHistoryRooms.has(roomId)) return;
    const now = Date.now();
    if (now - (this.historyRetriedAt.get(roomId) ?? 0) < this.historyRetryMs) return;
    this.historyRetriedAt.set(roomId, now);
    const room = this.rooms.get(roomId);
    if (room) this.mirrorRoom(roomId, room);
  }

  staleHistoryRoomsAfterRetry(roomIds: Iterable<string>): string[] {
    const stale: string[] = [];
    for (const id of roomIds) {
      this.retryStaleMirror(id);
      if (this.staleHistoryRooms.has(id)) stale.push(id);
    }
    return stale;
  }

  roomsForAgentSearch(roomId: string): { id: string; name: string }[] {
    const own = this.rooms.get(roomId);
    if (!own) return [];
    if (!own.settings.searchOtherRooms) return [{ id: own.id, name: own.settings.name }];
    return [...this.rooms.values()]
      .filter((room) => room.id === roomId || this.canReadSharedHistory(own, room))
      .map((room) => ({ id: room.id, name: room.settings.name }));
  }

  private canReadSharedHistory(caller: Room, target: Room): boolean {
    return caller.settings.searchOtherRooms && target.settings.searchOtherRooms && !caller.readOnly && !target.readOnly
      && !this.staleHistoryRoomsAfterRetry([target.id]).length;
  }

  readMessageForAgent(callerRoomId: string, participantId: string, seq: number, around: number, selector?: string): Record<string, unknown> {
    const caller = this.getRoom(callerRoomId);
    caller.assertHistoryAccessForAgent(participantId);
    let target = caller;
    if (selector !== undefined) {
      const byId = this.rooms.get(selector);
      const candidates = byId ? [byId] : [...this.rooms.values()].filter(room => room.settings.name === selector);
      const matches = candidates.filter(room => room === caller || this.canReadSharedHistory(caller, room));
      if (matches.length > 1) throw new Error(`room ${JSON.stringify(selector)} is ambiguous; use its room ID from search_history`);
      if (!matches.length) throw new Error(`room ${JSON.stringify(selector)} is not available to this vibemate`);
      target = matches[0];
    }
    try {
      const content = target === caller
        ? caller.readMessageForAgent(participantId, seq, around)
        : target.readVisibleMessageForAgent(seq, around, `${caller.participants.get(participantId)!.name} from ${JSON.stringify(caller.settings.name)}`);
      return { room: target.id, roomName: target.settings.name, ...content };
    } catch (error) {
      if (target === caller) throw error;
      throw new Error(`room ${JSON.stringify(target.settings.name)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  historyForAgent(roomId: string): HistoryStore | null {
    this.retryStaleMirror(roomId);
    if (this.staleHistoryRooms.has(roomId)) throw new Error("the conversation store is out of sync for this room; history could not be searched until it is reconciled");
    return this.history;
  }

  private mirrorRoom(id: string, room: Room): void {
    try {
      const { upserted, marked } = this.history.reconcile(id, room.messages.filter(committed));
      this.staleHistoryRooms.delete(id);
      if (upserted || marked) this.log.info(`history store: room ${id} reconciled (${upserted} written, ${marked} marked removed)`);
    } catch (error) {
      this.log.warn(`history store: room ${id} could not be reconciled: ${error instanceof Error ? error.message : String(error)}`);
      this.staleHistoryRooms.add(id);
    }
  }

  private instantiate(id: string, name: string, dir: string, settings: Partial<RoomSettings>, createdAt: number, uuid: string = newIdentity()): Room {
    const room = new Room({
      id,
      uuid,
      folderId: this.folderId,
      name,
      dir,
      dataDir: join(this.dataDir, "rooms", id),
      createdAt,
      humanName: this.settings.humanName,
      programHumanDescription: this.settings.humanDescription,
      bypassPermissionsByDefault: this.settings.bypassPermissionsByDefault,
      hubRun: () => this.run,
      programTranscripts: this.settings.transcripts,
      programFoldAfter: this.settings.foldAfter,
      settings: { ...this.settings.roomDefaults, ...settings },
      log: this.log.child(`room:${id}`),
      optionCache: this.optionCache,
      skills: this.skillsBridge,
      history: this.history,
      onHistoryFailure: (roomId) => this.staleHistoryRooms.add(roomId),
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

  createRoom(input: { name: string; dir?: string | null; settings?: Partial<RoomSettings>; uuid?: string }): { room: Room; notices: string[] } {
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

    const room = this.instantiate(id, name, dir, input.settings ?? {}, Date.now(), isIdentity(input.uuid) ? input.uuid : newIdentity());
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

  async createProposedRoom(plan: NewRoomPlan, by: { proposer: string; human: string }): Promise<{ room: Room; notices: string[] }> {
    const { room, notices } = this.createRoom({ name: plan.name, dir: null, settings: { reachableFromMessengers: false } });
    const installed = new Set(listRecipes().filter((r) => !r.unavailableReason).map((r) => r.id));
    for (const one of plan.vibemates) {
      const agentType = one.agentType && installed.has(one.agentType as AgentTypeId) ? one.agentType : "";
      if (one.agentType && !agentType) notices.push(`${one.name}: ${one.agentType} is not installed here; it waits in the roster until you cast it.`);
      try {
        const seated = agentType
          ? await room.inviteAgent({ agentType, name: one.name, tagline: one.tagline, role: one.role, avatar: one.avatar, model: one.model, effort: one.effort, mode: CREATED_MODE, textCheck: "notice" })
          : room.addUnstaffed({ name: one.name, tagline: one.tagline, role: one.role, avatar: one.avatar, textCheck: "notice" });
        seated.createdByVibemate = true;
      } catch (error) {
        notices.push(`${one.name} could not be added: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.markOpened(room.id);
    room.hubRecord(`${by.proposer} proposed this room; ${by.human} created it.`);
    this.saveRooms();
    return { room, notices };
  }

  async resolveNewRoom(roomId: string, key: string, create: boolean): Promise<{ status: "created" | "refused"; room?: string; notices: string[] }> {
    const from = this.getRoom(roomId);
    const proposal = from.pendingNewRoom(key);
    if (!proposal) throw new Error("no such proposed room");
    if (!create) {
      from.settleNewRoom(key, "refused");
      return { status: "refused", notices: [] };
    }
    const { room, notices } = await this.createProposedRoom(proposal.plan, { proposer: proposal.participantName, human: this.settings.humanName });
    from.settleNewRoom(key, "created", room.id);
    return { status: "created", room: room.id, notices };
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
    try {
      this.history?.dropRoom(id);
      this.history?.memory.drop(`room:${room.uuid}`);
    } catch (error) {
      this.log.warn(`history store: room ${id} not dropped: ${error instanceof Error ? error.message : String(error)}`);
    }
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

  async checkLogins(ids?: string[], maxAgeMs = 0): Promise<void> {
    if (this.leaving.signal.aborted) return;
    const targets = listRecipes().filter((r) => !r.unavailableReason && (!ids || ids.includes(r.id)) && !r.loginChecking);
    const due = targets.filter((r) => { const c = loginCheckOf(r.id); return !c || Date.now() - c.at >= maxAgeMs; });
    if (!due.length) return;
    const cwd = join(this.dataDir, ".probe");
    mkdirSync(cwd, { recursive: true });
    for (const r of due) markLoginChecking(r.id, true);
    this.emitRecipes();
    const run = Promise.all(
      due.map(async (r) => {
        try {
          const check = await checkLogin(r.loginStatus, r.build({ model: null, mode: null }), cwd, this.leaving.signal);
          rememberLoginCheck(r.id, check);
          this.log.info(`login check ${r.id}: ${check.state} (${check.how}: ${check.detail})`);
          this.logins.settle(r.id, check.state, check.detail);
        } catch (error) {
          rememberLoginCheck(r.id, { state: "unknown", how: r.loginStatus.kind === "acp" ? "acp" : "command", at: Date.now(), detail: error instanceof Error ? error.message : String(error) });
        } finally {
          markLoginChecking(r.id, false);
          this.emitRecipes();
        }
      }),
    );
    this.loginRun = run.then(() => undefined);
    try {
      await this.loginRun;
    } finally {
      this.loginRun = null;
    }
  }

  private loginRun: Promise<void> | null = null;
  private readonly leaving = new AbortController();

  readonly logins = new LoginFlows();

  startLogin(recipeId: string, inTerminal = false): LoginFlow {
    const recipe = listRecipes().find((r) => r.id === recipeId);
    if (!recipe) throw new Error(`unknown agent type: ${recipeId}`);
    if (recipe.unavailableReason) throw new Error(`${recipe.vendor}: ${recipe.unavailableReason}`);
    const cwd = join(this.dataDir, ".probe");
    mkdirSync(cwd, { recursive: true });
    if (inTerminal || recipe.loginFlow.kind === "terminal") {
      const line = recipe.loginFlow.kind === "terminal" ? recipe.loginFlow.commandLine : recipe.loginTerminalLine;
      if (!line) throw new Error(`${recipe.vendor} has no sign-in command to run in a terminal here`);
      return this.logins.startTerminal({ recipeId: recipe.id, vendor: recipe.vendor, commandLine: line, hint: recipe.loginFlow.hint }, () => openTerminal(line, `viberoom: ${recipe.vendor} sign-in`, cwd));
    }
    return this.logins.start({ recipeId: recipe.id, vendor: recipe.vendor, spec: recipe.loginFlow, launch: recipe.build({ model: null, mode: null }) }, cwd);
  }

  startInstall(recipeId: string, inTerminal = false): LoginFlow {
    const recipe = listRecipes().find((r) => r.id === recipeId);
    if (!recipe) throw new Error(`unknown agent type: ${recipeId}`);
    if (!recipe.unavailableReason) throw new Error(`${recipe.vendor} is already installed (${recipe.installedAt})`);
    const spec = recipe.install;
    if (spec.kind === "url") throw new Error(`${recipe.vendor} is installed from its website: ${spec.url}`);
    const cwd = join(this.dataDir, ".probe");
    mkdirSync(cwd, { recursive: true });
    if (spec.kind === "command" && !inTerminal) {
      return this.logins.start({ recipeId: recipe.id, vendor: recipe.vendor, purpose: "install", spec: { kind: "command", command: spec.command, args: spec.args, hint: spec.note }, launch: { command: spec.command, args: spec.args } }, cwd);
    }
    return this.logins.startTerminal({ recipeId: recipe.id, vendor: recipe.vendor, commandLine: spec.line, hint: spec.note, purpose: "install" }, () => openTerminal(spec.line, `viberoom: install ${recipe.vendor}`, cwd, { shell: spec.shell }));
  }

  async rescan(ids?: string[]): Promise<void> {
    rescanRecipes();
    for (const r of listRecipes()) if (!ids || ids.includes(r.id)) this.logins.settleInstall(r.id, r.unavailableReason ? null : r.installedAt);
    this.emitRecipes();
    await this.checkLogins(ids, 0);
  }

  private emitRecipes(): void {
    this.emit("event", { type: "recipes", recipes: publicRecipes() } satisfies HubEvent);
  }

  snapshot(): unknown {
    return {
      settings: this.settings,
      update: this.update,
      recipes: publicRecipes(),
      logins: this.logins.list(),
      skills: this.skills.list(),
      looks: this.looks.list(),
      roomDefaults: { ...DEFAULT_ROOM_SETTINGS, ...this.settings.roomDefaults },
      rooms: [...this.rooms.values()].map((room) => room.snapshot()),
      openRooms: [...this.openRooms],
      channels: this.channels.view(),
      secrets: this.openSecrets(),
      restart: { can: this.canRestart, pending: this.restartPending() },
    };
  }

  async shutdown(options: { stageMs?: number; onStage?: (step: ShutdownStep) => void } = {}): Promise<ShutdownStep[]> {
    const steps: ShutdownStep[] = [];
    const stage = async (name: string, budget: number, work: () => Promise<void> | void): Promise<void> => {
      const started = Date.now();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => await work())(),
          new Promise<void>((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(); }, budget); }),
        ]);
      } catch (error) {
        this.log.warn(`shutdown: ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timer);
      }
      const step: ShutdownStep = { stage: name, ms: Date.now() - started, timedOut };
      if (timedOut) this.log.warn(`shutdown: ${name} did not finish within ${budget} ms; carrying on`);
      steps.push(step);
      options.onStage?.(step);
    };
    const plain = options.stageMs ?? SHUTDOWN_STAGE_MS;

    this.clearRestart();
    if (this.channelsRetry) clearTimeout(this.channelsRetry);
    this.channelsRetry = null;
    this.leaving.abort();
    await stage("ways-in", plain, async () => {
      for (const room of this.rooms.values()) room.closeDoor();
      await this.loginRun;
      await this.channels.stop();
    });
    for (const room of this.rooms.values()) {
      const agents = [...room.participants.values()].filter((p) => p.kind === "agent").length;
      await stage(`room:${room.name}`, ROOM_AGENT_MS * (agents + 1) + plain, () => room.shutdown());
    }
    this.saveRooms();
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
      await stage("backup", plain, async () => { await this.backupHistory(); });
    }
    await stage("history", plain, () => this.history.close());
    return steps;
  }

  async reset(): Promise<void> {
    if (this.channelsRetry) clearTimeout(this.channelsRetry);
    this.channelsRetry = null;
    this.log.warn("erasing the whole data folder on the human's request");
    for (const room of this.rooms.values()) await room.shutdown();
    for (const id of this.rooms.keys()) this.history?.dropRoom(id);
    this.history.memory.drop();
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
    await this.channels.stop();
    rmSync(join(this.dataDir, "channels.json"), { force: true });
    this.channelsStore.reload();
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

export interface HistorySearchResponse {
  hits: Array<SearchHit & { roomName: string }>;
  query: string;
  usedTrigram: boolean;
  roomsSearched?: number;
  unavailable?: string;
  stale?: string[];
}

function clampInt(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function committed(message: ChatMessage): boolean {
  return !message.streaming && Number.isInteger(message.seq) && message.seq > 0;
}
