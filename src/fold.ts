// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export interface Foldable {
  seq: number;
}

export function foldIndex(list: readonly Foldable[], limit: number, atLeastSeq?: number): number {
  if (!limit || limit < 0 || list.length <= limit) return 0;
  let index = list.length - limit;
  if (atLeastSeq !== undefined) {
    const handed = list.findIndex((m) => m.seq >= atLeastSeq);
    if (handed >= 0) index = Math.min(index, handed);
  }
  const firstDraft = list.findIndex(m => m.seq <= 0);
  if (firstDraft >= 0) index = Math.min(index, firstDraft);
  return index;
}
