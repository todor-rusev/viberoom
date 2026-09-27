// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { OP_ATTEMPT_LIMIT, type MemoryOp, type MemoryOutbox } from "./outbox.js";
import { MemoryProviderError, type MemoryEpisode, type MemoryProvider, type MemoryRoom, type RecalledFact } from "./provider.js";
import { CONDENSE_OVER_CHARS, FILTER_BATCH, condense as condenseBatch, heuristicEpisode, screen, type FilterEndpoint, type FilterItem, type FilterVerdict } from "./filter.js";
import { BLOCK_CHARS_DEFAULT, consentCurrent, type MemoryConfig } from "./config.js";
import { MIN_RELEVANCE } from "./registry.js";
import type { StoredMessage } from "../history-store.js";
import { instructionRevision } from "../instruction-delivery.js";
import { visibleToAgents } from "../quotes.js";
import { rankRecalled } from "./rank.js";
import { memoryText, searchText } from "./text.js";
import { QUESTIONS_WAIT_MS, askQuestions, splitQuestions, type AskOptions, type AskedQuestions, type ModelCall, type QuestionsHow, type writeQuestions } from "./questions.js";
import { describeNetworkError } from "../net/outbound.js";

export interface MemoryRoomView {
  id: string;
  uuid: string;
  name: string;
  remembers: boolean;
  readsOtherRooms?: "off" | "on-search" | "every-turn";
}

export interface MemoryPorts {
  outbox: MemoryOutbox;
  history: {
    chatAfter(roomId: string, afterSeq: number, limit: number): StoredMessage[];
    get(roomId: string, seq: number): StoredMessage | null;
    deleted(roomId: string): Array<{ message: StoredMessage; deletedAt: number }>;
    maxSeq(roomId: string): number;
  };
  rooms(): MemoryRoomView[];
  room(id: string): MemoryRoomView | null;
  searchPool?(roomId: string): MemoryRoomView[];
  config(): MemoryConfig;
  provider(config: MemoryConfig): Promise<MemoryProvider>;
  note(roomId: string, text: string): void;
  log: { info(m: string): void; warn(m: string): void; error(m: string): void };
  minRelevance?: number;
  condense?: typeof condenseBatch;
  writeQuestions?: typeof writeQuestions;
  questionsWaitMs?: number;
  retryLadderMs?: number[];
  now?: () => number;
}

export type BriefSearch = { seq: number } & (AskedQuestions | { pending: true });

export interface LateModelNote {
  ms: number;
  questions?: string[];
  failure?: string;
}

export interface SearchReplay {
  asked: AskedQuestions;
  facts: RecalledFact[];
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
  rooms: Array<{ id: string; cursor: number; behind: number }>;
}

const DRAIN_PAGE = 24;
const RETRY_LADDER_MS = [5_000, 15_000, 60_000, 300_000];
const NOTE_AFTER_FAILURES = 2;
const CONTEXT_ROWS = 3;
const CONTEXT_ROW_CHARS = 300;
const CONTEXT_SCAN = 40;
const BRIEF_CANDIDATES = 30;
const QUESTION_CANDIDATES = 10;
const SEARCH_FACTS_WAIT_MS = 5_000;
const BRIEF_SEARCH_WAIT_MS = 3_000;
const FACTS_NOTE = "Facts this room's long-term memory holds about the current topic; each may carry the span it held true. They are inference, not quotes: the conversation and the rules win.";
const UNANSWERED_NOTE = "The memory was not searched for this message: the model that writes its questions did not answer. If earlier context matters, search it yourself: search_history also returns the memory's facts.";
const PENDING_NOTE = "The memory's search for this message had not returned when this turn began, so no facts are given. If earlier context matters, search it yourself: search_history also returns the memory's facts.";
const BRIEFS_KEPT = 20;
const LATE_CALLS_KEPT = 20;
export { MIN_RELEVANCE };

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const monthOf = (ts: number) => new Date(ts).toISOString().slice(0, 7);

export class MemoryPipeline {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly freshSearches = new Map<string, Map<number, { startedAt: number; promise: Promise<void> }>>();
  private readonly lateCalls = new Map<string, Map<number, ModelCall>>();
  private readonly handledEdits = new Map<string, number>();
  private readonly rewakes = new Map<string, ReturnType<typeof setTimeout>>();
  private budgetWarned = "";
  private unscoredNoted = false;
  private providerInstance: { key: string; provider: MemoryProvider } | null = null;
  private paused: { reason: string; since: number } | null = null;
  private pausedNoted = new Set<string>();
  private modelDown: { reason: string; since: number } | null = null;
  private retryStep = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastError: string | null = null;
  private stopped = false;

