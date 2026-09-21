// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { existsSync, readFileSync, realpathSync, readdirSync, statSync, lstatSync, openSync, readSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { createHash } from "node:crypto";
import { processCommand, runManaged, type AgentCommand } from "./managed-process.js";
import { withRunAsNode, RUN_AS_NODE } from "./own-runtime.js";
import { findOnPath } from "./open.js";

export const AGENT_PACKAGES = {
  claude: ["@anthropic-ai/claude-code"], codex: ["@openai/codex"], gemini: ["@google/gemini-cli"],
  cursor: [], opencode: ["opencode-ai", "@opencode/cli"], copilot: ["@github/copilot"], grok: ["@xai-official/grok"], hermes: [],
} as const;
export type VendorId = keyof typeof AGENT_PACKAGES;
export type InstallMethod = "npm" | "pnpm" | "yarn" | "bun" | "brew" | "winget" | "scoop" | "native" | "git" | "external";
export interface AgentInstallation {
  id: string; vendor: VendorId; executable: string; realPath: string; cli: AgentCommand;
  method: InstallMethod; packageName?: string; packageRoot?: string; prefix?: string;
  manager?: string; version: string | null; channel: string; source: string;
  scope?: "user" | "machine";
  root: string;
}
export interface DiscoveryHost {
  platform: NodeJS.Platform; env: NodeJS.ProcessEnv; home: string; runtime: string;
  exists(path: string): boolean; read(path: string): string; real(path: string): string;
  head(path: string): string;
  dirs(path: string): string[]; mtime(path: string): number;
  query(command: AgentCommand): string;
}
const defaults: DiscoveryHost = {
  platform: process.platform, env: process.env, home: homedir(), runtime: process.execPath,
  exists: path => {
    if (existsSync(path)) return true;
    if (process.platform === "win32" && /[\\/]Microsoft[\\/]WindowsApps[\\/][^\\/]+\.exe$/i.test(path)) {
      try { return lstatSync(path).isSymbolicLink(); } catch { }
    }
    return false;
  }, read: p => readFileSync(p, "utf8"), real: realpathSync,
  head: p => { const fd = openSync(p, "r"); try { const b = Buffer.alloc(256); return b.subarray(0, readSync(fd, b, 0, b.length, 0)).toString(); } finally { closeSync(fd); } },
  dirs: p => readdirSync(p, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name),
  mtime: p => statSync(p).mtimeMs,
  query: spec => {
    const cmd = processCommand(spec);
    const result = spawnSync(cmd.command, cmd.args, { cwd: homedir(), env: withRunAsNode(cmd.env), timeout: 6000, maxBuffer: 256 * 1024,
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, windowsVerbatimArguments: cmd.verbatim });
    if (result.error || result.status !== 0) throw result.error ?? new Error("Discovery command failed");
    return result.stdout.trim();
  },
};

