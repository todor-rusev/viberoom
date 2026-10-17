// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Attachment } from "../files.js";
import type { BodyRef } from "../body-delivery.js";
import { bodyRefs } from "../body-delivery.js";
import { NOTES_REQUEST, overThreshold } from "../context.js";
import { instructionBlock, planInstructionDelivery, type InstructionRevisions } from "../instruction-delivery.js";
import {
  buildBrief, buildHeader, buildInstructionContents, composePrompt, composeSkillBlock, replyLanguageClause,
  type BacklogAudio, type BacklogImage, type BacklogLine, type BacklogQuote, type BacklogVideo, type BriefNotes, type Persona,
  type PromptPart, type RosterEntry, type RoomSettings, type SkillsForPrompt,
} from "../persona.js";
import { memoryBlock, type MemoryState } from "../shared-memory.js";
import type { ChatMessage, PendingSkill, PreparationFields } from "../room.js";

export interface BacklogSelection {
  unread: ChatMessage[];
  omitted: number;
  supplied: BodyRef[];
}

export function selectBacklog(unreadAll: ChatMessage[], missed: number, cap: number): BacklogSelection {
  const omitted = missed ? 0 : Math.max(0, unreadAll.length - cap);
  const unread = missed ? [] : omitted ? unreadAll.slice(omitted) : unreadAll;
  return { unread, omitted, supplied: bodyRefs(unread) };
}

export interface ReadBeforeGraph {
  expected: PreparationFields;
  preparedThrough: number;
  headers: string[];
  attached: PendingSkill[];
  firstTurnDone: boolean;
  instructionRevisions?: InstructionRevisions;
  briefPending: string | null;
  turnsSinceBrief: number;
  lastUsed: number;
  usedAtBrief: number;
  skillCatalogPending?: boolean;
  memoryStamp?: string;
  settings: RoomSettings;
  knobs: { fullBriefEveryTurns: number; fullBriefEveryTokens: number };
  persona: Persona;
  roster: RosterEntry[];
  skillsForPrompt: SkillsForPrompt | undefined;
  userMemory: MemoryState;
  roomMemory: MemoryState;
}

export type MemoryGraphAnswer = { revision: string; block: string; search?: unknown } | null;

export interface ReadAfterGraph {
  memoryGraphStamp?: string;
  autoNotes: boolean;
  parallelNote: string | null;
  notesDue: boolean;
  lastUsed: number;
  contextSize: number;
  firstTurnDone: boolean;
  skillCatalogPending?: boolean;
  historyNoticePending: boolean;
  readOnly: boolean;
  seesImages: boolean;
  hops: number;
  connections: readonly string[];
}

export interface PromptPorts {
  notesForBrief(): BriefNotes | undefined;
  earlierChats(beforeSeq: number): number;
  render: {
    text(m: ChatMessage): string;
    audio(m: ChatMessage): BacklogAudio[] | undefined;
    video(m: ChatMessage): BacklogVideo[] | undefined;
    attachmentPath(a: Attachment): string;
  };
}

export interface OrdinaryPromptInput {
  participantId: string;
  participantName: string;
  missed: number;
  selection: BacklogSelection;
  before: ReadBeforeGraph;
  graph: MemoryGraphAnswer;
  after: ReadAfterGraph;
  ports: PromptPorts;
}

export interface OrdinaryPrompt {
  prompt: PromptPart[];
  next: PreparationFields;
  notes: string[];
  briefReason: string | null;
  delivery: ReturnType<typeof planInstructionDelivery>;
  sendMemory: boolean;
  sendMemoryGraph: boolean;
  offerHistoryNotice: boolean;
}

