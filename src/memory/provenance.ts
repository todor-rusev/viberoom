// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { StoredMessage } from "../history-store.js";
import { visibleToAgents } from "../quotes.js";
import { isFact, type EpisodeSource, type FactEvidence, type Recalled, type RecalledEpisode, type RecalledSource } from "./provider.js";
import { memoryText } from "./text.js";
import type { MemoryOutbox } from "./outbox.js";
import { memoryVersion } from "./version.js";

export const sourceVersion = (message: StoredMessage): string => memoryVersion(message);
export function messageSource(message: StoredMessage): EpisodeSource {
  return { kind: "message", version: sourceVersion(message), authorId: message.from, authorName: message.fromName, ts: message.ts, ...(message.origin ? { origin: message.origin } : {}) };
}

interface SourceRoom { id: string; uuid: string; name: string; graphId?: string; generationRevision?: string; account?: string }
interface SourcePorts {
  outbox: MemoryOutbox;
  getById?(room: string, id: string, includeDeleted?: boolean): StoredMessage | null;
}

export function resolveFacts<T extends Recalled>(facts: T[], provider: string, own: string, allowed: SourceRoom[], ports: SourcePorts): T[] {
  const rooms = new Map(allowed.map(room => [room.id, room]));
  const episodes = new Map<string, { retired: boolean; bindings: ReturnType<MemoryOutbox["episodeSources"]> }>();
  const messages = new Map<string, StoredMessage | null>();
  const versions = new WeakMap<StoredMessage, string>();
  const read = (room: string, id: string, deleted = false): StoredMessage | null => {
    const key = JSON.stringify([room, id, deleted]);
    if (!messages.has(key)) messages.set(key, ports.getById?.(room, id, deleted) ?? null);
    return messages.get(key)!;
  };
  const version = (message: StoredMessage): string => {
    if (!versions.has(message)) versions.set(message, sourceVersion(message));
    return versions.get(message)!;
  };
  const untracedGraphs = new Map<string, boolean>();
  const repairScope = (room: SourceRoom, account: string | null) => room.graphId && room.generationRevision && account
    ? { provider, room: room.id, uuid: room.uuid, graphId: room.graphId, revision: room.generationRevision, account } : undefined;
  const untracedGraph = (room: SourceRoom, account: string | null): boolean => {
    const key = JSON.stringify([room.id, room.uuid, room.graphId, room.generationRevision, account]);
    if (!untracedGraphs.has(key)) untracedGraphs.set(key, ports.outbox.untracedRemoval(provider, room.uuid, repairScope(room, account)));
    return untracedGraphs.get(key)!;
  };
  const resolveEpisode = (item: RecalledEpisode): RecalledEpisode[] => {
    type Accepted = { link: FactEvidence; room: SourceRoom; source: RecalledSource; text: string; proven: boolean };
    const accepted: Accepted[] = [];
    for (const link of item.evidence ?? []) {
      const room = rooms.get(link.roomId);
      if (!room || room.uuid !== link.roomUuid || provider !== link.provider || room.graphId !== link.graphId || room.generationRevision !== link.generationRevision) continue;
      const base = { roomId: room.id, roomUuid: room.uuid, roomName: room.name };
      const account = room.account ?? ports.outbox.generationAttachment(provider, room.id)?.account ?? null;
      const key = JSON.stringify([room.id, account, item.episodeId]);
      if (!episodes.has(key)) episodes.set(key, { retired: ports.outbox.episodeRetired(provider, room.id, item.episodeId, account), bindings: ports.outbox.episodeSources(provider, room.id, item.episodeId, account) });
      const { retired, bindings } = episodes.get(key)!;
      if (retired || !bindings.length) continue;
      if (new Set(bindings.map(binding => binding.sourceId)).size > 1) continue;
      const candidates: Accepted[] = [];
      let rejected = false;
      for (const binding of bindings) {
        const saved = binding.source;
        if (saved?.kind === "note") {
          candidates.push({ link, room, text: item.text, proven: true, source: { ...base, status: "note", episodeIds: [item.episodeId], noteId: binding.sourceId,
            authorId: saved.authorId, authorName: saved.authorName, writtenAt: new Date(saved.ts).toISOString() } });
          continue;
        }
        const message = read(room.id, binding.sourceId);
        if (!message || !visibleToAgents(message) || (saved?.version && saved.version !== version(message))) { rejected = true; break; }
        const proven = !!saved?.version;
        candidates.push({ link, room, proven, text: proven ? item.text : memoryText(message), source: { ...base, status: proven ? "available" : "version_unknown",
          episodeIds: [item.episodeId], messageId: message.id, seq: message.seq, ...(proven ? { version: saved!.version } : {}),
          authorId: saved?.authorId ?? message.from, authorName: saved?.authorName ?? message.fromName,
          writtenAt: new Date(saved?.ts ?? message.ts).toISOString(),
          ...(saved?.origin ?? message.origin ? { originCopy: saved?.origin ?? message.origin } : {}) } });
      }
      if (!rejected) accepted.push(...candidates);
    }
    const chosen = accepted.find(candidate => candidate.proven) ?? accepted[0];
    if (!chosen) return [];
    const { room: _room, verification: _verification, untraced: _untraced, ...rest } = item;
    return [{ ...rest, text: chosen.text, evidence: [chosen.link], sources: [chosen.source],
      ...(chosen.link.roomId !== own ? { room: chosen.room.name } : {}) }];
  };

  return facts.flatMap((fact): T[] => {
    if (fact.kind === "episode") return resolveEpisode(fact) as T[];
    const evidence: FactEvidence[] = [], sources: RecalledSource[] = [];
    let unchangedEvidence: FactEvidence | undefined, cleanEvidence: FactEvidence | undefined;
    for (const link of fact.evidence ?? []) {
      const room = rooms.get(link.roomId);
      if (!room || room.uuid !== link.roomUuid || provider !== link.provider || room.graphId !== link.graphId || room.generationRevision !== link.generationRevision) continue;
      const base = { roomId: room.id, roomUuid: room.uuid, roomName: room.name };
      const account = room.account ?? ports.outbox.generationAttachment(provider, room.id)?.account ?? null;
      const related: RecalledSource[] = [];
      let changed = ports.outbox.needsFactRepair(provider, room.uuid, link.factIds, repairScope(room, account))
        || (!!link.nodeIds?.length && ports.outbox.needsNodeRepair(provider, room.uuid, link.nodeIds, repairScope(room, account)));
      for (const episodeId of link.episodeIds) {
        const key = JSON.stringify([room.id, account, episodeId]);
        if (!episodes.has(key)) episodes.set(key, { retired: ports.outbox.episodeRetired(provider, room.id, episodeId, account), bindings: ports.outbox.episodeSources(provider, room.id, episodeId, account) });
        const { retired, bindings } = episodes.get(key)!;
        if (retired) { changed = true; continue; }
        const episodeSources: RecalledSource[] = [];
        let removed = false;
        if (!bindings.length) episodeSources.push({ ...base, status: "unavailable", episodeIds: [episodeId] });
        for (const binding of bindings) {
          const saved = binding.source;
          if (saved?.kind === "note") {
            episodeSources.push({ ...base, status: "note", episodeIds: [episodeId], noteId: binding.sourceId,
              authorId: saved.authorId, authorName: saved.authorName, writtenAt: new Date(saved.ts).toISOString() });
            continue;
          }
          const message = read(room.id, binding.sourceId);
          if ((!message && read(room.id, binding.sourceId, true)) ||
              (message && (!visibleToAgents(message) || (saved?.version && saved.version !== version(message))))) {
            removed = true; break;
          }
          if (!message) { episodeSources.push({ ...base, status: "unavailable", episodeIds: [episodeId] }); continue; }
          episodeSources.push({ ...base, status: saved?.version ? "available" : "version_unknown", episodeIds: [episodeId],
            messageId: message.id, seq: message.seq, ...(saved?.version ? { version: saved.version } : {}),
            authorId: saved?.authorId ?? message.from, authorName: saved?.authorName ?? message.fromName,
            writtenAt: new Date(saved?.ts ?? message.ts).toISOString(),
            ...(saved?.origin ?? message.origin ? { originCopy: saved?.origin ?? message.origin } : {}) });
        }
        if (removed) changed = true;
        else related.push(...episodeSources);
      }
      if (changed && !related.some(source => source.status !== "unavailable")) continue;
      if (!changed) { unchangedEvidence ??= link; if (!untracedGraph(room, account)) cleanEvidence ??= link; }
      evidence.push(link);
      sources.push(...(related.length ? related : [{ ...base, status: "unavailable" as const, episodeIds: [] }]));
    }
    if (!evidence.length) return [];
    const grouped = new Map<string, RecalledSource>();
    for (const source of sources) {
      const key = JSON.stringify([source.roomId, source.status, source.messageId, source.noteId, source.version]);
      const existing = grouped.get(key);
      if (existing) existing.episodeIds = [...new Set([...existing.episodeIds, ...source.episodeIds])];
      else grouped.set(key, { ...source });
    }
    const { room: _room, id: _id, verification: _verification, untraced: _untraced, ...rest } = fact;
    const first = cleanEvidence ?? unchangedEvidence ?? evidence[0];
    const untraced = !!unchangedEvidence && !cleanEvidence;
    const order = { available: 0, version_unknown: 1, note: 2, unavailable: 3 };
    const ended = isFact(fact) && !!fact.invalidAt;
    const id = first.factIds[0] ?? first.nodeIds?.[0];
    return [{ ...rest, evidence, sources: [...grouped.values()].sort((a, b) => order[a.status] - order[b.status]),
      ...(!unchangedEvidence ? { verification: "source_changed" as const } : untraced && ended ? { verification: "end_unverified" as const } : {}),
      ...(untraced ? { untraced: true as const } : {}),
      ...(id ? { id } : {}),
      episodeIds: [...new Set(evidence.flatMap(e => e.episodeIds))],
      ...(first.roomId !== own ? { room: rooms.get(first.roomId)!.name } : {}) } as T];
  });
}

