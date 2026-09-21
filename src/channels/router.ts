// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { SessionConfigSelectGroup, SessionConfigSelectOption } from "../acp-types.js";
import type { Logger } from "../log.js";
import { getRecipe } from "../recipes.js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { saveDocument } from "../files.js";
import { splitLocation } from "../open.js";
import type { ChatMessage, ExternalReceipt, Participant, ParticipantStatus, PendingPermission, QuietTurn, ReconnectOptions, Room, RoomEvent } from "../room.js";
import { spokenText } from "../room.js";
import { ZERO_WIDTH, authorPrefix, defuseMentions, markdownToTelegramHtml } from "./format.js";
import { PairingDesk, telegramPairUrl, type PairLink } from "./pairing.js";
import { ChannelsStore, pathInside, type FileRoot, type Pairing } from "./state.js";
import { acceptKey, chatKey, type AdapterStatus, type Button, type ChannelAdapter, type ChatRef, type InboundMessage, type InboundResult, type Platform } from "./types.js";

export interface RouterHost {
  rooms(): Room[];
  room(id: string): Room | undefined;
  markOpened(roomId: string): void;
  reconnectOptions(): ReconnectOptions;
  dataDir(): string;
  onRoomEvent(handler: (roomId: string, event: RoomEvent) => void): void;
  channelsChanged(): void;
  paired?(platform: Platform, name: string): void;
  restart?: {
    writingNow(): string[];
    request(input: { askedBy: string; from: Platform; when: "now" | "idle" }): { waitingFor: string[] };
    now(by: string): void;
    cancel(by: string): void;
    pending(): boolean;
  };
}

export interface ChannelsView {
  telegram: { enabled: boolean; tokenSet: boolean; account: string | null; state: AdapterStatus["state"]; detail?: string; name?: string; wantedName?: string } | null;
  machine: string;
  pairings: Pairing[];
  bindings: { chat: string; roomId: string; roomName: string | null }[];
  pairLinkUntil: number | null;
  fileRoots: FileRoot[];
  folderExample: string;
  phoneApprovals: boolean;
}

export function exampleFolder(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return "C:\\Users\\you\\Downloads";
  if (platform === "darwin") return "/Users/you/Downloads";
  return "/home/you/Downloads";
}

const WEDGE_TICK_MS = 5 * 60_000;

