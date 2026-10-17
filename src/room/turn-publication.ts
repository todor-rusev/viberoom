// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import type { PromptResult } from "../acp-types.js";
import type { AutomationOutcome } from "../automations.js";
import { extractNotes, isContextFullError } from "../context.js";
import { formatDuration } from "../duration.js";
import { composeCorrectionPrompt } from "../persona.js";
import { getRecipe } from "../recipes.js";
import type { ChatMessage, Participant, RetryRequest, RoomEvent, StoreOutcome, ToolCallView } from "../room.js";
import { renderSkillBody, type Skill } from "../skills.js";
import type { AgentRuntime, WorkGate } from "./agent-runtime.js";
import type { MessageDraft } from "./messages.js";
import * as presence from "./presence.js";
import { briefAskedAgain, endedBy as turnEndedBy, failedTurn, keepsFailedBubble, notesMissAfterReply, replyKind, settleEnd } from "./turn-outcome.js";

export interface SettledOwner {
  readonly phase: "settled";
  readonly participant: Participant;
  readonly runtime: AgentRuntime;
  readonly gate: WorkGate;
}

export interface BackgroundOwner {
  readonly phase: "background";
  readonly participant: Participant;
  readonly runtime: AgentRuntime;
}

export type PublicationOwner = SettledOwner | BackgroundOwner;

export interface SettledTurn {
  readonly draft: ChatMessage;
  readonly result: PromptResult | null;
  readonly failure: string | null;
  readonly failureCode: string;
  readonly startedAt: number;
  readonly published: boolean;
  readonly publishedAt: number | null;
}

export interface TurnPublicationPorts {
  held(owner: PublicationOwner): boolean;
  withdraw(draft: ChatMessage, retry: RetryRequest | null): void;
  humanName(): string;
  refereeAction(): string;
  referee(participant: Participant, text: string): string[];
  mentions(text: string): { ids: string[]; names: string[] };
  correctionHeader(participant: Participant): string;
  postedAfter(messageId: string, ts: number): boolean;
  resolveSkill(participant: Participant, name: string): { ok: true; skill: Skill } | { ok: false; reason: string };
  commit(owner: PublicationOwner, draft: MessageDraft): { message: ChatMessage; stored: StoreOutcome } | null;
  push(owner: PublicationOwner, event: RoomEvent): boolean;
  postRoomEvent(owner: PublicationOwner, text: string, audience?: "agents" | "human", wakes?: boolean, details?: ChatMessage["details"]): ChatMessage | null;
  postSystem(owner: PublicationOwner, text: string, audience?: "agents" | "human", wakes?: boolean, details?: ChatMessage["details"]): ChatMessage | null;
  notice(owner: PublicationOwner, text: string, level: "info" | "warn" | "error"): boolean;
  closeRetry(owner: PublicationOwner, retry: RetryRequest, outcome: string): boolean;
  compaction(owner: SettledOwner, used: number, size: number): boolean;
  keepNotes(owner: PublicationOwner, notes: string | null, via: "reply" | "hidden turn"): "kept" | "none" | "refused";
  askNotes(owner: SettledOwner, how: "reply" | "hidden turn"): boolean;
  contextFull(owner: SettledOwner, detail: string): boolean;
  requestTurn(owner: SettledOwner): boolean;
  route(owner: PublicationOwner, message: ChatMessage): boolean;
  queueBackgroundCorrection(owner: BackgroundOwner, retry: RetryRequest): boolean;
  unconfirmed(owner: BackgroundOwner, messageId: string, retry: RetryRequest | null, reportHash: string | null): void;
  automationAssigned(id: string): boolean;
  automationEnded(owner: SettledOwner, outcome: AutomationOutcome): boolean;
  automationFailed(owner: SettledOwner, detail: string): boolean;
  automationDelivered(owner: SettledOwner, stored: boolean, messageId: string): boolean;
  automationContinuing(owner: SettledOwner, value: boolean): boolean;
  completionCarried(id: string): unknown;
  completionConfirmed(owner: SettledOwner, value: boolean): boolean;
  completionContinuing(owner: SettledOwner, value: boolean): boolean;
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

export class TurnPublication {
  private disposed = false;

