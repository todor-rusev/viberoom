// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export interface SemanticVersion { parts: number[]; pre: string[] }
export function semanticVersion(raw: string): SemanticVersion | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(raw.trim());
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number), pre = match[4]?.split(".") ?? [];
  if (parts.some(n => !Number.isSafeInteger(n)) || pre.some(x => /^\d+$/.test(x) && (x.length > 1 && x[0] === "0"))) return null;
  return { parts, pre };
}
export function compareSemanticVersions(a: string, b: string): number | null {
  const av = semanticVersion(a), bv = semanticVersion(b);
  if (!av || !bv) return null;
  for (let i = 0; i < 3; i++) if (av.parts[i] !== bv.parts[i]) return av.parts[i] < bv.parts[i] ? -1 : 1;
  if (!av.pre.length || !bv.pre.length) return av.pre.length === bv.pre.length ? 0 : av.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(av.pre.length, bv.pre.length); i++) {
    const x = av.pre[i], y = bv.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return x.length !== y.length ? (x.length < y.length ? -1 : 1) : x < y ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
export function versionInOutput(output: string): string | null {
  const matches = output.match(/\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b/g) ?? [];
  const versions = [...new Set(matches.map(x => x.replace(/^v/, "")).filter(x => semanticVersion(x)))];
  return versions.length === 1 ? versions[0] : null;
}
