// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const startsAt = argv.indexOf("--starts");
if (startsAt >= 0) appendFileSync(argv[startsAt + 1], "started\n");
if (argv.includes("--not-mcp")) {
  process.stdout.write("Usage: fake-tool <file>\nThis is a command-line tool.\n");
  process.exit(0);
}
if (argv.includes("--fail-start")) {
  process.stderr.write("Error: FAKE_TOKEN is not set\n");
  process.exit(1);
}

const TOOLS = [
  { name: "echo", description: "Says the text back.", inputSchema: { type: "object", properties: { text: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { name: "whoami", description: "Says the key it was started with and the folder it runs in.", inputSchema: { type: "object", properties: {} } },
  { name: "ask", description: "Asks the client for sampling first, then answers what the client said.", inputSchema: { type: "object", properties: {} } },
  { name: "crash", description: "Stops the program in the middle of a call.", inputSchema: { type: "object", properties: {} } },
];

const send = (message: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(message)}\n`);
const asked = new Map<string, (answer: Record<string, unknown>) => void>();

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line) as { id?: number | string; method?: string; params?: Record<string, unknown>; error?: { code: number } };
  if (message.method === undefined && message.id !== undefined) {
    asked.get(String(message.id))?.(message as Record<string, unknown>);
    return;
  }
  if (message.id === undefined) return;
  const answer = (result: unknown) => send({ jsonrpc: "2.0", id: message.id, result });
  const text = (value: string) => answer({ content: [{ type: "text", text: value }] });
  if (message.method === "initialize") return answer({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake-local", version: "1" } });
  if (message.method === "tools/list") return answer({ tools: TOOLS });
  if (message.method !== "tools/call") return send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "no such method" } });
  const name = message.params?.name;
  const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
  if (name === "echo") return text(String(args.text ?? ""));
  if (name === "whoami") return text(`token=${process.env.FAKE_TOKEN ?? "(none)"} cwd=${process.cwd()}`);
  if (name === "ask") {
    const id = `server-${Date.now()}`;
    asked.set(id, (reply) => text(`declined:${(reply.error as { code?: number } | undefined)?.code ?? "no error"}`));
    return send({ jsonrpc: "2.0", id, method: "sampling/createMessage", params: { messages: [] } });
  }
  if (name === "crash") {
    process.stderr.write("fatal: the fake server crashed\n");
    process.exit(3);
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: `no tool ${String(name)}` } });
});
