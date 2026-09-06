// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type AgentTypeId = "claude" | "codex" | "gemini" | "cursor" | "opencode" | "copilot" | "hermes" | "grok" | "grok-full-access" | "antigravity";

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
  modelAtLaunch?: boolean;
  bypassMode: string | null;
  bypassConfig?: Record<string, string>;
  build(options: { model: string | null }): LaunchSpec;
}

const isWindows = process.platform === "win32";

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
    const out = execSync("npm root -g", { encoding: "utf8", shell: isWindows ? "cmd.exe" : "/bin/sh", stdio: ["ignore", "pipe", "ignore"] }).trim();
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

function resolveClaudeCode(): string | null {
  const onPath = resolveOnPath(["claude"]);
  if (onPath && !/\.(cmd|bat)$/i.test(onPath)) return onPath;
  const native = join(homedir(), ".local", "bin", isWindows ? "claude.exe" : "claude");
  if (existsSync(native)) return native;
  return resolveGlobalPackageEntry("@anthropic-ai/claude-code", "cli.js");
}

function resolveCodex(): string | null {
  return resolveGlobalNpmBin("codex") ?? resolveOnPath(["codex"]);
}

function resolveHermes(): string | null {
  const onPath = resolveOnPath(["hermes"]);
  if (onPath && !/\.(cmd|bat)$/i.test(onPath)) return onPath;
  const native = join(homedir(), ".local", "bin", isWindows ? "hermes.exe" : "hermes");
  return existsSync(native) ? native : null;
}

function resolveGrok(): string | null {
  const onPath = resolveOnPath(["grok"]);
  if (onPath && !/\.(cmd|bat)$/i.test(onPath)) return onPath;
  const native = join(homedir(), ".grok", "bin", isWindows ? "grok.exe" : "grok");
  return existsSync(native) ? native : null;
}

function resolveAgyAcp(): string | null {
  return (
    resolveGlobalPackageEntry("agy-acp", join("dist", "main.js")) ??
    resolvePackageEntry("agy-acp", join("dist", "main.js"))
  );
}

const vendorDir = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "acp");
const claudeAdapter = join(vendorDir, "claude-agent-acp", "dist", "index.js");
const codexAdapter = join(vendorDir, "codex-acp", "dist", "index.js");
const claudeExe = resolveClaudeCode();
const codexExe = resolveCodex();
const geminiEntry =
  resolvePackageEntry("@google/gemini-cli", join("bundle", "gemini.js")) ??
  resolveGlobalPackageEntry("@google/gemini-cli", join("bundle", "gemini.js"));
const cursorAgent = resolveCursorAgent();
const openCodeExe = resolveOpenCode();
const copilotExe = resolveCopilot();
const hermesExe = resolveHermes();
const grokExe = resolveGrok();
const agyAcpEntry = resolveAgyAcp();

