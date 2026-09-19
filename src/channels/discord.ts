// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Logger } from "../log.js";
import { authorOfPrefix, htmlToDiscord } from "./format.js";
import type { AdapterStatus, Button, Capabilities, ChannelAdapter, InboundFile, InboundMessage, InboundResult, OutboundFile, SendFileOptions, SendOptions } from "./types.js";

export interface DiscordOptions {
  token: string;
  apiBase?: string;
  log: Logger;
  fetch?: typeof fetch;
  makeSocket?: (url: string) => WebSocket;
  sleep?: (ms: number) => Promise<void>;
}

export class DiscordApiError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfterS?: number) {
    super(message);
  }
}

const API_BASE = "https://discord.com/api/v10";
const CALL_MS = 30_000;
const USER_AGENT = "DiscordBot (https://github.com/todorrusev/viberoom, 1.0)";
const INTENT_DIRECT_MESSAGES = 1 << 12;
const OP = { dispatch: 0, heartbeat: 1, identify: 2, resume: 6, reconnect: 7, invalidSession: 9, hello: 10, heartbeatAck: 11 } as const;
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const SUPPRESS_NOTIFICATIONS = 1 << 12;
const EPHEMERAL = 1 << 6;
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 15_000, 30_000];
const MIB = 1024 * 1024;

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
}

interface DiscordAttachment {
  id: string;
  filename?: string;
  size?: number;
  url: string;
  content_type?: string;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author?: DiscordUser;
  content?: string;
  attachments?: DiscordAttachment[];
  referenced_message?: { id: string; content?: string; author?: DiscordUser } | null;
}

interface DiscordInteraction {
  id: string;
  token: string;
  type: number;
  channel_id?: string;
  guild_id?: string;
  data?: { custom_id?: string; component_type?: number };
  message?: { id: string };
  user?: DiscordUser;
  member?: { user?: DiscordUser };
}

export class DiscordAdapter implements ChannelAdapter {
  readonly platform = "discord" as const;
  readonly capabilities: Capabilities = { drafts: false, richMarkdown: false, threads: false, buttons: true, editing: true, copyButtons: false };
  readonly limits = { text: 2000, file: 20 * MIB, photo: 20 * MIB, download: 20 * MIB };
  account = "";
  shownName = "";
  private botId = "";
  private readonly own = new Set<string>();
  private contested = false;
  private readonly token: string;
  private readonly apiBase: string;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly makeSocket: (url: string) => WebSocket;
  private readonly sleep: (ms: number) => Promise<void>;
  private handler: ((batch: InboundMessage[]) => Promise<InboundResult>) | null = null;
  private statusHandler: ((status: AdapterStatus) => void) | null = null;
  private running = false;
  private paused = false;
  private socket: WebSocket | null = null;
  private gatewayUrl = "";
  private resumeUrl: string | null = null;
  private sessionId: string | null = null;
  private seq: number | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private acked = true;
  private attempts = 0;
  private readonly queue: InboundMessage[] = [];
  private delivering = false;

  constructor(options: DiscordOptions) {
    this.token = options.token;
    this.apiBase = (options.apiBase ?? API_BASE).replace(/\/+$/, "");
    this.log = options.log;
    this.fetchImpl = options.fetch ?? fetch;
    this.makeSocket = options.makeSocket ?? ((url) => new WebSocket(url));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  onInbound(handler: (batch: InboundMessage[]) => Promise<InboundResult>): void {
    this.handler = handler;
  }

  onStatus(handler: (status: AdapterStatus) => void): void {
    this.statusHandler = handler;
  }

  async connect(): Promise<void> {
    const me = (await this.rest("GET", "/users/@me")) as DiscordUser;
    this.botId = me.id ?? "";
    this.account = me.username ?? "";
    this.shownName = me.global_name || me.username || "";
    const gateway = (await this.rest("GET", "/gateway/bot")) as { url?: string };
    this.gatewayUrl = gateway.url ?? "wss://gateway.discord.gg";
    this.running = true;
    this.paused = false;
    this.attempts = 0;
    this.statusHandler?.({ state: "connected", detail: `@${this.account}`, name: this.shownName });
    this.open(this.gatewayUrl, false);
  }

  async disconnect(): Promise<void> {
    this.running = false;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= 1) socket.close(1000);
    this.statusHandler?.({ state: "disconnected" });
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.statusHandler?.({ state: "paused" });
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.statusHandler?.({ state: "listening", detail: `@${this.account}`, name: this.shownName });
    void this.drain();
  }


