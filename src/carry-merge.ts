// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import { ancestor, carryHash, carryRevision, type CarryAlternative, type CarryHead, type CarryRevision } from "./carry-history.js";
import type { ChatMessage } from "./room.js";

export interface CarryState { message: ChatMessage; deletedAt: number | null; head: CarryHead }
export interface CarryBranch { key: string; changed: number; localContinuation: number; incomingContinuation: number; examples: { id: string; ours: string; incoming: string }[]; members: { changed: string[]; ours: string[]; incoming: string[] } }
export type BranchChoice = "ours" | "incoming" | "both";
export interface MergeInput { states: CarryState[]; revisions: CarryRevision[]; alternatives: CarryAlternative[]; source: string }
export interface MergePlan { states: CarryState[]; revisions: CarryRevision[]; alternatives: CarryAlternative[]; branch: CarryBranch | null; counts: { added: number; replaced: number; removed: number; same: number; alternatives: number } }

function ordered(states: CarryState[]): CarryState[] { return [...states].sort((a, b) => (a.message.displayOrder ?? a.message.seq) - (b.message.displayOrder ?? b.message.seq) || a.message.id.localeCompare(b.message.id)); }
function preview(state: CarryState): string { return state.deletedAt !== null ? "[removed] " + state.message.text.slice(0, 180) : state.message.text.slice(0, 180); }

function completeReferences(base: CarryState, other: CarryState): CarryState {
  const message = { ...base.message };
  if (message.quotes) message.quotes = message.quotes.map((q, i) => q.id || !other.message.quotes?.[i]?.id ? q : { ...q, id: other.message.quotes[i].id });
  if (message.images) message.images = message.images.map((image, i) => image.sha256 || !other.message.images?.[i]?.sha256 ? image : { ...image, sha256: other.message.images[i].sha256 });
  const refs = new Map((message.resourceRefs ?? []).map(ref => [ref.source, ref]));
  for (const ref of other.message.resourceRefs ?? []) if (message.text.includes(ref.source)) {
    const held = refs.get(ref.source);
    if (!held) refs.set(ref.source, ref);
    else if (!held.sha256 && ref.sha256) refs.set(ref.source, { ...held, sha256: ref.sha256 });
  }
  if (refs.size) message.resourceRefs = [...refs.values()];
  if (carryHash(message, base.deletedAt) !== base.head.hash) return base;
  return { ...base, message };
}

