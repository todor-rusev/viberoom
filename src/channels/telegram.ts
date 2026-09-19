// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Logger } from "../log.js";
import { authorOfPrefix } from "./format.js";
import { BOT_COMMANDS } from "./router.js";
import type { AdapterStatus, Button, Capabilities, ChannelAdapter, InboundFile, InboundMessage, InboundResult, OutboundFile, Platform, SendFileOptions, SendOptions } from "./types.js";

export interface TelegramOptions {
  token: string;
  apiBase?: string;
  name?: string;
  log: Logger;
  fetch?: typeof fetch;
  pollTimeoutS?: number;
  listenAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class TelegramApiError extends Error {
  constructor(readonly code: number, description: string, readonly retryAfterS?: number) {
    super(description);
  }
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    message_thread_id?: number;
    from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
    chat: { id: number; type: string };
    text?: string;
    caption?: string;
    photo?: { file_id: string; file_size?: number; width?: number; height?: number }[];
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    reply_to_message?: { message_id: number; text?: string; entities?: { type: string; offset: number; length: number }[]; from?: { id: number; is_bot?: boolean } };
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string; is_bot?: boolean };
    message?: { message_id: number; message_thread_id?: number; chat: { id: number; type: string } };
    data?: string;
  };
}

const NETWORK_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];
const CONFLICT_TRIES = 6;
const CONFLICT_RETRY_MS = 5000;
const BOT_DESCRIPTION = "The phone window into your viberoom rooms on one computer. What you write here reaches the room you open; what the vibemates answer comes back here. It is private: it answers only the Telegram account paired from viberoom on that computer. Open the pairing link from there, then send /rooms.";
const BOT_SHORT_DESCRIPTION = "Private phone window into viberoom on one computer. Pair it from viberoom on that computer.";

const LISTEN_AFTER_MS = 3000;

export class TelegramAdapter implements ChannelAdapter {
  readonly platform: Platform = "telegram";
  readonly capabilities: Capabilities = { drafts: false, richMarkdown: false, threads: false, buttons: true, editing: true, copyButtons: true };
  readonly limits = { text: 4096, file: 50 * 1024 * 1024, photo: 10 * 1024 * 1024, download: 20 * 1024 * 1024 };
  account = "";
  private readonly token: string;
  private readonly apiBase: string;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly pollTimeoutS: number;
  private readonly listenAfterMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly wantedName: string | undefined;
  shownName = "";
  private handler: ((batch: InboundMessage[]) => Promise<InboundResult>) | null = null;
  private statusHandler: ((status: AdapterStatus) => void) | null = null;
  private offset = 0;
  private running = false;
  private paused = false;
  private wake: (() => void) | null = null;
  private inFlight: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private lineOwed = false;
  private lineTimer: NodeJS.Timeout | null = null;

  constructor(options: TelegramOptions) {
    this.token = options.token;
    this.apiBase = (options.apiBase ?? "https://api.telegram.org").replace(/\/+$/, "");
    this.log = options.log;
    this.fetchImpl = options.fetch ?? fetch;
    this.pollTimeoutS = options.pollTimeoutS ?? 50;
    this.listenAfterMs = options.listenAfterMs ?? LISTEN_AFTER_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.wantedName = options.name?.trim().slice(0, 64) || undefined;
  }

  onInbound(handler: (batch: InboundMessage[]) => Promise<InboundResult>): void {
    this.handler = handler;
  }

  onStatus(handler: (status: AdapterStatus) => void): void {
    this.statusHandler = handler;
  }

  async connect(): Promise<void> {
    const me = (await this.call("getMe")) as { username?: string; first_name?: string };
    this.account = me.username ?? "";
    this.shownName = me.first_name ?? "";
    if (this.wantedName && this.wantedName !== this.shownName) {
      try {
        await this.call("setMyName", { name: this.wantedName });
        this.shownName = this.wantedName;
      } catch (error) {
        this.log.warn(`bot name not set: ${this.redact(describe(error))}`);
      }
    }
    await this.ensureProfileText("getMyDescription", "setMyDescription", "description", BOT_DESCRIPTION);
    await this.ensureProfileText("getMyShortDescription", "setMyShortDescription", "short_description", BOT_SHORT_DESCRIPTION);
    await this.call("setMyCommands", { commands: BOT_COMMANDS });
    this.running = true;
    this.paused = false;
    this.lineOwed = true;
    this.loop = this.pollLoop();
    this.statusHandler?.({ state: "connected", detail: `@${this.account}`, name: this.shownName });
  }

