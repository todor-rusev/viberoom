// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { EventEmitter } from "node:events";
import { memoryBlock } from "./shared-memory.js";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { HistoryStore, type DivertOp, type PendingOp, cursorOf, type Cursor } from "./history-store.js";
import { foldIndex } from "./fold.js";
import { NOTES_ONLY_PROMPT, NOTES_REQUEST, crossedThreshold, emptyUsageReport, extractNotes, isBareContextFullError, isContextFullError, looksCompacted, overThreshold, settledVisible } from "./context.js";
import { spokenText } from "./spoken-text.js";
import { planNewRoom, type NewRoomPlan } from "./new-room.js";
import { formatDuration } from "./duration.js";
import { affectedByEdit, editNotice, EDIT_NOTICE_MAX, partitionHistory, rewriteNotice, type AgentReadState, type EditMode } from "./edit.js";
import { bodyRefs, registerBodyReader, resetBodyDelivery, supplyBodies, type BodyDelivery, type BodyEdit, type BodyRef } from "./body-delivery.js";
import { isRoomResourceName, saveImages, type Attachment, type ImageInput } from "./files.js";
import { agentReadableWindow, resolveQuotes, visibleToAgents, type Quote, type QuoteInput } from "./quotes.js";
import { canAutoApproveMessageCheck, isDirectMessageCheck, messageAddressing, messageCheckCursor, messageCheckHeader, messageCheckPageCursor, messageCheckPagePosition, messageCheckPosition, messageCheckTitle, packMessageCheck, packLiveDraft, parseMessageCheckArgs, type MessageCheckArgs, type MessageCheckCounts, type MessageCheckResult } from "./message-check.js";
import { historySearchReceipt, historySearchTitle, parseAgentSearchArgs, type AgentSearchArgs, type AgentSearchResult, type HistorySearchReceipt } from "./agent-history.js";
import { canAutoApproveRoomTool, isDirectRoomTool } from "./room-tool-identity.js";
import { dirname, join, resolve } from "node:path";
import { AcpAgent } from "./acp-client.js";
import { errorCode, errorDetail, RemoteError } from "./jsonrpc.js";
import { getRecipe, listRecipes, publicRecipes, type AgentRecipe } from "./recipes.js";
import { classifyStartFailure, classifyTurnFailure, type Trouble } from "./agent-health.js";
import { legacyRowTone } from "./rows.js";
import { composeSkillBlock, formatQuoteTime, skillPull, SKILL_TOOL_NAME, type SkillsForPrompt } from "./persona.js";
import {
  BUILTIN_AUTHOR,
  parseSkillInvocation,
  renderSkillBody,
  SKILL_NAME_PATTERN,
  type Skill,
  type SkillDraft,
  type SkillLibrary,
  type SkillMeta,
} from "./skills.js";
import type { McpServer } from "./acp-types.js";
import { runAsNodeEntries } from "./own-runtime.js";
import { templateId, type TemplateLibrary, type TemplateVibemate } from "./templates.js";
import type { LookCheck, LookSpec } from "./looks.js";
import type { AppearanceSettings } from "./hub.js";
import { applyVibemateChanges, diffSettings, lintRoomDesign, ruleLines, type RoomChangeSet, type RoomDesign, type RoomDesignContext, type SettingChange, type VibemateChange } from "./room-design.js";
import {
  BRIEF_AFFECTING_SETTINGS,
  AGENT_SETTINGS,
  coerceSetting,
  describeSettings,
  DEFAULT_ROOM_SETTINGS,
  ROOM_SETTINGS_SPEC,
  REQUEST_BRIEF_MARKER,
  NAME_PATTERN,
  SILENT_MARKER,
  buildBrief,
  buildHeader,
  composeCorrectionPrompt,
  composePrompt,
  countSentences,
  ensureDir,
  type BacklogImage,
  type BacklogLine,
  type BacklogQuote,
  type Persona,
  type PromptPart,
  type RoomSettings,
  type RosterEntry,
} from "./persona.js";
import { Logger, Transcript, type TranscriptMode } from "./log.js";
import type {
  ContentBlock,
  NewSessionResult,
  PermissionOption,
  PlanEntry,
  PromptResult,
  RequestPermissionParams,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionUpdate,
  StopReason,
  ToolCallUpdate,
  Usage,
} from "./acp-types.js";

export type ParticipantStatus = "unstaffed" | "starting" | "idle" | "queued" | "thinking" | "error" | "offline" | "left";

export interface LaunchPrefs {
  model: string | null;
  effort: string | null;
  mode: string | null;
}

export interface QuietTurn {
  since: number;
  turnId: string;
  processAlive: boolean;
  nudge?: "asking" | "answered" | "silent";
  stopping?: "asked" | "forcing";
}

export interface Participant {
  id: string;
  name: string;
  kind: "human" | "agent";
  agentType?: string;
  agentLabel?: string;
  agentVendor?: string;
  agentInfo?: { name?: string | null; version?: string | null };
  status: ParticipantStatus;
  statusDetail?: string;
  trouble?: Trouble;
  model?: string;
  effort?: string;
  mode?: string;
  configOptions?: SessionConfigOption[];
  modes?: { id: string; name: string; description?: string | null }[];
  contextUsed?: number;
  contextSize?: number;
  cost?: { amount: number; currency: string };
  turns: number;
  color: string;
  colorSlot?: number;
  tagline?: string;
  role?: string;
  avatar?: string;
  muted?: boolean;
  startupSkipped?: "muted";
  createdByVibemate?: boolean;
  replyDelay?: number;
  skills?: string[];
  skillChannel?: "tool" | "marker" | "pending";
  launch?: LaunchPrefs;
  violations?: number;
  notes?: string;
  notesAt?: number;
  notesSeq?: number;
  notesTurn?: boolean;
  contextEvent?: { kind: "threshold" | "compacted" | "full"; at: number; used?: number; size?: number };
  autoRespawnAt?: number;
  briefsSent?: number;
  failedTurns?: number;
  retries?: number;
  sessionId?: string;
  supportsLoad?: boolean;
  sessionOrigin?: "new" | "loaded" | "replayed";
  deliveryEpoch?: string;
  suppliedThrough?: number;
  activeTurnId?: string;
  lastSignAt?: number;
  pendingSettings?: { id: string; name: string; value: string | boolean }[];
  quiet?: QuietTurn;
  runSeen?: string;
  buildSeen?: string;
  sawFromSeq?: number;
}

export interface StoredParticipant {
  id: string;
  name: string;
  agentType: string;
  tagline: string;
  role: string;
  avatar: string;
  color: string;
  colorSlot?: number;
  launch: LaunchPrefs;
  muted: boolean;
  createdByVibemate?: boolean;
  replyDelay?: number;
  skills?: string[];
  sessionId?: string;
  deliveryEpoch?: string;
  suppliedThrough?: number;
  supportsLoad?: boolean;
  runSeen?: string;
  buildSeen?: string;
  lastSeenSeq?: number;
  sawFromSeq?: number;
  notes?: string;
  notesAt?: number;
  notesSeq?: number;
}

export interface ReconnectOptions {
  mode: "load" | "replay";
  replay?: number;
  reason?: string;
  memory?: boolean;
}

export interface EditPreview {
  seq: number;
  laterMessages: number;
  laterRecords: number;
  restart: string[];
  untouched: string[];
  offline: string[];
}

export interface ToolCallView {
  toolCallId: string;
  title: string;
  name?: string;
  kind?: string | null;
  status?: string | null;
  rawInput?: unknown;
  output?: string;
  locations?: string[];
  messageCheck?: { mode: "read" | "status"; checkedAt: string; available?: number; returned?: number; more?: boolean; reset?: boolean; counts?: MessageCheckCounts; previewed?: number; moreHeaders?: boolean };
  historySearch?: HistorySearchReceipt;
}

export interface MessageVia {
  platform: string;
  account: string;
  chatId: string;
  threadId?: string;
  updateId: string;
  messageId: string;
  senderId: string;
}

export type StoreOutcome = "record" | "journal" | "memory";

const ACCEPT_RECEIPT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export type ExternalReceipt =
  | {
      id: string;
      seq: number;
      stored: StoreOutcome;
      repeated: boolean;
      rerouted: boolean;
    }
  | {
      stored: "rejected";
      reason: string;
      repeated: false;
      rerouted: false;
      transient: boolean;
    };

export function hubChangeNote(seen: { runSeen?: string; buildSeen?: string }, run: { id: string; build: string } | null): string | null {
  if (!run || !seen.runSeen || seen.runSeen === run.id) return null;
  const head = "viberoom restarted (a new hub process).";
  if (seen.buildSeen === run.build) return `${head} It runs the same build as before: ${run.build}.`;
  if (!seen.buildSeen) return `${head} It runs the build from ${run.build}; which build you were running under was not recorded.`;
  return `${head} It runs the build from ${run.build}; you were running under the build from ${seen.buildSeen}.`;
}

export function readJournal(text: string): { ops: DivertOp[]; unreadable: number } {
  const ops: DivertOp[] = [];
  let unreadable = 0;
  for (const line of text.split(String.fromCharCode(10))) {
    if (!line.trim()) continue;
    try {
      ops.push(JSON.parse(line) as DivertOp);
    } catch {
      unreadable++;
    }
  }
  return { ops, unreadable };
}
export class RoomRefusal extends Error {
  constructor(message: string, readonly transient = false) {
    super(message);
  }
}

export interface ChatMessage {
  id: string;
  seq: number;
  from: string;
  fromName: string;
  to: string[];
  toNames: string[];
  text: string;
  ts: number;
  displayOrder?: number;
  kind: "chat" | "system" | "hidden";
  details?: { original?: string; corrections?: string[]; outcome?: string; skill?: string; via?: "tool" | "marker"; refId?: string; agentId?: string; tone?: "attention" | "error" | "hush"; about?: "room" };
  skill?: { name: string; args: string };
  edited?: { ts: number; previous: string };
  bodyDelivery?: BodyDelivery;
  bodyEdit?: BodyEdit;
  via?: MessageVia;
  pinned?: true;
  images?: Attachment[];
  quotes?: Quote[];
  audience?: "agents" | "human";
  wakes?: true;
  streaming?: boolean;
  thought?: string;
  origin?: string;
  branch?: { source: string; revision: string };
  variantOf?: { id: string; revision: string };
  resourceRefs?: { source: string; file: string; sha256?: string }[];
  notices?: string[];
  toolCalls?: ToolCallView[];
  plan?: PlanEntry[];
  stopReason?: StopReason;
  stoppedBy?: string;
  usage?: Usage | null;
  durationMs?: number;
}

export interface PendingPermission {
  key: string;
  participantId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  ts: number;
}

export interface NewRoomProposal {
  key: string;
  participantId: string;
  participantName: string;
  ts: number;
  plan: NewRoomPlan;
  status: "pending" | "created" | "refused";
  roomId?: string;
}

export interface RoomProposal {
  key: string;
  participantId: string;
  participantName: string;
  ts: number;
  why: string;
  settings: SettingChange[];
  vibemates: VibemateChange[];
  appearance?: SettingChange[];
  warnings: string[];
  touchesOwn: boolean;
  status: "pending" | "applied" | "rejected";
  skipped?: string[];
}

export interface RoomRecovery {
  rows: number;
  lastTs: number | null;
  ts: number;
  status: "pending" | "adopted";
}

export type RoomEvent =
  | { type: "recovery"; recovery: RoomRecovery }
  | { type: "participant"; participant: Participant }
  | { type: "participant.removed"; id: string }
  | { type: "message"; message: ChatMessage }
  | { type: "message.delivery"; updates: { id: string; delivery: BodyDelivery }[] }
  | { type: "message.removed"; id: string }
  | { type: "messages.truncated"; fromSeq: number }
  | { type: "record.replaced"; reason: "import" }
  | { type: "chunk"; id: string; text: string }
  | { type: "thought"; id: string; text: string }
  | { type: "toolcall"; id: string; toolCall: ToolCallView }
  | { type: "plan"; id: string; entries: PlanEntry[] }
  | { type: "permission"; permission: PendingPermission }
  | { type: "permission.resolved"; key: string; optionId: string | null }
  | { type: "proposal"; proposal: RoomProposal }
  | { type: "proposal.resolved"; key: string; status: "applied" | "rejected"; skipped?: string[] }
  | { type: "new-room"; proposal: NewRoomProposal }
  | { type: "new-room.resolved"; key: string; status: "created" | "refused"; roomId?: string }
  | { type: "room"; hopLimit: number; hops: number; settings: RoomSettings; customRulesText: string; focused: boolean; startingWithHub: boolean; name: string; dir: string }
  | { type: "notice"; text: string; level: "info" | "warn" | "error"; ts: number };

export type BriefTextCheck = "refuse" | "notice" | "keep";

export interface InviteOptions {
  id?: string;
  textCheck?: BriefTextCheck;
  color?: string;
  agentType: string;
  name: string;
  tagline?: string | null;
  role?: string | null;
  avatar?: string | null;
  replyDelay?: number | null;
  skills?: string[] | null;
  model?: string | null;
  effort?: string | null;
  mode?: string | null;
}

export interface PersonaPatch {
  name?: string;
  tagline?: string;
  role?: string;
  avatar?: string;
  replyDelay?: number | null;
  skills?: string[];
}

export interface SkillsBridge {
  library: SkillLibrary;
  serverScript: string;
  hubUrl: () => string | null;
  issueToken: (roomId: string, participantId: string) => string;
  revokeToken: (token: string) => void;
  needApproval: () => boolean;
  save: (draft: SkillDraft) => SkillMeta;
  templates: TemplateLibrary;
  templatesChanged: () => void;
  looks?: {
    list: () => LookSpec[];
    describe: () => Promise<Record<string, unknown>>;
    check: (raw: unknown) => Promise<LookCheck>;
    save: (raw: unknown, options: { author: string; replace?: boolean }) => Promise<LookCheck>;
  };
  appearance?: {
    current: () => AppearanceSettings;
    preview: (patch: Record<string, unknown>) => AppearanceSettings;
    apply: (patch: Record<string, unknown>) => void;
    ownAdjustments: (lookId: string) => Promise<{ label: string; values: Record<string, string> } | null>;
  };
}

export interface LookChangeSet {
  look?: string;
  adjust?: Record<string, unknown>;
  chatFontSize?: number;
  font?: string;
  mono?: string;
}

export interface AgentSkillInput {
  op: "create" | "update";
  name: string;
  description: string;
  instructions: string;
  argumentHint?: string;
  userInvocable?: boolean;
  agentInvocable?: boolean;
  dryRun?: boolean;
}

interface PendingSkill {
  name: string;
  text: string;
  invokedBy?: string;
  extraFiles: string[];
}

const SKILL_TOOL_READY_MS = 5000;
const AUTH_WAIT_MS = 8000;

export interface DiscoveredOptions {
  recipeId: string;
  agentInfo: { name: string | null; version: string | null };
  authMethods: string[];
  modes: NewSessionResult["modes"];
  configOptions: SessionConfigOption[];
  modelAtLaunch: boolean;
  modeAtLaunch: boolean;
  discoveredAt: number;
  durationMs: number;
}

export interface RoomOptions {
  id: string;
  uuid: string;
  folderId?: string;
  name: string;
  dir: string;
  dataDir: string;
  createdAt: number;
  humanName: string;
  programHumanDescription: string;
  bypassPermissionsByDefault: boolean;
  hubRun?: () => { id: string; build: string } | null;
  programTranscripts?: TranscriptMode;
  programFoldAfter?: number;
  settings?: Partial<Omit<RoomSettings, "name" | "humanName">>;
  log: Logger;
  optionCache?: Map<string, DiscoveredOptions>;
  skills?: SkillsBridge;
  history: HistoryStore;
  onHistoryFailure?: (roomId: string, error: unknown) => void;
}

interface AgentRuntime {
  agent: AcpAgent;
  sessionId: string;
  transcript: Transcript;
  log: Logger;
  firstTurnDone: boolean;
  lastSeenSeq: number;
  turnStartSeq: number;
  turnActive: boolean;
  pendingConfig?: { configId: string; value: string | boolean; from?: string }[];
  workBusy?: boolean;
  notesPending?: boolean;
  workCancelled?: boolean;
  usageSeenThisTurn?: boolean;
  pendingTurn: boolean;
  turn: { message: ChatMessage; messageId: string | null; sawMessageId: boolean; startedAt: number; lastSignAt?: number; lastWorkAt?: number; published: boolean; publishedAt?: number; hidden?: boolean; messagesFromSeq: number; shownLength?: number } | null;
  quiet?: { turnId: string; nudge?: "asking" | "answered" | "silent" };
  strayMessageId: string | null;
  turnsSinceBrief: number;
  usedAtBrief: number;
  briefSentThisTurn: boolean;
  lastUsed: number;
  briefPending: string | null;
  memoryStamp?: string;
  headerNotes: string[];
  historyNoticePending: boolean;
  briefRequestedAtSeq: number;
  notesDue: boolean;
  notesMisses: number;
  notesAskedThisTurn: boolean;
  lastBriefSeq: number;
  notesForBrief: string | null;
  replayOwnUntilSeq: number;
  delayTimer: NodeJS.Timeout | null;
  addressed: boolean;
  retiring: boolean;
  mcpToken: string | null;
  sessionStartedAt: number;
  skillChannel: "tool" | "marker" | "pending";
  skillReadyWaiters: (() => void)[];
  pendingSkills: PendingSkill[];
  skillPulledAtSeq: number;
  skillPulledName: string;
}

interface RetryRequest {
  prompt: string;
  original: string;
  corrections: string[];
  record: ChatMessage;
}

interface PermissionEntry extends PendingPermission {
  resolve: (response: RequestPermissionResponse) => void;
}

const ADAPTER_TRACE = "viberoom-trace ";
const SILENCE_CHECK_MS = 60_000;
const STOP_GRACE_MS = 30_000;
const SILENCE_MS = 10 * 60_000;
const WORK_SIGNS = new Set(["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan"]);
const NUDGE_WAIT_MS = 10_000;

const COLORS = ["#6d5dfc", "#16a34a", "#d97706", "#dc2626", "#0891b2", "#be185d", "#4d7c0f", "#7c3aed"];
export const CAST_SIZE = 8;
const MENTION_PATTERN = /@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
export { spokenText };
const RULE_REF_TOKEN = /@\{p:([^}]+)\}/g;
const ADAPTER_ERROR_PATTERN =
  /^(?:Warning: Falling back from WebSockets|unexpected status \d{3}|Error when talking to|API Error|You have exhausted your (?:daily )?quota|Rate limit|429 |5\d\d )/i;

function needsTheHuman(method: { id: string; name?: string | null; description?: string | null }, recipe?: AgentRecipe): boolean {
  if (recipe?.loginFlow.kind === "acp" && method.id === recipe.loginFlow.methodId) return true;
  return /\b(browser|oauth|log ?in with|sign ?in with)\b/i.test(`${method.id} ${method.name ?? ""} ${method.description ?? ""}`);
}

export function tokensCarried(result: { usage?: { inputTokens?: number | null; cachedReadTokens?: number | null } | null; _meta?: Record<string, unknown> | null }): number | null {
  const usage = result.usage;
  if (usage && typeof usage.inputTokens === "number" && usage.inputTokens > 0) return usage.inputTokens + (typeof usage.cachedReadTokens === "number" ? usage.cachedReadTokens : 0);
  const meta = result._meta as { quota?: { token_count?: { input_tokens?: unknown } } } | null | undefined;
  const fromMeta = meta?.quota?.token_count?.input_tokens;
  return typeof fromMeta === "number" && fromMeta > 0 ? fromMeta : null;
}

const STOPPED_WORK_KINDS = 3;

function callName(call: ToolCallView): string {
  const named = (call.name ?? "").trim();
  if (named) return named.split(/[._]/).length > 1 && named.includes(".") ? named.slice(named.lastIndexOf(".") + 1) : named;
  return (call.kind ?? "").trim() || "tool";
}

function stoppedWork(message: ChatMessage): string {
  const calls = message.toolCalls ?? [];
  if (!calls.length) return "; it had written nothing";
  const byName = new Map<string, number>();
  for (const call of calls) byName.set(callName(call), (byName.get(callName(call)) ?? 0) + 1);
  const ranked = [...byName].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = ranked.slice(0, STOPPED_WORK_KINDS).map(([name, times]) => (times > 1 ? `${name} ×${times}` : name));
  if (ranked.length > STOPPED_WORK_KINDS) shown.push("…");
  return `; it had made ${calls.length} tool call${calls.length === 1 ? "" : "s"} (${shown.join(", ")}) and had written nothing`;
}

export class Room extends EventEmitter {
  readonly id: string;
  readonly uuid: string;
  readonly folderId: string | null;
  name: string;
  dir: string;
  readonly dataDir: string;
  private readonly hubRun: () => { id: string; build: string } | null;
  readonly createdAt: number;
  settings: RoomSettings;
  hops = 0;
  focused = false;
  readonly participants = new Map<string, Participant>();
  readonly messages: ChatMessage[] = [];
  private seq = 0;
  private displayOrder = 0;
  private programHumanDescription: string;
  private bypassPermissionsByDefault: boolean;
  private programTranscripts: TranscriptMode;
  private programFoldAfter: number;
  private readonly historyEpoch = randomUUID();
  private historyRevision = 0;
  private readonly messageCheckKey = randomUUID();
  private messageCheckRevision = 0;
  private historyStreamSequence = 0;
  private readonly skills?: SkillsBridge;
  private readonly earlySkillReady = new Set<string>();
  private speaking: string | null = null;
  private readonly floorQueue: string[] = [];
  private humanTypingUntil = 0;
  private typingTimer: NodeJS.Timeout | null = null;
  private closing = false;
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly drafts = new Map<string, ChatMessage>();
  private readonly permissions = new Map<string, PermissionEntry>();
  private readonly proposals = new Map<string, RoomProposal>();
  private readonly newRooms = new Map<string, NewRoomProposal>();
  private readonly proposalPlans = new Map<string, { settings: SettingChange[]; vibemates: TemplateVibemate[]; ops: VibemateChange[]; ids: Record<string, string>; appearance?: Record<string, unknown> }>();
  private readonly optionCache: Map<string, DiscoveredOptions>;
  private readonly log: Logger;
  private colorIndex = 0;
  private nextColour(given?: string): { color: string; colorSlot: number } {
    const slot = this.colorIndex++ % CAST_SIZE;
    return { color: given ?? COLORS[slot % COLORS.length], colorSlot: slot };
  }
  private readonly departed = new Map<string, string>();
  private readonly restoredSeen = new Map<string, number>();

  constructor(options: RoomOptions) {
    super();
    this.id = options.id;
    this.uuid = options.uuid;
    this.folderId = options.folderId ?? null;
    this.name = options.name;
    this.dir = options.dir;
    this.dataDir = options.dataDir;
    this.createdAt = options.createdAt;
    this.programHumanDescription = options.programHumanDescription;
    this.bypassPermissionsByDefault = options.bypassPermissionsByDefault;
    this.hubRun = options.hubRun ?? (() => null);
    this.programTranscripts = options.programTranscripts ?? "off";
    this.programFoldAfter = options.programFoldAfter ?? 1200;
    this.skills = options.skills;
    this.history = options.history;
    this.onHistoryFailure = options.onHistoryFailure;
    this.settings = { ...DEFAULT_ROOM_SETTINGS, ...(options.settings ?? {}), name: options.name, humanName: options.humanName };
    this.log = options.log;
    this.optionCache = options.optionCache ?? new Map();
    mkdirSync(this.dataDir, { recursive: true });
    this.participants.set("human", {
      id: "human",
      name: options.humanName,
      kind: "human",
      status: "idle",
      turns: 0,
      color: "#111827",
    });
    this.loadHistory();
    for (const text of this.loadNotices) this.postSystem(text, "human");
  }


  private historyPath(): string {
    return join(this.dataDir, "history.jsonl");
  }

  filesDir(): string {
    return join(this.dataDir, "files");
  }

  imagePath(attachment: Attachment): string {
    return join(this.filesDir(), attachment.file);
  }

  private readonly history: HistoryStore;
  private readonly onHistoryFailure?: (roomId: string, error: unknown) => void;
  private divertPending = false;

  private divertPath(): string {
    return join(this.dataDir, "divert.jsonl");
  }

  private readonly loadNotices: string[] = [];
  private recordHold: string | null = null;
  recovery: RoomRecovery | null = null;
  private adopting: Promise<RoomRecovery> | null = null;

  private loadHistory(): void {
    this.drainDivert();
    this.purgeAcceptReceipts();
    let copyAwaits = false;
    if (!this.history.migration(this.id)) {
      try {
        const mark = this.history.migrateRoom(this.id, { jsonl: this.historyPath(), deleted: join(this.dataDir, "history.deleted.jsonl") });
        if (mark.imported || mark.marked) this.log.info(`history moved into the store: ${mark.imported} written, ${mark.marked} marked removed`);
        if (mark.source === "mirror") copyAwaits = true;
        if (mark.skipped) this.loadNotices.push(`${mark.skipped} line${mark.skipped === 1 ? "" : "s"} of history.jsonl could not be read and did not move into the conversation store; the file is kept as it was.`);
      } catch (error) {
        this.log.error(`history could not move into the store: ${describeError(error)}`);
        this.recordHold = `This room's history file could not be moved into the conversation store (${describeError(error)}). Until it is, the room is read-only: what the store holds is shown, nothing new is written and no vibemate answers. Keep a copy of history.jsonl in the room's folder, repair it, and restart; the move is tried again at the next start.`;
        this.loadNotices.push(this.recordHold);
      }
    } else if (this.history.sourceChangedSince(this.id, this.historyPath())) {
      this.log.warn("history.jsonl changed after the move to the store; it is not read again (export / import is the way)");
      this.loadNotices.push("history.jsonl was changed after this room moved to the conversation store; those changes are not shown (export and import are the way to bring text in).");
    }
    this.takeFromRecord();
    if (copyAwaits) {
      const chat = this.messages.filter((m) => m.kind === "chat");
      const last = chat.length ? chat[chat.length - 1].ts : null;
      this.recovery = { rows: chat.length, lastTs: last, ts: Date.now(), status: "pending" };
      this.recordHold = `No history file was found for this room, only the room's own copy of the conversation (${chat.length} message${chat.length === 1 ? "" : "s"}${last ? `, the last from ${new Date(last).toLocaleString()}` : ""}). The copy may lack the newest changes, so until you decide on the card the room is read-only: what the copy holds is shown, nothing new is written and no vibemate answers. To use the original instead, put history.jsonl back in the room's folder and restart.`;
      this.loadNotices.push(this.recordHold);
    }
    if (this.divertPending) {
      const journal = this.journalOps();
      if (journal.unreadable) {
        this.loadNotices.push(`${journal.unreadable} line(s) of this room's pending-changes journal could not be read and were skipped; everything else in it is here.`);
        this.log.warn(`divert.jsonl: ${journal.unreadable} unreadable line(s) skipped`);
      }
      for (const op of journal.ops) {
        if (this.opApplied(op)) continue;
        this.applyOpToMemory(op);
        if (op.kind === "upsert" || op.kind === "rewrite") {
          this.seq = Math.max(this.seq, op.message.seq);
          this.displayOrder = Math.max(this.displayOrder, op.message.displayOrder ?? op.message.seq);
        }
      }
    }
  }

