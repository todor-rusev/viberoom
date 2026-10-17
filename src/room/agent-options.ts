// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AcpAgent } from "../acp-client.js";
import { useAgent } from "../agent-maintenance.js";
import type { Logger } from "../log.js";
import { ensureDir } from "../persona.js";
import type { AgentRecipe } from "../recipes.js";
import type { DiscoveredOptions } from "../room.js";
import { openSession } from "./session-open.js";

export const PROBE_TIMEOUT_MS = 30_000;

export async function probeAgentOptions(recipe: AgentRecipe, at: { dataDir: string; log: Logger }): Promise<DiscoveredOptions> {
  const recipeId = recipe.id;
  const cwd = ensureDir(join(at.dataDir, ".probe"));
  const log = at.log.child(`probe:${recipeId}`);
  const launch = recipe.build({ model: null, mode: null });
  const release = useAgent(recipeId);
  let agent: AcpAgent;
  try { agent = new AcpAgent(
    { ...launch, cwd },
    {
      onSessionUpdate: () => undefined,
      onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }),
      onStderr: (line) => log.info(`stderr: ${line}`),
      onExit: () => undefined,
    },
  ); } catch (error) { release(); throw error; }
  const started = Date.now();
  try {
    const info = await Promise.race([
      (async (): Promise<DiscoveredOptions> => {
        const init = await agent.initialize({ name: "viberoom", version: "0.2.0" });
        const session = await openSession(agent, cwd, log, [], recipe);
        const result: DiscoveredOptions = {
          recipeId,
          agentInfo: { name: init.agentInfo?.name ?? null, version: init.agentInfo?.version ?? null },
          authMethods: agent.authMethods.map((m) => m.id),
          modes: session.modes ?? null,
          configOptions: session.configOptions ?? [],
          modelAtLaunch: !!recipe.modelAtLaunch,
          modeAtLaunch: !!recipe.modeAtLaunch,
          discoveredAt: Date.now(),
          durationMs: 0,
          installStamp: null,
        };
        try {
          await Promise.race([agent.closeSession(session.sessionId), delay(1500)]);
        } catch {
        }
        return result;
      })(),
      delay(PROBE_TIMEOUT_MS).then(() => {
        throw new Error("agent did not answer initialize/session/new within 30 s");
      }),
    ]);
    info.durationMs = Date.now() - started;
    log.info(`options discovered in ${info.durationMs} ms: ${info.configOptions.map((o) => o.id).join(", ") || "none"}`);
    return info;
  } finally {
    try { await agent.kill(); } finally { release(); }
  }
}
