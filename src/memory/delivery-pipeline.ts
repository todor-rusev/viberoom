// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { maintainDelivery } from "./delivery-maintenance.js";
import { createHash } from "node:crypto";
import { isAsyncFunction } from "node:util/types";
import { carryHash } from "../carry-history.js";
import type { StoredMessage } from "../history-store.js";
import { visibleToAgents } from "../quotes.js";
import { DeliveryBudgetError, isPreparedDelivery, MemoryDeliveryWriter, type Delivery, type SourceListing, type WriteIdentity, type WriteTransport } from "./delivery.js";
import type { MemoryOp, MemoryOutbox } from "./outbox.js";
import type { LoadedTrialPreparation, MemoryEpisode, MemoryProvider } from "./provider.js";
import { messageSource, sourceVersion } from "./provenance.js";
import { observe, type IngestionObserver } from "./ingestion-debug.js";
import { EPISODE_INDEX_CLOCK_MARGIN_MS } from "./episode-index.js";
import type { SourceDelivery } from "./part-group.js";
import type { GroupPreflightResult } from "./group-preflight.js";
import { prepareLocalOriginalMessageGroup, prepareOriginalMessageGroup, type OriginalMessagePreparationRequest,
  type OriginalMessagePreparationResult, type OriginalMessagePreparationSnapshot } from "./original-message-preparation.js";
import { inspectOriginalSource, type OriginalSourceInspectionRequest, type OriginalSourceInspectionCurrent,
  type OriginalSourceInspectionResult } from "./original-source-preselection.js";

interface Room { id: string; uuid: string; name: string; remembers: boolean; graphId?: string; generationRevision?: string; account?: string }
interface Ports {
  outbox: MemoryOutbox;
  room(id: string): Room | null;
  message(room: string, id: string): StoredMessage | null;
  allowed(provider: string, room: string): boolean;
  cap(): number;
  now(): number;
  wakeAfter(room: string, ms: number): void;
  beforeSend?(row: Delivery, reads: WriteTransport, signal?: AbortSignal): Promise<boolean>;
  groupPreflight?(row: Delivery, reads: WriteTransport, signal?: AbortSignal): Promise<GroupPreflightResult>;
  sourceRead?(provider: string, graph: string, listing: SourceListing, reads: WriteTransport, signal: AbortSignal, graphId?: string): Promise<void>;
  removalGuard?(row: Delivery, id: string, reads: WriteTransport, signal: AbortSignal): Promise<(() => boolean) | null>;
}

export class MemoryDeliveryPipeline {
  private readonly writer: MemoryDeliveryWriter;
  private readonly transports = new WeakMap<WriteTransport, WriteTransport>();
  private readonly routeGuards = new Map<string, string | undefined>();
  constructor(private readonly ports: Ports) {
    this.writer = new MemoryDeliveryWriter(ports.outbox.deliveries, ports.now,
      row => this.current(row), row => this.current(row), (row, reads, signal) => ports.beforeSend?.(row, reads, signal) ?? Promise.resolve(!row.groupId),
      undefined, ports.groupPreflight?.bind(ports));
  }

  transport(provider: MemoryProvider): WriteTransport | undefined {
    const base = provider.writes?.transport;
    if (!base) return base;
    if (!this.transports.has(base)) this.transports.set(base, base.usingIndex ? base.usingIndex(this.ports.outbox.episodeIndex, this.ports.now,
      (graph, listing, reads, signal, graphId) => this.ports.sourceRead?.(base.provider, graph, listing, reads, signal, graphId) ?? Promise.resolve()) : this.observed(base));
    return this.transports.get(base)!;
  }

