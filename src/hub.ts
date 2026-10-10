// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { TrialBudgetCard, type TrialBudgetView, type TrialBudgetSubject } from "./memory/trial-budget-card.js";
import { startProductionPrivateTrial, stopProductionPrivateTrial } from "./memory/private-trial-startup.js";

import { EventEmitter } from "node:events";
import { AutomationStore } from "./automation-store.js";
import { Automations } from "./automations.js";
import { BackgroundTaskStore, BackgroundTaskError } from "./background-task-store.js";
import { AgentMessageError } from "./agent-message.js";
import type { NativeNoteEffect } from "./native-reports.js";
import { captureNativeNoteSubject, nativeNoteDisposition, type NativeNoteDisposition } from "./native-note-state.js";
import { validArguments } from "./tool-validation.js";
import { parseAutomation, parseSchedule, previewSchedule } from "./automation-schedule.js";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { onRenameRefused, writeFileAtomic } from "./atomic.js";
import { onSlowIo, slowIoWords } from "./slow-io.js";
import { watchThread } from "./thread-watch.js";
import { commitFiles, recoverFileTransactions, type FileChange, type FileOps } from "./file-transaction.js";
import { carriedParticipants } from "./carry-plan.js";
import { ARRIVING, HELD_FILE_RETRIES, removeArrivingFolder } from "./carry-write.js";
import { folderIdentity, isIdentity, newIdentity } from "./identity.js";
import { qrSvg } from "./qr.js";
import { pickBotKey } from "./bot-key.js";
import { ensureDataRoot } from "./data-root.js";
import { RequestTraceRing } from "./mcp-diagnostics.js";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Logger, type TranscriptMode } from "./log.js";
import { transcriptWriter } from "./transcript-writer.js";
import { HISTORY_DB_FILE, HistoryStore, storeOpenFailure, type SearchHit, type SearchQuery } from "./history-store.js";
import { NameDirectory, namesInQuery } from "./name-directory.js";

const TRANSCRIPT_MODES: readonly TranscriptMode[] = ["off", "errors", "full"];
export const WHEEL_STEP_DEFAULT = 20, WHEEL_STEP_MIN = 5, WHEEL_STEP_MAX = 60;
import { DEFAULT_EDITOR_SETTINGS, type EditorSettings } from "./open.js";
import { ownNpmPrefix } from "./own-runtime.js";
import { getRecipe, installVendorsInto, listRecipes, publicRecipes, type AgentTypeId } from "./recipes.js";
import { AgentManager, type AgentUpdatesView } from "./agent-manager.js";
import type { LoginFlows, LoginFlow } from "./login-flow.js";
import { DEFAULT_ROOM_SETTINGS, pastRoomSettings, upgradeRoomSettings, type RoomSettings } from "./persona.js";
import { CREATED_MODE, type NewRoomPlan } from "./new-room.js";
import { OptionCatalog } from "./option-catalog.js";
import { recipeStamp } from "./install-stamp.js";
import { Room, ROOM_SHUTDOWN_WAIT_MS, type ChatMessage, type DiscoveredOptions, type RoomEvent, type SkillsBridge, type StoredParticipant, type RoomRecovery } from "./room.js";
import { SkillLibrary, type SkillDraft, type SkillMeta } from "./skills.js";
import { TemplateLibrary, roomSettingsFromTemplate, type RoomTemplate } from "./templates.js";
import { LookLibrary, checkLookSpec, loadTokens, type LookCheck, type LookSpec } from "./looks.js";
import { ChannelRouter, type ChannelsView } from "./channels/router.js";
import { ChannelsStore, fileRootRefusal, type FileRoot } from "./channels/state.js";
import { Vault } from "./vault.js";
import { Connections, ConnectionError, type ConnectionView } from "./connections/service.js";
import { commandLine, type LocalLaunch } from "./connections/local-launch.js";
import { checkHeaderNames } from "./connections/mcp-remote.js";
import { ConnectionDesk } from "./connections/desk.js";
import { guardedFetch } from "./connections/outbound.js";
import { SignInError } from "./connections/oauth.js";
import { cleanFace, freshFace } from "./faces.js";
import type { KeyedSystemId } from "./connections/catalog.js";
import { launchOpen, openCommand } from "./open.js";
import { BLOCK_CHARS_MAX, BLOCK_CHARS_MIN, MemoryConfigStore, consentWords, legacyRecallAcrossRooms, memoryReadiness, type MemoryConfigView } from "./memory/config.js";
import { VoiceConfigStore, readingConsentWords, readingReadiness, voiceConsentWords, voiceReadiness } from "./voice/config.js";
import { voiceProvider } from "./voice/registry.js";
import { VoiceService } from "./voice/service.js";
import { MEMORY_PROVIDERS, coerceProviderSettings, providerEntry } from "./memory/registry.js";
import { MemoryPipeline, type MemoryStatus } from "./memory/service.js";
import { MemoryRecoveryActions } from "./memory/recovery-actions.js";
import { configuredAnswerContext, configuredTrialContext, configuredTrialAccountContext, type ConfiguredTrialSelection, type ConfiguredTrialAccountSelection } from "./memory/configured-trial.js";
import { sourceVersion } from "./memory/provenance.js";
import { visibleToAgents } from "./quotes.js";
import { QUESTION_FORMS, isQuestionForm } from "./memory/questions.js";
import { TelegramAdapter, TelegramApiError } from "./channels/telegram.js";
import type { AutostartStatus } from "./autostart.js";

export const FROM_SOURCES = hasSourceTree(import.meta.url);
const HUB_VERSION: string = (() => {
  try {
    return String((createRequire(import.meta.url)("../package.json") as { version?: string }).version ?? "0");
  } catch {
    return "0";
  }
})();

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
import { hasSourceTree } from "./update.js";
import { KEEP_AWAKE, KEEP_AWAKE_DEFAULT, keepAwakeOf, WakeKeeper, type KeepAwake, type KeepAwakeStatus, type NoPower, type Power } from "./keep-awake.js";
import { wakeFullyIfDark } from "./mac-wake.js";
import { AgentImages, type AgentImageState } from "./agent-images.js";

export const SECRET_CARD_MS = 10 * 60_000;

export interface SecretRequest {
  id: string;
  purpose: "telegram-token" | "telegram-pair" | "memory-zep-key" | "memory-sieve-key" | "voice-key" | "consent" | "connection" | "trial-budget";
  trialBudget?: TrialBudgetView;
  consent?: { feature: ConsentFeature; words: string; recipient: string; reader?: "system" | "provider"; changed?: boolean };
  connection?: {
    id: string; name: string; blurb: string; mark?: ConnectionView["mark"]; signingIn?: boolean;
    url?: string;
    command?: string;
    launch?: LocalLaunch;
    keys?: string[];
    keysIn?: "env" | "headers";
    keysSaved?: string[];
    add?: boolean;
  };
  prefill?: { baseUrl?: string; model?: string; provider?: string; language?: string };
  askedBy: { kind: "window" } | { kind: "vibemate"; roomId: string; participantId: string; name: string };
  askedAt: number;
  expiresAt: number;
  state: "open" | "done" | "closed" | "expired";
  outcome?: string;
  refusal?: string;
  link?: { url: string; expiresAt: number; svg: string };
}

export const KEYED_PURPOSE: Record<KeyedSystemId, SecretRequest["purpose"]> = { telegram: "telegram-token", zep: "memory-zep-key", sieve: "memory-sieve-key", voice: "voice-key" };

export const CONSENT_FEATURES = ["memory", "voice", "reading"] as const;
export type ConsentFeature = (typeof CONSENT_FEATURES)[number];
export const CONSENT_FEATURE_WORDS: Record<ConsentFeature, string> = { memory: "the long-term memory", voice: "the voice (recordings made into words)", reading: "reading the replies aloud" };
export const READ_HERE_WORDS = "The replies are read aloud by this computer's own voices, in the window: nothing leaves this computer.";

export function secretLabel(request: Pick<SecretRequest, "purpose" | "connection" | "consent">): string {
  const { purpose } = request;
  if (purpose === "connection" && request.connection?.add) return `${request.connection.name} (${request.connection.url ?? request.connection.command}) to be added as a connection`;
  if (purpose === "connection") return `a sign-in to ${request.connection?.name ?? "a system"}`;
  if (purpose === "consent") return `their consent to ${CONSENT_FEATURE_WORDS[request.consent?.feature ?? "voice"]}`;
  if (purpose === "voice-key") return "the voice provider's key";
  return purpose === "memory-zep-key" ? "the Zep API key" : purpose === "memory-sieve-key" ? "the sieve key" : "the Telegram bot key";
}

export type HubEvent =
  | { type: "automations"; pending: Record<string, number>; jobs: number }
  | { type: "update"; update: UpdateInfo }
  | { type: "agent.updates"; updates: AgentUpdatesView }
  | { type: "room.event"; roomId: string; event: RoomEvent }
  | { type: "room.created"; room: unknown }
  | { type: "room.removed"; roomId: string }
  | { type: "rooms.opened"; roomIds: string[] }
  | { type: "secret"; request: SecretRequest }
  | { type: "settings"; settings: ProgramSettings }
  | { type: "autostart"; autostart: AutostartStatus }
  | { type: "keep-awake"; keepAwake: KeepAwakeStatus }
  | { type: "skills"; skills: SkillMeta[] }
  | { type: "templates" }
  | { type: "looks"; looks: LookSpec[] }
  | { type: "recipes"; recipes: unknown[] }
  | { type: "login"; flow: LoginFlow }
  | { type: "restart"; restart: RestartView | null }
  | { type: "reset" }
  | { type: "channels"; channels: ChannelsView }
  | { type: "picture"; room: string; file: string; state: AgentImageState | null }
  | { type: "connections"; connections: ConnectionView[]; storageProblem?: string | null };

export interface RestartView {
  askedBy: string;
  from: "window" | "telegram" | "discord" | "vibemate";
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

const CHANNEL_RETRY_MS = [5_000, 15_000, 60_000, 300_000];
const RESTART_POLL_MS = 2_000;
const RESTART_GIVE_UP_MS = 30_000;
const RESTART_QUIET_MS = 5 * 60_000;

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const SHUTDOWN_STAGES = ["probe-hold", "ways-in", "transcripts", "rooms-file", "backup", "automations", "background-tasks", "memory", "history"] as const;
export type ShutdownStageName = (typeof SHUTDOWN_STAGES)[number] | `room:${string}`;

export interface ShutdownStep {
  stage: string;
  ms: number;
  timedOut: boolean;
  budget: number;
}

const SHUTDOWN_STAGE_MS = 5_000;
const ROOM_AGENT_MS = 1_000;

export class Hub extends EventEmitter {
  automations: Automations | null = null;
  private automationsUnavailable = "";
  private automationsStarted = false;
  private readonly automationBoot = randomUUID();
  private backgroundTasks: BackgroundTaskStore | null = null;
  private backgroundTaskTimer: ReturnType<typeof setInterval> | null = null;
  private nativeReportTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pendingNativeRooms = new Set<string>();
  private readonly backgroundTaskResults = new Map<string, { confirmed: boolean; messageId: string }>();
  private backgroundTaskFault = "";
  private roomFolderMemo: { key: string; names: ReadonlySet<string> } | null = null;
  private roomFolderReads = 0;
  readonly dataDir: string;
  readonly requestDiagnostics = new RequestTraceRing();
  readonly rooms = new Map<string, Room>();
  readonly skills: SkillLibrary;
  readonly templates: TemplateLibrary;
  readonly looks: LookLibrary;
  readonly history: HistoryStore;
  readonly pictures: AgentImages;
  private readonly staleHistoryRooms = new Set<string>();
  settings: ProgramSettings;
  private readonly log: Logger;
  private readonly optionCatalog = new OptionCatalog();
  private readonly mcpTokens = new Map<string, McpTokenEntry>();
  private hubUrl: string | null = null;
  private run: { id: string; build: string } | null = null;
  private readonly renamedSkills = new Map<string, string>();
  private renamedAttachments = false;
  private readonly skillsBridge: SkillsBridge;

