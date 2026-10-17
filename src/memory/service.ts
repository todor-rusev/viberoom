// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { eraseEpisode } from "./episode-cleanup.js";
import { randomUUID } from "node:crypto";

import { performance } from "node:perf_hooks";
import { OP_ATTEMPT_LIMIT, OP_STALLED_MS, REPLACEMENT_SETTLE_MS, type MemoryOp, type MemoryOutbox, type ReplacementBlocker } from "./outbox.js";
import { MemoryProviderError, MemoryWriteCancelled, SEARCH_GIVE_UP_MS, type MemoryEpisode, type MemoryProvider, type MemoryRoom, type Recalled, type RecalledFact, type SearchOptions, recalledEpisodeIds, type LoadedTrialPreparation, type ProviderRateWindow } from "./provider.js";
import { ZEP_EPISODE_MAX_CHARS } from "./zep-payload.js";
import { FILTER_BATCH, judge as judgeBatch, judgeWithoutModel, screen, type FilterEndpoint, type FilterItem, type FilterVerdict } from "./filter.js";
import { BLOCK_CHARS_DEFAULT, consentCurrent, type MemoryConfig } from "./config.js";
import { MIN_RELEVANCE, providerEntry } from "./registry.js";
import type { StoredMessage } from "../history-store.js";
import { instructionRevision } from "../instruction-delivery.js";
import { visibleToAgents } from "../quotes.js";
import { rankRecalled } from "./rank.js";
import { memoryText, searchText } from "./text.js";
import { QUESTIONS_WAIT_MS, askQuestions, splitQuestions, type AskOptions, type AskedQuestions, type ModelCall, type QuestionsHow, type writeQuestions } from "./questions.js";
import { describeNetworkError } from "../net/outbound.js";
import { type IngestionDebugStore, type IngestionTrace } from "./ingestion-debug.js";
import { factLines, messageSource, resolveFacts, sourceVersion, untracedLine, withoutShown } from "./provenance.js";
import { MemoryDeliveryPipeline } from "./delivery-pipeline.js";
import { MEMORY_THROTTLE_NOTICE_QUIET_MS, MemorySourceVersions } from "./source-versions.js";
import { ChangeTokenCache } from "./change-token-cache.js";
import type { Delivery, SourceListing, WriteTransport } from "./delivery.js";
import { decideVersion, type VersionFacts, type VersionWait } from "./version-check.js";
import { cleanVersionDuplicates } from "./version-duplicates.js";
import { MemoryGenerationRouting, type GraphLease } from "./generation-routing.js";
import { GenerationError, baseGenerationId, sameGenerationRoute, type GenerationHead, type GenerationSwitch } from "./graph-generations.js";
import { MemoryRecoverySources, recoveryFingerprint, type RecoverySourcePlan, type RecoveryScope } from "./recovery-sources.js";
import { MemoryRecoveryBuilder, type RecoveryJob } from "./recovery-jobs.js";
import type { RecoveryReviewDecision, RecoveryReviewReceipt, RecoveryVerificationReport } from "./recovery-verification.js";
import { preparationFingerprint, type RecoveryActivationPreview, type RecoveryCompletionPreview, type RecoverySwitchPreview } from "./recovery-switch.js";
import { MemorySelectiveReview, type SelectiveReviewRequest, type SelectiveReviewReport, type SelectiveReviewDecision } from "./selective-repair-review.js";
import { selectMessages, type SelectionVerdict } from "./selection.js";
import { ORIGINAL_PRODUCT_PROFILE, originalProductText, originalProductFingerprint } from "./original-product-input.js";
import type { PartGroupScope } from "./part-group.js";
import { THROTTLE_WAIT_MS, throttledIndexRead } from "./episode-index.js";

export interface CleanupEntry {
  id: number;
  kind: "deletion" | "replacement";
  roomId: string;
  roomUuid: string | null;
  sourceId: string;
  attempts: number;
  retryAt: number;
  waitingSince: number | null;
  reason: string | null;
  state: string;
  waitsFor?: ReplacementView["waitsFor"];
}

export interface ReplacementView {
  state: "settling" | "waiting" | "queued" | "suspended" | "failed" | "expired";
  waitsFor?: { kind: "deletion"; op: number; state: string; reason: string | null }
    | { kind: "version"; opId: string; attempt: number; state: string; reason: string | null; checksEnded: boolean };
}

interface LoadedTrialRows {
  members: { opId: string; identity: Delivery["identity"] }[];
  routes: { roomId: string; head: GenerationHead; attachment: ReturnType<MemoryOutbox["generationAttachment"]> }[];
}

export interface MemoryRoomView {
  id: string;
  uuid: string;
  name: string;
  remembers: boolean;
  graphId?: string;
  generationRevision?: string;
  generationCheck?: boolean;
  input?: "excerpts" | "whole";
  originalInput?: boolean;
  account?: string;
  readsOtherRooms?: "off" | "on-search" | "every-turn";
}

export function acceptForRecipient(current: { provider: string; uuid: string | undefined; living: boolean }, expected: { uuid: string; provider: string }, work: () => void): void {
  if (!current.living) throw new Error("viberoom is shutting down or was reset; the room's memory was not forgotten.");
  if (current.provider !== expected.provider || current.uuid !== expected.uuid) throw new Error("The memory provider or the room changed. Reopen the room settings.");
  work();
}

export interface ForgetRecipient { uuid: string; provider: string; life?: number }

export interface MemoryPorts {
  outbox: MemoryOutbox;
  recoveryAuthorized?(job: RecoveryJob): boolean;
  recoveryReviewAuthorized?(report: RecoveryVerificationReport, reviewId: string, decisionsFingerprint: string): boolean;
  selectiveReviewAuthorized?(report: SelectiveReviewReport, reviewId: string, decisionsFingerprint: string): boolean;
  recoveryPreparationAuthorized?(preview: RecoverySwitchPreview, approvalId: string): boolean;
  recoveryPublicationAuthorized?(preview: RecoveryActivationPreview, approvalId: string): boolean;
  recoveryCompletionAuthorized?(preview: RecoveryCompletionPreview, approvalId: string): boolean;
  debug?: IngestionDebugStore;
  debugEnabled?(): boolean;
  history: {
    chatAfter(roomId: string, afterSeq: number, limit: number): StoredMessage[];
    get(roomId: string, seq: number): StoredMessage | null;
    getById?(roomId: string, id: string, includeDeleted?: boolean): StoredMessage | null;
    deleted(roomId: string): Array<{ message: StoredMessage; deletedAt: number }>;
    maxSeq(roomId: string): number;
    knowsCarried?(roomId: string, id: string, carryHash: string): boolean;
    carriedRelation?(roomId: string, id: string, hash: string): "current" | "ancestor" | "unknown";
    carriedRevision?(roomId: string, id: string): string | null;
    earliestRemembered?(roomId: string, provider: string, folderId: string): number | null;
    upgradeMemoryVersions?(): void;
  };
  folderId?: string;
  rooms(): MemoryRoomView[];
  room(id: string): MemoryRoomView | null;
  accept?(roomId: string, expected: ForgetRecipient, work: () => void): void;
  searchPool?(roomId: string): MemoryRoomView[];
  config(): MemoryConfig;
  provider(config: MemoryConfig): Promise<MemoryProvider>;
  note(roomId: string, text: string): void;
  log: { info(m: string): void; warn(m: string): void; error(m: string): void };
  minRelevance?: number;
  judge?: typeof judgeBatch;
  selectMessages?: typeof selectMessages;
  writeQuestions?: typeof writeQuestions;
  questionsWaitMs?: number;
  searchGiveUpMs?: number;
  retryLadderMs?: number[];
  now?: () => number;
  monotonic?: () => number;
}

export type BriefSearch = { seq: number } & (AskedQuestions | { pending: true });

interface SearchTiming { room: string; question: number; total: number; ms: number; activeMs: number; ok: boolean }

export interface LateModelNote {
  ms: number;
  questions?: string[];
  failure?: string;
}

export interface SearchReplay {
  asked: AskedQuestions;
  facts: Recalled[];
  floor: number;
  searchedMs: number;
  unread?: string[];
}

export interface MemoryStatus {
  provider: string;
  consent: boolean;
  paused: { reason: string; since: number } | null;
  pendingOps: number;
  lastError: string | null;
  usage: { month: string; credits: number; cap: number };
  rateWindow: ProviderRateWindow | null;
  rooms: Array<{ id: string; cursor: number; behind: number }>;
}

const DRAIN_PAGE = 24;
const VERSION_CHECK_PAGE = 64;
const VERSION_WAIT_MS: Record<VersionWait, number> = { not_processed_yet: 30_000, older_version_leaving: 60_000, listing_incomplete: 5 * 60_000 };
export const RETRY_LADDER_MS = [5_000, 15_000, 60_000, 300_000];
const NOTE_AFTER_FAILURES = 2;
export const CONTEXT_ROWS = 3;
export const CONTEXT_ROW_CHARS = 300;

export const sieveItem = (m: StoredMessage): FilterItem => ({ sourceId: m.id, authorName: m.fromName, authorKind: m.from === "human" ? "human" : "agent", text: memoryText(m), ts: m.ts });
const CONTEXT_SCAN = 40;
const BRIEF_CANDIDATES = 30;
const QUESTION_CANDIDATES = 10;
const AUTO_BLOCK_CHARS = 12_000;
const AUTO_QUESTION_MIN_CHARS = 3_000;
const SEARCH_FACTS_WAIT_MS = 5_000;
const BRIEF_SEARCH_WAIT_MS = 3_000;
const FACTS_NOTE = "What this room's long-term memory holds about the current topic: facts, each may carry the span it held true; what it holds about an entity; and messages themselves, marked as such. Facts and what it holds about an entity are inference, not quotes: the conversation and the rules win.";
const UNANSWERED_NOTE = "The memory was not searched for this message: the model that writes its questions did not answer. If earlier context matters, search it yourself: search_history also returns the memory's facts.";
const PENDING_NOTE = "The memory's search for this message had not returned when this turn began, so no facts are given. If earlier context matters, search it yourself: search_history also returns the memory's facts.";
const BRIEFS_KEPT = 20;
const LATE_CALLS_KEPT = 20;
export { MIN_RELEVANCE };

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const monthOf = (ts: number) => new Date(ts).toISOString().slice(0, 7);

export class MemoryPipeline {
  private readonly delivery: MemoryDeliveryPipeline;
  private readonly sourceVersions: MemorySourceVersions;
  private readonly routing: MemoryGenerationRouting;
  private readonly chains = new Map<string, Promise<void>>();
  private readonly roomWork = new Map<string, AbortController>();
  private readonly cleanupWork = new AbortController();
  private readonly freshSearches = new Map<string, Map<number, { startedAt: number; promise: Promise<void> }>>();
  private readonly lateCalls = new Map<string, Map<number, ModelCall>>();
  private readonly handledEdits = new Map<string, number>();
  private readonly rewakes = new Map<string, { timer: ReturnType<typeof setTimeout>; dueAt: number }>();
  private budgetWarned = "";
  private readonly recoveryPlans = new WeakMap<RecoverySourcePlan, () => boolean>();
  private readonly recoveryRunning = new Map<string, Promise<RecoveryJob>>();
  private readonly recoverySwitchPreviews = new WeakMap<RecoverySwitchPreview, () => boolean>();
  private readonly selectiveReviewTokens = new Map<string, object>();
  private readonly selectiveReports = new WeakMap<SelectiveReviewReport, { owner: MemorySelectiveReview; signal: AbortSignal }>();
  private unscoredNoted = false;
  private providerInstance: { key: string; provider: MemoryProvider; revision: string } | null = null;
  private providerLoading: { key: string; promise: Promise<MemoryProvider> } | null = null;
  private configuredProviderKey: string;
  private paused: { reason: string; since: number } | null = null;
  private pausedNoted = new Set<string>();
  private lastPausedAt: number | null = null;
  private resumedAt: number | null = null;
  private modelDown: { reason: string; since: number } | null = null;
  private retryStep = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: string | null = null;
  private stopped = false;
  private readonly trialRows = new ChangeTokenCache<LoadedTrialRows | null>();

  constructor(private readonly ports: MemoryPorts) {
    this.configuredProviderKey = this.providerKey();
    this.routing = new MemoryGenerationRouting({ outbox: ports.outbox, room: ports.room, now: ports.now ?? Date.now, monotonic: ports.monotonic,
      allowed: provider => !this.stopped && this.providerInstance?.provider === provider && this.providerInstance.key === this.providerKey(),
      beforeFollow: (provider, room) => this.cursorBirth(provider, room, (ports.now ?? Date.now)()),
    });
    this.sourceVersions = new MemorySourceVersions({
      outbox: ports.outbox, room: room => this.routedRoom(room), message: (room, id) => ports.history.getById?.(room, id) ?? null,
      note: (room, text) => ports.note(room, text),
      relation: (room, id, hash) => ports.history.carriedRelation?.(room, id, hash) ?? "unknown",
      groupSourceCurrent: (group, source) => {
        try { return group.descriptor.representationFingerprint === originalProductFingerprint(source, group.descriptor.representation); }
        catch { return false; }
      },
      revision: (room, id) => ports.history.carriedRevision?.(room, id) ?? null,
      allowed: (provider, room) => !this.stopped && !this.paused && this.active() && this.ports.config().provider === provider && !this.workSignal(room).aborted && !this.forgettingRoom(room),
      now: ports.now ?? Date.now, wakeAfter: (room, ms) => this.rewakeAt(room, ms),
    });
    this.delivery = new MemoryDeliveryPipeline({
      outbox: ports.outbox, room: room => this.routedRoom(room),
      message: (room, id) => ports.history.getById?.(room, id) ?? null,
      allowed: (provider, room) => !this.stopped && !this.paused && this.active() && this.ports.config().provider === provider && !this.workSignal(room).aborted && !this.forgettingRoom(room),
      cap: () => Number(this.section(this.ports.config()).monthlyCreditCap ?? 0),
      now: ports.now ?? Date.now, wakeAfter: (room, ms) => this.rewakeAt(room, ms),
      beforeSend: (row, reads, signal) => this.sourceVersions.beforeSend(row, reads, signal),
      groupPreflight: (row, reads, signal) => this.sourceVersions.groupPreflight(row, reads, signal),
      removalGuard: (row, id, reads, signal) => this.sourceVersions.removalGuard(row, id, reads, signal),
      sourceRead: async (provider, uuid, listing, reads, signal, graphId) => {
        const found = ports.rooms().find(r => r.uuid === uuid), room = found && this.routedRoom(found.id);
        if (room && this.asMemoryRoom(room).graphId === graphId) await this.sourceVersions.observe(provider, room, listing, reads, signal);
      },
    });
  }

  private routedRoom(id: string): MemoryRoomView | null {
    const room = this.ports.room(id), instance = this.providerInstance;
    if (!room || !instance || instance.key !== this.providerKey()) return null;
    const view = this.routing.view(instance.provider, room);
    return view && { ...room, ...view };
  }

  private routeCurrent(provider: MemoryProvider, room: MemoryRoomView): boolean {
    return this.routing.current(provider, room);
  }

  private providerKey(): string {
    const config = this.ports.config();
    return JSON.stringify([config.provider, this.section(config)]);
  }

  private workSignal(roomId: string): AbortSignal {
    if (!this.roomWork.has(roomId)) this.roomWork.set(roomId, new AbortController());
    return this.roomWork.get(roomId)!.signal;
  }

  attachRoom(roomId: string): void {
    if (this.roomWork.get(roomId)?.signal.aborted) this.roomWork.delete(roomId);
  }

  detachRoom(roomId: string): void {
    this.cancelRoomWork(roomId);
    this.ports.outbox.dropLocalRoom(roomId);
    this.wake(roomId);
  }

  private cancelRoomWork(roomId: string): void {
    this.workSignal(roomId);
    this.roomWork.get(roomId)!.abort(new Error("This local room copy was removed."));
    this.freshSearches.delete(roomId);
    this.lateCalls.delete(roomId);
    this.selectiveReviewTokens.delete(roomId);
    const timer = this.rewakes.get(roomId);
    if (timer) clearTimeout(timer.timer);
    this.rewakes.delete(roomId);
    for (const key of this.handledEdits.keys()) if (key.startsWith(`${roomId}:`)) this.handledEdits.delete(key);
    this.ports.debug?.forgetRoom(roomId);
  }

  start(): void {
    this.ports.history.upgradeMemoryVersions?.();
    for (const room of this.ports.rooms()) this.ports.outbox.attachLegacyMaps(room.id, room.uuid);
    this.ports.outbox.deliveries.recoverUndispatched((this.ports.now ?? Date.now)());
    if (this.ports.config().provider === "off") return;
    if (this.active()) for (const room of this.ports.rooms()) if (room.remembers) {
      this.optIn(room.id);
      if (this.ports.outbox.hasCursor(this.ports.config().provider, room.id)) this.cursorBirth(this.ports.config().provider, room.id, (this.ports.now ?? Date.now)());
      this.wake(room.id);
    }
    for (const roomId of this.ports.outbox.roomsWithOps(this.ports.config().provider)) this.wake(roomId);
  }

  optIn(roomId: string): void {
    if (!this.active() || this.workSignal(roomId).aborted) return;
    const config = this.ports.config();
    const room = this.ports.room(roomId);
    if (!room?.remembers || this.ports.outbox.hasCursor(config.provider, roomId)) return;
    this.ports.outbox.carry.activate(config.provider, roomId, room.uuid);
    this.ports.outbox.resetCursor(config.provider, roomId, this.ports.history.maxSeq(roomId), (this.ports.now ?? Date.now)());
  }

  imported(roomId: string): void {
    this.attachRoom(roomId);
    if (this.ports.room(roomId) && !this.ports.room(roomId)!.remembers) { this.excludeImported(roomId); return; }
    if (!this.active() || this.workSignal(roomId).aborted || this.forgettingRoom(roomId)) return;
    this.optIn(roomId);
    this.wake(roomId);
  }