export function composeOrdinaryPrompt(input: OrdinaryPromptInput): OrdinaryPrompt {
  const { participantId: id, participantName, missed, selection: { unread, omitted }, before, graph, after, ports } = input;
  const { expected, preparedThrough, headers, attached, settings, persona, roster, skillsForPrompt } = before;

  const tokensSinceBrief = before.lastUsed - before.usedAtBrief;
  const memoryStamp = `${before.userMemory.revision}:${before.roomMemory.revision}`;
  let briefReason: string | null = null;
  if (!before.firstTurnDone || !before.instructionRevisions) briefReason = "first turn";
  else if (before.briefPending) briefReason = before.briefPending;
  else if (before.turnsSinceBrief >= before.knobs.fullBriefEveryTurns) briefReason = `every ${before.knobs.fullBriefEveryTurns} turns`;
  else if (tokensSinceBrief >= before.knobs.fullBriefEveryTokens) briefReason = `${tokensSinceBrief} tokens since last brief`;

  const contents = buildInstructionContents(settings, persona, roster, skillsForPrompt);
  const delivery = planInstructionDelivery(contents, before.instructionRevisions, briefReason !== null, before.skillCatalogPending);
  const sendMemory = delivery.full || before.memoryStamp !== memoryStamp;
  const sendMemoryGraph = !!graph && (delivery.full || after.memoryGraphStamp !== graph.revision);

  const notes = [...headers];
  if (missed) notes.push(`${missed} message${missed === 1 ? "" : "s"} arrived while you were working; none was addressed to you. Read ${missed === 1 ? "it" : "them"} with check_room if the conversation may concern you, then answer or reply [silent]. Either way ${missed === 1 ? "it arrives" : "they arrive"} again with your next turn.`);
  if (after.parallelNote) notes.push(after.parallelNote);
  const notesDue = after.notesDue || !!(after.autoNotes && briefReason && overThreshold(after.lastUsed, after.contextSize));
  if (notesDue) notes.push(NOTES_REQUEST);
  if (briefReason && after.firstTurnDone) {
    if (briefReason.startsWith("requested")) notes.push("full brief re-sent as requested");
    else notes.push(`full brief re-attached (${briefReason})`);
  }
  if (!delivery.full) {
    const updated = [delivery.brief && "room-brief", delivery.roomRules && "room-rules", delivery.vibio && "vibio"].filter(Boolean);
    if (updated.length) notes.push(`instructions updated (${updated.join(", ")}); each supplied block replaces its previous version`);
    if (sendMemory) notes.push("shared memory changed");
    if (sendMemoryGraph) notes.push("memory-graph refreshed; it replaces the previous memory-graph block");
  }
  notes.push(`instruction versions: room-rules=${delivery.revisions.roomRules}, vibio=${delivery.revisions.vibio}`);
  if (after.skillCatalogPending) notes.push("your skill library changed; reload an affected skill before using its instructions again");
  for (const s of attached) {
    notes.push(s.invokedBy ? `${s.invokedBy} invoked your skill "${s.name}"; its instructions are attached below, follow them` : `skill "${s.name}" attached below as you asked; the same messages follow`);
  }
  const offerHistoryNotice = !missed && after.historyNoticePending && skillsForPrompt?.channel === "tool" && !after.readOnly;
  if (offerHistoryNotice) {
    const earlier = ports.earlierChats(Math.min(...unread.map(m => m.seq)));
    if (earlier) notes.push(`${earlier} earlier chat message${earlier === 1 ? " is" : "s are"} outside this prompt; use search_history to find ${earlier === 1 ? "it" : "them"}.`);
  }
  const backlogImages = (m: ChatMessage): BacklogImage[] | undefined => {
    if (!m.images || !m.images.length) return undefined;
    const attachedHere = after.seesImages && (m.to.length === 0 || m.to.includes(id));
    return m.images.map((a, i) => ({ n: a.n ?? i + 1, ref: `#${m.seq}.${a.n ?? i + 1}`, name: a.name, path: ports.render.attachmentPath(a), mimeType: a.mimeType, attached: attachedHere, forNames: m.to.length ? m.toNames : [] }));
  };
  const backlogQuotes = (m: ChatMessage): BacklogQuote[] | undefined =>
    m.quotes && m.quotes.length ? m.quotes.map((q) => ({ n: q.n, seq: q.seq, fromName: q.fromName, ts: q.ts, text: q.text })) : undefined;
  const prompt = composePrompt({
    brief: delivery.brief ? buildBrief(settings, persona, roster, ports.notesForBrief(), skillsForPrompt) : undefined,
    roomRules: delivery.roomRules ? instructionBlock("room-rules", contents.roomRules) : undefined,
    vibio: delivery.vibio ? instructionBlock("vibio", contents.vibio) : undefined,
    header: buildHeader(settings, persona, roster, after.hops, notes, skillsForPrompt, after.connections),
    memory: sendMemory ? memoryBlock(before.userMemory, before.roomMemory) : undefined,
    memoryGraph: sendMemoryGraph ? graph!.block : undefined,
    skills: attached.map((s) => composeSkillBlock({ name: s.name, text: s.text, invokedBy: s.invokedBy, extraFiles: s.extraFiles })),
    backlog: unread.map<BacklogLine>((m) =>
      m.kind === "system"
        ? { kind: "event", text: ports.render.text(m) }
        : {
            kind: "message",
            fromName: m.from === id ? `${m.fromName} (you, earlier)` : m.fromName,
            toNames: m.toNames,
            text: ports.render.text(m),
            images: backlogImages(m),
            quotes: backlogQuotes(m),
            audio: ports.render.audio(m),
            video: ports.render.video(m),
          },
    ),
    omitted,
    personaName: participantName,
    replyLanguage: replyLanguageClause(settings),
  });
  const next: PreparationFields = { ...expected, missedNotice: false, promptedThisWork: !missed,
    turnStartSeq: missed ? expected.turnStartSeq : expected.lastSeenSeq, lastSeenSeq: missed ? expected.lastSeenSeq : preparedThrough,
    notesDue, notesAskedThisTurn: notesDue, instructionRevisions: delivery.revisions, skillCatalogPending: false,
    memoryStamp: sendMemory ? memoryStamp : expected.memoryStamp, memoryGraphStamp: sendMemoryGraph ? graph!.revision : expected.memoryGraphStamp,
    briefPending: delivery.full ? null : expected.briefPending, turnsSinceBrief: delivery.full ? 0 : expected.turnsSinceBrief,
    briefSentThisTurn: delivery.full ? true : expected.briefSentThisTurn, lastBriefSeq: delivery.brief ? preparedThrough : expected.lastBriefSeq,
    resumeNotes: delivery.brief ? null : expected.resumeNotes, firstTurnDone: true, replayOwnUntilSeq: -1 };
  return { prompt, next, notes, briefReason, delivery, sendMemory, sendMemoryGraph, offerHistoryNotice };
}
