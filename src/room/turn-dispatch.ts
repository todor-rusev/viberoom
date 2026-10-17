// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import type { ContentBlock, PromptResult } from "../acp-types.js";
import type { ChatMessage, NativeObligationRef, OrdinaryPromptPreparation, OrdinaryWakeClaim, Participant, RetryRequest, TurnExtras } from "../room.js";
import type { AgentRuntime, RuntimeWork, WorkGate, WorkHold } from "./agent-runtime.js";

export type DispatchTurn = NonNullable<RuntimeWork["turn"]>;

export interface DispatchOwner {
  readonly participant: Participant;
  readonly runtime: AgentRuntime;
  readonly gate: WorkGate;
  readonly turn: DispatchTurn;
}

export type SendAnswer = { readonly sent: Promise<PromptResult> } | { readonly unsent: "gone" | "deferred" };

export interface TurnDispatchPorts {
  startTurn(owner: DispatchOwner): boolean;
  holdDraft(draft: ChatMessage): void;
  releaseDraft(draft: ChatMessage): void;
  turnDiscarded(participant: Participant, runtime: AgentRuntime): void;
  ownerCurrent(owner: DispatchOwner): boolean;
  nativeLaneBlocked(runtime: AgentRuntime): boolean;
  wakeDisposition(wake: OrdinaryWakeClaim, participant: Participant, runtime: AgentRuntime): "allowed" | "suppressed" | "held";
  consumeNativeWake(runtime: AgentRuntime, refs: readonly NativeObligationRef[]): void;
  preparationCurrent(plan: OrdinaryPromptPreparation): boolean;
  nativeEligible(ref: NativeObligationRef, participant: Participant, runtime: AgentRuntime): boolean;
  startNative(ref: NativeObligationRef, participant: Participant, runtime: AgentRuntime): boolean;
  nativeTransition(ref: NativeObligationRef, phase: "applied_local" | "completed" | "attempt_unknown"): void;
  nativeFault(participant: Participant, runtime: AgentRuntime, reason: string): void;
  recordPrompt(draft: ChatMessage, participant: Participant, blocks: ContentBlock[], hidden: boolean, correction: boolean, extras: TurnExtras): void;
  send(owner: DispatchOwner, blocks: ContentBlock[], extras: TurnExtras): SendAnswer;
  metadata(owner: DispatchOwner, extras: TurnExtras, epoch: string | undefined): unknown[];
  log(runtime: AgentRuntime, text: string): void;
}

export type DispatchOutcome =
  | { readonly kind: "unsent"; readonly draft: ChatMessage }
  | { readonly kind: "late"; readonly draft: ChatMessage }
  | { readonly kind: "settled"; readonly draft: ChatMessage; readonly turn: DispatchTurn; readonly result: PromptResult | null;
      readonly failure: string | null; readonly failureCode: string; readonly startedAt: number; readonly published: boolean; readonly publishedAt: number | null };

function defer(runtime: AgentRuntime, retry: RetryRequest | null, extras: TurnExtras): void {
  if (extras.ordinaryPreparation) {
    runtime.queue.independentPendingTurn ||= extras.ordinaryPreparation.wake.independent;
    runtime.queue.pendingTurn = true;
  } else if (retry) {
    const corrections = runtime.native.backgroundCorrections ??= [];
    runtime.native.backgroundBacklogPending ||= runtime.queue.pendingTurn;
    if (!corrections.includes(retry)) corrections.unshift(retry);
    runtime.queue.pendingTurn = true;
  } else if (extras.hidden) runtime.notes.deferredNotesTurn = true;
}

