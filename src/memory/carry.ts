// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { SqliteConnection } from "../sqlite-capabilities.js";
import { isIdentity } from "../identity.js";
import type { MemoryImpactStore } from "./impact.js";

export interface PortableMemoryRepair {
  schema: 1;
  unknownSources: string[];
  graphs: { provider: string; uuid: string; unknownScope: boolean;
    episodes: { id: string; edgeIds: string[]; nodeIds: string[] }[] }[];
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\u0000-\u001f]/.test(v);
function ids(v: unknown, limit = 10000): string[] {
  if (!Array.isArray(v) || v.length > limit || !v.every(id)) throw new Error("Invalid carried memory repair IDs.");
  return [...new Set(v)].sort();
}
function keys(v: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(v).some(k => !allowed.includes(k))) throw new Error("Unsupported fields in carried memory repair.");
}

export function validateMemoryRepair(value: unknown, uuids: readonly string[]): PortableMemoryRepair | undefined {
  if (!object(value) || !Number.isSafeInteger(value.schema) || Number(value.schema) < 1) throw new Error("Invalid carried memory repair schema.");
  if (Number(value.schema) > 1) return undefined;
  keys(value, ["schema", "unknownSources", "graphs"]);
  if (!Array.isArray(value.graphs) || value.graphs.length > 256) throw new Error("Invalid carried memory repair graphs.");
  const seen = new Set<string>();
  const graphs = value.graphs.map(g => {
    if (!object(g) || typeof g.provider !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(g.provider) || !isIdentity(g.uuid) || !uuids.includes(g.uuid) || typeof g.unknownScope !== "boolean" || !Array.isArray(g.episodes)) throw new Error("Invalid carried memory repair graph identity.");
    keys(g, ["provider", "uuid", "unknownScope", "episodes"]);
    const key = `${g.provider}:${g.uuid}`;
    if (seen.has(key)) throw new Error("Repeated carried memory repair graph.");
    seen.add(key);
    const episodes = new Set<string>();
    return { provider: g.provider, uuid: g.uuid, unknownScope: g.unknownScope,
      episodes: g.episodes.map(e => {
        if (!object(e) || !id(e.id) || episodes.has(e.id)) throw new Error("Invalid or repeated carried impact episode.");
        keys(e, ["id", "edgeIds", "nodeIds"]); episodes.add(e.id);
        return { id: e.id, edgeIds: ids(e.edgeIds, 2_000_000), nodeIds: ids(e.nodeIds, 2_000_000) };
      }) };
  });
  return { schema: 1, unknownSources: ids(value.unknownSources, 2_000_000), graphs };
}

export class MemoryCarryStore {
  constructor(private readonly db: SqliteConnection, private readonly impacts: MemoryImpactStore) {
    db.exec(`create table if not exists memory_carry_unknown(room text not null, source_id text not null,
      primary key(room,source_id));`);
  }

  portable(room: string, uuids: readonly string[]): PortableMemoryRepair {
    const graphs: PortableMemoryRepair["graphs"] = [];
    for (const uuid of [...new Set(uuids)]) {
      const rows = this.db.prepare(`select c.provider,c.episode_id,a.kind,a.artifact_id from memory_episode_impact c
        left join memory_artifact_repair a using(provider,uuid,episode_id) where c.uuid=?
        order by c.provider,c.episode_id,a.kind,a.artifact_id`).all(uuid);
      const providers = new Set([...rows.map(r => String(r.provider)), ...this.db.prepare("select provider from memory_graph_repair where uuid=?").all(uuid).map(r => String(r.provider))]);
      for (const provider of providers) {
        const episodes = new Map<string, PortableMemoryRepair["graphs"][number]["episodes"][number]>();
        for (const r of rows) if (r.provider === provider) {
          const episodeId = String(r.episode_id);
          let e = episodes.get(episodeId);
          if (!e) { e = { id: episodeId, edgeIds: [], nodeIds: [] }; episodes.set(episodeId, e); }
          if (r.kind === "edge") e.edgeIds.push(String(r.artifact_id));
          if (r.kind === "node") e.nodeIds.push(String(r.artifact_id));
        }
        graphs.push({ provider, uuid, unknownScope: !!this.db.prepare("select 1 from memory_graph_repair where provider=? and uuid=?").get(provider, uuid), episodes: [...episodes.values()] });
      }
    }
    const value = { schema: 1 as const, graphs, unknownSources: this.db.prepare("select source_id from memory_carry_unknown where room=? order by source_id").all(room).map(r => String(r.source_id)) };
    return validateMemoryRepair(value, uuids)!;
  }

  merge(room: string, value: PortableMemoryRepair): void {
    this.db.exec("savepoint memory_carry_merge");
    try {
      for (const g of value.graphs) {
        for (const e of g.episodes) {
          for (let from = 0; from < Math.max(1, e.edgeIds.length, e.nodeIds.length); from += 10000)
            this.impacts.save(g.provider, g.uuid, e.id, { state: "processed", edgeIds: e.edgeIds.slice(from, from + 10000), nodeIds: e.nodeIds.slice(from, from + 10000) });
        }
        if (g.unknownScope) this.unknown(g.provider, g.uuid, "carried_unknown_impact_scope");
      }
      this.rememberUnknown(room, value.unknownSources);
      this.db.exec("release memory_carry_merge");
    } catch (error) { this.db.exec("rollback to memory_carry_merge; release memory_carry_merge"); throw error; }
  }

  rememberUnknown(room: string, sourceIds: readonly string[]): void {
    const insert = this.db.prepare("insert or ignore into memory_carry_unknown values(?,?)");
    for (const sourceId of sourceIds) insert.run(room, sourceId);
  }

  activate(provider: string, room: string, uuid: string): void {
    if (this.db.prepare("select 1 from memory_carry_unknown where room=? limit 1").get(room)) this.unknown(provider, uuid, "carried_change_without_impact_capture");
  }

  activateKnown(room: string, uuid: string, aliases: readonly string[]): void {
    const allowed = new Set([uuid, ...aliases]);
    const copies = this.db.prepare("select provider,uuid from memory_delivery_copy where room=?").all(room);
    for (const c of copies) if (allowed.has(String(c.uuid))) this.activate(String(c.provider), room, String(c.uuid));
    for (const c of this.db.prepare("select provider from memory_cursor where room=?").all(room)) {
      if (!copies.some(copy => copy.provider === c.provider)) this.activate(String(c.provider), room, uuid);
    }
  }

  private unknown(provider: string, uuid: string, reason: string): void {
    this.db.prepare(`insert into memory_graph_repair values(?,?,?,?)
      on conflict(provider,uuid) do update set reason=excluded.reason`).run(provider, uuid, Date.now(), reason);
  }

  dropRoom(room: string): void { this.db.prepare("delete from memory_carry_unknown where room=?").run(room); }
}
