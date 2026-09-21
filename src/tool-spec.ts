// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export const TOOL_NAME = "load_skill";

export const SKILL_FIELDS = {
  name: { type: "string", description: "short lowercase hyphenated name; it becomes the /command (1-32 letters, digits, _ or -)" },
  description: { type: "string", description: "what the skill does and when to use it (one or two sentences; agents decide from this alone; max 300 characters)" },
  instructions: { type: "string", description: "the skill text: imperative steps or a format; use $ARGUMENTS where the caller's text belongs (markdown, max 20000 characters)" },
  argument_hint: { type: "string", description: "optional hint for the human's / menu, e.g. [PR number]; give one when the instructions use $ARGUMENTS" },
  user_invocable: { type: "boolean", description: "optional (default true): the human may invoke it with /name" },
  agent_invocable: { type: "boolean", description: "optional (default true): agents may load it themselves" },
  dry_run: { type: "boolean", description: "optional: only lint, write nothing" },
};

export const DESIGN_FIELDS = {
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

export const LOOK_SPEC_FIELDS = {
  id: { type: "string", description: "short lower-case id (letters, digits, hyphens; 1-31 characters, starting with a letter): the file's name; never the id of a look viberoom ships" },
  label: { type: "string", description: "the name the picker shows (1-40 characters)" },
  extends: { type: "string", description: "the shipped look it starts from (describe_looks lists them: classic is VibeClassic, light; classic-dark; clay; comfort; plush is 3D; terminal); classic when omitted" },
  scheme: { type: "string", enum: ["light", "dark"], description: "light or dark paper (diagrams and marks are drawn for it); the base's when omitted" },
  palette: { type: "object", description: "hues laid over the base's palette, by name, each a flat colour #rrggbb: { primary: \"#b5533c\", bg: \"#f6f1e7\" }; describe_looks tells what every hue is for", additionalProperties: { type: "string" } },
  shape: { type: "object", description: "corners: rScale (0 square … 1.6 very round), rCtlMin (0px keeps each control's own corner, 99px makes every control a pill)", additionalProperties: { type: "string" } },
  type: { type: "object", description: "text: font and mono (an id from describe_looks fonts, or a family stack), lineHeight, fsScale", additionalProperties: { type: "string" } },
  motion: { type: "object", description: "tFast, tBase, tSlow (durations, 0ms for none), easeOut, easePop", additionalProperties: { type: "string" } },
  elevation: { type: "object", description: "shadows and light, as CSS: a shadow, none, or for bevel a gradient; $name, alpha($name, 0.2) and mix($a, $b, 0.5) may stand inside", additionalProperties: { type: "string" } },
  canvas: { type: "object", description: "the chat's paper: gradCanvas (a colour or gradients), canvasPattern (none, or a pattern), canvasPatternSize, gradPage, the scrollbar", additionalProperties: { type: "string" } },
  elements: { type: "object", description: "per element group, the parts to change: { bubble: { bg: \"$white\", border: \"alpha($ink, 0.12)\" }, btn: { shadow: \"none\" } }; describe_looks lists every group and key with its VibeClassic value", additionalProperties: { type: "object", additionalProperties: { type: "string" } } },
};

export const TOOLS = [
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
      "Create a new skill in the shared skill library (reusable instructions for one kind of task, usable by you later and by other agents). Load the built-in skill \"skill-writer\" first for the rules. The room lints the skill and returns the problems if it cannot be saved. The human sees every new skill in Settings.",
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
      "Save a room template into the human's library: a file the human picks under New room to create a room with these settings, rules and vibemates. No effect on any existing room. The room checks the design first (errors stop the save, warnings come back with it). A taken name gets a numbered id unless replace is true and the template is one you or the human made.",
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
      "Propose changes to this room: settings by key (rules in customRules, one per line) and vibemates to add, update or remove. The room checks the change set like a template, then shows the human a card with the diff and the warnings; nothing changes until the human clicks Apply, and the room gets a line with the outcome. A new vibemate is added waiting for the human to pick its coding agent. Say in why what the change fixes.",
    inputSchema: {
      type: "object",
      properties: {
        why: { type: "string", description: "one or two sentences: what this change fixes or enables; shown on the card" },
        settings: DESIGN_FIELDS.settings,
        vibemates: {
          type: "object",
          description: "optional: vibemates to add (full entries), update (by name; give only the fields that change; newName renames; model, effort and mode change what it runs on) or remove (names)",
          properties: {
            add: DESIGN_FIELDS.vibemates,
            update: {
              type: "array",
              items: { type: "object", properties: { name: { type: "string" }, newName: { type: "string" }, tagline: { type: "string" }, role: { type: "string" }, avatar: { type: "string" }, skills: { type: "array", items: { type: "string" } }, replyDelay: { type: "number" }, model: { type: "string", description: "what it runs on; describe_room names what this vibemate offers" }, effort: { type: "string", description: "how hard it thinks, when its vendor offers the choice" }, mode: { type: "string", description: "the mode it works in; a mode that acts without asking is never proposed silently, say so in why" }, muted: { type: "boolean", description: "true: it reads the room and never answers until it is unmuted; false: it answers again" } }, required: ["name"] },
            },
            remove: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["why"],
    },
  },
  {
    name: "propose_new_room",
    description:
      "Propose a new room, with the vibemates that would be in it. It becomes a card the human presses or refuses; nothing is created until they do, and this room is unchanged either way. The card carries the price — how many sessions would start and on which models. What is created comes with no working folder, out of reach of any messenger, and everyone in it starts in a mode that asks before it acts; a vibemate that arrived this way proposes no rooms of its own. One card at a time per room, and a field this tool does not know is refused rather than dropped. Say in why what the room is for.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "the room's name (1-40 letters, digits, spaces, _ or -)" },
        why: { type: "string", description: "one or two sentences: what the room is for; shown on the card" },
        vibemates: {
          type: "array",
          description: "who would be in it: 1-6 entries, each with a name (1-24 letters, digits, _ or -) and optionally tagline, role, avatar, agentType, model, effort",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              tagline: { type: "string", description: "the one line the others see, up to 80 characters" },
              role: { type: "string", description: "who this one is and which way it leans; private to it" },
              avatar: { type: "string", description: "one emoji" },
              agentType: { type: "string", description: "the coding agent it would run on; one that is not installed here waits in the roster" },
              model: { type: "string" },
              effort: { type: "string" },
            },
            required: ["name"],
          },
        },
      },
      required: ["name", "vibemates"],
    },
  },
  {
    name: "ask_for_bot_token",
    description:
      "Put a card on the human's screen asking for the key of their Telegram bot (from BotFather), when you guide the messenger setup. The key goes straight into viberoom's settings and the bot is started: it is not shown to you and does not enter the conversation, the record or your context. You learn only the outcome, as a row in this room: connected as @name, or the card closed without a key. One card at a time; it closes by itself after ten minutes.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "show_pairing_link",
    description:
      "Put a card on the human's screen with a one-time pairing link and its QR code for their phone, when you guide the messenger setup and the bot is connected (after ask_for_bot_token ended with connected). The link is shown only there: you do not see it and it does not enter the conversation. You learn only the outcome, as a row in this room: paired: <name>, closed, or expired (ten minutes; then call it again). One card at a time.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "describe_looks",
    description:
      "Everything about the looks before you design one: the looks that exist (the ones viberoom ships and the human's own), how the window is set now (the look worn, its fine-tuning, the fonts, the text size), every token a look may set with what it means and its VibeClassic value, how a value is written ($name, alpha(), mix()), the fonts by id, and what may be fine-tuned on any look without a spec. Read-only. Load the built-in skill \"look-designer\" for what makes a look good.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "lint_look",
    description:
      "Check a look spec without saving anything: whether every key exists and every value is of the right kind, and whether the words read on their paper (the contrast floors every look must pass), with the ratio of every pair measured, so you see the numbers you cannot see as colours. Errors must go before create_look takes it; warnings are advice.",
    inputSchema: { type: "object", properties: LOOK_SPEC_FIELDS, required: ["id", "label"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_look",
    description:
      "Save a look among the human's own looks: a file the human picks under Settings → Appearance, listed after the looks viberoom ships with the human's name on it. The spec extends a shipped look and changes only what it gives. The room checks it first (an error stops the save, warnings come back with it). Nothing is worn until the human picks it (or applies a propose_look_changes card). A taken id needs replace: true (one of the human's own looks may be replaced; a look viberoom ships never).",
    inputSchema: {
      type: "object",
      properties: {
        ...LOOK_SPEC_FIELDS,
        replace: { type: "boolean", description: "optional: overwrite the human's look with this id instead of refusing" },
      },
      required: ["id", "label"],
    },
  },
  {
    name: "propose_look_changes",
    description:
      "Propose a change to how the human's window looks, as a card the human applies or rejects: which look to wear (a shipped one, or one of the human's own by its id, e.g. one you just saved), the fine-tuning of a look (the adjustables describe_looks lists: a colour as #rrggbb, a scale as a number 0-2), the fonts, the text size. This is the whole window, not this room alone; nothing changes until the human clicks Apply, and the room gets a line with the outcome. Say in why what it improves.",
    inputSchema: {
      type: "object",
      properties: {
        why: { type: "string", description: "one or two sentences: what this change improves; shown on the card" },
        look: { type: "string", description: "optional: the id of the look to wear" },
        adjust: { type: "object", description: "optional: the fine-tuning of the look named in look (or of the one worn now): { accent: \"#b5533c\", corners: 0.5 }; describe_looks lists the keys", additionalProperties: {} },
        chatFontSize: { type: "number", description: "optional: the text size in px, 12-24" },
        font: { type: "string", description: "optional: a text font id (describe_looks fonts.text)" },
        mono: { type: "string", description: "optional: a code font id (describe_looks fonts.mono)" },
      },
      required: ["why"],
    },
  },
  {
    name: "search_history",
    description: "Find earlier conversation in this room by words, quoted phrase or prefix*. Several words are required together, so a whole question asked as a sentence usually finds nothing: widen it with OR (one OR two), ask for an exact phrase in quotes, or leave a word out with NOT. Returns ranked snippets and message numbers; the top hit includes up to two visible neighbours on each side. The response has a size limit and flags shortened text. Recent messages are included. Use read_message for the full text or more neighbours. Hidden, deleted and human-only messages are never returned. With rooms=\"all\" it also searches the rooms that share their history with this one, and each result names its room. If nothing relevant is found, try different wording and report the limits of the search. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, description: "words, quoted phrase or prefix* to find" },
        rooms: { type: "string", enum: ["this", "all"], description: "optional: this room only (default), or all the rooms open to you" },
        kinds: { type: "string", enum: ["chat", "chat,system"], description: "optional: chat by default; include room events explicitly" },
        author: { type: "string", description: "optional: the writer's name" },
        limit: { type: "integer", minimum: 1, maximum: 10, default: 3 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "check_room",
    description: "Check what is new and who is doing what, while you work. Beside the messages the answer carries a line per vibemate: its state, elapsed working time at this snapshot, how long nothing new has come from it, and the clock time its turn began Only when requested with draft.name, liveDraft contains that vibemate's unfinished visible text, clearly marked provisional. It is a separate observation, never a final reply; a draft cursor pages one revision and resets if it changes. Check new messages while working. status (default) gives snapshot-wide counts and headers: direct to you first, then broadcast, other, event; no bodies or acknowledgement. Broadcast includes @All and unaddressed chat. You decide whether to check and what to read: use read_message for a chosen seq, or mode=read for chronological bodies. nextCursor continues as after; status leaves it unchanged. nextPage continues headers as page with the same after; omit page for a fresh snapshot. Addressees are a clue, not grounds to ignore others or interrupt immediately. Responses stay within 16 KiB; truncation is explicit. Cursors belong to one turn; edits reset them. Normal next-turn delivery stays unchanged; do not poll in a waiting loop.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["status", "read"], default: "status", description: "status (default): inspect who wrote to whom without reading bodies; read: receive message bodies" },
        after: { type: "string", minLength: 1, maxLength: 1024, description: "optional: nextCursor from a previous check in this turn" },
        page: { type: "string", minLength: 1, maxLength: 1024, description: "status only: nextPage for more headers from the same snapshot; keep the same after. Omit to check new arrivals. Never pass as after." },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10, description: "maximum bodies or headers in this page; status counts always cover the whole range" },
        draft: { type: "object", additionalProperties: false, required: ["name"], description: "Optional: read the unfinished visible text of one other vibemate in this room. No hidden notes or tool arguments/results. Does not acknowledge a final reply.", properties: {
          name: { type: "string", minLength: 1, maxLength: 100, description: "exact vibemate name" },
          cursor: { type: "string", minLength: 1, maxLength: 1024, description: "optional liveDraft.nextCursor for more of the same revision; a changed draft resets explicitly" },
        } },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "read_message",
    description:
      "Read a full message by seq. Omit room for this room, or pass the room ID from search_history (preferred) or an exact, unique accessible room name. IDs take precedence over names. Other rooms must share history with yours and have an available record. Returns the room's identity, author, addressees, time, text, images as file paths, quotes, and up to around visible neighbours on each side. Hidden, deleted and human-only rows are excluded. Unknown or inaccessible rooms return the same error; there is no fallback to this room. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        seq: { type: "integer", description: "the message number, the N of #N" },
        room: { type: "string", minLength: 1, maxLength: 200, description: "optional: room ID from a search result (preferred), or exact unique accessible room name; omitted means this room" },
        around: { type: "integer", minimum: 0, maximum: 5, description: "optional: how many neighbouring messages to include on each side (default 0, at most 5)" },
      },
      required: ["seq"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

export const OLD_TOOL_NAMES: Record<string, string> = { check_messages: "check_room" };

export function oldNamesFor(name: string): string[] {
  return Object.entries(OLD_TOOL_NAMES).filter(([, now]) => now === name).map(([was]) => was);
}

export type ToolName = (typeof TOOLS)[number]["name"];
