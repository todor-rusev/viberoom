// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export interface Foldable {
  seq: number;
}

export function foldIndex(list: readonly Foldable[], limit: number): number {
  if (!limit || limit < 0 || list.length <= limit) return 0;
  return list.length - limit;
}