  private journalOps(): { ops: DivertOp[]; unreadable: number } {
    const path = this.divertPath();
    if (!existsSync(path)) return { ops: [], unreadable: 0 };
    return readJournal(readFileSync(path, "utf8"));
  }

  private opApplied(op: DivertOp): boolean {
    try {
      return this.history.isApplied(op.opId);
    } catch {
      return false;
    }
  }

  private applyOpToMemory(op: DivertOp): void {
    if (op.kind === "truncate" || op.kind === "rewrite") {
      const kept = this.messages.filter((m) => m.seq <= op.fromSeq);
      this.messages.splice(0, this.messages.length, ...kept);
    }
    if (op.kind === "upsert" || op.kind === "rewrite") {
      const at = this.messages.findIndex((m) => m.id === op.message.id);
      if (at >= 0) this.messages[at] = op.message;
      else this.messages.push(op.message);
    }
    if (op.kind === "bury") {
      const gone = new Set(op.ids);
      this.messages.splice(0, this.messages.length, ...this.messages.filter((m) => !gone.has(m.id)));
    }
  }

  private persist(op: PendingOp): StoreOutcome {
    return this.persistMany([op]);
  }

  private persistMany(ops: PendingOp[]): StoreOutcome {
    if (!ops.length) return "record";
    const keys = ops.map((op) => op.opId).filter((k): k is string => !!k);
    if (new Set(keys).size !== keys.length) throw new Error("the same accept key on two writes in one batch");
    this.historyRevision += ops.length;
    const divertAll = (error: unknown): StoreOutcome => {
      let outcome: StoreOutcome = "journal";
      for (const op of ops) if (!this.divert({ ...op, opId: op.opId ?? randomUUID() }, error)) outcome = "memory";
      return outcome;
    };
    if (this.divertPending) {
      this.drainDivert();
      if (this.divertPending) return divertAll(new Error("earlier writes are still waiting in the divert journal"));
    }
    this.retryUnsavedExternal();
    try {
      const apply = () => {
        for (const op of ops) {
          if (op.opId) this.history.applyOp(this.id, op as DivertOp);
          else if (op.kind === "upsert") this.history.upsert(this.id, op.message);
          else if (op.kind === "rewrite") this.history.rewrite(this.id, op.message, op.fromSeq, op.deletedAt);
          else if (op.kind === "bury") this.history.markDeleted(this.id, op.ids, op.deletedAt);
          else this.history.truncateFrom(this.id, op.fromSeq, op.deletedAt);
        }
      };
      if (ops.length === 1) apply();
      else this.history.transaction(apply);
      return "record";
    } catch (error) {
      return divertAll(error);
    }
  }

  private divert(op: DivertOp, error: unknown): boolean {
    const why = describeError(error);
    let journaled = false;
    try {
      appendFileSync(this.divertPath(), JSON.stringify(op) + "\n");
      this.divertPending = true;
      journaled = true;
      this.log.warn(`the conversation store refused a write (${why}); kept in divert.jsonl to apply later`);
      this.notice(`The conversation store refused a write (${why}). The change is kept in the room's divert journal and applied when the store answers again.`, "error");
    } catch (second) {
      this.log.error(`the conversation store refused a write (${why}) and divert.jsonl could not be written either: ${describeError(second)}`);
      this.notice(`The conversation store refused a write (${why}) and the divert journal could not be written either: this change is NOT saved.`, "error");
    }
    this.onHistoryFailure?.(this.id, error);
    return journaled;
  }

  private readonly unsavedExternal = new Map<string, { message: ChatMessage; stored: StoreOutcome }>();

  purgeAcceptReceipts(before = Date.now() - ACCEPT_RECEIPT_KEEP_MS): number {
    try {
      return this.history.purgeAcceptedOps(before);
    } catch (error) {
      this.log.warn(`accept receipts not purged: ${describeError(error)}`);
      return 0;
    }
  }

  retryUnsavedExternal(): number {
    for (const [opId, entry] of this.unsavedExternal) {
      if (entry.stored !== "memory") continue;
      try {
        this.history.applyOp(this.id, { kind: "upsert", message: entry.message, opId, accept: true });
        this.unsavedExternal.delete(opId);
        this.log.info(`an external message kept in memory only is now in the store (${opId})`);
      } catch {
      }
    }
    let left = 0;
    for (const entry of this.unsavedExternal.values()) if (entry.stored === "memory") left++;
    return left;
  }

  private drainDivert(): void {
    const path = this.divertPath();
    if (!existsSync(path)) {
      this.divertPending = false;
      return;
    }
    const journal = this.journalOps();
    try {
      for (const op of journal.ops) this.history.applyOp(this.id, op);
    } catch (error) {
      this.divertPending = true;
      this.log.warn(`divert.jsonl could not be applied yet: ${describeError(error)}`);
      return;
    }
    rmSync(path, { force: true });
    this.divertPending = false;
    if (journal.ops.length) this.log.info(`divert.jsonl applied: ${journal.ops.length} operation(s)${journal.unreadable ? `, ${journal.unreadable} unreadable line(s) dropped` : ""}`);
    for (const [opId, entry] of this.unsavedExternal) if (entry.stored === "journal") this.unsavedExternal.delete(opId);
  }

  get historyDiverted(): boolean {
    return this.divertPending;
  }

  restore(stored: StoredParticipant[], options: { quiet?: boolean } = {}): void {
    for (const s of stored) {
      if (!s.agentType) {
        const p = this.addUnstaffed({ name: s.name, tagline: s.tagline, role: s.role, avatar: s.avatar, skills: s.skills, color: s.color, id: s.id, textCheck: "keep", quiet: options.quiet, restoring: true });
        p.colorSlot = s.colorSlot ?? p.colorSlot;
        p.muted = s.muted; p.replyDelay = s.replyDelay; p.launch = s.launch;
        p.createdByVibemate = s.createdByVibemate;
        continue;
      }
      const recipe = getRecipe(s.agentType);
      this.participants.set(s.id, {
        id: s.id,
        name: s.name,
        kind: "agent",
        agentType: s.agentType,
        agentLabel: recipe?.label ?? s.agentType,
        agentVendor: recipe?.vendor ?? s.agentType,
        status: "offline",
        statusDetail: s.muted ? "Not summoned — muted" : "not connected since the room restarted",
        ...(s.muted ? { startupSkipped: "muted" as const } : {}),
        turns: 0,
        color: s.color,
        colorSlot: s.colorSlot ?? (COLORS.indexOf(s.color) >= 0 ? COLORS.indexOf(s.color) : undefined),
        tagline: s.tagline,
        role: s.role,
        avatar: s.avatar || undefined,
        muted: s.muted,
        createdByVibemate: s.createdByVibemate,
        replyDelay: s.replyDelay,
        skills: normalizeSkillList(s.skills),
        launch: s.launch,
        sessionId: s.sessionId,
        deliveryEpoch: s.deliveryEpoch,
        suppliedThrough: s.suppliedThrough,
        supportsLoad: s.supportsLoad,
        sawFromSeq: s.sawFromSeq,
        runSeen: s.runSeen,
        buildSeen: s.buildSeen,
        notes: s.notes,
        notesAt: s.notesAt,
        notesSeq: s.notesSeq,
        violations: 0,
        briefsSent: 0,
        failedTurns: 0,
      });
      if (s.lastSeenSeq !== undefined) this.restoredSeen.set(s.id, s.lastSeenSeq);
      this.colorIndex++;
    }
    const furthest = Math.max(this.seq, ...this.restoredSeen.values());
    if (furthest > this.seq) {
      this.log.warn(`the record reaches #${this.seq} but a vibemate had read up to #${furthest}: the count continues from there`);
      this.seq = furthest;
    }
  }

  templateOf(): { dir: string; settings: Partial<RoomSettings>; vibemates: TemplateVibemate[] } {
    const { name: _n, humanName: _h, ...rest } = this.settings;
    const settings: Partial<RoomSettings> = { ...rest, customRules: this.renderRuleReferences(this.settings.customRules) };
    const vibemates: TemplateVibemate[] = [];
    for (const p of this.participants.values()) {
      if (p.kind !== "agent" || p.status === "left") continue;
      const v: TemplateVibemate = { name: p.name };
      if (p.tagline) v.tagline = p.tagline;
      if (p.role) v.role = p.role;
      if (p.avatar) v.avatar = p.avatar;
      if (p.skills?.length) v.skills = [...p.skills];
      if (p.replyDelay !== undefined) v.replyDelay = p.replyDelay;
      if (p.agentType) {
        v.agentType = p.agentType;
        const model = p.launch?.model ?? p.model;
        const effort = p.launch?.effort ?? p.effort;
        const mode = p.launch?.mode ?? p.mode;
        if (model) v.model = model;
        if (effort) v.effort = effort;
        if (mode) v.mode = mode;
      }
      vibemates.push(v);
    }
    return { dir: this.dir, settings, vibemates };
  }

  toStored(): { id: string; uuid: string; name: string; dir: string; createdAt: number; settings: Partial<RoomSettings>; participants: StoredParticipant[] } {
    const { name: _n, humanName: _h, ...settings } = this.settings;
    return {
      id: this.id,
      uuid: this.uuid,
      name: this.name,
      dir: this.dir,
      createdAt: this.createdAt,
      settings,
      participants: [...this.participants.values()]
        .filter((p) => p.kind === "agent" && (p.agentType || p.status === "unstaffed"))
        .map((p) => ({
          id: p.id,
          name: p.name,
          agentType: p.agentType ?? "",
          tagline: p.tagline ?? "",
          role: p.role ?? "",
          avatar: p.avatar ?? "",
          color: p.color,
          colorSlot: p.colorSlot,
          launch: p.launch ?? { model: p.model ?? null, effort: p.effort ?? null, mode: p.mode ?? null },
          muted: !!p.muted,
          createdByVibemate: p.createdByVibemate || undefined,
          replyDelay: p.replyDelay,
          skills: p.skills && p.skills.length ? [...p.skills] : undefined,
          sessionId: p.sessionId,
          deliveryEpoch: p.deliveryEpoch,
          suppliedThrough: p.suppliedThrough,
          supportsLoad: p.supportsLoad,
          lastSeenSeq: this.runtimes.get(p.id)?.lastSeenSeq ?? this.restoredSeen.get(p.id),
          sawFromSeq: p.sawFromSeq,
          runSeen: p.runSeen,
          buildSeen: p.buildSeen,
          notes: p.notes,
          notesAt: p.notesAt,
          notesSeq: p.notesSeq,
        })),
    };
  }

  private commit(message: ChatMessage, opId?: string): StoreOutcome {
    message.displayOrder ??= ++this.displayOrder;
    if (this.folderId) message.origin ??= this.folderId;
    this.messages.push(message);
    const stored = this.persist(opId ? { kind: "upsert", message, opId, accept: true } : { kind: "upsert", message });
    this.push({ type: "message", message });
    return stored;
  }

  private takeFromRecord(): void {
    this.messages.splice(0, this.messages.length);
    for (const message of this.history.all(this.id)) {
      if (message.kind === "system" && !message.details?.tone) {
        const tone = legacyRowTone(message.text);
        if (tone) message.details = { ...(message.details ?? {}), tone };
      }
      this.messages.push(message);
      this.displayOrder = Math.max(this.displayOrder, message.displayOrder ?? message.seq);
    }
    this.seq = Math.max(this.seq, this.history.maxSeq(this.id));
  }

  absorbImported(arriving: ChatMessage[], buried: { id: string; at: number }[]): StoreOutcome {
    if (!arriving.length && !buried.length) return "record";
    const ops: PendingOp[] = arriving.map((message) => ({ kind: "upsert", message }));
    for (const grave of buried) ops.push({ kind: "bury", ids: [grave.id], deletedAt: grave.at });
    const stored = this.persistMany(ops);
    this.takeFromRecord();
    this.push({ type: "record.replaced", reason: "import" });
    return stored;
  }

  get hasConnectedAgents(): boolean { return this.runtimes.size > 0; }

  importCommitted(): void {
    this.takeFromRecord();
    this.messageCheckRevision++;
    this.push({ type: "record.replaced", reason: "import" });
  }

  private messagesWithLiveDrafts(): ChatMessage[] {
    const live = [...this.runtimes.values()].filter((r) => r.turn?.published).map((r) => r.turn!.message);
    return [...this.messages, ...live].sort((a, b) =>
      (a.displayOrder ?? a.seq) - (b.displayOrder ?? b.seq) || a.seq - b.seq || a.id.localeCompare(b.id),
    );
  }


  get humanName(): string {
    return this.settings.humanName;
  }

  turnProgressMark(participantId: string): string {
    const turn = this.runtimes.get(participantId)?.turn;
    return turn ? `${turn.message.id}:${turn.lastSignAt ?? turn.startedAt}:${turn.message.text.length}:${turn.message.toolCalls?.length ?? 0}` : "";
  }

  messageById(messageId: string): ChatMessage | undefined {
    let message = this.messages.find(m => m.id === messageId);
    if (!message) for (const runtime of this.runtimes.values()) {
      if (runtime.turn?.published && runtime.turn.message.id === messageId) { message = runtime.turn.message; break; }
    }
    return message;
  }
  toolCallDetails(messageId: string, toolCallId: string): ToolCallView | undefined {
    return this.messageById(messageId)?.toolCalls?.find(call => call.toolCallId === toolCallId);
  }

  get hopLimit(): number {
    return this.settings.hopLimit;
  }

  private effectiveFoldAfter(): number {
    return this.settings.foldAfter ?? this.programFoldAfter;
  }

  private handedFromSeq(): number | undefined {
    let from: number | undefined;
    for (const [id, runtime] of this.runtimes) {
      if (!runtime.agent?.alive) continue;
      const start = this.participants.get(id)?.sawFromSeq;
      if (start === undefined) continue;
      if (from === undefined || start < from) from = start;
    }
    return from;
  }

  historyStamp() {
    let chats = 0;
    let lastChatAt: number | null = null;
    for (const m of this.messages) if (m.kind === "chat") { chats++; lastChatAt = Math.max(lastChatAt ?? 0, m.ts); }
    return { epoch: this.historyEpoch, revision: this.historyRevision, version: `${this.historyEpoch}:${this.historyRevision}`,
      streamSequence: this.historyStreamSequence, handedFromSeq: this.handedFromSeq(), total: this.messages.length, chats, lastChatAt };
  }

  snapshot(request: { from?: Cursor; all?: boolean; seq?: number; message?: string } = {}): unknown {
    const last = this.messages.length ? this.messages[this.messages.length - 1] : null;
    const all = this.messagesWithLiveDrafts();
    let from = foldIndex(all, this.effectiveFoldAfter());
    if (request.all) from = 0;
    if (request.from) {
      const c = request.from;
      const index = all.findIndex(m => {
        const at = cursorOf(m);
        return at.order > c.order || (at.order === c.order && at.seq >= c.seq);
      });
      if (index >= 0) from = Math.min(from, index);
    }
    const targetSeq = request.seq;
    if (targetSeq !== undefined) {
      const index = all.findIndex(m => m.seq === targetSeq);
      if (index >= 0) from = Math.min(from, Math.max(0, index - 25));
    }
    if (request.message) {
      const index = all.findIndex(m => m.id === request.message);
      if (index >= 0) from = Math.min(from, Math.max(0, index - 25));
    }
    const shown = from ? all.slice(from) : all;
    const hidden = from ? all.slice(0, from).filter(m => m.seq > 0 && !m.streaming).length : 0;
    const latest: Record<string, { seq: number; usage?: ChatMessage["usage"] }> = {};
    for (const m of this.messages) if (m.kind === "chat") latest[m.from] = { seq: m.seq, ...(m.usage ? { usage: m.usage } : {}) };
    const lastChat = [...all].reverse().find(m => m.kind === "chat");
    return {
      history: { ...this.historyStamp(), hidden, oldest: hidden ? cursorOf(shown[0]) : null, latest,
        lastChat: lastChat ? { id: lastChat.id, seq: lastChat.seq, from: lastChat.from, fromName: lastChat.fromName, ts: lastChat.ts, text: lastChat.text.slice(0, 160) } : null },
      pinnedOlder: from ? all.slice(0, from).filter((m) => m.pinned && m.kind === "chat") : [],
      id: this.id,
      filesDir: this.filesDir(),
      sources: this.history.carry.sources(),
      resourceVersions: this.history.carry.resources(this.id),
      name: this.name,
      dir: this.dir,
      createdAt: this.createdAt,
      humanName: this.humanName,
      hopLimit: this.hopLimit,
      hops: this.hops,
      focused: this.focused,
      startingWithHub: this.startingWithHub,
      settings: this.settings,
      customRulesText: this.renderRuleReferences(this.settings.customRules),
      participants: [...this.participants.values()].map(p => this.participantView(p)),
      messages: shown,
      permissions: [...this.permissions.values()].map(({ resolve: _r, ...p }) => p),
      proposals: [...this.proposals.values()],
      newRooms: [...this.newRooms.values()],
      recovery: this.recovery,
      readOnly: this.readOnly,
      recipes: publicRecipes(),
      lastMessageAt: last?.ts ?? this.createdAt,
    };
  }

  applyProgramSettings(program: { humanName: string; humanDescription: string; bypassPermissionsByDefault: boolean; transcripts?: TranscriptMode; foldAfter?: number }): void {
    const changed: string[] = [];
    this.bypassPermissionsByDefault = program.bypassPermissionsByDefault;
    if (program.transcripts) this.programTranscripts = program.transcripts;
    if (program.transcripts) this.updateTranscriptModes();
    if (program.foldAfter) this.programFoldAfter = program.foldAfter;
    if (program.humanName !== this.settings.humanName) {
      this.settings = { ...this.settings, humanName: program.humanName };
      const human = this.participants.get("human")!;
      human.name = program.humanName;
      this.push({ type: "participant", participant: human });
      changed.push("human name");
    }
    if (program.humanDescription !== this.programHumanDescription) {
      this.programHumanDescription = program.humanDescription;
      if (this.settings.humanDescriptionMode !== "override") changed.push("human description");
    }
    if (changed.length) {
      for (const runtime of this.runtimes.values()) runtime.briefPending = `room rules: ${changed.join(", ")}`;
      this.push(this.roomEvent());
    }
  }

  private effectiveSettings(): RoomSettings {
    const own = this.settings.humanDescription.trim();
    const program = this.programHumanDescription.trim();
    let humanDescription = own;
    if (this.settings.humanDescriptionMode === "inherit") humanDescription = program;
    else if (this.settings.humanDescriptionMode === "append") humanDescription = [program, own].filter(Boolean).join(" ");
    else if (this.settings.humanDescriptionMode === "none") humanDescription = "";
    return { ...this.settings, humanDescription, customRules: this.renderRuleReferences(this.settings.customRules) };
  }

  private resolveRuleReferences(text: string): { stored: string; unknown: string[] } {
    const unknown: string[] = [];
    const stored = text.replace(MENTION_PATTERN, (whole, name: string) => {
      const p = this.findByName(name);
      if (p) return `@{p:${p.id}}`;
      if (!unknown.includes(name)) unknown.push(name);
      return whole;
    });
    return { stored, unknown };
  }

  private renderRuleReferences(stored: string): string {
    return stored.replace(RULE_REF_TOKEN, (_whole, id: string) => {
      const p = this.participants.get(id);
      if (p) return `@${p.name}`;
      const gone = this.departed.get(id);
      return gone ? `@${gone} (no longer in the room)` : "@(a participant who left)";
    });
  }


  unstaffed(): Participant[] {
    return [...this.participants.values()].filter((p) => p.kind === "agent" && p.status === "unstaffed");
  }

  get readOnly(): boolean {
    return this.recordHold !== null;
  }

  private assertRecordOpen(): void {
    if (this.recordHold) throw new RoomRefusal(this.recordHold, true);
  }

  channelNotice(text: string, level: "info" | "warn" | "error"): void {
    this.notice(text, level);
  }

  channelRecord(text: string): void {
    this.postRoomEvent(text);
  }

  shownStatus(id: string): ParticipantStatus | "working" | "writing" | "notes" {
    const participant = this.participants.get(id);
    if (!participant) return "left";
    if (participant.status !== "thinking") return participant.status;
    if (participant.notesTurn) return "notes";
    const draft = [...this.drafts.values()].find((m) => m.streaming && m.from === id);
    if (!draft) return "thinking";
    if ((draft.toolCalls ?? []).some((c) => c.status === "pending" || c.status === "in_progress")) return "working";
    return draft.text ? "writing" : "thinking";
  }

  whoIsBusy(): import("./message-check.js").CheckedVibemate[] {
    const now = Date.now();
    const out: import("./message-check.js").CheckedVibemate[] = [];
    for (const p of this.participants.values()) {
      if (p.kind !== "agent" || p.status === "left") continue;
      const state = p.muted ? "muted" : this.shownStatus(p.id);
      const turn = this.runtimes.get(p.id)?.turn;
      const parts = [state];
      let timing: Pick<import("./message-check.js").CheckedVibemate, "startedAt" | "elapsedSeconds" | "quietSeconds"> = {};
      if (turn && !turn.hidden && Number.isFinite(turn.startedAt)) {
        const elapsedSeconds = Math.max(0, Math.floor((now - turn.startedAt) / 1000));
        const quietSeconds = Math.max(0, Math.floor((now - (turn.lastSignAt ?? turn.startedAt)) / 1000));
        timing = { startedAt: new Date(turn.startedAt).toISOString(), elapsedSeconds, quietSeconds };
        parts.push(formatDuration(elapsedSeconds * 1000));
        const quiet = Math.floor(quietSeconds / 60);
        if (quiet >= 1) parts.push(`nothing new for ${quiet} min`);
        parts.push(`since ${formatQuoteTime(turn.startedAt).slice(-5)}`);
      }
      out.push({ name: p.name, state, line: parts.join(" · "), ...timing });
    }
    return out;
  }

  private silenceWatch: NodeJS.Timeout | null = null;
  private readonly toldOfSilence = new Set<string>();

  private watchForSilence(): void {
    if (this.silenceWatch) return;
    this.silenceWatch = setInterval(() => this.checkSilence(), SILENCE_CHECK_MS);
    this.silenceWatch.unref?.();
  }

  private checkSilence(): void {
    let active = false;
    for (const [id, runtime] of this.runtimes) {
      const turn = runtime.turn;
      if (!runtime.turnActive || !turn || turn.hidden) continue;
      active = true;
      const quiet = Date.now() - (turn.lastSignAt ?? turn.startedAt);
      if (quiet < SILENCE_MS) continue;
      const participant = this.participants.get(id);
      if (!participant || participant.muted) continue;
      if (!runtime.quiet || runtime.quiet.turnId !== turn.message.id) {
        runtime.quiet = { turnId: turn.message.id };
        this.push({ type: "participant", participant });
      }
      if (this.toldOfSilence.has(turn.message.id)) continue;
      this.toldOfSilence.add(turn.message.id);
      const minutes = Math.round(quiet / 60_000);
      const kept = runtime.transcript.dump(`nothing new from ${participant.name} for ${minutes} minutes`);
      if (kept) this.log.info(`protocol kept: ${kept}`);
      this.postSystem(`${participant.name}: nothing new for ${minutes} minutes; its turn started at ${formatQuoteTime(turn.startedAt).slice(-5)}.`, "human", false, { agentId: id, tone: "attention" });
    }
    if (active) return;
    if (this.silenceWatch) clearInterval(this.silenceWatch);
    this.silenceWatch = null;
    this.toldOfSilence.clear();
  }

  hubRecord(text: string): void {
    this.postRoomEvent(text);
  }

  noteStartedWithHub(mode: string, skippedMuted = 0): void {
    this.postRoomEvent(skippedMuted
      ? `Started with viberoom (${mode}): ${skippedMuted} muted vibemate${skippedMuted === 1 ? " was" : "s were"} left not summoned.`
      : `Started with viberoom: the vibemates are back (${mode}).`);
  }

  noteMutedStartup(id: string): void {
    const participant = this.participants.get(id);
    if (!participant?.muted || participant.status !== "offline") return;
    participant.startupSkipped = "muted";
    participant.statusDetail = "Not summoned — muted";
    this.push({ type: "participant", participant });
  }

  private restartMessageHandled = false;

  wakeAfterRestart(restored: string[]): void {
    if (this.restartMessageHandled) return;
    this.restartMessageHandled = true;
    const text = this.settings.restartMessage.trim();
    if (!this.settings.startWithHub || !this.settings.wakeAfterRestart || !text || this.closing || this.focused || this.recordHold) return;
    const targets = [...new Set(restored)].filter(id => {
      const participant = this.participants.get(id), runtime = this.runtimes.get(id);
      return participant?.kind === "agent" && participant.status === "idle" && !participant.muted && runtime?.agent.alive && !runtime.retiring && !runtime.workCancelled && !runtime.turnActive;
    });
    if (!targets.length) return;
    this.postRoomEvent(`Automatic restart message, configured by ${this.humanName}:\n${text}`, undefined, true);
    this.hops = 0;
    this.push(this.roomEvent());
    for (const id of targets) this.requestTurn(id);
  }

  exportMarkdown(): string {
    return this.history.exportMarkdown(this.id, this.settings.name);
  }

  private assertRecordOpenForAgents(): void {
    if (this.recordHold) throw new Error("this room's record is not settled yet (the human is deciding on it); its history cannot be read until then");
  }

