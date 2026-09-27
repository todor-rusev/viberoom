// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpTool } from "./mcp-session.js";

export interface FakeSystemOptions {
  tools?: McpTool[];
  sse?: boolean;
  accessTtl?: number;
  issParameter?: boolean;
  claimedIssuer?: string;
  open?: boolean;
}

export class FakeSystem {
  private server!: Server;
  origin = "";
  readonly clients = new Map<string, { secret?: string; redirectUris: string[] }>();
  private codes = new Map<string, { clientId: string; challenge: string; redirectUri: string; resource: string }>();
  readonly access = new Map<string, number>();
  readonly refresh = new Set<string>();
  readonly revoked: string[] = [];
  readonly calls: { name: string; arguments: unknown; token: string }[] = [];
  sessions = new Set<string>();
  refreshCount = 0;
  tools: McpTool[];
  forgeIss: string | null = null;
  open: boolean;

  constructor(private readonly options: FakeSystemOptions = {}) {
    this.open = options.open ?? false;
    this.tools = options.tools ?? [
      { name: "search", description: "Search pages", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
      { name: "create_page", description: "Create a page", inputSchema: { type: "object", properties: { title: { type: "string" } } } },
    ];
  }

  get mcpUrl(): string { return `${this.origin}/mcp`; }
  get issuer(): string { return `${this.origin}/auth`; }

  async start(): Promise<this> {
    this.server = createServer((req, res) => { void this.route(req, res); });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  async approve(authorizeUrl: string): Promise<Response> {
    const res = await fetch(authorizeUrl, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const location = res.headers.get("location");
    if (!location) throw new Error(`the sign-in page did not redirect: ${res.status}`);
    return fetch(location, { signal: AbortSignal.timeout(10_000) });
  }

  private async body(req: IncomingMessage): Promise<string> {
    let text = "";
    for await (const chunk of req) text += chunk;
    return text;
  }

  private json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(value));
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.origin);
    const path = url.pathname;
    if (path === "/.well-known/oauth-protected-resource/mcp") {
      return this.json(res, 200, { resource: this.mcpUrl, authorization_servers: [this.issuer], scopes_supported: ["read", "write"] });
    }
    if (path === "/.well-known/oauth-authorization-server/auth") {
      return this.json(res, 200, {
        issuer: this.options.claimedIssuer ?? this.issuer,
        authorization_endpoint: `${this.origin}/auth/authorize`,
        token_endpoint: `${this.origin}/auth/token`,
        registration_endpoint: `${this.origin}/auth/register`,
        revocation_endpoint: `${this.origin}/auth/revoke`,
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
        authorization_response_iss_parameter_supported: this.options.issParameter ?? true,
        scopes_supported: ["read", "write", "offline_access"],
      });
    }
    if (path === "/auth/register" && req.method === "POST") {
      const body = JSON.parse(await this.body(req));
      const clientId = `client-${randomBytes(4).toString("hex")}`;
      this.clients.set(clientId, { redirectUris: body.redirect_uris });
      return this.json(res, 201, { client_id: clientId, token_endpoint_auth_method: "none", redirect_uris: body.redirect_uris });
    }
    if (path === "/auth/authorize") {
      const q = url.searchParams;
      const client = this.clients.get(q.get("client_id") ?? "");
      const redirect = q.get("redirect_uri") ?? "";
      if (!client || !client.redirectUris.includes(redirect)) return this.json(res, 400, { error: "invalid_request" });
      if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return this.json(res, 400, { error: "invalid_request" });
      const code = randomBytes(8).toString("hex");
      this.codes.set(code, { clientId: q.get("client_id")!, challenge: q.get("code_challenge")!, redirectUri: redirect, resource: q.get("resource") ?? "" });
      const back = new URL(redirect);
      back.searchParams.set("code", code);
      back.searchParams.set("state", q.get("state") ?? "");
      if (this.forgeIss !== null) back.searchParams.set("iss", this.forgeIss);
      else if (this.options.issParameter ?? true) back.searchParams.set("iss", this.issuer);
      res.writeHead(302, { location: back.href });
      return void res.end();
    }
    if (path === "/auth/token" && req.method === "POST") {
      const form = new URLSearchParams(await this.body(req));
      if (form.get("resource") !== this.mcpUrl) return this.json(res, 400, { error: "invalid_target" });
      if (form.get("grant_type") === "authorization_code") {
        const grant = this.codes.get(form.get("code") ?? "");
        this.codes.delete(form.get("code") ?? "");
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (!grant || grant.clientId !== form.get("client_id") || grant.redirectUri !== form.get("redirect_uri") || grant.challenge !== challenge) {
          return this.json(res, 400, { error: "invalid_grant" });
        }
        return this.json(res, 200, this.issue());
      }
      if (form.get("grant_type") === "refresh_token") {
        this.refreshCount++;
        const old = form.get("refresh_token") ?? "";
        if (!this.refresh.has(old)) return this.json(res, 400, { error: "invalid_grant" });
        this.refresh.delete(old);
        return this.json(res, 200, this.issue());
      }
      return this.json(res, 400, { error: "unsupported_grant_type" });
    }
    if (path === "/auth/revoke" && req.method === "POST") {
      const form = new URLSearchParams(await this.body(req));
      const token = form.get("token") ?? "";
      this.revoked.push(token);
      this.refresh.delete(token);
      this.access.delete(token);
      res.writeHead(200);
      return void res.end();
    }
    if (path === "/mcp") return this.mcp(req, res);
    res.writeHead(404);
    res.end();
  }

