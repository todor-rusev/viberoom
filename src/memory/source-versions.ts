// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { StoredMessage } from "../history-store.js";
import { visibleToAgents } from "../quotes.js";
import { isPreparedDelivery, type Delivery, type ListedEpisode, type SourceListing, type WriteTransport } from "./delivery.js";
import { eraseEpisode } from "./episode-cleanup.js";
import type { MemoryOp, MemoryOutbox } from "./outbox.js";
import { sourceVersion } from "./provenance.js";
import type { MemoryProvider } from "./provider.js";
import { canonicalParts } from "./version-check.js";
import { EPISODE_INDEX_CLOCK_MARGIN_MS, THROTTLE_WAIT_MS, throttledIndexRead } from "./episode-index.js";
import { isDeepStrictEqual } from "node:util";
import { UNKNOWN_REPLAY_WAIT_MS } from "./delivery.js";
import { freshCompleteReadTimes } from "./delivery-read-freshness.js";
import { GROUP_BODY_PROOF_LIMITS, GROUP_ORIGINAL_BYTE_LIMIT, GROUP_PREFIX_BYTE_LIMIT, immutableGroupPins, matchesOwnGroupEpisode, type GroupPreflightResult } from "./group-preflight.js";
import type { PartGroup } from "./part-group.js";

interface Room { id: string; uuid: string; name: string; remembers: boolean; graphId?: string; generationRevision?: string; account?: string }
interface Ports {
  outbox: MemoryOutbox;
  room(id: string): Room | null;
  message(room: string, id: string): StoredMessage | null;
  revision(room: string, id: string): string | null;
  relation(room: string, id: string, hash: string): "current" | "ancestor" | "unknown";
  allowed(provider: string, room: string): boolean;
  groupSourceCurrent?(group: Readonly<PartGroup>, source: StoredMessage): boolean;
  now(): number;
  wakeAfter(room: string, ms: number): void;
  note?(room: string, text: string): void;
}

export const SOURCE_CHECK_RETRY_LIMIT = 5;
export const MEMORY_THROTTLE_NOTICE_QUIET_MS = 5 * 60_000;
type Inspection = { state: "complete"; same: ListedEpisode[]; ancestors: ListedEpisode[]; unknown: ListedEpisode[]; current(): boolean }
  | { state: "unknown"; reason: string };

export class MemorySourceVersions {
  private readonly throttleNoted = new Map<string | undefined, number>();
  constructor(private readonly ports: Ports) {}

  private version(room: string, id: string): string | null {
    const row = this.ports.message(room, id);
    return row && visibleToAgents(row) ? sourceVersion(row) : null;
  }

  private classify(provider: string, room: Room, id: string, episode: ListedEpisode): "same" | "ancestor" | "unknown" {
    const version = this.version(room.id, id);
    if (version !== null && episode.version === version) return "same";
    if (episode.legacy) {
      const projected = this.ports.outbox.deliveries.projectedReceiptVersion(provider, room.uuid, id, episode.id, episode.version, room.account);
      if (version !== null && projected === version) return "same";
      if (projected && episode.carryHash && this.ports.relation(room.id, id, episode.carryHash) === "ancestor") return "ancestor";
      return version !== null && episode.carryHash && this.ports.relation(room.id, id, episode.carryHash) === "current" ? "same" : "unknown";
    }
    return episode.carryHash && this.ports.relation(room.id, id, episode.carryHash) === "ancestor" ? "ancestor" : "unknown";
  }

  represents(provider: string, room: Room, id: string, episode: ListedEpisode): boolean { return this.classify(provider, room, id, episode) === "same"; }

