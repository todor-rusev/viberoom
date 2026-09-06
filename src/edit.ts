// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import type { ChatMessage } from "./room.js";

export type EditMode = "rewrite" | "notify";

export interface AgentReadState {
  id: string;
  name: string;
  lastSeenSeq: number;
  active: boolean;
  online: boolean;
}

export function partitionHistory(messages: ChatMessage[], editedSeq: number): { kept: ChatMessage[]; removed: ChatMessage[] } {
  const kept: ChatMessage[] = [];
  const removed: ChatMessage[] = [];
  for (const m of messages) (m.seq > editedSeq ? removed : kept).push(m);
  return { kept, removed };
}

export function affectedByEdit(agents: AgentReadState[], editedSeq: number): { restart: AgentReadState[]; untouched: AgentReadState[]; offline: AgentReadState[] } {
  const restart: AgentReadState[] = [];
  const untouched: AgentReadState[] = [];
  const offline: AgentReadState[] = [];
  for (const a of agents) {
    const saw = a.lastSeenSeq >= editedSeq || a.active;
    if (!a.online) (saw ? offline : untouched).push(a);
    else (saw ? restart : untouched).push(a);
  }
  return { restart, untouched, offline };
}

const QUOTE_MAX = 240;
const FULL_MAX = 4000;

function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX)}…` : flat;
}

function full(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > FULL_MAX ? `${trimmed.slice(0, FULL_MAX)}…` : trimmed;
}

export function editNotice(humanName: string, previous: string, next: string): string {
  const added = next.startsWith(previous) ? next.slice(previous.length).trim() : "";
  const body = added
    ? `They added to the end of it:\n\n"${full(added)}"`
    : `It now reads:\n\n"${full(next)}"\n\nBefore: "${quote(previous)}"`;
  return `${humanName} edited an earlier message. ${body}\n\nReply only if the change matters to you; otherwise [silent].`;
}

export function rewriteNotice(humanName: string, removedCount: number, restarted: string[]): string {
  const removed = removedCount === 1 ? "1 later message" : `${removedCount} later messages`;
  const who = restarted.length ? ` ${restarted.join(", ")} restarted with a fresh session and the conversation up to here.` : "";
  return `${humanName} rewrote the conversation from here (${removed} removed).${who}`;
}
