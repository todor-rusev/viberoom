// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { extname, basename } from "node:path";

export type ViewerKind = "markdown" | "csv" | "text";

export const VIEWER_MAX_BYTES = 2 * 1024 * 1024;
export const WINDOW_MAX_LINES = 500;
export const STREAM_MAX_BYTES = 64 * 1024 * 1024;

const KINDS: Record<string, ViewerKind> = { ".md": "markdown", ".markdown": "markdown", ".csv": "csv", ".tsv": "csv" };

export function viewerKind(path: string): ViewerKind {
  return KINDS[extname(path).toLowerCase()] ?? "text";
}

const LANGUAGES: Record<string, string> = {
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "tsx",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "jsx",
  ".json": "json", ".jsonc": "json", ".json5": "json",
  ".py": "python", ".rb": "ruby", ".php": "php", ".pl": "perl", ".lua": "lua", ".r": "r",
  ".rs": "rust", ".go": "go", ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".swift": "swift",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp",
  ".cs": "csharp", ".fs": "fsharp", ".scala": "scala", ".dart": "dart", ".ex": "elixir", ".exs": "elixir",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash", ".ps1": "powershell", ".psm1": "powershell", ".bat": "batch", ".cmd": "batch",
  ".sql": "sql", ".graphql": "graphql", ".gql": "graphql", ".proto": "protobuf",
  ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".ini": "ini", ".cfg": "ini", ".conf": "ini", ".env": "bash",
  ".xml": "xml", ".html": "html", ".htm": "html", ".svg": "xml", ".vue": "html",
  ".css": "css", ".scss": "scss", ".sass": "scss", ".less": "less",
  ".diff": "diff", ".patch": "diff",
};
const NAMED_FILES: Record<string, string> = {
  dockerfile: "docker",
  makefile: "makefile",
  ".gitignore": "bash",
  ".npmrc": "ini",
  ".editorconfig": "ini",
};

export function languageOf(path: string): string | null {
  const name = basename(path).toLowerCase();
  if (NAMED_FILES[name]) return NAMED_FILES[name];
  return LANGUAGES[extname(path).toLowerCase()] || null;
}

const IMAGE_MEDIA: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
export const IMAGE_VIEW_MAX_BYTES = 20 * 1024 * 1024;

export function imageMediaType(path: string): string | null {
  return IMAGE_MEDIA[extname(path).toLowerCase()] ?? null;
}

export function looksBinary(head: Uint8Array): boolean {
  if (!head.length) return false;
  let control = 0;
  for (const byte of head) {
    if (byte === 0) return true;
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 12) control++;
  }
  return control / head.length > 0.1;
}

export function sliceLines(text: string, from?: number, to?: number): { text: string; from: number; to: number; lines: number } {
  const all = text.split(/\r?\n/);
  if (all.length && all[all.length - 1] === "") all.pop();
  const lines = all.length;
  const start = Math.max(1, Math.min(Math.floor(from ?? 1) || 1, Math.max(1, lines)));
  const wanted = Math.floor(to ?? start + WINDOW_MAX_LINES - 1) || start;
  const end = Math.max(start, Math.min(wanted, lines, start + WINDOW_MAX_LINES - 1));
  return { text: all.slice(start - 1, end).join("\n"), from: start, to: end, lines };
}

export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = -1;
  for (const d of [",", ";", "\t"]) {
    const n = first.split(d).length - 1;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((f) => f === "")) rows.pop();
  return rows;
}
