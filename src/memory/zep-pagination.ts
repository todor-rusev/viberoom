// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export const zepPageCursorMissing = (count: number, pageSize: number, cursor: string | null): boolean =>
  !cursor && count === pageSize;