  private observed(reads: WriteTransport): WriteTransport {
    const seen = async (graph: string, listing: SourceListing, signal: AbortSignal, graphId?: string) => {
      if (listing.state === "complete") await this.ports.sourceRead?.(reads.provider, graph, listing, reads, signal, graphId);
      return listing;
    };
    return { ...reads, provider: reads.provider, validate: row => reads.validate(row), send: (row, signal) => reads.send(row, signal), reconcile: (row, signal, options) => reads.reconcile(row, signal, options),
      ...(reads.sourceBodyProof ? { sourceBodyProof: (...args: Parameters<NonNullable<WriteTransport["sourceBodyProof"]>>) => reads.sourceBodyProof!(...args) } : {}),
      ...(reads.originalSourceClassification ? { originalSourceClassification: (...args: Parameters<NonNullable<WriteTransport["originalSourceClassification"]>>) => reads.originalSourceClassification!(...args) } : {}),
      ...(reads.originalSourceBodyProof ? { originalSourceBodyProof: (...args: Parameters<NonNullable<WriteTransport["originalSourceBodyProof"]>>) => reads.originalSourceBodyProof!(...args) } : {}),
      ...(reads.sources ? { sources: async (graph: string, signal: AbortSignal, now: () => number, graphId?: string) => seen(graph, await reads.sources!(graph, signal, now, graphId), signal, graphId) } : {}),
      ...(reads.advanceIndex ? { advanceIndex: async (graph: string, signal: AbortSignal, graphId?: string) => {
        const listing = await reads.advanceIndex!(graph, signal, graphId);
        return listing ? seen(graph, listing, signal, graphId) : undefined;
      } } : {}),
      ...(reads.readCycle ? { readCycle: (...args: Parameters<NonNullable<WriteTransport["readCycle"]>>) => this.observed(reads.readCycle!(...args)) } : {}),
      ...(reads.episodePresence ? { episodePresence: (id: string, signal?: AbortSignal) => reads.episodePresence!(id, signal) } : {}),
      ...(reads.sourceEpisodes ? { sourceEpisodes: (graph: string, id: string, signal: AbortSignal, graphId?: string) => reads.sourceEpisodes!(graph, id, signal, graphId) } : {}),
      ...(reads.inventory ? { inventory: (row: Delivery, signal?: AbortSignal) => reads.inventory!(row, signal) } : {}),
      ...(reads.nextIndexRead ? { nextIndexRead: (graph: string, graphId?: string) => reads.nextIndexRead!(graph, graphId) } : {}),
      ...(reads.dropIndex ? { dropIndex: (graph: string, graphId?: string) => reads.dropIndex!(graph, graphId) } : {}) };
  }

  private identity(provider: string, room: Room, sourceId: string, version: string, kind: WriteIdentity["kind"]): WriteIdentity {
    return { provider, roomId: room.id, roomUuid: room.uuid, copyId: this.ports.outbox.deliveries.copy(provider, room.id, room.uuid),
      ...(room.graphId === undefined ? {} : { graphId: room.graphId }),
      sourceId, version, part: "1/1", kind };
  }

  savedSource(provider: string, room: Room, message: StoredMessage, renew = false): SourceDelivery | null {
    const identity = this.identity(provider, room, message.id, sourceVersion(message), "episode");
    const { part: _part, ...scope } = identity;
    const saved = this.ports.outbox.deliveries.lookupSourceDelivery({ ...scope, kind: "episode", account: room.account ?? null });
    return saved?.kind === "legacy-single" && renew && saved.delivery.retiredAt !== null ? null : saved;
  }

  savedMessage(provider: string, room: Room, message: StoredMessage, renew = false): SourceDelivery | null {
    return this.savedSource(provider, room, message, renew);
  }

  inspectOriginalSource(provider: MemoryProvider, request: OriginalSourceInspectionRequest,
    current: OriginalSourceInspectionCurrent, signal: AbortSignal): Promise<OriginalSourceInspectionResult> {
    return inspectOriginalSource(this.ports, provider, request, current, signal);
  }

  prepareOriginalMessageGroup(provider: MemoryProvider, request: OriginalMessagePreparationRequest,
    current: () => boolean): OriginalMessagePreparationResult {
    return this.prepareOriginalMessageGroupWith(provider, request, current,
      (writes, fence, now) => prepareOriginalMessageGroup(this.ports.outbox.deliveries, writes, request, fence, now));
  }

  prepareLoadedOriginalMessageGroup(preparation: LoadedTrialPreparation, request: OriginalMessagePreparationRequest,
    current: () => boolean): OriginalMessagePreparationResult {
    return this.prepareOriginalMessageGroupWith(preparation, request, current,
      (_writes, fence, now) => prepareLocalOriginalMessageGroup(this.ports.outbox.deliveries, preparation, request, fence, now));
  }

