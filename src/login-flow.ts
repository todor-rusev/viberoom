// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { AcpAgent } from "./acp-client.js";
import { spawnManaged, stopManaged } from "./managed-process.js";
import type { LoginState } from "./agent-health.js";
import type { WatchedTerminal } from "./agent-terminal.js";
import { stripAnsi } from "./login-status.js";

export type LoginFlowSpec =
  | { kind: "command"; command?: string | null; args: string[]; hint: string; scene?: "browser" | "code" }
  | { kind: "acp"; methodId: string; hint: string }
  | { kind: "terminal"; commandLine: string; hint: string }
  | { kind: "none"; hint: string };

export interface LoginFlow {
  id: string;
  recipeId: string;
  vendor: string;
  kind: "command" | "acp" | "terminal";
  purpose?: "login" | "install" | "update";
  looked?: boolean;
  state: "running" | "done" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number;
  lines: string[];
  url?: string;
  code?: string;
  wantsInput?: boolean;
  detail: string;
  hint: string;
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/;
const CODE_RE = /\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b|\bcode[:\s]+([A-Z0-9][A-Z0-9-]{5,11})\b/i;
const PROMPT_RE = /(paste|enter|type|code|press enter|continue|\?|:|>)\s*$/i;

export function readLoginLine(line: string): { url?: string; code?: string } {
  const url = URL_RE.exec(line)?.[0];
  const m = CODE_RE.exec(line);
  const code = m ? (m[1] || m[2]) : undefined;
  return { url, code: code && url && url.includes(code) ? undefined : code };
}

export function looksLikePrompt(tail: string): boolean {
  const t = tail.trim();
  return t.length > 0 && PROMPT_RE.test(t);
}

const MAX_LINES = 60;
const COMMAND_TIMEOUT_MS = 10 * 60_000;
const ACP_TIMEOUT_MS = 5 * 60_000;
const TERMINAL_TIMEOUT_MS = 60 * 60_000;

interface Running {
  flow: LoginFlow;
  child?: ChildProcess;
  agent?: AcpAgent;
  tail: string;
  timer?: NodeJS.Timeout;
  promptTimer?: NodeJS.Timeout;
  cleanup?: Promise<void>;
  finishing?: boolean;
  abort: AbortController;
  terminal?: WatchedTerminal;
}

export interface LoginTarget {
  recipeId: string;
  vendor: string;
  spec: LoginFlowSpec;
  launch: { command: string; args: string[]; env?: Record<string, string> };
  purpose?: "login" | "install" | "update";
  verify?: (signal: AbortSignal) => Promise<void>;
}

export class LoginFlows extends EventEmitter {
  private readonly running = new Map<string, Running>();

  list(): LoginFlow[] {
    return [...this.running.values()].map((r) => r.flow);
  }

  get(id: string): LoginFlow | undefined {
    return this.running.get(id)?.flow;
  }

  runningFor(recipeId: string): LoginFlow | undefined {
    return [...this.running.values()].find(r => r.flow.recipeId === recipeId && (r.flow.state === "running" || r.finishing))?.flow;
  }

  start(target: LoginTarget, cwd: string): LoginFlow {
    const purpose = target.purpose ?? "login";
    const existing = this.runningFor(target.recipeId);
    if (existing) {
      if ((existing.purpose ?? "login") === purpose && existing.state === "running") return existing;
      throw new Error(`${target.vendor} has another operation in progress. Wait until it finishes.`);
    }
    const { spec } = target;
    if (spec.kind !== "command" && spec.kind !== "acp") throw new Error(`${target.vendor} signs in through its own screen: run it in a terminal`);
    const flow: LoginFlow = { id: randomUUID(), recipeId: target.recipeId, vendor: target.vendor, kind: spec.kind, purpose, state: "running", startedAt: Date.now(), lines: [], detail: spec.kind === "acp" ? `${target.vendor} is opening your browser; finish the sign-in there and come back.` : `Starting ${target.vendor}'s own ${purpose === "install" ? "installer" : purpose === "update" ? "updater" : "sign-in"}…`, hint: spec.hint };
    const entry: Running = { flow, tail: "", abort: new AbortController() };
    this.running.set(flow.id, entry);
    for (const [id, r] of this.running) if (id !== flow.id && r.flow.recipeId === target.recipeId && (r.flow.purpose ?? "login") === purpose && r.flow.state !== "running") this.running.delete(id);
    if (spec.kind === "command") this.runCommand(entry, spec, target, cwd);
    else this.runAcp(entry, spec, target, cwd);
    this.changed(flow);
    return flow;
  }

