// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export interface LookLintIssue {
  level: "error" | "warning";
  key: string;
  message: string;
}

export interface LookLintResult {
  ok: boolean;
  errors: LookLintIssue[];
  warnings: LookLintIssue[];
  report: string[];
}

export interface LookData {
  id: string;
  label: string;
  scheme: string;
  palette: Record<string, string>;
  meaning: Record<string, string>;
  aliases: Record<string, string>;
  elements: Record<string, Record<string, string>>;
  shape?: Record<string, string>;
}

const outsideCalls = (value: string): string => {
  let out = "";
  let depth = 0;
  for (const ch of String(value)) {
    if (ch === "(") {
      if (depth === 0) out += "(";
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) out += ")";
    } else if (depth === 0) out += ch;
  }
  return out.replace(/[\w-]+\(\)/g, "x");
};

export function lintKinds(look: LookData, issues: { errors: LookLintIssue[]; warnings: LookLintIssue[] }): void {
  const check = (path: string, key: string, value: string, section: string) => {
    const v = String(value).trim();
    const isRadiusKey = section === "shape" ? key !== "rScale" && key !== "rCtlMin" : /[Rr]adius/.test(key);
    if (isRadiusKey) {
      const bare = outsideCalls(v);
      if (/\//.test(bare) || bare.trim().split(/\s+/).filter(Boolean).length > 1) issues.errors.push({ level: "error", key: path, message: `${path} is one length or calc(), not "${v.slice(0, 60)}": the named radii are used inside calc() and max(), so a multi-corner value leaves every corner square` });
      return;
    }
    if ((key === "border" || /Border$/.test(key)) && !/^#|^rgba?\(|^transparent$|^currentColor$/i.test(v)) {
      if (/^-?\d*\.?\d+(px|em|rem|pt)?$/.test(v) && v !== "0" && v !== "0px") issues.warnings.push({ level: "warning", key: path, message: `${path} "${v}" is a width alone, which draws no border: write width, style and colour ("2px solid $ink")` });
      return;
    }
    if (/Lift$/.test(key)) {
      const n = parseFloat(v);
      if (Number.isFinite(n) && n > 0) issues.warnings.push({ level: "warning", key: path, message: `${path} "${v}" pushes the thing down on hover; a lift is negative ("-2px")` });
      return;
    }
    if (/Drop$/.test(key)) {
      const n = parseFloat(v);
      if (Number.isFinite(n) && n < 0) issues.warnings.push({ level: "warning", key: path, message: `${path} "${v}" lifts the thing when pressed; a drop is positive ("1px")` });
    }
  };
  for (const [key, value] of Object.entries(look.shape ?? {})) check(`shape.${key}`, key, value, "shape");
  for (const [group, parts] of Object.entries(look.elements)) for (const [key, value] of Object.entries(parts)) check(`elements.${group}.${key}`, key, value, "elements");
}

export function contrast(a: string, b: string): number | null {
  const hex = (s: string) => {
    const m = /^#([0-9a-f]{6})$/i.exec(String(s).trim());
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
  };
  const lum = (c: number[]) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const x = hex(a);
  const y = hex(b);
  if (!x || !y) return null;
  const [l1, l2] = [lum(x), lum(y)];
  return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
}

export function luminance(colour: string): number | null {
  const c = contrast(colour, "#000000");
  return c === null ? null : (c * 0.05 - 0.05);
}

export function hslHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function flatten(value: string, paper: string): string | null {
  const v = String(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  const p = /^#([0-9a-f]{6})$/i.exec(String(paper).trim());
  if (!m || !p) return null;
  const a = m[4] === undefined ? 1 : Math.max(0, Math.min(1, parseFloat(m[4])));
  const base = [0, 2, 4].map((i) => parseInt(p[1].slice(i, i + 2), 16));
  const top = [m[1], m[2], m[3]].map((x) => parseInt(x, 10));
  return `#${top.map((c, i) => Math.round(c * a + base[i] * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
}

const NOT_A_PAIR = new Set(["meaning.attentionInk"]);

export function lintLook(look: LookData): LookLintResult {
  const errors: LookLintIssue[] = [];
  const warnings: LookLintIssue[] = [];
  const report: string[] = [];
  const dark = look.scheme === "dark";
  const at = (inkKey: string, ink: string, bgKey: string, bg: string, floor: number) => {
    const c = contrast(ink, bg);
    if (c === null) return;
    report.push(`${inkKey} on ${bgKey}: ${c}:1 (floor ${floor})`);
    if (c < floor) errors.push({ level: "error", key: inkKey, message: `${inkKey} ${ink} on ${bgKey} ${bg} reads ${c}:1, under ${floor}:1` });
  };
  const e = look.elements;
  const p = look.palette;
  const bubble = e.bubble?.bg ?? "";
  at("elements.bubble.ink", e.bubble?.ink ?? "", "elements.bubble.bg", bubble, 7);
  at("palette.muted", p.muted, "elements.bubble.bg", bubble, dark ? 4.5 : 3);
  at("palette.faint", p.faint, "elements.bubble.bg", bubble, dark ? 3 : 2);
  at("palette.ink", p.ink, "palette.bg", p.bg, 7);
  at("elements.logoTile.ink", e.logoTile?.ink ?? "", "elements.logoTile.bg", e.logoTile?.bg ?? "", 3);
  at("elements.logoTile.badgeInk", e.logoTile?.badgeInk ?? "", "elements.logoTile.badgeBg", e.logoTile?.badgeBg ?? "", 3);
  at("elements.btn.onPrimary", e.btn?.onPrimary ?? "", "palette.primary", p.primary, 3);
  at("elements.face.humanInk", e.face?.humanInk ?? "", "elements.face.paper", e.face?.paper ?? "", 4.5);
  if (dark && e.roomMark?.gradFrom) {
    const [s, l] = e.roomMark.gradFrom.split(" ").map((v) => parseFloat(v));
    if (Number.isFinite(s) && Number.isFinite(l)) {
      for (const hue of [0, 60, 120, 180, 240, 300]) at(`elements.roomMark.ink (hue ${hue})`, e.roomMark.ink, "the mark's paper", hslHex(hue, s, l), 3);
    }
  }
  const codeBg = e.code?.bg ?? "";
  for (const [part, colour] of Object.entries(e.syntax ?? {})) at(`elements.syntax.${part}`, colour, "elements.code.bg", codeBg, 3);
  at("elements.code.ink", e.code?.ink ?? "", "elements.code.bg", codeBg, 4.5);
  at("elements.code.gutterInk", e.code?.gutterInk ?? "", "elements.code.gutterBg", e.code?.gutterBg ?? "", 3);
  const headBtnBg = flatten(e.code?.headBtnBg ?? "", codeBg);
  if (headBtnBg) at("elements.code.headBtnInk", e.code?.headBtnInk ?? "", "elements.code.headBtnBg over the block", headBtnBg, 3);
  const cardBg = e.fileCard?.bg ?? "";
  const cardHead = flatten(e.fileCard?.headBg ?? "", cardBg);
  if (cardHead) at("elements.fileCard.headInk", e.fileCard?.headInk ?? "", "elements.fileCard.headBg over the card", cardHead, 3);
  const darkBtn = flatten(e.btn?.darkBg ?? "", cardBg);
  if (darkBtn) at("elements.btn.darkInk", e.btn?.darkInk ?? "", "elements.btn.darkBg over the file card", darkBtn, 3);
  const groups: Record<string, Record<string, string>> = { ...e, meaning: look.meaning ?? {} };
  for (const [group, parts] of Object.entries(groups)) {
    for (const [key, value] of Object.entries(parts)) {
      if (!(key === "ink" || /Ink$/.test(key)) || NOT_A_PAIR.has(`${group}.${key}`)) continue;
      const stem = key === "ink" ? "" : key.slice(0, -3);
      const bgKey = group === "meaning" ? stem : stem ? `${stem}Bg` : "bg";
      if (!(bgKey in parts)) continue;
      const where = group === "meaning" ? "meaning" : `elements.${group}`;
      at(`${where}.${key}`, value, `${where}.${bgKey}`, parts[bgKey], 3);
    }
  }
  const off = contrast(bubble, p.bg);
  if (off !== null) {
    report.push(`elements.bubble.bg off palette.bg: ${off}:1 (1.1 or a ring)`);
    const ring = e.bubble?.border ?? "transparent";
    if (off < 1.1 && /^transparent$/i.test(ring)) warnings.push({ level: "warning", key: "elements.bubble.bg", message: `the bubble ${bubble} barely stands off the paper ${p.bg} (${off}:1) and wears no ring: give elements.bubble.border a hairline or the bubble another shade` });
  }
  const paperLum = luminance(p.bg);
  if (paperLum !== null) {
    if (dark && paperLum > 0.4) warnings.push({ level: "warning", key: "scheme", message: `scheme is dark but the paper ${p.bg} is light: diagrams and the marks are drawn for dark paper` });
    if (!dark && paperLum < 0.2) warnings.push({ level: "warning", key: "scheme", message: `scheme is light but the paper ${p.bg} is dark: say scheme "dark", so diagrams and the marks are drawn for it` });
  }
  lintKinds(look, { errors, warnings });
  const onPanel = contrast(p.muted, look.aliases?.panel ?? "");
  if (onPanel !== null) {
    report.push(`palette.muted on aliases.panel: ${onPanel}:1 (3 wanted)`);
    if (onPanel < 3) warnings.push({ level: "warning", key: "palette.muted", message: `the quiet words ${p.muted} on a panel ${look.aliases.panel} read ${onPanel}:1; times and hints will be hard to read` });
  }
  return { ok: errors.length === 0, errors, warnings, report };
}
