// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { BriefNotes, NotesSource } from "../persona.js";
import { describeError } from "../jsonrpc.js";
import { nextNotesRevision } from "../native-note-state.js";
import { visibleToAgents } from "../quotes.js";
import type { ChatMessage, Participant } from "../room.js";
import type { AgentRuntime } from "./agent-runtime.js";
import { stillHeld, type Held, type SeenVibemate } from "./vibemate-seen.js";

export const NOTES_MAX = 4000;

export interface AgentNotesPorts {
  current(id: string): Held;
  participants(): Iterable<Participant>;
  runtimes(): Iterable<AgentRuntime>;
  seq(): number;
  messages(): readonly ChatMessage[];
  autoNotes(): boolean;
  open(): boolean;
  assertRecordOpen(): void;
  idle(id: string, runtime: AgentRuntime): boolean;
  pushParticipant(seen: SeenVibemate): boolean;
  log(text: string): void;
  runNotesTurn(expected: { participant: Participant; runtime: AgentRuntime }): Promise<void>;
}

export class AgentNotes {
  private disposed = false;

  constructor(private readonly ports: AgentNotesPorts) {}

  dispose(): void {
    this.disposed = true;
  }

  keep(participant: Participant, runtime: AgentRuntime, notes: string | null, via: "reply" | "hidden turn"): boolean {
    if (!notes || this.disposed) return false;
    const seq = this.ports.seq();
    if (!this.holds({ participant, runtime })) return false;
    participant.notesRevision = nextNotesRevision(participant.notesRevision);
    participant.nativeNoteReceipt = undefined;
    participant.notes = notes.slice(0, NOTES_MAX);
    participant.notesAt = runtime.session.lastUsed;
    participant.notesSeq = seq;
    participant.notesWrittenAt = Date.now();
    runtime.notes.notesDue = false;
    runtime.notes.notesMisses = 0;
    runtime.notes.notesPending = false;
    this.ports.pushParticipant({ participant, runtime });
    if (this.disposed) return true;
    runtime.session.log.info(`notes: ${notes.split("\n").length} lines kept (${via}, context ${runtime.session.lastUsed})`);
    return true;
  }

  dropAfter(seq: number): void {
    if (this.disposed) return;
    const everyone = [...this.ports.participants()];
    for (const participant of everyone) {
      if (this.disposed) return;
      if (!participant.notes || (participant.notesSeq ?? seq) < seq) continue;
      if (!this.holds({ participant })) continue;
      participant.notesRevision = nextNotesRevision(participant.notesRevision);
      participant.nativeNoteReceipt = undefined;
      participant.notes = participant.notesAt = participant.notesSeq = participant.notesWrittenAt = undefined;
      this.ports.pushParticipant({ participant });
      if (this.disposed) return;
      this.ports.log(`${participant.name}: notes dropped, the conversation was rewritten from #${seq}`);
    }
  }

  update(id: string, notes: string): Participant {
    this.alive();
    const { participant, runtime } = this.ports.current(id);
    this.alive();
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    const text = notes.trim().slice(0, NOTES_MAX);
    const seq = this.ports.seq();
    this.alive();
    if (!this.holds({ participant, runtime: runtime ?? null })) { this.alive(); throw new Error("no such agent"); }
    participant.notesRevision = nextNotesRevision(participant.notesRevision);
    participant.nativeNoteReceipt = undefined;
    participant.notes = text || undefined;
    participant.notesAt = text ? runtime?.session.lastUsed ?? participant.notesAt : undefined;
    participant.notesSeq = text ? seq : undefined;
    participant.notesWrittenAt = text ? Date.now() : undefined;
    this.ports.pushParticipant({ participant });
    return participant;
  }

  ask(runtime: AgentRuntime, how: "reply" | "hidden turn" = "reply"): boolean {
    if (this.disposed) return false;
    const auto = this.ports.autoNotes();
    if (this.disposed || !auto) return false;
    if (how === "reply") runtime.notes.notesDue = true;
    else runtime.notes.notesPending = true;
    return true;
  }

