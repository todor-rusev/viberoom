// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { Server } from "node:http";
import { createObservedTestServer } from "../owned-native-test-resources.js";

export interface SeenRequest { method: string; path: string; body: Record<string, unknown> | null }

export class ZepDouble {
  private server: Server;
  url = "";
  requests: SeenRequest[] = [];
  force = new Map<string, { status: number; body: unknown; headers?: Record<string, string> }>();
  forceOnce = new Map<string, { status: number; body: unknown; headers?: Record<string, string> }>();
  hold = new Map<string, number>();
  cut = 0;
  edgesByGraph: Record<string, Record<string, unknown>[]> = {};
  nodesByGraph: Record<string, Record<string, unknown>[]> = {};
  episodes = new Map<string, { graphId: string; wire: Record<string, unknown> }>();
  graphs = new Map<string, Record<string, unknown>>();
  derivedFacts = false;
  autoResults: Record<string, { nodes?: Record<string, unknown>[]; episodes?: Record<string, unknown>[]; observations?: Record<string, unknown>[]; thread_summaries?: Record<string, unknown>[] }> = {};
  projectUuid: string | null = null;
  model: ((body: Record<string, unknown> | null) => { status: number; body: unknown }) | null = null;
  drop: ((request: SeenRequest, n: number) => "before" | "after" | null) | null = null;
  edges: Record<string, unknown>[] = [
    { uuid: "e1", fact: "The default provider is Zep", name: "USES", episodes: ["ep-source", "ep-invalidating"], created_at: new Date(0).toISOString(), source_node_uuid: "a", target_node_uuid: "b", valid_at: "2026-09-23T00:00:00Z", score: 0.87 },
    { uuid: "e2", fact: "The default provider was Honcho", name: "USES", created_at: new Date(0).toISOString(), source_node_uuid: "a", target_node_uuid: "c", valid_at: "2026-09-01T00:00:00Z", invalid_at: "2026-09-23T00:00:00Z", score: 0.31 },
  ];

  constructor() {
    this.server = createObservedTestServer((req, res) => {
      let data = "";
      req.on("data", chunk => (data += chunk));
      req.on("end", () => {
        const path = (req.url ?? "").replace(/^\/v2/, "");
        this.requests.push({ method: req.method ?? "", path, body: data ? JSON.parse(data) : null });
        const dropped = this.drop?.(this.requests.at(-1)!, this.requests.length) ?? null;
        if (dropped === "before") { req.socket.destroy(); return; }
        const matching = ([suffix]: [string, unknown]) => suffix.includes(" ") ? suffix === `${req.method} ${path}` : path.startsWith(suffix);
        const once = [...this.forceOnce.entries()].find(matching);
        if (once) this.forceOnce.delete(once[0]);
        const forced = once ?? [...this.force.entries()].find(matching);
        const answer = forced ? forced[1] : this.answer(req.method ?? "", path, this.requests.at(-1)!.body);
        if (dropped === "after") { req.socket.destroy(); return; }
        const held = [...this.hold.entries()].find(([prefix]) => path.startsWith(prefix))?.[1] ?? 0;
        const send = () => {
          if (res.destroyed) return;
          res.writeHead(answer.status, { "content-type": "application/json", ...((answer as { headers?: Record<string, string> }).headers ?? {}) });
          res.end(JSON.stringify(answer.body));
        };
        if (!held) return send();
        const timer = setTimeout(send, held);
        res.on("close", () => { if (!res.writableEnded) { this.cut++; clearTimeout(timer); } });
      });
    });
  }

  private derivedNodes(graphId: string): Record<string, unknown>[] {
    return [{ uuid: `${graphId}-a`, name: "Synthetic subject", summary: "Synthetic summary.", created_at: "2026-10-03T00:00:00Z" },
      { uuid: `${graphId}-b`, name: "Synthetic object", summary: "Synthetic second summary.", created_at: "2026-10-03T00:00:00Z" }];
  }
  private derivedEdges(graphId: string): Record<string, unknown>[] {
    const episodes = [...this.episodes.entries()].filter(([, e]) => e.graphId === graphId).map(([uuid]) => uuid);
    return episodes.length ? [{ uuid: `${graphId}-edge`, fact: "Synthetic subject uses synthetic object.", name: "USES", created_at: "2026-10-03T00:00:00Z",
      valid_at: "2026-09-01T00:00:00Z", source_node_uuid: `${graphId}-a`, target_node_uuid: `${graphId}-b`, episodes }] : [];
  }
  private factsOf(graphId: string): Record<string, unknown>[] {
    return this.edgesByGraph[graphId] ?? (this.derivedFacts ? this.derivedEdges(graphId) : this.edges);
  }
  private nodesOf(graphId: string): Record<string, unknown>[] {
    return this.nodesByGraph[graphId] ?? (this.derivedFacts ? this.derivedNodes(graphId) : []);
  }

