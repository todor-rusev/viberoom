// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { SqliteConnection } from "../sqlite-capabilities.js";
import { isDeepStrictEqual } from "node:util";
import { PolicyRefusal } from "./policy-refusal.js";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const flags = ["query_only", "foreign_keys", "defer_foreign_keys", "recursive_triggers", "read_uncommitted",
  "ignore_check_constraints", "writable_schema", "trusted_schema", "legacy_alter_table", "busy_timeout",
  "reverse_unordered_selects", "count_changes", "automatic_index", "wal_autocheckpoint", "analysis_limit",
  "temp_store", "threads", "cell_size_check", "fullfsync", "checkpoint_fullfsync", "full_column_names",
  "short_column_names", "empty_result_callbacks"] as const;
const schemaState = ["user_version", "application_id", "default_cache_size", "page_size", "auto_vacuum",
  "page_count", "freelist_count", "cache_size", "cache_spill", "journal_size_limit", "mmap_size",
  "max_page_count", "synchronous", "secure_delete"] as const;
const reversibleSchemaState = ["cache_size", "cache_spill", "journal_size_limit", "mmap_size", "max_page_count", "secure_delete"] as const;
function mode(db: SqliteConnection, sql: string): string {
  const value = Object.values(db.prepare(sql).get()!)[0];
  if (typeof value !== "string" || !/^[a-z]+$/.test(value)) throw new Error("Readonly SQLite mode unavailable");
  return value;
}
function signedInteger(db: SqliteConnection, sql: string): bigint {
  const statement = db.prepare(sql); statement.setReadBigInts(true);
  const value = Object.values(statement.get()!)[0];
  if (typeof value !== "bigint") throw new Error("Readonly SQLite state unavailable");
  return value;
}
function integer(db: SqliteConnection, sql: string): bigint {
  const value = signedInteger(db, sql);
  if (value < 0n) throw new Error("Readonly SQLite state unavailable");
  return value;
}
function optionalInteger(db: SqliteConnection, sql: string): bigint | null {
  const statement = db.prepare(sql); statement.setReadBigInts(true);
  const row = statement.get(); if (row === undefined) return null;
  const value = Object.values(row)[0];
  if (typeof value !== "bigint") throw new Error("Readonly SQLite state unavailable");
  return value;
}
function schemaInteger(db: SqliteConnection, namespace: string, setting: string): bigint {
  const value = optionalInteger(db, `pragma ${quote(namespace)}.${setting}`);
  if (value === null && setting === "mmap_size") return 0n;
  if (value === null) throw new Error("Readonly SQLite schema state unavailable");
  return value;
}
const likeMode = (db: SqliteConnection): bigint => {
  const result = signedInteger(db, "select 'a' like 'A' as ascii_case_like");
  if (result !== 0n && result !== 1n) throw new Error("Readonly SQLite LIKE profile unavailable");
  return result;
};
export const sqliteTotalChanges = (db: SqliteConnection): bigint => integer(db, "select total_changes()");
export const sqliteDataVersion = (db: SqliteConnection): bigint => integer(db, "pragma data_version");

function snapshot(db: SqliteConnection) {
  signedInteger(db, "pragma temp.schema_version");
  const databases = db.prepare("pragma database_list").all();
  const schemas = databases.map(row => {
    const name = String(row.name);
    const configuration = Object.fromEntries(reversibleSchemaState.map(setting => [setting, schemaInteger(db, name, setting)]));
    const cacheSize = configuration.cache_size;
    const statement = db.prepare(`select type as type,name as name,tbl_name as tbl_name,rootpage as rootpage,sql as sql from ${quote(name)}.sqlite_schema order by type,name,tbl_name,rootpage,sql`);
    statement.setReadBigInts(true);
    const encoding = Object.values(db.prepare(`pragma ${quote(name)}.encoding`).get()!)[0];
    if (typeof encoding !== "string") throw new Error("Readonly SQLite encoding unavailable");
    const defaultCacheSize = schemaInteger(db, name, "default_cache_size");
    const result = { name, version: signedInteger(db, `pragma ${quote(name)}.schema_version`), rows: statement.all(), encoding,
      state: Object.fromEntries(schemaState.map(setting => [setting, setting === "default_cache_size" ? defaultCacheSize : setting in configuration ? configuration[setting] : schemaInteger(db, name, setting)])),
      journalMode: mode(db, `pragma ${quote(name)}.journal_mode`), lockingMode: mode(db, `pragma ${quote(name)}.locking_mode`) };
    if (schemaInteger(db, name, "cache_size") !== cacheSize)
      db.exec(`pragma ${quote(name)}.cache_size=${cacheSize}`);
    return result;
  });
  return { changes: sqliteTotalChanges(db), databases, schemas, flags: Object.fromEntries(flags.map(name => [name, signedInteger(db, `pragma ${name}`)])), like: likeMode(db),
    open: db.isOpen, transaction: db.isTransaction };
}
type Snapshot = ReturnType<typeof snapshot>;

export class SqlReadOnlyViolation extends Error {
  constructor(message: string) { super(message); this.name = "SqlReadOnlyViolation"; }
}
const refusedWrite = (error: unknown): boolean => {
  const sqlite = error as { code?: unknown; errcode?: unknown } | null;
  return sqlite?.code === "ERR_SQLITE_ERROR" && typeof sqlite.errcode === "number" && (sqlite.errcode & 0xff) === 8;
};

