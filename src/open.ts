// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, posix, resolve, win32 } from "node:path";

export type OpenKind = "url" | "path";

export interface OpenTarget {
  kind: OpenKind;
  value: string;
  line?: number;
  column?: number;
}

const URL_SCHEMES = /^(https?|mailto):/i;

const EXECUTABLE_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".msp", ".scr", ".pif", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".lnk", ".jar", ".reg", ".cpl", ".app", ".sh", ".command", ".desktop", ".run",
]);

export function splitLocation(text: string): { path: string; line?: number; column?: number } {
  const m = /^(.*[\\/][^\\/:]+?):(\d{1,7})(?::(\d{1,5}))?$/.exec(text);
  if (!m) return { path: text };
  return { path: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined };
}

export function classifyOpenTarget(raw: string, home: string = homedir()): OpenTarget | null {
  const text = String(raw ?? "").trim();
  if (!text || text.length > 4000) return null;
  if (URL_SCHEMES.test(text)) return /[\s<>"]/.test(text) ? null : { kind: "url", value: text };
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) return null;
  const loc = splitLocation(text);
  let value = loc.path;
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) value = home + value.slice(1);
  if (!isAbsolute(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
  const target: OpenTarget = { kind: "path", value: resolve(value) };
  if (loc.line !== undefined) target.line = loc.line;
  if (loc.column !== undefined) target.column = loc.column;
  return target;
}

export function isExecutablePath(path: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(extname(path).toLowerCase());
}


export interface EditorSpec {
  id: string;
  label: string;
  bins: string[];
  extra?: (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => string[];
  args: (file: string, line: number, column?: number) => string[];
}

const goto = (file: string, line: number, column?: number): string[] => ["--goto", `${file}:${line}${column ? `:${column}` : ""}`];
const fileLine = (file: string, line: number, column?: number): string[] => [`${file}:${line}${column ? `:${column}` : ""}`];
const winPrograms = (env: NodeJS.ProcessEnv): string[] => [env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, "Programs") : "", env.ProgramFiles ?? "", env["ProgramFiles(x86)"] ?? ""].filter(Boolean);

export const EDITORS: EditorSpec[] = [
  { id: "code", label: "VS Code", bins: ["code"], extra: (env, p) => (p === "win32" ? winPrograms(env).map((d) => win32.join(d, "Microsoft VS Code", "bin", "code.cmd")) : p === "darwin" ? ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"] : []), args: goto },
  { id: "cursor", label: "Cursor", bins: ["cursor"], extra: (env, p) => (p === "win32" ? winPrograms(env).map((d) => win32.join(d, "cursor", "resources", "app", "bin", "cursor.cmd")) : p === "darwin" ? ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"] : []), args: goto },
  { id: "windsurf", label: "Windsurf", bins: ["windsurf"], args: goto },
  { id: "zed", label: "Zed", bins: ["zed"], extra: (_e, p) => (p === "darwin" ? ["/Applications/Zed.app/Contents/MacOS/cli"] : []), args: fileLine },
  { id: "subl", label: "Sublime Text", bins: ["subl"], extra: (env, p) => (p === "win32" ? [env.ProgramFiles ? win32.join(env.ProgramFiles, "Sublime Text", "subl.exe") : ""].filter(Boolean) : p === "darwin" ? ["/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl"] : []), args: fileLine },
  { id: "notepad++", label: "Notepad++", bins: ["notepad++"], extra: (env, p) => (p === "win32" ? [env.ProgramFiles ?? "", env["ProgramFiles(x86)"] ?? ""].filter(Boolean).map((d) => win32.join(d, "Notepad++", "notepad++.exe")) : []), args: (f, l, c) => [`-n${l}`, ...(c ? [`-c${c}`] : []), f] },
  { id: "idea", label: "IntelliJ IDEA", bins: ["idea", "idea64"], args: (f, l) => ["--line", String(l), f] },
  { id: "webstorm", label: "WebStorm", bins: ["webstorm", "webstorm64"], args: (f, l) => ["--line", String(l), f] },
];

export interface DetectedEditor {
  id: string;
  label: string;
  command: string;
}

export function findOnPath(bin: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean): string | null {
  const p = platform === "win32" ? win32 : posix;
  const dirs = (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  const exts = platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = p.join(dir, bin + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

export function detectEditor(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean): DetectedEditor | null {
  for (const spec of EDITORS) {
    for (const bin of spec.bins) {
      const found = findOnPath(bin, env, platform, exists);
      if (found) return { id: spec.id, label: spec.label, command: found };
    }
    for (const candidate of spec.extra?.(env, platform) ?? []) if (exists(candidate)) return { id: spec.id, label: spec.label, command: candidate };
  }
  return null;
}

export interface EditorSettings {
  mode: "auto" | "default-app" | "custom";
  command: string;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = { mode: "auto", command: "" };

export function splitCommandLine(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

export interface OpenCommand {
  command: string;
  args: string[];
  action: "open-url" | "open-file" | "open-line" | "reveal";
  editor?: string;
}

function spawnable(command: string, args: string[], platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(command)) return { command: "cmd.exe", args: ["/c", command, ...args] };
  return { command, args };
}

export function editorCommand(target: OpenTarget, settings: EditorSettings, detected: DetectedEditor | null, platform: NodeJS.Platform = process.platform): OpenCommand | null {
  if (target.kind !== "path" || target.line === undefined) return null;
  if (settings.mode === "default-app") return null;
  if (settings.mode === "custom") {
    const parts = splitCommandLine(settings.command).map((p) => p.replace(/\{file\}/g, target.value).replace(/\{line\}/g, String(target.line)).replace(/\{column\}/g, String(target.column ?? 1)));
    if (!parts.length) return null;
    const [command, ...args] = parts;
    return { ...spawnable(command, args, platform), action: "open-line", editor: basename(command) };
  }
  if (!detected) return null;
  const spec = EDITORS.find((e) => e.id === detected.id);
  if (!spec) return null;
  return { ...spawnable(detected.command, spec.args(target.value, target.line, target.column), platform), action: "open-line", editor: detected.label };
}

export function openCommand(target: OpenTarget, platform: NodeJS.Platform = process.platform, reveal = false): OpenCommand {
  if (target.kind === "url") {
    if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", target.value], action: "open-url" };
    if (platform === "darwin") return { command: "open", args: [target.value], action: "open-url" };
    return { command: "xdg-open", args: [target.value], action: "open-url" };
  }
  if (reveal) {
    if (platform === "win32") return { command: "explorer.exe", args: [`/select,${target.value}`], action: "reveal" };
    if (platform === "darwin") return { command: "open", args: ["-R", target.value], action: "reveal" };
    return { command: "xdg-open", args: [dirname(target.value)], action: "reveal" };
  }
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", target.value], action: "open-file" };
  if (platform === "darwin") return { command: "open", args: [target.value], action: "open-file" };
  return { command: "xdg-open", args: [target.value], action: "open-file" };
}

export function describeOpen(target: OpenTarget, action: OpenCommand["action"], editor?: string): string {
  if (action === "open-url") return `Opened ${target.value} in your browser.`;
  if (action === "reveal") return `${basename(target.value)} could be run, not opened, so its folder is shown instead.`;
  if (action === "open-line") return `Opened ${basename(target.value)} at line ${target.line}${target.column ? `, column ${target.column}` : ""} in ${editor ?? "your editor"}.`;
  if (target.line !== undefined) return `Opened ${basename(target.value)} with its default app (it cannot jump to line ${target.line}; pick an editor in Settings).`;
  return `Opened ${basename(target.value)} with its default app.`;
}