  readonly folderId: string;

  constructor(dataDir: string, log: Logger, initialHumanName?: string, options: { backgroundAgentChecks?: boolean } = {}) {
    super();
    this.dataDir = resolve(dataDir);
    transcriptWriter.resume(this.dataDir);
    this.log = log;
    this.pictures = new AgentImages({ log: log.child("pictures"), onChange: (tag, state) => this.emit("event", { type: "picture", ...tag, state } satisfies HubEvent) });
    installVendorsInto(ownNpmPrefix(this.dataDir));
    ensureDataRoot(this.dataDir);
    mkdirSync(join(this.dataDir, "rooms"), { recursive: true });
    this.folderId = folderIdentity(this.dataDir);
    this.skills = new SkillLibrary(join(this.dataDir, "skills"), log.child("skills"));
    this.templates = new TemplateLibrary(join(this.dataDir, "templates"), log.child("templates"));
    this.looks = new LookLibrary(join(this.dataDir, "looks"), log.child("looks"));
    this.history = this.openHistory();
    onRenameRefused((path, error) => this.log.warn(`the system refuses renames in ${dirname(path)} (${error.code}); files there are written in place instead`));
    onSlowIo((slow) => this.log.warn(slowIoWords(slow)));
    try {
      recoverFileTransactions(this.dataDir, this.history);
    } catch (error) {
      this.log.warn(`${error instanceof Error ? error.message : String(error)} Imports wait until it is; it is tried again before the next one.`);
    }
    this.history.markOwnVersionsOnce(this.folderId);
    this.agents = new AgentManager({
      dataDir: this.dataDir, enabled: () => this.settings.checkAgentUpdates !== false,
      warn: message => this.log.warn(message),
      blockers: vendor => [...this.rooms.values()].flatMap(room => room.agentUpdateBlockers(vendor)),
      prepare: vendor => {
        const blockers = [...this.rooms.values()].flatMap(room => room.agentUpdateBlockers(vendor));
        if (blockers.length) throw new Error(`Wait for these vibemates to finish: ${blockers.join(", ")}`);
        const sessions = [...this.rooms.values()].map(room => room.prepareAgentUpdate(vendor));
        return { pause: async () => { for (const session of sessions) await session.pause(); },
          resume: async () => { for (const session of sessions) await session.resume(); } };
      },
      afterLogin: vendor => { for (const room of this.rooms.values()) room.retryAfterLogin(vendor); },
    });
    this.agents.on("login", (flow: LoginFlow) => this.emit("event", { type: "login", flow } satisfies HubEvent));
    this.agents.on("recipes", recipes => this.emit("event", { type: "recipes", recipes } satisfies HubEvent));
    this.agents.on("updates", updates => this.emit("event", { type: "agent.updates", updates } satisfies HubEvent));
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
      rooms: {
        list: () => [...this.rooms.values()].map((room) => ({ id: room.id, name: room.settings.name })),
        find: (selector) => {
          const byId = this.rooms.get(selector);
          if (byId) return byId;
          const named = [...this.rooms.values()].filter((room) => room.settings.name === selector);
          if (named.length > 1) throw new Error(`room ${JSON.stringify(selector)} is ambiguous; use its id from describe_room's otherRooms`);
          if (!named.length) throw new Error(`no room ${JSON.stringify(selector)}; describe_room's otherRooms lists them`);
          return named[0];
        },
        get: (id) => this.rooms.get(id),
        sharesWith: (readerId, targetId) => {
          const reader = this.rooms.get(readerId), target = this.rooms.get(targetId);
          return !!reader && !!target && this.canReadSharedHistory(reader, target);
        },
      },
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
    if (!FROM_SOURCES || !this.settings.devShowMemoryIngestion) this.history.memoryDebug.clear();
    if (options.backgroundAgentChecks !== false) this.agents.start();
    this.loadRooms();
    try { this.settleArrivingRooms(); }
    catch (error) { this.log.warn(`carry import: ${error instanceof Error ? error.message : String(error)}`); }
    try {
      const store = new AutomationStore(join(this.dataDir, "automations.sqlite"));
      const assignedRoom = (key: string) => [...this.rooms.values()].find(room => room.uuid === key);
      this.automations = new Automations(store, {
        prepare: job => assignedRoom(job.roomKey)?.prepareAutomation(job) ?? Promise.resolve("The room no longer exists."),
        execute: (run, signal) => assignedRoom(run.roomKey)?.executeAutomation(run, signal) ?? Promise.resolve({ status: "interrupted", detail: "The room was removed." }),
      }, () => this.automationsChanged(), message => this.log.warn(message));
    } catch (error) { this.automationsUnavailable = `Automations are unavailable: ${error instanceof Error ? error.message : String(error)}`; this.log.warn(this.automationsUnavailable); }
    try {
      this.backgroundTasks = new BackgroundTaskStore(join(this.dataDir, "background-tasks.sqlite"));
      this.backgroundTaskTimer = setInterval(() => this.flushBackgroundTasks(), 1000);
      this.backgroundTaskTimer.unref();
    } catch (error) { this.backgroundTaskFailure(error); }
    for (const room of this.rooms.values()) {
      try { if (room.hasPendingNativeDelivery()) this.pendingNativeRooms.add(room.id); }
      catch { this.pendingNativeRooms.add(room.id); }
    }
    this.nativeReportTimer = setInterval(() => this.retryNativeDeliveries(), 1000);
    this.nativeReportTimer.unref();
    this.tellRoomsWhatEndedTheLastRun();
    if (this.renamedAttachments) this.saveRooms();
    let vault: Vault | null | undefined;
    const vaultHandle = (): Vault | null => {
      if (vault !== undefined) return vault;
      try {
        vault = Vault.open(this.dataDir);
      } catch (error) {
        vault = null;
        log.child("vault").error(`the vault could not be opened; the stored keys stay unavailable until it can: ${error instanceof Error ? error.message : String(error)}`);
      }
      return vault;
    };
    this.connections = new Connections({
      dataDir: this.dataDir,
      vault: vaultHandle,
      fetch: guardedFetch(),
      openBrowser: (url) => launchOpen(openCommand({ kind: "url", value: url }), (error) => log.child("connections").warn(`the sign-in page could not be opened: ${error.message}`)),
      clientVersion: HUB_VERSION,
      changed: () => this.emit("event", { type: "connections", connections: this.connectionsView(), storageProblem: this.connections.storageProblem } satisfies HubEvent),
      warn: message => log.child("connections").warn(message),
    });
    this.connectionDesk = new ConnectionDesk(this.connections);
    this.channelsStore = new ChannelsStore(join(this.dataDir, "channels.json"), vaultHandle, message => log.child("channels").warn(message));
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
        hear: (room, sounds) => this.voice.hearAll(sounds, room.speechNames()),
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
    this.voice = new VoiceService(new VoiceConfigStore(join(this.dataDir, "voice.json"), vaultHandle), log.child("voice"));
    this.memoryStore = new MemoryConfigStore(join(this.dataDir, "memory.json"), vaultHandle);
    const memoryLog = log.child("memory");
    const memoryRoomView = (room: Room) => ({ id: room.id, uuid: room.uuid, name: room.name, remembers: room.settings.remembers === true,
      input: room.settings.memoryInput, originalInput: room.settings.memoryInput === "whole" && this.memoryStore.get().provider === "zep", readsOtherRooms: room.settings.readsOtherRooms });
    this.memory = new MemoryPipeline({
      outbox: this.history.memoryOutbox,
      debug: this.history.memoryDebug,
      debugEnabled: () => FROM_SOURCES && this.settings.devShowMemoryIngestion,
      history: this.history,
      folderId: this.folderId,
      recoveryAuthorized: job => this.history.memoryOutbox.recoveryHuman.buildAuthorized(job),
      recoveryReviewAuthorized: (report, id, fingerprint) => this.history.memoryOutbox.recoveryHuman.reviewAuthorized(report, id, fingerprint),
      recoveryPreparationAuthorized: (preview, id) => this.history.memoryOutbox.recoveryHuman.preparationAuthorized(preview, id),
      recoveryPublicationAuthorized: (preview, id) => this.history.memoryOutbox.recoveryHuman.publicationAuthorized(preview, id),
      recoveryCompletionAuthorized: (preview, id) => this.history.memoryOutbox.recoveryHuman.completionAuthorized(preview, id),
      rooms: () => [...this.rooms.values()].map(memoryRoomView),
      room: (id) => { const room = this.rooms.get(id); return room ? memoryRoomView(room) : null; },
      searchPool: (roomId) => this.roomsForAgentSearch(roomId).flatMap(({ id }) => { const room = this.rooms.get(id); return room ? [memoryRoomView(room)] : []; }),
      config: () => this.memoryStore.get(),
      provider: async (config) => {
        const entry = providerEntry(config.provider);
        if (!entry) throw new Error("no memory provider is configured");
        return entry.load(config.providers[entry.id] ?? {});
      },
      note: (roomId, text) => void this.rooms.get(roomId)?.serviceEvent(text),
      log: { info: m => memoryLog.info(m), warn: m => memoryLog.warn(m), error: m => memoryLog.error(m) },
    });
    this.memoryRecovery = new MemoryRecoveryActions(this.memory, this.history.memoryOutbox, id => this.rooms.has(id));
    this.on("event", (event: HubEvent) => {
      if (event.type !== "room.event") return;
      const inner = event.event;
      if (inner.type === "message" && inner.message.kind === "chat" && !inner.message.streaming) {
        const edited = inner.message.edited;
        if (edited) this.memory.edited(event.roomId, inner.message.id, edited.ts);
        else this.memory.messageLanded(event.roomId, inner.message.seq);
      } else if (inner.type === "messages.truncated") {
        this.memory.truncated(event.roomId, inner.fromSeq);
      } else if (inner.type === "message" && inner.message.kind === "system" && inner.message.details?.renamed) {
        const { from, to } = inner.message.details.renamed;
        this.memory.fact(event.roomId, from, "is also known as", to);
      } else if (inner.type === "room") {
        this.memory.roomSettingsChanged(event.roomId);
      }
    });
  }

  readonly voice: VoiceService;
  readonly memoryStore: MemoryConfigStore;
  readonly memory: MemoryPipeline;
  readonly memoryRecovery: MemoryRecoveryActions;

  memoryTrialContext(selection: ConfiguredTrialSelection) {
    return configuredTrialContext({ memory: this.memory, memoryStore: this.memoryStore }, selection);
  }

