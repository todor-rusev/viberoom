// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {
  boundedError, diagramSourceProblem, fenceFor, giveUp, mermaidBlocks, recordFailure, recordFix, replaceDiagramSource, type DiagramRepair,
} from "../diagram-repair.js";
import type { ChatMessage } from "../room.js";
import type { TurnSubscriber } from "./turn-life.js";

export interface RepairTask {
  messageId: string;
  block: number;
  delivered: boolean;
}

export interface DiagramRepairPorts {
  assertRecordOpen(): void;
  assertRecordOpenForAgents(): void;
  agentInRoom(participantId: string): void;
  messages(): readonly ChatMessage[];
  messageById(id: string): ChatMessage | undefined;
  revise(next: ChatMessage, store?: boolean): void;
  authorCanRepair(authorId: string, answeredAt: number): boolean;
  requestTurn(authorId: string): void;
  fixedThisTurn(authorId: string): void;
  recordHold(): boolean;
  humanName(): string;
}

export class DiagramRepairs {
  private readonly tasks = new Map<string, RepairTask[]>();
  private disposed = false;

  constructor(private readonly ports: DiagramRepairPorts) {}

  dispose(): void {
    this.disposed = true;
  }

  report(messageId: string, block: number, source: string, error: string): { state: DiagramRepair["state"] | "ignored" } {
    if (this.disposed) return { state: "ignored" };
    this.ports.assertRecordOpen();
    if (this.disposed) return { state: "ignored" };
    const reply = (m: ChatMessage | undefined): m is ChatMessage => !!m && m.kind === "chat" && !m.streaming && m.from !== "human";
    const asked = this.ports.messageById(messageId);
    if (this.disposed || !reply(asked)) return { state: "ignored" };
    const canAsk = this.ports.authorCanRepair(asked.from, asked.ts + (asked.durationMs ?? 0));
    if (this.disposed) return { state: "ignored" };
    const message = this.ports.messageById(messageId);
    if (this.disposed || !reply(message) || message.from !== asked.from) return { state: "ignored" };
    const found = mermaidBlocks(message.text).find((b) => b.block === block);
    if (!found || found.source !== String(source).trim()) return { state: "ignored" };
    const { outcome, repairs } = recordFailure(message.diagramRepairs ?? [], block, String(error), !!found.span && canAsk, Date.now());
    if (outcome === "unchanged") return { state: repairs.find((r) => r.block === block)?.state ?? "failed" };
    this.ports.revise({ ...message, diagramRepairs: repairs });
    if (this.disposed) return { state: outcome };
    if (outcome === "repairing") {
      const tasks = this.tasks.get(message.from) ?? [];
      tasks.push({ messageId: message.id, block, delivered: false });
      this.tasks.set(message.from, tasks);
      this.ports.requestTurn(message.from);
    }
    return { state: outcome };
  }

  fix(participantId: string, seq: number, block: number, source: string): { ok: true; message: string } {
    const shutDown = () => new Error("not fixed: the room has shut down");
    if (this.disposed) throw shutDown();
    this.ports.assertRecordOpenForAgents();
    if (this.disposed) throw shutDown();
    this.ports.agentInRoom(participantId);
    if (this.disposed) throw shutDown();
    const message = this.ports.messages().find((m) => m.seq === seq && m.kind === "chat");
    if (this.disposed) throw shutDown();
    if (!message) throw new Error(`no message #${seq} in this room`);
    if (message.from !== participantId) throw new Error(`#${seq} is not yours: only its author can fix its diagrams`);
    const repair = message.diagramRepairs?.find((r) => r.block === block);
    if (!repair || repair.state !== "repairing") throw new Error(`diagram ${block} of #${seq} is not waiting for a fix${repair?.state === "failed" ? " any more" : ""}`);
    const problem = diagramSourceProblem(source);
    if (problem) throw new Error(problem);
    const found = mermaidBlocks(message.text).find((b) => b.block === block);
    if (!found) throw new Error(`#${seq} has no diagram ${block}`);
    this.ports.revise({ ...message, text: replaceDiagramSource(message.text, found, source), diagramRepairs: recordFix(message.diagramRepairs!, block, found.source, Date.now()) });
    this.drop(participantId, message.id, block);
    if (!this.disposed) this.ports.fixedThisTurn(participantId);
    return { ok: true, message: `Diagram ${block} of #${seq} replaced; the room draws it again in the same message. Nothing else is needed from you.` };
  }

  has(authorId: string): boolean {
    return this.tasks.has(authorId);
  }

  pendingFor(authorId: string): readonly RepairTask[] {
    return this.tasks.get(authorId) ?? [];
  }

  isRepairing(authorId: string, messageId: string, block: number): boolean {
    return !!this.tasks.get(authorId)?.some((t) => t.messageId === messageId && t.block === block);
  }

  delivered(authorId: string, task: RepairTask): void {
    if (this.tasks.get(authorId)?.includes(task)) task.delivered = true;
  }

  block(task: Pick<RepairTask, "messageId" | "block">): string | null {
    if (this.disposed) return null;
    const human = this.ports.humanName();
    if (this.disposed) return null;
    const message = this.ports.messageById(task.messageId);
    if (this.disposed) return null;
    const repair = message?.diagramRepairs?.find((r) => r.block === task.block);
    const found = message && mermaidBlocks(message.text).find((b) => b.block === task.block);
    if (!message || !found || repair?.state !== "repairing") return null;
    const fence = fenceFor(found.source);
    return [
      "<diagram-repair>",
      `The room could not draw diagram ${task.block} of your message #${message.seq}. Until it is fixed, ${human} sees that you are fixing it, in its place. Mermaid says:`,
      boundedError(repair.error),
      "",
      "The diagram's code as it is now:",
      `${fence}mermaid`, found.source, fence,
      "",
      `Send the corrected code with tool_call {"name": "fix_diagram", "arguments": {"message": ${message.seq}, "block": ${task.block}, "source": "<the code>"}}: the code alone, without the fence. The room puts it in place of this one, so ${human} sees one message with a working diagram. Do not post the diagram again; if the fix is all you have to do, reply [silent].`,
      "</diagram-repair>",
    ].join("\n");
  }

  giveUp(authorId: string, which: "delivered" | "all"): void {
    if (this.disposed) return;
    const tasks = this.tasks.get(authorId);
    if (!tasks) return;
    const over = which === "all" ? tasks : tasks.filter((t) => t.delivered);
    for (const task of over) {
      const store = !this.ports.recordHold();
      if (this.disposed) return;
      const message = this.ports.messageById(task.messageId);
      if (this.disposed) return;
      const repairs = message && giveUp(message.diagramRepairs, task.block, Date.now());
      if (!message || !repairs) continue;
      this.ports.revise({ ...message, diagramRepairs: repairs }, store);
      if (this.disposed) return;
    }
    const left = which === "all" ? [] : tasks.filter((t) => !t.delivered);
    if (left.length) this.tasks.set(authorId, left);
    else this.tasks.delete(authorId);
  }

  turnSubscriber(): TurnSubscriber {
    return {
      turnEnded: ({ id }) => this.giveUp(id, "delivered"),
      sessionEnded: (id) => this.giveUp(id, "all"),
      muted: (id) => this.giveUp(id, "all"),
      asleep: (id) => this.giveUp(id, "all"),
    };
  }

  private drop(authorId: string, messageId: string, block: number): void {
    const tasks = this.tasks.get(authorId)?.filter((t) => t.messageId !== messageId || t.block !== block);
    if (tasks?.length) this.tasks.set(authorId, tasks);
    else this.tasks.delete(authorId);
  }
}