export function mergeCarried(ours: MergeInput, incoming: MergeInput, choice?: BranchChoice): MergePlan {
  const graph = new Map([...ours.revisions, ...incoming.revisions].map(r => [r.revision, r]));
  const here = new Map(ours.states.map(s => [s.message.id, s])), there = new Map(incoming.states.map(s => [s.message.id, s]));
  for (const list of [ours.states, incoming.states]) {
    if (new Set(list.map(s => s.message.id)).size !== list.length) throw new Error("The archive repeats a message identity.");
    for (const state of list) {
      const node = graph.get(state.head.revision);
      if (!node || node.id !== state.message.id || state.head.id !== state.message.id || node.hash !== state.head.hash || state.head.hash !== carryHash(state.message, state.deletedAt)) throw new Error("A carried message does not match its revision.");
    }
  }
  const common = new Set([...here.keys()].filter(id => there.has(id)));
  function tail(states: CarryState[], other: ReadonlyMap<string, CarryState>): CarryState[] {
    const list = ordered(states);
    let last = -1;
    list.forEach((s, i) => { if (common.has(s.message.id)) last = i; });
    return list.slice(last + 1).filter(s => !other.has(s.message.id) && s.deletedAt === null);
  }
  const localTail = tail(ours.states, there), remoteTail = tail(incoming.states, here);
  const parallel = localTail.some(s => s.message.kind === "chat") && remoteTail.some(s => s.message.kind === "chat");
  const conflicts: string[] = [];
  for (const [id, remote] of there) {
    const local = here.get(id);
    if (local && local.head.hash !== remote.head.hash && !ancestor(graph, local.head.revision, remote.head.revision) && !ancestor(graph, remote.head.revision, local.head.revision)) conflicts.push(id);
  }
  const branch: CarryBranch | null = conflicts.length || parallel ? {
    key: createHash("sha256").update(JSON.stringify([conflicts.sort().map(id => [here.get(id)!.head.revision, there.get(id)!.head.revision]), parallel ? localTail.map(s => s.head.revision).sort() : [], parallel ? remoteTail.map(s => s.head.revision).sort() : []])).digest("hex"),
    changed: conflicts.length, localContinuation: parallel ? localTail.length : 0, incomingContinuation: parallel ? remoteTail.length : 0,
    examples: conflicts.slice(0, 5).map(id => ({ id, ours: preview(here.get(id)!), incoming: preview(there.get(id)!) })),
    members: { changed: conflicts, ours: parallel ? localTail.map(s => s.message.id) : [], incoming: parallel ? remoteTail.map(s => s.message.id) : [] },
  } : null;
  const counts = { added: 0, replaced: 0, removed: 0, same: 0, alternatives: 0 };
  if (branch && !choice) return { states: [], revisions: [], alternatives: [], branch, counts };
  const result = new Map(here), addedNodes = new Map<string, CarryRevision>();
  const alternatives = new Map([...ours.alternatives, ...incoming.alternatives].map(a => [a.revision, a]));
  const conflictSet = new Set(conflicts), localTailIds = new Set(localTail.map(s => s.message.id)), remoteTailIds = new Set(remoteTail.map(s => s.message.id));
  function archive(state: CarryState) { alternatives.set(state.head.revision, { revision: state.head.revision, message: state.message, deletedAt: state.deletedAt }); }
  function revise(state: CarryState, parents: string[]): CarryState {
    const node = carryRevision(state.message.id, carryHash(state.message, state.deletedAt), parents);
    graph.set(node.revision, node); addedNodes.set(node.revision, node);
    return { ...state, head: { id: node.id, revision: node.revision, hash: node.hash } };
  }
  function bury(state: CarryState): CarryState {
    archive(state);
    return revise({ ...state, deletedAt: Date.now() }, [state.head.revision]);
  }
  function badge(state: CarryState, source: string): CarryState {
    return { ...state, message: { ...state.message, branch: state.message.branch ?? { source, revision: state.head.revision } } };
  }
  for (const [id, remote] of there) {
    const local = here.get(id);
    if (!local) {
      result.set(id, parallel && remoteTailIds.has(id) && choice === "ours" ? bury(remote) : parallel && remoteTailIds.has(id) ? badge(remote, incoming.source) : remote);
      continue;
    }
    if (conflictSet.has(id)) {
      archive(local); archive(remote);
      let selected: CarryState;
      if (choice === "ours") selected = local;
      else if (choice === "incoming") selected = remote;
      else {
        const pair = [local, remote].sort((a, b) => a.deletedAt === null && b.deletedAt !== null ? -1 : a.deletedAt !== null && b.deletedAt === null ? 1 : a.head.revision.localeCompare(b.head.revision));
        selected = pair[0];
        const second = pair[1];
        if (second.deletedAt === null) {
          const forkId = `variant-${createHash("sha256").update(id + "\0" + second.head.revision).digest("hex").slice(0, 32)}`;
          const forkMessage: ChatMessage = { ...second.message, id: forkId, variantOf: { id, revision: second.head.revision } };
          const fork = revise({ message: forkMessage, deletedAt: null, head: second.head }, []);
          result.set(forkId, badge(fork, second === local ? ours.source : incoming.source));
        }
      }
      result.set(id, badge(revise(selected, [local.head.revision, remote.head.revision]), selected === local ? ours.source : incoming.source));
    } else if (local.head.hash === remote.head.hash) {
      const selected = ancestor(graph, remote.head.revision, local.head.revision) ? local : ancestor(graph, local.head.revision, remote.head.revision) ? remote : revise(local, [local.head.revision, remote.head.revision]);
      result.set(id, completeReferences(selected, selected === remote ? local : remote));
    } else if (ancestor(graph, local.head.revision, remote.head.revision)) {
      archive(local);
      result.set(id, remote);
    }
  }
  if (parallel) for (const id of localTailIds) {
    const local = here.get(id)!;
    result.set(id, choice === "incoming" ? bury(local) : badge(local, ours.source));
  }
  for (const [id, state] of result) {
    const before = here.get(id);
    if (!before) { if (state.deletedAt === null) counts.added++; else counts.removed++; }
    else if (before.head.hash === state.head.hash) counts.same++;
    else if (state.deletedAt !== null) counts.removed++;
    else counts.replaced++;
  }
  counts.alternatives = alternatives.size - ours.alternatives.length;
  const ids = ordered(ours.states).map(s => s.message.id);
  let segment: string[] = [];
  for (const state of ordered(incoming.states)) {
    const id = state.message.id;
    if (here.has(id)) {
      if (segment.length) { ids.splice(ids.indexOf(id), 0, ...segment); segment = []; }
    } else segment.push(id);
  }
  ids.push(...segment);
  const placed = new Set(ids);
  for (const [id, state] of result) if (!placed.has(id)) {
    const original = state.message.variantOf?.id;
    const at = original ? ids.indexOf(original) : -1;
    ids.splice(at < 0 ? ids.length : at + 1, 0, id);
    placed.add(id);
  }
  return { states: ids.map(id => result.get(id)!), revisions: [...new Map([...ours.revisions, ...incoming.revisions, ...addedNodes.values()].map(r => [r.revision, r])).values()], alternatives: [...alternatives.values()], branch, counts };
}
