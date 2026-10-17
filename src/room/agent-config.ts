// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { SessionConfigOption, SessionConfigSelectGroup, SessionConfigSelectOption } from "../acp-types.js";
import { describeError } from "../jsonrpc.js";
import { getRecipe } from "../recipes.js";
import type { LaunchPrefs, Participant } from "../room.js";
import { holdsWork, type AgentRuntime, type WorkHold } from "./agent-runtime.js";
import { stillHeld, type Held, type SeenVibemate } from "./vibemate-seen.js";

export interface ConfigShortfall {
  category: string;
  log: string;
  said: string;
}

export interface AgentConfigPorts {
  current(id: string): Held;
  takeWork(runtime: AgentRuntime): WorkHold;
  finishWork(id: string, hold: WorkHold): Promise<void>;
  replaceForMode(id: string, hold: WorkHold): Promise<AgentRuntime>;
  pushParticipant(seen: SeenVibemate): boolean;
  tell(seen: SeenVibemate, text: string, tone?: "error"): boolean;
}

export class AgentConfig {
  private disposed = false;

  constructor(private readonly ports: AgentConfigPorts) {}

  dispose(): void {
    this.disposed = true;
  }

  async set(id: string, configId: string, value: string | boolean, from?: string): Promise<void> {
    this.alive();
    const { participant, runtime } = this.ports.current(id);
    this.alive();
    if (!participant) throw new Error("no such vibemate");
    if (participant.status === "starting") throw new Error(`${participant.name} is still starting. Change its settings once it is ready.`);
    if (!runtime) throw new Error(`${participant.name} is offline. Reconnect it before changing its live settings.`);
    const seen = { participant, runtime };
    configId = optionFor(participant, configId)?.id ?? configId;
    if (runtime.work.turnActive || runtime.work.workBusy || runtime.native.nativeDraining) {
      runtime.queue.pendingConfig = [...(runtime.queue.pendingConfig ?? []).filter((p) => p.configId !== configId), { configId, value, ...(from ? { from } : {}) }];
      const drawn = this.ports.pushParticipant(seen);
      this.alive();
      if (drawn) this.ports.tell(seen, `${participant.name}: ${configName(participant, configId)} → ${configShown(value)}; when this reply is finished${from ? ` (${from})` : ""}`);
      return;
    }
    const hold = this.ports.takeWork(runtime);
    try { await this.applyNow(id, seen, hold, configId, value, from); }
    finally { await this.ports.finishWork(id, hold); }
  }

  async applyPending(id: string, hold: WorkHold): Promise<AgentRuntime> {
    let runtime = hold.runtime;
    if (this.disposed) return runtime;
    const first = this.ports.current(id);
    if (this.disposed) return runtime;
    const participant = first.participant;
    if (!participant || first.runtime !== runtime || !holdsWork(hold)) return runtime;
    let changed = false;
    for (;;) {
      if (this.disposed) return runtime;
      const now = this.ports.current(id);
      if (this.disposed) return runtime;
      if (now.participant !== participant || now.runtime !== runtime || !holdsWork(hold) || runtime.session.retiring || !runtime.queue.pendingConfig?.length) break;
      changed = true;
      const entry = runtime.queue.pendingConfig.shift()!;
      try {
        runtime = await this.applyNow(id, { participant, runtime }, hold, entry.configId, entry.value, entry.from);
      } catch (error) {
        if (this.disposed) return runtime;
        this.ports.tell({ participant }, `${participant.name}: ${configName(participant, entry.configId)} → ${configShown(entry.value)} was refused (${describeError(error)})`, "error");
        if (this.disposed) return runtime;
      }
    }
    if (!changed || this.disposed) return runtime;
    const held = this.ports.current(id);
    if (this.disposed || held.participant !== participant || held.runtime !== runtime || !holdsWork(hold)) return runtime;
    runtime.queue.pendingConfig = undefined;
    this.ports.pushParticipant({ participant, runtime });
    return runtime;
  }

  setLaunch(id: string, patch: { model?: string | null; effort?: string | null; mode?: string | null }, from?: string): Participant {
    this.alive();
    const { participant, runtime } = this.ports.current(id);
    this.alive();
    if (!participant || participant.kind !== "agent") throw new Error("no such vibemate");
    if (runtime) throw new Error(`${participant.name} is running: this is one of its settings now, not a choice for its next start`);
    const seen: SeenVibemate = { participant, runtime: null };
    const launch: LaunchPrefs = { model: participant.launch?.model ?? null, effort: participant.launch?.effort ?? null, mode: participant.launch?.mode ?? null };
    for (const field of ["model", "effort", "mode"] as const) {
      const value = patch[field];
      if (value === undefined) continue;
      if (!this.holds(id, seen)) return participant;
      launch[field] = value === null || value === "" ? null : String(value).slice(0, 80);
      participant[field] = launch[field] ?? undefined;
      const told = this.ports.tell(seen, `${participant.name}: ${field} → ${launch[field] ?? "the agent's own"}; when it comes back${from ? ` (${from})` : ""}`);
      this.alive();
      if (!told) return participant;
    }
    if (!this.holds(id, seen)) return participant;
    participant.launch = launch;
    this.ports.pushParticipant(seen);
    return participant;
  }