  private prepareOriginalMessageGroupWith<W>(provider: {
    readonly id: string; readonly writes?: W; readonly generations?: Readonly<{ account: string }>;
  }, request: OriginalMessagePreparationRequest, current: () => boolean,
  prepare: (writes: W | undefined, fence: (snapshot: Readonly<OriginalMessagePreparationSnapshot>) => boolean,
    now: number) => OriginalMessagePreparationResult): OriginalMessagePreparationResult {
    const initial = this.ports.room(request.scope.roomId), account = provider.generations?.account;
    const route = initial ? { id: initial.id, uuid: initial.uuid, name: initial.name, graphId: initial.graphId,
      revision: initial.generationRevision, account: initial.account } : null;
    const writes = provider.writes;
    return prepare(writes, snapshot => {
      if (typeof current !== "function" || isAsyncFunction(current) || current() !== true) return false;
      const scope = snapshot.scope, live = this.ports.room(scope.roomId), source = this.ports.message(scope.roomId, scope.sourceId);
      return !!route && !!live && !!source && provider.id === scope.provider && provider.writes === writes &&
        provider.generations?.account === account && (account === undefined || account === scope.account) &&
        live.id === route.id && live.uuid === route.uuid && live.name === route.name && live.graphId === route.graphId &&
        live.generationRevision === route.revision && live.account === route.account && live.uuid === scope.roomUuid &&
        live.graphId === scope.graphId && (live.account ?? null) === scope.account && live.name === snapshot.room.name &&
        live.remembers && this.ports.allowed(provider.id, live.id) && !this.ports.outbox.importedSource(live.id, source.id) &&
        source.id === scope.sourceId && source.seq === snapshot.source.seq && visibleToAgents(source) && !source.streaming &&
        sourceVersion(source) === scope.version && carryHash(source) === carryHash(snapshot.source);
    }, this.ports.now());
  }

  prepareMessage(provider: MemoryProvider, room: Room, message: StoredMessage, episode: MemoryEpisode, options: { renew?: boolean; carried?: boolean } = {}): Delivery {
    const identity = this.identity(provider.id, room, message.id, sourceVersion(message), "episode");
    return this.ports.outbox.deliveries.prepare(identity, opId => ({
      ...provider.writes!.episode(identity, opId, room, { ...episode, carryHash: `sha256:${carryHash(message)}` }, "message"),
      binding: { source: { ...messageSource(message), ...(identity.graphId === undefined ? {} : { graphId: identity.graphId }) }, seq: message.seq },
    }), this.ports.now(), options);
  }

  prepareOp(provider: MemoryProvider, room: Room, op: MemoryOp): Delivery {
    if (provider.generations) this.ports.outbox.bindOperationAccount(op, provider.generations.account);
    const opKey = this.ports.outbox.identifyWrite(op);
    const { deliveryKey: _key, ...content } = op.payload;
    const stableVersion = `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`;
    const identity = this.identity(provider.id, room, `${op.kind}-${opKey}`, stableVersion, op.kind === "fact" ? "fact" : "episode");
    const ts = Number(op.payload.ts) || op.createdAt;
    return this.ports.outbox.deliveries.prepare(identity, opId => op.kind === "fact" ? {
      ...provider.writes!.fact(identity, opId, room, { subject: String(op.payload.subject), predicate: String(op.payload.predicate), object: String(op.payload.object), ts }),
      binding: { opKey, original: { kind: "fact", fact: { subject: String(op.payload.subject), predicate: String(op.payload.predicate), object: String(op.payload.object), ts } } },
    } : {
      ...provider.writes!.episode(identity, opId, room, { sourceId: identity.sourceId, authorId: String(op.payload.authorId), authorName: String(op.payload.authorName), text: String(op.payload.text), ts }, "note"),
      binding: { opKey, original: { kind: "note", episode: { sourceId: identity.sourceId, authorId: String(op.payload.authorId), authorName: String(op.payload.authorName), text: String(op.payload.text), ts } },
        source: { kind: "note", authorId: String(op.payload.authorId), authorName: String(op.payload.authorName), ts,
        ...(identity.graphId === undefined ? {} : { graphId: identity.graphId }) } },
    }, this.ports.now());
  }

