// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { isProxy } from "node:util/types";

export function hasExactFields(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const actual = Reflect.ownKeys(value), names = new Set(expected);
  if (actual.length !== expected.length || names.size !== expected.length) return false;
  return actual.every(key => {
    if (typeof key !== "string" || !names.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  });
}

export function hasDenseDataItems(value: unknown, maxLength = 10000): value is unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !Number.isSafeInteger(maxLength) || maxLength < 0) return false;
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maxLength || Reflect.ownKeys(value).length !== length + 1) return false;
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return false;
  }
  return true;
}