  async applyAtStart(runtime: AgentRuntime, participant: Participant, wanted: LaunchPrefs): Promise<ConfigShortfall[]> {
    const warnings: ConfigShortfall[] = [];
    const id = participant.id;
    const seen: SeenVibemate = { participant, runtime };
    const ours = (): boolean => this.holds(id, seen);
    const plan: [string, string, string | null][] = [
      ["model", "model", wanted.model],
      ["thought_level", "effort", wanted.effort],
      ["mode", "mode", wanted.mode],
    ];
    for (const [category, label, value] of plan) {
      if (!value) continue;
      const option = participant.configOptions?.find((o) => o.category === category);
      if (!option || option.type !== "select") {
        if (category === "mode" && participant.modes?.some((m) => m.id === value)) {
          if (!ours()) return warnings;
          try {
            const reported = await runtime.session.agent.setMode(runtime.session.sessionId, value);
            if (!ours()) return warnings;
            participant.mode = reported?.currentModeId ?? value;
          } catch (error) {
            if (!ours()) return warnings;
            warnings.push({ category, log: `mode: set_mode failed: ${describeError(error)}`, said: `the agent refused mode ${value}; it uses ${participant.mode ?? "its own"}` });
          }
          continue;
        }
        warnings.push({ category, log: `${category}: the agent exposes no such config option; left at its default`, said: `${label} ${value} cannot be chosen for this agent; it uses the agent's own` });
        continue;
      }
      const values = flattenOptions(option.options);
      if (!values.some((v) => v.value === value)) {
        warnings.push({ category, log: `${category}: "${value}" is not offered (${values.map((v) => v.value).join(", ")}); left at ${String(option.currentValue)}`, said: `${label} ${value} is not available on this computer; it uses ${String(option.currentValue)}` });
        continue;
      }
      if (option.currentValue === value) continue;
      if (!ours()) return warnings;
      try {
        const reported = await runtime.session.agent.setConfigOption(runtime.session.sessionId, option.id, value);
        if (!ours()) return warnings;
        participant.configOptions = reported;
        const taken = participant.configOptions?.find((o) => o.id === option.id)?.currentValue;
        if (taken !== undefined && taken !== value) {
          warnings.push({ category, log: `${category}: asked for "${value}", the agent took "${String(taken)}"`, said: `the agent took ${label} ${String(taken)} instead of ${value}` });
        }
      } catch (error) {
        if (!ours()) return warnings;
        warnings.push({ category, log: `${category}: set_config_option failed: ${describeError(error)}`, said: `the agent refused ${label} ${value}; it uses ${String(option.currentValue)}` });
      }
    }
    const recipe = participant.agentType ? getRecipe(participant.agentType) : undefined;
    if (recipe?.bypassConfig && wanted.mode && wanted.mode === recipe.bypassMode) {
      for (const [optionId, value] of Object.entries(recipe.bypassConfig)) {
        const option = participant.configOptions?.find((o) => o.id === optionId);
        if (!option || option.type !== "select" || option.currentValue === value) continue;
        if (!flattenOptions(option.options).some((v) => v.value === value)) continue;
        if (!ours()) return warnings;
        try {
          const reported = await runtime.session.agent.setConfigOption(runtime.session.sessionId, option.id, value);
          if (!ours()) return warnings;
          participant.configOptions = reported;
        } catch (error) {
          if (!ours()) return warnings;
          warnings.push({ category: optionId, log: `${optionId}: set_config_option failed: ${describeError(error)}`, said: `the agent refused ${option.name || optionId} ${value}, which acting without asking needs; it may ask before it acts` });
        }
      }
    }
    if (!ours()) return warnings;
    summarizeConfig(participant);
    if (wanted.mode && participant.mode && participant.mode !== wanted.mode && !warnings.some(w => w.category === "mode")) {
      warnings.push({ category: "mode", log: `mode: requested ${wanted.mode}; the agent reports ${participant.mode}`, said: `mode ${wanted.mode} was asked for; the agent uses ${participant.mode}` });
    }
    return warnings;
  }

