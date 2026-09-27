// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { declined, McpError, McpSession, parseMessage, type JsonRpcResponse } from "./mcp-session.js";
import { parseChallenge } from "./oauth.js";
import { OutboundRefused } from "./outbound.js";

export class McpAuthRequired extends Error {
  constructor(readonly challenge: { resourceMetadata?: string; scope?: string }, readonly insufficientScope = false) {
    super(insufficientScope ? "the server wants more access than was granted" : "the server refused the access token");
  }
}
async function readSse(res: Response, id: number, onRequest: (message: Record<string, unknown>) => void): Promise<JsonRpcResponse> {
  if (!res.body) throw new McpError("the server's stream is empty", "protocol");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let data: string[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline: number;
      while ((newline = buffer.search(/\r\n|\r|\n/)) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));
        if (line === "") {
          if (data.length) {
            const message = parseMessage(data.join("\n"));
            data = [];
            if (message && "id" in message && message.id === id && ("result" in message || "error" in message)) return message as unknown as JsonRpcResponse;
            if (message && typeof message.method === "string" && "id" in message) onRequest(message);
          }
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  throw new McpError("the server closed the stream without an answer", "unreachable");
}

export interface McpRemoteOptions {
  fetch: typeof fetch;
  token: () => Promise<string | null>;
  refused: (challenge: { resourceMetadata?: string; scope?: string }, token: string | null) => Promise<boolean>;
  clientVersion: string;
}

export class McpRemote extends McpSession {
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(readonly url: string, private readonly options: McpRemoteOptions) {
    super(options.clientVersion);
  }

  private async post(message: Record<string, unknown>, timeoutMs: number, retried = { auth: false, session: false }): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": this.protocolVersion,
    };
    const token = await this.options.token();
    if (token) headers.authorization = `Bearer ${token}`;
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    let res: Response;
    try {
      res = await this.options.fetch(this.url, { method: "POST", headers, body: JSON.stringify(message), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if ((error as Error).name === "TimeoutError") throw new McpError(`no answer within ${Math.round(timeoutMs / 1000)} s`, "unreachable");
      throw error instanceof OutboundRefused ? error : new McpError("the server could not be reached", "unreachable");
    }
    if (res.status === 401 || res.status === 403) {
      const challenge = parseChallenge(res.headers.get("www-authenticate"));
      const insufficient = res.status === 403 && /insufficient_scope/i.test(res.headers.get("www-authenticate") ?? "");
      await res.body?.cancel();
      if (res.status === 403 && !insufficient) throw new McpError("the server forbids this", "server");
      if (!insufficient && !retried.auth && await this.options.refused(challenge, token)) return this.post(message, timeoutMs, { ...retried, auth: true });
      throw new McpAuthRequired(challenge, insufficient);
    }
    if (res.status === 404 && this.sessionId && message.method !== "initialize" && !retried.session) {
      await res.body?.cancel();
      this.sessionId = null;
      this.forget();
      await this.ready();
      return this.post(message, timeoutMs, { ...retried, session: true });
    }
    return res;
  }

  protected async request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params }, timeoutMs);
    if (!res.ok) {
      await res.body?.cancel();
      throw new McpError(`the server answered ${res.status}`, res.status >= 500 ? "unreachable" : "server");
    }
    if (method === "initialize") {
      const session = res.headers.get("mcp-session-id");
      if (session && /^[\x21-\x7e]{1,256}$/.test(session)) this.sessionId = session;
    }
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    let answer: JsonRpcResponse;
    if (type.startsWith("text/event-stream")) {
      answer = await readSse(res, id, (request) => void this.decline(request));
    } else if (type.startsWith("application/json")) {
      const body = parseMessage(await res.text());
      if (!body || body.id !== id) throw new McpError("the server's answer is not the answer to this request", "protocol");
      answer = body as unknown as JsonRpcResponse;
    } else {
      await res.body?.cancel();
      throw new McpError(`the server answered with ${type || "no content type"}`, "protocol");
    }
    if (answer.error) throw new McpError(`the server refused: ${String(answer.error.message ?? answer.error.code)}`, "server");
    return answer.result;
  }

  private async decline(request: Record<string, unknown>): Promise<void> {
    try {
      const res = await this.post(declined(request), 10_000);
      await res.body?.cancel();
    } catch { }
  }

  protected async notify(method: string): Promise<void> {
    const res = await this.post({ jsonrpc: "2.0", method }, 10_000);
    await res.body?.cancel();
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    const headers: Record<string, string> = { "mcp-session-id": this.sessionId, "mcp-protocol-version": this.protocolVersion };
    this.sessionId = null;
    this.forget();
    try {
      const token = await this.options.token();
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await this.options.fetch(this.url, { method: "DELETE", headers, signal: AbortSignal.timeout(5_000) });
      await res.body?.cancel();
    } catch { }
  }
}
