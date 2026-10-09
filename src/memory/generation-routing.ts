// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { MemoryOutbox } from "./outbox.js";
import { MemoryWriteCancelled, type MemoryProvider } from "./provider.js";
import { baseGenerationId, GenerationError, MemoryGraphCoordinator, type GenerationSwitchGate } from "./graph-generations.js";

export interface RoutingRoom { id: string; uuid: string; name: string; remembers: boolean }
export interface RoutedRoom extends RoutingRoom { graphId?: string; generationRevision?: string; generationCheck?: boolean; account?: string }
export interface GraphLease { room: RoutedRoom; current(): boolean }
interface Ports {
  outbox: MemoryOutbox;
  room(id: string): RoutingRoom | null;
  allowed(provider: MemoryProvider): boolean;
  now(): number;
  monotonic?(): number;
  beforeFollow(provider: string, room: string): void;
}

export class MemoryGenerationRouting {
  private readonly coordinators = new WeakMap<MemoryProvider, Map<string, MemoryGraphCoordinator>>();
  private readonly chains = new Map<string, Promise<unknown>>();
  constructor(private readonly ports: Ports) {}
  private coordinator(provider: MemoryProvider, uuid: string): MemoryGraphCoordinator {
    let rooms = this.coordinators.get(provider);
    if (!rooms) this.coordinators.set(provider, rooms = new Map());
    let coordinator = rooms.get(uuid);
    if (!coordinator) rooms.set(uuid, coordinator = new MemoryGraphCoordinator(this.ports.outbox.generations, provider.generations!, provider.id, uuid, this.ports.now, undefined, this.ports.monotonic));
    return coordinator;
  }
  view(provider: MemoryProvider, room: RoutingRoom): RoutedRoom | null {
    if (!this.ports.allowed(provider)) return null;
    if (!provider.generations) return { ...room };
    const scope = this.coordinator(provider, room.uuid).scope, head = this.ports.outbox.generations.head(scope);
    const applied = this.ports.outbox.generationAttachment(provider.id, room.id);
    if (!head.route || head.reason || head.followPending || !applied || applied.account !== scope.account || applied.uuid !== room.uuid ||
        applied.revision !== head.revision || !this.ports.outbox.deliveries.currentCopy({ provider: provider.id, roomId: room.id, roomUuid: room.uuid, copyId: applied.copy })) return null;
    return { ...room, ...(head.route.graphId === baseGenerationId(room.uuid) ? {} : { graphId: head.route.graphId }),
      generationRevision: head.revision, generationCheck: applied.check, account: scope.account };
  }
  current(provider: MemoryProvider, leased: RoutedRoom): boolean {
    const live = this.ports.room(leased.id), view = live && this.view(provider, live);
    return !!view && view.uuid === leased.uuid && view.graphId === leased.graphId && view.generationRevision === leased.generationRevision && view.account === leased.account;
  }
  async resolve(provider: MemoryProvider, room: RoutingRoom, signal: AbortSignal, create: boolean | (() => boolean) = false, permitted: () => boolean = () => true): Promise<GraphLease | null> {
    const work = async () => {
      signal.throwIfAborted();
      if (!provider.generations) {
        const leased = Object.freeze({ ...room }); return { room: leased, current: () => !signal.aborted && permitted() && this.current(provider, leased) };
      }
      const coordinator = this.coordinator(provider, room.uuid), store = this.ports.outbox.generations;
      let copy = this.ports.outbox.deliveries.copy(provider.id, room.id, room.uuid);
      const attached = () => !signal.aborted && permitted() && this.ports.allowed(provider) && this.ports.room(room.id)?.uuid === room.uuid &&
        this.ports.outbox.deliveries.currentCopy({ provider: provider.id, roomId: room.id, roomUuid: room.uuid, copyId: copy });
      if (!attached()) throw new GenerationError("generation_attachment_changed", true);
      let head;
      try { head = await coordinator.refresh(signal); }
      catch (error) {
        const attachment = this.ports.outbox.generationAttachment(provider.id, room.id);
        if (!(error instanceof GenerationError) || error.reason !== "generation_anchor_missing" || store.head(coordinator.scope).route ||
            attachment?.account === coordinator.scope.account) throw error;
        if (!attached()) throw new GenerationError("generation_attachment_changed", true);
        const canCreate = () => attached() && (typeof create === "function" ? create() : create);
        if (!canCreate()) return null;
        try {
          await provider.ensureRoom({ uuid: room.uuid, name: room.name }, () => { if (!canCreate()) throw new MemoryWriteCancelled(); });
        } catch (error) { if (error instanceof MemoryWriteCancelled) return null; throw error; }
        if (!attached()) throw new GenerationError("generation_attachment_changed", true);
        head = await coordinator.refresh(signal);
      }
      if (!attached()) throw new GenerationError("generation_attachment_changed", true);
      const follow = () => {
        if (!attached() || store.head(coordinator.scope).revision !== head.revision) throw new GenerationError("generation_attachment_changed", true);
        const old = this.ports.outbox.generationAttachment(provider.id, room.id);
        const deliveries = this.ports.outbox.deliveries;
        if (old) {
          const previous = { provider: provider.id, roomId: room.id, roomUuid: old.uuid, copyId: old.copy };
          if (deliveries.copyAccount(previous) === null) {
            deliveries.bindAccount(previous, old.account);
          }
        }
        const identity = () => ({ provider: provider.id, roomId: room.id, roomUuid: room.uuid, copyId: copy });
        const owner = deliveries.copyAccount(identity());
        const unproven = owner === null && deliveries.copyHasDispatchedDeliveries(identity());
        if ((owner !== null && owner !== coordinator.scope.account) || unproven) copy = deliveries.rotateCopy(provider.id, room.id, room.uuid);
        deliveries.bindAccount(identity(), coordinator.scope.account);
        this.ports.beforeFollow(provider.id, room.id);
        this.ports.outbox.followGeneration(coordinator.scope, room.id, copy, head.revision, head.route!, unproven);
      };
      if (head.followPending) {
        if (!store.completeFollow(coordinator.scope, head.revision, follow)) throw new GenerationError("generation_observation_changed", true);
      } else store.transaction(follow);
      const leased = this.view(provider, room);
      if (!leased) throw new GenerationError("generation_follow_incomplete", true);
      Object.freeze(leased);
      return { room: leased, current: () => !signal.aborted && permitted() && this.current(provider, leased) };
    };
    return this.serialized(provider, room.uuid, work);
  }
  async prepareSwitch(provider: MemoryProvider, uuid: string, graphId: string, sourceFingerprint: string,
    approvalId: string, gate: GenerationSwitchGate, signal: AbortSignal) {
    if (!provider.generations) throw new GenerationError("generation_adapter_unavailable");
    return this.serialized(provider, uuid, () => this.coordinator(provider, uuid).prepareSwitch(graphId, sourceFingerprint, approvalId, gate, signal));
  }
  private async serialized<T>(provider: MemoryProvider, uuid: string, work: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([provider.id, provider.generations?.account, uuid]);
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.chains.set(key, next);
    try { return await next; } finally { if (this.chains.get(key) === next) this.chains.delete(key); }
  }
  inspectCurrent<T, R>(provider: MemoryProvider, lease: GraphLease, signal: AbortSignal, permitted: () => boolean,
    read: () => Promise<T>, finish: (value: T) => R): Promise<R> {
    return this.serialized(provider, lease.room.uuid, async () => {
      const current = () => !signal.aborted && permitted() === true && lease.current();
      const check = async () => {
        signal.throwIfAborted();
        if (!current() || !provider.generations) throw new GenerationError("generation_attachment_changed", true);
        await this.coordinator(provider, lease.room.uuid).refresh(signal);
        if (!current()) throw new GenerationError("generation_attachment_changed", true);
      };
      await check();
      const value = await read();
      await check();
      return finish(value);
    });
  }
  async advanceSwitch(provider: MemoryProvider, uuid: string, id: string, gate: GenerationSwitchGate, signal: AbortSignal) {
    if (!provider.generations) throw new GenerationError("generation_adapter_unavailable");
    return this.serialized(provider, uuid, () => this.coordinator(provider, uuid).advanceSwitch(id, gate, signal));
  }
}
