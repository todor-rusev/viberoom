// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { SqliteConnection } from "../sqlite-capabilities.js";

export type EpisodeImpact = { state: "processed"; edgeIds: string[]; nodeIds: string[] } | { state: "absent" } | { state: "pending" };

export class MemoryImpactStore {
  constructor(private readonly db: SqliteConnection) {
    db.exec(`create table if not exists memory_episode_impact(
      provider text not null, uuid text not null, episode_id text not null,
      captured_at integer not null, deleted_at integer,
      primary key(provider,uuid,episode_id));
      create table if not exists memory_artifact_repair(
      provider text not null, uuid text not null, episode_id text not null,
      kind text not null, artifact_id text not null,
      primary key(provider,uuid,episode_id,kind,artifact_id));
      create index if not exists memory_artifact_lookup on memory_artifact_repair(provider,uuid,kind,artifact_id);`);
  }

  captured(provider: string, uuid: string, episodeId: string): boolean {
    return !!this.db.prepare("select 1 from memory_episode_impact where provider=? and uuid=? and episode_id=?").get(provider, uuid, episodeId);
  }

  save(provider: string, uuid: string, episodeId: string, impact: Extract<EpisodeImpact, { state: "processed" }>): void {
    if (!episodeId || [impact.edgeIds, impact.nodeIds].some(ids => !Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== "string" || !id))) throw new Error("Invalid impact capture");
    this.db.exec("savepoint memory_impact_capture");
    try {
      this.db.prepare("insert or ignore into memory_episode_impact values(?,?,?,?,null)").run(provider, uuid, episodeId, Date.now());
      const insert = this.db.prepare("insert or ignore into memory_artifact_repair values(?,?,?,?,?)");
      for (const [kind, ids] of [["edge", impact.edgeIds], ["node", impact.nodeIds]] as const) for (const id of ids) insert.run(provider, uuid, episodeId, kind, id);
      this.db.exec("release memory_impact_capture");
    } catch (error) { this.db.exec("rollback to memory_impact_capture; release memory_impact_capture"); throw error; }
  }

  deleted(provider: string, uuid: string, episodeId: string): void {
    this.db.prepare("update memory_episode_impact set deleted_at=? where provider=? and uuid=? and episode_id=?").run(Date.now(), provider, uuid, episodeId);
  }

  affected(provider: string, uuid: string, kind: "edge" | "node", ids: string[]): boolean {
    const find = this.db.prepare("select 1 from memory_artifact_repair where provider=? and uuid=? and kind=? and artifact_id=? limit 1");
    return ids.some(id => !!find.get(provider, uuid, kind, id));
  }

  pending(provider: string, uuid: string): boolean {
    return !!this.db.prepare("select 1 from memory_artifact_repair where provider=? and uuid=? limit 1").get(provider, uuid);
  }
  snapshot(provider: string, uuid: string): { state: "unknown"; reason: string } | { state: "complete"; ownership: "unscoped";
    episodes: Array<{ id: string; deleted: boolean; edgeIds: string[]; nodeIds: string[] }> } {
    const captures = this.db.prepare("select episode_id,deleted_at from memory_episode_impact where provider=? and uuid=? order by episode_id limit 10001").all(provider, uuid);
    const artifacts = this.db.prepare("select episode_id,kind,artifact_id from memory_artifact_repair where provider=? and uuid=? order by episode_id,kind,artifact_id limit 10001").all(provider, uuid);
    if (captures.length > 10000 || artifacts.length > 10000) return { state: "unknown", reason: "repair_manifest_limit" };
    const captureIds = new Set(captures.map(row => String(row.episode_id)));
    if (artifacts.some(row => !captureIds.has(String(row.episode_id)) || !["edge", "node"].includes(String(row.kind))))
      return { state: "unknown", reason: "repair_manifest_inconsistent" };
    const byEpisode = new Map<string, { edgeIds: string[]; nodeIds: string[] }>();
    for (const a of artifacts) {
      const id = String(a.episode_id), group = byEpisode.get(id) ?? { edgeIds: [], nodeIds: [] };
      (a.kind === "edge" ? group.edgeIds : group.nodeIds).push(String(a.artifact_id)); byEpisode.set(id, group);
    }
    return { state: "complete", ownership: "unscoped", episodes: captures.map(row => ({ id: String(row.episode_id), deleted: row.deleted_at !== null,
      ...(byEpisode.get(String(row.episode_id)) ?? { edgeIds: [], nodeIds: [] }) })) };
  }

  clear(provider: string, uuid: string): void {
    this.db.prepare("delete from memory_artifact_repair where provider=? and uuid=?").run(provider, uuid);
    this.db.prepare("delete from memory_episode_impact where provider=? and uuid=?").run(provider, uuid);
  }
}