export interface RouterOptions {
  sendGapMs?: number;
  catchUpLimit?: number;
  pauseBackoffMs?: number[];
  retryDelaysMs?: number[];
  behindRetryMs?: number[];
  openContext?: number;
  earlierPage?: number;
  typingEveryMs?: number;
  editEveryMs?: number;
  wedgeTickMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const BOT_COMMANDS: { command: string; description: string }[] = [
  { command: "rooms", description: "List the rooms you can open here" },
  { command: "who", description: "Who is in the open room, and what you can do with each" },
  { command: "close", description: "Detach this chat from its room (the room stays)" },
  { command: "stop", description: "Stop the reply being written here, or /stop @Name" },
  { command: "restart", description: "Restart viberoom on the computer" },
  { command: "help", description: "What this bot does" },
];
export const TYPED_COMMANDS = ["open"];

const COMMAND_NAMES = new Set([...BOT_COMMANDS.map((c) => c.command), ...TYPED_COMMANDS]);
const STRANGER_REPLY = "This bot is private. Pair it from viberoom on the computer it runs on.";
const STRANGER_REPLY_EVERY_MS = 10 * 60_000;
const EXPIRED_LINK_REPLY = "That pairing link has expired or was already used. Make a new one in viberoom on your computer (Settings → Channels → Pair a phone…) and open it within ten minutes.";
const STALE_BUTTON_REPLY = "That button is no longer valid; send the command again.";
const PLATFORM_NAMES: Record<Platform, string> = { telegram: "Telegram", discord: "Discord" };
const BUTTON_TTL_MS = 24 * 60 * 60_000;
const BUTTON_CAP = 2000;

type ButtonAction =
  | { kind: "open"; roomId: string }
  | { kind: "stop"; roomId: string; participantId: string; turnId?: string }
  | { kind: "nudge"; roomId: string; participantId: string; turnId: string }
  | { kind: "respawn"; roomId: string; participantId: string; turnId: string }
  | { kind: "earlier"; roomId: string; beforeSeq: number }
  | { kind: "reconnect"; roomId: string; participantId?: string }
  | { kind: "vibemate"; roomId: string; participantId: string }
  | { kind: "mute"; roomId: string; participantId: string; on: boolean }
  | { kind: "settings"; roomId: string; participantId: string }
  | { kind: "setting"; roomId: string; participantId: string; configId: string }
  | { kind: "set"; roomId: string; participantId: string; configId: string; value: string | boolean }
  | { kind: "delay"; roomId: string; participantId: string; seconds: number | null }
  | { kind: "vibio"; roomId: string; participantId: string }
  | { kind: "file"; roomId: string; path: string }
  | { kind: "history"; roomId: string }
  | { kind: "hush"; roomId: string }
  | { kind: "permit"; roomId: string; key: string; optionId: string | null; allow: boolean; who: string; what: string }
  | { kind: "restart"; now: boolean };
const FILE_BUTTONS_PER_MESSAGE = 3;
const OFFER_NAMED_BY_VIBEMATES = true;
const PATH_BOUND_KINDS = new Set(["read", "edit", "delete", "search"]);
const DEFAULTS: Required<RouterOptions> = {
  sendGapMs: 1000,
  catchUpLimit: 20,
  pauseBackoffMs: [10_000, 20_000, 40_000, 60_000],
  retryDelaysMs: [1000, 3000, 10_000],
  behindRetryMs: [30_000, 60_000, 120_000, 300_000],
  openContext: 10,
  earlierPage: 20,
  typingEveryMs: 4000,
  editEveryMs: 2000,
  wedgeTickMs: WEDGE_TICK_MS,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface ParsedCommand {
  name: "rooms" | "open" | "close" | "who" | "stop" | "restart" | "help";
  args: string;
}

export function parseCommand(text: string, botName?: string): ParsedCommand | null {
  const m = /^\/([a-z]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (!COMMAND_NAMES.has(name)) return null;
  if (m[2] && botName && m[2].toLowerCase() !== botName.toLowerCase()) return null;
  return { name: name as ParsedCommand["name"], args: (m[3] ?? "").trim() };
}

export function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let piece = "";
  let inFence = false;
  const flush = (): void => {
    if (!piece) return;
    out.push(inFence ? `${piece}\n\`\`\`` : piece);
    piece = inFence ? "```" : "";
  };
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    const candidate = piece ? `${piece}\n${line}` : line;
    if (candidate.length > limit && piece) flush();
    let rest = piece ? `${piece}\n${line}` : line;
    while (rest.length > limit) {
      out.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    piece = rest;
  }
  if (piece) out.push(piece);
  return out;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const adapterKey = (adapter: ChannelAdapter): string => `${adapter.platform}:${adapter.account}`;
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class ChannelRouter {
  private readonly options: Required<RouterOptions>;
  private readonly adapters = new Map<string, ChannelAdapter>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly writing = new Map<string, string>();
  private readonly strangerReplied = new Map<string, number>();
  private readonly pauses = new Map<string, { attempts: number; timer: NodeJS.Timeout | null; noticed: Set<string> }>();
  private readonly behind = new Map<string, { attempts: number; timer: NodeJS.Timeout | null }>();
  private readonly statuses = new Map<Platform, AdapterStatus>();
  private readonly buttons = new Map<string, { action: ButtonAction; chat: string; until: number }>();
  private readonly typing = new Map<string, NodeJS.Timeout>();
  private readonly live = new Map<string, LiveRow>();
  private readonly wedges = new Map<string, WedgeCard>();
  readonly desk: PairingDesk;
  private stopped = false;

  constructor(
    private readonly host: RouterHost,
    private readonly store: ChannelsStore,
    private readonly log: Logger,
    options: RouterOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.desk = new PairingDesk(this.options.now);
    host.onRoomEvent((roomId, event) => this.onRoomEvent(roomId, event));
  }

  async start(adapter: ChannelAdapter): Promise<void> {
    this.stopped = false;
    adapter.onInbound((batch) => this.inbound(adapter, batch));
    adapter.onStatus((status) => {
      this.log.info(`${adapter.platform}: ${status.state}${status.detail ? ` (${status.detail})` : ""}`);
      const before = this.statuses.get(adapter.platform)?.state;
      this.statuses.set(adapter.platform, status);
      this.host.channelsChanged();
      if (status.state === "contested" && before !== "contested") {
        for (const room of this.host.rooms()) room.channelNotice("Another computer answers on this bot too, so the phone gets every reply twice. Give this computer a bot of its own (Settings → Channels).", "warn");
      }
      if (status.state === "degraded" && before !== "degraded") {
        for (const room of this.host.rooms()) room.channelNotice(`Another computer is listening to this bot, so this one gets nothing from the phone until it stops. Each computer needs a bot of its own: make one more with BotFather and paste its token in Settings → Channels.`, "warn");
      }
    });
    await adapter.connect();
    this.adapters.set(adapterKey(adapter), adapter);
    await this.catchUp(adapter);
  }

  noteStartFailure(platform: Platform, detail: string): void {
    this.statuses.set(platform, { state: "disconnected", detail });
    this.host.channelsChanged();
  }

  view(): ChannelsView {
    const state = this.store.get();
    const telegram = this.adapters.get(`telegram:${[...this.adapters.values()].find((a) => a.platform === "telegram")?.account ?? ""}`);
    const status = this.statuses.get("telegram");
    return {
      telegram: state.telegram
        ? { enabled: state.telegram.enabled, tokenSet: !!state.telegram.token, account: telegram?.account ?? null, state: status?.state ?? "disconnected", detail: status?.detail, name: status?.name || undefined, wantedName: state.telegram.name }
        : null,
      machine: hostname(),
      pairings: [...state.pairings].sort((a, b) => b.pairedAt - a.pairedAt),
      bindings: Object.entries(state.bindings).map(([chat, b]) => ({ chat, roomId: b.roomId, roomName: this.host.room(b.roomId)?.settings.name ?? null })),
      pairLinkUntil: this.desk.pending("telegram")?.expiresAt ?? null,
      fileRoots: state.fileRoots.map((r) => ({ ...r })),
      folderExample: exampleFolder(),
      phoneApprovals: !!state.phoneApprovals,
    };
  }

  pairLink(platform: Platform): { url: string; link: PairLink } {
    const adapter = [...this.adapters.values()].find((a) => a.platform === platform);
    if (!adapter?.account) throw new Error("the bot is not connected yet: check the token and that the channel is switched on");
    const link = this.desk.issue(platform);
    this.host.channelsChanged();
    return { url: telegramPairUrl(adapter.account, link.token), link };
  }

  cancelPairLink(platform: Platform): void {
    if (!this.desk.pending(platform)) return;
    this.desk.cancel(platform);
    this.host.channelsChanged();
  }

  unpair(platform: Platform, senderId: string, options: { stopTurns?: boolean } = {}): boolean {
    const pairing = this.store.activePairings().find((p) => p.platform === platform && p.senderId === senderId);
    if (!pairing) return false;
    const attached = new Set<string>();
    this.store.update((s) => {
      for (const p of s.pairings) if (p.platform === platform && p.senderId === senderId && !p.unpairedAt) p.unpairedAt = this.options.now();
      for (const [key, binding] of Object.entries(s.bindings)) {
        if (!key.startsWith(`${platform}:`) || chatIdOf(key) !== senderId) continue;
        attached.add(binding.roomId);
        delete s.bindings[key];
      }
      for (const key of Object.keys(s.detached)) if (key.startsWith(`${platform}:`) && chatIdOf(key) === senderId) delete s.detached[key];
    });
    for (const key of [...this.behind.keys()]) if (chatIdOf(key) === senderId) this.caughtUp(key);
    for (const key of [...this.live.keys()]) if (chatIdOf(key) === senderId) this.forgetLive(key);
    const who = pairing.name || senderId;
    this.recordInReachableRooms((room) => {
      let stopped = 0;
      if (options.stopTurns && attached.has(room.id)) {
        for (const p of room.participants.values()) if (p.kind === "agent" && (p.status === "thinking" || p.status === "queued") && cancelTurn(room, p.id) !== "nothing") stopped++;
      }
      return `The ${PLATFORM_NAMES[platform]} account of ${who} was unpaired: it can no longer read or write here.${stopped ? ` ${stopped} repl${stopped === 1 ? "y" : "ies"} being written here ${stopped === 1 ? "was" : "were"} stopped.` : ""}`;
    });
    this.host.channelsChanged();
    return true;
  }

  private recordInReachableRooms(text: (room: Room) => string): void {
    for (const room of this.host.rooms().filter(isReachable)) {
      try {
        room.channelRecord(text(room));
      } catch (error) {
        this.log.warn(`room ${room.id}: channel event not recorded: ${describe(error)}`);
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const pause of this.pauses.values()) if (pause.timer) clearTimeout(pause.timer);
    this.pauses.clear();
    for (const key of [...this.typing.keys()]) this.stopTyping(key);
    for (const key of [...this.live.keys()]) this.forgetLive(key);
    for (const entry of this.behind.values()) if (entry.timer) clearTimeout(entry.timer);
    this.behind.clear();
    for (const adapter of this.adapters.values()) await adapter.disconnect();
    this.adapters.clear();
    this.statuses.clear();
  }

  get connected(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }


  private async inbound(adapter: ChannelAdapter, batch: InboundMessage[]): Promise<InboundResult> {
    let acked = 0;
    for (const message of batch) {
      let outcome: "done" | "pause";
      try {
        outcome = await this.handle(adapter, message);
      } catch (error) {
        this.log.error(`inbound message not handled: ${describe(error)}`);
        outcome = "pause";
      }
      if (outcome === "pause") return { acked, pause: true };
      acked++;
    }
    const pause = this.pauses.get(adapterKey(adapter));
    if (pause && !pause.timer) this.pauses.delete(adapterKey(adapter));
    return { acked, pause: false };
  }

  private async guarded(adapter: ChannelAdapter, m: InboundMessage, what: string, work: () => Promise<unknown>): Promise<"done"> {
    try {
      await work();
    } catch (error) {
      this.log.error(`${what} failed for ${chatKey(m.ref)}: ${error instanceof Error && error.stack ? error.stack : describe(error)}`);
      if (m.button) {
        try {
          await adapter.answerButton(m.button.callbackId, "Something went wrong on viberoom's side; the details are in its log. Try again, or open viberoom on your computer.");
        } catch (again) {
          this.log.warn(`button not answered: ${describe(again)}`);
        }
      } else {
        await this.reply(adapter, m.ref, "Something went wrong on viberoom's side while doing that; the details are in its log. Try again, or open viberoom on your computer.");
      }
    }
    return "done";
  }

  private async handle(adapter: ChannelAdapter, m: InboundMessage): Promise<"done" | "pause"> {
    if (m.button) return this.guarded(adapter, m, "a button", () => this.pressed(adapter, m));
    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(m.text.trim());
    if (start && !this.allowed(m)) return this.guarded(adapter, m, "pairing", () => this.pair(adapter, m, start[1]));
    if (!this.allowed(m)) {
      await this.replyToStranger(adapter, m);
      return "done";
    }
    if (start) {
      await this.reply(adapter, m.ref, HELP, true);
      return "done";
    }
    if (m.replyTo && this.awaiting.has(chatKey(m.ref)) && await this.takeAnswer(adapter, m, chatKey(m.ref))) return "done";
    const command = parseCommand(m.text, adapter.account);
    if (command) return this.guarded(adapter, m, `/${command.name}`, () => this.runCommand(adapter, m, command));
    return this.accept(adapter, m);
  }

  private async pair(adapter: ChannelAdapter, m: InboundMessage, token: string | undefined): Promise<void> {
    const outcome = token ? this.desk.redeem(m.ref.platform, token) : { outcome: "unknown" as const };
    if (outcome.outcome === "expired") {
      await this.reply(adapter, m.ref, EXPIRED_LINK_REPLY);
      return;
    }
    if (outcome.outcome !== "paired") {
      await this.replyToStranger(adapter, m);
      return;
    }
    this.store.update((s) => { s.pairings.push({ platform: m.ref.platform, senderId: m.senderId, name: m.senderName, role: "owner", pairedAt: this.options.now() }); });
    this.recordInReachableRooms(() => `A ${PLATFORM_NAMES[m.ref.platform]} account was paired (${m.senderName || m.senderId}): every device signed in to it can now read and write here.`);
    this.host.paired?.(m.ref.platform, m.senderName || m.senderId);
    this.host.channelsChanged();
    await this.reply(adapter, m.ref, `<b>Paired.</b> This ${PLATFORM_NAMES[m.ref.platform]} account is yours now: what you write here reaches your rooms, and their replies come back here, on every device signed in to it.\nSend <b>/rooms</b> and tap the one you want.`, true);
  }

  private async accept(adapter: ChannelAdapter, m: InboundMessage): Promise<"done" | "pause"> {
    const key = chatKey(m.ref);
    const binding = this.store.get().bindings[key];
    if (!binding) {
      await this.reply(adapter, m.ref, `Nothing was sent: ${this.noRoomReply(key)}`);
      return "done";
    }
    const room = this.host.room(binding.roomId);
    if (!room) {
      this.detach(key, binding.roomId, "removed");
      await this.reply(adapter, m.ref, `Your message was not taken: ${this.noRoomReply(key)}`);
      return "done";
    }
    if (!isReachable(room)) {
      this.detach(key, room, "switched-off");
      await this.reply(adapter, m.ref, `Your message was not taken: ${this.noRoomReply(key)}`);
      return "done";
    }
    let text = m.text.replace(ZERO_WIDTH, "");
    if (m.replyToUnread) this.log.info(`${adapter.platform}: a reply to one of my own messages names nobody: ${m.replyToUnread}`);
    const addressed = m.replyToAuthor ? room.findByName(m.replyToAuthor) : undefined;
    if (addressed?.kind === "agent" && addressed.status !== "left" && !mentions(spokenText(text), addressed.name)) text = `@${addressed.name} ${text}`;
    let images: { name?: string; mimeType: string; data: string }[] = [];
    if (m.file) {
      if (m.file.size !== undefined && m.file.size > adapter.limits.download) {
        await this.reply(adapter, m.ref, `That ${m.file.kind} is larger than ${Math.round(adapter.limits.download / 1024 / 1024)} MB, which is more than can be fetched from here; your words${m.text.trim() ? " went through without it" : " were not sent"}. Use viberoom on your computer for a file that big.`);
        if (!m.text.trim()) return "done";
      } else {
        let fetched: { data: Buffer; name?: string; mime?: string };
        try {
          fetched = await adapter.downloadFile(m.file);
        } catch (error) {
          this.log.warn(`file from ${key} not fetched: ${describe(error)}`);
          await this.reply(adapter, m.ref, `The ${m.file.kind} could not be fetched from ${PLATFORM_NAMES[m.ref.platform]} (${describe(error)}); your words${m.text.trim() ? " went through without it" : " were not sent"}. Try sending it again.`);
          if (!m.text.trim()) return "done";
          fetched = { data: Buffer.alloc(0) };
        }
        if (fetched.data.length) {
          if (m.file.kind === "photo") images = [{ name: fetched.name, mimeType: fetched.mime ?? "image/jpeg", data: fetched.data.toString("base64") }];
          else {
            const saved = saveDocument(room.filesDir(), fetched.name ?? m.file.name, fetched.data);
            text = `${text.trim()}${text.trim() ? "\n" : ""}📎 ${basename(saved.path)} — ${saved.path}`;
          }
        }
      }
    } else if (!m.text.trim() && m.attachment) {
      await this.reply(adapter, m.ref, "Only text, photos and files reach the room; that kind of message does not.");
      return "done";
    }
    let receipt: ExternalReceipt;
    try {
      receipt = room.acceptExternalMessage({
        opId: acceptKey(m.ref, m.updateId),
        via: { platform: m.ref.platform, account: m.ref.account, chatId: m.ref.chatId, threadId: m.ref.threadId, updateId: m.updateId, messageId: m.messageId, senderId: m.senderId },
        text,
        ...(images.length ? { images } : {}),
      });
    } catch (error) {
      await this.pause(adapter, m.ref, `the room could not take the message: ${describe(error)}`, "unavailable");
      return "pause";
    }
    if (receipt.stored === "rejected") {
      const what = receipt.transient
        ? "The room's record is waiting for you in viberoom on your computer (decide on its card, or repair the history file and restart); until then the room takes nothing."
        : receipt.reason;
      const quote = m.text.trim() ? `\n\nYour message, to send again later:\n${m.text.trim()}` : "";
      await this.reply(adapter, m.ref, `Not saved. ${what}${quote}`);
      return "done";
    }
    if (adapter.capabilities.buttons && !m.file && m.text.trim()) void this.offerFiles(adapter, m.ref, room, m.text);
    if (receipt.stored === "memory") {
      await this.pause(adapter, m.ref, "the conversation store refused the message and the journal could not be written; it is kept in memory only", "memory");
      return "pause";
    }
    if (!receipt.repeated) {
      const hint = this.offlineHint(adapter, key, room, "Your message is in the room, but");
      if (hint) await this.reply(adapter, m.ref, hint.text, false, hint.buttons);
    }
    return "done";
  }

  private detach(key: string, room: Room | string, why: "switched-off" | "removed"): void {
    const name = typeof room === "string" ? room : roomName(room);
    this.store.update((s) => {
      delete s.bindings[key];
      s.detached[key] = { roomName: name, why, at: this.options.now() };
    });
    this.forgetLive(key);
  }

  private noRoomReply(key: string): string {
    const note = this.store.get().detached[key];
    if (!note) return "No room is open in this chat. Send /rooms to see them and /open <name> to open one.";
    this.store.update((s) => { delete s.detached[key]; });
    return note.why === "switched-off"
      ? `${note.roomName} was switched off for messengers, so this chat was detached; it is not in /rooms until you switch it on in the room's settings in viberoom on your computer. Send /rooms to open another room.`
      : `${note.roomName} was removed, so this chat was detached. Send /rooms to open another room.`;
  }


  private button(chat: string, action: ButtonAction): string {
    const now = this.options.now();
    if (this.buttons.size >= BUTTON_CAP) {
      for (const [data, entry] of this.buttons) if (entry.until <= now) this.buttons.delete(data);
      while (this.buttons.size >= BUTTON_CAP) this.buttons.delete(this.buttons.keys().next().value!);
    }
    const data = `b:${randomBytes(9).toString("base64url")}`;
    this.buttons.set(data, { action, chat, until: now + BUTTON_TTL_MS });
    return data;
  }

  private async pressed(adapter: ChannelAdapter, m: InboundMessage): Promise<"done"> {
    const answer = async (text: string): Promise<void> => {
      try {
        await adapter.answerButton(m.button!.callbackId, text);
      } catch (error) {
        this.log.warn(`button not answered: ${describe(error)}`);
      }
    };
    if (!this.allowed(m)) return answer(STRANGER_REPLY).then(() => "done" as const);
    const key = chatKey(m.ref);
    const entry = this.buttons.get(m.button!.data);
    if (!entry || entry.chat !== key || entry.until <= this.options.now()) {
      await answer(STALE_BUTTON_REPLY);
      return "done";
    }
    const action = entry.action;
    const room = "roomId" in action ? this.host.room(action.roomId) : undefined;
    switch (action.kind) {
      case "hush": {
        if (!room || this.store.get().bindings[key]?.roomId !== room.id) return answer("That room is not open in this chat any more.").then(() => "done" as const);
        if (room.focused) return answer("Already hushed: the vibemates stop until you write again.").then(() => "done" as const);
        room.focus(`${PLATFORM_NAMES[m.ref.platform]} (${m.senderName || m.senderId})`);
        await answer("Hushed: the vibemates stop until you write again.");
        return "done";
      }
      case "vibemate": {
        const who = room?.participants.get(action.participantId);
        if (!room || !who) return answer("That vibemate is not in the room any more.").then(() => "done" as const);
        await this.reply(adapter, m.ref, vibemateCard(room, who), true, this.vibemateButtons(key, room, who));
        await answer("");
        return "done";
      }
      case "settings": {
        const who = room?.participants.get(action.participantId);
        if (!room || !who) return answer("That vibemate is not in the room any more.").then(() => "done" as const);
        await this.showSettings(adapter, m.ref, key, room, who);
        await answer("");
        return "done";
      }
      case "setting": {
        const who = room?.participants.get(action.participantId);
        if (!room || !who) return answer("That vibemate is not in the room any more.").then(() => "done" as const);
        if (action.configId === DELAY_ID) {
          const rows = DELAY_CHOICES.filter((s) => s !== who.replyDelay).map((s) => [{ text: delayWords(s, room.settings.replyDelay), data: this.button(key, { kind: "delay", roomId: room.id, participantId: who.id, seconds: s }) }]);
          if (who.replyDelay !== undefined) rows.push([{ text: `The room's own (${delayWords(undefined, room.settings.replyDelay)})`, data: this.button(key, { kind: "delay", roomId: room.id, participantId: who.id, seconds: null }) }]);
          const words = [`<b>Waits</b> before ${escapeHtml(who.name)} answers`, `Now: ${delayWords(who.replyDelay, room.settings.replyDelay)}`, "<i>A pause before it starts, so a room of vibemates does not answer all at once.</i>"];
          await this.reply(adapter, m.ref, words.join("\n"), true, rows);
          await answer("");
          return "done";
        }
        const setting = vibemateSettings(who).find((s) => s.id === action.configId);
        if (!setting) return answer("That setting is not offered any more.").then(() => "done" as const);
        const lines = [`<b>${escapeHtml(setting.name)}</b> for ${escapeHtml(who.name)}`, `Now: ${escapeHtml(setting.shown)}`];
        if (setting.description) lines.push(`<i>${escapeHtml(setting.description)}</i>`);
        const buttons = setting.choices
          .filter((c) => c.value !== setting.value)
          .map((c) => [{ text: c.name, data: this.button(key, { kind: "set", roomId: room.id, participantId: who.id, configId: setting.id, value: c.value }) }]);
        await this.reply(adapter, m.ref, lines.join("\n"), true, buttons.length ? buttons : undefined);
        await answer("");
        return "done";
      }
      case "set": {
        const who = room?.participants.get(action.participantId);
        if (!room || !who) return answer("That vibemate is not in the room any more.").then(() => "done" as const);
        const from = `${PLATFORM_NAMES[m.ref.platform]}, ${this.writerName(m)}`;
        try {
          if (who.status === "offline" || who.status === "unstaffed") room.setLaunch(who.id, { [action.configId]: String(action.value) }, from);
          else await room.setConfig(who.id, action.configId, action.value, from);
        } catch (error) {
          await answer(`${who.name} did not take that: ${describe(error)}`.slice(0, 190));
          return "done";
        }
        await answer("Changed.");
        await this.showSettings(adapter, m.ref, key, room, who);
        return "done";
      }
      case "delay": {
        const who = room?.participants.get(action.participantId);
        if (!room || !who) return answer("That vibemate is not in the room any more.").then(() => "done" as const);
        room.updatePersona(who.id, { replyDelay: action.seconds });
        await answer(`${who.name} waits ${delayWords(who.replyDelay, room.settings.replyDelay)}.`);
        await this.showSettings(adapter, m.ref, key, room, who);
        return "done";
      }
      case "vibio": {
        const who = room?.participants.get(action.participantId);
        if (!room || !who) return answer("That vibemate is not in the room any more.").then(() => "done" as const);
        const now = who.role ? `<i>${escapeHtml(shorten(who.role, 300))}</i>` : "<i>It has none yet.</i>";
        const sent = await this.ask(adapter, m.ref, [`<b>Vibio</b> of ${escapeHtml(who.name)}`, now, "Write the new one as a reply to this message. It holds from its next turn."].join("\n"), "Who is this vibemate? What does it care about?");
        if (sent) this.awaiting.set(key, { messageId: sent, roomId: room.id, participantId: who.id, until: this.options.now() + ASK_TTL_MS });
        await answer("");
        return "done";
      }
      case "mute": {
        const target = room?.participants.get(action.participantId);
        if (!room || !target) return answer("That vibemate is not in the room any more.").then(() => "done" as const);
        room.setMuted(target.id, action.on, `${PLATFORM_NAMES[m.ref.platform]}, ${this.writerName(m)}`);
        this.buttons.delete(m.button!.data);
        await answer(action.on ? `${target.name} is muted.` : `${target.name} can answer again.`);
        await this.reply(adapter, m.ref, vibemateCard(room, target), true, this.vibemateButtons(key, room, target));
        return "done";
      }
      case "restart": {
        const restart = this.host.restart;
        if (!restart) return answer("This viberoom cannot restart itself.").then(() => "done" as const);
        const by = this.writerName(m);
        if (!action.now) {
          restart.cancel(by);
          await answer("The restart is called off.");
          return "done";
        }
        if (restart.pending()) restart.now(by);
        else restart.request({ askedBy: by, from: m.ref.platform, when: "now" });
        await answer("viberoom is restarting; it comes back in a few seconds.");
        return "done";
      }
      case "permit": {
        if (!room || !room.permissionPending(action.key)) return answer("Already answered.").then(() => "done" as const);
        room.resolvePermission(action.key, action.optionId);
        const from = PLATFORM_NAMES[m.ref.platform];
        room.channelRecord(action.allow
          ? `${room.settings.humanName} allowed ${action.who}'s action once from ${from}: ${action.what}.`
          : `${room.settings.humanName} refused ${action.who}'s action from ${from}: ${action.what}.`);
        await answer(action.allow ? "Allowed, once." : "Not allowed.");
        return "done";
      }
      case "open": {
        if (!room || !isReachable(room)) return answer("That room cannot be opened from here any more.").then(() => "done" as const);
        await answer(`Opening ${roomName(room)}…`);
        await this.openRoom(adapter, m.ref, key, room);
        return "done";
      }
      case "stop": {
        if (action.turnId && !this.wedgeCardFor(key, action.turnId)) return answer("That turn is over.").then(() => "done" as const);
        const target = room?.participants.get(action.participantId);
        if (!room || !target) return answer("That vibemate is not in the room any more.").then(() => "done" as const);
        if (action.turnId) {
          if (!this.wedgeCardFor(key, action.turnId) || target.activeTurnId !== action.turnId) return answer("That turn is over.").then(() => "done" as const);
          await answer(cancelTurn(room, target.id, action.turnId) === "nothing" ? "That turn is over." : `Stopping ${target.name}.`);
          return "done";
        }
        this.buttons.delete(m.button!.data);
        await answer(cancelTurn(room, target.id) === "nothing" ? `${target.name} is not writing anything now.` : `Stopping ${target.name}.`);
        return "done";
      }
      case "nudge": {
        if (!this.wedgeCardFor(key, action.turnId)) return answer("That turn is over.").then(() => "done" as const);
        const target = room?.participants.get(action.participantId);
        if (!room || !target) return answer("That vibemate is not in the room any more.").then(() => "done" as const);
        await answer("Asking it…");
        try {
          const outcome = await room.nudge(target.id, `${PLATFORM_NAMES[m.ref.platform]}, ${m.senderName || m.senderId}`);
          await this.reply(adapter, m.ref, outcome === "answered"
            ? `<b>${escapeHtml(target.name)} still answers.</b> What is stuck is the request to the provider. Stop should work.`
            : `<b>${escapeHtml(target.name)} does not answer.</b> ${WEDGE_SILENT_LINE.slice("It does not answer. ".length)}`, true);
        } catch (error) {
          await this.reply(adapter, m.ref, `${target.name} could not be asked: ${describe(error)}`);
        }
        return "done";
      }
      case "respawn": {
        if (!this.wedgeCardFor(key, action.turnId)) return answer("That turn is over.").then(() => "done" as const);
        const target = room?.participants.get(action.participantId);
        if (!room || !target) return answer("That vibemate is not in the room any more.").then(() => "done" as const);
        this.buttons.delete(m.button!.data);
        this.wedgeFinish(`${key}|${action.turnId}`, `${escapeHtml(target.name)} was given a fresh start from ${PLATFORM_NAMES[m.ref.platform]}: a new session with its notes and the last messages.`);
        await answer(`Starting ${target.name} fresh…`);
        try {
          await room.respawnAgent(target.id, { memory: true, replay: room.settings.replayAfterRestart, reason: `it was given a fresh start from ${PLATFORM_NAMES[m.ref.platform]} while its turn was stuck` });
        } catch (error) {
          await this.reply(adapter, m.ref, `${target.name} could not be started fresh: ${describe(error)}`);
        }
        return "done";
      }
      case "earlier": {
        const binding = this.store.get().bindings[key];
        if (!room || binding?.roomId !== room.id) return answer("That room is not open in this chat any more.").then(() => "done" as const);
        this.buttons.delete(m.button!.data);
        await answer("Sending the earlier messages…");
        this.enqueue(key, () => this.sendEarlier(adapter, key, room, action.beforeSeq));
        return "done";
      }
      case "file": {
        if (!room || this.store.get().bindings[key]?.roomId !== room.id) return answer("That room is not open in this chat any more.").then(() => "done" as const);
        const checked = this.fileRefusal(room, action.path, adapter);
        if ("refusal" in checked) return answer(checked.refusal).then(() => "done" as const);
        await answer(`Sending ${basename(action.path)}…`);
        this.enqueue(key, async () => {
          try {
            const data = readFileSync(checked.real);
            if (data.length > adapter.limits.file) throw new Error(`the file grew past ${Math.round(adapter.limits.file / 1024 / 1024)} MB`);
            const photo = /\.(png|jpe?g|webp|gif)$/i.test(checked.real) && data.length <= adapter.limits.photo;
            await adapter.sendFile(chatIdOf(key), { name: basename(action.path), data }, { photo, silent: true });
            room.channelRecord(`${basename(action.path)} was sent to ${PLATFORM_NAMES[adapter.platform]} (${m.senderName || m.senderId}).`);
          } catch (error) {
            this.log.warn(`file not sent to ${key}: ${describe(error)}`);
            await this.sendWithRetry(adapter, key, chatIdOf(key), `${basename(action.path)} could not be sent: ${escapeHtml(describe(error))}`, true);
          }
        });
        return "done";
      }
      case "history": {
        if (!room || this.store.get().bindings[key]?.roomId !== room.id) return answer("That room is not open in this chat any more.").then(() => "done" as const);
        await answer("Sending the whole room as a file…");
        this.enqueue(key, async () => {
          try {
            const name = `${roomName(room).replace(/[\\/:*?"<>|]+/g, "-").trim() || "room"}.md`;
            await adapter.sendFile(chatIdOf(key), { name, data: Buffer.from(room.exportMarkdown(), "utf8"), mime: "text/markdown" }, { caption: "The whole room so far.", silent: true });
            room.channelRecord(`The room's history was sent to ${PLATFORM_NAMES[adapter.platform]} (${m.senderName || m.senderId}) as a file.`);
          } catch (error) {
            this.log.warn(`history not sent to ${key}: ${describe(error)}`);
            await this.sendWithRetry(adapter, key, chatIdOf(key), `The history could not be sent: ${escapeHtml(describe(error))}`, true);
          }
        });
        return "done";
      }
      case "reconnect": {
        if (!room) return answer("That room is gone.").then(() => "done" as const);
        const named = action.participantId ? room.participants.get(action.participantId) : undefined;
        const offline = named ? (named.status === "offline" ? [named] : []) : [...room.participants.values()].filter((p) => p.kind === "agent" && p.status === "offline" && !p.muted);
        if (!offline.length) return answer(`Nobody is waiting to reconnect in ${roomName(room)} now.`).then(() => "done" as const);
        this.buttons.delete(m.button!.data);
        await answer(`Reconnecting ${offline.map((p) => p.name).join(", ")}…`);
        for (const p of offline) {
          if (p.muted && !named) continue;
          try {
            await room.reconnect(p.id, this.host.reconnectOptions());
          } catch (error) {
            await this.reply(adapter, m.ref, `${p.name} could not be reconnected: ${describe(error)}`);
          }
        }
        return "done";
      }
    }
  }

  private fileRefusal(room: Room, path: string, adapter: ChannelAdapter): { refusal: string } | { real: string } {
    const scope = fileScope(room, this.store.get().fileRoots, this.host.dataDir());
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      return { refusal: "That file is not there any more." };
    }
    if (!withinReach(real, scope)) return { refusal: "That file is outside the folders the phone may receive from: the room's files, its working folder, and the folders listed in Settings → Channels." };
    let info;
    try {
      info = statSync(real);
    } catch {
      return { refusal: "That file is not there any more." };
    }
    if (!info.isFile()) return { refusal: "That is a folder, not a file." };
    if (info.size > adapter.limits.file) return { refusal: `That file is ${Math.round(info.size / 1024 / 1024)} MB; the limit is ${Math.round(adapter.limits.file / 1024 / 1024)} MB.` };
    return { real };
  }

  private offlineHint(adapter: ChannelAdapter, chat: string, room: Room, lead: string): { text: string; buttons?: Button[][] } | null {
    const agents = [...room.participants.values()].filter((p) => p.kind === "agent" && p.status !== "left");
    const awake = agents.filter((p) => p.status !== "offline" && p.status !== "unstaffed");
    if (!agents.length || awake.length) return null;
    const who = agents.length === 1 ? `its vibemate ${agents[0].name} is` : `its ${agents.length} vibemates are`;
    if (!adapter.capabilities.buttons) return { text: `${lead} ${who} offline. Open viberoom on your computer to reconnect them.` };
    return { text: `${lead} ${who} offline.`, buttons: [[{ text: agents.length === 1 ? `Reconnect ${agents[0].name}` : "Reconnect them", data: this.button(chat, { kind: "reconnect", roomId: room.id }) }]] };
  }

  private allowed(m: InboundMessage): boolean {
    return this.store.allowed(m.ref.platform, m.senderId);
  }

  private async replyToStranger(adapter: ChannelAdapter, m: InboundMessage): Promise<void> {
    const who = `${m.ref.platform}:${m.senderId}`;
    const last = this.strangerReplied.get(who) ?? 0;
    if (this.options.now() - last < STRANGER_REPLY_EVERY_MS) return;
    this.strangerReplied.set(who, this.options.now());
    try {
      await adapter.send(m.ref.chatId, STRANGER_REPLY);
    } catch (error) {
      this.log.warn(`stranger reply not sent: ${describe(error)}`);
    }
  }


  private async pause(adapter: ChannelAdapter, ref: ChatRef, why: string, kind: "memory" | "unavailable"): Promise<void> {
    const key = adapterKey(adapter);
    const pause = this.pauses.get(key) ?? { attempts: 0, timer: null, noticed: new Set<string>() };
    this.pauses.set(key, pause);
    if (pause.timer) return;
    this.log.warn(`${adapter.platform}: paused (${why})`);
    const chat = chatKey(ref);
    if (!pause.noticed.has(chat)) {
      pause.noticed.add(chat);
      const text = kind === "memory"
        ? "viberoom can't save messages right now, so this chat is paused until the conversation store answers again, usually in a moment. Your last message is in the room, kept in memory only, and will be saved then."
        : "viberoom can't reach its conversation store right now, so this chat is paused until it answers again, usually in a moment. Your last message was not taken yet; it will be asked for again then, and if it does not show up in the room, send it again.";
      try {
        await adapter.send(ref.chatId, text);
      } catch (error) {
        this.log.warn(`pause notice not sent: ${describe(error)}`);
      }
    }
    adapter.pause();
    const delay = this.options.pauseBackoffMs[Math.min(pause.attempts, this.options.pauseBackoffMs.length - 1)];
    pause.attempts++;
    pause.timer = setTimeout(() => {
      pause.timer = null;
      if (this.stopped) return;
      for (const room of this.host.rooms()) room.retryUnsavedExternal();
      this.log.info(`${adapter.platform}: resuming after ${delay} ms`);
      adapter.resume();
    }, delay);
    pause.timer.unref?.();
  }


  private async runCommand(adapter: ChannelAdapter, m: InboundMessage, command: ParsedCommand): Promise<void> {
    const key = chatKey(m.ref);
    const binding = this.store.get().bindings[key];
    const bound = binding ? this.host.room(binding.roomId) : undefined;
    const reachable = this.host.rooms().filter(isReachable);
    switch (command.name) {
      case "rooms":
        return this.roomsList(adapter, m, key, reachable, bound);
      case "open": {
        if (!command.args) return this.roomsList(adapter, m, key, reachable, bound);
        const target = pickRoom(reachable, this.host.rooms(), command.args);
        if (target === "hidden") return this.reply(adapter, m.ref, "That room is not reachable from messengers: switch it on in the room's settings in viberoom on your computer.");
        if (!target) return this.reply(adapter, m.ref, `No room called "${command.args}". Send /rooms to see them.`);
        await this.openRoom(adapter, m.ref, key, target);
        return;
      }
      case "close": {
        if (!binding) return this.reply(adapter, m.ref, this.noRoomReply(key));
        const standing = this.live.get(key);
        if (standing) this.enqueue(key, () => this.liveDelete(adapter, key, standing));
        this.store.update((s) => { delete s.bindings[key]; delete s.detached[key]; });
        this.forgetLive(key);
        return this.reply(adapter, m.ref, `Detached from ${bound ? roomLabel(bound) : "the room"}. The room stays as it is; /open to attach again.`, true);
      }
      case "who": {
        if (!bound) return this.reply(adapter, m.ref, this.noRoomReply(key));
        const hushed = bound.focused ? "\n<i>Hushed: the vibemates stop until you write again.</i>" : "";
        const rows = adapter.capabilities.buttons
          ? presentAgents(bound).map((p) => [{ text: p.name, data: this.button(key, { kind: "vibemate", roomId: bound.id, participantId: p.id }) }])
          : [];
        const hush = this.hushButton(adapter, key, bound);
        const tap = rows.length ? "\nTap a name for what you can do with it." : "";
        return this.reply(adapter, m.ref, `${roomLabel(bound)}\n${whoHtml(bound)}${hushed}${tap}`, true, [...rows, ...(hush ?? [])]);
      }
      case "stop": {
        if (!bound) return this.reply(adapter, m.ref, this.noRoomReply(key));
        const stop = this.stopReply(adapter, key, bound, command.args);
        return this.reply(adapter, m.ref, stop.text, false, stop.buttons);
      }
      case "restart": {
        const restart = this.host.restart;
        if (!restart) return this.reply(adapter, m.ref, "This viberoom cannot restart itself. Use Settings → Restart in viberoom on your computer.");
        if (restart.pending()) return this.reply(adapter, m.ref, "A restart is already on its way.", false, this.restartButtons(key, true));
        const writing = restart.writingNow();
        if (!writing.length) {
          return this.reply(adapter, m.ref, "<b>Restart viberoom?</b> It comes back in a few seconds, with your rooms; the bot goes quiet while it does.", true, [
            [{ text: "Restart", data: this.button(key, { kind: "restart", now: true }) }],
          ]);
        }
        this.restartChat = { key, ref: m.ref };
        restart.request({ askedBy: this.writerName(m), from: m.ref.platform, when: "idle" });
        return this.reply(adapter, m.ref, `<b>Restart requested.</b> ${nameList(writing)} ${writing.length > 1 ? "are" : "is"} writing — viberoom will restart when ${writing.length > 1 ? "they finish" : "that reply is done"}.\nThe bot goes quiet for a few seconds.`, true, this.restartButtons(key, true));
      }
      case "help":
        return this.reply(adapter, m.ref, HELP, true);
    }
  }

  private restartChat: { key: string; ref: ChatRef } | null = null;

  async restartStillWaiting(text: string): Promise<void> {
    const at = this.restartChat;
    const adapter = at && this.adapterForKey(at.key);
    if (!at || !adapter) return;
    await this.reply(adapter, at.ref, text, true, this.restartButtons(at.key, true));
  }

  private vibemateButtons(key: string, room: Room, who: Participant): Button[][] {
    const rows: Button[][] = [];
    const row: Button[] = [{ text: who.muted ? "Unmute" : "Mute", data: this.button(key, { kind: "mute", roomId: room.id, participantId: who.id, on: !who.muted }) }];
    if (who.status === "thinking" || who.status === "queued") row.push({ text: "Stop", data: this.button(key, { kind: "stop", roomId: room.id, participantId: who.id }) });
    if (who.status === "offline") row.push({ text: "Reconnect", data: this.button(key, { kind: "reconnect", roomId: room.id, participantId: who.id }) });
    rows.push(row);
    if (this.adapterForKey(key)?.capabilities.copyButtons) rows.push([{ text: `Copy @${who.name}`, data: "", copy: `@${who.name} ` }]);
    if (hasSettingsHere(who)) {
      rows.push([{ text: "Settings…", data: this.button(key, { kind: "settings", roomId: room.id, participantId: who.id }) }]);
    }
    return rows;
  }

  private readonly awaiting = new Map<string, { messageId: string; roomId: string; participantId: string; until: number }>();

  private async ask(adapter: ChannelAdapter, ref: ChatRef, text: string, placeholder: string): Promise<string | null> {
    const key = chatKey(ref);
    let id: string | null = null;
    await this.enqueue(key, async () => {
      try {
        id = (await adapter.send(ref.chatId, text, { html: true, forceReply: { placeholder } })).messageId;
      } catch (error) {
        this.log.warn(`${adapter.platform}: the question was not sent to ${key}: ${describe(error)}`);
      }
    });
    return id;
  }

  private async takeAnswer(adapter: ChannelAdapter, m: InboundMessage, key: string): Promise<boolean> {
    const waiting = this.awaiting.get(key);
    if (!waiting) return false;
    if (waiting.until <= this.options.now()) {
      this.awaiting.delete(key);
      return false;
    }
    if (!m.replyTo || m.replyTo !== waiting.messageId) return false;
    this.awaiting.delete(key);
    const room = this.host.room(waiting.roomId);
    const who = room?.participants.get(waiting.participantId);
    if (!room || !who) {
      await this.reply(adapter, m.ref, "That vibemate is not in the room any more.");
      return true;
    }
    try {
      room.updatePersona(who.id, { role: m.text.replace(ZERO_WIDTH, "").trim() });
    } catch (error) {
      await this.reply(adapter, m.ref, `That did not take: ${describe(error)}`);
      return true;
    }
    room.hubRecord(`${who.name}'s vibio was rewritten (${PLATFORM_NAMES[m.ref.platform]}, ${this.writerName(m)}); it holds from its next turn.`);
    await this.reply(adapter, m.ref, `<b>${escapeHtml(who.name)}</b> has its new vibio; it holds from its next turn.`, true);
    await this.showSettings(adapter, m.ref, key, room, who);
    return true;
  }

  private async showSettings(adapter: ChannelAdapter, ref: ChatRef, key: string, room: Room, who: Participant): Promise<void> {
    const buttons = vibemateSettings(who).map((s) => [{ text: `${s.name}: ${s.shown}`, data: this.button(key, { kind: "setting", roomId: room.id, participantId: who.id, configId: s.id }) }]);
    buttons.push([{ text: `Waits: ${delayWords(who.replyDelay, room.settings.replyDelay)}`, data: this.button(key, { kind: "setting", roomId: room.id, participantId: who.id, configId: DELAY_ID }) }]);
    buttons.push([{ text: `Vibio: ${who.role ? shorten(who.role, 24) : "not set"}`, data: this.button(key, { kind: "vibio", roomId: room.id, participantId: who.id }) }]);
    const asleep = who.status === "offline" || who.status === "unstaffed";
    const text = [
      `<b>${escapeHtml(who.name)}</b> — settings`,
      asleep ? "It is not running. What you choose here is what it starts with when it comes back." : "Tap one to change it; it holds from its next turn.",
      `Its name, its face and its skills change in viberoom on your computer, under Settings → ${escapeHtml(who.name)}.`,
    ].join("\n");
    return this.reply(adapter, ref, text, true, buttons);
  }

  private restartButtons(key: string, waiting: boolean): Button[][] {
    const row: Button[] = [{ text: "Restart now", data: this.button(key, { kind: "restart", now: true }) }];
    if (waiting) row.push({ text: "Cancel", data: this.button(key, { kind: "restart", now: false }) });
    return [row];
  }

  private writerName(m: InboundMessage): string {
    const paired = this.store.get().pairings.find((p) => p.platform === m.ref.platform && p.senderId === m.senderId);
    return paired?.name || m.senderName || "Someone";
  }

  private async roomsList(adapter: ChannelAdapter, m: InboundMessage, key: string, reachable: Room[], bound: Room | undefined): Promise<void> {
    if (!reachable.length) return this.reply(adapter, m.ref, "No room can be opened from here yet. Open viberoom on your computer to create one, or switch a room's messenger access on.");
    const lines = reachable.map((room, i) => `${i + 1}. ${roomLabel(room)}${bound?.id === room.id ? " — <i>open here</i>" : ""}`);
    if (!adapter.capabilities.buttons) return this.reply(adapter, m.ref, `<b>Rooms you can open here</b>\n${lines.join("\n")}\nSend /open &lt;number or name&gt;.`, true);
    const buttons = reachable.map((room) => [{ text: roomTitle(room), data: this.button(key, { kind: "open", roomId: room.id }) }]);
    return this.reply(adapter, m.ref, `<b>Rooms you can open here</b>\n${lines.join("\n")}\nTap one to open it, or send /open &lt;number or name&gt;.`, true, buttons);
  }

  private async openRoom(adapter: ChannelAdapter, ref: ChatRef, key: string, target: Room): Promise<void> {
    const shown = target.messages.filter((msg) => renderForPhone(msg) && !cameFrom(msg, key));
    const context = shown.slice(-this.options.openContext);
    const before = shown.length - context.length;
    const latest = target.messages.length ? target.messages[target.messages.length - 1].seq : 0;
    const beforeContext = context.length ? context[0].seq - 1 : latest;
    this.store.update((s) => { s.bindings[key] = { roomId: target.id, cursorSeq: beforeContext, since: this.options.now() }; delete s.detached[key]; });
    this.host.markOpened(target.id);
    const head = `Opened ${roomLabel(target)}.\n${whoHtml(target)}\nWhat you write here goes to the room; what the vibemates answer comes here.`;
    const history = context.length
      ? context.length === 1 ? (before ? "Its newest message:" : "Its only message:") : `Its newest ${context.length} messages:`
      : "Nothing has been said in it yet.";
    let sent = false;
    await this.enqueue(key, async () => {
      const trailer = before ? this.earlierTrailer(adapter, key, target, context[0].seq, before) : { text: "<i>That is all of it so far.</i>", buttons: adapter.capabilities.buttons ? [] : undefined };
      if (trailer.buttons) trailer.buttons.push([{ text: "The whole room as a file", data: this.button(key, { kind: "history", roomId: target.id }) }]);
      const hush = this.hushButton(adapter, key, target);
      if (trailer.buttons && hush) trailer.buttons.push(...hush);
      sent = await this.sendBundle(adapter, key, [head, `<i>${history}</i>`, ...context.map(renderLine)], trailer);
    });
    if (sent) this.advance(key, latest);
    else this.fellBehind(adapter, key, target);
    const hint = this.offlineHint(adapter, key, target, "Right now");
    if (hint) await this.reply(adapter, ref, hint.text, false, hint.buttons);
  }

  private earlierTrailer(adapter: ChannelAdapter, key: string, room: Room, beforeSeq: number, count: number): { text: string; buttons?: Button[][] } {
    const text = `<i>${count} earlier message${count === 1 ? " is" : "s are"} in viberoom on your computer.</i>`;
    const buttons = adapter.capabilities.buttons ? [[{ text: `Earlier ${Math.min(count, this.options.earlierPage)}`, data: this.button(key, { kind: "earlier", roomId: room.id, beforeSeq }) }]] : undefined;
    return { text, buttons };
  }

  private async sendEarlier(adapter: ChannelAdapter, key: string, room: Room, beforeSeq: number): Promise<void> {
    const older = room.messages.filter((m) => m.seq < beforeSeq && renderForPhone(m) && !cameFrom(m, key));
    const page = older.slice(-this.options.earlierPage);
    if (!page.length) {
      await this.sendWithRetry(adapter, key, chatIdOf(key), "<i>Nothing is earlier than what you have.</i>", true, { silent: true });
      return;
    }
    const rest = older.length - page.length;
    const intro = `<i>${page.length} earlier message${page.length === 1 ? "" : "s"}${rest ? `; ${rest} more before ${page.length === 1 ? "it" : "them"}` : ""}:</i>`;
    await this.sendBundle(adapter, key, [intro, ...page.map(renderLine)], rest ? this.earlierTrailer(adapter, key, room, page[0].seq, rest) : { text: "<i>That is the whole room.</i>" });
  }

  private async sendBundle(adapter: ChannelAdapter, key: string, parts: string[], trailer: { text: string; buttons?: Button[][] } | null, silent = true): Promise<boolean> {
    const text = [...parts, ...(trailer ? [trailer.text] : [])].join("\n\n");
    const pieces = splitText(text, Math.max(200, adapter.limits.text - 16));
    for (let i = 0; i < pieces.length; i++) {
      const last = i === pieces.length - 1;
      if (!(await this.sendWithRetry(adapter, key, chatIdOf(key), pieces[i], true, { buttons: last ? trailer?.buttons : undefined, silent }))) return false;
    }
    return true;
  }

  private stopReply(adapter: ChannelAdapter, chat: string, room: Room, args: string): { text: string; buttons?: Button[][] } {
    if (args) {
      const name = args.replace(/^@/, "").trim();
      const target = room.findByName(name);
      if (!target || target.kind !== "agent") return { text: `Nobody called ${name} is in ${roomName(room)}.` };
      return { text: cancelTurn(room, target.id) === "nothing" ? `${target.name} is not writing anything now.` : `Stopping ${target.name}.` };
    }
    const writer = this.writing.get(room.id);
    const writerParticipant = writer ? room.participants.get(writer) : undefined;
    if (writerParticipant && cancelTurn(room, writerParticipant.id) !== "nothing") return { text: `Stopping ${writerParticipant.name}.` };
    const busy = [...room.participants.values()].filter((p) => p.kind === "agent" && (p.status === "thinking" || p.status === "queued"));
    if (busy.length === 1) return { text: cancelTurn(room, busy[0].id) === "nothing" ? `${busy[0].name} is not writing anything now.` : `Stopping ${busy[0].name}.` };
    if (busy.length > 1) {
      const names = busy.map((p) => p.name).join(", ");
      if (!adapter.capabilities.buttons) return { text: `Several are at work: ${names}. Say /stop @Name to stop one.` };
      return { text: `Several are at work: ${names}. Tap one to stop it, or say /stop @Name.`, buttons: busy.map((p) => [{ text: `Stop ${p.name}`, data: this.button(chat, { kind: "stop", roomId: room.id, participantId: p.id }) }]) };
    }
    return { text: "Nobody is writing anything now." };
  }


  private typingCheck(roomId: string): void {
    const room = this.host.room(roomId);
    if (!room) return;
    const busy = someoneWriting(room);
    for (const [key, binding] of Object.entries(this.store.get().bindings)) {
      if (binding.roomId !== roomId) continue;
      if (busy) this.startTyping(key, roomId);
      else this.stopTyping(key);
    }
  }

  private startTyping(key: string, roomId: string): void {
    if (this.typing.has(key) || this.stopped) return;
    const adapter = this.adapterForKey(key);
    if (!adapter) return;
    const tick = (): void => {
      const room = this.host.room(roomId);
      const binding = this.store.get().bindings[key];
      if (this.stopped || !room || binding?.roomId !== roomId || !someoneWriting(room)) {
        this.stopTyping(key);
        return;
      }
      adapter.sendTyping(chatIdOf(key)).catch((error) => this.log.warn(`typing not sent to ${key}: ${describe(error)}`));
      const timer = setTimeout(tick, this.options.typingEveryMs);
      timer.unref?.();
      this.typing.set(key, timer);
    };
    tick();
  }

  private stopTyping(key: string): void {
    const timer = this.typing.get(key);
    if (timer) clearTimeout(timer);
    this.typing.delete(key);
  }


  private onRoomEvent(roomId: string, event: RoomEvent): void {
    if (event.type === "participant" || event.type === "participant.removed") {
      this.typingCheck(roomId);
      if (event.type === "participant") this.wedgeSeen(roomId, event.participant);
      return;
    }
    if (event.type === "chunk") {
      this.liveChunk(roomId, event.id, event.text);
      return;
    }
    if (event.type === "permission") {
      const room = this.host.room(roomId);
      const who = room?.participants.get(event.permission.participantId)?.name ?? "A vibemate";
      const what = event.permission.toolCall.title || event.permission.toolCall.name || "an action";
      this.tellPermission(roomId, room, event.permission, who, what);
      this.liveWaiting(roomId, event.permission.participantId, true);
      return;
    }
    if (event.type === "permission.resolved") {
      this.liveWaiting(roomId, null, false);
      return;
    }
    if (event.type !== "message") return;
    const message = event.message;
    if (message.streaming) {
      this.writing.set(roomId, message.from);
      if ([...this.live.values()].some((row) => row.roomId === roomId && row.messageId === message.id)) this.liveResync(roomId, message);
      else this.liveStart(roomId, message);
      return;
    }
    if (this.writing.get(roomId) === message.from) this.writing.delete(roomId);
    this.liveEnd(roomId, message.id);
    if (!renderForPhone(message)) {
      this.liveDrop(roomId, message.id);
      return;
    }
    for (const [key, binding] of Object.entries(this.store.get().bindings)) {
      if (binding.roomId !== roomId) continue;
      const adapter = this.adapterForKey(key);
      if (!adapter) continue;
      this.enqueue(key, () => this.serve(adapter, key));
    }
  }

  private tellPermission(roomId: string, room: Room | undefined, permission: PendingPermission, who: string, what: string): void {
    const state = this.store.get();
    const plain = `<b>${escapeHtml(who)}</b> asks for permission: ${escapeHtml(what)}. Open viberoom on your computer to answer it.`;
    if (!state.phoneApprovals || !room) return this.tellAttached(roomId, plain);
    const allow = permission.options.find((o) => o.kind === "allow_once");
    const deny = permission.options.find((o) => o.kind === "reject_once");
    const paths = (permission.toolCall.locations ?? []).map((l) => l.path).filter((p): p is string => typeof p === "string" && !!p);
    const bounded = PATH_BOUND_KINDS.has(permission.toolCall.kind ?? "");
    if (!allow || !bounded || !paths.length || !this.inReach(room, paths)) return this.tellAttached(roomId, `${plain} The phone may answer only for a file action inside this room's folders.`);
    const text = `<b>${escapeHtml(who)}</b> asks for permission: ${escapeHtml(what)}.`;
    for (const [key, binding] of Object.entries(state.bindings)) {
      if (binding.roomId !== roomId) continue;
      const adapter = this.adapterForKey(key);
      if (!adapter) continue;
      if (!adapter.capabilities.buttons) {
        this.enqueue(key, () => this.sendWithRetry(adapter, key, chatIdOf(key), plain, true));
        continue;
      }
      const buttons = [[
        { text: "Yes, once", data: this.button(key, { kind: "permit", roomId, key: permission.key, optionId: allow.optionId, allow: true, who, what }) },
        { text: "No", data: this.button(key, { kind: "permit", roomId, key: permission.key, optionId: deny?.optionId ?? null, allow: false, who, what }) },
      ]];
      this.enqueue(key, () => this.sendWithRetry(adapter, key, chatIdOf(key), text, true, { buttons }));
    }
  }

  private hushButton(adapter: ChannelAdapter, key: string, room: Room): Button[][] | undefined {
    if (!adapter.capabilities.buttons || room.focused) return undefined;
    return [[{ text: "Hush the room", data: this.button(key, { kind: "hush", roomId: room.id }) }]];
  }

  private async offerFiles(adapter: ChannelAdapter, ref: ChatRef, room: Room, text: string): Promise<void> {
    const key = chatKey(ref);
    try {
      const scope = fileScope(room, this.store.get().fileRoots, this.host.dataDir());
      const found = await filesNamed(stripFenced(text), scope);
      if (!found.length) {
        const asked = bareNames(text);
        if (asked.length) this.enqueue(key, () => this.sendWithRetry(adapter, key, chatIdOf(key), `No ${asked.map(escapeHtml).join(", ")} in the folders the phone may be sent files from.`, true, { silent: true }));
        return;
      }
      const lines = found.map((f) => `<b>${escapeHtml(basename(f.path))}</b> — in ${escapeHtml(folderWords(f.path, room, scope))}`);
      const buttons = found.map((f) => [{ text: fileButtonLabel(f), data: this.button(key, { kind: "file", roomId: room.id, path: f.path }) }]);
      this.enqueue(key, () => this.sendWithRetry(adapter, key, chatIdOf(key), `Found on this computer; tap to send it here:${"\n"}${lines.join("\n")}`, true, { buttons, silent: true }));
    } catch (error) {
      this.log.warn(`files not offered to ${key}: ${describe(error)}`);
    }
  }

  private inReach(room: Room, paths: string[]): boolean {
    const scope = fileScope(room, this.store.get().fileRoots, this.host.dataDir());
    return paths.every((p) => {
      const real = realOf(resolve(p));
      return !!real && withinReach(real, scope);
    });
  }

  private tellAttached(roomId: string, text: string): void {
    for (const [key, binding] of Object.entries(this.store.get().bindings)) {
      if (binding.roomId !== roomId) continue;
      const adapter = this.adapterForKey(key);
      if (!adapter) continue;
      this.enqueue(key, () => this.sendWithRetry(adapter, key, chatIdOf(key), text, true));
    }
  }


  private liveStart(roomId: string, message: ChatMessage): void {
    for (const [key, binding] of Object.entries(this.store.get().bindings)) {
      if (binding.roomId !== roomId || this.live.has(key)) continue;
      const adapter = this.adapterForKey(key);
      if (!adapter || !adapter.capabilities.editing || !adapter.capabilities.buttons) continue;
      this.live.set(key, { roomId, messageId: message.id, participantId: message.from, fromName: message.fromName, text: message.text, sentText: "", shown: 0, ending: false, revealed: null, platformMessageId: "", timer: null, sending: false, waiting: false, done: false, stop: this.button(key, { kind: "stop", roomId, participantId: message.from }) });
    }
  }

  private liveResync(roomId: string, message: ChatMessage): void {
    for (const [key, row] of this.live) {
      if (row.roomId !== roomId || row.messageId !== message.id || row.done) continue;
      row.text = message.text;
      if (row.platformMessageId) this.liveSchedule(key, row);
    }
  }

  private liveChunk(roomId: string, messageId: string, text: string): void {
    for (const [key, row] of this.live) {
      if (row.roomId !== roomId || row.messageId !== messageId || row.done) continue;
      row.text += text;
      if (!row.platformMessageId) {
        if (!row.sending) this.liveSend(key, row);
        continue;
      }
      this.liveSchedule(key, row);
    }
  }

  private liveSend(key: string, row: LiveRow): void {
    const adapter = this.adapterForKey(key);
    if (!adapter) return;
    row.sending = true;
    this.enqueue(key, async () => {
      try {
        if (row.done || this.live.get(key) !== row) return;
        liveAdvance(row);
        const text = liveText(row);
        const sent = await adapter.send(chatIdOf(key), text, { html: true, silent: true, buttons: [[{ text: "Stop", data: row.stop }]] });
        row.platformMessageId = sent.messageId;
        row.sentText = text;
        this.store.update((s) => { const b = s.bindings[key]; if (b) b.live = { messageId: sent.messageId, roomMessageId: row.messageId }; });
        if (row.shown < row.text.length || liveText(row) !== row.sentText) this.liveSchedule(key, row);
      } catch (error) {
        this.log.warn(`live row not sent to ${key}: ${describe(error)}`);
        this.forgetLive(key);
      } finally {
        row.sending = false;
      }
    });
  }

  private liveSchedule(key: string, row: LiveRow): void {
    if (row.timer) return;
    const timer = setTimeout(() => {
      row.timer = null;
      this.liveFlush(key);
    }, this.options.editEveryMs);
    timer.unref?.();
    row.timer = timer;
  }

  private liveFlush(key: string): void {
    const row = this.live.get(key);
    if (!row || row.done || !row.platformMessageId) return;
    liveAdvance(row);
    const text = liveText(row);
    if (row.shown < row.text.length) this.liveSchedule(key, row);
    else if (row.ending) {
      row.done = true;
      row.revealed?.();
      row.revealed = null;
    }
    if (text === row.sentText) return;
    const adapter = this.adapterForKey(key);
    if (!adapter) return;
    row.sentText = text;
    adapter.editMessage(chatIdOf(key), row.platformMessageId, text, { html: true, buttons: [[{ text: "Stop", data: row.stop }]] }).catch((error) => this.log.warn(`live row not edited for ${key}: ${describe(error)}`));
  }

  private liveWaiting(roomId: string, participantId: string | null, waiting: boolean): void {
    for (const [key, row] of this.live) {
      if (row.roomId !== roomId || row.done || (participantId !== null && row.participantId !== participantId) || row.waiting === waiting) continue;
      row.waiting = waiting;
      if (row.platformMessageId) this.liveFlush(key);
    }
  }

  private liveEnd(roomId: string, messageId: string): void {
    for (const [key, row] of this.live) {
      if (row.roomId !== roomId || row.messageId !== messageId) continue;
      row.ending = true;
      if (row.shown >= row.text.length) {
        row.done = true;
        if (row.timer) clearTimeout(row.timer);
        row.timer = null;
        row.revealed?.();
        row.revealed = null;
      } else if (row.platformMessageId) this.liveSchedule(key, row);
    }
  }

  private async awaitReveal(key: string, messageId: string): Promise<void> {
    const row = this.live.get(key);
    if (!row || row.messageId !== messageId || row.shown >= row.text.length || !row.platformMessageId) return;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(cap);
        resolve();
      };
      const cap = setTimeout(() => {
        row.revealed = null;
        resolve();
      }, REVEAL.waitCapMs);
      cap.unref?.();
      row.revealed = done;
    });
  }