export class SqlReadOnlyFence {
  private depth = 0;
  constructor(private readonly db: SqliteConnection) {}
  preserveConnection<T>(ownedOperation: (ownerCurrent: () => boolean) => T): T {
    const label = `memory_original_sql_configuration_${++this.depth}`;
    let transaction = false, opened = false, checkpointActive = false, before: Snapshot | null = null;
    try {
      transaction = this.db.isTransaction;
      const entryFlags = Object.fromEntries(flags.map(name => [name, signedInteger(this.db, `pragma ${name}`)]));
      this.db.exec(`savepoint ${label}`); opened = true;
      before = { ...snapshot(this.db), flags: entryFlags };
      this.db.exec(`release ${label}`); opened = false;
      this.restoreConnection(before, transaction);
      const entry = before;
      checkpointActive = true;
      return ownedOperation(() => checkpointActive && this.ownerCurrent(entry));
    } finally {
      checkpointActive = false;
      try {
        if (opened) this.db.exec(`rollback to ${label}; release ${label}`);
        if (before) this.restoreConnection(before, transaction, true);
      } finally { this.depth--; }
    }
  }
  read<T>(operation: () => T): T {
    const label = `memory_original_sql_readonly_${++this.depth}`;
    let transaction = false, opened = false, before: Snapshot | null = null;
    try {
      transaction = this.db.isTransaction;
      this.db.exec(`savepoint ${label}`); opened = true;
      before = snapshot(this.db);
      this.db.exec("pragma query_only=on");
      const readonly = { ...before, flags: { ...before.flags, query_only: 1n } };
      const value = operation();
      if (!this.unchanged(readonly)) throw new SqlReadOnlyViolation("Readonly SQLite callback changed");
      this.db.exec(`pragma query_only=${before.flags.query_only}`);
      if (!this.unchanged(before)) throw new SqlReadOnlyViolation("Readonly SQLite state changed");
      this.db.exec(`release ${label}`); opened = false;
      this.restoreConnection(before, transaction);
      return value;
    } catch (error) {
      const rolledBack = opened;
      if (opened) this.db.exec(`rollback to ${label}; release ${label}`);
      if (before) this.restoreConnection(before, transaction, rolledBack);
      throw error;
    } finally { this.depth--; }
  }
  run(current: () => unknown, local: () => boolean = () => true): boolean {
    if (!this.db.isOpen) return false;
    try { return this.read(() => local() === true && current() === true && local() === true); }
    catch (error) {
      if (error instanceof SqlReadOnlyViolation || error instanceof PolicyRefusal || refusedWrite(error)) return false;
      throw error;
    }
  }
  private unchanged(expected: Snapshot): boolean {
    return this.db.isOpen && this.db.isTransaction === expected.transaction &&
      isDeepStrictEqual(this.db.prepare("pragma database_list").all(), expected.databases) &&
      isDeepStrictEqual(snapshot(this.db), expected);
  }
  private ownerCurrent(expected: Snapshot): boolean {
    try {
      if (!this.db.isOpen || !this.db.isTransaction ||
          !isDeepStrictEqual(this.db.prepare("pragma database_list").all(), expected.databases)) return false;
      const profile = (value: Snapshot) => ({ ...value, changes: null, transaction: null,
        schemas: value.schemas.map(schema => ({ ...schema,
          state: { ...schema.state, page_count: null, freelist_count: null } })) });
      return isDeepStrictEqual(profile(snapshot(this.db)), profile(expected));
    } catch { return false; }
  }
  private restoreConnection(before: Snapshot, transaction: boolean, allowStorageFootprint = false): void {
    try {
    const names = new Set(before.databases.map(row => String(row.name)));
    for (const row of this.db.prepare("pragma database_list").all())
      if (!names.has(String(row.name))) this.db.exec(`detach database ${quote(String(row.name))}`);
    for (const schema of before.schemas) {
      if (mode(this.db, `pragma ${quote(schema.name)}.journal_mode`) !== schema.journalMode)
        this.db.exec(`pragma ${quote(schema.name)}.journal_mode=${schema.journalMode}`);
      if (mode(this.db, `pragma ${quote(schema.name)}.locking_mode`) !== schema.lockingMode)
        this.db.exec(`pragma ${quote(schema.name)}.locking_mode=${schema.lockingMode}`);
      for (const name of reversibleSchemaState) {
        const expected = schema.state[name];
        if (schemaInteger(this.db, schema.name, name) !== expected)
          this.db.exec(`pragma ${quote(schema.name)}.${name}=${expected}`);
      }
    }
    if (likeMode(this.db) !== before.like)
      this.db.exec(`pragma case_sensitive_like=${before.like === 1n ? "off" : "on"}`);
    const after = snapshot(this.db);
    const schemas = (input: Snapshot) => allowStorageFootprint ? input.schemas.map(schema => ({ ...schema,
      state: { ...schema.state, page_count: null, freelist_count: null } })) : input.schemas;
    if (!isDeepStrictEqual(after.databases, before.databases) || !isDeepStrictEqual(schemas(after), schemas(before)) ||
      !after.open || after.transaction !== transaction)
      throw new Error("Readonly SQLite restoration failed");
    } finally {
    for (const name of flags) if (signedInteger(this.db, `pragma ${name}`) !== before.flags[name])
      this.db.exec(`pragma ${name}=${before.flags[name]}`);
    if (!isDeepStrictEqual(Object.fromEntries(flags.map(name => [name, signedInteger(this.db, `pragma ${name}`)])), before.flags) || likeMode(this.db) !== before.like)
      throw new Error("Readonly SQLite flags restoration failed");
    }
  }
}