  startTerminal(target: { recipeId: string; vendor: string; commandLine: string; hint: string; purpose?: "login" | "install" | "update" }, open: () => Promise<{ how: string }>, watch?: WatchedTerminal): LoginFlow {
    const purpose = target.purpose ?? "login";
    const existing = this.runningFor(target.recipeId);
    if (existing) {
      if ((existing.purpose ?? "login") === purpose && existing.state === "running") return existing;
      throw new Error(`${target.vendor} has another operation in progress. Wait until it finishes.`);
    }
    const thing = purpose === "install" ? "installer" : "sign-in";
    const flow: LoginFlow = { id: randomUUID(), recipeId: target.recipeId, vendor: target.vendor, kind: "terminal", purpose, state: "running", startedAt: Date.now(), lines: [target.commandLine], detail: `Opening a terminal window with ${target.vendor}'s own ${thing}…`, hint: target.hint };
    const entry: Running = { flow, tail: "", abort: new AbortController() };
    entry.terminal = watch;
    this.running.set(flow.id, entry);
    for (const [id, r] of this.running) if (id !== flow.id && r.flow.recipeId === target.recipeId && (r.flow.purpose ?? "login") === purpose && r.flow.state !== "running") this.running.delete(id);
    entry.timer = setTimeout(() => { if (flow.state === "running") this.end(entry, "cancelled", `${target.vendor}'s ${thing} was not finished in an hour; start it again when you are ready.`); }, TERMINAL_TIMEOUT_MS);
    this.changed(flow);
    open().then(
      ({ how }) => {
        if (flow.state !== "running") return;
        flow.detail = watch ? `${target.vendor}'s ${thing} is running in ${how}. Finish there and exit the vendor's screen; viberoom checks the result when the command ends.` : purpose === "install"
          ? `${target.vendor}'s installer is running in ${how}. Finish it there, then come back and press "I'm done": viberoom looks for ${target.vendor} again.`
          : `${target.vendor}'s sign-in is running in ${how}. Finish it there, then come back and press "I'm done": viberoom asks ${target.vendor} whether it worked.`;
        this.changed(flow);
      },
      (error: unknown) => {
        if (flow.state !== "running") return;
        this.end(entry, "failed", `No terminal window could be opened (${error instanceof Error ? error.message : String(error)}). Run the command below in a terminal yourself, then press "Check again".`);
      },
    );
    if (watch) void watch.finished.then(receipt => {
      if (flow.state !== "running") return;
      this.end(entry, receipt.state === "done" ? "done" : receipt.state === "cancelled" ? "cancelled" : "failed",
        receipt.detail || (receipt.state === "done" ? `${target.vendor}'s ${thing} finished. Checking the result…` : `${target.vendor}'s ${thing} ended without success (exit ${receipt.code ?? "unknown"}). See the terminal for its explanation.`));
    });
    return flow;
  }

  settleInstall(recipeId: string, installedAt: string | null): void {
    for (const r of this.running.values()) {
      if (r.flow.recipeId !== recipeId || r.flow.purpose !== "install") continue;
      if (r.flow.state === "running" && r.flow.kind === "terminal" && !r.terminal) {
        if (installedAt) { r.flow.looked = true; this.end(r, "done", `${r.flow.vendor} is installed (${installedAt}). Asking whether it is logged in…`); }
        else {
          r.flow.detail = `${r.flow.vendor} is still not found on this machine. Finish the install in the terminal window, then press "I'm done" once more; if it went somewhere unusual, \`viberoom doctor\` lists where the room looked.`;
          this.changed(r.flow);
        }
      } else if (r.flow.state === "done" && !r.flow.looked) {
        r.flow.looked = true;
        if (installedAt) r.flow.detail = `${r.flow.vendor} is installed (${installedAt}). Asking whether it is logged in…`;
        else {
          r.flow.state = "failed";
          r.flow.detail = `The installer finished, but ${r.flow.vendor} is still not found on this machine: \`viberoom doctor\` lists where the room looked. "Open a terminal instead" runs the same install where you can see it.`;
        }
        this.changed(r.flow);
      }
    }
  }

