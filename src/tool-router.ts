// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomUUID } from "node:crypto";
import { ToolDiscovery } from "./tool-discovery.js";
import { canonicalOperationName, DISCOVERY_SCHEMA_VERSION } from "./tool-spec.js";
import { argumentProblems, invalidArguments } from "./tool-validation.js";
import { callConnection, CONNECTION_TOOL, connectionRows, describeConnection, executeOperation, jsonResult, OperationArgumentError, OperationUnconfirmedError, type HubRequest, type McpResult } from "./mcp-operations.js";
import type { ToolUsage } from "./tool-usage.js";

export class ToolRouter {
  readonly discovery = new ToolDiscovery();
  constructor(private readonly token: string, private readonly hub: HubRequest, private readonly report: (event: ToolUsage) => void = () => {}) {}
  close(): void { this.discovery.close(); }
  async call(asked: string, input: unknown): Promise<McpResult> {
    const started = performance.now(), callId = randomUUID();
    const route = asked === "tool_call" ? "wrapped" : asked === "tool_search" ? "search" : "direct";
    let operation = canonicalOperationName(asked) ?? (asked === "tool_call" || asked === "tool_search" ? asked : "unknown");
    let args = input;
    let connectionTool: string | null = null;
    const wrapperProblems = route === "direct" ? [] : argumentProblems(asked, input);
    if (route === "wrapped" && !wrapperProblems.length) {
      const wrapped = input as { name: string; arguments: Record<string, unknown> };
      operation = canonicalOperationName(wrapped.name) ?? "unknown";
      args = wrapped.arguments;
      if (operation === "unknown" && CONNECTION_TOOL.test(wrapped.name.trim())) { connectionTool = wrapped.name.trim(); operation = "connection"; }
    }
    const emit = (outcome: ToolUsage["outcome"]) => {
      try { this.report({ callId, schemaVersion: DISCOVERY_SCHEMA_VERSION, operation, route, outcome, durationMs: Math.max(0, Math.round(performance.now() - started)) }); }
      catch { }
    };
    const finish = (result: McpResult, outcome: ToolUsage["outcome"]) => { emit(outcome); return result; };
    emit("attempt");
    try {
      if (wrapperProblems.length) return finish(jsonResult(invalidArguments(asked, wrapperProblems), true), "invalid_arguments");
      if (operation === "unknown") return finish(jsonResult(this.discovery.unknown(), true), "unknown_operation");
      if (connectionTool) {
        const result = await callConnection(connectionTool, args as Record<string, unknown>, this.token, this.hub);
        return finish(result, result.isError ? "refused" : "ok");
      }
      const problems = argumentProblems(operation, args);
      if (problems.length) return finish(jsonResult(invalidArguments(operation, problems), true), "invalid_arguments");
      if (route === "search") {
        const query = (args as { query: string }).query;
        const own = this.discovery.exact(query);
        if (own) return finish(jsonResult(own), "ok");
        const named = /^[a-z][a-z0-9-]{1,31}(\.\S+)?$/.test(query.trim()) ? await describeConnection(query.trim(), this.token, this.hub) : null;
        if (named) return finish(jsonResult({ schemaVersion: DISCOVERY_SCHEMA_VERSION, ...named }), "ok");
        const result = this.discovery.search(query, await connectionRows(this.token, this.hub));
        return finish(jsonResult(result), result.mode === "catalog" && result.lexicalMatches === 0 ? "no_match" : "ok");
      }
      const result = await executeOperation(operation, args as Record<string, unknown>, this.token, this.hub);
      return finish(result, result.isError ? "refused" : "ok");
    } catch (error) {
      if (error instanceof OperationArgumentError) return finish(jsonResult(invalidArguments(operation, [
        { path: "#", message: "Arguments violate an operation constraint; check nonblank text and compatible optional fields." },
      ]), true), "invalid_arguments");
      if (error instanceof OperationUnconfirmedError) return finish(jsonResult({ code: "unconfirmed_result", operation,
        hint: "The room is unreachable or its response could not be read. The outcome is unconfirmed; inspect it before retrying a write.",
      }, true), "unconfirmed_result");
      return finish(jsonResult({ code: "internal_error", hint: "The operation could not be confirmed. Check its outcome before retrying a write." }, true), "internal_error");
    }
  }
}