  constructor(private readonly ports: MemoryPorts) {}

  start(): void {
    if (!this.active()) return;
    for (const room of this.ports.rooms()) if (room.remembers) { this.optIn(room.id); this.wake(room.id); }
    for (const roomId of new Set(this.ports.outbox.ops(this.ports.config().provider, 512).map(op => op.room))) this.wake(roomId);
  }

  optIn(roomId: string): void {
    if (!this.active()) return;
    const config = this.ports.config();
    const room = this.ports.room(roomId);
    if (!room?.remembers || this.ports.outbox.hasCursor(config.provider, roomId)) return;
    this.ports.outbox.resetCursor(config.provider, roomId, this.ports.history.maxSeq(roomId));
  }

  messageLanded(roomId: string, seq: number): void {
    if (!this.active()) return;
    const config = this.ports.config();
    if (this.ports.room(roomId)?.remembers && !this.ports.outbox.hasCursor(config.provider, roomId)) {
      this.ports.outbox.resetCursor(config.provider, roomId, Math.max(0, seq - 1));
    }
    this.freshSearch(roomId, seq);
    this.wake(roomId);
  }

  private freshSearch(roomId: string, seq: number): void {
    const room = this.ports.room(roomId);
    if (!room?.remembers) return;
    const row = this.ports.history.get(roomId, seq);
    if (!row || !asksMemory(row)) return;
    const searches = this.freshSearches.get(roomId) ?? new Map<number, { startedAt: number; promise: Promise<void> }>();
    if (searches.has(seq) || this.ports.outbox.brief(this.ports.config().provider, roomId, seq)) return;
    const now = this.ports.now ?? Date.now;
    const startedAt = now();
    const promise = (async () => {
      try {
        const provider = await this.provider();
        const ask = this.briefAsk();
        const asked = await this.askFor(room, row, ask, call => {
          if (call.inTime) return;
          this.keepLateCall(roomId, seq, call);
          this.ports.log.info(`memory: ${describeLateCall(call, seq, room.name, ask.unavailable === undefined ? ask.waitMs ?? null : null)}`);
        });
        const searching = now();
        const facts = asked.questions.length ? await this.searchGraphs(provider, room, asked.questions, { candidates: this.briefCandidates(), across: this.blockReadsOthers(room) }) : [];
        if (this.freshSearches.get(roomId) !== searches) return;
        const told = this.applyBrief(roomId, provider.id, seq, facts, asked);
        const best = typeof facts[0]?.relevance === "number" ? ` (best ${facts[0].relevance.toFixed(2)})` : "";
        const searched = asked.questions.length ? `searched in ${now() - searching} ms, ` : "";
        this.ports.log.info(`memory: the brief for message ${seq} of ${room.name}: ${told} fact${told === 1 ? "" : "s"} told${best}; ${describeAsked(asked)}; ${searched}${now() - startedAt} ms in all`);
      } catch (error) {
        this.ports.log.warn(`memory: the brief for message ${seq} of ${room.name} was not searched (${describeNetworkError(error)}); its turn is told the search had not returned, and the next turn for it asks again`);
      }
      finally { searches.delete(seq); }
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

  private askFor(room: MemoryRoomView, row: StoredMessage, options: AskOptions = {}, onModelCall?: (call: ModelCall) => void): Promise<AskedQuestions> {
    const { mode, baseUrl, apiKey, model } = this.ports.config().filter;
    const endpoint = mode === "llm" && baseUrl && model ? { baseUrl, apiKey, model } : null;
    const before = this.ports.history.chatAfter(room.id, Math.max(0, row.seq - CONTEXT_SCAN), CONTEXT_SCAN)
      .filter(m => m.seq < row.seq && visibleToAgents(m))
      .slice(-CONTEXT_ROWS)
      .map(m => ({ speaker: m.fromName, text: [...memoryText(m)].slice(0, CONTEXT_ROW_CHARS).join("") }));
    const ended = (call: ModelCall): void => {
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
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    for (const timer of this.rewakes.values()) clearTimeout(timer);
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
      pendingOps: config.provider === "off" ? 0 : this.ports.outbox.pending(config.provider).ops,
      lastError: this.lastError,
      usage: { month, credits: config.provider === "off" ? 0 : this.ports.outbox.usage(config.provider, month), cap: Number(this.section(config).monthlyCreditCap ?? 0) },
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

  private recordSpend(provider: MemoryProvider, credits: number, roomId: string): void {
    const month = monthOf((this.ports.now ?? Date.now)());
    this.ports.outbox.addUsage(provider.id, month, credits);
    const cap = Number(this.section(this.ports.config()).monthlyCreditCap ?? 0);
    if (!cap) return;
    const spent = this.ports.outbox.usage(provider.id, month);
    const warnKey = `${provider.id}:${month}`;
    if (spent >= cap * 0.8 && spent < cap && this.budgetWarned !== warnKey) {
      this.budgetWarned = warnKey;
      this.ports.note(roomId, `Long-term memory has spent ${spent} of its ${cap} for ${month} (${Math.round(spent / cap * 100)}%). At the ceiling it pauses and waits; raise it in Settings → Long-term memory if the month should hold more.`);
    }
  }

  configChanged(): void {
    this.providerInstance = null;
    this.paused = null;
    this.retryStep = 0;
    this.start();
  }

  wake(roomId: string): void {
    if (this.stopped || !this.active()) return;
    const previous = this.chains.get(roomId) ?? Promise.resolve();
    const work = () => this.drain(roomId).catch(error => this.ports.log.error(`memory: drain of ${roomId} broke: ${(error as Error).message}`));
    const next = previous.then(work, work).then(() => undefined);
    this.chains.set(roomId, next);
  }

  edited(roomId: string, sourceId: string, seq: number, editedTs: number): void {
    if (!this.active()) return;
    const key = `${roomId}:${sourceId}`;
    if (this.handledEdits.get(key) === editedTs) return;
    this.handledEdits.set(key, editedTs);
    while (this.handledEdits.size > 512) this.handledEdits.delete(this.handledEdits.keys().next().value!);
    const config = this.ports.config();
    this.ports.outbox.enqueue(config.provider, roomId, "forget", { sourceId });
    this.ports.outbox.enqueue(config.provider, roomId, "reingest", { sourceId, seq });
    this.wake(roomId);
  }

  truncated(roomId: string, fromSeq: number): void {
    if (!this.active()) return;
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
    if (!this.active()) return;
    this.ports.outbox.enqueue(this.ports.config().provider, roomId, "fact", { subject, predicate, object, ts: (this.ports.now ?? Date.now)() });
    this.wake(roomId);
  }

  remember(roomId: string, author: { id: string; name: string }, text: string): void {
    if (!this.active()) throw new Error("Long-term memory is off; the human enables it in Settings.");
    const room = this.ports.room(roomId);
    if (!room?.remembers) throw new Error("This room does not feed the long-term memory (its switch is off).");
    const trimmed = text.trim();
    if (!trimmed || [...trimmed].length > 2000) throw new Error("A memory note is 1–2000 characters of plain text.");
    this.ports.outbox.enqueue(this.ports.config().provider, roomId, "note", { authorId: author.id, authorName: author.name, text: trimmed, ts: (this.ports.now ?? Date.now)() });
    this.wake(roomId);
  }

  async searchFacts(roomId: string, query: string, options: { limit: number; across?: boolean; waitMs?: number }): Promise<{ facts: RecalledFact[]; pending: number } | null> {
    if (!this.active()) return null;
    const room = this.ports.room(roomId);
    if (!room?.remembers) return null;
    const provider = await this.provider();
    const waitMs = options.waitMs ?? SEARCH_FACTS_WAIT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`it did not answer within ${waitMs / 1000} s`)), waitMs);
      timer.unref?.();
    });
    try {
      const found = await Promise.race([this.searchGraphs(provider, room, [query], { candidates: options.limit, across: options.across === true && room.readsOtherRooms !== "off" }), late]);
      return { facts: found.slice(0, options.limit), pending: Math.max(0, this.ports.history.maxSeq(roomId) - this.ports.outbox.cursor(provider.id, roomId)) };
    } finally { clearTimeout(timer); }
  }

