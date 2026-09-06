// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.js";
import { affectedByEdit, editNotice, partitionHistory, rewriteNotice, type AgentReadState, type EditMode } from "./edit.js";
import { saveImages, type Attachment, type ImageInput } from "./files.js";
import { join, resolve } from "node:path";
import { AcpAgent } from "./acp-client.js";
import { RemoteError } from "./jsonrpc.js";
import { getRecipe, listRecipes } from "./recipes.js";
import { composeSkillBlock, skillPull, SKILL_TOOL_NAME, type SkillsForPrompt } from "./persona.js";
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
import {
  BRIEF_AFFECTING_SETTINGS,
  DEFAULT_ROOM_SETTINGS,
  REQUEST_BRIEF_MARKER,
  SILENT_MARKER,
  buildBrief,
  buildHeader,
  composeCorrectionPrompt,
  composePrompt,
  countSentences,
  ensureDir,
  type BacklogImage,
  type BacklogLine,
  type Persona,
  type PromptPart,
  type RoomSettings,
  type RosterEntry,
} from "./persona.js";
import { Logger, Transcript } from "./log.js";
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
  tagline?: string;
  role?: string;
  avatar?: string;
  muted?: boolean;
  replyDelay?: number;
  skills?: string[];
  skillChannel?: "tool" | "marker" | "pending";
  launch?: LaunchPrefs;
  violations?: number;
  briefsSent?: number;
  failedTurns?: number;
  retries?: number;
  sessionId?: string;
  supportsLoad?: boolean;
  sessionOrigin?: "new" | "loaded" | "replayed";
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
  launch: LaunchPrefs;
  muted: boolean;
  replyDelay?: number;
  skills?: string[];
  sessionId?: string;
  supportsLoad?: boolean;
  lastSeenSeq?: number;
  sawFromSeq?: number;
}

export interface ReconnectOptions {
  mode: "load" | "replay";
  replay?: number;
  reason?: string;
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
  kind?: string | null;
  status?: string | null;
  rawInput?: unknown;
  output?: string;
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
  kind: "chat" | "system" | "hidden";
  details?: { original?: string; corrections?: string[]; outcome?: string; skill?: string; via?: "tool" | "marker"; refId?: string; agentId?: string };
  skill?: { name: string; args: string };
  edited?: { ts: number; previous: string };
  pinned?: true;
  images?: Attachment[];
  audience?: "agents" | "human";
  wakes?: true;
  streaming?: boolean;
  thought?: string;
  notices?: string[];
  toolCalls?: ToolCallView[];
  plan?: PlanEntry[];
  stopReason?: StopReason;
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

export type RoomEvent =
  | { type: "participant"; participant: Participant }
  | { type: "participant.removed"; id: string }
  | { type: "message"; message: ChatMessage }
  | { type: "message.removed"; id: string }
  | { type: "messages.truncated"; fromSeq: number }
  | { type: "chunk"; id: string; text: string }
  | { type: "thought"; id: string; text: string }
  | { type: "toolcall"; id: string; toolCall: ToolCallView }
  | { type: "plan"; id: string; entries: PlanEntry[] }
  | { type: "permission"; permission: PendingPermission }
  | { type: "permission.resolved"; key: string; optionId: string | null }
  | { type: "room"; hopLimit: number; hops: number; settings: RoomSettings; customRulesText: string; focused: boolean; name: string; dir: string }
  | { type: "notice"; text: string; level: "info" | "warn" | "error"; ts: number };

export interface InviteOptions {
  id?: string;
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

export interface DiscoveredOptions {
  recipeId: string;
  agentInfo: { name: string | null; version: string | null };
  authMethods: string[];
  modes: NewSessionResult["modes"];
  configOptions: SessionConfigOption[];
  modelAtLaunch: boolean;
  discoveredAt: number;
  durationMs: number;
}

export interface RoomOptions {
  id: string;
  name: string;
  dir: string;
  dataDir: string;
  createdAt: number;
  humanName: string;
  programHumanDescription: string;
  bypassPermissionsByDefault: boolean;
  settings?: Partial<Omit<RoomSettings, "name" | "humanName">>;
  log: Logger;
  optionCache?: Map<string, DiscoveredOptions>;
  skills?: SkillsBridge;
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
  pendingTurn: boolean;
  turn: { message: ChatMessage; messageId: string | null; sawMessageId: boolean; startedAt: number; published: boolean } | null;
  turnsSinceBrief: number;
  usedAtBrief: number;
  briefSentThisTurn: boolean;
  lastUsed: number;
  briefPending: string | null;
  headerNotes: string[];
  briefRequestedAtSeq: number;
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

const COLORS = ["#6d5dfc", "#16a34a", "#d97706", "#dc2626", "#0891b2", "#be185d", "#4d7c0f", "#7c3aed"];
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,23}$/u;
const MENTION_PATTERN = /@([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
const RULE_REF_TOKEN = /@\{p:([^}]+)\}/g;
const ADAPTER_ERROR_PATTERN =
  /^(?:Warning: Falling back from WebSockets|unexpected status \d{3}|Error when talking to|API Error|You have exhausted your (?:daily )?quota|Rate limit|429 |5\d\d )/i;

export class Room extends EventEmitter {
  readonly id: string;
  name: string;
  dir: string;
  readonly dataDir: string;
  readonly createdAt: number;
  settings: RoomSettings;
  hops = 0;
  focused = false;
  readonly participants = new Map<string, Participant>();
  readonly messages: ChatMessage[] = [];
  private seq = 0;
  private programHumanDescription: string;
  private bypassPermissionsByDefault: boolean;
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
  private readonly optionCache: Map<string, DiscoveredOptions>;
  private readonly log: Logger;
  private colorIndex = 0;
  private readonly departed = new Map<string, string>();
  private readonly restoredSeen = new Map<string, number>();

  constructor(options: RoomOptions) {
    super();
    this.id = options.id;
    this.name = options.name;
    this.dir = options.dir;
    this.dataDir = options.dataDir;
    this.createdAt = options.createdAt;
    this.programHumanDescription = options.programHumanDescription;
    this.bypassPermissionsByDefault = options.bypassPermissionsByDefault;
    this.skills = options.skills;
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

  private loadHistory(): void {
    if (!existsSync(this.historyPath())) return;
    const lines = readFileSync(this.historyPath(), "utf8").split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const message = JSON.parse(line) as ChatMessage;
        this.messages.push(message);
        if (message.seq > this.seq) this.seq = message.seq;
      } catch {
      }
    }
  }

  restore(stored: StoredParticipant[]): void {
    for (const s of stored) {
      if (!s.agentType) {
        this.addUnstaffed({ name: s.name, tagline: s.tagline, role: s.role, avatar: s.avatar, skills: s.skills, color: s.color, id: s.id });
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
        statusDetail: "not connected since the hub restarted",
        turns: 0,
        color: s.color,
        tagline: s.tagline,
        role: s.role,
        avatar: s.avatar || undefined,
        muted: s.muted,
        replyDelay: s.replyDelay,
        skills: normalizeSkillList(s.skills),
        launch: s.launch,
        sessionId: s.sessionId,
        supportsLoad: s.supportsLoad,
        sawFromSeq: s.sawFromSeq,
        violations: 0,
        briefsSent: 0,
        failedTurns: 0,
      });
      if (s.lastSeenSeq !== undefined) this.restoredSeen.set(s.id, s.lastSeenSeq);
      this.colorIndex++;
    }
  }

