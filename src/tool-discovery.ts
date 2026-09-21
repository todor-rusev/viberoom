// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { DatabaseSync } from "node:sqlite";
import { canonicalOperationName, DISCOVERY_SCHEMA_VERSION, OPERATIONS, toolDefinition, type OperationSpec } from "./tool-spec.js";

export const DISCOVERY_MAX_BYTES = 16 * 1024;
export type CatalogueRow = { name: string; summary: string; direct: boolean };
const alphabetical = (a: { name: string }, b: { name: string }) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
function bounded<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value)) > DISCOVERY_MAX_BYTES) throw new Error("The complete tool discovery response exceeds its size budget");
  return value;
}

export class ToolDiscovery {
  private readonly db: DatabaseSync;
  private readonly operations: Map<string, OperationSpec>;
  readonly catalogue: CatalogueRow[];
  constructor(operations: readonly OperationSpec[] = OPERATIONS) {
    this.operations = new Map(operations.map(operation => [operation.name, operation]));
    if (this.operations.size !== operations.length) throw new Error("Duplicate operation name");
    this.catalogue = operations.map(op => ({ name: op.name, summary: op.summary, direct: op.exposure === "direct" })).sort(alphabetical);
    bounded(this.catalogResult(this.catalogue, operations.length));
    this.unknown();
    for (const op of operations) bounded(this.definition(op));
    this.db = new DatabaseSync(":memory:");
    this.db.exec("CREATE VIRTUAL TABLE catalogue_fts USING fts5(name, purpose, tokenize='unicode61')");
    const insert = this.db.prepare("INSERT INTO catalogue_fts(name, purpose) VALUES (?, ?)");
    for (const op of operations) insert.run(op.name, op.summary);
  }
  close(): void { this.db.close(); }
  private definition(operation: OperationSpec) {
    return { mode: "definition" as const, schemaVersion: DISCOVERY_SCHEMA_VERSION,
      tool: { ...toolDefinition(operation), direct: operation.exposure === "direct" },
      hint: operation.exposure === "direct" ? "Call this direct tool, or use tool_call with its name and arguments."
        : "Use tool_call with this name and arguments matching inputSchema. This operation is not a direct tool in tools/list.",
    };
  }
  private catalogResult(tools: CatalogueRow[], lexicalMatches: number) {
    return { mode: "catalog" as const, schemaVersion: DISCOVERY_SCHEMA_VERSION, lexicalMatches, tools,
      hint: "This is the entire accessible catalogue, including non-matches. Rank is not confidence. Search an exact name for its full schema; if none fits, the capability is not available here.",
    };
  }
  unknown() {
    return bounded({ code: "unknown_operation", ...this.catalogResult(this.catalogue, 0) });
  }
  search(query: string) {
    const normalized = query.trim();
    const exact = this.operations.get(canonicalOperationName(normalized) ?? normalized);
    if (exact) return this.definition(exact);
    const terms = [...new Set(normalized.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
    const expression = terms.map(term => `"${term}"`).join(" OR ");
    const matches = expression ? this.db.prepare("SELECT name FROM catalogue_fts WHERE catalogue_fts MATCH ? ORDER BY bm25(catalogue_fts, 8.0, 1.0), name").all(expression) as { name: string }[] : [];
    const positions = new Map(matches.map((row, index) => [row.name, index]));
    const tools = [...this.catalogue].sort((a, b) => (positions.get(a.name) ?? matches.length) - (positions.get(b.name) ?? matches.length) || alphabetical(a, b));
    return this.catalogResult(tools, matches.length);
  }
}
