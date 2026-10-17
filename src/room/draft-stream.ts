// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { ContentBlock, PlanEntry, ToolCallUpdate } from "../acp-types.js";
import { settledVisible } from "../context.js";
import { SILENT_MARKER } from "../persona.js";
import { roomToolChip } from "../room-tool-identity.js";
import type { Participant, RoomEvent, ToolCallView } from "../room.js";
import type { AgentRuntime, RuntimeWork } from "./agent-runtime.js";
import type { Held } from "./vibemate-seen.js";

export type DraftTurn = NonNullable<RuntimeWork["turn"]>;

export interface DraftOwner {
  readonly participant: Participant;
  readonly runtime: AgentRuntime;
  readonly turn: DraftTurn | null;
}

export interface DraftStreamPorts {
  current(id: string): Held & { readonly open: boolean };
  push(owner: DraftOwner, event: RoomEvent): boolean;
  placeDraft(owner: DraftOwner & { readonly turn: DraftTurn }): boolean;
}

export function looksSilent(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.length <= SILENT_MARKER.length && SILENT_MARKER.startsWith(t);
}

export function contentText(block: ContentBlock): string {
  if (block.type === "text") return block.text;
  return `[${block.type}]`;
}

export function toolOutputText(u: ToolCallUpdate): string {
  const cap = (s: string): string => (s.length > 4000 ? `${s.slice(0, 4000)}\n… (${s.length - 4000} more characters)` : s);
  if (u.content && u.content.length) {
    const parts = u.content.map((c) => {
      if (c.type === "content") return contentText(c.content);
      if (c.type === "diff") return `--- ${c.path}\n${c.oldText ? `- ${c.oldText}\n` : ""}+ ${c.newText}`;
      return `[terminal ${c.terminalId}]`;
    });
    return cap(parts.join("\n"));
  }
  if (u.rawOutput !== undefined && u.rawOutput !== null) return cap(typeof u.rawOutput === "string" ? u.rawOutput : JSON.stringify(u.rawOutput, null, 1));
  return "";
}

export function applyToolCallUpdate(view: ToolCallView, u: ToolCallUpdate): boolean {
  const before = JSON.stringify(view);
  if (view.historySearch) {
    if (u.status === "failed" && view.status !== "failed") { view.status = "failed"; view.title += " · Response failed"; }
    return JSON.stringify(view) !== before;
  }
  if (view.messageCheck) {
    if (u.status === "failed") { view.status = "failed"; view.title = "Message check failed"; view.output = toolOutputText(u) || view.output; }
    return JSON.stringify(view) !== before;
  }
  if (u.title) view.title = u.title;
  if (u.name) view.name = u.name;
  if (u.kind !== undefined) view.kind = u.kind;
  if (u.status !== undefined) view.status = u.status;
  if (u.rawInput !== undefined) view.rawInput = u.rawInput;
  const touched = [...(u.locations ?? []).map((l) => l.path), ...(u.content ?? []).filter((c) => c.type === "diff").map((c) => (c as { path: string }).path)].filter((path) => typeof path === "string" && path);
  if (touched.length) view.locations = [...new Set([...(view.locations ?? []), ...touched])];
  const chip = roomToolChip(view);
  if (chip) {
    view.name ??= chip.name;
    view.title = chip.title;
    if (chip.kind) view.kind = chip.kind;
  }
  const output = toolOutputText(u);
  if (output) view.output = output;
  return JSON.stringify(view) !== before;
}

export class DraftStream {
  private disposed = false;

  constructor(private readonly ports: DraftStreamPorts) {}

  dispose(): void {
    this.disposed = true;
  }

  holds(owner: DraftOwner): boolean {
    if (this.disposed) return false;
    const now = this.ports.current(owner.participant.id);
    return !this.disposed && now.open && now.participant === owner.participant && now.runtime === owner.runtime && (owner.runtime.work.turn ?? null) === owner.turn;
  }