  constructor(private readonly ports: TurnPublicationPorts) {}

  dispose(): void {
    this.disposed = true;
  }

  private live(owner: PublicationOwner): boolean {
    return !this.disposed && this.ports.held(owner) && !this.disposed;
  }

  private after(owner: PublicationOwner, done: unknown): boolean {
    return !!done && this.live(owner);
  }

  settle(owner: SettledOwner, turn: SettledTurn, retry: RetryRequest | null, extras: { hidden: boolean; historyNoticeOffered: boolean }): RetryRequest | null {
    const { participant, runtime } = owner, id = participant.id;
    const { draft, failureCode, startedAt, published, publishedAt } = turn, { hidden, historyNoticeOffered } = extras;
    if (this.disposed) return null;
    if (!this.live(owner)) {
      if (!this.disposed) this.ports.withdraw(draft, retry);
      return null;
    }
    participant.turns += 1;
    if (!retry) runtime.brief.turnsSinceBrief += 1;
    if (runtime.session.retiring) {
      this.ports.withdraw(draft, retry);
      return null;
    }
    const settled = settleEnd({ result: turn.result, failure: turn.failure, roomStopped: !!runtime.work.roomStopped });
    if (settled.settledByRoom) runtime.session.log.info(`the turn ended with the room's shutdown: ${turn.failure ?? "no result"}`);
    const { result, failure } = settled;
    if (failure || !result) return this.failed(owner, draft, failure, failureCode, startedAt, published, retry, hidden);
    const failedBefore = participant.failedTurns ?? 0;
    if (!hidden) {
      if (!this.after(owner, this.ports.automationEnded(owner, { status: result.stopReason === "cancelled" ? "cancelled" : result.stopReason === "end_turn" ? "completed" : "failed",
        delivery: "silent", detail: result.stopReason === "end_turn" ? "The assigned vibemate finished its reply." : `The reply ended with ${result.stopReason}.` }))) return null;
      if (!this.after(owner, this.ports.completionConfirmed(owner, result.stopReason === "end_turn" && (participant.failedTurns ?? 0) === failedBefore))) return null;
    }
    const carried = !hidden ? this.ports.completionCarried(id) : undefined;
    const next = this.finalize(owner, draft, result, Date.now() - startedAt, retry, published, publishedAt, hidden);
    if (!this.live(owner)) return next;
    const stillCarried = carried ? this.ports.completionCarried(id) : undefined;
    if (!this.live(owner)) return next;
    if (carried && stillCarried === carried && (participant.failedTurns ?? 0) !== failedBefore) {
      if (!this.after(owner, this.ports.completionConfirmed(owner, false))) return next;
    }
    if (historyNoticeOffered && result.stopReason !== "cancelled" && !runtime.work.workCancelled && (participant.failedTurns ?? 0) === failedBefore) {
      runtime.reading.historyNoticePending = false;
    }
    return next;
  }

