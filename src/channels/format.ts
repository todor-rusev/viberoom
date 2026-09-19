// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function authorPrefix(name: string, part = 1, parts = 1): string {
  return `<b>${escapeHtml(parts > 1 ? `${name} (${part}/${parts})` : name)}:</b> `;
}
export function authorOfPrefix(bold: string): string | undefined {
  const m = /^(.+?)(?: \(\d+\/\d+\))?:$/.exec(bold);
  return m ? m[1] : undefined;
}

const JOINER = String.fromCharCode(0x2060);

export const ZERO_WIDTH = new RegExp(`[${String.fromCharCode(0x200b)}${String.fromCharCode(0x2060)}]`, "g");

export function defuseMentions(text: string, options: { commands?: boolean } = {}): string {
  let out = text.replace(/(^|[^\w/&])([@#])(?=[\p{L}\p{N}_])/gu, `$1$2${JOINER}`);
  out = out.replace(/(^|[^\w/&])(\$)(?=[A-Z]{1,8}(?![\w]))/g, `$1$2${JOINER}`);
  if (options.commands !== false) out = out.replace(/(^|[\s(\[{"'«„])(\/)(?=(?:rooms|open|close|who|stop|restart|help)(?![\w/]))/gi, `$1$2${JOINER}`);
  return out;
}

const HOLD = String.fromCharCode(0xe000);
const HOLD_BACK = new RegExp(`${HOLD}(\\d+)${HOLD}`, "g");
const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|[\s:|-]+\|\s*$/;

export function markdownToTelegramHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      const lang = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre>${lang ? `<code class="language-${escapeHtml(lang)}">` : ""}${escapeHtml(body.join("\n"))}${lang ? "</code>" : ""}</pre>`);
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        if (!TABLE_RULE.test(lines[i])) rows.push(tableCells(lines[i]));
        i++;
      }
      out.push(tableBlocks(rows));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${quoted.map(inline).join("\n")}</blockquote>`);
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      out.push(`<b>${inline(heading[1])}</b>`);
      i++;
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push(`${bullet[1]}• ${inline(bullet[2])}`);
      i++;
      continue;
    }
    out.push(inline(line));
    i++;
  }
  return out.join("\n").trim();
}

function tableCells(row: string): string[] {
  return row.trim().slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function tableBlocks(rows: string[][]): string {
  const heading = (cell: string): string => `<b>${inline(cell).replace(/<\/?b>/g, "")}</b>`;
  const [labels = [], ...body] = rows;
  if (body.length === 0) return heading(labels.join(" · "));
  const blocks = body.map(([title, ...cells]) => {
    const facts = cells.map((cell, n) => (cell ? [labels[n + 1], cell].filter(Boolean).map(inline).join(": ") : "")).filter(Boolean);
    return [title ? heading(title) : "", facts.join(" · ")].filter(Boolean).join("\n");
  });
  return blocks.join("\n\n");
}

function inline(text: string): string {
  const held: string[] = [];
  const hold = (html: string): string => {
    held.push(html);
    return `${HOLD}${held.length - 1}${HOLD}`;
  };
  let t = text.replace(/`([^`\n]+)`/g, (_, code: string) => hold(`<code>${escapeHtml(code)}</code>`));
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) => hold(`<a href="${escapeHtml(url).replace(/"/g, "&quot;")}">${defuseMentions(escapeHtml(label))}</a>`));
  t = t.replace(/https?:\/\/[^\s<>"'`]+/g, (url) => hold(escapeHtml(url)));
  t = defuseMentions(escapeHtml(t));
  t = t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/__(.+?)__/g, "<b>$1</b>");
  t = t.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1<i>$2</i>").replace(/(^|[^_\w])_(?!\s)([^_\n]+?)_(?!\w)/g, "$1<i>$2</i>");
  t = t.replace(/~~(.+?)~~/g, "<s>$1</s>");
  return t.replace(HOLD_BACK, (_, n: string) => held[Number(n)]);
}

export function htmlToDiscord(html: string): string {
  const decode = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  let out = html.replace(/<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g, (_m, lang: string | undefined, code: string) => "\n```" + (lang ?? "") + "\n" + decode(code).replace(/\n$/, "") + "\n```\n");
  out = out.replace(/<pre>([\s\S]*?)<\/pre>/g, (_m, code: string) => "\n```\n" + decode(code).replace(/\n$/, "") + "\n```\n");
  out = out.replace(/<code>([\s\S]*?)<\/code>/g, (_m, code: string) => {
    const plain = decode(code);
    return plain.includes("`") ? plain : "`" + plain + "`";
  });
  out = out.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_m, quote: string) => quote.split("\n").map((line) => "> " + line).join("\n"));
  out = out.replace(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_m, href: string, text: string) => (decode(text) === decode(href) ? decode(href) : "[" + decode(text) + "](" + decode(href) + ")"));
  out = out.replace(/<\/?(?:b|strong)>/g, "**").replace(/<\/?(?:i|em)>/g, "*").replace(/<\/?(?:s|del|strike)>/g, "~~").replace(/<\/?u>/g, "__");
  out = out.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "");
  return decode(out).replace(/\n{3,}/g, "\n\n").trim();
}