  memoryTrialAccountContext(selection: ConfiguredTrialAccountSelection) {
    return configuredTrialAccountContext({ memory: this.memory, memoryStore: this.memoryStore }, selection);
  }

  memoryAnswerContext(selection: ConfiguredTrialAccountSelection) {
    return configuredAnswerContext({ memoryStore: this.memoryStore }, selection);
  }

  privateTrialNamespaceUnregistered(roomIds: readonly string[], roomUuids: readonly string[], options: { fresh?: boolean } = {}): boolean {
    if (roomIds.length !== 20 || roomUuids.length !== 20 || new Set(roomIds).size !== 20 || new Set(roomUuids).size !== 20) return false;
    for (const id of roomIds) if (!/^trial:[0-9a-f-]{36}:[0-9a-f-]{36}$/.test(id) || ROOM_ID_PATTERN.test(id) ||
      this.rooms.has(id) || this.arriving.has(id)) return false;
    for (const room of this.rooms.values()) if (roomUuids.includes(room.uuid)) return false;
    if (this.arriving.size !== 0) return false;
    const names = this.roomFolderNames(join(this.dataDir, "rooms"), options.fresh === true);
    return !roomIds.some(id => names.has(id));
  }

  private roomFolderNames(directory: string, fresh: boolean): ReadonlySet<string> {
    const key = () => { const s = statSync(directory, { bigint: true, throwIfNoEntry: false }); return s ? { text: `${s.mtimeNs}:${s.ctimeNs}:${s.ino}`, mtimeMs: Number(s.mtimeNs / 1_000_000n) } : null; };
    const before = key();
    if (before === null) { this.roomFolderMemo = null; return new Set(); }
    if (!fresh && this.roomFolderMemo?.key === before.text) return this.roomFolderMemo.names;
    this.roomFolderReads++;
    const names: ReadonlySet<string> = new Set(readdirSync(directory)), after = key();
    this.roomFolderMemo = after?.text === before.text && Date.now() - before.mtimeMs >= 2000 ? { key: before.text, names } : null;
    return names;
  }

  privateTrialRoomFolderReads(): number { return this.roomFolderReads; }

