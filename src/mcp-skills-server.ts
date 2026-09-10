#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

const HUB = (process.env.VIBEROOM_HUB ?? "").replace(/\/+$/, "");
const TOKEN = process.env.VIBEROOM_TOKEN ?? "";
const VERSION = "0.2.0";
const TOOL_NAME = "load_skill";

const SKILL_FIELDS = {
  name: { type: "string", description: "short lowercase hyphenated name; it becomes the /command (1-32 letters, digits, _ or -)" },
  description: { type: "string", description: "what the skill does and when to use it (one or two sentences; agents decide from this alone; max 300 characters)" },
  instructions: { type: "string", description: "the skill text: imperative steps or a format; use $ARGUMENTS where the caller's text belongs (markdown, max 20000 characters)" },
  argument_hint: { type: "string", description: "optional hint for the human's / menu, e.g. [PR number]; give one when the instructions use $ARGUMENTS" },
  user_invocable: { type: "boolean", description: "optional (default true): the human may invoke it with /name" },
  agent_invocable: { type: "boolean", description: "optional (default true): agents may load it themselves" },
  dry_run: { type: "boolean", description: "optional: only lint, write nothing" },
};

const DESIGN_FIELDS = {
  kind: { type: "string", enum: ["template", "room"], description: "template: a whole template (name, description, vibemates); room: a change to this room, starting from its current settings" },
  name: { type: "string", description: "the template's name (1-40 characters; the id is derived from it)" },
  description: { type: "string", description: "what the room is for and how it feels, two sentences; shown in the picker" },
  emoji: { type: "string", description: "optional: the room's emoji" },
  settings: {
    type: "object",
    description: "room settings by key, only the ones you set; describe_room lists the keys with their meaning, bounds and defaults. Rules go in customRules, one per line.",
    additionalProperties: true,
  },
  vibemates: {
    type: "array",
    description: "the vibemates: name (1-24 letters, digits, _ or -), tagline (the one line the others see, up to 80 characters), role (who this one is and which way it leans; private), avatar (one emoji), skills (names from the library)",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        tagline: { type: "string" },
        role: { type: "string" },
        avatar: { type: "string" },
        skills: { type: "array", items: { type: "string" } },
        replyDelay: { type: "number", description: "optional: seconds this vibemate waits before a turn, overriding the room's delay" },
      },
      required: ["name"],
    },
  },
};