  private async inspect(provider: string, room: Room, id: string, reads: WriteTransport, signal: AbortSignal,
    supplied?: SourceListing, remembering = false): Promise<Inspection> {
    room = { ...room };
    const revision = this.ports.revision(room.id, id), version = this.version(room.id, id);
    const current = () => !signal.aborted && this.ports.allowed(provider, room.id) && this.ports.room(room.id)?.uuid === room.uuid &&
      !this.ports.outbox.importedSource(room.id, id) &&
      this.ports.room(room.id)?.graphId === room.graphId && this.ports.room(room.id)?.account === room.account &&
      this.ports.room(room.id)?.generationRevision === room.generationRevision &&
      (!remembering || !!this.ports.room(room.id)?.remembers) &&
      this.ports.revision(room.id, id) === revision && this.version(room.id, id) === version;
    const listed = supplied ?? await reads.sources!(room.uuid, signal, this.ports.now, room.graphId);
    if (!current()) return { state: "unknown", reason: "source_changed_during_check" };
    if (listed.state !== "complete") return { state: "unknown", reason: listed.reason };
    let episodes = listed.bySource.get(id) ?? [];
    if (reads.sourceEpisodes) {
      const fresh = await reads.sourceEpisodes(room.uuid, id, signal, room.graphId);
      if (!current()) return { state: "unknown", reason: "source_changed_during_check" };
      if (fresh.state !== "complete") return { state: "unknown", reason: fresh.reason };
      episodes = fresh.episodes;
    } else {
      const present: ListedEpisode[] = [];
      if (episodes.length && !reads.episodePresence) return { state: "unknown", reason: "source_presence_unavailable" };
      for (const episode of episodes) {
        const presence = await reads.episodePresence!(episode.id, signal);
        if (!current()) return { state: "unknown", reason: "source_changed_during_check" };
        if (presence === "unknown") return { state: "unknown", reason: "source_presence_unavailable" };
        if (presence === "present") present.push(episode);
      }
      episodes = present;
    }
    const result: Inspection = { state: "complete", same: [], ancestors: [], unknown: [], current };
    for (const episode of episodes.filter(e => e.kind === "message" && e.sourceId === id)) {
      const kind = this.classify(provider, room, id, episode);
      result[kind === "same" ? "same" : kind === "ancestor" ? "ancestors" : "unknown"].push(episode);
    }
    return result;
  }

  private async olderLeaving(provider: string, room: Room, id: string, reads: WriteTransport, signal: AbortSignal, result: Extract<Inspection, { state: "complete" }>): Promise<boolean> {
    const outbox = this.ports.outbox, version = this.version(room.id, id) ?? undefined;
    if (outbox.deliveries.unprovenSource({ provider, roomId: room.id, roomUuid: room.uuid, sourceId: id, graphId: room.graphId }, room.account)) {
      this.wait(room, id, "account_ownership_unknown", reads); return true;
    }
    let blocker = outbox.replacementBlocker(provider, room.id, room.uuid, id, version, room.graphId, room.account);
    if (blocker?.kind === "version" && reads.inventory) {
      outbox.deliveries.maintainLater(blocker.delivery.opId, "watching", "checking_source_predecessor", this.ports.now());
      const exact = blocker.delivery.attemptedAt !== null ? reads.readCycle?.(new Set([blocker.delivery.opId]), signal, this.ports.now,
        blocker.delivery.attemptedAt - EPISODE_INDEX_CLOCK_MARGIN_MS) : undefined;
      const from = this.ports.now(), inventory = await (exact ?? reads).inventory!(blocker.delivery, signal);
      if (!result.current()) return true;
      if (inventory.state === "complete" && !inventory.episodes.length)
        outbox.deliveries.clearedBy(blocker.delivery.opId, inventory.scan?.startedAt ?? from, inventory.scan?.indexedFrom);
      blocker = outbox.replacementBlocker(provider, room.id, room.uuid, id, version, room.graphId, room.account);
    }
    if (!blocker) return false;
    this.wait(room, id, "older_version_leaving", reads); return true;
  }

  incompleteRead(roomId: string, id: string, reason: string, retryAt: number, revision?: number): boolean {
    const now = this.ports.now();
    if (this.ports.outbox.exhaustedSourceCheck(roomId, id) !== null) return false;
    if (this.ports.outbox.sourceVersionRetries(roomId, id) < SOURCE_CHECK_RETRY_LIMIT) {
      if (this.ports.outbox.holdSourceVersion(roomId, id, reason, now, retryAt, true, revision)) this.ports.wakeAfter(roomId, Math.max(0, retryAt - now));
      return true;
    }
    const first = this.ports.outbox.exhaustedSourceChecks(roomId) === 0;
    if (this.ports.outbox.holdSourceVersion(roomId, id, `source_check_exhausted:${reason}`, now, undefined, false, revision) && first)
      this.ports.note?.(roomId, `Long-term memory could not confirm one message in its graph: ${SOURCE_CHECK_RETRY_LIMIT} reads in a row came back incomplete or stale (${reason}), so the message is not confirmed in the long-term memory. Edit the message, or use Check again in the memory registry. Other messages that cannot be confirmed are listed there, not here.`);
    return false;
  }

