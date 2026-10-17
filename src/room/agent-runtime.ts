// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { AcpAgent } from "../acp-client.js";
import type { InstructionRevisions } from "../instruction-delivery.js";
import type { Logger, Transcript } from "../log.js";
import type { NotesSource } from "../persona.js";
import type { ChatMessage, NativeObligationRef, PendingSkill, RetryRequest } from "../room.js";

export interface RuntimeSession {
  agent: AcpAgent;
  sessionId: string;
  installStamp: string | null;
  transcript: Transcript;
  log: Logger;
  mcpToken: string | null;
  sessionStartedAt: number;
  retiring: boolean;
  firstTurnDone: boolean;
  lastUsed: number;
  cwd: string;
}

export interface WorkGate {
  promise: Promise<void>;
  resolve: () => void;
}

export interface WorkHold {
  runtime: AgentRuntime;
  gate: WorkGate;
}

export function holdsWork(hold: Pick<WorkHold, "runtime" | "gate">): boolean {
  return hold.runtime.work.workSettled === hold.gate;
}

export interface RuntimeWork {
  turnActive: boolean;
  turn: { message: ChatMessage; messageId: string | null; sawMessageId: boolean; startedAt: number; lastSignAt?: number; lastWorkAt?: number; published: boolean; publishedAt?: number; hidden?: boolean; messagesFromSeq: number; inputThrough?: number; shownLength?: number } | null;
  workBusy?: boolean;
  workSettled?: WorkGate;
  workCancelled?: boolean;
  roomStopped?: boolean;
  usageSeenThisTurn?: boolean;
  fixedDiagramThisTurn?: boolean;
  quiet?: { turnId: string; nudge?: "asking" | "answered" | "silent" };
  strayMessageId: string | null;
  promptedThisWork?: boolean;
}

export interface RuntimeQueue {
  pendingTurn: boolean;
  independentPendingTurn?: boolean;
  missedNotice?: boolean;
  delayTimer: NodeJS.Timeout | null;
  addressed: boolean;
  pendingConfig?: { configId: string; value: string | boolean; from?: string }[];
}

export interface RuntimeReading {
  lastSeenSeq: number;
  turnStartSeq: number;
  replayOwnUntilSeq: number;
  historyNoticePending: boolean;
}

export interface RuntimeBrief {
  turnsSinceBrief: number;
  usedAtBrief: number;
  briefSentThisTurn: boolean;
  briefPending: string | null;
  instructionRevisions?: InstructionRevisions;
  skillCatalogPending?: boolean;
  memoryStamp?: string;
  memoryGraphStamp?: string;
  headerNotes: string[];
  briefRequestedAtSeq: number;
  lastBriefSeq: number;
}

export interface RuntimeNotes {
  notesDue: boolean;
  notesMisses: number;
  notesAskedThisTurn: boolean;
  notesPending?: boolean;
  deferredNotesTurn?: boolean;
  resumeNotes: Exclude<NotesSource, "live"> | null;
}

export interface RuntimeNative {
  nativeDraining?: boolean;
  nativeHold?: boolean;
  nativePromptObligations?: NativeObligationRef[];
  nativeHeaderObligations?: NativeObligationRef[];
  backgroundMessages?: Set<string>;
  backgroundCorrections?: RetryRequest[];
  backgroundBacklogPending?: boolean;
}

export interface RuntimeSkills {
  skillChannel: "tool" | "marker" | "pending";
  skillReadyWaiters: (() => void)[];
  pendingSkills: PendingSkill[];
  skillPulledAtSeq: number;
  skillPulledName: string;
}

export interface AgentRuntime {
  readonly session: RuntimeSession;
  readonly work: RuntimeWork;
  readonly queue: RuntimeQueue;
  readonly reading: RuntimeReading;
  readonly brief: RuntimeBrief;
  readonly notes: RuntimeNotes;
  readonly native: RuntimeNative;
  readonly skills: RuntimeSkills;
}

export interface AgentRuntimeInit {
  agent: AcpAgent;
  sessionId: string;
  transcript: Transcript;
  log: Logger;
  installStamp?: string | null;
  mcpToken?: string | null;
  sessionStartedAt?: number;
  lastSeenSeq?: number;
  replayOwnUntilSeq?: number;
  historyNoticePending?: boolean;
  skillChannel?: RuntimeSkills["skillChannel"];
  cwd: string;
}

export function createAgentRuntime(init: AgentRuntimeInit): AgentRuntime {
  const seen = init.lastSeenSeq ?? 0;
  return {
    session: {
      agent: init.agent, sessionId: init.sessionId, installStamp: init.installStamp ?? null, transcript: init.transcript, log: init.log,
      mcpToken: init.mcpToken ?? null, sessionStartedAt: init.sessionStartedAt ?? Date.now(), retiring: false, firstTurnDone: false, lastUsed: 0,
      cwd: init.cwd,
    },
    work: { turnActive: false, turn: null, strayMessageId: null },
    queue: { pendingTurn: false, delayTimer: null, addressed: false },
    reading: { lastSeenSeq: seen, turnStartSeq: seen, replayOwnUntilSeq: init.replayOwnUntilSeq ?? -1, historyNoticePending: init.historyNoticePending ?? false },
    brief: { turnsSinceBrief: 0, usedAtBrief: 0, briefSentThisTurn: false, briefPending: null, headerNotes: [], briefRequestedAtSeq: -1, lastBriefSeq: -1 },
    notes: { notesDue: false, notesMisses: 0, notesAskedThisTurn: false, resumeNotes: null },
    native: {},
    skills: { skillChannel: init.skillChannel ?? "marker", skillReadyWaiters: [], pendingSkills: [], skillPulledAtSeq: -1, skillPulledName: "" },
  };
}