  private failed(owner: SettledOwner, draft: ChatMessage, failure: string | null, failureCode: string, startedAt: number, published: boolean,
    retry: RetryRequest | null, hidden: boolean): null {
    const { participant, runtime } = owner;
    if (!hidden && !this.after(owner, this.ports.automationFailed(owner, failure ?? "No result was returned."))) return null;
    runtime.brief.briefPending = runtime.brief.briefPending ?? "previous turn failed";
    runtime.brief.briefSentThisTurn = false;
    presence.turnFailed(participant, `last turn failed: ${(failure ?? "no result").replace(/\s+/g, " ").slice(0, 120)}`);
    participant.failedTurns = (participant.failedTurns ?? 0) + 1;
    const keepFailed = keepsFailedBubble({ published, hidden, retry: !!retry, hasWork: !!(draft.toolCalls?.length || draft.text || draft.thought) });
    const shown = keepFailed
      ? this.ports.commit(owner, { ...draft, to: [], toNames: [], streaming: false, audience: "human",
        failed: (failure ?? "no result").replace(/\s+/g, " ").slice(0, 240), usage: draft.usage ?? null, durationMs: Date.now() - startedAt })
      : this.ports.push(owner, { type: "message.removed", id: draft.id });
    if (!this.after(owner, shown)) return null;
    runtime.session.log.error(`turn failed: ${failure}`);
    const kept = runtime.session.transcript.dump(`turn failed: ${(failure ?? "no result").slice(0, 120)}`);
    if (kept) runtime.session.log.info(`the protocol around the failure was kept: ${kept}`);
    if (retry && !this.after(owner, this.ports.closeRetry(owner, retry, "the correction turn failed; nothing was posted"))) return null;
    if (isContextFullError(failure)) {
      presence.turnEnded(participant, !runtime.session.agent.alive);
      if (!this.after(owner, this.ports.push(owner, { type: "participant", participant }))) return null;
      this.ports.contextFull(owner, failure ?? "");
      return null;
    }
    const recipe = getRecipe(participant.agentType ?? "");
    const { trouble, paused } = failedTurn({ failure, code: failureCode, vendor: recipe?.vendor ?? participant.agentVendor ?? "The coding agent",
      alive: runtime.session.agent.alive, loginCommand: recipe?.loginCommand || undefined, loginFromHere: !!recipe && recipe.loginFlow.kind !== "none",
      previous: participant.trouble });
    presence.troubled(participant, trouble);
    presence.turnEnded(participant, paused);
    if (!this.after(owner, this.ports.push(owner, { type: "participant", participant }))) return null;
    if (paused) {
      runtime.session.log.warn(`paused after ${trouble.streak} ${trouble.kind} failure(s): waiting for the human`);
      this.ports.postRoomEvent(owner, `${participant.name} needs you: ${trouble.what} ${trouble.advice}`, "human", false, { tone: "attention" });
    } else {
      this.ports.postRoomEvent(owner, `${participant.name} could not answer: ${(failure ?? "no result").slice(0, 240)}`, undefined, false, { tone: "error" });
    }
    return null;
  }