  async setMemory(patch: { provider?: unknown; settings?: unknown; consent?: unknown; filterMode?: unknown; filterBaseUrl?: unknown; filterApiKey?: unknown; filterModel?: unknown; filterForm?: unknown; blockChars?: unknown }): Promise<{ view: MemoryConfigView; status: MemoryStatus; verified?: { ok: boolean; reason?: string } }> {
    if (patch.provider !== undefined && patch.provider !== "off" && !providerEntry(String(patch.provider))) throw new Error(`memory provider must be off or one of: ${MEMORY_PROVIDERS.map(e => e.id).join(", ")}`);
    if (patch.settings !== undefined && (typeof patch.settings !== "object" || patch.settings === null || Array.isArray(patch.settings))) throw new Error("settings must be an object of the provider's fields");
    if (patch.consent !== undefined && typeof patch.consent !== "boolean") throw new Error("consent must be true or false");
    if (patch.blockChars !== undefined && !(Number.isInteger(patch.blockChars) && (patch.blockChars as number) >= BLOCK_CHARS_MIN && (patch.blockChars as number) <= BLOCK_CHARS_MAX)) throw new Error(`blockChars must be a whole number from ${BLOCK_CHARS_MIN} to ${BLOCK_CHARS_MAX}`);
    if (patch.filterMode !== undefined && patch.filterMode !== "off" && patch.filterMode !== "heuristic" && patch.filterMode !== "llm") throw new Error("filter mode must be off, heuristic or llm");
    if (patch.filterForm !== undefined && !(typeof patch.filterForm === "string" && isQuestionForm(patch.filterForm))) throw new Error(`filterForm must be one of: ${QUESTION_FORMS.join(", ")}`);
    for (const [key, value] of [["filterBaseUrl", patch.filterBaseUrl], ["filterApiKey", patch.filterApiKey], ["filterModel", patch.filterModel]] as const) {
      if (value !== undefined && typeof value !== "string") throw new Error(`${key} must be text`);
    }
    const targetId = patch.provider !== undefined ? String(patch.provider) : this.memoryStore.get().provider;
    const target = providerEntry(targetId);
    if (patch.settings !== undefined && !target) throw new Error("choose a provider before its settings");
    const settings = patch.settings !== undefined && target
      ? coerceProviderSettings(target, this.memoryStore.get().providers[target.id] ?? {}, patch.settings as Record<string, unknown>)
      : null;
    this.memoryStore.update((s) => {
      if (patch.provider !== undefined) s.provider = targetId;
      if (settings && target) s.providers[target.id] = settings;
      if (patch.filterMode !== undefined) s.filter.mode = patch.filterMode as "off" | "heuristic" | "llm";
      if (typeof patch.filterBaseUrl === "string" && patch.filterBaseUrl.trim()) s.filter.baseUrl = patch.filterBaseUrl.trim();
      if (typeof patch.filterApiKey === "string" && patch.filterApiKey.trim()) s.filter.apiKey = patch.filterApiKey.trim();
      if (typeof patch.filterModel === "string") s.filter.model = patch.filterModel.trim();
      if (typeof patch.filterForm === "string" && isQuestionForm(patch.filterForm)) s.filter.form = patch.filterForm;
      if (typeof patch.blockChars === "number") s.blockChars = patch.blockChars;
      if (patch.consent === true && target) {
        const words = consentWords(target, s.filter);
        if (s.consent[target.id]?.words !== words) s.consent[target.id] = { at: Date.now(), words };
      }
      if (patch.consent === false && target) delete s.consent[target.id];
    });
    this.memory.configChanged();
    let verified: { ok: boolean; reason?: string } | undefined;
    const config = this.memoryStore.get();
    const entry = providerEntry(config.provider);
    if (entry && (patch.settings !== undefined || patch.provider !== undefined)) {
      const section = config.providers[entry.id] ?? {};
      if (entry.fields.some(f => f.kind === "secret" && String(section[f.key] ?? ""))) {
        const result = await (await entry.load(section)).verify();
        verified = result.ok ? { ok: true } : { ok: false, reason: result.reason };
      }
    }
    return { view: this.memoryStore.describe(), status: this.memory.status(), ...(verified ? { verified } : {}) };
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
  private servicesStarted: Promise<string[]> | null = null;
  private stopThreadWatch: (() => void) | null = null;

  startServices(options: { url: string; run: { id: string; build: string }; afterRestart?: boolean; reconnectMode?: "load" | "replay" }): Promise<string[]> {
    if (this.servicesStarted) return this.servicesStarted;
    this.setRun(options.run);
    this.setHubUrl(options.url);
    this.stopThreadWatch = watchThread((ms, kind) => this.log.warn(`the hub's event-loop tick was ${ms} ms late${kind === "long-gap" ? "; a long gap may be suspension or a stalled thread" : ""}`));
    this.startBackups();
    void this.startChannels();
    this.memory.start();
    if (options.afterRestart) this.noteBackAfterRestart(options.run.build);
    const mode = options.reconnectMode;
    return this.servicesStarted = this.startRoomsAtBoot(mode ? (room, id) => room.reconnect(id, { mode }) : undefined, { afterRestart: options.afterRestart }).then(started => {
      if (!this.leaving.signal.aborted) {
        const trial = startProductionPrivateTrial(this);
        if (trial) void trial.then(outcome => {
          if (outcome.state === "OFFERED") this.log.info("private-trial whole-budget offer available");
          else if (outcome.reason === "deployment_outdated") this.log.warn("private-trial deployment outdated: recreate it (node scripts/private-trial-deploy.mjs)");
          else this.log.warn("private-trial startup refused");
        });
      }
      return started;
    });
  }

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
      let skippedMuted = 0;
      try {
        for (const p of offline) {
          if (p.asleep) { skippedMuted++; continue; }
          if (p.muted) { room.noteMutedStartup(p.id); skippedMuted++; continue; }
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
      room.noteStartedWithHub(this.reconnectModeFor(room), skippedMuted);
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

  requestRestart(input: { askedBy: string; from: RestartView["from"]; room?: string; sessions?: "load" | "replay"; when: "now" | "idle" }): RestartView {
    if (!this.restartWith) throw new Error("this viberoom cannot restart itself");
    if (this.restart) return this.restartPending()!;
    const waiting = input.when === "idle" ? this.writingNow() : [];
    this.restart = { askedBy: input.askedBy, from: input.from, ...(input.sessions ? { sessions: input.sessions } : {}), since: Date.now(), waitingFor: waiting, timer: null, marks: this.writingMarks(), quietSince: Date.now(), toldOfWait: false };
    const where = input.from === "window" ? "" : input.from === "vibemate" ? (input.room ? ` from the room ${input.room}` : "")
      : ` from ${input.from === "telegram" ? "Telegram" : "Discord"}`;
    this.recordEverywhere(waiting.length
      ? `${input.askedBy} asked${where} for viberoom to restart when ${nameList(waiting)} ${waiting.length > 1 ? "finish" : "finishes"}.`
      : `${input.askedBy} asked${where} for viberoom to restart now; a reply being written this moment is cut short.`);
    this.announceRestart();
    const accepted = this.restartPending()!;
    if (waiting.length) this.restart.timer = setInterval(() => this.checkRestart(), RESTART_POLL_MS).unref();
    else this.goRestart();
    return accepted;
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
  readonly connections: Connections;
  readonly connectionDesk: ConnectionDesk;

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
  private readonly trialBudgetSessions = new WeakMap<SecretRequest, TrialBudgetCard>();

  askTrialBudget(subject: TrialBudgetSubject): SecretRequest {
    const session = new TrialBudgetCard(subject);
    const open = [...this.secrets.values()].find(r => r.state === "open" && r.purpose === "trial-budget" &&
      r.trialBudget?.cardSha256 === session.view.cardSha256);
    if (open) return structuredClone(open);
    const request: SecretRequest = { id: randomUUID(), purpose: "trial-budget", askedBy: { kind: "window" },
      askedAt: session.view.offeredAt, expiresAt: session.view.offerExpiresAt, state: "open", trialBudget: session.view };
    this.secrets.set(request.id, request); this.trialBudgetSessions.set(request, session);
    this.emit("event", { type: "secret", request: structuredClone(request) } satisfies HubEvent);
    const timer = setTimeout(() => this.expireSecrets(), request.expiresAt - Date.now() + 50); timer.unref();
    return structuredClone(request);
  }

  decideTrialBudget(id: string, body: unknown): SecretRequest {
    const request = this.secrets.get(id), session = request && this.trialBudgetSessions.get(request);
    if (!request || request.purpose !== "trial-budget" || request.state !== "open" || !session)
      throw new Error("trial_budget_card_unavailable");
    try {
      const outcome = session.decide(body);
      request.outcome = outcome.state === "claimed" ? `Whole comparison claimed once: ${outcome.claimId}` : "not now";
      this.settleSecret(request, outcome.state === "claimed" ? "done" : "closed");
      return structuredClone(request);
    } catch {
      request.refusal = "The exact whole-budget decision was refused; no new grant is available.";
      if (session.outcome().phase === "closed") { request.outcome = session.outcome().reason ?? "refused"; this.settleSecret(request, "closed"); }
      this.emit("event", { type: "secret", request: structuredClone(request) } satisfies HubEvent);
      throw new Error("trial_budget_decision_refused");
    }
  }

  private revokeTrialBudgetCards(reason: string): void {
    for (const request of this.secrets.values()) {
      if (request.purpose !== "trial-budget") continue;
      this.trialBudgetSessions.get(request)?.close(reason);
      if (request.state === "open") { request.outcome = reason; this.settleSecret(request, "closed"); }
    }
  }

  revokeTrialBudget(id: string): SecretRequest {
    const request = this.secrets.get(id), session = request && this.trialBudgetSessions.get(request);
    if (!request || request.purpose !== "trial-budget" || !session) throw new Error("trial_budget_card_unavailable");
    session.close("human_revoked"); request.outcome = "Whole comparison authority withdrawn";
    if (request.state === "open") this.settleSecret(request, "closed");
    else this.emit("event", { type: "secret", request: structuredClone(request) } satisfies HubEvent);
    return structuredClone(request);
  }



  openSecrets(): SecretRequest[] {
    return [...this.secrets.values()].filter((r) => r.state === "open").map(r => r.purpose === "trial-budget" ? structuredClone(r) : r);
  }

  askSecret(purpose: SecretRequest["purpose"], askedBy: SecretRequest["askedBy"], prefill?: SecretRequest["prefill"], connection?: SecretRequest["connection"], consent?: SecretRequest["consent"]): SecretRequest {
    const key = (c?: SecretRequest["connection"]) => c?.add ? `+${c.url ?? c.command}` : c?.id;
    const open = this.openSecrets().find((r) => r.purpose === purpose && (purpose !== "connection" || key(r.connection) === key(connection)) && (purpose !== "consent" || r.consent?.feature === consent?.feature));
    if (open) return open;
    const now = Date.now();
    const request: SecretRequest = { id: randomBytes(9).toString("base64url"), purpose, askedBy, askedAt: now, expiresAt: now + SECRET_CARD_MS, state: "open" };
    if (connection) request.connection = { ...connection };
    if (consent) request.consent = { ...consent };
    const given = Object.entries(prefill ?? {}).filter(([, value]) => typeof value === "string" && value !== "");
    if (given.length) request.prefill = Object.fromEntries(given);
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
        : `${askedBy.name} asked for ${secretLabel(request)}: a card is on ${human}'s screen.`);
    }
    const timer = setTimeout(() => this.expireSecrets(), request.expiresAt - now + 50);
    timer.unref();
    return request;
  }

  async answerSecret(id: string, value: string): Promise<SecretRequest> {
    const request = this.secrets.get(id);
    if (!request || request.state !== "open") throw new Error("that card is no longer open");
    if (request.purpose === "trial-budget") throw new Error("trial_budget_exact_decision_required");
    if (request.purpose === "telegram-pair" || request.purpose === "connection" || request.purpose === "consent") throw new Error("that card takes no value");
    if (!value && !(request.purpose === "voice-key" && request.prefill?.provider === "compatible")) throw new Error("the card is empty: paste the key, or close it without one");
    try {
      if (request.purpose === "voice-key") {
        const provider = request.prefill?.provider ?? "openai";
        const entry = voiceProvider(provider);
        if (!entry) throw new Error(`"${provider}" is not a voice provider`);
        const settings = { ...(value ? { apiKey: value } : {}), ...(request.prefill?.baseUrl ? { baseUrl: request.prefill.baseUrl } : {}), ...(request.prefill?.model ? { model: request.prefill.model } : {}) };
        const proven = await this.voice.proveKey(provider, settings);
        this.voice.set({ provider, settings, ...(request.prefill?.language ? { language: request.prefill.language } : {}) });
        request.outcome = proven ? `${entry.label} is chosen, its key in the vault, and it answers` : `${entry.label} is chosen${value ? ", its key in the vault" : ""}`;
      } else if (request.purpose === "telegram-token") {
        const view = await this.setTelegram({ token: value, enabled: true });
        const tg = view.telegram;
        if (!tg || (tg.state !== "connected" && tg.state !== "listening")) throw new Error(tg?.detail || "the bot did not start");
        request.outcome = `connected as @${tg.account}`;
      } else if (request.purpose === "memory-zep-key") {
        const result = await this.setMemory({ provider: "zep", settings: { apiKey: value } });
        if (result.verified && !result.verified.ok) throw new Error(result.verified.reason || "Zep did not accept the key");
        request.outcome = "the Zep key is in the vault and the provider answers";
      } else {
        await this.setMemory({
          filterMode: "llm", filterApiKey: value,
          ...(request.prefill?.baseUrl ? { filterBaseUrl: request.prefill.baseUrl } : {}),
          ...(request.prefill?.model ? { filterModel: request.prefill.model } : {}),
        });
        request.outcome = "the sieve key is in the vault";
      }
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
    if (request.purpose === "trial-budget") {
      this.trialBudgetSessions.get(request)?.close(); request.outcome = "not now";
      this.settleSecret(request, "closed"); return structuredClone(request);
    }
    if (request.purpose === "telegram-pair") {
      request.outcome = options.copied ? "closed: the link was copied and stays good until it runs out" : "closed without pairing";
      this.settleSecret(request, "closed");
      if (!options.copied) this.channels.cancelPairLink("telegram");
      return request;
    }
    if (request.purpose === "connection" || request.purpose === "consent") {
      if (request.connection) this.connections.cancelSignIn(request.connection.id);
      request.outcome = "not now";
      this.settleSecret(request, "closed");
      return request;
    }
    request.outcome = "closed without a key";
    this.settleSecret(request, "closed");
    return request;
  }

  askConsent(feature: ConsentFeature, askedBy: SecretRequest["askedBy"], reader?: "system" | "provider"): SecretRequest | null {
    const who = feature === "reading" ? reader ?? "provider" : undefined;
    if (this.featureOn(feature, who)) return null;
    return this.askSecret("consent", askedBy, undefined, undefined, { feature, words: this.consentWordsNow(feature, who), recipient: this.consentRecipient(feature, who), ...(who ? { reader: who } : {}) });
  }

  private consentRecipient(feature: ConsentFeature, reader?: "system" | "provider"): string {
    if (feature === "memory") return providerEntry(this.memoryStore.get().provider)?.label ?? "the provider";
    if (feature === "reading" && reader === "system") return "this computer's own voices";
    const entry = voiceProvider(this.voice.store.get().provider);
    return !entry ? "the provider" : entry.id === "compatible" ? "your own server" : entry.label;
  }

  private featureOn(feature: ConsentFeature, reader?: "system" | "provider"): boolean {
    if (feature === "memory") return memoryReadiness(this.memoryStore.get()).ready;
    const state = this.voice.store.get();
    if (feature === "voice") return voiceReadiness(state).ready;
    return state.reading.reader === reader && readingReadiness(state).ready;
  }

  private consentWordsNow(feature: ConsentFeature, reader?: "system" | "provider"): string {
    if (feature === "memory") {
      const state = this.memoryStore.get();
      const entry = providerEntry(state.provider);
      if (!entry) throw new Error("no memory provider is chosen yet: its key card, or Settings → Long-term memory, comes first");
      return consentWords(entry, state.filter);
    }
    if (feature === "reading" && reader === "system") return READ_HERE_WORDS;
    const state = this.voice.store.get();
    const entry = voiceProvider(state.provider);
    if (!entry) throw new Error("no voice provider is chosen yet: its key card, or Settings → Voice, comes first");
    const settings = state.providers[entry.id] ?? {};
    return feature === "voice" ? voiceConsentWords(entry, settings) : readingConsentWords(entry, settings);
  }

  private async applyConsent(feature: ConsentFeature, reader?: "system" | "provider"): Promise<string> {
    if (feature === "memory") await this.setMemory({ consent: true });
    else if (feature === "voice") this.voice.set({ consent: true });
    else this.voice.set({ reading: reader === "system" ? { reader: "system" } : { reader: "provider", consent: true } });
    return this.featureState(feature);
  }

  async agreeTo(feature: ConsentFeature, words: string, reader?: "system" | "provider"): Promise<string> {
    const who = feature === "reading" ? reader ?? "provider" : undefined;
    if (words !== this.consentWordsNow(feature, who)) throw new Error("What leaves this computer changed since the page showed it: read the words again.");
    return this.applyConsent(feature, who);
  }

  async withdrawConsent(feature: ConsentFeature): Promise<void> {
    if (feature === "memory") await this.setMemory({ consent: false });
    else if (feature === "voice") this.voice.set({ consent: false });
    else this.voice.set({ reading: { consent: false } });
  }

  private featureState(feature: ConsentFeature): string {
    const readiness = feature === "memory" ? memoryReadiness(this.memoryStore.get()) : feature === "voice" ? voiceReadiness(this.voice.store.get()) : readingReadiness(this.voice.store.get());
    const name = CONSENT_FEATURE_WORDS[feature];
    return readiness.ready ? `${name} is on` : `${name} is not on yet: ${readiness.reason}`;
  }

  async giveConsent(id: string): Promise<SecretRequest> {
    const request = this.secrets.get(id);
    if (!request || request.state !== "open" || request.purpose !== "consent" || !request.consent) throw new Error("that card is no longer open");
    const { feature, reader } = request.consent;
    try {
      const words = this.consentWordsNow(feature, reader);
      if (words !== request.consent.words) {
        request.consent.words = words;
        request.consent.recipient = this.consentRecipient(feature, reader);
        request.consent.changed = true;
        throw new Error("What leaves this computer changed since the card opened: read the words again.");
      }
      request.outcome = await this.applyConsent(feature, reader);
    } catch (error) {
      request.refusal = error instanceof Error ? error.message : String(error);
      this.emit("event", { type: "secret", request } satisfies HubEvent);
      throw error;
    }
    request.refusal = undefined;
    this.settleSecret(request, "done");
    return request;
  }

  connectionsView(): ConnectionView[] {
    const ids = new Map([...this.rooms.values()].map((room) => [room.uuid, room.id]));
    return this.connections.view().map((view) => view.offInRooms ? { ...view, offInRooms: view.offInRooms.flatMap((uuid) => ids.has(uuid) ? [ids.get(uuid)!] : []) } : view);
  }

  askConnection(id: string, askedBy: SecretRequest["askedBy"]): SecretRequest {
    const view = this.connections.view().find((v) => v.id === id);
    if (!view) throw new ConnectionError(`"${id}" is not a system viberoom connects to`, "unknown-tool");
    return this.askSecret("connection", askedBy, undefined, {
      id, name: view.name, blurb: view.blurb, mark: view.mark, ...(view.url ? { url: view.url } : {}),
      ...(view.command ? { command: view.command } : {}),
      ...(view.keys?.length ? { keys: view.keys, keysIn: view.keysIn, keysSaved: this.connections.savedKeys(id) } : {}),
    });
  }

  askAddConnection(name: string, url: string, askedBy: SecretRequest["askedBy"], headers: readonly string[] = []): { request: SecretRequest; known: boolean } {
    const known = this.connections.findByUrl(url);
    if (known) return { request: this.askConnection(known, askedBy), known: true };
    const label = name.trim().replace(/\s+/g, " ");
    if (!label || label.length > 60) throw new ConnectionError("give the server a name of 1 to 60 characters", "failed");
    const href = new URL(url.trim()).href;
    const keys = checkHeaderNames([...headers]);
    return {
      request: this.askSecret("connection", askedBy, undefined, { id: "", name: label, blurb: new URL(href).host, url: href, ...(keys.length ? { keys, keysIn: "headers" as const } : {}), add: true }),
      known: false,
    };
  }

  askAddLocalConnection(name: string, launch: LocalLaunch, env: readonly string[], askedBy: SecretRequest["askedBy"]): { request: SecretRequest; known: boolean } {
    const known = this.connections.findByLaunch(launch);
    if (known) return { request: this.askConnection(known, askedBy), known: true };
    const label = name.trim().replace(/\s+/g, " ");
    if (!label || label.length > 60) throw new ConnectionError("give the server a name of 1 to 60 characters", "failed");
    const command = commandLine(launch);
    return { request: this.askSecret("connection", askedBy, undefined, { id: "", name: label, blurb: "a program on this computer", command, launch: { ...launch, args: [...launch.args] }, ...(env.length ? { keys: [...env], keysIn: "env" as const } : {}), add: true }), known: false };
  }

  async connectCard(cardId: string, keys: Record<string, unknown> = {}): Promise<ConnectionView> {
    const card = this.openSecrets().find((r) => r.id === cardId);
    if (!card?.connection) throw new Error("that card is no longer open");
    try {
      if (card.connection.add) {
        card.connection.id = card.connection.launch
          ? this.connections.addOwnLocal(card.connection.name, card.connection.launch, card.connection.keys ?? [])
          : this.connections.addOwn(card.connection.name, card.connection.url!, card.connection.keys ?? []);
        card.connection.add = false;
      }
      if (card.connection.keys?.length) await this.connections.setKeys(card.connection.id, keys);
    } catch (error) {
      card.refusal = error instanceof Error ? error.message : String(error);
      this.emit("event", { type: "secret", request: card } satisfies HubEvent);
      throw error;
    }
    return this.connectSystem(card.connection.id, card.id);
  }

  async connectSystem(id: string, cardId?: string): Promise<ConnectionView> {
    const request = cardId ? this.secrets.get(cardId) : undefined;
    if (cardId && (!request || request.state !== "open" || request.purpose !== "connection" || request.connection?.id !== id)) throw new Error("that card is no longer open");
    if (request?.connection) {
      request.connection.signingIn = true;
      request.refusal = undefined;
      this.emit("event", { type: "secret", request } satisfies HubEvent);
    }
    try {
      const view = await this.connections.connect(id);
      const tools = view.tools ?? [];
      const reads = tools.filter((t) => t.rule === "read").length;
      this.log.info(`connection ${id}: connected, ${tools.length} tools`);
      for (const card of this.openSecrets()) {
        if (card.purpose !== "connection" || card.connection?.id !== id) continue;
        card.outcome = `connected, ${tools.length} tools (${reads} read, ${tools.length - reads} write and ask first)`;
        this.settleSecret(card, "done");
      }
      return view;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`connection ${id}: the sign-in did not finish: ${message}`);
      if (request?.connection && request.state === "open") {
        request.connection.signingIn = false;
        request.refusal = error instanceof SignInError && error.kind === "cancelled" ? `Not connected: ${message}.` : `The sign-in failed: ${message}.`;
        this.emit("event", { type: "secret", request } satisfies HubEvent);
      }
      throw error;
    }
  }

  private settlePairingCards(name: string): void {
    for (const request of this.openSecrets()) {
      if (request.purpose !== "telegram-pair") continue;
      request.outcome = `paired: ${name}`;
      this.settleSecret(request, "done");
    }
  }

  expireSecrets(now = Date.now()): void {
    for (const request of this.secrets.values()) {
      if (request.state !== "open") continue;
      if (request.expiresAt > now) continue;
      if (request.purpose === "trial-budget") this.trialBudgetSessions.get(request)?.close("offer_expired");
      if (request.purpose === "connection" && request.connection) this.connections.cancelSignIn(request.connection.id);
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
      room.cardOutcome(
        state === "done" ? `${human} paired the phone from the card: ${request.outcome}.`
          : state === "closed" ? `${human}'s pairing card closed: ${request.outcome}.`
          : "The pairing card was not used within ten minutes and closed by itself.",
        request.askedBy.participantId,
      );
      return;
    }
    if (request.purpose === "consent") {
      const feature = CONSENT_FEATURE_WORDS[request.consent?.feature ?? "voice"];
      room.cardOutcome(
        state === "done" ? `${human} gave their consent on the card: ${request.outcome}.`
          : state === "closed" ? `${human} closed the card for ${feature}: not now.`
          : `The card for ${feature} was not answered within ten minutes and closed by itself.`,
        request.askedBy.participantId,
      );
      return;
    }
    room.cardOutcome(
      state === "done" ? (request.purpose === "connection" ? `${human} connected ${request.connection?.name} from the card: ${request.outcome}.`
        : request.purpose === "voice-key" ? `${human} saved the voice provider's card: ${request.outcome}.`
        : `${human} entered ${secretLabel(request)} on the card: ${request.outcome}.`)
        : state === "closed" ? (request.purpose === "connection" ? `${human} closed the ${request.connection?.name} card: ${request.outcome}.` : `${human} closed the key card without a key.`)
        : "The key card was not answered within ten minutes and closed by itself.",
      request.askedBy.participantId,
    );
  }

  setRun(run: { id: string; build: string }): void {
    this.run = run;
  }

  setHubUrl(url: string): void {
    this.hubUrl = url.replace(/\/+$/, "");
    if (this.automations && !this.automationsStarted) {
      this.automationsStarted = true;
      for (const room of this.rooms.values()) this.automationEvent(room, "room-start");
      this.automations.start();
    }
  }

  private automationEvent(room: Room, event: "first-human-message" | "room-start"): void {
    try {
      if (this.automations?.store.event(room.uuid, event, this.automationBoot, Date.now())) this.automationsChanged();
    } catch (error) { this.log.warn(`Automation event could not be recorded: ${String(error)}`); }
  }

  private automationPending(): Record<string, number> {
    try { return Object.fromEntries([...this.rooms.values()].map(room => [room.id, room.readOnly ? 0 : this.automations?.store.proposals(room.uuid).filter(p => p.status === "pending").length ?? 0])); }
    catch { return {}; }
  }
  private automationJobs(): number {
    try { return this.automations?.store.jobCount() ?? 0; }
    catch { return 0; }
  }
  private automationsChanged(): void { this.emit("event", { type: "automations", pending: this.automationPending(), jobs: this.automationJobs() } satisfies HubEvent); }

  private automationStore(): AutomationStore {
    if (!this.automations) throw new Error(this.automationsUnavailable || "Automations are unavailable.");
    return this.automations.store;
  }
  automationView(roomId: string) {
    const room = this.getRoom(roomId), store = this.automations?.store;
    if (room.readOnly) throw new Error("Resolve the room's history decision before accessing automations.");
    if (!store) return { available: false, error: this.automationsUnavailable, jobs: [], runs: [], proposals: [] };
    return { available: true, error: this.automations!.error, participants: [...room.participants.values()].filter(p => p.kind === "agent" && p.status !== "left").map(p => ({ id: p.id, name: p.name, status: p.status, muted: !!p.muted, avatar: p.avatar, color: p.color, colorSlot: p.colorSlot })), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: Date.now(), jobs: store.jobs(room.uuid),
      runs: store.runs(room.uuid).map(run => ({ ...run, stopping: this.automations!.stopping(run.id) })),
      proposals: store.proposals(room.uuid).filter(proposal => proposal.status === "pending") };
  }
  previewAutomation(roomId: string, schedule: unknown) {
    this.getRoom(roomId);
    const parsed = parseSchedule(schedule);
    return { schedule: parsed, times: previewSchedule(parsed, Date.now()) };
  }
  saveAutomation(roomId: string, raw: unknown, id: string | null, revision: number | null) {
    const room = this.getRoom(roomId), parsed = parseAutomation(raw, Date.now(), !id);
    this.validateAutomationTarget(room, parsed.targetId);
    const job = this.automationStore().save(room.uuid, parsed, id, revision, Date.now());
    this.automationsChanged(); return job;
  }
  private automationTargets(roomUuid: string): string[] {
    const store = this.automations?.store;
    if (!store) return [];
    const definitions = [...store.jobs(roomUuid), ...store.proposals(roomUuid).filter((p) => p.status === "pending").map((p) => p.definition)];
    return definitions.flatMap((d) => (d.targetId ? [d.targetId] : []));
  }
  private validateAutomationTarget(room: Room, targetId: string | null): void {
    if (room.readOnly) throw new Error("Resolve the room's history decision before changing automations.");
    if (!targetId) return;
    const participant = room.participants.get(targetId);
    if (!participant || participant.kind !== "agent" || participant.status === "left") throw new Error("Choose a vibemate in this room.");
  }
  proposeAutomation(roomId: string, participantId: string, raw: unknown, why: string, id: string | null, revision: number | null) {
    const room = this.getRoom(roomId), parsed = parseAutomation(raw);
    this.validateAutomationTarget(room, parsed.targetId);
    const participant = room.participants.get(participantId);
    if (!participant || participant.kind !== "agent") throw new Error("Unknown proposing participant.");
    const proposal = this.automationStore().propose(room.uuid, participant.name, why, parsed, id, revision, Date.now());
    room.automationNotice(`${participant.name} proposed an automation: ${parsed.name}. Review it in Automations.`);
    this.automationsChanged(); return proposal;
  }
  automationAction(roomId: string, action: string, id: string, revision?: number, apply?: boolean) {
    const room = this.getRoom(roomId), store = this.automationStore();
    if (room.readOnly) throw new Error("Resolve the room's history decision before changing automations.");
    let result: unknown = { ok: true };
    if (action === "run") {
      if (store.get(room.uuid, id).revision !== revision) throw new Error("This automation changed. Review it before running.");
      result = store.manual(room.uuid, id, Date.now());
    }
    else if (action === "delete") store.remove(room.uuid, id, Number(revision), Date.now());
    else if (action === "cancel") this.automations!.cancel(room.uuid, id);
    else if (action === "resolve") {
      const proposal = store.proposals(room.uuid).find(p => p.id === id);
      if (apply && proposal) this.validateAutomationTarget(room, proposal.definition.targetId);
      result = store.resolve(room.uuid, id, apply === true, Date.now());
    } else throw new Error("Unknown automation action.");
    this.automationsChanged();
    queueMicrotask(() => { void this.automations?.tick(); });
    return result;
  }

  resolveMcpToken(token: string): { room: Room; participantId: string } | null {
    const entry = this.mcpTokens.get(token);
    if (!entry) return null;
    const room = this.rooms.get(entry.roomId);
    return room ? { room, participantId: entry.participantId } : null;
  }

  private backgroundTaskFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== this.backgroundTaskFault) this.log.warn(`Background tasks: ${message}`);
    this.backgroundTaskFault = message;
  }