  private open(url: string, resuming: boolean): void {
    const socket = this.makeSocket(`${url}${url.includes("?") ? "&" : "?"}v=10&encoding=json`);
    this.socket = socket;
    this.acked = true;
    socket.addEventListener("message", (event) => {
      let payload: GatewayPayload;
      try {
        payload = JSON.parse(String((event as MessageEvent).data)) as GatewayPayload;
      } catch {
        return;
      }
      this.onPayload(socket, payload, resuming);
    });
    socket.addEventListener("close", (event) => void this.onClose(socket, (event as CloseEvent).code));
    socket.addEventListener("error", () => {
    });
  }

  private sendPayload(socket: WebSocket, payload: GatewayPayload): void {
    if (socket.readyState !== 1) return;
    socket.send(JSON.stringify(payload));
  }

  private onPayload(socket: WebSocket, payload: GatewayPayload, resuming: boolean): void {
    if (typeof payload.s === "number") this.seq = payload.s;
    switch (payload.op) {
      case OP.hello: {
        const interval = Number((payload.d as { heartbeat_interval?: number })?.heartbeat_interval) || 41_250;
        this.startHeartbeat(socket, interval);
        if (resuming && this.sessionId) this.sendPayload(socket, { op: OP.resume, d: { token: this.token, session_id: this.sessionId, seq: this.seq } });
        else this.sendPayload(socket, { op: OP.identify, d: { token: this.token, intents: INTENT_DIRECT_MESSAGES, properties: { os: process.platform, browser: "viberoom", device: "viberoom" } } });
        return;
      }
      case OP.heartbeatAck:
        this.acked = true;
        return;
      case OP.heartbeat:
        this.sendPayload(socket, { op: OP.heartbeat, d: this.seq });
        return;
      case OP.reconnect:
        this.log.info("gateway asked to reconnect; resuming");
        this.closeToResume(socket);
        return;
      case OP.invalidSession:
        this.log.warn(`gateway: invalid session (resumable: ${payload.d === true})`);
        if (payload.d !== true) this.sessionId = null;
        void this.sleep(1000).then(() => this.closeToResume(socket));
        return;
      case OP.dispatch:
        this.onDispatch(payload.t ?? "", payload.d);
        return;
      default:
        return;
    }
  }

  private startHeartbeat(socket: WebSocket, interval: number): void {
    this.stopHeartbeat();
    const beat = (): void => {
      if (this.socket !== socket) return;
      if (!this.acked) {
        this.log.warn("gateway: no heartbeat ACK; the connection is a zombie, resuming");
        this.closeToResume(socket);
        return;
      }
      this.acked = false;
      this.sendPayload(socket, { op: OP.heartbeat, d: this.seq });
    };
    this.heartbeat = setTimeout(() => {
      beat();
      this.heartbeat = setInterval(beat, interval);
    }, Math.floor(interval * Math.random()));
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.heartbeat = null;
  }

  private closeToResume(socket: WebSocket): void {
    if (socket.readyState <= 1) socket.close(4000);
  }