export class AgentDiscovery {
  readonly host: DiscoveryHost;
  private selected = new Map<VendorId, AgentInstallation>();
  private initialized = false;
  private npmRoot: string | null = null;
  private npmPath: string | null = null;
  constructor(host: Partial<DiscoveryHost> = {}) {
    this.host = { ...defaults, ...host };
    if (host.read && !host.head) this.host.head = p => host.read!(p).slice(0, 256);
  }
  private get p() { return this.host.platform === "win32" ? win32 : posix; }
  private real(path: string): string { try { return this.host.real(path); } catch { return path; } }
  private json(path: string): any { try { return JSON.parse(this.host.read(path)); } catch { return null; } }
  private dirs(path: string): string[] { try { return this.host.dirs(path); } catch { return []; } }
  private query(command: AgentCommand): string | null { try { return this.host.query(command) || null; } catch { return null; } }
  onPath(name: string): string | null {
    const env = { ...this.host.env };
    env.PATH = (env.PATH ?? env.Path ?? "").split(this.host.platform === "win32" ? ";" : ":")
      .filter(dir => !/[\\/]node_modules[\\/]\.bin[\\/]?$/i.test(dir)).join(this.host.platform === "win32" ? ";" : ":");
    if (this.host.platform === "win32" && this.p.extname(name)) return env.PATH.split(";").map(dir => this.p.join(dir, name)).find(file => this.host.exists(file)) ?? null;
    return findOnPath(name, env, this.host.platform, this.host.exists);
  }
  npm(): string | null {
    const p = this.p, dir = p.dirname(this.host.runtime);
    return [p.join(dir, "node_modules/npm/bin/npm-cli.js"), p.join(dir, "../lib/node_modules/npm/bin/npm-cli.js")]
      .find(x => this.host.exists(x)) ?? this.onPath("npm");
  }
  get(id: VendorId): AgentInstallation | null { if (!this.initialized) this.refresh(); return this.selected.get(id) ?? null; }
  list(): AgentInstallation[] { if (!this.initialized) this.refresh(); return [...this.selected.values()]; }
  refresh(): void {
    this.npmPath = this.npm();
    this.rebuild(this.npmPath ? this.query({ command: this.npmPath, args: ["root", "--global"] }) : null);
  }
  async refreshAsync(signal?: AbortSignal): Promise<void> {
    this.npmPath = this.npm();
    const result = this.npmPath ? await runManaged({ command: this.npmPath, args: ["root", "--global"] }, this.host.home, { signal, timeoutMs: 6000, maxBytes: 256 * 1024 }) : null;
    if (signal?.aborted) return;
    this.rebuild(result?.code === 0 ? result.output.trim() : null);
  }
  private rebuild(root: string | null): void {
    this.initialized = true;
    this.selected.clear();
    this.npmRoot = root;
    if (!this.npmRoot && this.host.platform === "win32" && this.host.env.APPDATA) this.npmRoot = this.p.join(this.host.env.APPDATA, "npm/node_modules");
    for (const id of Object.keys(AGENT_PACKAGES) as VendorId[]) {
      const found = this.discover(id);
      if (found) this.selected.set(id, found);
    }
  }
  private packageBin(root: string, name: string): string | null {
    const pkg = this.json(this.p.join(root, "package.json"));
    const bin = typeof pkg?.bin === "string" ? pkg.bin : pkg?.bin?.[name];
    if (typeof bin !== "string") return null;
    const file = this.p.resolve(root, bin);
    return this.host.exists(file) ? file : null;
  }
  private packageAt(file: string, id: VendorId): { root: string; pkg: any } | null {
    let dir = this.p.dirname(file);
    for (let i = 0; i < 12; i++) {
      const pkg = this.json(this.p.join(dir, "package.json"));
      if (pkg && (AGENT_PACKAGES[id] as readonly string[]).includes(pkg.name)) return { root: dir, pkg };
      const parent = this.p.dirname(dir); if (parent === dir) break; dir = parent;
    }
    return null;
  }
  private unpackShim(file: string, id: VendorId): string | null {
    if (/\.exe$/i.test(file) && this.host.exists(file.replace(/\.exe$/i, ".shim"))) {
      try {
        const target = /^path\s*=\s*"([^"]+)"/m.exec(this.host.read(file.replace(/\.exe$/i, ".shim")))?.[1];
        if (target && this.host.exists(target)) return target;
      } catch { }
    }
    if (!/\.(?:cmd|bat|ps1)$/i.test(file)) return file;
    const p = this.p, bin = p.dirname(file);
    for (const name of AGENT_PACKAGES[id]) {
      for (const root of [p.join(bin, "node_modules", name), p.join(bin, "../lib/node_modules", name)]) {
        const entry = this.packageBin(root, id); if (entry) return entry;
      }
    }
    try {
      const text = this.host.read(file);
      const prefix = /\.(?:cmd|bat)$/i.test(file) ? /(?:%~dp0|%dp0%)([^"\r\n]+)/g : /\$basedir[\\/]([^"\r\n]+)/g;
      for (const match of text.matchAll(prefix)) {
        const target = p.resolve(bin, match[1]);
        if (this.host.exists(target) && this.packageAt(this.real(target), id)) return this.real(target);
      }
    } catch { }
    return null;
  }
  private launch(file: string): AgentCommand {
    let node = /\.(?:js|mjs|cjs)$/i.test(file);
    if (!node && !/\.(?:exe|cmd|bat|ps1)$/i.test(file)) {
      try { node = /^#![^\r\n]*\bnode\b/.test(this.host.head(file)); } catch { }
    }
    return node ? { command: this.host.runtime, args: [file], env: { ...RUN_AS_NODE } } : { command: file, args: [] };
  }
  private describe(id: VendorId, executable: string, file: string, known: Partial<AgentInstallation> = {}): AgentInstallation {
    const p = this.p, real = this.real(file), pkg = this.packageAt(real, id);
    const normalized = real.replace(/\\/g, "/"), display = executable.replace(/\\/g, "/");
    let method: InstallMethod = "external", root = p.dirname(real), prefix: string | undefined, manager: string | undefined;
    let packageName = pkg?.pkg.name as string | undefined;
    const brew = /^(.*)\/(?:Cellar|Caskroom)\/([^/]+)\//.exec(normalized);
    const winget = /\/(?:Microsoft\/)?WinGet\/(?:Packages|Links)\//i.test(normalized + " " + display);
    const scoop = /^(.*)\/apps\/([^/]+)\//i.exec(normalized) ?? /^(.*)\/apps\/([^/]+)\/current\//i.exec(display);
    if (brew) { method = "brew"; root = p.join(brew[1], "opt", brew[2]); packageName = brew[2]; const own = p.join(brew[1], "bin/brew"); manager = this.host.exists(own) ? own : undefined; }
    else if (winget) {
      method = "winget"; root = executable; manager = this.onPath("winget") ?? undefined;
      packageName = /\/(?:Microsoft\/)?WinGet\/Packages\/([^/]+)_Microsoft\.Winget\.Source_/i.exec(normalized)?.[1];
      if (!packageName && /\/(?:Microsoft\/)?WinGet\/Links\//i.test(display)) {
        const known = id === "copilot" ? "GitHub.Copilot" : id === "claude" ? "Anthropic.ClaudeCode" : null;
        const packages = p.join(p.dirname(executable), "../Packages");
        if (known && this.dirs(packages).includes(`${known}_Microsoft.Winget.Source_8wekyb3d8bbwe`)) packageName = known;
      }
    }
    else if (scoop && this.host.exists(p.join(scoop[1], "apps", scoop[2], "current/manifest.json"))) {
      method = "scoop"; root = p.join(scoop[1], "apps", scoop[2]); packageName = scoop[2]; prefix = scoop[1];
      const own = p.join(scoop[1], "apps/scoop/current/bin/scoop.ps1");
      manager = this.host.exists(own) ? own : this.onPath("scoop.ps1") ?? this.onPath("scoop") ?? undefined;
    } else if (pkg) {
      root = pkg.root;
      const raw = pkg.root.replace(/\\/g, "/");
      const nodeModules = raw.lastIndexOf("/node_modules/");
      const globalDir = nodeModules < 0 ? undefined : raw.slice(0, nodeModules);
      if (/\/(?:pnpm|\.pnpm)\//.test(raw) && /\/global\//.test(raw)) { method = "pnpm"; manager = this.onPath("pnpm") ?? undefined; prefix = raw.split("/node_modules/")[0]; root = p.join(prefix, pkg.pkg.name); }
      else if (/\/yarn\/global\//.test(raw) || (globalDir && this.host.exists(p.join(globalDir, "yarn.lock")))) { method = "yarn"; manager = this.onPath("yarn") ?? undefined; prefix = globalDir; }
      else if (/\/.bun\/install\/global\//.test(raw) || (globalDir && (this.host.exists(p.join(globalDir, "bun.lockb")) || this.host.exists(p.join(globalDir, "bun.lock"))))) { method = "bun"; manager = this.onPath("bun") ?? undefined; prefix = globalDir; }
      else if (this.npmRoot && this.real(p.join(this.npmRoot, pkg.pkg.name)) === pkg.root) {
        method = "npm"; manager = this.npmPath ?? undefined;
        prefix = this.host.platform === "win32" ? p.dirname(this.npmRoot) : p.dirname(p.dirname(this.npmRoot));
      } else if (globalDir && (p.basename(globalDir) === "lib" || this.host.platform === "win32" && /(?:[\\/]npm|[\\/]nodejs|[\\/]node[\\/])/i.test(globalDir))) {
        method = "npm"; manager = this.npmPath ?? undefined; prefix = p.basename(globalDir) === "lib" ? p.dirname(globalDir) : globalDir;
      }
    }
    const result: AgentInstallation = {
      vendor: id, executable, realPath: real, cli: this.launch(pkg ? real : file), method, packageName, packageRoot: pkg?.root, prefix, manager,
      version: typeof pkg?.pkg.version === "string" ? pkg.pkg.version : null,
      channel: "latest", source: method, root, ...known, id: "",
    };
    result.source = known.source ?? result.method;
    if (method === "scoop") result.scope = prefix?.replace(/\\/g, "/").toLowerCase() === (this.host.env.SCOOP_GLOBAL || p.join(this.host.env.ProgramData || this.host.env.PROGRAMDATA || "C:\\ProgramData", "scoop")).replace(/\\/g, "/").toLowerCase() ? "machine" : "user";
    if (result.version?.includes("-")) result.channel = result.version.split("-")[1].split(".")[0];
    result.id = createHash("sha256").update([id, result.method, result.root, result.packageName ?? ""].join("\n")).digest("hex").slice(0, 24);
    return result;
  }
  private discover(id: VendorId): AgentInstallation | null {
    const p = this.p, h = this.host, win = h.platform === "win32", suffix = win ? ".exe" : "";
    if (id === "cursor") {
      let launcher = this.onPath("cursor-agent");
      if (!launcher) {
        const alias = this.onPath("agent");
        if (alias) {
          let cursor = /[\\/]cursor-agent[\\/]/i.test(this.real(alias));
          try { cursor ||= /cursor-agent|cursor\.com/.test(this.host.head(this.real(alias))); } catch { }
          if (cursor) launcher = alias;
        }
      }
      const base = win ? h.env.LOCALAPPDATA && p.join(h.env.LOCALAPPDATA, "cursor-agent") : p.join(h.home, ".local/share/cursor-agent");
      const describeCursor = (launcher: string, cli?: AgentCommand) => {
        const found = this.describe(id, launcher, this.unpackShim(launcher, id) ?? launcher, cli ? { cli } : {});
        return found.method !== "external" ? found : this.describe(id, launcher, launcher, { method: "native", root: base || p.dirname(launcher), ...(cli ? { cli } : {}) });
      };
      if (launcher) {
        if (/\.cmd$/i.test(launcher) && h.exists(launcher.replace(/\.cmd$/i, ".ps1"))) {
          return describeCursor(launcher, { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcher.replace(/\.cmd$/i, ".ps1")], env: { CURSOR_INVOKED_AS: "cursor-agent" } });
        }
        if (!/\.(?:cmd|bat)$/i.test(launcher)) return describeCursor(launcher);
      }
      if (base && win && h.exists(p.join(base, "cursor-agent.ps1"))) return this.describe(id, p.join(base, "cursor-agent.ps1"), p.join(base, "cursor-agent.ps1"), {
        method: "native", root: base, cli: { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", p.join(base, "cursor-agent.ps1")], env: { CURSOR_INVOKED_AS: "cursor-agent" } },
      });
      return null;
    }
    if (id === "hermes") {
      const home = h.env.HERMES_HOME || (win && h.env.LOCALAPPDATA ? p.join(h.env.LOCALAPPDATA, "hermes") : p.join(h.home, ".hermes"));
      const candidates = [this.onPath("hermes"), p.join(home, `hermes-agent/venv/${win ? "Scripts" : "bin"}/hermes${suffix}`), p.join(h.home, ".local/bin/hermes"), "/usr/local/bin/hermes"].filter((x): x is string => !!x);
      for (const candidate of candidates) if (h.exists(candidate)) {
        const managed = this.describe(id, candidate, this.unpackShim(candidate, id) ?? candidate);
        if (managed.method !== "external") return managed;
        const real = this.real(candidate), normalized = real.replace(/\\/g, "/");
        const at = normalized.search(/\/\.?venv\//);
        const root = at >= 0 ? normalized.slice(0, at) : p.join(home, "hermes-agent");
        const git = h.exists(p.join(root, ".git"));
        return this.describe(id, candidate, candidate, { method: git ? "git" : "external", root, source: git ? "Hermes managed checkout" : "External Python installation" });
      }
      return null;
    }
    const onPath = this.onPath(id);
    if (onPath) {
      const file = this.unpackShim(onPath, id);
      if (file) {
        const described = this.describe(id, onPath, file);
        if (described.method !== "external") return described;
        const n = this.real(file).replace(/\\/g, "/");
        if (id === "grok" && /\/\.grok\/bin\//.test(n) || id === "claude" && /\/\.local\/(?:bin\/claude|share\/claude\/)/.test(n) || id === "codex" && /\/\.local\/bin\/codex/.test(n) || id === "opencode" && /\/\.opencode\/bin\//.test(n)) {
          described.method = "native"; described.source = "native"; described.root = p.dirname(onPath);
          described.id = createHash("sha256").update([id, "native", described.root].join("\n")).digest("hex").slice(0, 24);
        }
        return described;
      }
    }
    if (this.npmRoot) for (const name of AGENT_PACKAGES[id]) {
      const file = this.packageBin(p.join(this.npmRoot, name), id);
      if (file) {
        const shim = win ? p.join(p.dirname(this.npmRoot), `${id}.cmd`) : p.join(p.dirname(p.dirname(this.npmRoot)), "bin", id);
        return this.describe(id, h.exists(shim) ? shim : file, file);
      }
    }
    const native = id === "grok" ? [h.env.GROK_BIN_DIR, h.env.GROK_HOME && p.join(h.env.GROK_HOME, "bin"), p.join(h.home, ".grok/bin")]
      : id === "opencode" ? [p.join(h.home, ".opencode/bin")] : [p.join(h.home, ".local/bin")];
    for (const dir of native) if (dir && h.exists(p.join(dir, id + suffix))) return this.describe(id, p.join(dir, id + suffix), p.join(dir, id + suffix), { method: "native", source: "native", root: dir });
    if (win && h.env.LOCALAPPDATA) {
      const link = p.join(h.env.LOCALAPPDATA, "Microsoft/WinGet/Links", id + suffix);
      if (h.exists(link)) return this.describe(id, link, link);
    }
    return null;
  }
}

export const agentDiscovery = new AgentDiscovery();
