// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { Delivery, ListedEpisode, SourceListing, WriteTransport } from "./delivery.js";
import { eraseEpisode } from "./episode-cleanup.js";
import type { MemoryOutbox } from "./outbox.js";
import type { EpisodeSource, MemoryProvider } from "./provider.js";

interface Ports {
  outbox: MemoryOutbox;
  now(): number;
  current(sourceId?: string, version?: string): boolean;
}
interface Stake { sourceId: string; version: string; part: string; rows: Delivery[]; links: Array<{ id: string; source: EpisodeSource }> }

const DELETES_PER_PASS = 8;

export async function cleanVersionDuplicates(ports: Ports, provider: MemoryProvider, room: { id: string; uuid: string; name: string; graphId?: string; account?: string },
  listing: Extract<SourceListing, { state: "complete" }>, signal: AbortSignal, reads?: WriteTransport): Promise<number> {
  room = { ...room };
  const account = provider.generations?.account;
  const inAccount = () => !signal.aborted && provider.generations?.account === account && (account === undefined || room.account === account);
  if (!inAccount()) return 0;
  const { outbox } = ports, store = outbox.deliveries, presence = provider.writes?.transport.episodePresence?.bind(provider.writes.transport);
  if (!provider.capabilities.forgetEpisode || !provider.captureEpisodeImpact || !presence) return 0;
  const view = { uuid: room.uuid, name: room.name, ...(room.graphId === undefined ? {} : { graphId: room.graphId }) }, listed = new Map<string, ListedEpisode>();
  for (const episodes of listing.bySource.values()) for (const episode of episodes) listed.set(episode.id, episode);
  const stakes = new Map<string, Stake>();
  const stake = (sourceId: string, version: string, part: string): Stake => {
    const key = JSON.stringify([account, sourceId, version, part]);
    if (!stakes.has(key)) stakes.set(key, { sourceId, version, part, rows: [], links: [] });
    return stakes.get(key)!;
  };
  for (let after: string | undefined; ;) {
    const rows = store.list(provider.id, { room: room.id, activeOnly: true, limit: 1000, after, account });
    for (const row of rows) {
      if (row.identity.kind !== "episode" || row.identity.roomUuid !== room.uuid || row.identity.graphId !== room.graphId || row.payload?.binding?.source?.kind !== "message" ||
          !(store.crossCopyDuplicates(row) || ["accepted", "processed"].includes(row.state) && row.acknowledged)) continue;
      stake(row.identity.sourceId, row.identity.version, row.identity.part).rows.push(row);
    }
    if (rows.length < 1000) break;
    after = rows.at(-1)!.opId;
  }
  for (const link of outbox.links(provider.id, room.id, account)) {
    if (link.source.graphId !== room.graphId) continue;
    const at = listed.get(link.id);
    stake(link.sourceId, link.source.version ?? "", at?.part ?? "1/1").links.push({ id: link.id, source: link.source });
  }
  let changes = 0;
  for (const held of stakes.values()) {
    const current = () => inAccount() && ports.current(held.sourceId, held.version) &&
      !store.groupedSource(provider.id, room.id, held.sourceId, held.version, room.graphId);
    if (!current()) continue;
    signal.throwIfAborted();
    const fresh = await reads?.sourceEpisodes?.(room.uuid, held.sourceId, signal, room.graphId);
    signal.throwIfAborted();
    if (!current() || fresh?.state === "unknown") continue;
    const group = (fresh?.episodes ?? listing.bySource.get(held.sourceId) ?? []).filter(e => e.kind === "message" && e.version === held.version && e.part === held.part);
    const survivor = group.filter(e => e.processed).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
    if (!survivor) {
      if (!group.length) for (const id of new Set([...held.rows.flatMap(row => row.externalIds), ...held.links.map(link => link.id)])) {
        if (await presence(id, signal) === "absent" && current()) outbox.needsGraphRepair(provider.id, room.uuid, "processed_episode_missing");
      }
      continue;
    }
    if (await presence(survivor.id, signal) !== "present" || !current()) continue;
    const gone = new Set<string>();
    for (const duplicate of group.filter(e => e.processed && e.id > survivor.id)) {
      if (changes >= DELETES_PER_PASS || !current()) return changes;
      const ours = held.rows.some(row => row.opId === duplicate.opId) && store.ownsReceipt(provider.id, room.uuid, held.sourceId, duplicate.id, account);
      if (!ours && await presence(duplicate.id, signal) === "absent") { gone.add(duplicate.id); continue; }
      if (!current()) break;
      const result = await eraseEpisode(outbox, provider, view, duplicate.id, signal, current, ours);
      if (result !== "deleted") break;
      for (const row of held.rows.filter(r => r.externalIds.includes(duplicate.id))) store.removedEpisode(row.opId, duplicate.id, ports.now());
      gone.add(duplicate.id); changes++;
    }
    const left = (id: string) => id !== survivor.id && group.some(e => e.id === id) && !gone.has(id);
    if (await presence(survivor.id, signal) !== "present" || !current()) continue;
    for (const row of held.rows) {
      if (row.externalIds.length === 1 && row.externalIds[0] === survivor.id) continue;
      if (row.externalIds.some(left) || !current()) continue;
      if (store.rebind(row.opId, survivor.id, ports.now(), saved => {
        if (!current()) throw new Error("Version cleanup account or source changed");
        outbox.dropEpisodeIds(provider.id, room.id, held.sourceId, saved.externalIds.filter(id => id !== survivor.id), account);
        const source = saved.payload.binding?.source;
        outbox.mapEpisode(provider.id, room.id, held.sourceId, survivor.id, source && (survivor.copyId === saved.identity.copyId ? source : { ...source, boundCopy: survivor.copyId ?? "unknown" }), account);
        return undefined;
      }, survivor.copyId ?? "unknown", account)) changes++;
    }
    for (const link of held.links) {
      if (link.id === survivor.id || left(link.id) || !current()) continue;
      if (outbox.replaceEpisodeBinding(provider.id, room.id, held.sourceId, link.id, survivor.id, { ...link.source, boundCopy: survivor.copyId ?? "unknown" }, account)) changes++;
    }
  }
  return changes;
}
