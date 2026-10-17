// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { setTimeout as delay } from "node:timers/promises";
import type { AcpAgent } from "../acp-client.js";
import type { AgentRuntime } from "./agent-runtime.js";
import type { Held, SeenVibemate } from "./vibemate-seen.js";

export interface SessionClose {
  readonly within: number;
  readonly awaitKill: boolean;
  readonly closeFailed?: (error: unknown) => void;
}

export const RETIRE: SessionClose = Object.freeze({ within: 1500, awaitKill: true });

export interface AgentSessionPorts {
  current(id: string): Held;
  closing(): boolean;
  blocked(): boolean;
  forget(id: string, expected: AgentRuntime): void;
  pushParticipant(seen: SeenVibemate): boolean;
  cancelPermissionsOf(id: string): void;
  restoreSeen(seen: SeenVibemate, seq: number): boolean;
  notice(seen: SeenVibemate, text: string): boolean;
  markForgotten(seen: SeenVibemate): boolean;
  markExited(seen: SeenVibemate, detail: string): boolean;
}

export class AgentSessions {
  constructor(private readonly ports: AgentSessionPorts) {}

  live(id: string, agent: AcpAgent, sessionId: string): boolean {
    const { participant, runtime } = this.ports.current(id);
    return !!participant && participant.kind === "agent" && participant.status !== "left"
      && !!runtime && runtime.session.agent === agent && runtime.session.sessionId === sessionId
      && agent.alive && !runtime.session.retiring && !this.ports.closing() && !this.ports.blocked();
  }

  async retire(id: string, expected?: AgentRuntime): Promise<void> {
    const { participant, runtime } = this.ports.current(id);
    if (!runtime || !participant || (expected && runtime !== expected)) return;
    runtime.session.retiring = true;
    if (runtime.work.quiet) this.ports.pushParticipant({ participant, runtime });
    if (runtime.work.turnActive) runtime.session.agent.cancel(runtime.session.sessionId);
    await this.close(id, runtime, RETIRE);
    this.ports.markForgotten({ participant, runtime: null });
  }

  async close(id: string, runtime: AgentRuntime, how: SessionClose): Promise<void> {
    try {
      await Promise.race([runtime.session.agent.closeSession(runtime.session.sessionId), delay(how.within)]);
    } catch (error) {
      how.closeFailed?.(error);
    }
    if (how.awaitKill) await runtime.session.agent.kill();
    else void runtime.session.agent.kill();
    this.ports.forget(id, runtime);
  }

  exited(id: string, code: number | null, signal: NodeJS.Signals | null, agent: AcpAgent): void {
    const { participant, runtime } = this.ports.current(id);
    if (!participant || !runtime || runtime.session.agent !== agent) return;
    delete participant.authStatus;
    this.ports.cancelPermissionsOf(id);
    if (this.ports.closing() || runtime.session.retiring) {
      this.ports.forget(id, runtime);
      return;
    }
    runtime.session.log.warn(`agent process exited (code ${code}, signal ${signal})`);
    const kept = runtime.session.transcript.dump(`the agent process exited (code ${code}, signal ${signal})`);
    if (kept) runtime.session.log.info(`the protocol around the exit was kept: ${kept}`);
    this.ports.forget(id, runtime);
    const after: SeenVibemate = { participant, runtime: null };
    if (participant.status === "left") return;
    if (!this.ports.restoreSeen(after, runtime.reading.lastSeenSeq)) return;
    if (!this.ports.markExited(after, `process exited (code ${code}${signal ? `, signal ${signal}` : ""}); reconnect to continue`)) return;
    if (this.ports.pushParticipant(after)) this.ports.notice(after, `${participant.name}: agent process exited.`);
  }
}