  private withBackgroundTasks<T>(action: (store: BackgroundTaskStore) => T): T {
    if (this.leaving.signal.aborted || !this.backgroundTasks)
      throw new AgentMessageError(503, "unconfirmed_result", "Background tasks are unavailable now.");
    try { return action(this.backgroundTasks); }
    catch (error) {
      if (error instanceof AgentMessageError) throw error;
      if (error instanceof BackgroundTaskError) throw new AgentMessageError(error.status, error.code, error.message);
      this.backgroundTaskFailure(error);
      throw new AgentMessageError(503, "unconfirmed_result", "The background task result could not be confirmed; repeat only the same task ID and payload.");
    }
  }

  private backgroundTaskCaller(token: string): { room: Room; participantId: string } {
    const target = this.resolveMcpToken(token);
    if (!target || !target.room.acceptsBackgroundRegistration(target.participantId, token))
      throw new AgentMessageError(403, "session_unavailable", "This agent session cannot register background tasks now.");
    return target;
  }

  registerBackgroundTask(token: string, raw: unknown) {
    const target = this.backgroundTaskCaller(token);
    if (!validArguments("register_background_task", raw)) throw new AgentMessageError(400, "invalid_arguments", "Provide only taskId and description.");
    const input = raw as { taskId: string; description: string };
    return this.withBackgroundTasks(store => store.register(target.room.uuid, target.participantId, input.taskId, input.description));
  }

