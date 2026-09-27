// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Logger } from "./log.js";

import { isReservedSkillName, RESERVED_SKILL_NAMES } from "./commands.js";

export const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
export const SKILL_FILE = "SKILL.md";
import { LOOK_DESIGNER_NAME, ROOM_DESIGNER_NAME } from "./persona.js";

export const BUILTIN_AUTHOR = "viberoom";
export const HUMAN_AUTHOR = "human";
const DESCRIPTION_MAX = 300;
const DESCRIPTION_MIN_USEFUL = 15;
const ARGUMENT_HINT_MAX = 80;
const BODY_MAX = 20_000;
const KNOWN_FIELDS = new Set([
  "name",
  "description",
  "argument-hint",
  "user-invocable",
  "disable-agent-invocation",
  "author",
  "created",
  "reviewed",
  "draft",
  "metadata",
  "license",
  "compatibility",
  "when_to_use",
]);

export interface SkillMeta {
  name: string;
  description: string;
  argumentHint: string;
  userInvocable: boolean;
  agentInvocable: boolean;
  author: string;
  created: string;
  reviewed: boolean;
  draft: boolean;
  dir: string;
  file: string;
  extraFiles: string[];
  mtime: number;
  problems: string[];
  warnings: string[];
}

export interface Skill extends SkillMeta {
  body: string;
}

export interface SkillDraft {
  name: string;
  description: string;
  argumentHint?: string;
  body: string;
  userInvocable?: boolean;
  agentInvocable?: boolean;
  author?: string;
  reviewed?: boolean;
  draft?: boolean;
}

export interface LintIssue {
  code: string;
  message: string;
}

export interface LintResult {
  errors: LintIssue[];
  warnings: LintIssue[];
}