  show(owner: DraftOwner): "shown" | "skipped" | "refused" {
    const turn = owner.turn;
    if (!turn || !this.holds(owner)) return "refused";
    if (turn.published || turn.hidden) return "skipped";
    turn.published = true;
    turn.publishedAt = Date.now();
    if (this.ports.placeDraft({ ...owner, turn })) return "shown";
    turn.published = false;
    turn.publishedAt = undefined;
    return "refused";
  }

  tell(owner: DraftOwner, event: RoomEvent): boolean {
    return this.holds(owner) && this.ports.push(owner, event);
  }

  toolView(owner: DraftOwner, update: ToolCallUpdate): void {
    const turn = owner.turn;
    if (!turn || !this.holds(owner)) return;
    const view = turn.message.toolCalls?.find((call) => call.toolCallId === update.toolCallId);
    if (view && applyToolCallUpdate(view, update)) this.ports.push(owner, { type: "toolcall", id: turn.message.id, toolCall: view });
  }

  update(owner: DraftOwner, update: { sessionUpdate: string } & Record<string, unknown>): void {
    const { runtime } = owner, turn = owner.turn;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const u = update as unknown as { content: ContentBlock; messageId?: string | null };
        const messageId = u.messageId ?? null;
        if (!turn) {
          if (messageId && this.holds(owner)) runtime.work.strayMessageId = messageId;
          return;
        }
        if (messageId && messageId === runtime.work.strayMessageId) return;
        if (!this.holds(owner)) return;
        let text = contentText(u.content);
        if (messageId && !turn.sawMessageId && turn.message.text) {
          const notices = (turn.message.notices ??= []);
          notices.push(turn.message.text.trim());
          turn.message.text = "";
          turn.message.answerFrom = undefined;
          turn.shownLength = 0;
          if (turn.published && (!this.ports.push(owner, { type: "message", message: turn.message }) || !this.holds(owner))) return;
        } else if (messageId !== turn.messageId && turn.message.text) {
          text = "\n\n" + text;
          turn.message.answerFrom = turn.message.text.length + 2;
        }
        if (messageId) turn.sawMessageId = true;
        turn.messageId = messageId;
        const settled = settledVisible(turn.message.text + text);
        const shown = settled.slice(turn.shownLength ?? 0);
        turn.shownLength = settled.length;
        turn.message.text += text;
        if (!turn.published) {
          if (!looksSilent(turn.message.text) && shown) this.show(owner);
          return;
        }
        if (shown) this.ports.push(owner, { type: "chunk", id: turn.message.id, text: shown });
        return;
      }
      case "agent_thought_chunk": {
        if (!turn || !this.holds(owner)) return;
        const text = contentText((update as unknown as { content: ContentBlock }).content);
        turn.message.thought = (turn.message.thought ?? "") + text;
        if (turn.published) this.ports.push(owner, { type: "thought", id: turn.message.id, text });
        return;
      }
      case "tool_call":
      case "tool_call_update": {
        if (!turn || !this.holds(owner)) return;
        if (this.show(owner) === "refused" || !this.holds(owner)) return;
        const u = update as unknown as ToolCallUpdate;
        const calls = (turn.message.toolCalls ??= []);
        let view = calls.find((c) => c.toolCallId === u.toolCallId);
        if (!view) {
          view = { toolCallId: u.toolCallId, title: u.title ?? u.name ?? "tool call" };
          calls.push(view);
        }
        if (!applyToolCallUpdate(view, u) && update.sessionUpdate === "tool_call_update") return;
        this.ports.push(owner, { type: "toolcall", id: turn.message.id, toolCall: view });
        return;
      }
      case "plan": {
        if (!turn || !this.holds(owner)) return;
        if (this.show(owner) === "refused" || !this.holds(owner)) return;
        const entries = (update as unknown as { entries: PlanEntry[] }).entries;
        turn.message.plan = entries;
        this.ports.push(owner, { type: "plan", id: turn.message.id, entries });
        return;
      }
    }
  }
}