  private issue() {
    const access = `at-${randomBytes(8).toString("hex")}`;
    const refresh = `rt-${randomBytes(8).toString("hex")}`;
    const ttl = this.options.accessTtl ?? 3600;
    this.access.set(access, Date.now() + ttl * 1000);
    this.refresh.add(refresh);
    return { access_token: access, token_type: "Bearer", expires_in: ttl, refresh_token: refresh, scope: "read write" };
  }

  expireAccess(): void {
    for (const token of this.access.keys()) this.access.set(token, 0);
  }

  private async mcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const expiry = this.access.get(token);
    if (!this.open && (expiry === undefined || expiry < Date.now())) {
      await this.body(req);
      res.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${this.origin}/.well-known/oauth-protected-resource/mcp", scope="read write"` });
      return void res.end();
    }
    if (req.method === "DELETE") {
      this.sessions.delete(String(req.headers["mcp-session-id"]));
      res.writeHead(204);
      return void res.end();
    }
    const message = JSON.parse(await this.body(req));
    const session = req.headers["mcp-session-id"];
    if (message.method === "initialize") {
      const id = randomBytes(6).toString("hex");
      this.sessions.add(id);
      return this.answer(res, message.id, { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake-system", version: "1.0" } }, { "mcp-session-id": id });
    }
    if (typeof session !== "string" || !this.sessions.has(session)) {
      res.writeHead(404);
      return void res.end();
    }
    if (message.id === undefined) { res.writeHead(202); return void res.end(); }
    if (message.method === "tools/list") return this.answer(res, message.id, { tools: this.tools });
    if (message.method === "tools/call") {
      this.calls.push({ name: message.params.name, arguments: message.params.arguments, token });
      return this.answer(res, message.id, { content: [{ type: "text", text: `ran ${message.params.name}` }] });
    }
    return this.answer(res, message.id, undefined, {}, { code: -32601, message: "no such method" });
  }

  private answer(res: ServerResponse, id: unknown, result: unknown, headers: Record<string, string> = {}, error?: unknown): void {
    const message = { jsonrpc: "2.0", id, ...(error ? { error } : { result }) };
    if (this.options.sse) {
      res.writeHead(200, { "content-type": "text/event-stream", ...headers });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}\n\n`);
      res.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
      return void res.end();
    }
    this.json(res, 200, message, headers);
  }
}
