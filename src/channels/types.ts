// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export type Platform = "telegram" | "discord";

export interface ChatRef {
  platform: Platform;
  account: string;
  chatId: string;
  threadId?: string;
}

export function chatKey(ref: ChatRef): string {
  return `${ref.platform}:${ref.account}:${ref.chatId}${ref.threadId ? `:${ref.threadId}` : ""}`;
}

export function acceptKey(ref: ChatRef, updateId: string): string {
  return `${ref.platform}:${ref.account}:${ref.chatId}:${updateId}`;
}

export interface InboundMessage {
  ref: ChatRef;
  senderId: string;
  senderName: string;
  updateId: string;
  messageId: string;
  text: string;
  replyTo?: string;
  replyToAuthor?: string;
  replyToUnread?: string;
  attachment?: "photo" | "document" | "other";
  file?: InboundFile;
  button?: { callbackId: string; data: string };
}

export interface InboundFile {
  kind: "photo" | "document";
  fileId: string;
  name?: string;
  mime?: string;
  size?: number;
}

export interface OutboundFile {
  name: string;
  data: Buffer;
  mime?: string;
}

export interface SendFileOptions {
  caption?: string;
  photo?: boolean;
  silent?: boolean;
}

export interface Button {
  text: string;
  data: string;
  copy?: string;
}

export interface InboundResult {
  acked: number;
  pause: boolean;
}

export interface AdapterStatus {
  state: "connected" | "listening" | "checking" | "degraded" | "contested" | "paused" | "disconnected";
  detail?: string;
  name?: string;
}

export interface Capabilities {
  drafts: boolean;
  richMarkdown: boolean;
  threads: boolean;
  buttons: boolean;
  editing: boolean;
  copyButtons: boolean;
}

export interface SendOptions {
  html?: boolean;
  replyTo?: string;
  threadId?: string;
  buttons?: Button[][];
  silent?: boolean;
  forceReply?: { placeholder?: string };
}

export interface ChannelAdapter {
  readonly platform: Platform;
  readonly account: string;
  readonly capabilities: Capabilities;
  readonly limits: { text: number; file: number; photo: number; download: number };
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(chatId: string, text: string, options?: SendOptions): Promise<{ messageId: string }>;
  sendTyping(chatId: string): Promise<void>;
  answerButton(callbackId: string, text?: string): Promise<void>;
  editMessage(chatId: string, messageId: string, text: string, options?: SendOptions): Promise<void>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;
  downloadFile(file: InboundFile): Promise<{ data: Buffer; name?: string; mime?: string }>;
  sendFile(chatId: string, file: OutboundFile, options?: SendFileOptions): Promise<{ messageId: string }>;
  onInbound(handler: (batch: InboundMessage[]) => Promise<InboundResult>): void;
  onStatus(handler: (status: AdapterStatus) => void): void;
  pause(): void;
  resume(): void;
}