  private liveDrop(roomId: string, messageId: string): void {
    for (const [key, row] of this.live) {
      if (row.roomId !== roomId || row.messageId !== messageId) continue;
      const adapter = this.adapterForKey(key);
      if (!adapter) {
        this.forgetLive(key);
        continue;
      }
      this.enqueue(key, () => this.liveDelete(adapter, key, row));
    }
  }

  private async liveDelete(adapter: ChannelAdapter, key: string, row: LiveRow): Promise<void> {
    if (this.live.get(key) === row) this.live.delete(key);
    if (row.timer) clearTimeout(row.timer);
    if (!row.platformMessageId) return;
    try {
      await adapter.deleteMessage(chatIdOf(key), row.platformMessageId);
    } catch (error) {
      this.log.warn(`live row not removed for ${key}: ${describe(error)}`);
    }
    this.store.update((s) => { const b = s.bindings[key]; if (b?.live?.messageId === row.platformMessageId) delete b.live; });
  }

  private forgetLive(key: string): void {
    const row = this.live.get(key);
    if (!row) return;
    if (row.timer) clearTimeout(row.timer);
    this.live.delete(key);
  }


  private wedgeSeen(roomId: string, p: Participant & { quiet?: QuietTurn }): void {
    const quiet = p.muted ? undefined : p.quiet;
    if (quiet) {
      for (const [key, binding] of Object.entries(this.store.get().bindings)) {
        if (binding.roomId !== roomId) continue;
        const adapter = this.adapterForKey(key);
        if (!adapter || !adapter.capabilities.editing || !adapter.capabilities.buttons) continue;
        const at = `${key}|${quiet.turnId}`;
        const card = this.wedges.get(at);
        if (card) {
          if (card.ended) continue;
          card.since = quiet.since;
          card.processAlive = quiet.processAlive;
          card.nudge = quiet.nudge ?? null;
          card.stopping = quiet.stopping ?? null;
          this.wedgeFlush(at);
        } else {
          this.wedges.set(at, { roomId, participantId: p.id, turnId: quiet.turnId, name: p.name, since: quiet.since,
            processAlive: quiet.processAlive, nudge: quiet.nudge ?? null, stopping: quiet.stopping ?? null,
            sentText: "", platformMessageId: "", sending: false, ended: false, timer: null,
            press: {
              nudge: this.button(key, { kind: "nudge", roomId, participantId: p.id, turnId: quiet.turnId }),
              stop: this.button(key, { kind: "stop", roomId, participantId: p.id, turnId: quiet.turnId }),
              respawn: this.button(key, { kind: "respawn", roomId, participantId: p.id, turnId: quiet.turnId }),
            } });
          this.wedgeSend(key, at);
        }
      }
      return;
    }
    for (const [at, card] of this.wedges) {
      if (card.roomId !== roomId || card.participantId !== p.id || card.ended) continue;
      const spoke = p.activeTurnId === card.turnId;
      const minutes = Math.max(0, Math.round((this.options.now() - card.since) / 60_000));
      this.wedgeFinish(at, spoke ? `${escapeHtml(card.name)} answered after ${minutes} minute${minutes === 1 ? "" : "s"}.` : "That turn is over.");
    }
  }

