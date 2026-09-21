// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFileAtomic } from "./atomic.js";
import { agentDiscovery, type AgentInstallation } from "./agent-discovery.js";
import { AgentUpdateProviders, AGENT_HELP, type AgentUpdate } from "./agent-updates.js";
import { holdAgent, assertAgentAvailable } from "./agent-maintenance.js";
import { LoginFlows, type LoginFlow } from "./login-flow.js";
import { checkLogin } from "./login-status.js";
import { listRecipes, rescanRecipesAsync, loginCheckOf, rememberLoginCheck, markLoginChecking, publicRecipes, type AgentRecipe } from "./recipes.js";
import { watchTerminal, recoverTerminals } from "./agent-terminal.js";
import { compareSemanticVersions } from "./agent-version.js";

export const AGENT_CHECK_INTERVAL = 24 * 60 * 60_000;
export interface AgentUpdateBatch {
  id: string; startedAt: number; state: "running" | "cancelling" | "done" | "cancelled" | "interrupted";
  entries: { vendor: string; key: string; state: "queued" | "preparing" | "running" | "done" | "failed" | "cancelled"; detail: string }[];
}
interface SavedUpdates { version: 1; checkedAt: number; snoozeUntil: number; skipped: string[]; updates: AgentUpdate[]; batch?: AgentUpdateBatch }
export interface AgentUpdatesView {
  instance: string; revision: number;
  checking: boolean; enabled: boolean; checkedAt: number | null; nextCheckAt: number | null;
  snoozeUntil: number; updates: AgentUpdate[]; notification: string | null;
  batch: AgentUpdateBatch | null;
}
export interface AgentManagerOptions {
  dataDir: string;
  enabled(): boolean;
  blockers(vendor: string): string[];
  prepare(vendor: string): { pause(): Promise<void>; resume(): Promise<void> };
  afterLogin(vendor: string): void;
  warn(message: string): void;
  providers?: AgentUpdateProviders;
  now?: () => number;
  inventory?: () => AgentInstallation[];
  rescan?: () => void | Promise<void>;
  recipes?: () => AgentRecipe[];
  checkLogin?: typeof checkLogin;
}
export class AgentManager extends EventEmitter {
  readonly logins = new LoginFlows();
  private readonly stop = new AbortController();
  private readonly cwd: string;
  private readonly file: string;
  private readonly providers: AgentUpdateProviders;
  private readonly now: () => number;
  private readonly inventory: () => AgentInstallation[];
  private readonly refresh: () => void | Promise<void>;
  private readonly recipes: () => AgentRecipe[];
  private saved: SavedUpdates = { version: 1, checkedAt: 0, snoozeUntil: 0, skipped: [], updates: [] };
  private readonly probes = new Map<string, Promise<void>>();
  private readonly pendingProbes = new Set<string>();
  private readonly updates = new Map<string, Promise<void>>();
  private checkRun: Promise<void> | null = null;
  private timer?: NodeJS.Timeout;
  private startTimer?: NodeJS.Timeout;
  private claim: { id: string; until: number; token: string } | null = null;
  private handledFlows = new Set<string>();
  private batchStop?: AbortController;
  private batchRun?: Promise<void>;
  private readonly instance = randomUUID();
  private revision = 0;
  constructor(private readonly options: AgentManagerOptions) {
    super(); this.cwd = join(options.dataDir, ".probe"); mkdirSync(this.cwd, { recursive: true });
    this.file = join(options.dataDir, "agent-updates.json");
    this.providers = options.providers ?? new AgentUpdateProviders(); this.now = options.now ?? Date.now;
    this.inventory = options.inventory ?? (() => agentDiscovery.list()); this.refresh = options.rescan ?? (() => rescanRecipesAsync(this.stop.signal));
    this.recipes = options.recipes ?? listRecipes;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      if (raw.version === 1) {
        this.saved.checkedAt = Number.isFinite(raw.checkedAt) ? Math.min(raw.checkedAt, this.now()) : 0;
        this.saved.snoozeUntil = Number.isFinite(raw.snoozeUntil) ? Math.min(raw.snoozeUntil, this.now() + AGENT_CHECK_INTERVAL) : 0;
        this.saved.skipped = Array.isArray(raw.skipped) ? raw.skipped.filter((x: unknown) => typeof x === "string").slice(-100) : [];
        this.saved.updates = Array.isArray(raw.updates) ? raw.updates.slice(0, 32).filter((x: any) => typeof x?.installationId === "string" && Object.hasOwn(AGENT_HELP, x?.vendor ?? "")
          && Number.isFinite(x?.checkedAt) && ["current", "available", "unknown", "manual"].includes(x?.status)
          && typeof x?.channel === "string" && typeof x?.executable === "string" && typeof x?.detail === "string"
          && (x?.current === null || typeof x?.current === "string") && (x?.latest === null || typeof x?.latest === "string"))
          .map((x: AgentUpdate) => ({ ...x, help: AGENT_HELP[x.vendor] })) : [];
        if (raw.batch && typeof raw.batch.id === "string" && raw.batch.id.length <= 100 && Array.isArray(raw.batch.entries)
          && ["running", "cancelling", "done", "cancelled", "interrupted"].includes(raw.batch.state)) {
          const interrupted = raw.batch.state === "running" || raw.batch.state === "cancelling";
          this.saved.batch = { id: raw.batch.id, startedAt: Number.isFinite(raw.batch.startedAt) ? raw.batch.startedAt : 0, state: interrupted ? "interrupted" : raw.batch.state,
            entries: raw.batch.entries.slice(0, 32).filter((e: any) => Object.hasOwn(AGENT_HELP, e?.vendor ?? "") && typeof e.key === "string" && e.key.length <= 512
              && typeof e.detail === "string" && ["queued", "preparing", "running", "done", "failed", "cancelled"].includes(e.state))
              .map((e: AgentUpdateBatch["entries"][number]) => ({ vendor: e.vendor, key: e.key, state: ["queued", "preparing", "running"].includes(e.state) ? "cancelled" : e.state,
                detail: ["queued", "preparing", "running"].includes(e.state) ? "Interrupted by a viberoom restart. Check updates before trying again." : e.detail.slice(0, 4000) })) };
          if (interrupted) this.save();
        }
      }
    } catch { }
    this.logins.on("change", (flow: LoginFlow) => {
      this.emit("login", flow);
      const batchEntry = this.batchActive() && flow.purpose === "update" ? this.saved.batch?.entries.find(e => e.vendor === flow.recipeId && (e.state === "preparing" || e.state === "running")) : undefined;
      if (batchEntry && (batchEntry.state !== flow.state || batchEntry.detail !== flow.detail)) {
        batchEntry.state = flow.state; batchEntry.detail = flow.detail; this.batchChanged();
      }
      if (flow.state === "running" || this.handledFlows.has(flow.id) || flow.purpose === "update") return;
      if (flow.state !== "done" && !(flow.kind === "terminal" && (flow.purpose ?? "login") === "login")) return;
      this.handledFlows.add(flow.id);
      const post = flow.purpose === "install" && !flow.looked ? this.rescan([flow.recipeId]) : this.checkLogins([flow.recipeId], 0);
      void post.then(() => { if (!this.stop.signal.aborted && loginCheckOf(flow.recipeId)?.state === "ok") options.afterLogin(flow.recipeId); }).catch(error => options.warn(`agent operation check: ${String(error)}`));
    });
    for (const { ticket, watch } of recoverTerminals(options.dataDir)) {
      const release = ticket.purpose === "install" ? holdAgent(ticket.recipeId) : undefined;
      try {
        const flow = this.logins.startTerminal({ recipeId: ticket.recipeId, vendor: ticket.vendor, purpose: ticket.purpose,
          commandLine: "Resuming observation of the existing terminal", hint: "Finish in the already open terminal, or cancel here." }, () => watch.open, watch);
        if (release) this.releaseWhenFinished(flow, release);
      } catch (error) { release?.(); throw error; }
    }
  }
  start(): void {
    if (this.startTimer || this.stop.signal.aborted) return;
    this.startTimer = setTimeout(() => {
      void this.checkLogins().catch(error => this.options.warn(String(error)));
      void this.checkUpdates().catch(error => this.options.warn(String(error)));
    }, 2500); this.startTimer.unref();
    this.schedule();
  }
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.stop.signal.aborted || !this.options.enabled()) return;
    const wait = Math.max(3000, this.saved.checkedAt + AGENT_CHECK_INTERVAL - this.now());
    this.timer = setTimeout(() => { void this.checkUpdates().catch(error => this.options.warn(String(error))); }, wait);
    this.timer.unref();
  }
  settingsChanged(): void { this.schedule(); this.changed(); }
  private save(): void { writeFileAtomic(this.file, JSON.stringify(this.saved, null, 2)); }
  private changed(): void { this.revision++; this.emit("updates", this.view()); }
  private batchChanged(): void {
    try { this.save(); } catch (error) { this.options.warn(`Could not save update queue progress: ${String(error)}`); }
    this.changed();
  }
  private recipesChanged(): void { this.emit("recipes", publicRecipes()); }
  view(): AgentUpdatesView {
    const inventory = this.inventory();
    const installed = new Set(inventory.map(i => i.id));
    const skipped = new Set(this.saved.skipped);
    const updates = this.saved.updates.filter(u => installed.has(u.installationId)).map(u => ({ ...u, skipped: !!u.key && skipped.has(u.key) }));
    for (const i of inventory) if (!updates.some(u => u.installationId === i.id)) updates.push({ installationId: i.id, vendor: i.vendor, method: i.method,
      executable: i.executable, current: i.version, latest: null, channel: i.channel, status: "unknown", checkedAt: 0,
      detail: "This installation has not been checked yet.", help: AGENT_HELP[i.vendor], canUpdate: false, skipped: false });
    const keys = updates.filter(u => u.status === "available" && !u.skipped).map(u => u.key!).filter(Boolean).sort();
    return { instance: this.instance, revision: this.revision, checking: !!this.checkRun, enabled: this.options.enabled(), checkedAt: this.saved.checkedAt || null,
      nextCheckAt: this.options.enabled() ? this.saved.checkedAt + AGENT_CHECK_INTERVAL : null, snoozeUntil: this.saved.snoozeUntil,
      updates, batch: this.saved.batch ? structuredClone(this.saved.batch) : null,
      notification: keys.length && this.options.enabled() && this.now() >= this.saved.snoozeUntil ? keys.join("|") : null };
  }
  async checkUpdates(force = false): Promise<void> {
    if (this.stop.signal.aborted || !force && !this.options.enabled()) return;
    if (this.checkRun) return this.checkRun;
    if (!force && this.saved.checkedAt && this.now() - this.saved.checkedAt < AGENT_CHECK_INTERVAL) { this.schedule(); return; }
    const run = (async () => {
      await this.refresh();
      const installations = this.inventory();
      const answers: AgentUpdate[] = [];
      let next = 0;
      await Promise.all([0, 1].map(async () => {
        while (next < installations.length && !this.stop.signal.aborted) {
          const installation = installations[next++];
          if (this.logins.runningFor(installation.vendor) || this.updates.has(installation.vendor)) {
            const old = this.saved.updates.find(u => u.installationId === installation.id); if (old) answers.push(old);
            continue;
          }
          answers.push(await this.providers.check(installation, this.stop.signal));
        }
      }));
      if (this.stop.signal.aborted) return;
      this.saved.updates = answers.sort((a, b) => a.vendor.localeCompare(b.vendor));
      this.saved.checkedAt = this.now(); this.save();
    })();
    this.checkRun = run; this.changed();
    try { await run; } finally { this.checkRun = null; this.schedule(); this.changed(); this.recipesChanged(); }
  }
  claimNotification(windowId: string, notification: string): { token: string } | null {
    if (!windowId || windowId.length > 120 || this.view().notification !== notification) return null;
    if (this.claim && this.claim.until > this.now()) return this.claim.id === windowId ? { token: this.claim.token } : null;
    this.claim = { id: windowId, until: this.now() + 60_000, token: randomUUID() };
    return { token: this.claim.token };
  }
  renewNotification(token: string): boolean {
    if (this.claim?.token !== token) return false;
    this.claim.until = this.now() + 60_000; return true;
  }
  dismiss(action: "close" | "skip", keys: string[]): void {
    if (action === "skip") {
      const known = new Set(this.saved.updates.filter(u => u.status === "available").map(u => u.key));
      this.saved.skipped = [...new Set([...this.saved.skipped, ...keys.filter(key => known.has(key))])].slice(-100);
    }
    this.saved.snoozeUntil = action === "close" ? this.now() + AGENT_CHECK_INTERVAL : 0;
    this.claim = null; this.save(); this.changed();
  }
  async checkLogins(ids?: string[], maxAgeMs = 0): Promise<void> {
    if (this.stop.signal.aborted) return;
    const targets = this.recipes().filter(r => !r.unavailableReason && (!ids || ids.includes(r.id)) && !this.updates.has(r.id) && this.logins.runningFor(r.id)?.purpose !== "install");
    await Promise.all(targets.map(async recipe => {
      const running = this.probes.get(recipe.id);
      if (running) {
        if (maxAgeMs === 0) this.pendingProbes.add(recipe.id);
        await running; return;
      }
      const checked = loginCheckOf(recipe.id);
      if (checked && this.now() - checked.at < maxAgeMs) return;
      const run = (async () => {
        do {
          this.pendingProbes.delete(recipe.id);
          markLoginChecking(recipe.id, true); this.recipesChanged();
          try {
            const fresh = this.recipes().find(r => r.id === recipe.id)!;
            const result = await (this.options.checkLogin ?? checkLogin)(fresh.loginStatus, fresh.build({ model: null, mode: null }), this.cwd, this.stop.signal);
            rememberLoginCheck(recipe.id, result); this.logins.settle(recipe.id, result.state, result.detail);
          } catch (error) {
            rememberLoginCheck(recipe.id, { state: "unknown", how: recipe.loginStatus.kind === "acp" ? "acp" : "command", at: this.now(), detail: error instanceof Error ? error.message : String(error) });
          } finally { markLoginChecking(recipe.id, false); this.recipesChanged(); }
        } while (this.pendingProbes.has(recipe.id) && !this.stop.signal.aborted && !this.updates.has(recipe.id));
      })();
      this.probes.set(recipe.id, run);
      try { await run; } finally { this.probes.delete(recipe.id); }
    }));
  }
  startLogin(recipeId: string, inTerminal = false): LoginFlow {
    this.assertOpen(recipeId);
    const recipe = this.recipes().find(r => r.id === recipeId);
    if (!recipe) throw new Error(`Unknown agent: ${recipeId}`);
    if (recipe.unavailableReason) throw new Error(`${recipe.vendor}: ${recipe.unavailableReason}`);
    if (inTerminal || recipe.loginFlow.kind === "terminal") {
      const line = recipe.loginFlow.kind === "terminal" ? recipe.loginFlow.commandLine : recipe.loginTerminalLine;
      if (!line) throw new Error(`${recipe.vendor} has no terminal sign-in command`);
      const existing = this.logins.runningFor(recipeId);
      if (existing) { if ((existing.purpose ?? "login") === "login") return existing; throw new Error("Another operation is already running for this agent"); }
      const watch = watchTerminal(this.options.dataDir, { recipeId, vendor: recipe.vendor, purpose: "login", cwd: this.cwd,
        env: recipe.build({ model: null, mode: null }).env,
        line, command: recipe.loginFlow.kind === "command" ? { command: recipe.loginFlow.command ?? recipe.build({ model: null, mode: null }).command,
          args: recipe.loginFlow.args, env: recipe.build({ model: null, mode: null }).env } : undefined });
      return this.logins.startTerminal({ recipeId, vendor: recipe.vendor, commandLine: line, hint: recipe.loginFlow.hint }, () => watch.open, watch);
    }
    return this.logins.start({ recipeId, vendor: recipe.vendor, spec: recipe.loginFlow, launch: recipe.build({ model: null, mode: null }) }, this.cwd);
  }
  startInstall(recipeId: string, inTerminal = false): LoginFlow {
    this.assertOpen(recipeId);
    const recipe = this.recipes().find(r => r.id === recipeId);
    if (!recipe) throw new Error(`Unknown agent: ${recipeId}`);
    if (!recipe.unavailableReason) throw new Error(`${recipe.vendor} is already installed (${recipe.installedAt})`);
    const spec = recipe.install;
    if (spec.kind === "url") throw new Error(`Install ${recipe.vendor} from ${spec.url}`);
    const existing = this.logins.runningFor(recipeId);
    if (existing) { if (existing.purpose === "install") return existing; throw new Error("Another operation is already running for this agent"); }
    if (this.batchActive()) throw new Error("Finish or cancel the queued updates first.");
    this.assertNoOtherMutation();
    const release = holdAgent(recipeId);
    const start = (): LoginFlow => {
    if (spec.kind === "command" && !inTerminal) return this.logins.start({ recipeId, vendor: recipe.vendor, purpose: "install",
      spec: { kind: "command", command: spec.command, args: spec.args, hint: spec.note }, launch: { command: spec.command, args: spec.args },
      verify: async () => {
        await this.refresh(); const found = this.recipes().find(r => r.id === recipeId);
        if (!found || found.unavailableReason) throw new Error("The installer exited, but the agent was not found. Check the installer output and its installation directory.");
      } }, this.cwd);
    const watch = watchTerminal(this.options.dataDir, { recipeId, vendor: recipe.vendor, purpose: "install", cwd: this.cwd,
      ...(spec.kind === "command" ? { command: { command: spec.command, args: spec.args } } : { line: spec.line, shell: spec.shell }) });
    return this.logins.startTerminal({ recipeId, vendor: recipe.vendor, commandLine: spec.line, hint: spec.note, purpose: "install" }, () => watch.open, watch);
    };
    try {
      const flow = start();
      this.releaseWhenFinished(flow, release); return flow;
    } catch (error) { release(); throw error; }
  }
  private releaseWhenFinished(flow: LoginFlow, release: () => void): void {
    const ended = (event: LoginFlow) => { if (event.id === flow.id && event.state !== "running") { release(); this.logins.off("change", ended); } };
    this.logins.on("change", ended); ended(flow);
  }
  async rescan(ids?: string[]): Promise<void> {
    if (this.stop.signal.aborted) return;
    await this.refresh();
    for (const r of this.recipes()) if (!ids || ids.includes(r.id)) this.logins.settleInstall(r.id, r.unavailableReason ? null : r.installedAt);
    this.recipesChanged(); this.changed(); await this.checkLogins(ids, 0);
  }
  private assertOpen(vendor: string): void {
    if (this.stop.signal.aborted) throw new Error("The application is closing");
    assertAgentAvailable(vendor);
    if (this.updates.has(vendor)) throw new Error("An update is already running for this agent");
  }
  private assertNoOtherMutation(): void {
    if (this.updates.size || this.logins.list().some(flow => flow.state === "running" && (flow.purpose === "install" || flow.purpose === "update"))) {
      throw new Error("Finish the current install or update first. Package managers can share a global directory.");
    }
  }
  private batchActive(): boolean { return this.saved.batch?.state === "running" || this.saved.batch?.state === "cancelling"; }
  startUpdate(vendor: string, key: string): Promise<LoginFlow> {
    if (this.batchActive()) return Promise.reject(new Error("Finish or cancel the queued updates first."));
    return this.beginUpdate(vendor, key, this.stop.signal);
  }
  startUpdateBatch(keys: string[]): AgentUpdatesView {
    if (this.stop.signal.aborted) throw new Error("The application is closing");
    if (this.batchActive()) return this.view();
    this.assertNoOtherMutation();
    const wanted = [...new Set(keys)];
    if (!wanted.length || wanted.length > 32) throw new Error("Choose the available updates first.");
    const offers = this.view().updates;
    const entries = wanted.map(key => {
      const offer = offers.find(u => u.key === key && u.status === "available" && u.canUpdate);
      if (!offer) throw new Error("The available updates changed. Check updates again before continuing.");
      return { vendor: offer.vendor, key, state: "queued" as const, detail: "Waiting for its turn." };
    });
    const batch: AgentUpdateBatch = { id: randomUUID(), startedAt: this.now(), state: "running", entries };
    const previous = this.saved.batch;
    this.saved.batch = batch; this.batchStop = new AbortController();
    try { this.save(); } catch (error) { this.saved.batch = previous; throw error; }
    this.changed();
    this.batchRun = this.runUpdateBatch(batch, AbortSignal.any([this.stop.signal, this.batchStop.signal]));
    void this.batchRun.catch(error => this.options.warn(`Update queue stopped: ${String(error)}`));
    return this.view();
  }
  cancelUpdateBatch(id: string): AgentUpdatesView {
    if (!this.batchActive() || this.saved.batch?.id !== id) return this.view();
    this.saved.batch.state = "cancelling"; this.batchStop?.abort();
    for (const entry of this.saved.batch.entries) {
      if (entry.state === "queued") { entry.state = "cancelled"; entry.detail = "Cancelled before starting."; }
      const flow = this.logins.runningFor(entry.vendor);
      if (flow?.purpose === "update") this.logins.cancel(flow.id);
    }
    this.batchChanged(); return this.view();
  }
  private async runUpdateBatch(batch: AgentUpdateBatch, signal: AbortSignal): Promise<void> {
    try {
      for (const entry of batch.entries) {
        if (signal.aborted) break;
        entry.state = "preparing"; entry.detail = "Preparing the update…"; this.batchChanged();
        try {
          const flow = await this.beginUpdate(entry.vendor, entry.key, signal);
          entry.state = flow.state; entry.detail = flow.detail; this.batchChanged();
          await this.updates.get(entry.vendor);
          entry.state = flow.state; entry.detail = flow.detail;
        } catch (error) {
          entry.state = signal.aborted ? "cancelled" : "failed";
          entry.detail = signal.aborted ? "Cancelled before the updater started." : error instanceof Error ? error.message : String(error);
        }
        this.batchChanged();
      }
    } finally {
      for (const entry of batch.entries) if (entry.state === "queued") { entry.state = "cancelled"; entry.detail = "Cancelled before starting."; }
      batch.state = signal.aborted ? "cancelled" : "done"; this.batchChanged();
    }
  }
  private async beginUpdate(vendor: string, key: string, signal: AbortSignal): Promise<LoginFlow> {
    signal.throwIfAborted();
    this.assertOpen(vendor);
    this.assertNoOtherMutation();
    if (this.logins.runningFor(vendor)) throw new Error("Finish this agent's current operation first");
    const blockers = this.options.blockers(vendor);
    if (blockers.length) throw new Error(`Wait for these vibemates to finish: ${blockers.join(", ")}`);
    const release = holdAgent(vendor);
    let finish!: () => void;
    const running = new Promise<void>(resolve => { finish = resolve; }); this.updates.set(vendor, running);
    let resume: (() => Promise<void>) | undefined;
    const tidy = async () => {
      release();
      try { if (!this.stop.signal.aborted) await resume?.(); }
      catch (error) { this.options.warn(`Agent sessions after update: ${String(error)}`); }
      finally { this.updates.delete(vendor); finish(); this.changed(); }
    };
    try {
      await this.checkRun;
      await this.probes.get(vendor);
      await this.refresh();
      const installation = this.inventory().find(i => i.vendor === vendor);
      if (!installation) throw new Error("This agent is no longer installed");
      signal.throwIfAborted();
      const offer = await this.providers.check(installation, signal);
      if (offer.key !== key || !offer.canUpdate) throw new Error("The available version changed or this installation needs attention. Check updates again before continuing.");
      const plan = await this.providers.plan(installation, offer, signal);
      signal.throwIfAborted();
      const sessions = this.options.prepare(vendor);
      resume = sessions.resume;
      await sessions.pause();
      signal.throwIfAborted();
      const recipe = this.recipes().find(r => r.id === vendor)!;
      const flow = this.logins.start({ recipeId: vendor, vendor: recipe?.vendor ?? vendor, purpose: "update",
        spec: { kind: "command", command: plan.command.command, args: plan.command.args, hint: plan.detail }, launch: plan.command,
        verify: async operationSignal => {
          await this.refresh(); const fresh = this.inventory().find(i => i.id === installation.id);
          if (!fresh) throw new Error("The updater changed the selected installation. Review the installation paths before continuing.");
          const current = await this.providers.current(fresh, AbortSignal.any([operationSignal, signal]));
          if (operationSignal.aborted || signal.aborted) throw new Error("Update verification was cancelled");
          if (current !== offer.latest && compareSemanticVersions(current, offer.latest!) !== 0) throw new Error(`The updater exited, but the selected agent reports ${current}; expected ${offer.latest}. Check again.`);
          this.saved.updates = this.saved.updates.filter(u => u.installationId !== fresh.id);
          this.saved.updates.push({ ...offer, current, status: "current", canUpdate: false, key: undefined, checkedAt: this.now(), detail: "Updated and verified." });
          this.save(); this.changed(); this.recipesChanged();
        } }, plan.cwd);
      const ended = (changed: LoginFlow) => {
        if (changed.id !== flow.id || changed.state === "running") return;
        this.logins.off("change", ended); void tidy();
      };
      this.logins.on("change", ended);
      if (flow.state !== "running") ended(flow);
      return flow;
    } catch (error) { await tidy(); throw error; }
  }
  async shutdown(): Promise<void> {
    if (this.stop.signal.aborted) return;
    this.stop.abort(); clearTimeout(this.timer); clearTimeout(this.startTimer);
    await this.logins.shutdown();
    await Promise.allSettled([this.checkRun, ...this.probes.values(), ...this.updates.values(), this.batchRun]);
  }
}
