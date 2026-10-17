// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { HistoryStore, SearchHit, SearchQuery } from "../history-store.js";
import { sourceVersion } from "../memory/provenance.js";
import { NameDirectory, namesInQuery } from "../name-directory.js";
import { visibleToAgents } from "../quotes.js";
import type { ChatMessage, Room } from "../room.js";

export interface HistorySearchResponse {
  hits: Array<SearchHit & { roomName: string; fromNow?: string }>;
  names?: { term: string; roomId: string; now: string | null; others: string[] }[];
  query: string;
  usedTrigram: boolean;
  roomsSearched?: number;
  unavailable?: string;
  stale?: string[];
}

export interface HistoryAccessPorts {
  rooms(): ReadonlyMap<string, Room>;
  history(): HistoryStore | null;
  knobs(): { retryMs: number; backupKeep: number; backupEveryMs: number };
  backupsDir(): string;
  log(text: string): void;
}

class Refusal extends Error {}

function clampInt(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function committed(message: ChatMessage): boolean {
  return !message.streaming && Number.isInteger(message.seq) && message.seq > 0;
}

export class HistoryAccess {
  private readonly marks = new Map<string, Room>();
  private readonly retriedAt = new WeakMap<Room, number>();
  private readonly dropped = new WeakSet<Room>();
  private scopesShare: (caller: string, target: string | null) => boolean = () => false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private disposed = false;

  constructor(private readonly ports: HistoryAccessPorts) {}

  private held(room: Room): boolean {
    return this.ports.rooms().get(room.id) === room;
  }

  private standing(...rooms: Room[]): boolean {
    if (this.disposed) return false;
    const registry = this.ports.rooms();
    return !this.disposed && rooms.every((room) => registry.get(room.id) === room);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }


  markStale(room: Room): void {
    if (this.disposed || this.dropped.has(room)) return;
    const holder = this.ports.rooms().get(room.id);
    if (this.disposed || (holder !== undefined && holder !== room)) return;
    this.marks.set(room.id, room);
  }

  dropRoom(room: Room): void {
    this.dropped.add(room);
    this.retriedAt.delete(room);
    if (this.marks.get(room.id) !== room) return;
    this.marks.delete(room.id);
  }

  private marked(registry: ReadonlyMap<string, Room>, id: string): boolean {
    const room = registry.get(id);
    return !!room && this.marks.get(id) === room;
  }

  private mirror(room: Room): void {
    const history = this.ports.history();
    if (!history || !this.standing(room)) return;
    try {
      const { upserted, marked } = history.reconcile(room.id, room.messages.filter(committed));
      if (!this.standing(room)) return;
      if (this.marks.get(room.id) === room) this.marks.delete(room.id);
      if (upserted || marked) this.ports.log(`history store: room ${room.id} reconciled (${upserted} written, ${marked} marked removed)`);
    } catch (error) {
      if (!this.standing(room)) return;
      this.marks.set(room.id, room);
      this.ports.log(`history store: room ${room.id} could not be reconciled: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private retry(roomId: string): void {
    if (this.disposed) return;
    const registry = this.ports.rooms();
    if (this.disposed || !this.marked(registry, roomId)) return;
    const room = registry.get(roomId)!;
    const now = Date.now();
    const every = this.ports.knobs().retryMs;
    if (this.disposed || registry.get(roomId) !== room || this.marks.get(roomId) !== room) return;
    if (now - (this.retriedAt.get(room) ?? 0) < every) return;
    this.retriedAt.set(room, now);
    this.mirror(room);
  }

  staleAfterRetry(roomIds: Iterable<string>): string[] {
    const stale: string[] = [];
    const registry = this.ports.rooms();
    for (const id of roomIds) {
      this.retry(id);
      if (this.marked(registry, id)) stale.push(id);
    }
    return stale;
  }


  setScopePolicy(policy: ((caller: string, target: string | null) => boolean) | null): void {
    this.scopesShare = policy ?? (() => false);
  }

  private reaches(caller: Room, target: Room): boolean {
    if (caller.unreadableScope !== undefined || target.unreadableScope !== undefined) return false;
    return caller.scope === target.scope || (caller.scope !== null && this.scopesShare(caller.scope, target.scope));
  }

  canReadShared(caller: Room, target: Room): boolean {
    if (!this.permits(caller, target, false)) return false;
    this.staleAfterRetry([target.id]);
    return this.permits(caller, target, true);
  }

  private permits(caller: Room, target: Room, inStep: boolean): boolean {
    if (this.disposed) return false;
    const registry = this.ports.rooms();
    const policy = this.scopesShare, scopes = [caller.scope, target.scope];
    const reached = this.reaches(caller, target);
    return reached && !this.disposed && caller.scope === scopes[0] && target.scope === scopes[1] && this.allowed(registry, policy, caller, target, inStep);
  }

  private allowed(registry: ReadonlyMap<string, Room>, policy: HistoryAccess["scopesShare"], caller: Room, target: Room, inStep: boolean): boolean {
    return registry.get(caller.id) === caller && registry.get(target.id) === target && this.scopesShare === policy
      && caller.unreadableScope === undefined && target.unreadableScope === undefined
      && caller.settings.readsOtherRooms !== "off" && !!target.settings.sharesHistory && !caller.readOnly && !target.readOnly
      && (!inStep || !this.marked(registry, target.id));
  }

  roomsReachedFrom(callerId: string): Room[] {
    if (this.disposed) return [];
    const registry = this.ports.rooms();
    const caller = registry.get(callerId);
    if (!caller) return [];
    const policy = this.scopesShare;
    const asked = [...registry.values()].map((room) => ({ room, scopes: [caller.scope, room.scope] as const }));
    const reached = asked.filter(({ room }) => room === caller || this.reaches(caller, room));
    if (this.disposed || registry.get(caller.id) !== caller || this.scopesShare !== policy) return [];
    return reached.filter(({ room, scopes }) => registry.get(room.id) === room && caller.scope === scopes[0] && room.scope === scopes[1]).map(({ room }) => room);
  }

  roomsForAgentSearch(roomId: string): { id: string; name: string }[] {
    if (this.disposed) return [];
    const own = this.ports.rooms().get(roomId);
    if (!own) return [];
    const view = (room: Room) => ({ id: room.id, name: room.settings.name });
    if (own.settings.readsOtherRooms === "off") return this.standing(own) ? [view(own)] : [];
    const candidates = [...this.ports.rooms().values()].filter((room) => room === own || this.canReadShared(own, room));
    const registry = this.ports.rooms();
    const policy = this.scopesShare;
    const asked = candidates.map((room) => ({ room, scopes: [own.scope, room.scope] as const }));
    const reached = asked.filter(({ room }) => room === own || this.reaches(own, room));
    if (this.disposed || registry.get(own.id) !== own) return [];
    return reached.filter(({ room, scopes }) => room === own || (own.scope === scopes[0] && room.scope === scopes[1] && this.allowed(registry, policy, own, room, true)))
      .map(({ room }) => view(room));
  }

  nameDirectory(roomIds: string[]): NameDirectory {
    const none = () => new NameDirectory([], []);
    if (this.disposed) return none();
    const rooms = this.ports.rooms();
    const current = roomIds.flatMap((id) => [...(rooms.get(id)?.participants.values() ?? [])].map((p) => ({ roomId: id, id: p.id, name: p.name })));
    const history = this.ports.history();
    if (this.disposed) return none();
    const uses = history?.nameUses(roomIds) ?? [];
    return this.disposed ? none() : new NameDirectory(uses, current);
  }

  readMessageForAgent(caller: Room, participantId: string, seq: number | undefined, around: number, selector?: string, copy?: string, messageId?: string, version?: string): Record<string, unknown> {
    if (this.disposed) throw new Error("viberoom is shutting down; the history cannot be read now");
    caller.assertHistoryAccessForAgent(participantId);
    let target = caller;
    if (selector !== undefined) {
      const rooms = this.ports.rooms();
      const byId = rooms.get(selector);
      const candidates = byId ? [byId] : [...rooms.values()].filter(room => room.settings.name === selector);
      const matches = candidates.filter(room => room === caller || this.canReadShared(caller, room));
      if (matches.length > 1) throw new Error(`room ${JSON.stringify(selector)} is ambiguous; use its room ID from search_history`);
      if (!matches.length) throw new Error(`room ${JSON.stringify(selector)} is not available to this vibemate`);
      target = matches[0];
    }
    const still = () => target === caller ? this.standing(caller) : this.permits(caller, target, true);
    const refused = () => new Refusal(`room ${JSON.stringify(target.settings.name)} is not available to this vibemate`);
    if (!still()) throw refused();
    let content: Record<string, unknown>;
    try {
      if (messageId !== undefined) {
        const message = target.messages.find(m => m.id === messageId && visibleToAgents(m));
        if (!still()) throw refused();
        if (!message) throw new Error("message is not available in this room");
        if (version !== undefined && sourceVersion(message) !== version) throw new Error("the requested source version is not available; the current message differs");
        seq = message.seq;
      }
      if (seq === undefined) throw new Error("read_message needs seq or message_id");
      if (copy !== undefined) seq = target.numberFromCopy(copy, seq);
      if (!still()) throw refused();
      content = target === caller
        ? caller.readMessageForAgent(participantId, seq, around)
        : target.readVisibleMessageForAgent(seq, around, `${caller.participants.get(participantId)!.name} from ${JSON.stringify(caller.settings.name)}`);
    } catch (error) {
      if (target === caller || error instanceof Refusal) throw error;
      throw new Error(`room ${JSON.stringify(target.settings.name)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!still()) throw refused();
    return { room: target.id, roomName: target.settings.name, ...content };
  }

  historyForAgent(roomId: string): HistoryStore | null {
    if (this.disposed) throw new Error("viberoom is shutting down; the history cannot be searched now");
    this.retry(roomId);
    if (this.marked(this.ports.rooms(), roomId)) throw new Error("the conversation store is out of sync for this room; history could not be searched until it is reconciled");
    const history = this.ports.history();
    if (this.disposed) throw new Error("viberoom is shutting down; the history cannot be searched now");
    return history;
  }

  search(params: { q?: string; rooms?: string; kinds?: string; author?: string; sort?: string; limit?: string; offset?: string; perRoom?: string; deleted?: string }): HistorySearchResponse {
    const closing = { hits: [], query: "", usedTrigram: false, unavailable: "viberoom is shutting down; the history cannot be searched now" };
    if (this.disposed) return closing;
    const history = this.ports.history();
    if (!history) return { hits: [], query: "", usedTrigram: false, unavailable: "the conversation store is off (SQLite is not available in this Node)" };
    const registry = this.ports.rooms();
    const kinds = (params.kinds ?? "chat").split(",").map((k) => k.trim()).filter((k): k is "chat" | "system" => k === "chat" || k === "system");
    const asked = params.rooms && params.rooms !== "all" ? params.rooms.split(",").map((r) => r.trim()).filter((r) => registry.has(r)) : [];
    const rooms = asked.length ? asked : [...registry.keys()];
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
    const stale = this.staleAfterRetry(rooms).map((id) => registry.get(id)?.name ?? id);
    if (this.disposed) return closing;
    const result = history.search(query);
    if (this.disposed) return closing;
    const names = namesInQuery(params.q ?? "", people).map(({ term, holder, others }) => ({ term, roomId: holder.roomId, now: holder.now ?? null, others }));
    const answer: HistorySearchResponse = {
      ...result,
      hits: result.hits.map((h) => {
        const now = people.now(h.roomId, h.from);
        return { ...h, roomName: registry.get(h.roomId)?.name ?? h.roomId, ...(now && now !== h.fromName ? { fromNow: now } : {}) };
      }),
      ...(names.length ? { names } : {}),
      roomsSearched: rooms.length,
      ...(stale.length ? { stale } : {}),
    };
    return answer;
  }


  get backupsStarted(): boolean { return this.started; }

  startBackups(): void {
    if (this.timer || this.disposed) return;
    const every = this.ports.knobs().backupEveryMs;
    if (this.timer || this.disposed) return;
    this.started = true;
    this.timer = setInterval(() => {
      void this.backup().catch((error) => this.ports.log(`history backup failed: ${error instanceof Error ? error.message : String(error)}`));
      for (const room of [...this.ports.rooms().values()]) {
        if (this.standing(room)) room.purgeAcceptReceipts();
      }
    }, every);
    this.timer.unref();
  }

  async backup(final = false): Promise<string> {
    const history = this.ports.history();
    if (!history) throw new Error("the conversation store is off");
    if (this.disposed && !final) throw new Error("viberoom is shutting down; the last copy is the shutdown's own");
    const dir = this.ports.backupsDir();
    if (this.disposed && !final) throw new Error("viberoom is shutting down; the last copy is the shutdown's own");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `history-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    const part = `${file}.part`;
    try {
      await history.backup(part);
      if (this.disposed && !final) throw new Error("viberoom is shutting down; this copy was not kept");
      renameSync(part, file);
    } catch (error) {
      rmSync(part, { force: true });
      throw error;
    }
    const keep = this.ports.knobs().backupKeep;
    if (this.disposed && !final) return file;
    const older = readdirSync(dir).filter((f) => /^history-.*\.db$/.test(f)).sort();
    for (const f of older.slice(0, Math.max(0, older.length - keep))) rmSync(join(dir, f), { force: true });
    return file;
  }

  async finalBackup(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    await this.backup(true);
  }
}