  async replaySearch(roomId: string, seq: number, how?: QuestionsHow, options: AskOptions = {}): Promise<SearchReplay> {
    if (!this.active()) throw new Error("Long-term memory is off; the human enables it in Settings.");
    const room = this.ports.room(roomId);
    if (!room?.remembers) throw new Error("This room does not feed the long-term memory (its switch is off).");
    const row = this.ports.history.get(roomId, seq);
    if (!row || !asksMemory(row)) throw new Error(`#${seq} is not a message of the human's that asks the memory anything.`);
    const provider = await this.provider();
    const text = searchText(row);
    const asked: AskedQuestions = how === "whole" ? { how: "whole", questions: [text] }
      : how === "split" ? { how: "split", questions: splitQuestions(text) }
      : await this.askFor(room, row, { waitMs: this.questionsWaitMs(), ...options });
    const now = this.ports.now ?? Date.now;
    const started = now();
    const unread: string[] = [];
    const facts = asked.questions.length ? await this.searchGraphs(provider, room, asked.questions, { candidates: this.briefCandidates(), across: this.blockReadsOthers(room), unread, floor: 0 }) : [];
    return { asked, facts, floor: this.floor(), searchedMs: now() - started, ...(unread.length ? { unread } : {}) };
  }

  forgetRoom(roomId: string): void {
    const config = this.ports.config();
    if (config.provider === "off") return;
    const room = this.ports.room(roomId);
    this.ports.outbox.clearRoomData(config.provider, roomId);
    this.ports.outbox.resetCursor(config.provider, roomId, this.ports.history.maxSeq(roomId));
    this.ports.outbox.enqueue(config.provider, roomId, "forget-room", { uuid: room?.uuid ?? roomId, name: room?.name ?? roomId });
    this.freshSearches.delete(roomId);
    this.lateCalls.delete(roomId);
    this.wake(roomId);
  }

