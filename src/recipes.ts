// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loginState, type LoginProbe, type LoginState } from "./agent-health.js";
import { readClaudeStatus, readCodexStatus, readGrokStatus, readHermesStatus, readOpenCodeStatus, type LoginCheck, type LoginStatusSpec } from "./login-status.js";
import type { LoginFlowSpec } from "./login-flow.js";
import { commandLine as terminalLine, type TerminalShell } from "./terminal.js";

export type InstallSpec =
  | { kind: "command"; command: string; args: string[]; shell: TerminalShell; line: string; note: string }
  | { kind: "terminal"; shell: TerminalShell; line: string; note: string }
  | { kind: "url"; url: string; note: string };

export type AgentTypeId = "claude" | "codex" | "gemini" | "cursor" | "opencode" | "copilot" | "grok" | "hermes" | "fake";

export interface LaunchSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AgentRecipe {
  id: AgentTypeId;
  label: string;
  vendor: string;
  icon: string;
  tested: boolean;
  note: string;
  modelPresets: string[];
  defaultModel: string | null;
  effortPresets: string[];
  defaultEffort: string | null;
  modePresets: string[];
  defaultMode: string | null;
  unavailableReason: string | null;
  installedAt: string | null;
  installHint: string;
  install: InstallSpec;
  loginCommand: string;
  login?: LoginProbe;
  loginState: LoginState;
  loginStatus: LoginStatusSpec;
  loginChecked?: LoginCheck;
  loginChecking?: boolean;
  loginFlow: LoginFlowSpec;
  loginTerminalLine: string | null;
  modelAtLaunch?: boolean;
  bypassMode: string | null;
  bypassConfig?: Record<string, string>;
  modeAtLaunch?: boolean;
  build(options: { model: string | null; mode: string | null }): LaunchSpec;
}

const isWindows = process.platform === "win32";

const ICON_VERSION: string = (() => {
  try {
    return String((createRequire(import.meta.url)("../package.json") as { version?: string }).version ?? "0");
  } catch {
    return "0";
  }
})();
const iconUrl = (id: string): string => `/vendor-icons/${id}.svg?v=${ICON_VERSION}`;