  withdraw(): void {
    if (this.disposed) return;
    const sessions = [...this.ports.runtimes()];
    if (this.disposed) return;
    for (const runtime of sessions) {
      runtime.notes.notesDue = false;
      runtime.notes.notesPending = false;
      runtime.notes.notesMisses = 0;
    }
  }

  forBrief(participant: Participant, runtime: AgentRuntime): BriefNotes | undefined {
    if (this.disposed || !participant.notes) return undefined;
    const source: NotesSource | null = runtime.notes.resumeNotes ?? (runtime.brief.lastBriefSeq >= 0 && (participant.notesSeq ?? -1) >= runtime.brief.lastBriefSeq ? "live" : null);
    if (!source) return undefined;
    const after = participant.notesSeq;
    const messages = after === undefined ? undefined : this.ports.messages();
    if (!this.holds({ participant, runtime })) return undefined;
    const newerMessages = messages === undefined || after === undefined ? undefined
      : messages.reduce((count, m) => count + Number(m.seq > after && m.kind === "chat" && !m.streaming && visibleToAgents(m)), 0);
    return { text: participant.notes, source, writtenAt: participant.notesWrittenAt, newerMessages };
  }

  async take(id: string, expected?: { participant: Participant; runtime: AgentRuntime }): Promise<Participant> {
    this.alive();
    this.ports.assertRecordOpen();
    this.alive();
    const { participant, runtime } = this.ports.current(id);
    this.alive();
    if (!participant || participant.kind !== "agent") throw new Error("no such agent");
    if (expected && (participant !== expected.participant || runtime !== expected.runtime)) throw new Error(`${participant.name} restarted before its notes were taken`);
    if (!runtime || !runtime.session.agent.alive) throw new Error(`${participant.name} is not online`);
    const idle = this.ports.idle(id, runtime);
    this.alive();
    if (!idle) throw new Error(`${participant.name} is in the middle of a reply or held native delivery; try again when it is idle`);
    await this.ports.runNotesTurn({ participant, runtime });
    return participant;
  }

  startPending(id: string, runtime: AgentRuntime): boolean {
    if (this.disposed || !runtime.notes.notesPending || runtime.work.workCancelled) return false;
    const auto = this.ports.autoNotes();
    if (this.disposed || !auto) return false;
    const now = this.ports.current(id);
    if (this.disposed || !now.participant || now.runtime !== runtime) return false;
    runtime.notes.notesPending = false;
    this.begin(id, now.participant, runtime, "hidden turn failed");
    return true;
  }

  resumeDeferred(id: string, runtime: AgentRuntime): boolean {
    if (this.disposed || !runtime.notes.deferredNotesTurn || runtime.work.workCancelled || runtime.session.retiring || !runtime.session.agent.alive) return false;
    const open = this.ports.open();
    if (this.disposed || !open) return false;
    const now = this.ports.current(id);
    if (this.disposed || !now.participant || now.runtime !== runtime) return false;
    const idle = this.ports.idle(id, runtime);
    if (this.disposed || !idle) return false;
    runtime.notes.deferredNotesTurn = false;
    runtime.notes.notesPending = false;
    this.begin(id, now.participant, runtime, "deferred hidden turn failed");
    return true;
  }

  private begin(id: string, participant: Participant, runtime: AgentRuntime, why: string): void {
    void this.take(id, { participant, runtime }).catch(error => runtime.session.log.warn(`notes: ${why}: ${describeError(error)}`));
  }

  private holds(seen: SeenVibemate): boolean {
    if (this.disposed) return false;
    const now = this.ports.current(seen.participant.id);
    return !this.disposed && stillHeld(seen, now);
  }

  private alive(): void {
    if (this.disposed) throw new Error("the room has shut down; the notes were not changed");
  }
}
