// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export const PIN_LABEL_MAX = 120;

interface Pinnable {
  pinned?: boolean;
  pinLabel?: string;
}

export function withPin<T extends Pinnable>(row: T, pinned: boolean): T {
  if (pinned) return { ...row, pinned: true };
  const { pinned: _pinned, pinLabel: _label, ...rest } = row;
  return rest as T;
}

export function pinTitle(label: string): string {
  return String(label ?? "").replace(/\s+/g, " ").trim().slice(0, PIN_LABEL_MAX);
}

export function withPinLabel<T extends Pinnable>(row: T, title: string): T {
  if (title) return { ...row, pinLabel: title };
  const { pinLabel: _label, ...rest } = row;
  return rest as T;
}
