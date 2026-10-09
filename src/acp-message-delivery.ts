// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export const BACKGROUND_MESSAGE_CAPABILITY = "viberoom.backgroundMessages";
export const BACKGROUND_MESSAGE_METHOD = "_viberoom/background_message";

export interface BackgroundMessage {
  sessionId: string;
  messageId: string;
  text: string;
  stopReason: "end_turn" | "cancelled" | "error";
}
interface Notification {
  sessionId: string;
  update: { sessionUpdate: string; messageId?: string | null; content?: { type: string; text?: string }; _meta?: Record<string, unknown> };
}

export function backgroundMessagesEnabled(capabilities: unknown): boolean {
  return (capabilities as { _meta?: Record<string, unknown> } | null)?._meta?.[BACKGROUND_MESSAGE_CAPABILITY] === 1;
}

function rootProse(notification: Notification): boolean {
  const update = notification.update;
  return update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text" &&
    !(update._meta?.claudeCode as { parentToolUseId?: unknown } | undefined)?.parentToolUseId;
}

function prose(notifications: Notification[]): string {
  let text = "", previous: string | null | undefined;
  for (const { update } of notifications) {
    if (!rootProse({ sessionId: "", update })) continue;
    if (text && update.messageId && previous && update.messageId !== previous) text += "\n\n";
    text += update.content?.text ?? "";
    previous = update.messageId;
  }
  return text;
}

export class ClaudeMessageDelivery {
  private pending: Notification[] = [];
  private owned = false;
  private flushing = false;
  private readonly completed = new Set<string>();
  constructor(readonly enabled: boolean, private readonly send: (notification: Notification) => Promise<void>,
    private readonly publish: (message: BackgroundMessage) => Promise<void>) {}

  bindOwned(): void { this.owned = true; }

  capture(notification: Notification): boolean {
    if (!this.enabled || this.flushing || !rootProse(notification)) return false;
    if (this.owned && !this.pending.length) return false;
    this.pending.push(notification);
    return true;
  }

  async deliverOwned(): Promise<void> {
    const pending = this.pending;
    this.pending = [];
    this.owned = true;
    this.flushing = true;
    try { for (const notification of pending) await this.send(notification); }
    finally { this.flushing = false; }
  }

  async deliverBackground(message: Omit<BackgroundMessage, "text">, fallback = ""): Promise<void> {
    const text = prose(this.pending) || fallback;
    this.reset();
    if (!this.enabled || !message.messageId || this.completed.has(message.messageId)) return;
    this.completed.add(message.messageId);
    if (text) await this.publish({ ...message, text });
  }

  reset(): void { this.pending = []; this.owned = false; }
}

interface NativeTurn {
  updates: Notification[];
  texts: Map<string, string>;
  delivered: Map<string, string>;
  terminal?: BackgroundMessage["stopReason"];
  owned: boolean;
}

export class CodexMessageDelivery {
  private readonly turns = new Map<string, NativeTurn>();
  private readonly completed = new Set<string>();
  private starting = 0;
  private ambiguousStart = false;
  private legacyCommand = 0;
  constructor(readonly enabled: boolean, private readonly sessionId: string,
    private readonly send: (notification: Notification) => Promise<void>,
    private readonly publish: (message: BackgroundMessage) => Promise<void>) {}

