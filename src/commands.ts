// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export interface RoomCommand {
  name: string;
  typed: string;
  args: string;
}

export const ROOM_COMMANDS = ["fresh-start"];

export const COMMAND_OLD_NAMES: Record<string, string> = { respawn: "fresh-start" };

export const RESERVED_SKILL_NAMES = [
  "fresh-start",
  "respawn",
  "clear",
  "help",
  "brief",
  "mute",
  "unmute",
  "invite",
  "kick",
  "reset",
  "stop",
  "silent",
  "request-brief",
];

export function isReservedSkillName(name: string): boolean {
  return RESERVED_SKILL_NAMES.includes(name.trim().toLowerCase());
}

export function parseRoomCommand(text: string): RoomCommand | null {
  const match = text.trim().match(/^\/([A-Za-z][A-Za-z0-9_-]{0,31})(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const typed = match[1].toLowerCase();
  const name = ROOM_COMMANDS.includes(typed) ? typed : COMMAND_OLD_NAMES[typed];
  if (!name) return null;
  return { name, typed, args: (match[2] ?? "").trim() };
}

export function commandTarget(args: string): string {
  return args.trim().replace(/^@/, "").trim();
}
