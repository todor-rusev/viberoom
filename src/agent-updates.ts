// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { posix, win32 } from "node:path";
import { homedir } from "node:os";
import type { AgentInstallation, VendorId } from "./agent-discovery.js";
import { runManaged, type AgentCommand, type ProcessResult } from "./managed-process.js";
import { compareSemanticVersions, semanticVersion, versionInOutput } from "./agent-version.js";
import { stripAnsi } from "./login-status.js";

export const AGENT_HELP: Record<VendorId, string> = {
  claude: "https://code.claude.com/docs/en/setup", codex: "https://developers.openai.com/codex/cli",
  gemini: "https://geminicli.com/docs/get-started/installation/", cursor: "https://cursor.com/docs/cli/installation",
  opencode: "https://opencode.ai/docs/cli/", copilot: "https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli",
  grok: "https://docs.x.ai/build/cli/reference", hermes: "https://hermes-agent.nousresearch.com/docs/getting-started/updating",
};

export interface AgentUpdate {
  installationId: string; vendor: VendorId; method: AgentInstallation["method"]; executable: string;
  current: string | null; latest: string | null; channel: string;
  status: "current" | "available" | "unknown" | "manual";
  checkedAt: number; detail: string; help: string;
  key?: string; canUpdate: boolean; skipped?: boolean;
}
export interface UpdatePlan {
  command: AgentCommand; cwd: string; detail: string;
  followsChannel?: boolean;
}
export interface UpdateHost {
  platform: NodeJS.Platform; home: string; env: NodeJS.ProcessEnv; now(): number;
  read(path: string): string; real(path: string): string; exists(path: string): boolean;
  run(command: AgentCommand, cwd: string, signal?: AbortSignal): Promise<ProcessResult>;
  text(url: string, signal?: AbortSignal): Promise<string>;
}
async function boundedText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { headers: { accept: "application/json, text/plain", "user-agent": "viberoom-agent-updates" },
    signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(signal ? [signal] : [])]) });
  if (!response.ok) throw new Error(`Update service answered HTTP ${response.status}`);
  if (!response.body) throw new Error("Update service returned no body");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > 2 * 1024 * 1024) throw new Error("Update metadata exceeded its size limit");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => undefined); }
}
const defaults: UpdateHost = {
  platform: process.platform, home: homedir(), env: process.env, now: Date.now,
  read: p => readFileSync(p, "utf8"), real: realpathSync, exists: existsSync,
  run: (spec, cwd, signal) => runManaged(spec, cwd, { signal, timeoutMs: 25_000, maxBytes: 1024 * 1024 }), text: boundedText,
};
const jsManagers = new Set(["npm", "pnpm", "yarn", "bun"]);
const cursorBuild = /^\d{4}\.\d{2}\.\d{2}(?:-\d{2}\.\d{2}\.\d{2})?-[a-f0-9]{7,40}$/;
const fullSha = /^[a-f0-9]{40}$/;
const safeTag = /^[a-zA-Z][a-zA-Z0-9._-]*$/;
function json(raw: string): any { return JSON.parse(raw.trim()); }
function cleanError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 280); }