  async adoptCopy(backup: () => Promise<unknown>, stillMine: () => boolean): Promise<RoomRecovery> {
    if (!this.recovery) throw new Error("this room has no copy waiting for a decision");
    if (this.recovery.status === "adopted") return this.recovery;
    if (this.adopting) return this.adopting;
    this.adopting = (async () => {
      try {
        await backup();
      } catch (error) {
        throw new Error(`The copy was not taken as the record: a backup of the conversation store failed first (${describeError(error)}). Nothing changed.`);
      }
      if (!stillMine() || this.closing || !this.recovery || this.recovery.status !== "pending") throw new Error("the room changed while the backup was made; nothing was taken as the record");
      this.history.adoptMirror(this.id);
      this.recovery = { ...this.recovery, status: "adopted" };
      this.recordHold = null;
      this.push({ type: "recovery", recovery: this.recovery });
      this.postSystem(`${this.settings.humanName} chose the room's own copy as its record (${this.recovery.rows} message${this.recovery.rows === 1 ? "" : "s"}); a backup of the conversation store was kept first. The room is open again.`, "human");
      return this.recovery;
    })().finally(() => {
      this.adopting = null;
    });
    return this.adopting;
  }

  postHumanMessage(text: string, images: ImageInput[] = [], quotes: QuoteInput[] = []): ChatMessage {
    const message = this.buildHumanMessage(text, images, quotes);
    this.commit(message);
    this.route(message);
    return message;
  }

  acceptExternalMessage(input: { opId: string; via: MessageVia; text: string; images?: ImageInput[]; quotes?: QuoteInput[] }): ExternalReceipt {
    const held = this.unsavedExternal.get(input.opId);
    if (held) return { id: held.message.id, seq: held.message.seq, stored: held.stored, repeated: true, rerouted: false };
    const applied = this.appliedReceipt(input.opId);
    if (applied) return { id: applied.messageId, seq: applied.seq, stored: "record", repeated: true, rerouted: this.rerouteIfNeverSeen(applied.messageId) };
    let message: ChatMessage;
    try {
      message = this.buildHumanMessage(input.text, input.images ?? [], input.quotes ?? []);
    } catch (error) {
      if (error instanceof RoomRefusal) return { stored: "rejected", reason: error.message, repeated: false, rerouted: false, transient: error.transient };
      throw error;
    }
    message.via = input.via;
    const stored = this.commit(message, input.opId);
    if (stored !== "record") this.unsavedExternal.set(input.opId, { message, stored });
    this.route(message);
    return { id: message.id, seq: message.seq, stored, repeated: false, rerouted: false };
  }