  toStored(): { id: string; name: string; dir: string; createdAt: number; settings: Partial<RoomSettings>; participants: StoredParticipant[] } {
    const { name: _n, humanName: _h, ...settings } = this.settings;
    return {
      id: this.id,
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
          launch: p.launch ?? { model: p.model ?? null, effort: p.effort ?? null, mode: p.mode ?? null },
          muted: !!p.muted,
          replyDelay: p.replyDelay,
          skills: p.skills && p.skills.length ? [...p.skills] : undefined,
          sessionId: p.sessionId,
          supportsLoad: p.supportsLoad,
          lastSeenSeq: this.runtimes.get(p.id)?.lastSeenSeq ?? this.restoredSeen.get(p.id),
          sawFromSeq: p.sawFromSeq,
        })),
    };
  }

  private commit(message: ChatMessage): void {
    this.messages.push(message);
    appendFileSync(this.historyPath(), JSON.stringify(message) + "\n");
    this.push({ type: "message", message });
  }


  get humanName(): string {
    return this.settings.humanName;
  }

  get hopLimit(): number {
    return this.settings.hopLimit;
  }

  snapshot(): unknown {
    const last = this.messages.length ? this.messages[this.messages.length - 1] : null;
    return {
      id: this.id,
      name: this.name,
      dir: this.dir,
      createdAt: this.createdAt,
      humanName: this.humanName,
      hopLimit: this.hopLimit,
      hops: this.hops,
      focused: this.focused,
      settings: this.settings,
      customRulesText: this.renderRuleReferences(this.settings.customRules),
      participants: [...this.participants.values()],
      messages: [...this.messages, ...this.drafts.values()],
      permissions: [...this.permissions.values()].map(({ resolve: _r, ...p }) => p),
      recipes: listRecipes().map(({ build: _b, ...r }) => r),
      lastMessageAt: last?.ts ?? this.createdAt,
    };
  }

  applyProgramSettings(program: { humanName: string; humanDescription: string; bypassPermissionsByDefault: boolean }): void {
    const changed: string[] = [];
    this.bypassPermissionsByDefault = program.bypassPermissionsByDefault;
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

  postHumanMessage(text: string, images: ImageInput[] = []): ChatMessage {
    const waiting = this.unstaffed();
    if (waiting.length) throw new Error(`${waiting.map((p) => p.name).join(", ")} ${waiting.length === 1 ? "has" : "have"} no coding agent yet: summon ${waiting.length === 1 ? "it" : "them"} from the roster to start the conversation`);
    const trimmed = text.trim();
    if (!trimmed && !images.length) throw new Error("empty message");
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
    this.decorateHumanMessage(message);
    human.turns += 1;
    if (this.focused) {
      this.focused = false;
      this.push(this.roomEvent());
    }
    this.commit(message);
    this.route(message);
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
      if (runtime) out.push({ id: p.id, name: p.name, lastSeenSeq: runtime.lastSeenSeq, active: runtime.turnActive, online: true });
      else out.push({ id: p.id, name: p.name, lastSeenSeq: this.restoredSeen.get(p.id) ?? -1, active: false, online: false });
    }
    return out;
  }

  private editableMessage(messageId: string): ChatMessage {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message || message.kind !== "chat" || message.from !== "human") throw new Error("only your own chat messages can be edited");
    return message;
  }

  setPinned(messageId: string, pinned: boolean): ChatMessage {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message || message.kind !== "chat") throw new Error("only chat messages can be pinned");
    if (!!message.pinned === pinned) return message;
    if (pinned) message.pinned = true;
    else delete message.pinned;
    this.rewriteHistory();
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
    const trimmed = text.trim();
    if (!trimmed) throw new Error("empty message");
    const message = this.editableMessage(messageId);
    if (trimmed === message.text) throw new Error("the text is unchanged");
    const { restart, offline } = affectedByEdit(this.agentReadStates(), message.seq);
    const previous = message.text;
    message.edited = { ts: Date.now(), previous };
    message.text = trimmed;
    this.decorateHumanMessage(message);
    this.humanTypingUntil = 0;
    if (this.focused) {
      this.focused = false;
      this.push(this.roomEvent());
    }

    if (mode === "notify") {
      this.rewriteHistory();
      this.push({ type: "message", message });
      if (restart.length || offline.length) this.postSystem(editNotice(this.humanName, previous, trimmed), "agents", true);
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
    this.appendDeleted(removed, message.seq);
    this.rewriteHistory();
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

  async respawnAgent(id: string): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const online = this.runtimes.has(id);
    this.dropScheduledTurn(id);
    this.cancelPermissionsOf(id);
    if (this.speaking === id) this.speaking = null;
    if (online) await this.retireRuntime(id);
    participant.sessionId = undefined;
    this.restoredSeen.set(id, this.seq);
    this.push({ type: "participant", participant });
    if (!online) {
      participant.statusDetail = "its context was cleared; a reconnect starts it with an empty head";
      this.postSystem(`${participant.name} was respawned while offline: it comes back knowing nothing from before.`);
      this.push({ type: "participant", participant });
      this.log.info(`respawn of ${participant.name} (offline): stored session dropped`);
      return participant;
    }
    await this.reconnect(id, { mode: "replay", replay: 0, reason: "its context was cleared, it remembers nothing from before" });
    this.log.info(`respawn of ${participant.name}: fresh session, no replay`);
    return participant;
  }

  private async retireRuntime(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) return;
    runtime.retiring = true;
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

  private rewriteHistory(): void {
    writeFileAtomic(this.historyPath(), this.messages.map((m) => JSON.stringify(m)).join("\n") + (this.messages.length ? "\n" : ""));
  }

  private appendDeleted(records: ChatMessage[], editedSeq: number): void {
    if (!records.length) return;
    const lines = [JSON.stringify({ deletedAt: Date.now(), reason: "rewrite", editedSeq }), ...records.map((m) => JSON.stringify(m))];
    appendFileSync(join(this.dataDir, "history.deleted.jsonl"), lines.join("\n") + "\n");
  }

  focus(): void {
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
    this.postSystem(`Hush: ${stopped ? `${stopped} repl${stopped > 1 ? "ies" : "y"} stopped; ` : ""}everyone waits until ${this.humanName} writes again.`);
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
    const setNumber = (key: "hopLimit" | "fullBriefEveryTurns" | "fullBriefEveryTokens" | "replayAfterRestart" | "backlogCap", min: number, max: number) => {
      if (patch[key] === undefined) return;
      const value = Number(patch[key]);
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer between ${min} and ${max}`);
      if (value !== next[key]) {
        next[key] = value;
        changed.push(key);
      }
    };
    setNumber("hopLimit", 0, 10_000);
    setNumber("fullBriefEveryTurns", 1, 10_000);
    setNumber("fullBriefEveryTokens", 1000, 10_000_000);
    setNumber("replayAfterRestart", 0, 200);
    setNumber("backlogCap", 1, 1000);
    if (patch.replyDelay !== undefined) {
      const value = Number(patch.replyDelay);
      if (!Number.isFinite(value) || value < 0 || value > 120) throw new Error("replyDelay must be between 0 and 120 seconds");
      next.replyDelay = value;
    }
    const setText = (key: "topic" | "humanDescription" | "customRules" | "emoji", max: number) => {
      if (patch[key] === undefined) return;
      const value = String(patch[key]).slice(0, max);
      if (value !== next[key]) {
        next[key] = value;
        changed.push(key);
      }
    };
    setText("topic", 2000);
    setText("emoji", 8);
    setText("humanDescription", 200);
    let unknownRefs: string[] = [];
    if (patch.customRules !== undefined) {
      const resolved = this.resolveRuleReferences(String(patch.customRules).slice(0, 4000));
      unknownRefs = resolved.unknown;
      if (resolved.stored !== next.customRules) {
        next.customRules = resolved.stored;
        changed.push("customRules");
      }
    }
    if (patch.humanDescriptionMode !== undefined) {
      const mode = String(patch.humanDescriptionMode);
      if (mode !== "inherit" && mode !== "override" && mode !== "append" && mode !== "none") throw new Error("humanDescriptionMode must be inherit, override, append or none");
      if (mode !== next.humanDescriptionMode) {
        next.humanDescriptionMode = mode;
        changed.push("humanDescriptionMode");
      }
    }
    if (patch.refereeAction !== undefined) {
      const action = String(patch.refereeAction);
      if (action !== "next-header" && action !== "retry-hidden") throw new Error("refereeAction must be next-header or retry-hidden");
      if (action !== next.refereeAction) {
        next.refereeAction = action;
        changed.push("refereeAction");
      }
    }
    if (patch.turnTaking !== undefined) {
      const mode = String(patch.turnTaking);
      if (mode !== "parallel" && mode !== "one-at-a-time") throw new Error("turnTaking must be parallel or one-at-a-time");
      if (mode !== next.turnTaking) {
        next.turnTaking = mode;
        changed.push("turnTaking");
      }
    }
    if (patch.agentsWakeEachOther !== undefined) {
      const on = patch.agentsWakeEachOther === true || patch.agentsWakeEachOther === "true";
      if (on !== next.agentsWakeEachOther) {
        next.agentsWakeEachOther = on;
        changed.push("agentsWakeEachOther");
      }
    }
    if (patch.waitWhileHumanTypes !== undefined) {
      const on = patch.waitWhileHumanTypes === true || patch.waitWhileHumanTypes === "true";
      if (on !== next.waitWhileHumanTypes) {
        next.waitWhileHumanTypes = on;
        changed.push("waitWhileHumanTypes");
      }
    }
    if (patch.language !== undefined) {
      const raw = String(patch.language).trim();
      const language: RoomSettings["language"] = !raw || raw === "follow-human" ? { mode: "follow-human" } : { mode: "fixed", language: raw };
      if (JSON.stringify(language) !== JSON.stringify(next.language)) {
        next.language = language;
        changed.push("language");
      }
    }
    if (patch.tools !== undefined) {
      const tools = String(patch.tools);
      if (tools !== "on-request" && tools !== "never") throw new Error("tools must be on-request or never");
      if (tools !== next.tools) {
        next.tools = tools;
        changed.push("tools");
      }
    }
    if (patch.maxSentences !== undefined) {
      const value = patch.maxSentences === null || patch.maxSentences === "" ? null : Number(patch.maxSentences);
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > 100)) throw new Error("maxSentences must be 1-100 or empty");
      if (value !== next.maxSentences) {
        next.maxSentences = value;
        changed.push("maxSentences");
      }
    }
    for (const key of ["headerRules", "showVendorInRoster"] as const) {
      if (patch[key] !== undefined) {
        const value = patch[key] === true || patch[key] === "true";
        if (value !== next[key]) {
          next[key] = value;
          changed.push(key);
        }
      }
    }

    this.settings = next;
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
        this.postSystem(`${participant.name} is now called ${name}.`);
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
      participant.role = patch.role.trim().slice(0, 4000);
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

  setMuted(id: string, muted: boolean): Participant {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    if (!!participant.muted === muted) return participant;
    participant.muted = muted;
    const runtime = this.runtimes.get(id);
    if (muted && runtime) {
      this.dropScheduledTurn(id);
      if (runtime.turnActive) {
        runtime.agent.cancel(runtime.sessionId);
        this.cancelPermissionsOf(id);
      }
    }
    this.push({ type: "participant", participant });
    this.postSystem(muted ? `${participant.name} is muted and receives no prompts.` : `${participant.name} is unmuted.`);
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
    const launch = recipe.build({ model: null });
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
          const session = await this.openSession(agent, cwd, log);
          const result: DiscoveredOptions = {
            recipeId,
            agentInfo: { name: init.agentInfo?.name ?? null, version: init.agentInfo?.version ?? null },
            authMethods: agent.authMethods.map((m) => m.id),
            modes: session.modes ?? null,
            configOptions: session.configOptions ?? [],
            modelAtLaunch: !!recipe.modelAtLaunch,
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
      color: options.color ?? COLORS[this.colorIndex++ % COLORS.length],
      tagline: (options.tagline ?? "").trim().slice(0, 80),
      role: (options.role ?? "").trim().slice(0, 4000),
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

  addUnstaffed(input: { name: string; tagline?: string; role?: string; avatar?: string; skills?: string[]; color?: string; id?: string }): Participant {
    const name = input.name.trim();
    if (!NAME_PATTERN.test(name)) throw new Error("name must be 1-24 letters, digits, _ or - (no spaces)");
    if (this.findByName(name)) throw new Error(`name "${name}" is already taken`);
    const id = input.id ?? `vm-${name.toLowerCase()}`;
    const participant: Participant = {
      id,
      name,
      kind: "agent",
      status: "unstaffed",
      statusDetail: "awaiting a coding agent",
      turns: 0,
      color: input.color ?? COLORS[this.colorIndex++ % COLORS.length],
      tagline: (input.tagline ?? "").trim().slice(0, 80),
      role: (input.role ?? "").trim().slice(0, 4000),
      avatar: (input.avatar ?? "").trim().slice(0, 8) || undefined,
      skills: normalizeSkillList(input.skills),
      violations: 0,
      briefsSent: 0,
      failedTurns: 0,
    };
    this.participants.set(id, participant);
    this.push({ type: "participant", participant });
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

  async reconnect(id: string, options: ReconnectOptions = { mode: "replay" }): Promise<Participant> {
    const participant = this.participants.get(id);
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    if (this.runtimes.has(id) || participant.status === "starting") return participant;
    participant.status = "starting";
    participant.statusDetail = undefined;
    this.push({ type: "participant", participant });
    const launch = participant.launch ?? { model: participant.model ?? null, effort: participant.effort ?? null, mode: participant.mode ?? null };
    await this.startAgent(participant, launch, false, options);
    return participant;
  }

  private async startAgent(participant: Participant, launch: LaunchPrefs, fresh: boolean, reconnectOptions?: ReconnectOptions): Promise<void> {
    const recipe = getRecipe(participant.agentType ?? "");
    if (!recipe) throw new Error(`unknown agent type: ${participant.agentType}`);
    const id = participant.id;
    const name = participant.name;
    const log = this.log.child(name);
    const cwd = ensureDir(this.dir);
    const spec = recipe.build({ model: launch.model });
    const transcript = new Transcript(join(this.dataDir, "transcripts"), name);
    log.info(`spawning ${spec.command} ${spec.args.join(" ")} (cwd ${cwd}); transcript ${transcript.path}`);

    let agent: AcpAgent;
    try {
      agent = new AcpAgent(
        { ...spec, cwd },
        {
          onSessionUpdate: (_sessionId, update) => this.onSessionUpdate(id, update),
          onPermissionRequest: (params) => this.onPermissionRequest(id, params),
          onStderr: (line) => log.info(`stderr: ${line}`),
          onExit: (code, signal) => this.onAgentExit(id, code, signal, agent),
          onRaw: (direction, message) => transcript.record(direction, message),
          onProtocolError: (text) => log.warn(`protocol: ${text}`),
        },
      );
    } catch (error) {
      this.failStart(participant, error, fresh);
      throw error;
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
      if (!session) session = await this.openSession(agent, cwd, log, mcpServers);
      participant.sessionId = session.sessionId;
      participant.sessionOrigin = origin;
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
        turnsSinceBrief: 0,
        usedAtBrief: 0,
        briefSentThisTurn: false,
        lastUsed: 0,
        briefPending: null,
        headerNotes: [],
        briefRequestedAtSeq: -1,
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
        mode: launch.mode,
      });
      if (recipe.modelAtLaunch && launch.model) participant.model = launch.model;
      for (const w of warnings) this.notice(`${name}: ${w}`, "warn");

      participant.status = "idle";
      participant.statusDetail = undefined;
      this.push({ type: "participant", participant });
      if (fresh) {
        const detail = this.settings.showVendorInRoster ? `${recipe.label}${participant.model ? `, model ${participant.model}` : ""}` : "agent";
        this.postSystem(`${name} joined the room (${detail}${participant.tagline ? `; "${participant.tagline}"` : ""}).`);
        runtime.lastSeenSeq = this.seq;
        participant.sawFromSeq = this.seq + 1;
      } else if (origin === "loaded") {
        runtime.lastSeenSeq = storedSeen ?? Math.max(0, this.seq - this.settings.replayAfterRestart);
        runtime.firstTurnDone = true;
        runtime.briefPending = "reconnected: your stored session was restored";
        this.postSystem(`${name} is back in the room (session restored).`);
        if (participant.sawFromSeq === undefined) participant.sawFromSeq = runtime.lastSeenSeq + 1;
      } else {
        this.postSystem(reconnectOptions?.reason ? `${name} restarted: ${reconnectOptions.reason}.` : `${name} is back in the room.`);
        const replay = Math.max(0, reconnectOptions?.replay ?? this.settings.replayAfterRestart);
        const chats = this.messages.filter((m) => m.kind === "chat");
        const firstReplayed = replay > 0 && chats.length ? chats[Math.max(0, chats.length - replay)] : undefined;
        runtime.lastSeenSeq = firstReplayed ? Math.max(0, firstReplayed.seq - 1) : this.seq;
        participant.sawFromSeq = runtime.lastSeenSeq + 1;
      }
      this.restoredSeen.delete(id);
      this.push({ type: "participant", participant });
      runtime.turnStartSeq = runtime.lastSeenSeq;
      log.info(`ready: session ${session.sessionId}`);
    } catch (error) {
      agent.kill();
      this.forgetRuntime(id);
      this.failStart(participant, error, fresh);
      throw error;
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
    this.postSystem(`${participant.name} left the room.`);
    if (RULE_REF_TOKEN.test(this.settings.customRules)) {
      RULE_REF_TOKEN.lastIndex = 0;
      if (this.settings.customRules.includes(`@{p:${id}}`)) {
        for (const runtime of this.runtimes.values()) runtime.briefPending = "room rules: a referenced participant left";
      }
    }
  }

  cancelTurn(id: string): void {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) throw new Error("no such agent");
    if (!runtime.turnActive) return;
    runtime.agent.cancel(runtime.sessionId);
    this.cancelPermissionsOf(id);
    this.notice(`${participant.name}: stop requested.`, "info");
  }

  async setConfig(id: string, configId: string, value: string | boolean): Promise<void> {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) throw new Error("no such agent (offline?)");
    const hasOption = participant.configOptions?.some((o) => o.id === configId);
    if (!hasOption && configId === "mode" && participant.modes?.some((m) => m.id === value)) {
      await runtime.agent.setMode(runtime.sessionId, String(value));
      participant.mode = String(value);
    } else {
      participant.configOptions = await runtime.agent.setConfigOption(runtime.sessionId, configId, value);
      this.applyConfigSummary(participant);
    }
    participant.launch = { model: participant.model ?? null, effort: participant.effort ?? null, mode: participant.mode ?? null };
    this.push({ type: "participant", participant });
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

  async shutdown(): Promise<void> {
    this.closing = true;
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    for (const [id, runtime] of this.runtimes) {
      if (runtime.delayTimer) clearTimeout(runtime.delayTimer);
      runtime.delayTimer = null;
      runtime.pendingTurn = false;
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
          this.postSystem(`Hop limit ${this.hopLimit} reached: ${who} will not be prompted until ${this.humanName} writes again.`);
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
    if (!participant?.skills) return false;
    const lower = name.toLowerCase();
    return participant.skills.some((s) => s.toLowerCase() === lower);
  }

  private attachedSkills(participant: Participant): SkillMeta[] {
    if (!this.skills || !participant.skills?.length) return [];
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

  createSkillForAgent(participantId: string, input: AgentSkillInput): { ok: true; message: string; warnings: string[] } {
    const participant = this.participants.get(participantId);
    if (!participant || !this.runtimes.has(participantId)) throw new Error("this agent is not in the room any more");
    if (!this.skills) throw new Error("skills are not available in this hub");
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
    if (!this.skills) throw new Error("skills are not available in this hub");
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
    if (!this.skills) return { ok: false, reason: "skills are not available in this hub" };
    const skill = this.skills.library.get(name);
    const builtin = !!skill && skill.author === BUILTIN_AUTHOR && !skill.draft;
    const mine = this.attachedSkills(participant).filter((s) => s.agentInvocable).map((s) => s.name);
    const list = mine.length ? `your skills: ${mine.join(", ")}` : "you have no skills";
    if (!builtin && (!this.hasSkill(participant, name) || !mine.some((s) => s.toLowerCase() === name.toLowerCase()))) {
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
    const pattern = /load_skill/i;
    const call = params.toolCall;
    if (pattern.test(call.title ?? "")) return true;
    if (call.rawInput && pattern.test(JSON.stringify(call.rawInput))) return true;
    const known = runtime.turn?.message.toolCalls?.find((t) => t.toolCallId === call.toolCallId);
    return !!known && pattern.test(known.title ?? "");
  }

  private forgetRuntime(id: string): void {
    const runtime = this.runtimes.get(id);
    if (runtime?.mcpToken) this.skills?.revokeToken(runtime.mcpToken);
    if (runtime?.delayTimer) clearTimeout(runtime.delayTimer);
    this.runtimes.delete(id);
  }

  private requestTurn(id: string, addressed = false): void {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) return;
    runtime.pendingTurn = true;
    if (addressed && !runtime.addressed) {
      runtime.addressed = true;
      if (this.floorQueue.includes(id)) {
        this.floorQueue.splice(this.floorQueue.indexOf(id), 1);
        this.enqueueForFloor(id);
      }
    }
    if (runtime.turnActive || runtime.delayTimer || this.floorQueue.includes(id)) return;
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
    if (!runtime || !runtime.pendingTurn) return;
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
      if (!this.speaking) this.startNext();
    }, wait);
  }

  private startNext(): void {
    if (this.humanIsTyping()) {
      this.armTypingTimer();
      return;
    }
    while (this.floorQueue.length) {
      const id = this.floorQueue.shift()!;
      const runtime = this.runtimes.get(id);
      const participant = this.participants.get(id);
      if (!runtime || !participant || !runtime.pendingTurn || participant.muted || this.focused) continue;
      void this.runTurn(id);
      return;
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
    if (!participant || !runtime) return;
    this.speaking = id;
    runtime.addressed = false;
    try {
      await this.runTurnInner(id, participant, runtime);
    } finally {
      if (this.speaking === id) this.speaking = null;
      if (participant.status === "queued") {
        participant.status = "idle";
        this.push({ type: "participant", participant });
      }
      if (runtime.pendingTurn && runtime.agent.alive) this.requestTurn(id);
      this.startNext();
    }
  }

  private async runTurnInner(id: string, participant: Participant, runtime: AgentRuntime): Promise<void> {
    runtime.pendingTurn = false;
    if (!runtime.agent.alive || participant.muted || this.focused) return;
    await this.awaitSkillChannel(participant, runtime);
    if (!runtime.agent.alive || participant.muted || this.focused) return;

    const unreadAll = this.messages.filter(
      (m) => m.kind !== "hidden" && m.audience !== "human" && m.seq > runtime.lastSeenSeq && (m.kind === "system" || m.from !== id || m.seq <= runtime.replayOwnUntilSeq),
    );
    if (!unreadAll.some((m) => m.kind === "chat" || m.wakes)) return;
    const cap = this.settings.backlogCap;
    const omitted = Math.max(0, unreadAll.length - cap);
    const unread = omitted ? unreadAll.slice(omitted) : unreadAll;
    runtime.turnStartSeq = runtime.lastSeenSeq;
    runtime.lastSeenSeq = this.seq;

    const persona = this.personaOf(participant);
    const roster = this.roster();
    const settings = this.effectiveSettings();
    const tokensSinceBrief = runtime.lastUsed - runtime.usedAtBrief;
    let briefReason: string | null = null;
    if (!runtime.firstTurnDone) briefReason = "first turn";
    else if (runtime.briefPending) briefReason = runtime.briefPending;
    else if (runtime.turnsSinceBrief >= this.settings.fullBriefEveryTurns) briefReason = `every ${this.settings.fullBriefEveryTurns} turns`;
    else if (tokensSinceBrief >= this.settings.fullBriefEveryTokens) briefReason = `${tokensSinceBrief} tokens since last brief`;

    const notes = [...runtime.headerNotes];
    runtime.headerNotes = [];
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
    const seesImages = runtime.agent.acceptsImages;
    const backlogImages = (m: ChatMessage): BacklogImage[] | undefined => {
      if (!m.images || !m.images.length) return undefined;
      const attached = seesImages && (m.to.length === 0 || m.to.includes(id));
      return m.images.map((a, i) => ({ n: a.n ?? i + 1, ref: `#${m.seq}.${a.n ?? i + 1}`, name: a.name, path: this.imagePath(a), mimeType: a.mimeType, attached, forNames: m.to.length ? m.toNames : [] }));
    };
    const prompt = composePrompt({
      brief: briefReason ? buildBrief(settings, persona, roster, undefined, skillsForPrompt) : undefined,
      header: buildHeader(settings, persona, roster, this.hops, notes, skillsForPrompt),
      skills: attached.map((s) => composeSkillBlock({ name: s.name, text: s.text, invokedBy: s.invokedBy, extraFiles: s.extraFiles })),
      backlog: unread.map<BacklogLine>((m) =>
        m.kind === "system"
          ? { kind: "event", text: m.text }
          : {
              kind: "message",
              fromName: m.from === id ? `${m.fromName} (you, earlier)` : m.fromName,
              toNames: m.toNames,
              text: m.text,
              images: backlogImages(m),
            },
      ),
      omitted,
      personaName: participant.name,
    });
    if (briefReason) {
      runtime.briefPending = null;
      runtime.turnsSinceBrief = 0;
      runtime.briefSentThisTurn = true;
      participant.briefsSent = (participant.briefsSent ?? 0) + 1;
    }
    runtime.firstTurnDone = true;
    runtime.replayOwnUntilSeq = -1;
    runtime.log.info(`turn: ${unread.length} unread (${omitted} omitted), brief=${briefReason ?? "no"}, notes=${notes.length}`);

    const retry = await this.executeTurn(participant, runtime, this.promptBlocks(prompt, runtime), null);
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

  private async executeTurn(participant: Participant, runtime: AgentRuntime, blocks: ContentBlock[], retry: RetryRequest | null): Promise<RetryRequest | null> {
    const id = participant.id;
    runtime.turnActive = true;
    participant.status = "thinking";
    participant.statusDetail = undefined;
    this.push({ type: "participant", participant });

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
    runtime.turn = { message: draft, messageId: null, sawMessageId: false, startedAt: Date.now(), published: false };

    let result: PromptResult | null = null;
    let failure: string | null = null;
    try {
      result = await runtime.agent.prompt(runtime.sessionId, blocks);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    const startedAt = runtime.turn.startedAt;
    const published = runtime.turn.published;
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
      participant.status = runtime.agent.alive ? "idle" : "error";
      participant.statusDetail = `last turn failed: ${(failure ?? "no result").replace(/\s+/g, " ").slice(0, 120)}`;
      participant.failedTurns = (participant.failedTurns ?? 0) + 1;
      this.push({ type: "participant", participant });
      this.push({ type: "message.removed", id: draft.id });
      this.notice(`${participant.name}: turn failed: ${failure ?? "no result"}`, "error");
      this.postSystem(`${participant.name} could not answer: ${(failure ?? "no result").slice(0, 240)}`);
      runtime.log.error(`turn failed: ${failure}`);
      if (retry) this.closeRetry(retry, "the correction turn failed; nothing was posted");
      return null;
    }
    return this.finalizeTurn(participant, runtime, draft, result, Date.now() - startedAt, retry, published);
  }

  private finalizeTurn(
    participant: Participant,
    runtime: AgentRuntime,
    draft: ChatMessage,
    result: PromptResult,
    durationMs: number,
    retry: RetryRequest | null,
    published: boolean,
  ): RetryRequest | null {
    participant.status = "idle";
    this.push({ type: "participant", participant });

    const text = draft.text.trim();
    const cancelled = result.stopReason === "cancelled";
    if (cancelled) runtime.briefPending = runtime.briefPending ?? "previous turn was cancelled";

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
      if (published) this.push({ type: "message.removed", id: draft.id });
      if (retry) {
        this.closeRetry(retry, cancelled ? "the correction turn was stopped; nothing was posted" : "the agent withdrew the reply");
        if (cancelled) this.postSystem(`${participant.name} was stopped.`);
      } else {
        this.postSystem(cancelled ? `${participant.name} was stopped.` : `${participant.name} read the room and has nothing to add.`);
      }
      return null;
    }

    if (!(draft.toolCalls?.length) && ADAPTER_ERROR_PATTERN.test(text)) {
      this.push({ type: "message.removed", id: draft.id });
      participant.failedTurns = (participant.failedTurns ?? 0) + 1;
      participant.statusDetail = `agent error: ${text.replace(/\s+/g, " ").slice(0, 120)}${text.length > 120 ? "…" : ""}`;
      this.push({ type: "participant", participant });
      this.postSystem(`${participant.name}'s agent reported an error instead of a reply: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`);
      runtime.log.warn(`adapter error text treated as failed turn: ${text.slice(0, 200)}`);
      if (retry) this.closeRetry(retry, "the agent reported an error instead of a corrected reply");
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
      usage: result.usage ?? null,
      durationMs,
    };
    this.commit(message);
    if (this.messages.some((x) => x.kind === "chat" && x.id !== message.id && x.ts > draft.ts)) {
      const at = new Date(draft.ts);
      const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
      this.postSystem(`${participant.name} finished the reply started at ${hhmm} · ${Math.round(durationMs / 1000)} s`, "human", false, { refId: message.id, agentId: participant.id });
    }
    if (retry) {
      this.closeRetry(retry, corrections.length ? `corrected reply posted, but it still breaks: ${corrections.map((c) => c.replace(/^reminder:\s*/i, "")).join("; ")}` : "corrected reply posted");
    }
    if (cancelled) {
      this.postSystem(`${participant.name} was stopped mid-reply; the partial reply stays in the log.`);
      return null;
    }
    if (result.stopReason !== "end_turn") {
      this.postSystem(`${participant.name} stopped with ${result.stopReason}.`);
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
    for (const match of text.matchAll(MENTION_PATTERN)) {
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
    if (turn.published) return;
    turn.published = true;
    this.push({ type: "message", message: turn.message });
  }

  private onSessionUpdate(id: string, update: SessionUpdate): void {
    const runtime = this.runtimes.get(id);
    const participant = this.participants.get(id);
    if (!runtime || !participant) return;
    const turn = runtime.turn;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (!turn) return;
        const u = update as { content: ContentBlock; messageId?: string | null };
        let text = contentText(u.content);
        const messageId = u.messageId ?? null;
        if (messageId && !turn.sawMessageId && turn.message.text) {
          const notices = (turn.message.notices ??= []);
          notices.push(turn.message.text.trim());
          turn.message.text = "";
          if (turn.published) this.push({ type: "message", message: turn.message });
        } else if (messageId !== turn.messageId && turn.message.text) {
          text = "\n\n" + text;
        }
        if (messageId) turn.sawMessageId = true;
        turn.messageId = messageId;
        turn.message.text += text;
        if (!turn.published) {
          if (!looksSilent(turn.message.text)) this.showDraft(turn);
          return;
        }
        this.push({ type: "chunk", id: turn.message.id, text });
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
        if (u.title) view.title = u.title;
        if (u.kind !== undefined) view.kind = u.kind;
        if (u.status !== undefined) view.status = u.status;
        if (u.rawInput !== undefined) view.rawInput = u.rawInput;
        const output = toolOutputText(u);
        if (output) view.output = output;
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
        participant.contextUsed = u.used;
        participant.contextSize = u.size;
        if (u.cost) participant.cost = { amount: u.cost.amount, currency: u.cost.currency };
        if (runtime.lastUsed > 0 && u.used < runtime.lastUsed * 0.7 && !runtime.briefPending) {
          runtime.briefPending = `context shrank from ${runtime.lastUsed} to ${u.used} tokens (compaction?)`;
          runtime.log.info(`usage dropped ${runtime.lastUsed} -> ${u.used}; brief scheduled`);
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
      const option = params.options.find((o) => o.kind === "allow_always") ?? params.options.find((o) => o.kind === "allow_once");
      if (option) {
        runtime.log.info(`skills: ${SKILL_TOOL_NAME} permission auto-approved (${option.optionId})`);
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


  private async openSession(agent: AcpAgent, cwd: string, log: Logger, mcpServers: McpServer[] = []): Promise<NewSessionResult> {
    try {
      return await agent.newSession(cwd, mcpServers);
    } catch (error) {
      if (!isAuthRequired(error) || !agent.authMethods.length) throw error;
      log.info(`session/new needs authentication: ${describeError(error)}`);
    }
    const failures: string[] = [];
    for (const method of agent.authMethods) {
      log.info(`authenticate with "${method.id}"${method.name ? ` (${method.name})` : ""}`);
      try {
        await agent.authenticate(method.id);
        return await agent.newSession(cwd, mcpServers);
      } catch (error) {
        failures.push(`${method.id}: ${describeError(error)}`);
      }
    }
    throw new Error(`authentication failed; log in with the agent's own CLI first. ${failures.join("; ")}`);
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
            await runtime.agent.setMode(runtime.sessionId, value);
            participant.mode = value;
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

  private failStart(participant: Participant, error: unknown, fresh: boolean): void {
    participant.statusDetail = error instanceof Error ? error.message : String(error);
    this.notice(`${participant.name}: failed to start: ${participant.statusDetail}`, "error");
    if (fresh) {
      participant.status = "error";
      this.push({ type: "participant", participant });
      this.participants.delete(participant.id);
      this.push({ type: "participant.removed", id: participant.id });
    } else {
      participant.status = "offline";
      this.push({ type: "participant", participant });
    }
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
    return [...this.participants.values()]
      .filter((p) => p.status !== "left" && p.status !== "unstaffed")
      .map((p) => ({ name: p.name, kind: p.kind, vendor: p.agentVendor ?? p.agentLabel, tagline: p.tagline || undefined, muted: p.muted || undefined }));
  }

  private parseMentions(text: string): { ids: string[]; names: string[] } {
    const ids: string[] = [];
    const names: string[] = [];
    for (const match of text.matchAll(MENTION_PATTERN)) {
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

  private postSystem(text: string, audience?: "agents" | "human", wakes?: boolean, details?: ChatMessage["details"]): void {
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
    this.postSystem(`The room moved to ${next}${restarted.length ? `; ${restarted.join(", ")} restarted there` : ""}.`);
    this.log.info(`working directory: ${previous} -> ${next}`);
    return { dir: next, restarted };
  }

  private roomEvent(): RoomEvent {
    return {
      type: "room",
      hopLimit: this.hopLimit,
      hops: this.hops,
      settings: this.settings,
      customRulesText: this.renderRuleReferences(this.settings.customRules),
      focused: this.focused,
      name: this.name,
      dir: this.dir,
    };
  }

  private notice(text: string, level: "info" | "warn" | "error"): void {
    if (level === "error") this.log.error(text);
    else if (level === "warn") this.log.warn(text);
    else this.log.info(text);
    this.push({ type: "notice", text, level, ts: Date.now() });
  }

  private push(event: RoomEvent): void {
    if (event.type === "participant") {
      const id = event.participant.id;
      const lastSeenSeq = this.runtimes.get(id)?.lastSeenSeq ?? this.restoredSeen.get(id);
      this.emit("event", { ...event, participant: { ...event.participant, lastSeenSeq } });
      return;
    }
    this.emit("event", event);
  }
}

function isAuthRequired(error: unknown): boolean {
  if (error instanceof RemoteError) return error.rpc.code === -32000 || /auth/i.test(error.rpc.message);
  return error instanceof Error && /auth/i.test(error.message);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function looksSilent(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.length <= SILENT_MARKER.length && SILENT_MARKER.startsWith(t);
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