  private current(row: Delivery): boolean {
    const { identity } = row, room = this.ports.room(identity.roomId);
    if (!isPreparedDelivery(row) || !room || room.uuid !== identity.roomUuid || room.graphId !== identity.graphId || !this.ports.outbox.deliveries.accountMatches(identity, room.account) || !this.ports.outbox.deliveries.currentCopy(identity)) return false;
    if (this.ports.outbox.deliveries.unprovenSource(identity, room.account)) return false;
    if (this.routeGuards.has(row.opId) && this.routeGuards.get(row.opId) !== room.generationRevision) return false;
    if (row.payload.binding?.source?.kind === "message") {
      if (this.ports.outbox.importedSource(room.id, identity.sourceId)) return false;
      const message = this.ports.message(room.id, identity.sourceId);
      if (!message || !visibleToAgents(message) || message.streaming || sourceVersion(message) !== (row.sourceVersion ?? identity.version)) return false;
    }
    return room.remembers && this.ports.allowed(identity.provider, room.id);
  }

  private retireStale(row: Delivery): void {
    if (!isPreparedDelivery(row) || row.payload.binding?.source?.kind !== "message") return;
    const room = this.ports.room(row.identity.roomId);
    if (!room) return;
    if (this.ports.outbox.importedSource(room.id, row.identity.sourceId)) {
      this.ports.outbox.deliveries.retire(row.opId, "source_imported", this.ports.now());
      return;
    }
    const message = this.ports.message(room.id, row.identity.sourceId);
    if (room.uuid !== row.identity.roomUuid || !message || !visibleToAgents(message) || sourceVersion(message) !== (row.sourceVersion ?? row.identity.version))
      this.ports.outbox.deliveries.retire(row.opId, "source_changed_or_removed", this.ports.now());
  }

