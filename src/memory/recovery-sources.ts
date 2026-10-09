// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import type { StoredMessage } from "../history-store.js";
import { visibleToAgents } from "../quotes.js";
import type { Delivery, ListedEpisode } from "./delivery.js";
import type { MemoryOutbox } from "./outbox.js";
import type { MemoryEpisode, MemoryFact, MemoryWriteAdapter } from "./provider.js";
import { sourceVersion } from "./provenance.js";
import { memoryText } from "./text.js";
import { canonicalParts } from "./version-check.js";
import { carryHash } from "../carry-history.js";

export interface RecoveryScope { provider: string; account: string; room: string; uuid: string; graphId?: string; revision: string }
export interface RecoveryFactInput { id: string; sourceId: string; version: string; part: string; opId: string; copyId: string; processed: boolean; receiptIds: string[] }
export type RecoveryInventory = { state: "complete"; episodes: ListedEpisode[]; facts: RecoveryFactInput[]; unexplained: string[];
  fingerprint: string; startedAt: number; finishedAt: number }
  | { state: "unknown"; reason: string; startedAt: number; finishedAt: number };
export interface RecoveryInventoryReader {
  recoveryInventory(uuid: string, signal: AbortSignal, now: () => number, graphId?: string): Promise<RecoveryInventory>;
}
export type RecoverySource = { sourceId: string; version: string; episodeIds: string[] } &
  ({ kind: "message" | "note"; episode: MemoryEpisode } | { kind: "fact"; fact: MemoryFact });
export interface RecoveryIssue { reason: string; sourceId?: string; externalId?: string }
export interface RecoverySourcePlan {
  state: "ready" | "blocked"; scope: RecoveryScope; fingerprint: string; inventoryFingerprint: string | null;
  sources: RecoverySource[]; excluded: RecoveryIssue[]; blockers: RecoveryIssue[];
}
interface Ports {
  outbox: MemoryOutbox;
  message(room: string, id: string): { state: "live" | "removed"; row: StoredMessage } | { state: "missing" };
  relation(room: string, id: string, hash: string): "current" | "ancestor" | "unknown";
  writes: MemoryWriteAdapter;
  current(scope: RecoveryScope): boolean;
}
const stable = (v: unknown): string => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v)
  ? `[${v.map(stable).join(",")}]` : `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
export const recoveryFingerprint = (value: unknown): string => `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
const sameGraph = (row: Delivery, scope: RecoveryScope): boolean => row.identity.roomId === scope.room && row.identity.roomUuid === scope.uuid && row.identity.graphId === scope.graphId;

export class MemoryRecoverySources {
  private readonly observations = new WeakMap<RecoverySourcePlan, RecoveryInventory>();
  constructor(private readonly ports: Ports) {}

  plan(scope: RecoveryScope, inventory: RecoveryInventory): RecoverySourcePlan {
    const snapshot = freeze(structuredClone(inventory));
    const result = this.inspect(structuredClone(scope), snapshot);
    this.observations.set(result, snapshot);
    return result;
  }

  locallyCurrent(plan: RecoverySourcePlan): boolean {
    const inventory = this.observations.get(plan);
    return plan.state === "ready" && !!inventory && this.ports.current(plan.scope) && this.inspect(plan.scope, inventory).fingerprint === plan.fingerprint;
  }

