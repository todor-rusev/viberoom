// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export class ConnectionError extends Error {
  constructor(message: string, readonly code: "not-connected" | "reconnect" | "changed" | "unknown-tool" | "off-in-room" | "failed") { super(message); }
}