  private wedgeSend(key: string, at: string): void {
    const card = this.wedges.get(at);
    const adapter = card && this.adapterForKey(key);
    if (!card || !adapter || card.sending || card.platformMessageId) return;
    card.sending = true;
    this.enqueue(key, async () => {
      try {
        const text = wedgeText(card, this.options.now());
        const hushed = this.host.room(card.roomId)?.focused === true;
        const sent = await adapter.send(chatIdOf(key), text, { html: true, buttons: this.wedgeButtons(card), ...(hushed ? { silent: true } : {}) });
        card.platformMessageId = sent.messageId;
        card.sentText = text;
        this.store.update((s) => { const b = s.bindings[key]; if (b) b.wedge = { messageId: sent.messageId, turnId: card.turnId }; });
        this.wedgeSchedule(at);
      } catch (error) {
        this.log.warn(`wedge card not sent to ${key}: ${describe(error)}`);
        this.wedges.delete(at);
      } finally {
        card.sending = false;
      }
    });
  }

  private wedgeButtons(card: WedgeCard): Button[][] {
    return [[
      { text: "Nudge", data: card.press.nudge },
      { text: "Stop", data: card.press.stop },
      { text: "Fresh start", data: card.press.respawn },
    ]];
  }

  private wedgeSchedule(at: string): void {
    const card = this.wedges.get(at);
    if (!card || card.timer || card.ended) return;
    const timer = setTimeout(() => {
      const still = this.wedges.get(at);
      if (still) still.timer = null;
      this.wedgeFlush(at);
      this.wedgeSchedule(at);
    }, this.options.wedgeTickMs);
    timer.unref?.();
    card.timer = timer;
  }