const TOOLS = [
  {
    name: TOOL_NAME,
    description:
      "Load the full instructions of one of your skills (the skills listed in your room brief) or of a built-in skill such as skill-writer. Returns the skill text; read it and then follow it in the same reply. Call it only when the task matches a skill's description.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "the skill name exactly as listed in your brief" } },
      required: ["name"],
    },
  },
  {
    name: "create_skill",
    description:
      "Create a new skill in the shared skill library (reusable instructions for one kind of task, usable by you later and by other agents). Load the built-in skill \"skill-writer\" first for the rules. The hub lints the skill and returns the problems if it cannot be saved. The human sees every new skill in Settings.",
    inputSchema: { type: "object", properties: SKILL_FIELDS, required: ["name", "description", "instructions"] },
  },
  {
    name: "update_skill",
    description: "Update a skill that an agent created earlier (human-written skills are read-only for agents). Same fields as create_skill; all of description and instructions are replaced.",
    inputSchema: { type: "object", properties: SKILL_FIELDS, required: ["name", "description", "instructions"] },
  },
  {
    name: "attach_skill",
    description:
      "Attach a library skill to yourself (to: \"me\") or to other agents in this room (to: [\"Boris\", \"Vera\"]). Attached skills appear in the agent's brief so it can load them. Attaching to others is announced in the room.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "the skill name" },
        to: { description: '"me", or a list of agent names in this room', anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
      },
      required: ["name"],
    },
  },
  {
    name: "describe_room",
    description:
      "The facts about this room before you design anything: its settings with their meaning, bounds, defaults and current values; the rules; the vibemates (name, tagline, role, avatar, skills); the skill library; the templates that exist; and the brief you yourself receive. Read-only. Load the built-in skill \"room-designer\" for what makes rules and roles good.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "lint_room_design",
    description:
      "Check a room design without saving anything: the same errors and warnings create_template / propose_room_changes would give, plus a preview of the brief the first vibemate would receive (exactly what the room will read). kind \"template\" checks a whole template; kind \"room\" checks a change to this room, starting from its current settings.",
    inputSchema: { type: "object", properties: DESIGN_FIELDS, required: ["kind"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_template",
    description:
      "Save a room template into the human's library: a file the human picks under New room to create a room with these settings, rules and vibemates. No effect on any existing room. The hub checks the design first (errors stop the save, warnings come back with it). A taken name gets a numbered id unless replace is true and the template is one you or the human made.",
    inputSchema: {
      type: "object",
      properties: {
        name: DESIGN_FIELDS.name,
        description: DESIGN_FIELDS.description,
        emoji: DESIGN_FIELDS.emoji,
        settings: DESIGN_FIELDS.settings,
        vibemates: DESIGN_FIELDS.vibemates,
        replace: { type: "boolean", description: "optional: overwrite the template with this name instead of saving a numbered copy (never a template viberoom ships)" },
      },
      required: ["name", "description", "vibemates"],
    },
  },
  {
    name: "propose_room_changes",
    description:
      "Propose changes to this room: settings by key (rules in customRules, one per line) and vibemates to add, update or remove. The hub checks the change set like a template, then shows the human a card with the diff and the warnings; nothing changes until the human clicks Apply, and the room gets a line with the outcome. A new vibemate is added waiting for the human to pick its coding agent. Say in why what the change fixes.",
    inputSchema: {
      type: "object",
      properties: {
        why: { type: "string", description: "one or two sentences: what this change fixes or enables; shown on the card" },
        settings: DESIGN_FIELDS.settings,
        vibemates: {
          type: "object",
          description: "optional: vibemates to add (full entries), update (by name; give only the fields that change; newName renames) or remove (names)",
          properties: {
            add: DESIGN_FIELDS.vibemates,
            update: {
              type: "array",
              items: { type: "object", properties: { name: { type: "string" }, newName: { type: "string" }, tagline: { type: "string" }, role: { type: "string" }, avatar: { type: "string" }, skills: { type: "array", items: { type: "string" } }, replyDelay: { type: "number" } }, required: ["name"] },
            },
            remove: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["why"],
    },
  },
  {
    name: "read_message",
    description:
      "One message of this room by its number: the whole of a message that was quoted to you as \"> Name (#N, time): …\", or any message whose #N you have seen. Returns who wrote it, to whom, when, its text, its images as file paths and, with around > 0, up to that many messages before and after it. Read-only; the human sees the call like any other tool call.",
    inputSchema: {
      type: "object",
      properties: {
        seq: { type: "integer", description: "the message number, the N of #N" },
        around: { type: "integer", minimum: 0, maximum: 5, description: "optional: how many neighbouring messages to include on each side (default 0, at most 5)" },
      },
      required: ["seq"],
    },
    annotations: { readOnlyHint: true },
  },
];

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

let readySent = false;

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: number | string | null | undefined, result: unknown): void {
  send({ jsonrpc: "2.0", id: id ?? null, result });
}

function fail(id: number | string | null | undefined, code: number, message: string): void {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

async function hub(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  if (!HUB || !TOKEN) return { ok: false, status: 0, body: { error: "viberoom hub address or token missing" } };
  try {
    const res = await fetch(`${HUB}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { error: `hub unreachable: ${error instanceof Error ? error.message : String(error)}` } };
  }
}

function announceReady(): void {
  if (readySent) return;
  readySent = true;
  void hub("/api/mcp/ready", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
}

async function handle(message: JsonRpcMessage): Promise<void> {
  const { id, method, params } = message;
  if (!method) return;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "viberoom", version: VERSION },
      });
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return;
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS });
      announceReady();
      return;
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : "";
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const errorResult = (fallback: string, res: { body: Record<string, unknown> }): void => {
        const text = typeof res.body.error === "string" ? res.body.error : fallback;
        reply(id, { content: [{ type: "text", text }], isError: true });
      };
      if (name === TOOL_NAME) {
        const skill = typeof args.name === "string" ? args.name.trim() : "";
        const res = await hub(`/api/mcp/skill?token=${encodeURIComponent(TOKEN)}&name=${encodeURIComponent(skill)}`);
        if (!res.ok) return errorResult(`skill "${skill}" could not be loaded`, res);
        reply(id, { content: [{ type: "text", text: String(res.body.text ?? "") }] });
        return;
      }
      if (name === "create_skill" || name === "update_skill") {
        const res = await hub("/api/mcp/skills", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, op: name === "update_skill" ? "update" : "create", ...args }),
        });
        if (!res.ok) return errorResult("the skill could not be saved", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "saved") }] });
        return;
      }
      if (name === "attach_skill") {
        const res = await hub("/api/mcp/attach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, name: args.name, to: args.to ?? "me" }),
        });
        if (!res.ok) return errorResult("the skill could not be attached", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "attached") }] });
        return;
      }
      if (name === "describe_room") {
        const res = await hub(`/api/mcp/room?token=${encodeURIComponent(TOKEN)}`);
        if (!res.ok) return errorResult("the room could not be described", res);
        reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] });
        return;
      }
      if (name === "lint_room_design") {
        const res = await hub("/api/mcp/design/lint", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, ...args }),
        });
        if (!res.ok) return errorResult("the design could not be checked", res);
        reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }], isError: res.body.ok === false ? true : undefined });
        return;
      }
      if (name === "create_template") {
        const res = await hub("/api/mcp/templates", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, ...args }),
        });
        if (!res.ok) return errorResult("the template could not be saved", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "saved") }] });
        return;
      }
      if (name === "propose_room_changes") {
        const res = await hub("/api/mcp/propose", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: TOKEN, ...args }),
        });
        if (!res.ok) return errorResult("the proposal could not be made", res);
        reply(id, { content: [{ type: "text", text: String(res.body.message ?? "proposed") }] });
        return;
      }
      if (name === "read_message") {
        const seq = Number(args.seq);
        if (!Number.isInteger(seq)) return fail(id, -32602, "read_message needs seq: the message number, the N of #N");
        const around = Number(args.around);
        const res = await hub(`/api/mcp/message?token=${encodeURIComponent(TOKEN)}&seq=${seq}${Number.isInteger(around) && around > 0 ? `&around=${around}` : ""}`);
        if (!res.ok) return errorResult("the message could not be read", res);
        reply(id, { content: [{ type: "text", text: JSON.stringify(res.body, null, 2) }] });
        return;
      }
      fail(id, -32602, `unknown tool: ${name}`);
      return;
    }
    default:
      if (id !== undefined) fail(id, -32601, `method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newline: number;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      continue;
    }
    void handle(message);
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
