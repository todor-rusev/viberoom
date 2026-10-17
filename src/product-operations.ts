// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { ToolDiscovery } from "./tool-discovery.js";
import { canonicalOperationName, OLD_TOOL_NAMES, OPERATIONS, TOOLS, type OperationSpec } from "./tool-spec.js";
import type { InputProblem } from "./tool-validation.js";

export interface OperationCaller {
  room: { id: string; uuid: string; scope: string | null };
  participant: { id: string; name: string };
}

export interface ProductOperation {
  spec: Omit<OperationSpec, "exposure">;
  run(caller: OperationCaller, args: Record<string, unknown>): unknown | Promise<unknown>;
}

export class OperationRefusal extends Error {}

const NAME = /^[a-z][a-z0-9_]{2,63}$/;

export type OperationOutcome =
  | { ok: true; result: unknown }
  | { ok: false; code: "unknown_operation" }
  | { ok: false; code: "invalid_arguments"; problems: InputProblem[]; inputSchema: OperationSpec["inputSchema"] }
  | { ok: false; code: "refused"; error: string }
  | { ok: false; code: "internal_error" };

export class ProductOperations {
  readonly #operations = new Map<string, { operation: ProductOperation; validate: ValidateFunction }>();

  constructor(operations: readonly ProductOperation[] = []) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
    const taken = new Set(TOOLS.map((tool) => tool.name));
    for (const operation of operations) {
      const name = operation.spec.name;
      if (!NAME.test(name)) throw new Error(`a product operation's name must be lower case letters, digits and _: ${name}`);
      if (taken.has(name) || canonicalOperationName(name) || Object.hasOwn(OLD_TOOL_NAMES, name) || this.#operations.has(name)) throw new Error(`the operation name ${name} is taken`);
      const spec = { ...operation.spec, inputSchema: { ...operation.spec.inputSchema, additionalProperties: false } };
      this.#operations.set(name, { operation: { ...operation, spec }, validate: ajv.compile(spec.inputSchema) });
    }
    new ToolDiscovery([...OPERATIONS, ...this.definitions()]).close();
  }

  definitions(): OperationSpec[] {
    return [...this.#operations.values()].map(({ operation }) => ({ ...operation.spec, exposure: "deferred" }));
  }

  async call(name: string, caller: OperationCaller, args: unknown): Promise<OperationOutcome> {
    const entry = this.#operations.get(name);
    if (!entry) return { ok: false, code: "unknown_operation" };
    if (!entry.validate(args)) {
      const problems = (entry.validate.errors ?? []).slice(0, 8).map((error) => ({
        path: error.schemaPath.slice(0, 240), message: (error.message ?? "Invalid argument").slice(0, 200),
      }));
      return { ok: false, code: "invalid_arguments", problems, inputSchema: entry.operation.spec.inputSchema };
    }
    try {
      return { ok: true, result: await entry.operation.run(caller, args as Record<string, unknown>) };
    } catch (error) {
      return error instanceof OperationRefusal ? { ok: false, code: "refused", error: error.message } : { ok: false, code: "internal_error" };
    }
  }
}