  private inspect(scope: RecoveryScope, inventory: RecoveryInventory): RecoverySourcePlan {
    const sources: RecoverySource[] = [], excluded: RecoveryIssue[] = [], blockers: RecoveryIssue[] = [];
    const block = (reason: string, sourceId?: string, externalId?: string) => blockers.push({ reason, ...(sourceId ? { sourceId } : {}), ...(externalId ? { externalId } : {}) });
    const finish = (): RecoverySourcePlan => {
      if (!this.ports.current(scope)) { sources.length = 0; excluded.length = 0; block("attachment_or_permission_changed"); }
      sources.sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);
      const normalize = (issues: RecoveryIssue[]) => [...new Map(issues.map(i => [stable(i), i])).values()].sort((a, b) => stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0);
      const result = { scope, sources, excluded: normalize(excluded), blockers: normalize(blockers), inventoryFingerprint: inventory.state === "complete" ? inventory.fingerprint : null };
      return freeze({ ...result, state: result.blockers.length ? "blocked" : "ready", fingerprint: recoveryFingerprint(result) });
    };
    const { outbox } = this.ports;
    if (!scope.provider || !scope.room || !scope.uuid || !scope.revision || !/^sha256:[a-f0-9]{64}$/.test(scope.account)) block("invalid_scope");
    if (!this.ports.current(scope)) block("attachment_or_permission_changed");
    if (blockers.length) return finish();
    const rows: Delivery[] = [];
    let after = "", scanned = 0;
    for (;;) {
      const page = outbox.deliveries.list(scope.provider, { room: scope.room, after, limit: 1000 });
      scanned += page.length;
      rows.push(...page.filter(row => sameGraph(row, scope)));
      if (scanned > 10000) { block("delivery_limit"); break; }
      if (page.length < 1000) break;
      after = page.at(-1)!.opId;
    }
    const owned = rows.filter(row => outbox.deliveries.copyAccount(row.identity) === scope.account);
    for (const row of rows) {
      const account = outbox.deliveries.copyAccount(row.identity);
      if (!account && (row.attemptedAt !== null || row.externalIds.length)) block("account_ownership_unknown", row.identity.sourceId);
      if (account !== scope.account || row.retiredAt !== null && ["episodes_deleted", "graph_deleted"].includes(row.cleanup ?? "")) continue;
      if (row.attemptedAt !== null && ["unknown", "conflict", "duplicates"].includes(row.state)) block("delivery_unsettled", row.identity.sourceId);
      if (row.retiredAt !== null && (row.attemptedAt !== null || row.externalIds.length) && ["pending", "not_requested"].includes(row.cleanup ?? "")) block("retired_delivery_unsettled", row.identity.sourceId);
    }
    if (inventory.state === "unknown") block(`inventory_${inventory.reason}`);
    else {
      if (inventory.episodes.length + inventory.facts.length + inventory.unexplained.length > 10000) block("inventory_limit");
      else {
        for (const id of inventory.unexplained) block("unexplained_graph_input", undefined, id);
        const groups = new Map<string, ListedEpisode[]>(), ids = new Set<string>();
        for (const episode of inventory.episodes) {
          if (!episode.id || ids.has(episode.id)) { block("inventory_identity_conflict", episode.sourceId, episode.id); continue; }
          ids.add(episode.id);
          if (outbox.episodeRetired(scope.provider, scope.room, episode.id, scope.account)) {
            block("retired_episode_still_present", episode.sourceId, episode.id); continue;
          }
          groups.set(episode.sourceId, [...groups.get(episode.sourceId) ?? [], episode]);
        }
        for (const [id, episodes] of groups) {
          if (new Set(episodes.map(e => e.kind)).size !== 1) { block("source_kind_conflict", id); continue; }
          if (episodes.some(e => !e.processed)) { block("source_not_processed", id); continue; }
          if (episodes[0].kind === "note") {
            const versions = new Set(episodes.map(e => e.version));
            if (versions.size !== 1 || !canonicalParts(episodes)) { block("explicit_source_parts_or_versions", id); continue; }
            this.explicit(scope, owned, "note", episodes, sources, block); continue;
          }
          const local = this.ports.message(scope.room, id);
          if (local.state === "missing") { block("original_missing", id); continue; }
          const row = local.row, version = sourceVersion(row);
          const unknown = episodes.some(e => e.legacy ? !e.carryHash || this.ports.relation(scope.room, id, e.carryHash) === "unknown"
            : e.version !== version && (!e.carryHash || this.ports.relation(scope.room, id, e.carryHash) !== "ancestor"));
          if (unknown) { block("source_version_unknown", id); continue; }
          if (local.state === "removed" || !visibleToAgents(row) || outbox.excludedVersion(scope.room, id, version)) {
            excluded.push({ sourceId: id, reason: local.state === "removed" ? "source_removed" : !visibleToAgents(row) ? "source_hidden" : "version_excluded" }); continue;
          }
          if (row.kind !== "chat" || row.streaming) { block("source_not_final_chat", id); continue; }
          const parts = new Map<string, ListedEpisode[]>();
          for (const e of episodes) { const key = JSON.stringify([!!e.legacy, e.version]); parts.set(key, [...parts.get(key) ?? [], e]); }
          if ([...parts.values()].some(set => !canonicalParts(set))) { block("source_parts_incomplete", id); continue; }
          sources.push({ kind: "message", sourceId: id, version, episodeIds: episodes.map(e => e.id).sort(),
            episode: { sourceId: id, seq: row.seq, authorId: row.from, authorName: row.fromName, ts: row.ts, text: memoryText(row), carryHash: `sha256:${carryHash(row)}` } });
        }
        const factGroups = new Map<string, RecoveryFactInput[]>();
        for (const fact of inventory.facts) {
          if (!fact.id || ids.has(fact.id)) { block("inventory_identity_conflict", fact.sourceId, fact.id); continue; }
          ids.add(fact.id);
          if (!fact.processed || !fact.receiptIds.length) { block("fact_not_processed_or_linked", fact.sourceId, fact.id); continue; }
          if (groups.has(fact.sourceId)) { block("source_kind_conflict", fact.sourceId); continue; }
          factGroups.set(fact.sourceId, [...factGroups.get(fact.sourceId) ?? [], fact]);
        }
        for (const facts of factGroups.values()) this.explicit(scope, owned, "fact", facts, sources, block);
        const represented = new Set([...inventory.episodes.map(e => e.id), ...inventory.facts.flatMap(f => f.receiptIds)]);
        for (const row of owned) if (row.retiredAt === null && row.attemptedAt !== null && ["accepted", "processed"].includes(row.state)
          && (!row.externalIds.length || row.externalIds.some(id => !represented.has(id)))) block("accepted_receipt_missing", row.identity.sourceId);
      }
    }
    return finish();
  }

  private explicit(scope: RecoveryScope, rows: Delivery[], kind: "note" | "fact", remote: readonly (ListedEpisode | RecoveryFactInput)[],
    sources: RecoverySource[], block: (reason: string, sourceId?: string, externalId?: string) => void): void {
    const id = remote[0].sourceId;
    const originals: RecoverySource[] = [];
    for (const item of remote) {
      const row = rows.find(row => row.opId === item.opId && row.identity.copyId === item.copyId && row.identity.sourceId === id && row.identity.version === item.version
        && row.identity.part === item.part && row.identity.kind === (kind === "fact" ? "fact" : "episode") &&
        ("receiptIds" in item ? item.receiptIds.some(id => row.externalIds.includes(id)) : row.externalIds.includes(item.id)));
      const original = row?.payload?.binding?.original;
      if (!row || row.retiredAt !== null || !original || original.kind !== kind) { block("explicit_original_missing", id, item.id); return; }
      try {
        this.ports.writes.transport.validate(row as Delivery & { payload: NonNullable<Delivery["payload"]> });
        const room = { uuid: scope.uuid, name: "", graphId: scope.graphId };
        let note = original.kind === "note" ? original.episode : null;
        if (note && item.part !== "1/1") {
          const part = /^(\d+)\/(\d+)$/.exec(item.part), size = this.ports.writes.episodeTextLimit, chars = [...note.text];
          if (!part || !Number.isSafeInteger(size) || size! < 1 || Number(part[2]) !== Math.ceil(chars.length / size!) || Number(part[1]) < 1 || Number(part[1]) > Number(part[2]))
            throw new Error("Invalid explicit original parts");
          note = { ...note, text: chars.slice((Number(part[1]) - 1) * size!, Number(part[1]) * size!).join("") };
        }
        const prepared = original.kind === "note" ? this.ports.writes.episode(row.identity, row.opId, room, note!, "note")
          : this.ports.writes.fact(row.identity, row.opId, room, original.fact);
        const { sourceDescription: _old, ...request } = row.payload!.request;
        const { sourceDescription: _new, ...rebuilt } = prepared.request;
        if (row.payload!.format !== prepared.format || recoveryFingerprint(request) !== recoveryFingerprint(rebuilt)) throw new Error("Original mismatch");
        originals.push(original.kind === "note" ? { kind: "note", sourceId: id, version: row.identity.version, episodeIds: [], episode: structuredClone(original.episode) }
          : { kind: "fact", sourceId: id, version: row.identity.version, episodeIds: [], fact: structuredClone(original.fact) });
      } catch { block("explicit_original_mismatch", id, item.id); return; }
    }
    if (new Set(originals.map(recoveryFingerprint)).size !== 1 || kind === "fact" && remote.some(item => item.part !== "1/1")) { block("explicit_source_parts_or_versions", id); return; }
    sources.push({ ...originals[0], episodeIds: remote.map(e => e.id).sort() });
  }
}