  messageLanded(roomId: string, seq: number): void {
    if (!this.active() || this.workSignal(roomId).aborted || this.forgettingRoom(roomId)) return;
    const config = this.ports.config();
    if (this.ports.room(roomId)?.remembers && !this.ports.outbox.hasCursor(config.provider, roomId)) {
      this.ports.outbox.resetCursor(config.provider, roomId, Math.max(0, seq - 1), (this.ports.now ?? Date.now)());
    }
    this.freshSearch(roomId, seq);
    this.wake(roomId);
  }

  private freshSearch(roomId: string, seq: number): void {
    const signal = this.workSignal(roomId);
    if (signal.aborted || this.forgettingRoom(roomId)) return;
    const room = this.ports.room(roomId);
    if (!room?.remembers) return;
    const row = this.ports.history.get(roomId, seq);
    if (!row || !asksMemory(row)) return;
    const searches = this.freshSearches.get(roomId) ?? new Map<number, { startedAt: number; promise: Promise<void> }>();
    const kept = this.ports.outbox.brief(this.ports.config().provider, roomId, seq);
    if (searches.has(seq)) return;
    const now = this.ports.now ?? Date.now;
    const startedAt = now();
    const measure = this.ports.now ?? (() => performance.now());
    const measuredStart = measure();
    const giveUpMs = this.ports.searchGiveUpMs ?? SEARCH_GIVE_UP_MS;
    const giveUp = new AbortController();
    const giveUpTimer = setTimeout(() => giveUp.abort(new Error(`given up after ${giveUpMs / 1000} s`)), giveUpMs);
    giveUpTimer.unref?.();
    const promise = (async () => {
      try {
        const provider = await this.provider();
        signal.throwIfAborted();
        if (kept && (!kept.lines.length || kept.facts)) {
          if (!provider.generations) return;
          const targets = [room, ...(this.blockReadsOthers(room) ? this.ports.searchPool?.(roomId) ?? [] : [])]
            .filter((r, i, all) => r.remembers && all.findIndex(other => other.id === r.id) === i && !this.forgettingRoom(r.id));
          await Promise.all(targets.map(async target => {
            if (target.id === roomId) await this.routing.resolve(provider, target, this.workSignal(target.id));
            else try { await this.routing.resolve(provider, target, this.workSignal(target.id)); }
            catch (error) { this.ports.log.warn(`memory: a cached answer could not check the graph of ${target.name}: ${describeNetworkError(error)}`); }
          }));
          signal.throwIfAborted();
          const cached = this.ports.outbox.brief(provider.id, roomId, seq);
          if (cached && (!cached.facts?.length || this.currentFacts(roomId, cached.facts, this.blockReadsOthers(room)).length === cached.facts.length)) return;
        }
        const ask = this.briefAsk();
        const asked = await this.askFor(room, row, ask, call => {
          if (call.inTime || signal.aborted) return;
          this.keepLateCall(roomId, seq, call);
          this.ports.log.info(`memory: ${describeLateCall(call, seq, room.name, ask.unavailable === undefined ? ask.waitMs ?? null : null)}`);
        }, signal);
        signal.throwIfAborted();
        const searching = measure();
        const calls: SearchTiming[] = [];
        if (giveUp.signal.aborted) throw giveUp.signal.reason;
        const facts = asked.questions.length ? await this.searchGraphs(provider, room, asked.questions, {
          candidates: this.briefCandidates(), across: this.blockReadsOthers(room), signal: giveUp.signal,
          observe: timing => {
            calls.push(timing);
            if (timing.ms >= 1000 || !timing.ok) this.ports.log.warn(`memory: brief #${seq}, search ${timing.question}/${timing.total} in ${timing.room}: ${timing.ms} ms elapsed, hub event loop active ${timing.activeMs} ms, ${timing.ok ? "answered" : "failed"}`);
          },
        }) : [];
        const searchedMs = Math.round(measure() - searching);
        if (this.freshSearches.get(roomId) !== searches) return;
        const storing = measure();
        const told = this.applyBrief(roomId, provider.id, seq, facts, asked);
        const storedMs = Math.round(measure() - storing);
        const best = typeof facts[0]?.relevance === "number" ? ` (best ${facts[0].relevance.toFixed(2)})` : "";
        const details = calls.slice(0, 12).map(call => `${call.room} ${call.question}/${call.total}=${call.ms} ms`).join(", ");
        const searched = asked.questions.length ? `searched in ${searchedMs} ms (${details}${calls.length > 12 ? `, ${calls.length - 12} more` : ""}), stored in ${storedMs} ms, ` : "";
        this.ports.log.info(`memory: the brief for message ${seq} of ${room.name}: ${told} fact${told === 1 ? "" : "s"} told${best}; ${describeAsked(asked)}; ${searched}${Math.round(measure() - measuredStart)} ms in all`);
      } catch (error) {
        if (signal.aborted) return;
        if (giveUp.signal.aborted) this.ports.log.warn(`memory: the search for the brief of message ${seq} of ${room.name} was given up after ${giveUpMs / 1000} s; nothing is kept, and the next turn for it asks again`);
        else this.ports.log.warn(`memory: the brief for message ${seq} of ${room.name} was not searched (${describeNetworkError(error)}); its turn is told the search had not returned, and the next turn for it asks again`);
      }
      finally { clearTimeout(giveUpTimer); searches.delete(seq); }
    })();
    searches.set(seq, { startedAt, promise });
    this.freshSearches.set(roomId, searches);
  }

  private questionsWaitMs(): number {
    return this.ports.questionsWaitMs ?? QUESTIONS_WAIT_MS;
  }

  private briefAsk(): AskOptions {
    return { waitMs: this.questionsWaitMs(), ...(this.modelDown ? { unavailable: this.modelDown.reason } : {}) };
  }

  private modelCallEnded(failure: string | null): void {
    if (failure === null) {
      if (!this.modelDown) return;
      this.ports.log.info(`memory: the sieve's model answers again (it did not from ${clockOf(this.modelDown.since)}); the turns wait for its questions`);
      this.modelDown = null;
      return;
    }
    if (this.modelDown) return;
    this.modelDown = { reason: failure, since: (this.ports.now ?? Date.now)() };
    this.ports.log.warn(`memory: the sieve's model did not answer (${failure}); until it does, the turns do not wait for its questions and their blocks say the memory was not searched`);
  }

  private keepLateCall(roomId: string, seq: number, call: ModelCall): void {
    const room = this.lateCalls.get(roomId) ?? new Map<number, ModelCall>();
    room.set(seq, call);
    for (const old of [...room.keys()].sort((a, b) => a - b).slice(0, Math.max(0, room.size - LATE_CALLS_KEPT))) room.delete(old);
    this.lateCalls.set(roomId, room);
  }

  lateModelNote(roomId: string, seq: number): LateModelNote | null {
    const call = this.lateCalls.get(roomId)?.get(seq);
    if (!call) return null;
    return { ms: call.endedAt - call.startedAt, ...(call.questions ? { questions: call.questions } : { failure: call.failure ?? "no answer" }) };
  }

  private askFor(room: MemoryRoomView, row: StoredMessage, options: AskOptions = {}, onModelCall?: (call: ModelCall) => void, signal = this.workSignal(room.id)): Promise<AskedQuestions> {
    signal.throwIfAborted();
    const { mode, baseUrl, apiKey, model } = this.ports.config().filter;
    const endpoint = mode === "llm" && baseUrl && model ? { baseUrl, apiKey, model } : null;
    const before = this.ports.history.chatAfter(room.id, Math.max(0, row.seq - CONTEXT_SCAN), CONTEXT_SCAN)
      .filter(m => m.seq < row.seq && visibleToAgents(m))
      .slice(-CONTEXT_ROWS)
      .map(m => ({ speaker: m.fromName, text: [...memoryText(m)].slice(0, CONTEXT_ROW_CHARS).join("") }));
    const ended = (call: ModelCall): void => {
      if (signal.aborted) return;
      this.modelCallEnded(call.questions ? null : call.failure ?? "no answer");
      onModelCall?.(call);
    };
    return askQuestions(
      { endpoint, onModelCall: ended, ...(this.ports.writeQuestions ? { write: this.ports.writeQuestions } : {}), ...(this.ports.now ? { now: this.ports.now } : {}) },
      { latest: { speaker: row.fromName, text: memoryText(row) }, before },
      searchText(row),
      { form: this.ports.config().filter.form, ...options },
    );
  }