export function withoutShown<T extends Recalled>(items: T[], roomId: string, shown: readonly number[]): T[] {
  const inTurn = new Set(shown);
  return items.filter(item => item.kind !== "episode" || !item.sources?.some(source => source.roomId === roomId && source.seq !== undefined && inTurn.has(source.seq)));
}

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function untracedNote(facts: Recalled[]): string | null {
  const rooms = [...new Set(facts.filter(fact => fact.untraced).map(fact => fact.room ?? ""))];
  if (!rooms.length) return null;
  const places = [...(rooms.includes("") ? ["this room"] : []), ...rooms.filter(Boolean).map(room => `the room "${room}"`)];
  const where = places.length === 1 ? places[0] : `${places.slice(0, -1).join(", ")} and ${places.at(-1)}`;
  return places.length === 1
    ? `The memory of ${where} had a source removed with no record of what it touched, so the start dates of its facts may be inexact.`
    : `The memories of ${where} each had a source removed with no record of what it touched, so the start dates of their facts may be inexact.`;
}

export function untracedLine(facts: Recalled[]): string | null {
  const note = untracedNote(facts);
  return note === null ? null : xml(note);
}

export function factLine(item: Recalled, inferredFrom = false): string {
  const verification = item.verification === "source_changed" ? " [unverified assertion and validity: a related source changed or was removed]"
    : item.verification === "end_unverified" ? " [unverified end: a source removed with no record of what it touched may have ended it; the fact may still hold]" : "";
  const validity = isFact(item) && (item.validAt || item.invalidAt)
    ? ` (graph validity: ${item.validAt ?? "start unknown"}${item.invalidAt ? ` to ${item.invalidAt}` : "; end unknown"})` : "";
  const source = item.sources?.[0];
  let provenance = " [source unavailable in this copy]";
  if (source?.messageId) provenance = `\n  related source: room=${JSON.stringify(source.roomId)}, message_id=${JSON.stringify(source.messageId)}, #${source.seq}; ${source.authorName} [${source.authorId}]; written ${source.writtenAt}${source.version ? `; version=${source.version}` : "; original version unknown (current message reference)"}${source.originCopy ? `; origin copy=${source.originCopy}` : ""}`;
  else if (source?.status === "note") provenance = `\n  related source: explicit note ${source.noteId}; room=${JSON.stringify(source.roomId)}; ${source.authorName} [${source.authorId}]; written ${source.writtenAt}; no conversation message`;
  if ((item.sources?.length ?? 0) > 1) provenance += `; ${item.sources!.length - 1} more related sources (search_history)`;
  const derived = inferredFrom ? " [facts shown here that cite this message were inferred from it, not confirmed by it]" : "";
  return `- ${itemWords(item)}${derived}${verification}${xml(validity)}${item.room ? ` [heard in the room "${xml(item.room)}"]` : ""}${xml(provenance)}`;
}

