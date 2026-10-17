// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { setTimeout as delay } from "node:timers/promises";
import type { AcpAgent } from "../acp-client.js";
import type { McpServer, NewSessionResult } from "../acp-types.js";
import { describeError, RemoteError } from "../jsonrpc.js";
import type { Logger } from "../log.js";
import type { AgentRecipe } from "../recipes.js";

export const AUTH_WAIT_MS = 8000;

export function needsTheHuman(method: { id: string; name?: string | null; description?: string | null }, recipe?: AgentRecipe): boolean {
  if (recipe?.loginFlow.kind === "acp" && method.id === recipe.loginFlow.methodId) return true;
  return /\b(browser|oauth|log ?in with|sign ?in with)\b/i.test(`${method.id} ${method.name ?? ""} ${method.description ?? ""}`);
}

export function isAuthRequired(error: unknown): boolean {
  if (error instanceof RemoteError) return error.rpc.code === -32000 || /auth/i.test(error.rpc.message);
  return error instanceof Error && /auth/i.test(error.message);
}

export async function openSession(agent: AcpAgent, cwd: string, log: Logger, mcpServers: McpServer[] = [], recipe?: AgentRecipe, meta?: Record<string, unknown>): Promise<NewSessionResult> {
  try {
    return await agent.newSession(cwd, mcpServers, meta);
  } catch (error) {
    if (!isAuthRequired(error) || !agent.authMethods.length) throw error;
    log.info(`session/new needs authentication: ${describeError(error)}`);
    if (recipe?.loginState === "missing") throw new Error(`authentication required: ${recipe.vendor} is not logged in on this machine${recipe.loginCommand ? ` (its own CLI: ${recipe.loginCommand})` : ""}`);
  }
  const failures: string[] = [];
  for (const method of agent.authMethods) {
    const human = (method as { type?: string }).type === "terminal" ? "needs a terminal" : needsTheHuman(method, recipe) ? "opens a browser (a sign-in that needs you)" : null;
    if (human) {
      failures.push(`${method.id}: ${human}`);
      continue;
    }
    log.info(`authenticate with "${method.id}"${method.name ? ` (${method.name})` : ""}`);
    try {
      const done = await Promise.race([agent.authenticate(method.id).then(() => true), delay(AUTH_WAIT_MS).then(() => false)]);
      if (!done) {
        failures.push(`${method.id}: no answer in ${AUTH_WAIT_MS / 1000} s (a sign-in that needs you)`);
        continue;
      }
      return await agent.newSession(cwd, mcpServers, meta);
    } catch (error) {
      failures.push(`${method.id}: ${describeError(error)}`);
    }
  }
  throw new Error(`authentication failed: ${recipe?.vendor ?? "the agent"} is not logged in on this machine. ${failures.join("; ")}`);
}