export async function dispatchTurn(participant: Participant, hold: WorkHold, blocks: ContentBlock[], retry: RetryRequest | null,
  extras: TurnExtras, errorName: (error: unknown) => string, describeError: (error: unknown) => string, ports: TurnDispatchPorts): Promise<DispatchOutcome> {
  const { hidden = false } = extras;
  const { runtime, gate } = hold;
  if (ports.nativeLaneBlocked(runtime) || runtime.work.turnActive || runtime.work.turn) throw new Error(`${participant.name} is already answering or has held native delivery`);
  const draft: ChatMessage = { id: randomUUID(), seq: 0, from: participant.id, fromName: participant.name, to: [], toNames: [], text: "", ts: Date.now(), kind: "chat", streaming: true, toolCalls: [] };
  const turn: DispatchTurn = { message: draft, messageId: null, sawMessageId: false, startedAt: Date.now(), published: false, hidden, messagesFromSeq: runtime.reading.lastSeenSeq,
    inputThrough: extras.ordinaryPreparation?.next.lastSeenSeq };
  runtime.work.turnActive = true;
  runtime.work.turn = turn;
  const owner: DispatchOwner = { participant, runtime, gate, turn };

  let result: PromptResult | null = null;
  let failure: string | null = null;
  let failureCode = "";
  const nativeCorrection = retry?.nativeObligation;
  const nativePrompts = extras.ordinaryPreparation?.wake.native ?? (extras.nativeHeaderOffered ? [...(runtime.native.nativePromptObligations ?? [])] : []);
  const startedNative: NativeObligationRef[] = [];
  const unsent = (): DispatchOutcome => {
    ports.releaseDraft(draft);
    if (runtime.work.turn === turn) {
      runtime.work.turn = null;
      runtime.work.turnActive = false;
      ports.turnDiscarded(participant, runtime);
    }
    return { kind: "unsent", draft };
  };
  try {
    ports.holdDraft(draft);
    if (!ports.startTurn(owner)) return unsent();
  } catch (error) { unsent(); throw error; }
  try {
    const epoch = participant.deliveryEpoch;
    if (!ports.ownerCurrent(owner)) return unsent();
    if (ports.nativeLaneBlocked(runtime)) {
      defer(runtime, retry, extras);
      return unsent();
    }
    if (extras.ordinaryPreparation) {
      const disposition = ports.wakeDisposition(extras.ordinaryPreparation.wake, participant, runtime);
      if (disposition !== "allowed") {
        if (disposition === "suppressed") ports.consumeNativeWake(runtime, nativePrompts);
        else runtime.queue.pendingTurn = true;
        return unsent();
      }
      if (!ports.preparationCurrent(extras.ordinaryPreparation)) {
        runtime.queue.independentPendingTurn ||= extras.ordinaryPreparation.wake.independent;
        runtime.queue.pendingTurn = true;
        return unsent();
      }
    }
    if (nativeCorrection && !ports.nativeEligible(nativeCorrection, participant, runtime)) return unsent();
    ports.recordPrompt(draft, participant, blocks, hidden, retry !== null, extras);
    if (extras.nativeHeaderOffered) {
      const captured = extras.ordinaryPreparation?.nativeHeaders ?? [...(runtime.native.nativeHeaderObligations ?? [])];
      for (const ref of captured) ports.nativeTransition(ref, "applied_local");
      runtime.native.nativeHeaderObligations = (runtime.native.nativeHeaderObligations ?? []).filter(ref => !captured.some(old => old.obligationId === ref.obligationId));
    }
    for (const ref of nativePrompts) if (ports.startNative(ref, participant, runtime)) startedNative.push(ref);
    if (extras.nativeHeaderOffered) ports.consumeNativeWake(runtime, nativePrompts);
    if (nativeCorrection) {
      if (!ports.startNative(nativeCorrection, participant, runtime)) return unsent();
      startedNative.push(nativeCorrection);
    }
    const answer = ports.send(owner, blocks, extras);
    if ("unsent" in answer) {
      if (answer.unsent === "deferred") defer(runtime, retry, extras);
      for (const ref of startedNative) {
        try { ports.nativeTransition(ref, "attempt_unknown"); }
        catch { ports.nativeFault(participant, runtime, "native_attempt_unknown"); }
      }
      return unsent();
    }
    let metadataFailures: unknown[];
    try { metadataFailures = ports.metadata(owner, extras, epoch); }
    catch (error) { metadataFailures = [error]; }
    try { result = await answer.sent; }
    finally {
      for (const error of metadataFailures) {
        try { ports.log(runtime, `prompt body metadata failed after dispatch: ${describeError(error)}`); }
        catch { }
      }
    }
  } catch (error) {
    failureCode = errorName(error);
    failure = describeError(error);
  }
  for (const ref of startedNative) {
    try { ports.nativeTransition(ref, result ? "completed" : "attempt_unknown"); }
    catch { ports.nativeFault(participant, runtime, "native_attempt_unknown"); }
  }
  if (runtime.work.turn !== turn) {
    ports.releaseDraft(draft);
    return { kind: "late", draft };
  }
  const startedAt = turn.startedAt, published = turn.published, publishedAt = turn.publishedAt ?? null;
  runtime.work.turn = null;
  runtime.work.turnActive = false;
  ports.releaseDraft(draft);
  return { kind: "settled", draft, turn, result, failure, failureCode, startedAt, published, publishedAt };
}
