// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { DatabaseSync, StatementSync } from "node:sqlite";

export type SqliteStatement = Pick<StatementSync, "run" | "get" | "all" | "iterate" | "setReadBigInts">;

export interface SqliteConnection extends Pick<DatabaseSync, "exec" | "isOpen" | "isTransaction"> {
  prepare(sql: string): SqliteStatement;
}