  private hold(room: Room, id: string, reason: string, reads: WriteTransport): void {
    if (throttledIndexRead(reason)) {
      const now = this.ports.now(), retryAt = Math.max(now + 1000, reads.nextIndexRead?.(room.uuid, room.graphId) ?? now + THROTTLE_WAIT_MS.first);
      if (this.ports.outbox.holdSourceVersion(room.id, id, reason, now, retryAt, false)) this.ports.wakeAfter(room.id, retryAt - now);
      this.throttled(room.id);
      return;
    }
    this.incompleteRead(room.id, id, reason, this.retryAt(room, reads));
  }

  throttled(roomId: string): void {
    const room = this.ports.room(roomId);
    if (!room) return;
    const noted = this.throttleNoted.has(room.account);
    this.throttleNoted.set(room.account, this.ports.now());
    if (noted) return;
    this.ports.note?.(roomId, "Long-term memory is waiting: Zep is limiting this account's requests (429), as it does when the account's rate or usage quota is used up. Nothing is lost; the memory goes on at the pace Zep allows, in every room using this account. If this lasts, check the account's usage in Zep.");
  }

  readBack(roomId: string): void {
    const room = this.ports.room(roomId);
    if (!room) return;
    const last = this.throttleNoted.get(room.account);
    if (last !== undefined && this.ports.now() - last >= MEMORY_THROTTLE_NOTICE_QUIET_MS) this.throttleNoted.delete(room.account);
  }

  private wait(room: Room, id: string, reason: string, reads: WriteTransport): void { this.defer(room, id, reason, reads, false); }

  private holdForGood(room: Room, id: string, reason: string): void { this.ports.outbox.holdSourceVersion(room.id, id, reason, this.ports.now()); }

  private defer(room: Room, id: string, reason: string, reads: WriteTransport, counted: boolean): void {
    const now = this.ports.now(), retryAt = this.retryAt(room, reads);
    if (this.ports.outbox.holdSourceVersion(room.id, id, reason, now, retryAt, counted)) this.ports.wakeAfter(room.id, retryAt - now);
  }

  private retryAt(room: Room, reads: WriteTransport): number {
    const now = this.ports.now(), next = reads.nextIndexRead?.(room.uuid, room.graphId);
    return Math.max(now + 1000, Math.min(now + 30_000, next ?? now + 30_000));
  }

    async ready(provider: string, room: Room, id: string, reads: WriteTransport, signal: AbortSignal, listing?: SourceListing): Promise<boolean> {
    if (this.ports.outbox.importedSource(room.id, id)) return false;
    if (!reads.sources) return true;
    const result = await this.inspect(provider, room, id, reads, signal, listing, true);
    if (result.state !== "complete") { if (result.reason !== "source_changed_during_check") this.hold(room, id, result.reason, reads); return false; }
    this.readBack(room.id);
    if (result.ancestors.length) {
      this.ports.outbox.ensureForget(provider, room.id, id, room.uuid, room.graphId);
      this.ports.wakeAfter(room.id, 1000);
    }
    if (result.unknown.length) { this.holdForGood(room, id, "source_replaced_elsewhere"); return false; }
    if (await this.olderLeaving(provider, room, id, reads, signal, result)) return false;
    return result.current();
  }