  private async applyNow(id: string, seen: SeenVibemate & { runtime: AgentRuntime }, hold: WorkHold, configId: string, value: string | boolean, from?: string): Promise<AgentRuntime> {
    const participant = seen.participant, runtime = hold.runtime;
    this.alive();
    if (!this.holds(id, seen) || !holdsWork(hold)) throw new Error("the vibemate is no longer connected");
    const option = optionFor(participant, configId);
    if (option) configId = option.id;
    const stillOurs = () => {
      this.alive();
      if (!this.holds(id, seen) || !holdsWork(hold)) throw new Error("the vibemate restarted while its setting was changing; choose the setting again");
    };
    const change = async <T>(request: () => Promise<T>): Promise<T> => {
      stillOurs();
      try { return await request(); }
      catch (error) {
        const record = runtime.session.transcript?.dump("setting change failed");
        const setting = JSON.stringify({ id: configId, value, model: participant.model, mode: participant.mode }).slice(0, 500);
        runtime.session.log.warn(`setting refused ${setting}: ${describeError(error)}${record ? `; protocol kept at ${record}` : ""}`);
        throw error;
      }
    };
    const recipe = getRecipe(participant.agentType ?? "");
    if (recipe?.modeAtLaunch && configId === "mode") {
      if (!recipe.modePresets.includes(String(value))) throw new Error(`${participant.name}: no mode "${value}" (${recipe.modePresets.join(", ")})`);
      stillOurs();
      participant.launch = { model: participant.launch?.model ?? null, effort: participant.launch?.effort ?? null, mode: String(value) };
      const drawn = this.ports.pushParticipant(seen);
      this.alive();
      if (!drawn || !holdsWork(hold)) throw new Error("the vibemate restarted while its setting was changing; choose the setting again");
      return this.ports.replaceForMode(id, hold);
    }
    if (!option && configId === "mode" && (participant.modes?.some((m) => m.id === value) || participant.mode === value)) {
      const reported = await change(() => runtime.session.agent.setMode(runtime.session.sessionId, String(value)));
      stillOurs();
      participant.mode = reported?.currentModeId ?? String(value);
    } else {
      if (!option && configId === "mode" && participant.modes?.length) throw new Error(`${participant.name}: ${configShown(value)} is not an available mode. Choose one of ${participant.modes.map(m => m.name || m.id).join(", ")}.`);
      if (!option) throw new Error(`${participant.name} no longer offers that setting. Open its settings again to see the current choices.`);
      if ((option.type === "boolean" && typeof value !== "boolean") || (option.type === "select" && typeof value !== "string")) {
        throw new Error(`${participant.name}: choose a valid value for ${option.name}.`);
      }
      if (option.category === "mode" && value !== option.currentValue && !flattenOptions(option.options).some(o => o.value === value)) {
        throw new Error(`${participant.name}: ${configShown(value)} is not available for ${option.name}. Open its settings again to see the current choices.`);
      }
      const reported = await change(() => runtime.session.agent.setConfigOption(runtime.session.sessionId, configId, value));
      stillOurs();
      participant.configOptions = reported;
      summarizeConfig(participant);
    }
    participant.launch = { model: participant.model ?? null, effort: participant.effort ?? null, mode: participant.mode ?? null };
    const drawn = this.ports.pushParticipant(seen);
    this.alive();
    if (!drawn || !holdsWork(hold)) return runtime;
    const actual = participant.configOptions?.find(o => o.id === configId)?.currentValue ?? (configId === "mode" ? participant.mode : undefined) ?? value;
    const said = actual === value ? configShown(actual) : `${configShown(actual)} (requested ${configShown(value)})`;
    this.ports.tell(seen, `${participant.name}: ${configName(participant, configId)} → ${said}; from its next turn${from ? ` (${from})` : ""}`);
    return runtime;
  }

  private holds(id: string, seen: SeenVibemate): boolean {
    if (this.disposed) return false;
    const now = this.ports.current(id);
    return !this.disposed && stillHeld(seen, now);
  }

  private alive(): void {
    if (this.disposed) throw new Error("the room has shut down; the setting was not changed");
  }
}

function optionFor(participant: Participant, configId: string): SessionConfigOption | undefined {
  return participant.configOptions?.find(o => o.id === configId) ?? participant.configOptions?.find(o => o.category === configId);
}

export function configName(participant: Participant, configId: string): string {
  return configId === "mode" ? "mode" : participant.configOptions?.find((o) => o.id === configId)?.name || configId;
}

export function configShown(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "on" : "off") : String(value);
}

export function summarizeConfig(participant: Participant): void {
  const pick = (category: string): string | undefined => {
    const option = participant.configOptions?.find((o) => o.category === category);
    return option ? String(option.currentValue) : undefined;
  };
  participant.model = pick("model") ?? participant.model;
  participant.effort = pick("thought_level") ?? participant.effort;
  participant.mode = pick("mode") ?? participant.mode;
}

export function flattenOptions(options: SessionConfigOption["options"]): SessionConfigSelectOption[] {
  if (!options) return [];
  const out: SessionConfigSelectOption[] = [];
  for (const entry of options) {
    if ("options" in entry) out.push(...(entry as SessionConfigSelectGroup).options);
    else out.push(entry as SessionConfigSelectOption);
  }
  return out;
}