  private wedgeFlush(at: string): void {
    const card = this.wedges.get(at);
    if (!card || card.ended || !card.platformMessageId) return;
    const key = at.slice(0, at.lastIndexOf("|"));
    const adapter = this.adapterForKey(key);
    const text = wedgeText(card, this.options.now());
    if (!adapter || text === card.sentText) return;
    card.sentText = text;
    adapter.editMessage(chatIdOf(key), card.platformMessageId, text, { html: true, buttons: this.wedgeButtons(card) })
      .catch((error) => this.log.warn(`wedge card not edited for ${key}: ${describe(error)}`));
  }

  private wedgeFinish(at: string, text: string): void {
    const card = this.wedges.get(at);
    if (!card || card.ended) return;
    card.ended = true;
    if (card.timer) clearTimeout(card.timer);
    card.timer = null;
    this.wedges.delete(at);
    const key = at.slice(0, at.lastIndexOf("|"));
    this.store.update((s) => { const b = s.bindings[key]; if (b?.wedge?.turnId === card.turnId) delete b.wedge; });
    const adapter = this.adapterForKey(key);
    if (!adapter || !card.platformMessageId) return;
    adapter.editMessage(chatIdOf(key), card.platformMessageId, text, { html: true })
      .catch((error) => this.log.warn(`wedge card not closed for ${key}: ${describe(error)}`));
  }