export function lintSkill(input: {
  name: string;
  folder?: string;
  description: string;
  argumentHint?: string;
  body: string;
  unknownFields?: string[];
}): LintResult {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const name = input.name.trim();
  const description = input.description.trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  const hint = (input.argumentHint ?? "").trim();
  if (!SKILL_NAME_PATTERN.test(name)) errors.push({ code: "name-invalid", message: `name "${name}" must be 1-32 letters, digits, _ or -` });
  else if (isReservedSkillName(name)) {
    errors.push({ code: "name-reserved", message: `"${name}" is a room command (reserved: ${RESERVED_SKILL_NAMES.join(", ")})` });
  }
  if (input.folder && name.toLowerCase() !== input.folder.toLowerCase()) {
    errors.push({ code: "name-folder-mismatch", message: `name "${name}" differs from the folder "${input.folder}"` });
  }
  if (!description) errors.push({ code: "description-missing", message: "description is required: it is what tells an agent when to use the skill" });
  else if (description.length > DESCRIPTION_MAX) errors.push({ code: "description-too-long", message: `description must be at most ${DESCRIPTION_MAX} characters` });
  else if (description.length < DESCRIPTION_MIN_USEFUL || description.toLowerCase() === name.toLowerCase()) {
    warnings.push({ code: "description-thin", message: "description should say what the skill does and when to use it, not just its name" });
  }
  if (hint.length > ARGUMENT_HINT_MAX) errors.push({ code: "hint-too-long", message: `argument hint must be at most ${ARGUMENT_HINT_MAX} characters` });
  if (!body) errors.push({ code: "body-empty", message: "the instructions are empty" });
  else if (body.length > BODY_MAX) errors.push({ code: "body-too-long", message: `the instructions must be at most ${BODY_MAX} characters` });
  if (/\[skill:/i.test(body) || /<\/?skill[\s>]/i.test(body)) {
    errors.push({ code: "body-contains-delivery-syntax", message: "the instructions must not contain [skill:…] or <skill> tags (they are the room's delivery syntax)" });
  }
  const usesArguments = /(^|[^\\])\$ARGUMENTS/.test(body);
  if (usesArguments && !hint) warnings.push({ code: "arguments-without-hint", message: "the instructions use $ARGUMENTS but there is no argument hint for the / menu" });
  if (!usesArguments && hint) warnings.push({ code: "hint-without-arguments", message: "there is an argument hint but the instructions never use $ARGUMENTS" });
  for (const field of input.unknownFields ?? []) warnings.push({ code: "unknown-field", message: `unknown frontmatter field "${field}" is ignored` });
  return { errors, warnings };
}

const DEFERRED_OPERATIONS = 'For each operation below, first call viberoom tool_search with its exact name to read the schema, then tool_call with {name, arguments}. These names are operations, not directly exposed tools. Human approval requirements still apply.';

export const SKILL_WRITER: SkillDraft = {
  name: "skill-writer",
  description: "How to write a good skill for this library. Load it before creating or updating a skill with create_skill / update_skill.",
  argumentHint: "",
  body: [
    DEFERRED_OPERATIONS,
    "",
    "A skill is a reusable set of instructions for one kind of task. Another agent (or you, later, in another room) will get only this text when the skill is invoked, so it must stand on its own.",
    "",
    "Write it like this:",
    "- name: short, lowercase, hyphenated (e.g. pr-review, daily-summary). It becomes the /command.",
    "- description: one or two sentences that say WHAT the skill does and WHEN to use it. This is the only thing agents see before loading it, so it must let them decide (e.g. \"Review a pull request for correctness and post findings as a numbered list. Use when someone asks for a code review.\").",
    "- instructions: imperative, concrete steps or a format. Say what the reply should contain, in what order, how long. Include an example when the format is non-obvious. Write \\$ARGUMENTS where the caller's text (what follows /name) belongs; give an argument hint like [PR number] when you use it. To mention the placeholder without filling it in, put a backslash before it.",
    "- Do not put chat greetings, room rules or secrets in a skill, and do not write the room's own delivery markers (the bracketed skill marker or skill tags) in it.",
    "- Keep it under ~300 words; put long reference material in separate files in the skill's folder instead.",
    "",
    "Before creating: check that no existing skill already covers the task (your brief lists the skills you have). Prefer updating an agent-made skill over creating a near-duplicate.",
    "After creating: attach it to yourself (attach_skill) if you will use it, and to other agents only when they need it; say in the room what you created and why.",
  ].join("\n"),
  userInvocable: true,
  agentInvocable: true,
  author: BUILTIN_AUTHOR,
  reviewed: true,
  draft: false,
};

export const ROOM_DESIGNER: SkillDraft = {
  name: ROOM_DESIGNER_NAME,
  description: "Design rooms and templates, or propose and refine durable rules for how a team works together. Load before lint_room_design, create_template or propose_room_changes.",
  argumentHint: "",
  body: [
    DEFERRED_OPERATIONS,
    "",
    "A room is a protocol between a human and vibemates. Start with describe_room for current rules, roles, settings and limits; do not guess or repeat mechanics already in the brief.",
    "",
    "When the current task reveals an important, durable team agreement or recurring coordination problem, you may propose a rule without a separate request. Do not review or invent rules after every task. Explain the concrete benefit.",
    "",
    "Rules are human-approved working instructions. Memory holds evidenced preferences and context; current requests and rules take precedence. Keep task progress in project notes and lengthy procedures in a skill or document. Never use memory to impose a new obligation.",
    "",
    "Before adding a rule, check for overlap and improve or consolidate existing wording. Explain its reason. Keep the whole rules text within briefTextLimit; never silently raise it. Eight to twelve short rules are usually enough. Address foreseeable choices: who acts, waits and decides, what done means, and how disagreements end.",
    "",
    "Roles describe people and their leanings, not duplicated rules; end with \"Everything else is in the room rules\". Use short, distinct names and clear taglines. Do not pin agents or models in templates.",
    "",
    "Coordinate task ownership and address findings to whoever relies on them. Use silence to avoid needless turns. Match agentsWakeEachOther and hopLimit to the collaboration: off and low for reporting rooms, on and roughly three times the participants for joint work.",
    "",
    "Run lint_room_design and read its warnings and brief preview. Check unaddressed tasks, simultaneous starts, unsolicited findings and mid-task questions. Then use create_template for a reusable design or propose_room_changes for this room. Preserve unrelated settings. Changes require the human's Apply; a proposal is not an applied rule. Briefly report what you proposed and why.",
  ].join("\n"),
  userInvocable: true,
  agentInvocable: true,
  author: BUILTIN_AUTHOR,
  reviewed: true,
  draft: false,
};

interface CacheEntry {
  mtime: number;
  skill: Skill;
}

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: normalized };
  const meta: Record<string, string> = {};
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    meta[key] = value;
  }
  return { meta, body: match[2] };
}