  async dispatch(provider: MemoryProvider, row: Delivery, signal: AbortSignal, readOnly = false, observer?: IngestionObserver,
    reads?: WriteTransport, claimed = false): Promise<Delivery> {
    const store = this.ports.outbox.deliveries;
    this.retireStale(row);
    row = store.get(row.opId)!;
    if (!store.dispatchAdmitted(row.opId)) {
      if (claimed && row.retiredAt !== null) store.releaseUndispatched(row.opId, row.attempts, this.ports.now());
      return store.get(row.opId)!;
    }
    if (!store.accountMatches(row.identity, provider.generations?.account) || !this.current(row)) {
      if (claimed) store.releaseUndispatched(row.opId, row.attempts, this.ports.now());
      store.deferUnavailable(row.opId, this.ports.now());
      return store.get(row.opId)!;
    }
    const base = this.transport(provider)!;
    if (row.groupId && (!this.ports.groupPreflight || !base.sourceBodyProof)) {
      if (claimed) store.releaseUndispatched(row.opId, row.attempts, this.ports.now());
      return store.get(row.opId)!;
    }
    if (base.advanceIndex) this.ports.outbox.episodeIndex.attachRoom(row.identity.roomId, row.identity.roomUuid);
    reads ??= base;
    const readsAllowed = !claimed && store.claimReads(row, this.ports.now());
    const transport = { ...reads, provider: base.provider, validate: base.validate.bind(base), reconcile: reads.reconcile.bind(reads),
      episodePresence: base.episodePresence?.bind(base),
      send: async (prepared: Parameters<typeof base.send>[0], abort?: AbortSignal) => {
        observe(observer, { kind: "provider.request", sourceId: row.identity.sourceId, data: { opId: prepared.opId, request: prepared.payload.request } });
        const result = await base.send(prepared, abort);
        observe(observer, { kind: result.state === "accepted" || result.state === "processed" ? "provider.accepted" : "provider.pending", sourceId: row.identity.sourceId,
          data: { opId: prepared.opId, ...result, processing: result.state === "processed" ? "Processing confirmed by the provider." : "Not observed; acceptance is not completed graph extraction." } });
        return result;
      } };
    try {
      this.routeGuards.set(row.opId, this.ports.room(row.identity.roomId)?.generationRevision);
      if (row.state === "prepared") await provider.ensureRoom({ uuid: row.identity.roomUuid, name: this.ports.room(row.identity.roomId)!.name,
        ...(row.identity.graphId === undefined ? {} : { graphId: row.identity.graphId }) });
      signal.throwIfAborted();
      this.retireStale(store.get(row.opId)!);
      if (!this.current(store.get(row.opId)!)) {
        if (claimed) store.releaseUndispatched(row.opId, row.attempts, this.ports.now());
        return store.get(row.opId)!;
      }
      if (claimed && !row.groupId && this.ports.beforeSend && !await this.ports.beforeSend(row, reads, signal)) {
        store.releaseUndispatched(row.opId, row.attempts, this.ports.now());
        return store.get(row.opId)!;
      }
      row = claimed ? await this.writer.sendAfterClaim(row.opId, transport, signal)
        : readOnly ? readsAllowed ? await this.writer.refresh(row.opId, transport, signal) : row
        : await this.writer.deliver(row.opId, transport, { signal, creditCap: this.ports.cap(), reads: readsAllowed });
      this.retireStale(row);
      row = store.get(row.opId)!;
      if (!signal.aborted && this.current(row) && store.crossCopyDuplicates(row))
        this.ports.outbox.watchVersion(provider.id, row.identity.roomId, row.identity.sourceId, row.identity.version, this.ports.now(), true);
      if (!signal.aborted && this.current(row)) store.acknowledge(row.opId, (_db, accepted) => {
        const { identity, payload } = accepted;
        if (identity.kind === "episode") for (const id of accepted.externalIds) {
          const foreign = store.foreignCopy(accepted.opId, id);
          const source = payload.binding?.source && accepted.sourceVersion ? { ...payload.binding.source, version: accepted.sourceVersion } : payload.binding?.source;
          this.ports.outbox.mapEpisode(provider.id, identity.roomId, identity.sourceId, id, source && foreign ? { ...source, boundCopy: foreign } : source, store.copyAccount(identity));
        }
        if (accepted.carried) this.ports.outbox.watchVersion(provider.id, identity.roomId, identity.sourceId, identity.version, this.ports.now());
        if (payload.binding?.seq !== undefined) this.ports.outbox.advance(provider.id, identity.roomId, payload.binding.seq);
        return undefined;
      });
      return store.get(row.opId)!;
    } catch (error) {
      if (["accepted", "processed"].includes(store.get(row.opId)!.state)) observe(observer, {
        kind: "provider.bookkeeping-failed", sourceId: row.identity.sourceId, data: { opId: row.opId, reason: "Acceptance is durable; local binding will be retried without sending again." },
      });
      if (!(error instanceof DeliveryBudgetError)) throw error;
      return store.get(row.opId)!;
    } finally {
      this.routeGuards.delete(row.opId);
      const saved = store.get(row.opId)!;
      const held = this.ports.outbox.sourceVersionHeld(row.identity.roomId, row.identity.sourceId);
      store.checkAfter(row.opId, Math.max(this.ports.now() + (held ? 24 * 60 * 60_000 : 30_000), saved.retryAt ?? 0));
      store.recordCheck(row.opId, this.ports.now());
      this.continueRead(row.opId, base);
      this.schedule(provider.id, row.identity.roomId, !!provider.writes?.transport.inventory, base);
    }
  }

