// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export interface QrCode {
  size: number;
  version: number;
  mask: number;
  modules: boolean[][];
  isFunction: boolean[][];
}

export const BLOCKS_M: { ec: number; blocks: [number, number][] }[] = [
  { ec: 10, blocks: [[1, 16]] },
  { ec: 16, blocks: [[1, 28]] },
  { ec: 26, blocks: [[1, 44]] },
  { ec: 18, blocks: [[2, 32]] },
  { ec: 24, blocks: [[2, 43]] },
  { ec: 16, blocks: [[4, 27]] },
  { ec: 18, blocks: [[4, 31]] },
  { ec: 22, blocks: [[2, 38], [2, 39]] },
  { ec: 22, blocks: [[3, 36], [2, 37]] },
  { ec: 26, blocks: [[4, 43], [1, 44]] },
];
export const ALIGNMENT: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MAX_VERSION = BLOCKS_M.length;
const LEVEL_M_BITS = 0;

export function byteCapacity(version: number): number {
  const dataCodewords = BLOCKS_M[version - 1].blocks.reduce((n, [count, length]) => n + count * length, 0);
  return Math.floor((dataCodewords * 8 - 4 - countBits(version)) / 8);
}

function countBits(version: number): number {
  return version < 10 ? 8 : 16;
}


const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

function mul(a: number, b: number): number {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

function generator(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next: number[] = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

function errorCorrection(data: number[], degree: number): number[] {
  const g = generator(degree);
  const rest: number[] = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rest.shift()!;
    rest.push(0);
    for (let i = 0; i < degree; i++) rest[i] ^= mul(g[i + 1], factor);
  }
  return rest;
}


function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacity = BLOCKS_M[version - 1].blocks.reduce((n, [count, length]) => n + count * length, 0) * 8;
  const bits: number[] = [];
  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((v, bit) => (v << 1) | bit, 0));
  return out;
}

function interleave(data: number[], version: number): number[] {
  const { ec, blocks } = BLOCKS_M[version - 1];
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let at = 0;
  for (const [count, length] of blocks) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(at, at + length);
      at += length;
      dataBlocks.push(block);
      ecBlocks.push(errorCorrection(block, ec));
    }
  }
  const out: number[] = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ec; i++) for (const block of ecBlocks) out.push(block[i]);
  return out;
}


export function formatBits(mask: number): number {
  const data = (LEVEL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

export function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

export function codewordPath(size: number, isFunction: boolean[][]): [number, number][] {
  const path: [number, number][] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (const x of [right, right - 1]) if (!isFunction[y][x]) path.push([x, y]);
    }
  }
  return path;
}

function penalty(modules: boolean[][], size: number): number {
  let score = 0;
  const line = (at: (i: number) => boolean): void => {
    let run = 0;
    let prev: boolean | null = null;
    let s = "";
    for (let i = 0; i < size; i++) {
      const dark = at(i);
      s += dark ? "1" : "0";
      if (dark === prev) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        prev = dark;
        run = 1;
      }
    }
    for (const pattern of ["10111010000", "00001011101"]) for (let i = s.indexOf(pattern); i >= 0; i = s.indexOf(pattern, i + 1)) score += 40;
  };
  for (let y = 0; y < size; y++) line((x) => modules[y][x]);
  for (let x = 0; x < size; x++) line((y) => modules[y][x]);
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
  }
  let dark = 0;
  for (const row of modules) for (const m of row) if (m) dark++;
  const percent = (dark * 100) / (size * size);
  const low = Math.floor(percent / 5) * 5;
  score += (10 * Math.min(Math.abs(low - 50), Math.abs(low + 5 - 50))) / 5;
  return score;
}

export function encodeQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= MAX_VERSION && !version; v++) if (byteCapacity(v) >= bytes.length) version = v;
  if (!version) throw new Error(`too long for a QR code: ${bytes.length} bytes, at most ${byteCapacity(MAX_VERSION)}`);
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean): void => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const centres = ALIGNMENT[version];
  for (const cy of centres) {
    for (const cx of centres) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  const drawFormat = (mask: number): void => {
    const bits = formatBits(mask);
    const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  const codewords = interleave(dataCodewords(bytes, version), version);
  const path = codewordPath(size, isFunction);
  path.forEach(([x, y], i) => {
    if (i < codewords.length * 8) modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
  });

  const apply = (mask: number): void => {
    for (const [x, y] of path) if (maskBit(mask, x, y)) modules[y][x] = !modules[y][x];
  };
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    apply(mask);
    drawFormat(mask);
    const score = penalty(modules, size);
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
    apply(mask);
  }
  apply(best);
  drawFormat(best);
  return { size, version, mask: best, modules, isFunction };
}

export function qrSvg(text: string): string {
  const { size, modules } = encodeQr(text);
  const quiet = 4;
  const span = size + quiet * 2;
  let d = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${span}" height="${span}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
