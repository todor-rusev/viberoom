// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { isPreparedDelivery, type Delivery, type WriteTransport } from "./delivery.js";
import { eraseEpisode } from "./episode-cleanup.js";
import type { MemoryOutbox } from "./outbox.js";
import { MemoryProviderError, type MemoryProvider } from "./provider.js";
import { EPISODE_INDEX_CLOCK_MARGIN_MS } from "./episode-index.js";

interface Ports {
  outbox: MemoryOutbox;
  now(): number;
  current(row: Delivery): boolean;
  removalGuard?(row: Delivery, id: string, reads: WriteTransport, signal: AbortSignal): Promise<(() => boolean) | null>;
}

export async function maintainDelivery(ports: Ports, provider: MemoryProvider, row: Delivery, signal: AbortSignal,
  reads: WriteTransport | undefined = provider.writes?.transport, transport: WriteTransport | undefined = provider.writes?.transport): Promise<void> {
  const { outbox } = ports, store = outbox.deliveries;
  if (row.retiredAt === null && store.groupedSource(row.identity.provider, row.identity.roomId, row.identity.sourceId,
    row.sourceVersion ?? row.identity.version, row.identity.graphId)) {
    store.maintainLater(row.opId, "watching", "group_duplicate_cleanup_unproven", ports.now());
    return;
  }
  if (!transport?.inventory || !reads?.inventory || !transport.episodePresence || !provider.captureEpisodeImpact || !provider.capabilities.forgetEpisode) return;
  const current = () => {
    signal.throwIfAborted();
    const saved = store.get(row.opId);
    return !signal.aborted && !!saved && store.accountMatches(saved.identity, provider.generations?.account) && saved.retiredAt === row.retiredAt && ports.current(saved);
  };
  const later = (state: "processing" | "watching" | "failed", reason: string) => store.maintainLater(row.opId, state, reason, ports.now());
  if (!current()) return;
  later("processing", "checking_episode_inventory");
  try {
    const listedFrom = ports.now();
    let inventory = await reads.inventory(row, signal);
    if (inventory.state === "complete" && row.retiredAt !== null && row.attemptedAt !== null && inventory.scan?.indexedFrom !== undefined &&
        inventory.scan.indexedFrom > row.attemptedAt - EPISODE_INDEX_CLOCK_MARGIN_MS) inventory = await transport.inventory!(row, signal);
    if (!current()) return;
    if (inventory.state !== "complete") { later("failed", inventory.reason); return; }
    const listingStarted = inventory.scan?.startedAt ?? listedFrom;
    store.rememberInventory(row.opId, inventory.episodes.map(e => e.id));
    const retired = row.retiredAt !== null;
    let canonicalId: string | null = null;
    let survivorEdges: string[] = [];
    const view = { uuid: row.identity.roomUuid, name: row.identity.roomId,
      ...(row.identity.graphId === undefined ? {} : { graphId: row.identity.graphId }) };
    if (!retired) {
      const candidate = inventory.episodes.filter(e => e.processed).map(e => e.id).sort()[0];
      if (!candidate) { later("processing", "episode_not_processed"); return; }
      canonicalId = store.chooseCanonical(row.opId, candidate, ports.now());
      const before = await provider.captureEpisodeImpact(view, canonicalId, signal);
      if (!current()) return;
      if (before.state !== "processed") { later("processing", "canonical_episode_not_processed_or_absent"); return; }
      survivorEdges = store.survivorEdges(row.opId, before.edgeIds);
    }
    const unprocessed = retired ? [] : inventory.episodes.filter(e => !e.processed && e.id !== canonicalId).map(e => e.id);
    const ids = inventory.episodes.filter(e => retired || e.processed && e.id > canonicalId!).map(e => e.id);
    const removed = store.removedEpisodes(row.opId);
    const unseen: string[] = [];
    for (const id of row.externalIds) if (id !== canonicalId && !removed.includes(id) && !ids.includes(id) && !unprocessed.includes(id)) {
      if (retired) ids.push(id);
      else if (id > canonicalId! && outbox.impacts.captured(provider.id, row.identity.roomUuid, id)) ids.push(id);
      else {
        unseen.push(id);
      }
    }
    for (const id of ids.slice(0, 8)) {
      if (!current()) return;
      const guard = retired && ports.removalGuard ? await ports.removalGuard(row, id, reads, signal) : () => true;
      if (!guard) { later("watching", "source_version_unproven"); return; }
      const result = await eraseEpisode(outbox, provider, view, id, signal, () => current() && guard(), true);
      if (result === "changed") return;
      if (result === "pending") { later("processing", "episode_not_processed"); return; }
      if (result === "unconfirmed") { later("processing", "episode_deletion_unconfirmed"); return; }
      if (result === "unseen") { unseen.push(id); continue; }
      store.confirmRemoval(row.opId, id, ports.now(), () => {
        outbox.dropEpisodeIds(provider.id, row.identity.roomId, row.identity.sourceId, [id], provider.generations?.account);
      });
    }
    if (ids.length > 8) { later("processing", "episode_cleanup_batch_pending"); return; }
    if (retired) {
      store.clearedBy(row.opId, listingStarted, inventory.scan?.indexedFrom);
      if (unseen.length) { later("processing", "receipt_not_visible"); return; }
      store.sourceDeleted(provider.id, row.identity.roomId, row.identity.roomUuid, row.identity.sourceId, row.opId, undefined, row.identity.graphId, provider.generations?.account);
      store.maintainLater(row.opId, store.get(row.opId)!.cleanup === "pending" ? "watching" : "cleaned",
        store.get(row.opId)!.cleanup === "pending" ? "late_acceptance_watch" : null, ports.now());
      return;
    }
    if (unseen.length) { later("processing", "receipt_not_visible"); return; }
    if (unprocessed.length) { later("processing", "episode_not_processed"); return; }
    const verified = await transport.inventory(store.get(row.opId)!, signal);
    if (!current()) return;
    if (verified.state !== "complete" || verified.episodes.length !== 1 || verified.episodes[0].id !== canonicalId || !verified.episodes[0].processed) {
      later("failed", verified.state === "complete" ? "survivor_verification_incomplete" : verified.reason); return;
    }
    const after = await provider.captureEpisodeImpact(view, canonicalId!, signal);
    if (!current()) return;
    if (after.state !== "processed" || survivorEdges.some(id => !after.edgeIds.includes(id))) {
      later("failed", "survivor_facts_need_repair"); return;
    }
    store.finishDuplicates(row.opId, canonicalId!, saved => {
      if (!isPreparedDelivery(saved) || !current()) throw new Error("Delivery changed during cleanup");
      outbox.dropEpisodeIds(provider.id, saved.identity.roomId, saved.identity.sourceId, saved.externalIds.filter(id => id !== canonicalId), provider.generations?.account);
      const source = saved.payload.binding?.source;
      outbox.mapEpisode(provider.id, saved.identity.roomId, saved.identity.sourceId, canonicalId!, source && saved.sourceVersion ? { ...source, version: saved.sourceVersion } : source, store.copyAccount(saved.identity));
    }, ports.now());
  } catch (error) {
    if (signal.aborted) throw error;
    later("failed", "episode_maintenance_failed");
    if (error instanceof MemoryProviderError && error.retryable) throw error;
  }
}