  async drain(provider: MemoryProvider, room: string, signal: AbortSignal): Promise<WriteTransport | undefined> {
    if (!provider.writes || !this.ports.allowed(provider.id, room)) return undefined;
    const store = this.ports.outbox.deliveries, base = this.transport(provider)!, attached = this.ports.room(room), now = this.ports.now();
    const routeRevision = attached?.generationRevision;
    if (attached && base.advanceIndex) this.ports.outbox.episodeIndex.attachRoom(room, attached.uuid);
    if (attached) store.prepareWatches(provider.id, room, attached.uuid, now);
    const maintenance = attached && base.inventory ? store.maintenanceDue(provider.id, room, now, attached.uuid, attached.remembers, 16, attached) : [];
    const expected = new Set([...maintenance, ...store.due(provider.id, room, now, 16, attached ?? {})].map(row => row.opId));
    const reads = base.readCycle?.(expected, signal, this.ports.now) ?? base;
    const advance = async () => {
      if (attached &&
          (base.nextIndexRead?.(attached.uuid, attached.graphId) ?? Infinity) <= this.ports.now()) await reads.advanceIndex?.(attached.uuid, signal, attached.graphId);
    };
    const maintainRows = async () => { for (const row of maintenance) {
      signal.throwIfAborted();
      if (!store.claimReads(store.get(row.opId)!, this.ports.now())) continue;
      try {
        if (row.retiredAt === null && store.crossCopyDuplicates(store.get(row.opId)!)) {
          this.ports.outbox.watchVersion(provider.id, room, row.identity.sourceId, row.identity.version, this.ports.now(), true);
          store.maintainLater(row.opId, "processing", "version_duplicates_waiting", this.ports.now());
          continue;
        }
        await maintainDelivery({ outbox: this.ports.outbox, now: this.ports.now, removalGuard: this.ports.removalGuard, current: candidate => {
          const attached = this.ports.room(room);
          if (this.ports.outbox.importedSource(room, candidate.identity.sourceId)) return false;
          const live = this.ports.message(room, candidate.identity.sourceId);
          if (candidate.retiredAt !== null && live && sourceVersion(live) === (candidate.sourceVersion ?? candidate.identity.version)) return false;
          return !!attached && store.accountMatches(candidate.identity, provider.generations?.account) && attached.account === provider.generations?.account && attached.uuid === candidate.identity.roomUuid && attached.graphId === candidate.identity.graphId && attached.generationRevision === routeRevision && this.ports.allowed(provider.id, room) &&
            (candidate.retiredAt !== null ? candidate.cleanup === "pending" : candidate.state === "duplicates" && this.current(candidate));
        } }, provider, row, signal, reads, base);
      } finally { store.recordCheck(row.opId, this.ports.now()); this.continueRead(row.opId, base); }
    } };
    if (!attached?.remembers) { await maintainRows(); await advance(); this.schedule(provider.id, room, !!base.inventory, base); return reads; }
    const candidates = store.due(provider.id, room, this.ports.now(), 16, attached ?? {}).filter(row => this.writer.replayCandidate(row) && this.current(row));
    const claimed: Delivery[] = [];
    if (candidates.length) {
      const from = Math.min(...candidates.map(row => row.attemptedAt ?? this.ports.now())) - EPISODE_INDEX_CLOCK_MARGIN_MS;
      const fresh = base.readCycle?.(new Set(candidates.map(row => row.opId)), signal, this.ports.now, from);
      for (const row of candidates) {
        signal.throwIfAborted();
        if (!store.claimReads(store.get(row.opId)!, this.ports.now())) continue;
        try {
          if (await this.writer.decideReplay(row.opId, fresh ?? base, { signal, creditCap: this.ports.cap(), fresh: !fresh })) claimed.push(row);
        } finally { store.recordCheck(row.opId, this.ports.now()); this.continueRead(row.opId, base); }
      }
      try {
        for (const row of claimed) { signal.throwIfAborted(); await this.dispatch(provider, row, signal, false, undefined, fresh ?? base, true); }
      } finally {
        for (const row of claimed) store.releaseUndispatched(row.opId, store.get(row.opId)!.attempts, this.ports.now());
      }
    }
    await maintainRows();
    const sent = new Set(claimed.map(row => row.opId));
    for (const row of store.due(provider.id, room, this.ports.now(), 16, attached ?? {})) {
      if (sent.has(row.opId)) continue;
      signal.throwIfAborted();
      await this.dispatch(provider, row, signal, false, undefined, reads);
    }
    await advance();
    this.schedule(provider.id, room, !!base.inventory, base);
    return reads;
  }

  private continueRead(opId: string, transport: WriteTransport): void {
    const store = this.ports.outbox.deliveries, row = store.get(opId)!;
    const reason = store.maintenance(opId)?.reason ?? row.reason;
    if (reason !== "index_building" && reason !== "index_recent_incomplete") return;
    const at = transport.nextIndexRead?.(row.identity.roomUuid, row.identity.graphId);
    if (at !== null && at !== undefined) store.watches.continueAt(opId, at);
  }

  private schedule(provider: string, room: string, maintenance: boolean, transport?: WriteTransport): void {
    const attached = this.ports.room(room);
    const times = [attached?.remembers ? this.ports.outbox.deliveries.nextCheck(provider, room, attached) : null,
      attached && maintenance ? this.ports.outbox.deliveries.nextMaintenance(provider, room, attached.uuid, attached.remembers, attached) : null,
      attached ? transport?.nextIndexRead?.(attached.uuid, attached.graphId) : null]
      .filter((at): at is number => at !== null && at !== undefined);
    if (times.length) this.ports.wakeAfter(room, Math.max(1000, Math.min(...times) - this.ports.now()));
  }
}
