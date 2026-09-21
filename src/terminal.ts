// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { findOnPath } from "./open.js";
import { childEnvironment } from "./child-environment.js";

export interface TerminalCommand {
  command: string;
  args: string[];
  verbatim?: boolean;
  how: string;
}

export function quoteArg(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return /^[a-zA-Z0-9_./:=+@,-]+$/.test(arg) ? arg : shQuote(arg);
  if (/["\r\n%!]/.test(arg)) throw new Error("This path needs a directly launched executable, not a Windows command line.");
  return /[\s&|<>()^]/.test(arg) ? `"${arg}"` : arg;
}

export function commandLine(parts: string[], platform: NodeJS.Platform = process.platform): string {
  return parts.map(part => quoteArg(part, platform)).join(" ");
}

function shQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function appleQuote(text: string): string {
  return `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

const LINUX_TERMINALS: { bin: string; args: (title: string, script: string, sh: string) => string[] }[] = [
  { bin: "x-terminal-emulator", args: (t, s, sh) => ["-T", t, "-e", sh, "-c", s] },
  { bin: "gnome-terminal", args: (t, s, sh) => ["--title", t, "--", sh, "-c", s] },
  { bin: "konsole", args: (_t, s, sh) => ["-e", sh, "-c", s] },
  { bin: "xfce4-terminal", args: (t, s, sh) => ["-T", t, "-e", `${sh} -c ${shQuote(s)}`] },
  { bin: "kitty", args: (t, s, sh) => ["--title", t, sh, "-c", s] },
  { bin: "alacritty", args: (t, s, sh) => ["-t", t, "-e", sh, "-c", s] },
  { bin: "xterm", args: (t, s, sh) => ["-T", t, "-e", sh, "-c", s] },
];

export type TerminalShell = "cmd" | "powershell" | "sh" | "bash";

export interface TerminalOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
  keepOpen?: boolean;
  shell?: TerminalShell;
}

export function terminalCommand(line: string, title: string, opts: TerminalOptions = {}): TerminalCommand | null {
  const platform = opts.platform ?? process.platform;
  const keepOpen = opts.keepOpen !== false;
  if (platform === "win32") {
    const inner = opts.shell === "powershell"
      ? `powershell ${keepOpen ? "-NoExit " : ""}-ExecutionPolicy Bypass -Command "${line}"`
      : `cmd.exe /d /s /${keepOpen ? "k" : "c"} "${line}"`;
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `"start "${title.replace(/"/g, "'")}" ${inner}"`], verbatim: true, how: "a command window" };
  }
  const sh = opts.shell === "bash" ? "bash" : "sh";
  const afterwards = keepOpen ? `; echo; echo "viberoom: when you are done here, go back to the room and press \\"I'm done\\"."; exec "\${SHELL:-sh}"` : "";
  const script = `${line}${afterwards}`;
  if (platform === "darwin") {
    return { command: "osascript", args: ["-e", `tell application "Terminal" to do script ${appleQuote(script)}`, "-e", `tell application "Terminal" to activate`], how: "Terminal" };
  }
  const exists = opts.exists ?? existsSync;
  const env = opts.env ?? process.env;
  for (const t of LINUX_TERMINALS) {
    const found = findOnPath(t.bin, env, platform, exists);
    if (found) return { command: found, args: t.args(title, script, sh), how: t.bin };
  }
  return null;
}

export function openTerminal(line: string, title: string, cwd: string, opts: TerminalOptions = {}): Promise<{ how: string }> {
  const platform = opts.platform ?? process.platform;
  const context = platform === "win32" ? line : `cd ${shQuote(cwd)} || exit; ${Object.entries(opts.env ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0])).map(([key, value]) => `export ${key}=${shQuote(value)}; `).join("")}${line}`;
  const cmd = terminalCommand(context, title, opts);
  if (!cmd) return Promise.reject(new Error("no terminal emulator found on this machine (looked for x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, kitty, alacritty, xterm)"));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd.command, cmd.args, { cwd, env: childEnvironment(opts.env as Record<string, string> | undefined), detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: cmd.verbatim === true });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    child.once("error", (error) => reject(error));
    child.once("spawn", () => { child.unref(); resolve({ how: cmd.how }); });
  });
}