export function renderFrontmatter(meta: Record<string, string | boolean | undefined>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === "") continue;
    const text = typeof value === "boolean" ? String(value) : /[:#"'\n]/.test(value) ? JSON.stringify(value) : value;
    lines.push(`${key}: ${text}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function listExtraFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name !== SKILL_FILE)
      .map((d) => join(dir, d.name))
      .sort();
  } catch {
    return [];
  }
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "yes") return true;
  if (v === "false" || v === "no") return false;
  return fallback;
}

export interface SkillInvocation {
  name: string;
  args: string;
}

export function parseSkillInvocation(text: string): SkillInvocation | null {
  const match = text.match(/^(?:@[\p{L}\p{N}][\p{L}\p{N}_-]*\s+)*\/([A-Za-z0-9][A-Za-z0-9_-]{0,31})(?:\s+([\s\S]*))?$/u);
  if (!match) return null;
  return { name: match[1], args: (match[2] ?? "").trim() };
}

export function renderSkillBody(body: string, args: string): string {
  const trimmedArgs = args.trim();
  return body
    .replace(/\\\$ARGUMENTS|\$ARGUMENTS/g, (m) => (m.startsWith("\\") ? "$ARGUMENTS" : trimmedArgs))
    .replace(/\r\n/g, "\n")
    .trim();
}

export const LOOK_DESIGNER: SkillDraft = {
  name: LOOK_DESIGNER_NAME,
  description: "How to design a good viberoom look (how the window is drawn: colours, light, corners, fonts) as data that extends a shipped look. Load it before lint_look, create_look or propose_look_changes.",
  argumentHint: "",
  body: [
    DEFERRED_OPERATIONS,
    "",
    "A look is data, not code: which shipped look it extends, a few hues laid over that look's palette, and what it wants otherwise (corners, fonts, shadows, the chat's paper, a part of an element). Everything the window draws is derived from the palette, so a hue changed there reaches every place that wears it; start from the shipped look closest to what is asked and change as little as says it. The facts (the looks, every hue and element with what it means, the value syntax, the fonts, how the window is set now) come from describe_looks; never guess a name, a key the look does not have is refused.",
    "",
    "Name what a colour looks like, not what it is for: the palette says primary, ink, bg, white, lav; the elements say which part wears which hue (bubble.bg, btn.hoverInk). Prefer changing hues over changing elements: a new accent is palette.primary plus its primaryLight, primaryDeep and primaryDark steps and its tints lav and lav2; a new paper is bg with white (the panels) a shade apart from it, and soft / softer a step off white; a new ink is ink with ink2 for the words in a bubble and ink3, muted and faint growing quieter. Change an element only when a part must differ from what the palette gives it.",
    "",
    "You cannot see the colours; the lint can. Every look must read: the words on a bubble and on the paper at 7:1, the quiet words at 3:1 (4.5:1 on dark paper), every ink on its own paper at 3:1. Run lint_look before you save and read the report: it names every pair with its ratio. Fix the ink before the paper (a darker muted, an ink2 nearer black), keep the accent readable where it is written on (btn.onPrimary on primary at 3:1), and give a bubble that sits on paper of nearly its own shade a hairline (bubble.border) or another shade.",
    "",
    "Light comes from one place, top-left, and the shadows fall from it in the palette's shadowInk; a flat look sets the shadows to none, a look with volume raises a thing with a soft shadow below it and a bevel (a light gradient over its face) and sinks a pressed one with an inset shade. Say scheme dark when the paper is dark: diagrams, marks and the quiet-word floors follow it. One accent; the state colours (green ready, yellow thinking, red error, blue waiting, violet writing) keep their families, only their shades follow the paper. Fonts by id from describe_looks (they ship with viberoom and look the same on every machine); running text at lineHeight 1.45 or more; a terminal look wants the mono font everywhere and no curves (rScale 0), a soft look rounder corners (rScale 1.2-1.6) and pills for every control (rCtlMin 99px).",
    "",
    "When it reads: create_look saves it among the human's own looks (Settings → Appearance, after the shipped ones, with the human's name on it); one of the human's own may be replaced with replace: true, a shipped look never. Then propose_look_changes offers it as a card (look: its id), or fine-tunes any look with the adjustables describe_looks lists (a colour as #rrggbb, a scale 0-2) — the whole window changes, not this room, and only on the human's click. What a look cannot do: no CSS of its own, no layout, no icons, no fonts beyond the shipped ids; when the human asks for such a thing, say so instead of forcing a token to carry it.",
  ].join("\n"),
  userInvocable: true,
  agentInvocable: true,
  author: BUILTIN_AUTHOR,
  reviewed: true,
  draft: false,
};

export const ROOM_LIBRARIAN: SkillDraft = {
  name: "room-librarian",
  description:
    "Find what this room already discussed or decided about a topic and answer with checkable message numbers. Use when someone asks what was said, decided or tried about something, or when you need earlier context before you answer.",
  argumentHint: "[topic]",
  body: [
    "Find what the room already knows about: $ARGUMENTS",
    "",
    "1. Ask search_history in two or three different ways, not one. Use the words the asker used; the words the room would have used (a file, a setting, a person's name); and one exact phrase in quotes. Add rooms: \"all\" when the topic may belong to another room.",
    "2. If nothing comes back, change the angle before you conclude anything: a prefix like deploy*, an author, or kinds: \"chat,system\" for room events.",
    "3. Open the promising hits with read_message and around: 1 or 2. A hit from another room needs its room as well as its seq: a number alone means a different message in every room. The decision is usually in the reply under the matching line, not in the line itself.",
    "4. Answer in this shape: one sentence with the answer; then two to five bullets, oldest first, each \"#seq — who — what in one clause\", naming the room when it is not this one; then one line on what is still open, if anything is.",
    "5. Say what you did not find, and name the words you tried. Not found is not the same as not discussed; the asker may know a better word.",
    "6. When the hits disagree, give both and say which is newer. Do not pick one silently.",
    "7. Quote a clause, not a paragraph. The number is the link; the reader opens the rest.",
    "8. If search_history is unavailable, say that you cannot verify the archive and ask the room for help. Distinguish information in your current context from findings verified through history tools.",
  ].join("\n"),
  userInvocable: true,
  agentInvocable: true,
  author: BUILTIN_AUTHOR,
  reviewed: true,
  draft: false,
};

export const SET_UP_ON_MESSENGER: SkillDraft = {
  name: "set-up-on-messenger",
  description:
    "Walk the human through connecting Telegram (on a phone or this computer) to viberoom: make the bot, hand its key over on a card (you never see it), name it, pair the phone. Use when the human asks to set up, connect or pair a phone, a messenger or Telegram, or /rooms from the phone gets no answer.",
  argumentHint: "[bot | key | name | pair]",
  body: [
    DEFERRED_OPERATIONS,
    "",
    "You are an experienced friend at the human's side, not a brochure. One action per message, at most two sentences, then stop and wait for the human's word; never list the steps ahead. Every message ends with what success looks like. The key never appears in the chat: it goes through the card, and you learn only the outcome. \"The phone\" is wherever the human uses Telegram: a phone, or the Telegram app on this computer.",
    "",
    "0. Offer the wizard once, in one line: Settings → Channels → Set up Telegram… walks the same steps with pictures and QR codes; you can also guide them here. Ask which they prefer, then stop. If they choose the wizard, stay available and say nothing more unless asked.",
    "1. Open BotFather in Telegram (https://t.me/BotFather) and press Start. Success: BotFather greets them. Stop and wait.",
    "2. Send /newbot. BotFather asks for a name: any name they like. Stop and wait.",
    "3. BotFather asks for a username ending in bot (for example viberoom_home_bot). Success: a reply with a long line that has a colon in it; that line is the key. Say why they make the bot themselves: the key never passes through anyone else's server. Stop and wait.",
    "4. Call connect with system \"telegram\": a card opens on the human's screen. Tell them to paste BotFather's whole reply into it; the key is taken out of it. Wait for the outcome. \"connected as @name\": go on. \"refused: <reason>\": say the smallest next thing to try, then wait. \"closed without a key\": ask whether to continue or stop, without pressing.",
    "5. Suggest a neutral name that tells their computers apart (viberoom home, viberoom work), in one sentence, and where to set it (Settings → Channels → Rename…). Anyone who opens the bot sees this name. Stop and wait.",
    "6. Call show_pairing_link: the QR code appears on the human's screen. Tell them to scan it with the phone's camera (or open the link on the phone) and press Start; the account that does it is paired on every device signed in to it. Wait for the outcome: \"paired: <name>\" means done; \"expired\" means call it again.",
    "7. Done: ask them to send /rooms to the bot and /open a room; if the bot says a vibemate is offline, point at the Reconnect button under that message. Stop here; do not repeat the steps.",
    "",
    "When something goes wrong, say only the smallest next thing to try: the bot is busy (another computer is listening with this key) → make a new bot in BotFather, not a new key; the key is refused → paste BotFather's whole reply; the pairing code has run out → call show_pairing_link again; the username is taken → another one ending in bot; no Telegram on the phone → the Telegram app on this computer does the same. For anything else, point at the guide in viberoom on the computer: Settings → Channels → Open the guide.",
    "",
    "Start at: $ARGUMENTS (one of bot, key, name, pair; nothing means from step 0).",
  ].join("\n"),
  userInvocable: true,
  agentInvocable: true,
  author: BUILTIN_AUTHOR,
  reviewed: true,
  draft: false,
};

export const SET_UP_LONG_TERM_MEMORY: SkillDraft = {
  name: "set-up-long-term-memory",
  description:
    "Walk the human through turning on the long-term memory: a Zep Cloud account, its key on a card (you never see it), the sieve and its small model, the consent, the rooms that remember. Use when the human asks to set up, enable or configure the long-term memory, or types /set-up-long-term-memory.",
  argumentHint: "[zep | sieve | consent | rooms]",
  body: [
    DEFERRED_OPERATIONS,
    "",
    "You are an experienced friend at the human's side, not a brochure. One action per message, at most a few sentences, then stop and wait for the human's word; never list the steps ahead. Longer explanations only when the human asks. Keys never appear in the chat: each goes through a card on their screen — the card shows a vibemate that has turned away and shut its eyes, because that is literally what happens — and you learn only the outcome, as a room row that wakes you. Before every card, warn first: \"I am about to open a card for the key — ready?\" Open it only on their word.",
    "",
    "0. One line on what they are turning on: rooms that opt in feed one long-term memory; what was said becomes facts vibemates recall later, with the time each held true. Offer the geek path once: everything can also be set by hand in Settings → Long-term memory. Ask which they prefer, then stop.",
    "1. Zep Cloud is the memory provider: a hosted temporal knowledge graph with a free tier. Send them to https://app.getzep.com to sign up (or sign in) and create a project. Success: they see the project's dashboard. If what they see differs from what you expect, ask them to describe the screen and navigate from their words — the dashboard changes; their eyes are current, your memory may not be.",
    "2. The project key: in the project's settings the dashboard has an API Keys page; they create a key and copy it. Do not let them paste it in the chat — if they do, tell them to revoke that key in the same page and make a new one, and say why in one line. Warn, then call connect with system \"zep\": the card opens, they paste the key there. Entering it also chooses Zep as the provider, and the key is proven against Zep before the card closes. Wait for the outcome row. \"refused\": say the smallest next thing to try (usually: a whole key, freshly copied). \"closed without a key\": ask whether to continue or stop, without pressing.",
    "3. The sieve, when the moment comes and in one breath: it is the small model that reads the room's messages and forwards only a condensed episode of what matters — it decides what is worth remembering, so it must be cheap and need not be clever. A strong model here is wasted money. Suggest gpt-5.6-luna at https://api.openai.com/v1 (an OpenAI account and a key from https://platform.openai.com/api-keys), or any OpenAI-compatible endpoint they already have — a local Ollama needs no key at all. Stop and wait for their choice.",
    "4. Warn, then call connect with system \"sieve\" and the baseUrl and model they chose: both are shown on the card and saved with the key; the sieve switches to its model mode. Wait for the outcome row.",
    "5. Consent is theirs alone: you open the card, only their press gives it. Warn, then call ask_consent with feature \"memory\": the card shows the words that name exactly what leaves this computer and through which sieve — tell them to read those before they press Turn on. Changing the data path later voids the consent, and the card is asked again. Wait for the outcome row: \"is on\" goes on; \"not on yet: …\" says what is still missing; \"not now\" is their answer, respect it.",
    "6. Rooms: nothing is remembered until a room opts in. In each room they choose: the room's gear → \"This room remembers\". Suggest starting with one room, not all.",
    "7. Done: in Settings → Long-term memory the Provider row's status should say On, with the month's credits; after the next few messages in a remembering room, facts appear. Point them at the ceiling field (credits per month) as the spending brake. Stop here; do not repeat the steps.",
    "",
    "When something goes wrong, say only the smallest next thing to try: the key is refused → copy it whole and fresh from the dashboard; the status says Paused → read its reason aloud and follow it; the sieve endpoint refuses → check the endpoint URL ends with /v1 and the key belongs to it; no credits appear → the room's own \"This room remembers\" switch is off. For anything else, Settings → Long-term memory shows the live status line.",
    "",
    "Start at: $ARGUMENTS (one of zep, sieve, consent, rooms; nothing means from step 0).",
  ].join("\n"),
  userInvocable: true,
  agentInvocable: true,
  author: BUILTIN_AUTHOR,
  reviewed: true,
  draft: false,
};

export const SET_UP_VOICE: SkillDraft = {
  name: "set-up-voice",
  description:
    "Walk the human through turning on the voice: a speech provider (OpenAI, Groq or their own server), its key on a card (you never see it), the consent on a card, reading aloud. Use when the human asks to set up the voice, the microphone, voice messages or reading aloud, or types /set-up-voice.",
  argumentHint: "[provider | key | consent | reading]",
  body: [
    DEFERRED_OPERATIONS,
    "",
    "You are an experienced friend at the human's side, not a brochure. One action per message, at most a few sentences, then stop and wait for the human's word; never list the steps ahead. The key never appears in the chat: it goes through a card on their screen, and you learn only the outcome, as a room row that wakes you. Before every card, warn first: \"I am about to open a card — ready?\" Open it only on their word.",
    "",
    "0. One line on what they are turning on: the microphone in the message field makes their words into text, Send while it records sends a voice message, and voice notes from the phone come with their words; the replies can be read aloud too. Offer the geek path once: everything can also be set by hand in Settings → Voice. Ask which they prefer, then stop.",
    "1. The provider, in three short lines, then their choice: OpenAI — the most exact, paid by the minute (a minute costs about a cent); Groq — Whisper on Groq's servers, fast, with a free plan; their own server — a Whisper server on this computer keeps their voice here, and they need its address and model name. Stop and wait.",
    "2. The key. OpenAI: https://platform.openai.com/api-keys → Create new secret key; the account needs a little credit under Billing. Groq: https://console.groq.com/keys → Create API Key. Their own server: its address and model, and a key only if it asks for one. Do not let them paste a key in the chat — if they do, tell them to revoke it where they made it and make a new one, and say why in one line. Ask which language they speak (bg, en…). Warn, then call connect with system \"voice\", the provider (openai, groq or compatible, with baseUrl and model for their own server) and the language. The key is proven against the provider before the card closes. Wait for the outcome row; \"refused\": the smallest next thing to try (a whole key, freshly copied; credit on OpenAI).",
    "3. The consent is theirs alone. Warn, then call ask_consent with feature \"voice\": the card names where each recording goes; tell them to read it before they press Turn on. Wait for the outcome row: \"is on\" goes on; \"not now\" is their answer.",
    "4. Reading aloud, if they want it, in two lines: this computer's own voices are free and send nothing anywhere, but need a voice in their language installed in the system; the provider sounds more natural and sends the replies' text to it. On their choice, warn, then call ask_consent with feature \"reading\" and reader \"system\" or \"provider\". Groq and their own server read with a model and a voice of the provider's own naming, which the human types in Settings → Voice, under Replies read aloud; the outcome row says when they are still missing. Which replies are read by themselves is chosen there too.",
    "5. Done: in a room, the microphone beside Send — press, speak, press again: the words land in the field; Send while it records sends a voice message. Stop here; do not repeat the steps.",
    "",
    "When something goes wrong, say only the smallest next thing to try: the key is refused → a whole key, freshly copied, and on OpenAI some credit under Billing; the microphone does not open → allow it in the browser's or the system's privacy settings; the words are wrong → name their language in Settings → Voice; this computer has no voice in their language → add one in the system's language settings, or let the provider read. For anything else, Settings → Voice shows what is missing.",
    "",
    "Start at: $ARGUMENTS (one of provider, key, consent, reading; nothing means from step 0).",
  ].join("\n"),
  userInvocable: true,
  agentInvocable: true,
  author: BUILTIN_AUTHOR,
  reviewed: true,
  draft: false,
};

export const ADD_CONNECTION: SkillDraft = {
  name: "add-connection",
  description:
    "Connect a system that is not in the Connections catalogue: find its MCP server (a remote address or a local command) in the system's own docs, check it, and bring the human the card; it shows in Connections under Your own. Use when the human asks to connect or add a system, tool or service.",
  argumentHint: "[system name]",
  body: [
    DEFERRED_OPERATIONS,
    "",
    "You do the work; the human decides with one press. Keep each message short and say what happens next.",
    "",
    "1. Look first. tool_search the system's name: a catalogue system or a server the human already added is listed there, with its state. If it is, use connect with its system id, as for any catalogue system, and stop here.",
    "2. Find its MCP server in the system's own documentation: a page on the system's own domain, or its official repository. Never take it from a directory, a forum, a blog or a search snippet alone: a lookalike server can read what the vibemates send it and tell them what to do, and a lookalike package runs on the human's computer. If you cannot browse, ask the human for the page and read it with them.",
    "3. Say plainly which kind it is. A remote server is an HTTPS address, usually ending in /mcp (or /sse for older servers), on the system's own domain or one its docs name; if it needs a sign-in, that opens in the human's browser. A local server is a command the docs give to start it (npx, uvx, docker or a program), often with keys in environment variables. When the docs offer both, prefer the remote one: nothing runs on the computer and the sign-in is the system's own. A remote server that asks for an API key in a header instead of a sign-in cannot be added yet; say so and stop.",
    "4. Tell the human, in two or three sentences: what the system is, the exact address or command and the page you found it on, and that every tool of a server outside the catalogue asks them before it runs, reading too. For a local server add that the program runs on their computer with their rights, and name the keys it needs and where they get them. Ask whether to put the card up. Stop and wait for their word.",
    "5. On their word, call connect. A remote server: url (the address) and name (the system's own name, as the human would say it). A local server: command (the program, such as npx), args (its arguments exactly as the docs give them, one string each), env (the names of the variables for its keys) and name. A key's value never goes into args, env or the conversation: the card has a field for each name, and the value goes from there into the vault. Nothing is added until they press the card. Wait for the outcome row: connected with its tools, not now, or failed.",
    "6. Connected: tool_search the new id for its tools, and say in one line what it can do. Every call asks the human first, so offer the first useful thing and ask before you call it.",
    "",
    "When it fails, say only the smallest next thing: the address is refused as not HTTPS or not public → it is a private server, which connect does not reach; the sign-in says viberoom cannot register → the system wants an application registered with it by viberoom, which the human cannot do from here, so say it waits for that; no answer from the address → check it against the docs page again, character by character; a local program is not installed → say what installs it (Node.js for npx, uv for uvx, Docker) and stop; a local server stopped at the start → its words are in the outcome, usually a missing or wrong key; the human closed the card → ask whether they want it at all, without pressing. The human can also add a server by hand: Connections → Your own → Add a connection….",
    "",
    "The system: $ARGUMENTS",
  ].join("\n"),
  userInvocable: true,
  agentInvocable: true,
  author: BUILTIN_AUTHOR,
  reviewed: true,
  draft: false,
};

export const BUILTIN_SKILLS: SkillDraft[] = [SKILL_WRITER, ROOM_DESIGNER, LOOK_DESIGNER, ROOM_LIBRARIAN, SET_UP_ON_MESSENGER, SET_UP_LONG_TERM_MEMORY, SET_UP_VOICE, ADD_CONNECTION];

export function isBuiltinSkill(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return BUILTIN_SKILLS.some((b) => b.name === lower);
}

export class SkillLibrary {
  readonly dir: string;
  private readonly log: Logger;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(dir: string, log: Logger) {
    this.dir = resolve(dir);
    this.log = log;
    mkdirSync(this.dir, { recursive: true });
  }

  list(): SkillMeta[] {
    const out: SkillMeta[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(this.dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      this.log.warn(`skills folder unreadable: ${String(error)}`);
      return out;
    }
    const seen = new Set<string>();
    for (const folder of entries) {
      const skill = this.load(folder);
      if (!skill) continue;
      seen.add(folder);
      const { body: _body, ...meta } = skill;
      out.push(meta);
    }
    for (const key of [...this.cache.keys()]) if (!seen.has(key)) this.cache.delete(key);
    return out;
  }

  get(name: string): Skill | undefined {
    if (!SKILL_NAME_PATTERN.test(name)) return undefined;
    const folder = this.folderFor(name);
    return folder ? this.load(folder) : undefined;
  }

  lint(draft: SkillDraft): LintResult {
    return lintSkill({ name: draft.name, description: draft.description, argumentHint: draft.argumentHint, body: draft.body });
  }

  save(draft: SkillDraft): Skill {
    const name = draft.name.trim();
    if (isBuiltinSkill(name) && draft.author !== BUILTIN_AUTHOR) throw new Error(`${name} is built into viberoom and read-only; create your own skill instead`);
    const description = draft.description.trim();
    const body = draft.body.replace(/\r\n/g, "\n").trim();
    const lint = this.lint({ ...draft, name, description, body });
    if (lint.errors.length) throw new Error(lint.errors.map((e) => e.message).join("; "));
    const existingFolder = this.folderFor(name);
    const existing = existingFolder ? this.load(existingFolder) : undefined;
    const folder = existingFolder ?? name;
    const dir = join(this.dir, folder);
    mkdirSync(dir, { recursive: true });
    const author = draft.author ?? existing?.author ?? HUMAN_AUTHOR;
    const created = existing?.created || new Date().toISOString();
    const reviewed = draft.reviewed ?? (author === HUMAN_AUTHOR || author === BUILTIN_AUTHOR ? true : (existing?.reviewed ?? false));
    const isDraft = draft.draft ?? (existing?.draft ?? false);
    const text = `${renderFrontmatter({
      name,
      description,
      "argument-hint": draft.argumentHint?.trim() || undefined,
      "user-invocable": draft.userInvocable === false ? false : undefined,
      "disable-agent-invocation": draft.agentInvocable === false ? true : undefined,
      author: author === HUMAN_AUTHOR ? undefined : author,
      created,
      reviewed: reviewed ? undefined : false,
      draft: isDraft ? true : undefined,
    })}\n\n${body}\n`;
    writeFileSync(join(dir, SKILL_FILE), text);
    this.cache.delete(folder);
    const skill = this.load(folder);
    if (!skill) throw new Error("the skill could not be read back");
    this.log.info(`skill "${name}" saved (${skill.file}; author ${author}${isDraft ? "; draft" : ""})`);
    return skill;
  }

  approve(name: string): Skill {
    const skill = this.get(name);
    if (!skill) throw new Error(`no such skill: ${name}`);
    return this.save({
      name: skill.name,
      description: skill.description,
      argumentHint: skill.argumentHint,
      body: skill.body,
      userInvocable: skill.userInvocable,
      agentInvocable: skill.agentInvocable,
      author: skill.author,
      reviewed: true,
      draft: false,
    });
  }

  seedBuiltins(): { name: string; kept: string }[] {
    const moved: { name: string; kept: string }[] = [];
    for (const builtin of BUILTIN_SKILLS) {
      const folder = this.folderFor(builtin.name);
      const current = folder ? this.load(folder) : undefined;
      const same = current && current.description === builtin.description && current.body === builtin.body && (current.argumentHint ?? "") === (builtin.argumentHint ?? "");
      if (same && current.author === BUILTIN_AUTHOR) continue;
      if (current && folder && current.author !== BUILTIN_AUTHOR) {
        const kept = this.keepAside(folder, builtin.name);
        if (!kept) {
          this.log.error(`built-in skill "${builtin.name}" was not installed: your own skill of that name could not be copied aside first`);
          continue;
        }
        this.log.warn(`"${builtin.name}" is a built-in skill from this version; your own skill of that name is kept as "${kept}"`);
        moved.push({ name: builtin.name, kept });
      }
      this.save(builtin);
      if (current) this.log.info(`built-in skill "${builtin.name}" updated to the shipped text`);
    }
    return moved;
  }

  private keepAside(folder: string, name: string): string | null {
    const from = join(this.dir, folder);
    for (let n = 1; n <= 20; n++) {
      const kept = n === 1 ? `${name}-yours` : `${name}-yours-${n}`;
      if (!SKILL_NAME_PATTERN.test(kept)) return null;
      if (existsSync(join(this.dir, kept))) continue;
      const to = join(this.dir, kept);
      try {
        cpSync(from, to, { recursive: true });
        const { meta, body } = parseFrontmatter(readFileSync(join(to, SKILL_FILE), "utf8"));
        writeFileSync(join(to, SKILL_FILE), `${renderFrontmatter({ ...meta, name: kept })}\n\n${body.trim()}\n`);
        this.cache.delete(kept);
        return kept;
      } catch (error) {
        this.log.warn(`skill "${name}" could not be copied aside: ${String(error)}`);
        try {
          rmSync(to, { recursive: true, force: true });
        } catch {
        }
        return null;
      }
    }
    return null;
  }

  remove(name: string): void {
    if (isBuiltinSkill(name)) throw new Error(`${name.trim()} is built into viberoom and cannot be deleted; detach it from a vibemate if it should not use it`);
    const folder = this.folderFor(name);
    if (!folder) throw new Error(`no such skill: ${name}`);
    rmSync(join(this.dir, folder), { recursive: true, force: true });
    this.cache.delete(folder);
    this.log.info(`skill "${name}" removed`);
  }

  private folderFor(name: string): string | null {
    if (existsSync(join(this.dir, name, SKILL_FILE))) return name;
    const lower = name.toLowerCase();
    try {
      for (const d of readdirSync(this.dir, { withFileTypes: true })) {
        if (d.isDirectory() && d.name.toLowerCase() === lower && existsSync(join(this.dir, d.name, SKILL_FILE))) return d.name;
      }
    } catch {
    }
    return null;
  }

  private load(folder: string): Skill | undefined {
    const dir = join(this.dir, folder);
    const file = join(dir, SKILL_FILE);
    let mtime: number;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      return undefined;
    }
    const cached = this.cache.get(folder);
    if (cached && cached.mtime === mtime) {
      cached.skill.extraFiles = listExtraFiles(dir);
      return cached.skill;
    }
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      this.log.warn(`skill ${folder}: unreadable (${String(error)})`);
      return undefined;
    }
    const { meta, body } = parseFrontmatter(text);
    const name = (meta.name ?? folder).trim();
    const description = (meta.description ?? "").trim();
    const argumentHint = (meta["argument-hint"] ?? "").trim();
    const lint = lintSkill({
      name,
      folder,
      description,
      argumentHint,
      body,
      unknownFields: Object.keys(meta).filter((k) => !KNOWN_FIELDS.has(k)),
    });
    const extraFiles = listExtraFiles(dir);
    const author = (meta.author ?? "").trim() || HUMAN_AUTHOR;
    const skill: Skill = {
      name,
      description: description.slice(0, DESCRIPTION_MAX),
      argumentHint,
      userInvocable: parseBool(meta["user-invocable"], true),
      agentInvocable: !parseBool(meta["disable-agent-invocation"], false),
      author,
      created: (meta.created ?? "").trim(),
      reviewed: parseBool(meta.reviewed, true),
      draft: parseBool(meta.draft, false),
      dir,
      file,
      extraFiles,
      mtime,
      problems: lint.errors.map((e) => e.message),
      warnings: lint.warnings.map((w) => w.message),
      body: body.replace(/\r\n/g, "\n").trim(),
    };
    this.cache.set(folder, { mtime, skill });
    return skill;
  }
}
