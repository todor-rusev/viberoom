// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { resolve } from "node:path";

export function defaultDataDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  return env.VIBEROOM_DATA_DIR ? resolve(env.VIBEROOM_DATA_DIR) : resolve(home, ".viberoom");
}