  private wedgeCardFor(key: string, turnId: string): WedgeCard | undefined {
    return this.wedges.get(`${key}|${turnId}`);
  }



  private async catchUp(adapter: ChannelAdapter): Promise<void> {
    const prefix = `${adapterKey(adapter)}:`;
    for (const [key, binding] of Object.entries(this.store.get().bindings)) {
      if (!key.startsWith(prefix)) continue;
      const stale = binding.live;
      if (stale) {
        this.enqueue(key, async () => {
          try {
            await adapter.deleteMessage(chatIdOf(key), stale.messageId);
          } catch (error) {
            this.log.warn(`stale live row not removed for ${key}: ${describe(error)}`);
          }
          this.store.update((s) => { const b = s.bindings[key]; if (b?.live?.messageId === stale.messageId) delete b.live; });
        });
      }
      const openCard = binding.wedge;
      if (openCard) {
        this.enqueue(key, async () => {
          try {
            await adapter.editMessage(chatIdOf(key), openCard.messageId, "That turn is over.", { html: true });
          } catch (error) {
            this.log.warn(`stale wedge card not closed for ${key}: ${describe(error)}`);
          }
          this.store.update((s) => { const b = s.bindings[key]; if (b?.wedge?.messageId === openCard.messageId) delete b.wedge; });
        });
      }
      this.enqueue(key, () => this.serve(adapter, key, true));
    }
    await Promise.all([...this.chains.values()]);
  }

  private async serve(adapter: ChannelAdapter, key: string, bundle = false): Promise<void> {
    const binding = this.store.get().bindings[key];
    if (!binding || this.stopped) return;
    const room = this.host.room(binding.roomId);
    if (!room) {
      this.detach(key, binding.roomId, "removed");
      return;
    }
    if (!isReachable(room)) {
      this.detach(key, room, "switched-off");
      await this.sendWithRetry(adapter, key, chatIdOf(key), `${roomName(room)} is no longer reachable from messengers, so this chat is detached. Send /rooms to pick another room.`, false);
      return;
    }
    let owed = room.messages.filter((m) => m.seq > binding.cursorSeq && renderForPhone(m) && !cameFrom(m, key));
    if (!owed.length) {
      const latest = room.messages.length ? room.messages[room.messages.length - 1].seq : binding.cursorSeq;
      if (latest > binding.cursorSeq) this.advance(key, latest);
      this.caughtUp(key);
      return;
    }
    const limit = this.options.catchUpLimit;
    const skipped = owed.length > limit ? owed.length - limit : 0;
    const capLine = skipped ? `<i>… and ${skipped} earlier message${skipped === 1 ? "" : "s"} — open viberoom on your computer to read them.</i>` : null;
    if (bundle) {
      const page = owed.slice(skipped);
      if (!(await this.sendBundle(adapter, key, [...(capLine ? [capLine] : []), ...page.map(renderLine)], null, false))) return this.fellBehind(adapter, key, room);
      this.advance(key, page[page.length - 1].seq);
      const row = this.live.get(key);
      if (row && page.some((m) => m.id === row.messageId)) await this.liveDelete(adapter, key, row);
      this.caughtUp(key);
      return;
    }
    if (capLine) {
      const ok = await this.sendWithRetry(adapter, key, chatIdOf(key), capLine, true);
      if (!ok) return this.fellBehind(adapter, key, room);
      this.advance(key, owed[skipped - 1].seq);
      owed = owed.slice(skipped);
    }
    for (const message of owed) {
      if (!(await this.deliver(adapter, key, message, room))) return this.fellBehind(adapter, key, room);
    }
    this.caughtUp(key);
  }

  private async deliver(adapter: ChannelAdapter, key: string, message: ChatMessage, room?: Room): Promise<boolean> {
    await this.awaitReveal(key, message.id);
    if (!(await this.sendMessage(adapter, key, message, room))) return false;
    this.advance(key, message.seq);
    const row = this.live.get(key);
    if (row && row.messageId === message.id) await this.liveDelete(adapter, key, row);
    return true;
  }