  private async onClose(socket: WebSocket, code: number): Promise<void> {
    if (socket !== this.socket) return;
    this.stopHeartbeat();
    this.socket = null;
    if (!this.running) return;
    if (FATAL_CLOSE.has(code)) {
      const detail = code === 4004 ? "Discord did not accept the bot token" : `Discord closed the connection (${code})`;
      this.log.error(`gateway closed with ${code}: ${detail}; not asking again`);
      this.running = false;
      this.statusHandler?.({ state: "degraded", detail, name: this.shownName });
      return;
    }
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.attempts++, RECONNECT_BACKOFF_MS.length - 1)];
    this.log.warn(`gateway closed (${code}); ${this.sessionId ? "resuming" : "connecting again"} in ${delay} ms`);
    await this.sleep(delay);
    if (!this.running || this.socket) return;
    const resuming = !!this.sessionId;
    this.open(resuming && this.resumeUrl ? this.resumeUrl : this.gatewayUrl, resuming);
  }

  private onDispatch(type: string, data: unknown): void {
    if (type === "READY") {
      const ready = data as { session_id?: string; resume_gateway_url?: string };
      this.sessionId = ready.session_id ?? null;
      this.resumeUrl = ready.resume_gateway_url ?? null;
      this.attempts = 0;
      this.statusHandler?.({ state: "listening", detail: `@${this.account}`, name: this.shownName });
      return;
    }
    if (type === "RESUMED") {
      this.attempts = 0;
      this.log.info("gateway resumed: what was missed came back");
      this.statusHandler?.({ state: "listening", detail: `@${this.account}`, name: this.shownName });
      return;
    }
    if (type === "MESSAGE_CREATE" && this.isAnotherComputer(data as DiscordMessage)) return;
    const inbound = type === "MESSAGE_CREATE" ? messageToInbound(data as DiscordMessage, this.account) : type === "INTERACTION_CREATE" ? interactionToInbound(data as DiscordInteraction, this.account) : null;
    if (!inbound) return;
    this.queue.push(inbound);
    void this.drain();
  }

  private isAnotherComputer(m: DiscordMessage): boolean {
    if (!m?.author || m.author.id !== this.botId) return false;
    if (this.own.has(m.id) || this.contested) return true;
    this.contested = true;
    this.log.warn("a message from this bot's account that this hub did not send: another computer answers on the same bot");
    this.statusHandler?.({ state: "contested", detail: "another computer answers on this bot too", name: this.shownName });
    return true;
  }

  private remember(id: string): void {
    this.own.add(id);
    if (this.own.size > 1000) this.own.delete(this.own.values().next().value as string);
  }

  private async drain(): Promise<void> {
    if (this.delivering || this.paused || !this.handler) return;
    this.delivering = true;
    try {
      while (this.queue.length && !this.paused && this.running) {
        const batch = this.queue.splice(0);
        let result: InboundResult;
        try {
          result = await this.handler(batch);
        } catch (error) {
          this.log.warn(`inbound batch not taken: ${this.redact(describe(error))}`);
          this.queue.unshift(...batch);
          break;
        }
        if (result.acked < batch.length) this.queue.unshift(...batch.slice(Math.max(0, result.acked)));
        if (result.pause) {
          this.pause();
          break;
        }
      }
    } finally {
      this.delivering = false;
    }
  }


  async send(chatId: string, text: string, options: SendOptions = {}): Promise<{ messageId: string }> {
    const body: Record<string, unknown> = {
      content: options.html ? htmlToDiscord(text) : text,
      allowed_mentions: { parse: [] },
      ...(options.silent ? { flags: SUPPRESS_NOTIFICATIONS } : {}),
      ...(options.replyTo ? { message_reference: { message_id: options.replyTo, fail_if_not_exists: false } } : {}),
      ...(options.buttons?.length ? { components: componentRows(options.buttons) } : {}),
    };
    const sent = (await this.rest("POST", `/channels/${chatId}/messages`, body)) as { id: string };
    this.remember(sent.id);
    return { messageId: sent.id };
  }

  async sendTyping(chatId: string): Promise<void> {
    await this.rest("POST", `/channels/${chatId}/typing`);
  }

  async answerButton(callbackId: string, text?: string): Promise<void> {
    const at = callbackId.indexOf(":");
    const id = callbackId.slice(0, at);
    const token = callbackId.slice(at + 1);
    await this.rest("POST", `/interactions/${id}/${token}/callback`, text ? { type: 4, data: { content: text, flags: EPHEMERAL, allowed_mentions: { parse: [] } } } : { type: 6 });
  }

  async editMessage(chatId: string, messageId: string, text: string, options: SendOptions = {}): Promise<void> {
    await this.rest("PATCH", `/channels/${chatId}/messages/${messageId}`, {
      content: options.html ? htmlToDiscord(text) : text,
      allowed_mentions: { parse: [] },
      components: options.buttons?.length ? componentRows(options.buttons) : [],
    });
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    await this.rest("DELETE", `/channels/${chatId}/messages/${messageId}`);
  }

  async downloadFile(file: InboundFile): Promise<{ data: Buffer; name?: string; mime?: string }> {
    const response = await this.fetchImpl(file.fileId, { signal: AbortSignal.timeout(CALL_MS) });
    if (!response.ok) throw new Error(`the attachment could not be fetched (${response.status})`);
    return { data: Buffer.from(await response.arrayBuffer()), name: file.name, mime: file.mime };
  }

  async sendFile(chatId: string, file: OutboundFile, options: SendFileOptions = {}): Promise<{ messageId: string }> {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: options.caption ?? "", attachments: [{ id: 0, filename: file.name }], allowed_mentions: { parse: [] }, ...(options.silent ? { flags: SUPPRESS_NOTIFICATIONS } : {}) }));
    form.append("files[0]", new Blob([new Uint8Array(file.data)], { type: file.mime ?? "application/octet-stream" }), file.name);
    const sent = (await this.rest("POST", `/channels/${chatId}/messages`, undefined, form)) as { id: string };
    this.remember(sent.id);
    return { messageId: sent.id };
  }


  private async rest(method: string, path: string, body?: Record<string, unknown>, form?: FormData): Promise<unknown> {
    const request = (): Promise<Response> =>
      this.fetchImpl(`${this.apiBase}${path}`, {
        method,
        headers: { Authorization: `Bot ${this.token}`, "User-Agent": USER_AGENT, ...(form ? {} : { "content-type": "application/json" }) },
        body: form ?? (body ? JSON.stringify(body) : undefined),
        signal: AbortSignal.timeout(CALL_MS),
      });
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      throw new Error(this.redact(describe(error)));
    }
    if (response.status === 429) {
      const parsed = await response.json().catch(() => ({})) as { retry_after?: number; message?: string };
      const wait = Math.min(Number(parsed.retry_after) || 1, 60);
      await this.sleep(wait * 1000);
      response = await request();
    }
    if (response.status === 204) return null;
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const message = (json as { message?: string } | null)?.message ?? `Discord answered ${response.status}`;
      throw new DiscordApiError(response.status, this.redact(message), (json as { retry_after?: number } | null)?.retry_after);
    }
    return json;
  }

  private redact(text: string): string {
    return this.token ? text.split(this.token).join("<token>") : text;
  }
}

