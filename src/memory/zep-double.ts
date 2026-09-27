// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { createServer, type Server } from "node:http";

export interface SeenRequest { method: string; path: string; body: Record<string, unknown> | null }

export class ZepDouble {
  private server: Server;
  url = "";
  requests: SeenRequest[] = [];
  force = new Map<string, { status: number; body: unknown }>();
  edgesByGraph: Record<string, Record<string, unknown>[]> = {};
  edges: Record<string, unknown>[] = [
    { uuid: "e1", fact: "The default provider is Zep", name: "USES", created_at: new Date(0).toISOString(), source_node_uuid: "a", target_node_uuid: "b", valid_at: "2026-09-23T00:00:00Z", score: 0.87 },
    { uuid: "e2", fact: "The default provider was Honcho", name: "USES", created_at: new Date(0).toISOString(), source_node_uuid: "a", target_node_uuid: "c", valid_at: "2026-09-01T00:00:00Z", invalid_at: "2026-09-23T00:00:00Z", score: 0.31 },
  ];

  constructor() {
    this.server = createServer((req, res) => {
      let data = "";
      req.on("data", chunk => (data += chunk));
      req.on("end", () => {
        const path = (req.url ?? "").replace(/^\/v2/, "");
        this.requests.push({ method: req.method ?? "", path, body: data ? JSON.parse(data) : null });
        const forced = [...this.force.entries()].find(([suffix]) => path.startsWith(suffix));
        const answer = forced ? forced[1] : this.answer(req.method ?? "", path, this.requests.at(-1)!.body);
        res.writeHead(answer.status, { "content-type": "application/json" });
        res.end(JSON.stringify(answer.body));
      });
    });
  }

  private answer(method: string, path: string, body: unknown): { status: number; body: unknown } {
    if (path.startsWith("/graph/list-all")) return { status: 200, body: { graphs: [] } };
    if (path === "/graph/create") return { status: 200, body: { graph_id: "g", id: 1 } };
    if (path === "/entity-types") return { status: 200, body: { message: "ok" } };
    if (path === "/graph" && method === "POST") return { status: 200, body: { uuid: `ep-${this.requests.length}`, content: "x", created_at: new Date(0).toISOString(), processed: false } };
    if (path === "/graph/add-fact-triple") return { status: 200, body: {} };
    if (path === "/graph/search") {
      const graphId = String((body as { graph_id?: unknown } | null)?.graph_id ?? "");
      return { status: 200, body: { edges: this.edgesByGraph[graphId] ?? this.edges } };
    }
    if (method === "DELETE") return { status: 200, body: { message: "gone" } };
    return { status: 404, body: { message: `no route ${method} ${path}` } };
  }

  last(match: (r: SeenRequest) => boolean): SeenRequest | undefined {
    return [...this.requests].reverse().find(match);
  }

  async start(): Promise<void> {
    if (this.server.listening) return;
    await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v2`;
  }

  stop(): void {
    this.server.closeAllConnections();
    this.server.close();
  }
}
