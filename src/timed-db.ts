// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { DatabaseSync, type FunctionOptions, type SQLInputValue, type SQLOutputValue, type StatementResultingChanges, type StatementSync } from "node:sqlite";
import { timedIo } from "./slow-io.js";
import type { SqliteConnection, SqliteStatement } from "./sqlite-capabilities.js";
import { openObservedTestDatabase } from "./owned-native-test-resources.js";

const stepOf = (sql: string): string => `sqlite ${(/^\s*([A-Za-z]+)/.exec(sql)?.[1] ?? "statement").toLowerCase()}`;

type Row = Record<string, SQLOutputValue>;
type BoundParameters = Array<SQLInputValue | Record<string, SQLInputValue>>;

export class TimedStatement implements SqliteStatement {
  constructor(private readonly statement: StatementSync, private readonly step: string, private readonly path: string,
    private readonly now?: () => number) {}
  run(...params: SQLInputValue[]): StatementResultingChanges;
  run(named: Record<string, SQLInputValue>, ...params: SQLInputValue[]): StatementResultingChanges;
  run(...params: BoundParameters): StatementResultingChanges {
    return timedIo(this.step, this.path, () => Reflect.apply(this.statement.run, this.statement, params), this.now);
  }
  get(...params: SQLInputValue[]): Row | undefined;
  get(named: Record<string, SQLInputValue>, ...params: SQLInputValue[]): Row | undefined;
  get(...params: BoundParameters): Row | undefined {
    return timedIo(this.step, this.path, () => Reflect.apply(this.statement.get, this.statement, params), this.now);
  }
  all(...params: SQLInputValue[]): Row[];
  all(named: Record<string, SQLInputValue>, ...params: SQLInputValue[]): Row[];
  all(...params: BoundParameters): Row[] {
    return timedIo(this.step, this.path, () => Reflect.apply(this.statement.all, this.statement, params), this.now);
  }
  iterate(...params: SQLInputValue[]): NodeJS.Iterator<Row>;
  iterate(named: Record<string, SQLInputValue>, ...params: SQLInputValue[]): NodeJS.Iterator<Row>;
  iterate(...params: BoundParameters): NodeJS.Iterator<Row> {
    const iterator: NodeJS.Iterator<Row> = timedIo(this.step, this.path,
      () => Reflect.apply(this.statement.iterate, this.statement, params), this.now);
    const measured: NodeJS.Iterator<Row> = Object.create(Object.getPrototypeOf(iterator));
    const thisStatement = this;
    for (const name of ["next", "return", "throw"] as const) {
      const method = iterator[name];
      if (typeof method !== "function") continue;
      Object.defineProperty(measured, name, { configurable: true, writable: true,
        value: function(this: unknown, ...args: unknown[]) {
          return timedIo(thisStatement.step, thisStatement.path,
            () => Reflect.apply(method, this === measured ? iterator : this, args), thisStatement.now);
        } });
    }
    Object.defineProperty(measured, Symbol.iterator, { configurable: true, writable: true, value: () => measured });
    return measured;
  }
  setReadBigInts(enabled: boolean): void { this.statement.setReadBigInts(enabled); }
}

export class TimedDatabase implements SqliteConnection {
  static open(path: string, now?: () => number): TimedDatabase { return new TimedDatabase(openObservedTestDatabase(path), path, now); }
  private constructor(readonly raw: DatabaseSync, private readonly path: string, private readonly now?: () => number) {}
  get isOpen(): boolean { return this.raw.isOpen; }
  get isTransaction(): boolean { return this.raw.isTransaction; }
  exec(sql: string): void { timedIo(stepOf(sql), this.path, () => this.raw.exec(sql), this.now); }
  prepare(sql: string): TimedStatement {
    const step = stepOf(sql);
    return new TimedStatement(timedIo(step, this.path, () => this.raw.prepare(sql), this.now), step, this.path, this.now);
  }
  function(name: string, fn: (...args: SQLOutputValue[]) => SQLInputValue): void;
  function(name: string, options: FunctionOptions, fn: (...args: SQLOutputValue[]) => SQLInputValue): void;
  function(name: string, ...parameters: [fn: (...args: SQLOutputValue[]) => SQLInputValue]
    | [options: FunctionOptions, fn: (...args: SQLOutputValue[]) => SQLInputValue]): void {
    Reflect.apply(this.raw.function, this.raw, [name, ...parameters]);
  }
  close(): void { timedIo("sqlite close", this.path, () => this.raw.close(), this.now); }
}