  settle(recipeId: string, state: LoginState, detail: string): void {
    for (const r of this.running.values()) {
      if (r.flow.recipeId !== recipeId || r.flow.kind !== "terminal" || r.flow.purpose === "install" || r.flow.state !== "running" || r.terminal) continue;
      if (state === "ok" || state === "configured") this.end(r, "done", `${r.flow.vendor} ${state === "ok" ? "confirms it is logged in" : "has sign-in details configured"}${detail ? ` (${detail})` : ""}. You can summon it now; the terminal window can be closed.`);
      else {
        r.flow.detail = `${r.flow.vendor}, asked again, ${state === "missing" ? "still says it is not logged in" : "could not say for sure"}${detail ? ` (${detail})` : ""}. Finish the sign-in in the terminal window, then press "I'm done" once more.`;
        this.changed(r.flow);
      }
    }
  }

  input(id: string, text: string): LoginFlow {
    const r = this.running.get(id);
    if (!r) throw new Error("no such sign-in");
    if (r.flow.kind === "terminal") throw new Error("this sign-in runs in a terminal window: type your answer there");
    if (r.flow.state !== "running" || !r.child?.stdin) throw new Error("this sign-in is not waiting for anything");
    r.child.stdin.write(`${text}\n`);
    r.flow.lines.push(`> ${text.replace(/./g, "•")}`);
    r.flow.wantsInput = false;
    r.tail = "";
    this.changed(r.flow);
    return r.flow;
  }

  cancel(id: string): LoginFlow {
    const r = this.running.get(id);
    if (!r) throw new Error("no such sign-in");
    if (r.flow.state === "running") this.end(r, "cancelled", r.flow.kind === "terminal" ? "Cancelled here; the terminal window, if it is still open, can be closed." : "Cancelled.");
    return r.flow;
  }