  private answer(method: string, path: string, body: unknown): { status: number; body: unknown } {
    if (path === "/v1/chat/completions" && this.model) return this.model((body ?? null) as Record<string, unknown> | null);
    if (path.startsWith("/graph/list-all")) return { status: 200, body: { graphs: [] } };
    if (path === "/graph/create") {
      const sent = body as Record<string, unknown>, id = String(sent.graph_id);
      const graph = { graph_id: id, id: 1, ...(sent.description === undefined ? {} : { description: sent.description }), ...(this.projectUuid ? { project_uuid: this.projectUuid } : {}) };
      this.graphs.set(id, graph); return { status: 200, body: graph };
    }
    const graph = path.match(/^\/graph\/([^/?]+)$/);
    if (graph && ["GET", "PATCH"].includes(method)) {
      const id = decodeURIComponent(graph[1]), saved = this.graphs.get(id);
      if (!saved) return { status: 404, body: { message: "not found" } };
      if (method === "PATCH") Object.assign(saved, body);
      return { status: 200, body: saved };
    }
    if (path === "/entity-types") return { status: 200, body: { message: "ok" } };
    if (path === "/graph" && method === "POST") {
      const sent = (body ?? {}) as Record<string, unknown>, uuid = `ep-${this.requests.length}`;
      const createdAt = typeof sent.created_at === "string" ? sent.created_at : new Date(0).toISOString();
      this.episodes.set(uuid, { graphId: String(sent.graph_id ?? ""), wire: { uuid, content: sent.data, source: sent.type ?? "message",
        source_description: sent.source_description, metadata: sent.metadata, created_at: createdAt, processed: true } });
      return { status: 200, body: { uuid, content: "x", created_at: createdAt, processed: false } };
    }
    if (path === "/graph/add-fact-triple") return { status: 200, body: {} };
    if (path === "/graph/search") {
      const sent = body as { graph_id?: unknown; scope?: unknown } | null, graphId = String(sent?.graph_id ?? ""), edges = this.factsOf(graphId);
      if (sent?.scope !== "auto") return { status: 200, body: { edges } };
      const extra = this.autoResults[graphId] ?? {};
      return { status: 200, body: { edges, nodes: extra.nodes ?? [], episodes: extra.episodes ?? [],
        ...(extra.observations ? { observations: extra.observations } : {}), ...(extra.thread_summaries ? { thread_summaries: extra.thread_summaries } : {}) } };
    }
    const episode = path.match(/^\/graph\/episodes\/([^/]+)$/);
    if (episode && method === "GET") {
      const known = this.episodes.get(decodeURIComponent(episode[1]));
      return known ? { status: 200, body: known.wire } : { status: 404, body: { message: "not found" } };
    }
    if (episode && method === "DELETE") { this.episodes.delete(decodeURIComponent(episode[1])); return { status: 200, body: { message: "gone" } }; }
    const listing = path.match(/^\/graph\/(episodes|edge|node)\/graph\/([^/?]+)/);
    if (listing && method === "POST") {
      const graphId = decodeURIComponent(listing[2]), order = body as { order_by?: unknown; direction?: unknown } | null;
      const ordered = (rows: Record<string, unknown>[], key: string): Record<string, unknown>[] => {
        const sign = order?.direction === "desc" ? -1 : 1, text = (row: Record<string, unknown>, k: string) => String(row[k] ?? "");
        return [...rows].sort((x, y) => sign * (text(x, key) < text(y, key) ? -1 : text(x, key) > text(y, key) ? 1 : text(x, "uuid") < text(y, "uuid") ? -1 : text(x, "uuid") > text(y, "uuid") ? 1 : 0));
      };
      if (listing[1] === "episodes") return { status: 200, body: ordered([...this.episodes.values()].filter(e => e.graphId === graphId).map(e => e.wire), order?.order_by === "uuid" ? "uuid" : "created_at") };
      if (listing[1] === "node") return { status: 200, body: ordered(this.nodesOf(graphId), order?.order_by === "created_at" ? "created_at" : "uuid") };
      const wanted = ((body as { filters?: { episode_uuids?: unknown } } | null)?.filters?.episode_uuids ?? []) as string[];
      const edges = listing[1] === "edge" ? (this.edgesByGraph[graphId] ?? (this.derivedFacts ? this.derivedEdges(graphId) : [])).filter(edge => !Array.isArray((body as { filters?: { episode_uuids?: unknown } } | null)?.filters?.episode_uuids)
        || (edge.episodes as string[] | undefined)?.some(id => wanted.includes(id))) : [];
      return { status: 200, body: ordered(edges, order?.order_by === "created_at" ? "created_at" : "uuid") };
    }
    if (method === "DELETE") return { status: 200, body: { message: "gone" } };
    return { status: 404, body: { message: `no route ${method} ${path}` } };
  }

  last(match: (r: SeenRequest) => boolean): SeenRequest | undefined {
    return [...this.requests].reverse().find(match);
  }

  async start(): Promise<void> {
    if (this.server.listening) return;
    this.server.keepAliveTimeout = 60_000;
    await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v2`;
  }

  stop(): void {
    this.server.closeAllConnections();
    this.server.close();
  }
}