  briefBlock(roomId: string, addressed: readonly number[]): { revision: string; block: string; search?: BriefSearch } | null {
    if (!this.active() || !this.ports.room(roomId)?.remembers) return null;
    const seq = this.questionOf(roomId, addressed);
    if (seq === null) return null;
    const provider = this.ports.config().provider;
    const brief = this.ports.outbox.brief(provider, roomId, seq);
    const unanswered = brief?.asked.how === "model" && brief.asked.unanswered !== undefined;
    const body = !brief ? [PENDING_NOTE]
      : brief.lines.length ? [FACTS_NOTE, ...brief.lines]
      : unanswered ? [UNANSWERED_NOTE]
      : null;
    if (!body) return null;
    const block = [`<memory-graph provider="${provider}">`, ...body, "</memory-graph>"].join("\n");
    const search: BriefSearch = brief ? { seq, ...brief.asked } : { seq, pending: true };
    return { revision: instructionRevision(`#${seq}\n${block}`), block, search };
  }


  private async drain(roomId: string): Promise<void> {
    if (this.stopped || this.paused || !this.active()) return;
    const room = this.ports.room(roomId);
    const config = this.ports.config();
    if (!room?.remembers && !this.ports.outbox.ops(config.provider).some(op => op.room === roomId)) return;
    let provider: MemoryProvider;
    try { provider = await this.provider(); }
    catch (error) { this.pause(roomId, `the ${config.provider} provider could not start: ${(error as Error).message}`); return; }
    try {
      let worked = await this.drainOps(provider, roomId);
      if (room?.remembers) worked += await this.drainStream(provider, room, config);
      if (worked) this.resume();
    } catch (error) {
      if (error instanceof MemoryProviderError && error.retryable) { this.pause(roomId, error.message); return; }
      throw error;
    }
  }