  private runCommand(entry: Running, spec: Extract<LoginFlowSpec, { kind: "command" }>, target: LoginTarget, cwd: string): void {
    const command = spec.command ?? target.launch.command;
    const installing = target.purpose === "install";
    const thing = installing ? "installer" : target.purpose === "update" ? "updater" : "sign-in";
    if (!command) { this.end(entry, "failed", `${target.vendor} is not installed here.`); return; }
    let child: ChildProcess;
    try {
      child = spawnManaged({ command, args: spec.args, env: target.launch.env }, cwd);
    } catch (error) {
      this.end(entry, "failed", `${target.vendor}'s ${thing} could not start: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    entry.child = child;
    entry.flow.detail = installing ? `${target.vendor} is being installed; what the installer prints appears here.` : target.purpose === "update" ? `${target.vendor} is being updated; what the updater prints appears here.` : `${target.vendor} is signing in; what it says appears here.`;
    const onData = (d: Buffer | string) => this.absorb(entry, String(d));
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => this.end(entry, "failed", `${target.vendor}'s ${thing} could not start: ${e.message}`));
    child.on("close", (code) => {
      if (entry.flow.state !== "running" || entry.finishing) return;
      this.flushTail(entry);
      if (code === 0 && target.verify) {
        entry.flow.detail = `Checking ${target.vendor} after ${target.purpose ?? "sign-in"}…`;
        this.changed(entry.flow);
        void target.verify(entry.abort.signal).then(() => { if (entry.flow.state === "running") this.end(entry, "done", `${target.vendor}'s ${target.purpose ?? "sign-in"} is complete and checked.`); }, error => {
          if (entry.flow.state === "running") this.end(entry, "failed", error instanceof Error ? error.message : String(error));
        });
      }
      else if (code === 0) this.end(entry, "done", installing ? `${target.vendor}'s installer finished. Looking for ${target.vendor}…` : `${target.vendor} says it is signed in. Checking…`);
      else this.end(entry, "failed", `${target.vendor}'s ${thing} ended without success (exit ${code})${entry.flow.lines.length ? `: ${entry.flow.lines[entry.flow.lines.length - 1]}` : ""}.`);
    });
    entry.timer = setTimeout(() => { if (entry.flow.state === "running") this.end(entry, "failed", `${target.vendor}'s ${thing} got no answer in ten minutes.`); }, COMMAND_TIMEOUT_MS);
  }

  private runAcp(entry: Running, spec: Extract<LoginFlowSpec, { kind: "acp" }>, target: LoginTarget, cwd: string): void {
    let agent: AcpAgent;
    try {
      agent = new AcpAgent({ ...target.launch, cwd }, {
        onSessionUpdate: () => undefined,
        onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }),
        onStderr: (line) => this.absorb(entry, `${line}\n`),
        onExit: () => { if (entry.flow.state === "running") this.end(entry, "failed", `${target.vendor} stopped before the sign-in ended.`); },
      });
    } catch (error) {
      this.end(entry, "failed", `${target.vendor} could not start: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    entry.agent = agent;
    void (async () => {
      try {
        await agent.initialize({ name: "viberoom", version: "0.2.0" });
        if (!agent.authMethods.some((m) => m.id === spec.methodId)) throw new Error(`${target.vendor} does not support this sign-in method. Check its sign-in options and try again.`);
        await agent.authenticate(spec.methodId);
        if (entry.flow.state === "running") this.end(entry, "done", `${target.vendor} says it is signed in. Checking…`);
      } catch (error) {
        if (entry.flow.state === "running") this.end(entry, "failed", `${target.vendor}'s sign-in did not go through: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    entry.timer = setTimeout(() => { if (entry.flow.state === "running") this.end(entry, "failed", `${target.vendor}'s sign-in got no answer in five minutes.`); }, ACP_TIMEOUT_MS);
  }

  private absorb(entry: Running, chunk: string): void {
    const text = stripAnsi(chunk.replace(/\r\n?/g, "\n"));
    entry.tail = (entry.tail + text).slice(-16_000);
    const parts = entry.tail.split("\n");
    entry.tail = parts.pop() ?? "";
    for (const line of parts) this.addLine(entry, line);
    if (entry.promptTimer) clearTimeout(entry.promptTimer);
    entry.flow.wantsInput = false;
    if (entry.tail.trim()) {
      entry.promptTimer = setTimeout(() => {
        if (entry.flow.state !== "running") return;
        entry.flow.wantsInput = looksLikePrompt(entry.tail);
        if (entry.flow.wantsInput) {
          const shown = entry.tail.trim();
          if (entry.flow.lines[entry.flow.lines.length - 1] !== shown) this.addLine(entry, shown, true);
          entry.flow.detail = `${entry.flow.vendor} is asking you something: answer below.`;
        }
        this.changed(entry.flow);
      }, 700);
    }
    this.changed(entry.flow);
  }

  private flushTail(entry: Running): void {
    if (entry.tail.trim()) this.addLine(entry, entry.tail.trim());
    entry.tail = "";
  }

  private addLine(entry: Running, raw: string, keepTail = false): void {
    const line = raw.trimEnd().slice(0, 4000);
    if (!line.trim()) return;
    entry.flow.lines.push(line);
    if (entry.flow.lines.length > MAX_LINES) entry.flow.lines.splice(0, entry.flow.lines.length - MAX_LINES);
    const found = readLoginLine(line);
    if (found.url && !entry.flow.url) { entry.flow.url = found.url; entry.flow.detail = `Open the address and follow the steps there; ${entry.flow.vendor} will notice when you are done.`; }
    if (found.code && !entry.flow.code) entry.flow.code = found.code;
    if (!keepTail) entry.tail = entry.tail;
  }

  private end(entry: Running, state: LoginFlow["state"], detail: string): void {
    if (entry.finishing || entry.flow.state !== "running") return;
    entry.flow.detail = "Waiting for the operation's processes to stop…";
    entry.flow.wantsInput = false;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.promptTimer) clearTimeout(entry.promptTimer);
    entry.finishing = true;
    entry.abort.abort();
    entry.cleanup = Promise.all([entry.child ? stopManaged(entry.child) : undefined, entry.agent?.kill(), entry.terminal?.cancel()]).then(() => {
      entry.finishing = false;
      entry.flow.state = state;
      entry.flow.endedAt = Date.now();
      entry.flow.detail = detail;
      this.changed(entry.flow);
    }, error => {
      entry.finishing = false;
      entry.flow.detail = `Still waiting for the operation to stop: ${error instanceof Error ? error.message : String(error)}. Close its terminal or retry Cancel.`;
      this.changed(entry.flow);
    });
  }

  async shutdown(): Promise<void> {
    for (const entry of this.running.values()) if (entry.flow.state === "running") this.end(entry, "cancelled", "The application is closing.");
    await Promise.all([...this.running.values()].map(entry => entry.cleanup));
    if ([...this.running.values()].some(entry => entry.flow.state === "running")) throw new Error("An agent operation has not confirmed it stopped. Its ownership is retained until the process exits.");
  }

  private changed(flow: LoginFlow): void {
    this.emit("change", { ...flow, lines: [...flow.lines] });
  }
}