  beginPrompt(): void { if (this.enabled) this.starting++; }
  beginLegacyCommand(): void { this.legacyCommand++; }
  endLegacyCommand(): void { this.legacyCommand = Math.max(0, this.legacyCommand - 1); }
  async claimPrompt(turnId: string): Promise<void> {
    if (!this.enabled) return;
    const turn = this.turn(turnId);
    turn.owned = true;
    const updates = turn.updates.splice(0);
    for (const update of updates) {
      await this.send(update);
      const id = update.update.messageId;
      if (id) turn.delivered.set(id, (turn.delivered.get(id) ?? "") + (update.update.content?.text ?? ""));
    }
    for (const [id, text] of turn.texts) await this.deliverMissingTail(turn, id, text);
    if (turn.terminal) {
      this.completed.add(turnId);
      this.turns.delete(turnId);
    }
  }
  async endPromptStart(ambiguous = false): Promise<void> {
    if (!this.enabled) return;
    this.starting = Math.max(0, this.starting - 1);
    if (ambiguous) {
      this.ambiguousStart = true;
      for (const [id, turn] of this.turns) if (!turn.owned) this.turns.delete(id);
    }
    if (this.ambiguousStart && !this.starting) {
      for (const [id, turn] of this.turns) if (!turn.owned) {
        this.completed.add(id);
        this.turns.delete(id);
      }
    }
    for (const [id, turn] of this.turns) if (turn.terminal && !turn.owned) await this.publishCompleted(id, turn);
  }
  capture(turnId: string | undefined, notification: Notification): boolean {
    if (!this.enabled || this.legacyCommand || !turnId || !rootProse(notification)) return false;
    if (this.completed.has(turnId)) return true;
    if (this.ambiguousStart && !this.starting && !this.turns.get(turnId)?.owned) return true;
    const turn = this.turn(turnId);
    const id = notification.update.messageId;
    if (id) {
      turn.texts.set(id, (turn.texts.get(id) ?? "") + (notification.update.content?.text ?? ""));
      if (turn.owned) turn.delivered.set(id, (turn.delivered.get(id) ?? "") + (notification.update.content?.text ?? ""));
    }
    if (turn.owned) return false;
    turn.updates.push(notification);
    return true;
  }
  async completedItem(turnId: string, itemId: string, text: string): Promise<void> {
    if (!this.enabled || this.legacyCommand || this.completed.has(turnId)) return;
    if (this.ambiguousStart && !this.starting && !this.turns.get(turnId)?.owned) return;
    const turn = this.turn(turnId);
    if (turn.owned) await this.deliverMissingTail(turn, itemId, text);
    if (text) turn.texts.set(itemId, text);
  }
  async terminal(turnId: string, reason: BackgroundMessage["stopReason"]): Promise<void> {
    if (!this.enabled || this.completed.has(turnId)) return;
    if (this.legacyCommand || this.ambiguousStart && !this.starting && !this.turns.get(turnId)?.owned) {
      this.completed.add(turnId);
      this.turns.delete(turnId);
      return;
    }
    const turn = this.turn(turnId);
    turn.terminal = reason;
    if (turn.owned) {
      this.completed.add(turnId);
      this.turns.delete(turnId);
    } else if (!this.starting) await this.publishCompleted(turnId, turn);
  }
  private turn(id: string): NativeTurn {
    let turn = this.turns.get(id);
    if (!turn) { turn = { updates: [], texts: new Map(), delivered: new Map(), owned: false }; this.turns.set(id, turn); }
    return turn;
  }
  private async deliverMissingTail(turn: NativeTurn, itemId: string, text: string): Promise<void> {
    const previous = turn.delivered.get(itemId) ?? "";
    if (text && text.startsWith(previous) && text.length > previous.length) {
      await this.send({ sessionId: this.sessionId, update: { sessionUpdate: "agent_message_chunk", messageId: itemId,
        content: { type: "text", text: text.slice(previous.length) } } });
      turn.delivered.set(itemId, text);
    }
  }
  private async publishCompleted(id: string, turn: NativeTurn): Promise<void> {
    if (this.starting || this.ambiguousStart || !turn.terminal || this.completed.has(id)) return;
    this.completed.add(id);
    this.turns.delete(id);
    const text = [...turn.texts.values()].filter(Boolean).join("\n\n") || prose(turn.updates);
    if (text) await this.publish({ sessionId: this.sessionId, messageId: id, text, stopReason: turn.terminal });
  }
}