  async beforeSend(row: Delivery, reads: WriteTransport, signal?: AbortSignal): Promise<boolean> {
    if (row.groupId) { const result = await this.groupPreflight(row, reads, signal); return result.kind === "send" && result.current(); }
    if (this.ports.outbox.deliveries.groupedSource(row.identity.provider, row.identity.roomId, row.identity.sourceId,
      row.sourceVersion ?? row.identity.version, row.identity.graphId)) return false;
    if (!isPreparedDelivery(row) || row.payload.binding?.source?.kind !== "message" || !reads.sources) return true;
    if (this.ports.outbox.importedSource(row.identity.roomId, row.identity.sourceId)) return false;
    if (this.ports.outbox.exhaustedSourceCheck(row.identity.roomId, row.identity.sourceId) !== null) return false;
    const room = this.ports.room(row.identity.roomId);
    if (!room?.remembers || room.uuid !== row.identity.roomUuid || room.graphId !== row.identity.graphId || !this.ports.outbox.deliveries.accountMatches(row.identity, room.account)) return false;
    const abort = signal ?? new AbortController().signal;
    const result = await this.inspect(row.identity.provider, room, row.identity.sourceId, reads, abort, undefined, true);
    if (result.state === "unknown") { if (result.reason !== "source_changed_during_check") this.hold(room, row.identity.sourceId, result.reason, reads); return false; }
    this.readBack(room.id);
    if (result.ancestors.length) {
      this.ports.outbox.ensureForget(row.identity.provider, room.id, row.identity.sourceId, room.uuid, room.graphId);
      this.ports.wakeAfter(room.id, 1000);
    }
    if (result.unknown.length) { this.holdForGood(room, row.identity.sourceId, "source_replaced_elsewhere"); return false; }
    if (await this.olderLeaving(row.identity.provider, room, row.identity.sourceId, reads, abort, result)) return false;
    if (result.same.length && !row.externalIds.length && (row.state === "unknown" || row.state === "prepared" && (row.attempts === 0 || row.replays > 0))) {
      const parts = canonicalParts(result.same), episode = parts?.find(e => e.part === row.identity.part);
      if (!episode) { this.wait(room, row.identity.sourceId, "not_processed_yet", reads); return false; }
      this.ports.outbox.deliveries.releaseUndispatched(row.opId, row.attempts, this.ports.now());
      const saved = this.ports.outbox.deliveries.get(row.opId);
      if (result.current() && saved?.attempts === row.attempts && !saved.externalIds.length && (saved.state === "unknown" || saved.state === "prepared"))
        this.ports.outbox.deliveries.adopt(row.opId, episode.id, this.ports.now(), saved.attempts, episode.copyId ?? "unknown");
      return false;
    }
    return result.current();
  }