  async briefReady(roomId: string, addressed: readonly number[], capMs?: number): Promise<void> {
    if (!this.active()) return;
    const seq = this.questionOf(roomId, addressed);
    if (seq === null) return;
    this.freshSearch(roomId, seq);
    const search = this.freshSearches.get(roomId)?.get(seq);
    if (!search) return;
    const left = capMs ?? Math.max(0, search.startedAt + this.questionsWaitMs() + BRIEF_SEARCH_WAIT_MS - (this.ports.now ?? Date.now)());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([search.promise, new Promise<void>(resolve => { timer = setTimeout(resolve, left); timer.unref?.(); })]); }
    finally { clearTimeout(timer); }
  }

  private questionOf(roomId: string, addressed: readonly number[]): number | null {
    for (let i = addressed.length - 1; i >= 0; i--) {
      const row = this.ports.history.get(roomId, addressed[i]);
      if (row && asksMemory(row)) return row.seq;
    }
    return null;
  }

  stop(): void {
    this.stopped = true;
    this.cleanupWork.abort(new Error("The memory pipeline stopped."));
    for (const work of this.roomWork.values()) work.abort(new Error("The memory pipeline stopped."));
    this.selectiveReviewTokens.clear();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    for (const alarm of this.rewakes.values()) clearTimeout(alarm.timer);
    this.rewakes.clear();
  }

  async settled(): Promise<void> {
    for (;;) {
      const chains = [...this.chains.values()];
      await Promise.all(chains);
      if ([...this.chains.values()].every(chain => chains.includes(chain))) return;
    }
  }

  active(): boolean {
    const config = this.ports.config();
    return config.provider !== "off" && consentCurrent(config, config.provider);
  }

  inspectLoadedTrial(roomIds: readonly string[], opIds: readonly string[]) {
    const instance = this.providerInstance, config = this.ports.config(), metadata = instance?.provider.loadedMetadata;
    if (this.stopped || this.paused || !this.active() || config.provider !== "zep" || !instance || instance.key !== this.providerKey() ||
        !metadata || metadata.provider !== "zep" || instance.provider.id !== "zep" || typeof instance.revision !== "string" ||
        metadata.accountId !== instance.provider.generations?.account) return null;
    if (roomIds.length !== 20 || new Set(roomIds).size !== 20 || opIds.length !== 34 || new Set(opIds).size !== 34) return null;
    const cap = Number(this.section(config).monthlyCreditCap ?? 0);
    if (!Number.isSafeInteger(cap) || cap < 0) return null;
    const rooms: MemoryRoomView[] = [];
    for (const id of roomIds) {
      const room = this.ports.room(id);
      if (!room?.remembers || this.roomWork.get(id)?.signal.aborted) return null;
      rooms.push({ ...room, account: metadata.accountId });
    }
    const rows = this.loadedTrialRows(rooms, opIds, metadata.accountId);
    if (!rows) return null;
    if (this.providerInstance !== instance || instance.key !== this.providerKey() || this.stopped || this.paused || !this.active()) return null;
    return structuredClone({ provider: "zep" as const, accountId: metadata.accountId, readBase: metadata.readBase,
      loadedRevision: instance.revision, cap, consent: config.consent.zep, rooms, members: rows.members, routes: rows.routes });
  }

  private loadedTrialRows(rooms: readonly MemoryRoomView[], opIds: readonly string[], account: string): LoadedTrialRows | null {
    const outbox = this.ports.outbox;
    return this.trialRows.read(outbox.changeToken(), JSON.stringify([account, opIds, rooms.map(r => [r.id, r.uuid])]), () => {
      const members: LoadedTrialRows["members"] = [];
      for (const opId of opIds) {
        const row = outbox.deliveries.get(opId);
        if (!row || row.identity.provider !== "zep" || !rooms.some(r => r.id === row.identity.roomId && r.uuid === row.identity.roomUuid) ||
            !outbox.deliveries.currentCopy(row.identity) || !outbox.deliveries.accountMatches(row.identity, account)) return null;
        members.push({ opId, identity: { ...row.identity } });
      }
      if (new Set(members.map(m => m.identity.roomId)).size !== 20) return null;
      return { members, routes: rooms.map(room => ({ roomId: room.id,
        head: outbox.generations.head({ provider: "zep", account, uuid: room.uuid }), attachment: outbox.generationAttachment("zep", room.id) })) };
    });
  }

  inspectLoadedTrialAccount() {
    const instance = this.providerInstance, config = this.ports.config(), metadata = instance?.provider.loadedMetadata;
    if (this.stopped || this.paused || !this.active() || config.provider !== "zep" || !instance || instance.key !== this.providerKey() ||
        !metadata || metadata.provider !== "zep" || instance.provider.id !== "zep" || typeof instance.revision !== "string" ||
        metadata.accountId !== instance.provider.generations?.account) return null;
    const cap = Number(this.section(config).monthlyCreditCap ?? 0);
    if (!Number.isSafeInteger(cap) || cap < 0) return null;
    if (this.providerInstance !== instance || instance.key !== this.providerKey() || this.stopped || this.paused || !this.active()) return null;
    return structuredClone({ provider: "zep" as const, accountId: metadata.accountId, readBase: metadata.readBase,
      loadedRevision: instance.revision, cap, consent: config.consent.zep });
  }

  loadedTrialPreparation(): LoadedTrialPreparation | null {
    const account = this.inspectLoadedTrialAccount(), instance = this.providerInstance;
    const writes = instance?.provider.writes, original = writes?.originalMessage;
    if (!account || !instance || !writes || !original) return null;
    const current = () => this.providerInstance === instance && instance.provider.writes === writes &&
      writes.originalMessage === original && JSON.stringify(this.inspectLoadedTrialAccount()) === JSON.stringify(account);
    const sync = <T>(operation: () => T): T => {
      if (!current()) throw new MemoryWriteCancelled();
      const value = operation();
      if (value && typeof (value as unknown as { then?: unknown }).then === "function") throw new MemoryWriteCancelled();
      if (!current()) throw new MemoryWriteCancelled();
      return value;
    };
    return Object.freeze({ id: "zep" as const, loadedRevision: account.loadedRevision,
      generations: Object.freeze({ account: account.accountId }),
      writes: Object.freeze({ episodeTextLimit: writes.episodeTextLimit,
        episode: (...args: Parameters<typeof writes.episode>) => sync(() => writes.episode(...args)),
        originalMessage: Object.freeze({ bytesPerCredit: original.bytesPerCredit,
          validatePolicy: (...args: Parameters<typeof original.validatePolicy>) => sync(() => original.validatePolicy(...args)),
          buildPart: (...args: Parameters<typeof original.buildPart>) => sync(() => original.buildPart(...args)),
          validatePart: (...args: Parameters<typeof original.validatePart>) => sync(() => original.validatePart(...args)) }) }) });
  }

  private section(config: MemoryConfig): Record<string, unknown> {
    return config.providers[config.provider] ?? {};
  }

  status(): MemoryStatus {
    const config = this.ports.config();
    const month = monthOf((this.ports.now ?? Date.now)());
    return {
      provider: config.provider,
      consent: consentCurrent(config, config.provider),
      paused: this.paused,
      pendingOps: config.provider === "off" ? 0 : this.ports.outbox.pending(config.provider).ops + this.ports.outbox.deliveries.pending(config.provider),
      lastError: this.lastError,
      usage: { month, credits: config.provider === "off" ? 0 : this.ports.outbox.usage(config.provider, month), cap: Number(this.section(config).monthlyCreditCap ?? 0) },
      rateWindow: config.provider !== "off" && this.providerInstance?.key === this.providerKey() ? this.providerInstance.provider.rateWindow?.() ?? null : null,
      rooms: this.ports.rooms().filter(r => r.remembers).map(r => {
        const cursor = config.provider === "off" ? 0 : this.ports.outbox.cursor(config.provider, r.id);
        return { id: r.id, cursor, behind: Math.max(0, this.ports.history.maxSeq(r.id) - cursor) };
      }),
    };
  }

  private ensureBudget(provider: MemoryProvider): void {
    const cap = Number(this.section(this.ports.config()).monthlyCreditCap ?? 0);
    if (!cap) return;
    const month = monthOf((this.ports.now ?? Date.now)());
    const spent = this.ports.outbox.usage(provider.id, month);
    if (spent >= cap) {
      throw new MemoryProviderError(`the monthly memory budget is reached (${spent} of ${cap} credits for ${month}); raise the ceiling in Settings or let the new month start`, true);
    }
  }

  private recordSpend(provider: MemoryProvider, credits: number, roomId: string, signal: AbortSignal): void {
    if (this.stopped) return;
    const month = monthOf((this.ports.now ?? Date.now)());
    this.ports.outbox.addUsage(provider.id, month, credits);
    this.warnBudget(provider, roomId, signal);
  }

  private warnBudget(provider: MemoryProvider, roomId: string, signal: AbortSignal): void {
    if (this.stopped) return;
    const month = monthOf((this.ports.now ?? Date.now)());
    if (signal.aborted) return;
    const cap = Number(this.section(this.ports.config()).monthlyCreditCap ?? 0);
    if (!cap) return;
    const spent = this.ports.outbox.usage(provider.id, month);
    const warnKey = `${provider.id}:${month}`;
    if (spent >= cap * 0.8 && spent < cap && this.budgetWarned !== warnKey) {
      this.budgetWarned = warnKey;
      this.ports.note(roomId, `Long-term memory has recorded ${spent} of its ${cap} credits for ${month} (${Math.round(spent / cap * 100)}%), including reservations for uncertain requests. At the ceiling it pauses and waits; raise it in Settings → Long-term memory if the month should hold more.`);
    }
  }

  configChanged(): void {
    for (const roomId of this.roomWork.keys()) {
      this.cancelRoomWork(roomId);
      this.attachRoom(roomId);
    }
    const key = this.providerKey();
    if (key !== this.configuredProviderKey) {
      for (const room of this.ports.rooms()) this.ports.outbox.reopenAllVersionChecks(room.id);
      this.ports.outbox.retryProviderForgets(this.ports.config().provider);
      this.ports.outbox.deliveries.retryAuth(this.ports.config().provider, (this.ports.now ?? Date.now)());
      this.ports.outbox.retryFailedOps(this.ports.config().provider);
      this.configuredProviderKey = key;
    }
    this.providerInstance = null;
    this.paused = null;
    this.retryStep = 0;
    this.start();
  }

  roomSettingsChanged(roomId: string): void {
    if (!this.ports.room(roomId)?.remembers) {
      this.excludeImported(roomId);
      this.cancelRoomWork(roomId);
      this.attachRoom(roomId);
      return;
    }
    this.optIn(roomId);
    this.wake(roomId);
  }

  private excludeImported(roomId: string): void {
    for (const check of this.ports.outbox.openVersionChecks(roomId, Number.MAX_SAFE_INTEGER)) {
      const row = this.ports.history.getById?.(roomId, check.sourceId);
      if (row) this.ports.outbox.excludeVersion(roomId, row.id, sourceVersion(row));
    }
    this.ports.outbox.dropVersionChecks(roomId);
  }

  deliveryRegistry(provider = this.ports.config().provider, after?: string, cleanupAfter = 0, versionAfter?: string, bindingAfter?: string) {
    if (!providerEntry(provider)) throw new Error("Choose a memory provider to inspect its deliveries.");
    if (!Number.isSafeInteger(cleanupAfter) || cleanupAfter < 0) throw new Error("Invalid cleanup cursor.");
    const page = this.ports.outbox.deliveries.list(provider, { after, limit: 51 });
    const cleanups = this.ports.outbox.ops(provider, 51, { kinds: ["forget", "reingest"], after: cleanupAfter }), now = (this.ports.now ?? Date.now)();
    const versions = this.ports.outbox.versionCheckPage(versionAfter), bindings = this.ports.outbox.bindingWatches(provider, bindingAfter);
    const accountReason = (op: MemoryOp) => {
      const account = this.routedRoom(op.room)?.account;
      return account !== undefined && op.account !== account ? op.account === undefined ? "account_ownership_unknown" : "account_changed" : null;
    };
    const deletionState = (op: MemoryOp) => accountReason(op) ? "suspended" : op.deferKind === "processing" ? now - op.deferredSince! >= OP_STALLED_MS ? "stalled" : "processing" : op.deferKind ?? "queued";
    return { provider, entries: page.slice(0, 50).map(row => ({
      opId: row.opId, ...row.identity, account: this.ports.outbox.deliveries.copyAccount(row.identity), state: row.state, preparedAt: row.preparedAt, updatedAt: row.updatedAt,
      attempts: row.attempts, replays: row.replays, retryAt: row.retryAt, reason: row.reason, acknowledged: row.acknowledged,
      externalIds: row.externalIds, retiredAt: row.retiredAt, retirement: row.retirement, cleanup: row.cleanup,
      maintenance: this.ports.outbox.deliveries.maintenance(row.opId),
      watch: this.ports.outbox.deliveries.watches.get(row.opId),
      creditsPerAttempt: row.payload?.estimatedCredits ?? null,
      sourceKind: row.payload?.binding?.source?.kind ?? row.identity.kind,
      roomLoaded: this.ports.room(row.identity.roomId)?.uuid === row.identity.roomUuid,
      repairPending: this.ports.outbox.needsGraphRepair(provider, row.identity.roomUuid),
    })), next: page.length > 50 ? page[49].opId : null, deletions: this.ports.outbox.forgottenRooms(provider),
      cleanups: { entries: cleanups.slice(0, 50).map((op): CleanupEntry => ({
        id: op.id, kind: op.kind === "reingest" ? "replacement" : "deletion", roomId: op.room,
        roomUuid: typeof op.payload.uuid === "string" ? op.payload.uuid : null,
        sourceId: String(op.payload.sourceId), attempts: op.attempts, retryAt: op.retryAt, waitingSince: op.deferredSince, reason: accountReason(op) ?? op.deferReason,
        ...(op.kind === "reingest" ? this.replacementView(provider, op, now, deletionState) : { state: deletionState(op) }),
      })), next: cleanups.length > 50 ? cleanups[49].id : null },
      versions: { entries: versions.slice(0, 50).map(row => ({ roomId: row.room, sourceId: row.sourceId, state: row.state, reason: row.reason, retryAt: row.retryAt, checkedAt: row.checkedAt })),
        next: versions.length > 50 ? Buffer.from(JSON.stringify([versions[49].room, versions[49].sourceId])).toString("base64url") : null },
      bindings: { entries: bindings.slice(0, 50), next: bindings.length > 50 ? bindings[49].watchId : null }, skippedVersions: this.ports.outbox.skippedVersions(provider) };
  }

  async previewRecoverySources(roomId: string, requestedSignal?: AbortSignal): Promise<RecoverySourcePlan> {
    const initial = this.ports.room(roomId), room = initial && { ...initial };
    if (!this.active() || this.stopped || !room?.remembers || this.forgettingRoom(roomId)) throw new Error("Enable remembering and consent before planning recovery.");
    const signal = requestedSignal ? AbortSignal.any([requestedSignal, this.workSignal(roomId)]) : this.workSignal(roomId);
    signal.throwIfAborted();
    const provider = await this.provider();
    signal.throwIfAborted();
    if (!this.active() || this.stopped || this.ports.room(roomId)?.uuid !== room.uuid || !this.ports.room(roomId)?.remembers || this.forgettingRoom(roomId))
      throw new Error("The recovery attachment or permission changed.");
    if (!provider.generations || !provider.writes?.transport.recoveryInventory) throw new Error("This provider cannot enumerate recovery inputs.");
    const lease = await this.routing.resolve(provider, room, signal);
    if (!lease?.room.account || !lease.room.generationRevision) throw new Error("Refresh the room's graph attachment before planning recovery.");
    return this.readRecoverySources(provider, room, lease, signal);
  }
  private async readRecoverySources(provider: MemoryProvider, room: MemoryRoomView, lease: GraphLease, signal: AbortSignal, sourceScope?: RecoveryScope): Promise<RecoverySourcePlan> {
    const roomId = room.id;
    if (!provider.writes?.transport.recoveryInventory) throw new Error("Recovery inventory is unavailable.");
    const scope = sourceScope ?? { provider: provider.id, account: lease.room.account, room: room.id, uuid: room.uuid, graphId: lease.room.graphId, revision: lease.room.generationRevision };
    const current = () => !signal.aborted && this.active() && !this.stopped && !!this.ports.room(roomId)?.remembers && !this.forgettingRoom(roomId) && lease.current();
    if (!current()) throw new Error("The recovery attachment or permission changed.");
    const inventory = await provider.writes.transport.recoveryInventory(room.uuid, signal, this.ports.now ?? Date.now, scope.graphId);
    signal.throwIfAborted();
    const planner = this.recoverySourcePlanner(provider, current);
    const plan = planner.plan({ ...scope, account: scope.account!, revision: scope.revision! }, inventory);
    this.recoveryPlans.set(plan, () => planner.locallyCurrent(plan));
    return plan;
  }
  private recoverySourcePlanner(provider: MemoryProvider, current: () => boolean): MemoryRecoverySources {
    if (!provider.writes) throw new Error("Recovery source serializer is unavailable.");
    return new MemoryRecoverySources({ outbox: this.ports.outbox, writes: provider.writes, current,
      message: (room, id) => {
        const row = this.ports.history.getById?.(room, id);
        if (row) return { state: "live", row };
        const removed = this.ports.history.getById?.(room, id, true);
        return removed ? { state: "removed", row: removed } : { state: "missing" };
      }, relation: (room, id, hash) => this.ports.history.carriedRelation?.(room, id, hash) ?? "unknown" });
  }

  async previewSelectiveReview(input: SelectiveReviewRequest, requestedSignal?: AbortSignal): Promise<SelectiveReviewReport> {
    const request = MemorySelectiveReview.snapshotRequest(input), scope = request.scope, room = this.ports.room(scope.room);
    if (!room || room.uuid !== scope.uuid || !room.remembers || !this.active() || this.stopped || this.forgettingRoom(room.id) ||
        this.ports.config().provider !== scope.provider || !this.ports.outbox.repairs.selectiveScopeReadable(scope))
      throw new Error("Selective review attachment is unavailable.");
    const signal = AbortSignal.any([this.workSignal(room.id), AbortSignal.timeout(60_000), ...(requestedSignal ? [requestedSignal] : [])]);
    signal.throwIfAborted();
    const scopeKey = scope.room, token = {}, providerKey = this.providerKey();
    const consent = recoveryFingerprint(this.ports.config().consent[scope.provider]);
    this.selectiveReviewTokens.set(scopeKey, token);
    let cancel!: () => void;
    const interrupted = new Promise<never>((_, reject) => { cancel = () => reject(new Error("Selective review interrupted")); signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel(); });
    let provider: MemoryProvider;
    try { provider = await Promise.race([this.provider(), interrupted]); }
    finally { signal.removeEventListener("abort", cancel); }
    const writes = provider.writes, transport = writes?.transport, read = transport?.recoveryKnowledge;
    const current = () => {
      const live = this.ports.room(scope.room);
      return !signal.aborted && !this.stopped && this.active() && !!live?.remembers && live.uuid === scope.uuid && !this.forgettingRoom(scope.room) &&
        this.selectiveReviewTokens.get(scopeKey) === token && this.providerKey() === providerKey &&
        recoveryFingerprint(this.ports.config().consent[scope.provider]) === consent && this.providerInstance?.provider === provider &&
        this.providerInstance.key === providerKey && provider.id === scope.provider && provider.generations?.account === scope.account &&
        provider.writes === writes && writes?.transport === transport && transport?.recoveryKnowledge === read &&
        this.ports.outbox.repairs.selectiveScopeReadable(scope);
    };
    const applied = this.routing.view(provider, room);
    if (!current() || !applied || !read || (applied.graphId ?? baseGenerationId(room.uuid)) !== scope.graphId ||
        applied.generationRevision !== scope.revision || applied.account !== scope.account) throw new Error("Selective review applied route or reader is unavailable.");
    const owner = this.ports.outbox.repairs.selectiveReview({
      knowledge: { recoveryKnowledge: (uuid, graphId, abort, now) => read.call(transport, uuid, graphId, abort, now) },
      sources: this.recoverySourcePlanner(provider, current), current, now: this.ports.now ?? Date.now,
    });
    const report = await owner.inspect(request, signal);
    if (!current()) throw new Error("Selective review attachment changed.");
    this.selectiveReports.set(report, { owner, signal }); return report;
  }
  prepareSelectiveIntent(report: SelectiveReviewReport) {
    const entry = this.selectiveReports.get(report);
    if (!entry) throw new Error("Selective review was not issued by this pipeline.");
    return entry.owner.prepareIntent(report, entry.signal);
  }
  async recordSelectiveReview(report: SelectiveReviewReport, intentId: string, checkpoint: number, reviewId: string,
    decisions: SelectiveReviewDecision[], requestedSignal?: AbortSignal) {
    const entry = this.selectiveReports.get(report);
    if (!entry || !this.ports.selectiveReviewAuthorized) throw new Error("Selective semantic review integration is unavailable.");
    const signal = AbortSignal.any([entry.signal, ...(requestedSignal ? [requestedSignal] : [])]);
    return entry.owner.accept(report, intentId, checkpoint, reviewId, decisions,
      (report, id, fingerprint) => this.ports.selectiveReviewAuthorized?.(report, id, fingerprint) === true, signal);
  }

  async prepareRecoveryBuild(roomId: string, maxCredits: number, signal?: AbortSignal): Promise<RecoveryJob> {
    const plan = await this.previewRecoverySources(roomId, signal);
    const current = this.recoveryPlans.get(plan)!;
    const provider = await this.provider();
    if (!current() || !provider.writes || provider.generations?.account !== plan.scope.account) throw new Error("The recovery source lease changed.");
    return this.ports.outbox.recovery.prepare(plan, provider.writes, this.ports.room(roomId)!.name, maxCredits, (this.ports.now ?? Date.now)(), current);
  }

  async previewRecoveryBuild(id: string, signal?: AbortSignal) {
    const job = this.ports.outbox.recovery.get(id);
    if (!job || job.state === "cancelled") throw new Error("Recovery job is unavailable.");
    const sources = await this.previewRecoverySources(job.quote.scope.room, signal);
    if (sources.state !== "ready" || sources.fingerprint !== job.quote.sourceFingerprint || recoveryFingerprint(sources.scope) !== recoveryFingerprint(job.quote.scope)
      || !this.recoverySourceCurrent(sources)) throw new Error("The recovery sources changed. Prepare a new quotation.");
    return { kind: "quote" as const, job: this.ports.outbox.recovery.get(id)!, sources,
      spent: this.ports.outbox.recovery.spent(id), usage: this.status().usage };
  }
  recoverySourceCurrent(plan: RecoverySourcePlan): boolean { return this.recoveryPlans.get(plan)?.() === true; }

  async runRecoveryBuild(id: string, requestedSignal?: AbortSignal): Promise<RecoveryJob> {
    const job = this.ports.outbox.recovery.get(id);
    if (!job) throw new Error("Recovery job not found.");
    const signal = requestedSignal ? AbortSignal.any([requestedSignal, this.workSignal(job.quote.scope.room)]) : this.workSignal(job.quote.scope.room);
    const provider = await this.provider();
    const pending = this.recoveryRunning.get(id); if (pending) return pending;
    const authorized = (saved: RecoveryJob) => {
      const room = this.ports.room(saved.quote.scope.room);
      return !signal.aborted && !this.stopped && this.active() && this.providerInstance?.provider === provider && this.providerInstance.key === this.providerKey()
        && !!room?.remembers && room.uuid === saved.quote.scope.uuid && !this.forgettingRoom(room.id) && this.ports.recoveryAuthorized?.(saved) === true;
    };
    const builder = new MemoryRecoveryBuilder({ outbox: this.ports.outbox, provider, now: this.ports.now ?? Date.now,
      monthlyCap: () => Number(this.section(this.ports.config()).monthlyCreditCap ?? 0), authorized,
      inspect: (saved, signal) => this.previewRecoverySources(saved.quote.scope.room, signal),
      current: plan => this.recoveryPlans.get(plan)?.() === true });
    const work = builder.run(id, signal); this.recoveryRunning.set(id, work);
    try { return await work; } finally { if (this.recoveryRunning.get(id) === work) this.recoveryRunning.delete(id); }
  }

  async previewRecoveryVerification(id: string, requestedSignal?: AbortSignal): Promise<RecoveryVerificationReport> {
    return this.readRecoveryVerification(id, requestedSignal);
  }
  private async readRecoveryVerification(id: string, requestedSignal?: AbortSignal,
    readSources?: (room: string, signal: AbortSignal) => Promise<RecoverySourcePlan>): Promise<RecoveryVerificationReport> {
    const job = this.ports.outbox.recovery.get(id);
    if (!job) throw new Error("Recovery job not found.");
    const signal = AbortSignal.any([this.workSignal(job.quote.scope.room), AbortSignal.timeout(60_000), ...(requestedSignal ? [requestedSignal] : [])]);
    const sources = readSources ?? ((room, signal) => this.previewRecoverySources(room, signal));
    const firstPlan = await sources(job.quote.scope.room, signal), provider = await this.provider();
    const read = provider.writes?.transport.recoveryKnowledge;
    const current = (plan: RecoverySourcePlan) => !signal.aborted && this.providerInstance?.provider === provider
      && this.providerInstance.key === this.providerKey() && provider.generations?.account === job.quote.scope.account && this.recoveryPlans.get(plan)?.() === true;
    if (!read || !current(firstPlan)) throw new Error("This recovery output reader or attachment is unavailable.");
    const first = await read.call(provider.writes!.transport, job.quote.scope.uuid, job.quote.graphId, signal, this.ports.now ?? Date.now);
    signal.throwIfAborted();
    if (!current(firstPlan)) throw new Error("The recovery source lease changed.");
    const plan = await sources(job.quote.scope.room, signal);
    if (!current(plan)) throw new Error("The recovery source lease changed.");
    const second = await read.call(provider.writes!.transport, job.quote.scope.uuid, job.quote.graphId, signal, this.ports.now ?? Date.now);
    signal.throwIfAborted();
    if (!current(plan)) throw new Error("The recovery source lease changed.");
    const knowledge = first.state === "unknown" ? first : second.state === "unknown" ? second
      : first.fingerprint !== second.fingerprint ? { state: "unknown" as const, reason: "output_changed_during_review", startedAt: first.startedAt, finishedAt: second.finishedAt } : second;
    return this.ports.outbox.recoveryVerification.inspect(job, plan, knowledge, () => current(plan) && firstPlan.fingerprint === plan.fingerprint);
  }

  async recordRecoveryReview(id: string, reviewedFingerprint: string, reviewId: string, decisions: RecoveryReviewDecision[],
    signal?: AbortSignal): Promise<RecoveryReviewReceipt> {
    if (!this.ports.recoveryReviewAuthorized) throw new Error("The human recovery review integration is unavailable.");
    const reviewedDecisions = structuredClone(decisions);
    const report = await this.previewRecoveryVerification(id, signal);
    if (report.fingerprint !== reviewedFingerprint) throw new Error("The recovery review contents changed.");
    return this.ports.outbox.recoveryVerification.accept(report, reviewId, reviewedDecisions, (this.ports.now ?? Date.now)(),
      (report, reviewId, fingerprint) => this.ports.recoveryReviewAuthorized?.(report, reviewId, fingerprint) === true);
  }

  async previewRecoverySwitch(id: string, signal?: AbortSignal): Promise<RecoverySwitchPreview> {
    const report = await this.previewRecoveryVerification(id, signal), job = this.ports.outbox.recovery.get(id)!;
    const review = this.ports.outbox.recoveryVerification.matchingReview(report);
    if (!review || !report.sources) throw new Error("Review the current recovery contents before preparing a switch.");
    const scope = job.quote.scope, namespace = { provider: scope.provider, account: scope.account, uuid: scope.uuid };
    const head = this.ports.outbox.generations.head(namespace);
    if (!head.route || head.reason || head.followPending || head.revision !== scope.revision || head.route.graphId !== (scope.graphId ?? baseGenerationId(scope.uuid))
      || head.route.epoch === Number.MAX_SAFE_INTEGER || head.route.graphId === job.quote.graphId) throw new Error("The room's active graph changed.");
    const contents = { jobId: id, quoteFingerprint: job.quoteFingerprint, scope, previous: Object.freeze(head.route),
      wanted: Object.freeze({ graphId: job.quote.graphId, epoch: head.route.epoch + 1, copy: job.quote.copyId }),
      sourceFingerprint: job.quote.sourceFingerprint, reportFingerprint: report.fingerprint, reviewFingerprint: recoveryFingerprint(review) };
    const preview = Object.freeze({ ...contents, fingerprint: recoveryFingerprint(contents) });
    this.recoverySwitchPreviews.set(preview, () => this.ports.outbox.recoveryVerification.matchingReview(report) !== null
      && this.ports.outbox.generations.head(namespace).revision === head.revision);
    return preview;
  }
  async prepareRecoverySwitch(id: string, fingerprint: string, approvalId: string, requestedSignal?: AbortSignal): Promise<GenerationSwitch> {
    if (!this.ports.recoveryPreparationAuthorized) throw new Error("The human switch preparation integration is unavailable.");
    const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(requestedSignal ? [requestedSignal] : [])]);
    const preview = await this.previewRecoverySwitch(id, signal), provider = await this.provider();
    if (preview.fingerprint !== fingerprint) throw new Error("The switch preparation contents changed.");
    const current = () => !signal.aborted && !this.stopped && this.active() && this.providerInstance?.provider === provider
      && this.providerInstance.key === this.providerKey() && this.recoverySwitchPreviews.get(preview)?.() === true;
    const matches = (sw: GenerationSwitch) => current() && sw.approvalId === approvalId && sw.sourceFingerprint === preview.sourceFingerprint
      && sameGenerationRoute(sw.previous, preview.previous) && sameGenerationRoute(sw.wanted, preview.wanted)
      && this.ports.recoveryPreparationAuthorized?.(preview, approvalId) === true;
    return this.routing.prepareSwitch(provider, preview.scope.uuid, preview.wanted.graphId, preview.sourceFingerprint, approvalId,
      { authorized: matches, verified: async sw => matches(sw), current: matches }, signal);
  }

  recoverySwitches(id: string) {
    const job = this.ports.outbox.recovery.get(id);
    if (!job) throw new Error("Recovery job is unavailable.");
    const { provider, account, uuid } = job.quote.scope;
    return this.ports.outbox.generations.switches({ provider, account, uuid }, job.quote.graphId);
  }
  private recoverySwitch(id: string, switchId: string) {
    const job = this.ports.outbox.recovery.get(id);
    if (!job) throw new Error("Recovery job is unavailable.");
    const { provider, account, uuid } = job.quote.scope, scope = { provider, account, uuid };
    const sw = this.ports.outbox.generations.switch(scope, switchId);
    if (!sw || sw.wanted.graphId !== job.quote.graphId || sw.wanted.copy !== job.quote.copyId || sw.sourceFingerprint !== job.quote.sourceFingerprint)
      throw new Error("This switch belongs to another rebuild or account.");
    return { job, scope, sw };
  }
  async previewRecoveryActivation(id: string, switchId: string, signal?: AbortSignal): Promise<RecoveryActivationPreview> {
    const { job } = this.recoverySwitch(id, switchId);
    return this.roomTask(job.quote.scope.room, () => this.readRecoveryActivation(id, switchId, signal));
  }
  private async readRecoveryActivation(id: string, switchId: string, signal?: AbortSignal): Promise<RecoveryActivationPreview> {
    signal?.throwIfAborted();
    const { job, sw } = this.recoverySwitch(id, switchId);
    if (sw.state !== "prepared") throw new Error("This plan cannot be published. Check its recorded result.");
    const preview = await this.previewRecoverySwitch(id, signal), live = this.recoverySwitch(id, switchId).sw;
    if (live.state !== "prepared" || preparationFingerprint(live) !== preparationFingerprint(sw) || !sameGenerationRoute(sw.previous, preview.previous)
      || !sameGenerationRoute(sw.wanted, preview.wanted) || this.ports.recoveryPreparationAuthorized?.(preview, sw.approvalId) !== true
      || this.recoverySwitchPreviews.get(preview)?.() !== true) throw new Error("The prepared plan or reviewed contents changed.");
    const contents = { preview, switchId, roomName: job.quote.roomName, createdAt: job.createdAt, preparationFingerprint: preparationFingerprint(sw) };
    return Object.freeze({ ...contents, fingerprint: recoveryFingerprint(contents) });
  }
  private recoveryAttachment(provider: MemoryProvider, job: RecoveryJob, signal: AbortSignal): boolean {
    const room = this.ports.room(job.quote.scope.room);
    return !signal.aborted && !this.stopped && this.active() && this.providerInstance?.provider === provider && this.providerInstance.key === this.providerKey()
      && provider.id === job.quote.scope.provider && provider.generations?.account === job.quote.scope.account
      && room?.uuid === job.quote.scope.uuid && room.remembers && !this.forgettingRoom(room.id);
  }
  async activateRecoverySwitch(id: string, switchId: string, fingerprint: string, approvalId: string, requestedSignal?: AbortSignal) {
    if (!this.ports.recoveryPublicationAuthorized) throw new Error("Human activation is unavailable.");
    const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(requestedSignal ? [requestedSignal] : [])]);
    const { job } = this.recoverySwitch(id, switchId);
    return this.roomTask(job.quote.scope.room, () => this.publishRecoverySwitch(id, switchId, fingerprint, approvalId, signal));
  }
  private async publishRecoverySwitch(id: string, switchId: string, fingerprint: string, approvalId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const card = await this.readRecoveryActivation(id, switchId, signal), { job } = this.recoverySwitch(id, switchId), provider = await this.provider();
    if (card.fingerprint !== fingerprint || !this.recoveryAttachment(provider, job, signal)) throw new Error("The activation card or account changed.");
    if (this.ports.recoveryPublicationAuthorized?.(card, approvalId) !== true) throw new Error("This activation has no matching human publication approval.");
    const room = { ...this.ports.room(job.quote.scope.room)! }, leased = this.routing.view(provider, room);
    if (!leased) throw new Error("Refresh the room's graph attachment.");
    const lease = { room: leased, current: () => this.routing.current(provider, leased) };
    let report: RecoveryVerificationReport | null = null;
    const authorized = (sw: GenerationSwitch) => this.recoveryAttachment(provider, job, signal)
      && preparationFingerprint(sw) === card.preparationFingerprint
      && this.ports.recoveryPreparationAuthorized?.(card.preview, sw.approvalId) === true
      && this.ports.recoveryPublicationAuthorized?.(card, approvalId) === true;
    const current = (sw: GenerationSwitch) => authorized(sw) && !!report && report.fingerprint === card.preview.reportFingerprint
      && recoveryFingerprint(this.ports.outbox.recoveryVerification.matchingReview(report)) === card.preview.reviewFingerprint;
    const result = await this.routing.advanceSwitch(provider, job.quote.scope.uuid, switchId, {
      authorized, current,
      verified: async sw => {
        if (!authorized(sw)) return false;
        report = await this.readRecoveryVerification(id, signal, (_room, readSignal) => this.readRecoverySources(provider, room, lease, readSignal));
        return current(sw);
      }, observing: () => this.recoveryAttachment(provider, job, signal),
    }, signal);
    if (!this.recoveryAttachment(provider, job, signal)) throw new Error("The activation account or permission changed. Check the recorded result.");
    return this.recoverySwitchResult(job, provider, result);
  }
  private recoverySwitchResult(job: RecoveryJob, provider: MemoryProvider, sw: GenerationSwitch) {
    const head = this.ports.outbox.generations.head({ provider: job.quote.scope.provider, account: job.quote.scope.account, uuid: job.quote.scope.uuid });
    const room = this.ports.room(job.quote.scope.room), applied = room && this.routing.view(provider, room);
    return { kind: "switch-result" as const, jobId: job.id, switch: sw, observed: head.route,
      observedAt: head.checkedAt, observationReason: head.reason,
      applied: !!applied && sameGenerationRoute(head.route, sw.wanted), followPending: head.followPending,
      repairCovered: !!applied && sameGenerationRoute(head.route, sw.wanted)
        && this.ports.outbox.repairs.covered({ ...job.quote.scope, graphId: job.quote.graphId, revision: applied.generationRevision! }) };
  }

  private recoveryCompletion<T>(id: string, switchId: string, requestedSignal: AbortSignal | undefined,
    finish: (report: RecoveryVerificationReport, scope: RecoveryScope & { graphId: string }, current: () => boolean) => T): Promise<T> {
    const { job } = this.recoverySwitch(id, switchId);
    const signal = AbortSignal.any([this.workSignal(job.quote.scope.room), AbortSignal.timeout(60_000), ...(requestedSignal ? [requestedSignal] : [])]);
    return this.roomTask(job.quote.scope.room, async () => {
      const provider = await this.provider(), { sw } = this.recoverySwitch(id, switchId);
      const attached = () => this.recoveryAttachment(provider, job, signal);
      if (sw.state !== "confirmed" || !attached()) throw new Error("Check and follow this candidate in its original account before completing repair.");
      const room = { ...this.ports.room(job.quote.scope.room)! }, lease = await this.routing.resolve(provider, room, signal, false, attached);
      if (!lease || lease.room.graphId !== job.quote.graphId) throw new Error("The reviewed candidate is not this room's active generation.");
      const scope = { ...job.quote.scope, graphId: job.quote.graphId, revision: lease.room.generationRevision! };
      const current = () => attached() && lease.current() && this.recoverySwitch(id, switchId).sw.state === "confirmed"
        && sameGenerationRoute(this.ports.outbox.generations.head(job.quote.scope).route, sw.wanted)
        && !this.ports.outbox.deliveries.extraRecoveryAttempt(job.quote.scope, job.quote.graphId, job.id);
      if (!current()) throw new Error("The active candidate has changed or has an additional paid write. Prepare a new rebuild.");
      return this.routing.inspectCurrent(provider, lease, signal, current,
        () => this.readRecoveryVerification(id, signal, (_room, readSignal) => this.readRecoverySources(provider, room, lease, readSignal, job.quote.scope)),
        report => {
          if (!current() || report.state !== "review_required" || !this.ports.outbox.recoveryVerification.current(report))
            throw new Error(`The current recovery sources, knowledge or repair context could not be verified: ${report.blockers.map(b => b.reason).join(", ")}`);
          return finish(report, scope, current);
        });
    });
  }
  previewRecoveryCompletionReview(id: string, switchId: string, signal?: AbortSignal) {
    return this.recoveryCompletion(id, switchId, signal, report => report);
  }
  recordRecoveryCompletionReview(id: string, switchId: string, fingerprint: string, reviewId: string, decisions: RecoveryReviewDecision[], signal?: AbortSignal) {
    const reviewed = structuredClone(decisions);
    return this.recoveryCompletion(id, switchId, signal, (report, _scope, current) => {
      if (report.fingerprint !== fingerprint) throw new Error("The recovery review contents changed.");
      return this.ports.outbox.recoveryVerification.accept(report, reviewId, reviewed, (this.ports.now ?? Date.now)(),
        (r, approved, decisionsFingerprint) => current() && this.ports.recoveryReviewAuthorized?.(r, approved, decisionsFingerprint) === true);
    });
  }
  private recoveryCompletionCard(report: RecoveryVerificationReport, scope: RecoveryScope & { graphId: string }, switchId: string): RecoveryCompletionPreview {
    const job = this.ports.outbox.recovery.get(report.jobId)!, review = this.ports.outbox.recoveryVerification.matchingReview(report);
    if (!review) throw new Error("Review the current active recovery contents before completing repair.");
    const contents = { jobId: job.id, quoteFingerprint: job.quoteFingerprint, switchId, scope, roomName: job.quote.roomName, createdAt: job.createdAt,
      reportFingerprint: report.fingerprint, sourceFingerprint: review.sourceFingerprint, knowledgeFingerprint: review.knowledgeFingerprint,
      reviewFingerprint: recoveryFingerprint(review), repairFingerprint: review.repairFingerprint, repairRevision: report.repair!.revision,
      originals: report.sources!.sources.length, facts: report.knowledge!.edges.length, nodes: report.knowledge!.nodes.length };
    return Object.freeze({ ...contents, fingerprint: recoveryFingerprint(contents) });
  }
  previewRecoveryCompletion(id: string, switchId: string, signal?: AbortSignal) {
    return this.recoveryCompletion(id, switchId, signal, (report, scope) => this.recoveryCompletionCard(report, scope, switchId));
  }
  completeRecoveryRepair(id: string, switchId: string, fingerprint: string, approvalId: string, signal?: AbortSignal) {
    return this.recoveryCompletion(id, switchId, signal, (report, scope, current) => {
      const card = this.recoveryCompletionCard(report, scope, switchId);
      const authorized = () => current() && this.ports.recoveryCompletionAuthorized?.(card, approvalId) === true;
      if (card.fingerprint !== fingerprint || !authorized()) throw new Error("The completion card changed or lacks a separate human approval.");
      const receipt = this.ports.outbox.generations.transaction(() => {
        const job = this.ports.outbox.recovery.get(id)!;
        for (const item of job.quote.items) {
          const row = this.ports.outbox.deliveries.get(item.opId)!, source = row.payload?.binding?.source;
          if (!source) continue;
          for (const externalId of row.externalIds) {
            const bindings = this.ports.outbox.episodeSources(scope.provider, scope.room, externalId, scope.account);
            if (bindings.some(b => b.sourceId !== item.sourceId || b.source && ["kind", "graphId", "version", "authorId", "authorName", "ts"]
              .some(key => b.source![key as keyof typeof source] !== source[key as keyof typeof source])))
              throw new Error("The candidate's local source binding conflicts with the verified original.");
            this.ports.outbox.mapEpisode(scope.provider, scope.room, item.sourceId, externalId, { ...source, boundCopy: row.identity.copyId }, scope.account);
          }
        }
        const receipt = this.ports.outbox.recoveryVerification.complete(report, scope, switchId, (this.ports.now ?? Date.now)(), authorized);
        this.ports.outbox.invalidateRecoveryBriefs(scope.provider);
        if (!authorized()) throw new Error("The repair completion attachment changed.");
        return receipt;
      });
      this.freshSearches.clear(); this.lateCalls.clear();
      return { kind: "repair-result" as const, jobId: id, switchId, receipt, covered: this.ports.outbox.repairs.covered(scope) };
    });
  }
  async checkRecoverySwitch(id: string, switchId: string, requestedSignal?: AbortSignal) {
    const { job, sw } = this.recoverySwitch(id, switchId), provider = await this.provider();
    const signal = AbortSignal.any([this.workSignal(job.quote.scope.room), AbortSignal.timeout(60_000), ...(requestedSignal ? [requestedSignal] : [])]);
    const observing = () => this.recoveryAttachment(provider, job, signal);
    if (!observing()) throw new Error("Restore this room's original account and consent before checking the switch.");
    const result = sw.state === "prepared" || sw.state === "blocked" ? sw : await this.routing.advanceSwitch(provider, job.quote.scope.uuid, switchId,
      { authorized: () => false, verified: async () => false, current: () => false, observing }, signal);
    if (!observing()) throw new Error("The switch observation account or permission changed.");
    if (["confirmed", "superseded"].includes(result.state)) await this.routing.resolve(provider, { ...this.ports.room(job.quote.scope.room)! }, signal, false, observing);
    if (!observing()) throw new Error("The switch observation account or permission changed.");
    return this.recoverySwitchResult(job, provider, result);
  }

  checkSourceVersion(roomId: string, sourceId: string): void {
    if (!this.active()) throw new Error("Enable this provider and its consent before checking a message again.");
    if (!this.ports.room(roomId)?.remembers || this.forgettingRoom(roomId)) throw new Error("Enable remembering in this room before checking a message again.");
    if (!this.ports.outbox.reopenExhaustedVersionCheck(roomId, sourceId)) throw new Error("Only a check whose automatic reads ended can be asked again here. Refresh the registry.");
    this.wake(roomId);
  }

  checkBinding(id: string): void {
    if (!this.active()) throw new Error("Enable this provider and its consent before checking a binding.");
    const roomId = this.ports.outbox.bindingRoom(this.ports.config().provider, id);
    if (!roomId || !this.ports.room(roomId)?.remembers || this.forgettingRoom(roomId)) throw new Error("Enable remembering in this room before checking a binding.");
    this.ports.outbox.requestBindingCheck(this.ports.config().provider, id);
    this.wake(roomId);
  }

  private replacementView(provider: string, op: MemoryOp, now: number, deletionState: (op: MemoryOp) => string): ReplacementView {
    if (op.deferKind === "failed" || op.deferKind === "expired") return { state: op.deferKind };
    if (op.retryAt > now) return { state: "settling" };
    const room = this.routedRoom(op.room), uuid = typeof op.payload.uuid === "string" ? op.payload.uuid : room?.uuid;
    if (!room?.remembers || uuid !== room.uuid || room.graphId !== op.payload.graphId || room.account !== undefined && op.account !== room.account) return { state: "suspended" };
    const current = this.ports.history.getById?.(room.id, String(op.payload.sourceId));
    const blocker = providerEntry(provider)?.capabilities.forgetEpisode ? this.ports.outbox.replacementBlocker(provider, room.id, room.uuid, String(op.payload.sourceId), current ? sourceVersion(current) : undefined, room.graphId, room.account) : null;
    if (!blocker) return { state: "queued" };
    if (blocker.kind === "deletion") return { state: "waiting", waitsFor: { kind: "deletion", op: blocker.op.id, state: deletionState(blocker.op), reason: blocker.op.deferReason } };
    const { delivery } = blocker, store = this.ports.outbox.deliveries, watch = store.watches.get(delivery.opId);
    return { state: "waiting", waitsFor: { kind: "version", opId: delivery.opId, attempt: delivery.attempts, state: delivery.state,
      reason: store.maintenance(delivery.opId)?.reason ?? delivery.reason, checksEnded: !watch || watch.state !== "active" } };
  }

  recoverDelivery(opId: string, attempt: number, action: "check" | "retry" | "replay", confirmed = false): void {
    const store = this.ports.outbox.deliveries, row = store.get(opId), now = (this.ports.now ?? Date.now)();
    const cleanup = row?.retiredAt !== null;
    if (!row || row.attempts !== attempt || (cleanup ? action !== "check" || row.cleanup !== "pending" || this.ports.room(row.identity.roomId)?.uuid !== row.identity.roomUuid
      : !store.currentCopy(row.identity))) throw new Error("This delivery changed or its local copy was removed. Refresh the registry.");
    if (row.identity.provider !== this.ports.config().provider || !this.active() || !cleanup && !this.ports.room(row.identity.roomId)?.remembers) throw new Error("Enable this provider, its consent and the room's remembering before recovery.");
    if (action === "retry" && !store.retryRejected(opId, attempt, "operator_retry", now)) throw new Error("Only a known refusal can be retried here.");
    if (action === "replay" && (!confirmed || !store.authorizeReplay(opId, attempt, now))) throw new Error("Confirm one additional attempt for an uncertain episode; it may cost again and create a duplicate.");
    if (action === "check" && row.state === "conflict") throw new Error("This delivery needs graph repair; another send cannot resolve it.");
    store.requestCheck(opId, now);
    this.wake(row.identity.roomId);
  }

  retryCleanup(opId: number): void {
    const provider = this.ports.config().provider;
    const op = this.ports.outbox.ops(provider, 1, { kinds: ["forget"], after: opId - 1 })[0];
    if (!op || op.id !== opId || !this.ports.outbox.retryOp(provider, opId)) throw new Error("This deletion is not waiting for a retry. Refresh the registry.");
    this.wake(op.room);
  }

  retryReplacement(opId: number): void {
    const provider = this.ports.config().provider;
    const op = this.ports.outbox.ops(provider, 1, { kinds: ["reingest"], after: opId - 1 })[0];
    if (!op || op.id !== opId || !this.ports.outbox.retryOp(provider, opId, "reingest")) throw new Error("This new version is not waiting for a retry. Refresh the registry.");
    this.wake(op.room);
  }

  retryDetachedForget(provider: string, room: string, uuid: string): void {
    if (provider !== this.ports.config().provider) throw new Error("Select the deletion's provider first.");
    const status = this.ports.outbox.roomForgetStatus(provider, room, uuid);
    if (!status || status.state === "confirmed") throw new Error("This deletion is no longer waiting for a retry.");
    this.ports.outbox.retryRoomForget(provider, room, uuid);
    this.wake(room);
  }

  private roomTask<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(roomId) ?? Promise.resolve();
    const task = previous.then(work, work);
    this.chains.set(roomId, task.then(() => undefined, () => undefined));
    return task;
  }
  wake(roomId: string): void {
    if (this.stopped) return;
    const forgetting = this.forgettingRoom(roomId);
    if (!this.active() && !forgetting) return;
    const attachedSignal = this.workSignal(roomId);
    if (attachedSignal.aborted && !forgetting) return;
    const signal = attachedSignal.aborted ? this.cleanupWork.signal : attachedSignal;
    const work = () => this.drain(roomId, signal).catch(error => { if (!signal.aborted) this.ports.log.error(`memory: drain of ${roomId} broke: ${(error as Error).message}`); });
    void this.roomTask(roomId, work);
  }

  edited(roomId: string, sourceId: string, editedTs: number): void {
    if (this.ports.outbox.importedSource(roomId, sourceId)) { this.wake(roomId); return; }
    const current = this.ports.history.getById?.(roomId, sourceId);
    const provider = this.ports.config().provider;
    const room = this.routedRoom(roomId) ?? this.ports.room(roomId);
    if (current && room && this.ports.outbox.boundVersion(provider, roomId, sourceId, sourceVersion(current))
        && !this.ports.outbox.pendingForget(provider, roomId, sourceId, room.uuid, room.graphId)) {
      this.wake(roomId);
      return;
    }
    this.ports.outbox.sourceChanged(roomId, sourceId, current ? sourceVersion(current) : undefined);
    if (!room || !this.active() || this.workSignal(roomId).aborted || this.forgettingRoom(roomId)) return;
    const key = `${roomId}:${sourceId}`;
    if (this.handledEdits.get(key) === editedTs) { this.wake(roomId); return; }
    this.handledEdits.set(key, editedTs);
    while (this.handledEdits.size > 512) this.handledEdits.delete(this.handledEdits.keys().next().value!);
    this.ports.outbox.ensureForget(provider, roomId, sourceId, room.uuid, room.graphId);
    if (room.remembers) {
      this.ports.outbox.queueReplacement(provider, roomId, sourceId, room.uuid, (this.ports.now ?? Date.now)() + REPLACEMENT_SETTLE_MS, room.graphId);
      this.ports.outbox.queueVersionCheck(roomId, sourceId, (this.ports.now ?? Date.now)());
    }
    this.wake(roomId);
  }

  truncated(roomId: string, fromSeq: number): void {
    for (const { message } of this.ports.history.deleted(roomId)) if (message.seq >= fromSeq) this.ports.outbox.sourceChanged(roomId, message.id);
    if (!this.active() || this.workSignal(roomId).aborted) return;
    const config = this.ports.config();
    for (const { message } of this.ports.history.deleted(roomId)) {
      if (message.seq < fromSeq) continue;
      if (this.ports.outbox.episodeIds(config.provider, roomId, message.id).length) {
        this.ports.outbox.enqueue(config.provider, roomId, "forget", { sourceId: message.id });
      }
    }
    this.wake(roomId);
  }

  fact(roomId: string, subject: string, predicate: string, object: string): void {
    if (!this.active() || this.workSignal(roomId).aborted || this.forgettingRoom(roomId) || !this.ports.room(roomId)?.remembers) return;
    this.ports.outbox.enqueue(this.ports.config().provider, roomId, "fact", { subject, predicate, object, ts: (this.ports.now ?? Date.now)() });
    this.wake(roomId);
  }

  remember(roomId: string, author: { id: string; name: string }, text: string): void {
    this.workSignal(roomId).throwIfAborted();
    if (this.forgettingRoom(roomId)) throw new Error("Cloud memory deletion is still pending for this room.");
    if (!this.active()) throw new Error("Long-term memory is off; the human enables it in Settings.");
    const room = this.ports.room(roomId);
    if (!room?.remembers) throw new Error("This room does not feed the long-term memory (its switch is off).");
    const trimmed = text.trim();
    if (!trimmed || [...trimmed].length > 2000) throw new Error("A memory note is 1–2000 characters of plain text.");
    this.ports.outbox.enqueue(this.ports.config().provider, roomId, "note", { authorId: author.id, authorName: author.name, text: trimmed, ts: (this.ports.now ?? Date.now)() });
    this.wake(roomId);
  }

  async searchFacts(roomId: string, query: string, options: { limit: number; across?: boolean; waitMs?: number }): Promise<{ facts: Recalled[]; pending: number } | null> {
    const signal = this.workSignal(roomId);
    if (!this.active() || signal.aborted || this.forgettingRoom(roomId)) return null;
    const room = this.ports.room(roomId);
    if (!room?.remembers) return null;
    const provider = await this.provider();
    if (signal.aborted) return null;
    const waitMs = options.waitMs ?? SEARCH_FACTS_WAIT_MS;
    const giveUp = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { const timedOut = new Error(`it did not answer within ${waitMs / 1000} s`); giveUp.abort(timedOut); reject(timedOut); }, waitMs);
      timer.unref?.();
    });
    try {
      const found = await Promise.race([this.searchGraphs(provider, room, [query], { candidates: options.limit, across: options.across === true && room.readsOtherRooms !== "off", signal: giveUp.signal }), late]);
      if (signal.aborted) return null;
      return { facts: found.slice(0, options.limit), pending: Math.max(0, this.ports.history.maxSeq(roomId) - this.ports.outbox.cursor(provider.id, roomId)) };
    } finally { clearTimeout(timer); }
  }

  currentFacts<T extends Recalled>(roomId: string, facts: T[], across = true): T[] {
    if (!this.active() || this.workSignal(roomId).aborted || this.forgettingRoom(roomId)) return [];
    const own = this.ports.room(roomId);
    if (!own?.remembers) return [];
    const others = across && own.readsOtherRooms !== "off" ? this.ports.searchPool?.(roomId) ?? [] : [];
    const allowed = [own, ...others.filter(r => r.remembers && r.id !== roomId && !this.workSignal(r.id).aborted && !this.forgettingRoom(r.id))]
      .flatMap(room => { const view = this.routedRoom(room.id); return view ? [view] : []; });
    return resolveFacts(facts, this.ports.config().provider, roomId, allowed, {
      outbox: this.ports.outbox, getById: this.ports.history.getById?.bind(this.ports.history),
    });
  }

  async replaySearch(roomId: string, seq: number, how?: QuestionsHow, options: AskOptions = {}): Promise<SearchReplay> {
    const signal = this.workSignal(roomId);
    signal.throwIfAborted();
    if (!this.active()) throw new Error("Long-term memory is off; the human enables it in Settings.");
    const room = this.ports.room(roomId);
    if (!room?.remembers) throw new Error("This room does not feed the long-term memory (its switch is off).");
    const row = this.ports.history.get(roomId, seq);
    if (!row || !asksMemory(row)) throw new Error(`#${seq} is not a message of the human's that asks the memory anything.`);
    const provider = await this.provider();
    signal.throwIfAborted();
    const text = searchText(row);
    const asked: AskedQuestions = how === "whole" ? { how: "whole", questions: [text] }
      : how === "split" ? { how: "split", questions: splitQuestions(text) }
      : await this.askFor(room, row, { waitMs: this.questionsWaitMs(), ...options }, undefined, signal);
    signal.throwIfAborted();
    const now = this.ports.now ?? Date.now;
    const started = now();
    const unread: string[] = [];
    const facts = asked.questions.length ? await this.searchGraphs(provider, room, asked.questions, { candidates: this.briefCandidates(), across: this.blockReadsOthers(room), unread, floor: 0 }) : [];
    signal.throwIfAborted();
    return { asked, facts, floor: this.floor(), searchedMs: now() - started, ...(unread.length ? { unread } : {}) };
  }

  forgettingRoom(roomId: string): boolean {
    return this.ports.outbox.forgetting(this.ports.config().provider, roomId);
  }

  roomForgetStatus(roomId: string) {
    const room = this.ports.room(roomId);
    return room ? this.ports.outbox.roomForgetStatus(this.ports.config().provider, roomId, room.uuid) : null;
  }

  forgetRoom(roomId: string, expected?: ForgetRecipient): void {
    this.workSignal(roomId).throwIfAborted();
    const config = this.ports.config();
    if (config.provider === "off") throw new Error("Choose the memory provider in Settings before forgetting its cloud memory.");
    const room = this.ports.room(roomId);
    if (!room) throw new Error("The room must be loaded before requesting cloud deletion.");
    const provider = expected?.provider ?? config.provider, uuid = expected?.uuid ?? room.uuid;
    const unlessStopped = (work: () => void) => () => {
      if (this.stopped) throw new Error("The long-term memory has stopped; the room's memory was not forgotten.");
      work();
    };
    const accept = (work: () => void) => { if (expected) this.accepted(roomId, expected, unlessStopped(work)); else unlessStopped(work)(); };
    if (this.forgettingRoom(roomId)) {
      if (!this.roomForgetStatus(roomId)) throw new Error("A deletion for a previous graph at this local address is still pending.");
      accept(() => this.ports.outbox.retryRoomForget(provider, roomId, uuid));
      this.wake(roomId); return;
    }
    const seq = this.ports.history.maxSeq(roomId);
    accept(() => this.ports.outbox.queueRoomForget(provider, roomId, { uuid, name: room.name }, seq));
    this.cancelRoomWork(roomId);
    this.attachRoom(roomId);
    this.wake(roomId);
  }

  private accepted(roomId: string, expected: ForgetRecipient, work: () => void): void {
    if (!this.ports.accept) throw new Error("The memory cannot tell whom a deletion is for here. Reopen the room settings.");
    this.ports.accept(roomId, expected, work);
  }

  briefBlock(roomId: string, addressed: readonly number[], shown: readonly number[] = []): { revision: string; block: string; search?: BriefSearch } | null {
    return this.briefFor(roomId, addressed, shown).block;
  }

  briefWhy(roomId: string, addressed: readonly number[]): string {
    return this.briefFor(roomId, addressed).why;
  }

  private briefFor(roomId: string, addressed: readonly number[], shown: readonly number[] = []): { block: { revision: string; block: string; search?: BriefSearch } | null; why: string } {
    if (!this.active() || this.workSignal(roomId).aborted || !this.ports.room(roomId)?.remembers) return { block: null, why: "off" };
    const seq = this.questionOf(roomId, addressed);
    if (seq === null) return { block: null, why: "no message of the human's to search" };
    const provider = this.ports.config().provider;
    const checkingRoute = !!this.providerInstance?.provider.generations && !!this.freshSearches.get(roomId)?.has(seq);
    const brief = checkingRoute ? null : this.ports.outbox.brief(provider, roomId, seq);
    const unanswered = brief?.asked.how === "model" && brief.asked.unanswered !== undefined;
    const facts = withoutShown(brief?.facts ? this.currentFacts(roomId, brief.facts, this.blockReadsOthers(this.ports.room(roomId)!)) : [], roomId, shown);
    const { lines, told } = factLines(facts, this.ports.config().blockChars);
    const note = untracedLine(told);
    const body = !brief || (brief.lines.length && !brief.facts) ? [PENDING_NOTE]
      : lines.length ? [FACTS_NOTE, ...(note ? [note] : []), ...lines]
      : unanswered ? [UNANSWERED_NOTE]
      : null;
    if (!body) return { block: null, why: brief?.asked.questions.length ? `nothing found for #${seq}` : `no questions for #${seq}` };
    const block = [`<memory-graph provider="${provider}">`, ...body, "</memory-graph>"].join("\n");
    const search: BriefSearch = brief ? { seq, ...brief.asked } : { seq, pending: true };
    return { block: { revision: instructionRevision(`#${seq}\n${block}`), block, search }, why: `#${seq}` };
  }


  private async drain(roomId: string, signal: AbortSignal): Promise<void> {
    const forgetting = this.forgettingRoom(roomId);
    if (this.stopped || signal.aborted || ((this.paused || !this.active()) && !forgetting)) return;
    let room = this.ports.room(roomId);
    const config = this.ports.config();
    const nextRetry = this.ports.outbox.nextOpRetry(config.provider, roomId);
    const now = (this.ports.now ?? Date.now)();
    if (room && nextRetry !== null && nextRetry > now && !forgetting) this.rewakeAt(roomId, nextRetry - now);
    if ((forgetting || !room?.remembers) && !this.runnableOps(config.provider, roomId).length &&
        (!room || this.ports.outbox.deliveries.nextMaintenance(config.provider, roomId, room.uuid, room.remembers) === null)) return;
    let provider: MemoryProvider;
    try { provider = await this.provider(); }
    catch (error) {
      if (signal.aborted) return;
      const pending = this.runnableOps(config.provider, roomId).filter(op => op.kind === "forget-room");
      if (pending.length) {
        const reason = this.forgetFailureReason(error);
        const retryable = error instanceof MemoryProviderError && error.retryable;
        for (const op of pending) this.ports.outbox.failRoomForget(this.ports.outbox.prepareRoomForget(op), reason, retryable);
        if (retryable) this.pause(roomId, reason); else this.fail(reason);
      } else this.pause(roomId, `the ${config.provider} provider could not start: ${(error as Error).message}`);
      return;
    }
    try {
      signal.throwIfAborted();
      if (room && !forgetting) {
        const canCreate = () => this.active() && !!this.ports.room(roomId)?.remembers &&
          (this.ports.outbox.hasOwnVersions(roomId) || this.runnableOps(provider.id, roomId).some(op => op.kind === "fact" || op.kind === "note"));
        const lease = await this.routing.resolve(provider, room, signal, canCreate);
        if (!lease) return;
        room = { ...room, ...lease.room };
      }
      let worked = await this.drainOps(provider, roomId, signal, room ?? undefined);
      signal.throwIfAborted();
      const reads = await this.delivery.drain(provider, roomId, signal);
      if (provider.writes) this.warnBudget(provider, roomId, signal);
      signal.throwIfAborted();
      worked += await this.drainReplacements(provider, roomId, signal);
      signal.throwIfAborted();
      const sending = () => this.active() && !this.paused && !this.workSignal(roomId).aborted && !this.forgettingRoom(roomId) && !!this.ports.room(roomId)?.remembers && !!room && this.routeCurrent(provider, room);
      if (sending()) worked += await this.drainStream(provider, room!, config, signal);
      signal.throwIfAborted();
      const transport = reads ?? this.delivery.transport(provider);
      let listing: Promise<SourceListing> | undefined;
      const sourceReads = transport?.sources ? { ...transport, sources: (uuid: string, abort: AbortSignal, now: () => number, graphId?: string) =>
        graphId === room?.graphId ? listing ??= transport.sources!(uuid, abort, now, graphId) : transport.sources!(uuid, abort, now, graphId) } : transport;
      if (sending()) worked += await this.drainVersionChecks(provider, room!, config, signal, sourceReads);
      if (room && this.active() && !this.paused && !this.forgettingRoom(roomId) && sourceReads?.sources) {
        const now = () => (this.ports.now ?? Date.now)(), checks = this.ports.outbox.claimBindingChecks(provider.id, roomId, now());
        try {
          if (listing || checks.length) {
            const sources = await sourceReads.sources(room!.uuid, signal, now, room!.graphId);
            signal.throwIfAborted();
            if (sources.state === "complete" && sending()) worked += await cleanVersionDuplicates({ outbox: this.ports.outbox, now,
              current: (sourceId, version) => {
                const row = sourceId ? this.ports.history.getById?.(roomId, sourceId) : null;
                return sending() && this.ports.room(roomId)?.uuid === room!.uuid && (!sourceId || !!row && sourceVersion(row) === version && !this.ports.outbox.importedSource(roomId, sourceId));
              } }, provider, room!, sources, signal, sourceReads);
            for (const id of checks) {
              this.ports.outbox.deliveries.watches.result(id, sources.state === "complete" ? "version_checked" : sources.reason, now());
              if (sources.state === "unknown" && ["index_building", "index_recent_incomplete"].includes(sources.reason)) {
                const at = transport?.nextIndexRead?.(room!.uuid, room!.graphId);
                if (at !== null && at !== undefined) this.ports.outbox.deliveries.watches.continueAt(id, at);
              }
            }
          }
        } catch (error) {
          for (const id of checks) this.ports.outbox.deliveries.watches.result(id, "version_cleanup_failed", now());
          if (!(error instanceof MemoryProviderError) || error.retryable) throw error;
        } finally {
          const next = this.ports.outbox.nextBindingCheck(provider.id, roomId);
          if (next !== null) this.rewakeAt(roomId, Math.max(1000, next - now()));
          const nextIndex = transport?.nextIndexRead?.(room!.uuid, room!.graphId);
          if (nextIndex !== null && nextIndex !== undefined) this.rewakeAt(roomId, Math.max(1000, nextIndex - now()));
        }
      }
      signal.throwIfAborted();
      if (worked) this.resume();
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof MemoryProviderError && error.retryable) { this.pause(roomId, error.message); return; }
      if (error instanceof GenerationError) { this.fail(error.message); return; }
      throw error;
    }
  }

  private runnableOps(provider: string, roomId: string, account?: string): MemoryOp[] {
    const onlyForgets = !this.active() || !!this.paused || this.workSignal(roomId).aborted || !this.ports.room(roomId) || this.ports.outbox.forgetting(provider, roomId);
    return this.ports.outbox.ops(provider, 16, { room: roomId, account, runnable: true, dueAt: (this.ports.now ?? Date.now)(),
      kinds: onlyForgets ? ["forget-room"] : ["fact", "note", "forget", "forget-room"] });
  }

  private async drainOps(provider: MemoryProvider, roomId: string, signal: AbortSignal, lease?: MemoryRoomView): Promise<number> {
    let done = 0;
    for (let round = 0; round < 64; round++) {
      signal.throwIfAborted();
      const ops = this.runnableOps(provider.id, roomId, provider.generations?.account);
      if (!ops.length) return done;
      for (let op of ops) {
        try {
          signal.throwIfAborted();
          if (lease && op.kind !== "forget-room" && !this.routeCurrent(provider, lease)) return done;
          if (op.kind === "forget-room") op = this.ports.outbox.prepareRoomForget(op);
          const waiting = await this.runOp(provider, op, signal, lease);
          signal.throwIfAborted();
          if (waiting) { this.deferOperation(op, "processing", waiting.reason); continue; }
          if (op.kind === "forget-room") {
            const current = this.ports.room(op.room);
            const clear = !current || current.uuid === op.payload.uuid;
            this.ports.outbox.completeRoomForget(op, { clear, ...(clear && current?.remembers ? { cursor: this.ports.history.maxSeq(op.room) } : {}) });
          } else if (!(provider.writes && (op.kind === "note" || op.kind === "fact" && provider.capabilities.addFact))) this.ports.outbox.opDone(op.id);
          done++;
        } catch (error) {
          if (signal.aborted) throw error;
          if (provider.writes && (op.kind === "note" || op.kind === "fact" && provider.capabilities.addFact)) {
            this.fail(`memory delivery in ${op.room} remains pending: ${this.forgetFailureReason(error)}`);
            return done;
          }
          if (op.kind === "forget") {
            if (error instanceof MemoryProviderError && error.retryable) throw error;
            this.deferOperation(op, "failed", this.forgetFailureReason(error));
            continue;
          }
          if (op.kind === "forget-room") {
            const reason = this.forgetFailureReason(error);
            const retryable = error instanceof MemoryProviderError && error.retryable;
            this.ports.outbox.failRoomForget(op, reason, retryable);
            if (retryable) throw new MemoryProviderError(`cloud deletion is pending: ${reason}`, true);
            this.fail(`cloud deletion needs another attempt: ${reason}`);
            return done;
          }
          if (error instanceof MemoryProviderError && error.retryable) throw error;
          if (op.attempts + 1 >= OP_ATTEMPT_LIMIT) {
            this.ports.outbox.opDone(op.id);
            this.fail(`memory: gave up on ${op.kind} in ${op.room} after ${OP_ATTEMPT_LIMIT} attempts: ${(error as Error).message}`);
          } else {
            this.ports.outbox.opFailed(op.id);
            this.fail(`memory: ${op.kind} in ${op.room} failed: ${(error as Error).message}`);
          }
        }
      }
    }
    return done;
  }

  private forgetFailureReason(error: unknown): string {
    let reason = error instanceof Error ? error.message : String(error);
    const config = this.ports.config();
    const secrets = [config.filter.apiKey, ...Object.entries(config.providers).flatMap(([id, settings]) =>
      (providerEntry(id)?.fields ?? []).filter(field => field.kind === "secret").map(field => settings[field.key]))];
    for (const secret of secrets) if (typeof secret === "string" && secret) reason = reason.split(secret).join("[redacted]");
    return reason.slice(0, 2000);
  }

  private deferOperation(op: MemoryOp, kind: "processing" | "failed", reason: string): void {
    const now = (this.ports.now ?? Date.now)();
    const retryAt = this.ports.outbox.deferOp(op, kind, reason, now);
    if (retryAt !== null) this.rewakeAt(op.room, retryAt - now);
  }

  private async runOp(provider: MemoryProvider, op: MemoryOp, signal: AbortSignal, lease?: MemoryRoomView): Promise<void | { reason: string }> {
    signal.throwIfAborted();
    const room = lease ?? this.routedRoom(op.room);
    if (provider.generations && (op.kind === "forget" || op.kind === "reingest" || op.account !== undefined) && op.account !== provider.generations.account)
      return { reason: op.account === undefined ? "account_ownership_unknown" : "account_changed" };
    if (op.kind === "forget" && provider.generations && (!room || room.graphId !== op.payload.graphId)) return { reason: "graph_generation_changed" };
    if ((op.kind === "note" || op.kind === "fact") && !room) return { reason: "generation_route_unavailable" };
    if (provider.writes && room && (op.kind === "note" || (op.kind === "fact" && provider.capabilities.addFact))) {
      const delivery = this.delivery.prepareOp(provider, room, op);
      this.ports.outbox.handoff(delivery.opId, undefined, op);
      await this.delivery.dispatch(provider, delivery, signal);
      this.warnBudget(provider, op.room, signal);
      return;
    }
    const view: MemoryRoom = op.kind === "forget-room" || op.kind === "forget" && typeof op.payload.uuid === "string"
      ? { uuid: String(op.payload.uuid), name: String(op.payload.name ?? room?.name ?? op.room),
        ...(typeof op.payload.graphId === "string" ? { graphId: op.payload.graphId } : {}) }
      : this.asMemoryRoom(room ?? { id: op.room, uuid: op.room, name: op.room, remembers: false });
    switch (op.kind) {
      case "forget-room": {
        if (provider.generations) throw new GenerationError("generation_retirement_protocol_unavailable");
        await provider.forgetRoom(view);
        this.delivery.transport(provider)?.dropIndex?.(view.uuid);
        return;
      }
      case "forget": {
        const sourceId = String(op.payload.sourceId);
        if (this.ports.outbox.importedSource(op.room, sourceId)) return { reason: "imported_source_read_only" };
        const reads = this.delivery.transport(provider);
        if (room?.uuid === view.uuid && this.asMemoryRoom(room).graphId === view.graphId && reads?.sources) {
          const waiting = await this.sourceVersions.cleanup(provider, room, op, reads, signal);
          if (waiting) return { reason: waiting };
        }
        const current = this.ports.history.getById?.(op.room, sourceId);
        const mapped = room?.uuid === view.uuid ? this.ports.outbox.episodeIds(provider.id, op.room, sourceId).filter(id => {
          const bindings = this.ports.outbox.episodeSources(provider.id, op.room, id);
          if (!bindings.some(b => b.sourceId === sourceId && b.source?.graphId === view.graphId)) return false;
          if (!current || !visibleToAgents(current)) return true;
          return !bindings.some(b => b.sourceId === sourceId && b.source?.version === sourceVersion(current));
        }) : [];
        const currentVersion = current && visibleToAgents(current) ? sourceVersion(current) : undefined;
        const owned = this.ports.outbox.deliveries.sourceReceipts(provider.id, op.room, view.uuid, sourceId, view.graphId, provider.generations?.account).filter(id => !currentVersion ||
          !this.ports.outbox.deliveries.receiptOfVersion(provider.id, view.uuid, sourceId, id, currentVersion, provider.generations?.account));
        const ids = [...new Set([...(reads?.sources ? mapped.filter(id => this.ports.outbox.deliveries.ownsReceipt(provider.id, view.uuid, sourceId, id, provider.generations?.account)) : mapped), ...owned])];
        const unseen = new Set<string>();
        if (provider.capabilities.forgetEpisode) {
          for (const externalId of ids) {
            signal.throwIfAborted();
            const ours = this.ports.outbox.deliveries.ownsReceipt(provider.id, view.uuid, sourceId, externalId, provider.generations?.account);
            const owner = this.ports.outbox.deliveries.receiptDelivery(provider.id, view.uuid, sourceId, externalId, provider.generations?.account);
            const proof = reads?.sources && owner ? await this.sourceVersions.removalGuard(owner, externalId, reads, signal) : () => true;
            if (!proof) return { reason: "source_version_unproven" };
            const stillOld = () => {
              const live = this.ports.history.getById?.(op.room, sourceId);
              return proof() && !this.ports.outbox.importedSource(op.room, sourceId) && !signal.aborted && this.active() && this.ports.config().provider === provider.id && this.ports.room(op.room)?.uuid === view.uuid &&
                (!lease || this.routeCurrent(provider, lease)) &&
                (!live || !visibleToAgents(live) || !this.ports.outbox.deliveries.receiptOfVersion(provider.id, view.uuid, sourceId, externalId, sourceVersion(live), provider.generations?.account));
            };
            const result = await eraseEpisode(this.ports.outbox, provider, view, externalId, signal, stillOld, ours);
            if (result === "changed") return { reason: "source_changed_during_check" };
            if (result === "pending") return { reason: "episode_not_processed" };
            if (result === "unconfirmed") return { reason: "episode_deletion_unconfirmed" };
            if (result === "unseen") unseen.add(externalId);
          }
        }
        signal.throwIfAborted();
        if (lease && !this.routeCurrent(provider, lease)) return { reason: "graph_generation_changed" };
        this.ports.outbox.dropEpisodeIds(provider.id, op.room, sourceId, ids, provider.generations?.account);
        this.ports.outbox.deliveries.sourceDeleted(provider.id, op.room, view.uuid, sourceId, undefined, unseen, view.graphId, provider.generations?.account);
        this.ports.outbox.sourceCleanupFinished(op.room, sourceId);
        return;
      }
      case "fact": {
        if (!provider.capabilities.addFact) return;
        this.ensureBudget(provider);
        await provider.ensureRoom(view);
        signal.throwIfAborted();
        const { credits } = await provider.addFact(view, { subject: String(op.payload.subject), predicate: String(op.payload.predicate), object: String(op.payload.object), ts: Number(op.payload.ts) || Date.now() });
        this.recordSpend(provider, credits, op.room, signal);
        return;
      }
      case "note": {
        this.ensureBudget(provider);
        await provider.ensureRoom(view);
        signal.throwIfAborted();
        const { externalId, credits } = await provider.addEpisode(view, {
          sourceId: `note-${op.id}`,
          authorId: String(op.payload.authorId),
          authorName: String(op.payload.authorName),
          text: String(op.payload.text),
          ts: Number(op.payload.ts) || Date.now(),
        });
        this.recordSpend(provider, credits, op.room, signal);
        signal.throwIfAborted();
        if (externalId) this.ports.outbox.mapEpisode(provider.id, op.room, `note-${op.id}`, externalId, {
          kind: "note", authorId: String(op.payload.authorId), authorName: String(op.payload.authorName), ts: Number(op.payload.ts) || op.createdAt,
        });
        return;
      }
    }
  }

  private async drainReplacements(provider: MemoryProvider, roomId: string, signal: AbortSignal): Promise<number> {
    const room = this.routedRoom(roomId);
    if (!room?.remembers || !this.active() || this.paused || this.forgettingRoom(roomId)) return 0;
    let done = 0;
    for (const op of this.ports.outbox.replacements(provider.id, roomId, 64, provider.generations?.account)) {
      signal.throwIfAborted();
      const now = (this.ports.now ?? Date.now)(), sourceId = String(op.payload.sourceId);
      if (this.ports.outbox.importedSource(roomId, sourceId)) continue;
      if (typeof op.payload.uuid === "string" && op.payload.uuid !== room.uuid) { this.ports.outbox.opDone(op.id); continue; }
      if (op.payload.graphId !== room.graphId || provider.generations && op.account !== provider.generations.account) continue;
      if (op.deferKind === "expired") continue;
      if (op.retryAt > now) { this.rewakeAt(roomId, op.retryAt - now); continue; }
      const live = this.ports.history.getById?.(roomId, sourceId), reads = this.delivery.transport(provider);
      if (live && visibleToAgents(live) && reads?.sources && !await this.sourceVersions.ready(provider.id, room, sourceId, reads, signal)) continue;
      if (this.replacementBlocker(provider, room, sourceId)) continue;
      try {
        done += await this.sendReplacement(provider, room, sourceId, signal);
        this.ports.outbox.opDone(op.id);
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof MemoryProviderError && error.retryable) throw error;
        const reason = this.forgetFailureReason(error), retryAt = this.ports.outbox.deferOp(op, "failed", reason, now);
        if (retryAt !== null) this.rewakeAt(roomId, retryAt - now);
        this.fail(`memory: the new version of an edited message in ${roomId} is not sent yet: ${reason}`);
      }
    }
    return done;
  }

  private replacementBlocker(provider: MemoryProvider, room: MemoryRoomView, sourceId: string): ReplacementBlocker | null {
    const current = this.ports.history.getById?.(room.id, sourceId);
    return provider.capabilities.forgetEpisode ? this.ports.outbox.replacementBlocker(provider.id, room.id, room.uuid, sourceId, current ? sourceVersion(current) : undefined, room.graphId, room.account) : null;
  }

  private async sendReplacement(provider: MemoryProvider, room: MemoryRoomView, sourceId: string, signal: AbortSignal): Promise<number> {
    const row = this.ports.history.getById?.(room.id, sourceId);
    if (!row || row.streaming || !visibleToAgents(row)) return 0;
    if (row.seq > this.ports.outbox.cursor(provider.id, room.id)) return 0;
    await this.sendMessages(provider, room, this.ports.config(), [row], false, signal);
    return 1;
  }

  private async drainStream(provider: MemoryProvider, room: MemoryRoomView, config: MemoryConfig, signal: AbortSignal): Promise<number> {
    let processed = 0;
    for (let page = 0; page < 40; page++) {
      signal.throwIfAborted();
      if (!this.routeCurrent(provider, room)) return processed;
      const cursor = this.ports.outbox.cursor(provider.id, room.id);
      let rows = this.ports.history.chatAfter(room.id, cursor, DRAIN_PAGE);
      const streamingAt = rows.findIndex(m => m.streaming);
      if (streamingAt >= 0) rows = rows.slice(0, streamingAt);
      const window = provider.capabilities.forgetEpisode ? 0 : provider.editWindowMs ?? 600_000;
      if (window) {
        const now = (this.ports.now ?? Date.now)();
        const restingAt = rows.findIndex(m => m.ts > now - window);
        if (restingAt >= 0) {
          const resting = rows[restingAt];
          rows = rows.slice(0, restingAt);
          this.rewakeAt(room.id, resting.ts + window - now);
        }
      }
      if (!rows.length) return processed;
      await this.sendMessages(provider, room, config, rows, true, signal);
      if (this.ports.outbox.cursor(provider.id, room.id) <= cursor) return processed;
      processed += rows.length;
    }
    signal.throwIfAborted();
    this.wake(room.id);
    return processed;
  }

  private async drainVersionChecks(provider: MemoryProvider, room: MemoryRoomView, config: MemoryConfig, signal: AbortSignal, reads?: WriteTransport): Promise<number> {
    const now = () => (this.ports.now ?? Date.now)();
    const checks = this.ports.outbox.versionChecks(room.id, VERSION_CHECK_PAGE, now());
    if (!checks.length) {
      const next = this.ports.outbox.nextVersionCheck(room.id);
      if (next !== null) this.rewakeAt(room.id, Math.max(1000, next - now()));
      return 0;
    }
    const transport = reads ?? this.delivery.transport(provider);
    const bornAt = this.cursorBirth(provider.id, room.id, now()), cursor = this.ports.outbox.cursor(provider.id, room.id);
    let listing: SourceListing | null = null, decided = 0;
    for (const check of checks) {
      signal.throwIfAborted();
      let row = this.ports.history.getById?.(room.id, check.sourceId) ?? null;
      let version = row ? sourceVersion(row) : "";
      const writeAllowed = () => !!row && !this.ports.outbox.importedSource(room.id, row.id) && this.ports.outbox.ownVersion(room.id, row.id, version);
      if (writeAllowed() && row && visibleToAgents(row) && transport?.sources &&
          !await this.sourceVersions.ready(provider.id, room, row.id, transport, signal)) continue;
      if (!this.ports.outbox.versionCheckCurrent(check)) continue;
      const current = () => {
        const live = this.ports.history.getById?.(room.id, check.sourceId);
        return !signal.aborted && this.active() && this.ports.config().provider === provider.id && !this.forgettingRoom(room.id) &&
          this.routeCurrent(provider, room) &&
          this.ports.room(room.id)?.uuid === room.uuid && !!this.ports.room(room.id)?.remembers && this.ports.outbox.versionCheckCurrent(check) &&
          !!live && sourceVersion(live) === version;
      };
      const facts = (): VersionFacts => ({ row, version, remembers: !!this.ports.room(room.id)?.remembers, listing, bornAt,
        own: !room.generationCheck && writeAllowed(), writeAllowed: writeAllowed(),
        canList: !!transport?.sources,
        held: !!row && (this.ports.outbox.boundVersion(provider.id, room.id, row.id, version) || (() => {
          const source = this.delivery.savedSource(provider.id, room, row);
          if (source?.kind === "part-group") return true;
          const saved = source?.delivery;
          return saved?.retiredAt === null && (!room.generationCheck || !saved.externalIds.length);
        })()),
        olderLeaving: !!row && this.replacementBlocker(provider, room, row.id) !== null,
        knows: carryHash => this.ports.history.knowsCarried?.(room.id, check.sourceId, carryHash) ?? false,
        matchesCurrent: episode => this.sourceVersions.represents(provider.id, room, check.sourceId, episode),
        inMemory: this.ports.outbox.heldSource(provider.id, room.id, check.sourceId),
        excluded: !!row && this.ports.outbox.excludedVersion(room.id, row.id, version) });
      let decision = decideVersion(facts()), freshThrottled = false;
      if (decision.kind === "wait" && decision.reason === "listing_incomplete" && !listing && transport?.sources) {
        listing = await transport.sources(room.uuid, signal, now, room.graphId);
        signal.throwIfAborted();
        if (listing.state === "complete") this.sourceVersions.readBack(room.id);
        if (!this.ports.outbox.versionCheckCurrent(check)) continue;
        row = this.ports.history.getById?.(room.id, check.sourceId) ?? null;
        version = row ? sourceVersion(row) : "";
        decision = decideVersion(facts());
      }
      if (row && listing?.state === "complete" && transport?.sourceEpisodes && decision.kind !== "own" && decision.kind !== "drop") {
        const fresh = await transport.sourceEpisodes(room.uuid, row.id, signal, room.graphId);
        signal.throwIfAborted();
        if (!this.ports.outbox.versionCheckCurrent(check)) continue;
        row = this.ports.history.getById?.(room.id, check.sourceId) ?? null;
        version = row ? sourceVersion(row) : "";
        if (fresh.state !== "complete") { decision = { kind: "wait", reason: "listing_incomplete" }; freshThrottled = throttledIndexRead(fresh.reason); }
        else {
          listing = { ...listing, bySource: new Map(listing.bySource).set(check.sourceId, fresh.episodes) };
          decision = decideVersion(facts());
        }
      }
      if (decision.kind === "bind") {
        if (this.ports.outbox.deliveries.groupedSource(provider.id, room.id, check.sourceId, version, room.graphId))
          decision = { kind: "hold", versions: [version] };
      }
      if (decision.kind === "bind") {
        for (const episode of decision.episodes) {
          const presence = await transport?.episodePresence?.(episode.id, signal);
          signal.throwIfAborted();
          if (presence !== "present") { decision = { kind: "wait", reason: "not_processed_yet" }; break; }
        }
      }
      if (row && !current()) continue;
      switch (decision.kind) {
        case "drop": this.ports.outbox.versionChecked(room.id, check.sourceId, check.revision); break;
        case "own":
          this.ports.outbox.versionChecked(room.id, check.sourceId, check.revision);
          if (row!.seq <= cursor) this.ports.outbox.localVersion(room.id, row!.id, version, now());
          break;
        case "wait":
          {
            if (decision.reason === "listing_incomplete" && (freshThrottled || listing?.state === "unknown" && throttledIndexRead(listing.reason))) {
              const at = Math.max(now() + 1000, transport?.nextIndexRead?.(room.uuid, room.graphId) ?? now() + THROTTLE_WAIT_MS.first);
              this.ports.outbox.deferVersionCheck(room.id, check.sourceId, "index_read_failed_429", now(), at, check.revision);
              this.rewakeAt(room.id, at - now());
              this.sourceVersions.throttled(room.id);
              break;
            }
            const nextIndex = decision.reason === "listing_incomplete" ? transport?.nextIndexRead?.(room.uuid, room.graphId) : null;
            const delay = nextIndex === null || nextIndex === undefined ? VERSION_WAIT_MS[decision.reason]
              : Math.max(1000, Math.min(VERSION_WAIT_MS[decision.reason], nextIndex - now()));
            if (decision.reason === "listing_incomplete") this.sourceVersions.incompleteRead(room.id, check.sourceId, decision.reason, now() + delay, check.revision);
            else { this.ports.outbox.deferVersionCheck(room.id, check.sourceId, decision.reason, now(), now() + delay, check.revision); this.rewakeAt(room.id, delay); }
          }
          break;
        case "hold": this.ports.outbox.holdVersionCheck(room.id, check.sourceId, "unknown_version", now(), check.revision); break;
        case "bind":
          this.ports.outbox.bindVersion(provider.id, check, { ...messageSource(row!), ...(room.graphId === undefined ? {} : { graphId: room.graphId }) }, decision.episodes, now());
          break;
        case "skip": this.ports.outbox.skipVersionCheck(provider.id, room.id, check.sourceId, decision.reason, now()); break;
        case "send":
          await this.sendMessages(provider, room, config, [row!], false, signal, true);
          this.ports.outbox.versionChecked(room.id, check.sourceId, check.revision);
          break;
      }
      decided++;
    }
    const next = this.ports.outbox.nextVersionCheck(room.id);
    if (next !== null) this.rewakeAt(room.id, Math.max(1000, next - now()));
    return decided;
  }

  private cursorBirth(provider: string, roomId: string, now: number): number {
    const born = this.ports.outbox.cursorBirth(provider, roomId);
    if (born !== null) return born;
    const earliest = this.ports.folderId ? this.ports.history.earliestRemembered?.(roomId, provider, this.ports.folderId) ?? null : null;
    return this.ports.outbox.recordCursorBirth(provider, roomId, earliest ?? now);
  }

  private rewakeAt(roomId: string, inMs: number): void {
    if (this.stopped) return;
    const delay = Math.max(50, inMs), dueAt = (this.ports.now ?? Date.now)() + delay;
    const prior = this.rewakes.get(roomId);
    if (prior && prior.dueAt <= dueAt) return;
    if (prior) clearTimeout(prior.timer);
    const timer = setTimeout(() => { this.rewakes.delete(roomId); this.wake(roomId); }, delay);
    timer.unref?.();
    this.rewakes.set(roomId, { timer, dueAt });
  }

  private async sendMessages(provider: MemoryProvider, room: MemoryRoomView, config: MemoryConfig, rows: StoredMessage[], advance: boolean, signal: AbortSignal, carried = false): Promise<void> {
    signal.throwIfAborted();
    if (!this.routeCurrent(provider, room)) return;
    if (room.originalInput && advance && !carried) return this.sendOriginalMessages(provider, room, config, rows, signal);
    const trace = this.ports.debugEnabled?.() ? this.ports.debug?.begin(room.id, provider.id, rows.map(m => ({ id: m.id, seq: m.seq, role: "message", fingerprint: sourceVersion(m) })), () => this.ports.debugEnabled?.() === true) : undefined;
    try {
      const foreign = new Set(advance ? rows.filter(m => visibleToAgents(m) && (room.generationCheck || !this.ports.outbox.ownVersion(room.id, m.id, sourceVersion(m)))).map(m => m.id) : []);
      const eligible = rows.filter(m => !foreign.has(m.id) && visibleToAgents(m) && screen(m.text) === "pass");
      trace?.event({ kind: "batch.input", data: { mode: config.filter.mode, messages: eligible.map(m => ({ id: m.id, seq: m.seq, authorId: m.from, authorName: m.fromName, ts: m.ts, edited: m.edited ?? null, text: memoryText(m) })) } });
      for (const row of rows) {
        if (foreign.has(row.id)) trace?.event({ kind: "version.check", sourceId: row.id, data: { reason: "Written by another copy: checked against the graph before anything is sent" } });
        else if (!eligible.includes(row)) trace?.event({ kind: "screen.dropped", sourceId: row.id, data: { reason: visibleToAgents(row) ? "Empty text or protocol marker" : "Not visible to agents" } });
      }
      const renew = !advance;
      const lookupHeld = new Set<string>();
      const saved = new Map(provider.writes ? eligible.flatMap(row => {
        try {
          const delivery = this.delivery.savedSource(provider.id, room, row, renew);
          return delivery ? [[row.id, delivery] as const] : [];
        } catch {
          lookupHeld.add(row.id);
          this.ports.outbox.holdSourceVersion(room.id, row.id, "group_source_lookup_unproven", (this.ports.now ?? Date.now)());
          return [];
        }
      }) : []);
      if (advance) {
        const heldAt = rows.findIndex(row => {
          const source = saved.get(row.id);
          return lookupHeld.has(row.id) || source?.kind === "part-group" && source.group.retired;
        });
        if (heldAt >= 0) rows = rows.slice(0, heldAt + 1);
      }
      const verdicts = await this.judge(room, config, eligible.filter(row => rows.includes(row) && !saved.has(row.id) && !lookupHeld.has(row.id)), signal, trace);
      signal.throwIfAborted();
      if (!this.routeCurrent(provider, room)) return;
      for (const verdict of verdicts) trace?.event({ kind: "filter.verdict", sourceId: verdict.sourceId, data: verdict });
      const keep = new Map(verdicts.map(v => [v.sourceId, v]));
      for (const row of rows) {
        signal.throwIfAborted();
        if (!this.routeCurrent(provider, room)) return;
        if (lookupHeld.has(row.id)) { if (advance) return; continue; }
        if (this.ports.outbox.importedSource(room.id, row.id)) {
          if (advance) this.ports.outbox.divertToVersionCheck(provider.id, room.id, row.id, row.seq, (this.ports.now ?? Date.now)());
          continue;
        }
        if (foreign.has(row.id)) { this.ports.outbox.divertToVersionCheck(provider.id, room.id, row.id, row.seq, (this.ports.now ?? Date.now)()); continue; }
        const verdict = keep.get(row.id);
        if (verdict?.excerpts?.kind === "whole" && !saved.has(row.id)) {
          if (advance && !carried && this.wholePathAvailable(provider, room)) {
            trace?.event({ kind: "excerpts.whole", sourceId: row.id, data: { reason: verdict.excerpts.reason, path: "whole-message" } });
            await this.sendOriginalMessages(provider, room, config, [row], signal, { decided: new Set([row.id]) });
            continue;
          }
          if ([...memoryText(row)].length > ZEP_EPISODE_MAX_CHARS) {
            trace?.event({ kind: "excerpts.whole", sourceId: row.id, data: { reason: verdict.excerpts.reason, path: "held", why: "original_whole_exceeds_one_episode" } });
            this.ports.outbox.holdSourceVersion(room.id, row.id, "original_whole_exceeds_one_episode", (this.ports.now ?? Date.now)());
            if (advance) return;
            continue;
          }
          trace?.event({ kind: "excerpts.whole", sourceId: row.id, data: { reason: verdict.excerpts.reason, path: "one-episode" } });
        }
        if (provider.writes && (saved.has(row.id) || verdict?.keep)) {
          const current = this.ports.history.getById?.(room.id, row.id);
          if (!current || sourceVersion(current) !== sourceVersion(row) || !visibleToAgents(current)) continue;
          const source = saved.get(row.id);
          if (source?.kind === "part-group") {
            if (source.group.retired) {
              this.ports.outbox.holdSourceVersion(room.id, row.id, "group_renewal_pending", (this.ports.now ?? Date.now)());
              if (advance) return;
              continue;
            }
            this.ports.outbox.handoffPartGroup(source.group.groupId, advance ? row.seq : undefined);
            for (const member of source.group.members) {
              signal.throwIfAborted();
              if (!this.routeCurrent(provider, room) || this.ports.outbox.importedSource(room.id, row.id)) break;
              await this.delivery.dispatch(provider, member, signal, false, trace?.event);
            }
            this.warnBudget(provider, room.id, signal);
            continue;
          }
          const delivery = source?.delivery ?? this.delivery.prepareMessage(provider, room, row, {
            sourceId: row.id, seq: row.seq, authorId: row.from, authorName: row.fromName,
            text: this.episodeText(row, verdict), ts: row.ts,
          }, { renew, carried });
          if (delivery.payload) {
            this.ports.outbox.handoff(delivery.opId, advance ? row.seq : undefined);
            await this.delivery.dispatch(provider, delivery, signal, false, trace?.event);
            this.warnBudget(provider, room.id, signal);
          } else if (advance) this.ports.outbox.advance(provider.id, room.id, row.seq);
          continue;
        }
        if (verdict?.keep) {
          this.ensureBudget(provider);
          const current = () => {
            const live = this.ports.history.getById?.(room.id, row.id);
            return !signal.aborted && this.active() && !this.paused && !!this.ports.room(room.id)?.remembers &&
              this.routeCurrent(provider, room) && !this.ports.outbox.importedSource(room.id, row.id) &&
              !!live && !live.streaming && visibleToAgents(live) && sourceVersion(live) === sourceVersion(row);
          };
          const beforeWrite = () => { signal.throwIfAborted(); if (!current()) throw new MemoryWriteCancelled(); };
          const episode: MemoryEpisode = {
            sourceId: row.id,
            seq: row.seq,
            authorId: row.from,
            authorName: row.fromName,
            text: this.episodeText(row, verdict),
            ts: row.ts,
          };
          let accepted = false;
          try {
            beforeWrite();
            await provider.ensureRoom(this.asMemoryRoom(room), beforeWrite);
            beforeWrite();
            trace?.event({ kind: "provider.episode", sourceId: row.id, data: episode });
            const source = messageSource(row);
            const { externalId, credits } = await provider.addEpisode(this.asMemoryRoom(room), episode, trace?.event, beforeWrite);
            accepted = true;
            trace?.event({ kind: "provider.accepted", sourceId: row.id, data: { externalId, creditsEstimate: credits, processing: "Not observed; acceptance is not completed graph extraction." } });
            this.recordSpend(provider, credits, room.id, signal);
            signal.throwIfAborted();
            if (externalId) this.ports.outbox.mapEpisode(provider.id, room.id, row.id, externalId, source);
          } catch (error) {
            if (signal.aborted) throw error;
            if (error instanceof MemoryWriteCancelled) {
              if (advance && this.ports.outbox.importedSource(room.id, row.id))
                this.ports.outbox.divertToVersionCheck(provider.id, room.id, row.id, row.seq, (this.ports.now ?? Date.now)());
              continue;
            }
            trace?.event({ kind: accepted ? "provider.bookkeeping-failed" : "provider.failed", sourceId: row.id, data: { retryable: error instanceof MemoryProviderError && error.retryable, outcome: accepted ? "The provider accepted the episode, but local bookkeeping failed." : "No acceptance receipt recorded; the request may have reached the provider." } });
            if (error instanceof MemoryProviderError && error.retryable) throw error;
            this.fail(`memory: message ${row.seq} of ${room.name} was refused and skipped: ${(error as Error).message}`);
          }
        }
        if (advance) this.ports.outbox.advance(provider.id, room.id, row.seq);
      }
      trace?.event({ kind: "batch.finished", data: { status: "finished" } });
    } catch (error) {
      trace?.event({ kind: "batch.failed", data: { status: "failed", retryable: error instanceof MemoryProviderError && error.retryable } });
      throw error;
    }
  }

  private async sendOriginalMessages(provider: MemoryProvider, room: MemoryRoomView, config: MemoryConfig,
    inputRows: StoredMessage[], signal: AbortSignal, options: { decided?: ReadonlySet<string> } = {}): Promise<void> {
    const outbox = this.ports.outbox, writes = provider.writes, account = provider.generations?.account;
    if (!writes?.originalMessage || provider.id !== "zep" || !account || room.account !== account || !room.generationRevision)
      throw new MemoryProviderError("Original message input needs a current account, route and group adapter", true);
    const configPin = JSON.stringify(config), rows = inputRows.map(row => structuredClone(row));
    const trace = this.ports.debugEnabled?.() ? this.ports.debug?.begin(room.id, provider.id,
      rows.map(row => ({ id: row.id, seq: row.seq, role: "message", fingerprint: sourceVersion(row) })),
      () => this.ports.debugEnabled?.() === true) : undefined;
    const copyId = outbox.deliveries.copy(provider.id, room.id, room.uuid);
    const scope = (row: StoredMessage): PartGroupScope => ({ provider: provider.id, roomId: room.id,
      roomUuid: room.uuid, copyId, account, sourceId: row.id, version: sourceVersion(row), kind: "episode",
      ...(room.graphId === undefined ? {} : { graphId: room.graphId }) });
    const current = (row: StoredMessage, requireVisible = true, requireLocal = true) => {
      const liveRoom = this.ports.room(room.id), live = this.ports.history.getById?.(room.id, row.id);
      return !signal.aborted && this.active() && !this.paused && JSON.stringify(this.ports.config()) === configPin &&
        !!liveRoom?.remembers && (liveRoom.originalInput === true || options.decided?.has(row.id) === true && liveRoom.input !== "whole") && provider.writes === writes &&
        provider.generations?.account === account && this.routeCurrent(provider, room) &&
        (!requireLocal || !room.generationCheck && !outbox.importedSource(room.id, row.id) && outbox.ownVersion(room.id, row.id, sourceVersion(row))) &&
        outbox.deliveries.currentCopy(scope(row)) && outbox.deliveries.copyAccount(scope(row)) === account &&
        !!live && live.kind === "chat" && !live.streaming && (!requireVisible || visibleToAgents(live)) && live.seq === row.seq &&
        sourceVersion(live) === sourceVersion(row) && originalProductFingerprint(live) === originalProductFingerprint(row);
    };
    const saved = new Map<string, NonNullable<ReturnType<MemoryDeliveryPipeline["savedSource"]>>>();
    const receipts = new Set<string>(), held = new Set<string>();
    const eligible: StoredMessage[] = [];
    try {
      for (const row of rows) {
        if (row.kind !== "chat" || row.streaming || !visibleToAgents(row)) continue;
        if (room.generationCheck || outbox.importedSource(room.id, row.id) || !outbox.ownVersion(room.id, row.id, sourceVersion(row))) continue;
        try {
          const { kind: _kind, ...receiptScope } = scope(row);
          const receipt = outbox.originals.lookup({ ...receiptScope, provider: "zep", account, generationRevision: room.generationRevision });
          if (receipt.kind === "hold") { held.add(row.id); break; }
          const source = this.delivery.savedSource(provider.id, room, row);
          if (source && receipt.kind === "represented") { held.add(row.id); break; }
          if (source) {
            if (source.kind === "part-group" ? source.group.retired : source.delivery.retiredAt !== null) { held.add(row.id); break; }
            if (source.kind === "part-group" && source.group.descriptor.representationFingerprint !==
              originalProductFingerprint(row, source.group.descriptor.representation)) { held.add(row.id); break; }
            saved.set(row.id, source);
          } else if (receipt.kind === "represented") {
            if (receipt.receipt.bodyHash !== originalProductFingerprint(row, receipt.receipt.representation)) { held.add(row.id); break; }
            receipts.add(row.id);
          } else if (screen(originalProductText(row)) === "pass") eligible.push(row);
        } catch { held.add(row.id); break; }
      }
      const heldIndex = rows.findIndex(row => held.has(row.id));
      if (heldIndex >= 0) rows.splice(heldIndex + 1);
      const contextPins = new Map<string, { version: string; representation: string }>();
      const decisions: SelectionVerdict[] = [];
      for (const row of eligible) if (options.decided?.has(row.id)) decisions.push({ sourceId: row.id, keep: true });
      const undecided = eligible.filter(row => !options.decided?.has(row.id));
      if (config.filter.mode !== "llm") {
        for (const row of undecided) decisions.push({ sourceId: row.id, keep: config.filter.mode === "off" || row.from === "human" });
      } else {
        for (let start = 0; start < undecided.length; start += FILTER_BATCH) {
          const batch = undecided.slice(start, start + FILTER_BATCH);
          if (!batch.every(row => current(row))) return;
          const contextRows = this.ports.history.chatAfter(room.id, Math.max(0, batch[0].seq - CONTEXT_ROWS - 1), CONTEXT_ROWS)
            .filter(row => row.seq < batch[0].seq && visibleToAgents(row));
          for (const row of contextRows) contextPins.set(row.id, { version: sourceVersion(row), representation: originalProductFingerprint(row) });
          trace?.link(contextRows.map(row => ({ id: row.id, seq: row.seq, role: "context", fingerprint: sourceVersion(row) })));
          const context = contextRows.map(row => `${row.fromName}: ${[...originalProductText(row)].slice(0, CONTEXT_ROW_CHARS).join("")}`).join("\n");
          const items = batch.map(row => ({ sourceId: row.id, authorName: row.fromName,
            authorKind: row.from === "human" ? "human" as const : "agent" as const, text: originalProductText(row), ts: row.ts }));
          decisions.push(...await (this.ports.selectMessages ?? selectMessages)(this.filterEndpoint(config), items, context, trace?.event));
        }
      }
      const contextCurrent = () => [...contextPins].every(([id, pin]) => {
        const live = this.ports.history.getById?.(room.id, id);
        return !!live && visibleToAgents(live) && !live.streaming && sourceVersion(live) === pin.version &&
          originalProductFingerprint(live) === pin.representation;
      });
      const selectedIds = new Set<string>(), expectedIds = new Set(eligible.map(row => row.id));
      if (decisions.length !== eligible.length || decisions.some(decision => {
        if (!decision || typeof decision.keep !== "boolean" || !expectedIds.has(decision.sourceId) || selectedIds.has(decision.sourceId) ||
          Object.keys(decision).some(key => key !== "sourceId" && key !== "keep")) return true;
        selectedIds.add(decision.sourceId); return false;
      })) throw new MemoryProviderError("Original message selector returned invalid decisions", true);
      const keep = new Map(decisions.map(decision => [decision.sourceId, decision.keep]));
      for (const row of rows) {
        signal.throwIfAborted();
        if (!current(row, false, false) || !contextCurrent()) return;
        if (!visibleToAgents(row)) {
          if (!current(row, false, false) || !contextCurrent()) return;
          outbox.advance(provider.id, room.id, row.seq); continue;
        }
        if (room.generationCheck || outbox.importedSource(room.id, row.id) || !outbox.ownVersion(room.id, row.id, sourceVersion(row))) {
          outbox.divertToVersionCheck(provider.id, room.id, row.id, row.seq, (this.ports.now ?? Date.now)()); continue;
        }
        if (held.has(row.id)) { outbox.holdSourceVersion(room.id, row.id, "original_source_lookup_held", (this.ports.now ?? Date.now)()); return; }
        if (!current(row) || !contextCurrent()) return;
        let source = saved.get(row.id);
        if (!source && !receipts.has(row.id) && keep.get(row.id) === true) {
          const prepared = this.delivery.prepareOriginalMessageGroup(provider, { scope: scope(row),
            room: this.asMemoryRoom(room), source: row, input: { representation: ORIGINAL_PRODUCT_PROFILE.representation, text: originalProductText(row) },
            profile: ORIGINAL_PRODUCT_PROFILE }, () => current(row) && contextCurrent());
          if (prepared.kind === "hold") { outbox.holdSourceVersion(room.id, row.id, prepared.reason, (this.ports.now ?? Date.now)()); return; }
          source = prepared.kind === "saved" ? prepared.source : { kind: "part-group", group: prepared.group };
        }
        if (!current(row) || !contextCurrent()) return;
        if (source?.kind === "part-group") {
          outbox.handoffPartGroup(source.group.groupId, row.seq);
          for (const member of source.group.members) {
            if (!current(row) || !contextCurrent()) return;
            await this.delivery.dispatch(provider, member, signal, false, trace?.event);
          }
          this.warnBudget(provider, room.id, signal);
        } else if (source?.kind === "legacy-single") {
          outbox.handoff(source.delivery.opId, row.seq);
          await this.delivery.dispatch(provider, source.delivery, signal, false, trace?.event);
          this.warnBudget(provider, room.id, signal);
        } else outbox.advance(provider.id, room.id, row.seq);
      }
      trace?.event({ kind: "batch.finished", data: { status: "finished", representation: ORIGINAL_PRODUCT_PROFILE.representation, policyId: ORIGINAL_PRODUCT_PROFILE.policyId } });
    } catch (error) {
      trace?.event({ kind: "batch.failed", data: { status: "failed" } });
      if (signal.aborted || error instanceof MemoryProviderError) throw error;
      throw new MemoryProviderError(`Original message input held: ${(error as Error).message}`, true, { cause: error });
    }
  }

  private episodeText(row: StoredMessage, verdict: FilterVerdict | undefined): string {
    return verdict?.episode ?? memoryText(row);
  }

  private wholePathAvailable(provider: MemoryProvider, room: MemoryRoomView): boolean {
    const account = provider.generations?.account;
    return !!provider.writes?.originalMessage && provider.id === "zep" && !!account && room.account === account && !!room.generationRevision;
  }

  private async judge(room: MemoryRoomView, config: MemoryConfig, rows: StoredMessage[], signal: AbortSignal, trace?: IngestionTrace): Promise<FilterVerdict[]> {
    signal.throwIfAborted();
    if (!rows.length) return [];
    if (config.filter.mode !== "llm") return judgeWithoutModel(rows.map(sieveItem), config.filter.mode);
    const endpoint = this.filterEndpoint(config);
    const verdicts: FilterVerdict[] = [];
    for (let start = 0; start < rows.length; start += FILTER_BATCH) {
      signal.throwIfAborted();
      const slice = rows.slice(start, start + FILTER_BATCH);
      const first = slice[0];
      const contextRows = this.ports.history.chatAfter(room.id, Math.max(0, first.seq - CONTEXT_ROWS - 1), CONTEXT_ROWS)
        .filter(m => m.seq < first.seq && visibleToAgents(m));
      trace?.link(contextRows.map(m => ({ id: m.id, seq: m.seq, role: "context", fingerprint: sourceVersion(m) })));
      const context = contextRows
        .map(m => `${m.fromName}: ${[...memoryText(m)].slice(0, CONTEXT_ROW_CHARS).join("")}`)
        .join("\n");
      const items = slice.map(sieveItem);
      try {
        verdicts.push(...await (this.ports.judge ?? judgeBatch)(endpoint, items, context, trace?.event));
      } catch (error) {
        throw new MemoryProviderError(`the memory filter is unavailable: ${describeNetworkError(error)}`, true, { cause: error });
      }
    }
    return verdicts;
  }

  private filterEndpoint(config: MemoryConfig): FilterEndpoint {
    const { baseUrl, apiKey, model } = config.filter;
    if (!baseUrl || !model) throw new MemoryProviderError("the memory filter needs an endpoint and a model in Settings", true);
    return { baseUrl, apiKey, model };
  }


  private async provider(): Promise<MemoryProvider> {
    const config = this.ports.config();
    const key = JSON.stringify([config.provider, this.section(config)]);
    if (this.providerInstance?.key === key) return this.providerInstance.provider;
    if (this.providerLoading?.key === key) return this.providerLoading.promise;
    const promise = (async () => {
      const provider = await this.ports.provider(config);
      if (this.stopped || key !== this.providerKey()) throw new GenerationError("provider_configuration_changed", true);
      this.providerInstance = { key, provider, revision: randomUUID() };
      return provider;
    })();
    this.providerLoading = { key, promise };
    try { return await promise; }
    finally { if (this.providerLoading?.promise === promise) this.providerLoading = null; }
  }

  private pause(roomId: string, reason: string): void {
    const now = (this.ports.now ?? Date.now)();
    if (this.resumedAt !== null && this.lastPausedAt !== null && this.resumedAt >= this.lastPausedAt
      && now - this.resumedAt >= MEMORY_THROTTLE_NOTICE_QUIET_MS) this.pausedNoted.clear();
    this.lastPausedAt = now;
    if (!this.paused) {
      this.paused = { reason, since: now };
      this.ports.log.warn(`memory: paused: ${reason}`);
    }
    if (this.retryStep >= NOTE_AFTER_FAILURES && !this.pausedNoted.has(roomId)) {
      this.pausedNoted.add(roomId);
      this.ports.note(roomId, `Long-term memory is paused: ${reason}. Nothing is lost; the queue waits.`);
    }
    if (this.retryTimer || this.stopped) return;
    const delay = (this.ports.retryLadderMs ?? RETRY_LADDER_MS)[Math.min(this.retryStep, (this.ports.retryLadderMs ?? RETRY_LADDER_MS).length - 1)];
    this.retryStep++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.paused = null;
      for (const room of this.ports.rooms()) if (room.remembers) this.wake(room.id);
      for (const roomId of this.ports.outbox.roomsWithOps(this.ports.config().provider)) this.wake(roomId);
    }, delay);
    this.retryTimer.unref?.();
  }

  private resume(): void {
    if (this.retryStep === 0 && !this.paused) return;
    this.paused = null;
    this.retryStep = 0;
    this.lastError = null;
    this.ports.log.info("memory: resumed; the queue is draining");
    this.resumedAt = (this.ports.now ?? Date.now)();
  }

  private fail(message: string): void {
    this.lastError = message;
    this.ports.log.error(message);
  }


  private applyBrief(roomId: string, providerId: string, seq: number, facts: Recalled[], asked: AskedQuestions): number {
    if (!this.ports.room(roomId)?.remembers) return 0;
    const current = this.currentFacts(roomId, facts, this.blockReadsOthers(this.ports.room(roomId)!));
    const { lines, told, omitted } = factLines(current, this.ports.config().blockChars);
    if (omitted) this.ports.log.info(`memory: the brief for message ${seq} left out ${omitted} of ${current.length} found for the block's budget`);
    this.ports.outbox.saveBrief(providerId, roomId, seq, lines, asked, BRIEFS_KEPT, told);
    return lines.length;
  }

  private asMemoryRoom(room: MemoryRoomView): MemoryRoom {
    return { uuid: room.uuid, name: room.name, ...(room.graphId === undefined ? {} : { graphId: room.graphId }) };
  }


  private async searchGraphs(provider: MemoryProvider, room: MemoryRoomView, questions: string[], options: { candidates: number; across: boolean; unread?: string[]; floor?: number; signal?: AbortSignal; observe?: (timing: SearchTiming) => void }): Promise<Recalled[]> {
    const signal = this.workSignal(room.id);
    if (signal.aborted || this.forgettingRoom(room.id)) return [];
    const { candidates, across, unread, floor = this.floor() } = options;
    const others = across
      ? (this.ports.searchPool?.(room.id) ?? []).filter(r => r.id !== room.id && r.remembers && !this.workSignal(r.id).aborted && !this.forgettingRoom(r.id))
      : [];
    const each = questions.length > 1 ? Math.max(QUESTION_CANDIDATES, Math.ceil(candidates / questions.length)) : candidates;
    const blockAuto = Math.ceil((AUTO_BLOCK_CHARS * this.ports.config().blockChars) / BLOCK_CHARS_DEFAULT);
    const maxChars = questions.length > 1 ? Math.max(AUTO_QUESTION_MIN_CHARS, Math.ceil(blockAuto / questions.length)) : blockAuto;
    const measure = this.ports.now ?? (() => performance.now());
    const ask = async (target: MemoryRoomView): Promise<Recalled[][]> => {
      const targetSignal = this.workSignal(target.id);
      if (targetSignal.aborted || this.forgettingRoom(target.id)) return [];
      const lease = await this.routing.resolve(provider, target, targetSignal);
      if (!lease) return [];
      const omitted = new Map<string, number>();
      const how: SearchOptions = { ...(options.signal ? { signal: options.signal } : {}), maxChars,
        onOmitted: (kind, count) => omitted.set(kind, (omitted.get(kind) ?? 0) + count) };
      const results = await Promise.all(questions.map(async (question, index) => {
        if (!options.observe) return provider.search(this.asMemoryRoom(lease.room), question, each, how);
        const started = measure(), activity = performance.eventLoopUtilization();
        let ok = false;
        try {
          const facts = await provider.search(this.asMemoryRoom(lease.room), question, each, how);
          ok = true;
          return facts;
        } finally {
          options.observe({ room: target.name, question: index + 1, total: questions.length, ms: Math.round(measure() - started),
            activeMs: Math.max(0, Math.round(performance.eventLoopUtilization(activity).active)), ok });
        }
      }));
      if (omitted.size) this.ports.log.info(`memory: a search of ${target.name} left out ${[...omitted].map(([kind, count]) => `${count} ${kind}`).join(", ")}`);
      if (targetSignal.aborted || this.forgettingRoom(target.id) || !lease.current()) return [];
      return results.map(answer => answer.map(item => ({
        ...item, evidence: [{ provider: provider.id, roomId: target.id, roomUuid: target.uuid,
          ...(lease.room.graphId === undefined ? {} : { graphId: lease.room.graphId }),
          ...(lease.room.generationRevision === undefined ? {} : { generationRevision: lease.room.generationRevision }),
          factIds: item.kind !== "node" && item.kind !== "episode" && item.id ? [item.id] : [],
          ...(item.kind === "node" && item.id ? { nodeIds: [item.id] } : {}),
          episodeIds: recalledEpisodeIds(item) }],
      })));
    };
    const answers = await Promise.all([
      ask(room),
      ...others.map(async target => {
        try { return (await ask(target)).map(answer => answer.map(fact => ({ ...fact, room: target.name }))); }
        catch (error) {
          if (!options.signal?.aborted) this.ports.log.warn(`memory: a search could not read the graph of ${target.name}: ${describeNetworkError(error)}`);
          unread?.push(target.name);
          return [];
        }
      }),
    ]);
    if (signal.aborted) return [];
    const own = answers[0].length;
    const scored = provider.capabilities.relevance;
    if (scored && !this.unscoredNoted && answers.some(graph => graph.some(facts => facts.some(f => typeof f.relevance !== "number")))) {
      this.unscoredNoted = true;
      this.ports.log.warn(`memory: ${provider.id} returned facts without a relevance; they rank as 0`);
    }
    return this.currentFacts(room.id, rankRecalled(answers.flat(), scored, floor, own), across);
  }

  private blockReadsOthers(room: MemoryRoomView): boolean {
    return room.readsOtherRooms === "every-turn";
  }

  private briefCandidates(): number {
    return Math.ceil((BRIEF_CANDIDATES * this.ports.config().blockChars) / BLOCK_CHARS_DEFAULT);
  }

  private floor(): number {
    if (this.ports.minRelevance !== undefined) return this.ports.minRelevance;
    const config = this.ports.config();
    const own = config.providers[config.provider]?.relevanceFloor;
    return typeof own === "number" && Number.isFinite(own) ? own : MIN_RELEVANCE;
  }
}

