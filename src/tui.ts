// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { ReadStream, WriteStream } from "node:tty";

export type MenuChoice = "window" | "browser" | "shortcut" | "terminal" | "quit";

export interface MenuItem {
  id: MenuChoice;
  label: string;
  hint: string;
}

export const MENU: MenuItem[] = [
  { id: "shortcut", label: "Install the desktop icon", hint: "Start Menu and Desktop entry that opens the app window" },
  { id: "window", label: "Open in the app window", hint: "the hub in the background, a Chromium window of its own" },
  { id: "browser", label: "Open in your browser", hint: "the hub in the background, a tab in your default browser" },
  { id: "terminal", label: "Run here, in this terminal", hint: "the hub in the foreground with its log; Ctrl+C stops it" },
  { id: "quit", label: "Quit", hint: "" },
];

export const QUESTION = "What would you like to do?";

export interface MenuState {
  index: number;
  done?: MenuChoice;
}

export type MenuKey = "up" | "down" | "enter" | "escape" | "digit";

export function decodeKey(data: Buffer | string): { key: MenuKey; digit?: number } | null {
  const s = data.toString();
  if (s === "\x1b[A" || s === "\x1bOA" || s === "k") return { key: "up" };
  if (s === "\x1b[B" || s === "\x1bOB" || s === "j") return { key: "down" };
  if (s === "\r" || s === "\n" || s === " ") return { key: "enter" };
  if (s === "\x1b" || s === "q" || s === "\x03" || s === "\x04") return { key: "escape" };
  if (/^[1-9]$/.test(s)) return { key: "digit", digit: Number(s) };
  return null;
}

export function reduceMenu(state: MenuState, key: MenuKey, digit?: number, items: MenuItem[] = MENU): MenuState {
  const n = items.length;
  switch (key) {
    case "up":
      return { index: (state.index - 1 + n) % n };
    case "down":
      return { index: (state.index + 1) % n };
    case "enter":
      return { index: state.index, done: items[state.index].id };
    case "escape":
      return { index: state.index, done: "quit" };
    case "digit":
      if (digit === undefined || digit < 1 || digit > n) return state;
      return { index: digit - 1, done: items[digit - 1].id };
  }
}

export function unicodeSupported(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") return env.TERM !== "linux";
  return Boolean(env.WT_SESSION || env.TERMINUS_SUBLIME || env.ConEmuTask === "{cmd::Cmder}" || env.TERM_PROGRAM === "Terminus-Sublime" || env.TERM_PROGRAM === "vscode" || env.TERM === "xterm-256color" || env.TERM === "alacritty" || env.TERMINAL_EMULATOR === "JetBrains-JediTerm");
}

export interface RenderOptions {
  color: boolean;
  unicode: boolean;
  columns?: number;
}

const GLYPHS = {
  unicode: { top: "┌", bar: "│", bottom: "└", active: "◆", done: "◇", on: "●", off: "○" },
  ascii: { top: "+", bar: "|", bottom: "+", active: "*", done: "o", on: "(*)", off: "( )" },
};

const ESC = "\x1b[";
const paint = (on: boolean, code: string, text: string): string => (on ? `${ESC}${code}m${text}${ESC}0m` : text);

export function renderMenu(state: MenuState, title: string, opts: RenderOptions, items: MenuItem[] = MENU): string {
  const g = opts.unicode ? GLYPHS.unicode : GLYPHS.ascii;
  const dim = (t: string): string => paint(opts.color, "2", t);
  const columns = Math.max(40, opts.columns ?? 80);
  const lines = [`${dim(g.top)}  ${paint(opts.color, "1", title)}`, dim(g.bar), `${paint(opts.color, "36", g.active)}  ${QUESTION}`];
  items.forEach((item, i) => {
    const current = i === state.index;
    const dot = current ? paint(opts.color, "32", g.on) : dim(g.off);
    const label = current ? paint(opts.color, "1", item.label) : item.label;
    lines.push(`${paint(opts.color, "36", g.bar)}  ${dot} ${label}`);
  });
  const hint = items[state.index].hint || "Enter to choose, 1-5 to jump, q to quit";
  lines.push(paint(opts.color, "36", g.bar), `${paint(opts.color, "36", g.bottom)}  ${dim(hint.slice(0, columns - 4))}`);
  return lines.join("\n") + "\n";
}

export function renderDone(choice: MenuChoice, title: string, opts: RenderOptions, items: MenuItem[] = MENU): string {
  const g = opts.unicode ? GLYPHS.unicode : GLYPHS.ascii;
  const dim = (t: string): string => paint(opts.color, "2", t);
  const label = items.find((i) => i.id === choice)?.label ?? choice;
  return [`${dim(g.top)}  ${paint(opts.color, "1", title)}`, dim(g.bar), `${paint(opts.color, "32", g.done)}  ${QUESTION}`, `${dim(g.bar)}  ${dim(label)}`, dim(g.bar), ""].join("\n");
}

export function menuLineCount(items: MenuItem[] = MENU): number {
  return items.length + 5;
}

export function runMenu(title: string, stdin: ReadStream = process.stdin as ReadStream, stdout: WriteStream = process.stdout as WriteStream): Promise<MenuChoice | null> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") return Promise.resolve(null);
  const opts: RenderOptions = { color: !process.env.NO_COLOR, unicode: unicodeSupported(), columns: stdout.columns };
  return new Promise((resolve) => {
    let state: MenuState = { index: 0 };
    const clear = (): void => {
      stdout.write(`${ESC}${menuLineCount()}A${ESC}0J`);
    };
    const finish = (choice: MenuChoice): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      clear();
      stdout.write(renderDone(choice, title, opts));
      resolve(choice);
    };
    const onData = (data: Buffer): void => {
      const decoded = decodeKey(data);
      if (!decoded) return;
      state = reduceMenu(state, decoded.key, decoded.digit);
      if (state.done) finish(state.done);
      else {
        clear();
        stdout.write(renderMenu(state, title, { ...opts, columns: stdout.columns }));
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    stdout.write(renderMenu(state, title, opts));
  });
}