  finalize(owner: SettledOwner, draft: ChatMessage, result: PromptResult, durationMs: number, retry: RetryRequest | null, published: boolean,
    publishedAt: number | null = null, hidden = false): RetryRequest | null {
    const { participant, runtime } = owner;
    if (!this.live(owner)) return null;
    presence.turnEnded(participant);
    if (!runtime.work.usageSeenThisTurn) {
      const used = tokensCarried(result);
      if (used !== null) {
        participant.contextUsed = used;
        if (!this.after(owner, this.ports.compaction(owner, used, participant.contextSize ?? 0))) return null;
        runtime.session.lastUsed = used;
        runtime.session.log.info(`context from the result: ${used} input tokens${participant.contextSize ? ` of ${participant.contextSize}` : " (window size unknown)"}`);
      }
    }
    if (runtime.brief.briefSentThisTurn) {
      runtime.brief.usedAtBrief = runtime.session.lastUsed;
      runtime.brief.briefSentThisTurn = false;
    }
    presence.turnTroubleCleared(participant);
    if (!this.after(owner, this.ports.push(owner, { type: "participant", participant }))) return null;

    const cancelled = result.stopReason === "cancelled";
    const endedBy: ChatMessage["cancelledBy"] = turnEndedBy({ cancelled, workCancelled: !!runtime.work.workCancelled, roomStopped: !!runtime.work.roomStopped });
    const stoppedByHuman = endedBy === "human";
    const stopRow = () => endedBy === "human" ? `${participant.name} was stopped by ${this.ports.humanName()}${stoppedWork(draft)}.`
      : endedBy === "room" ? `${participant.name}'s turn ended when viberoom stopped${stoppedWork(draft)}.`
      : `${participant.name}'s agent ended the turn${stoppedWork(draft)}.`;
    if (cancelled) runtime.brief.briefPending = runtime.brief.briefPending ?? "previous turn was cancelled";

    const extracted = extractNotes(draft.text);
    const keptNotes = this.ports.keepNotes(owner, extracted.notes, hidden ? "hidden turn" : "reply");
    if (!this.after(owner, keptNotes !== "refused")) return null;
    const hadNotes = keptNotes === "kept";
    draft.text = extracted.visible;
    const text = draft.text.trim();
    const words = replyKind({ text, hidden, retry: !!retry, cancelled, hasToolCalls: !!draft.toolCalls?.length });
    if (words.kind === "notes_only") {
      this.ports.commit(owner, {
        id: randomUUID(),
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
    const miss = notesMissAfterReply({ asked: runtime.notes.notesAskedThisTurn, hadNotes, retry: !!retry, cancelled, misses: runtime.notes.notesMisses });
    if (miss) {
      runtime.notes.notesMisses = miss.misses;
      if (miss.askHidden) this.ports.askNotes(owner, "hidden turn");
      if (!this.live(owner)) return null;
    }

    if (words.kind === "request_brief") {
      if (!this.after(owner, this.ports.push(owner, { type: "message.removed", id: draft.id }))) return null;
      if (briefAskedAgain({ briefRequestedAtSeq: runtime.brief.briefRequestedAtSeq, lastSeenSeq: runtime.reading.lastSeenSeq })) {
        this.ports.notice(owner, `${participant.name} asked for the brief twice on the same messages; treated as silent.`, "warn");
        return null;
      }
      runtime.brief.briefRequestedAtSeq = runtime.reading.lastSeenSeq;
      runtime.reading.lastSeenSeq = runtime.reading.turnStartSeq;
      runtime.brief.briefPending = "requested by the agent";
      if (!this.after(owner, this.ports.automationContinuing(owner, true))) return null;
      if (!this.after(owner, this.ports.completionContinuing(owner, true))) return null;
      if (!this.after(owner, this.ports.notice(owner, `${participant.name} asked for the room brief (hidden turn); re-sending with the same messages.`, "info"))) return null;
      this.ports.requestTurn(owner);
      return null;
    }

    if (words.kind === "skill_pull") {
      if (!this.after(owner, this.ports.push(owner, { type: "message.removed", id: draft.id }))) return null;
      if (!this.after(owner, this.skillPull(owner, text, words.name))) return null;
      if (!this.after(owner, this.ports.automationContinuing(owner, runtime.queue.pendingTurn))) return null;
      this.ports.completionContinuing(owner, runtime.queue.pendingTurn);
      return null;
    }

    if (words.kind === "silent") {
      const keepBubble = words.keepBubble;
      if (published && !keepBubble && !this.after(owner, this.ports.push(owner, { type: "message.removed", id: draft.id }))) return null;
      if (keepBubble) {
        const stoppedBy = stoppedByHuman ? this.ports.humanName() : undefined;
        if (!this.live(owner)) return null;
        if (!this.after(owner, this.ports.commit(owner, { ...draft, to: [], toNames: [], text: "", streaming: false,
          stopReason: result.stopReason, cancelledBy: endedBy,
          ...(stoppedBy !== undefined ? { stoppedBy } : {}),
          audience: "human", usage: result.usage ?? null, durationMs }))) return null;
      }
      if (retry) {
        if (!this.after(owner, this.ports.closeRetry(owner, retry, cancelled ? "the correction turn was stopped; nothing was posted" : "the agent withdrew the reply"))) return null;
        if (cancelled) this.stopped(owner, stopRow());
      } else if (cancelled) {
        this.stopped(owner, stopRow());
      } else if (!runtime.work.fixedDiagramThisTurn) {
        this.ports.postSystem(owner, `${participant.name} read the room and has nothing to add.`);
      }
      return null;
    }

    if (words.kind === "adapter_error") {
      if (!this.after(owner, this.ports.automationFailed(owner, text.slice(0, 1000)))) return null;
      runtime.brief.briefPending = runtime.brief.briefPending ?? "previous turn returned an adapter error";
      if (!this.after(owner, this.ports.push(owner, { type: "message.removed", id: draft.id }))) return null;
      participant.failedTurns = (participant.failedTurns ?? 0) + 1;
      presence.agentError(participant, `agent error: ${text.replace(/\s+/g, " ").slice(0, 120)}${text.length > 120 ? "…" : ""}`);
      if (!this.after(owner, this.ports.push(owner, { type: "participant", participant }))) return null;
      if (!this.after(owner, this.ports.postRoomEvent(owner, `${participant.name}'s agent reported an error instead of a reply: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`, undefined, false, { tone: "error" }))) return null;
      runtime.session.log.warn(`adapter error text treated as failed turn: ${text.slice(0, 200)}`);
      if (retry && !this.after(owner, this.ports.closeRetry(owner, retry, "the agent reported an error instead of a corrected reply"))) return null;
      if (words.contextFull) this.ports.contextFull(owner, text);
      return null;
    }

    return this.publish(owner, draft, result, durationMs, publishedAt, retry, endedBy);
  }

  private stopped(owner: SettledOwner, row: string): void {
    if (this.live(owner)) this.ports.postRoomEvent(owner, row, undefined, false, { tone: "attention" });
  }

  private skillPull(owner: SettledOwner, original: string, name: string): boolean {
    const { participant, runtime } = owner;
    const record: MessageDraft = {
      id: randomUUID(),
      from: participant.id,
      fromName: participant.name,
      to: [],
      toNames: [],
      text: `asked for skill "${name}"`,
      ts: Date.now(),
      kind: "hidden",
      details: { original, skill: name, via: "marker" },
    };
    const resolved = this.ports.resolveSkill(participant, name);
    if (!this.live(owner)) return false;
    if (!resolved.ok) {
      record.details = { ...record.details, outcome: `not delivered: ${resolved.reason}` };
      if (!this.after(owner, this.ports.commit(owner, record))) return false;
      runtime.brief.headerNotes.push(`you asked for skill "${name}" but ${resolved.reason}`);
      runtime.session.log.info(`skills: pull of "${name}" refused: ${resolved.reason}`);
      return true;
    }
    if (runtime.skills.skillPulledAtSeq === runtime.reading.lastSeenSeq && runtime.skills.skillPulledName === resolved.skill.name) {
      record.details = { ...record.details, outcome: "not delivered: asked twice on the same messages; treated as silent" };
      if (!this.after(owner, this.ports.commit(owner, record))) return false;
      return this.ports.notice(owner, `${participant.name} asked for skill "${name}" twice on the same messages; treated as silent.`, "warn");
    }
    runtime.skills.skillPulledAtSeq = runtime.reading.lastSeenSeq;
    runtime.skills.skillPulledName = resolved.skill.name;
    runtime.skills.pendingSkills.push({ name: resolved.skill.name, text: renderSkillBody(resolved.skill.body, ""), extraFiles: resolved.skill.extraFiles });
    runtime.reading.lastSeenSeq = runtime.reading.turnStartSeq;
    record.details = { ...record.details, outcome: "delivered in a hidden turn" };
    if (!this.after(owner, this.ports.commit(owner, record))) return false;
    runtime.session.log.info(`skills: "${resolved.skill.name}" pulled with the marker; re-running the turn`);
    return this.ports.requestTurn(owner);
  }

  publish(owner: PublicationOwner, draft: ChatMessage, result: PromptResult, durationMs: number | undefined, publishedAt: number | null,
    retry: RetryRequest | null, endedBy?: ChatMessage["cancelledBy"]): RetryRequest | null {
    const { participant, runtime } = owner, background = owner.phase === "background";
    if (!this.live(owner)) return null;
    const text = draft.text.trim();
    const cancelled = result.stopReason === "cancelled";
    const stoppedByHuman = endedBy === "human";
    const mentions = this.ports.mentions(text);
    const corrections = this.ports.referee(participant, text);
    if (!this.live(owner)) return null;
    if (corrections.length) {
      participant.violations = (participant.violations ?? 0) + corrections.length;
      runtime.session.log.info(`referee${retry ? " (after retry)" : ""}: ${corrections.join(" | ")}`);
      const holdBack = !retry && this.ports.refereeAction() === "retry-hidden" && !cancelled && !draft.failed;
      if (!this.live(owner)) return null;
      if (holdBack) {
        if (!this.after(owner, this.ports.push(owner, { type: "message.removed", id: draft.id }))) return null;
        participant.retries = (participant.retries ?? 0) + 1;
        if (!this.after(owner, this.ports.push(owner, { type: "participant", participant }))) return null;
        const held = this.ports.commit(owner, {
          id: background ? draft.id : randomUUID(),
          from: participant.id,
          fromName: participant.name,
          to: [],
          toNames: [],
          text: `Reply held back; correction requested: ${corrections.map((c) => c.replace(/^reminder:\s*/i, "")).join("; ")}`,
          ts: Date.now(),
          kind: "hidden",
          details: { ...draft.details, original: text, corrections },
        });
        if (!held) return null;
        const request: RetryRequest = {
          prompt: composeCorrectionPrompt({ header: this.ports.correctionHeader(participant), originalText: text, corrections, personaName: participant.name }),
          original: text,
          corrections,
          recordId: held.message.id,
        };
        if (owner.phase === "background" && held.stored !== "record") {
          if (!this.disposed) this.ports.unconfirmed(owner, held.message.id, request, draft.details?.reportHash ?? null);
          return request;
        }
        if (!this.live(owner)) return null;
        if (owner.phase === "background") this.ports.queueBackgroundCorrection(owner, request);
        return request;
      }
      runtime.brief.headerNotes.push(...corrections);
      if (!this.after(owner, this.ports.push(owner, { type: "participant", participant }))) return null;
    }

    const answerFrom = (draft.answerFrom ?? 0) - (draft.text.length - draft.text.trimStart().length);
    const stoppedBy = stoppedByHuman ? this.ports.humanName() : undefined;
    if (!this.live(owner)) return null;
    const posted = this.ports.commit(owner, {
      ...draft,
      to: mentions.ids,
      toNames: mentions.names,
      text,
      answerFrom: answerFrom > 0 && answerFrom < text.length ? answerFrom : undefined,
      streaming: false,
      stopReason: background && draft.failed ? undefined : result.stopReason,
      ...(endedBy ? { cancelledBy: endedBy } : {}),
      ...(stoppedBy !== undefined ? { stoppedBy } : {}),
      usage: result.usage ?? null,
      durationMs,
    });
    if (!posted) return null;
    const { message, stored } = posted;
    if (owner.phase === "background" && stored !== "record" && !this.disposed) this.ports.unconfirmed(owner, message.id, null, draft.details?.reportHash ?? null);
    if (!this.live(owner)) return null;
    if (owner.phase === "settled" && stored !== "record" && !this.after(owner, this.ports.completionConfirmed(owner, false))) return null;
    const assigned = owner.phase === "settled" && this.ports.automationAssigned(participant.id);
    if (!this.live(owner)) return null;
    if (owner.phase === "settled" && assigned && !this.after(owner, this.ports.automationDelivered(owner, stored === "record", message.id))) return null;
    if (!background && participant.contextEvent?.kind === "compacted") {
      participant.contextEvent = undefined;
      if (!this.after(owner, this.ports.push(owner, { type: "participant", participant }))) return null;
    }
    const othersPosted = publishedAt !== null && durationMs !== undefined && this.ports.postedAfter(message.id, publishedAt);
    if (!this.live(owner)) return null;
    if (othersPosted && durationMs !== undefined) {
      const at = new Date(draft.ts);
      const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
      if (!this.after(owner, this.ports.postSystem(owner, `${participant.name} finished the reply started at ${hhmm} · ${formatDuration(durationMs)}`, "human", false, { refId: message.id, agentId: participant.id }))) return null;
    }
    if (retry && !this.after(owner, this.ports.closeRetry(owner, retry, corrections.length ? `corrected reply posted, but it still breaks: ${corrections.map((c) => c.replace(/^reminder:\s*/i, "")).join("; ")}` : "corrected reply posted"))) return null;
    if (cancelled) {
      if (background) return null;
      const cut = endedBy === "human" ? `${participant.name} was stopped mid-reply by ${this.ports.humanName()}`
        : endedBy === "room" ? `${participant.name}'s turn ended mid-reply when viberoom stopped`
        : `${participant.name}'s agent ended the turn mid-reply`;
      if (this.live(owner)) this.ports.postSystem(owner, `${cut}; what it had written stays in the room.`, "agents", false, { tone: "attention" });
      return null;
    }
    if (result.stopReason !== "end_turn" && !this.after(owner, this.ports.postRoomEvent(owner, `${participant.name} stopped with ${result.stopReason}.`, undefined, false, { tone: "attention" }))) return null;
    if (!assigned && (!background || (stored === "record" && !message.audience && !message.failed))) this.ports.route(owner, message);
    return null;
  }
}