  private async ensureProfileText(getter: string, setter: string, field: string, wanted: string): Promise<void> {
    try {
      const current = (await this.call(getter)) as Record<string, string | undefined>;
      if ((current[field] ?? "") === wanted) return;
      await this.call(setter, { [field]: wanted });
    } catch (error) {
      this.log.warn(`bot ${field.replace("_", " ")} not set: ${this.redact(describe(error))}`);
    }
  }

  async disconnect(): Promise<void> {
    this.running = false;
    this.clearLineTimer();
    this.inFlight?.abort();
    this.wake?.();
    await this.loop;
    this.loop = null;
    this.statusHandler?.({ state: "disconnected" });
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.clearLineTimer();
    this.lineOwed = true;
    this.inFlight?.abort();
    this.statusHandler?.({ state: "paused" });
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lineOwed = true;
    this.wake?.();
    this.statusHandler?.({ state: "connected" });
  }

  async send(chatId: string, text: string, options: SendOptions = {}): Promise<{ messageId: string }> {
    const params: Record<string, unknown> = { chat_id: chatId, text };
    if (options.html) params.parse_mode = "HTML";
    if (options.replyTo) params.reply_parameters = { message_id: Number(options.replyTo) };
    if (options.threadId) params.message_thread_id = Number(options.threadId);
    if (options.buttons?.length) params.reply_markup = { inline_keyboard: options.buttons.map((row) => row.map(inlineButton)) };
    else if (options.forceReply) params.reply_markup = { force_reply: true, ...(options.forceReply.placeholder ? { input_field_placeholder: options.forceReply.placeholder.slice(0, 64) } : {}) };
    if (options.silent) params.disable_notification = true;
    try {
      const sent = (await this.call("sendMessage", params)) as { message_id: number };
      return { messageId: String(sent.message_id) };
    } catch (error) {
      if (options.html && error instanceof TelegramApiError && error.code === 400 && /parse|entit|tag/i.test(error.message)) {
        const plain = (await this.call("sendMessage", { ...params, parse_mode: undefined, text: stripTags(text) })) as { message_id: number };
        return { messageId: String(plain.message_id) };
      }
      throw error;
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action: "typing" });
  }

  async answerButton(callbackId: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
  }

  async editMessage(chatId: string, messageId: string, text: string, options: SendOptions = {}): Promise<void> {
    const params: Record<string, unknown> = { chat_id: chatId, message_id: Number(messageId), text };
    if (options.html) params.parse_mode = "HTML";
    if (options.buttons?.length) params.reply_markup = { inline_keyboard: options.buttons.map((row) => row.map(inlineButton)) };
    try {
      await this.call("editMessageText", params);
    } catch (error) {
      if (error instanceof TelegramApiError && error.code === 400 && /not modified/i.test(error.message)) return;
      if (options.html && error instanceof TelegramApiError && error.code === 400 && /parse|entit|tag/i.test(error.message)) {
        await this.call("editMessageText", { ...params, parse_mode: undefined, text: stripTags(text) });
        return;
      }
      throw error;
    }
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    await this.call("deleteMessage", { chat_id: chatId, message_id: Number(messageId) });
  }

  async downloadFile(file: InboundFile): Promise<{ data: Buffer; name?: string; mime?: string }> {
    const info = (await this.call("getFile", { file_id: file.fileId })) as { file_path?: string; file_size?: number };
    if (!info.file_path) throw new Error("the platform gave no path for the file");
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBase}/file/bot${this.token}/${info.file_path}`, { signal: this.deadline(false) });
    } catch (error) {
      throw new Error(this.redact(describe(error)));
    }
    if (!response.ok) throw new Error(`the file could not be fetched (${response.status})`);
    const data = Buffer.from(await response.arrayBuffer());
    return { data, name: file.name ?? info.file_path.split("/").pop(), mime: file.mime };
  }

  async sendFile(chatId: string, file: OutboundFile, options: SendFileOptions = {}): Promise<{ messageId: string }> {
    const form = new FormData();
    form.set("chat_id", chatId);
    if (options.caption) form.set("caption", options.caption.slice(0, 1024));
    if (options.silent) form.set("disable_notification", "true");
    form.set(options.photo ? "photo" : "document", new Blob([new Uint8Array(file.data)], { type: file.mime || "application/octet-stream" }), file.name);
    const sent = (await this.call(options.photo ? "sendPhoto" : "sendDocument", form)) as { message_id: number };
    return { messageId: String(sent.message_id) };
  }


  private async pollLoop(): Promise<void> {
    let failures = 0;
    let conflicts = 0;
    while (this.running) {
      if (this.paused) {
        await new Promise<void>((resolve) => { this.wake = resolve; });
        this.wake = null;
        continue;
      }
      let updates: TelegramUpdate[];
      try {
        this.watchLine();
        updates = (await this.call("getUpdates", { offset: this.offset, timeout: this.pollTimeoutS, allowed_updates: ["message", "callback_query"] }, { longPoll: true })) as TelegramUpdate[];
        failures = 0;
        conflicts = 0;
        this.lineHeld();
      } catch (error) {
        this.clearLineTimer();
        if (!this.running) break;
        if (error instanceof TelegramApiError && error.code === 409) {
          conflicts++;
          this.lineOwed = true;
          if (conflicts === 1) this.statusHandler?.({ state: "checking", detail: "another program answered for this bot; checking whether it lets go", name: this.shownName });
          if (conflicts < CONFLICT_TRIES) {
            this.log.warn(`another program is polling this bot (409); try ${conflicts} of ${CONFLICT_TRIES - 1}, again in ${CONFLICT_RETRY_MS / 1000} s`);
            await this.sleep(CONFLICT_RETRY_MS);
            continue;
          }
          this.log.error("another program is polling this bot (409) and did not let go: this hub stops asking Telegram for updates");
          this.statusHandler?.({ state: "degraded", detail: "another computer is listening to this bot", name: this.shownName });
          this.running = false;
          break;
        }
        if ((error as Error).name === "AbortError") continue;
        const delay = NETWORK_BACKOFF_MS[Math.min(failures++, NETWORK_BACKOFF_MS.length - 1)];
        this.log.warn(`getUpdates failed (${this.redact(describe(error))}); again in ${delay} ms`);
        await this.sleep(delay);
        continue;
      }
      if (!updates.length) continue;
      const batch = updates.map(toInbound).filter((m): m is InboundMessage => !!m).map((m) => ({ ...m, ref: { ...m.ref, account: this.account } }));
      if (!batch.length) {
        this.offset = updates[updates.length - 1].update_id + 1;
        continue;
      }
      const result = this.handler ? await this.handler(batch) : { acked: batch.length, pause: false };
      if (result.acked > 0) {
        const last = batch[result.acked - 1];
        this.offset = Number(last.updateId) + 1;
        const next = result.acked < batch.length ? Number(batch[result.acked].updateId) : Number.POSITIVE_INFINITY;
        for (const u of updates) if (u.update_id >= this.offset && u.update_id < next && !batch.some((m) => Number(m.updateId) === u.update_id)) this.offset = u.update_id + 1;
      }
      if (result.pause) this.pause();
    }
  }

  private watchLine(): void {
    if (!this.lineOwed || this.lineTimer) return;
    this.lineTimer = setTimeout(() => this.lineHeld(), this.listenAfterMs);
    this.lineTimer.unref();
  }

  private lineHeld(): void {
    this.clearLineTimer();
    if (!this.lineOwed || !this.running || this.paused) return;
    this.lineOwed = false;
    this.statusHandler?.({ state: "listening", detail: `@${this.account}`, name: this.shownName });
  }

  private clearLineTimer(): void {
    if (this.lineTimer) clearTimeout(this.lineTimer);
    this.lineTimer = null;
  }


  private deadline(longPoll: boolean): AbortSignal {
    return AbortSignal.timeout(longPoll ? (this.pollTimeoutS + 15) * 1000 : 30_000);
  }

  private async call(method: string, params: Record<string, unknown> | FormData = {}, { longPoll = false } = {}): Promise<unknown> {
    const controller = new AbortController();
    if (longPoll) this.inFlight = controller;
    let response: Response;
    const form = params instanceof FormData;
    try {
      response = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, {
        method: "POST",
        ...(form ? { body: params } : { headers: { "content-type": "application/json" }, body: JSON.stringify(params) }),
        signal: AbortSignal.any([controller.signal, this.deadline(longPoll)]),
      });
    } catch (error) {
      if (longPoll) this.inFlight = null;
      const wrapped = new Error(this.redact(describe(error)));
      wrapped.name = (error as Error).name;
      throw wrapped;
    }
    if (longPoll) this.inFlight = null;
    let json: { ok: boolean; result?: unknown; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    try {
      json = (await response.json()) as typeof json;
    } catch {
      throw new TelegramApiError(response.status, `Bot API answered ${response.status} without a JSON body`);
    }
    if (json.ok) return json.result;
    const error = new TelegramApiError(json.error_code ?? response.status, this.redact(json.description ?? "unknown error"), json.parameters?.retry_after);
    if (error.code === 429 && error.retryAfterS !== undefined && !longPoll) {
      await this.sleep(Math.min(error.retryAfterS, 60) * 1000);
      const again = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, { method: "POST", ...(form ? { body: params } : { headers: { "content-type": "application/json" }, body: JSON.stringify(params) }), signal: this.deadline(false) });
      const retried = (await again.json()) as typeof json;
      if (retried.ok) return retried.result;
      throw new TelegramApiError(retried.error_code ?? again.status, this.redact(retried.description ?? "unknown error"), retried.parameters?.retry_after);
    }
    throw error;
  }

  private redact(text: string): string {
    return this.token ? text.split(this.token).join("<token>") : text;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function inlineButton(b: Button): Record<string, unknown> {
  return b.copy ? { text: b.text, copy_text: { text: b.copy.slice(0, 256) } } : { text: b.text, callback_data: b.data };
}

export function toInbound(update: TelegramUpdate): InboundMessage | null {
  const cq = update.callback_query;
  if (cq) {
    if (!cq.message || cq.message.chat.type !== "private" || cq.from.is_bot) return null;
    return {
      ref: { platform: "telegram", account: "", chatId: String(cq.message.chat.id), threadId: cq.message.message_thread_id ? String(cq.message.message_thread_id) : undefined },
      senderId: String(cq.from.id),
      senderName: cq.from.first_name ?? cq.from.username ?? String(cq.from.id),
      updateId: String(update.update_id),
      messageId: String(cq.message.message_id),
      text: "",
      button: { callbackId: cq.id, data: cq.data ?? "" },
    };
  }
  const m = update.message;
  if (!m || m.chat.type !== "private" || !m.from || m.from.is_bot) return null;
  const text = m.text ?? m.caption ?? "";
  const attachment = m.photo ? "photo" : m.document ? "document" : !m.text && !m.caption ? "other" : undefined;
  const largest = m.photo?.length ? m.photo[m.photo.length - 1] : undefined;
  const file: InboundFile | undefined = largest
    ? { kind: "photo", fileId: largest.file_id, mime: "image/jpeg", size: largest.file_size }
    : m.document ? { kind: "document", fileId: m.document.file_id, name: m.document.file_name, mime: m.document.mime_type, size: m.document.file_size } : undefined;
  const quoted = quotedAuthor(m.reply_to_message);
  return {
    ref: { platform: "telegram", account: "", chatId: String(m.chat.id), threadId: m.message_thread_id ? String(m.message_thread_id) : undefined },
    senderId: String(m.from.id),
    senderName: m.from.first_name ?? m.from.username ?? String(m.from.id),
    updateId: String(update.update_id),
    messageId: String(m.message_id),
    text,
    replyTo: m.reply_to_message ? String(m.reply_to_message.message_id) : undefined,
    ...(quoted.author ? { replyToAuthor: quoted.author } : {}),
    ...(quoted.unread ? { replyToUnread: quoted.unread } : {}),
    attachment,
    ...(file ? { file } : {}),
  };
}

type Quoted = NonNullable<NonNullable<TelegramUpdate["message"]>["reply_to_message"]>;
function quotedAuthor(q: Quoted | undefined): { author?: string; unread?: string } {
  if (!q?.from?.is_bot) return {};
  if (!q.text) return { unread: "it came without its text" };
  const bold = q.entities?.find((e) => e.type === "bold" && e.offset === 0);
  const kinds = (q.entities ?? []).map((e) => `${e.type}@${e.offset}`).join(", ") || "none";
  if (!bold) return { unread: `it came with no bold head (entities: ${kinds})` };
  const head = q.text.slice(0, bold.length);
  const author = authorOfPrefix(head);
  return author ? { author } : { unread: `its bold head is not a name: "${head}"` };
}