  listBackgroundTasks(token: string) {
    const target = this.backgroundTaskCaller(token);
    return this.withBackgroundTasks(store => ({ tasks: store.list(target.room.uuid, target.participantId) }));
  }

  getBackgroundTask(token: string, taskId: string) {
    const target = this.backgroundTaskCaller(token);
    if (!validArguments("get_background_task", { taskId })) throw new AgentMessageError(400, "invalid_arguments", "Provide a nonblank taskId.");
    return this.withBackgroundTasks(store => {
      const task = store.get(target.room.uuid, target.participantId, taskId);
      if (!task) throw new AgentMessageError(404, "task_unavailable", "That task is not registered under your name in this room.");
      return task;
    });
  }

  cancelBackgroundTask(token: string, raw: unknown) {
    const target = this.backgroundTaskCaller(token);
    if (!validArguments("cancel_background_task", raw)) throw new AgentMessageError(400, "invalid_arguments", "Provide only taskId.");
    const input = raw as { taskId: string };
    const result = this.withBackgroundTasks(store => store.cancel(target.room.uuid, target.participantId, input.taskId));
    target.room.removeBackgroundCompletion(target.participantId, result.key);
    return result;
  }

  completeBackgroundTask(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AgentMessageError(400, "invalid_arguments", "Provide the completion key, token, terminal status and complete result.");
    const input = raw as Record<string, unknown>;
    if (Object.keys(input).some(key => !["key", "token", "status", "result"].includes(key))
        || typeof input.key !== "string" || typeof input.token !== "string" || typeof input.result !== "string"
        || typeof input.status !== "string" || !["succeeded", "failed", "cancelled"].includes(input.status))
      throw new AgentMessageError(400, "invalid_arguments", "Provide the completion key, token, terminal status and complete result.");
    const result = this.withBackgroundTasks(store => {
      const task = store.lookup(input.key as string);
      const room = task && [...this.rooms.values()].find(candidate => candidate.uuid === task.roomUuid);
      const participant = task && room?.participants.get(task.participantId);
      if (!task || !room || !participant || participant.kind !== "agent" || participant.status === "left")
        throw new AgentMessageError(403, "session_unavailable", "The background task's author is no longer in this room.");
      return store.complete(input.key as string, input.token as string, input.status as "succeeded" | "failed" | "cancelled", input.result as string);
    });
    queueMicrotask(() => this.flushBackgroundTasks());
    return { key: result.key, status: result.status, delivery: result.delivery };
  }

  private flushBackgroundTasks(): void {
    if (this.leaving.signal.aborted || !this.backgroundTasks) return;
    try {
      for (const [key, result] of this.backgroundTaskResults) {
        if (!this.backgroundTasks.lookup(key)) { this.backgroundTaskResults.delete(key); continue; }
        if (result.confirmed) this.backgroundTasks.delivered(key, result.messageId);
        else this.backgroundTasks.interrupted(key);
        this.backgroundTaskResults.delete(key);
      }
      for (const task of this.backgroundTasks.pending()) {
        const room = [...this.rooms.values()].find(candidate => candidate.uuid === task.roomUuid);
        if (!room || task.result === null) continue;
        room.enqueueBackgroundCompletion(task.participantId, { ...task, result: task.result,
          claim: messageId => {
            try { return this.backgroundTasks!.claim(task.key, messageId); }
            catch (error) { this.backgroundTaskFailure(error); return false; }
          },
          finish: (confirmed, messageId) => {
            this.backgroundTaskResults.set(task.key, { confirmed, messageId });
            this.flushBackgroundTasks();
          },
        });
      }
      for (const room of this.rooms.values()) room.resumeBackgroundCompletions();
      this.backgroundTaskFault = "";
    } catch (error) { this.backgroundTaskFailure(error); }
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
    if (!existsSync(this.settingsPath())) {
      writeJson(this.settingsPath(), defaults);
      return defaults;
    }
    try {
      const raw = JSON.parse(readFileSync(this.settingsPath(), "utf8")) as Partial<ProgramSettings>;
      const loaded = { ...defaults, ...raw, roomDefaults: raw.roomDefaults ?? {}, vendorPresets: raw.vendorPresets ?? {} };
      const roomDefaults = this.upgradeRoomDefaults(loaded.roomDefaults);
      if (roomDefaults === loaded.roomDefaults) return loaded;
      const upgraded = { ...loaded, roomDefaults };
      writeJson(this.settingsPath(), upgraded);
      return upgraded;
    } catch (error) {
      this.log.warn(`settings.json unreadable (${String(error)}); using defaults`);
      return defaults;
    }
  }

  private upgradeRoomDefaults(raw: ProgramSettings["roomDefaults"]): ProgramSettings["roomDefaults"] {
    const upgraded = upgradeRoomSettings(raw);
    if (upgraded.readsOtherRooms !== undefined || upgraded.sharesHistory === false || !legacyRecallAcrossRooms(join(this.dataDir, "memory.json"))) return upgraded;
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
    this.settings = next;
    if (!next.devShowMemoryIngestion && patch.devShowMemoryIngestion !== undefined) this.history.memoryDebug.clear();
    this.agents.settingsChanged();
    writeJson(this.settingsPath(), this.settings);
    for (const room of this.rooms.values()) {
      room.applyProgramSettings({
        humanName: next.humanName,
        humanDescription: next.humanDescription,
        bypassPermissionsByDefault: next.bypassPermissionsByDefault,
        transcripts: next.transcripts,
        foldAfter: next.foldAfter,
        recordPrompts: FROM_SOURCES && next.devShowPrompts,
      });
    }
    this.emit("event", { type: "settings", settings: this.settings } satisfies HubEvent);
    this.saveRooms();
    this.keeper?.review();
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
    let upgraded = 0;
    let file: RoomsFile;
    try {
      file = JSON.parse(readFileSync(this.roomsPath(), "utf8")) as RoomsFile;
    } catch (error) {
      this.log.warn(`rooms.json unreadable (${String(error)}); starting with no rooms`);
      return;
    }
    for (const stored of file.rooms ?? []) {
      try {
        const kept = stored.settings ?? {};
        const settings = pastRoomSettings(kept);
        if (settings !== kept) upgraded++;
        const room = this.instantiate(stored.id, stored.name, stored.dir, settings, stored.createdAt, isIdentity(stored.uuid) ? stored.uuid : newIdentity());
        if (!isIdentity(stored.uuid)) backfilled++;
        room.restore(this.keepAttachments(stored.participants ?? []));
        this.log.info(`restored room "${stored.name}" (${stored.id}): ${room.messages.length} messages, ${stored.participants?.length ?? 0} participants offline`);
      } catch (error) {
        this.log.error(`could not restore room ${stored.id}: ${String(error)}`);
      }
    }
    if (backfilled || upgraded) this.saveRooms();
    if (backfilled) this.log.info(`${backfilled} room(s) had no identity of their own and were given one on this machine`);
    if (upgraded) this.log.info(`${upgraded} room(s) now decide apart whether they share their history and whether they search the others, reading as before`);
  }

  saveRooms(): void {
    const file: RoomsFile = {
      version: 1,
      rooms: [...this.rooms.values()].map((room) => room.toStored()),
    };
    writeJson(this.roomsPath(), file);
  }

  commitNativeNoteDecision(room: Room, participantId: string, effect: NativeNoteEffect, writeRecord: () => void): NativeNoteDisposition {
    const participant = room.participants.get(participantId);
    const currentOwner = (): boolean => this.rooms.get(room.id) === room && !this.leaving.signal.aborted
      && !room.readOnly && room.participants.get(participantId) === participant
      && participant?.kind === "agent" && participant.status !== "left";
    if (!currentOwner() || !participant) return "changed";
    const readSavedParticipant = (): StoredParticipant | null => {
      const saved = JSON.parse(readFileSync(this.roomsPath(), "utf8")) as RoomsFile;
      if (saved.version !== 1 || !Array.isArray(saved.rooms)) throw new Error("native_note_rooms_file_invalid");
      const matches = saved.rooms.filter(row => row.id === room.id);
      if (matches.length !== 1 || matches[0].uuid !== room.uuid || matches[0].dir !== room.dir) return null;
      const participants = matches[0].participants.filter(row => row.id === participantId);
      return participants.length === 1 && typeof participants[0].agentType === "string" ? participants[0] : null;
    };
    const liveDisposition = nativeNoteDisposition(captureNativeNoteSubject(participant), effect);
    if (liveDisposition === "changed" || liveDisposition === "superseded") return liveDisposition;
    const savedParticipant = readSavedParticipant();
    if (!savedParticipant) return "changed";
    const savedDisposition = nativeNoteDisposition(captureNativeNoteSubject(savedParticipant), effect);
    if (savedDisposition === "changed" || savedDisposition === "superseded") return savedDisposition;
    if (liveDisposition === "already_applied" && savedDisposition !== "already_applied") return "changed";
    const assertSubject = (): void => {
      if (!currentOwner() || nativeNoteDisposition(captureNativeNoteSubject(participant), effect) !== liveDisposition) {
        throw new Error("native_note_subject_changed");
      }
      const saved = readSavedParticipant();
      if (!saved || nativeNoteDisposition(captureNativeNoteSubject(saved), effect) !== "already_applied") {
        throw new Error("native_note_saved_subject_changed");
      }
    };
    if (savedDisposition === "already_applied") {
      this.history.transaction(() => { assertSubject(); writeRecord(); });
      return "already_applied";
    }
    const rooms = [...this.rooms.values()].map(value => value.toStored());
    const stored = rooms.find(value => value.id === room.id)!.participants.find(value => value.id === participantId)!;
    const next = effect.next;
    stored.notesRevision = next.notesRevision;
    stored.notes = next.notes ?? undefined;
    stored.notesAt = next.notesAt ?? undefined;
    stored.notesSeq = next.notesSeq ?? undefined;
    stored.notesWrittenAt = next.notesWrittenAt ?? undefined;
    stored.nativeNoteReceipt = next.nativeNoteReceipt ?? undefined;
    commitFiles(this.dataDir, this.history, [{ path: "rooms.json", data: JSON.stringify({ version: 1, rooms }, null, 2) + "\n" }], () => {
      assertSubject();
      writeRecord();
    });
    return "apply";
  }

