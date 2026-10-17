// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
export class ConsentChangedError extends Error {
  constructor() {
    super("what leaves this computer changed since the words were shown");
    this.name = "ConsentChangedError";
  }
}