export function cursorInstallerVersion(source: string): string | null {
  const matches = [...source.matchAll(/(?:\$version|VERSION)\s*=\s*['"](\d{4}\.\d{2}\.\d{2}(?:-\d{2}\.\d{2}\.\d{2})?-[a-f0-9]{7,40})['"]/g)];
  const versions = [...new Set(matches.map(m => m[1]))];
  return versions.length === 1 ? versions[0] : null;
}
export function wingetRow(output: string, id: string): { current: string; latest: string | null } | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = stripAnsi(output).split(/\r?\n/);
  const rows = lines.map(line => new RegExp(`(?:^|\\s)${escaped}\\s+(\\S+)(?:\\s+(\\S+))?`).exec(line)).filter(m => m && semanticVersion(m[1]));
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  return { current: row[1], latest: row[2] && semanticVersion(row[2]) ? row[2] : null };
}

export class AgentUpdateProviders {
  readonly host: UpdateHost;
  constructor(host: Partial<UpdateHost> = {}) { this.host = { ...defaults, ...host }; }
  private path() { return this.host.platform === "win32" ? win32 : posix; }
  private readJson(path: string): any { try { return json(this.host.read(path)); } catch { return null; } }
  private async command(spec: AgentCommand, cwd: string, signal?: AbortSignal): Promise<string> {
    const result = await this.host.run(spec, cwd, signal);
    if (result.cancelled) throw new Error("Check cancelled");
    if (result.timedOut) throw new Error("The agent's update check timed out");
    if (result.error || result.code !== 0) throw new Error(`Update check command did not complete (exit ${result.code ?? "unknown"}). Use the vendor's installer or try again.`);
    return stripAnsi(result.output).trim();
  }
  private cli(installation: AgentInstallation, args: string[]): AgentCommand {
    return { ...installation.cli, args: [...installation.cli.args, ...args] };
  }
  async current(installation: AgentInstallation, signal?: AbortSignal): Promise<string> {
    if (installation.vendor === "hermes" && installation.method === "git") {
      const sha = await this.command({ command: "git", args: ["rev-parse", "HEAD"], env: { GIT_TERMINAL_PROMPT: "0" } }, installation.root, signal);
      if (!fullSha.test(sha)) throw new Error("Hermes did not report a commit identity");
      return sha;
    }
    const output = await this.command(this.cli(installation, installation.vendor === "grok" ? ["version"] : ["--version"]), this.host.home, signal);
    if (installation.vendor === "cursor") {
      const builds = output.split(/\s+/).filter(x => cursorBuild.test(x));
      if (new Set(builds).size === 1) return builds[0];
      throw new Error("Cursor did not report a recognised build identity");
    }
    const version = versionInOutput(output);
    if (!version) throw new Error("The installed agent did not report one recognised version");
    return version;
  }
  private base(i: AgentInstallation): AgentUpdate {
    return { installationId: i.id, vendor: i.vendor, method: i.method, executable: i.executable, current: null, latest: null,
      channel: i.channel, status: "unknown", checkedAt: this.host.now(), detail: "Not checked", help: AGENT_HELP[i.vendor], canUpdate: false };
  }
  private offer(state: AgentUpdate, latest: string, comparison?: number): AgentUpdate {
    if (!state.current) throw new Error("Installed version is unknown");
    const order = comparison ?? compareSemanticVersions(latest, state.current);
    if (order === null) throw new Error("The release uses an unrecognised version format");
    state.latest = latest; state.status = order > 0 ? "available" : "current";
    state.detail = order > 0 ? "An update is available." : "No newer version was found on this channel.";
    state.canUpdate = order > 0;
    if (order > 0) state.key = `${state.installationId}:${state.channel}:${latest}`;
    return state;
  }
  private manager(i: AgentInstallation, args: string[], env?: Record<string, string>): AgentCommand {
    if (!i.manager) throw new Error(`The ${i.method} that owns this installation was not found. Restore it before updating.`);
    return { command: i.manager, args, env };
  }
  private async confirmJsManager(i: AgentInstallation, signal?: AbortSignal): Promise<void> {
    if (!i.packageName || !i.packageRoot || !i.prefix) throw new Error("The global package location could not be verified");
    if (i.method === "npm" || i.method === "bun" || i.method === "yarn") return;
    const root = await this.command(this.manager(i, ["root", "--global"]), this.host.home, signal);
    let actual: string;
    try { actual = this.host.real(this.path().join(root, i.packageName)); } catch { throw new Error("The package manager points to a different global directory"); }
    if (actual !== this.host.real(i.packageRoot)) throw new Error("The package manager points to a different copy. Update this installation with its original package manager.");
  }
  private async packageLatest(i: AgentInstallation, state: AgentUpdate, signal?: AbortSignal): Promise<string> {
    await this.confirmJsManager(i, signal);
    const verb = i.method === "yarn" || i.method === "bun" ? "info" : "view";
    const readField = async (field: string) => {
      const raw = await this.command(this.manager(i, [verb, i.packageName!, field, "--json"]), this.host.home, signal);
      if (i.method !== "yarn") return json(raw);
      const items = raw.split(/\r?\n/).map(line => { try { return json(line); } catch { return null; } }).filter(x => x?.type === "inspect");
      if (items.length !== 1) throw new Error("Yarn returned an unrecognised response");
      return items[0].data;
    };
    const tags = await readField("dist-tags");
    if (!tags || typeof tags !== "object" || Array.isArray(tags)) throw new Error("The package registry did not return release channels");
    const pre = semanticVersion(state.current!)?.pre[0];
    let channel = pre && !/^\d+$/.test(pre) ? pre : "latest";
    if (!tags[channel] && pre) {
      const exact = Object.keys(tags).filter(key => key !== "latest" && tags[key] === state.current);
      if (exact.length !== 1) throw new Error("The installed prerelease's channel cannot be identified. Choose the channel with your package manager.");
      channel = exact[0];
    }
    if (!safeTag.test(channel) || typeof tags[channel] !== "string" || !semanticVersion(tags[channel])) throw new Error("The package registry did not return a valid version for this channel");
    state.channel = channel;
    return tags[channel];
  }
  async check(i: AgentInstallation, signal?: AbortSignal): Promise<AgentUpdate> {
    const state = this.base(i);
    try {
      state.current = await this.current(i, signal);
      if (jsManagers.has(i.method)) return this.offer(state, await this.packageLatest(i, state, signal));
      if (i.method === "brew") {
        const raw = json(await this.command(this.manager(i, ["info", "--json=v2", i.packageName!], { HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_ANALYTICS: "1" }), this.host.home, signal));
        const formula = raw.formulae?.find((x: any) => x.name === i.packageName || x.full_name === i.packageName);
        const cask = raw.casks?.find((x: any) => x.token === i.packageName || x.full_token === i.packageName);
        const item = formula ?? cask;
        if (!item || item.pinned || item.installed?.some?.((x: any) => x.version === "HEAD")) throw new Error("Homebrew reports a pinned, HEAD or unrecognised installation. Manage it with brew.");
        const tap = item.tap;
        if (tap !== "homebrew/core" && tap !== "homebrew/cask") throw new Error("This Homebrew tap has no supported read-only release feed. Use brew upgrade for this package.");
        const release = json(await this.host.text(`https://formulae.brew.sh/api/${formula ? "formula" : "cask"}/${encodeURIComponent(i.packageName!)}.json`, signal));
        state.channel = formula ? "formula" : "cask";
        const latest = formula ? release.versions?.stable : release.version;
        if (typeof latest !== "string") throw new Error("Homebrew returned no stable version");
        return this.offer(state, latest);
      }
      if (i.method === "winget") {
        if (!i.packageName) throw new Error("The WinGet package identity could not be verified");
        const row = wingetRow(await this.command(this.manager(i, ["list", "--id", i.packageName, "--exact", "--source", "winget", "--disable-interactivity"]), this.host.home, signal), i.packageName);
        if (!row || compareSemanticVersions(row.current, state.current)! > 0) throw new Error("WinGet and the executable disagree about the installed version. Check the installation before updating.");
        state.channel = "winget";
        this.offer(state, row.latest ?? row.current);
        if (state.status === "current" && compareSemanticVersions(state.current, row.current)! > 0) state.detail = "The executable is already newer than WinGet’s installation record. No newer release is offered by WinGet.";
        return state;
      }
      if (i.method === "scoop") {
        const p = this.path(), installed = this.readJson(p.join(i.root, "current/install.json"));
        if (installed?.hold) throw new Error("This Scoop package is held. Change the hold in Scoop before updating.");
        const bucket = installed?.bucket;
        if (typeof bucket !== "string" || !/^[a-z0-9_-]+$/i.test(bucket) || !i.packageName || !/^[a-z0-9@._-]+$/i.test(i.packageName)) throw new Error("Scoop did not retain a recognised source bucket for this package");
        const userRoot = this.host.env.SCOOP || p.join(this.host.home, "scoop");
        const bucketDir = p.join(i.scope === "machine" ? userRoot : i.prefix!, "buckets", bucket);
        const git = (args: string[]) => this.command({ command: "git", args, env: { GIT_TERMINAL_PROMPT: "0" } }, bucketDir, signal);
        const remote = await git(["remote", "get-url", "origin"]);
        const repo = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remote)?.[1];
        const branch = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
        if (!repo || !/^[\w./-]+$/.test(branch) || branch.includes("..")) throw new Error("This Scoop bucket has no supported release feed. Refresh it with Scoop.");
        const manifest = json(await this.host.text(`https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/bucket/${encodeURIComponent(i.packageName)}.json`, signal));
        state.channel = `${bucket}/${branch}`;
        if (typeof manifest.version !== "string") throw new Error("The Scoop bucket returned no package version");
        return this.offer(state, manifest.version);
      }
      if (i.method === "git" && i.vendor === "hermes") return await this.hermes(i, state, signal);
      if (i.method !== "native") {
        state.status = "manual";
        state.detail = "This copy is managed externally. Update it with the installer or package manager that owns this path, then check again.";
        return state;
      }
      if (i.vendor === "cursor") {
        const source = await this.host.text(this.host.platform === "win32" ? "https://cursor.com/install?win32=true" : "https://cursor.com/install", signal);
        const latest = cursorInstallerVersion(source);
        if (!latest) throw new Error("Cursor's installer no longer exposes a recognised build identity");
        state.channel = "native";
        return this.offer(state, latest, latest === state.current || latest.slice(0, 10) < state.current.slice(0, 10) ? 0 : 1);
      }
      if (i.vendor === "claude") {
        const configHome = this.host.env.CLAUDE_CONFIG_DIR || this.path().join(this.host.home, ".claude");
        const config = this.readJson(this.path().join(configHome, "settings.json"));
        const channel = config?.autoUpdatesChannel ?? "latest";
        if (channel !== "latest" && channel !== "stable") throw new Error("Claude's configured release channel is not recognised");
        state.channel = channel;
        const latest = (await this.host.text(`https://downloads.claude.ai/claude-code-releases/${channel}`, signal)).trim();
        return this.offer(state, latest);
      }
      if (i.vendor === "grok") {
        const output = await this.command(this.cli(i, ["update", "--check"]), this.host.home, signal);
        const versions = [...new Set((output.match(/\bv?\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?\b/g) ?? []).map(v => v.replace(/^v/, "")))];
        if (!versions.length || versions.some(v => !semanticVersion(v))) throw new Error("Grok's update check returned no recognised release");
        const latest = versions.sort((a, b) => compareSemanticVersions(a, b)!)[versions.length - 1];
        state.channel = semanticVersion(latest)?.pre.length ? "alpha" : "stable";
        return this.offer(state, latest);
      }
      const pkg = i.vendor === "codex" ? "@openai/codex" : i.vendor === "opencode" ? "opencode-ai" : i.vendor === "copilot" ? "@github/copilot" : null;
      if (!pkg || semanticVersion(state.current)?.pre.length) throw new Error("This native release channel has no supported update check. Use the vendor's updater.");
      state.channel = "latest";
      const release = json(await this.host.text(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, signal));
      return this.offer(state, release.version);
    } catch (error) { state.status = "unknown"; state.canUpdate = false; state.detail = cleanError(error); return state; }
  }
  private async hermes(i: AgentInstallation, state: AgentUpdate, signal?: AbortSignal): Promise<AgentUpdate> {
    const git = (args: string[]) => this.command({ command: "git", args, env: { GIT_TERMINAL_PROMPT: "0" } }, i.root, signal);
    const branch = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const remote = await git(["remote", "get-url", "origin"]);
    if (branch !== "main" || !/^(?:https:\/\/github\.com\/|git@github\.com:)NousResearch\/hermes-agent(?:\.git)?\/?$/i.test(remote)) throw new Error("This Hermes checkout uses a custom branch or remote. Update it with its owner’s workflow.");
    if (await git(["status", "--porcelain", "--untracked-files=no"])) throw new Error("Hermes has local tracked changes. Review them before updating; viberoom will not stash or overwrite them.");
    const tip = (await git(["ls-remote", "origin", "refs/heads/main"])).split(/\s+/)[0];
    if (!fullSha.test(tip)) throw new Error("Hermes returned no upstream commit");
    state.channel = "main";
    if (tip === state.current) return this.offer(state, tip, 0);
    const comparison = json(await this.host.text(`https://api.github.com/repos/NousResearch/hermes-agent/compare/${state.current}...${tip}`, signal));
    if (comparison.status !== "ahead" && comparison.status !== "behind" && comparison.status !== "identical") throw new Error("Hermes has diverged from its update branch; resolve this in the checkout before updating.");
    const answer = this.offer(state, tip, comparison.status === "ahead" ? 1 : 0);
    if (answer.status === "available") {
      answer.canUpdate = false;
      answer.detail = "A Hermes commit is available. Its updater also manages dependencies and gateways; run hermes update in a terminal, then check again.";
    }
    return answer;
  }
  async plan(i: AgentInstallation, offer: AgentUpdate, signal?: AbortSignal): Promise<UpdatePlan> {
    if (offer.installationId !== i.id || offer.status !== "available" || !offer.canUpdate || !offer.latest) throw new Error("This update offer is no longer applicable. Check again.");
    const version = offer.latest;
    let command: AgentCommand;
    if (jsManagers.has(i.method)) {
      await this.confirmJsManager(i, signal);
      if (!semanticVersion(version)) throw new Error("Invalid package version");
      const pkg = `${i.packageName}@${version}`;
      if (i.method === "npm") command = this.manager(i, ["install", "--global", "--prefix", i.prefix!, pkg]);
      else if (i.method === "pnpm") command = this.manager(i, ["add", "--global", pkg]);
      else if (i.method === "yarn") command = this.manager(i, ["global", "add", "--global-folder", i.prefix!, "--prefix", this.path().dirname(this.path().dirname(i.executable)), pkg]);
      else command = this.manager(i, ["add", "--global", pkg], { BUN_INSTALL_GLOBAL_DIR: i.prefix!, BUN_INSTALL_BIN: this.path().dirname(i.executable) });
    } else if (i.method === "brew") command = this.manager(i, ["upgrade", `--${offer.channel}`, i.packageName!], { HOMEBREW_NO_ANALYTICS: "1" });
    else if (i.method === "winget") command = this.manager(i, ["upgrade", "--id", i.packageName!, "--exact", "--source", "winget", "--version", version, "--disable-interactivity"]);
    else if (i.method === "scoop") {
      const manager = this.manager(i, []);
      const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
      const invoke = `& ${quote(manager.command)} update`;
      command = { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `${invoke}; if (!$?) { exit 1 }; ${invoke} ${quote(i.packageName!)}${i.scope === "machine" ? " --global" : ""}; if (!$?) { exit 1 }`],
        env: i.scope === "machine" ? { SCOOP_GLOBAL: i.prefix! } : { SCOOP: i.prefix! } };
    }
    else if (i.method === "native") {
      const args = i.vendor === "opencode" ? ["upgrade", version, "--method", "curl"] : i.vendor === "grok" ? ["update", "--version", version] : ["update"];
      const help = await this.command(this.cli(i, [args[0], "--help"]), this.host.home, signal);
      if (!new RegExp(`\\b${args[0]}\\b`, "i").test(help) || !/update|upgrade/i.test(help)) throw new Error("This installed release does not expose the expected updater. Use the vendor’s installation instructions.");
      command = this.cli(i, args);
    } else throw new Error("This installation is updated by its external manager");
    return { command, cwd: this.host.home, detail: `Update the existing ${i.method} installation at ${i.executable}.`, followsChannel: ["brew", "scoop"].includes(i.method) || i.method === "native" && !["opencode", "grok"].includes(i.vendor) };
  }
}
