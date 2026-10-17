// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { ContentBlock } from "../acp-types.js";
import type { ChatMessage, OrdinaryPromptPreparation, OrdinaryWakeClaim, Participant, PreparationFields, PromptMemoryNote } from "../room.js";
import type { PromptPart, RoomSettings } from "../persona.js";
import type { BriefSearch } from "../memory/service.js";
import type { AgentRuntime } from "./agent-runtime.js";
import type { QueuedBackgroundCompletion } from "./background-completions.js";
import { composeOrdinaryPrompt, selectBacklog, type ReadAfterGraph, type ReadBeforeGraph } from "./ordinary-prompt.js";

export interface PreparationOwner {
  readonly participant: Participant;
  readonly runtime: AgentRuntime;
}

export interface PreparationCapture {
  readonly wake: OrdinaryWakeClaim;
  readonly completion?: QueuedBackgroundCompletion;
}

type ComposeInput = Parameters<typeof composeOrdinaryPrompt>[0];
type RepairTask = OrdinaryPromptPreparation["repairs"][number];

export interface TurnPreparationPorts {
  messages(): readonly ChatMessage[];
  seq(): number;
  messageCheckRevision(): number;
  settings(): RoomSettings;
  effectiveSettings(): ReadBeforeGraph["settings"];
  persona(participant: Participant): ReadBeforeGraph["persona"];
  roster(): ReadBeforeGraph["roster"];
  skillsForPrompt(owner: PreparationOwner): ReadBeforeGraph["skillsForPrompt"];
  memory(scope: "user" | "room"): ReadBeforeGraph["userMemory"];
  memoryGraph(addressed: number[], seqs: number[]): { revision: string; block: string; search?: BriefSearch } | null;
  memoryWhy(addressed: number[]): string;
  addressedIn(id: string, messages: readonly ChatMessage[]): number[];
  noticeOnly(owner: PreparationOwner): boolean;
  missedChat(owner: PreparationOwner): readonly ChatMessage[];
  automationHas(id: string): boolean;
  repairsHas(id: string): boolean;
  parallelNote(id: string): string | null;
  hops(): number;
  readOnly(): boolean;
  connections(): ReadAfterGraph["connections"];
  notesForBrief(owner: PreparationOwner): ReturnType<ComposeInput["ports"]["notesForBrief"]>;
  earlierChats(beforeSeq: number): number;
  render: ComposeInput["ports"]["render"];
  promptBlocks(prompt: PromptPart[], runtime: AgentRuntime): Promise<ContentBlock[]>;
  automationBlock(id: string): string | null | undefined;
  completionBlock(completion: QueuedBackgroundCompletion): string;
  pendingRepairs(id: string): readonly RepairTask[];
  repairBlock(task: RepairTask): string | null | undefined;
  log(owner: PreparationOwner, text: string): boolean;
}

export type Preparation =
  | { readonly kind: "nothing" }
  | { readonly kind: "prepared"; readonly blocks: ContentBlock[]; readonly preparation: OrdinaryPromptPreparation;
      readonly supplied: NonNullable<ComposeInput["selection"]["supplied"]>; readonly historyNoticeOffered: boolean; readonly memorySearch?: PromptMemoryNote };

export function preparationFields(runtime: AgentRuntime): PreparationFields {
  return { missedNotice: runtime.queue.missedNotice, promptedThisWork: runtime.work.promptedThisWork, turnStartSeq: runtime.reading.turnStartSeq,
    lastSeenSeq: runtime.reading.lastSeenSeq, notesDue: runtime.notes.notesDue, notesAskedThisTurn: runtime.notes.notesAskedThisTurn,
    instructionRevisions: runtime.brief.instructionRevisions, skillCatalogPending: runtime.brief.skillCatalogPending, memoryStamp: runtime.brief.memoryStamp,
    memoryGraphStamp: runtime.brief.memoryGraphStamp, briefPending: runtime.brief.briefPending, turnsSinceBrief: runtime.brief.turnsSinceBrief,
    briefSentThisTurn: runtime.brief.briefSentThisTurn, lastBriefSeq: runtime.brief.lastBriefSeq, resumeNotes: runtime.notes.resumeNotes,
    firstTurnDone: runtime.session.firstTurnDone, replayOwnUntilSeq: runtime.reading.replayOwnUntilSeq };
}