  async groupPreflight(row: Delivery, reads: WriteTransport, signal?: AbortSignal): Promise<GroupPreflightResult> {
    const store = this.ports.outbox.deliveries, abort = signal ?? new AbortController().signal;
    let group;
    try { group = row.groupId && store.getPartGroup(row.groupId); } catch { return { kind: "hold", reason: "group_corrupt" }; }
    const found = this.ports.room(row.identity.roomId);
    if (!group || group.retired || !found || !isPreparedDelivery(row)) return { kind: "hold", reason: "group_unavailable" };
    const room = { ...found }, revision = this.ports.revision(room.id, row.identity.sourceId), version = this.version(room.id, row.identity.sourceId);
    const immutable = immutableGroupPins(group);
    const current = () => {
      const attached = this.ports.room(room.id), message = this.ports.message(room.id, row.identity.sourceId);
      try {
        const saved = store.getPartGroup(group.groupId);
        if (!saved || !isDeepStrictEqual(immutableGroupPins(saved), immutable)) return false;
      } catch { return false; }
      return !abort.aborted && this.ports.allowed(row.identity.provider, room.id) && !!attached?.remembers &&
        attached.uuid === room.uuid && attached.graphId === room.graphId && attached.account === room.account &&
        attached.generationRevision === room.generationRevision && !this.ports.outbox.importedSource(room.id, row.identity.sourceId) &&
        this.ports.revision(room.id, row.identity.sourceId) === revision && this.version(room.id, row.identity.sourceId) === version &&
        !!message && visibleToAgents(message) && !message.streaming && version === row.identity.version &&
        (this.ports.groupSourceCurrent?.(group, message) ?? true) &&
        room.uuid === row.identity.roomUuid && room.graphId === row.identity.graphId && store.currentCopy(row.identity) &&
        store.accountMatches(row.identity, room.account) && !store.unprovenSource(row.identity, room.account) &&
        !this.ports.outbox.replacementBlocker(row.identity.provider, room.id, room.uuid, row.identity.sourceId, version, room.graphId, room.account);
    };
    const hold = (reason: string, read: "incomplete" | "complete" = "incomplete"): GroupPreflightResult => {
      if (current()) this[read === "incomplete" ? "hold" : "wait"](room, row.identity.sourceId, reason, reads);
      return { kind: "hold", reason };
    };
    if (!current() || reads.provider !== "zep" || row.identity.provider !== "zep" || !group.account || group.account !== room.account)
      return { kind: "hold", reason: "group_authority_changed" };
    const setAside = this.ports.outbox.exhaustedSourceCheck(room.id, row.identity.sourceId);
    if (setAside !== null) return { kind: "hold", reason: setAside };
    if (!reads.sourceBodyProof || !reads.sources) return hold("group_native_proof_unavailable");
    const inspected = await this.inspect(row.identity.provider, room, row.identity.sourceId, reads, abort, undefined, true);
    if (!current() || inspected.state !== "complete") return hold(inspected.state === "unknown" ? inspected.reason : "group_authority_changed");
    if (inspected.ancestors.length || inspected.unknown.length) return hold("group_source_predecessor_unproven");
    const scope = { provider: "zep" as const, account: group.account, roomUuid: room.uuid, sourceId: row.identity.sourceId,
      version: row.identity.version, ...(room.graphId === undefined ? {} : { graphId: room.graphId }) };
    let proof;
    try { proof = await reads.sourceBodyProof({ scope, limits: { ...GROUP_BODY_PROOF_LIMITS } }, abort, current); }
    catch { return hold("group_native_proof_failed"); }
    if (!current()) return { kind: "hold", reason: "group_authority_changed" };
    let saved;
    try { saved = store.getPartGroup(group.groupId); } catch { return hold("group_corrupt"); }
    if (!saved || !isDeepStrictEqual(saved, group)) return hold("group_progress_changed");
    if (!proof || proof.state !== "complete" || !Array.isArray(proof.episodes) || !isDeepStrictEqual(proof.scope, scope) ||
      !freshCompleteReadTimes(proof.scan, this.ports.now(), group.members.map(member => member.updatedAt))) return hold("group_native_proof_incomplete");
    const own = proof.episodes.filter(episode => episode.copyId === group.identity.copyId || group.members.some(member => member.opId === episode.opId));
    if (own.some(episode => !matchesOwnGroupEpisode(group, episode))) return hold("group_own_body_mismatch");
    if (new Set(proof.episodes.map(episode => episode.id)).size !== proof.episodes.length) return hold("group_native_proof_incomplete");
    for (const member of group.members) {
      if (member.externalIds.length && !member.carried && !member.externalIds.every(id => own.some(episode => episode.id === id && episode.opId === member.opId)))
        return hold("group_own_receipt_unconfirmed");
    }
    const foreign = proof.episodes.filter(episode => !own.includes(episode));
    if (foreign.length) {
      if (own.length || group.members.some(member => member.externalIds.length)) return hold("group_mixed_own_foreign_progress");
      for (const member of group.members) {
        const attempt = store.latestAttemptStatus(member.opId);
        if (member.state === "unknown" && attempt?.dispatchedAt !== null &&
          (member.attemptedAt === null || proof.scan.startedAt < member.attemptedAt + UNKNOWN_REPLAY_WAIT_MS)) return hold("group_unknown_waiting", "complete");
      }
      const adopted = store.adoptPartGroup({ group, scope, proof, maxOriginalBytes: GROUP_ORIGINAL_BYTE_LIMIT,
        maxPrefixBytes: GROUP_PREFIX_BYTE_LIMIT }, current, this.ports.now());
      return adopted.kind === "adopted" ? { kind: "adopted", group: adopted.group } : hold(adopted.reason);
    }
    if (group.members.some(member => member.carried || member.externalIds.some(id => store.foreignCopy(member.opId, id))))
      return hold("group_foreign_receipt_unconfirmed");
    if (own.some(episode => episode.opId === row.opId) && (row.state === "prepared" || row.state === "unknown"))
      return hold("group_own_operation_present");
    return current() ? { kind: "send", current } : { kind: "hold", reason: "group_authority_changed" };
  }

