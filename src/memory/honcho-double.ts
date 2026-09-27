// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { createServer, type Server } from "node:http";

export interface HonchoSeen { method: string; path: string; body: Record<string, unknown> | null }

interface StoredMessage { id: string; content: string; peer_id: string; session_id: string; created_at: string; metadata: Record<string, unknown>; token_count: number }

export class HonchoDouble {
  private server: Server;
  url = "";
  requests: HonchoSeen[] = [];
  force = new Map<string, { status: number; body: unknown }>();
  messages = new Map<string, StoredMessage[]>();
  private counter = 0;

  constructor() {
    this.server = createServer((req, res) => {
      let data = "";
      req.on("data", chunk => (data += chunk));
      req.on("end", () => {
        const path = req.url ?? "";
        const body = data ? JSON.parse(data) as Record<string, unknown> : null;
        this.requests.push({ method: req.method ?? "", path, body });
        const forced = [...this.force.entries()].find(([prefix]) => path.startsWith(prefix));
        const answer = forced ? forced[1] : this.answer(req.method ?? "", path, body);
        res.writeHead(answer.status, { "content-type": "application/json" });
        res.end(JSON.stringify(answer.body));
      });
    });
  }

  private answer(method: string, path: string, body: Record<string, unknown> | null): { status: number; body: unknown } {
    const now = new Date(0).toISOString();
    if (method === "POST" && /\/v3\/workspaces$/.test(path)) {
      return { status: 200, body: { id: String(body?.id ?? "ws"), metadata: {}, configuration: {}, created_at: now } };
    }
    if (method === "POST" && /\/peers\/list(\?|$)/.test(path)) {
      return { status: 200, body: { items: [], page: 1, size: 1, total: 0, pages: 0 } };
    }
    if (method === "POST" && /\/sessions$/.test(path)) {
      return { status: 200, body: { id: String(body?.id ?? "s"), workspace_id: "ws", is_active: true, metadata: {}, configuration: {}, created_at: now } };
    }
    const sessionPath = path.match(/\/sessions\/([^/?]+)(\/[a-z]+)?(\?|$)/);
    if (sessionPath) {
      const sessionId = decodeURIComponent(sessionPath[1]);
      const tail = sessionPath[2] ?? "";
      if (method === "POST" && tail === "/peers") return { status: 200, body: {} };
      if (method === "POST" && tail === "/messages") {
        const inputs = (body?.messages ?? []) as Array<{ peer_id: string; content: string; metadata?: Record<string, unknown>; created_at?: string }>;
        const stored = inputs.map((m) => ({
          id: `msg-${++this.counter}`, content: m.content, peer_id: m.peer_id, session_id: sessionId,
          created_at: m.created_at ?? now, metadata: m.metadata ?? {},
          token_count: Math.max(1, Math.ceil(m.content.length / 4)),
        }));
        const list = this.messages.get(sessionId) ?? [];
        list.push(...stored);
        this.messages.set(sessionId, list);
        return { status: 200, body: stored.map((m) => ({ ...m, workspace_id: "ws" })) };
      }
      if (method === "POST" && tail === "/search") {
        const query = String((body as { query?: unknown })?.query ?? "");
        const all = this.messages.get(sessionId) ?? [];
        const hits = all.filter((m) => m.content.toLowerCase().includes(query.toLowerCase().split(" ")[0] ?? ""));
        return { status: 200, body: (hits.length ? hits : all).map((m) => ({ ...m, workspace_id: "ws" })) };
      }
      if (method === "DELETE" && !tail) {
        this.messages.delete(sessionId);
        return { status: 200, body: {} };
      }
    }
    return { status: 404, body: { detail: `no route ${method} ${path}` } };
  }

  episodeCount(): number {
    let count = 0;
    for (const list of this.messages.values()) count += list.length;
    return count;
  }

  async start(): Promise<void> {
    await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  }

  stop(): void {
    this.server.closeAllConnections();
    this.server.close();
  }
}
