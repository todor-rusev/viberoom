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

export function renderInstalled(o: { files: string[]; notes: string[]; platform: NodeJS.Platform; browserAdvice?: string | null }, opts: RenderOptions): string {
  const g = opts.unicode ? GLYPHS.unicode : GLYPHS.ascii;
  const dim = (t: string): string => paint(opts.color, "2", t);
  const bold = (t: string): string => paint(opts.color, "1", t);
  const green = (t: string): string => paint(opts.color, "32", t);
  const bar = paint(opts.color, "36", g.bar);
  const steps: string[] =
    o.platform === "win32"
      ? [
          `Press the ${bold("Windows key")}, type ${bold("viberoom")}, press Enter.`,
          `Or double-click ${bold("viberoom")} on the Desktop.`,
          `Pin it: once the window is open, right-click its icon in the taskbar and choose "Pin to taskbar".`,
        ]
      : o.platform === "darwin"
        ? [
            `Press ${bold("⌘ Space")}, type ${bold("viberoom")}, press Enter (Spotlight); or open it from Launchpad.`,
            `It lives in ${bold("~/Applications/viberoom.app")}; drag it to the Dock to keep it there.`,
            `If macOS asks whether to open it the first time, choose Open: the app was made on this machine.`,
          ]
        : [
            `Press the ${bold("Super key")}, type ${bold("viberoom")}, press Enter; it is in the applications menu.`,
            `On the Desktop: right-click ${bold("viberoom.desktop")} and choose "Allow launching" once if your desktop asks.`,
            `Pin it: right-click the running icon in the dock and choose "Add to favorites" (or your desktop's equivalent).`,
          ];
  const lines = [
    `${dim(g.top)}  ${bold("The desktop icon is installed")}`,
    dim(g.bar),
    `${green(g.done)}  ${bold("How to start viberoom from now on")}`,
    ...steps.map((t) => `${bar}  ${t}`),
    bar,
    `${green(g.done)}  ${bold("What happens")}`,
    `${bar}  The icon starts the hub in the background and opens the app window.`,
    `${bar}  Closing the window keeps the hub running; "viberoom stop" in a terminal ends it.`,
    `${bar}  A newer version: the app tells you with a bubble over your avatar (Settings → Updates).`,
  ];
  if (o.browserAdvice) lines.push(bar, `${paint(opts.color, "33", "!")}  ${o.browserAdvice}`);
  if (o.files.length || o.notes.length) {
    lines.push(bar, `${green(g.done)}  ${bold("Written")}`);
    for (const f of o.files) lines.push(`${bar}  ${dim(f)}`);
    for (const n of o.notes) lines.push(`${bar}  ${dim(n)}`);
  }
  lines.push(bar, `${dim(g.bottom)}  ${dim("Press Enter to open viberoom now, or q to leave it for later.")}`);
  return lines.join("\n") + "\n";
}

export function askEnter(stdin: ReadStream = process.stdin as ReadStream, stdout: WriteStream = process.stdout as WriteStream): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") return Promise.resolve(false);
  return new Promise((resolve) => {
    const onData = (data: Buffer): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      const s = data.toString();
      resolve(s === "\r" || s === "\n");
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
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
