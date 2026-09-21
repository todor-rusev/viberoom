// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import type { Hub } from "./hub.js";
import { visibleToAgents } from "./quotes.js";
import { lintMemory, MEMORY_LIMITS, MEMORY_RULE, memoryHash, revisedNotes, type MemoryInput, type MemoryScope, type MemoryState } from "./shared-memory.js";

type Receipt = { ticket: string; turn: string; room: string; user: number; local: number };
export class MemoryService {
  private readonly reads = new Map<string, Receipt>();
  constructor(private readonly hub: Hub) {}
  private context(roomId?: string) {
    const room = roomId ? this.hub.getRoom(roomId) : null;
    const user = this.hub.history.memory.read("user");
    const local = room ? this.hub.history.memory.read(`room:${room.uuid}`) : null;
    return { room, user, local };
  }
  view(roomId?: string, history = false) {
    const { room, user, local } = this.context(roomId);
    const stale = (state: MemoryState | null) => state?.notes.filter(n => n.sources.some(source => {
      const message = this.hub.history.get(source.room, source.seq);
      return !message || memoryHash(message.text) !== source.hash;
    })).map(n => ({ id: n.id, message: "A supporting message was changed or removed. Review whether this observation is still valid." })) ?? [];
    return { limits: MEMORY_LIMITS, rule: MEMORY_RULE, user, room: local, warnings: { user: stale(user), room: stale(local) },
      ...(history ? { revisions: { user: this.hub.history.memory.revisions("user"), room: room ? this.hub.history.memory.revisions(`room:${room.uuid}`) : [] } } : {}) };
  }
  private agentView(roomId: string) {
    const view = this.view(roomId);
    const brief = (state: MemoryState) => ({ revision: state.revision, enabled: state.enabled, notes: state.notes.map(n => ({ id: n.id, text: n.text, locked: n.locked, basis: n.basis })) });
    return { limits: view.limits, rule: view.rule, user: brief(view.user), room: brief(view.room!), warnings: view.warnings };
  }
  agent(token: string, raw: Record<string, unknown>) {
    const target = this.hub.resolveMcpToken(token);
    if (!target) throw new Error("The session for this memory request is no longer available.");
    const turn = target.room.memoryTurn(target.participantId);
    for (const key of Object.keys(raw)) if (!["action", "scope", "ticket", "notes", "reason", "acknowledge"].includes(key)) throw new Error(`Unsupported memory argument: ${key}`);
    const { user, local } = this.context(target.room.id);
    const actorKey = `${target.room.id}:${target.participantId}`;
    if (raw.action === "read") {
      if (Object.keys(raw).some(k => k !== "action")) throw new Error("memory(action=read) returns both complete scopes; no edit arguments belong in a read.");
      const receipt = { ticket: randomUUID(), turn, room: target.room.id, user: user.revision, local: local!.revision };
      this.reads.set(actorKey, receipt);
      while (this.reads.size > 512) this.reads.delete(this.reads.keys().next().value!);
      return { ...this.agentView(target.room.id), ticket: receipt.ticket };
    }
    if (raw.action !== "revise") throw new Error("memory action must be read or revise.");
    const receipt = this.reads.get(actorKey);
    if (!receipt || raw.ticket !== receipt.ticket || receipt.turn !== turn || receipt.user !== user.revision || receipt.local !== local!.revision) throw new Error("Read BOTH complete memory scopes with memory(action=read) in this turn before revising. A changed scope requires a fresh read.");
    const scope = this.scope(raw.scope), current = scope === "user" ? user : local!;
    const lint = lintMemory(raw.notes, (scope === "user" ? local! : user).notes);
    const reason = this.reason(raw.reason);
    const notes = revisedNotes(current, lint.notes, target.room.participants.get(target.participantId)!.name, false, (note: MemoryInput) => {
      const numbers = [...new Set(note.evidence ?? [])];
      if (numbers.length < (note.basis === "pattern" ? 2 : 1)) throw new Error("An explicit preference needs one human message; a repeated pattern needs two distinct human messages from this room.");
      return numbers.map(seq => {
        const message = this.hub.history.get(target.room.id, seq);
        if (!message || message.from !== "human" || message.kind !== "chat" || message.streaming || !visibleToAgents(message)) throw new Error(`Evidence #${seq} is not a saved, visible human message in this room.`);
        return { room: target.room.id, seq, hash: memoryHash(message.text) };
      });
    });
    const warningKey = memoryHash({ scope, notes: lint.notes, warnings: lint.warnings, ticket: receipt.ticket });
    if (lint.warnings.length && raw.acknowledge !== warningKey) return { saved: false, warnings: lint.warnings, acknowledge: warningKey, hint: "Review these warnings. Prefer correcting the proposed set; to retain it deliberately, repeat the same revision with this acknowledge value." };
    const key = scope === "user" ? "user" : `room:${target.room.uuid}`;
    this.hub.history.memory.write(key, current.revision, { enabled: current.enabled, notes }, target.room.participants.get(target.participantId)!.name, reason);
    this.reads.delete(actorKey);
    return { saved: true, lintWarnings: lint.warnings, ...this.agentView(target.room.id) };
  }
  human(roomId: string | undefined, raw: Record<string, unknown>) {
    const { room, user, local } = this.context(roomId), scope = this.scope(raw.scope);
    if (scope === "room" && !room) throw new Error("Open a room to edit its memory.");
    const current = scope === "user" ? user : local!, key = scope === "user" ? "user" : `room:${room!.uuid}`;
    if (raw.revision !== current.revision) throw new Error("Memory changed while this editor was open. Reload before saving; your draft has not been applied.");
    if (raw.action === "clear") {
      this.hub.history.memory.write(key, current.revision, { enabled: current.enabled, notes: [] }, this.hub.settings.humanName, "Cleared notes and revision history", true);
      return { saved: true, ...this.view(roomId, true) };
    }
    if (raw.action === "restore") {
      const old = this.hub.history.memory.revisions(key).find(r => r.revision === raw.restoreRevision);
      if (!old) throw new Error("That memory revision is no longer retained.");
      this.hub.history.memory.write(key, current.revision, { enabled: current.enabled, notes: old.snapshot.notes }, this.hub.settings.humanName, `Restored revision ${old.revision}`);
      return { saved: true, ...this.view(roomId, true) };
    }
    if (raw.action !== "revise" || typeof raw.enabled !== "boolean") throw new Error("Choose revise and whether agents may maintain these notes.");
    const lint = lintMemory(raw.notes, (scope === "user" ? local?.notes : user.notes) ?? []);
    const notes = revisedNotes(current, lint.notes, this.hub.settings.humanName, true, () => []);
    const warningKey = memoryHash({ scope, notes: lint.notes, enabled: raw.enabled, revision: raw.revision });
    if (lint.warnings.length && raw.acknowledge !== warningKey) return { saved: false, warnings: lint.warnings, acknowledge: warningKey };
    this.hub.history.memory.write(key, current.revision, { enabled: raw.enabled, notes }, this.hub.settings.humanName, "Edited in Settings");
    return { saved: true, lintWarnings: lint.warnings, ...this.view(roomId, true) };
  }
  private scope(value: unknown): MemoryScope {
    if (value !== "user" && value !== "room") throw new Error("Memory scope must be user or room.");
    return value;
  }
  private reason(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || [...value].length > 300) throw new Error("Give a short reason for this consolidation (1–300 characters).");
    return value.trim();
  }
}
