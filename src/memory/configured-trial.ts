// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { MemoryPipeline } from "./service.js";
import type { MemoryConfigStore } from "./config.js";
import type { LoadedTrialPreparation } from "./provider.js";
import { chatCompletionsUrl } from "./chat-endpoint.js";

export interface ConfiguredTrialSelection {
  roomIds: readonly string[];
  opIds: readonly string[];
  answerKeyOwner: "memory.filter.apiKey";
  answerEndpoint: string;
  answerModel: string;
}

export type ConfiguredTrialAccountSelection = Pick<ConfiguredTrialSelection, "answerKeyOwner" | "answerEndpoint" | "answerModel">;

export function configuredAnswerContext(owners: { memoryStore: Pick<MemoryConfigStore, "get" | "trialRevision"> }, input: ConfiguredTrialAccountSelection) {
  if (input.answerKeyOwner !== "memory.filter.apiKey" || !input.answerEndpoint || !input.answerModel)
    throw new Error("configured_trial_answer_owner_required");
  if (Object.keys(input).sort().join(",") !== ["answerKeyOwner", "answerEndpoint", "answerModel"].sort().join(","))
    throw new Error("configured_trial_account_selection_fields");
  const selection = Object.freeze({ ...input });
  const snapshot = () => {
    const revision = owners.memoryStore.trialRevision(), config = owners.memoryStore.get();
    let endpoint: string;
    try { endpoint = chatCompletionsUrl(config.filter.baseUrl).href; }
    catch { return null; }
    if (endpoint !== selection.answerEndpoint || revision !== owners.memoryStore.trialRevision()) return null;
    return { configurationRevision: revision, answer: { owner: selection.answerKeyOwner, endpoint, model: selection.answerModel }, selection };
  };
  return Object.freeze({ snapshot });
}

export function configuredTrialAccountContext(owners: {
  memory: Pick<MemoryPipeline, "inspectLoadedTrialAccount" | "loadedTrialPreparation">;
  memoryStore: Pick<MemoryConfigStore, "get" | "trialRevision">;
}, input: ConfiguredTrialAccountSelection) {
  if (input.answerKeyOwner !== "memory.filter.apiKey" || !input.answerEndpoint || !input.answerModel)
    throw new Error("configured_trial_answer_owner_required");
  if (Object.keys(input).sort().join(",") !== ["answerKeyOwner", "answerEndpoint", "answerModel"].sort().join(","))
    throw new Error("configured_trial_account_selection_fields");
  const selection = Object.freeze({ ...input });
  const snapshot = () => {
    const revision = owners.memoryStore.trialRevision(), config = owners.memoryStore.get();
    const loaded = owners.memory.inspectLoadedTrialAccount();
    if (!loaded || config.provider !== "zep") return null;
    let endpoint: string;
    try { endpoint = chatCompletionsUrl(config.filter.baseUrl).href; }
    catch { return null; }
    if (endpoint !== selection.answerEndpoint || revision !== owners.memoryStore.trialRevision()) return null;
    return { ...loaded, configurationRevision: revision,
      answer: { owner: selection.answerKeyOwner, endpoint, model: selection.answerModel }, selection };
  };
  const preparation = (): LoadedTrialPreparation | null => {
    const initial = snapshot(), cached = initial && owners.memory.loadedTrialPreparation();
    if (!initial || !cached || cached.loadedRevision !== initial.loadedRevision || cached.generations.account !== initial.accountId ||
        JSON.stringify(snapshot()) !== JSON.stringify(initial)) return null;
    const original = cached.writes.originalMessage;
    if (!original) return null;
    const sync = <T>(operation: () => T): T => {
      if (JSON.stringify(snapshot()) !== JSON.stringify(initial)) throw new Error("configured_trial_preparation_changed");
      const value = operation();
      if (value && typeof (value as unknown as { then?: unknown }).then === "function") throw new Error("configured_trial_preparation_async");
      if (JSON.stringify(snapshot()) !== JSON.stringify(initial)) throw new Error("configured_trial_preparation_changed");
      return value;
    };
    return Object.freeze({ id: "zep" as const, loadedRevision: cached.loadedRevision, generations: cached.generations,
      writes: Object.freeze({ episodeTextLimit: cached.writes.episodeTextLimit,
        episode: (...args: Parameters<typeof cached.writes.episode>) => sync(() => cached.writes.episode(...args)),
        originalMessage: Object.freeze({ bytesPerCredit: original.bytesPerCredit,
          validatePolicy: (...args: Parameters<typeof original.validatePolicy>) => sync(() => original.validatePolicy(...args)),
          buildPart: (...args: Parameters<typeof original.buildPart>) => sync(() => original.buildPart(...args)),
          validatePart: (...args: Parameters<typeof original.validatePart>) => sync(() => original.validatePart(...args)) }) }) });
  };
  return Object.freeze({ snapshot, preparation });
}

export function configuredTrialContext(owners: {
  memory: Pick<MemoryPipeline, "inspectLoadedTrial">;
  memoryStore: Pick<MemoryConfigStore, "get" | "trialRevision">;
}, input: ConfiguredTrialSelection) {
  if (input.answerKeyOwner !== "memory.filter.apiKey" || !input.answerEndpoint || !input.answerModel)
    throw new Error("configured_trial_answer_owner_required");
  if (Object.keys(input).sort().join(",") !== ["roomIds", "opIds", "answerKeyOwner", "answerEndpoint", "answerModel"].sort().join(","))
    throw new Error("configured_trial_selection_fields");
  const selection = Object.freeze({ roomIds: Object.freeze([...input.roomIds]), opIds: Object.freeze([...input.opIds]),
    answerKeyOwner: input.answerKeyOwner, answerEndpoint: input.answerEndpoint, answerModel: input.answerModel });
  const snapshot = () => {
    const revision = owners.memoryStore.trialRevision(), config = owners.memoryStore.get();
    const loaded = owners.memory.inspectLoadedTrial(selection.roomIds, selection.opIds);
    if (!loaded || config.provider !== "zep") return null;
    let endpoint: string;
    try { endpoint = chatCompletionsUrl(config.filter.baseUrl).href; }
    catch { return null; }
    if (endpoint !== selection.answerEndpoint || revision !== owners.memoryStore.trialRevision()) return null;
    return { ...loaded, configurationRevision: revision,
      answer: { owner: selection.answerKeyOwner, endpoint, model: selection.answerModel }, selection };
  };
  return Object.freeze({ snapshot });
}