  async observe(provider: string, room: Room, listing: SourceListing, reads: WriteTransport, signal: AbortSignal): Promise<void> {
    if (listing.state !== "complete" || !this.ports.allowed(provider, room.id) || this.ports.room(room.id)?.uuid !== room.uuid || this.ports.room(room.id)?.graphId !== room.graphId) return;
    for (const [id, episodes] of listing.bySource) {
      signal.throwIfAborted();
      if (this.ports.outbox.importedSource(room.id, id)) continue;
      if (!this.ports.revision(room.id, id)) continue;
      if (episodes.some(e => e.kind === "message" && this.classify(provider, room, id, e) === "ancestor") &&
          !this.ports.outbox.pendingForget(provider, room.id, id, room.uuid, room.graphId)) {
        const fresh = await this.inspect(provider, room, id, reads, signal, listing);
        if (fresh.state !== "complete" || !fresh.ancestors.length) continue;
        this.ports.outbox.ensureForget(provider, room.id, id, room.uuid, room.graphId);
        this.ports.wakeAfter(room.id, 1000);
      }
    }
  }

  async cleanup(provider: MemoryProvider, room: Room, op: MemoryOp, reads: WriteTransport, signal: AbortSignal): Promise<string | null> {
    if (provider.generations && (op.account !== provider.generations.account || room.account !== provider.generations.account)) return "account_changed";
    if (op.payload.graphId !== room.graphId) return "graph_generation_changed";
    if (!reads.sources) return null;
    const id = String(op.payload.sourceId);
    if (this.ports.outbox.importedSource(room.id, id)) return "imported_source_read_only";
    const result = await this.inspect(provider.id, room, id, reads, signal);
    if (result.state !== "complete") return result.reason;
    const targets = this.ports.outbox.rememberSourceCleanup(op, result.ancestors);
    for (const episode of targets.slice(0, 8)) {
      if (this.classify(provider.id, room, id, episode) === "same") {
        this.ports.outbox.sourceCleanupTargetDone(op, episode.id, false);
        continue;
      }
      const current = () => result.current() && this.classify(provider.id, room, id, episode) === "ancestor";
      const presence = await reads.episodePresence?.(episode.id, signal);
      if (!result.current()) return "source_changed_during_check";
      if (presence === "absent") {
        if (this.ports.outbox.impacts.captured(provider.id, room.uuid, episode.id)) this.ports.outbox.impacts.deleted(provider.id, room.uuid, episode.id);
        this.ports.outbox.sourceCleanupTargetDone(op, episode.id); continue;
      }
      if (presence !== "present") return "source_presence_unavailable";
      if (!current()) return "source_replaced_elsewhere";
      if (!result.ancestors.some(e => e.id === episode.id && e.version === episode.version && e.carryHash === episode.carryHash)) return "cleanup_identity_changed";
      const erased = await eraseEpisode(this.ports.outbox, provider, room, episode.id, signal, current, true);
      if (erased !== "deleted") return erased === "pending" ? "episode_not_processed" : erased === "unconfirmed" ? "episode_deletion_unconfirmed" : "source_changed_during_check";
      this.ports.outbox.sourceCleanupTargetDone(op, episode.id);
    }
    return targets.length > 8 ? "episode_cleanup_batch_pending" : result.unknown.length ? "source_replaced_elsewhere" : null;
  }

  async removalGuard(row: Delivery, id: string, reads: WriteTransport, signal: AbortSignal): Promise<(() => boolean) | null> {
    const room = this.ports.room(row.identity.roomId);
    if (!room || room.uuid !== row.identity.roomUuid || room.graphId !== row.identity.graphId || !this.ports.outbox.deliveries.accountMatches(row.identity, room.account)) return null;
    if (!reads.sources || row.identity.kind !== "episode") return () => !signal.aborted;
    const result = await this.inspect(row.identity.provider, room, row.identity.sourceId, reads, signal);
    if (result.state !== "complete") return null;
    const ancestor = result.ancestors.find(e => e.id === id);
    if (ancestor) return () => result.current() && this.classify(row.identity.provider, room, row.identity.sourceId, ancestor) === "ancestor";
    if (result.same.some(e => e.id === id) || result.unknown.some(e => e.id === id)) return null;
    const presence = await reads.episodePresence?.(id, signal);
    return presence === "absent" && result.current() ? result.current : null;
  }
}
