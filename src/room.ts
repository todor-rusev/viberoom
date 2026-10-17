// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { AutomationJob, AutomationRun } from "./automation-store.js";
import type { AutomationOutcome } from "./automations.js";
import { EventEmitter } from "node:events";
import { isIdentity } from "./identity.js";
import { randomUUID } from "node:crypto";
import { AgentMessageError, agentMessageId, agentMessageHash, parsePostMessage, type PostMessageReceipt } from "./agent-message.js";
import { captureNativeNoteSubject, nativeNoteDisposition, planNativeNoteEffect, type NativeNoteDisposition } from "./native-note-state.js";
import { isNativeOperation, nativeDivertOp, nativeInteger, nativeObligationId, parseNativeOperation, type NativeDecision, type NativeEnvelope, type NativeNoteEffect, type NativeObligation, type NativeRecord, type NativeSubject } from "./native-reports.js";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { NameDirectory } from "./name-directory.js";
import { citedNumbers, numbersNote, type CitedNumber } from "./message-numbers.js";
import { HistoryStore, type DivertOp, type PendingOp, cursorOf, type Cursor } from "./history-store.js";
import { foldIndex } from "./fold.js";
import { NOTES_ONLY_PROMPT, crossedThreshold, emptyUsageReport, extractNotes, looksCompacted, overThreshold, settledVisible } from "./context.js";
import { spokenText } from "./spoken-text.js";
import { MENTION_PATTERN } from "./mentions.js";
import { RoomSettingsModel, RULE_REF_TOKEN, type ProgramRoomSettings } from "./room/settings.js";
import { PermissionDesk, roomToolNeedsNoQuestion, type PendingPermission } from "./room/permissions.js";
import { RoomProposals, type NewRoomProposal, type ProposalPlan, type RoomProposal } from "./room/proposals.js";
import { RoomDesignTools, type DesignTarget } from "./room/design.js";
import { RoomMessages, type MessageDraft, type SeqTicket } from "./room/messages.js";
import * as presence from "./room/presence.js";
import { TurnLife, type Turn } from "./room/turn-life.js";
import { DiagramRepairs } from "./room/diagram-repairs.js";
import { BackgroundCompletions, type QueuedBackgroundCompletion } from "./room/background-completions.js";
import { AutomationTasks } from "./room/automation-tasks.js";
import { SilenceWatch, stillQuiet, type SeenQuietTurn } from "./room/silence-watch.js";
import { AgentConfig, configName, summarizeConfig, type ConfigShortfall } from "./room/agent-config.js";
import { stillHeld, type SeenVibemate } from "./room/vibemate-seen.js";
import { decideWake, woken } from "./room/wake-policy.js";
import { TurnOrder } from "./room/turn-order.js";
import { DraftStream, applyToolCallUpdate, looksSilent, toolOutputText, type DraftOwner, type DraftTurn } from "./room/draft-stream.js";
export { applyToolCallUpdate };
import { NativeReports, type FaultOwner, type NativeHop, type NativeRouteObligation, type UnconfirmedPost } from "./room/native-reports.js";
import { openSession } from "./room/session-open.js";
import { probeAgentOptions } from "./room/agent-options.js";
import { AgentNotes } from "./room/agent-notes.js";
import { AgentSessions } from "./room/agent-sessions.js";
import { failStart, loadedPointer, readyLine, replayPointer } from "./room/agent-start.js";
import { prepareOrdinaryTurn, preparationFields, type TurnPreparationPorts } from "./room/turn-preparation.js";
import { dispatchTurn, type DispatchOwner, type TurnDispatchPorts } from "./room/turn-dispatch.js";
import { TurnPublication, type PublicationOwner, type SettledOwner } from "./room/turn-publication.js";
import { createAgentRuntime, type AgentRuntime, type RuntimeBrief, type RuntimeNotes, type RuntimeQueue, type RuntimeReading, type RuntimeSession, type RuntimeSkills, type RuntimeWork, type WorkHold, holdsWork } from "./room/agent-runtime.js";
import { pinTitle, withPin, withPinLabel } from "./room/pins.js";
import { planNewRoom, type NewRoomPlan } from "./new-room.js";
import { formatDuration } from "./duration.js";
import { affectedByEdit, editNotice, EDIT_NOTICE_MAX, partitionHistory, rewriteNotice, type AgentReadState, type EditMode } from "./edit.js";
import { bodyRefs, nextBodyVersion, registerBodyReader, suppliedBodies, withBodyReader, type BodyDelivery, type BodyEdit, type BodyRef } from "./body-delivery.js";
import { isRoomResourceName, saveAudio, saveImages, saveVideo, type Attachment, type AudioAttachment, type HeardSound, type ImageInput, type VideoAttachment, type VideoInput } from "./files.js";
import { agentReadableWindow, resolveQuotes, visibleToAgents, type Quote, type QuoteInput } from "./quotes.js";
import { isDirectMessageCheck, messageAddressing, messageCheckCursor, messageCheckHeader, messageCheckPageCursor, messageCheckPagePosition, messageCheckPosition, messageCheckTitle, packMessageCheck, packLiveDraft, parseMessageCheckArgs, type MessageCheckArgs, type MessageCheckCounts, type MessageCheckResult } from "./message-check.js";
import { historySearchReceipt, historySearchTitle, parseAgentSearchArgs, type AgentSearchArgs, type AgentSearchResult, type HistorySearchReceipt } from "./agent-history.js";
import { isWrappedRoomCall, roomOperation, roomToolTitle, cursorPermissionInput } from "./room-tool-identity.js";
import { basename, dirname, join, resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { AGENT_MESSAGE_MAX_BYTES, PromptBudget, type AgentView, type PictureTag } from "./agent-images.js";
import { AcpAgent } from "./acp-client.js";
import { ExtensionRouter, type AgentAuthStatus, type BackgroundMessage } from "./acp-extensions.js";
import { describeError, errorCode, errorData } from "./jsonrpc.js";
import { getRecipe, listRecipes, publicRecipes, type AgentRecipe } from "./recipes.js";
import { recipeStamp } from "./install-stamp.js";
import { OptionCatalog } from "./option-catalog.js";
import { assertAgentAvailable } from "./agent-maintenance.js";
import type { Trouble } from "./agent-health.js";
import { legacyRowTone } from "./rows.js";
import { DIAGRAM_REPAIR_WINDOW_MS, boundedError, diagramSourceProblem, fenceFor, giveUp, mermaidBlocks, recordFailure, recordFix, replaceDiagramSource, type DiagramRepair } from "./diagram-repair.js";
import { cleanFace, freshFace } from "./faces.js";
import { composeSkillBlock, formatQuoteTime, skillPull, SKILL_TOOL_NAME, type NotesSource, type SkillsForPrompt } from "./persona.js";
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
import type { BriefSearch } from "./memory/service.js";
import { runAsNodeEntries } from "./own-runtime.js";
import { templateRoomSettings, type TemplateLibrary, type TemplateVibemate } from "./templates.js";
import type { LookCheck, LookSpec } from "./looks.js";
import type { AppearanceSettings } from "./hub.js";
import type { RoomChangeSet, RoomDesign, RoomDesignContext } from "./room-design.js";
import {
  REQUEST_BRIEF_MARKER,
  NAME_PATTERN,
  SILENT_MARKER,
  buildStandingText,
  buildInstructionPreview,
  buildHeader,
  composeCorrectionPrompt,
  countSentences,
  ensureDir,
  type BacklogAudio,
  type BacklogVideo,
  type Persona,
  type PromptPart,
  type RoomSettings,
  type RosterEntry,
} from "./persona.js";
import { Logger, Transcript, type TranscriptMode } from "./log.js";
import { WINDOW_RECENT_BODIES } from "./window-wire.js";
import type {
  ContentBlock,
  NewSessionResult,
  PlanEntry,
  PromptResult,
  RequestPermissionParams,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionUpdate,
  StopReason,
  Usage,
} from "./acp-types.js";

export type ParticipantStatus = "unstaffed" | "starting" | "idle" | "queued" | "thinking" | "error" | "offline" | "left";

export interface LaunchPrefs {
  model: string | null;
  effort: string | null;
  mode: string | null;
}

interface StartTicket {
  readonly id: string;
  readonly participant: Participant;
  readonly name: string;
  readonly recipe: AgentRecipe;
  readonly launch: LaunchPrefs;
  readonly fresh: boolean;
  readonly reconnectOptions?: ReconnectOptions;
  readonly log: Logger;
  readonly cwd: string;
  readonly transcript: Transcript;
  readonly installStamp: string | null;
  readonly stderrTail: string[];
  readonly agent: AcpAgent;
  readonly abandoned: Error;
  registered: AgentRuntime | undefined;
  stillWanted(): boolean;
  check(): void;
}

interface StartUnderWay {
  readonly ticket: StartTicket;
  readonly settled: Promise<void>;
}

interface OpenedSession {
  readonly session: NewSessionResult;
  readonly origin: NonNullable<Participant["sessionOrigin"]>;
  readonly mcpToken: string | null;
  readonly hasMcp: boolean;
}

interface RegisteredSession {
  readonly runtime: AgentRuntime;
  readonly storedSeen: number | undefined;
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
  readonly status: ParticipantStatus;
  readonly statusDetail?: string;
  readonly trouble?: Trouble;
  model?: string;
  effort?: string;
  mode?: string;
  configOptions?: SessionConfigOption[];
  installOutdated?: boolean;
  authStatus?: AgentAuthStatus;
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
  readonly asleep?: boolean;
  readonly fell?: true;
  readonly startupSkipped?: "muted";
  createdByVibemate?: boolean;
  replyDelay?: number;
  skills?: string[];
  skillChannel?: "tool" | "marker" | "pending";
  launch?: LaunchPrefs;
  earlierLaunches?: Record<string, LaunchPrefs>;
  violations?: number;
  notes?: string;
  notesAt?: number;
  notesSeq?: number;
  notesWrittenAt?: number;
  notesRevision?: number;
  nativeNoteReceipt?: string;
  formerNames?: string[];
  notesTurn?: boolean;
  contextEvent?: { kind: "threshold" | "compacted" | "full"; at: number; used?: number; size?: number };
  autoRespawnAt?: number;
  briefsSent?: number;
  failedTurns?: number;
  retries?: number;
  sessionId?: string;
  sessionDir?: string;
  folderPending?: boolean;
  supportsLoad?: boolean;
  sessionOrigin?: "new" | "loaded" | "replayed";
  deliveryEpoch?: string;
  suppliedThrough?: number;
  activeTurnId?: string;
  activeTurnInputThrough?: number;
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
  earlierLaunches?: Record<string, LaunchPrefs>;
  muted: boolean;
  asleep?: boolean;
  createdByVibemate?: boolean;
  replyDelay?: number;
  skills?: string[];
  sessionId?: string;
  sessionDir?: string;
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
  notesWrittenAt?: number;
  notesRevision?: number;
  nativeNoteReceipt?: string;
}

export interface ReconnectOptions {
  mode: "load" | "replay";
  replay?: number;
  reason?: string;
  notes?: boolean;
  wake?: boolean;
}

export function resumeNotesSource(loaded: boolean, options: ReconnectOptions | undefined, replayed: boolean): Exclude<NotesSource, "live"> | null {
  if (loaded) return "load";
  if (options?.notes === false) return null;
  return replayed ? "replay" : "fresh";
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

export function readJournal(text: string, nativeSafety = false): { ops: DivertOp[]; unreadable: number; blocked?: boolean } {
  const ops: DivertOp[] = [];
  let unreadable = 0;
  for (const line of text.split(String.fromCharCode(10))) {
    if (!line.trim()) continue;
    try {
      const raw: unknown = JSON.parse(line);
      const native = parseNativeOperation(raw);
      if (native) ops.push(nativeDivertOp(native));
      else {
        if (nativeSafety && (!raw || typeof raw !== "object" || !["upsert", "truncate", "bury", "rewrite"].includes(String((raw as { kind?: unknown }).kind))))
          return { ops, unreadable, blocked: true };
        ops.push(raw as DivertOp);
      }
    } catch {
      unreadable++;
      if (nativeSafety || /"kind"\s*:\s*"native_/.test(line)) return { ops, unreadable, blocked: true };
    }
  }
  return { ops, unreadable };
}
export class RoomRefusal extends Error {
  constructor(message: string, readonly transient = false) {
    super(message);
  }
}

export interface Renamed { id: string; from: string; to: string }

export type WindowMessage = ChatMessage & { numbersHere?: { copy: string; here: Record<string, number | null> } };

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
  details?: { original?: string; corrections?: string[]; outcome?: string; skill?: string; via?: "tool" | "marker"; refId?: string; agentId?: string; tone?: "attention" | "error" | "hush"; about?: "room"; renamed?: Renamed; reportHash?: string };
  skill?: { name: string; args: string };
  edited?: { ts: number; previous: string };
  bodyDelivery?: BodyDelivery;
  bodyEdit?: BodyEdit;
  via?: MessageVia;
  pinned?: true;
  pinLabel?: string;
  diagramRepairs?: readonly DiagramRepair[];
  images?: Attachment[];
  audio?: AudioAttachment[];
  answerFrom?: number;
  video?: VideoAttachment[];
  quotes?: Quote[];
  audience?: "agents" | "human";
  wakes?: true;
  streaming?: boolean;
  thought?: string;
  origin?: string;
  numbering?: string;
  branch?: { source: string; revision: string };
  variantOf?: { id: string; revision: string };
  resourceRefs?: { source: string; file: string; sha256?: string }[];
  notices?: string[];
  toolCalls?: ToolCallView[];
  plan?: PlanEntry[];
  stopReason?: StopReason;
  stoppedBy?: string;
  cancelledBy?: "human" | "agent" | "room";
  failed?: string;
  usage?: Usage | null;
  durationMs?: number;
}

export type { PendingPermission } from "./room/permissions.js";

export type { NewRoomProposal, RoomProposal } from "./room/proposals.js";

export interface RoomRecovery {
  rows: number;
  lastTs: number | null;
  ts: number;
  afterSeq?: number;
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
  rooms?: {
    list: (callerId: string) => { id: string; name: string }[];
    find: (callerId: string, selector: string) => Room;
    get: (id: string) => Room | undefined;
    sharesWith: (readerId: string, targetId: string) => boolean;
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
  scale?: number;
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

export interface PendingSkill {
  name: string;
  text: string;
  invokedBy?: string;
  extraFiles: string[];
}

const SKILL_TOOL_READY_MS = 5000;

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
  installStamp: string | null;
}

export interface RoomOptions {
  id: string;
  uuid: string;
  folderId?: string;
  scope?: unknown;
  name: string;
  dir: string;
  dataDir: string;
  createdAt: number;
  humanName: string;
  programHumanDescription: string;
  bypassPermissionsByDefault: boolean;
  hubRun?: () => { id: string; build: string } | null;
  memoryGraph?: (roomId: string, addressed: readonly number[], shown: readonly number[]) => { revision: string; block: string; search?: BriefSearch } | null;
  memoryGraphReady?: (roomId: string, addressed: readonly number[]) => Promise<void>;
  memoryWhy?: (roomId: string, addressed: readonly number[]) => string;
  connections?: (roomUuid: string) => string[];
  pictures?: { prepare(path: string, mimeType: string, tag: PictureTag): Promise<AgentView>; forAgent(path: string, mimeType: string, tag: PictureTag): Promise<AgentView> };
  programTranscripts?: TranscriptMode;
  programFoldAfter?: number;
  recordPrompts?: boolean;
  settings?: Partial<Omit<RoomSettings, "name" | "humanName">>;
  log: Logger;
  optionCatalog?: OptionCatalog;
  skills?: SkillsBridge;
  history: HistoryStore;
  onHistoryFailure?: (roomId: string, error: unknown) => void;
  commitNativeNoteDecision?: (room: Room, participantId: string, effect: NativeNoteEffect, writeRecord: () => void) => NativeNoteDisposition;
  onNativePending?: (roomId: string) => void;
  heldParticipantIds?: () => Iterable<string>;
}


export interface RetryRequest {
  prompt: string;
  original: string;
  corrections: string[];
  recordId: string;
  nativeObligation?: NativeObligationRef;
}

export interface NativeObligationRef { subject: NativeSubject; obligationId: string }

export interface OrdinaryWakeClaim { independent: boolean; native: NativeObligationRef[] }
export type PreparationFields = Pick<RuntimeQueue, "missedNotice"> & Pick<RuntimeWork, "promptedThisWork">
  & Pick<RuntimeReading, "turnStartSeq" | "lastSeenSeq" | "replayOwnUntilSeq"> & Pick<RuntimeNotes, "notesDue" | "notesAskedThisTurn" | "resumeNotes">
  & Pick<RuntimeBrief, "instructionRevisions" | "skillCatalogPending" | "memoryStamp" | "memoryGraphStamp" | "briefPending" | "turnsSinceBrief" | "briefSentThisTurn" | "lastBriefSeq">
  & Pick<RuntimeSession, "firstTurnDone">;

function compareAndSet<T, K extends keyof T>(group: T, field: K, expected: T[K], next: T[K]): void {
  if (group[field] === expected) group[field] = next;
}

export interface OrdinaryPromptPreparation {
  wake: OrdinaryWakeClaim;
  expected: PreparationFields;
  next: PreparationFields;
  headerArray: string[];
  headers: string[];
  skillArray: RuntimeSkills["pendingSkills"];
  skills: RuntimeSkills["pendingSkills"];
  nativeHeaders: NativeObligationRef[];
  bodies: ChatMessage[];
  sourceRevision: number;
  sourceRows: { row: ChatMessage; stamp: string }[];
  brief: boolean;
  repairs: { messageId: string; block: number; delivered: boolean }[];
  completion?: QueuedBackgroundCompletion;
}

export interface BackgroundCompletion {
  key: string; taskId: string; description: string; status: string; result: string;
  claim(messageId: string): boolean;
  finish(confirmed: boolean, messageId: string): void;
}

export type PromptMemoryNote = BriefSearch & { sent: boolean };

export interface TurnExtras {
  hidden?: boolean;
  historyNoticeOffered?: boolean;
  supplied?: BodyRef[];
  memorySearch?: PromptMemoryNote;
  nativeHeaderOffered?: boolean;
  ordinaryPreparation?: OrdinaryPromptPreparation;
}

const ADAPTER_TRACE = "viberoom-trace ";
const STOP_GRACE_MS = 30_000;
const SHUTDOWN_TURN_STOP_MS = 2_000;
const SHUTDOWN_SETTLE_MS = 1_000;
export const ROOM_SHUTDOWN_WAIT_MS = SHUTDOWN_TURN_STOP_MS + SHUTDOWN_SETTLE_MS;
const WORK_SIGNS = new Set(["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan"]);
const NUDGE_WAIT_MS = 10_000;

const COLORS = ["#6d5dfc", "#16a34a", "#d97706", "#dc2626", "#0891b2", "#be185d", "#4d7c0f", "#7c3aed"];
export const CAST_SIZE = 8;
export { PIN_LABEL_MAX } from "./room/pins.js";
export { spokenText };

export function sessionMeta(recipe: Pick<AgentRecipe, "systemPromptAppend"> | undefined, settings: RoomSettings, withTools: boolean): Record<string, unknown> | undefined {
  return recipe?.systemPromptAppend ? { systemPrompt: { append: buildStandingText(settings, withTools) } } : undefined;
}

export { tokensCarried } from "./room/turn-publication.js";

export class Room extends EventEmitter {
  readonly id: string;
  readonly uuid: string;
  readonly folderId: string | null;
  readonly scope: string | null;
  readonly unreadableScope: unknown;
  name: string;
  dir: string;
  readonly dataDir: string;
  private readonly hubRun: () => { id: string; build: string } | null;
  private readonly memoryGraph: (roomId: string, addressed: readonly number[], shown: readonly number[]) => { revision: string; block: string; search?: BriefSearch } | null;
  private readonly memoryGraphReady: (roomId: string, addressed: readonly number[]) => Promise<void>;
  private readonly memoryWhy: (roomId: string, addressed: readonly number[]) => string;
  private readonly pictures: RoomOptions["pictures"];
  private readonly connections: (roomUuid: string) => string[];
  readonly createdAt: number;
  get hops(): number { return this.turnOrder.hops; }
  set hops(value: number) { this.turnOrder.hops = value; }
  get focused(): boolean { return this.turnOrder.focused; }
  set focused(value: boolean) { this.turnOrder.focused = value; }
  readonly participants = new Map<string, Participant>();
  private readonly roomMessages = new RoomMessages();
  get messages(): readonly ChatMessage[] {
    return this.roomMessages.list;
  }
  private get seq(): number {
    return this.roomMessages.seq;
  }
  private get displayOrder(): number {
    return this.roomMessages.displayOrder;
  }
  private readonly roomSettings: RoomSettingsModel;
  get settings(): Readonly<RoomSettings> {
    return this.roomSettings.value;
  }
  private readonly historyEpoch = randomUUID();
  private historyRevision = 0;
  private readonly messageCheckKey = randomUUID();
  private messageCheckRevision = 0;
  private historyStreamSequence = 0;
  private readonly skills?: SkillsBridge;
  private readonly earlySkillReady = new Set<string>();
  private readonly turnOrder: TurnOrder = new TurnOrder({
    current: (id) => ({ participant: this.participants.get(id), runtime: this.runtimes.get(id) }),
    sessions: () => [...this.runtimes.keys()],
    settings: () => this.settings,
    recordHold: () => !!this.recordHold,
    nativeLaneBlocked: (runtime) => this.nativeLaneBlocked(runtime),
    showQueued: (participant) => { if (presence.queue(participant)) this.push({ type: "participant", participant }); },
    showUnqueued: (participant) => { if (presence.unqueue(participant)) this.push({ type: "participant", participant }); },
    recover: (participant) => this.clearTrouble(participant, "you wrote to it directly"),
    run: (owner) => { if (this.participants.get(owner.id) === owner.participant && this.runtimes.get(owner.id) === owner.runtime) void this.runTurn(owner.id); },
    log: (runtime, text) => runtime.session.log.info(text),
  });
  private readonly draftStream: DraftStream = new DraftStream({
    current: (id) => ({ participant: this.participants.get(id), runtime: this.runtimes.get(id), open: !this.closing }),
    push: (owner, event) => {
      if (!this.draftHeld(owner)) return false;
      this.push(event);
      return true;
    },
    placeDraft: (owner) => {
      if (!this.draftHeld(owner)) return false;
      this.roomMessages.placeDraft(owner.turn.message);
      this.push({ type: "message", message: owner.turn.message });
      return true;
    },
  });
  private draftHeld(owner: DraftOwner): boolean {
    const id = owner.participant.id;
    return !this.closing && this.participants.get(id) === owner.participant && this.runtimes.get(id) === owner.runtime
      && (owner.runtime.work.turn ?? null) === owner.turn;
  }
  private get speaking(): string | null { return this.turnOrder.speaking; }
  private get floorQueue(): readonly string[] { return this.turnOrder.queued(); }
  private closing = false;
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly nativeReports: NativeReports = new NativeReports({
    identity: () => ({ roomId: this.id, roomUuid: this.uuid, folderId: this.folderId }),
    current: (id) => ({ participant: this.participants.get(id), runtime: this.runtimes.get(id) }),
    sessions: () => [...this.runtimes.keys()],
    state: () => ({ closing: this.closing, readOnly: this.readOnly, recordHold: !!this.recordHold }),
    liveSession: (id, agent, sessionId) => this.liveAgentSession(id, agent, sessionId),
    journal: { pending: () => this.divertPending, drain: () => this.drainDivert(), ops: () => this.journalOps(), append: (op, error) => this.divert(op, error) },
    decide: (envelope, owner) => {
      const decision = this.prepareNativeDecision(envelope, owner.participant, owner.runtime);
      return { decision, message: this.nativeMessage(envelope, decision, owner.participant) };
    },
    publish: (record) => this.publishNativeRecord(record),
    counted: (owner, decision) => {
      if (!this.operationHolds(owner)) return false;
      const { participant } = owner;
      if (decision.corrections.length) participant.violations = (participant.violations ?? 0) + decision.corrections.length;
      if (decision.kind === "referee_hidden") participant.retries = (participant.retries ?? 0) + 1;
      if (decision.corrections.length) this.push({ type: "participant", participant });
      return true;
    },
    notesApplied: (owner, effect) => {
      if (!this.operationHolds(owner)) return false;
      const { participant, runtime } = owner, disposition = nativeNoteDisposition(captureNativeNoteSubject(participant), effect);
      if (disposition === "apply") {
        Object.assign(participant, { notes: effect.next.notes ?? undefined, notesAt: effect.next.notesAt ?? undefined,
          notesSeq: effect.next.notesSeq ?? undefined, notesWrittenAt: effect.next.notesWrittenAt ?? undefined,
          notesRevision: effect.next.notesRevision, nativeNoteReceipt: effect.next.nativeNoteReceipt ?? undefined });
        runtime.notes.notesDue = false; runtime.notes.notesMisses = 0; runtime.notes.notesPending = false;
        this.push({ type: "participant", participant });
      }
      return disposition;
    },
    header: (owner, lines, ref) => {
      if (!this.operationHolds(owner)) return false;
      owner.runtime.brief.headerNotes.push(...lines);
      (owner.runtime.native.nativeHeaderObligations ??= []).push(ref);
      return true;
    },
    correction: (owner, obligation, ref) => {
      if (!this.operationHolds(owner)) return false;
      const message = this.messages.find(m => m.id === ref.subject.id);
      if (!message) return "unknown";
      const { participant, runtime } = owner;
      const header = buildHeader(this.roomSettings.effective(), this.personaOf(participant), this.roster(), this.hops, ["your last reply was not posted; see the correction below"]);
      this.queueBackgroundCorrection(participant.id, runtime, { prompt: composeCorrectionPrompt({ header, originalText: obligation.original,
        corrections: obligation.corrections, personaName: participant.name }), original: obligation.original,
        corrections: obligation.corrections, recordId: message.id, nativeObligation: ref });
      return true;
    },
    route: (obligation, ref, addressed, hop) => this.routeNativeObligation(obligation, ref, addressed, hop),
    commitNote: (owner, effect, writeRecord) => {
      if (!this.operationHolds(owner)) return "owner_changed";
      return this.commitNativeNoteDecision?.(this, owner.participant.id, effect, writeRecord);
    },
    drained: (owner) => {
      if (!this.operationHolds(owner)) return;
      const { participant, runtime } = owner;
      if (this.agentNotes.resumeDeferred(participant.id, runtime)) return;
      if (runtime.native.backgroundCorrections?.length && !participant.muted && !this.focused) this.requestTurn(participant.id, false, false, true);
      else if (runtime.queue.pendingTurn) this.requestTurn(participant.id, false, false, false, "resume");
    },
    fault: (owner, reason, say) => {
      if (this.closing || this.participants.get(owner.id) !== owner.participant || this.runtimes.get(owner.id) !== owner.runtime) return false;
      if (owner.runtime) owner.runtime.native.nativeHold = true;
      if (!say) return true;
      this.log.warn(`native report for ${owner.id}: ${reason}; publication is held`);
      this.notice(`An autonomous report for ${owner.participant.name} is held (${reason}). No new reply was published.`, "error");
      return true;
    },
    pending: () => this.onNativePending?.(this.id),
    routePost: (messageId) => {
      const message = this.messages.find(message => message.id === messageId);
      if (message?.kind === "chat" && !message.audience && !message.failed) this.route(message);
    },
    correctPost: (post) => {
      if (!post.retry || !this.operationHolds(post)) return false;
      this.queueBackgroundCorrection(post.participant.id, post.runtime, post.retry);
      return true;
    },
    log: (level, text) => this.log[level](text),
  }, () => this.history);
  private get unconfirmedBackground(): Map<string, UnconfirmedPost> { return this.nativeReports.unconfirmed; }
  private get retainedNativeArrivals(): NativeReports["arrivals"] { return this.nativeReports.arrivals; }
  private get nativeRecoveryHold(): boolean { return this.nativeReports.recoveryHold; }
  private set nativeRecoveryHold(value: boolean) { this.nativeReports.recoveryHold = value; }
  private readonly completions = new BackgroundCompletions({
    accepts: (id) => {
      const participant = this.participants.get(id);
      return !!participant && participant.kind === "agent" && participant.status !== "left" && !this.closing && !this.readOnly;
    },
    wake: (id) => this.requestBackgroundCompletion(id),
    recorded: (messageId) => this.history.hasMessageId(this.id, messageId),
    recordNotice: (id, completion) => {
      const pending = this.messages.find(message => message.id === completion.messageId);
      if (pending) return this.persist({ kind: "upsert", message: pending });
      return this.commit({ id: completion.messageId, from: "system", fromName: "",
        to: [id], toNames: [this.participants.get(id)!.name], text: `Background task finished · ${completion.description}`,
        ts: Date.now(), kind: "system", audience: "human", details: { agentId: id } }).stored;
    },
    closing: () => this.closing,
  });
  private readonly automations = new AutomationTasks({
    runtimeOf: (id) => this.runtimes.get(id),
    requestTurn: (id) => this.requestTurn(id, true),
    cancelTurn: (id) => { this.cancelTurn(id); },
    closing: () => this.closing,
    humanName: () => this.humanName,
  });
  private readonly diagramRepairs = new DiagramRepairs({
    assertRecordOpen: () => this.assertRecordOpen(),
    assertRecordOpenForAgents: () => this.assertRecordOpenForAgents(),
    agentInRoom: (id) => { this.agentInRoom(id); },
    messages: () => this.messages,
    messageById: (id) => this.roomMessages.byId(id),
    revise: (next, store) => { this.reviseRecorded(next, store); },
    authorCanRepair: (authorId, answeredAt) => this.canRepairDiagram(authorId, answeredAt),
    requestTurn: (id) => this.requestTurn(id, true),
    fixedThisTurn: (id) => {
      const runtime = this.runtimes.get(id);
      if (runtime?.work.turnActive) runtime.work.fixedDiagramThisTurn = true;
    },
    recordHold: () => !!this.recordHold,
    humanName: () => this.humanName,
  });
  private readonly turnLife = this.turnBoundWork();
  private readonly drafts = new Map<string, ChatMessage>();
  private readonly quotesAwaitingNumber = new Map<string, Set<string>>();
  private readonly permissions = new PermissionDesk({
    seq: () => this.seq,
    nameOf: (id) => this.participants.get(id)?.name ?? id,
    emit: (event) => this.push(event),
    notice: (text) => this.notice(text, "info"),
    answered: (id) => { const turn = this.runtimes.get(id)?.work.turn; if (turn) turn.lastSignAt = Date.now(); },
    log: (text) => this.log.info(text),
  });
  private readonly design = new RoomDesignTools({
    id: () => this.id,
    dir: () => this.dir,
    settings: () => this.settings,
    rulesText: () => this.roomSettings.rulesText(),
    skills: () => this.skills,
    agent: (participantId) => this.agentInRoom(participantId),
    shape: () => this.templateOf(),
    findByName: (name) => this.findByName(name),
    otherRoom: (selector): DesignTarget | null => {
      const wanted = String(selector ?? "").trim();
      if (!wanted) return null;
      if (!this.skills?.rooms) throw new Error("the other rooms are not available here");
      const room = this.skills.rooms.find(this.id, wanted);
      return room === this ? null : room;
    },
    brief: (participant) => buildInstructionPreview(this.roomSettings.effective(), this.personaOf(participant), this.roster(), this.skillsForPrompt(participant, this.runtimes.get(participant.id)!)),
    skillsForDesign: (participantId) => this.skillsForDesign(participantId),
    cards: () => this.proposalCards,
    postSystem: (text) => this.postSystem(text),
    log: (text) => this.log.info(text),
  });
  private readonly proposalCards = new RoomProposals({
    store: { list: () => this.history.cards.list(this.id), save: (kind, key, ts, body) => this.history.cards.save(this.id, kind, key, ts, body) },
    emit: (event) => this.push(event),
    roomLine: (text, forHuman) => (forHuman ? this.postRoomEvent(text, "human", false, { tone: "attention" }) : this.postRoomEvent(text)),
    seq: () => this.seq,
    humanName: () => this.settings.humanName,
    log: (text) => this.log.info(text),
    warn: (text) => this.log.warn(text),
  });
  private readonly optionCatalog: OptionCatalog;
  private readonly log: Logger;
  private colorIndex = 0;
  private nextColour(given?: string): { color: string; colorSlot: number } {
    const slot = this.colorIndex++ % CAST_SIZE;
    return { color: given ?? COLORS[slot % COLORS.length], colorSlot: slot };
  }
  private freshAvatar(): string {
    return freshFace("vibemate", [...this.participants.values()].map((p) => p.avatar));
  }
  private readonly departed = new Map<string, string>();
  private readonly restoredSeen = new Map<string, number>();

  constructor(options: RoomOptions) {
    super();
    this.id = options.id;
    this.uuid = options.uuid;
    this.folderId = options.folderId ?? null;
    this.scope = isIdentity(options.scope) ? options.scope : null;
    this.unreadableScope = options.scope === undefined || isIdentity(options.scope) ? undefined : options.scope;
    this.name = options.name;
    this.dir = options.dir;
    this.dataDir = options.dataDir;
    this.createdAt = options.createdAt;
    this.hubRun = options.hubRun ?? (() => null);
    this.memoryGraph = options.memoryGraph ?? (() => null);
    this.pictures = options.pictures;
    this.memoryGraphReady = options.memoryGraphReady ?? (async () => {});
    this.memoryWhy = options.memoryWhy ?? (() => "none");
    this.connections = options.connections ?? (() => []);
    this.skills = options.skills;
    this.history = options.history;
    this.onHistoryFailure = options.onHistoryFailure;
    this.commitNativeNoteDecision = options.commitNativeNoteDecision;
    this.onNativePending = options.onNativePending;
    this.heldParticipantIds = options.heldParticipantIds;
    this.roomSettings = new RoomSettingsModel({
      findByName: (name) => this.findByName(name),
      nameOf: (id) => this.participants.get(id)?.name,
      departedName: (id) => this.departed.get(id),
    }, {
      name: options.name, humanName: options.humanName, settings: options.settings,
      programHumanDescription: options.programHumanDescription, bypassPermissionsByDefault: options.bypassPermissionsByDefault,
      programTranscripts: options.programTranscripts, programFoldAfter: options.programFoldAfter, recordPrompts: options.recordPrompts,
    });
    this.log = options.log;
    this.optionCatalog = options.optionCatalog ?? new OptionCatalog();
    mkdirSync(this.dataDir, { recursive: true });
    this.participants.set("human", {
      id: "human",
      name: options.humanName,
      kind: "human",
      ...presence.humanPresence(),
      turns: 0,
      color: "#111827",
    });
    this.loadHistory();
    if (this.hasPendingNativeDelivery()) this.onNativePending?.(this.id);
    for (const text of this.loadNotices) this.postSystem(text, "human");
  }


  private historyPath(): string {
    return join(this.dataDir, "history.jsonl");
  }

  filesDir(): string {
    return join(this.dataDir, "files");
  }

  attachmentPath(attachment: Attachment): string {
    return join(this.filesDir(), attachment.file);
  }

  private readonly history: HistoryStore;
  private readonly onHistoryFailure?: (roomId: string, error: unknown) => void;
  private readonly commitNativeNoteDecision?: RoomOptions["commitNativeNoteDecision"];
  private readonly onNativePending?: (roomId: string) => void;
  private readonly heldParticipantIds?: () => Iterable<string>;
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
      this.recovery = { rows: chat.length, lastTs: last, ts: Date.now(), afterSeq: this.seq, status: "pending" };
      this.recordHold = `No history file was found for this room, only the room's own copy of the conversation (${chat.length} message${chat.length === 1 ? "" : "s"}${last ? `, the last from ${new Date(last).toLocaleString()}` : ""}). The copy may lack the newest changes, so until you decide on the card the room is read-only: what the copy holds is shown, nothing new is written and no vibemate answers. To use the original instead, put history.jsonl back in the room's folder and restart.`;
      this.loadNotices.push(this.recordHold);
    }
    if (this.divertPending) {
      const journal = this.journalOps();
      if (journal.blocked) {
        this.loadNotices.push("The native pending-changes journal is held unreadable or unsupported; its original bytes are retained.");
      } else if (journal.unreadable) {
        this.loadNotices.push(`${journal.unreadable} line(s) of this room's pending-changes journal could not be read and were skipped; everything else in it is here.`);
        this.log.warn(`divert.jsonl: ${journal.unreadable} unreadable line(s) skipped`);
      }
      for (const op of journal.ops) {
        if (this.opApplied(op)) continue;
        this.roomMessages.applyJournal(op);
      }
    }
    this.proposalCards.load();
  }

  private journalOps(): { ops: DivertOp[]; unreadable: number; blocked?: boolean } {
    const path = this.divertPath();
    if (!existsSync(path)) return { ops: [], unreadable: 0 };
    try { return readJournal(readFileSync(path, "utf8"), this.history.nativeJournalSafety(this.id)); }
    catch { return { ops: [], unreadable: 0, blocked: true }; }
  }

  private opApplied(op: DivertOp): boolean {
    try {
      if (isNativeOperation(op)) return this.history.nativeOperationApplied(this.id, nativeDivertOp(op as Parameters<typeof nativeDivertOp>[0]));
      return this.history.isApplied(op.opId);
    } catch {
      return false;
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
          else if (op.kind === "truncate") this.history.truncateFrom(this.id, op.fromSeq, op.deletedAt);
          else this.history.applyOp(this.id, nativeDivertOp(op));
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
      if (isNativeOperation(op)) {
        this.history.enableNativeJournalSafety(this.id);
        const closed = nativeDivertOp(op as Parameters<typeof nativeDivertOp>[0]);
        const fd = openSync(this.divertPath(), "a");
        try { writeFileSync(fd, JSON.stringify(closed) + "\n", "utf8"); fsyncSync(fd); }
        finally { closeSync(fd); }
      } else appendFileSync(this.divertPath(), JSON.stringify(op) + "\n");
      this.divertPending = true;
      journaled = true;
      this.log.warn(`the conversation store refused a write (${why}); kept in divert.jsonl to apply later`);
      this.notice(`The conversation store refused a write (${why}). The change is kept in the room's divert journal and applied when the store answers again.`, "error");
    } catch (second) {
      if (isNativeOperation(op) && existsSync(this.divertPath())) {
        this.divertPending = true;
        this.nativeRecoveryHold = true;
        this.onNativePending?.(this.id);
      }
      this.log.error(`the conversation store refused a write (${why}) and divert.jsonl could not be written either: ${describeError(second)}`);
      this.notice(`The conversation store refused a write (${why}) and the divert journal could not be written either: this change is NOT saved.`, "error");
    }
    this.onHistoryFailure?.(this.id, error);
    return journaled;
  }

  private readonly unsavedExternal = new Map<string, { id: string; seq: number; stored: StoreOutcome }>();

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
      const message = this.roomMessages.byId(entry.id);
      if (!message) { this.unsavedExternal.delete(opId); continue; }
      try {
        this.history.applyOp(this.id, { kind: "upsert", message, opId, accept: true });
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
    if (journal.blocked) {
      this.nativeRecoveryHold = true;
      this.divertPending = true;
      this.onNativePending?.(this.id);
      this.log.warn("The native pending-changes journal is unreadable or unsupported; it is retained without replay or deletion.");
      return;
    }
    try {
      for (const op of journal.ops) this.history.applyOp(this.id, op);
    } catch (error) {
      try { if (this.history.nativeJournalSafety(this.id) || journal.ops.some(isNativeOperation)) this.nativeRecoveryHold = true; }
      catch { this.nativeRecoveryHold = true; }
      this.divertPending = true;
      this.log.warn(`divert.jsonl could not be applied yet: ${describeError(error)}`);
      return;
    }
    rmSync(path, { force: true });
    this.divertPending = false;
    this.nativeRecoveryHold = false;
    this.journalApplied();
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
        p.notes = s.notes; p.notesAt = s.notesAt; p.notesSeq = s.notesSeq; p.notesWrittenAt = s.notesWrittenAt;
        p.notesRevision = s.notesRevision; p.nativeNoteReceipt = s.nativeNoteReceipt;
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
        ...presence.restoredPresence(s),
        turns: 0,
        color: s.color,
        colorSlot: s.colorSlot ?? (COLORS.indexOf(s.color) >= 0 ? COLORS.indexOf(s.color) : undefined),
        tagline: s.tagline,
        role: s.role,
        avatar: s.avatar || undefined,
        muted: s.muted,
        ...(s.asleep ? { asleep: true } : {}),
        createdByVibemate: s.createdByVibemate,
        replyDelay: s.replyDelay,
        skills: normalizeSkillList(s.skills),
        launch: s.launch,
        earlierLaunches: s.earlierLaunches,
        sessionId: s.sessionId,
        sessionDir: s.sessionDir,
        deliveryEpoch: s.deliveryEpoch,
        suppliedThrough: s.suppliedThrough,
        supportsLoad: s.supportsLoad,
        sawFromSeq: s.sawFromSeq,
        runSeen: s.runSeen,
        buildSeen: s.buildSeen,
        notes: s.notes,
        notesAt: s.notesAt,
        notesSeq: s.notesSeq,
        notesWrittenAt: s.notesWrittenAt,
        notesRevision: s.notesRevision,
        nativeNoteReceipt: s.nativeNoteReceipt,
        violations: 0,
        briefsSent: 0,
        failedTurns: 0,
      });
      if (s.lastSeenSeq !== undefined) this.restoredSeen.set(s.id, s.lastSeenSeq);
      this.colorIndex++;
    }
    this.readFormerNames();
    const furthest = Math.max(this.seq, ...this.restoredSeen.values());
    if (furthest > this.seq) {
      this.log.warn(`the record reaches #${this.seq} but a vibemate had read up to #${furthest}: the count continues from there`);
      this.roomMessages.continueFrom(furthest);
    }
  }

  templateOf(): { dir: string; settings: Partial<RoomSettings>; vibemates: TemplateVibemate[] } {
    const settings = templateRoomSettings({ ...this.settings, customRules: this.roomSettings.rulesText() });
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

  toStored(): { id: string; uuid: string; scope?: unknown; name: string; dir: string; createdAt: number; settings: Partial<RoomSettings>; participants: StoredParticipant[] } {
    const { name: _n, humanName: _h, ...settings } = this.settings;
    return {
      id: this.id,
      uuid: this.uuid,
      ...(this.scope ? { scope: this.scope } : this.unreadableScope !== undefined ? { scope: this.unreadableScope } : {}),
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
          earlierLaunches: p.earlierLaunches ? { ...p.earlierLaunches } : undefined,
          muted: !!p.muted,
          asleep: p.asleep || undefined,
          createdByVibemate: p.createdByVibemate || undefined,
          replyDelay: p.replyDelay,
          skills: p.skills && p.skills.length ? [...p.skills] : undefined,
          sessionId: p.sessionId,
          sessionDir: p.sessionDir,
          deliveryEpoch: p.deliveryEpoch,
          suppliedThrough: p.suppliedThrough,
          supportsLoad: p.supportsLoad,
          lastSeenSeq: this.runtimes.get(p.id)?.reading.lastSeenSeq ?? this.restoredSeen.get(p.id),
          sawFromSeq: p.sawFromSeq,
          runSeen: p.runSeen,
          buildSeen: p.buildSeen,
          notes: p.notes,
          notesAt: p.notesAt,
          notesSeq: p.notesSeq,
          notesWrittenAt: p.notesWrittenAt,
          notesRevision: p.notesRevision,
          nativeNoteReceipt: p.nativeNoteReceipt,
        })),
    };
  }

  private commit(draft: MessageDraft, opId?: string): { message: ChatMessage; stored: StoreOutcome } {
    this.markOrigin(draft);
    const message = this.roomMessages.add(draft);
    return { message, stored: this.recordNew(message, opId) };
  }

  private commitReserved(draft: ChatMessage, ticket: SeqTicket, opId?: string): { message: ChatMessage; stored: StoreOutcome } {
    this.markOrigin(draft);
    const message = this.roomMessages.addReserved(draft, ticket);
    return { message, stored: this.recordNew(message, opId) };
  }

  private markOrigin(message: MessageDraft): void {
    if (this.folderId) message.origin ??= this.folderId;
  }

  private recordNew(message: ChatMessage, opId?: string): StoreOutcome {
    const stored = this.persist(opId ? { kind: "upsert", message, opId, accept: true } : { kind: "upsert", message });
    this.push({ type: "message", message });
    this.numberQuotesOf(message);
    return stored;
  }

  private awaitNumbers(message: ChatMessage): void {
    for (const id of this.quotesAwaitingNumber.keys()) if (!this.drafts.has(id)) this.quotesAwaitingNumber.delete(id);
    for (const quote of message.quotes ?? []) {
      if (quote.seq !== undefined || !quote.id || !this.drafts.has(quote.id)) continue;
      const waiting = this.quotesAwaitingNumber.get(quote.id) ?? new Set<string>();
      waiting.add(message.id);
      this.quotesAwaitingNumber.set(quote.id, waiting);
    }
  }

  private numberQuotesOf(landed: ChatMessage): void {
    const waiting = this.quotesAwaitingNumber.get(landed.id);
    if (!waiting) return;
    this.quotesAwaitingNumber.delete(landed.id);
    if (!visibleToAgents(landed)) return;
    for (const id of waiting) {
      const message = this.roomMessages.byId(id);
      const quotes = message?.quotes;
      if (!message || !quotes?.some((q) => q.id === landed.id && q.seq === undefined)) continue;
      this.reviseRecorded({ ...message, quotes: quotes.map((q) => (q.id === landed.id && q.seq === undefined ? { ...q, seq: landed.seq } : q)) });
    }
  }

  private takeFromRecord(): void {
    const rows: ChatMessage[] = [];
    for (const message of this.history.all(this.id)) {
      if (message.kind === "system" && !message.details?.tone) {
        const tone = legacyRowTone(message.text);
        if (tone) message.details = { ...(message.details ?? {}), tone };
      }
      for (const repair of message.diagramRepairs ?? []) {
        if (repair.state === "repairing" && !this.diagramRepairs.isRepairing(message.from, message.id, repair.block)) repair.state = "failed";
      }
      rows.push(message);
    }
    this.roomMessages.replaceFromRecord(rows, this.history.maxSeq(this.id));
    this.readFormerNames();
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
    const live = [...this.runtimes.values()].filter((r) => r.work.turn?.published).map((r) => r.work.turn!.message);
    return [...this.messages, ...live].sort((a, b) =>
      (a.displayOrder ?? a.seq) - (b.displayOrder ?? b.seq) || a.seq - b.seq || a.id.localeCompare(b.id),
    );
  }


  get humanName(): string {
    return this.settings.humanName;
  }

  speechNames(): string[] {
    return [this.humanName, ...[...this.participants.values()].filter((p) => p.kind === "agent" && p.status !== "left").map((p) => p.name)];
  }

  turnProgressMark(participantId: string): string {
    const turn = this.runtimes.get(participantId)?.work.turn;
    return turn ? `${turn.message.id}:${turn.lastSignAt ?? turn.startedAt}:${turn.message.text.length}:${turn.message.toolCalls?.length ?? 0}` : "";
  }

  messageById(messageId: string): ChatMessage | undefined {
    let message = this.messages.find(m => m.id === messageId);
    if (!message) for (const runtime of this.runtimes.values()) {
      if (runtime.work.turn?.published && runtime.work.turn.message.id === messageId) { message = runtime.work.turn.message; break; }
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
    return this.roomSettings.foldAfter;
  }

  private handedFromSeq(): number | undefined {
    let from: number | undefined;
    for (const [id, runtime] of this.runtimes) {
      if (!runtime.session.agent?.alive) continue;
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

  snapshot(request: { from?: Cursor; all?: boolean; seq?: number; message?: string; index?: boolean } = {}): unknown {
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
      pinnedOlder: from ? all.slice(0, from).filter((m) => m.pinned && m.kind === "chat").map((m) => this.forWindow(m)) : [],
      id: this.id,
      uuid: this.uuid,
      ...(this.scope ? { scope: this.scope } : {}),
      filesDir: this.filesDir(),
      sources: this.history.carry.sources(),
      resourceVersions: this.history.carry.resources(this.id),
      name: this.name,
      dir: this.dir,
      folderRestartChoice: true,
      createdAt: this.createdAt,
      humanName: this.humanName,
      hopLimit: this.hopLimit,
      hops: this.hops,
      focused: this.focused,
      startingWithHub: this.startingWithHub,
      settings: this.settings,
      customRulesText: this.roomSettings.rulesText(),
      participants: [...this.participants.values()].map(p => this.participantView(p)),
      messages: request.index
        ? shown.map((m, at) => (at >= shown.length - WINDOW_RECENT_BODIES || m.streaming ? this.forWindow(m) : m))
        : shown.map((m) => this.forWindow(m)),
      permissions: this.permissions.views(),
      ...this.proposalCards.views(),
      recovery: this.recovery,
      readOnly: this.readOnly,
      recipes: publicRecipes(),
      lastMessageAt: last?.ts ?? this.createdAt,
    };
  }

  applyProgramSettings(program: ProgramRoomSettings): void {
    const change = this.roomSettings.applyProgram(program);
    if (change.transcriptsChanged) this.updateTranscriptModes();
    if (change.humanNameChanged) {
      const human = this.participants.get("human")!;
      human.name = program.humanName;
      this.push({ type: "participant", participant: human });
    }
    if (change.roomEventChanged) {
      this.push(this.roomEvent());
    }
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

  serviceNotice(text: string, level: "info" | "warn" | "error"): void {
    this.notice(text, level);
  }

  serviceEvent(text: string): ChatMessage {
    return this.postRoomEvent(text, "human", false, { tone: "attention" });
  }

  channelRecord(text: string): void {
    this.postRoomEvent(text);
  }

  cardOutcome(text: string, participantId: string): void {
    this.postRoomEvent(text, undefined, true);
    this.requestTurn(participantId, true);
  }

  enqueueBackgroundCompletion(participantId: string, completion: BackgroundCompletion): void {
    this.completions.enqueue(participantId, completion);
  }

  resumeBackgroundCompletions(): void {
    this.completions.resume();
  }

  private requestBackgroundCompletion(participantId: string): void {
    const participant = this.participants.get(participantId);
    const runtime = this.runtimes.get(participantId);
    if (!participant || participant.status === "left" || this.closing || this.readOnly) return;
    if (!runtime?.session.agent.alive || runtime.session.retiring || runtime.work.workCancelled || participant.muted
        || runtime.work.workBusy || runtime.work.turnActive || runtime.queue.pendingTurn || runtime.queue.delayTimer
        || participant.status === "error" || participant.trouble || this.focused || this.recordHold) return;
    this.requestTurn(participantId);
  }

  removeBackgroundCompletion(participantId: string, key: string): void {
    this.completions.remove(participantId, key);
  }

  acceptsBackgroundRegistration(participantId: string, token: string): boolean {
    const runtime = this.runtimes.get(participantId);
    return !!runtime && !!token && runtime.session.mcpToken === token && this.liveAgentSession(participantId, runtime.session.agent, runtime.session.sessionId);
  }

  askConnectionWrite(participantId: string, call: { title: string; input: Record<string, unknown> }): Promise<boolean> {
    return this.permissions.ask(participantId,
      { toolCallId: `connection-${randomUUID()}`, title: call.title, kind: "other", rawInput: call.input },
      [{ optionId: "allow", name: "Allow once", kind: "allow_once" }, { optionId: "deny", name: "Deny", kind: "reject_once" }],
      call.title,
    ).then((response) => response.outcome.outcome === "selected" && response.outcome.optionId === "allow");
  }

  shownStatus(id: string): ParticipantStatus | "working" | "writing" | "notes" | "asking" {
    const participant = this.participants.get(id);
    if (!participant) return "left";
    if (participant.status !== "thinking") return participant.status;
    if (participant.notesTurn) return "notes";
    if (this.askingHuman(id)) return "asking";
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
      const state = p.asleep ? "asleep" : p.muted ? "muted" : this.shownStatus(p.id);
      const turn = this.runtimes.get(p.id)?.work.turn;
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

  workingNow(): { name: string; lastSignAt: number | null }[] {
    const out: { name: string; lastSignAt: number | null }[] = [];
    for (const p of this.participants.values()) {
      if (p.kind !== "agent" || p.status === "left") continue;
      const runtime = this.runtimes.get(p.id);
      if (!runtime || !(runtime.work.turnActive || runtime.work.workBusy)) continue;
      const turn = runtime.work.turn;
      out.push({ name: p.name, lastSignAt: turn ? (turn.lastSignAt ?? turn.startedAt) : null });
    }
    return out;
  }

  private readonly silence = new SilenceWatch({
    runtimes: () => this.runtimes,
    participant: (id) => this.participants.get(id),
    askingHuman: (id) => this.askingHuman(id),
    markQuiet: (seen) => {
      if (!this.stillQuiet(seen)) return false;
      seen.runtime.work.quiet = { turnId: seen.turn.message.id };
      this.push({ type: "participant", participant: seen.participant });
      return true;
    },
    keepRecord: (seen, reason) => {
      if (!this.stillQuiet(seen)) return false;
      const kept = seen.runtime.session.transcript.dump(reason);
      if (kept) this.log.info(`protocol kept: ${kept}`);
      return true;
    },
    tell: (seen, text) => {
      if (!this.stillQuiet(seen)) return false;
      this.postSystem(text, "human", false, { agentId: seen.id, tone: "attention" });
      return true;
    },
  });
  private readonly agentConfig = new AgentConfig({
    current: (id) => ({ participant: this.participants.get(id), runtime: this.runtimes.get(id) }),
    takeWork: (runtime) => this.takeWork(runtime),
    finishWork: (id, hold) => this.finishRuntimeWork(id, hold),
    replaceForMode: (id, hold) => this.replaceForMode(id, hold),
    pushParticipant: (seen) => {
      if (!this.vibemateHeld(seen)) return false;
      this.push({ type: "participant", participant: seen.participant });
      return true;
    },
    tell: (seen, text, tone) => {
      if (!this.vibemateHeld(seen)) return false;
      this.postSystem(text, "human", false, { agentId: seen.participant.id, ...(tone ? { tone } : {}) });
      return true;
    },
  });
  private readonly agentNotes = new AgentNotes({
    current: (id) => ({ participant: this.participants.get(id), runtime: this.runtimes.get(id) }),
    participants: () => this.participants.values(),
    runtimes: () => this.runtimes.values(),
    seq: () => this.seq,
    messages: () => this.messages,
    autoNotes: () => this.settings.autoNotes,
    open: () => !this.closing && !this.readOnly,
    assertRecordOpen: () => this.assertRecordOpen(),
    idle: (_id, runtime) => !runtime.work.turnActive && !runtime.work.workBusy && !this.nativeLaneBlocked(runtime),
    pushParticipant: (seen) => {
      if (!this.vibemateHeld(seen)) return false;
      this.push({ type: "participant", participant: seen.participant });
      return true;
    },
    log: (text) => this.log.info(text),
    runNotesTurn: (expected) => this.runNotesTurn(expected),
  });
  private readonly agentSessions = new AgentSessions({
    current: (id) => ({ participant: this.participants.get(id), runtime: this.runtimes.get(id) }),
    closing: () => this.closing,
    blocked: () => this.readOnly || !!this.recordHold,
    forget: (id, expected) => this.forgetRuntime(id, expected),
    pushParticipant: (seen) => {
      if (this.closing || !this.vibemateHeld(seen)) return false;
      this.push({ type: "participant", participant: seen.participant });
      return true;
    },
    cancelPermissionsOf: (id) => this.cancelPermissionsOf(id),
    restoreSeen: (seen, seq) => {
      if (this.closing || !this.vibemateHeld(seen)) return false;
      this.restoredSeen.set(seen.participant.id, seq);
      return true;
    },
    notice: (seen, text) => {
      if (this.closing || !this.vibemateHeld(seen)) return false;
      this.notice(text, "error");
      return true;
    },
    markForgotten: (seen) => {
      if (this.closing || !this.vibemateHeld(seen)) return false;
      presence.forgotten(seen.participant);
      return true;
    },
    markExited: (seen, detail) => {
      if (this.closing || !this.vibemateHeld(seen)) return false;
      presence.exited(seen.participant, detail);
      return true;
    },
  });
  private readonly notesTurns = new Map<string, AgentRuntime>();
  private operationHolds(seen: SeenVibemate): boolean {
    return !this.closing && this.vibemateHeld(seen);
  }
  private vibemateHeld(seen: SeenVibemate): boolean {
    const id = seen.participant.id;
    return stillHeld(seen, { participant: this.participants.get(id), runtime: this.runtimes.get(id) });
  }
  private stillQuiet(seen: SeenQuietTurn): boolean {
    return stillQuiet(seen, { runtime: this.runtimes.get(seen.id), participant: this.participants.get(seen.id), asking: this.askingHuman(seen.id) });
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
    if (!participant || !presence.skippedMuted(participant)) return;
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
      return participant?.kind === "agent" && participant.status === "idle" && !participant.muted && runtime?.session.agent.alive && !runtime.session.retiring && !runtime.work.workCancelled && !runtime.work.turnActive;
    });
    if (!targets.length) return;
    this.postRoomEvent(`Automatic restart message, configured by ${this.humanName}:\n${text}`, undefined, true);
    this.turnOrder.resetHops();
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

  postHumanMessage(text: string, images: ImageInput[] = [], quotes: QuoteInput[] = [], audio: HeardSound[] = [], video: VideoInput[] = []): ChatMessage {
    const built = this.buildHumanMessage(text, images, quotes, audio, video);
    const { message } = this.commitReserved(built.message, built.ticket);
    this.route(message);
    this.emit("humanActivity");
    return message;
  }

  automationNotice(text: string): void { this.postRoomEvent(text, "human", false, { tone: "attention" }); }

  async prepareAutomation(job: AutomationJob, allowWake = true): Promise<string | null> {
    if (this.closing) return "This room is stopping.";
    if (this.recordHold) return "The room's history needs a decision first.";
    if (this.focused) return "The room is hushed. Speak in it to resume work.";
    if (job.action === "reminder") return null;
    const id = job.targetId!, participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent" || participant.status === "left") return "The selected vibemate is no longer in this room. Edit the automation.";
    if (participant.muted) return "The selected vibemate is muted.";
    if (participant.asleep) return "The selected vibemate is asleep. Wake it up to let the automation run.";
    if (participant.trouble || participant.status === "error") return "The selected vibemate needs attention before it can work.";
    if (participant.status === "offline" && job.wakeOffline && allowWake) return null;
    const runtime = this.runtimes.get(id);
    if (!runtime?.session.agent.alive) return "The selected vibemate is offline.";
    if (this.focused || participant.muted || this.closing || this.recordHold) return "The room paused while the vibemate was connecting.";
    if (runtime.work.workCancelled) return "The selected vibemate was stopped. Speak to it to resume work.";
    if (runtime.work.turnActive || runtime.work.workBusy || this.nativeLaneBlocked(runtime) || runtime.queue.pendingTurn || runtime.queue.delayTimer || runtime.session.retiring || this.automations.has(id)
        || this.completions.waiting(id) || participant.status !== "idle") return "Waiting for the selected vibemate to finish.";
    return null;
  }

  async executeAutomation(run: AutomationRun, signal: AbortSignal): Promise<AutomationOutcome> {
    if (signal.aborted) return { status: "cancelled", detail: String(signal.reason ?? "Cancelled.") };
    if (run.job.action === "agent" && run.job.wakeOffline && this.participants.get(run.job.targetId!)?.status === "offline") {
      const gate = await this.prepareAutomation(run.job);
      if (gate) return { status: "deferred", detail: gate };
      await this.reconnect(run.job.targetId!, { mode: "load" });
    }
    const reason = await this.prepareAutomation(run.job, false);
    if (reason) return { status: "deferred", detail: reason };
    if (signal.aborted) return { status: "cancelled", detail: String(signal.reason ?? "Cancelled.") };
    const id = run.job.targetId;
    const { message, stored } = this.commit({ id: randomUUID(), from: "system", fromName: "", to: id ? [id] : [],
      toNames: id ? [this.participants.get(id)!.name] : [], ts: Date.now(), kind: "system",
      audience: "human", details: { about: "room" },
      text: run.job.action === "reminder" ? `Reminder · ${run.job.name}\n${run.job.text}` : `Automation · ${run.job.name} → ${this.participants.get(id!)!.name}` });
    if (stored !== "record") return { status: "failed", detail: "The task notice could not be durably recorded; no agent was started." };
    if (run.job.action === "reminder") return { status: "completed", messageId: message.id };
    return this.automations.begin(id!, run, this.runtimes.get(id!)!, signal);
  }

  acceptExternalMessage(input: { opId: string; via: MessageVia; text: string; images?: ImageInput[]; quotes?: QuoteInput[]; audio?: HeardSound[]; video?: VideoInput[] }): ExternalReceipt {
    const held = this.unsavedExternal.get(input.opId);
    if (held) return { id: held.id, seq: held.seq, stored: held.stored, repeated: true, rerouted: false };
    const applied = this.appliedReceipt(input.opId);
    if (applied) return { id: applied.messageId, seq: applied.seq, stored: "record", repeated: true, rerouted: this.rerouteIfNeverSeen(applied.messageId) };
    let built: { message: ChatMessage; ticket: SeqTicket };
    try {
      built = this.buildHumanMessage(input.text, input.images ?? [], input.quotes ?? [], input.audio ?? [], input.video ?? []);
    } catch (error) {
      if (error instanceof RoomRefusal) return { stored: "rejected", reason: error.message, repeated: false, rerouted: false, transient: error.transient };
      throw error;
    }
    built.message.via = input.via;
    const { message, stored } = this.commitReserved(built.message, built.ticket, input.opId);
    if (stored !== "record") this.unsavedExternal.set(input.opId, { id: message.id, seq: message.seq, stored });
    this.route(message);
    this.emit("humanActivity");
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

  private buildHumanMessage(text: string, images: ImageInput[], quotes: QuoteInput[], audio: HeardSound[] = [], video: VideoInput[] = []): { message: ChatMessage; ticket: SeqTicket } {
    this.assertRecordOpen();
    const waiting = this.unstaffed();
    if (waiting.length) throw new RoomRefusal(`${waiting.map((p) => p.name).join(", ")} ${waiting.length === 1 ? "has" : "have"} no coding agent yet: summon ${waiting.length === 1 ? "it" : "them"} from the roster to start the conversation`);
    const trimmed = text.trim();
    if (!trimmed && !images.length && !audio.length && !video.length && !quotes.length) throw new RoomRefusal("empty message");
    const quoted = quotes.length ? resolveQuotes(quotes, this.messages, this.drafts) : [];
    const attachments = images.length ? saveImages(ensureDir(this.filesDir()), images) : [];
    for (const a of attachments) void this.pictures?.prepare(join(this.filesDir(), a.file), a.mimeType, { room: this.id, file: a.file });
    const sounds = audio.length ? saveAudio(ensureDir(this.filesDir()), audio).map((kept, i) => ({ ...kept, ...(audio[i].words !== undefined ? { words: audio[i].words } : {}), ...(audio[i].unheard ? { unheard: audio[i].unheard } : {}) })) : [];
    const clips = video.length ? saveVideo(ensureDir(this.filesDir()), video) : [];
    this.turnOrder.messageArrived();
    const human = this.participants.get("human")!;
    const ticket = this.roomMessages.reserve();
    const message: ChatMessage = {
      id: randomUUID(),
      seq: ticket.seq,
      from: human.id,
      fromName: human.name,
      to: [],
      toNames: [],
      text: trimmed,
      ts: Date.now(),
      kind: "chat",
    };
    if (attachments.length) message.images = attachments;
    if (sounds.length) message.audio = sounds;
    if (clips.length) message.video = clips;
    if (quoted.length) message.quotes = quoted;
    this.awaitNumbers(message);
    this.decorateHumanMessage(message);
    message.bodyDelivery = { version: 1, readers: {} };
    for (const p of this.participants.values()) {
      if (p.kind === "agent" && this.runtimes.get(p.id)?.session.agent.alive) registerBodyReader(message, p.id, this.ensureDeliveryEpoch(p));
    }
    human.turns += 1;
    if (this.turnOrder.endHush()) this.push(this.roomEvent());
    return { message, ticket };
  }

  private decorateHumanMessage(message: ChatMessage): void {
    const addressing = this.humanAddressing(message.text);
    message.to = addressing.to;
    message.toNames = addressing.toNames;
    delete message.skill;
    if (addressing.skill) message.skill = addressing.skill;
  }

  private humanAddressing(text: string): Pick<ChatMessage, "to" | "toNames" | "skill"> {
    const mentions = this.parseMentions(text);
    const invocation = parseSkillInvocation(text);
    if (!invocation) return { to: mentions.ids, toNames: mentions.names };
    const skill = this.skills?.library.get(invocation.name);
    if (!skill) this.notice(`No skill named "${invocation.name}" in the library; sent as plain text.`, "warn");
    else if (!skill.userInvocable) this.notice(`Skill "${skill.name}" is not user-invocable; sent as plain text.`, "warn");
    else if (skill.problems.length) this.notice(`Skill "${skill.name}" has problems (${skill.problems.join("; ")}); sent as plain text.`, "warn");
    else return { to: mentions.ids, toNames: mentions.names, skill: { name: skill.name, args: invocation.args } };
    return { to: mentions.ids, toNames: mentions.names };
  }


  private agentReadStates(): AgentReadState[] {
    const out: AgentReadState[] = [];
    for (const p of this.participants.values()) {
      if (p.kind !== "agent" || p.status === "left" || p.status === "unstaffed") continue;
      const runtime = this.runtimes.get(p.id);
      if (runtime) out.push({ id: p.id, name: p.name, lastSeenSeq: runtime.reading.lastSeenSeq, suppliedThrough: p.suppliedThrough, active: runtime.work.turnActive, online: true });
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
    const recorded = this.roomMessages.byId(messageId);
    const draft = recorded ? undefined : this.drafts.get(messageId);
    const message = recorded ?? draft;
    if (!message || message.kind !== "chat") throw new Error("only chat messages can be pinned");
    if (!!message.pinned === pinned) return message;
    if (recorded) return this.reviseRecorded(withPin(recorded, pinned));
    if (pinned) draft!.pinned = true;
    else {
      delete draft!.pinned;
      delete draft!.pinLabel;
    }
    this.push({ type: "message", message: draft! });
    return draft!;
  }

  setPinLabel(messageId: string, label: string): ChatMessage {
    this.assertRecordOpen();
    const recorded = this.roomMessages.byId(messageId);
    const draft = recorded ? undefined : this.drafts.get(messageId);
    const message = recorded ?? draft;
    if (!message || message.kind !== "chat" || !message.pinned) throw new Error("only a pinned message has a title of its own");
    const title = pinTitle(label);
    if ((message.pinLabel ?? "") === title) return message;
    if (recorded) return this.reviseRecorded(withPinLabel(recorded, title));
    if (title) draft!.pinLabel = title;
    else delete draft!.pinLabel;
    this.push({ type: "message", message: draft! });
    return draft!;
  }

  private reviseRecorded(next: ChatMessage, store = true): ChatMessage {
    const message = this.roomMessages.revise(next);
    if (store) this.persist({ kind: "upsert", message });
    this.push({ type: "message", message });
    return message;
  }

  reportDiagramFailure(messageId: string, block: number, source: string, error: string): { state: DiagramRepair["state"] | "ignored" } {
    return this.diagramRepairs.report(messageId, block, source, error);
  }

  private canRepairDiagram(authorId: string, answeredAt: number): boolean {
    const participant = this.participants.get(authorId), runtime = this.runtimes.get(authorId);
    if (participant?.kind !== "agent" || participant.muted || this.focused || this.closing) return false;
    if (!runtime?.session.agent.alive || runtime.session.retiring || runtime.work.workCancelled) return false;
    if (["unstaffed", "error", "offline", "left"].includes(participant.status)) return false;
    return Date.now() - answeredAt <= DIAGRAM_REPAIR_WINDOW_MS;
  }

  fixDiagramForAgent(participantId: string, seq: number, block: number, source: string): { ok: true; message: string } {
    return this.diagramRepairs.fix(participantId, seq, block, source);
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
    const held = this.editableMessage(messageId);
    if (trimmed === held.text) throw new Error("the text is unchanged");
    this.messageCheckRevision++;
    const { restart, offline } = affectedByEdit(this.agentReadStates(), held.seq);
    const readers = [...this.participants.values()].filter((p) => p.kind === "agent" && this.runtimes.get(p.id)?.session.agent.alive)
      .map((p) => [p.id, this.ensureDeliveryEpoch(p)] as const);
    const addressing = this.humanAddressing(trimmed);
    const current = this.editableMessage(messageId);
    const previous = current.text;
    const previousVersion = current.bodyDelivery?.version ?? 1;
    const { skill: _skill, ...unaddressed } = current;
    const next: ChatMessage = { ...unaddressed, ...addressing, bodyDelivery: nextBodyVersion(current), edited: { ts: Date.now(), previous }, text: trimmed };
    for (const [id, epoch] of readers) registerBodyReader(next, id, epoch);
    if (this.folderId && (current.numbering ?? current.origin ?? this.folderId) !== this.folderId) next.numbering = this.folderId;
    const message = this.roomMessages.revise(next);
    this.turnOrder.messageArrived();
    if (this.turnOrder.endHush()) this.push(this.roomEvent());

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
    this.agentNotes.dropAfter(message.seq);
    for (const a of restart) {
      const runtime = this.runtimes.get(a.id);
      if (!runtime) continue;
      this.dropScheduledTurn(a.id);
      this.cancelPermissionsOf(a.id);
    }
    this.roomMessages.truncateAfter(message.seq);
    this.persist({ kind: "rewrite", fromSeq: message.seq, deletedAt: Date.now(), message });
    this.push({ type: "messages.truncated", fromSeq: message.seq });
    this.push({ type: "message", message });
    for (const a of restart) { const runtime = this.runtimes.get(a.id); if (runtime) this.turnOrder.standDown(runtime); }

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
      presence.rewrittenWhileOffline(p);
      this.restoredSeen.set(a.id, Math.max(0, message.seq - 1));
      this.push({ type: "participant", participant: p });
    }
    this.postSystem(rewriteNotice(this.humanName, removed.filter((m) => m.kind === "chat").length, restarted));
    this.log.info(`edit (rewrite) of #${message.seq}: ${removed.length} records removed; restarted ${restarted.join(", ") || "nobody"}`);
    this.startNext();
    this.route(message);
    return { restarted, removed: removed.length };
  }

  async respawnAgent(id: string, options: { memory?: boolean; replay?: number; reason?: string; wake?: boolean } = {}): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    return this.respawnExpected(participant, this.runtimes.get(id) ?? null, options);
  }

  private async respawnExpected(participant: Participant, runtime: AgentRuntime | null, options: { memory?: boolean; replay?: number; reason?: string; wake?: boolean }): Promise<Participant> {
    await this.respawnSession(participant, runtime, options);
    return participant;
  }

  private async respawnSession(participant: Participant, runtime: AgentRuntime | null, options: { memory?: boolean; replay?: number; reason?: string; wake?: boolean }): Promise<AgentRuntime | undefined> {
    const id = participant.id;
    const asked: SeenVibemate = { participant, runtime };
    if (!this.operationHolds(asked)) return undefined;
    const online = !!runtime;
    const memory = !!options.memory;
    const replay = memory ? Math.max(0, options.replay ?? this.settings.replayAfterRestart) : 0;
    const withNotes = memory && !!participant.notes;
    const why = options.reason ?? "its context was cleared";
    this.dropScheduledTurn(id);
    if (!this.operationHolds(asked)) return undefined;
    this.cancelPermissionsOf(id);
    if (!this.operationHolds(asked)) return undefined;
    if (runtime) this.turnOrder.standDown(runtime);
    if (runtime) await this.retireRuntime(id, runtime);
    const without: SeenVibemate = { participant, runtime: null };
    if (!this.operationHolds(without)) { this.log.info(`respawn of ${participant.name} stopped: the vibemate changed meanwhile`); return undefined; }
    participant.sessionId = undefined;
    this.restoredSeen.set(id, this.seq);
    this.push({ type: "participant", participant });
    if (!this.operationHolds(without)) return undefined;
    if (!online) this.log.info(`respawn of ${participant.name} (offline): stored session dropped, starting it now`);
    const started = await this.reconnectExpected(participant, memory
      ? { mode: "replay", replay, reason: `${why}; it comes back with ${withNotes ? "its notes and " : ""}the last ${replay} messages`, wake: options.wake }
      : { mode: "replay", replay: 0, notes: false, reason: `${why}, it remembers nothing from before`, wake: options.wake });
    this.log.info(`respawn of ${participant.name}: fresh session, ${memory ? `${withNotes ? "notes + " : ""}replay ${replay}` : "no replay"}`);
    return started;
  }

  async restartWithPersona(id: string, patch: PersonaPatch): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const runtime = this.runtimes.get(id) ?? null;
    const online = !!runtime && runtime.session.agent.alive;
    if (online && runtime.work.turnActive) throw new Error(`${participant.name} is in the middle of a reply; try again when it is idle`);
    const asked: SeenVibemate = { participant, runtime };
    if (!this.operationHolds(asked)) return participant;
    if (online) {
      try {
        await this.takeNotes(id);
      } catch (error) {
        this.log.warn(`${participant.name}: notes before the restart failed (${describeError(error)}); it restarts with the notes it had`);
      }
      if (!this.operationHolds(asked)) return participant;
    }
    this.updatePersona(id, patch);
    if (!this.operationHolds(asked)) return participant;
    return this.respawnExpected(participant, runtime, { memory: true, reason: "its role changed" });
  }

  updateNotes(id: string, notes: string): Participant {
    return this.agentNotes.update(id, notes);
  }

  async takeNotes(id: string): Promise<Participant> {
    return this.agentNotes.take(id);
  }

  private async runNotesTurn({ participant, runtime }: { participant: Participant; runtime: AgentRuntime }): Promise<void> {
    const id = participant.id;
    if (this.participants.get(id) !== participant || this.runtimes.get(id) !== runtime) throw new Error(`${participant.name} restarted before its notes were taken`);
    const header = buildHeader(this.roomSettings.effective(), this.personaOf(participant), this.roster(), this.hops, ["hidden turn: notes only, nothing is posted"]);
    const hold = this.takeWork(runtime);
    runtime.work.workCancelled = false;
    runtime.notes.notesPending = false;
    runtime.notes.deferredNotesTurn = false;
    this.turnOrder.defer({ id, participant, runtime });
    try {
      runtime.session.log.info("notes: hidden turn");
      this.notesTurns.set(id, runtime);
      participant.notesTurn = true;
      this.push({ type: "participant", participant });
      await this.executeTurn(participant, hold, [{ type: "text", text: `${header}\n\n${NOTES_ONLY_PROMPT}` }], null, { hidden: true });
    } finally {
      const mine = this.notesTurns.get(id) === runtime;
      if (mine) { this.notesTurns.delete(id); participant.notesTurn = undefined; }
      try {
        if (mine && this.participants.get(id) === participant) this.push({ type: "participant", participant });
      } finally {
        await this.finishRuntimeWork(id, hold);
      }
    }
  }

  private contextFull(participant: Participant, runtime: AgentRuntime, detail: string): void {
    const asked: SeenVibemate = { participant, runtime };
    if (!this.operationHolds(asked)) return;
    participant.contextEvent = { kind: "full", at: Date.now(), used: runtime.session.lastUsed, size: participant.contextSize };
    const recently = participant.autoRespawnAt !== undefined && Date.now() - participant.autoRespawnAt < 10 * 60_000;
    if (recently) {
      presence.exhausted(participant, "its context filled up again right after a respawn; it needs you (respawn it by hand, with fewer replayed messages)");
      this.push({ type: "participant", participant });
      if (!this.operationHolds(asked)) return;
      this.postRoomEvent(`${participant.name} ran out of context again (${detail.slice(0, 120)}); it was respawned once already and now needs you.`, "human", false, { tone: "error" });
      runtime.session.log.warn(`context full again within 10 minutes: no automatic respawn`);
      return;
    }
    participant.autoRespawnAt = Date.now();
    this.push({ type: "participant", participant });
    if (!this.operationHolds(asked)) return;
    const memory = !!participant.notes;
    this.postRoomEvent(`${participant.name} ran out of context (${detail.slice(0, 120)}); it is respawned ${memory ? `with its notes and the last ${this.settings.replayAfterRestart} messages` : `with the last ${this.settings.replayAfterRestart} messages (it had no notes)`}.`, "human", false, { tone: "error" });
    if (!this.operationHolds(asked)) return;
    runtime.session.log.warn(`context full: ${detail}; respawn with ${memory ? "notes" : "no notes"}`);
    setImmediate(() => {
      if (!this.operationHolds(asked)) return;
      void (memory ? this.respawnExpected(participant, runtime, { memory: true }) : this.reconnectAfterFull(participant, runtime)).catch((error) => {
        if (this.operationHolds(asked) || this.operationHolds({ participant, runtime: null })) this.notice(`${participant.name}: respawn after a full context failed: ${describeError(error)}`, "error");
      });
    });
  }

  private async reconnectAfterFull(participant: Participant, runtime: AgentRuntime): Promise<void> {
    const id = participant.id;
    const asked: SeenVibemate = { participant, runtime };
    if (!this.operationHolds(asked)) return;
    this.dropScheduledTurn(id);
    if (!this.operationHolds(asked)) return;
    this.cancelPermissionsOf(id);
    if (!this.operationHolds(asked)) return;
    await this.retireRuntime(id, runtime);
    if (!this.operationHolds({ participant, runtime: null })) return;
    participant.sessionId = undefined;
    await this.reconnectExpected(participant, { mode: "replay", reason: "its context was full; it comes back with the last messages" });
  }

  private watchTheStop(id: string): void {
    const participant = this.participants.get(id), runtime = this.runtimes.get(id);
    if (!participant || !runtime) return;
    const asked: SeenVibemate = { participant, runtime };
    const turnAtStop = runtime.work.turn ?? null;
    const unanswered = () => this.operationHolds(asked) && runtime.work.turnActive && (runtime.work.turn ?? null) === turnAtStop;
    const timer = setTimeout(() => {
      if (!unanswered()) return;
      this.postRoomEvent(`${participant.name} did not answer the stop; it is being started again with the same session.`, "human", false, { tone: "attention" });
      if (!unanswered()) return;
      void (async () => {
        let expected = asked;
        try {
          await this.retireRuntime(id, runtime);
          expected = { participant, runtime: null };
          if (!this.operationHolds(expected)) return;
          await this.reconnectExpected(participant, { mode: "load" });
        } catch (error) {
          if (this.operationHolds(expected)) this.notice(`${participant.name} could not be started again: ${describeError(error)}`, "error");
        }
      })();
    }, STOP_GRACE_MS);
    timer.unref?.();
  }

  private async retireRuntime(id: string, expected?: AgentRuntime): Promise<void> {
    return this.agentSessions.retire(id, expected);
  }

  focus(from?: string): void {
    let stopped = 0;
    for (const [id, runtime] of this.runtimes) {
      this.dropScheduledTurn(id);
      if (runtime.work.turnActive) {
        runtime.session.agent.cancel(runtime.session.sessionId);
        this.cancelPermissionsOf(id);
        stopped++;
      }
    }
    this.turnOrder.hush();
    this.push(this.roomEvent());
    this.postRoomEvent(`Hush${from ? ` from ${from}` : ""}: ${stopped ? `${stopped} repl${stopped > 1 ? "ies" : "y"} stopped; ` : ""}everyone waits until ${this.humanName} writes again.`, undefined, false, { tone: "hush" });
  }

  rename(name: string): void {
    if (!this.roomSettings.rename(name)) return;
    this.name = this.roomSettings.value.name;
    this.push(this.roomEvent());
  }

  updateSettings(patch: Record<string, unknown>): RoomSettings {
    const update = this.roomSettings.update(patch, (text, limit) => this.guardBriefText("The room rules text", text, "refuse", limit));
    if (update.changed.includes("transcripts")) this.updateTranscriptModes();
    if (update.changed.includes("autoNotes") && !update.settings.autoNotes) this.agentNotes.withdraw();
    this.push(this.roomEvent());
    if (update.briefChanges.length) {
      this.postSystem(`Room settings updated (${update.briefChanges.join(", ")}); agents get refreshed instructions on their next turn.`);
    }
    const missing = update.unknownNames;
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
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const asked: SeenVibemate = { participant, runtime: this.runtimes.get(id) ?? null };
    const still = () => this.operationHolds(asked);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!NAME_PATTERN.test(name)) throw new Error("name must be 1-24 letters, digits, _ or - (no spaces)");
      const taken = this.findByName(name);
      if (taken && taken.id !== id) throw new Error(`name "${name}" is already taken`);
      if (name !== participant.name) {
        const renamed: Renamed = { id, from: participant.name, to: name };
        this.postRoomEvent(`${participant.name} is now called ${name}.`, undefined, undefined, { renamed });
        if (!still()) return participant;
        participant.formerNames = [renamed.from, ...(participant.formerNames ?? [])]
          .filter((n, i, all) => n.toLowerCase() !== name.toLowerCase() && all.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);
        participant.name = name;
      }
    }
    if (patch.tagline !== undefined && patch.tagline.trim() !== (participant.tagline ?? "")) {
      participant.tagline = patch.tagline.trim().slice(0, 80);
    }
    if (patch.role !== undefined && patch.role.trim() !== (participant.role ?? "")) {
      const role = this.guardBriefText(`${participant.name}'s vibio`, patch.role.trim());
      if (!still()) return participant;
      participant.role = role;
    }
    if (patch.avatar !== undefined) {
      participant.avatar = cleanFace(patch.avatar, "vibemate") || undefined;
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
      }
    }
    this.push({ type: "participant", participant });
    return participant;
  }

  retryTurn(id: string): Participant {
    const participant = this.participants.get(id);
    const runtime = this.runtimes.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such vibemate");
    if (!runtime || !runtime.session.agent.alive) throw new Error(`${participant.name} is not running: respawn it instead`);
    if (runtime.work.turnActive) throw new Error(`${participant.name} is answering right now`);
    if (participant.trouble?.stage === "turn") runtime.reading.lastSeenSeq = Math.min(runtime.reading.lastSeenSeq, runtime.reading.turnStartSeq);
    this.clearTrouble(participant, undefined);
    this.log.info(`retry of ${participant.name}'s last turn, asked by the human`);
    this.requestTurn(id, true);
    return participant;
  }

  retryAfterLogin(recipeId: string): void {
    for (const participant of this.participants.values()) {
      if (participant.kind !== "agent" || participant.muted || participant.agentType !== recipeId || participant.trouble?.kind !== "login") continue;
      const runtime = this.runtimes.get(participant.id);
      if (runtime?.session.agent.alive) {
        this.notice(`${participant.name}: ${getRecipe(recipeId)?.vendor ?? recipeId} is logged in again; sending it the messages it missed.`, "info");
        try { this.retryTurn(participant.id); } catch (error) { this.log.warn(`retry after login: ${describeError(error)}`); }
      } else {
        const restore = this.storedSessionHere(participant) && participant.supportsLoad !== false;
        this.notice(`${participant.name}: ${getRecipe(recipeId)?.vendor ?? recipeId} is logged in again; ${restore ? "bringing it back with its session" : "starting it afresh with its notes"}.`, "info");
        void (restore ? this.reconnect(participant.id, { mode: "load" }) : this.respawnAgent(participant.id, { memory: true, reason: "logged in again" })).catch((error) => this.notice(`${participant.name}: the start after the login failed: ${describeError(error)}`, "error"));
      }
    }
  }

  agentUpdateBlockers(recipeId: string): string[] {
    return [...this.participants.values()].filter(p => {
      if (p.kind !== "agent" || p.agentType !== recipeId) return false;
      const runtime = this.runtimes.get(p.id);
      return p.status === "starting" || !!runtime && (runtime.work.turnActive || runtime.work.workBusy === true);
    }).map(p => `${p.name} (${this.name})`);
  }

  agentUpdateSessions(recipeId: string): { name: string; room: string; canRestore: boolean }[] {
    return [...this.participants.values()].filter(p => p.agentType === recipeId && this.runtimes.has(p.id))
      .map(p => ({ name: p.name, room: this.name, canRestore: p.supportsLoad !== false && this.storedSessionHere(p) }));
  }

  prepareAgentUpdate(recipeId: string): { pause: () => Promise<void>; resume: () => Promise<void> } {
    const blockers = this.agentUpdateBlockers(recipeId);
    if (blockers.length) throw new Error(`Still working: ${blockers.join(", ")}`);
    const group: SeenVibemate[] = [...this.runtimes.entries()].flatMap(([id, runtime]) => {
      const participant = this.participants.get(id);
      return participant?.agentType === recipeId ? [{ participant, runtime }] : [];
    });
    const standing = new Map<SeenVibemate, "frozen" | "paused" | "lost">();
    for (const member of group) {
      const id = member.participant.id, runtime = member.runtime!;
      if (!this.operationHolds(member)) { standing.set(member, "lost"); continue; }
      runtime.session.retiring = true; this.dropScheduledTurn(id);
      if (!this.operationHolds(member)) { standing.set(member, "lost"); continue; }
      this.restoredSeen.set(id, runtime.reading.lastSeenSeq);
      standing.set(member, "frozen");
    }
    const resume = async () => {
      this.optionCatalog.forget(recipeId);
      for (const member of group) {
        const { participant } = member, id = participant.id;
        if (participant.status === "left") continue;
        const state = standing.get(member);
        if (state === "frozen") {
          if (this.operationHolds(member)) { member.runtime!.session.retiring = false; this.requestTurn(id); }
          continue;
        }
        const without: SeenVibemate = { participant, runtime: null };
        if (state !== "paused" || !this.operationHolds(without)) continue;
        try {
          const started = await this.reconnectExpected(participant, { mode: "load", reason: "its installed agent was updated" });
          if (started && this.operationHolds({ participant, runtime: started })) this.requestTurn(id);
        } catch (error) {
          if (this.operationHolds(without)) this.notice(`${participant.name}: could not reconnect after the update: ${describeError(error)}`, "error");
        }
      }
    };
    return { resume, pause: async () => {
      for (const member of group) {
        if (standing.get(member) !== "frozen") continue;
        if (!this.operationHolds(member)) { standing.set(member, "lost"); continue; }
        await this.retireRuntime(member.participant.id, member.runtime!);
        const without: SeenVibemate = { participant: member.participant, runtime: null };
        if (!this.operationHolds(without)) { standing.set(member, "lost"); continue; }
        standing.set(member, "paused");
        this.push({ type: "participant", participant: member.participant });
        if (!this.operationHolds(without)) standing.set(member, "lost");
      }
    } };
  }

  private clearTrouble(participant: Participant, why: string | undefined): void {
    presence.recover(participant);
    this.push({ type: "participant", participant });
    if (why) this.notice(`${participant.name} is back in the conversation (${why}).`, "info");
  }

  async setAsleep(id: string, from?: string): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    if (participant.status === "unstaffed") throw new Error(`${participant.name} has no coding agent to put to sleep`);
    if (participant.asleep) return participant;
    if (participant.status === "starting") throw new Error(`${participant.name} is starting; put it to sleep once it is up`);
    const runtime = this.runtimes.get(id) ?? null;
    const asked: SeenVibemate = { participant, runtime };
    if (!this.operationHolds(asked)) return participant;
    this.turnLife.asleep(id);
    if (!this.operationHolds(asked)) return participant;
    this.dropScheduledTurn(id);
    if (!this.operationHolds(asked)) return participant;
    this.cancelPermissionsOf(id);
    if (!this.operationHolds(asked)) return participant;
    if (runtime) await this.retireRuntime(id, runtime);
    const without: SeenVibemate = { participant, runtime: null };
    if (!this.operationHolds(without)) return participant;
    presence.asleep(participant);
    this.push({ type: "participant", participant });
    if (!this.operationHolds(without)) return participant;
    const where = from ? ` (${from})` : "";
    this.postRoomEvent(`${participant.name} is asleep: its agent is stopped, and it starts again only when it is woken up${where}.`);
    return participant;
  }

  setMuted(id: string, muted: boolean, from?: string): Participant {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    if (!!participant.muted === muted) return participant;
    participant.muted = muted;
    if (!muted) presence.unmuted(participant);
    const runtime = this.runtimes.get(id);
    if (muted) this.turnLife.muted(id);
    if (muted && runtime) {
      this.dropScheduledTurn(id);
      if (runtime.work.turnActive) {
        runtime.session.agent.cancel(runtime.session.sessionId);
        this.cancelPermissionsOf(id);
      }
    }
    this.push({ type: "participant", participant });
    const where = from ? ` (${from})` : "";
    this.postRoomEvent(muted ? `${participant.name} is muted and receives no prompts${where}.` : `${participant.name} is unmuted${where}.`);
    return participant;
  }


  async discoverOptions(recipeId: string, refresh = false): Promise<DiscoveredOptions> {
    assertAgentAvailable(recipeId);
    const recipe = getRecipe(recipeId);
    if (!recipe) throw new Error(`unknown agent type: ${recipeId}`);
    if (recipe.unavailableReason) throw new Error(`${recipe.label}: ${recipe.unavailableReason}`);
    const stamp = recipeStamp(recipe);
    this.noteInstallation(recipeId, stamp);
    return this.optionCatalog.get(recipeId, stamp, refresh, () => probeAgentOptions(recipe, { dataDir: this.dataDir, log: this.log }));
  }

  noteInstallation(recipeId: string, stamp: string | null): void {
    if (!stamp) return;
    for (const [id, runtime] of this.runtimes) {
      const participant = this.participants.get(id);
      if (!participant || participant.agentType !== recipeId || !runtime.session.installStamp) continue;
      const outdated = runtime.session.installStamp !== stamp;
      if (!!participant.installOutdated === outdated) continue;
      participant.installOutdated = outdated || undefined;
      this.push({ type: "participant", participant });
    }
  }

  async inviteAgent(options: InviteOptions): Promise<Participant> {
    assertAgentAvailable(options.agentType);
    const recipe = getRecipe(options.agentType);
    if (!recipe) throw new Error(`unknown agent type: ${options.agentType}`);
    if (recipe.unavailableReason) throw new Error(`${recipe.label}: ${recipe.unavailableReason}`);
    const name = options.name.trim();
    if (!NAME_PATTERN.test(name)) throw new Error("name must be 1-24 letters, digits, _ or - (no spaces)");
    const taken = this.findByName(name);
    if (taken && !(options.id && taken.id === options.id && taken.status === "unstaffed")) throw new Error(`name "${name}" is already taken`);

    if (options.id && this.participants.get(options.id)?.status !== "unstaffed") throw new Error(`no vibemate awaiting a coding agent has the id "${options.id}"`);
    const id = options.id ?? this.mintParticipantId(`${recipe.id}-${name.toLowerCase()}`);
    const launch: LaunchPrefs = {
      model: options.model ?? recipe.defaultModel,
      effort: options.effort ?? recipe.defaultEffort,
      mode: options.mode ?? (this.roomSettings.bypassPermissionsByDefault ? recipe.bypassMode ?? recipe.defaultMode : recipe.defaultMode),
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
      avatar: (options.avatar == null ? this.freshAvatar() : cleanFace(options.avatar, "vibemate")) || undefined,
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
    if (input.id && !input.restoring) throw new Error("only a restored vibemate brings its own id");
    const id = input.id ?? this.mintParticipantId(`vm-${name.toLowerCase()}`);
    const participant: Participant = {
      id,
      name,
      kind: "agent",
      ...presence.unstaffedPresence(),
      turns: 0,
      ...this.nextColour(input.color),
      tagline: (input.tagline ?? "").trim().slice(0, 80),
      role: this.guardBriefText(`${name}'s vibio`, (input.role ?? "").trim(), input.textCheck),
      avatar: (input.avatar == null ? this.freshAvatar() : cleanFace(input.avatar, "vibemate")) || undefined,
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
    const runtime = this.runtimes.get(id) ?? null;
    const online = !!runtime && runtime.session.agent.alive;
    if (online && runtime.work.turnActive) throw new Error(`${participant.name} is in the middle of a reply; try again when it is idle`);
    if (!this.operationHolds({ participant, runtime })) return participant;
    if (online) {
      try {
        await this.takeNotes(id);
      } catch (error) {
        this.log.warn(`${participant.name}: notes before the change of agent failed (${describeError(error)}); it restarts with the notes it had`);
      }
      if (!this.operationHolds({ participant, runtime })) return participant;
      await this.retireRuntime(id, runtime);
      if (!this.operationHolds({ participant, runtime: null })) return participant;
    }
    const from = participant.agentVendor ?? participant.agentType;
    const earlier = { ...participant.earlierLaunches };
    if (participant.agentType) earlier[participant.agentType] = participant.launch ?? { model: participant.model ?? null, effort: participant.effort ?? null, mode: participant.mode ?? null };
    const remembered = earlier[recipe.id];
    delete earlier[recipe.id];
    participant.earlierLaunches = Object.keys(earlier).length ? earlier : undefined;
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
    const base: LaunchPrefs = remembered ?? {
      model: recipe.defaultModel,
      effort: recipe.defaultEffort,
      mode: this.roomSettings.bypassPermissionsByDefault ? recipe.bypassMode ?? recipe.defaultMode : recipe.defaultMode,
    };
    participant.launch = { model: choice.model ?? base.model, effort: choice.effort ?? base.effort, mode: choice.mode ?? base.mode };
    const source = choice.model || choice.effort ? "as chosen" : remembered ? "as it had there before" : `the defaults for ${recipe.vendor}`;
    this.postSystem(`${participant.name} on ${recipe.vendor}: model ${participant.launch.model ?? "the agent's own"}, effort ${participant.launch.effort ?? "the agent's own"}, ${source}`, "human", false, { agentId: participant.id });
    if (!this.operationHolds({ participant, runtime: online ? null : runtime })) return participant;
    this.log.info(`${participant.name}: coding agent ${from} -> ${recipe.vendor}`);
    return this.respawnExpected(participant, online ? null : runtime, { memory: true, replay: choice.replay, reason: `it now runs on ${recipe.vendor}` });
  }

  async reconnect(id: string, options: ReconnectOptions = { mode: "replay" }): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    await this.reconnectExpected(participant, options);
    return participant;
  }

  private async reconnectExpected(participant: Participant, options: ReconnectOptions): Promise<AgentRuntime | undefined> {
    const id = participant.id;
    assertAgentAvailable(participant.agentType ?? "");
    if (this.closing || this.participants.get(id) !== participant) return undefined;
    if (this.runtimes.has(id) || participant.status === "starting") return undefined;
    if (participant.asleep && !options.wake) return undefined;
    const without: SeenVibemate = { participant, runtime: null };
    const woken = presence.woken(participant);
    if (woken) {
      this.postRoomEvent(`${participant.name} is woken up.`);
      if (!this.operationHolds(without)) return undefined;
    }
    presence.starting(participant);
    this.push({ type: "participant", participant });
    if (!this.operationHolds(without)) return undefined;
    const launch = participant.launch ?? { model: participant.model ?? null, effort: participant.effort ?? null, mode: participant.mode ?? null };
    return this.startAgent(participant, launch, false, options);
  }

  async restartOnInstalled(id: string): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const runtime = this.runtimes.get(id);
    if (!runtime) return this.reconnect(id, { mode: "load" });
    if (runtime.work.turnActive || runtime.session.retiring) throw new Error(`${participant.name} is busy; restart it when it has finished.`);
    const asked: SeenVibemate = { participant, runtime };
    if (!this.operationHolds(asked)) return participant;
    runtime.session.retiring = true;
    this.dropScheduledTurn(id);
    if (!this.operationHolds(asked)) return participant;
    this.restoredSeen.set(id, runtime.reading.lastSeenSeq);
    await this.retireRuntime(id, runtime);
    const without: SeenVibemate = { participant, runtime: null };
    if (!this.operationHolds(without)) return participant;
    this.push({ type: "participant", participant });
    if (!this.operationHolds(without)) return participant;
    const started = await this.reconnectExpected(participant, { mode: "load", reason: "a newer version of its agent is installed" });
    if (started && this.operationHolds({ participant, runtime: started })) this.requestTurn(id);
    return participant;
  }

  private updateTranscriptModes(): void {
    const mode = this.roomSettings.transcriptMode;
    for (const runtime of this.runtimes.values()) runtime.session.transcript?.setMode(mode);
  }

  private async startAgent(participant: Participant, launch: LaunchPrefs, fresh: boolean, reconnectOptions?: ReconnectOptions): Promise<AgentRuntime> {
    const ticket = this.launchAgent(participant, launch, fresh, reconnectOptions);
    let settle!: () => void;
    const under: StartUnderWay = { ticket, settled: new Promise<void>((done) => { settle = done; }) };
    this.starts.set(ticket.id, under);
    try {
      const runtime = await this.runStart(participant, ticket, fresh);
      this.owedRestart.delete(participant);
      return runtime;
    } finally {
      const before = this.folderPending(participant);
      if (this.starts.get(ticket.id) === under) this.starts.delete(ticket.id);
      try {
        if (before !== this.folderPending(participant) && !this.closing && this.participants.get(ticket.id) === participant) {
          this.push({ type: "participant", participant });
        }
      } finally { settle(); }
    }
  }

  private async runStart(participant: Participant, ticket: StartTicket, fresh: boolean): Promise<AgentRuntime> {
    try {
      const opened = await this.openAgentSession(ticket);
      ticket.check();
      const registered = this.registerAgentSession(ticket, opened);
      const warnings = await this.configureAgentSession(ticket, registered.runtime);
      ticket.check();
      this.readyAgentSession(ticket, registered, opened, warnings);
      return registered.runtime;
    } catch (error) {
      if (error === ticket.abandoned || !ticket.stillWanted()) {
        try {
          if (ticket.registered) this.forgetRuntime(ticket.id, ticket.registered);
        } finally {
          try { await ticket.agent.kill(); } catch { }
        }
        throw error === ticket.abandoned ? error : ticket.abandoned;
      }
      ticket.agent.kill();
      this.forgetRuntime(ticket.id, ticket.registered);
      throw this.failedStart(participant, error, fresh, ticket.stderrTail, ticket.recipe);
    }
  }

  private launchAgent(participant: Participant, launch: LaunchPrefs, fresh: boolean, reconnectOptions?: ReconnectOptions): StartTicket {
    assertAgentAvailable(participant.agentType ?? "");
    const recipe = getRecipe(participant.agentType ?? "");
    if (!recipe) throw new Error(`unknown agent type: ${participant.agentType}`);
    const id = participant.id;
    const name = participant.name;
    const log = this.log.child(name);
    const cwd = ensureDir(this.dir);
    const spec = recipe.build({ model: launch.model, mode: launch.mode });
    const installStamp = recipeStamp(recipe);
    const mode = this.roomSettings.transcriptMode;
    const transcript = new Transcript(join(this.dataDir, "transcripts"), name, mode,
      this.history.path === ":memory:" ? undefined : dirname(this.history.path));
    log.info(`spawning ${spec.command} ${spec.args.join(" ")} (cwd ${cwd}); protocol: ${mode}${mode === "off" ? "" : ` (${transcript.path})`}`);

    const stderrTail: string[] = [];

    const extensions = new ExtensionRouter(
      {
        onAuthStatus: (status) => {
          const p = this.participants.get(id);
          const current = this.runtimes.get(id);
          if (!p || !agent?.alive || this.closing || (current && current.session.agent !== agent)) return;
          p.authStatus = status;
          this.push({ type: "participant", participant: p });
        },
        onBackgroundMessage: (message) => this.onBackgroundMessage(id, agent, message),
      },
      { info: (text) => log.info(`protocol: ${text}`), warn: (text) => log.warn(`protocol: ${text}`) },
    );
    let agent: AcpAgent;
    try {
      agent = new AcpAgent(
        { ...spec, cwd },
        {
          onSessionUpdate: (sessionId, update) => {
            if (this.liveAgentSession(id, agent, sessionId)) this.onSessionUpdate(id, update);
          },
          onPermissionRequest: (params) => this.liveAgentSession(id, agent, params.sessionId)
            ? this.onPermissionRequest(id, params) : Promise.resolve({ outcome: { outcome: "cancelled" } }),
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
          onProtocolError: (text) => extensions.protocolFault(text),
          onExtensionNotification: (method, params) => extensions.notification(method, params),
        },
      );
    } catch (error) {
      throw this.failedStart(participant, error, fresh, stderrTail, recipe);
    }
    const ticket: StartTicket = {
      id, participant, name, recipe, launch, fresh, reconnectOptions, log, cwd, transcript, installStamp, stderrTail, agent,
      abandoned: new Error(`${name} stopped starting: the room closed or the vibemate changed meanwhile`),
      registered: undefined,
      stillWanted: () => !this.closing && this.participants.get(id) === participant
        && this.runtimes.get(id) === ticket.registered,
      check: () => { if (!ticket.stillWanted()) throw ticket.abandoned; },
    };
    return ticket;
  }

  private async openAgentSession(ticket: StartTicket): Promise<OpenedSession> {
    const { id, participant, name, recipe, agent, cwd, log, fresh, reconnectOptions } = ticket;
    const init = await agent.initialize({ name: "viberoom", version: "0.2.0" });
    ticket.check();
    participant.agentInfo = { name: init.agentInfo?.name, version: init.agentInfo?.version };
    if (agent.authMethods.length) {
      log.info(`auth methods advertised: ${agent.authMethods.map((m) => m.id).join(", ")}`);
    }
    participant.supportsLoad = agent.supportsLoadSession;

    const mcp = this.skillMcpServers(id);
    const mcpToken = mcp ? mcp.token : null;
    const mcpServers = mcp ? [mcp.server] : [];
    const meta = sessionMeta(recipe, this.settings, mcpServers.length > 0);

    let session: NewSessionResult | null = null;
    let origin: NonNullable<Participant["sessionOrigin"]> = fresh ? "new" : "replayed";
    if (!fresh && reconnectOptions?.mode === "load") {
      if (!participant.sessionId) this.notice(`${name}: no stored session to load; starting a new one with replayed history.`, "warn");
      else if (participant.sessionDir && participant.sessionDir !== cwd) log.info(`the stored session was opened in ${participant.sessionDir}; a new session in ${cwd} with replayed history`);
      else if (!agent.supportsLoadSession) this.notice(`${name}: this agent does not support session/load; starting a new session with replayed history.`, "warn");
      else {
        try {
          log.info(`session/load ${participant.sessionId}`);
          session = await agent.loadSession(participant.sessionId, cwd, mcpServers, meta);
          origin = "loaded";
        } catch (error) {
          ticket.check();
          this.notice(`${name}: session/load failed (${describeError(error)}); starting a new session with replayed history.`, "warn");
        }
      }
      ticket.check();
    }
    if (!session) session = await openSession(agent, cwd, log, mcpServers, recipe, meta);
    ticket.check();
    return { session, origin, mcpToken, hasMcp: !!mcp };
  }

  private registerAgentSession(ticket: StartTicket, opened: OpenedSession): RegisteredSession {
    const { id, participant, fresh, transcript, log, installStamp, agent } = ticket;
    const { session, origin, mcpToken } = opened;
    participant.sessionId = session.sessionId;
    participant.sessionDir = ticket.cwd;
    participant.sessionOrigin = origin;
    if (origin !== "loaded" || !participant.deliveryEpoch) {
      participant.deliveryEpoch = randomUUID();
      participant.suppliedThrough = undefined;
    }
    const storedSeen = this.restoredSeen.get(id);
    const runtime = createAgentRuntime({
      agent, sessionId: session.sessionId, transcript, log, installStamp, mcpToken, sessionStartedAt: Date.now(),
      lastSeenSeq: this.seq, historyNoticePending: !fresh, replayOwnUntilSeq: fresh || origin === "loaded" ? -1 : this.seq,
      skillChannel: opened.hasMcp ? "pending" : "marker", cwd: ticket.cwd,
    });
    participant.skillChannel = runtime.skills.skillChannel;
    this.runtimes.set(id, runtime);
    ticket.registered = runtime;
    if (mcpToken && this.earlySkillReady.delete(mcpToken)) {
      this.skillToolReady(id, mcpToken);
      ticket.check();
    }
    this.restoredSeen.delete(id);
    participant.configOptions = session.configOptions ?? undefined;
    participant.installOutdated = undefined;
    if (session.modes) {
      participant.mode = session.modes.currentModeId;
      participant.modes = session.modes.availableModes;
    }
    summarizeConfig(participant);
    return { runtime, storedSeen };
  }

  private async configureAgentSession(ticket: StartTicket, runtime: AgentRuntime): Promise<ConfigShortfall[]> {
    const { participant, recipe, launch } = ticket;
    const warnings = await this.agentConfig.applyAtStart(runtime, participant, {
      model: recipe.modelAtLaunch ? null : launch.model,
      effort: launch.effort,
      mode: recipe.modeAtLaunch ? null : launch.mode,
    });
    ticket.check();
    return warnings;
  }

  private readyAgentSession(ticket: StartTicket, registered: RegisteredSession, opened: OpenedSession, warnings: ConfigShortfall[]): void {
    const { id, participant, name, recipe, launch, fresh, reconnectOptions, log } = ticket;
    const { runtime, storedSeen } = registered;
    const { session, origin } = opened;
    if (recipe.modelAtLaunch && launch.model) participant.model = launch.model;
    if (recipe.modeAtLaunch) {
      if (!participant.modes?.length) participant.modes = recipe.modePresets.map((id) => ({ id, name: id }));
      participant.mode = launch.mode ?? recipe.defaultMode ?? participant.mode;
    }
    for (const w of warnings) {
      this.log.warn(`${name}: ${w.log}`);
      this.postSystem(`${name}: ${w.said}.`, "human", false, { agentId: participant.id, tone: "attention" });
      ticket.check();
    }

    presence.ready(participant);
    this.push({ type: "participant", participant });
    ticket.check();
    const line = readyLine({
      name, fresh, origin, reason: reconnectOptions?.reason, tagline: participant.tagline ?? undefined,
      detail: this.settings.showVendorInRoster ? `${recipe.label}${participant.model ? `, model ${participant.model}` : ""}` : "agent",
    });
    if (fresh) {
      this.postRoomEvent(line);
      ticket.check();
      runtime.reading.lastSeenSeq = this.seq;
      participant.sawFromSeq = this.seq + 1;
    } else if (origin === "loaded") {
      runtime.reading.lastSeenSeq = loadedPointer(storedSeen, this.seq, this.settings.replayAfterRestart);
      runtime.session.firstTurnDone = true;
      runtime.brief.briefPending = "reconnected: your stored session was restored";
      this.postRoomEvent(line);
      ticket.check();
      if (participant.sawFromSeq === undefined) participant.sawFromSeq = runtime.reading.lastSeenSeq + 1;
    } else {
      this.postRoomEvent(line);
      ticket.check();
      const replay = Math.max(0, reconnectOptions?.replay ?? this.settings.replayAfterRestart);
      runtime.reading.lastSeenSeq = replayPointer(this.messages.filter((m) => m.kind === "chat"), replay, this.seq);
      participant.sawFromSeq = runtime.reading.lastSeenSeq + 1;
    }
    if (participant.notes) runtime.notes.resumeNotes = resumeNotesSource(origin === "loaded", reconnectOptions, runtime.reading.lastSeenSeq < this.seq);

    const run = this.hubRun();
    if (run) {
      const note = fresh ? null : hubChangeNote(participant, run);
      if (note) runtime.brief.headerNotes.push(note);
      participant.runSeen = run.id;
      participant.buildSeen = run.build;
    }
    this.restoredSeen.delete(id);
    this.push({ type: "participant", participant });
    ticket.check();
    runtime.reading.turnStartSeq = runtime.reading.lastSeenSeq;
    this.rebindNativeReports(id, runtime, origin === "loaded");
    ticket.check();
    this.drainNativeReports(id, runtime);
    log.info(`ready: session ${session.sessionId}`);
  }

  private failedStart(participant: Participant, error: unknown, fresh: boolean, stderr: string[], recipe: AgentRecipe | undefined): Error {
    const id = participant.id;
    const owns = (seen: SeenVibemate) => !this.closing && this.vibemateHeld(seen);
    return failStart({ participant, runtime: null }, error, fresh, stderr, recipe, {
      markFailed: (seen, detail, trouble) => {
        if (!owns(seen)) return false;
        presence.startFailed(participant, detail, trouble);
        return true;
      },
      markStatus: (seen, first) => {
        if (!owns(seen)) return false;
        if (first) presence.startAbandoned(participant);
        else presence.fellAfterStart(participant);
        return true;
      },
      carried: (seen) => (owns(seen) && participant.trouble && participant.statusDetail !== undefined
        ? { detail: participant.statusDetail, trouble: participant.trouble } : undefined),
      publish: (seen) => {
        if (!owns(seen)) return false;
        this.push({ type: "participant", participant });
        return true;
      },
      remove: (seen) => {
        if (!owns(seen)) return false;
        this.participants.delete(id);
        this.push({ type: "participant.removed", id });
        return true;
      },
      log: (text) => this.log.warn(text),
    });
  }

  private mintParticipantId(base: string): string {
    const known = this.knownParticipantIds();
    let id = base;
    for (let n = 2; known.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  nameDirectory(): NameDirectory {
    return new NameDirectory(this.history.nameUses([this.id]), [...this.participants.values()].map((p) => ({ roomId: this.id, id: p.id, name: p.name })));
  }

  private readFormerNames(): void {
    const names = this.nameDirectory();
    for (const p of this.participants.values()) {
      const former = names.formerNames(this.id, p.id);
      p.formerNames = former.length ? former : undefined;
    }
  }

  private knownParticipantIds(): Set<string> {
    const ids = this.history.participantIds(this.id);
    for (const m of this.messages) {
      ids.add(m.from);
      for (const to of m.to) ids.add(to);
    }
    for (const id of this.participants.keys()) ids.add(id);
    for (const id of this.departed.keys()) ids.add(id);
    for (const [, id] of (this.settings.customRules ?? "").matchAll(RULE_REF_TOKEN)) ids.add(id);
    for (const id of this.heldParticipantIds?.() ?? []) ids.add(id);
    return ids;
  }

  async removeParticipant(id: string): Promise<void> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const runtime = this.runtimes.get(id);
    if (runtime) {
      this.dropScheduledTurn(id);
      if (runtime.work.turnActive) runtime.session.agent.cancel(runtime.session.sessionId);
      this.cancelPermissionsOf(id);
      await this.agentSessions.close(id, runtime, { within: 2000, awaitKill: false, closeFailed: (error) => runtime.session.log.warn(`session/close failed: ${String(error)}`) });
      if (this.speaking === id) {
        this.turnOrder.standDown(runtime);
        this.startNext();
      }
    }
    presence.left(participant);
    this.participants.delete(id);
    this.departed.set(id, participant.name);
    this.push({ type: "participant.removed", id });
    this.postRoomEvent(`${participant.name} left the room.`);
  }

  cancelTurn(id: string, expectedTurnId?: string, waitingFor?: { id: string; version: number }): "turn" | "queued" | "nothing" {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) throw new Error("no such agent");
    if (expectedTurnId !== undefined && runtime.work.turn?.message.id !== expectedTurnId) return "nothing";
    if (waitingFor) {
      if (runtime.work.turn?.hidden) return "nothing";
      const message = this.messages.find(m => m.id === waitingFor.id && m.from === "human" && m.kind === "chat");
      if (!message || message.seq <= runtime.reading.lastSeenSeq) return "nothing";
      if (message.to.length && !message.to.includes(id)) return "nothing";
      const delivery = message?.bodyDelivery, reader = delivery?.readers[id];
      if (!delivery || !reader || delivery.version !== waitingFor.version || reader.epoch !== participant.deliveryEpoch || reader.version >= delivery.version) return "nothing";
    }
    if (runtime.work.turnActive || runtime.work.workBusy) {
      runtime.work.workCancelled = true;
      if (runtime.work.turnActive) {
        runtime.session.agent.cancel(runtime.session.sessionId);
        this.watchTheStop(id);
        if (runtime.work.quiet) this.push({ type: "participant", participant });
      }
      this.cancelPermissionsOf(id);
      this.notice(`${participant.name}: stop requested.`, "info");
      return "turn";
    }
    if (runtime.queue.pendingTurn || runtime.queue.delayTimer || this.turnOrder.waiting({ id, participant, runtime })) {
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
    if (!runtime.work.quiet || runtime.work.quiet.turnId !== runtime.work.turn?.message.id) throw new RoomRefusal("that turn is over");
    const call = unchangingCall(participant);
    if (!call) throw new RoomRefusal(`${participant.name} offers no setting to ask about, so there is nothing that can be asked without changing something`);
    const quiet = runtime.work.quiet;
    quiet.nudge = "asking";
    this.push({ type: "participant", participant });
    const answered = await Promise.race([
      (call.kind === "config"
        ? runtime.session.agent.setConfigOption(runtime.session.sessionId, call.id, call.value)
        : runtime.session.agent.setMode(runtime.session.sessionId, call.id)
      ).then(() => true, (error) => {
        this.log.info(`${participant.name}: nudge refused: ${describeError(error)}`);
        return true;
      }),
      delay(NUDGE_WAIT_MS).then(() => false),
    ]);
    const outcome = answered ? "answered" : "silent";
    if (runtime.work.quiet === quiet && runtime.work.quiet.turnId === runtime.work.turn?.message.id) {
      quiet.nudge = outcome;
      this.push({ type: "participant", participant });
    }
    this.postSystem(`${participant.name} ${answered
      ? "still answers — what is stuck is the request to the provider. Stop should work."
      : "does not answer. Stop replaces its process and keeps its session; Fresh start replaces it too and begins a new one."}${by ? ` (nudged by ${by})` : ""}`, "human", false, { agentId: id, tone: "attention" });
    return outcome;
  }

  async setConfig(id: string, configId: string, value: string | boolean, from?: string): Promise<void> {
    return this.agentConfig.set(id, configId, value, from);
  }

  private async replaceForMode(id: string, hold: WorkHold): Promise<AgentRuntime> {
    const expected = hold.runtime, participant = this.participants.get(id);
    if (!participant || this.runtimes.get(id) !== expected || !holdsWork(hold)) throw new Error("the vibemate restarted while its setting was changing; choose the setting again");
    const pendingTurn = expected.queue.pendingTurn, independentPendingTurn = expected.queue.independentPendingTurn, addressed = expected.queue.addressed;
    const replacement = await this.respawnSession(participant, expected, { memory: true, reason: "its mode changed" });
    if (!replacement) throw new Error("the vibemate could not restart with its new mode");
    const free = !replacement.work.workBusy && !replacement.work.turnActive && !replacement.work.workSettled;
    if (!this.operationHolds({ participant, runtime: replacement }) || !free) {
      throw new Error("the new session began other work before the setting could follow; choose it again");
    }
    const handed = this.takeWork(replacement);
    replacement.queue.pendingTurn ||= pendingTurn;
    replacement.queue.independentPendingTurn ||= independentPendingTurn;
    replacement.queue.addressed ||= addressed;
    replacement.queue.pendingConfig = [...(expected.queue.pendingConfig || []), ...(replacement.queue.pendingConfig || [])];
    expected.queue.pendingConfig = undefined;
    const old: WorkHold = { ...hold };
    Object.assign(hold, handed);
    this.releaseWork(old);
    return replacement;
  }

  setLaunch(id: string, patch: { model?: string | null; effort?: string | null; mode?: string | null }, from?: string): Participant {
    return this.agentConfig.setLaunch(id, patch, from);
  }

  permissionPending(key: string): boolean {
    return this.permissions.pending(key);
  }

  private askingHuman(id: string): boolean {
    return this.permissions.waitsOn(id);
  }

  resolvePermission(key: string, optionId: string | null): void {
    this.permissions.resolve(key, optionId);
  }

  postNotice(text: string): void {
    this.postSystem(text);
  }

  closeDoor(): void {
    this.closing = true;
    this.silence.stop();
    this.turnOrder.closeDoor();
    this.turnLife.doorClosed();
  }

  reopenDoor(): void {
    this.closing = false;
  }

  liveVibemates(): { id: string; name: string }[] {
    return [...this.runtimes.keys()].map((id) => ({ id, name: this.participants.get(id)?.name ?? id }));
  }

  writingVibemates(): { id: string; name: string }[] {
    return [...this.participants.values()].filter((p) => p.kind === "agent" && (p.status === "thinking" || p.status === "queued")).map((p) => ({ id: p.id, name: p.name }));
  }

  async shutdown(): Promise<void> {
    this.closeDoor();
    const runtimes = [...this.runtimes.entries()];
    const working = runtimes.map(([, runtime]) => runtime).filter((runtime) => runtime.work.turnActive || runtime.work.workBusy);
    for (const runtime of working) {
      runtime.work.roomStopped = true;
      try {
        if (runtime.work.turnActive) runtime.session.agent.cancel(runtime.session.sessionId);
      } catch {
      }
    }
    const ended = (jobs: AgentRuntime[], ms: number) => jobs.length ? Promise.race([Promise.all(jobs.map((runtime) => runtime.work.workSettled?.promise)), delay(ms)]) : Promise.resolve();
    await ended(working, SHUTDOWN_TURN_STOP_MS);
    for (const [id, runtime] of runtimes) await this.agentSessions.close(id, runtime, { within: 1000, awaitKill: false });
    await ended(working.filter((runtime) => runtime.work.workBusy), SHUTDOWN_SETTLE_MS);
    this.permissions.dispose();
    this.proposalCards.dispose();
    this.design.dispose();
    this.diagramRepairs.dispose();
    this.turnOrder.dispose();
    this.nativeReports.dispose();
    this.draftStream.dispose();
    this.turnPublication.dispose();
    this.silence.dispose();
    this.agentConfig.dispose();
    this.agentNotes.dispose();
    this.automations.dispose();
    this.completions.dispose();
  }


  private route(message: ChatMessage): void {
    const from = this.participants.get(message.from);
    const human = from?.kind === "human";
    if (human) this.turnOrder.resetHops();
    const invoked = human ? message.skill : undefined;
    const skill = invoked ? this.skills?.library.get(invoked.name) : undefined;
    const live = this.wakeableVibemates();
    const skillHolders = !invoked ? undefined : message.to.length ? [] : live.filter((id) => this.hasSkill(this.participants.get(id), invoked.name));
    const decision = decideWake({ author: { id: message.from, human }, addressed: message.to, live, skillHolders,
      agentsWakeEachOther: this.settings.agentsWakeEachOther, focused: this.focused, hops: this.hops, hopLimit: this.hopLimit });
    let targets = [...woken(decision)];
    if (invoked) {
      if (decision.skillMissing) this.notice(`Nobody in this room has the skill "${invoked.name}"; attach it to an agent first, or address one with @.`, "warn");
      if (skill) {
        for (const id of targets) {
          const runtime = this.runtimes.get(id);
          if (runtime) runtime.skills.pendingSkills.push({ name: skill.name, text: renderSkillBody(skill.body, invoked.args), invokedBy: from!.name, extraFiles: skill.extraFiles });
        }
      }
    }
    if (decision.hop === "limit") {
      const who = decision.broadcast ? "the other vibemates" : message.toNames.join(", ");
      this.postRoomEvent(`Hop limit ${this.hopLimit} reached: ${who} will not be prompted until ${this.humanName} writes again.`, undefined, false, { tone: "attention" });
    }
    if (decision.hop === "take") this.turnOrder.countHop();
    if (decision.broadcast && !message.skill && this.settings.turnTaking === "one-at-a-time" && targets.length > 1) targets = shuffle(targets);
    this.push(this.roomEvent());
    for (const id of targets) this.requestTurn(id, message.to.includes(id) || !!message.skill);
  }

  private wakeableVibemates(): string[] {
    return [...this.runtimes.keys()].filter((id) => !this.participants.get(id)?.muted);
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
    const channel = runtime.skills.skillChannel === "tool" ? "tool" : "marker";
    if (!items.length && channel !== "tool") return undefined;
    return { items, channel, canCreate: channel === "tool" };
  }


  private skillsForDesign(participantId: string): RoomDesignContext["skills"] {
    if (!this.skills) return undefined;
    const runtime = this.runtimes.get(participantId);
    const channel = runtime?.skills.skillChannel === "tool" ? "tool" : "marker";
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
    if (!runtime?.session.agent.alive || !runtime.work.turnActive || !runtime.work.turn || runtime.work.turn.hidden || runtime.session.retiring || runtime.work.workCancelled) throw new Error("Memory maintenance is available only during an active visible room turn.");
    return runtime.work.turn.message.id;
  }

  describeRoomForAgent(participantId: string, selector?: string): Record<string, unknown> {
    return this.design.describeRoomForAgent(participantId, selector);
  }


  describeForVisitor(sharesHistory: boolean): Record<string, unknown> {
    return this.design.describeForVisitor(sharesHistory);
  }

  proposalShape(): { context: RoomDesignContext; vibemates: TemplateVibemate[] } {
    return this.design.proposalShape();
  }

  applySettingsFromCard(patch: Record<string, unknown>, line: string): void {
    this.updateSettings(patch);
    this.postRoomEvent(line);
  }

  lintDesignForAgent(participantId: string, kind: "template" | "room", design: RoomDesign): { ok: boolean; errors: string[]; warnings: string[]; preview?: string } {
    return this.design.lintDesignForAgent(participantId, kind, design);
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

  soundForAgent(participantId: string, ref: string): { path: string; mimeType: string; name: string; seconds?: number } {
    this.assertRecordOpenForAgents();
    this.agentInRoom(participantId);
    const match = /^#(\d+)\.(\d+)$/.exec(ref.trim());
    if (!match) throw new Error("a sound's reference is #<message>.<n>, as its \"[audio N · #…]\" line gives it");
    const window = agentReadableWindow(this.messages, Number(match[1]), 0);
    if (!window) throw new Error(`no message #${match[1]} in this room (or it is one the vibemates do not see)`);
    const sound = (window.message.audio ?? []).find((a, i) => (a.n ?? i + 1) === Number(match[2]));
    if (!sound) throw new Error(`message #${match[1]} has no sound ${match[2]}`);
    return { path: this.attachmentPath(sound), mimeType: sound.mimeType, name: sound.name, ...(sound.seconds ? { seconds: sound.seconds } : {}) };
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
    const now = this.participants.get(m.from)?.name;
    const numbers = this.numbersHere(m), differ = numbers?.cited.filter(c => c.here !== c.written) ?? [];
    return {
      seq: m.seq,
      from: m.fromName,
      ...(now && now !== m.fromName ? { now } : {}),
      to: m.toNames,
      at: new Date(m.ts).toISOString(),
      text: m.text,
      ...(differ.length ? { numbers: { writtenOn: numbers!.copy, here: Object.fromEntries(differ.map(c => [`#${c.written}`, c.here === null ? null : `#${c.here}`])) } } : {}),
      ...(files.length ? { files } : {}),
      ...(m.kind === "system" ? { kind: "system" } : {}),
      ...(m.edited ? { edited: true } : {}),
      ...(m.images && m.images.length ? { images: m.images.map((a, i) => ({ ref: `#${m.seq}.${a.n ?? i + 1}`, name: a.name, path: this.attachmentPath(a) })) } : {}),
      ...(m.audio && m.audio.length ? { audio: this.backlogAudio(m) } : {}),
      ...(m.video && m.video.length ? { video: this.backlogVideo(m) } : {}),
      ...(m.quotes && m.quotes.length ? { quotes: m.quotes.map((q) => ({ n: q.n, seq: q.seq, from: q.fromName, text: q.text })) } : {}),
    };
  }

  private backlogVideo(m: ChatMessage): BacklogVideo[] | undefined {
    if (!m.video || !m.video.length) return undefined;
    return m.video.map((v, i) => ({ n: v.n ?? i + 1, ref: `#${m.seq}.${v.n ?? i + 1}`, name: v.name, path: this.attachmentPath(v), ...(v.seconds ? { seconds: v.seconds } : {}) }));
  }

  private backlogAudio(m: ChatMessage): BacklogAudio[] | undefined {
    if (!m.audio || !m.audio.length) return undefined;
    return m.audio.map((a, i) => ({
      n: a.n ?? i + 1,
      ref: `#${m.seq}.${a.n ?? i + 1}`,
      name: a.name,
      path: this.attachmentPath(a),
      ...(a.seconds ? { seconds: a.seconds } : {}),
      ...(a.words !== undefined ? { words: a.words } : {}),
      ...(a.unheard ? { unheard: a.unheard } : {}),
    }));
  }

  private carriedFilePaths(m: ChatMessage): { original: string; path: string }[] {
    return (m.resourceRefs ?? []).filter(ref => isRoomResourceName(ref.file) && m.text.includes(ref.source)).map(ref => ({ original: ref.source, path: join(this.filesDir(), ref.file) }));
  }

  private backlogText(m: ChatMessage): string {
    const files = this.carriedFilePaths(m), numbers = this.numbersHere(m);
    const note = numbers ? numbersNote(numbers.copy, numbers.cited) : "";
    const text = files.length ? `${m.text}\n\n[Files carried with this message; paths on this computer]\n${files.map(file => JSON.stringify(file)).join("\n")}` : m.text;
    return note ? `${text}\n\n${note}` : text;
  }

  numberFromCopy(copy: string, seq: number): number {
    const carry = this.history.carry, wanted = copy.trim().toLowerCase();
    if (this.folderId && (copy === this.folderId || (carry.sourceLabel(this.folderId) ?? "").toLowerCase() === wanted)) return seq;
    const sources = carry.sources().filter(s => s.uuid !== this.folderId);
    const byId = sources.filter(s => s.uuid === copy), named = byId.length ? byId : sources.filter(s => s.label.toLowerCase() === wanted);
    if (named.length > 1) throw new Error(`${named.length} copies of this room are called ${JSON.stringify(copy)}; name one by its identity: ${named.map(s => s.uuid).join(", ")}`);
    if (!named.length) throw new Error(`no copy called ${JSON.stringify(copy)} is known here; the copies this room has heard of: ${sources.map(s => JSON.stringify(s.label)).join(", ") || "none"}`);
    const id = carry.numberedOn(this.id, named[0].uuid, seq), here = id ? this.messageById(id)?.seq : undefined;
    if (here === undefined) throw new Error(`#${seq} of ${named[0].label} is not in this room`);
    return here;
  }

  forWindow(m: ChatMessage): WindowMessage {
    const numbers = this.numbersHere(m), differ = numbers?.cited.filter(c => c.here !== c.written) ?? [];
    if (!differ.length) return m;
    return { ...m, numbersHere: { copy: numbers!.copy, here: Object.fromEntries(differ.map(c => [String(c.written), c.here])) } };
  }

  numbersHere(m: ChatMessage): { copy: string; cited: CitedNumber[] } | null {
    const origin = m.numbering ?? m.origin;
    if (!origin || !this.folderId || origin === this.folderId) return null;
    const cited = citedNumbers(m.text);
    if (!cited.length) return null;
    const carry = this.history.carry;
    return {
      copy: carry.sourceLabel(origin) ?? "another computer",
      cited: cited.map(written => {
        const id = carry.numberedOn(this.id, origin, written);
        return { written, here: id ? this.messageById(id)?.seq ?? null : null };
      }),
    };
  }

  private ensureDeliveryEpoch(participant: Participant): string {
    if (!participant.deliveryEpoch) {
      participant.deliveryEpoch = randomUUID();
      this.push({ type: "participant", participant });
    }
    return participant.deliveryEpoch;
  }

  private publishBodyDelivery(changes: ReadonlyMap<string, BodyDelivery>): void {
    const revised: ChatMessage[] = [];
    for (const [id, delivery] of changes) {
      const row = this.roomMessages.byId(id);
      if (row) revised.push(this.roomMessages.revise({ ...row, bodyDelivery: delivery }));
    }
    if (!revised.length) return;
    this.persistMany(revised.map(message => ({ kind: "upsert", message })));
    this.push({ type: "message.delivery", updates: revised.map(row => ({ id: row.id, delivery: row.bodyDelivery! })) });
  }

  private registerPendingBodies(participant: Participant, rows: readonly ChatMessage[]): void {
    const epoch = this.ensureDeliveryEpoch(participant);
    const changes = new Map<string, BodyDelivery>();
    for (const prepared of rows) {
      const row = this.roomMessages.byId(prepared.id);
      const next = row && withBodyReader(row, participant.id, epoch);
      if (next) changes.set(row.id, next);
    }
    this.publishBodyDelivery(changes);
  }

  private recordBodySupply(participantId: string, refs: BodyRef[], expectedEpoch?: string): void {
    const participant = this.participants.get(participantId);
    if (!participant || !this.runtimes.has(participantId)) return;
    const epoch = this.ensureDeliveryEpoch(participant);
    if (expectedEpoch !== undefined && epoch !== expectedEpoch) return;
    const referenced = new Set(refs.map(ref => ref.id));
    this.noteBodyExposure(participantId, this.messages.filter(row => referenced.has(row.id)).map(row => row.seq));
    const changes = new Map<string, BodyDelivery>();
    for (const row of this.messages) {
      const next = referenced.has(row.id) ? withBodyReader(row, participantId, epoch) : null;
      if (next) changes.set(row.id, next);
    }
    const rows = changes.size ? this.messages.map(row => (changes.has(row.id) ? { ...row, bodyDelivery: changes.get(row.id) } : row)) : this.messages;
    for (const [id, delivery] of suppliedBodies(rows, refs, participantId, epoch)) changes.set(id, delivery);
    this.publishBodyDelivery(changes);
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
    const turn = runtime.work.turnActive && runtime.session.agent?.alive && !runtime.session.retiring && !runtime.work.workCancelled && runtime.work.turn && !runtime.work.turn.hidden ? runtime.work.turn : undefined;
    const searcher = this.participants.get(participantId)!;
    const owner = turn ? { participant: searcher, runtime, turn } : undefined;
    try {
      const result = search();
      const local = result.results.filter(hit => hit.room === this.id);
      this.noteBodyExposure(participantId, local.flatMap(hit => [hit.seq, ...(hit.context ?? []).map(row => row.seq)]));
      const complete = local.flatMap(hit => hit.context ?? []).filter(row => !row.truncated);
      this.recordBodySupply(participantId, bodyRefs(this.messages.filter(message =>
        !message.images?.length && !message.quotes?.length && complete.some(row => row.seq === message.seq && row.text === message.text))));
      if (owner) this.recordHistorySearch(owner, args, result);
      return result;
    } catch (error) {
      if (owner) this.recordHistorySearch(owner, args, undefined, describeError(error));
      throw error;
    }
  }

  private recordHistorySearch(owner: DraftOwner & { readonly turn: DraftTurn }, args: AgentSearchArgs, result?: AgentSearchResult, error?: string): void {
    if (!this.draftStream.holds(owner)) return;
    const turn = owner.turn;
    const calls = (turn.message.toolCalls ??= []);
    const candidates = calls.filter(call => {
      if (call.historySearch || ["completed", "failed"].includes(call.status ?? "") || roomOperation(call)?.name !== "search_history") return false;
      if (!call.rawInput || typeof call.rawInput !== "object" || Array.isArray(call.rawInput)) return false;
      try {
        const input = parseAgentSearchArgs(roomOperation(call)!.arguments);
        return input.query === args.query && input.rooms === args.rooms && input.kinds === args.kinds && input.author === args.author && input.limit === args.limit && input.only === args.only;
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
    if (this.showDraft(owner) === "refused") return;
    this.draftStream.tell(owner, { type: "toolcall", id: turn.message.id, toolCall: view });
  }

  private checkRoomExtras(participantId: string, callerTurn: string, args: MessageCheckArgs): Pick<MessageCheckResult, "vibemates" | "vibematesOmitted" | "liveDraft" | "hopLimitReached" | "hopLimitNotice"> {
    const all = this.whoIsBusy(), vibemates: typeof all = [];
    for (const entry of all) {
      if (Buffer.byteLength(JSON.stringify([...vibemates, entry], null, 2)) > 3 * 1024) break;
      vibemates.push(entry);
    }
    const hopLimitReached = this.hops >= this.hopLimit;
    const extras: ReturnType<Room["checkRoomExtras"]> = {
      vibemates, ...(all.length > vibemates.length ? { vibematesOmitted: all.length - vibemates.length } : {}),
      hopLimitReached,
      ...(hopLimitReached ? { hopLimitNotice: `The room's hop limit has been reached. Agents will not be prompted by other agents until ${this.humanName} writes again. Already active turns continue.` } : {}),
    };
    if (!args.draft) return extras;
    const writer = this.findByName(args.draft.name);
    if (!writer || writer.kind !== "agent" || writer.id === participantId || writer.status === "left") throw new Error("Choose another vibemate in this room for draft.name.");
    const runtime = this.runtimes.get(writer.id), turn = runtime?.work.turn;
    if (!runtime?.session.agent.alive || !runtime.work.turnActive || runtime.session.retiring || runtime.work.workCancelled || !turn || turn.hidden || !turn.published || !visibleToAgents(turn.message)) {
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
    const turn = runtime.work.turn;
    if (!runtime.session.agent.alive || !runtime.work.turnActive || !turn || turn.hidden || runtime.session.retiring || runtime.work.workCancelled || !Number.isSafeInteger(turn.messagesFromSeq)) {
      throw new Error("check_room is available only during an active visible room turn");
    }
    const owner = { participant: this.participants.get(participantId)!, runtime, turn };
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
      this.recordMessageCheck(owner, args, result);
      return result;
    } catch (error) {
      this.recordMessageCheck(owner, args, undefined, describeError(error));
      throw error;
    }
  }

  private recordMessageCheck(owner: DraftOwner & { readonly turn: DraftTurn }, args: MessageCheckArgs, result?: MessageCheckResult, error?: string): void {
    if (!this.draftStream.holds(owner)) return;
    const turn = owner.turn;
    const calls = (turn.message.toolCalls ??= []);
    const candidates = calls.filter(call => {
      if (call.messageCheck || ["completed", "failed"].includes(call.status ?? "") || !(roomOperation(call)?.name === "check_room" || isDirectMessageCheck(call.name ?? call.title))) return false;
      try {
        const input = parseMessageCheckArgs(roomOperation(call)?.arguments ?? (call.rawInput ?? {}) as Record<string, unknown>);
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
    if (this.showDraft(owner) === "refused") return;
    this.draftStream.tell(owner, { type: "toolcall", id: turn.message.id, toolCall: view });
  }


  createTemplateForAgent(participantId: string, design: RoomDesign, replace: boolean): { ok: true; message: string; id: string; path: string; warnings: string[] } {
    return this.design.createTemplateForAgent(participantId, design, replace);
  }


  proposeRoomChanges(participantId: string, why: string, changes: RoomChangeSet, roomSelector?: string): { ok: true; message: string; key: string; warnings: string[] } {
    return this.design.proposeRoomChanges(participantId, why, changes, roomSelector);
  }




  proposeNewRoom(participantId: string, request: Record<string, unknown>): { ok: true; message: string; key: string } {
    const participant = this.agentInRoom(participantId);
    const plan = planNewRoom(request, {
      proposerWasCreated: participant.createdByVibemate === true,
      openCard: this.proposalCards.hasWaitingRoom(),
      proposerName: participant.name,
    });
    const proposal = this.proposalCards.proposeRoom(participant, plan);
    if (!proposal) throw new Error("not proposed: the room has shut down");
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
    return this.proposalCards.newRoomProposals();
  }

  pendingNewRoom(key: string): NewRoomProposal | undefined {
    return this.proposalCards.pendingNewRoom(key);
  }

  settleNewRoom(key: string, status: "created" | "refused", madeAs?: string): NewRoomProposal {
    return this.proposalCards.settleNewRoom(key, status, madeAs);
  }


  describeLooksForAgent(participantId: string): Promise<Record<string, unknown>> {
    return this.design.describeLooksForAgent(participantId);
  }

  lintLookForAgent(participantId: string, raw: unknown): Promise<{ ok: boolean; id?: string; errors: { key: string; message: string }[]; warnings: { key: string; message: string }[]; report: string[] }> {
    return this.design.lintLookForAgent(participantId, raw);
  }

  createLookForAgent(participantId: string, raw: unknown, replace: boolean): Promise<{ ok: true; message: string; id: string; warnings: string[] }> {
    return this.design.createLookForAgent(participantId, raw, replace);
  }

  proposeLookChanges(participantId: string, why: string, changes: LookChangeSet): Promise<{ ok: true; message: string; key: string; warnings: string[] }> {
    return this.design.proposeLookChanges(participantId, why, changes);
  }

  async resolveProposal(key: string, accept: boolean): Promise<RoomProposal> {
    const { proposal, plan } = this.proposalCards.pending(key);
    if (proposal.status !== "pending") return proposal;
    const what = [...proposal.settings.map((c) => c.key), ...proposal.vibemates.map((o) => `${o.op} ${o.name}`), ...(proposal.appearance ?? []).map((c) => c.key)].join(", ")
      + (proposal.room ? ` for the room ${proposal.room.name}` : "");
    if (!accept) return this.proposalCards.reject(key, what);
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
      if (!plan.roomId) this.updateSettings(patch);
      else {
        const target = this.skills?.rooms?.get(plan.roomId);
        if (!target) skipped.push(`the settings (the room ${proposal.room?.name ?? plan.roomId} is gone)`);
        else if (target.readOnly) skipped.push(`the settings (${target.settings.name} waits for its record to be released)`);
        else target.applySettingsFromCard(patch, `${this.settings.humanName} applied ${proposal.participantName}'s proposal from the room ${this.settings.name} (${proposal.settings.map((c) => c.key).join(", ")}).`);
      }
    }
    if (plan.appearance) {
      try {
        if (!this.skills?.appearance) throw new Error("looks are not available in this room");
        this.skills.appearance.apply(plan.appearance);
      } catch (error) {
        skipped.push(`appearance (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    return this.proposalCards.applied(key, what, skipped);
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
    if (!runtime || runtime.session.mcpToken !== token) {
      this.earlySkillReady.add(token);
      return;
    }
    if (!participant) return;
    const late = runtime.skills.skillChannel === "marker";
    runtime.skills.skillChannel = "tool";
    participant.skillChannel = "tool";
    for (const wake of runtime.skills.skillReadyWaiters.splice(0)) wake();
    runtime.session.log.info(`skills: the ${SKILL_TOOL_NAME} tool is available${late ? " (late; brief will be refreshed)" : ""}`);
    this.push({ type: "participant", participant });
  }

  private async awaitSkillChannel(participant: Participant, runtime: AgentRuntime): Promise<void> {
    if (runtime.skills.skillChannel !== "pending") return;
    const remaining = runtime.session.sessionStartedAt + SKILL_TOOL_READY_MS - Date.now();
    if (remaining > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        runtime.skills.skillReadyWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (runtime.skills.skillChannel === "pending") {
      runtime.skills.skillChannel = "marker";
      participant.skillChannel = "marker";
      runtime.session.log.info("skills: no MCP tools listed in time; using the [skill:name] marker");
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
      from: participant.id,
      fromName: participant.name,
      to: [],
      toNames: [],
      text: `loaded skill "${skill.skill.name}"`,
      ts: Date.now(),
      kind: "hidden",
      details: { skill: skill.skill.name, via: "tool", outcome: "delivered as a tool result" },
    });
    runtime.session.log.info(`skills: "${skill.skill.name}" loaded through the tool`);
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
      if (participant && this.hasSkill(participant, name)) runtime.brief.skillCatalogPending = true;
    }
  }

  private turnBoundWork(): TurnLife {
    const life = new TurnLife();
    life.subscribe(this.completions.turnSubscriber());
    life.subscribe(this.automations.turnSubscriber());
    life.subscribe(this.diagramRepairs.turnSubscriber());
    return life;
  }

  private forgetRuntime(id: string, expected?: AgentRuntime): void {
    if (expected && this.runtimes.get(id) !== expected) return;
    this.turnLife.sessionEnded(id);
    const runtime = this.runtimes.get(id);
    if (expected && runtime !== expected) return;
    if (runtime?.session.mcpToken) this.skills?.revokeToken(runtime.session.mcpToken);
    if (runtime) this.turnOrder.sessionEnded(id, runtime);
    this.runtimes.delete(id);
  }

  private requestTurn(id: string, addressed = false, missedNotice = false, backgroundCorrection = false, cause: "ordinary" | "native" | "resume" = "ordinary"): void {
    this.turnOrder.request(id, { addressed, missedNotice, backgroundCorrection, cause });
  }

  private tryStartTurn(id: string): void {
    const participant = this.participants.get(id), runtime = this.runtimes.get(id);
    if (participant && runtime) this.turnOrder.tryStart({ id, participant, runtime });
  }

  humanTyping(): void {
    this.turnOrder.humanTyping();
  }

  private startNext(): void {
    this.turnOrder.next();
  }

  private dropScheduledTurn(id: string): void {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    this.turnLife.turnDropped(id, runtime);
    if (this.participants.get(id) !== participant || this.runtimes.get(id) !== runtime) return;
    this.turnOrder.drop(id, runtime);
    if (participant && presence.unqueue(participant)) this.push({ type: "participant", participant });
  }

  private async runTurn(id: string): Promise<void> {
    const participant = this.participants.get(id);
    const runtime = this.runtimes.get(id);
    if (!participant || !runtime || runtime.work.turnActive || runtime.work.workBusy || this.nativeLaneBlocked(runtime)) return;
    const hold = this.takeWork(runtime);
    runtime.work.workCancelled = false;
    runtime.queue.addressed = false;
    const turn: Turn = { id, runtime };
    try {
      this.turnOrder.begin(turn);
      try {
        this.turnLife.turnStarted(turn);
        await this.runTurnInner(id, participant, hold);
      } finally {
        try { this.turnLife.turnEnded(turn); }
        finally { this.turnOrder.end(turn); }
      }
    } finally {
      try {
        if (presence.unqueue(participant)) this.push({ type: "participant", participant });
      } finally {
        await this.finishRuntimeWork(id, hold);
      }
    }
  }

  private takeWork(runtime: AgentRuntime): WorkHold {
    runtime.work.workBusy = true;
    if (!runtime.work.workSettled) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      runtime.work.workSettled = { promise, resolve };
    }
    return { runtime, gate: runtime.work.workSettled };
  }

  private releaseWork(hold: WorkHold): void {
    if (holdsWork(hold)) {
      hold.runtime.work.workBusy = false;
      hold.runtime.work.workSettled = undefined;
    }
    hold.gate.resolve();
  }

  private async finishRuntimeWork(id: string, hold: WorkHold): Promise<void> {
    try { await this.agentConfig.applyPending(id, hold); }
    finally { this.resumeRuntimeWork(id, hold); this.startNext(); }
  }

  private resumeRuntimeWork(id: string, hold: WorkHold): void {
    const runtime = hold.runtime;
    this.releaseWork(hold);
    if (this.closing || runtime.session.retiring || this.runtimes.get(id) !== runtime || !runtime.session.agent.alive) return;
    this.drainNativeReports(id, runtime);
    if (runtime.work.workBusy || this.nativeLaneBlocked(runtime)) return;
    if (this.agentNotes.resumeDeferred(id, runtime)) return;
    const participant = this.participants.get(id);
    if (!participant || participant.muted || this.focused || participant.status === "error" || this.recordHold) {
      runtime.work.promptedThisWork = false;
      return;
    }
    if (runtime.native.backgroundCorrections?.length && !this.automations.has(id)) {
      this.requestTurn(id, false, false, true);
    } else if (this.completions.waiting(id)) {
      this.requestTurn(id);
    } else if (this.agentNotes.startPending(id, runtime)) {
    } else if (runtime.queue.pendingTurn) {
      this.requestTurn(id, false, false, false, "resume");
    } else if (this.missedWhileWorking(id, runtime)) {
      this.requestTurn(id, false, true);
    }
    runtime.work.promptedThisWork = false;
  }

  private missedWhileWorking(id: string, runtime: AgentRuntime): boolean {
    if (!this.settings.missedMessagesNotice || !runtime.work.promptedThisWork || runtime.queue.missedNotice || runtime.work.workCancelled) return false;
    const participant = this.participants.get(id);
    if (!participant || participant.muted || participant.status === "error" || this.focused || this.recordHold) return false;
    if (!this.missedChat(id, runtime).length) return false;
    if (this.hops >= this.hopLimit) return false;
    this.hops += 1;
    this.push(this.roomEvent());
    return true;
  }

  private missedChat(id: string, runtime: AgentRuntime): ChatMessage[] {
    return this.messages.filter(m => m.kind === "chat" && m.from !== id && m.audience !== "human" && !m.streaming && m.seq > runtime.reading.lastSeenSeq);
  }

  private noticeOnly(id: string, runtime: AgentRuntime): boolean {
    return !!runtime.queue.missedNotice && !this.automations.has(id) && !this.diagramRepairs.has(id);
  }

  private addressedIn(id: string, messages: readonly ChatMessage[]): number[] {
    return messages.filter(m => m.kind === "chat" && (m.to.length === 0 || m.to.includes(id))).map(m => m.seq);
  }

  private parallelWorkNote(id: string): string | null {
    const starting: string[] = [];
    const midTurn: string[] = [];
    for (const [otherId, other] of this.runtimes) {
      if (otherId === id) continue;
      const p = this.participants.get(otherId);
      if (!p || p.kind !== "agent" || p.muted || !other.session.agent.alive || other.session.retiring || p.status === "left" || p.status === "error") continue;
      if (other.work.turnActive || other.work.workBusy) midTurn.push(p.name);
      else if (this.settings.turnTaking !== "one-at-a-time" && (other.queue.pendingTurn || other.queue.delayTimer || this.turnOrder.waiting({ id: otherId, participant: p, runtime: other }) || p.status === "queued")) starting.push(p.name);
    }
    if (!starting.length && !midTurn.length) return null;
    const clauses: string[] = [];
    if (starting.length) clauses.push(`${starting.join(", ")} start${starting.length === 1 ? "s" : ""} a turn in parallel with you right now`);
    if (midTurn.length) clauses.push(`${midTurn.join(", ")} ${midTurn.length === 1 ? "is" : "are"} mid-turn`);
    return `${clauses.join("; ")}.`;
  }

  private ordinaryWakeDisposition(wake: OrdinaryWakeClaim, participant: Participant, runtime: AgentRuntime): "allowed" | "suppressed" | "held" {
    if (wake.independent) return "allowed";
    try { return wake.native.some(ref => this.nativePromptEligible(ref, participant, runtime)) ? "allowed" : "suppressed"; }
    catch { this.nativeFault({ id: participant.id, participant, runtime }, "native_route_authority_unknown"); return "held"; }
  }

  private consumeNativeWake(runtime: AgentRuntime, captured: readonly NativeObligationRef[]): void {
    const same = (a: NativeObligationRef, b: NativeObligationRef) => a.obligationId === b.obligationId && a.subject.id === b.subject.id
      && a.subject.roomUuid === b.subject.roomUuid && a.subject.reportHash === b.subject.reportHash;
    runtime.native.nativePromptObligations = (runtime.native.nativePromptObligations ?? []).filter(ref => !captured.some(old => same(old, ref)));
  }

  private dispatchHeld(owner: DispatchOwner): boolean {
    const { participant, runtime, turn } = owner;
    return this.dispatchOwnerCurrent(participant, runtime, !!turn.hidden) && runtime.work.turn === turn && holdsWork(owner);
  }

  private dispatchOwnerCurrent(participant: Participant, runtime: AgentRuntime, hidden: boolean): boolean {
    return !this.closing && !this.readOnly && this.participants.get(participant.id) === participant && this.runtimes.get(participant.id) === runtime
      && runtime.session.agent.alive && !runtime.session.retiring && !runtime.work.workCancelled
      && (hidden || !participant.muted && !this.focused);
  }

  private ordinaryPreparationCurrent(plan: OrdinaryPromptPreparation): boolean {
    return plan.sourceRevision === this.messageCheckRevision && plan.sourceRows.every(({ row, stamp }) =>
      this.messages.find(current => current.id === row.id) === row && JSON.stringify(row) === stamp);
  }

  private preparationFields(runtime: AgentRuntime): PreparationFields {
    return preparationFields(runtime);
  }

  private readonly turnDispatch: TurnDispatchPorts = {
    startTurn: (owner) => {
      if (!this.dispatchHeld(owner)) return false;
      const { participant } = owner;
      presence.startTurn(participant);
      this.push({ type: "participant", participant });
      return true;
    },
    holdDraft: (draft) => { this.drafts.set(draft.id, draft); },
    releaseDraft: (draft) => { this.drafts.delete(draft.id); },
    turnDiscarded: (participant, runtime) => {
      if (this.runtimes.get(participant.id) === runtime && this.participants.get(participant.id) === participant && presence.quietTurnEnded(participant)) {
        this.push({ type: "participant", participant });
      }
    },
    ownerCurrent: (owner) => this.dispatchHeld(owner),
    nativeLaneBlocked: (runtime) => this.nativeLaneBlocked(runtime),
    wakeDisposition: (wake, participant, runtime) => this.ordinaryWakeDisposition(wake, participant, runtime),
    consumeNativeWake: (runtime, refs) => this.consumeNativeWake(runtime, refs),
    preparationCurrent: (plan) => this.ordinaryPreparationCurrent(plan),
    nativeEligible: (ref, participant, runtime) => this.nativePromptEligible(ref, participant, runtime),
    startNative: (ref, participant, runtime) => this.startNativePrompt(ref, participant, runtime),
    nativeTransition: (ref, phase) => this.nativeTransition(ref, phase),
    nativeFault: (participant, runtime, reason) => this.nativeFault({ id: participant.id, participant, runtime }, reason),
    recordPrompt: (draft, participant, blocks, hidden, correction, extras) => {
      if (this.roomSettings.recordPrompts) this.recordPrompt(draft.id, participant, blocks, hidden, correction, extras.memorySearch);
    },
    send: (owner, blocks, extras) => {
      const { participant, runtime, turn } = owner, hidden = !!extras.hidden;
      if (!this.dispatchHeld(owner)) return { unsent: "gone" };
      if (this.nativeLaneBlocked(runtime)) return { unsent: "deferred" };
      if (extras.ordinaryPreparation) {
        this.commitOrdinaryPreparation(participant, runtime, extras.ordinaryPreparation);
        turn.messagesFromSeq = runtime.reading.lastSeenSeq;
      }
      if (!hidden) this.completions.confirmed(participant.id, false);
      runtime.work.usageSeenThisTurn = false;
      runtime.work.fixedDiagramThisTurn = false;
      this.silence.watch();
      return { sent: runtime.session.agent.prompt(runtime.session.sessionId, blocks) };
    },
    metadata: (owner, extras, epoch) => {
      const { participant, runtime } = owner, failures: unknown[] = [];
      if (extras.ordinaryPreparation && this.runtimes.get(participant.id) === runtime) {
        try { this.registerPendingBodies(participant, extras.ordinaryPreparation.bodies); }
        catch (error) { failures.push(error); }
      }
      if (!extras.hidden && this.runtimes.get(participant.id) === runtime) {
        try { this.recordBodySupply(participant.id, extras.supplied ?? [], epoch); }
        catch (error) { failures.push(error); }
      }
      return failures;
    },
    log: (runtime, text) => runtime.session.log.warn(text),
  };

  private publicationHeld(owner: PublicationOwner): boolean {
    const { participant, runtime } = owner, id = participant.id;
    if (this.participants.get(id) !== participant) return false;
    if (owner.phase === "background") return this.runtimes.get(id) === runtime && !runtime.work.turn && !runtime.work.turnActive && !runtime.work.workBusy;
    const holder = this.runtimes.get(id);
    return (!holder || holder === runtime) && holdsWork(owner);
  }

  private publicationOpen(owner: PublicationOwner): boolean {
    return !this.closing && this.publicationHeld(owner);
  }

  private readonly turnPublication: TurnPublication = new TurnPublication({
    held: (owner) => this.publicationHeld(owner),
    withdraw: (draft, retry) => {
      this.push({ type: "message.removed", id: draft.id });
      if (retry) this.closeRetry(retry, "the session was replaced; nothing was posted");
    },
    humanName: () => this.humanName,
    refereeAction: () => this.settings.refereeAction,
    referee: (participant, text) => this.referee(participant, text),
    mentions: (text) => this.parseMentions(text),
    correctionHeader: (participant) => buildHeader(this.roomSettings.effective(), this.personaOf(participant), this.roster(), this.hops, [
      "your last reply was not posted; see the correction below",
    ]),
    postedAfter: (messageId, ts) => this.messages.some((x) => x.kind === "chat" && x.id !== messageId && x.ts > ts),
    resolveSkill: (participant, name) => this.resolveAgentSkill(participant, name),
    commit: (owner, draft) => this.publicationHeld(owner) ? this.commit(draft) : null,
    push: (owner, event) => {
      if (!this.publicationHeld(owner)) return false;
      this.push(event);
      return true;
    },
    postRoomEvent: (owner, text, audience, wakes, details) => this.publicationHeld(owner) ? this.postRoomEvent(text, audience, wakes, details) : null,
    postSystem: (owner, text, audience, wakes, details) => this.publicationHeld(owner) ? this.postSystem(text, audience, wakes, details) : null,
    notice: (owner, text, level) => {
      if (!this.publicationHeld(owner)) return false;
      this.notice(text, level);
      return true;
    },
    closeRetry: (owner, retry, outcome) => {
      if (!this.publicationHeld(owner)) return false;
      this.closeRetry(retry, outcome);
      return true;
    },
    compaction: (owner, used, size) => {
      if (!this.publicationHeld(owner)) return false;
      this.checkForCompaction(owner.participant, owner.runtime, used, size);
      return true;
    },
    keepNotes: (owner, notes, via) => !this.publicationHeld(owner) ? "refused" : this.agentNotes.keep(owner.participant, owner.runtime, notes, via) ? "kept" : "none",
    askNotes: (owner, how) => this.publicationOpen(owner) && this.agentNotes.ask(owner.runtime, how),
    contextFull: (owner, detail) => {
      if (!this.publicationOpen(owner)) return false;
      this.contextFull(owner.participant, owner.runtime, detail);
      return true;
    },
    requestTurn: (owner) => {
      if (!this.publicationOpen(owner)) return false;
      this.requestTurn(owner.participant.id);
      return true;
    },
    route: (owner, message) => {
      if (!this.publicationOpen(owner)) return false;
      this.route(message);
      return true;
    },
    queueBackgroundCorrection: (owner, retry) => {
      if (!this.publicationOpen(owner)) return false;
      this.queueBackgroundCorrection(owner.participant.id, owner.runtime, retry);
      return true;
    },
    unconfirmed: (owner, messageId, retry, reportHash) => {
      this.unconfirmedBackground.set(messageId, { participant: owner.participant, runtime: owner.runtime, retry, reportHash, due: false });
    },
    automationAssigned: (id) => this.automations.has(id),
    automationEnded: (owner, outcome) => {
      if (!this.publicationHeld(owner)) return false;
      this.automations.ended(owner.participant.id, outcome);
      return true;
    },
    automationFailed: (owner, detail) => {
      if (!this.publicationHeld(owner)) return false;
      this.automations.failed(owner.participant.id, detail);
      return true;
    },
    automationDelivered: (owner, stored, messageId) => {
      if (!this.publicationHeld(owner)) return false;
      this.automations.delivered(owner.participant.id, stored, messageId);
      return true;
    },
    automationContinuing: (owner, value) => {
      if (!this.publicationHeld(owner)) return false;
      this.automations.continuing(owner.participant.id, value);
      return true;
    },
    completionCarried: (id) => this.completions.carriedBy(id),
    completionConfirmed: (owner, value) => {
      if (!this.publicationHeld(owner)) return false;
      this.completions.confirmed(owner.participant.id, value);
      return true;
    },
    completionContinuing: (owner, value) => {
      if (!this.publicationHeld(owner)) return false;
      this.completions.continuing(owner.participant.id, value);
      return true;
    },
  });

  private readonly turnPreparation: TurnPreparationPorts = {
    messages: () => this.messages,
    seq: () => this.seq,
    messageCheckRevision: () => this.messageCheckRevision,
    settings: () => this.settings,
    effectiveSettings: () => this.roomSettings.effective(),
    persona: (participant) => this.personaOf(participant),
    roster: () => this.roster(),
    skillsForPrompt: (owner) => this.skillsForPrompt(owner.participant, owner.runtime),
    memory: (scope) => this.history.memory.read(scope === "user" ? "user" : `room:${this.uuid}`),
    memoryGraph: (addressed, seqs) => this.memoryGraph(this.id, addressed, seqs),
    memoryWhy: (addressed) => this.memoryWhy(this.id, addressed),
    addressedIn: (id, messages) => this.addressedIn(id, messages),
    noticeOnly: (owner) => this.noticeOnly(owner.participant.id, owner.runtime),
    missedChat: (owner) => this.missedChat(owner.participant.id, owner.runtime),
    automationHas: (id) => this.automations.has(id),
    repairsHas: (id) => this.diagramRepairs.has(id),
    parallelNote: (id) => this.parallelWorkNote(id),
    hops: () => this.hops,
    readOnly: () => this.readOnly,
    connections: () => this.connections(this.uuid),
    notesForBrief: (owner) => this.agentNotes.forBrief(owner.participant, owner.runtime),
    earlierChats: (beforeSeq) => this.messages.reduce((count, m) => count + Number(m.seq < beforeSeq && m.kind === "chat" && !m.streaming && visibleToAgents(m)), 0),
    render: { text: (m) => this.backlogText(m), audio: (m) => this.backlogAudio(m), video: (m) => this.backlogVideo(m), attachmentPath: (a) => this.attachmentPath(a) },
    promptBlocks: (prompt, runtime) => this.promptBlocks(prompt, runtime),
    automationBlock: (id) => this.automations.block(id),
    completionBlock: (completion) => this.completions.block(completion),
    pendingRepairs: (id) => this.diagramRepairs.pendingFor(id),
    repairBlock: (task) => this.diagramRepairs.block(task),
    log: (owner, text) => {
      if (this.closing || this.participants.get(owner.participant.id) !== owner.participant || this.runtimes.get(owner.participant.id) !== owner.runtime) return false;
      owner.runtime.session.log.info(text);
      return true;
    },
  };

  private commitOrdinaryPreparation(participant: Participant, runtime: AgentRuntime, plan: OrdinaryPromptPreparation): void {
    const { expected: was, next } = plan;
    const { queue, work, reading, notes, brief, session } = runtime;
    compareAndSet(queue, "missedNotice", was.missedNotice, next.missedNotice);
    compareAndSet(work, "promptedThisWork", was.promptedThisWork, next.promptedThisWork);
    compareAndSet(reading, "turnStartSeq", was.turnStartSeq, next.turnStartSeq);
    compareAndSet(reading, "lastSeenSeq", was.lastSeenSeq, next.lastSeenSeq);
    compareAndSet(notes, "notesDue", was.notesDue, next.notesDue);
    compareAndSet(notes, "notesAskedThisTurn", was.notesAskedThisTurn, next.notesAskedThisTurn);
    compareAndSet(brief, "instructionRevisions", was.instructionRevisions, next.instructionRevisions);
    compareAndSet(brief, "skillCatalogPending", was.skillCatalogPending, next.skillCatalogPending);
    compareAndSet(brief, "memoryStamp", was.memoryStamp, next.memoryStamp);
    compareAndSet(brief, "memoryGraphStamp", was.memoryGraphStamp, next.memoryGraphStamp);
    compareAndSet(brief, "briefPending", was.briefPending, next.briefPending);
    compareAndSet(brief, "turnsSinceBrief", was.turnsSinceBrief, next.turnsSinceBrief);
    compareAndSet(brief, "briefSentThisTurn", was.briefSentThisTurn, next.briefSentThisTurn);
    compareAndSet(brief, "lastBriefSeq", was.lastBriefSeq, next.lastBriefSeq);
    compareAndSet(notes, "resumeNotes", was.resumeNotes, next.resumeNotes);
    compareAndSet(session, "firstTurnDone", was.firstTurnDone, next.firstTurnDone);
    compareAndSet(reading, "replayOwnUntilSeq", was.replayOwnUntilSeq, next.replayOwnUntilSeq);
    if (runtime.brief.headerNotes === plan.headerArray && plan.headers.every((line, i) => runtime.brief.headerNotes[i] === line)) runtime.brief.headerNotes.splice(0, plan.headers.length);
    if (runtime.skills.pendingSkills === plan.skillArray && plan.skills.every((skill, i) => runtime.skills.pendingSkills[i] === skill)) runtime.skills.pendingSkills.splice(0, plan.skills.length);
    if (plan.brief) participant.briefsSent = (participant.briefsSent ?? 0) + 1;
    for (const task of plan.repairs) this.diagramRepairs.delivered(participant.id, task);
    if (plan.completion) this.completions.prepared(participant.id, plan.completion);
  }

  private async runTurnInner(id: string, participant: Participant, hold: WorkHold): Promise<void> {
    const runtime = hold.runtime;
    runtime.queue.pendingTurn = false;
    if (!runtime.session.agent.alive || participant.muted || this.focused || runtime.work.workCancelled) return;
    const correction = !this.automations.has(id) && !this.completions.carriedBy(id) ? runtime.native.backgroundCorrections?.shift() : undefined;
    if (correction) {
      const backlogPending = runtime.native.backgroundBacklogPending;
      runtime.native.backgroundBacklogPending = false;
      await this.executeTurn(participant, hold, [{ type: "text", text: correction.prompt }], correction);
      if (runtime.native.backgroundCorrections?.includes(correction)) runtime.native.backgroundBacklogPending ||= backlogPending;
      if (backlogPending || runtime.native.backgroundCorrections?.length) runtime.queue.pendingTurn = true;
      return;
    }
    const wake: OrdinaryWakeClaim = { independent: !!runtime.queue.independentPendingTurn || this.automations.has(id)
      || this.diagramRepairs.has(id) || this.completions.waiting(id), native: [...(runtime.native.nativePromptObligations ?? [])] };
    runtime.queue.independentPendingTurn = false;
    const admission = this.ordinaryWakeDisposition(wake, participant, runtime);
    if (admission !== "allowed") {
      if (admission === "suppressed") this.consumeNativeWake(runtime, wake.native);
      else runtime.queue.pendingTurn = true;
      return;
    }
    await this.awaitSkillChannel(participant, runtime);
    if (this.settings.remembers && !this.noticeOnly(id, runtime)) {
      await this.memoryGraphReady(this.id, this.addressedIn(id, this.messages.filter(m => m.seq > runtime.reading.lastSeenSeq)));
    }
    if (!runtime.session.agent.alive || runtime.session.retiring || this.runtimes.get(id) !== runtime || participant.muted || this.focused || runtime.work.workCancelled) return;

    const queued = !this.automations.has(id) ? this.completions.next(id) : undefined;
    const claim = queued && this.completions.claim(id, queued);
    if (claim && claim.kind !== "carried") {
      if (claim.kind === "refused") {
        runtime.queue.pendingTurn = true;
        runtime.queue.independentPendingTurn ||= wake.independent;
      }
      if (claim.kind === "failed") runtime.session.log.warn(`background completion is waiting for storage: ${describeError(claim.error)}`);
      return;
    }
    const completion = claim ? claim.completion : undefined;

    const beforePreparation = this.ordinaryWakeDisposition(wake, participant, runtime);
    if (beforePreparation !== "allowed") {
      if (beforePreparation === "suppressed") this.consumeNativeWake(runtime, wake.native);
      else runtime.queue.pendingTurn = true;
      return;
    }

    const prepared = await prepareOrdinaryTurn({ participant, runtime }, { wake, ...(completion ? { completion } : {}) }, this.turnPreparation);
    if (prepared.kind === "nothing") return;
    if (!this.dispatchOwnerCurrent(participant, runtime, false) || !holdsWork(hold)) return;
    if (this.nativeLaneBlocked(runtime)) {
      runtime.queue.independentPendingTurn ||= wake.independent;
      runtime.queue.pendingTurn = true;
      return;
    }
    const retry = await this.executeTurn(participant, hold, prepared.blocks, null, { historyNoticeOffered: prepared.historyNoticeOffered, nativeHeaderOffered: true,
      ordinaryPreparation: prepared.preparation, supplied: prepared.supplied, ...(prepared.memorySearch ? { memorySearch: prepared.memorySearch } : {}) });
    if (retry) {
      await this.executeTurn(participant, hold, [{ type: "text", text: retry.prompt }], retry);
    }
  }

  static readonly PROMPTS_KEPT = 300;
  private static readonly PROMPTS_SLACK = 50;
  private promptsDir(): string {
    return join(this.dataDir, "prompts");
  }
  private recordPrompt(messageId: string, participant: Participant, blocks: ContentBlock[], hidden: boolean, correction: boolean, memory?: PromptMemoryNote): void {
    try {
      const dir = ensureDir(this.promptsDir());
      const kept = blocks.map((b) =>
        b.type === "text" ? { type: "text", text: b.text }
        : b.type === "image" ? { type: "image", mimeType: b.mimeType, bytes: Math.floor((b.data.length * 3) / 4) }
        : { type: b.type },
      );
      writeFileSync(join(dir, `${messageId}.json`), JSON.stringify({ messageId, at: Date.now(), vibemate: participant.name, hidden, correction, blocks: kept, ...(memory ? { memory } : {}) }));
      const names = readdirSync(dir).filter((n) => n.endsWith(".json"));
      if (names.length > Room.PROMPTS_KEPT + Room.PROMPTS_SLACK) {
        const byAge = names.map((n) => ({ n, at: statSync(join(dir, n)).mtimeMs })).sort((a, b) => a.at - b.at);
        for (const { n } of byAge.slice(0, names.length - Room.PROMPTS_KEPT)) rmSync(join(dir, n), { force: true });
      }
    } catch (error) {
      this.log.warn(`the prompt of ${participant.name}'s turn could not be kept: ${describeError(error)}`);
    }
  }
  promptOf(messageId: string): unknown {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(messageId)) return null;
    try {
      return JSON.parse(readFileSync(join(this.promptsDir(), `${messageId}.json`), "utf8"));
    } catch {
      return null;
    }
  }

  private async promptBlocks(parts: PromptPart[], runtime: AgentRuntime): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = [];
    const budget = new PromptBudget(parts.reduce((bytes, part) => part.type === "text" ? bytes + Buffer.byteLength(JSON.stringify(part.text)) : bytes, 0));
    for (const part of parts) {
      if (part.type === "text") {
        blocks.push({ type: "text", text: part.text });
        continue;
      }
      const view: AgentView = this.pictures
        ? await this.pictures.forAgent(part.image.path, part.image.mimeType, { room: this.id, file: basename(part.image.path) })
        : { path: part.image.path, mimeType: part.image.mimeType };
      if ("unavailable" in view) {
        blocks.push({ type: "text", text: ` (${part.image.ref} is not shown: ${view.unavailable})` });
        continue;
      }
      try {
        if (!budget.take((await stat(view.path)).size)) {
          runtime.session.log.info(`image ${part.image.ref} is not attached: the turn's pictures before it fill the message`);
          blocks.push({ type: "text", text: ` (${part.image.ref} is not attached: with it this message would pass the ${AGENT_MESSAGE_MAX_BYTES / 1024 / 1024} MiB one message to you may carry; it is in the room)` });
          continue;
        }
        blocks.push({ type: "image", data: (await readFile(view.path)).toString("base64"), mimeType: view.mimeType });
      } catch (error) {
        runtime.session.log.warn(`image ${part.image.ref} could not be read: ${describeError(error)}`);
        blocks.push({ type: "text", text: ` (${part.image.ref} could not be read: ${part.image.path})` });
      }
    }
    return blocks;
  }

  private async executeTurn(participant: Participant, hold: WorkHold, blocks: ContentBlock[], retry: RetryRequest | null, extras: TurnExtras = {}): Promise<RetryRequest | null> {
    const { hidden = false, historyNoticeOffered = false } = extras;
    const id = participant.id;
    const { runtime, gate } = hold;
    const dispatched = await dispatchTurn(participant, { runtime, gate }, blocks, retry, extras, errorName, describeError, this.turnDispatch);
    if (dispatched.kind !== "settled") return null;
    return this.turnPublication.settle({ phase: "settled", participant, runtime, gate }, dispatched, retry, { hidden, historyNoticeOffered });
  }

  private finalizeTurn(owner: SettledOwner, draft: ChatMessage, result: PromptResult, durationMs: number, retry: RetryRequest | null,
    published: boolean, publishedAt: number | null = null, hidden = false): RetryRequest | null {
    return this.turnPublication.finalize(owner, draft, result, durationMs, retry, published, publishedAt, hidden);
  }

  private publishAgentReply(owner: PublicationOwner, draft: ChatMessage, result: PromptResult, durationMs: number | undefined,
    publishedAt: number | null, retry: RetryRequest | null, endedBy?: ChatMessage["cancelledBy"]): RetryRequest | null {
    return this.turnPublication.publish(owner, draft, result, durationMs, publishedAt, retry, endedBy);
  }

  private closeRetry(retry: RetryRequest, outcome: string): void {
    const row = this.roomMessages.byId(retry.recordId);
    if (!row) return;
    this.reviseRecorded({ ...row, details: { ...(row.details ?? { original: retry.original, corrections: retry.corrections }), outcome } });
  }

  private referee(participant: Participant, text: string): string[] {
    const corrections: string[] = [];
    const unknown: string[] = [];
    let selfNamed = false;
    for (const match of spokenText(text).matchAll(MENTION_PATTERN)) {
      if (match[1].toLowerCase() === "all") continue;
      const named = this.findByName(match[1]);
      if (!named && !unknown.includes(match[1])) unknown.push(match[1]);
      if (named?.id === participant.id) selfNamed = true;
    }
    if (unknown.length) {
      const known = [...this.participants.values()].map((p) => p.name).join(", ");
      corrections.push(`reminder: ${unknown.map((u) => `@${u}`).join(", ")} ${unknown.length > 1 ? "are" : "is"} not in the room; participants are ${known}`);
    }
    if (selfNamed) {
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


  private liveAgentSession(id: string, agent: AcpAgent, sessionId: string): boolean {
    return this.agentSessions.live(id, agent, sessionId);
  }

  postMessageForAgent(id: string, token: string, raw: unknown): PostMessageReceipt {
    const runtime = this.runtimes.get(id);
    if (!runtime || runtime.session.mcpToken !== token || !token || !this.liveAgentSession(id, runtime.session.agent, runtime.session.sessionId))
      throw new AgentMessageError(403, "session_unavailable", "This agent session cannot publish a message now.");
    if (runtime.work.workBusy || runtime.work.turnActive || runtime.work.turn)
      throw new AgentMessageError(409, "reply_in_progress", "A separate message cannot be posted while your current reply is active. Include this text in the current reply, or publish after that turn has finished.");
    if (this.nativeLaneBlocked(runtime))
      throw new AgentMessageError(409, "native_delivery_pending", "A previously completed native report is held for storage or delivery recovery. A separate message cannot be published until that pending delivery is resolved.");
    const input = parsePostMessage(raw);
    const visible = extractNotes(input.text).visible.trim();
    if (!visible || visible.toLowerCase() === SILENT_MARKER || visible.toLowerCase() === REQUEST_BRIEF_MARKER || skillPull(visible))
      throw new AgentMessageError(400, "invalid_arguments", "post_message publishes a complete visible message; control markers and notes alone are not messages.");
    const report: BackgroundMessage = { sessionId: runtime.session.sessionId, ...input, stopReason: "end_turn" };
    const messageId = agentMessageId(this.uuid, id, runtime.session.sessionId, input.messageId, "mcp");
    const hash = agentMessageHash(report);
    const confirm = <T>(read: () => T): T => {
      try { return read(); }
      catch (error) {
        if (error instanceof AgentMessageError) throw error;
        throw new AgentMessageError(503, "unconfirmed_result", "The message could not be confirmed in the room's durable record; inspect it before retrying.");
      }
    };
    const receipt = (stored: NonNullable<ReturnType<HistoryStore["agentMessageReceipt"]>>, duplicate: boolean): PostMessageReceipt => {
      if (stored.hash !== hash) throw new AgentMessageError(409, "message_id_conflict", "That messageId already belongs to a different message.");
      return { messageId, seq: stored.seq, status: stored.deleted ? "deleted" : stored.kind === "hidden" ? "held" : "posted", duplicate };
    };
    const previous = confirm(() => this.history.agentMessageReceipt(this.id, messageId));
    if (previous) {
      const result = receipt(previous, true);
      this.confirmBackground(messageId, previous);
      return result;
    }
    const pending = this.messages.find(message => message.id === messageId);
    if (pending) {
      if (pending.details?.reportHash !== hash)
        throw new AgentMessageError(409, "message_id_conflict", "That messageId already belongs to a different message.");
      if (!confirm(() => this.history.hasMessageId(this.id, messageId))) this.persist({ kind: "upsert", message: pending });
      const recovered = confirm(() => this.history.agentMessageReceipt(this.id, messageId));
      if (recovered) {
        const result = receipt(recovered, true);
        this.confirmBackground(messageId, recovered);
        return result;
      }
      throw new AgentMessageError(503, "unconfirmed_result", "The message could not be confirmed in the room's durable record; inspect it before retrying.");
    }
    confirm(() => this.onBackgroundMessage(id, runtime.session.agent, report, "mcp"));
    const stored = confirm(() => this.history.agentMessageReceipt(this.id, messageId));
    if (!stored) throw new AgentMessageError(503, "unconfirmed_result", "The message could not be confirmed in the room's durable record; inspect it before retrying.");
    return receipt(stored, false);
  }

  private onBackgroundMessage(id: string, agent: AcpAgent, report: BackgroundMessage, transport: "acp" | "mcp" = "acp"): void {
    if (transport === "acp") { this.acceptNativeReport(id, agent, report); return; }
    if (!this.liveAgentSession(id, agent, report.sessionId)) return;
    const runtime = this.runtimes.get(id)!;
    const participant = this.participants.get(id)!;
    const messageId = agentMessageId(this.uuid, id, report.sessionId, report.messageId, transport);
    const seen = runtime.native.backgroundMessages ??= new Set();
    if (seen.has(messageId) || this.messages.some(message => message.id === messageId) || this.history.hasMessageId(this.id, messageId)) return;
    seen.add(messageId);
    if (seen.size > 256) seen.delete(seen.values().next().value!);

    const extracted = extractNotes(report.text);
    if (report.stopReason === "end_turn") this.agentNotes.keep(participant, runtime, extracted.notes, "reply");
    const text = extracted.visible.trim();
    if (!text || text.toLowerCase() === SILENT_MARKER) return;
    if (text.toLowerCase() === REQUEST_BRIEF_MARKER || skillPull(text)) {
      runtime.brief.headerNotes.push("your autonomous report requested room instructions; use the instructions supplied with your next turn");
      return;
    }
    const interrupted = report.stopReason !== "end_turn";
    const draft: ChatMessage = {
      id: messageId, seq: 0, from: id, fromName: participant.name, to: [], toNames: [],
      text, ts: Date.now(), kind: "chat", streaming: false,
      details: { reportHash: agentMessageHash(report) },
      ...(interrupted ? { audience: "human" as const } : {}),
      ...(report.stopReason === "error" ? { failed: "The autonomous agent cycle failed before completing." } : {}),
    };
    this.publishAgentReply({ phase: "background", participant, runtime }, draft,
      { stopReason: report.stopReason === "cancelled" ? "cancelled" : "end_turn" }, undefined, null, null,
      report.stopReason === "cancelled" ? "agent" : undefined);
  }

  private nativeLaneBlocked(runtime: AgentRuntime): boolean {
    return this.nativeReports.laneBlocked(runtime);
  }

  hasPendingNativeDelivery(): boolean {
    return this.nativeReports.hasPending();
  }

  retryNativeReports(): boolean {
    return this.nativeReports.retry();
  }

  private nativeFault(owner: FaultOwner, reason: string): void {
    this.nativeReports.fault(owner, reason);
  }

  private rebindNativeReports(id: string, runtime: AgentRuntime, loaded: boolean): void {
    this.nativeReports.rebind(id, runtime, loaded);
  }

  private acceptNativeReport(id: string, agent: AcpAgent, raw: BackgroundMessage): void {
    this.nativeReports.accept(id, agent, raw);
  }

  private prepareNativeDecision(envelope: NativeEnvelope, participant: Participant, runtime: AgentRuntime): NativeDecision {
    const extracted = extractNotes(envelope.text), text = extracted.visible.trim(), at = Date.now();
    const notes = envelope.stopReason === "end_turn" && extracted.notes
      ? planNativeNoteEffect(captureNativeNoteSubject(participant), envelope.id,
        { notes: extracted.notes, notesAt: runtime.session.lastUsed, notesSeq: this.seq, notesWrittenAt: at }) : null;
    const silent = !text || text.toLowerCase() === SILENT_MARKER;
    const marker = text.toLowerCase() === REQUEST_BRIEF_MARKER || !!skillPull(text);
    const mentions = silent || marker ? { ids: [], names: [] } : this.parseMentions(text);
    const corrections = silent || marker ? [] : this.referee(participant, text);
    const kind: NativeDecision["kind"] = silent ? notes && !text ? "notes_only" : "silent" : marker ? "instruction_marker"
      : envelope.stopReason === "cancelled" ? "visible_cancelled_human" : envelope.stopReason === "error" ? "visible_error_human"
      : corrections.length && this.settings.refereeAction === "retry-hidden" ? "referee_hidden" : "visible_complete";
    const obligations: NativeObligation[] = [];
    const base = (kind: NativeObligation["kind"], target: string | null = null) => ({ id: nativeObligationId(envelope.id, kind, target), phase: "pending" as const });
    if (notes) obligations.push({ ...base("note"), kind: "note", effect: notes });
    if (marker || corrections.length && kind !== "referee_hidden") obligations.push({ ...base("header"), kind: "header",
      lines: marker ? ["your autonomous report requested room instructions; use the instructions supplied with your next turn"] : corrections });
    if (kind === "referee_hidden") obligations.push({ ...base("correction"), kind: "correction", original: text, corrections });
    if (kind === "visible_complete") {
      const decision = decideWake({ author: { id: participant.id, human: false }, addressed: mentions.ids, live: this.wakeableVibemates(),
        agentsWakeEachOther: this.settings.agentsWakeEachOther, focused: this.focused, hops: this.hops, hopLimit: this.hopLimit });
      for (const target of woken(decision)) {
        const owner = this.runtimes.get(target)!, epoch = this.participants.get(target)?.deliveryEpoch;
        if (epoch) obligations.push({ ...base("route", target), kind: "route", messageId: envelope.id,
          participantId: target, sessionId: owner.session.sessionId, deliveryEpoch: epoch });
      }
    }
    return { version: 1, kind, reportHash: envelope.reportHash, owner: envelope.owner, at, text,
      to: mentions.ids, toNames: mentions.names, corrections, notes, obligations };
  }

  private nativeMessage(envelope: NativeEnvelope, decision: NativeDecision, participant: Participant): ChatMessage | null {
    if (["silent", "notes_only", "instruction_marker"].includes(decision.kind)) return null;
    const hidden = decision.kind === "referee_hidden", interrupted = envelope.stopReason !== "end_turn";
    const next = this.roomMessages.nextNative(this.history.maxSeq(this.id), this.history.nativeDisplayHighWater(this.id));
    return { id: envelope.id, seq: nativeInteger(next.seq, 1), displayOrder: nativeInteger(next.displayOrder, 1),
      from: participant.id, fromName: participant.name, to: hidden ? [] : decision.to, toNames: hidden ? [] : decision.toNames,
      text: hidden ? `Reply held back; correction requested: ${decision.corrections.map(c => c.replace(/^reminder:\s*/i, "")).join("; ")}` : decision.text,
      ts: decision.at, kind: hidden ? "hidden" : "chat", streaming: false, usage: null,
      details: { reportHash: envelope.reportHash, ...(hidden ? { original: decision.text, corrections: decision.corrections } : {}) },
      ...(this.folderId ? { origin: this.folderId } : {}), ...(interrupted ? { audience: "human" as const } : {}),
      ...(envelope.stopReason === "error" ? { failed: "The autonomous agent cycle failed before completing." } : { stopReason: envelope.stopReason }),
      ...(envelope.stopReason === "cancelled" ? { cancelledBy: "agent" as const } : {}) };
  }

  private drainNativeReports(id: string, runtime: AgentRuntime): void {
    this.nativeReports.drain(id, runtime);
  }

  private publishNativeRecord(record: NativeRecord): "published" | "tombstoned" | "unknown" {
    const envelope = record.envelope, owner = envelope.owner;
    if (record.state === "tombstoned") return "tombstoned";
    if (!record.receipt || owner.roomId !== this.id || owner.roomUuid !== this.uuid || owner.folderId !== this.folderId
      || owner.generation !== this.history.nativeGeneration(this.id)) return "unknown";
    const message = this.history.get(this.id, record.receipt.seq);
    if (!message || message.id !== envelope.id || message.details?.reportHash !== envelope.reportHash) return "unknown";
    this.roomMessages.acceptRecorded(message);
    this.push({ type: "message", message }); this.numberQuotesOf(message);
    return "published";
  }

  private routeNativeObligation(obligation: NativeRouteObligation, ref: NativeObligationRef, addressed: boolean, hop: NativeHop): "routed" | "superseded" {
    const holder = () => {
      const target = this.runtimes.get(obligation.participantId), p = this.participants.get(obligation.participantId);
      return target && p && !this.closing && !this.readOnly && !this.recordHold && target.session.agent.alive && !target.session.retiring
        && target.session.sessionId === obligation.sessionId && p.deliveryEpoch === obligation.deliveryEpoch && !p.muted && !this.focused ? { target, p } : null;
    };
    const first = holder();
    if (!first || this.hops >= this.hopLimit && !hop.spent) return "superseded";
    if (!hop.spent) {
      this.turnOrder.countHop();
      hop.spend();
      this.push(this.roomEvent());
      const now = holder();
      if (!now || now.target !== first.target || now.p !== first.p) return "superseded";
    }
    (first.target.native.nativePromptObligations ??= []).push(ref);
    this.requestTurn(first.p.id, addressed, false, false, "native");
    return "routed";
  }

  private nativeTransition(ref: NativeObligationRef, phase: NativeObligation["phase"]): void {
    this.nativeReports.transition(ref, phase);
  }

  private nativePromptEligible(ref: NativeObligationRef, participant: Participant, runtime: AgentRuntime): boolean {
    return this.nativeReports.promptEligible(ref, participant, runtime);
  }

  private startNativePrompt(ref: NativeObligationRef, participant: Participant, runtime: AgentRuntime): boolean {
    return this.nativeReports.startPrompt(ref, participant, runtime);
  }

  private confirmBackground(messageId: string, receipt: { deleted: boolean; hash: string | null }): void {
    this.nativeReports.confirmPost(messageId, receipt);
  }

  private journalApplied(): void {
    this.nativeReports.journalApplied();
  }

  private queueBackgroundCorrection(id: string, runtime: AgentRuntime, retry: RetryRequest): void {
    runtime.native.backgroundBacklogPending ||= runtime.queue.pendingTurn;
    (runtime.native.backgroundCorrections ??= []).push(retry);
    this.requestTurn(id, false, false, true);
  }

  private showDraft(owner: DraftOwner): "shown" | "skipped" | "refused" {
    return this.draftStream.show(owner);
  }

  private checkForCompaction(participant: Participant, runtime: AgentRuntime, used: number, size: number): void {
    if (!looksCompacted(runtime.session.lastUsed, used) || runtime.brief.briefPending) return;
    runtime.brief.briefPending = `context shrank from ${runtime.session.lastUsed} to ${used} tokens (compaction?)`;
    runtime.session.log.info(`usage dropped ${runtime.session.lastUsed} -> ${used}; full instructions scheduled`);
    participant.contextEvent = { kind: "compacted", at: Date.now(), used, size };
    runtime.notes.notesDue = false;
    if (overThreshold(used, size)) this.agentNotes.ask(runtime);
    this.postSystem(`${participant.name} compacted its context (${Math.round(runtime.session.lastUsed / 1000)}k → ${Math.round(used / 1000)}k tokens); the room instructions are re-sent with its next turn${participant.notes ? ", with its notes" : ""}.`, "human", false, { tone: "attention" });
  }

  private onSessionUpdate(id: string, update: SessionUpdate): void {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) return;
    const turn = runtime.work.turn;
    const owner: DraftOwner = { participant, runtime, turn: turn ?? null };
    if (turn) {
      if (runtime.work.quiet && runtime.work.quiet.turnId === turn.message.id) {
        const waited = Math.round((Date.now() - (turn.lastSignAt ?? turn.startedAt)) / 60_000);
        runtime.work.quiet = undefined;
        if (this.silence.toldOf(turn.message.id)) this.postSystem(`${participant.name} answered after ${waited} minute${waited === 1 ? "" : "s"}.`, "human", false, { agentId: id });
        this.push({ type: "participant", participant });
      }
      turn.lastSignAt = Date.now();
      if (WORK_SIGNS.has(update.sessionUpdate)) turn.lastWorkAt = Date.now();
    }

    const held = () => this.participants.get(id) === participant && this.runtimes.get(id) === runtime;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk":
      case "tool_call":
      case "tool_call_update":
      case "plan":
        this.draftStream.update(owner, update as unknown as { sessionUpdate: string } & Record<string, unknown>);
        return;
      case "usage_update": {
        if (!held()) return;
        const u = update as { used: number; size: number; cost?: { amount: number; currency: string } | null };
        if (emptyUsageReport(runtime.session.lastUsed, u.used)) {
          runtime.session.log.info(`usage report of 0 after ${runtime.session.lastUsed} tokens ignored (failed request?)`);
          return;
        }
        runtime.work.usageSeenThisTurn = true;
        participant.contextUsed = u.used;
        participant.contextSize = u.size;
        if (u.cost) participant.cost = { amount: u.cost.amount, currency: u.cost.currency };
        this.checkForCompaction(participant, runtime, u.used, u.size);
        if (crossedThreshold(runtime.session.lastUsed, u.used, u.size)) {
          const asked = this.agentNotes.ask(runtime);
          participant.contextEvent = { kind: "threshold", at: Date.now(), used: u.used, size: u.size };
          const percent = Math.round((100 * u.used) / u.size);
          this.postSystem(asked
            ? `${participant.name} is at ${percent}% of its context; it will leave notes with its next reply. You can respawn it with memory from its panel.`
            : `${participant.name} is at ${percent}% of its context. You can take its notes or respawn it with memory from its panel.`, "human", false, { tone: "attention" });
          runtime.session.log.info(`context at ${u.used}/${u.size}: ${asked ? "notes due" : "automatic notes are off"}`);
        }
        runtime.session.lastUsed = u.used;
        this.push({ type: "participant", participant });
        return;
      }
      case "config_option_update": {
        if (!held()) return;
        participant.configOptions = (update as { configOptions: SessionConfigOption[] }).configOptions;
        summarizeConfig(participant);
        this.push({ type: "participant", participant });
        return;
      }
      case "current_mode_update": {
        if (!held()) return;
        participant.mode = (update as { currentModeId: string }).currentModeId;
        this.push({ type: "participant", participant });
        return;
      }
      case "available_commands_update":
      case "session_info_update":
      case "user_message_chunk":
        return;
      default:
        runtime.session.log.info(`unhandled session update: ${update.sessionUpdate}`);
    }
  }

  private onPermissionRequest(id: string, params: RequestPermissionParams): Promise<RequestPermissionResponse> {
    const participant = this.participants.get(id);
    const runtime = this.runtimes.get(id);
    const owner: DraftOwner | null = participant && runtime ? { participant, runtime, turn: runtime.work.turn ?? null } : null;
    if (participant?.agentType === "cursor") {
      const normalized = cursorPermissionInput(params.toolCall);
      if (normalized !== params.toolCall) {
        params = { ...params, toolCall: normalized };
        if (owner) this.draftStream.toolView(owner, normalized);
      }
    }
    const known = runtime?.work.turn?.message.toolCalls?.find(t => t.toolCallId === params.toolCall.toolCallId);
    if (runtime && roomToolNeedsNoQuestion(params.toolCall, known, !!runtime.session.mcpToken)) {
      const option = params.options.find((o) => o.kind === "allow_once");
      if (option) {
        runtime.session.log.info(`room tool permission auto-approved (${option.optionId})`);
        return Promise.resolve({ outcome: { outcome: "selected", optionId: option.optionId } });
      }
    }
    return this.permissions.ask(id,
      { ...params.toolCall, title: roomToolTitle(params.toolCall, known) ?? params.toolCall.title },
      isWrappedRoomCall(params.toolCall, known) ? params.options.filter(option => option.kind !== "allow_always") : params.options,
      params.toolCall.title ?? params.toolCall.toolCallId,
      () => { if (owner?.turn) this.showDraft(owner); },
    );
  }

  private onAgentExit(id: string, code: number | null, signal: NodeJS.Signals | null, agent: AcpAgent): void {
    this.agentSessions.exited(id, code, signal, agent);
  }


  private cancelPermissionsOf(id: string): void {
    this.permissions.cancelOf(id);
  }

  private personaOf(participant: Participant): Persona {
    return { name: participant.name, tagline: participant.tagline ?? "", role: participant.role ?? "" };
  }

  private roster(): RosterEntry[] {
    const activity = new Map(this.whoIsBusy().map(p => [p.name, p.line]));
    return [...this.participants.values()]
      .filter((p) => p.status !== "left" && p.status !== "unstaffed")
      .map((p) => ({ name: p.name, kind: p.kind, vendor: p.agentVendor ?? p.agentLabel, tagline: p.tagline || undefined, muted: p.muted || undefined, asleep: p.asleep || undefined, activity: activity.get(p.name), formerNames: p.formerNames?.length ? p.formerNames : undefined }));
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

  private postRoomEvent(text: string, audience?: "agents" | "human", wakes?: boolean, details?: ChatMessage["details"], bodyEdit?: BodyEdit): ChatMessage {
    return this.postSystem(text, audience, wakes, { ...(details ?? {}), about: "room" }, bodyEdit);
  }

  private postSystem(text: string, audience?: "agents" | "human", wakes?: boolean, details?: ChatMessage["details"], bodyEdit?: BodyEdit): ChatMessage {
    const message: MessageDraft = {
      id: randomUUID(),
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
    return this.commit(message).message;
  }

  async setDir(dir: string, restart: "now" | "later" = "now"): Promise<{ dir: string; restarted: string[] }> {
    const next = resolve(String(dir ?? "").trim());
    if (!dir.trim()) throw new Error("working directory is required");
    if (!existsSync(next) || !statSync(next).isDirectory()) throw new Error(`working directory does not exist: ${next}`);
    return this.queueMove(() => this.moveDir(next, restart));
  }

  async restartInFolder(): Promise<{ dir: string; restarted: string[] }> {
    return this.queueMove(() => this.moveDir(this.dir, "now"));
  }

  private queueMove(move: () => Promise<{ dir: string; restarted: string[] }>): Promise<{ dir: string; restarted: string[] }> {
    const queued = this.dirMoves.then(move);
    this.dirMoves = queued.then(() => undefined, () => undefined);
    return queued;
  }
  private dirMoves: Promise<void> = Promise.resolve();
  private readonly starts = new Map<string, StartUnderWay>();
  private readonly owedRestart = new Set<Participant>();

  private async moveDir(next: string, restart: "now" | "later"): Promise<{ dir: string; restarted: string[] }> {
    if (this.closing) return { dir: this.dir, restarted: [] };
    const previous = this.dir, moved = next !== previous;
    if (moved) {
      for (const p of this.participants.values()) if (p.kind === "agent" && p.sessionId && !p.sessionDir) p.sessionDir = previous;
      this.dir = next;
      this.push(this.roomEvent());
      for (const p of [...this.participants.values()].filter((v) => v.kind === "agent")) {
        if (this.closing) return { dir: this.dir, restarted: [] };
        if (this.participants.get(p.id) === p) this.push({ type: "participant", participant: p });
      }
    }
    const restarted = restart === "now" ? await this.restartOutsideFolder() : [];
    if (this.closing) return { dir: this.dir, restarted };
    if (moved) {
      this.postRoomEvent(`The room moved to ${next}${restarted.length ? `; ${restarted.join(", ")} restarted there` : restart === "later" ? "; the vibemates move there at their next restart" : ""}.`);
      this.log.info(`working directory: ${previous} -> ${next} (${restart})`);
    } else if (restarted.length) {
      this.postRoomEvent(`${restarted.join(", ")} restarted in ${next}.`);
    }
    return { dir: this.dir, restarted };
  }

  private async restartOutsideFolder(): Promise<string[]> {
    await Promise.all([...this.starts.values()].filter((start) => start.ticket.cwd !== this.dir).map((start) => start.settled));
    const group: SeenVibemate[] = [...this.runtimes.entries()].flatMap(([id, runtime]) => {
      const participant = this.participants.get(id);
      return participant && runtime.session.cwd !== this.dir ? [{ participant, runtime }] : [];
    });
    for (const participant of this.owedRestart) {
      if (this.participants.get(participant.id) === participant && !this.runtimes.has(participant.id)) group.push({ participant, runtime: null });
      else this.owedRestart.delete(participant);
    }
    const restarted: string[] = [];
    for (const member of group) {
      const { participant } = member;
      if (!this.operationHolds(member)) continue;
      if (member.runtime) await this.retireRuntime(participant.id, member.runtime);
      const without: SeenVibemate = { participant, runtime: null };
      if (!this.operationHolds(without)) continue;
      this.owedRestart.add(participant);
      try {
        const started = await this.reconnectExpected(participant, { mode: "replay", reason: "the room moved to another folder" });
        if (started && this.operationHolds({ participant, runtime: started })) restarted.push(participant.name);
      } catch (error) {
        if (this.operationHolds(without)) this.notice(`${participant.name} could not be restarted in the new folder: ${describeError(error)}`, "error");
      }
      if (!this.closing && this.participants.get(participant.id) === participant) this.push({ type: "participant", participant });
    }
    return restarted;
  }

  startingWithHub = false;

  private roomEvent(): RoomEvent {
    return {
      type: "room",
      hopLimit: this.hopLimit,
      hops: this.hops,
      settings: this.settings,
      customRulesText: this.roomSettings.rulesText(),
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
    return { ...participant, lastSeenSeq: runtime?.reading.lastSeenSeq ?? this.restoredSeen.get(participant.id),
      pendingSettings: runtime?.queue.pendingConfig?.length ? runtime.queue.pendingConfig.map(entry => ({ id: entry.configId, name: configName(participant, entry.configId), value: entry.value })) : undefined,
      activeTurnId: runtime?.work.turn && !runtime.work.turn.hidden ? runtime.work.turn.message.id : undefined,
      activeTurnInputThrough: runtime?.work.turn && !runtime.work.turn.hidden ? runtime.work.turn.inputThrough : undefined,
      lastSignAt: runtime?.work.turn && !runtime.work.turn.hidden ? (runtime.work.turn.lastWorkAt ?? runtime.work.turn.startedAt) : undefined,
      quiet: this.quietTurn(participant.id), folderPending: this.folderPending(participant) || undefined };
  }

  private folderPending(participant: Participant): boolean {
    const runtime = this.runtimes.get(participant.id);
    if (runtime) return runtime.session.cwd !== this.dir;
    const start = this.starts.get(participant.id);
    if (start && start.ticket.participant === participant) return start.ticket.cwd !== this.dir;
    return this.owedRestart.has(participant);
  }

  private storedSessionHere(participant: Participant): boolean {
    return !!participant.sessionId && (!participant.sessionDir || participant.sessionDir === this.dir);
  }

  private quietTurn(id: string): QuietTurn | undefined {
    const runtime = this.runtimes.get(id);
    const turn = runtime?.work.turn;
    if (!runtime?.work.quiet || !turn || turn.hidden || runtime.work.quiet.turnId !== turn.message.id) return undefined;
    const stopping = runtime.session.retiring ? "forcing" : runtime.work.workCancelled ? "asked" : undefined;
    return {
      since: turn.lastSignAt ?? turn.startedAt,
      turnId: turn.message.id,
      processAlive: runtime.session.agent.alive,
      ...(runtime.work.quiet.nudge ? { nudge: runtime.work.quiet.nudge } : {}),
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

function errorName(error: unknown): string {
  return errorCode(errorData(error));
}

function unchangingCall(participant: Participant): { kind: "config"; id: string; value: string | boolean } | { kind: "mode"; id: string } | null {
  const option = (participant.configOptions ?? []).find((o) => o.currentValue !== undefined && o.currentValue !== null);
  if (option) return { kind: "config", id: option.id, value: option.currentValue };
  const mode = participant.mode;
  if (mode && (participant.modes ?? []).some((m) => m.id === mode)) return { kind: "mode", id: mode };
  return null;
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
