// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { JsonRpcError, JsonRpcId, JsonRpcMessage } from "./acp-types.js";

export class MethodNotFound extends Error {
  constructor(public readonly method: string) {
    super(`Method not found: ${method}`);
  }
}

export class RemoteError extends Error {
  constructor(public readonly rpc: JsonRpcError, public readonly method: string) {
    super(`${method} failed: ${rpc.message} (code ${rpc.code})`);
  }
}

export interface PeerHandlers {
  onRequest(method: string, params: unknown): Promise<unknown>;
  onNotification(method: string, params: unknown): void;
  onRaw?(direction: "in" | "out", message: unknown): void;
  onProtocolError?(text: string): void;
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class JsonRpcPeer {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private closed = false;

  constructor(
    private readonly input: Writable,
    output: Readable,
    private readonly handlers: PeerHandlers,
  ) {
    const rl = createInterface({ input: output });
    rl.on("line", (line) => {
      void this.onLine(line);
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(`connection closed (${method})`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(new Error(`${p.method}: ${reason}`));
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private write(message: JsonRpcMessage): void {
    if (this.closed) return;
    this.handlers.onRaw?.("out", message);
    this.input.write(JSON.stringify(message) + "\n");
  }

  private async onLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      this.handlers.onProtocolError?.(`non-JSON line on stdout: ${trimmed.slice(0, 200)}`);
      return;
    }
    this.handlers.onRaw?.("in", msg);

    if ("method" in msg) {
      const hasId = "id" in msg && msg.id !== undefined && msg.id !== null;
      if (hasId) {
        const id = (msg as { id: JsonRpcId }).id;
        try {
          const result = await this.handlers.onRequest(msg.method, msg.params);
          this.write({ jsonrpc: "2.0", id, result: result ?? null });
        } catch (error) {
          const rpcError: JsonRpcError =
            error instanceof MethodNotFound
              ? { code: -32601, message: error.message }
              : { code: -32603, message: error instanceof Error ? error.message : String(error) };
          this.write({ jsonrpc: "2.0", id, error: rpcError });
        }
      } else {
        this.handlers.onNotification(msg.method, msg.params);
      }
      return;
    }

    if ("id" in msg) {
      const p = this.pending.get(msg.id);
      if (!p) {
        this.handlers.onProtocolError?.(`response for unknown id ${String(msg.id)}`);
        return;
      }
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new RemoteError(msg.error, p.method));
      else p.resolve(msg.result);
    }
  }
}
