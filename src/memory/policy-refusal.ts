// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import strict, { AssertionError } from "node:assert/strict";

export class PolicyRefusal extends AssertionError {
  constructor(refused: AssertionError) {
    super({ message: refused.message });
    this.name = "PolicyRefusal";
    Object.assign(this, { actual: refused.actual, expected: refused.expected, operator: refused.operator,
      generatedMessage: refused.generatedMessage, cause: refused });
  }
}

const refused = (error: unknown): unknown =>
  error instanceof AssertionError && !(error instanceof PolicyRefusal) ? new PolicyRefusal(error) : error;
function refusing(check: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
  return function (this: unknown, ...args: unknown[]) {
    let result: unknown;
    try { result = check.apply(this, args); } catch (error) { throw refused(error); }
    return result instanceof Promise ? result.catch(error => { throw refused(error); }) : result;
  };
}

export const policyAssert: typeof strict = (() => {
  const assert = refusing(strict as unknown as (...args: unknown[]) => unknown) as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(strict))
    if (typeof value === "function" && name !== "AssertionError" && name !== "CallTracker") assert[name] = refusing(value as (...args: unknown[]) => unknown);
  Object.assign(assert, { AssertionError, strict: assert });
  return assert as unknown as typeof strict;
})();

const CHANGED = new Set(["ENOENT", "ENOTDIR", "EISDIR", "ELOOP", "EACCES", "EPERM"]);
export const fileChanged = (error: unknown): boolean => CHANGED.has(String((error as { code?: unknown } | null)?.code));