function itemWords(item: Recalled): string {
  if (item.kind === "episode") return `[the message itself] ${xml(item.text)}`;
  if (item.kind === "node") {
    const labels = item.labels?.length ? ` (${item.labels.map(xml).join(", ")})` : "";
    const attributes = item.attributes && Object.keys(item.attributes).length ? ` [attributes: ${xml(JSON.stringify(item.attributes))}]` : "";
    return `[what the memory holds about ${xml(item.name)}${labels}] ${item.summary.trim() ? xml(item.summary) : "[no summary, only the name]"}${attributes}`;
  }
  return xml(item.fact);
}

function withWords(item: Recalled, text: string): Recalled {
  if (item.kind === "episode") return { ...item, text };
  if (item.kind === "node") return { ...item, summary: text };
  return { ...item, fact: text };
}
const words = (item: Recalled): string => item.kind === "episode" ? item.text : item.kind === "node" ? item.summary : item.fact;

export function factLines(items: Recalled[], budget: number): { lines: string[]; told: Recalled[]; omitted: number } {
  const order = items.map(item => ({ item, line: factLine(item), marked: false }));
  const kept: typeof order = [];
  const messages = (item: Recalled): string[] => (item.sources ?? []).flatMap(source => source.messageId ? [source.messageId] : []);
  const citedByFacts = new Set<string>();
  let used = 0;
  for (const entry of order) {
    const { item } = entry;
    if (item.kind === "episode" && messages(item).some(id => citedByFacts.has(id))) { entry.line = factLine(item, true); entry.marked = true; }
    const newly = item.kind !== "episode" && item.kind !== "node" ? messages(item).filter(id => !citedByFacts.has(id)) : [];
    const marks = kept.filter(shown => shown.item.kind === "episode" && !shown.marked && messages(shown.item).some(id => newly.includes(id)))
      .map(shown => ({ shown, line: factLine(shown.item, true) }));
    const room = entry.line.length + 1 + marks.reduce((sum, mark) => sum + mark.line.length - mark.shown.line.length, 0);
    if (room > budget - used) break;
    for (const mark of marks) { mark.shown.line = mark.line; mark.shown.marked = true; }
    kept.push(entry); used += room;
    for (const id of newly) citedByFacts.add(id);
  }
  if (!kept.length && order.length) {
    const first = order[0], suffix = " [truncated]";
    const overhead = factLine(withWords(first.item, "")).length + 1;
    let text = words(first.item);
    while (text.length && factLine(withWords(first.item, text + suffix)).length + 1 > budget) text = text.slice(0, Math.max(0, text.length - Math.max(1, first.line.length - budget)));
    if (budget > overhead + suffix.length) { const item = withWords(first.item, text + suffix); return { lines: [factLine(item)], told: [item], omitted: order.length - 1 }; }
    return { lines: [], told: [], omitted: order.length };
  }
  return { lines: kept.map(entry => entry.line), told: kept.map(entry => entry.item), omitted: order.length - kept.length };
}
