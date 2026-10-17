// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import type { NewRoomPlan } from "../new-room.js";
import type { CardKind, StoredCard } from "../room-cards.js";
import type { SettingChange, VibemateChange } from "../room-design.js";
import type { TemplateVibemate } from "../templates.js";

export interface NewRoomProposal {
  key: string;
  participantId: string;
  participantName: string;
  ts: number;
  afterSeq?: number;
  plan: NewRoomPlan;
  status: "pending" | "created" | "refused";
  roomId?: string;
}

export interface RoomProposal {
  key: string;
  participantId: string;
  participantName: string;
  ts: number;
  afterSeq?: number;
  why: string;
  room?: { id: string; name: string };
  settings: SettingChange[];
  vibemates: VibemateChange[];
  appearance?: SettingChange[];
  warnings: string[];
  touchesOwn: boolean;
  status: "pending" | "applied" | "rejected";
  skipped?: string[];
}

export interface ProposalPlan { settings: SettingChange[]; vibemates: TemplateVibemate[]; ops: VibemateChange[]; ids: Record<string, string>; appearance?: Record<string, unknown>; roomId?: string }

export type ProposalEvent =
  | { type: "proposal"; proposal: RoomProposal }
  | { type: "proposal.resolved"; key: string; status: "applied" | "rejected"; skipped?: string[] }
  | { type: "new-room"; proposal: NewRoomProposal }
  | { type: "new-room.resolved"; key: string; status: "created" | "refused"; roomId?: string };

export interface RoomProposalsPorts {
  store: { list(): StoredCard[]; save(kind: CardKind, key: string, ts: number, body: unknown): void };
  emit(event: ProposalEvent): void;
  roomLine(text: string, forHuman: boolean): { seq: number };
  seq(): number;
  humanName(): string;
  log(text: string): void;
  warn(text: string): void;
}

function owned<T>(value: T): T {
  const freeze = (inner: unknown): void => {
    if (inner && typeof inner === "object") { for (const part of Object.values(inner)) freeze(part); Object.freeze(inner); }
  };
  const copy = structuredClone(value);
  freeze(copy);
  return copy;
}

export class RoomProposals {
  private readonly proposals = new Map<string, RoomProposal>();
  private readonly plans = new Map<string, ProposalPlan>();
  private readonly newRooms = new Map<string, NewRoomProposal>();
  private disposed = false;

  constructor(private readonly ports: RoomProposalsPorts) {}

  load(): void {
    if (this.disposed) return;
    let cards: StoredCard[];
    try { cards = this.ports.store.list(); }
    catch (error) { this.ports.warn(`the room's cards could not be read: ${error instanceof Error ? error.message : String(error)}`); return; }
    for (const card of cards) {
      const body = card.body as { proposal?: { key?: unknown; status?: unknown }; plan?: unknown };
      if (!body?.proposal || body.proposal.key !== card.key) { this.ports.warn(`card ${card.key} is not readable; left out`); continue; }
      if (card.kind === "proposal") {
        let proposal = body.proposal as RoomProposal;
        if (proposal.status === "pending" && !body.plan) { this.ports.warn(`proposal ${card.key} lost its plan; shown as rejected`); proposal = { ...proposal, status: "rejected" }; }
        this.proposals.set(card.key, owned(proposal));
        if (proposal.status === "pending") this.plans.set(card.key, owned(body.plan as ProposalPlan));
      } else if (card.kind === "new-room") this.newRooms.set(card.key, owned(body.proposal as NewRoomProposal));
    }
  }

  hold(from: { id: string; name: string }, card: Omit<RoomProposal, "key" | "participantId" | "participantName" | "ts" | "afterSeq" | "status">, plan: ProposalPlan, line: string, logged: (key: string) => string): RoomProposal | null {
    if (this.disposed) return null;
    const placed = this.ports.roomLine(line, true);
    if (this.disposed) return null;
    const proposal = owned<RoomProposal>({ key: randomUUID(), participantId: from.id, participantName: from.name, ts: Date.now(), afterSeq: placed.seq, ...card, status: "pending" });
    this.plans.set(proposal.key, owned(plan));
    this.proposals.set(proposal.key, proposal);
    this.keep("proposal", proposal.key);
    if (this.disposed) return proposal;
    this.ports.emit({ type: "proposal", proposal });
    if (this.disposed) return proposal;
    this.ports.log(logged(proposal.key));
    return proposal;
  }

  pending(key: string): { proposal: RoomProposal; plan: ProposalPlan } {
    const proposal = this.proposals.get(key);
    const plan = this.plans.get(key);
    if (!proposal || !plan || this.disposed) throw new Error("no such pending proposal");
    return { proposal, plan };
  }

