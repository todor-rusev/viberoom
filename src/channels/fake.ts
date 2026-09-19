// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { AdapterStatus, Button, Capabilities, ChannelAdapter, InboundFile, InboundMessage, InboundResult, OutboundFile, Platform, SendFileOptions, SendOptions } from "./types.js";

export interface SentRecord {
  chatId: string;
  text: string;
  options?: SendOptions;
  messageId: string;
}

export class FakeAdapter implements ChannelAdapter {
  readonly platform: Platform = "telegram";
  readonly capabilities: Capabilities = { drafts: false, richMarkdown: false, threads: false, buttons: true, editing: true, copyButtons: true };
  readonly limits: { text: number; file: number; photo: number; download: number };
  readonly sent: SentRecord[] = [];
  readonly files: { chatId: string; name: string; data: Buffer; mime?: string; options?: SendFileOptions; messageId: string }[] = [];
  readonly held = new Map<string, { data: Buffer; name?: string; mime?: string }>();
  readonly typing: string[] = [];
  readonly answered: { callbackId: string; text?: string }[] = [];
  readonly edits: { chatId: string; messageId: string; text: string; options?: SendOptions }[] = [];
  readonly deleted: { chatId: string; messageId: string }[] = [];
  readonly calls: string[] = [];
  readonly statuses: AdapterStatus[] = [];
  connected = false;
  paused = false;
  failSends: string | null = null;
  private handler: ((batch: InboundMessage[]) => Promise<InboundResult>) | null = null;
  private statusHandler: ((status: AdapterStatus) => void) | null = null;
  private nextMessageId = 1;

  constructor(readonly account = "fakebot", limit = 4096) {
    this.limits = { text: limit, file: 50 * 1024 * 1024, photo: 10 * 1024 * 1024, download: 20 * 1024 * 1024 };
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.statusHandler?.({ state: "connected" });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.statusHandler?.({ state: "disconnected" });
  }

  async send(chatId: string, text: string, options?: SendOptions): Promise<{ messageId: string }> {
    if (this.failSends) throw new Error(this.failSends);
    const messageId = String(this.nextMessageId++);
    this.sent.push({ chatId, text, options, messageId });
    this.calls.push("send");
    return { messageId };
  }

  async editMessage(chatId: string, messageId: string, text: string, options?: SendOptions): Promise<void> {
    this.edits.push({ chatId, messageId, text, options });
    this.calls.push("edit");
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    this.deleted.push({ chatId, messageId });
    this.calls.push("delete");
  }

  async downloadFile(file: InboundFile): Promise<{ data: Buffer; name?: string; mime?: string }> {
    const held = this.held.get(file.fileId);
    if (!held) throw new Error(`no such file on the platform: ${file.fileId}`);
    return held;
  }

  async sendFile(chatId: string, file: OutboundFile, options?: SendFileOptions): Promise<{ messageId: string }> {
    if (this.failSends) throw new Error(this.failSends);
    const messageId = String(this.nextMessageId++);
    this.files.push({ chatId, name: file.name, data: file.data, mime: file.mime, options, messageId });
    this.calls.push("file");
    return { messageId };
  }

  async sendTyping(chatId: string): Promise<void> {
    this.typing.push(chatId);
  }

  async answerButton(callbackId: string, text?: string): Promise<void> {
    this.answered.push({ callbackId, text });
  }

  buttonsTo(chatId: string): Button[] {
    const last = this.sent.filter((s) => s.chatId === chatId).at(-1);
    return (last?.options?.buttons ?? []).flat();
  }

  onInbound(handler: (batch: InboundMessage[]) => Promise<InboundResult>): void {
    this.handler = handler;
  }

  onStatus(handler: (status: AdapterStatus) => void): void {
    this.statusHandler = handler;
  }

  pause(): void {
    this.paused = true;
    this.statusHandler?.({ state: "paused" });
  }

  resume(): void {
    this.paused = false;
    this.statusHandler?.({ state: "connected" });
  }

  deliver(batch: InboundMessage[]): Promise<InboundResult> {
    if (!this.handler) throw new Error("no inbound handler: attach the adapter to a router first");
    return this.handler(batch);
  }

  textsTo(chatId: string): string[] {
    return this.sent.filter((s) => s.chatId === chatId).map((s) => s.text);
  }
}

export function pressed(n: number, data: string, extra: { chatId?: string; senderId?: string } = {}): InboundMessage {
  return { ...inbound(n, "", extra), button: { callbackId: `cb${n}`, data } };
}

export function inbound(n: number, text: string, extra: Partial<InboundMessage> & { chatId?: string; senderId?: string } = {}): InboundMessage {
  const { chatId = "chat1", senderId = "owner", ...rest } = extra;
  return {
    ref: { platform: "telegram", account: "fakebot", chatId },
    senderId,
    senderName: senderId === "owner" ? "Owner" : "Someone",
    updateId: String(n),
    messageId: String(1000 + n),
    text,
    ...rest,
  };
}