  private async offerNamed(adapter: ChannelAdapter, key: string, room: Room, message: ChatMessage): Promise<void> {
    try {
      const full = fileScope(room, this.store.get().fileRoots, this.host.dataDir());
      const human = message.from === "human";
      const roomDir = realOf(room.dir);
      const scope = human ? full : { ...full, roots: full.roots.filter((root) => root.real === full.roomFiles || (roomDir !== null && root.real === roomDir)) };
      const touched = human ? new Set<string>() : touchedPaths(message);
      const seenNames = new Set<string>();
      const found = (await filesNamed(stripFenced(message.text), scope))
        .filter((f) => { const n = foldPath(basename(f.path)); if (seenNames.has(n)) return false; seenNames.add(n); return true; })
        .filter((f) => human || OFFER_NAMED_BY_VIBEMATES || touched.has(foldPath(f.path)));
      if (!found.length) return;
      const who = human ? "You" : escapeHtml(message.fromName);
      const lines = found.map((f) => {
        const wrote = !human && touched.has(foldPath(f.path));
        return `${who} ${wrote ? "wrote" : "named"} <b>${escapeHtml(basename(f.path))}</b>${wrote ? " in this reply" : ""} — in ${escapeHtml(folderWords(f.path, room, scope))}`;
      });
      const buttons = found.map((f) => [{ text: fileButtonLabel(f), data: this.button(key, { kind: "file", roomId: room.id, path: f.path }) }]);
      if (!(await this.sendWithRetry(adapter, key, chatIdOf(key), `${lines.join("\n")}${"\n"}Tap to send it to this phone.`, true, { buttons, silent: true }))) return;
    } catch (error) {
      this.log.warn(`files not offered to ${key}: ${describe(error)}`);
    }
  }

  private async sendMessage(adapter: ChannelAdapter, key: string, message: ChatMessage, room?: Room): Promise<boolean> {
    const rendered = renderForPhone(message)!;
    const chatId = chatIdOf(key);
    const pieces = splitText(rendered.body, Math.max(200, adapter.limits.text - rendered.prefix.length - 16));
    for (let i = 0; i < pieces.length; i++) {
      const prefix = pieces.length > 1 ? authorPrefix(message.fromName, i + 1, pieces.length) : rendered.prefix;
      const text = rendered.italic ? `<i>${pieces[i]}</i>` : `${prefix}${pieces[i]}`;
      if (!(await this.sendWithRetry(adapter, key, chatId, text, true))) return false;
    }
    if (room && adapter.capabilities.buttons && message.kind === "chat") await this.offerNamed(adapter, key, room, message);
    if (room && message.images?.length) {
      for (const image of message.images) {
        try {
          const data = readFileSync(room.imagePath(image));
          await adapter.sendFile(chatId, { name: image.name, data, mime: image.mimeType }, { photo: data.length <= adapter.limits.photo, silent: true });
        } catch (error) {
          this.log.warn(`picture ${image.file} not sent to ${key}: ${describe(error)}`);
        }
      }
    }
    return true;
  }

  private fellBehind(adapter: ChannelAdapter, key: string, room: Room): void {
    if (this.stopped) return;
    const entry = this.behind.get(key) ?? { attempts: 0, timer: null };
    if (!this.behind.has(key)) room.channelNotice(`A message could not be delivered to ${adapter.platform} (${key}); it stays owed and will be sent when the channel answers again.`, "warn");
    this.behind.set(key, entry);
    if (entry.timer) return;
    const delay = this.options.behindRetryMs[Math.min(entry.attempts, this.options.behindRetryMs.length - 1)];
    entry.attempts++;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (!this.stopped) this.enqueue(key, () => this.serve(adapter, key, true));
    }, delay);
    entry.timer.unref?.();
  }

  private caughtUp(key: string): void {
    const entry = this.behind.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.behind.delete(key);
  }

  private advance(key: string, seq: number): void {
    this.store.update((s) => {
      const b = s.bindings[key];
      if (b && b.cursorSeq < seq) b.cursorSeq = seq;
    });
  }

  private async sendWithRetry(adapter: ChannelAdapter, key: string, chatId: string, text: string, html: boolean, extra: { buttons?: Button[][]; silent?: boolean } = {}): Promise<boolean> {
    const delays = this.options.retryDelaysMs;
    for (let attempt = 0; ; attempt++) {
      if (this.stopped) return false;
      try {
        await adapter.send(chatId, text, { html, ...(extra.buttons?.length ? { buttons: extra.buttons } : {}), ...(extra.silent ? { silent: true } : {}) });
        await this.options.sleep(this.options.sendGapMs);
        return true;
      } catch (error) {
        if (attempt >= delays.length || this.stopped) {
          this.log.warn(`${adapter.platform}: message to ${key} not sent after ${attempt + 1} attempts: ${describe(error)}`);
          return false;
        }
        await this.options.sleep(delays[attempt]);
      }
    }
  }

  private reply(adapter: ChannelAdapter, ref: ChatRef, text: string, html = false, buttons?: Button[][]): Promise<void> {
    const key = chatKey(ref);
    return this.enqueue(key, async () => {
      await this.sendWithRetry(adapter, key, ref.chatId, text, html, { buttons });
    });
  }

  private enqueue(key: string, work: () => Promise<unknown>): Promise<void> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.then(work, work).catch((error) => this.log.error(`send chain ${key}: ${describe(error)}`)).then(() => undefined);
    this.chains.set(key, next);
    return next;
  }

  private adapterForKey(key: string): ChannelAdapter | undefined {
    for (const [k, adapter] of this.adapters) if (key.startsWith(`${k}:`)) return adapter;
    return undefined;
  }
}

const HELP = defuseMentions([
  "<b>This chat is a window into a viberoom room.</b>",
  "/rooms — the rooms you can open here",
  "/open &lt;name or number&gt; — attach this chat to a room (typed; /open alone lists them)",
  "/close — detach (the room stays as it is)",
  "/who — who is in the room; tap a name to mute it, stop it or bring it back",
  "/stop — stop the reply being written here; /stop @Name stops that vibemate",
  "/restart — restart viberoom on the computer; it waits for the vibemates to finish first",
  "/help — this",
  "Buttons under the bot's messages do what they say: open a room, show earlier messages, stop a vibemate, reconnect them.",
  "While a vibemate writes, its reply grows here; Stop under it stops that reply. The finished reply comes as its own message.",
  "A photo or a file you send here lands in the room. A file a message names gets a Send button when it is within reach; nothing leaves the computer without your press.",
  "Anything else you write goes to the open room as your message, @Name and /skill included, as it does on your computer.",
  "The guide, with pictures, is in viberoom on your computer: Settings → Channels → Guide.",
].join("\n"), { commands: false });

interface Rendered {
  prefix: string;
  body: string;
  italic: boolean;
}

export function renderForPhone(message: ChatMessage): Rendered | null {
  if (message.kind === "hidden") return null;
  if (message.kind === "system") {
    if (message.audience === "agents" || message.details?.about !== "room" || !message.text.trim()) return null;
    return { prefix: "", body: defuseMentions(escapeHtml(message.text)), italic: true };
  }
  const attachments = message.images?.length ? (message.text.trim() ? " [image]" : "[image]") : "";
  const body = markdownToTelegramHtml(message.text) + attachments;
  if (!body.trim()) return null;
  return { prefix: authorPrefix(message.fromName), body, italic: false };
}

interface LiveRow {
  roomId: string;
  messageId: string;
  participantId: string;
  fromName: string;
  text: string;
  sentText: string;
  shown: number;
  ending: boolean;
  revealed: (() => void) | null;
  waiting: boolean;
  platformMessageId: string;
  timer: NodeJS.Timeout | null;
  sending: boolean;
  done: boolean;
  stop: string;
}

const LIVE_TEXT_CAP = 3800;

interface WedgeCard {
  roomId: string;
  participantId: string;
  turnId: string;
  name: string;
  since: number;
  processAlive: boolean;
  nudge: "asking" | "answered" | "silent" | null;
  stopping: "asked" | "forcing" | null;
  sentText: string;
  platformMessageId: string;
  sending: boolean;
  ended: boolean;
  timer: NodeJS.Timeout | null;
  press: { nudge: string; stop: string; respawn: string };
}

function wedgeText(card: WedgeCard, now: number): string {
  const minutes = Math.max(0, Math.floor((now - card.since) / 60_000));
  const head = `<b>Nothing new from ${escapeHtml(card.name)} for ${minutes} minute${minutes === 1 ? "" : "s"}.</b>`;
  const detail = card.stopping === "forcing" ? "It is not yielding; its process is being replaced; it comes back by itself."
    : card.stopping === "asked" ? "Stopping…"
    : card.nudge === "asking" ? "Asking it for something that changes nothing…"
    : card.nudge === "answered" ? "It still answers — what is stuck is the request to the provider. Stop should work."
    : card.nudge === "silent" ? WEDGE_SILENT_LINE
    : card.processAlive ? "Its process is running, so it has not crashed — what is silent is the answer."
    : "Its process is gone; only a fresh start can bring it back.";
  return `${head} ${detail}`;
}

export const WEDGE_SILENT_LINE = "It does not answer. Stop replaces its process and keeps its session; Fresh start replaces it too and begins a new one.";

const REVEAL = {
  perEdit: 90,
  maxLagChars: 700,
  rushSteps: 3,
  waitCapMs: 30_000,
};

function liveAdvance(row: LiveRow): void {
  const waiting = row.text.length - row.shown;
  if (waiting <= 0) return;
  const step = waiting > REVEAL.maxLagChars
    ? Math.min(REVEAL.perEdit * REVEAL.rushSteps, waiting - REVEAL.maxLagChars + REVEAL.perEdit)
    : REVEAL.perEdit;
  row.shown = Math.min(row.text.length, row.shown + step);
}

function liveText(row: LiveRow): string {
  const whole = readableSoFar(row.text.slice(0, row.shown));
  const text = whole.length > LIVE_TEXT_CAP ? `${whole.slice(0, LIVE_TEXT_CAP)}…` : whole;
  return `${authorPrefix(row.fromName)}${defuseMentions(escapeHtml(text || "…"))}${row.waiting ? "\n<i>waiting for your permission in viberoom on your computer</i>" : ""}`;
}