  private retryNativeDeliveries(): void {
    if (this.leaving.signal.aborted || !this.pendingNativeRooms.size) return;
    try { recoverFileTransactions(this.dataDir, this.history); }
    catch { return; }
    for (const id of [...this.pendingNativeRooms]) {
      const room = this.rooms.get(id);
      if (!room) { this.pendingNativeRooms.delete(id); continue; }
      try { if (!room.retryNativeReports()) this.pendingNativeRooms.delete(id); }
      catch { }
    }
  }

  importedRoomAddress(name: string, reserved: ReadonlySet<string> = new Set()): string {
    let base = slugify(name);
    if (!ROOM_ID_PATTERN.test(base)) base = `room-${randomBytes(6).toString("hex")}`;
    let id = base;
    for (let n = 2; this.rooms.has(id) || this.arriving.has(id) || reserved.has(id) || existsSync(join(this.dataDir, "rooms", id)); n++) id = `${base.slice(0, 32)}-${n}`;
    return id;
  }

  readonly arriving = new Set<string>();

  private settleArrivingRooms(): void {
    const roomsDir = join(this.dataDir, "rooms");
    if (!existsSync(roomsDir)) return;
    const unsettled: string[] = [];
    for (const entry of readdirSync(roomsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ROOM_ID_PATTERN.test(entry.name) || this.arriving.has(entry.name)) continue;
      const folder = join(roomsDir, entry.name);
      if (!existsSync(join(folder, ARRIVING))) continue;
      try {
        if (this.rooms.has(entry.name)) {
          (this.fileOps.remove ?? rmSync)(join(folder, ARRIVING), HELD_FILE_RETRIES);
          this.log.info(`carry import: ${entry.name} had arrived before viberoom stopped; its marker is cleared`);
          continue;
        }
        this.history?.dropRoom(entry.name);
        removeArrivingFolder(folder, this.fileOps.remove);
        this.log.warn(`carry import: viberoom stopped while an import wrote ${entry.name}; what it had written is removed`);
      } catch (error) {
        unsettled.push(`${entry.name} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    if (unsettled.length) throw new Error(`what an earlier import left half written could not all be removed yet: ${unsettled.join("; ")}. A program may be holding one of its files; viberoom tries again at its next start and before the next import.`);
  }

  fileOps: FileOps = {};

  settleImports(): void {
    recoverFileTransactions(this.dataDir, this.history, this.fileOps);
    this.settleArrivingRooms();
  }

  async pauseRoomsForImport(ids: string[], options: { waiting: (names: string[]) => void; hurry: () => boolean }): Promise<Map<string, string[]>> {
    const rooms = ids.map((id) => this.getRoom(id));
    for (const room of rooms) room.closeDoor();
    let cut = false;
    for (;;) {
      const writing = rooms.flatMap((room) => room.writingVibemates().map((v) => ({ room, ...v })));
      if (!writing.length) break;
      if (options.hurry() && !cut) {
        cut = true;
        for (const w of writing) w.room.cancelTurn(w.id);
      }
      options.waiting(writing.map((w) => w.name));
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const running = new Map<string, string[]>();
    for (const room of rooms) {
      running.set(room.id, room.liveVibemates().map((v) => v.id));
      await room.shutdown();
    }
    return running;
  }

  async resumeRoomsAfterImport(paused: Map<string, string[]>): Promise<void> {
    for (const [id, ids] of paused) {
      const room = this.rooms.get(id);
      if (!room) continue;
      room.reopenDoor();
      const mode = this.reconnectModeFor(room);
      for (const pid of ids) {
        const p = room.participants.get(pid);
        if (!p || p.kind !== "agent" || p.muted) continue;
        try {
          await this.importReconnect(room, pid, mode);
        } catch (error) {
          this.log.warn(`room ${room.id}: ${p.name} did not come back after the import: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  importReconnect: (room: Room, id: string, mode: "load" | "replay") => Promise<unknown> = (room, id, mode) => room.reconnect(id, { mode });

  commitRoomTransfer(changes: { stored: StoredRoom; setup: boolean }[], files: FileChange[], writeRecord: () => void): void {
    const changed = new Map(changes.map(c => [c.stored.id, c]));
    if (changed.size !== changes.length) throw new Error("The import targets a room more than once.");
    for (const { stored, setup } of changes) {
      if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(stored.id) || !isIdentity(stored.uuid) || !stored.name.trim() || stored.name.length > 60) throw new Error("The import has invalid room metadata.");
      const room = this.rooms.get(stored.id);
      if (room && room.uuid !== stored.uuid) throw new Error("The target room changed. Preview the import again.");
      if (!room && resolve(stored.dir) !== resolve(this.dataDir, "rooms", stored.id, "workspace")) throw new Error("A carried room must start with its own local working folder.");
      if (room?.historyDiverted) throw new Error(`The conversation in ${room.name} has unsaved writes. Let those finish before importing.`);
      if (setup && room?.hasConnectedAgents) throw new Error(`The vibemates in ${room.name} are still running. Look at the import again.`);
    }
    for (const change of changes) change.stored = { ...change.stored, settings: pastRoomSettings(change.stored.settings ?? {}) };
    for (const change of changes) {
      const room = this.rooms.get(change.stored.id);
      if (change.setup && room) change.stored = { ...change.stored, participants: carriedParticipants(room.toStored().participants, change.stored.participants as unknown as Record<string, unknown>[]) };
    }
    const rooms = [...this.rooms.values()].map(room => changed.get(room.id)?.stored ?? room.toStored());
    for (const change of changes) if (!this.rooms.has(change.stored.id)) rooms.push(change.stored as ReturnType<Room["toStored"]>);
    const workspaces: FileChange[] = changes.filter(c => !this.rooms.has(c.stored.id)).map(c => ({ path: join("rooms", c.stored.id, "workspace"), directory: [] }));
    commitFiles(this.dataDir, this.history, [...workspaces, ...files, { path: "rooms.json", data: JSON.stringify({ version: 1, rooms }, null, 2) + "\n" }], () => {
      for (const { stored } of changes) if (!this.history.migration(stored.id)) this.history.adoptMirror(stored.id);
      writeRecord();
    }, this.fileOps);
    for (const { stored, setup } of changes) {
      let room = this.rooms.get(stored.id);
      if (!room || setup) {
        room?.removeAllListeners();
        room = this.instantiate(stored.id, stored.name, stored.dir, stored.settings, stored.createdAt, stored.uuid);
        room.restore(stored.participants, { quiet: true });
        this.emit("event", { type: "room.created", room: room.snapshot() } satisfies HubEvent);
      } else room.importCommitted();
    }
    for (const { stored } of changes) this.memory.imported(stored.id);
  }

  searchHistory(params: { q?: string; rooms?: string; kinds?: string; author?: string; sort?: string; limit?: string; offset?: string; perRoom?: string; deleted?: string }): HistorySearchResponse {
    if (!this.history) return { hits: [], query: "", usedTrigram: false, unavailable: "the conversation store is off (SQLite is not available in this Node)" };
    const kinds = (params.kinds ?? "chat").split(",").map((k) => k.trim()).filter((k): k is "chat" | "system" => k === "chat" || k === "system");
    const asked = params.rooms && params.rooms !== "all" ? params.rooms.split(",").map((r) => r.trim()).filter((r) => this.rooms.has(r)) : [];
    const rooms = asked.length ? asked : [...this.rooms.keys()];
    const sort = params.sort === "newest" || params.sort === "oldest" ? params.sort : "rank";
    const people = this.nameDirectory(rooms);
    const author = params.author?.trim();
    const query: SearchQuery = {
      text: params.q ?? "",
      rooms,
      kinds: kinds.length ? kinds : ["chat"],
      authors: author ? people.holders(author).map((h) => ({ roomId: h.roomId, id: h.id })) : undefined,
      sort,
      limit: clampInt(params.limit, 40, 1, 200),
      offset: clampInt(params.offset, 0, 0, 100_000),
      perRoom: params.perRoom ? clampInt(params.perRoom, 10, 1, 200) : undefined,
      includeDeleted: params.deleted === "1",
    };
    const stale = this.staleHistoryRoomsAfterRetry(rooms).map((id) => this.rooms.get(id)?.name ?? id);
    const result = this.history.search(query);
    const names = namesInQuery(params.q ?? "", people).map(({ term, holder, others }) => ({ term, roomId: holder.roomId, now: holder.now ?? null, others }));
    return {
      ...result,
      hits: result.hits.map((h) => {
        const now = people.now(h.roomId, h.from);
        return { ...h, roomName: this.rooms.get(h.roomId)?.name ?? h.roomId, ...(now && now !== h.fromName ? { fromNow: now } : {}) };
      }),
      ...(names.length ? { names } : {}),
      roomsSearched: rooms.length,
      ...(stale.length ? { stale } : {}),
    };
  }

  private openHistory(): HistoryStore {
    try {
      return new HistoryStore(join(this.dataDir, HISTORY_DB_FILE), this.log.child("history"));
    } catch (error) {
      throw storeOpenFailure(error);
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

  nameDirectory(roomIds: string[]): NameDirectory {
    const current = roomIds.flatMap((id) => [...(this.rooms.get(id)?.participants.values() ?? [])].map((p) => ({ roomId: id, id: p.id, name: p.name })));
    return new NameDirectory(this.history?.nameUses(roomIds) ?? [], current);
  }

  roomsForAgentSearch(roomId: string): { id: string; name: string }[] {
    const own = this.rooms.get(roomId);
    if (!own) return [];
    if (own.settings.readsOtherRooms === "off") return [{ id: own.id, name: own.settings.name }];
    return [...this.rooms.values()]
      .filter((room) => room.id === roomId || this.canReadSharedHistory(own, room))
      .map((room) => ({ id: room.id, name: room.settings.name }));
  }

  private canReadSharedHistory(caller: Room, target: Room): boolean {
    return caller.settings.readsOtherRooms !== "off" && target.settings.sharesHistory && !caller.readOnly && !target.readOnly
      && !this.staleHistoryRoomsAfterRetry([target.id]).length;
  }

  readMessageForAgent(callerRoomId: string, participantId: string, seq: number | undefined, around: number, selector?: string, copy?: string, messageId?: string, version?: string): Record<string, unknown> {
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
      if (messageId !== undefined) {
        const message = target.messages.find(m => m.id === messageId && visibleToAgents(m));
        if (!message) throw new Error("message is not available in this room");
        if (version !== undefined && sourceVersion(message) !== version) throw new Error("the requested source version is not available; the current message differs");
        seq = message.seq;
      }
      if (seq === undefined) throw new Error("read_message needs seq or message_id");
      if (copy !== undefined) seq = target.numberFromCopy(copy, seq);
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
      recordPrompts: FROM_SOURCES && this.settings.devShowPrompts,
      settings: { ...this.settings.roomDefaults, ...upgradeRoomSettings(settings) },
      log: this.log.child(`room:${id}`),
      optionCatalog: this.optionCatalog,
      skills: this.skillsBridge,
      history: this.history,
      onHistoryFailure: (roomId) => this.staleHistoryRooms.add(roomId),
      onNativePending: roomId => this.pendingNativeRooms.add(roomId),
      commitNativeNoteDecision: (room, participantId, effect, writeRecord) => this.commitNativeNoteDecision(room, participantId, effect, writeRecord),
      heldParticipantIds: () => this.automationTargets(uuid),
      memoryGraph: (roomId, addressed, shown) => this.memory.briefBlock(roomId, addressed, shown),
      memoryGraphReady: (roomId, addressed) => this.memory.briefReady(roomId, addressed),
      memoryWhy: (roomId, addressed) => this.memory.briefWhy(roomId, addressed),
      connections: (roomUuid) => this.connections.inRoom(roomUuid).filter((c) => c.state === "connected").map((c) => c.name),
      pictures: this.pictures,
    });
    room.on("event", (event: RoomEvent) => {
      this.emit("event", { type: "room.event", roomId: id, event } satisfies HubEvent);
      if (event.type === "participant" || event.type === "participant.removed" || event.type === "room") this.saveRooms();
      if (event.type === "participant" || event.type === "participant.removed") this.keeper?.review();
    });
    room.on("humanActivity", () => this.automationEvent(room, "first-human-message"));
    this.rooms.set(id, room);
    this.memory?.attachRoom(id);
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
    for (let n = 2; this.rooms.has(candidate) || this.arriving.has(candidate); n++) candidate = `${id}-${n}`;
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

    const settings = input.settings?.emoji === undefined
      ? { ...input.settings, emoji: freshFace("room", [...this.rooms.values()].map((r) => r.settings.emoji)) }
      : { ...input.settings, emoji: cleanFace(input.settings.emoji, "room") };
    const room = this.instantiate(id, name, dir, settings, Date.now(), isIdentity(input.uuid) ? input.uuid : newIdentity());
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

  async agentOptions(recipeId: string, refresh: boolean): Promise<DiscoveredOptions> {
    const rooms = [...this.rooms.values()];
    if (!rooms.length) throw new Error("create a room first");
    this.noteInstallation(recipeId);
    return rooms[0].discoverOptions(recipeId, refresh);
  }

  noteInstallation(recipeId: string): void {
    const recipe = getRecipe(recipeId);
    const stamp = recipe && !recipe.unavailableReason ? recipeStamp(recipe) : null;
    for (const room of this.rooms.values()) room.noteInstallation(recipeId, stamp);
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

  forgetRoomMemory(id: string, providerId: string): void {
    const room = this.getRoom(id);
    const config = this.memoryStore.get();
    const entry = providerEntry(config.provider);
    if (!entry?.roomForget || providerId !== entry.id) throw new Error("The memory provider changed or cannot forget a room. Reopen the room settings.");
    if (entry.fields.some(field => field.kind === "secret" && !config.providers[entry.id]?.[field.key])) throw new Error(`Set the ${entry.label} key in Settings before requesting deletion.`);
    room.updateSettings({ remembers: false });
    this.saveRooms();
    this.memory.forgetRoom(id);
  }

  async removeRoom(id: string): Promise<void> {
    const room = this.getRoom(id);
    this.memory.detachRoom(id);
    await room.shutdown();
    this.automations?.store.removeRoom(room.uuid);
    this.backgroundTasks?.removeRoom(room.uuid);
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
    this.keeper?.review();
  }

  update: UpdateInfo | null = null;
  setUpdate(update: UpdateInfo): void {
    this.update = update;
    this.emit("event", { type: "update", update } satisfies HubEvent);
  }

  private keeper: WakeKeeper | null = null;
  keepAwakeWith(power: Power | NoPower, options: { wakeFully?: ((stillHeld: () => boolean) => Promise<unknown>) | null } = {}): void {
    this.keeper?.close();
    this.keeper = new WakeKeeper({
      power,
      wakeFully: options.wakeFully === undefined ? (stillHeld) => wakeFullyIfDark(this.log.child("awake"), { stillHeld }) : options.wakeFully ?? undefined,
      choice: () => keepAwakeOf(this.settings.keepAwake),
      working: () => [...this.rooms.entries()].flatMap(([id, room]) => room.workingNow().map((w) => ({ room: id, ...w }))),
      log: this.log.child("awake"),
      changed: (keepAwake) => this.emit("event", { type: "keep-awake", keepAwake } satisfies HubEvent),
    });
  }

  tellWorkingRooms(text: string): boolean {
    let told = false;
    for (const room of this.rooms.values()) {
      if (!room.workingNow().length) continue;
      room.postNotice(text);
      told = true;
    }
    return told;
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

  readonly agents: AgentManager;
  private readonly leaving = new AbortController();
  get logins(): LoginFlows { return this.agents.logins; }
  checkLogins(ids?: string[], maxAgeMs = 0): Promise<void> { return this.agents.checkLogins(ids, maxAgeMs); }
  startLogin(recipeId: string, inTerminal = false): LoginFlow { return this.agents.startLogin(recipeId, inTerminal); }
  startInstall(recipeId: string, inTerminal = false): LoginFlow { return this.agents.startInstall(recipeId, inTerminal); }
  rescan(ids?: string[]): Promise<void> { return this.agents.rescan(ids); }

  private emitRecipes(): void {
    this.emit("event", { type: "recipes", recipes: publicRecipes() } satisfies HubEvent);
  }

  snapshot(): unknown {
    return {
      settings: this.settings,
      update: this.update,
      agentUpdates: this.agents.view(),
      automationPending: this.automationPending(),
      automationJobs: this.automationJobs(),
      recipes: publicRecipes(),
      logins: this.logins.list(),
      skills: this.skills.list(),
      looks: this.looks.list(),
      roomDefaults: { ...DEFAULT_ROOM_SETTINGS, ...this.settings.roomDefaults },
      rooms: [...this.rooms.values()].map((room) => room.snapshot()),
      pictures: this.pictures.states(),
      openRooms: [...this.openRooms],
      channels: this.channels.view(),
      connections: this.connectionsView(),
      connectionStorageProblem: this.connections.storageProblem,
      voice: this.voice.view(),
      memoryProvider: { view: this.memoryStore.describe(), status: this.memory.status() },
      secrets: this.openSecrets(),
      restart: { can: this.canRestart, pending: this.restartPending() },
      keepAwake: this.keeper?.status() ?? null,
    };
  }

  private roomShutdownMs(room: Room, plain: number): number {
    const agents = [...room.participants.values()].filter((p) => p.kind === "agent").length;
    return ROOM_AGENT_MS * (agents + 1) + ROOM_SHUTDOWN_WAIT_MS + plain;
  }

  shutdownWithinMs(plain = SHUTDOWN_STAGE_MS): number {
    return this.shutdownStages(plain).reduce((sum, next) => sum + next.budget, 0);
  }

  private shutdownStages(plain: number): { name: ShutdownStageName; budget: number; work: () => Promise<void> | void }[] {
    const hold = Number(process.env.VIBEROOM_SHUTDOWN_HOLD_MS || 0);
    return [
      ...(Number.isFinite(hold) && hold > 0 ? [{ name: "probe-hold" as const, budget: hold + plain, work: () => new Promise<void>((resolve) => setTimeout(resolve, hold)) }] : []),
      { name: "ways-in" as const, budget: plain, work: async () => {
        for (const room of this.rooms.values()) room.closeDoor();
        await this.agents.shutdown();
        await this.channels.stop();
        await this.connections.close();
      } },
      ...[...this.rooms.values()].map((room) => ({ name: `room:${room.name}` as const, budget: this.roomShutdownMs(room, plain), work: () => room.shutdown() })),
      { name: "transcripts" as const, budget: plain, work: async () => {
        const result = await transcriptWriter.stop(this.dataDir, plain / 2);
        if (result.timedOut) this.log.warn(`shutdown: diagnostic writes reached their deadline; ${result.abandonedRecords} pending record(s) were abandoned`);
      } },
      { name: "rooms-file" as const, budget: plain, work: () => this.saveRooms() },
      ...(this.backupTimer ? [{ name: "backup" as const, budget: plain, work: async () => {
        if (this.backupTimer) clearInterval(this.backupTimer);
        this.backupTimer = null;
        await this.backupHistory();
      } }] : []),
      { name: "automations" as const, budget: plain, work: () => this.automations?.close() },
      { name: "background-tasks" as const, budget: plain, work: () => this.backgroundTasks?.close() },
      { name: "memory" as const, budget: plain, work: () => this.memory.settled() },
      { name: "history" as const, budget: plain, work: () => this.history.close() },
    ];
  }

  async shutdown(options: { stageMs?: number; onStage?: (step: ShutdownStep) => void } = {}): Promise<ShutdownStep[]> {
    this.stopThreadWatch?.();
    this.stopThreadWatch = null;
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
      const step: ShutdownStep = { stage: name, ms: Date.now() - started, timedOut, budget };
      if (timedOut) this.log.warn(`shutdown: ${name} did not finish within ${budget} ms; carrying on`);
      steps.push(step);
      options.onStage?.(step);
    };
    const plain = options.stageMs ?? SHUTDOWN_STAGE_MS;

    this.clearRestart();
    this.keeper?.close();
    this.keeper = null;
    if (this.channelsRetry) clearTimeout(this.channelsRetry);
    this.channelsRetry = null;
    this.leaving.abort();
    try { stopProductionPrivateTrial(this); } catch { this.log.warn("private-trial startup withdrawal refused"); }
    this.revokeTrialBudgetCards("hub_shutdown");
    if (this.backgroundTaskTimer) clearInterval(this.backgroundTaskTimer);
    this.backgroundTaskTimer = null;
    if (this.nativeReportTimer) clearInterval(this.nativeReportTimer);
    this.nativeReportTimer = null;
    this.automations?.stop();
    this.memory.stop();
    for (const next of this.shutdownStages(plain)) await stage(next.name, next.budget, next.work);
    return steps;
  }

  async reset(): Promise<void> {
    try { stopProductionPrivateTrial(this); } catch { this.log.warn("private-trial startup withdrawal refused"); }
    this.revokeTrialBudgetCards("hub_reset");
    this.memoryStore.invalidateTrialRevision();
    if (this.channelsRetry) clearTimeout(this.channelsRetry);
    this.channelsRetry = null;
    this.log.warn("erasing the whole data folder on the human's request");
    for (const id of this.rooms.keys()) this.memory.detachRoom(id);
    for (const room of this.rooms.values()) await room.shutdown();
    this.backgroundTaskResults.clear();
    for (const [id, room] of this.rooms) { this.history?.dropRoom(id); this.automations?.store.removeRoom(room.uuid); this.backgroundTasks?.removeRoom(room.uuid); }
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
    for (const view of this.connections.view()) {
      if (view.group === "own") await this.connections.removeOwn(view.id);
      else if (view.state !== "not-connected") await this.connections.disconnect(view.id);
    }
    this.connections.clear();
    await this.channels.stop();
    this.channelsStore.clear();
    this.voice.store.clear();
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
  hits: Array<SearchHit & { roomName: string; fromNow?: string }>;
  names?: { term: string; roomId: string; now: string | null; others: string[] }[];
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
