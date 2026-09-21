// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { OPERATIONS, TOOLS, type ToolSpec } from "./tool-spec.js";

const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
const validators = new Map<string, ValidateFunction>();
const definitions = new Map<string, ToolSpec>([...OPERATIONS, ...TOOLS].map(spec => [spec.name, spec]));
for (const [name, spec] of definitions) validators.set(name, ajv.compile(spec.inputSchema));

export interface InputProblem { path: string; message: string }
export function argumentProblems(name: string, input: unknown): InputProblem[] {
  const validate = validators.get(name);
  if (!validate) return [{ path: "#", message: "Unknown operation" }];
  if (validate(input)) return [];
  return (validate.errors ?? []).slice(0, 8).map(error => ({
    path: error.schemaPath.slice(0, 240), message: (error.message ?? "Invalid argument").slice(0, 200),
  }));
}
export function validArguments(name: string, input: unknown): input is Record<string, unknown> {
  return argumentProblems(name, input).length === 0;
}
export function invalidArguments(name: string, problems: InputProblem[]) {
  return {
    code: "invalid_arguments", operation: name, problems,
    inputSchema: definitions.get(name)?.inputSchema,
    hint: "Nothing was executed. Correct the arguments using this schema and retry the same operation.",
  };
}