const HOLD_BACK_CAP = 240;
const THOUGHT_END = /[.!?…:;][")'»”’\]]*(?=\s|$)|\n/g;

export function readableSoFar(text: string): string {
  if (!text) return text;
  let end = -1;
  for (const match of text.matchAll(THOUGHT_END)) end = match.index + match[0].length;
  if (end <= 0 || end >= text.length) return text;
  return text.length - end <= HOLD_BACK_CAP ? text.slice(0, end) : text;
}

function renderLine(message: ChatMessage): string {
  const r = renderForPhone(message)!;
  return r.italic ? `<i>${r.body}</i>` : `${r.prefix}${r.body}`;
}

function cameFrom(message: ChatMessage, key: string): boolean {
  return !!message.via && chatKey({ platform: message.via.platform as ChatRef["platform"], account: message.via.account, chatId: message.via.chatId, threadId: message.via.threadId }) === key;
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_-])`, "u").test(text);
}

function isReachable(room: Room): boolean {
  return (room.settings as { reachableFromMessengers?: boolean }).reachableFromMessengers !== false;
}

function roomName(room: Room): string {
  return room.settings.name;
}

function chatIdOf(key: string): string {
  return key.split(":")[2];
}

function pickRoom(reachable: Room[], all: Room[], query: string): Room | "hidden" | null {
  const n = Number(query);
  if (Number.isInteger(n) && n >= 1 && n <= reachable.length) return reachable[n - 1];
  const wanted = query.toLowerCase();
  const exact = reachable.find((r) => roomName(r).toLowerCase() === wanted) ?? reachable.find((r) => roomName(r).toLowerCase().startsWith(wanted));
  if (exact) return exact;
  if (all.some((r) => roomName(r).toLowerCase() === wanted)) return "hidden";
  return null;
}

export const STATUS_WORDS: Record<ParticipantStatus | "working" | "writing" | "notes", string> = {
  unstaffed: "not summoned yet",
  starting: "starting",
  idle: "listening",
  queued: "about to reply",
  thinking: "thinking",
  working: "vibing",
  writing: "vibing",
  notes: "taking notes",
  error: "in trouble",
  offline: "offline",
  left: "left",
};

function statusWords(room: Room, who: Participant): string {
  return who.muted ? "muted" : STATUS_WORDS[room.shownStatus(who.id)];
}

function roomLabel(room: Room): string {
  const emoji = (room.settings as { emoji?: string }).emoji;
  return `${emoji ? `${escapeHtml(emoji)} ` : ""}<b>${escapeHtml(roomName(room))}</b>`;
}

function roomTitle(room: Room): string {
  const emoji = (room.settings as { emoji?: string }).emoji;
  return `${emoji ? `${emoji} ` : ""}${roomName(room)}`;
}

function cancelTurn(room: Room, id: string, turnId?: string): "turn" | "queued" | "nothing" {
  try {
    return room.cancelTurn(id, turnId);
  } catch {
    return "nothing";
  }
}

interface FileScope {
  roots: { real: string; deep: boolean }[];
  roomFiles: string | null;
  hubData: string | null;
}

function fileScope(room: Room, roots: FileRoot[], dataDir: string): FileScope {
  const real = (folder: string | undefined): string | null => {
    if (!folder) return null;
    try {
      return realpathSync(folder);
    } catch {
      return null;
    }
  };
  const roomFiles = real(room.filesDir());
  const listed = roots.map((r) => ({ real: real(r.path), deep: r.subfolders })).filter((r): r is { real: string; deep: boolean } => !!r.real);
  return {
    roots: [{ real: roomFiles, deep: true }, { real: real(room.dir), deep: true }, ...listed].filter((r): r is { real: string; deep: boolean } => !!r.real),
    roomFiles,
    hubData: real(dataDir),
  };
}

function directlyIn(real: string, root: string): boolean {
  const parent = dirname(real);
  return process.platform === "linux" ? parent === root : parent.toLowerCase() === root.toLowerCase();
}

function realOf(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    try {
      return join(realpathSync(dirname(path)), basename(path));
    } catch {
      return null;
    }
  }
}

function withinReach(real: string, scope: FileScope): boolean {
  if (!scope.roots.some((root) => (root.deep ? inside(real, root.real) : directlyIn(real, root.real)))) return false;
  if (scope.hubData && inside(real, scope.hubData) && !(scope.roomFiles && inside(real, scope.roomFiles))) return false;
  return true;
}

const inside = pathInside;

const PATH_IN_TEXT = /(?:[A-Za-z]:\\[^\s"'<>|*?`]+|(?<![\w/])\/(?:[^\s"'<>|*?:`/]+\/)*[^\s"'<>|*?:`/]+\.[A-Za-z0-9]{1,8})/g;
const SPACED_PATH_IN_TEXT = /(?:[A-Za-z]:\\|(?<![\w/])\/)[^\r\n"'<>|*?`]*?\.[A-Za-z0-9]{1,8}(?=$|[\s,;:!?)\]"'»])/g;
const CODE_SPAN = /`([^`\n]+)`/g;
const LOOKS_LIKE_PATH = /^(?:[A-Za-z]:[\\/]|\/)[^\r\n"'<>|*?]+$/;

export function pathsNamed(text: string): string[] {
  const found: string[] = [];
  const prose = text.replace(CODE_SPAN, (whole, inner: string) => {
    const span = inner.trim();
    if (!LOOKS_LIKE_PATH.test(span)) return whole;
    found.push(span);
    return " ";
  });
  for (const raw of prose.match(SPACED_PATH_IN_TEXT) ?? []) found.push(raw);
  for (const raw of prose.match(PATH_IN_TEXT) ?? []) found.push(raw);
  return found;
}

const BARE_NAME = /(?<![\p{L}\p{N}_.\\/:@-])([\p{L}\p{N}_-]{1,64}\.[A-Za-z0-9]{1,8})(?![\p{L}\p{N}_\\/@-])/gu;

export function bareNames(text: string): string[] {
  let prose = text.replace(CODE_SPAN, (whole, inner: string) => (LOOKS_LIKE_PATH.test(inner.trim()) ? " " : whole));
  for (const raw of [...(prose.match(SPACED_PATH_IN_TEXT) ?? []), ...(prose.match(PATH_IN_TEXT) ?? [])]) prose = prose.split(raw).join(" ");
  const out: string[] = [];
  for (const m of prose.matchAll(BARE_NAME)) {
    const name = m[1];
    if (/^\d+\.\d+$/.test(name) || out.includes(name)) continue;
    out.push(name);
    if (out.length >= FILE_BUTTONS_PER_MESSAGE) break;
  }
  return out;
}

const SEARCH_LIMITS = { depth: 8, entries: 20000, ms: 500 };

async function findByName(name: string, scope: FileScope, limits = SEARCH_LIMITS): Promise<string[]> {
  const fold = (s: string): string => (process.platform === "linux" ? s : s.toLowerCase());
  const wanted = fold(name);
  const hits: string[] = [];
  let seen = 0;
  const deadline = Date.now() + limits.ms;
  const done = (): boolean => hits.length >= FILE_BUTTONS_PER_MESSAGE || seen > limits.entries || Date.now() > deadline;
  let level: { dir: string; deep: boolean }[] = scope.roots.map((root) => ({ dir: root.real, deep: root.deep }));
  for (let depth = 0; level.length && !done(); depth++) {
    const next: { dir: string; deep: boolean }[] = [];
    for (const { dir, deep } of level) {
      if (done()) break;
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (done()) break;
        seen++;
        const full = join(dir, entry.name);
        if (entry.isFile() && fold(entry.name) === wanted) {
          let real: string;
          try {
            real = realpathSync(full);
          } catch {
            continue;
          }
          if (withinReach(real, scope) && !hits.includes(real)) hits.push(real);
        } else if (deep && entry.isDirectory() && depth < limits.depth && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          next.push({ dir: full, deep: true });
        }
      }
    }
    level = next;
  }
  return hits;
}

interface NamedFile {
  path: string;
  byName: boolean;
}

function fileButtonLabel(f: NamedFile): string {
  return `📄 ${basename(f.path)}`;
}

function touchedPaths(message: ChatMessage): Set<string> {
  const out = new Set<string>();
  for (const call of message.toolCalls ?? []) {
    for (const path of call.locations ?? []) {
      const real = realOf(path);
      if (real) out.add(foldPath(real));
    }
  }
  return out;
}

function foldPath(path: string): string {
  return process.platform === "linux" ? path : path.toLowerCase();
}

function folderWords(path: string, room: Room, scope: FileScope): string {
  const dir = dirname(path);
  if (scope.roomFiles && (foldPath(dir) === foldPath(scope.roomFiles) || inside(dir, scope.roomFiles))) return "the room's files";
  const roomDir = realOf(room.dir);
  if (roomDir && (foldPath(dir) === foldPath(roomDir) || inside(dir, roomDir))) {
    const rel = relative(roomDir, dir).split(sep).filter(Boolean).join("/");
    return rel ? `${basename(roomDir)}/${rel}` : basename(roomDir);
  }
  return basename(dir) || dir;
}

function nameList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function stripFenced(text: string): string {
  return text.replace(FENCED, " ");
}
const FENCED = new RegExp("```[^]*?```", "g");

async function filesNamed(text: string, scope: FileScope): Promise<NamedFile[]> {
  const out: NamedFile[] = namedFiles(text, scope).map((path) => ({ path, byName: false }));
  for (const name of bareNames(text)) {
    if (out.length >= FILE_BUTTONS_PER_MESSAGE) break;
    for (const path of await findByName(name, scope)) {
      if (out.some((f) => f.path === path)) continue;
      out.push({ path, byName: true });
      if (out.length >= FILE_BUTTONS_PER_MESSAGE) break;
    }
  }
  return out;
}

function namedFiles(text: string, scope: FileScope): string[] {
  if (!scope.roots.length) return [];
  const out: string[] = [];
  for (const raw of pathsNamed(text)) {
    const candidate = splitLocation(raw.replace(/[.,;:)\]]+$/, "")).path;
    let real: string;
    try {
      real = realpathSync(resolve(candidate));
    } catch {
      continue;
    }
    if (out.includes(real) || !withinReach(real, scope)) continue;
    try {
      if (!statSync(real).isFile() || !existsSync(real)) continue;
    } catch {
      continue;
    }
    out.push(real);
    if (out.length >= FILE_BUTTONS_PER_MESSAGE) break;
  }
  return out;
}

function someoneWriting(room: Room): boolean {
  return [...room.participants.values()].some((p) => p.kind === "agent" && p.status === "thinking");
}

function vibemateCard(room: Room, who: Participant): string {
  const settings = vibemateSettings(who);
  const model = settings.find((s) => s.id === "model")?.shown ?? who.model;
  const mode = settings.find((s) => s.id === "mode");
  const bypass = getRecipe(who.agentType ?? "")?.bypassMode;
  const modeWords = !mode ? undefined
    : bypass && mode.value === bypass ? "does not ask before it acts"
    : mode.choices.find((c) => c.value === mode.value)?.description ?? mode.shown;
  const facts = [upperFirst(statusWords(room, who)), model, modeWords].filter(Boolean) as string[];
  const elsewhere = hasSettingsHere(who) ? "" : `Its settings are in viberoom on your computer, under Settings → ${escapeHtml(who.name)}.`;
  return [`<b>${escapeHtml(who.name)}</b>`, escapeHtml(facts.join(" · ")), elsewhere].filter(Boolean).join("\n");
}

function upperFirst(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function hasSettingsHere(who: Participant): boolean {
  return (who.status !== "offline" && who.status !== "unstaffed") || vibemateSettings(who).length > 0;
}

const ASK_TTL_MS = 15 * 60_000;
const DELAY_ID = "viberoom:delay";
const DELAY_CHOICES: number[] = [0, 2, 5, 10, 30];

function delayWords(own: number | undefined, roomDelay: number | undefined): string {
  const seconds = own ?? roomDelay ?? 0;
  const words = seconds ? `up to ${seconds} s` : "no wait";
  return own === undefined ? `${words}, as the room` : words;
}

function presetName(id: string): string {
  return upperFirst(id.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").toLowerCase());
}

function shorten(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}

interface VibemateSetting {
  id: string;
  name: string;
  description?: string;
  value: string | boolean;
  shown: string;
  choices: { value: string | boolean; name: string; description?: string }[];
}

function vibemateSettings(who: Participant): VibemateSetting[] {
  const out: VibemateSetting[] = [];
  const named = (id: string | boolean, choices: { value: string | boolean; name: string }[]): string => choices.find((c) => c.value === id)?.name ?? String(id);
  if (who.status === "offline" || who.status === "unstaffed") {
    const recipe = getRecipe(who.agentType ?? "");
    if (!recipe) return out;
    const presets: [string, string, string[], string | null | undefined][] = [
      ["model", "Model", recipe.modelPresets, who.launch?.model ?? who.model],
      ["mode", "Mode", recipe.modePresets, who.launch?.mode ?? who.mode],
      ["effort", "Effort", recipe.effortPresets, who.launch?.effort ?? who.effort],
    ];
    for (const [id, name, values, current] of presets) {
      if (!values.length) continue;
      const choices = values.map((v) => ({ value: v, name: presetName(v) }));
      out.push({ id, name, value: current ?? "", shown: current ? presetName(current) : "the agent's own", choices });
    }
    return out;
  }
  const hasModeOption = (who.configOptions ?? []).some((o) => o.category === "mode");
  if (!hasModeOption && who.modes?.length) {
    const choices = who.modes.map((m) => ({ value: m.id, name: m.name || m.id, ...(m.description ? { description: m.description } : {}) }));
    out.push({ id: "mode", name: "Mode", value: who.mode ?? "", shown: named(who.mode ?? "", choices), choices });
  }
  for (const option of who.configOptions ?? []) {
    if (option.type === "boolean") {
      const choices = [{ value: true, name: "On" }, { value: false, name: "Off" }];
      out.push({ id: option.id, name: option.name, ...(option.description ? { description: option.description } : {}), value: option.currentValue, shown: option.currentValue ? "On" : "Off", choices });
      continue;
    }
    const entries = (option.options ?? []) as (SessionConfigSelectOption | SessionConfigSelectGroup)[];
    const flat = entries.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
    const choices = flat
      .map((c) => ({ value: String(c.value ?? ""), name: c.name || String(c.value ?? ""), ...(c.description ? { description: String(c.description) } : {}) }))
      .filter((c) => c.value);
    if (!choices.length) continue;
    out.push({ id: option.id, name: option.name, ...(option.description ? { description: option.description } : {}), value: option.currentValue, shown: named(option.currentValue, choices), choices });
  }
  return out;
}

function presentAgents(room: Room): Participant[] {
  return [...room.participants.values()].filter((p) => p.kind === "agent" && p.status !== "left");
}

function whoHtml(room: Room): string {
  const agents = presentAgents(room);
  if (!agents.length) return "<i>No vibemates in the room yet.</i>";
  const face = (p: Participant): string => {
    const avatar = (p as { avatar?: string }).avatar;
    return avatar && !/^[A-Za-z0-9]/.test(avatar) ? `${escapeHtml(avatar)} ` : "";
  };
  return agents.map((p) => `${face(p)}<b>${escapeHtml(p.name)}</b> — ${statusWords(room, p)}`).join("\n");
}
