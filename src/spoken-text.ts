// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
const SHOWN_SPANS = /```[^]*?```|`[^`\n]*`|"[^"\n]*"|„[^“”\n]*[“”]|“[^”\n]*”|^[ \t]*>.*$/gm;

export function spokenText(text: string): string {
  return text.replace(SHOWN_SPANS, (span) => " ".repeat(span.length));
}