  private rerouteIfNeverSeen(messageId: string): boolean {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message || message.kind !== "chat") return false;
    const live = this.agentReadStates().filter((s) => s.online);
    if (!live.length || live.some((s) => s.lastSeenSeq >= message.seq || s.active)) return false;
    this.route(message);
    return true;
  }

  private appliedReceipt(opId: string): { messageId: string; seq: number } | null {
    try {
      return this.history.appliedReceipt(opId);
    } catch (error) {
      throw new Error(`the conversation store cannot say whether this message was accepted before (${describeError(error)}); nothing was written`);
    }
  }

  private buildHumanMessage(text: string, images: ImageInput[], quotes: QuoteInput[]): ChatMessage {
    this.assertRecordOpen();
    const waiting = this.unstaffed();
    if (waiting.length) throw new RoomRefusal(`${waiting.map((p) => p.name).join(", ")} ${waiting.length === 1 ? "has" : "have"} no coding agent yet: summon ${waiting.length === 1 ? "it" : "them"} from the roster to start the conversation`);
    const trimmed = text.trim();
    if (!trimmed && !images.length && !quotes.length) throw new RoomRefusal("empty message");
    const quoted = quotes.length ? resolveQuotes(quotes, this.messages, new Set(this.drafts.keys())) : [];
    const attachments = images.length ? saveImages(ensureDir(this.filesDir()), images) : [];
    this.humanTypingUntil = 0;
    const human = this.participants.get("human")!;
    const message: ChatMessage = {
      id: randomUUID(),
      seq: ++this.seq,
      from: human.id,
      fromName: human.name,
      to: [],
      toNames: [],
      text: trimmed,
      ts: Date.now(),
      kind: "chat",
    };
    if (attachments.length) message.images = attachments;
    if (quoted.length) message.quotes = quoted;
    this.decorateHumanMessage(message);
    message.bodyDelivery = { version: 1, readers: {} };
    for (const p of this.participants.values()) {
      if (p.kind === "agent" && this.runtimes.get(p.id)?.agent.alive) registerBodyReader(message, p.id, this.ensureDeliveryEpoch(p));
    }
    human.turns += 1;
    if (this.focused) {
      this.focused = false;
      this.push(this.roomEvent());
    }
    return message;
  }

  private decorateHumanMessage(message: ChatMessage): void {
    const mentions = this.parseMentions(message.text);
    message.to = mentions.ids;
    message.toNames = mentions.names;
    delete message.skill;
    const invocation = parseSkillInvocation(message.text);
    if (invocation) {
      const skill = this.skills?.library.get(invocation.name);
      if (!skill) this.notice(`No skill named "${invocation.name}" in the library; sent as plain text.`, "warn");
      else if (!skill.userInvocable) this.notice(`Skill "${skill.name}" is not user-invocable; sent as plain text.`, "warn");
      else if (skill.problems.length) this.notice(`Skill "${skill.name}" has problems (${skill.problems.join("; ")}); sent as plain text.`, "warn");
      else message.skill = { name: skill.name, args: invocation.args };
    }
  }


  private agentReadStates(): AgentReadState[] {
    const out: AgentReadState[] = [];
    for (const p of this.participants.values()) {
      if (p.kind !== "agent" || p.status === "left" || p.status === "unstaffed") continue;
      const runtime = this.runtimes.get(p.id);
      if (runtime) out.push({ id: p.id, name: p.name, lastSeenSeq: runtime.lastSeenSeq, suppliedThrough: p.suppliedThrough, active: runtime.turnActive, online: true });
      else out.push({ id: p.id, name: p.name, lastSeenSeq: this.restoredSeen.get(p.id) ?? -1, suppliedThrough: p.suppliedThrough, active: false, online: false });
    }
    return out;
  }

  private editableMessage(messageId: string): ChatMessage {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message || message.kind !== "chat" || message.from !== "human") throw new Error("only your own chat messages can be edited");
    return message;
  }

  setPinned(messageId: string, pinned: boolean): ChatMessage {
    this.assertRecordOpen();
    const message = this.messages.find((m) => m.id === messageId) ?? this.drafts.get(messageId);
    if (!message || message.kind !== "chat") throw new Error("only chat messages can be pinned");
    if (!!message.pinned === pinned) return message;
    if (pinned) message.pinned = true;
    else delete message.pinned;
    if (!message.streaming) this.persist({ kind: "upsert", message });
    this.push({ type: "message", message });
    return message;
  }

  previewEdit(messageId: string): EditPreview {
    const message = this.editableMessage(messageId);
    const { removed } = partitionHistory(this.messages, message.seq);
    const { restart, untouched, offline } = affectedByEdit(this.agentReadStates(), message.seq);
    return {
      seq: message.seq,
      laterMessages: removed.filter((m) => m.kind === "chat").length,
      laterRecords: removed.length,
      restart: restart.map((a) => a.name),
      untouched: untouched.map((a) => a.name),
      offline: offline.map((a) => a.name),
    };
  }

  async editMessage(messageId: string, text: string, mode: EditMode): Promise<{ restarted: string[]; removed: number }> {
    this.assertRecordOpen();
    const trimmed = text.trim();
    if (!trimmed) throw new Error("empty message");
    const message = this.editableMessage(messageId);
    if (trimmed === message.text) throw new Error("the text is unchanged");
    this.messageCheckRevision++;
    const { restart, offline } = affectedByEdit(this.agentReadStates(), message.seq);
    const previous = message.text;
    const previousVersion = message.bodyDelivery?.version ?? 1;
    resetBodyDelivery(message);
    for (const p of this.participants.values()) {
      if (p.kind === "agent" && this.runtimes.get(p.id)?.agent.alive) registerBodyReader(message, p.id, this.ensureDeliveryEpoch(p));
    }
    message.edited = { ts: Date.now(), previous };
    message.text = trimmed;
    this.decorateHumanMessage(message);
    this.humanTypingUntil = 0;
    if (this.focused) {
      this.focused = false;
      this.push(this.roomEvent());
    }

    if (mode === "notify") {
      this.persist({ kind: "upsert", message });
      this.push({ type: "message", message });
      if (restart.length || offline.length) {
        const append = trimmed.startsWith(previous);
        const payload = append ? trimmed.slice(previous.length) : trimmed;
        this.postSystem(editNotice(this.humanName, previous, trimmed), "agents", true, undefined,
          { id: message.id, fromVersion: previousVersion, version: message.bodyDelivery!.version, append, complete: payload.length <= EDIT_NOTICE_MAX });
      }
      for (const a of restart) this.requestTurn(a.id);
      this.log.info(`edit (notify) of #${message.seq}: ${restart.length} agents had the old version`);
      this.route(message);
      return { restarted: [], removed: 0 };
    }

    const { kept, removed } = partitionHistory(this.messages, message.seq);
    for (const a of restart) {
      const runtime = this.runtimes.get(a.id);
      if (!runtime) continue;
      this.dropScheduledTurn(a.id);
      this.cancelPermissionsOf(a.id);
    }
    this.messages.splice(0, this.messages.length, ...kept);
    this.persist({ kind: "rewrite", fromSeq: message.seq, deletedAt: Date.now(), message });
    this.push({ type: "messages.truncated", fromSeq: message.seq });
    this.push({ type: "message", message });
    if (this.speaking && restart.some((a) => a.id === this.speaking)) this.speaking = null;

    const restarted: string[] = [];
    for (const a of restart) {
      await this.retireRuntime(a.id);
      try {
        await this.reconnect(a.id, { mode: "replay", reason: "the conversation was rewritten" });
        restarted.push(a.name);
      } catch (error) {
        this.notice(`${a.name} could not be restarted after the rewrite: ${describeError(error)}`, "error");
      }
    }
    for (const a of offline) {
      const p = this.participants.get(a.id);
      if (!p) continue;
      p.sessionId = undefined;
      p.statusDetail = "the conversation was rewritten while it was offline; reconnect replays the new history";
      this.restoredSeen.set(a.id, Math.max(0, message.seq - 1));
      this.push({ type: "participant", participant: p });
    }
    this.postSystem(rewriteNotice(this.humanName, removed.filter((m) => m.kind === "chat").length, restarted));
    this.log.info(`edit (rewrite) of #${message.seq}: ${removed.length} records removed; restarted ${restarted.join(", ") || "nobody"}`);
    this.startNext();
    this.route(message);
    return { restarted, removed: removed.length };
  }

  async respawnAgent(id: string, options: { memory?: boolean; replay?: number; reason?: string } = {}): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const online = this.runtimes.has(id);
    const memory = !!options.memory;
    const replay = memory ? Math.max(0, options.replay ?? this.settings.replayAfterRestart) : 0;
    const withNotes = memory && !!participant.notes;
    const why = options.reason ?? "its context was cleared";
    this.dropScheduledTurn(id);
    this.cancelPermissionsOf(id);
    if (this.speaking === id) this.speaking = null;
    if (online) await this.retireRuntime(id);
    participant.sessionId = undefined;
    this.restoredSeen.set(id, this.seq);
    this.push({ type: "participant", participant });
    if (!online) this.log.info(`respawn of ${participant.name} (offline): stored session dropped, starting it now`);
    await this.reconnect(id, memory
      ? { mode: "replay", replay, memory: withNotes, reason: `${why}; it comes back with ${withNotes ? "its notes and " : ""}the last ${replay} messages` }
      : { mode: "replay", replay: 0, reason: `${why}, it remembers nothing from before` });
    this.log.info(`respawn of ${participant.name}: fresh session, ${memory ? `${withNotes ? "notes + " : ""}replay ${replay}` : "no replay"}`);
    return participant;
  }

  async restartWithPersona(id: string, patch: PersonaPatch): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const runtime = this.runtimes.get(id);
    const online = !!runtime && runtime.agent.alive;
    if (online && runtime.turnActive) throw new Error(`${participant.name} is in the middle of a reply; try again when it is idle`);
    if (online) {
      try {
        await this.takeNotes(id);
      } catch (error) {
        this.log.warn(`${participant.name}: notes before the restart failed (${describeError(error)}); it restarts with the notes it had`);
      }
    }
    this.updatePersona(id, patch);
    return this.respawnAgent(id, { memory: true, reason: "its role changed" });
  }

  updateNotes(id: string, notes: string): Participant {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const text = notes.trim().slice(0, 4000);
    participant.notes = text || undefined;
    participant.notesAt = text ? this.runtimes.get(id)?.lastUsed ?? participant.notesAt : undefined;
    participant.notesSeq = text ? this.seq : undefined;
    this.push({ type: "participant", participant });
    return participant;
  }

  async takeNotes(id: string): Promise<Participant> {
    this.assertRecordOpen();
    const participant = this.participants.get(id);
    const runtime = this.runtimes.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    if (!runtime || !runtime.agent.alive) throw new Error(`${participant.name} is not online`);
    if (runtime.turnActive || runtime.workBusy) throw new Error(`${participant.name} is in the middle of a reply; try again when it is idle`);
    const header = buildHeader(this.effectiveSettings(), this.personaOf(participant), this.roster(), this.hops, ["hidden turn: notes only, nothing is posted"]);
    runtime.workBusy = true;
    runtime.workCancelled = false;
    runtime.notesPending = false;
    if (runtime.delayTimer) clearTimeout(runtime.delayTimer);
    runtime.delayTimer = null;
    const queued = this.floorQueue.indexOf(id);
    if (queued >= 0) this.floorQueue.splice(queued, 1);
    try {
      runtime.log.info("notes: hidden turn");
      participant.notesTurn = true;
      this.push({ type: "participant", participant });
      await this.executeTurn(participant, runtime, [{ type: "text", text: `${header}\n\n${NOTES_ONLY_PROMPT}` }], null, true);
    } finally {
      participant.notesTurn = undefined;
      try {
        this.push({ type: "participant", participant });
      } finally {
        await this.finishRuntimeWork(id, runtime);
      }
    }
    return participant;
  }

  private keepNotes(participant: Participant, runtime: AgentRuntime, notes: string | null, via: "reply" | "hidden turn"): boolean {
    if (!notes) return false;
    participant.notes = notes.slice(0, 4000);
    participant.notesAt = runtime.lastUsed;
    participant.notesSeq = this.seq;
    runtime.notesDue = false;
    runtime.notesMisses = 0;
    runtime.notesPending = false;
    this.push({ type: "participant", participant });
    runtime.log.info(`notes: ${notes.split("\n").length} lines kept (${via}, context ${runtime.lastUsed})`);
    return true;
  }

  private contextFull(participant: Participant, runtime: AgentRuntime, detail: string): void {
    participant.contextEvent = { kind: "full", at: Date.now(), used: runtime.lastUsed, size: participant.contextSize };
    const recently = participant.autoRespawnAt !== undefined && Date.now() - participant.autoRespawnAt < 10 * 60_000;
    if (recently) {
      participant.status = "error";
      participant.statusDetail = "its context filled up again right after a respawn; it needs you (respawn it by hand, with fewer replayed messages)";
      this.push({ type: "participant", participant });
      this.postRoomEvent(`${participant.name} ran out of context again (${detail.slice(0, 120)}); it was respawned once already and now needs you.`, "human", false, { tone: "error" });
      runtime.log.warn(`context full again within 10 minutes: no automatic respawn`);
      return;
    }
    participant.autoRespawnAt = Date.now();
    this.push({ type: "participant", participant });
    const memory = !!participant.notes;
    this.postRoomEvent(`${participant.name} ran out of context (${detail.slice(0, 120)}); it is respawned ${memory ? `with its notes and the last ${this.settings.replayAfterRestart} messages` : `with the last ${this.settings.replayAfterRestart} messages (it had no notes)`}.`, "human", false, { tone: "error" });
    runtime.log.warn(`context full: ${detail}; respawn with ${memory ? "notes" : "no notes"}`);
    setImmediate(() => {
      void (memory ? this.respawnAgent(participant.id, { memory: true }) : this.reconnectAfterFull(participant.id)).catch((error) => this.notice(`${participant.name}: respawn after a full context failed: ${describeError(error)}`, "error"));
    });
  }

  private async reconnectAfterFull(id: string): Promise<void> {
    const participant = this.participants.get(id);
    if (!participant) return;
    this.dropScheduledTurn(id);
    this.cancelPermissionsOf(id);
    if (this.runtimes.has(id)) await this.retireRuntime(id);
    participant.sessionId = undefined;
    await this.reconnect(id, { mode: "replay", reason: "its context was full; it comes back with the last messages" });
  }

  private watchTheStop(id: string): void {
    const turnAtStop = this.runtimes.get(id)?.turn?.message.id;
    const timer = setTimeout(() => {
      const runtime = this.runtimes.get(id);
      const participant = this.participants.get(id);
      if (!runtime || !participant || !runtime.turnActive || runtime.turn?.message.id !== turnAtStop) return;
      this.postRoomEvent(`${participant.name} did not answer the stop; it is being started again with the same session.`, "human", false, { tone: "attention" });
      void (async () => {
        try {
          await this.retireRuntime(id);
          await this.reconnect(id, { mode: "load" });
        } catch (error) {
          this.notice(`${participant.name} could not be started again: ${describeError(error)}`, "error");
        }
      })();
    }, STOP_GRACE_MS);
    timer.unref?.();
  }

  private async retireRuntime(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) return;
    runtime.retiring = true;
    if (runtime.quiet) this.push({ type: "participant", participant });
    if (runtime.turnActive) runtime.agent.cancel(runtime.sessionId);
    try {
      await Promise.race([runtime.agent.closeSession(runtime.sessionId), delay(1500)]);
    } catch {
    }
    runtime.agent.kill();
    this.forgetRuntime(id);
    participant.status = "offline";
    participant.statusDetail = undefined;
  }

  focus(from?: string): void {
    let stopped = 0;
    for (const [id, runtime] of this.runtimes) {
      this.dropScheduledTurn(id);
      if (runtime.turnActive) {
        runtime.agent.cancel(runtime.sessionId);
        this.cancelPermissionsOf(id);
        stopped++;
      }
    }
    this.focused = true;
    this.push(this.roomEvent());
    this.postRoomEvent(`Hush${from ? ` from ${from}` : ""}: ${stopped ? `${stopped} repl${stopped > 1 ? "ies" : "y"} stopped; ` : ""}everyone waits until ${this.humanName} writes again.`, undefined, false, { tone: "hush" });
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 60) throw new Error("room name must be 1-60 characters");
    if (trimmed === this.name) return;
    this.name = trimmed;
    this.settings = { ...this.settings, name: trimmed };
    for (const runtime of this.runtimes.values()) runtime.briefPending = "room rules: name";
    this.push(this.roomEvent());
  }

  updateSettings(patch: Record<string, unknown>): RoomSettings {
    const next: RoomSettings = { ...this.settings };
    const changed: string[] = [];
    let unknownRefs: string[] = [];
    for (const key of Object.keys(ROOM_SETTINGS_SPEC) as (keyof RoomSettings)[]) {
      if (patch[key] === undefined || ROOM_SETTINGS_SPEC[key].kind === "own-path") continue;
      let value: RoomSettings[typeof key] = coerceSetting(key, patch[key]);
      if (key === "customRules") {
        const resolved = this.resolveRuleReferences(this.guardBriefText("The room rules text", value as string, "refuse", next.briefTextLimit));
        unknownRefs = resolved.unknown;
        value = resolved.stored;
      }
      if (JSON.stringify(value) !== JSON.stringify(next[key])) {
        (next as unknown as Record<string, unknown>)[key] = value;
        changed.push(key);
      }
    }
    this.settings = next;
    if (changed.includes("transcripts")) this.updateTranscriptModes();
    this.push(this.roomEvent());
    const briefChanges = changed.filter((c) => BRIEF_AFFECTING_SETTINGS.includes(c as keyof RoomSettings));
    if (briefChanges.length) {
      for (const runtime of this.runtimes.values()) runtime.briefPending = `room rules: ${briefChanges.join(", ")}`;
      this.postSystem(`Room settings updated (${briefChanges.join(", ")}); agents get refreshed instructions on their next turn.`);
    }
    const missing = unknownRefs.filter((n) => n !== "Name");
    if (missing.length) {
      this.notice(`Room rules mention ${missing.map((n) => `@${n}`).join(", ")}, who ${missing.length > 1 ? "are" : "is"} not in the room; left as plain text.`, "warn");
    }
    return this.settings;
  }

  private guardBriefText(what: string, text: string, check: BriefTextCheck = "refuse", limit = this.settings.briefTextLimit): string {
    if (check === "keep" || text.length <= limit) return text;
    if (check === "refuse") throw new Error(`${what} is ${text.length} characters; this room's limit is ${limit} (the briefTextLimit setting). Shorten it, move the instructions into a skill, or raise the limit.`);
    this.postSystem(`${what} is ${text.length} characters, over this room's limit of ${limit}; kept as it is, but the next edit has to fit (shorten it or raise briefTextLimit).`, "human", false, { tone: "attention" });
    return text;
  }

  updatePersona(id: string, patch: PersonaPatch): Participant {
    const participant = this.participants.get(id);
    const runtime = this.runtimes.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const changed: string[] = [];
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!NAME_PATTERN.test(name)) throw new Error("name must be 1-24 letters, digits, _ or - (no spaces)");
      const taken = this.findByName(name);
      if (taken && taken.id !== id) throw new Error(`name "${name}" is already taken`);
      if (name !== participant.name) {
        this.postRoomEvent(`${participant.name} is now called ${name}.`);
        participant.name = name;
        changed.push("name");
        if (this.settings.customRules.includes(`@{p:${id}}`)) {
          for (const other of this.runtimes.values()) other.briefPending = other.briefPending ?? "room rules: a referenced participant was renamed";
        }
      }
    }
    if (patch.tagline !== undefined && patch.tagline.trim() !== (participant.tagline ?? "")) {
      participant.tagline = patch.tagline.trim().slice(0, 80);
      changed.push("tagline");
    }
    if (patch.role !== undefined && patch.role.trim() !== (participant.role ?? "")) {
      participant.role = this.guardBriefText(`${participant.name}'s vibio`, patch.role.trim());
      changed.push("role");
    }
    if (patch.avatar !== undefined) {
      participant.avatar = patch.avatar.trim().slice(0, 8) || undefined;
    }
    if (patch.replyDelay !== undefined) {
      if (patch.replyDelay === null) participant.replyDelay = undefined;
      else {
        const value = Number(patch.replyDelay);
        if (!Number.isFinite(value) || value < 0 || value > 120) throw new Error("replyDelay must be between 0 and 120 seconds");
        participant.replyDelay = value;
      }
    }
    if (patch.skills !== undefined) {
      const next = normalizeSkillList(patch.skills) ?? [];
      const current = participant.skills ?? [];
      if (next.join("\n") !== current.join("\n")) {
        participant.skills = next;
        changed.push("skills");
      }
    }
    if (changed.length && runtime) runtime.briefPending = `your persona: ${changed.join(", ")}`;
    this.push({ type: "participant", participant });
    return participant;
  }

  retryTurn(id: string): Participant {
    const participant = this.participants.get(id);
    const runtime = this.runtimes.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such vibemate");
    if (!runtime || !runtime.agent.alive) throw new Error(`${participant.name} is not running: respawn it instead`);
    if (runtime.turnActive) throw new Error(`${participant.name} is answering right now`);
    if (participant.trouble?.stage === "turn") runtime.lastSeenSeq = Math.min(runtime.lastSeenSeq, runtime.turnStartSeq);
    this.clearTrouble(participant, undefined);
    this.log.info(`retry of ${participant.name}'s last turn, asked by the human`);
    this.requestTurn(id, true);
    return participant;
  }

  retryAfterLogin(recipeId: string): void {
    for (const participant of this.participants.values()) {
      if (participant.kind !== "agent" || participant.muted || participant.agentType !== recipeId || participant.trouble?.kind !== "login") continue;
      const runtime = this.runtimes.get(participant.id);
      if (runtime?.agent.alive) {
        this.notice(`${participant.name}: ${getRecipe(recipeId)?.vendor ?? recipeId} is logged in again; sending it the messages it missed.`, "info");
        try { this.retryTurn(participant.id); } catch (error) { this.log.warn(`retry after login: ${describeError(error)}`); }
      } else {
        const restore = !!participant.sessionId && participant.supportsLoad !== false;
        this.notice(`${participant.name}: ${getRecipe(recipeId)?.vendor ?? recipeId} is logged in again; ${restore ? "bringing it back with its session" : "starting it afresh with its notes"}.`, "info");
        void (restore ? this.reconnect(participant.id, { mode: "load" }) : this.respawnAgent(participant.id, { memory: true, reason: "logged in again" })).catch((error) => this.notice(`${participant.name}: the start after the login failed: ${describeError(error)}`, "error"));
      }
    }
  }

  private clearTrouble(participant: Participant, why: string | undefined): void {
    if (participant.status === "error") participant.status = "idle";
    participant.trouble = undefined;
    participant.statusDetail = undefined;
    this.push({ type: "participant", participant });
    if (why) this.notice(`${participant.name} is back in the conversation (${why}).`, "info");
  }

  setMuted(id: string, muted: boolean, from?: string): Participant {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    if (!!participant.muted === muted) return participant;
    participant.muted = muted;
    if (!muted && participant.startupSkipped === "muted") {
      participant.startupSkipped = undefined;
      participant.statusDetail = "not summoned yet; reconnect when ready";
    }
    const runtime = this.runtimes.get(id);
    if (muted && runtime) {
      this.dropScheduledTurn(id);
      if (runtime.turnActive) {
        runtime.agent.cancel(runtime.sessionId);
        this.cancelPermissionsOf(id);
      }
    }
    this.push({ type: "participant", participant });
    const where = from ? ` (${from})` : "";
    this.postRoomEvent(muted ? `${participant.name} is muted and receives no prompts${where}.` : `${participant.name} is unmuted${where}.`);
    return participant;
  }


  async discoverOptions(recipeId: string, refresh = false): Promise<DiscoveredOptions> {
    const recipe = getRecipe(recipeId);
    if (!recipe) throw new Error(`unknown agent type: ${recipeId}`);
    if (recipe.unavailableReason) throw new Error(`${recipe.label}: ${recipe.unavailableReason}`);
    const cached = this.optionCache.get(recipeId);
    if (cached && !refresh) return cached;

    const cwd = ensureDir(join(this.dataDir, ".probe"));
    const log = this.log.child(`probe:${recipeId}`);
    const launch = recipe.build({ model: null, mode: null });
    const agent = new AcpAgent(
      { ...launch, cwd },
      {
        onSessionUpdate: () => undefined,
        onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }),
        onStderr: (line) => log.info(`stderr: ${line}`),
        onExit: () => undefined,
      },
    );
    const started = Date.now();
    try {
      const info = await Promise.race([
        (async (): Promise<DiscoveredOptions> => {
          const init = await agent.initialize({ name: "viberoom", version: "0.2.0" });
          const session = await this.openSession(agent, cwd, log, [], recipe);
          const result: DiscoveredOptions = {
            recipeId,
            agentInfo: { name: init.agentInfo?.name ?? null, version: init.agentInfo?.version ?? null },
            authMethods: agent.authMethods.map((m) => m.id),
            modes: session.modes ?? null,
            configOptions: session.configOptions ?? [],
            modelAtLaunch: !!recipe.modelAtLaunch,
            modeAtLaunch: !!recipe.modeAtLaunch,
            discoveredAt: Date.now(),
            durationMs: 0,
          };
          try {
            await Promise.race([agent.closeSession(session.sessionId), delay(1500)]);
          } catch {
          }
          return result;
        })(),
        delay(30_000).then(() => {
          throw new Error("agent did not answer initialize/session/new within 30 s");
        }),
      ]);
      info.durationMs = Date.now() - started;
      this.optionCache.set(recipeId, info);
      log.info(`options discovered in ${info.durationMs} ms: ${info.configOptions.map((o) => o.id).join(", ") || "none"}`);
      return info;
    } finally {
      agent.kill();
    }
  }

  async inviteAgent(options: InviteOptions): Promise<Participant> {
    const recipe = getRecipe(options.agentType);
    if (!recipe) throw new Error(`unknown agent type: ${options.agentType}`);
    if (recipe.unavailableReason) throw new Error(`${recipe.label}: ${recipe.unavailableReason}`);
    const name = options.name.trim();
    if (!NAME_PATTERN.test(name)) throw new Error("name must be 1-24 letters, digits, _ or - (no spaces)");
    const taken = this.findByName(name);
    if (taken && !(options.id && taken.id === options.id && taken.status === "unstaffed")) throw new Error(`name "${name}" is already taken`);

    const id = options.id ?? `${recipe.id}-${name.toLowerCase()}`;
    const launch: LaunchPrefs = {
      model: options.model ?? recipe.defaultModel,
      effort: options.effort ?? recipe.defaultEffort,
      mode: options.mode ?? (this.bypassPermissionsByDefault ? recipe.bypassMode ?? recipe.defaultMode : recipe.defaultMode),
    };
    const participant: Participant = {
      id,
      name,
      kind: "agent",
      agentType: recipe.id,
      agentLabel: recipe.label,
      agentVendor: recipe.vendor,
      status: "starting",
      turns: 0,
      ...this.nextColour(options.color),
      tagline: (options.tagline ?? "").trim().slice(0, 80),
      role: this.guardBriefText(`${name}'s vibio`, (options.role ?? "").trim(), options.textCheck),
      avatar: (options.avatar ?? "").trim().slice(0, 8) || undefined,
      replyDelay: options.replyDelay === undefined || options.replyDelay === null ? undefined : Math.max(0, Math.min(120, Number(options.replyDelay) || 0)),
      skills: normalizeSkillList(options.skills ?? undefined),
      launch,
      violations: 0,
      briefsSent: 0,
      failedTurns: 0,
    };
    this.participants.set(id, participant);
    this.push({ type: "participant", participant });
    await this.startAgent(participant, launch, true);
    return participant;
  }

  addUnstaffed(input: { name: string; tagline?: string; role?: string; avatar?: string; skills?: string[]; color?: string; id?: string; textCheck?: BriefTextCheck; quiet?: boolean; restoring?: boolean }): Participant {
    const name = input.name.trim();
    if (!NAME_PATTERN.test(name)) throw new Error("name must be 1-24 letters, digits, _ or - (no spaces)");
    if (!input.restoring && this.findByName(name)) throw new Error(`name "${name}" is already taken`);
    const id = input.id ?? `vm-${name.toLowerCase()}`;
    const participant: Participant = {
      id,
      name,
      kind: "agent",
      status: "unstaffed",
      statusDetail: "awaiting a coding agent",
      turns: 0,
      ...this.nextColour(input.color),
      tagline: (input.tagline ?? "").trim().slice(0, 80),
      role: this.guardBriefText(`${name}'s vibio`, (input.role ?? "").trim(), input.textCheck),
      avatar: (input.avatar ?? "").trim().slice(0, 8) || undefined,
      skills: normalizeSkillList(input.skills),
      violations: 0,
      briefsSent: 0,
      failedTurns: 0,
    };
    this.participants.set(id, participant);
    if (!input.quiet) this.push({ type: "participant", participant });
    return participant;
  }

  async staff(
    id: string,
    choice: { agentType: string; model?: string | null; effort?: string | null; mode?: string | null; name?: string | null; tagline?: string | null; role?: string | null; avatar?: string | null; skills?: string[] },
  ): Promise<Participant> {
    const placeholder = this.participants.get(id);
    if (!placeholder || placeholder.kind !== "agent" || placeholder.status !== "unstaffed") throw new Error("this vibemate is not awaiting a coding agent");
    return this.inviteAgent({
      id,
      agentType: choice.agentType,
      name: choice.name?.trim() || placeholder.name,
      tagline: choice.tagline ?? placeholder.tagline,
      role: choice.role ?? placeholder.role,
      avatar: choice.avatar ?? placeholder.avatar,
      skills: choice.skills ?? placeholder.skills,
      color: placeholder.color,
      model: choice.model,
      effort: choice.effort,
      mode: choice.mode,
    });
  }

  async restaff(id: string, choice: { agentType: string; model?: string | null; effort?: string | null; mode?: string | null; replay?: number }): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    if (participant.status === "unstaffed") return this.staff(id, choice);
    const recipe = getRecipe(choice.agentType);
    if (!recipe) throw new Error(`unknown agent type: ${choice.agentType}`);
    if (recipe.unavailableReason) throw new Error(`${recipe.label}: ${recipe.unavailableReason}`);
    if (recipe.id === participant.agentType) return participant;
    const runtime = this.runtimes.get(id);
    const online = !!runtime && runtime.agent.alive;
    if (online && runtime.turnActive) throw new Error(`${participant.name} is in the middle of a reply; try again when it is idle`);
    if (online) {
      try {
        await this.takeNotes(id);
      } catch (error) {
        this.log.warn(`${participant.name}: notes before the change of agent failed (${describeError(error)}); it restarts with the notes it had`);
      }
      await this.retireRuntime(id);
    }
    const from = participant.agentVendor ?? participant.agentType;
    participant.agentType = recipe.id;
    participant.agentLabel = recipe.label;
    participant.agentVendor = recipe.vendor;
    participant.agentInfo = undefined;
    participant.configOptions = undefined;
    participant.modes = undefined;
    participant.model = undefined;
    participant.effort = undefined;
    participant.mode = undefined;
    participant.supportsLoad = undefined;
    participant.contextUsed = undefined;
    participant.contextSize = undefined;
    participant.cost = undefined;
    participant.launch = {
      model: choice.model ?? recipe.defaultModel,
      effort: choice.effort ?? recipe.defaultEffort,
      mode: choice.mode ?? (this.bypassPermissionsByDefault ? recipe.bypassMode ?? recipe.defaultMode : recipe.defaultMode),
    };
    this.log.info(`${participant.name}: coding agent ${from} -> ${recipe.vendor}`);
    return this.respawnAgent(id, { memory: true, replay: choice.replay, reason: `it now runs on ${recipe.vendor}` });
  }

  async reconnect(id: string, options: ReconnectOptions = { mode: "replay" }): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    if (this.runtimes.has(id) || participant.status === "starting") return participant;
    participant.status = "starting";
    participant.startupSkipped = undefined;
    participant.statusDetail = undefined;
    this.push({ type: "participant", participant });
    const launch = participant.launch ?? { model: participant.model ?? null, effort: participant.effort ?? null, mode: participant.mode ?? null };
    await this.startAgent(participant, launch, false, options);
    return participant;
  }

  private updateTranscriptModes(): void {
    const mode = this.settings.transcripts === "inherit" ? this.programTranscripts : this.settings.transcripts;
    for (const runtime of this.runtimes.values()) runtime.transcript?.setMode(mode);
  }

  private async startAgent(participant: Participant, launch: LaunchPrefs, fresh: boolean, reconnectOptions?: ReconnectOptions): Promise<void> {
    const recipe = getRecipe(participant.agentType ?? "");
    if (!recipe) throw new Error(`unknown agent type: ${participant.agentType}`);
    const id = participant.id;
    const name = participant.name;
    const log = this.log.child(name);
    const cwd = ensureDir(this.dir);
    const spec = recipe.build({ model: launch.model, mode: launch.mode });
    const mode = this.settings.transcripts === "inherit" ? this.programTranscripts : this.settings.transcripts;
    const transcript = new Transcript(join(this.dataDir, "transcripts"), name, mode,
      this.history.path === ":memory:" ? undefined : dirname(this.history.path));
    log.info(`spawning ${spec.command} ${spec.args.join(" ")} (cwd ${cwd}); protocol: ${mode}${mode === "off" ? "" : ` (${transcript.path})`}`);

    const stderrTail: string[] = [];

    let agent: AcpAgent;
    try {
      agent = new AcpAgent(
        { ...spec, cwd },
        {
          onSessionUpdate: (_sessionId, update) => this.onSessionUpdate(id, update),
          onPermissionRequest: (params) => this.onPermissionRequest(id, params),
          onStderr: (line) => routeAdapterStderr(line, {
            note: (text) => transcript.note(text),
            say: (text) => log.info(text),
            keep: (text) => {
              stderrTail.push(text);
              if (stderrTail.length > 10) stderrTail.shift();
            },
          }),
          onExit: (code, signal) => this.onAgentExit(id, code, signal, agent),
          onRaw: (direction, message) => transcript.record(direction, message),
          onProtocolError: (text) => log.warn(`protocol: ${text}`),
        },
      );
    } catch (error) {
      throw this.failStart(participant, error, fresh, stderrTail);
    }

    try {
      const init = await agent.initialize({ name: "viberoom", version: "0.2.0" });
      participant.agentInfo = { name: init.agentInfo?.name, version: init.agentInfo?.version };
      if (agent.authMethods.length) {
        log.info(`auth methods advertised: ${agent.authMethods.map((m) => m.id).join(", ")}`);
      }
      participant.supportsLoad = agent.supportsLoadSession;

      const mcp = this.skillMcpServers(id);
      const mcpToken = mcp ? mcp.token : null;
      const mcpServers = mcp ? [mcp.server] : [];

      let session: NewSessionResult | null = null;
      let origin: NonNullable<Participant["sessionOrigin"]> = fresh ? "new" : "replayed";
      if (!fresh && reconnectOptions?.mode === "load") {
        if (!participant.sessionId) this.notice(`${name}: no stored session to load; starting a new one with replayed history.`, "warn");
        else if (!agent.supportsLoadSession) this.notice(`${name}: this agent does not support session/load; starting a new session with replayed history.`, "warn");
        else {
          try {
            log.info(`session/load ${participant.sessionId}`);
            session = await agent.loadSession(participant.sessionId, cwd, mcpServers);
            origin = "loaded";
          } catch (error) {
            this.notice(`${name}: session/load failed (${describeError(error)}); starting a new session with replayed history.`, "warn");
          }
        }
      }
      if (!session) session = await this.openSession(agent, cwd, log, mcpServers, recipe);
      participant.sessionId = session.sessionId;
      participant.sessionOrigin = origin;
      if (origin !== "loaded" || !participant.deliveryEpoch) {
        participant.deliveryEpoch = randomUUID();
        participant.suppliedThrough = undefined;
      }
      const storedSeen = this.restoredSeen.get(id);
      const runtime: AgentRuntime = {
        agent,
        sessionId: session.sessionId,
        transcript,
        log,
        firstTurnDone: false,
        lastSeenSeq: this.seq,
        turnStartSeq: this.seq,
        turnActive: false,
        pendingTurn: false,
        turn: null,
        strayMessageId: null,
        turnsSinceBrief: 0,
        usedAtBrief: 0,
        briefSentThisTurn: false,
        lastUsed: 0,
        briefPending: null,
        headerNotes: [],
        historyNoticePending: !fresh,
        briefRequestedAtSeq: -1,
        notesDue: false,
        notesMisses: 0,
        notesAskedThisTurn: false,
        lastBriefSeq: -1,
        notesForBrief: reconnectOptions?.memory && participant.notes ? participant.notes : null,
        replayOwnUntilSeq: fresh || origin === "loaded" ? -1 : this.seq,
        delayTimer: null,
        addressed: false,
        retiring: false,
        mcpToken,
        sessionStartedAt: Date.now(),
        skillChannel: mcp ? "pending" : "marker",
        skillReadyWaiters: [],
        pendingSkills: [],
        skillPulledAtSeq: -1,
        skillPulledName: "",
      };
      participant.skillChannel = runtime.skillChannel;
      this.runtimes.set(id, runtime);
      if (mcpToken && this.earlySkillReady.delete(mcpToken)) this.skillToolReady(id, mcpToken);
      this.restoredSeen.delete(id);
      participant.configOptions = session.configOptions ?? undefined;
      if (session.modes) {
        participant.mode = session.modes.currentModeId;
        participant.modes = session.modes.availableModes;
      }
      this.applyConfigSummary(participant);

      const warnings = await this.applyConfig(runtime, participant, {
        model: recipe.modelAtLaunch ? null : launch.model,
        effort: launch.effort,
        mode: recipe.modeAtLaunch ? null : launch.mode,
      });
      if (recipe.modelAtLaunch && launch.model) participant.model = launch.model;
      if (recipe.modeAtLaunch) {
        if (!participant.modes?.length) participant.modes = recipe.modePresets.map((id) => ({ id, name: id }));
        participant.mode = launch.mode ?? recipe.defaultMode ?? participant.mode;
      }
      for (const w of warnings) this.notice(`${name}: ${w}`, "warn");

      participant.status = "idle";
      participant.statusDetail = undefined;
      participant.trouble = undefined;
      this.push({ type: "participant", participant });
      if (fresh) {
        const detail = this.settings.showVendorInRoster ? `${recipe.label}${participant.model ? `, model ${participant.model}` : ""}` : "agent";
        this.postRoomEvent(`${name} joined the room (${detail}${participant.tagline ? `; "${participant.tagline}"` : ""}).`);
        runtime.lastSeenSeq = this.seq;
        participant.sawFromSeq = this.seq + 1;
      } else if (origin === "loaded") {
        runtime.lastSeenSeq = storedSeen ?? Math.max(0, this.seq - this.settings.replayAfterRestart);
        runtime.firstTurnDone = true;
        runtime.briefPending = "reconnected: your stored session was restored";
        this.postRoomEvent(`${name} is back in the room (session restored).`);
        if (participant.sawFromSeq === undefined) participant.sawFromSeq = runtime.lastSeenSeq + 1;
      } else {
        this.postRoomEvent(reconnectOptions?.reason ? `${name} restarted: ${reconnectOptions.reason}.` : `${name} is back in the room.`);
        const replay = Math.max(0, reconnectOptions?.replay ?? this.settings.replayAfterRestart);
        const chats = this.messages.filter((m) => m.kind === "chat");
        const firstReplayed = replay > 0 && chats.length ? chats[Math.max(0, chats.length - replay)] : undefined;
        runtime.lastSeenSeq = firstReplayed ? Math.max(0, firstReplayed.seq - 1) : this.seq;
        participant.sawFromSeq = runtime.lastSeenSeq + 1;
      }

      const run = this.hubRun();
      if (run) {
        const note = fresh ? null : hubChangeNote(participant, run);
        if (note) runtime.headerNotes.push(note);
        participant.runSeen = run.id;
        participant.buildSeen = run.build;
      }
      this.restoredSeen.delete(id);
      this.push({ type: "participant", participant });
      runtime.turnStartSeq = runtime.lastSeenSeq;
      log.info(`ready: session ${session.sessionId}`);
    } catch (error) {
      agent.kill();
      this.forgetRuntime(id);
      throw this.failStart(participant, error, fresh, stderrTail);
    }
  }

  async removeParticipant(id: string): Promise<void> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const runtime = this.runtimes.get(id);
    if (runtime) {
      this.dropScheduledTurn(id);
      if (runtime.turnActive) runtime.agent.cancel(runtime.sessionId);
      this.cancelPermissionsOf(id);
      try {
        await Promise.race([runtime.agent.closeSession(runtime.sessionId), delay(2000)]);
      } catch (error) {
        runtime.log.warn(`session/close failed: ${String(error)}`);
      }
      runtime.agent.kill();
      this.forgetRuntime(id);
      if (this.speaking === id) {
        this.speaking = null;
        this.startNext();
      }
    }
    participant.status = "left";
    this.participants.delete(id);
    this.departed.set(id, participant.name);
    this.push({ type: "participant.removed", id });
    this.postRoomEvent(`${participant.name} left the room.`);
    if (RULE_REF_TOKEN.test(this.settings.customRules)) {
      RULE_REF_TOKEN.lastIndex = 0;
      if (this.settings.customRules.includes(`@{p:${id}}`)) {
        for (const runtime of this.runtimes.values()) runtime.briefPending = "room rules: a referenced participant left";
      }
    }
  }

  cancelTurn(id: string, expectedTurnId?: string, waitingFor?: { id: string; version: number }): "turn" | "queued" | "nothing" {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) throw new Error("no such agent");
    if (expectedTurnId !== undefined && runtime.turn?.message.id !== expectedTurnId) return "nothing";
    if (waitingFor) {
      if (runtime.turn?.hidden) return "nothing";
      const message = this.messages.find(m => m.id === waitingFor.id && m.from === "human" && m.kind === "chat");
      if (!message || message.seq <= runtime.lastSeenSeq) return "nothing";
      if (message.to.length && !message.to.includes(id)) return "nothing";
      const delivery = message?.bodyDelivery, reader = delivery?.readers[id];
      if (!delivery || !reader || delivery.version !== waitingFor.version || reader.epoch !== participant.deliveryEpoch || reader.version >= delivery.version) return "nothing";
    }
    if (runtime.turnActive || runtime.workBusy) {
      runtime.workCancelled = true;
      if (runtime.turnActive) {
        runtime.agent.cancel(runtime.sessionId);
        this.watchTheStop(id);
        if (runtime.quiet) this.push({ type: "participant", participant });
      }
      this.cancelPermissionsOf(id);
      this.notice(`${participant.name}: stop requested.`, "info");
      return "turn";
    }
    if (runtime.pendingTurn || runtime.delayTimer || this.floorQueue.includes(id)) {
      this.dropScheduledTurn(id);
      this.notice(`${participant.name}: stopped before it began; the turn is dropped.`, "info");
      this.postRoomEvent(`${participant.name} was stopped by ${this.humanName} before it began.`, undefined, false, { tone: "attention" });
      return "queued";
    }
    this.notice(`${participant.name}: nothing to stop, it is not writing.`, "info");
    return "nothing";
  }

  async nudge(id: string, by?: string): Promise<"answered" | "silent"> {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) throw new Error("no such agent");
    if (!runtime.quiet || runtime.quiet.turnId !== runtime.turn?.message.id) throw new RoomRefusal("that turn is over");
    const call = unchangingCall(participant);
    if (!call) throw new RoomRefusal(`${participant.name} offers no setting to ask about, so there is nothing that can be asked without changing something`);
    const quiet = runtime.quiet;
    quiet.nudge = "asking";
    this.push({ type: "participant", participant });
    const answered = await Promise.race([
      (call.kind === "config"
        ? runtime.agent.setConfigOption(runtime.sessionId, call.id, call.value)
        : runtime.agent.setMode(runtime.sessionId, call.id)
      ).then(() => true, (error) => {
        this.log.info(`${participant.name}: nudge refused: ${describeError(error)}`);
        return true;
      }),
      delay(NUDGE_WAIT_MS).then(() => false),
    ]);
    const outcome = answered ? "answered" : "silent";
    if (runtime.quiet === quiet && runtime.quiet.turnId === runtime.turn?.message.id) {
      quiet.nudge = outcome;
      this.push({ type: "participant", participant });
    }
    this.postSystem(`${participant.name} ${answered
      ? "still answers — what is stuck is the request to the provider. Stop should work."
      : "does not answer. Stop replaces its process and keeps its session; Fresh start replaces it too and begins a new one."}${by ? ` (nudged by ${by})` : ""}`, "human", false, { agentId: id, tone: "attention" });
    return outcome;
  }

  async setConfig(id: string, configId: string, value: string | boolean, from?: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!participant) throw new Error("no such vibemate");
    if (participant.status === "starting") throw new Error(`${participant.name} is still starting. Change its settings once it is ready.`);
    if (!runtime) throw new Error(`${participant.name} is offline. Reconnect it before changing its live settings.`);
    const option = participant.configOptions?.find(o => o.id === configId)
      ?? participant.configOptions?.find(o => o.category === configId);
    if (option) configId = option.id;
    if (runtime.turnActive || runtime.workBusy) {
      runtime.pendingConfig = [...(runtime.pendingConfig ?? []).filter((p) => p.configId !== configId), { configId, value, ...(from ? { from } : {}) }];
      this.push({ type: "participant", participant });
      this.postSystem(`${participant.name}: ${this.configName(participant, configId)} → ${configShown(value)}; when this reply is finished${from ? ` (${from})` : ""}`, "human", false, { agentId: participant.id });
      return;
    }
    let owner = runtime;
    runtime.workBusy = true;
    try { owner = await this.applyConfigNow(id, configId, value, from); }
    finally { await this.finishRuntimeWork(id, owner); }
  }

  private async applyConfigNow(id: string, configId: string, value: string | boolean, from?: string): Promise<AgentRuntime> {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) throw new Error("the vibemate is no longer connected");
    const option = participant.configOptions?.find(o => o.id === configId)
      ?? participant.configOptions?.find(o => o.category === configId);
    if (option) configId = option.id;
    const stillOurs = () => {
      if (this.runtimes.get(id) !== runtime || this.participants.get(id) !== participant) throw new Error("the vibemate restarted while its setting was changing; choose the setting again");
    };
    const change = async <T>(request: () => Promise<T>): Promise<T> => {
      try { return await request(); }
      catch (error) {
        const record = runtime.transcript?.dump("setting change failed");
        const setting = JSON.stringify({ id: configId, value, model: participant.model, mode: participant.mode }).slice(0, 500);
        runtime.log.warn(`setting refused ${setting}: ${describeError(error)}${record ? `; protocol kept at ${record}` : ""}`);
        throw error;
      }
    };
    const recipe = getRecipe(participant.agentType ?? "");
    if (recipe?.modeAtLaunch && configId === "mode") {
      if (!recipe.modePresets.includes(String(value))) throw new Error(`${participant.name}: no mode "${value}" (${recipe.modePresets.join(", ")})`);
      participant.launch = { model: participant.launch?.model ?? null, effort: participant.launch?.effort ?? null, mode: String(value) };
      this.push({ type: "participant", participant });
      const pendingTurn = runtime.pendingTurn, addressed = runtime.addressed;
      await this.respawnAgent(id, { memory: true, reason: "its mode changed" });
      const replacement = this.runtimes.get(id);
      if (!replacement) throw new Error("the vibemate could not restart with its new mode");
      replacement.workBusy = true;
      replacement.pendingTurn ||= pendingTurn;
      replacement.addressed ||= addressed;
      replacement.pendingConfig = [...(runtime.pendingConfig || []), ...(replacement.pendingConfig || [])];
      runtime.pendingConfig = undefined;
      runtime.workBusy = false;
      return replacement;
    }
    if (!option && configId === "mode" && (participant.modes?.some((m) => m.id === value) || participant.mode === value)) {
      const reported = await change(() => runtime.agent.setMode(runtime.sessionId, String(value)));
      stillOurs();
      participant.mode = reported?.currentModeId ?? String(value);
    } else {
      if (!option && configId === "mode" && participant.modes?.length) throw new Error(`${participant.name}: ${configShown(value)} is not an available mode. Choose one of ${participant.modes.map(m => m.name || m.id).join(", ")}.`);
      if (!option) throw new Error(`${participant.name} no longer offers that setting. Open its settings again to see the current choices.`);
      if ((option.type === "boolean" && typeof value !== "boolean") || (option.type === "select" && typeof value !== "string")) {
        throw new Error(`${participant.name}: choose a valid value for ${option.name}.`);
      }
      if (option.category === "mode" && value !== option.currentValue && !flattenOptions(option.options).some(o => o.value === value)) {
        throw new Error(`${participant.name}: ${configShown(value)} is not available for ${option.name}. Open its settings again to see the current choices.`);
      }
      const reported = await change(() => runtime.agent.setConfigOption(runtime.sessionId, configId, value));
      stillOurs();
      participant.configOptions = reported;
      this.applyConfigSummary(participant);
    }
    participant.launch = { model: participant.model ?? null, effort: participant.effort ?? null, mode: participant.mode ?? null };
    this.push({ type: "participant", participant });
    const actual = participant.configOptions?.find(o => o.id === configId)?.currentValue ?? (configId === "mode" ? participant.mode : undefined) ?? value;
    const said = actual === value ? configShown(actual) : `${configShown(actual)} (requested ${configShown(value)})`;
    this.postSystem(`${participant.name}: ${this.configName(participant, configId)} → ${said}; from its next turn${from ? ` (${from})` : ""}`, "human", false, { agentId: participant.id });
    return runtime;
  }

  setLaunch(id: string, patch: { model?: string | null; effort?: string | null; mode?: string | null }, from?: string): Participant {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such vibemate");
    if (this.runtimes.get(id)) throw new Error(`${participant.name} is running: this is one of its settings now, not a choice for its next start`);
    const launch: LaunchPrefs = { model: participant.launch?.model ?? null, effort: participant.launch?.effort ?? null, mode: participant.launch?.mode ?? null };
    for (const field of ["model", "effort", "mode"] as const) {
      const value = patch[field];
      if (value === undefined) continue;
      launch[field] = value === null || value === "" ? null : String(value).slice(0, 80);
      participant[field] = launch[field] ?? undefined;
      this.postSystem(`${participant.name}: ${field} → ${launch[field] ?? "the agent's own"}; when it comes back${from ? ` (${from})` : ""}`, "human", false, { agentId: participant.id });
    }
    participant.launch = launch;
    this.push({ type: "participant", participant });
    return participant;
  }

  private configName(participant: Participant, configId: string): string {
    return configId === "mode" ? "mode" : participant.configOptions?.find((o) => o.id === configId)?.name || configId;
  }

  private async applyPendingConfig(id: string, expected = this.runtimes.get(id)): Promise<AgentRuntime | undefined> {
    let runtime = expected;
    const participant = this.participants.get(id);
    if (!runtime || !participant) return runtime;
    let changed = false;
    while (this.runtimes.get(id) === runtime && !runtime.retiring && runtime.pendingConfig?.length) {
      changed = true;
      const entry = runtime.pendingConfig.shift()!;
      try {
        runtime = await this.applyConfigNow(id, entry.configId, entry.value, entry.from);
      } catch (error) {
        this.postSystem(`${participant.name}: ${this.configName(participant, entry.configId)} → ${configShown(entry.value)} was refused (${describeError(error)})`, "human", false, { agentId: participant.id, tone: "error" });
      }
    }
    if (changed && this.runtimes.get(id) === runtime) { runtime.pendingConfig = undefined; this.push({ type: "participant", participant }); }
    return runtime;
  }

  permissionPending(key: string): boolean {
    return this.permissions.has(key);
  }

  resolvePermission(key: string, optionId: string | null): void {
    const entry = this.permissions.get(key);
    if (!entry) throw new Error("no such pending permission");
    this.permissions.delete(key);
    entry.resolve(optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } });
    this.push({ type: "permission.resolved", key, optionId });
  }

  postNotice(text: string): void {
    this.postSystem(text);
  }

  closeDoor(): void {
    this.closing = true;
    if (this.silenceWatch) clearInterval(this.silenceWatch);
    this.silenceWatch = null;
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    for (const runtime of this.runtimes.values()) {
      if (runtime.delayTimer) clearTimeout(runtime.delayTimer);
      runtime.delayTimer = null;
      runtime.pendingTurn = false;
    }
  }

  async shutdown(): Promise<void> {
    this.closeDoor();
    for (const [id, runtime] of this.runtimes) {
      try {
        if (runtime.turnActive) runtime.agent.cancel(runtime.sessionId);
        await Promise.race([runtime.agent.closeSession(runtime.sessionId), delay(1000)]);
      } catch {
      }
      runtime.agent.kill();
      this.forgetRuntime(id);
    }
  }


  private route(message: ChatMessage): void {
    const from = this.participants.get(message.from);
    const live = (id: string): boolean => this.runtimes.has(id) && !this.participants.get(id)?.muted;
    const agentTargets = message.to.filter(live);
    let targets: string[] = [];
    if (from?.kind === "human") {
      this.hops = 0;
      targets = message.to.length ? agentTargets : [...this.runtimes.keys()].filter(live);
      if (message.skill) {
        const skill = this.skills?.library.get(message.skill.name);
        if (!message.to.length) targets = targets.filter((id) => this.hasSkill(this.participants.get(id), message.skill!.name));
        if (!targets.length && !message.to.length) {
          const alone = [...this.runtimes.keys()].filter(live);
          if (alone.length === 1) targets = alone;
        }
        if (!targets.length) this.notice(`Nobody in this room has the skill "${message.skill.name}"; attach it to an agent first, or address one with @.`, "warn");
        if (skill) {
          for (const id of targets) {
            const runtime = this.runtimes.get(id);
            if (runtime) runtime.pendingSkills.push({ name: skill.name, text: renderSkillBody(skill.body, message.skill.args), invokedBy: from.name, extraFiles: skill.extraFiles });
          }
        }
        targets = [...targets];
      }
      if (!message.to.length && !message.skill && this.settings.turnTaking === "one-at-a-time" && targets.length > 1) targets = shuffle(targets);
    } else if (this.focused) {
      targets = [];
    } else {
      const addressed = message.to.length > 0;
      const wanted = agentTargets.length ? agentTargets : addressed ? [] : this.settings.agentsWakeEachOther ? [...this.runtimes.keys()].filter((id) => id !== message.from && live(id)) : [];
      if (wanted.length) {
        if (this.hops >= this.hopLimit) {
          const who = agentTargets.length ? message.toNames.join(", ") : "the other vibemates";
          this.postRoomEvent(`Hop limit ${this.hopLimit} reached: ${who} will not be prompted until ${this.humanName} writes again.`, undefined, false, { tone: "attention" });
        } else {
          this.hops += 1;
          targets = this.settings.turnTaking === "one-at-a-time" && !agentTargets.length && wanted.length > 1 ? shuffle(wanted) : wanted;
        }
      }
    }
    this.push(this.roomEvent());
    for (const id of targets) this.requestTurn(id, message.to.includes(id) || !!message.skill);
  }


  private hasSkill(participant: Participant | undefined, name: string): boolean {
    if (this.isBuiltinSkill(name)) return true;
    if (!participant?.skills) return false;
    const lower = name.toLowerCase();
    return participant.skills.some((s) => s.toLowerCase() === lower);
  }

  private isBuiltinSkill(name: string): boolean {
    const skill = this.skills?.library.get(name);
    return !!skill && skill.author === BUILTIN_AUTHOR && !skill.draft && !skill.problems.length;
  }

  private attachedSkills(participant: Participant): SkillMeta[] {
    if (!this.skills) return [];
    return this.skills.library.list().filter((s) => !s.problems.length && !s.draft && this.hasSkill(participant, s.name));
  }

  private skillsForPrompt(participant: Participant, runtime: AgentRuntime): SkillsForPrompt | undefined {
    if (!this.skills) return undefined;
    const items = this.attachedSkills(participant)
      .filter((s) => s.agentInvocable)
      .map((s) => ({ name: s.name, description: s.description }));
    const channel = runtime.skillChannel === "tool" ? "tool" : "marker";
    if (!items.length && channel !== "tool") return undefined;
    return { items, channel, canCreate: channel === "tool" };
  }


  private skillsForDesign(participantId: string): RoomDesignContext["skills"] {
    if (!this.skills) return undefined;
    const runtime = this.runtimes.get(participantId);
    const channel = runtime?.skillChannel === "tool" ? "tool" : "marker";
    return {
      library: this.skills.library.list().filter((s) => !s.problems.length && !s.draft && s.agentInvocable).map((s) => ({ name: s.name, description: s.description })),
      channel,
      canCreate: channel === "tool",
    };
  }

  private agentInRoom(participantId: string): Participant {
    const participant = this.participants.get(participantId);
    if (!participant || !this.runtimes.has(participantId)) throw new Error("this agent is not in the room any more");
    return participant;
  }

  assertHistoryAccessForAgent(participantId: string): void {
    this.assertRecordOpenForAgents();
    this.agentInRoom(participantId);
  }

  memoryTurn(participantId: string): string {
    this.assertHistoryAccessForAgent(participantId);
    const runtime = this.runtimes.get(participantId);
    if (!runtime?.agent.alive || !runtime.turnActive || !runtime.turn || runtime.turn.hidden || runtime.retiring || runtime.workCancelled) throw new Error("Memory maintenance is available only during an active visible room turn.");
    return runtime.turn.message.id;
  }

  describeRoomForAgent(participantId: string): Record<string, unknown> {
    const participant = this.agentInRoom(participantId);
    const shape = this.templateOf();
    const skills = this.skills ? this.skills.library.list().filter((s) => !s.problems.length && !s.draft).map((s) => ({ name: s.name, description: s.description })) : [];
    const templates = this.skills ? this.skills.templates.list().map((t) => ({ id: t.id, name: t.name, builtin: !!t.builtin })) : [];
    return {
      room: { name: this.settings.name, topic: this.settings.topic, emoji: this.settings.emoji, dir: this.dir },
      human: this.settings.humanName,
      you: participant.name,
      settings: describeSettings({ ...this.settings, customRules: this.renderRuleReferences(this.settings.customRules) }),
      rules: ruleLines(this.renderRuleReferences(this.settings.customRules)),
      vibemates: shape.vibemates.map((v) => {
        const role = v.role ?? "";
        const own = v.name === participant.name;
        return {
          name: v.name,
          tagline: v.tagline ?? "",
          ...(own ? { role } : { rolePrivate: true, roleLength: role.length }),
          avatar: v.avatar ?? "",
          skills: v.skills ?? [],
          agentType: v.agentType,
        };
      }),
      skills,
      templates,
      yourBrief: buildBrief(this.settings, this.personaOf(participant), this.roster(), undefined, this.skillsForPrompt(participant, this.runtimes.get(participant.id)!)),
      howTo: "Settings are proposed by key with the values above; rules are one per line in customRules; a vibemate is { name, tagline, role, avatar, skills }. Another vibemate's role is private: you learn only that it has one and how long it is, and you may still propose a new one, which the human reads in full on the card. Check a design with lint_room_design, then create_template (a file for the human to pick) or propose_room_changes (a card the human applies).",
    };
  }

  lintDesignForAgent(participantId: string, kind: "template" | "room", design: RoomDesign): { ok: boolean; errors: string[]; warnings: string[]; preview?: string } {
    this.agentInRoom(participantId);
    const result = lintRoomDesign(design, { ...this.designContext(kind), skills: this.skillsForDesign(participantId) });
    return { ok: !result.errors.length, errors: result.errors.map((e) => e.message), warnings: result.warnings.map((w) => w.message), preview: result.preview };
  }

  readMessageForAgent(participantId: string, seq: number, around: number): Record<string, unknown> {
    this.assertRecordOpenForAgents();
    const participant = this.agentInRoom(participantId);
    const result = this.readVisibleMessageForAgent(seq, around, participant.name);
    const window = agentReadableWindow(this.messages, seq, around)!;
    const rows = [...window.before, window.message, ...window.after];
    this.noteBodyExposure(participantId, rows.map(m => m.seq));
    this.recordBodySupply(participantId, bodyRefs(rows));
    return result;
  }

  readVisibleMessageForAgent(seq: number, around: number, reader: string): Record<string, unknown> {
    this.assertRecordOpenForAgents();
    const window = agentReadableWindow(this.messages, seq, around);
    if (!window) throw new Error(`no message #${seq} in this room (or it is one the vibemates do not see)`);
    this.log.info(`read_message: ${reader} read #${seq}${around ? ` (around ${around})` : ""}`);
    return { message: this.agentMessageView(window.message), before: window.before.map(m => this.agentMessageView(m)), after: window.after.map(m => this.agentMessageView(m)) };
  }

  private agentMessageView(m: ChatMessage) {
    const files = this.carriedFilePaths(m);
    return {
      seq: m.seq,
      from: m.fromName,
      to: m.toNames,
      at: new Date(m.ts).toISOString(),
      text: m.text,
      ...(files.length ? { files } : {}),
      ...(m.kind === "system" ? { kind: "system" } : {}),
      ...(m.edited ? { edited: true } : {}),
      ...(m.images && m.images.length ? { images: m.images.map((a, i) => ({ ref: `#${m.seq}.${a.n ?? i + 1}`, name: a.name, path: this.imagePath(a) })) } : {}),
      ...(m.quotes && m.quotes.length ? { quotes: m.quotes.map((q) => ({ n: q.n, seq: q.seq, from: q.fromName, text: q.text })) } : {}),
    };
  }

  private carriedFilePaths(m: ChatMessage): { original: string; path: string }[] {
    return (m.resourceRefs ?? []).filter(ref => isRoomResourceName(ref.file) && m.text.includes(ref.source)).map(ref => ({ original: ref.source, path: join(this.filesDir(), ref.file) }));
  }

  private backlogText(m: ChatMessage): string {
    const files = this.carriedFilePaths(m);
    return files.length ? `${m.text}\n\n[Files carried with this message; paths on this computer]\n${files.map(file => JSON.stringify(file)).join("\n")}` : m.text;
  }

  private ensureDeliveryEpoch(participant: Participant): string {
    if (!participant.deliveryEpoch) {
      participant.deliveryEpoch = randomUUID();
      this.push({ type: "participant", participant });
    }
    return participant.deliveryEpoch;
  }

  private publishBodyDelivery(rows: ChatMessage[]): void {
    const unique = [...new Map(rows.map(row => [row.id, row])).values()].filter(row => row.bodyDelivery);
    if (!unique.length) return;
    this.persistMany(unique.map(message => ({ kind: "upsert", message })));
    this.push({ type: "message.delivery", updates: unique.map(row => ({ id: row.id, delivery: row.bodyDelivery! })) });
  }

  private registerPendingBodies(participant: Participant, rows: ChatMessage[]): void {
    const epoch = this.ensureDeliveryEpoch(participant);
    this.publishBodyDelivery(rows.filter(row => registerBodyReader(row, participant.id, epoch)));
  }

  private recordBodySupply(participantId: string, refs: BodyRef[], expectedEpoch?: string): void {
    const participant = this.participants.get(participantId);
    if (!participant || !this.runtimes.has(participantId)) return;
    const epoch = this.ensureDeliveryEpoch(participant);
    if (expectedEpoch !== undefined && epoch !== expectedEpoch) return;
    const referenced = new Set(refs.map(ref => ref.id));
    this.noteBodyExposure(participantId, this.messages.filter(row => referenced.has(row.id)).map(row => row.seq));
    const initialized = this.messages.filter(row => referenced.has(row.id) && registerBodyReader(row, participantId, epoch));
    const changed = supplyBodies(this.messages, refs, participantId, epoch) as ChatMessage[];
    this.publishBodyDelivery([...initialized, ...changed]);
  }

  private noteBodyExposure(participantId: string, seqs: number[]): void {
    const participant = this.participants.get(participantId);
    if (!participant || !seqs.length) return;
    this.ensureDeliveryEpoch(participant);
    const highest = Math.max(participant.suppliedThrough ?? -1, ...seqs);
    if (highest === participant.suppliedThrough) return;
    participant.suppliedThrough = highest;
    this.push({ type: "participant", participant });
  }

  searchHistoryForAgent(participantId: string, args: AgentSearchArgs, search: () => AgentSearchResult): AgentSearchResult {
    this.assertHistoryAccessForAgent(participantId);
    const runtime = this.runtimes.get(participantId)!;
    const turn = runtime.turnActive && runtime.agent?.alive && !runtime.retiring && !runtime.workCancelled && runtime.turn && !runtime.turn.hidden ? runtime.turn : undefined;
    try {
      const result = search();
      const local = result.results.filter(hit => hit.room === this.id);
      this.noteBodyExposure(participantId, local.flatMap(hit => [hit.seq, ...(hit.context ?? []).map(row => row.seq)]));
      const complete = local.flatMap(hit => hit.context ?? []).filter(row => !row.truncated);
      this.recordBodySupply(participantId, bodyRefs(this.messages.filter(message =>
        !message.images?.length && !message.quotes?.length && complete.some(row => row.seq === message.seq && row.text === message.text))));
      if (turn) this.recordHistorySearch(turn, args, result);
      return result;
    } catch (error) {
      if (turn) this.recordHistorySearch(turn, args, undefined, describeError(error));
      throw error;
    }
  }

  private recordHistorySearch(turn: NonNullable<AgentRuntime["turn"]>, args: AgentSearchArgs, result?: AgentSearchResult, error?: string): void {
    const calls = (turn.message.toolCalls ??= []);
    const candidates = calls.filter(call => {
      if (call.historySearch || ["completed", "failed"].includes(call.status ?? "") || !isDirectRoomTool(call.name ?? call.title, "search_history")) return false;
      if (!call.rawInput || typeof call.rawInput !== "object" || Array.isArray(call.rawInput)) return false;
      try {
        const input = parseAgentSearchArgs(call.rawInput as Record<string, unknown>);
        return input.query === args.query && input.rooms === args.rooms && input.kinds === args.kinds && input.author === args.author && input.limit === args.limit;
      }
      catch { return false; }
    });
    const view = candidates.length === 1 ? candidates[0] : { toolCallId: `room-search-${randomUUID()}`, title: "Search history" } as ToolCallView;
    if (!calls.includes(view)) calls.push(view);
    view.name = "viberoom.search_history";
    view.title = result ? historySearchTitle(result) : "History search failed";
    view.kind = "search";
    view.status = result ? "completed" : "failed";
    view.rawInput = args;
    view.historySearch = historySearchReceipt(result);
    view.output = result ? toolOutputText({ toolCallId: view.toolCallId, rawOutput: view.historySearch }) : error;
    this.showDraft(turn);
    this.push({ type: "toolcall", id: turn.message.id, toolCall: view });
  }

  private checkRoomExtras(participantId: string, callerTurn: string, args: MessageCheckArgs): Pick<MessageCheckResult, "vibemates" | "vibematesOmitted" | "liveDraft"> {
    const all = this.whoIsBusy(), vibemates: typeof all = [];
    for (const entry of all) {
      if (Buffer.byteLength(JSON.stringify([...vibemates, entry], null, 2)) > 3 * 1024) break;
      vibemates.push(entry);
    }
    const extras: ReturnType<Room["checkRoomExtras"]> = { vibemates, ...(all.length > vibemates.length ? { vibematesOmitted: all.length - vibemates.length } : {}) };
    if (!args.draft) return extras;
    const writer = this.findByName(args.draft.name);
    if (!writer || writer.kind !== "agent" || writer.id === participantId || writer.status === "left") throw new Error("Choose another vibemate in this room for draft.name.");
    const runtime = this.runtimes.get(writer.id), turn = runtime?.turn;
    if (!runtime?.agent.alive || !runtime.turnActive || runtime.retiring || runtime.workCancelled || !turn || turn.hidden || !turn.published || !visibleToAgents(turn.message)) {
      extras.liveDraft = { name: writer.name, provisional: true, available: false, text: "", hint: "No visible draft is being written now. Finished replies are ordinary room messages.", ...(args.draft.cursor ? { reset: true } : {}) };
      return extras;
    }
    const text = settledVisible(turn.message.text);
    extras.liveDraft = packLiveDraft(this.messageCheckKey, callerTurn, writer.id, args.draft, {
      name: writer.name, provisional: true, available: true, turnId: turn.message.id,
      startedAt: new Date(turn.startedAt).toISOString(), updatedAt: new Date(turn.lastSignAt ?? turn.startedAt).toISOString(),
      text: looksSilent(text) ? "" : text, toolCalls: turn.message.toolCalls?.length ?? 0,
      hint: "Unfinished visible text, not a final reply. It may change or disappear. Read further with draft.cursor=nextCursor; reset means a changed draft restarted at zero. This does not mark the final reply as read or wake anyone.",
    });
    return extras;
  }

  checkMessagesForAgent(participantId: string, params: Record<string, unknown>): MessageCheckResult {
    this.assertHistoryAccessForAgent(participantId);
    const runtime = this.runtimes.get(participantId)!;
    const turn = runtime.turn;
    if (!runtime.agent.alive || !runtime.turnActive || !turn || turn.hidden || runtime.retiring || runtime.workCancelled || !Number.isSafeInteger(turn.messagesFromSeq)) {
      throw new Error("check_room is available only during an active visible room turn");
    }
    const args = parseMessageCheckArgs(params);
    try {
      const context = { turn: turn.message.id, revision: this.messageCheckRevision, baseline: turn.messagesFromSeq, latest: this.seq };
      const position = messageCheckPosition(this.messageCheckKey, context, args.after);
      const page = messageCheckPagePosition(this.messageCheckKey, context, position.seq, args.page);
      const latest = args.mode === "status" ? page.until : context.latest;
      const rows = this.messages.filter(m => !m.streaming && m.seq > position.seq && m.seq <= latest && m.from !== participantId && visibleToAgents(m))
        .sort((a, b) => a.seq - b.seq)
        .map(m => ({
          ...(args.mode === "status" ? { seq: m.seq, from: m.fromName, to: m.toNames, at: new Date(m.ts).toISOString(), kind: m.kind, text: "" } : this.agentMessageView(m)),
          addressing: messageAddressing(m, participantId),
        }));
      const result = packMessageCheck(args, { ...position, pageSeq: page.seq, pagePriority: page.priority, reset: position.reset || page.reset }, rows, {
        read: seq => messageCheckCursor(this.messageCheckKey, context, seq),
        headers: (seq, priority) => messageCheckPageCursor(this.messageCheckKey, { ...context, latest }, position.seq, seq, priority),
      }, latest, new Date().toISOString(), this.checkRoomExtras(participantId, turn.message.id, args));
      if (args.mode === "read") {
        this.noteBodyExposure(participantId, result.messages.map(m => m.seq));
        const complete = new Set(result.messages.filter(m => !m.truncated && !m.detailsOmitted).map(m => m.seq));
        this.recordBodySupply(participantId, bodyRefs(this.messages.filter(m => complete.has(m.seq))));
      }
      this.recordMessageCheck(turn, args, result);
      return result;
    } catch (error) {
      this.recordMessageCheck(turn, args, undefined, describeError(error));
      throw error;
    }
  }

  private recordMessageCheck(turn: NonNullable<AgentRuntime["turn"]>, args: MessageCheckArgs, result?: MessageCheckResult, error?: string): void {
    const calls = (turn.message.toolCalls ??= []);
    const candidates = calls.filter(call => {
      if (call.messageCheck || ["completed", "failed"].includes(call.status ?? "") || !isDirectMessageCheck(call.name ?? call.title)) return false;
      try {
        const input = parseMessageCheckArgs((call.rawInput ?? {}) as Record<string, unknown>);
        return input.mode === args.mode && input.limit === args.limit && input.after === args.after && input.page === args.page && JSON.stringify(input.draft) === JSON.stringify(args.draft);
      } catch { return false; }
    });
    const view = candidates.length === 1 ? candidates[0] : { toolCallId: `room-check-${randomUUID()}`, title: "Check messages" } as ToolCallView;
    if (!calls.includes(view)) calls.push(view);
    view.name = "viberoom.check_room";
    view.title = result ? messageCheckTitle(result) : "Message check failed";
    view.kind = "read";
    view.status = result ? "completed" : "failed";
    view.rawInput = args;
    view.messageCheck = { mode: args.mode, checkedAt: result?.checkedAt ?? new Date().toISOString(),
      ...(result ? { available: result.available, returned: result.returned, more: result.more, reset: result.reset,
        ...(result.counts ? { counts: result.counts, previewed: result.previewed, moreHeaders: result.moreHeaders } : {}) } : {}) };
    view.output = result ? toolOutputText({ toolCallId: view.toolCallId, rawOutput: { ...view.messageCheck,
      ...(result.liveDraft ? { liveDraft: { name: result.liveDraft.name, turnId: result.liveDraft.turnId, available: result.liveDraft.available, offset: result.liveDraft.offset, characters: result.liveDraft.text.length, truncated: result.liveDraft.truncated, reset: result.liveDraft.reset } } : {}),
      ...(result.mode === "status" ? { headers: result.headers, snapshotThrough: result.snapshotThrough } : {
        messages: result.messages.map(m => ({ ...messageCheckHeader(m), truncated: !!m.truncated, detailsOmitted: !!m.detailsOmitted })),
      }) } }) : error;
    this.showDraft(turn);
    this.push({ type: "toolcall", id: turn.message.id, toolCall: view });
  }

  private designContext(kind: "template" | "room"): RoomDesignContext {
    return {
      kind,
      humanName: this.settings.humanName,
      roomName: this.settings.name,
      base: kind === "room" ? { ...this.settings, customRules: this.renderRuleReferences(this.settings.customRules) } : undefined,
      briefTextLimit: this.settings.briefTextLimit,
      knownSkills: this.skills ? this.skills.library.list().map((s) => s.name) : undefined,
    };
  }

  createTemplateForAgent(participantId: string, design: RoomDesign, replace: boolean): { ok: true; message: string; id: string; path: string; warnings: string[] } {
    const participant = this.agentInRoom(participantId);
    if (!this.skills) throw new Error("templates are not available in this room");
    const result = lintRoomDesign(design, this.designContext("template"));
    if (result.errors.length) throw new Error(`not saved: ${result.errors.map((e) => e.message).join("; ")}`);
    const settings = result.settings!;
    const rest: Partial<RoomSettings> = {};
    for (const key of Object.keys(design.settings ?? {}) as (keyof RoomSettings)[]) if (AGENT_SETTINGS.includes(key)) (rest as Record<string, unknown>)[key] = settings[key];
    const draft = {
      name: String(design.name).trim(),
      description: String(design.description ?? "").trim(),
      emoji: settings.emoji || undefined,
      settings: rest,
      vibemates: (design.vibemates ?? []).map((v) => {
        const out: TemplateVibemate = { name: v.name.trim() };
        if (v.tagline?.trim()) out.tagline = v.tagline.trim();
        if (v.role?.trim()) out.role = v.role.trim();
        if (v.avatar?.trim()) out.avatar = v.avatar.trim();
        if (v.skills?.length) out.skills = v.skills.map((s) => s.trim()).filter(Boolean);
        if (typeof v.replyDelay === "number") out.replyDelay = v.replyDelay;
        return out;
      }),
    };
    const library = this.skills.templates;
    const wanted = templateId(draft.name);
    const existing = library.list().find((t) => t.id === wanted);
    let saved;
    if (existing && replace) {
      if (existing.builtin) throw new Error(`"${existing.name}" is a template viberoom ships and cannot be replaced; pick another name`);
      saved = library.overwrite(wanted, draft);
    } else saved = library.save(draft);
    this.skills.templatesChanged();
    const warnings = result.warnings.map((w) => w.message);
    this.postSystem(`${participant.name} ${existing && replace ? "updated" : "created"} the room template "${saved.name}" (${saved.vibemates.map((v) => v.name).join(", ") || "no vibemates"}); it is in the picker under New room.`);
    this.log.info(`templates: ${participant.name} ${existing && replace ? "updated" : "created"} "${saved.name}" (${saved.id})`);
    return {
      ok: true,
      message: `Template "${saved.name}" saved as ${saved.id}${existing && !replace ? ` (the name was taken, so the id got a number; pass replace: true to update your own template instead)` : ""}. The human creates a room from it under New room; nothing in this room changed.${warnings.length ? ` Warnings: ${warnings.join("; ")}` : ""}`,
      id: saved.id,
      path: join(library.dir, saved.id, "template.json"),
      warnings,
    };
  }


  proposeRoomChanges(participantId: string, why: string, changes: RoomChangeSet): { ok: true; message: string; key: string; warnings: string[] } {
    const participant = this.agentInRoom(participantId);
    const shape = this.templateOf();
    const current = shape.vibemates;
    const vibes = applyVibemateChanges(current, changes.vibemates);
    if (vibes.errors.length) throw new Error(`not proposed: ${vibes.errors.join("; ")}`);
    const touched = vibes.ops.flatMap((op) => [op.name, ...(op.fields ?? []).filter((f) => f.field === "name").map((f) => f.to)]);
    const result = lintRoomDesign({ settings: changes.settings, vibemates: vibes.next }, { ...this.designContext("room"), changedVibemates: touched });
    if (result.errors.length) throw new Error(`not proposed: ${result.errors.map((e) => e.message).join("; ")}`);
    const base = this.designContext("room").base!;
    const settingChanges = diffSettings(base, result.settings!);
    if (!settingChanges.length && !vibes.ops.length) throw new Error("not proposed: the change set leaves the room as it is");
    const touchesOwn = vibes.ops.some((op) => op.name.toLowerCase() === participant.name.toLowerCase()) || settingChanges.some((c) => c.key === "customRules");
    const proposal: RoomProposal = {
      key: randomUUID(),
      participantId,
      participantName: participant.name,
      ts: Date.now(),
      why: String(why ?? "").trim().slice(0, 600),
      settings: settingChanges,
      vibemates: vibes.ops,
      warnings: result.warnings.map((w) => w.message),
      touchesOwn,
      status: "pending",
    };
    const ids: Record<string, string> = {};
    for (const op of vibes.ops) {
      const target = op.op === "add" ? undefined : this.findByName(op.name);
      if (target) ids[op.name] = target.id;
    }
    this.proposalPlans.set(proposal.key, { settings: settingChanges, vibemates: vibes.next, ops: vibes.ops, ids });
    this.proposals.set(proposal.key, proposal);
    this.push({ type: "proposal", proposal });
    const what = [...settingChanges.map((c) => c.key), ...vibes.ops.map((o) => `${o.op} ${o.name}`)].join(", ");
    this.postRoomEvent(`${participant.name} proposes changes to the room (${what}); apply or reject them on the card.`, "human", false, { tone: "attention" });
    this.log.info(`proposal ${proposal.key} from ${participant.name}: ${what}`);
    return {
      ok: true,
      message: `Proposal sent to ${this.settings.humanName} as a card in the room (${what}). Nothing changes until they apply it; you will see a room line with the outcome.${proposal.warnings.length ? ` Warnings shown on the card: ${proposal.warnings.join("; ")}` : ""}`,
      key: proposal.key,
      warnings: proposal.warnings,
    };
  }


  proposeNewRoom(participantId: string, request: Record<string, unknown>): { ok: true; message: string; key: string } {
    const participant = this.agentInRoom(participantId);
    const plan = planNewRoom(request, {
      proposerWasCreated: participant.createdByVibemate === true,
      openCard: [...this.newRooms.values()].some((waiting) => waiting.status === "pending"),
      proposerName: participant.name,
    });
    const proposal: NewRoomProposal = { key: randomUUID(), participantId, participantName: participant.name, ts: Date.now(), plan, status: "pending" };
    this.newRooms.set(proposal.key, proposal);
    this.push({ type: "new-room", proposal });
    const cast = plan.vibemates.map((one) => one.name).join(", ");
    const price = plan.price.byModel.map((one) => `${one.sessions} on ${one.model}`).join(", ");
    this.log.info(`new room proposed by ${participant.name}: ${plan.name} (${cast}; ${plan.price.sessions} sessions — ${price})`);
    return {
      ok: true,
      key: proposal.key,
      message: `Proposed to ${this.settings.humanName} as a card: a room called ${plan.name} with ${cast}. ${plan.price.sessions} new session${plan.price.sessions === 1 ? "" : "s"} (${price}). Nothing is created until they press it, and nothing here changes either way.`,
    };
  }

  newRoomProposals(): NewRoomProposal[] {
    return [...this.newRooms.values()];
  }

  pendingNewRoom(key: string): NewRoomProposal | undefined {
    const proposal = this.newRooms.get(key);
    return proposal && proposal.status === "pending" ? proposal : undefined;
  }

  settleNewRoom(key: string, status: "created" | "refused", madeAs?: string): NewRoomProposal {
    const proposal = this.newRooms.get(key);
    if (!proposal) throw new Error("no such proposed room");
    if (proposal.status !== "pending") return proposal;
    proposal.status = status;
    if (madeAs) proposal.roomId = madeAs;
    this.push({ type: "new-room.resolved", key, status, ...(madeAs ? { roomId: madeAs } : {}) });
    this.postRoomEvent(status === "created"
      ? `${this.settings.humanName} created the room ${proposal.plan.name} that ${proposal.participantName} proposed.`
      : `${this.settings.humanName} did not create the room ${proposal.plan.name} that ${proposal.participantName} proposed.`);
    return proposal;
  }


  async describeLooksForAgent(participantId: string): Promise<Record<string, unknown>> {
    const participant = this.agentInRoom(participantId);
    if (!this.skills?.looks || !this.skills.appearance) throw new Error("looks are not available in this room");
    const described = await this.skills.looks.describe();
    return { you: participant.name, human: this.settings.humanName, appearance: this.skills.appearance.current(), ...described };
  }

  async lintLookForAgent(participantId: string, raw: unknown): Promise<{ ok: boolean; id?: string; errors: { key: string; message: string }[]; warnings: { key: string; message: string }[]; report: string[] }> {
    this.agentInRoom(participantId);
    if (!this.skills?.looks) throw new Error("looks are not available in this room");
    try {
      const checked = await this.skills.looks.check(raw);
      return { ok: checked.lint.ok, id: checked.spec.id, errors: checked.lint.errors.map((e) => ({ key: e.key, message: e.message })), warnings: checked.lint.warnings.map((w) => ({ key: w.key, message: w.message })), report: checked.lint.report };
    } catch (error) {
      return { ok: false, errors: [{ key: "spec", message: error instanceof Error ? error.message : String(error) }], warnings: [], report: [] };
    }
  }

  async createLookForAgent(participantId: string, raw: unknown, replace: boolean): Promise<{ ok: true; message: string; id: string; warnings: string[] }> {
    const participant = this.agentInRoom(participantId);
    if (!this.skills?.looks) throw new Error("looks are not available in this room");
    let saved: LookCheck;
    try {
      saved = await this.skills.looks.save(raw, { author: participant.name, replace });
    } catch (error) {
      throw new Error(`not saved: ${error instanceof Error ? error.message : String(error)}`);
    }
    const warnings = saved.lint.warnings.map((w) => w.message);
    this.postSystem(`${participant.name} saved the look "${saved.spec.label}" (Settings → Appearance).`);
    this.log.info(`${participant.name} saved look ${saved.spec.id}`);
    return {
      ok: true,
      message: `Saved the look "${saved.spec.label}" (id ${saved.spec.id}) among ${this.settings.humanName}'s own looks: it is in Settings → Appearance now, after the looks viberoom ships. Nothing is worn until ${this.settings.humanName} picks it; propose_look_changes with look "${saved.spec.id}" offers it as a card.${warnings.length ? ` Warnings: ${warnings.join("; ")}` : ""}`,
      id: saved.spec.id,
      warnings,
    };
  }

  async proposeLookChanges(participantId: string, why: string, changes: LookChangeSet): Promise<{ ok: true; message: string; key: string; warnings: string[] }> {
    const participant = this.agentInRoom(participantId);
    if (!this.skills?.appearance || !this.skills.looks) throw new Error("looks are not available in this room");
    const current = this.skills.appearance.current();
    const patch: Record<string, unknown> = {};
    const rows: SettingChange[] = [];
    if (changes.look !== undefined) {
      const lookId = String(changes.look).trim();
      const known = await this.skills.appearance.ownAdjustments(lookId);
      if (!known) throw new Error(`not proposed: no look "${lookId}" (the looks viberoom ships, or one of ${this.settings.humanName}'s own by its id)`);
      patch.look = lookId;
      if (lookId !== current.look) rows.push({ key: "look", from: current.look, to: lookId });
    }
    if (changes.adjust !== undefined) {
      if (!changes.adjust || typeof changes.adjust !== "object" || Array.isArray(changes.adjust)) throw new Error("not proposed: adjust is an object of adjustable keys and values");
      const lookId = String(changes.look ?? current.look);
      const own = await this.skills.appearance.ownAdjustments(lookId);
      if (!own) throw new Error(`not proposed: no look "${lookId}" to fine-tune`);
      const merged = { ...(current.custom?.[lookId] ?? {}), ...(changes.adjust as Record<string, unknown>) };
      patch.custom = { [lookId]: merged };
      const previewed = this.skills.appearance.preview({ custom: { [lookId]: merged } });
      for (const key of Object.keys(changes.adjust)) {
        const from = current.custom?.[lookId]?.[key as keyof typeof current.custom[string]] ?? own.values[key] ?? "";
        const to = previewed.custom[lookId]?.[key as keyof typeof previewed.custom[string]] ?? "";
        if (String(from).toLowerCase() !== String(to).toLowerCase()) rows.push({ key: `${key} (${own.label})`, from, to });
      }
    }
    for (const key of ["chatFontSize", "font", "mono"] as const) {
      if (changes[key] === undefined) continue;
      patch[key] = changes[key];
      const previewed = this.skills.appearance.preview({ [key]: changes[key] });
      if (String(previewed[key]) !== String(current[key])) rows.push({ key: key === "chatFontSize" ? "text size" : key === "font" ? "font" : "code font", from: current[key], to: previewed[key] });
    }
    this.skills.appearance.preview(patch);
    if (!rows.length) throw new Error("not proposed: the change leaves the window as it is");
    const proposal: RoomProposal = {
      key: randomUUID(),
      participantId,
      participantName: participant.name,
      ts: Date.now(),
      why: String(why ?? "").trim().slice(0, 600),
      settings: [],
      vibemates: [],
      appearance: rows,
      warnings: [],
      touchesOwn: false,
      status: "pending",
    };
    this.proposalPlans.set(proposal.key, { settings: [], vibemates: [], ops: [], ids: {}, appearance: patch });
    this.proposals.set(proposal.key, proposal);
    this.push({ type: "proposal", proposal });
    const what = rows.map((c) => c.key).join(", ");
    this.postRoomEvent(`${participant.name} proposes a change to how the window looks (${what}); apply or reject it on the card.`, "human", false, { tone: "attention" });
    this.log.info(`look proposal ${proposal.key} from ${participant.name}: ${what}`);
    return {
      ok: true,
      message: `Proposal sent to ${this.settings.humanName} as a card in the room (${what}). It changes the whole window, not this room alone; nothing changes until they apply it, and you will see a room line with the outcome.`,
      key: proposal.key,
      warnings: [],
    };
  }

  async resolveProposal(key: string, accept: boolean): Promise<RoomProposal> {
    const proposal = this.proposals.get(key);
    const plan = this.proposalPlans.get(key);
    if (!proposal || !plan) throw new Error("no such pending proposal");
    if (proposal.status !== "pending") return proposal;
    const what = [...proposal.settings.map((c) => c.key), ...proposal.vibemates.map((o) => `${o.op} ${o.name}`), ...(proposal.appearance ?? []).map((c) => c.key)].join(", ");
    if (!accept) {
      proposal.status = "rejected";
      this.proposalPlans.delete(key);
      this.push({ type: "proposal.resolved", key, status: "rejected" });
      this.postRoomEvent(`${this.settings.humanName} rejected ${proposal.participantName}'s proposal (${what}).`);
      return proposal;
    }
    const skipped: string[] = [];
    for (const op of plan.ops) {
      const known = plan.ids[op.name];
      const existing = known ? this.participants.get(known) : this.findByName(op.name);
      if (op.op !== "add" && (!existing || existing.kind !== "agent" || existing.status === "left")) {
        skipped.push(`${op.op} ${op.name} (no longer in the room)`);
        continue;
      }
      if (op.op === "remove") {
        if (existing && existing.kind === "agent") await this.removeParticipant(existing.id);
      } else if (op.op === "update") {
        if (!existing || existing.kind !== "agent") continue;
        const target = plan.vibemates.find((v) => v.name === op.name) ?? plan.vibemates.find((v) => op.fields?.some((f) => f.field === "name" && f.to === v.name));
        const patch: PersonaPatch = {};
        for (const f of op.fields ?? []) {
          if (f.field === "name") patch.name = f.to;
          else if (f.field === "tagline") patch.tagline = target?.tagline ?? f.to;
          else if (f.field === "role") patch.role = target?.role ?? f.to;
          else if (f.field === "avatar") patch.avatar = target?.avatar ?? f.to;
          else if (f.field === "skills") patch.skills = target?.skills ?? [];
          else if (f.field === "replyDelay") patch.replyDelay = target?.replyDelay ?? null;
        }
        this.updatePersona(existing.id, patch);
        const mute = (op.fields ?? []).find((f) => f.field === "muted");
        if (mute) this.setMuted(existing.id, mute.to === "true", "an applied proposal");
        const runs = (op.fields ?? []).filter((f) => f.field === "model" || f.field === "effort" || f.field === "mode");
        for (const f of runs) {
          try {
            if (this.runtimes.get(existing.id)) await this.setConfig(existing.id, f.field, f.to, "an applied proposal");
            else this.setLaunch(existing.id, { [f.field]: f.to }, "an applied proposal");
          } catch (error) {
            skipped.push(`${f.field} of ${op.name} (${describeError(error)})`);
          }
        }
      } else {
        const v = plan.vibemates.find((x) => x.name === op.name);
        if (!v || this.findByName(op.name)) skipped.push(`add ${op.name} (the name is taken now)`);
        else this.addUnstaffed({ name: v.name, tagline: v.tagline, role: v.role, avatar: v.avatar, skills: v.skills });
      }
    }
    if (plan.settings.length) {
      const patch: Record<string, unknown> = {};
      for (const c of plan.settings) patch[c.key] = c.key === "language" ? (c.to as RoomSettings["language"]) : c.to;
      this.updateSettings(patch);
    }
    if (plan.appearance) {
      try {
        if (!this.skills?.appearance) throw new Error("looks are not available in this room");
        this.skills.appearance.apply(plan.appearance);
      } catch (error) {
        skipped.push(`appearance (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    proposal.status = "applied";
    proposal.skipped = skipped;
    this.proposalPlans.delete(key);
    this.push({ type: "proposal.resolved", key, status: "applied", skipped });
    this.postRoomEvent(`${this.settings.humanName} applied ${proposal.participantName}'s proposal (${what}).${skipped.length ? ` Not applied: ${skipped.join("; ")}.` : ""}`);
    return proposal;
  }

  createSkillForAgent(participantId: string, input: AgentSkillInput): { ok: true; message: string; warnings: string[] } {
    const participant = this.participants.get(participantId);
    if (!participant || !this.runtimes.has(participantId)) throw new Error("this agent is not in the room any more");
    if (!this.skills) throw new Error("skills are not available in this room");
    const library = this.skills.library;
    const name = String(input.name ?? "").trim();
    const existing = library.get(name);
    if (input.op === "create" && existing) {
      throw new Error(`a skill named "${existing.name}" already exists (author ${existing.author}); use update_skill for an agent-made skill, or pick another name`);
    }
    if (input.op === "update") {
      if (!existing) throw new Error(`no skill named "${name}" to update; use create_skill`);
      if (!existing.author.startsWith("agent:")) throw new Error(`skill "${existing.name}" was written by the human and is read-only for agents; ask in the room or create a new one`);
    }
    const draft: SkillDraft = {
      name: existing?.name ?? name,
      description: String(input.description ?? ""),
      argumentHint: input.argumentHint ? String(input.argumentHint) : "",
      body: String(input.instructions ?? ""),
      userInvocable: input.userInvocable,
      agentInvocable: input.agentInvocable,
      author: existing?.author ?? `agent:${participant.name}@${this.id}`,
      reviewed: false,
      draft: existing ? existing.draft : this.skills.needApproval(),
    };
    const lint = library.lint(draft);
    if (lint.errors.length) throw new Error(`not saved: ${lint.errors.map((e) => e.message).join("; ")}`);
    const warnings = lint.warnings.map((w) => w.message);
    if (input.dryRun) return { ok: true, message: `dry run: "${draft.name}" would be ${input.op === "create" ? "created" : "updated"}${warnings.length ? ` with warnings: ${warnings.join("; ")}` : ""}`, warnings };
    const saved = this.skills.save(draft);
    const awaiting = saved.draft ? " It is a draft until the human approves it in Settings; it cannot be attached or loaded before that." : "";
    this.postSystem(`${participant.name} ${input.op === "create" ? "created" : "updated"} the skill "${saved.name}" (${saved.description.slice(0, 80)}${saved.description.length > 80 ? "…" : ""}).${saved.draft ? " Awaiting the human's approval." : ""}`);
    this.log.info(`skills: ${participant.name} ${input.op}d "${saved.name}"${saved.draft ? " (draft)" : ""}`);
    return {
      ok: true,
      message: `Skill "${saved.name}" ${input.op === "create" ? "created" : "updated"} in the shared library.${awaiting}${warnings.length ? ` Warnings: ${warnings.join("; ")}` : ""}${saved.draft ? "" : " Use attach_skill to give it to yourself or to other agents."}`,
      warnings,
    };
  }

  attachSkillForAgent(participantId: string, name: string, to: "me" | string[]): { ok: true; message: string } {
    const participant = this.participants.get(participantId);
    if (!participant || !this.runtimes.has(participantId)) throw new Error("this agent is not in the room any more");
    if (!this.skills) throw new Error("skills are not available in this room");
    const skill = this.skills.library.get(String(name ?? "").trim());
    if (!skill) throw new Error(`no skill named "${name}" in the library`);
    if (skill.problems.length) throw new Error(`skill "${skill.name}" cannot be attached (${skill.problems.join("; ")})`);
    if (skill.draft) throw new Error(`skill "${skill.name}" is a draft awaiting the human's approval; it cannot be attached yet`);
    const targets: Participant[] = [];
    const unknown: string[] = [];
    if (to === "me" || (Array.isArray(to) && to.length === 0)) targets.push(participant);
    else {
      for (const raw of Array.isArray(to) ? to : [String(to)]) {
        const wanted = String(raw).trim();
        if (!wanted || wanted.toLowerCase() === "me" || wanted.toLowerCase() === participant.name.toLowerCase()) {
          if (!targets.includes(participant)) targets.push(participant);
          continue;
        }
        const other = this.findByName(wanted.replace(/^@/, ""));
        if (!other || other.kind !== "agent" || other.status === "left") unknown.push(wanted);
        else if (!targets.includes(other)) targets.push(other);
      }
    }
    if (unknown.length) throw new Error(`no such agent in this room: ${unknown.join(", ")} (agents here: ${[...this.participants.values()].filter((p) => p.kind === "agent" && p.status !== "left").map((p) => p.name).join(", ")})`);
    const attached: string[] = [];
    for (const target of targets) {
      if (this.hasSkill(target, skill.name)) continue;
      target.skills = [...(target.skills ?? []), skill.name];
      attached.push(target.name);
      const runtime = this.runtimes.get(target.id);
      if (runtime) runtime.briefPending = runtime.briefPending ?? `your skills: "${skill.name}" attached${target.id === participant.id ? "" : ` by ${participant.name}`}`;
      this.push({ type: "participant", participant: target });
    }
    const others = attached.filter((n) => n !== participant.name);
    if (others.length) this.postSystem(`${participant.name} attached the skill "${skill.name}" to ${others.join(", ")}.`);
    this.log.info(`skills: ${participant.name} attached "${skill.name}" to ${attached.join(", ") || "nobody new"}`);
    const already = targets.filter((t) => !attached.includes(t.name)).map((t) => t.name);
    return {
      ok: true,
      message: `${attached.length ? `Skill "${skill.name}" attached to ${attached.map((n) => (n === participant.name ? "you" : n)).join(", ")}.` : ""}${already.length ? ` ${already.map((n) => (n === participant.name ? "You" : n)).join(", ")} already had it.` : ""}`.trim(),
    };
  }

  private skillMcpServers(participantId: string): { server: McpServer; token: string } | null {
    const hubUrl = this.skills?.hubUrl();
    if (!this.skills || !hubUrl) return null;
    const token = this.skills.issueToken(this.id, participantId);
    return {
      token,
      server: {
        name: "viberoom",
        command: process.execPath,
        args: [this.skills.serverScript],
        env: [
          { name: "VIBEROOM_HUB", value: hubUrl },
          { name: "VIBEROOM_TOKEN", value: token },
          ...runAsNodeEntries(),
        ],
      },
    };
  }

  skillToolReady(participantId: string, token: string): void {
    const runtime = this.runtimes.get(participantId);
    const participant = this.participants.get(participantId);
    if (!runtime || runtime.mcpToken !== token) {
      this.earlySkillReady.add(token);
      return;
    }
    if (!participant) return;
    const late = runtime.skillChannel === "marker";
    runtime.skillChannel = "tool";
    participant.skillChannel = "tool";
    for (const wake of runtime.skillReadyWaiters.splice(0)) wake();
    runtime.log.info(`skills: the ${SKILL_TOOL_NAME} tool is available${late ? " (late; brief will be refreshed)" : ""}`);
    if (late && this.attachedSkills(participant).length) runtime.briefPending = runtime.briefPending ?? "your skills: the load_skill tool became available";
    this.push({ type: "participant", participant });
  }

  private async awaitSkillChannel(participant: Participant, runtime: AgentRuntime): Promise<void> {
    if (runtime.skillChannel !== "pending") return;
    const remaining = runtime.sessionStartedAt + SKILL_TOOL_READY_MS - Date.now();
    if (remaining > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        runtime.skillReadyWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (runtime.skillChannel === "pending") {
      runtime.skillChannel = "marker";
      participant.skillChannel = "marker";
      runtime.log.info("skills: no MCP tools listed in time; using the [skill:name] marker");
      this.push({ type: "participant", participant });
    }
  }

  loadSkillForAgent(participantId: string, name: string): { name: string; text: string } {
    const participant = this.participants.get(participantId);
    const runtime = this.runtimes.get(participantId);
    if (!participant || !runtime) throw new Error("this agent is not in the room any more");
    const skill = this.resolveAgentSkill(participant, name);
    if (!skill.ok) throw new Error(skill.reason);
    const text = composeSkillBlock({ name: skill.skill.name, text: renderSkillBody(skill.skill.body, ""), extraFiles: skill.skill.extraFiles });
    this.commit({
      id: randomUUID(),
      seq: ++this.seq,
      from: participant.id,
      fromName: participant.name,
      to: [],
      toNames: [],
      text: `loaded skill "${skill.skill.name}"`,
      ts: Date.now(),
      kind: "hidden",
      details: { skill: skill.skill.name, via: "tool", outcome: "delivered as a tool result" },
    });
    runtime.log.info(`skills: "${skill.skill.name}" loaded through the tool`);
    return { name: skill.skill.name, text };
  }

  private resolveAgentSkill(participant: Participant, name: string): { ok: true; skill: Skill } | { ok: false; reason: string } {
    if (!this.skills) return { ok: false, reason: "skills are not available in this room" };
    const skill = this.skills.library.get(name);
    const mine = this.attachedSkills(participant).filter((s) => s.agentInvocable).map((s) => s.name);
    const list = mine.length ? `your skills: ${mine.join(", ")}` : "you have no skills";
    if (!this.hasSkill(participant, name) || !mine.some((s) => s.toLowerCase() === name.toLowerCase())) {
      return { ok: false, reason: `"${name}" is not one of your skills (${list})` };
    }
    if (!skill || skill.problems.length) return { ok: false, reason: `skill "${name}" cannot be loaded right now (${skill ? skill.problems.join("; ") : "missing"})` };
    return { ok: true, skill };
  }

  skillChanged(name: string): void {
    for (const [id, runtime] of this.runtimes) {
      const participant = this.participants.get(id);
      if (participant && this.hasSkill(participant, name)) runtime.briefPending = runtime.briefPending ?? `your skills: "${name}" changed`;
    }
  }

  private isSkillToolCall(runtime: AgentRuntime, params: RequestPermissionParams): boolean {
    if (!runtime.mcpToken) return false;
    const call = params.toolCall;
    const known = runtime.turn?.message.toolCalls?.find((t) => t.toolCallId === call.toolCallId);
    return canAutoApproveMessageCheck(call, known) || canAutoApproveRoomTool(call, known, "memory",
      input => Object.keys(input).every(key => ["action", "scope", "ticket", "notes", "reason", "acknowledge"].includes(key)) && (input.action === "read" || input.action === "revise")) || canAutoApproveRoomTool(call, known, SKILL_TOOL_NAME,
      input => Object.keys(input).every(key => key === "name") && typeof input.name === "string" && !!input.name.trim());
  }

  private forgetRuntime(id: string): void {
    const runtime = this.runtimes.get(id);
    if (runtime?.mcpToken) this.skills?.revokeToken(runtime.mcpToken);
    if (runtime?.delayTimer) clearTimeout(runtime.delayTimer);
    this.runtimes.delete(id);
  }

  private requestTurn(id: string, addressed = false): void {
    if (this.recordHold) return;
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) return;
    runtime.pendingTurn = true;
    if (participant.status === "error") {
      const trouble = participant.trouble;
      const canResume = addressed && runtime.agent.alive && trouble?.stage === "turn" && trouble.kind !== "crash";
      if (!canResume) return;
      this.clearTrouble(participant, "you wrote to it directly");
    }
    if (addressed && !runtime.addressed) {
      runtime.addressed = true;
      if (this.floorQueue.includes(id)) {
        this.floorQueue.splice(this.floorQueue.indexOf(id), 1);
        this.enqueueForFloor(id);
      }
    }
    if (runtime.turnActive || runtime.workBusy || runtime.delayTimer || this.floorQueue.includes(id)) return;
    const others = [...this.runtimes.keys()].filter((otherId) => otherId !== id && this.participants.get(otherId)?.status !== "left").length;
    const roomDelay = others >= 1 ? (this.settings.replyDelay ?? 0) : 0;
    const maxMs = Math.max(0, participant.replyDelay ?? roomDelay) * 1000;
    const waitMs = maxMs > 0 ? Math.round(Math.random() * maxMs) : 0;
    if (participant.status === "idle") {
      participant.status = "queued";
      this.push({ type: "participant", participant });
    }
    runtime.delayTimer = setTimeout(() => {
      runtime.delayTimer = null;
      this.tryStartTurn(id);
    }, waitMs);
    if (waitMs) runtime.log.info(`reply delay ${waitMs} ms`);
  }

  private tryStartTurn(id: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime || !runtime.pendingTurn || runtime.turnActive || runtime.workBusy) return;
    if (this.humanIsTyping()) {
      this.enqueueForFloor(id);
      this.armTypingTimer();
      return;
    }
    if (this.settings.turnTaking === "one-at-a-time" && this.speaking && this.speaking !== id) {
      this.enqueueForFloor(id);
      return;
    }
    void this.runTurn(id);
  }

  private enqueueForFloor(id: string): void {
    if (this.floorQueue.includes(id)) return;
    const runtime = this.runtimes.get(id);
    if (runtime?.addressed) {
      const firstPlain = this.floorQueue.findIndex((other) => !this.runtimes.get(other)?.addressed);
      if (firstPlain >= 0) {
        this.floorQueue.splice(firstPlain, 0, id);
        return;
      }
    }
    this.floorQueue.push(id);
  }

  private static readonly TYPING_HOLD_CAP_MS = 12_000;
  private typingHoldSince = 0;

  private humanIsTyping(): boolean {
    return this.settings.waitWhileHumanTypes && Date.now() < this.humanTypingUntil && Date.now() - this.typingHoldSince < Room.TYPING_HOLD_CAP_MS;
  }

  humanTyping(): void {
    if (Date.now() >= this.humanTypingUntil) this.typingHoldSince = Date.now();
    this.humanTypingUntil = Date.now() + 4000;
    this.armTypingTimer();
  }

  private armTypingTimer(): void {
    if (this.typingTimer) return;
    const wait = Math.max(50, this.humanTypingUntil - Date.now() + 20);
    this.typingTimer = setTimeout(() => {
      this.typingTimer = null;
      if (this.humanIsTyping()) {
        this.armTypingTimer();
        return;
      }
      this.startNext();
    }, wait);
  }

  private startNext(): void {
    if (this.humanIsTyping()) {
      this.armTypingTimer();
      return;
    }
    const oneAtATime = this.settings.turnTaking === "one-at-a-time";
    if (oneAtATime && this.speaking) return;
    while (this.floorQueue.length) {
      const id = this.floorQueue.shift()!;
      const runtime = this.runtimes.get(id);
      const participant = this.participants.get(id);
      if (!runtime || !participant || !runtime.pendingTurn || runtime.turnActive || runtime.workBusy || participant.muted || this.focused || participant.status === "error") continue;
      void this.runTurn(id);
      if (oneAtATime) return;
    }
  }

  private dropScheduledTurn(id: string): void {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (runtime) {
      runtime.pendingTurn = false;
      runtime.addressed = false;
      if (runtime.delayTimer) {
        clearTimeout(runtime.delayTimer);
        runtime.delayTimer = null;
      }
    }
    const i = this.floorQueue.indexOf(id);
    if (i >= 0) this.floorQueue.splice(i, 1);
    if (participant && participant.status === "queued") {
      participant.status = "idle";
      this.push({ type: "participant", participant });
    }
  }

  private async runTurn(id: string): Promise<void> {
    const participant = this.participants.get(id);
    const runtime = this.runtimes.get(id);
    if (!participant || !runtime || runtime.turnActive || runtime.workBusy) return;
    runtime.workBusy = true;
    runtime.workCancelled = false;
    this.speaking = id;
    runtime.addressed = false;
    try {
      await this.runTurnInner(id, participant, runtime);
    } finally {
      if (this.speaking === id) this.speaking = null;
      try {
        if (participant.status === "queued") {
          participant.status = "idle";
          this.push({ type: "participant", participant });
        }
      } finally {
        await this.finishRuntimeWork(id, runtime);
      }
    }
  }

  private async finishRuntimeWork(id: string, runtime: AgentRuntime): Promise<void> {
    let owner = runtime;
    try { owner = await this.applyPendingConfig(id, runtime) ?? runtime; }
    finally { this.resumeRuntimeWork(id, owner); this.startNext(); }
  }

  private resumeRuntimeWork(id: string, runtime: AgentRuntime): void {
    runtime.workBusy = false;
    if (this.closing || runtime.retiring || this.runtimes.get(id) !== runtime || !runtime.agent.alive) return;
    const participant = this.participants.get(id);
    if (runtime.notesPending && !runtime.workCancelled && participant && participant.status !== "error" && !participant.muted && !this.focused) {
      runtime.notesPending = false;
      void this.takeNotes(id).catch(error => runtime.log.warn(`notes: hidden turn failed: ${describeError(error)}`));
    } else if (runtime.pendingTurn) {
      this.requestTurn(id);
    }
  }

  private async runTurnInner(id: string, participant: Participant, runtime: AgentRuntime): Promise<void> {
    runtime.pendingTurn = false;
    if (!runtime.agent.alive || participant.muted || this.focused || runtime.workCancelled) return;
    await this.awaitSkillChannel(participant, runtime);
    if (!runtime.agent.alive || runtime.retiring || this.runtimes.get(id) !== runtime || participant.muted || this.focused || runtime.workCancelled) return;

    const unreadAll = this.messages.filter(
      (m) => m.kind !== "hidden" && m.audience !== "human" && m.seq > runtime.lastSeenSeq && (m.kind === "system" || m.from !== id || m.seq <= runtime.replayOwnUntilSeq),
    );
    if (!unreadAll.some((m) => m.kind === "chat" || m.wakes)) return;
    const cap = this.settings.backlogCap;
    const omitted = Math.max(0, unreadAll.length - cap);
    const unread = omitted ? unreadAll.slice(omitted) : unreadAll;
    this.registerPendingBodies(participant, unreadAll);
    const supplied = bodyRefs(unread);
    runtime.turnStartSeq = runtime.lastSeenSeq;
    runtime.lastSeenSeq = this.seq;

    const persona = this.personaOf(participant);
    const roster = this.roster();
    const settings = this.effectiveSettings();
    const tokensSinceBrief = runtime.lastUsed - runtime.usedAtBrief;
    const userMemory = this.history.memory.read("user"), roomMemory = this.history.memory.read(`room:${this.uuid}`);
    const memoryStamp = `${userMemory.revision}:${roomMemory.revision}`;
    let briefReason: string | null = null;
    if (!runtime.firstTurnDone) briefReason = "first turn";
    else if (runtime.briefPending) briefReason = runtime.briefPending;
    else if (runtime.memoryStamp !== memoryStamp) briefReason = "shared memory changed";
    else if (runtime.turnsSinceBrief >= this.settings.fullBriefEveryTurns) briefReason = `every ${this.settings.fullBriefEveryTurns} turns`;
    else if (tokensSinceBrief >= this.settings.fullBriefEveryTokens) briefReason = `${tokensSinceBrief} tokens since last brief`;

    const notes = [...runtime.headerNotes];
    runtime.headerNotes = [];
    if (briefReason && overThreshold(runtime.lastUsed, participant.contextSize ?? 0)) runtime.notesDue = true;
    runtime.notesAskedThisTurn = runtime.notesDue;
    if (runtime.notesDue) notes.push(NOTES_REQUEST);
    if (briefReason && runtime.firstTurnDone) {
      if (briefReason.startsWith("requested")) notes.push("full brief re-sent as requested");
      else if (briefReason.startsWith("room rules") || briefReason.startsWith("your persona") || briefReason.startsWith("your skills")) notes.push(`instructions updated (${briefReason})`);
      else notes.push(`full brief re-attached (${briefReason})`);
    }
    const attached = runtime.pendingSkills.splice(0);
    for (const s of attached) {
      notes.push(s.invokedBy ? `${s.invokedBy} invoked your skill "${s.name}"; its instructions are attached below, follow them` : `skill "${s.name}" attached below as you asked; the same messages follow`);
    }
    const skillsForPrompt = this.skillsForPrompt(participant, runtime);
    const offerHistoryNotice = runtime.historyNoticePending && skillsForPrompt?.channel === "tool" && !this.readOnly;
    if (offerHistoryNotice) {
      const firstShownSeq = Math.min(...unread.map(m => m.seq));
      const earlier = this.messages.reduce((count, m) => count + Number(
        m.seq < firstShownSeq && m.kind === "chat" && !m.streaming && visibleToAgents(m),
      ), 0);
      if (earlier) notes.push(`${earlier} earlier chat message${earlier === 1 ? " is" : "s are"} outside this prompt; use search_history to find ${earlier === 1 ? "it" : "them"}.`);
    }
    const seesImages = runtime.agent.acceptsImages;
    const backlogImages = (m: ChatMessage): BacklogImage[] | undefined => {
      if (!m.images || !m.images.length) return undefined;
      const attached = seesImages && (m.to.length === 0 || m.to.includes(id));
      return m.images.map((a, i) => ({ n: a.n ?? i + 1, ref: `#${m.seq}.${a.n ?? i + 1}`, name: a.name, path: this.imagePath(a), mimeType: a.mimeType, attached, forNames: m.to.length ? m.toNames : [] }));
    };
    const backlogQuotes = (m: ChatMessage): BacklogQuote[] | undefined =>
      m.quotes && m.quotes.length ? m.quotes.map((q) => ({ n: q.n, seq: q.seq, fromName: q.fromName, ts: q.ts, text: q.text })) : undefined;
    const prompt = composePrompt({
      brief: briefReason ? buildBrief(settings, persona, roster, runtime.notesForBrief ?? (participant.notes && (participant.notesSeq ?? -1) >= runtime.lastBriefSeq ? participant.notes : undefined), skillsForPrompt) : undefined,
      header: buildHeader(settings, persona, roster, this.hops, notes, skillsForPrompt),
      memory: briefReason ? memoryBlock(userMemory, roomMemory) : undefined,
      skills: attached.map((s) => composeSkillBlock({ name: s.name, text: s.text, invokedBy: s.invokedBy, extraFiles: s.extraFiles })),
      backlog: unread.map<BacklogLine>((m) =>
        m.kind === "system"
          ? { kind: "event", text: this.backlogText(m) }
          : {
              kind: "message",
              fromName: m.from === id ? `${m.fromName} (you, earlier)` : m.fromName,
              toNames: m.toNames,
              text: this.backlogText(m),
              images: backlogImages(m),
              quotes: backlogQuotes(m),
            },
      ),
      omitted,
      personaName: participant.name,
    });
    if (briefReason) {
      runtime.memoryStamp = memoryStamp;
      runtime.briefPending = null;
      runtime.turnsSinceBrief = 0;
      runtime.briefSentThisTurn = true;
      runtime.lastBriefSeq = this.seq;
      runtime.notesForBrief = null;
      participant.briefsSent = (participant.briefsSent ?? 0) + 1;
    }
    runtime.firstTurnDone = true;
    runtime.replayOwnUntilSeq = -1;
    runtime.log.info(`turn: ${unread.length} unread (${omitted} omitted), brief=${briefReason ?? "no"}, notes=${notes.length}`);

    const retry = await this.executeTurn(participant, runtime, this.promptBlocks(prompt, runtime), null, false, offerHistoryNotice, supplied);
    if (retry) {
      await this.executeTurn(participant, runtime, [{ type: "text", text: retry.prompt }], retry);
    }
  }

  private promptBlocks(parts: PromptPart[], runtime: AgentRuntime): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    for (const part of parts) {
      if (part.type === "text") {
        blocks.push({ type: "text", text: part.text });
        continue;
      }
      try {
        blocks.push({ type: "image", data: readFileSync(part.image.path).toString("base64"), mimeType: part.image.mimeType });
      } catch (error) {
        runtime.log.warn(`image ${part.image.ref} could not be read: ${describeError(error)}`);
        blocks.push({ type: "text", text: ` (${part.image.ref} could not be read: ${part.image.path})` });
      }
    }
    return blocks;
  }

  private async executeTurn(participant: Participant, runtime: AgentRuntime, blocks: ContentBlock[], retry: RetryRequest | null, hidden = false, historyNoticeOffered = false, supplied: BodyRef[] = []): Promise<RetryRequest | null> {
    if (runtime.turnActive || runtime.turn) throw new Error(`${participant.name} is already answering`);
    const id = participant.id;
    runtime.turnActive = true;
    runtime.usageSeenThisTurn = false;
    this.watchForSilence();
    participant.status = "thinking";
    participant.statusDetail = undefined;

    const draft: ChatMessage = {
      id: randomUUID(),
      seq: 0,
      from: id,
      fromName: participant.name,
      to: [],
      toNames: [],
      text: "",
      ts: Date.now(),
      kind: "chat",
      streaming: true,
      toolCalls: [],
    };
    this.drafts.set(draft.id, draft);
    const turn: NonNullable<AgentRuntime["turn"]> = { message: draft, messageId: null, sawMessageId: false, startedAt: Date.now(), published: false, hidden, messagesFromSeq: runtime.lastSeenSeq };
    runtime.turn = turn;
    this.push({ type: "participant", participant });

    let result: PromptResult | null = null;
    let failure: string | null = null;
    let failureCode = "";
    try {
      const epoch = participant.deliveryEpoch;
      const pending = runtime.agent.prompt(runtime.sessionId, blocks);
      if (!hidden && this.runtimes.get(id) === runtime) this.recordBodySupply(id, supplied, epoch);
      result = await pending;
    } catch (error) {
      failureCode = errorName(error);
      failure = describeError(error);
    }

    if (runtime.turn !== turn) {
      this.drafts.delete(draft.id);
      return null;
    }
    const startedAt = turn.startedAt;
    const published = turn.published;
    const publishedAt = turn.publishedAt ?? null;
    runtime.turn = null;
    runtime.turnActive = false;
    this.drafts.delete(draft.id);
    participant.turns += 1;
    if (!retry) runtime.turnsSinceBrief += 1;
    if (runtime.briefSentThisTurn) {
      runtime.usedAtBrief = runtime.lastUsed;
      runtime.briefSentThisTurn = false;
    }

    if (runtime.retiring) {
      this.push({ type: "message.removed", id: draft.id });
      if (retry) this.closeRetry(retry, "the session was replaced; nothing was posted");
      return null;
    }
    if (failure || !result) {
      participant.statusDetail = `last turn failed: ${(failure ?? "no result").replace(/\s+/g, " ").slice(0, 120)}`;
      participant.failedTurns = (participant.failedTurns ?? 0) + 1;
      this.push({ type: "message.removed", id: draft.id });
      runtime.log.error(`turn failed: ${failure}`);
      const kept = runtime.transcript.dump(`turn failed: ${(failure ?? "no result").slice(0, 120)}`);
      if (kept) runtime.log.info(`the protocol around the failure was kept: ${kept}`);
      if (retry) this.closeRetry(retry, "the correction turn failed; nothing was posted");
      if (isContextFullError(failure)) {
        participant.status = runtime.agent.alive ? "idle" : "error";
        this.push({ type: "participant", participant });
        this.contextFull(participant, runtime, failure ?? "");
        return null;
      }
      const recipe = getRecipe(participant.agentType ?? "");
      const trouble = classifyTurnFailure({
        error: failure ?? "no result",
        code: failureCode,
        vendor: recipe?.vendor ?? participant.agentVendor ?? "The coding agent",
        alive: runtime.agent.alive,
        loginCommand: recipe?.loginCommand || undefined,
        loginFromHere: !!recipe && recipe.loginFlow.kind !== "none",
      });
      const again = participant.trouble?.stage === "turn" && participant.trouble.kind === trouble.kind;
      trouble.streak = again ? (participant.trouble?.streak ?? 1) + 1 : 1;
      if (trouble.streak >= 2 && trouble.kind === "unknown" && trouble.actions?.includes("respawn")) {
        trouble.actions = ["respawn", ...trouble.actions.filter((a) => a !== "respawn")];
        trouble.advice = "It failed the same way twice in a row: respawn it (a fresh session with its notes and the last messages; the history stays), or press Retry if it was a passing thing.";
      } else if (trouble.streak >= 2 && (trouble.kind === "limit" || trouble.kind === "network")) {
        trouble.advice = `${trouble.advice} It has failed this way ${trouble.streak} times in a row: give it a few minutes first.`;
      }
      participant.trouble = trouble;
      const paused = !runtime.agent.alive || trouble.kind === "login" || trouble.streak >= 2;
      participant.status = paused ? "error" : "idle";
      this.push({ type: "participant", participant });
      if (paused) {
        runtime.log.warn(`paused after ${trouble.streak} ${trouble.kind} failure(s): waiting for the human`);
        this.postRoomEvent(`${participant.name} needs you: ${trouble.what} ${trouble.advice}`, "human", false, { tone: "attention" });
      } else {
        this.postRoomEvent(`${participant.name} could not answer: ${(failure ?? "no result").slice(0, 240)}`, undefined, false, { tone: "error" });
      }
      return null;
    }
    const failedBefore = participant.failedTurns ?? 0;
    const next = this.finalizeTurn(participant, runtime, draft, result, Date.now() - startedAt, retry, published, publishedAt, hidden);
    if (historyNoticeOffered && result.stopReason !== "cancelled" && !runtime.workCancelled && (participant.failedTurns ?? 0) === failedBefore) {
      runtime.historyNoticePending = false;
    }
    return next;
  }

  private finalizeTurn(
    participant: Participant,
    runtime: AgentRuntime,
    draft: ChatMessage,
    result: PromptResult,
    durationMs: number,
    retry: RetryRequest | null,
    published: boolean,
    publishedAt: number | null = null,
    hidden = false,
  ): RetryRequest | null {
    participant.status = "idle";
    if (!runtime.usageSeenThisTurn) {
      const used = tokensCarried(result);
      if (used !== null) {
        participant.contextUsed = used;
        runtime.lastUsed = used;
        runtime.log.info(`context from the result: ${used} input tokens${participant.contextSize ? ` of ${participant.contextSize}` : " (window size unknown)"}`);
      }
    }
    if (participant.trouble?.stage === "turn") {
      participant.trouble = undefined;
      participant.statusDetail = undefined;
    }
    this.push({ type: "participant", participant });

    const cancelled = result.stopReason === "cancelled";
    if (cancelled) runtime.briefPending = runtime.briefPending ?? "previous turn was cancelled";

    const extracted = extractNotes(draft.text);
    const hadNotes = this.keepNotes(participant, runtime, extracted.notes, hidden ? "hidden turn" : "reply");
    draft.text = extracted.visible;
    const text = draft.text.trim();
    if (hidden) {
      this.commit({
        id: randomUUID(),
        seq: ++this.seq,
        from: participant.id,
        fromName: participant.name,
        to: [],
        toNames: [],
        text: hadNotes ? `took notes (${(participant.notes ?? "").split("\n").length} lines)` : "was asked for notes and gave none",
        ts: Date.now(),
        kind: "hidden",
        details: { original: draft.text, outcome: hadNotes ? "notes kept" : "no <notes> block in the reply" },
      });
      return null;
    }
    if (runtime.notesAskedThisTurn && !hadNotes && !retry && !cancelled) {
      runtime.notesMisses += 1;
      if (runtime.notesMisses >= 2) {
        runtime.notesMisses = 0;
        if (!cancelled) runtime.notesPending = true;
      }
    }

    if (!retry && text.toLowerCase() === REQUEST_BRIEF_MARKER) {
      this.push({ type: "message.removed", id: draft.id });
      if (runtime.briefRequestedAtSeq === runtime.lastSeenSeq) {
        this.notice(`${participant.name} asked for the brief twice on the same messages; treated as silent.`, "warn");
        return null;
      }
      runtime.briefRequestedAtSeq = runtime.lastSeenSeq;
      runtime.lastSeenSeq = runtime.turnStartSeq;
      runtime.briefPending = "requested by the agent";
      this.notice(`${participant.name} asked for the room brief (hidden turn); re-sending with the same messages.`, "info");
      this.requestTurn(participant.id);
      return null;
    }

    const pull = !retry ? skillPull(text) : null;
    if (pull) {
      this.push({ type: "message.removed", id: draft.id });
      return this.handleSkillPull(participant, runtime, text, pull);
    }

    if (!text || text.toLowerCase() === SILENT_MARKER) {
      const keepBubble = cancelled && !retry && !!draft.toolCalls?.length;
      if (published && !keepBubble) this.push({ type: "message.removed", id: draft.id });
      if (keepBubble) {
        this.commit({ ...draft, seq: ++this.seq, to: [], toNames: [], text: "", streaming: false,
          stopReason: result.stopReason, stoppedBy: this.humanName, audience: "human", usage: result.usage ?? null, durationMs });
      }
      if (retry) {
        this.closeRetry(retry, cancelled ? "the correction turn was stopped; nothing was posted" : "the agent withdrew the reply");
        if (cancelled) this.postRoomEvent(`${participant.name} was stopped by ${this.humanName}${stoppedWork(draft)}.`, undefined, false, { tone: "attention" });
      } else if (cancelled) {
        this.postRoomEvent(`${participant.name} was stopped by ${this.humanName}${stoppedWork(draft)}.`, undefined, false, { tone: "attention" });
      } else {
        this.postSystem(`${participant.name} read the room and has nothing to add.`);
      }
      return null;
    }

    const bareContextFull = isBareContextFullError(text);
    if (!(draft.toolCalls?.length) && (ADAPTER_ERROR_PATTERN.test(text) || bareContextFull)) {
      this.push({ type: "message.removed", id: draft.id });
      participant.failedTurns = (participant.failedTurns ?? 0) + 1;
      participant.statusDetail = `agent error: ${text.replace(/\s+/g, " ").slice(0, 120)}${text.length > 120 ? "…" : ""}`;
      this.push({ type: "participant", participant });
      this.postRoomEvent(`${participant.name}'s agent reported an error instead of a reply: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`, undefined, false, { tone: "error" });
      runtime.log.warn(`adapter error text treated as failed turn: ${text.slice(0, 200)}`);
      if (retry) this.closeRetry(retry, "the agent reported an error instead of a corrected reply");
      if (bareContextFull) this.contextFull(participant, runtime, text);
      return null;
    }

    const mentions = this.parseMentions(text);
    const corrections = this.referee(participant, text, mentions);
    if (corrections.length) {
      participant.violations = (participant.violations ?? 0) + corrections.length;
      runtime.log.info(`referee${retry ? " (after retry)" : ""}: ${corrections.join(" | ")}`);
      if (!retry && this.settings.refereeAction === "retry-hidden" && !cancelled) {
        this.push({ type: "message.removed", id: draft.id });
        participant.retries = (participant.retries ?? 0) + 1;
        this.push({ type: "participant", participant });
        const record: ChatMessage = {
          id: randomUUID(),
          seq: ++this.seq,
          from: participant.id,
          fromName: participant.name,
          to: [],
          toNames: [],
          text: `Reply held back; correction requested: ${corrections.map((c) => c.replace(/^reminder:\s*/i, "")).join("; ")}`,
          ts: Date.now(),
          kind: "hidden",
          details: { original: text, corrections },
        };
        this.commit(record);
        const header = buildHeader(this.effectiveSettings(), this.personaOf(participant), this.roster(), this.hops, [
          "your last reply was not posted; see the correction below",
        ]);
        return {
          prompt: composeCorrectionPrompt({ header, originalText: text, corrections, personaName: participant.name }),
          original: text,
          corrections,
          record,
        };
      }
      runtime.headerNotes.push(...corrections);
      this.push({ type: "participant", participant });
    }

    const message: ChatMessage = {
      ...draft,
      seq: ++this.seq,
      to: mentions.ids,
      toNames: mentions.names,
      text,
      streaming: false,
      stopReason: result.stopReason,
      ...(cancelled ? { stoppedBy: this.humanName } : {}),
      usage: result.usage ?? null,
      durationMs,
    };
    this.commit(message);
    if (participant.contextEvent?.kind === "compacted") {
      participant.contextEvent = undefined;
      this.push({ type: "participant", participant });
    }
    if (publishedAt !== null && this.messages.some((x) => x.kind === "chat" && x.id !== message.id && x.ts > publishedAt)) {
      const at = new Date(draft.ts);
      const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
      this.postSystem(`${participant.name} finished the reply started at ${hhmm} · ${formatDuration(durationMs)}`, "human", false, { refId: message.id, agentId: participant.id });
    }
    if (retry) {
      this.closeRetry(retry, corrections.length ? `corrected reply posted, but it still breaks: ${corrections.map((c) => c.replace(/^reminder:\s*/i, "")).join("; ")}` : "corrected reply posted");
    }
    if (cancelled) {
      this.postSystem(`${participant.name} was stopped mid-reply by ${this.humanName}; what it had written stays in the room.`, "agents", false, { tone: "attention" });
      return null;
    }
    if (result.stopReason !== "end_turn") {
      this.postRoomEvent(`${participant.name} stopped with ${result.stopReason}.`, undefined, false, { tone: "attention" });
    }
    this.route(message);
    return null;
  }

  private handleSkillPull(participant: Participant, runtime: AgentRuntime, original: string, name: string): null {
    const record: ChatMessage = {
      id: randomUUID(),
      seq: ++this.seq,
      from: participant.id,
      fromName: participant.name,
      to: [],
      toNames: [],
      text: `asked for skill "${name}"`,
      ts: Date.now(),
      kind: "hidden",
      details: { original, skill: name, via: "marker" },
    };
    const resolved = this.resolveAgentSkill(participant, name);
    if (!resolved.ok) {
      record.details = { ...record.details, outcome: `not delivered: ${resolved.reason}` };
      this.commit(record);
      runtime.headerNotes.push(`you asked for skill "${name}" but ${resolved.reason}`);
      runtime.log.info(`skills: pull of "${name}" refused: ${resolved.reason}`);
      return null;
    }
    if (runtime.skillPulledAtSeq === runtime.lastSeenSeq && runtime.skillPulledName === resolved.skill.name) {
      record.details = { ...record.details, outcome: "not delivered: asked twice on the same messages; treated as silent" };
      this.commit(record);
      this.notice(`${participant.name} asked for skill "${name}" twice on the same messages; treated as silent.`, "warn");
      return null;
    }
    runtime.skillPulledAtSeq = runtime.lastSeenSeq;
    runtime.skillPulledName = resolved.skill.name;
    runtime.pendingSkills.push({ name: resolved.skill.name, text: renderSkillBody(resolved.skill.body, ""), extraFiles: resolved.skill.extraFiles });
    runtime.lastSeenSeq = runtime.turnStartSeq;
    record.details = { ...record.details, outcome: "delivered in a hidden turn" };
    this.commit(record);
    runtime.log.info(`skills: "${resolved.skill.name}" pulled with the marker; re-running the turn`);
    this.requestTurn(participant.id);
    return null;
  }

  private closeRetry(retry: RetryRequest, outcome: string): void {
    retry.record.details = { ...(retry.record.details ?? { original: retry.original, corrections: retry.corrections }), outcome };
    this.push({ type: "message", message: retry.record });
  }

  private referee(participant: Participant, text: string, mentions: { ids: string[]; names: string[] }): string[] {
    const corrections: string[] = [];
    const unknown: string[] = [];
    for (const match of spokenText(text).matchAll(MENTION_PATTERN)) {
      if (match[1].toLowerCase() === "all") continue;
      if (!this.findByName(match[1]) && !unknown.includes(match[1])) unknown.push(match[1]);
    }
    if (unknown.length) {
      const known = [...this.participants.values()].map((p) => p.name).join(", ");
      corrections.push(`reminder: ${unknown.map((u) => `@${u}`).join(", ")} ${unknown.length > 1 ? "are" : "is"} not in the room; participants are ${known}`);
    }
    if (mentions.ids.includes(participant.id)) {
      corrections.push("reminder: do not address yourself with @");
    }
    if (this.settings.maxSentences) {
      const sentences = countSentences(text);
      if (sentences > this.settings.maxSentences) {
        corrections.push(`reminder: keep replies to at most ${this.settings.maxSentences} sentences (last reply had ${sentences})`);
      }
    }
    return corrections;
  }


  private showDraft(turn: NonNullable<AgentRuntime["turn"]>): void {
    if (turn.published || turn.hidden) return;
    turn.published = true;
    turn.publishedAt = Date.now();
    turn.message.displayOrder = ++this.displayOrder;
    this.push({ type: "message", message: turn.message });
  }

  private onSessionUpdate(id: string, update: SessionUpdate): void {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) return;
    const turn = runtime.turn;
    if (turn) {
      if (runtime.quiet && runtime.quiet.turnId === turn.message.id) {
        const waited = Math.round((Date.now() - (turn.lastSignAt ?? turn.startedAt)) / 60_000);
        runtime.quiet = undefined;
        if (this.toldOfSilence.has(turn.message.id)) this.postSystem(`${participant.name} answered after ${waited} minute${waited === 1 ? "" : "s"}.`, "human", false, { agentId: id });
        this.push({ type: "participant", participant });
      }
      turn.lastSignAt = Date.now();
      if (WORK_SIGNS.has(update.sessionUpdate)) turn.lastWorkAt = Date.now();
    }

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const u = update as { content: ContentBlock; messageId?: string | null };
        const messageId = u.messageId ?? null;
        if (!turn) {
          if (messageId) runtime.strayMessageId = messageId;
          return;
        }
        if (messageId && messageId === runtime.strayMessageId) return;
        let text = contentText(u.content);
        if (messageId && !turn.sawMessageId && turn.message.text) {
          const notices = (turn.message.notices ??= []);
          notices.push(turn.message.text.trim());
          turn.message.text = "";
          turn.shownLength = 0;
          if (turn.published) this.push({ type: "message", message: turn.message });
        } else if (messageId !== turn.messageId && turn.message.text) {
          text = "\n\n" + text;
        }
        if (messageId) turn.sawMessageId = true;
        turn.messageId = messageId;
        const settled = settledVisible(turn.message.text + text);
        const shown = settled.slice(turn.shownLength ?? 0);
        turn.shownLength = settled.length;
        turn.message.text += text;
        if (!turn.published) {
          if (!looksSilent(turn.message.text) && shown) this.showDraft(turn);
          return;
        }
        if (shown) this.push({ type: "chunk", id: turn.message.id, text: shown });
        return;
      }
      case "agent_thought_chunk": {
        if (!turn) return;
        const text = contentText((update as { content: ContentBlock }).content);
        turn.message.thought = (turn.message.thought ?? "") + text;
        if (turn.published) this.push({ type: "thought", id: turn.message.id, text });
        return;
      }
      case "tool_call":
      case "tool_call_update": {
        if (!turn) return;
        this.showDraft(turn);
        const u = update as ToolCallUpdate;
        const calls = (turn.message.toolCalls ??= []);
        let view = calls.find((c) => c.toolCallId === u.toolCallId);
        if (!view) {
          view = { toolCallId: u.toolCallId, title: u.title ?? u.name ?? "tool call" };
          calls.push(view);
        }
        if (!applyToolCallUpdate(view, u) && update.sessionUpdate === "tool_call_update") return;
        this.push({ type: "toolcall", id: turn.message.id, toolCall: view });
        return;
      }
      case "plan": {
        if (!turn) return;
        this.showDraft(turn);
        const entries = (update as { entries: PlanEntry[] }).entries;
        turn.message.plan = entries;
        this.push({ type: "plan", id: turn.message.id, entries });
        return;
      }
      case "usage_update": {
        const u = update as { used: number; size: number; cost?: { amount: number; currency: string } | null };
        if (emptyUsageReport(runtime.lastUsed, u.used)) {
          runtime.log.info(`usage report of 0 after ${runtime.lastUsed} tokens ignored (failed request?)`);
          return;
        }
        runtime.usageSeenThisTurn = true;
        participant.contextUsed = u.used;
        participant.contextSize = u.size;
        if (u.cost) participant.cost = { amount: u.cost.amount, currency: u.cost.currency };
        if (looksCompacted(runtime.lastUsed, u.used) && !runtime.briefPending) {
          runtime.briefPending = `context shrank from ${runtime.lastUsed} to ${u.used} tokens (compaction?)`;
          runtime.log.info(`usage dropped ${runtime.lastUsed} -> ${u.used}; brief scheduled`);
          participant.contextEvent = { kind: "compacted", at: Date.now(), used: u.used, size: u.size };
          runtime.notesDue = overThreshold(u.used, u.size);
          this.postSystem(`${participant.name} compacted its context (${Math.round(runtime.lastUsed / 1000)}k → ${Math.round(u.used / 1000)}k tokens); the room rules are re-sent with its next turn${participant.notes ? ", with its notes" : ""}.`, "human", false, { tone: "attention" });
        }
        if (crossedThreshold(runtime.lastUsed, u.used, u.size)) {
          runtime.notesDue = true;
          participant.contextEvent = { kind: "threshold", at: Date.now(), used: u.used, size: u.size };
          this.postSystem(`${participant.name} is at ${Math.round((100 * u.used) / u.size)}% of its context; it will leave notes with its next reply. You can respawn it with memory from its panel.`, "human", false, { tone: "attention" });
          runtime.log.info(`context at ${u.used}/${u.size}: notes due`);
        }
        runtime.lastUsed = u.used;
        this.push({ type: "participant", participant });
        return;
      }
      case "config_option_update": {
        participant.configOptions = (update as { configOptions: SessionConfigOption[] }).configOptions;
        this.applyConfigSummary(participant);
        this.push({ type: "participant", participant });
        return;
      }
      case "current_mode_update": {
        participant.mode = (update as { currentModeId: string }).currentModeId;
        this.push({ type: "participant", participant });
        return;
      }
      case "available_commands_update":
      case "session_info_update":
      case "user_message_chunk":
        return;
      default:
        runtime.log.info(`unhandled session update: ${update.sessionUpdate}`);
    }
  }

  private onPermissionRequest(id: string, params: RequestPermissionParams): Promise<RequestPermissionResponse> {
    const participant = this.participants.get(id);
    const runtime = this.runtimes.get(id);
    if (runtime && this.isSkillToolCall(runtime, params)) {
      const option = params.options.find((o) => o.kind === "allow_once");
      if (option) {
        runtime.log.info(`room tool permission auto-approved (${option.optionId})`);
        return Promise.resolve({ outcome: { outcome: "selected", optionId: option.optionId } });
      }
    }
    return new Promise((resolve) => {
      const entry: PermissionEntry = {
        key: randomUUID(),
        participantId: id,
        toolCall: params.toolCall,
        options: params.options,
        ts: Date.now(),
        resolve,
      };
      this.permissions.set(entry.key, entry);
      const { resolve: _r, ...view } = entry;
      if (runtime?.turn) this.showDraft(runtime.turn);
      this.push({ type: "permission", permission: view });
      this.notice(`${participant?.name ?? id} asks for permission: ${params.toolCall.title ?? params.toolCall.toolCallId}`, "info");
    });
  }

  private onAgentExit(id: string, code: number | null, signal: NodeJS.Signals | null, agent: AcpAgent): void {
    const participant = this.participants.get(id);
    const runtime = this.runtimes.get(id);
    if (!participant) return;
    if (!runtime || runtime.agent !== agent) return;
    this.cancelPermissionsOf(id);
    if (this.closing || runtime.retiring) {
      this.forgetRuntime(id);
      return;
    }
    if (runtime) {
      runtime.log.warn(`agent process exited (code ${code}, signal ${signal})`);
      const kept = runtime.transcript.dump(`the agent process exited (code ${code}, signal ${signal})`);
      if (kept) runtime.log.info(`the protocol around the exit was kept: ${kept}`);
      this.forgetRuntime(id);
    }
    if (participant.status !== "left") {
      if (runtime) this.restoredSeen.set(id, runtime.lastSeenSeq);
      participant.status = "offline";
      participant.statusDetail = `process exited (code ${code}${signal ? `, signal ${signal}` : ""}); reconnect to continue`;
      this.push({ type: "participant", participant });
      this.notice(`${participant.name}: agent process exited.`, "error");
    }
  }


  private async openSession(agent: AcpAgent, cwd: string, log: Logger, mcpServers: McpServer[] = [], recipe?: AgentRecipe): Promise<NewSessionResult> {
    try {
      return await agent.newSession(cwd, mcpServers);
    } catch (error) {
      if (!isAuthRequired(error) || !agent.authMethods.length) throw error;
      log.info(`session/new needs authentication: ${describeError(error)}`);
      if (recipe?.loginState === "missing") throw new Error(`authentication required: ${recipe.vendor} is not logged in on this machine${recipe.loginCommand ? ` (its own CLI: ${recipe.loginCommand})` : ""}`);
    }
    const failures: string[] = [];
    for (const method of agent.authMethods) {
      const human = (method as { type?: string }).type === "terminal" ? "needs a terminal" : needsTheHuman(method, recipe) ? "opens a browser (a sign-in that needs you)" : null;
      if (human) {
        failures.push(`${method.id}: ${human}`);
        continue;
      }
      log.info(`authenticate with "${method.id}"${method.name ? ` (${method.name})` : ""}`);
      try {
        const done = await Promise.race([agent.authenticate(method.id).then(() => true), delay(AUTH_WAIT_MS).then(() => false)]);
        if (!done) {
          failures.push(`${method.id}: no answer in ${AUTH_WAIT_MS / 1000} s (a sign-in that needs you)`);
          continue;
        }
        return await agent.newSession(cwd, mcpServers);
      } catch (error) {
        failures.push(`${method.id}: ${describeError(error)}`);
      }
    }
    throw new Error(`authentication failed: ${recipe?.vendor ?? "the agent"} is not logged in on this machine. ${failures.join("; ")}`);
  }

  private async applyConfig(
    runtime: AgentRuntime,
    participant: Participant,
    wanted: { model: string | null; effort: string | null; mode: string | null },
  ): Promise<string[]> {
    const warnings: string[] = [];
    const plan: [string, string | null][] = [
      ["model", wanted.model],
      ["thought_level", wanted.effort],
      ["mode", wanted.mode],
    ];
    for (const [category, value] of plan) {
      if (!value) continue;
      const option = participant.configOptions?.find((o) => o.category === category);
      if (!option || option.type !== "select") {
        if (category === "mode" && participant.modes?.some((m) => m.id === value)) {
          try {
            const reported = await runtime.agent.setMode(runtime.sessionId, value);
            participant.mode = reported?.currentModeId ?? value;
          } catch (error) {
            warnings.push(`mode: set_mode failed: ${describeError(error)}`);
          }
          continue;
        }
        warnings.push(`${category}: the agent exposes no such config option; left at its default`);
        continue;
      }
      const values = flattenOptions(option.options);
      if (!values.some((v) => v.value === value)) {
        warnings.push(`${category}: "${value}" is not offered (${values.map((v) => v.value).join(", ")}); left at ${String(option.currentValue)}`);
        continue;
      }
      if (option.currentValue === value) continue;
      try {
        participant.configOptions = await runtime.agent.setConfigOption(runtime.sessionId, option.id, value);
      } catch (error) {
        warnings.push(`${category}: set_config_option failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const recipe = participant.agentType ? getRecipe(participant.agentType) : undefined;
    if (recipe?.bypassConfig && wanted.mode && wanted.mode === recipe.bypassMode) {
      for (const [optionId, value] of Object.entries(recipe.bypassConfig)) {
        const option = participant.configOptions?.find((o) => o.id === optionId);
        if (!option || option.type !== "select" || option.currentValue === value) continue;
        if (!flattenOptions(option.options).some((v) => v.value === value)) continue;
        try {
          participant.configOptions = await runtime.agent.setConfigOption(runtime.sessionId, option.id, value);
        } catch (error) {
          warnings.push(`${optionId}: set_config_option failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    this.applyConfigSummary(participant);
    if (wanted.mode && participant.mode && participant.mode !== wanted.mode && !warnings.some(w => w.startsWith("mode:"))) {
      warnings.push(`mode: requested ${wanted.mode}; the agent reports ${participant.mode}`);
    }
    return warnings;
  }

  private applyConfigSummary(participant: Participant): void {
    const pick = (category: string): string | undefined => {
      const option = participant.configOptions?.find((o) => o.category === category);
      return option ? String(option.currentValue) : undefined;
    };
    participant.model = pick("model") ?? participant.model;
    participant.effort = pick("thought_level") ?? participant.effort;
    participant.mode = pick("mode") ?? participant.mode;
  }

  private failStart(participant: Participant, error: unknown, fresh: boolean, stderr: string[] = []): Error {
    participant.statusDetail = describeError(error);
    const recipe = getRecipe(participant.agentType ?? "");
    participant.trouble = classifyStartFailure({
      error: participant.statusDetail,
      stderr,
      vendor: recipe?.vendor ?? participant.agentVendor ?? "The coding agent",
      loginCommand: recipe?.loginCommand || undefined,
      installHint: recipe?.installHint || undefined,
      loginState: recipe?.loginState,
      loginFromHere: !!recipe && recipe.loginFlow.kind !== "none",
    });
    this.log.warn(`${participant.name}: failed to start: ${participant.statusDetail}`);
    if (fresh) {
      participant.status = "error";
      this.push({ type: "participant", participant });
      this.participants.delete(participant.id);
      this.push({ type: "participant.removed", id: participant.id });
    } else {
      participant.status = "offline";
      this.push({ type: "participant", participant });
    }
    return new Error(`${participant.trouble.what} ${participant.trouble.advice} (${participant.statusDetail})`);
  }

  private cancelPermissionsOf(id: string): void {
    for (const [key, entry] of this.permissions) {
      if (entry.participantId !== id) continue;
      this.permissions.delete(key);
      entry.resolve({ outcome: { outcome: "cancelled" } });
      this.push({ type: "permission.resolved", key, optionId: null });
    }
  }

  private personaOf(participant: Participant): Persona {
    return { name: participant.name, tagline: participant.tagline ?? "", role: participant.role ?? "" };
  }

  private roster(): RosterEntry[] {
    const activity = new Map(this.whoIsBusy().map(p => [p.name, p.line]));
    return [...this.participants.values()]
      .filter((p) => p.status !== "left" && p.status !== "unstaffed")
      .map((p) => ({ name: p.name, kind: p.kind, vendor: p.agentVendor ?? p.agentLabel, tagline: p.tagline || undefined, muted: p.muted || undefined, activity: activity.get(p.name) }));
  }

  private parseMentions(text: string): { ids: string[]; names: string[] } {
    const ids: string[] = [];
    const names: string[] = [];
    for (const match of spokenText(text).matchAll(MENTION_PATTERN)) {
      if (match[1].toLowerCase() === "all") {
        for (const p of this.participants.values()) {
          if (p.kind !== "agent" || p.status === "left" || ids.includes(p.id)) continue;
          ids.push(p.id);
        }
        if (!names.includes("All")) names.push("All");
        continue;
      }
      const participant = this.findByName(match[1]);
      if (participant && !ids.includes(participant.id)) {
        ids.push(participant.id);
        names.push(participant.name);
      }
    }
    return { ids, names };
  }

  findByName(name: string): Participant | undefined {
    const lower = name.toLowerCase();
    for (const p of this.participants.values()) if (p.name.toLowerCase() === lower) return p;
    return undefined;
  }

  private postRoomEvent(text: string, audience?: "agents" | "human", wakes?: boolean, details?: ChatMessage["details"], bodyEdit?: BodyEdit): void {
    this.postSystem(text, audience, wakes, { ...(details ?? {}), about: "room" }, bodyEdit);
  }

  private postSystem(text: string, audience?: "agents" | "human", wakes?: boolean, details?: ChatMessage["details"], bodyEdit?: BodyEdit): void {
    const message: ChatMessage = {
      id: randomUUID(),
      seq: ++this.seq,
      from: "system",
      fromName: "",
      to: [],
      toNames: [],
      text,
      ts: Date.now(),
      kind: "system",
    };
    if (audience) message.audience = audience;
    if (wakes) message.wakes = true;
    if (details) message.details = details;
    if (bodyEdit) message.bodyEdit = bodyEdit;
    this.commit(message);
  }

  async setDir(dir: string): Promise<{ dir: string; restarted: string[] }> {
    const next = resolve(String(dir ?? "").trim());
    if (!dir.trim()) throw new Error("working directory is required");
    if (!existsSync(next) || !statSync(next).isDirectory()) throw new Error(`working directory does not exist: ${next}`);
    if (next === this.dir) return { dir: next, restarted: [] };
    const previous = this.dir;
    this.dir = next;
    const restarted: string[] = [];
    for (const id of [...this.runtimes.keys()]) {
      const p = this.participants.get(id);
      if (!p) continue;
      await this.retireRuntime(id);
      try {
        await this.reconnect(id, { mode: "replay", reason: "the room moved to another folder" });
        restarted.push(p.name);
      } catch (error) {
        this.notice(`${p.name} could not be restarted in the new folder: ${describeError(error)}`, "error");
      }
    }
    for (const p of this.participants.values()) {
      if (p.kind === "agent" && !this.runtimes.has(p.id)) p.sessionId = undefined;
    }
    this.push(this.roomEvent());
    this.postRoomEvent(`The room moved to ${next}${restarted.length ? `; ${restarted.join(", ")} restarted there` : ""}.`);
    this.log.info(`working directory: ${previous} -> ${next}`);
    return { dir: next, restarted };
  }

  startingWithHub = false;

  private roomEvent(): RoomEvent {
    return {
      type: "room",
      hopLimit: this.hopLimit,
      hops: this.hops,
      settings: this.settings,
      customRulesText: this.renderRuleReferences(this.settings.customRules),
      focused: this.focused,
      startingWithHub: this.startingWithHub,
      name: this.name,
      dir: this.dir,
    };
  }

  noteStartingWithHub(starting: boolean): void {
    if (this.startingWithHub === starting) return;
    this.startingWithHub = starting;
    this.push(this.roomEvent());
  }

  private notice(text: string, level: "info" | "warn" | "error"): void {
    if (level === "error") this.log.error(text);
    else if (level === "warn") this.log.warn(text);
    else this.log.info(text);
    this.push({ type: "notice", text, level, ts: Date.now() });
  }

  participantSnapshot(id: string): Participant {
    const participant = this.participants.get(id);
    if (!participant) throw new Error("no such vibemate");
    return this.participantView(participant);
  }

  private participantView(participant: Participant): Participant & { lastSeenSeq?: number } {
    const runtime = this.runtimes.get(participant.id);
    return { ...participant, lastSeenSeq: runtime?.lastSeenSeq ?? this.restoredSeen.get(participant.id),
      pendingSettings: runtime?.pendingConfig?.length ? runtime.pendingConfig.map(entry => ({ id: entry.configId, name: this.configName(participant, entry.configId), value: entry.value })) : undefined,
      activeTurnId: runtime?.turn && !runtime.turn.hidden ? runtime.turn.message.id : undefined,
      lastSignAt: runtime?.turn && !runtime.turn.hidden ? (runtime.turn.lastWorkAt ?? runtime.turn.startedAt) : undefined,
      quiet: this.quietTurn(participant.id) };
  }

  private quietTurn(id: string): QuietTurn | undefined {
    const runtime = this.runtimes.get(id);
    const turn = runtime?.turn;
    if (!runtime?.quiet || !turn || turn.hidden || runtime.quiet.turnId !== turn.message.id) return undefined;
    const stopping = runtime.retiring ? "forcing" : runtime.workCancelled ? "asked" : undefined;
    return {
      since: turn.lastSignAt ?? turn.startedAt,
      turnId: turn.message.id,
      processAlive: runtime.agent.alive,
      ...(runtime.quiet.nudge ? { nudge: runtime.quiet.nudge } : {}),
      ...(stopping ? { stopping } : {}),
    };
  }

  private readonly turnEnds = new Map<string, { at: number; streamSequence: number }>();
  private static readonly TURN_ENDS_KEPT = 100;

  endOfTurn(messageId: string): { at: number; streamSequence: number } | null {
    return this.turnEnds.get(messageId) ?? null;
  }

  private push(event: RoomEvent): void {
    const streamSequence = ++this.historyStreamSequence;
    if (event.type === "message" && event.message.streaming === false && event.message.from !== "human") {
      if (this.turnEnds.size >= Room.TURN_ENDS_KEPT) this.turnEnds.delete(this.turnEnds.keys().next().value as string);
      this.turnEnds.set(event.message.id, { at: Date.now(), streamSequence });
    }
    if (event.type === "participant") {
      this.emit("event", { ...event, streamSequence, history: this.historyStamp(), participant: this.participantView(event.participant) });
      return;
    }
    if (event.type === "message" || event.type === "messages.truncated" || event.type === "message.removed" || event.type === "record.replaced") {
      this.historyRevision++;
      this.emit("event", { ...event, streamSequence, history: this.historyStamp() });
      return;
    }
    if (event.type === "message.delivery") {
      this.emit("event", { ...event, streamSequence, history: this.historyStamp() });
      return;
    }
    this.emit("event", { ...event, streamSequence });
  }
}

export function routeAdapterStderr(line: string, to: { note(text: string): void; say(text: string): void; keep(text: string): void }): void {
  if (line.startsWith(ADAPTER_TRACE)) {
    const trace = line.slice(ADAPTER_TRACE.length);
    to.note(trace);
    to.say(`adapter: ${trace}`);
    return;
  }
  to.say(`stderr: ${line}`);
  to.keep(line);
}

function isAuthRequired(error: unknown): boolean {
  if (error instanceof RemoteError) return error.rpc.code === -32000 || /auth/i.test(error.rpc.message);
  return error instanceof Error && /auth/i.test(error.message);
}

function errorData(error: unknown): unknown {
  if (!(error instanceof Error)) return undefined;
  return (error as Error & { data?: unknown; rpc?: { data?: unknown } }).rpc?.data ?? (error as Error & { data?: unknown }).data;
}

function errorName(error: unknown): string {
  return errorCode(errorData(error));
}

function configShown(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "on" : "off") : String(value);
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const data = errorData(error);
  const detail = errorDetail(data);
  return detail && !error.message.includes(detail) ? `${error.message}: ${detail}` : error.message;
}

function unchangingCall(participant: Participant): { kind: "config"; id: string; value: string | boolean } | { kind: "mode"; id: string } | null {
  const option = (participant.configOptions ?? []).find((o) => o.currentValue !== undefined && o.currentValue !== null);
  if (option) return { kind: "config", id: option.id, value: option.currentValue };
  const mode = participant.mode;
  if (mode && (participant.modes ?? []).some((m) => m.id === mode)) return { kind: "mode", id: mode };
  return null;
}

function looksSilent(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.length <= SILENT_MARKER.length && SILENT_MARKER.startsWith(t);
}

export function applyToolCallUpdate(view: ToolCallView, u: ToolCallUpdate): boolean {
  const before = JSON.stringify(view);
  if (view.historySearch) {
    if (u.status === "failed" && view.status !== "failed") { view.status = "failed"; view.title += " · Response failed"; }
    return JSON.stringify(view) !== before;
  }
  if (view.messageCheck) {
    if (u.status === "failed") { view.status = "failed"; view.title = "Message check failed"; view.output = toolOutputText(u) || view.output; }
    return JSON.stringify(view) !== before;
  }
  if (u.title) view.title = u.title;
  if (u.name) view.name = u.name;
  if (u.kind !== undefined) view.kind = u.kind;
  if (u.status !== undefined) view.status = u.status;
  if (u.rawInput !== undefined) view.rawInput = u.rawInput;
  const touched = [...(u.locations ?? []).map((l) => l.path), ...(u.content ?? []).filter((c) => c.type === "diff").map((c) => (c as { path: string }).path)].filter((path) => typeof path === "string" && path);
  if (touched.length) view.locations = [...new Set([...(view.locations ?? []), ...touched])];
  const output = toolOutputText(u);
  if (output) view.output = output;
  return JSON.stringify(view) !== before;
}

function toolOutputText(u: ToolCallUpdate): string {
  const cap = (s: string): string => (s.length > 4000 ? `${s.slice(0, 4000)}\n… (${s.length - 4000} more characters)` : s);
  if (u.content && u.content.length) {
    const parts = u.content.map((c) => {
      if (c.type === "content") return contentText(c.content);
      if (c.type === "diff") return `--- ${c.path}\n${c.oldText ? `- ${c.oldText}\n` : ""}+ ${c.newText}`;
      return `[terminal ${c.terminalId}]`;
    });
    return cap(parts.join("\n"));
  }
  if (u.rawOutput !== undefined && u.rawOutput !== null) return cap(typeof u.rawOutput === "string" ? u.rawOutput : JSON.stringify(u.rawOutput, null, 1));
  return "";
}

function contentText(block: ContentBlock): string {
  if (block.type === "text") return block.text;
  return `[${block.type}]`;
}

function flattenOptions(options: SessionConfigOption["options"]): SessionConfigSelectOption[] {
  if (!options) return [];
  const out: SessionConfigSelectOption[] = [];
  for (const entry of options) {
    if ("options" in entry) out.push(...(entry as SessionConfigSelectGroup).options);
    else out.push(entry as SessionConfigSelectOption);
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSkillList(list: string[] | undefined | null): string[] | undefined {
  if (!list) return undefined;
  const out: string[] = [];
  for (const raw of list) {
    const name = String(raw).trim();
    if (!SKILL_NAME_PATTERN.test(name)) continue;
    if (!out.some((s) => s.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.length ? out : undefined;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