function describeAsked(asked: AskedQuestions): string {
  const count = asked.questions.length ? `${asked.questions.length} question${asked.questions.length === 1 ? "" : "s"}` : "no question";
  if (asked.how === "model" && asked.unanswered !== undefined) {
    return `no question: the sieve's model did not answer (${asked.unanswered}${asked.modelMs !== undefined ? `, waited ${asked.modelMs} ms` : ""}), so the block says the memory was not searched`;
  }
  if (asked.how === "model") return `${count} by the sieve's model in ${asked.modelMs ?? 0} ms`;
  if (asked.how === "split") return `${count} split from the message${asked.fallback ? ` (the model: ${asked.fallback})` : ""}`;
  return `${count}: the whole message`;
}

function describeLateCall(call: ModelCall, seq: number, roomName: string, waitedMs: number | null): string {
  const ended = call.questions
    ? `answered with ${call.questions.length} question${call.questions.length === 1 ? "" : "s"}, too late for this turn`
    : `ended without questions (${call.failure})`;
  const turn = waitedMs === null ? "the turn did not wait for it, its last call having failed" : `the turn went on without it at ${waitedMs} ms`;
  return `the sieve's model, asked about message ${seq} of ${roomName} at ${clockOf(call.startedAt, true)}, ${ended} after ${call.endedAt - call.startedAt} ms; ${turn}`;
}

function clockOf(at: number, ms = false): string {
  const when = new Date(at);
  return `${when.toTimeString().slice(0, 8)}${ms ? `.${String(when.getMilliseconds()).padStart(3, "0")}` : ""}`;
}

function asksMemory(m: StoredMessage): boolean {
  return m.from === "human" && visibleToAgents(m) && screen(m.text) === "pass" && searchText(m) !== "";
}
