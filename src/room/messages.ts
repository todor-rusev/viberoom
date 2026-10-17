// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { DivertOp } from "../history-store.js";
import type { ChatMessage } from "../room.js";

export type MessageDraft = Omit<ChatMessage, "seq"> & { seq?: number };

export interface SeqTicket {
  readonly seq: number;
}

function frozen<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const inner of Object.values(value)) frozen(inner, seen);
  return value;
}

const owned = (row: ChatMessage): ChatMessage => frozen(structuredClone(row));

export class RoomMessages {
  private readonly rows: ChatMessage[] = [];
  private lastSeq = 0;
  private lastOrder = 0;
  private readonly open = new WeakSet<SeqTicket>();

  get list(): readonly ChatMessage[] {
    return this.rows;
  }

  get seq(): number {
    return this.lastSeq;
  }

  get displayOrder(): number {
    return this.lastOrder;
  }

  reserve(): SeqTicket {
    const ticket = Object.freeze({ seq: ++this.lastSeq });
    this.open.add(ticket);
    return ticket;
  }

  add(draft: MessageDraft): ChatMessage {
    if (draft.seq !== undefined && draft.seq !== 0) throw new Error(`#${draft.seq} already has a number; a new message has none yet`);
    return this.place({ ...draft, seq: ++this.lastSeq } as ChatMessage);
  }

  addReserved(message: ChatMessage, ticket: SeqTicket): ChatMessage {
    if (!this.open.has(ticket)) throw new Error("this number was not set aside here, or it was already used");
    if (message.seq !== ticket.seq) throw new Error(`the message carries #${message.seq}, but its ticket is for #${ticket.seq}`);
    this.open.delete(ticket);
    return this.place(message);
  }

  byId(id: string): ChatMessage | undefined {
    return this.rows.find((m) => m.id === id);
  }

  revise(next: ChatMessage): ChatMessage {
    const at = this.rows.findIndex((m) => m.id === next.id);
    if (at < 0) throw new Error(`no message ${next.id} in this room to change`);
    const held = this.rows[at];
    if (next.seq !== held.seq || next.displayOrder !== held.displayOrder) {
      throw new Error(`a change keeps a message's number and place (#${held.seq} at ${held.displayOrder}, not #${next.seq} at ${next.displayOrder})`);
    }
    const row = owned(next);
    this.rows[at] = row;
    return row;
  }

  placeDraft(message: { displayOrder?: number }): void {
    message.displayOrder = ++this.lastOrder;
  }

  nextNative(recordSeq: number, recordOrder: number): { seq: number; displayOrder: number } {
    return { seq: Math.max(this.lastSeq, recordSeq) + 1, displayOrder: Math.max(this.lastOrder, recordOrder) + 1 };
  }

  acceptRecorded(message: ChatMessage): boolean {
    this.raise(message);
    if (this.rows.some((m) => m.id === message.id)) return false;
    this.rows.push(frozen(message));
    return true;
  }

  applyJournal(op: DivertOp): void {
    if (op.kind === "truncate" || op.kind === "rewrite") this.keep((m) => m.seq <= op.fromSeq);
    if (op.kind === "upsert" || op.kind === "rewrite") {
      const at = this.rows.findIndex((m) => m.id === op.message.id);
      if (at >= 0) this.rows[at] = frozen(op.message);
      else this.rows.push(frozen(op.message));
      this.raise(op.message);
    }
    if (op.kind === "bury") {
      const gone = new Set(op.ids);
      this.keep((m) => !gone.has(m.id));
    }
  }

  replaceFromRecord(rows: readonly ChatMessage[], recordSeq: number): void {
    this.rows.splice(0, this.rows.length);
    for (const message of rows) {
      this.rows.push(frozen(message));
      this.lastOrder = Math.max(this.lastOrder, message.displayOrder ?? message.seq);
    }
    this.lastSeq = Math.max(this.lastSeq, recordSeq);
  }

  truncateAfter(seq: number): void {
    this.keep((m) => m.seq <= seq);
  }

  continueFrom(seen: number): void {
    this.lastSeq = Math.max(this.lastSeq, seen);
  }

  private place(message: ChatMessage): ChatMessage {
    const row = owned(message.displayOrder === undefined ? { ...message, displayOrder: ++this.lastOrder } : message);
    this.rows.push(row);
    return row;
  }

  private raise(message: ChatMessage): void {
    this.lastSeq = Math.max(this.lastSeq, message.seq);
    this.lastOrder = Math.max(this.lastOrder, message.displayOrder ?? message.seq);
  }

  private keep(wanted: (message: ChatMessage) => boolean): void {
    const kept = this.rows.filter(wanted);
    this.rows.splice(0, this.rows.length, ...kept);
  }
}