function componentRows(buttons: Button[][]): unknown[] {
  return buttons.slice(0, 5).map((row) => ({ type: 1, components: row.slice(0, 5).map((b, i) => ({ type: 2, style: i === 0 ? 1 : 2, label: b.text.slice(0, 80), custom_id: b.data.slice(0, 100) })) }));
}

export function messageToInbound(m: DiscordMessage, account: string): InboundMessage | null {
  if (!m || m.guild_id || !m.author || m.author.bot) return null;
  const first = m.attachments?.[0];
  const file: InboundFile | undefined = first
    ? { kind: first.content_type?.startsWith("image/") ? "photo" : "document", fileId: first.url, name: first.filename, mime: first.content_type, size: first.size }
    : undefined;
  const text = m.content ?? "";
  const quoted = quotedAuthor(m.referenced_message);
  return {
    ref: { platform: "discord", account, chatId: m.channel_id },
    senderId: m.author.id,
    senderName: m.author.global_name || m.author.username || m.author.id,
    updateId: m.id,
    messageId: m.id,
    text,
    replyTo: m.referenced_message?.id,
    ...(quoted.author ? { replyToAuthor: quoted.author } : {}),
    ...(quoted.unread ? { replyToUnread: quoted.unread } : {}),
    attachment: file ? file.kind : !text ? "other" : undefined,
    ...(file ? { file } : {}),
  };
}

function quotedAuthor(q: DiscordMessage["referenced_message"]): { author?: string; unread?: string } {
  if (!q?.author?.bot) return {};
  if (!q.content) return { unread: "it came without its content" };
  const bold = /^\*\*([^*\n]+)\*\* /.exec(q.content);
  if (!bold) return { unread: "it came with no bold head" };
  const author = authorOfPrefix(bold[1]);
  return author ? { author } : { unread: `its bold head is not a name: "${bold[1]}"` };
}

export function interactionToInbound(i: DiscordInteraction, account: string): InboundMessage | null {
  if (!i || i.type !== 3 || i.guild_id || !i.channel_id) return null;
  const user = i.user ?? i.member?.user;
  if (!user || user.bot) return null;
  return {
    ref: { platform: "discord", account, chatId: i.channel_id },
    senderId: user.id,
    senderName: user.global_name || user.username || user.id,
    updateId: i.id,
    messageId: i.message?.id ?? i.id,
    text: "",
    button: { callbackId: `${i.id}:${i.token}`, data: i.data?.custom_id ?? "" },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
