// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { TrialBudgetCard, type TrialBudgetView, type TrialBudgetSubject } from "./memory/trial-budget-card.js";
import { startProductionPrivateTrial, stopProductionPrivateTrial } from "./memory/private-trial-startup.js";

import { EventEmitter } from "node:events";
import { AutomationStore } from "./automation-store.js";
import { Automations } from "./automations.js";
import { BackgroundTasks } from "./hub/background-tasks.js";
import { RestartCoordinator, type RestartView } from "./hub/restart.js";
import { HistoryAccess, type HistorySearchResponse } from "./hub/history-access.js";

export type { RestartView } from "./hub/restart.js";
export type { HistorySearchResponse } from "./hub/history-access.js";
import type { ConsentFeature, SecretRequest } from "./hub/secret-cards.js";
import { SecretDesk } from "./hub/secret-desk.js";
export { CONSENT_FEATURES, CONSENT_FEATURE_WORDS, KEYED_PURPOSE, READ_HERE_WORDS, SECRET_CARD_MS, secretLabel, type ConsentFeature, type SecretRequest } from "./hub/secret-cards.js";
import type { NativeNoteEffect } from "./native-reports.js";
import { captureNativeNoteSubject, nativeNoteDisposition, type NativeNoteDisposition } from "./native-note-state.js";
import { parseAutomation, parseSchedule, previewSchedule } from "./automation-schedule.js";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { onRenameRefused, writeFileAtomic } from "./atomic.js";
import { onSlowIo, slowIoWords } from "./slow-io.js";
import { watchThread } from "./thread-watch.js";
import { commitFiles, recoverFileTransactions, type FileChange, type FileOps } from "./file-transaction.js";
import { folderIdentity, isIdentity, newIdentity } from "./identity.js";
import { qrSvg } from "./qr.js";
import { pickBotKey } from "./bot-key.js";
import { ensureDataRoot } from "./data-root.js";
import { RequestTraceRing } from "./mcp-diagnostics.js";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Logger } from "./log.js";
import { transcriptWriter } from "./transcript-writer.js";
import { HISTORY_DB_FILE, HistoryStore, storeOpenFailure } from "./history-store.js";
import type { NameDirectory } from "./name-directory.js";
import { ROOM_ID_PATTERN, RoomRegistry, type ArrivingReservation, type RoomsFile } from "./hub/room-registry.js";
import { RoomImport, type ImportCommit, type ImportContext, type Pause } from "./hub/room-import.js";
import { RoomLifecycle } from "./hub/room-lifecycle.js";
import { DEFAULT_APPEARANCE, ProgramSettingsFile, nextAppearance, type ProgramSettings } from "./hub/program-settings.js";
export {
  ADJUSTABLE, DEFAULT_APPEARANCE, DIAGRAM_PRESETS, MONO_FONTS, TEXT_FONTS, WHEEL_STEP_DEFAULT, WHEEL_STEP_MAX, WHEEL_STEP_MIN, nextAppearance,
  type Adjustable, type AppearanceSettings, type DiagramPreset, type DiagramSettings, type ProgramSettings, type VendorPreset,
} from "./hub/program-settings.js";

