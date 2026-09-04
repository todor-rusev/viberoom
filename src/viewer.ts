// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { extname } from "node:path";

export type ViewerKind = "markdown" | "csv";

export const VIEWER_MAX_BYTES = 2 * 1024 * 1024;

const KINDS: Record<string, ViewerKind> = { ".md": "markdown", ".markdown": "markdown", ".csv": "csv", ".tsv": "csv" };

export function viewerKind(path: string): ViewerKind | null {
  return KINDS[extname(path).toLowerCase()] ?? null;
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