  private async drainOps(provider: MemoryProvider, roomId: string): Promise<number> {
    let done = 0;
    for (let round = 0; round < 64; round++) {
      const ops = this.ports.outbox.ops(provider.id).filter(op => op.room === roomId);
      if (!ops.length) return done;
      for (const op of ops) {
        try {
          await this.runOp(provider, op);
          this.ports.outbox.opDone(op.id);
          done++;
        } catch (error) {
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

  private async runOp(provider: MemoryProvider, op: MemoryOp): Promise<void> {
    const room = this.ports.room(op.room);
    const view: MemoryRoom = op.kind === "forget-room"
      ? { uuid: String(op.payload.uuid), name: String(op.payload.name) }
      : this.asMemoryRoom(room ?? { id: op.room, uuid: op.room, name: op.room, remembers: false });
    switch (op.kind) {
      case "forget-room":
        await provider.forgetRoom(view);
        return;
      case "forget": {
        const sourceId = String(op.payload.sourceId);
        if (provider.capabilities.forgetEpisode) {
          for (const externalId of this.ports.outbox.episodeIds(provider.id, op.room, sourceId)) {
            await provider.forgetEpisode(view, externalId);
          }
        }
        this.ports.outbox.dropEpisodes(provider.id, op.room, sourceId);
        return;
      }
      case "fact": {
        if (!provider.capabilities.addFact) return;
        this.ensureBudget(provider);
        await provider.ensureRoom(view);
        const { credits } = await provider.addFact(view, { subject: String(op.payload.subject), predicate: String(op.payload.predicate), object: String(op.payload.object), ts: Number(op.payload.ts) || Date.now() });
        this.recordSpend(provider, credits, op.room);
        return;
      }
      case "note": {
        this.ensureBudget(provider);
        await provider.ensureRoom(view);
        const { externalId, credits } = await provider.addEpisode(view, {
          sourceId: `note-${op.id}`,
          authorId: String(op.payload.authorId),
          authorName: String(op.payload.authorName),
          text: String(op.payload.text),
          ts: Number(op.payload.ts) || Date.now(),
        });
        this.recordSpend(provider, credits, op.room);
        if (externalId) this.ports.outbox.mapEpisode(provider.id, op.room, `note-${op.id}`, externalId);
        return;
      }
      case "reingest": {
        if (!room) return;
        const cursor = this.ports.outbox.cursor(provider.id, op.room);
        const row = this.ports.history.get(op.room, Number(op.payload.seq));
        if (!row || row.id !== String(op.payload.sourceId) || row.seq > cursor) return;
        await this.sendMessages(provider, room, this.ports.config(), [row]);
        return;
      }
    }
  }

  private async drainStream(provider: MemoryProvider, room: MemoryRoomView, config: MemoryConfig): Promise<number> {
    let processed = 0;
    for (let page = 0; page < 40; page++) {
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
      await this.sendMessages(provider, room, config, rows, true);
      processed += rows.length;
    }
    this.wake(room.id);
    return processed;
  }

  private rewakeAt(roomId: string, inMs: number): void {
    if (this.stopped || this.rewakes.has(roomId)) return;
    const timer = setTimeout(() => { this.rewakes.delete(roomId); this.wake(roomId); }, Math.max(50, inMs));
    timer.unref?.();
    this.rewakes.set(roomId, timer);
  }

  private async sendMessages(provider: MemoryProvider, room: MemoryRoomView, config: MemoryConfig, rows: StoredMessage[], advance = false): Promise<void> {
    const eligible = rows.filter(m => visibleToAgents(m) && screen(m.text) === "pass");
    const verdicts = await this.judge(room, config, eligible);
    const keep = new Map(verdicts.map(v => [v.sourceId, v]));
    for (const row of rows) {
      const verdict = keep.get(row.id);
      if (verdict?.keep) {
        this.ensureBudget(provider);
        await provider.ensureRoom(this.asMemoryRoom(room));
        const episode: MemoryEpisode = {
          sourceId: row.id,
          seq: row.seq,
          authorId: row.from,
          authorName: row.fromName,
          text: verdict.episode ?? memoryText(row),
          ts: row.ts,
        };
        try {
          const { externalId, credits } = await provider.addEpisode(this.asMemoryRoom(room), episode);
          this.recordSpend(provider, credits, room.id);
          if (externalId) this.ports.outbox.mapEpisode(provider.id, room.id, row.id, externalId);
        } catch (error) {
          if (error instanceof MemoryProviderError && error.retryable) throw error;
          this.fail(`memory: message ${row.seq} of ${room.name} was refused and skipped: ${(error as Error).message}`);
        }
      }
      if (advance) this.ports.outbox.advance(provider.id, room.id, row.seq);
    }
  }

  private async judge(room: MemoryRoomView, config: MemoryConfig, rows: StoredMessage[]): Promise<FilterVerdict[]> {
    if (!rows.length) return [];
    const long = (m: StoredMessage): { episode?: string } => {
      const text = memoryText(m);
      return [...text].length > CONDENSE_OVER_CHARS ? { episode: heuristicEpisode(text) } : {};
    };
    if (config.filter.mode === "off") return rows.map(m => ({ sourceId: m.id, keep: true, ...long(m) }));
    if (config.filter.mode === "heuristic") {
      return rows.map(m => ({ sourceId: m.id, keep: m.from === "human", ...(m.from === "human" ? long(m) : {}) }));
    }
    const endpoint = this.filterEndpoint(config);
    const verdicts: FilterVerdict[] = [];
    for (let start = 0; start < rows.length; start += FILTER_BATCH) {
      const slice = rows.slice(start, start + FILTER_BATCH);
      const first = slice[0];
      const context = this.ports.history.chatAfter(room.id, Math.max(0, first.seq - CONTEXT_ROWS - 1), CONTEXT_ROWS)
        .filter(m => m.seq < first.seq)
        .map(m => `${m.fromName}: ${[...memoryText(m)].slice(0, CONTEXT_ROW_CHARS).join("")}`)
        .join("\n");
      const items: FilterItem[] = slice.map(m => ({ sourceId: m.id, authorName: m.fromName, authorKind: m.from === "human" ? "human" : "agent", text: memoryText(m), ts: m.ts }));
      try {
        verdicts.push(...await (this.ports.condense ?? condenseBatch)(endpoint, items, context));
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
    const provider = await this.ports.provider(config);
    this.providerInstance = { key, provider };
    return provider;
  }

  private pause(roomId: string, reason: string): void {
    const now = (this.ports.now ?? Date.now)();
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
    }, delay);
    this.retryTimer.unref?.();
  }

  private resume(): void {
    if (this.retryStep === 0 && !this.paused) return;
    this.paused = null;
    this.retryStep = 0;
    this.lastError = null;
    this.ports.log.info("memory: resumed; the queue is draining");
    this.pausedNoted.clear();
  }

  private fail(message: string): void {
    this.lastError = message;
    this.ports.log.error(message);
  }


  private applyBrief(roomId: string, providerId: string, seq: number, facts: RecalledFact[], asked: AskedQuestions): number {
    if (!this.ports.room(roomId)?.remembers) return 0;
    const size = this.ports.config().blockChars;
    const lines: string[] = [];
    let chars = 0;
    for (const f of facts) {
      const line = `- ${xml(f.fact)}${f.validAt ? ` (from ${f.validAt.slice(0, 10)}${f.invalidAt ? ` to ${f.invalidAt.slice(0, 10)}` : ""})` : ""}${f.room ? ` [heard in the room "${xml(f.room)}"]` : ""}`;
      if (lines.length && chars + line.length > size) break;
      lines.push(line);
      chars += line.length + 1;
    }
    this.ports.outbox.saveBrief(providerId, roomId, seq, lines, asked, BRIEFS_KEPT);
    return lines.length;
  }

  private asMemoryRoom(room: MemoryRoomView): MemoryRoom {
    return { uuid: room.uuid, name: room.name };
  }


  private async searchGraphs(provider: MemoryProvider, room: MemoryRoomView, questions: string[], options: { candidates: number; across: boolean; unread?: string[]; floor?: number }): Promise<RecalledFact[]> {
    const { candidates, across, unread, floor = this.floor() } = options;
    const others = across
      ? (this.ports.searchPool?.(room.id) ?? []).filter(r => r.id !== room.id && r.remembers)
      : [];
    const each = questions.length > 1 ? Math.max(QUESTION_CANDIDATES, Math.ceil(candidates / questions.length)) : candidates;
    const ask = async (target: MemoryRoomView): Promise<RecalledFact[]> =>
      (await Promise.all(questions.map(question => provider.search(this.asMemoryRoom(target), question, each)))).flat();
    const answers = await Promise.all([
      ask(room),
      ...others.map(async target => {
        try { return (await ask(target)).map(fact => ({ ...fact, room: target.name })); }
        catch (error) {
          this.ports.log.warn(`memory: a search could not read the graph of ${target.name}: ${describeNetworkError(error)}`);
          unread?.push(target.name);
          return [];
        }
      }),
    ]);
    const scored = provider.capabilities.relevance;
    if (scored && !this.unscoredNoted && answers.some(facts => facts.some(f => typeof f.relevance !== "number"))) {
      this.unscoredNoted = true;
      this.ports.log.warn(`memory: ${provider.id} returned facts without a relevance; they rank as 0`);
    }
    return rankRecalled(answers, scored, floor);
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