import { ownNpmPrefix } from "./own-runtime.js";
import { getRecipe, installVendorsInto, listRecipes, publicRecipes } from "./recipes.js";
import { AgentManager, type AgentUpdatesView } from "./agent-manager.js";
import type { LoginFlows, LoginFlow } from "./login-flow.js";
import { DEFAULT_ROOM_SETTINGS, pastRoomSettings, upgradeRoomSettings, type RoomSettings } from "./persona.js";
import type { NewRoomPlan } from "./new-room.js";
import { OptionCatalog } from "./option-catalog.js";
import { recipeStamp } from "./install-stamp.js";
import { Room, ROOM_SHUTDOWN_WAIT_MS, type ChatMessage, type DiscoveredOptions, type RoomEvent, type SkillsBridge, type StoredParticipant, type RoomRecovery } from "./room.js";
import { SkillLibrary, type SkillDraft, type SkillMeta } from "./skills.js";
import { TemplateLibrary, type RoomTemplate } from "./templates.js";
import { LookLibrary, checkLookSpec, loadTokens, type LookCheck, type LookSpec } from "./looks.js";
import { ChannelRouter, type ChannelsView } from "./channels/router.js";
import { ChannelsStore, fileRootRefusal, type FileRoot } from "./channels/state.js";
import { Vault } from "./vault.js";
import { ConsentChangedError } from "./consent-changed.js";
import { Connections, ConnectionError, type ConnectionView } from "./connections/service.js";
import { commandLine, type LocalLaunch } from "./connections/local-launch.js";
import { checkHeaderNames } from "./connections/mcp-remote.js";
import { ConnectionDesk } from "./connections/desk.js";
import { guardedFetch } from "./connections/outbound.js";
import { SignInError } from "./connections/oauth.js";
import type { KeyedSystemId } from "./connections/catalog.js";
import { launchOpen, openCommand } from "./open.js";
import { BLOCK_CHARS_MAX, BLOCK_CHARS_MIN, MemoryConfigStore, consentWords, memoryReadiness, type MemoryConfigView } from "./memory/config.js";
import { VoiceConfigStore, readingConsentWords, readingReadiness, voiceConsentWords, voiceReadiness } from "./voice/config.js";
import { voiceProvider } from "./voice/registry.js";
import { VoiceService } from "./voice/service.js";
import { MEMORY_PROVIDERS, coerceProviderSettings, providerEntry } from "./memory/registry.js";
import { MemoryPipeline, acceptForRecipient, type MemoryStatus } from "./memory/service.js";
import { MemoryRecoveryActions } from "./memory/recovery-actions.js";
import { configuredAnswerContext, configuredTrialContext, configuredTrialAccountContext, type ConfiguredTrialSelection, type ConfiguredTrialAccountSelection } from "./memory/configured-trial.js";
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


export interface StoredRoom {
  id: string;
  uuid?: string;
  scope?: unknown;
  name: string;
  dir: string;
  createdAt: number;
  settings: Partial<RoomSettings>;
  participants: StoredParticipant[];
}


import type { UpdateInfo } from "./update.js";
import { hasSourceTree } from "./update.js";
import { keepAwakeOf, WakeKeeper, type KeepAwakeStatus, type NoPower, type Power } from "./keep-awake.js";
import { wakeFullyIfDark } from "./mac-wake.js";
import { AgentImages, type AgentImageState } from "./agent-images.js";
import { ProductOperations, type OperationOutcome, type ProductOperation } from "./product-operations.js";

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

interface McpTokenEntry {
  roomId: string;
  participantId: string;
}



