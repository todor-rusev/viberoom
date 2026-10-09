// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { Server } from "node:http";
import { createObservedTestServer } from "../owned-native-test-resources.js";

export class ModelDouble {
  private server: Server;
  url = "";
  requests: Array<{ path: string; auth: string | undefined; body: Record<string, unknown> }> = [];
  reply: { status: number; content?: unknown; raw?: string; delayMs?: number } = { status: 200 };
  queue: Array<{ status: number; content?: unknown; raw?: string; delayMs?: number }> = [];
  respond?: (request: { path: string; auth: string | undefined; body: Record<string, unknown> }) => { status: number; content?: unknown; raw?: string; delayMs?: number } | undefined;
  constructor() {
    this.server = createObservedTestServer((req, res) => {
      let data = "";
      req.on("data", chunk => (data += chunk));
      req.on("end", () => {
        const request = { path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(data) as Record<string, unknown> };
        this.requests.push(request);
        const reply = this.respond?.(request) ?? this.queue.shift() ?? this.reply;
        const answer = (): void => {
          if (res.destroyed) return;
          res.writeHead(reply.status, { "content-type": "application/json" });
          res.end(reply.raw ?? JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply.content) } }] }));
        };
        if (reply.delayMs) setTimeout(answer, reply.delayMs);
        else answer();
      });
    });
  }
  async start(): Promise<void> {
    this.server.keepAliveTimeout = 60_000;
    await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    this.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;
  }
  stop(): void {
    this.server.closeAllConnections();
    this.server.close();
  }
}