export async function prepareOrdinaryTurn(owner: PreparationOwner, captured: PreparationCapture, ports: TurnPreparationPorts): Promise<Preparation> {
  const { participant, runtime } = owner, id = participant.id, { wake, completion } = captured;
  const unreadAll = ports.messages().filter(
    (m) => m.kind !== "hidden" && m.audience !== "human" && m.seq > runtime.reading.lastSeenSeq && (m.kind === "system" || m.from !== id || m.seq <= runtime.reading.replayOwnUntilSeq),
  );
  if (!unreadAll.some((m) => m.kind === "chat" || m.wakes) && !ports.automationHas(id) && !ports.repairsHas(id) && !completion) return { kind: "nothing" };
  const missed = ports.noticeOnly(owner) ? ports.missedChat(owner).length : 0;
  const expected = preparationFields(runtime), preparedThrough = ports.seq();
  const sourceRevision = ports.messageCheckRevision(), sourceRows = unreadAll.map(row => ({ row, stamp: JSON.stringify(row) }));
  const headerArray = runtime.brief.headerNotes, headers = [...headerArray];
  const skillArray = runtime.skills.pendingSkills, attached = [...skillArray];
  const nativeHeaders = [...(runtime.native.nativeHeaderObligations ?? [])];
  const { unread, omitted, supplied } = selectBacklog(unreadAll, missed, ports.settings().backlogCap);

  const settings = ports.effectiveSettings();
  const before: ReadBeforeGraph = {
    expected, preparedThrough, headers, attached, firstTurnDone: runtime.session.firstTurnDone, instructionRevisions: runtime.brief.instructionRevisions,
    briefPending: runtime.brief.briefPending, turnsSinceBrief: runtime.brief.turnsSinceBrief, lastUsed: runtime.session.lastUsed, usedAtBrief: runtime.brief.usedAtBrief,
    skillCatalogPending: runtime.brief.skillCatalogPending, memoryStamp: runtime.brief.memoryStamp, settings,
    knobs: { fullBriefEveryTurns: ports.settings().fullBriefEveryTurns, fullBriefEveryTokens: ports.settings().fullBriefEveryTokens },
    persona: ports.persona(participant), roster: ports.roster(), skillsForPrompt: ports.skillsForPrompt(owner),
    userMemory: ports.memory("user"), roomMemory: ports.memory("room"),
  };
  const memoryGraph = ports.settings().remembers ? ports.memoryGraph(ports.addressedIn(id, unread), unread.map(m => m.seq)) : null;
  const after: ReadAfterGraph = {
    memoryGraphStamp: runtime.brief.memoryGraphStamp, autoNotes: ports.settings().autoNotes, parallelNote: ports.parallelNote(id), notesDue: runtime.notes.notesDue, lastUsed: runtime.session.lastUsed,
    contextSize: participant.contextSize ?? 0, firstTurnDone: runtime.session.firstTurnDone, skillCatalogPending: runtime.brief.skillCatalogPending,
    historyNoticePending: runtime.reading.historyNoticePending, readOnly: ports.readOnly(), seesImages: runtime.session.agent.acceptsImages, hops: ports.hops(),
    connections: ports.connections(),
  };
  const { prompt, next, notes, briefReason, delivery, sendMemoryGraph, offerHistoryNotice } = composeOrdinaryPrompt({
    participantId: id, participantName: participant.name, missed, selection: { unread, omitted, supplied }, before, graph: memoryGraph, after,
    ports: {
      notesForBrief: () => ports.notesForBrief(owner),
      earlierChats: (beforeSeq) => ports.earlierChats(beforeSeq),
      render: ports.render,
    },
  });
  const memoryWords = !ports.settings().remembers ? "off"
    : memoryGraph ? `${sendMemoryGraph ? "sent" : "unchanged, not sent again"} for #${memoryGraph.search?.seq ?? "?"}`
    : ports.memoryWhy(ports.addressedIn(id, unread));
  ports.log(owner, `turn: ${unread.length} unread (${omitted} omitted), full refresh=${briefReason ?? "no"}, blocks=${[delivery.brief && "brief", delivery.roomRules && "rules", delivery.vibio && "vibio"].filter(Boolean).join(",") || "none"}, memory=${memoryWords}, notes=${notes.length}`);

  const blocks = await ports.promptBlocks(prompt, runtime);
  const automationBlock = ports.automationBlock(id);
  if (completion) blocks.push({ type: "text", text: ports.completionBlock(completion) });
  const repairs: RepairTask[] = [];
  for (const task of ports.pendingRepairs(id)) {
    if (task.delivered) continue;
    const text = ports.repairBlock(task);
    repairs.push(task);
    if (text) blocks.push({ type: "text", text });
  }
  if (automationBlock) blocks.unshift({ type: "text", text: automationBlock });
  const memorySearch = memoryGraph?.search ? { ...memoryGraph.search, sent: sendMemoryGraph } : undefined;
  const preparation: OrdinaryPromptPreparation = { wake, expected, next, headerArray, headers, skillArray, skills: attached,
    nativeHeaders, bodies: missed ? [] : unreadAll, sourceRevision, sourceRows, brief: !!delivery.brief, repairs, ...(completion ? { completion } : {}) };
  return { kind: "prepared", blocks, preparation, supplied, historyNoticeOffered: offerHistoryNotice, ...(memorySearch ? { memorySearch } : {}) };
}