const CHANNEL_RETRY_MS = [5_000, 15_000, 60_000, 300_000];
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
  private readonly backgroundTasks: BackgroundTasks;
  private nativeReportTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pendingNativeRooms = new Set<string>();
  private roomFolderMemo: { key: string; names: ReadonlySet<string> } | null = null;
  private roomFolderReads = 0;
  readonly dataDir: string;
  readonly requestDiagnostics = new RequestTraceRing();
  private readonly registry: RoomRegistry = new RoomRegistry({
    dataDir: () => this.dataDir,
    log: { info: (text) => this.log.info(text), warn: (text) => this.log.warn(text) },
    renamedSkills: () => this.renamedSkills,
    announce: (event) => this.emit("event", event satisfies HubEvent),
  });
  private readonly lifecycle: RoomLifecycle = new RoomLifecycle({
    registry: this.registry,
    dataDir: () => this.dataDir,
    log: { info: (text) => this.log.info(text), warn: (text) => this.log.warn(text) },
    make: (made) => this.instantiate(made.id, made.name, made.dir, made.settings, made.createdAt, made.uuid, made.scope, { life: made.life, reservation: made.reservation }),
    templates: { get: (id) => this.templates.get(id), save: (template) => this.templates.save(template) },
    hasSkill: (name) => !!this.skills.get(name),
    installed: () => new Set(listRecipes().filter((r) => !r.unavailableReason).map((r) => r.id)),
    humanName: () => this.settings.humanName,
    announce: (event) => this.emit("event", event as HubEvent),
    saveRooms: () => this.saveRooms(),
    keeperReview: () => this.keeper?.review(),
    memory: { detachRoom: (id) => this.memory.detachRoom(id), forgetRoom: (id, expected) => this.memory.forgetRoom(id, expected) },
    forgetter: () => {
      const config = this.memoryStore.get();
      const entry = providerEntry(config.provider);
      if (!entry?.roomForget) return null;
      return { id: entry.id, label: entry.label, keySet: !entry.fields.some((field) => field.kind === "secret" && !config.providers[entry.id]?.[field.key]) };
    },
    identityDrops: (room) => [
      () => this.automations?.store.removeRoom(room.uuid),
      () => this.backgroundTasks.removeRoom(room.uuid),
      () => this.historyAccess.dropRoom(room),
      () => this.history?.memory.drop(`room:${room.uuid}`),
    ],
    dropByAddress: (id) => this.history?.dropRoom(id),
  });
  private readonly roomImport: RoomImport = new RoomImport({
    registry: this.registry,
    dataDir: () => this.dataDir,
    log: { info: (text) => this.log.info(text), warn: (text) => this.log.warn(text) },
    history: () => this.history,
    fileOps: () => this.fileOps,
    make: (stored, life) => this.instantiate(stored.id, stored.name, stored.dir, stored.settings, stored.createdAt, stored.uuid, stored.scope, { life }),
    discard: (room) => {
      if (!this.registry.drop(room)) return;
      this.memory.detachRoom(room.id);
      void room.shutdown().catch((error) => this.log.warn(`room ${room.id}: its sessions did not all close (${error instanceof Error ? error.message : String(error)})`));
    },
    announce: (event) => this.emit("event", event as HubEvent),
    reconnectMode: (room) => this.reconnectModeFor(room),
    reconnect: (room, id, mode) => this.importReconnect(room, id, mode),
    memoryImported: (id) => this.memory.imported(id),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  get rooms(): ReadonlyMap<string, Room> { return this.registry.rooms; }
  readonly skills: SkillLibrary;
  readonly templates: TemplateLibrary;
  readonly looks: LookLibrary;
  readonly history: HistoryStore;
  readonly pictures: AgentImages;
  private readonly historyAccess: HistoryAccess = new HistoryAccess({
    rooms: () => this.rooms,
    history: () => this.history,
    knobs: () => ({ retryMs: this.historyRetryMs, backupKeep: this.historyBackupKeep, backupEveryMs: this.historyBackupEveryMs }),
    backupsDir: () => join(this.dataDir, "backups"),
    log: (text) => this.log.warn(text),
  });
  private readonly programSettings: ProgramSettingsFile;
  private readonly log: Logger;
  private readonly optionCatalog = new OptionCatalog();
  private readonly mcpTokens = new Map<string, McpTokenEntry>();
  private hubUrl: string | null = null;
  private run: { id: string; build: string } | null = null;
  private readonly renamedSkills = new Map<string, string>();
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
        list: (callerId) => this.roomsReachedFrom(callerId).map((room) => ({ id: room.id, name: room.settings.name })),
        find: (callerId, selector) => {
          const reached = this.roomsReachedFrom(callerId);
          const byId = reached.find((room) => room.id === selector);
          if (byId) return byId;
          const named = reached.filter((room) => room.settings.name === selector);
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
    this.programSettings = new ProgramSettingsFile({ dataDir: this.dataDir, log: { warn: (text) => this.log.warn(text) } }, initialHumanName);
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
    this.backgroundTasks = new BackgroundTasks(join(this.dataDir, "background-tasks.sqlite"), {
      caller: (token) => this.resolveMcpToken(token),
      roomByUuid: (uuid) => [...this.rooms.values()].find((room) => room.uuid === uuid),
      rooms: () => this.rooms.values(),
      log: (text) => this.log.warn(text),
    });
    for (const room of this.rooms.values()) {
      try { if (room.hasPendingNativeDelivery()) this.pendingNativeRooms.add(room.id); }
      catch { this.pendingNativeRooms.add(room.id); }
    }
    this.nativeReportTimer = setInterval(() => this.retryNativeDeliveries(), 1000);
    this.nativeReportTimer.unref();
    this.tellRoomsWhatEndedTheLastRun();
    if (this.registry.renamedAttachments) this.saveRooms();
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
        paired: (_platform, name) => this.desk.settlePairingCards(name),
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
      accept: (roomId, expected, work) => acceptForRecipient({ provider: this.memoryStore.get().provider, uuid: this.rooms.get(roomId)?.uuid, living: expected.life === undefined ? !this.registry.ended : this.registry.living(expected.life) }, expected, work),
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
      this.rooms.has(id) || this.registry.isArriving(id)) return false;
    for (const room of this.rooms.values()) if (roomUuids.includes(room.uuid)) return false;
    if (this.registry.arriving.size !== 0) return false;
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

  async setMemory(patch: { provider?: unknown; settings?: unknown; consent?: unknown; consentWords?: unknown; filterMode?: unknown; filterBaseUrl?: unknown; filterApiKey?: unknown; filterModel?: unknown; filterForm?: unknown; blockChars?: unknown }): Promise<{ view: MemoryConfigView; status: MemoryStatus; verified?: { ok: boolean; reason?: string } }> {
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
    const shown = patch.consentWords;
    if (shown !== undefined && (typeof shown !== "string" || patch.consent !== true || Object.keys(patch).some((key) => key !== "consent" && key !== "consentWords")))
      throw new Error("consentWords go with the consent alone, as text");
    this.memoryStore.update((s) => {
      if (typeof shown === "string") {
        const current = providerEntry(s.provider);
        if (!current || current.id !== target?.id || consentWords(current, s.filter) !== shown) throw new ConsentChangedError();
      }
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
    this.desk.pairLinkWithdrawn();
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
  private readonly restarts: RestartCoordinator = new RestartCoordinator({
    handOver: () => this.restartWith,
    rooms: () => this.rooms.values(),
    holds: (room) => this.rooms.get(room.id) === room,
    stillWaiting: (text) => this.channels.restartStillWaiting(text),
    announce: (restart) => this.emit("event", { type: "restart", restart } satisfies HubEvent),
    log: (text) => this.log.warn(text),
  });

  get canRestart(): boolean {
    return !!this.restartWith;
  }

  writingNow(): string[] { return this.restarts.writingNow(); }

  restartPending(): RestartView | null { return this.restarts.pending(); }

  requestRestart(input: { askedBy: string; from: RestartView["from"]; room?: string; sessions?: "load" | "replay"; when: "now" | "idle" }): RestartView {
    return this.restarts.request(input);
  }

  restartNow(by: string): void { this.restarts.now(by); }

  cancelRestart(by: string): void { this.restarts.cancel(by); }

  noteBackAfterRestart(build: string): void { this.restarts.noteBack(build); }

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


  private readonly desk: SecretDesk = (() => {
    const hub = this;
    return new SecretDesk({
      rooms: () => hub.rooms,
      announce: (request) => hub.emit("event", { type: "secret", request } satisfies HubEvent),
      log: { info: (text) => hub.log.info(text), warn: (text) => hub.log.warn(text) },
      get voice() { return hub.voice; },
      get memoryStore() { return hub.memoryStore; },
      get connections() { return hub.connections; },
      setTelegram: (patch) => hub.setTelegram(patch),
      setMemory: (patch) => hub.setMemory(patch),
      pairLink: () => hub.channels.pairLink("telegram"),
      cancelPairLink: (link) => hub.channels.cancelPairLink("telegram", link),
      connectSystem: (id, cardId) => hub.connectSystem(id, cardId),
    });
  })();

  askTrialBudget(subject: TrialBudgetSubject): SecretRequest { return this.desk.askTrialBudget(subject); }
  decideTrialBudget(id: string, body: unknown): SecretRequest { return this.desk.decideTrialBudget(id, body); }
  revokeTrialBudget(id: string): SecretRequest { return this.desk.revokeTrialBudget(id); }
  openSecrets(): SecretRequest[] { return this.desk.openSecrets(); }
  askSecret(purpose: SecretRequest["purpose"], askedBy: SecretRequest["askedBy"], prefill?: SecretRequest["prefill"], connection?: SecretRequest["connection"], consent?: SecretRequest["consent"]): SecretRequest {
    return this.desk.askSecret(purpose, askedBy, prefill, connection, consent);
  }
  answerSecret(id: string, value: string): Promise<SecretRequest> { return this.desk.answerSecret(id, value); }
  closeSecret(id: string, options: { copied?: boolean } = {}): SecretRequest { return this.desk.closeSecret(id, options); }
  askConsent(feature: ConsentFeature, askedBy: SecretRequest["askedBy"], reader?: "system" | "provider"): SecretRequest | null { return this.desk.askConsent(feature, askedBy, reader); }
  agreeTo(feature: ConsentFeature, words: string, reader?: "system" | "provider"): Promise<string> { return this.desk.agreeTo(feature, words, reader); }
  withdrawConsent(feature: ConsentFeature): Promise<void> { return this.desk.withdrawConsent(feature); }
  giveConsent(id: string): Promise<SecretRequest> { return this.desk.giveConsent(id); }
  connectionsView(): ConnectionView[] { return this.desk.connectionsView(); }
  askConnection(id: string, askedBy: SecretRequest["askedBy"]): SecretRequest { return this.desk.askConnection(id, askedBy); }
  askAddConnection(name: string, url: string, askedBy: SecretRequest["askedBy"], headers: readonly string[] = []): { request: SecretRequest; known: boolean } {
    return this.desk.askAddConnection(name, url, askedBy, headers);
  }
  askAddLocalConnection(name: string, launch: LocalLaunch, env: readonly string[], askedBy: SecretRequest["askedBy"]): { request: SecretRequest; known: boolean } {
    return this.desk.askAddLocalConnection(name, launch, env, askedBy);
  }
  connectCard(cardId: string, keys: Record<string, unknown> = {}): Promise<ConnectionView> { return this.desk.connectCard(cardId, keys); }
  connectSystem(id: string, cardId?: string): Promise<ConnectionView> { return this.desk.connectSystem(id, cardId); }
  expireSecrets(now = Date.now()): void { this.desk.expireSecrets(now); }

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
    const still = () => this.registry.speaks(room);
    if (!still()) return;
    try {
      const changed = this.automations?.store.event(room.uuid, event, this.automationBoot, Date.now());
      if (changed && still()) this.automationsChanged(still);
    } catch (error) {
      if (still()) this.log.warn(`Automation event could not be recorded: ${String(error)}`);
    }
  }

  private automationPending(still: () => boolean = () => true): Record<string, number> | undefined {
    try {
      const pending: Record<string, number> = {};
      for (const room of [...this.rooms.values()]) {
        pending[room.id] = room.readOnly ? 0 : this.automations?.store.proposals(room.uuid).filter(p => p.status === "pending").length ?? 0;
        if (!still()) return undefined;
      }
      return pending;
    }
    catch { return still() ? {} : undefined; }
  }
  private automationJobs(): number {
    try { return this.automations?.store.jobCount() ?? 0; }
    catch { return 0; }
  }
  private automationsChanged(still: () => boolean = () => true): void {
    const pending = this.automationPending(still);
    if (!pending) return;
    const jobs = this.automationJobs();
    if (!still()) return;
    this.emit("event", { type: "automations", pending, jobs } satisfies HubEvent);
  }

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

  registerBackgroundTask(token: string, raw: unknown) { return this.backgroundTasks.register(token, raw); }
  listBackgroundTasks(token: string) { return this.backgroundTasks.list(token); }
  getBackgroundTask(token: string, taskId: string) { return this.backgroundTasks.get(token, taskId); }
  cancelBackgroundTask(token: string, raw: unknown) { return this.backgroundTasks.cancel(token, raw); }
  completeBackgroundTask(raw: unknown) { return this.backgroundTasks.complete(raw); }


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


  get settings(): ProgramSettings {
    return this.programSettings.current;
  }

  saveWindowPlacement(report: Record<string, unknown>): void {
    this.programSettings.saveWindowPlacement(report);
  }

  updateSettings(patch: Record<string, unknown>): ProgramSettings {
    const { settings: next, revision } = this.programSettings.commit(patch);
    const latest = () => this.programSettings.holds(revision);
    const lastWord = (deliver: (settings: ProgramSettings) => void): boolean => {
      deliver(next);
      if (latest()) return true;
      for (let seen = this.programSettings.revision; !this.programSettings.ended; seen = this.programSettings.revision) {
        deliver(this.settings);
        if (this.programSettings.revision === seen) return false;
      }
      return false;
    };
    if (!next.devShowMemoryIngestion && patch.devShowMemoryIngestion !== undefined) this.history.memoryDebug.clear();
    if (!latest()) return this.settings;
    this.agents.settingsChanged();
    if (!latest()) return this.settings;
    for (const room of [...this.rooms.values()]) {
      const told = lastWord((settings) => {
        if (this.rooms.get(room.id) !== room) return;
        room.applyProgramSettings({
          humanName: settings.humanName,
          humanDescription: settings.humanDescription,
          bypassPermissionsByDefault: settings.bypassPermissionsByDefault,
          transcripts: settings.transcripts,
          foldAfter: settings.foldAfter,
          recordPrompts: FROM_SOURCES && settings.devShowPrompts,
        });
      });
      if (!told) return this.settings;
    }
    if (!lastWord((settings) => this.emit("event", { type: "settings", settings } satisfies HubEvent))) return this.settings;
    this.saveRooms();
    if (!latest()) return this.settings;
    this.keeper?.review();
    return this.settings;
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
    const file = this.registry.readFile();
    if (!file) return;
    let backfilled = 0;
    let upgraded = 0;
    for (const stored of file.rooms ?? []) {
      try {
        const kept = stored.settings ?? {};
        const settings = pastRoomSettings(kept);
        if (settings !== kept) upgraded++;
        const room = this.instantiate(stored.id, stored.name, stored.dir, settings, stored.createdAt, isIdentity(stored.uuid) ? stored.uuid : newIdentity(), stored.scope);
        if (room.unreadableScope !== undefined) this.log.warn(`room ${stored.id}: its project ${JSON.stringify(room.unreadableScope)} is not an identity; kept as written, and the room reaches no other room until it is put right`);
        if (!isIdentity(stored.uuid)) backfilled++;
        room.restore(this.registry.keepAttachments(stored.participants ?? []));
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
    this.registry.save();
  }

  commitNativeNoteDecision(room: Room, participantId: string, effect: NativeNoteEffect, writeRecord: () => void): NativeNoteDisposition {
    const participant = room.participants.get(participantId);
    const currentOwner = (): boolean => this.rooms.get(room.id) === room && !this.leaving.signal.aborted
      && !room.readOnly && room.participants.get(participantId) === participant
      && participant?.kind === "agent" && participant.status !== "left";
    if (!currentOwner() || !participant) return "changed";
    const readSavedParticipant = (): StoredParticipant | null => {
      const saved = JSON.parse(readFileSync(this.registry.path, "utf8")) as RoomsFile;
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
    const projected = this.registry.project();
    if (!projected) throw new Error("native_note_rooms_file_changed");
    const { rooms, serial } = projected;
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
      if (!this.registry.stillProjected(serial)) throw new Error("native_note_rooms_file_changed");
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
    return this.registry.importedAddress(name, reserved);
  }

  get arriving(): ReadonlySet<string> { return this.registry.arriving; }
  reserveArriving(id: string): ArrivingReservation { return this.registry.reserveArriving(id); }
  releaseArriving(reservation: ArrivingReservation): void { this.registry.releaseArriving(reservation); }

  private settleArrivingRooms(): void { this.roomImport.settleArriving(); }

  fileOps: FileOps = {};

  settleImports(): void { this.roomImport.settle(); }

  importContext(): ImportContext { return this.roomImport.context(); }
  importLiving(context: ImportContext): boolean { return this.roomImport.living(context); }
  importOwns(context: ImportContext, reservation: ArrivingReservation): boolean { return this.roomImport.owns(context, reservation); }

  pauseRoomsForImport(ids: string[], options: { waiting: (names: string[]) => void; hurry: () => boolean }, context: ImportContext = this.importContext()): Promise<Pause> {
    return this.roomImport.pause(context, ids, options);
  }

  resumeRoomsAfterImport(pause: Pause): Promise<void> { return this.roomImport.resume(pause); }

  importReconnect: (room: Room, id: string, mode: "load" | "replay") => Promise<unknown> = (room, id, mode) => room.reconnect(id, { mode });

  commitRoomTransfer(changes: { stored: StoredRoom; setup: boolean }[], files: FileChange[], writeRecord: () => void, options: { context?: ImportContext; pause?: Pause } = {}): ImportCommit {
    return this.roomImport.commit(options.context ?? this.importContext(), changes, files, writeRecord, options.pause);
  }

  searchHistory(params: { q?: string; rooms?: string; kinds?: string; author?: string; sort?: string; limit?: string; offset?: string; perRoom?: string; deleted?: string }): HistorySearchResponse {
    return this.historyAccess.search(params);
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

  startBackups(): void { this.historyAccess.startBackups(); }

  adoptRoomCopy(id: string): Promise<RoomRecovery> {
    const room = this.getRoom(id);
    return room.adoptCopy(() => this.backupHistory(), () => this.rooms.get(id) === room);
  }

  backupHistory(): Promise<string> { return this.historyAccess.backup(); }

  historyRetryMs = 30_000;

  staleHistoryRoomsAfterRetry(roomIds: Iterable<string>): string[] { return this.historyAccess.staleAfterRetry(roomIds); }

  nameDirectory(roomIds: string[]): NameDirectory { return this.historyAccess.nameDirectory(roomIds); }

  roomsForAgentSearch(roomId: string): { id: string; name: string }[] { return this.historyAccess.roomsForAgentSearch(roomId); }

  private canReadSharedHistory(caller: Room, target: Room): boolean { return this.historyAccess.canReadShared(caller, target); }

  setScopePolicy(policy: ((caller: string, target: string | null) => boolean) | null): void { this.historyAccess.setScopePolicy(policy); }

  private productOperations = new ProductOperations();
  setOperations(operations: readonly ProductOperation[]): void { this.productOperations = new ProductOperations(operations); }

  operationDefinitions(token: string) { return this.resolveMcpToken(token) ? this.productOperations.definitions() : null; }

  async runOperation(token: string, operation: string, args: unknown): Promise<OperationOutcome | null> {
    const target = this.resolveMcpToken(token);
    if (!target) return null;
    const { room, participantId } = target;
    const name = ((room.snapshot() as { participants?: { id: string; name: string }[] }).participants ?? []).find((p) => p.id === participantId)?.name ?? "A vibemate";
    return this.productOperations.call(operation, { room: { id: room.id, uuid: room.uuid, scope: room.scope }, participant: { id: participantId, name } }, args);
  }

  private roomsReachedFrom(callerId: string): Room[] { return this.historyAccess.roomsReachedFrom(callerId); }

  readMessageForAgent(callerRoomId: string, participantId: string, seq: number | undefined, around: number, selector?: string, copy?: string, messageId?: string, version?: string): Record<string, unknown> {
    return this.historyAccess.readMessageForAgent(this.getRoom(callerRoomId), participantId, seq, around, selector, copy, messageId, version);
  }

  historyForAgent(roomId: string): HistoryStore | null { return this.historyAccess.historyForAgent(roomId); }

  private instantiate(id: string, name: string, dir: string, settings: Partial<RoomSettings>, createdAt: number, uuid: string = newIdentity(), scope?: unknown, making?: { life: number; reservation?: ArrivingReservation }): Room {
    const life = making?.life ?? this.registry.life;
    let made: Room | undefined, failedEarly = false;
    const room = new Room({
      id,
      uuid,
      folderId: this.folderId,
      scope,
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
      onHistoryFailure: () => { if (made) this.historyAccess.markStale(made); else failedEarly = true; },
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
      if (!this.registry.speaks(room)) return;
      this.emit("event", { type: "room.event", roomId: id, event } satisfies HubEvent);
      if (event.type !== "participant" && event.type !== "participant.removed" && event.type !== "room") return;
      if (!this.registry.speaks(room)) return;
      this.saveRooms();
      if (event.type === "room" || !this.registry.speaks(room)) return;
      this.keeper?.review();
    });
    room.on("humanActivity", () => { if (this.registry.speaks(room)) this.automationEvent(room, "first-human-message"); });
    if (!this.registry.adopt(room, life, making?.reservation)) {
      room.removeAllListeners();
      throw new Error(this.registry.ended ? "viberoom is shutting down; no room is made now" : life !== this.registry.life ? "viberoom was reset; this room is not made" : `the address ${id} is another making's`);
    }
    made = room;
    if (failedEarly) this.historyAccess.markStale(room);
    this.memory?.attachRoom(id);
    return room;
  }

  workspaceNotice(dir: string): string | null { return this.lifecycle.workspaceNotice(dir); }
  createRoom(input: { name: string; dir?: string | null; settings?: Partial<RoomSettings>; uuid?: string; scope?: string | null }): { room: Room; notices: string[] } {
    return this.lifecycle.createRoom(input);
  }
  createRoomFromTemplate(input: { templateId: string; name: string; dir?: string | null; scope?: string | null; vibemates: { name: string; agentType: string; model?: string | null; effort?: string | null; mode?: string | null }[] }): Promise<{ room: Room; notices: string[] }> {
    return this.lifecycle.createRoomFromTemplate(input);
  }
  createProposedRoom(plan: NewRoomPlan, by: { proposer: string; human: string }): Promise<{ room: Room; notices: string[] }> {
    return this.lifecycle.createProposedRoom(plan, by);
  }
  async resolveNewRoom(roomId: string, key: string, create: boolean): Promise<{ status: "created" | "refused"; room?: string; notices: string[] }> {
    return this.lifecycle.resolveNewRoom(this.getRoom(roomId), key, create);
  }
  saveRoomAsTemplate(roomId: string, input: { name: string; description: string; emoji?: string; template?: Partial<Pick<RoomTemplate, "dir" | "settings" | "vibemates">> }): RoomTemplate {
    return this.lifecycle.saveRoomAsTemplate(this.getRoom(roomId), input);
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
    return this.registry.get(id);
  }

  get openRooms(): readonly string[] { return this.registry.openRooms; }

  markOpened(id: string): void {
    this.registry.markOpened(id);
  }

  forgetRoomMemory(id: string, providerId: string): void {
    this.lifecycle.forgetRoomMemory(this.getRoom(id), providerId);
  }

  removeRoom(id: string): Promise<void> {
    return this.lifecycle.removeRoom(this.getRoom(id));
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
      automationPending: this.automationPending() ?? {},
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
      { name: "rooms-file" as const, budget: plain, work: () => { this.registry.saveFinal(); } },
      ...(this.historyAccess.backupsStarted ? [{ name: "backup" as const, budget: plain, work: () => this.historyAccess.finalBackup() }] : []),
      { name: "automations" as const, budget: plain, work: () => this.automations?.close() },
      { name: "background-tasks" as const, budget: plain, work: () => this.backgroundTasks.close() },
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

    this.restarts.dispose();
    this.keeper?.close();
    this.keeper = null;
    if (this.channelsRetry) clearTimeout(this.channelsRetry);
    this.channelsRetry = null;
    this.leaving.abort();
    try { stopProductionPrivateTrial(this); } catch { this.log.warn("private-trial startup withdrawal refused"); }
    this.desk.revokeTrialBudgetCards("hub_shutdown");
    this.desk.dispose();
    this.programSettings.dispose();
    this.registry.dispose();
    this.backgroundTasks.dispose();
    this.historyAccess.dispose();
    if (this.nativeReportTimer) clearInterval(this.nativeReportTimer);
    this.nativeReportTimer = null;
    this.automations?.stop();
    this.memory.stop();
    for (const next of this.shutdownStages(plain)) await stage(next.name, next.budget, next.work);
    return steps;
  }

  private readonly importWriters = new Set<() => Promise<() => void>>();
  addImportWriters(hold: () => Promise<() => void>): () => void {
    this.importWriters.add(hold);
    return () => { this.importWriters.delete(hold); };
  }

  async reset(): Promise<void> {
    const releases: Array<() => void> = [];
    try {
      for (const hold of [...this.importWriters]) releases.push(await hold());
      try { this.settleArrivingRooms(); }
      catch (error) { this.log.warn(`carry import: ${error instanceof Error ? error.message : String(error)}`); }
      await this.erase();
    } finally {
      for (const release of releases) release();
    }
  }

  private async erase(): Promise<void> {
    try { stopProductionPrivateTrial(this); } catch { this.log.warn("private-trial startup withdrawal refused"); }
    this.desk.reset();
    this.memoryStore.invalidateTrialRevision();
    if (this.channelsRetry) clearTimeout(this.channelsRetry);
    this.channelsRetry = null;
    this.log.warn("erasing the whole data folder on the human's request");
    for (const id of this.rooms.keys()) this.memory.detachRoom(id);
    for (const room of this.rooms.values()) await room.shutdown();
    this.backgroundTasks.reset([...this.rooms.values()].map((room) => room.uuid));
    for (const [id, room] of this.rooms) { this.history?.dropRoom(id); this.automations?.store.removeRoom(room.uuid); this.historyAccess.dropRoom(room); }
    for (const id of this.registry.accepted) if (!this.rooms.has(id)) this.history?.dropRoom(id);
    this.history.memory.drop();
    this.registry.reset();
    for (const token of this.mcpTokens.keys()) this.mcpTokens.delete(token);
    rmSync(join(this.dataDir, "rooms"), { recursive: true, force: true });
    rmSync(this.registry.path, { force: true });
    rmSync(this.skills.dir, { recursive: true, force: true });
    rmSync(this.looks.dir, { recursive: true, force: true });
    mkdirSync(join(this.dataDir, "rooms"), { recursive: true });
    mkdirSync(this.skills.dir, { recursive: true });
    this.skills.list();
    this.skills.seedBuiltins();
    this.programSettings.reset();
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


function writeJson(path: string, value: unknown): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2));
}