function resolvePackageEntry(packageName: string, relativeEntry: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve(`${packageName}/package.json`);
    const entry = join(dirname(pkg), relativeEntry);
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

let globalNpmRoot: string | null | undefined;
function resolveGlobalNpmRoot(): string | null {
  if (globalNpmRoot !== undefined) return globalNpmRoot;
  const candidates: string[] = [];
  if (isWindows && process.env.APPDATA) candidates.push(join(process.env.APPDATA, "npm", "node_modules"));
  try {
    const out = execSync("npm root -g", { encoding: "utf8", shell: isWindows ? "cmd.exe" : "/bin/sh", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    if (out) candidates.push(out);
  } catch {
  }
  globalNpmRoot = candidates.find((c) => existsSync(c)) ?? null;
  return globalNpmRoot;
}

function resolveGlobalPackageEntry(packageName: string, relativeEntry: string): string | null {
  const root = resolveGlobalNpmRoot();
  if (!root) return null;
  const entry = join(root, packageName, relativeEntry);
  return existsSync(entry) ? entry : null;
}

function resolveCursorAgent(): { node: string; index: string } | null {
  const base = isWindows
    ? process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "cursor-agent")
    : join(homedir(), ".local", "share", "cursor-agent");
  if (!base || !existsSync(join(base, "versions"))) return null;
  const versions = readdirSync(join(base, "versions"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}\.\d{1,2}\.\d{1,2}/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => versionKey(b) - versionKey(a));
  for (const version of versions) {
    const dir = join(base, "versions", version);
    const node = join(dir, isWindows ? "node.exe" : "node");
    const index = join(dir, "index.js");
    if (existsSync(node) && existsSync(index)) return { node, index };
  }
  return null;
}

function versionKey(name: string): number {
  const [y, m, d] = name.split("-")[0].split(".").map((n) => Number(n));
  return y * 10000 + m * 100 + d;
}

function resolveOnPath(names: string[]): string | null {
  for (const name of names) {
    try {
      const out = execSync(isWindows ? `where ${name}` : `command -v ${name}`, {
        encoding: "utf8",
        shell: isWindows ? "cmd.exe" : "/bin/sh",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      const first = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && existsSync(l) && (!isWindows || /\.(exe|cmd|bat)$/i.test(l)));
      if (first) return first;
    } catch {
    }
  }
  return null;
}

function resolveOpenCode(): string | null {
  const fromNpm =
    resolveGlobalPackageEntry("opencode-ai", join("bin", isWindows ? "opencode.exe" : "opencode")) ??
    resolvePackageEntry("opencode-ai", join("bin", isWindows ? "opencode.exe" : "opencode"));
  if (fromNpm) return fromNpm;
  const onPath = resolveOnPath(["opencode"]);
  return onPath && !/\.(cmd|bat)$/i.test(onPath) ? onPath : null;
}

function resolveCopilot(): string | null {
  const onPath = resolveOnPath(["copilot"]);
  if (onPath && !/\.(cmd|bat)$/i.test(onPath)) return onPath;
  if (isWindows && process.env.LOCALAPPDATA) {
    const winget = join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "copilot.exe");
    if (existsSync(winget)) return winget;
  }
  return null;
}

function resolveGlobalNpmBin(name: string): string | null {
  const root = resolveGlobalNpmRoot();
  if (!root) return null;
  const candidates = isWindows ? [join(root, "..", `${name}.cmd`)] : [join(root, "..", "..", "bin", name)];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function resolveGlobalPackageBin(packageName: string, command: string): string | null {
  const root = resolveGlobalNpmRoot();
  if (!root) return null;
  const dir = join(root, packageName);
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { bin?: string | Record<string, string> };
    const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[command];
    if (!entry) return null;
    const file = join(dir, entry);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

function resolveClaudeCode(): string | null {
  const onPath = resolveOnPath(["claude"]);
  if (onPath && !/\.(cmd|bat)$/i.test(onPath)) return onPath;
  const native = join(homedir(), ".local", "bin", isWindows ? "claude.exe" : "claude");
  if (existsSync(native)) return native;
  return resolveGlobalPackageBin("@anthropic-ai/claude-code", "claude");
}

function resolveCodex(): string | null {
  return resolveGlobalNpmBin("codex") ?? resolveOnPath(["codex"]);
}

function realHome(): string | null {
  try {
    return realpathSync(homedir());
  } catch {
    return null;
  }
}

function resolveGrok(): string | null {
  const exe = isWindows ? "grok.exe" : "grok";
  const home = realHome();
  const dirs = [process.env.GROK_BIN_DIR, process.env.GROK_HOME && join(process.env.GROK_HOME, "bin"), join(homedir(), ".grok", "bin"), home && join(home, ".grok", "bin")];
  for (const dir of dirs) if (dir && existsSync(join(dir, exe))) return join(dir, exe);
  const onPath = resolveOnPath(["grok"]);
  return onPath && !/\.(cmd|bat|ps1)$/i.test(onPath) ? onPath : null;
}

function resolveHermes(): { command: string; args: string[]; cli: string | null } | null {
  const hermesHome = process.env.HERMES_HOME || (isWindows ? process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "hermes") : join(homedir(), ".hermes"));
  const scripts = isWindows ? "Scripts" : "bin";
  const exe = (name: string) => (isWindows ? `${name}.exe` : name);
  const candidates: { command: string; args: string[] }[] = [];
  if (hermesHome) {
    const venv = join(hermesHome, "hermes-agent", "venv");
    candidates.push({ command: join(venv, scripts, exe("hermes-acp")), args: [] }, { command: join(venv, scripts, exe("hermes")), args: ["acp"] });
    if (isWindows) candidates.push({ command: join(hermesHome, "bin", "hermes-acp.exe"), args: [] }, { command: join(hermesHome, "bin", "hermes.exe"), args: ["acp"] });
  }
  if (!isWindows) {
    candidates.push({ command: join(homedir(), ".local", "bin", "hermes"), args: ["acp"] }, { command: "/usr/local/lib/hermes-agent/venv/bin/hermes-acp", args: [] }, { command: "/usr/local/bin/hermes", args: ["acp"] });
  }
  const withCli = (found: { command: string; args: string[] }) => {
    const sibling = join(dirname(found.command), exe("hermes"));
    return { ...found, cli: existsSync(sibling) ? sibling : /^hermes(\.exe)?$/i.test(basename(found.command)) ? found.command : null };
  };
  for (const candidate of candidates) if (existsSync(candidate.command)) return withCli(candidate);
  const onPath = resolveOnPath(["hermes-acp", "hermes"]);
  if (onPath && !/\.(cmd|bat|ps1)$/i.test(onPath)) return withCli({ command: onPath, args: /^hermes-acp/i.test(basename(onPath)) ? [] : ["acp"] });
  return null;
}

const vendorDir = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "acp");
const claudeAdapter = join(vendorDir, "claude-agent-acp", "dist", "index.js");
const codexAdapter = join(vendorDir, "codex-acp", "dist", "index.js");
function resolveNpmCli(): string | null {
  const nodeDir = dirname(process.execPath);
  for (const candidate of [join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"), join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")]) if (existsSync(candidate)) return candidate;
  return resolveOnPath(["npm"]);
}

function buildRecipes(): AgentRecipe[] {
  const shellHere: TerminalShell = isWindows ? "cmd" : "sh";
  const npmCli = resolveNpmCli();
  const npmInstall = (pkg: string, vendor: string): InstallSpec => {
    const line = `npm install -g ${pkg}`;
    const note = `${vendor} comes from npm; Node is already here, since viberoom runs on it.`;
    return npmCli ? { kind: "command", command: npmCli, args: ["install", "-g", pkg], shell: shellHere, line, note } : { kind: "terminal", shell: shellHere, line, note };
  };
  const scriptInstall = (vendor: string, unix: string, windows: string): InstallSpec =>
    isWindows ? { kind: "terminal", shell: "powershell", line: windows, note: `${vendor}'s own installer, from its website.` } : { kind: "terminal", shell: "sh", line: unix, note: `${vendor}'s own installer, from its website.` };
  const claudeExe = resolveClaudeCode();
  const codexExe = resolveCodex();
  const geminiEntry =
    resolvePackageEntry("@google/gemini-cli", join("bundle", "gemini.js")) ??
    resolveGlobalPackageEntry("@google/gemini-cli", join("bundle", "gemini.js"));
  const cursorAgent = resolveCursorAgent();
  const openCodeExe = resolveOpenCode();
  const copilotExe = resolveCopilot();
  const grokExe = resolveGrok();
  const hermesLaunch = resolveHermes();
  const geminiCli = geminiEntry ? resolveOnPath(["gemini"]) : null;
  const terminalLines = {
    claude: claudeExe ? terminalLine([claudeExe, "auth", "login"]) : null,
    codex: codexExe ? terminalLine([codexExe, "login"]) : null,
    gemini: geminiCli ? terminalLine([geminiCli]) : geminiEntry ? terminalLine([process.execPath, geminiEntry]) : null,
    cursor: cursorAgent ? terminalLine([cursorAgent.node, cursorAgent.index, "login"]) : null,
    opencode: openCodeExe ? terminalLine([openCodeExe, "auth", "login"]) : null,
    copilot: copilotExe ? terminalLine([copilotExe, "login"]) : null,
    grok: grokExe ? terminalLine([grokExe, "login"]) : null,
    hermes: hermesLaunch?.cli ? terminalLine([hermesLaunch.cli, "model"]) : null,
  };

  const recipes: AgentRecipe[] = [
    {
      id: "claude",
      label: "Claude (claude-agent-acp)",
      vendor: "Claude",
      icon: iconUrl("claude"),
      tested: true,
      note: "Adapter around the Claude Agent SDK, driving the Claude Code installed on this machine with its login and settings.",
      modelPresets: ["haiku", "sonnet", "opus", "default"],
      defaultModel: "sonnet",
      effortPresets: ["low", "medium", "high", "default"],
      defaultEffort: "low",
      modePresets: ["default", "acceptEdits", "plan", "auto", "bypassPermissions"],
      defaultMode: "default",
      bypassMode: "bypassPermissions",
      unavailableReason: claudeExe ? null : "Claude Code not found",
      installedAt: claudeExe,
      installHint: "install Claude Code (npm install -g @anthropic-ai/claude-code, or the native installer) and log in with `claude`",
      install: npmInstall("@anthropic-ai/claude-code", "Claude Code"),
      loginCommand: "claude",
      login: { env: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"], files: [".claude/.credentials.json"], command: "claude", fileless: ["darwin"] },
      loginStatus: { kind: "command", command: claudeExe, args: ["auth", "status", "--json"], read: readClaudeStatus },
      loginFlow: { kind: "command", command: claudeExe, args: ["auth", "login"], hint: "Claude opens your browser: sign in there. If it shows a code instead, paste it here." },
      loginTerminalLine: terminalLines.claude,
      loginState: "unknown",
      build: ({ model }) => ({
        command: process.execPath,
        args: [claudeAdapter],
        env: { CLAUDE_CODE_EXECUTABLE: claudeExe ?? "", ...(model && model !== "default" ? { ANTHROPIC_MODEL: model } : {}) },
      }),
    },
    {
      id: "codex",
      label: "Codex (codex-acp)",
      vendor: "Codex",
      icon: iconUrl("codex"),
      tested: true,
      note: "Adapter around the Codex App Server of the Codex CLI installed on this machine; uses its login (~/.codex) or CODEX_API_KEY. Mode 'agent' edits the working directory without asking; 'read-only' for a chat-only participant.",
      modelPresets: ["gpt-5.4-mini", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
      defaultModel: "gpt-5.4-mini",
      effortPresets: ["low", "medium", "high", "xhigh"],
      defaultEffort: "low",
      modePresets: ["read-only", "agent", "agent-full-access"],
      defaultMode: "read-only",
      bypassMode: "agent-full-access",
      unavailableReason: codexExe ? null : "Codex CLI not found",
      installedAt: codexExe,
      installHint: "install Codex (npm install -g @openai/codex) and log in with `codex login`",
      install: npmInstall("@openai/codex", "Codex"),
      loginCommand: "codex login",
      login: { env: ["CODEX_API_KEY", "OPENAI_API_KEY"], files: [".codex/auth.json"], command: "codex login" },
      loginStatus: { kind: "command", command: codexExe, args: ["login", "status"], read: readCodexStatus },
      loginFlow: { kind: "command", command: codexExe, args: ["login", "--device-auth"], hint: "Codex shows a web address and a code: open the address, enter the code, and it signs in.", scene: "code" },
      loginTerminalLine: terminalLines.codex,
      loginState: "unknown",
      build: () => ({
        command: process.execPath,
        args: [codexAdapter],
        env: { CODEX_PATH: codexExe ?? "", NO_BROWSER: "1" },
      }),
    },
    {
      id: "gemini",
      label: "Gemini CLI (gemini --acp)",
      vendor: "Gemini",
      icon: iconUrl("gemini"),
      tested: true,
      note: "Native ACP mode of the globally installed Gemini CLI; uses the machine's Gemini login / API key. Exposes no config options over ACP: the model is fixed at launch (--model).",
      modelPresets: ["gemini-3.8-flash", "gemini-3.7-flash"],
      defaultModel: null,
      effortPresets: [],
      defaultEffort: null,
      modePresets: ["default", "autoEdit", "yolo", "plan"],
      defaultMode: "default",
      bypassMode: "yolo",
      unavailableReason: geminiEntry ? null : "Gemini CLI not found",
      installedAt: geminiEntry,
      installHint: "npm install -g @google/gemini-cli, then sign in once (gemini)",
      install: npmInstall("@google/gemini-cli", "Gemini CLI"),
      loginCommand: "gemini",
      login: { env: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"], files: [".gemini/google_accounts.json", ".gemini/oauth_creds.json"], command: "gemini" },
      loginStatus: { kind: "acp" },
      loginFlow: { kind: "terminal", commandLine: terminalLines.gemini ?? "gemini", hint: "Gemini signs in inside its own screen the first time it runs: pick Google login there and follow it." },
      loginTerminalLine: terminalLines.gemini,
      loginState: "unknown",
      modelAtLaunch: true,
      build: ({ model }) => ({
        command: process.execPath,
        args: [geminiEntry ?? "", "--acp", ...(model ? ["--model", model] : [])],
        env: { GEMINI_CLI_TRUST_WORKSPACE: "true" },
      }),
    },
    {
      id: "cursor",
      label: "Cursor (cursor-agent acp)",
      vendor: "Cursor",
      icon: iconUrl("cursor"),
      tested: true,
      note: "Cursor's CLI agent in native ACP mode; uses the machine's Cursor login (agent login) or CURSOR_API_KEY. Mode 'agent' edits without asking; 'ask' is read-only Q&A. Models: see the session settings after joining.",
      modelPresets: [],
      defaultModel: null,
      effortPresets: [],
      defaultEffort: null,
      modePresets: ["agent", "plan", "ask"],
      defaultMode: "ask",
      bypassMode: "agent",
      unavailableReason: cursorAgent ? null : "Cursor CLI not found",
      installedAt: cursorAgent?.index ?? null,
      installHint: "install cursor-agent (cursor.com/cli), then agent login",
      install: { kind: "url", url: "https://cursor.com/cli", note: "Cursor's CLI is installed from cursor.com: follow the steps there, then come back and press \"Check again\"." },
      loginCommand: "cursor-agent login",
      login: { env: ["CURSOR_API_KEY"], files: [], command: "cursor-agent login" },
      loginStatus: { kind: "acp" },
      loginFlow: { kind: "command", command: cursorAgent?.node ?? null, args: [cursorAgent?.index ?? "", "login"], hint: "Cursor opens your browser: sign in there and come back." },
      loginTerminalLine: terminalLines.cursor,
      loginState: "unknown",
      build: () => ({
        command: cursorAgent?.node ?? "",
        args: [cursorAgent?.index ?? "", "acp"],
        env: { CURSOR_INVOKED_AS: "cursor-agent" },
      }),
    },
    {
      id: "opencode",
      label: "OpenCode (opencode acp)",
      vendor: "OpenCode",
      icon: iconUrl("opencode"),
      tested: false,
      note: "The open-source coding agent in native ACP mode; the model list comes from the providers configured in OpenCode (opencode providers). Mode 'plan' is read-only; 'build' edits the working directory (OpenCode's own permission config decides what still asks; the questions arrive here).",
      modelPresets: [],
      defaultModel: null,
      effortPresets: [],
      defaultEffort: null,
      modePresets: ["plan", "build"],
      defaultMode: "plan",
      bypassMode: "build",
      unavailableReason: openCodeExe ? null : "OpenCode not found",
      installedAt: openCodeExe,
      installHint: "npm install -g opencode-ai (or curl -fsSL https://opencode.ai/install | bash), then opencode providers",
      install: npmInstall("opencode-ai", "OpenCode"),
      loginCommand: "opencode auth login",
      login: { env: [], files: [".local/share/opencode/auth.json", "AppData/Local/opencode/auth.json", ".config/opencode/auth.json"], command: "opencode auth login" },
      loginStatus: { kind: "command", args: ["auth", "list"], read: readOpenCodeStatus },
      loginFlow: { kind: "terminal", commandLine: terminalLines.opencode ?? "opencode auth login", hint: "OpenCode asks which provider and for its key, in a menu of its own." },
      loginTerminalLine: terminalLines.opencode,
      loginState: "unknown",
      build: () => ({
        command: openCodeExe ?? "",
        args: ["acp"],
      }),
    },
    {
      id: "copilot",
      label: "GitHub Copilot (copilot --acp)",
      vendor: "Copilot",
      icon: iconUrl("copilot"),
      tested: false,
      note: "GitHub Copilot CLI in native ACP mode; uses the machine's Copilot login (copilot login). Session modes agent / plan / autopilot; the 'allow_all' option decides whether tool calls ask for permission. Exposes no model option over ACP: the model is fixed at launch (--model, e.g. auto).",
      modelPresets: ["auto"],
      defaultModel: null,
      effortPresets: [],
      defaultEffort: null,
      modePresets: [
        "https://agentclientprotocol.com/protocol/session-modes#agent",
        "https://agentclientprotocol.com/protocol/session-modes#plan",
      ],
      defaultMode: "https://agentclientprotocol.com/protocol/session-modes#agent",
      bypassMode: "https://agentclientprotocol.com/protocol/session-modes#agent",
      bypassConfig: { allow_all: "on" },
      unavailableReason: copilotExe ? null : "GitHub Copilot CLI not found",
      installedAt: copilotExe,
      installHint: "winget install GitHub.Copilot / brew install copilot-cli / npm install -g @github/copilot, then copilot login",
      install: npmInstall("@github/copilot", "Copilot"),
      loginCommand: "copilot",
      login: { env: ["GITHUB_TOKEN", "GH_TOKEN", "COPILOT_API_KEY"], files: [], command: "copilot" },
      loginStatus: { kind: "acp" },
      loginFlow: { kind: "command", command: copilotExe, args: ["login"], hint: "Copilot opens your browser, or shows a code to enter at github.com/login/device.", scene: "code" },
      loginTerminalLine: terminalLines.copilot,
      loginState: "unknown",
      modelAtLaunch: true,
      build: ({ model }) => ({
        command: copilotExe ?? "",
        args: ["--acp", ...(model ? ["--model", model] : [])],
      }),
    },
    {
      id: "grok",
      label: "Grok Build (grok agent stdio)",
      vendor: "Grok",
      icon: iconUrl("grok"),
      tested: true,
      note: "xAI's coding agent in its native ACP mode; uses this machine's Grok login (grok login) or XAI_API_KEY. It reports no session modes over ACP, so the mode is a launch flag: 'ask-first' asks before every tool call, 'always-approve' never does; a change restarts the session with its notes kept. Model and reasoning effort are session options (the model also goes on the launch command).",
      modelPresets: ["grok-4.6", "grok-4.5"],
      defaultModel: null,
      effortPresets: ["xhigh", "high", "medium", "low"],
      defaultEffort: null,
      modePresets: ["ask-first", "always-approve"],
      defaultMode: "ask-first",
      bypassMode: "always-approve",
      unavailableReason: grokExe ? null : "Grok Build not found",
      installedAt: grokExe,
      installHint: "curl -fsSL https://x.ai/cli/install.sh | bash (Windows: irm https://x.ai/cli/install.ps1 | iex), or npm install -g @xai-official/grok; then grok login",
      install: scriptInstall("Grok Build", "curl -fsSL https://x.ai/cli/install.sh | bash", "irm https://x.ai/cli/install.ps1 | iex"),
      loginCommand: "grok login",
      login: { env: ["XAI_API_KEY", "GROK_DEPLOYMENT_KEY"], files: [".grok/auth.json"], command: "grok login" },
      loginStatus: { kind: "command", args: ["models"], read: readGrokStatus },
      loginFlow: { kind: "acp", methodId: "grok.com", hint: "Grok opens your browser: sign in there and come back; viberoom waits." },
      loginTerminalLine: terminalLines.grok,
      loginState: "unknown",
      modeAtLaunch: true,
      build: ({ model, mode }) => ({
        command: grokExe ?? "",
        args: ["agent", ...(model ? ["-m", model] : []), ...(mode === "always-approve" ? ["--always-approve"] : []), "stdio"],
      }),
    },
    {
      id: "hermes",
      label: "Hermes Agent (hermes acp)",
      vendor: "Hermes",
      icon: iconUrl("hermes"),
      tested: true,
      note: "Nous Research's open-source agent in its native ACP mode; the provider and model are the ones configured in Hermes (hermes model). Mode 'default' asks before edits, 'accept_edits' auto-allows workspace and /tmp edits, 'dont_ask' auto-allows file edits except sensitive paths; a tool call that still needs permission arrives here with Hermes' own choices: once, this session, or always.",
      modelPresets: [],
      defaultModel: null,
      effortPresets: [],
      defaultEffort: null,
      modePresets: ["default", "accept_edits", "dont_ask"],
      defaultMode: "default",
      bypassMode: "dont_ask",
      unavailableReason: hermesLaunch ? null : "Hermes Agent not found",
      installedAt: hermesLaunch?.command ?? null,
      installHint: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash (Windows: iex (irm https://hermes-agent.nousresearch.com/install.ps1)), then hermes model",
      install: scriptInstall("Hermes Agent", "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash", "iex (irm https://hermes-agent.nousresearch.com/install.ps1)"),
      loginCommand: "hermes model",
      login: { env: [], files: [], command: "hermes model" },
      loginStatus: { kind: "command", command: hermesLaunch?.cli ?? null, args: ["status"], read: readHermesStatus, timeoutMs: 40_000 },
      loginFlow: { kind: "terminal", commandLine: terminalLines.hermes ?? "hermes model", hint: "Hermes asks for a provider and its key or sign-in, in a menu of its own." },
      loginTerminalLine: terminalLines.hermes,
      loginState: "unknown",
      build: () => ({
        command: hermesLaunch?.command ?? "",
        args: hermesLaunch?.args ?? [],
      }),
    },
  ];

  const fakeAgent = process.env.VIBEROOM_FAKE_AGENT;
  if (fakeAgent) {
    const fakeTerminalLine = `${terminalLine([process.execPath, fakeAgent, "--login", "--unattended"])}${isWindows ? " & exit" : "; exit"}`;
    const fakeInstallFile = process.env.FAKE_INSTALL_FILE;
    const fakeInstalled = !fakeInstallFile || existsSync(fakeInstallFile);
    recipes.push({
      id: "fake",
      label: "Fake (test agent)",
      vendor: "Fake",
      icon: "",
      tested: false,
      note: "A scripted ACP agent for the hub's own probes; present only with VIBEROOM_FAKE_AGENT.",
      modelPresets: [],
      defaultModel: null,
      effortPresets: [],
      defaultEffort: null,
      modePresets: [],
      defaultMode: null,
      unavailableReason: fakeInstalled ? null : "Fake is not installed (its marker file is missing)",
      installedAt: fakeInstalled ? fakeAgent : null,
      installHint: "",
    install: process.env.FAKE_INSTALL_HIDDEN === "1"
      ? { kind: "command", command: process.execPath, args: [fakeAgent, "--install"], shell: isWindows ? "cmd" : "sh", line: terminalLine([process.execPath, fakeAgent, "--install"]), note: "A scripted installer: it prints a line and writes its marker." }
      : { kind: "terminal", shell: isWindows ? "cmd" : "sh", line: `${terminalLine([process.execPath, fakeAgent, "--install"])}${isWindows ? " & exit" : "; exit"}`, note: "A scripted installer: it writes its marker and closes." },
      loginCommand: "",
      loginState: "ok",
      loginStatus: { kind: "acp" },
      loginFlow: process.env.FAKE_LOGIN_TERMINAL === "1"
        ? { kind: "terminal", commandLine: fakeTerminalLine, hint: "A scripted sign-in in a terminal window: it signs in by itself and closes." }
        : process.env.FAKE_LOGIN_ACP === "1"
          ? { kind: "acp", methodId: "fake.com", hint: "Fake opens your browser: sign in there and come back; viberoom waits." }
          : { kind: "command", command: process.execPath, args: [fakeAgent, "--login"], hint: "A scripted sign-in: an address, a code, a question.", scene: "code" },
      loginTerminalLine: fakeTerminalLine,
      bypassMode: null,
      build: () => ({ command: process.execPath, args: [fakeAgent], env: {} }),
    });
  }
  return recipes;
}

let recipes = buildRecipes();

export function rescanRecipes(): void {
  recipes = buildRecipes();
}

function loginEvidence(): { env: NodeJS.ProcessEnv; platform: NodeJS.Platform; exists: (relative: string) => boolean } {
  return { env: process.env, platform: process.platform, exists: (relative) => existsSync(join(homedir(), ...relative.split("/"))) };
}

export function listRecipes(): AgentRecipe[] {
  const evidence = loginEvidence();
  for (const recipe of recipes) {
    recipe.loginState = recipe.unavailableReason ? "unknown" : loginState(recipe.login, evidence);
    const checked = loginChecks.get(recipe.id);
    recipe.loginChecked = checked;
    recipe.loginChecking = loginChecking.has(recipe.id);
    if (checked && checked.state !== "unknown" && !recipe.unavailableReason) recipe.loginState = checked.state;
  }
  return recipes;
}

const loginChecks = new Map<string, LoginCheck>();
const loginChecking = new Set<string>();
export function rememberLoginCheck(id: string, check: LoginCheck): void {
  loginChecks.set(id, check);
}
export function markLoginChecking(id: string, on: boolean): void {
  if (on) loginChecking.add(id);
  else loginChecking.delete(id);
}
export function loginCheckOf(id: string): LoginCheck | undefined {
  return loginChecks.get(id);
}

export type PublicRecipe = Omit<AgentRecipe, "build" | "loginStatus" | "loginFlow" | "loginTerminalLine" | "install"> & {
  loginHow: "card" | "terminal" | "none";
  loginHint: string;
  loginTerminalCommand?: string;
  loginScene: "browser" | "code" | "terminal";
  installHow: "command" | "terminal" | "url";
  installCommand?: string;
  installShell?: TerminalShell;
  installUrl?: string;
  installNote: string;
};
export function publicRecipes(): PublicRecipe[] {
  return listRecipes().map(({ build: _b, loginStatus: _s, loginFlow, loginTerminalLine, install, ...r }) => ({
    ...r,
    loginHow: loginFlow.kind === "command" || loginFlow.kind === "acp" ? "card" : loginFlow.kind === "terminal" ? "terminal" : "none",
    loginHint: loginFlow.hint,
    loginScene: loginFlow.kind === "terminal" ? "terminal" : loginFlow.kind === "command" ? loginFlow.scene ?? "browser" : "browser",
    loginTerminalCommand: loginFlow.kind === "terminal" ? loginFlow.commandLine : loginTerminalLine ?? undefined,
    installHow: install.kind,
    installCommand: install.kind !== "url" ? install.line : undefined,
    installShell: install.kind !== "url" ? install.shell : undefined,
    installUrl: install.kind === "url" ? install.url : undefined,
    installNote: install.note,
  }));
}

export function getRecipe(id: string): AgentRecipe | undefined {
  return listRecipes().find((r) => r.id === id);
}