  reject(key: string, what: string): RoomProposal {
    const { proposal, answered } = this.answer(key, { status: "rejected" });
    if (!answered || this.disposed) return proposal;
    this.ports.emit({ type: "proposal.resolved", key, status: "rejected" });
    if (this.disposed) return proposal;
    this.ports.roomLine(`${this.ports.humanName()} rejected ${proposal.participantName}'s proposal (${what}).`, false);
    return proposal;
  }

  applied(key: string, what: string, skipped: string[]): RoomProposal {
    const { proposal, answered } = this.answer(key, { status: "applied", skipped });
    if (!answered || this.disposed) return proposal;
    const kept = proposal.skipped ?? [];
    this.ports.emit({ type: "proposal.resolved", key, status: "applied", skipped: kept });
    if (this.disposed) return proposal;
    this.ports.roomLine(`${this.ports.humanName()} applied ${proposal.participantName}'s proposal (${what}).${kept.length ? ` Not applied: ${kept.join("; ")}.` : ""}`, false);
    return proposal;
  }

  hasWaitingRoom(): boolean {
    return [...this.newRooms.values()].some((waiting) => waiting.status === "pending");
  }

  proposeRoom(from: { id: string; name: string }, plan: NewRoomPlan): NewRoomProposal | null {
    if (this.disposed) return null;
    const proposal = owned<NewRoomProposal>({ key: randomUUID(), participantId: from.id, participantName: from.name, ts: Date.now(), afterSeq: this.ports.seq(), plan, status: "pending" });
    this.newRooms.set(proposal.key, proposal);
    this.keep("new-room", proposal.key);
    if (this.disposed) return proposal;
    this.ports.emit({ type: "new-room", proposal });
    return proposal;
  }

  newRoomProposals(): NewRoomProposal[] {
    return [...this.newRooms.values()];
  }

  pendingNewRoom(key: string): NewRoomProposal | undefined {
    const proposal = this.newRooms.get(key);
    return proposal && proposal.status === "pending" && !this.disposed ? proposal : undefined;
  }

  settleNewRoom(key: string, status: "created" | "refused", madeAs?: string): NewRoomProposal {
    const waiting = this.newRooms.get(key);
    if (!waiting) throw new Error("no such proposed room");
    if (waiting.status !== "pending" || this.disposed) return waiting;
    const proposal = owned<NewRoomProposal>({ ...waiting, status, ...(madeAs ? { roomId: madeAs } : {}) });
    this.newRooms.set(key, proposal);
    this.keep("new-room", key);
    if (this.disposed) return proposal;
    this.ports.emit({ type: "new-room.resolved", key, status, ...(madeAs ? { roomId: madeAs } : {}) });
    if (this.disposed) return proposal;
    this.ports.roomLine(status === "created"
      ? `${this.ports.humanName()} created the room ${proposal.plan.name} that ${proposal.participantName} proposed.`
      : `${this.ports.humanName()} did not create the room ${proposal.plan.name} that ${proposal.participantName} proposed.`, false);
    return proposal;
  }

  views(): { proposals: RoomProposal[]; newRooms: NewRoomProposal[] } {
    return { proposals: [...this.proposals.values()], newRooms: [...this.newRooms.values()] };
  }

  dispose(): void {
    this.disposed = true;
  }

  private answer(key: string, change: Pick<RoomProposal, "status"> & Partial<Pick<RoomProposal, "skipped">>): { proposal: RoomProposal; answered: boolean } {
    const waiting = this.proposals.get(key);
    if (!waiting) throw new Error("no such pending proposal");
    if (waiting.status !== "pending" || this.disposed) return { proposal: waiting, answered: false };
    const proposal = owned<RoomProposal>({ ...waiting, ...change });
    this.proposals.set(key, proposal);
    this.plans.delete(key);
    this.keep("proposal", key);
    return { proposal, answered: true };
  }

  private keep(kind: CardKind, key: string): void {
    const proposal = kind === "proposal" ? this.proposals.get(key) : this.newRooms.get(key);
    if (!proposal) return;
    const plan = kind === "proposal" && proposal.status === "pending" ? this.plans.get(key) : undefined;
    try { this.ports.store.save(kind, key, proposal.ts, plan ? { proposal, plan } : { proposal }); }
    catch (error) { this.ports.warn(`the card ${key} could not be kept with the record (it is shown until the hub stops): ${error instanceof Error ? error.message : String(error)}`); }
  }
}
