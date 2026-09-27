// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { ConnectionError } from "./errors.js";

export interface LocalLaunch { command: string; args: string[] }

const ARGS_MAX = 64;
const ARG_CHARS = 2_000;
const COMMAND_CHARS = 400;
const ENV_MAX = 16;
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ENV_RESERVED = /^(PATH|PATHEXT|COMSPEC|SHELL|HOME|USERPROFILE|NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONSTARTUP|PYTHONHOME|PERL5LIB|PERL5OPT|RUBYOPT|RUBYLIB|BASH_ENV|ENV|ZDOTDIR|JAVA_TOOL_OPTIONS|LD_.*|DYLD_.*)$/i;

const CONTROL = /[\u0000-\u001f\u007f]/;

export function checkLaunch(launch: { command?: unknown; args?: unknown }): LocalLaunch {
  const command = typeof launch.command === "string" ? launch.command.trim() : "";
  if (!command || command.length > COMMAND_CHARS || CONTROL.test(command)) throw new ConnectionError("a local server needs the program that starts it, such as npx, uvx or a full path", "failed");
  const args = launch.args === undefined ? [] : launch.args;
  if (!Array.isArray(args) || args.length > ARGS_MAX || !args.every((a) => typeof a === "string" && a.length <= ARG_CHARS && !CONTROL.test(a))) {
    throw new ConnectionError(`its arguments are a list of up to ${ARGS_MAX} strings, each on one line`, "failed");
  }
  return { command, args: [...args] as string[] };
}

export function checkEnvNames(names: unknown): string[] {
  const list = names === undefined ? [] : names;
  if (!Array.isArray(list) || list.length > ENV_MAX) throw new ConnectionError(`a local server takes up to ${ENV_MAX} keys`, "failed");
  const out: string[] = [];
  for (const name of list) {
    if (typeof name !== "string" || !ENV_NAME.test(name)) throw new ConnectionError(`"${String(name)}" is not a variable name (letters, digits and _)`, "failed");
    if (ENV_RESERVED.test(name)) throw new ConnectionError(`${name} decides what runs, so it cannot carry a key`, "failed");
    if (!out.some((n) => n.toUpperCase() === name.toUpperCase())) out.push(name);
  }
  return out;
}

export function splitCommandLine(line: string): LocalLaunch {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote && quote === '"' && line[i + 1] === '"') { current += '"'; i++; continue; }
      if (ch === quote) { quote = null; continue; }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) {
      if (started) parts.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (quote) throw new ConnectionError(`a quote (${quote}) is not closed`, "failed");
  if (started) parts.push(current);
  const [command, ...args] = parts;
  return checkLaunch({ command, args });
}

export function commandLine(launch: LocalLaunch): string {
  const word = (part: string) => part && !/[\s"']/.test(part) ? part : `"${part.replace(/"/g, '""')}"`;
  return [launch.command, ...launch.args].map(word).join(" ");
}

export function sameLaunch(a: LocalLaunch, b: LocalLaunch): boolean {
  return a.command === b.command && a.args.length === b.args.length && a.args.every((arg, i) => arg === b.args[i]);
}
