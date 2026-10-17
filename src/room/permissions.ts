// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import type { PermissionOption, RequestPermissionResponse, ToolCallUpdate } from "../acp-types.js";
import { canAutoApproveMessageCheck } from "../message-check.js";
import { SKILL_TOOL_NAME } from "../persona.js";
import { canAutoApproveRoomTool } from "../room-tool-identity.js";
import { validArguments } from "../tool-validation.js";
import type { ToolCallView } from "../room.js";

export interface PendingPermission {
  key: string;
  participantId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  ts: number;
  afterSeq?: number;
}

export interface PermissionDeskPorts {
  seq(): number;
  nameOf(id: string): string;
  emit(event: { type: "permission"; permission: PendingPermission } | { type: "permission.resolved"; key: string; optionId: string | null }): void;
  notice(text: string): void;
  answered(participantId: string): void;
  log(text: string): void;
}

function owned<T>(value: T): T {
  const freeze = (inner: unknown): void => {
    if (inner && typeof inner === "object") { for (const part of Object.values(inner)) freeze(part); Object.freeze(inner); }
  };
  const copy = structuredClone(value);
  freeze(copy);
  return copy;
}

interface Entry extends PendingPermission {
  resolve: (response: RequestPermissionResponse) => void;
}

export function roomToolNeedsNoQuestion(call: ToolCallUpdate, known: ToolCallView | undefined, hasRoomToken: boolean): boolean {
  if (!hasRoomToken) return false;
  return canAutoApproveRoomTool(call, known, "tool_search", input => validArguments("tool_search", input)) || canAutoApproveMessageCheck(call, known) || canAutoApproveRoomTool(call, known, "memory",
    input => Object.keys(input).every(key => ["action", "scope", "ticket", "notes", "reason", "acknowledge"].includes(key)) && (input.action === "read" || input.action === "revise")) || canAutoApproveRoomTool(call, known, SKILL_TOOL_NAME,
    input => Object.keys(input).every(key => key === "name") && typeof input.name === "string" && !!input.name.trim())
    || canAutoApproveRoomTool(call, known, "post_message", input => validArguments("post_message", input))
    || ["register_background_task", "list_background_tasks", "get_background_task", "cancel_background_task"].some(name =>
      canAutoApproveRoomTool(call, known, name, input => validArguments(name, input)))
    || canAutoApproveRoomTool(call, known, "fix_diagram", () => true);
}

export class PermissionDesk {
  private readonly entries = new Map<string, Entry>();
  private disposed = false;

  constructor(private readonly ports: PermissionDeskPorts) {}

  ask(participantId: string, toolCall: ToolCallUpdate, options: PermissionOption[], named: string, onListed?: () => void): Promise<RequestPermissionResponse> {
    if (this.disposed) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    return new Promise((resolve) => {
      const entry: Entry = { key: randomUUID(), participantId, toolCall: owned(toolCall), options: owned(options), ts: Date.now(), afterSeq: this.ports.seq(), resolve };
      this.entries.set(entry.key, entry);
      onListed?.();
      if (this.disposed) return;
      this.ports.emit({ type: "permission", permission: this.view(entry) });
      if (this.disposed) return;
      this.ports.notice(`${this.ports.nameOf(participantId)} asks for permission: ${named}`);
    });
  }

  pending(key: string): boolean {
    return this.entries.has(key);
  }

  waitsOn(participantId: string): boolean {
    for (const entry of this.entries.values()) if (entry.participantId === participantId) return true;
    return false;
  }

  resolve(key: string, optionId: string | null): void {
    const entry = this.entries.get(key);
    if (!entry) throw new Error("no such pending permission");
    this.entries.delete(key);
    entry.resolve(optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } });
    this.ports.emit({ type: "permission.resolved", key, optionId });
    if (this.disposed) return;
    this.ports.answered(entry.participantId);
    if (this.disposed) return;
    this.ports.log(`${this.ports.nameOf(entry.participantId)}'s question for permission was answered: ${optionId ?? "dismissed"}`);
  }

  cancelOf(participantId: string): void {
    let ended = 0;
    for (const [key, entry] of this.entries) {
      if (entry.participantId !== participantId) continue;
      this.entries.delete(key);
      entry.resolve({ outcome: { outcome: "cancelled" } });
      this.ports.emit({ type: "permission.resolved", key, optionId: null });
      ended++;
      if (this.disposed) return;
    }
    if (ended) this.ports.log(`${this.ports.nameOf(participantId)}'s question${ended === 1 ? "" : "s"} for permission ended with the turn, unanswered`);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const waiting = [...this.entries.values()];
    this.entries.clear();
    for (const entry of waiting) entry.resolve({ outcome: { outcome: "cancelled" } });
  }

  views(): PendingPermission[] {
    return [...this.entries.values()].map(entry => this.view(entry));
  }

  private view(entry: Entry): PendingPermission {
    const { resolve: _resolve, ...view } = entry;
    return Object.freeze(view);
  }
}