const recipes: AgentRecipe[] = [
  {
    id: "claude",
    label: "Claude (claude-agent-acp)",
    vendor: "Claude",
    icon: "/vendor-icons/claude.svg",
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
    icon: "/vendor-icons/codex.svg",
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
    icon: "/vendor-icons/gemini.svg",
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
    icon: "/vendor-icons/cursor.svg",
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
    icon: "/vendor-icons/opencode.svg",
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
    build: () => ({
      command: openCodeExe ?? "",
      args: ["acp"],
    }),
  },
  {
    id: "copilot",
    label: "GitHub Copilot (copilot --acp)",
    vendor: "Copilot",
    icon: "/vendor-icons/copilot.svg",
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
    modelAtLaunch: true,
    build: ({ model }) => ({
      command: copilotExe ?? "",
      args: ["--acp", ...(model ? ["--model", model] : [])],
    }),
  },
  {
    id: "hermes",
    label: "Hermes (hermes acp)",
    vendor: "Hermes",
    icon: "/vendor-icons/hermes.svg",
    tested: true,
    note: "Hermes' own native ACP mode; uses this machine's configured Hermes provider/model (see `hermes setup`). Mode 'dont_ask' edits files and runs commands without asking; 'accept_edits' auto-allows workspace/tmp edits but still asks for sensitive paths.",
    modelPresets: [],
    defaultModel: null,
    effortPresets: [],
    defaultEffort: null,
    modePresets: ["default", "accept_edits", "dont_ask"],
    defaultMode: "default",
    bypassMode: "dont_ask",
    unavailableReason: hermesExe ? null : "Hermes not found",
    installedAt: hermesExe,
    installHint: "install Hermes (see hermes.bot) and run `hermes setup` to configure a provider",
    build: () => ({
      command: hermesExe ?? "",
      args: ["acp", "--accept-hooks"],
    }),
  },
  {
    id: "grok",
    label: "Grok (grok agent stdio)",
    vendor: "Grok",
    icon: "/vendor-icons/grok.svg",
    tested: true,
    note: "xAI's Grok Build CLI in native ACP mode; uses this machine's SuperGrok/X Premium+ login (grok login) or XAI_API_KEY. Grok reports no session-mode list over ACP, so tool permission is decided by --always-approve at launch: the 'ask first' recipe always prompts, the '-full-access' recipe below never does, with no in-session switch between the two.",
    modelPresets: [],
    defaultModel: null,
    effortPresets: [],
    defaultEffort: null,
    modePresets: ["default"],
    defaultMode: "default",
    bypassMode: null,
    unavailableReason: grokExe ? null : "Grok CLI not found",
    installedAt: grokExe,
    installHint: "npm install -g @xai-official/grok, then `grok login` (SuperGrok/X Premium+)",
    build: () => ({
      command: grokExe ?? "",
      args: ["agent", "stdio"],
    }),
  },
  {
    id: "grok-full-access",
    label: "Grok, full access (grok agent stdio --always-approve)",
    vendor: "Grok",
    icon: "/vendor-icons/grok.svg",
    tested: true,
    note: "Same as Grok, but launched with --always-approve: every tool call is auto-approved from the first turn, no exceptions, no way to ask first with this recipe. Use the plain Grok recipe if you want to be asked.",
    modelPresets: [],
    defaultModel: null,
    effortPresets: [],
    defaultEffort: null,
    modePresets: ["default"],
    defaultMode: "default",
    bypassMode: "default",
    unavailableReason: grokExe ? null : "Grok CLI not found",
    installedAt: grokExe,
    installHint: "npm install -g @xai-official/grok, then `grok login` (SuperGrok/X Premium+)",
    build: () => ({
      command: grokExe ?? "",
      args: ["agent", "stdio", "--always-approve"],
    }),
  },
  {
    id: "antigravity",
    label: "Antigravity (agy-acp)",
    vendor: "Antigravity",
    icon: "/vendor-icons/antigravity.svg",
    tested: false,
    note: "Third-party ACP adapter (agy-acp, not published or endorsed by Google) wrapping the Google Antigravity CLI (agy). Google's own FAQ states third-party tools accessing Antigravity violate its Terms of Service and may lead to account suspension - use only on a secondary/test account. Mode 'accept-edits' applies file edits without interactive review; 'plan' is read-only.",
    modelPresets: [],
    defaultModel: null,
    effortPresets: ["low", "medium", "high"],
    defaultEffort: null,
    modePresets: ["default", "accept-edits", "plan"],
    defaultMode: "default",
    bypassMode: "accept-edits",
    unavailableReason: agyAcpEntry ? null : "agy-acp not found",
    installedAt: agyAcpEntry,
    installHint: "npm install -g agy-acp (installs the Antigravity CLI itself on first run if missing)",
    build: () => ({
      command: process.execPath,
      args: [agyAcpEntry ?? ""],
    }),
  },
];

export function listRecipes(): AgentRecipe[] {
  return recipes;
}

export function getRecipe(id: string): AgentRecipe | undefined {
  return recipes.find((r) => r.id === id);
}
