// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export interface AgentAuthStatus {
  kind: string;
  label: string;
  detail?: string;
  account?: { plan?: string; email?: string; organization?: string };
}

export function readAuthStatusUpdate(params: unknown): AgentAuthStatus | null {
  const status = (params as { authStatus?: unknown } | null)?.authStatus;
  if (!status || typeof status !== "object" || Array.isArray(status)) return null;
  const s = status as Record<string, unknown>;
  if (typeof s.kind !== "string" || !s.kind || typeof s.label !== "string" || !s.label) return null;
  const out: AgentAuthStatus = { kind: s.kind.slice(0, 60), label: s.label.slice(0, 120) };
  if (typeof s.detail === "string" && s.detail) out.detail = s.detail.slice(0, 200);
  const account = s.account;
  if (account && typeof account === "object" && !Array.isArray(account)) {
    const a = account as Record<string, unknown>;
    const taken: AgentAuthStatus["account"] = {};
    if (typeof a.plan === "string" && a.plan) taken.plan = a.plan.slice(0, 60);
    if (typeof a.email === "string" && a.email) taken.email = a.email.slice(0, 120);
    if (typeof a.organization === "string" && a.organization) taken.organization = a.organization.slice(0, 120);
    if (Object.keys(taken).length) out.account = taken;
  }
  return out;
}

export interface ExtensionHandlers {
  onAuthStatus?(status: AgentAuthStatus): void;
}
export interface ExtensionLog {
  info(text: string): void;
  warn(text: string): void;
}

export class ExtensionRouter {
  private readonly said = new Set<string>();
  constructor(private readonly handlers: ExtensionHandlers, private readonly log: ExtensionLog) {}

  private once(key: string, tell: () => void): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    tell();
  }

  notification(method: string, params: unknown): void {
    if (method === "_auth/status_update") {
      const status = readAuthStatusUpdate(params);
      if (status) this.handlers.onAuthStatus?.(status);
      else this.once(`malformed:${method}`, () => this.log.warn(`extension ${method} arrived with a payload this hub does not recognise; it is ignored`));
      return;
    }
    if (method.startsWith("_")) {
      this.once(`vendor:${method}`, () => this.log.info(`vendor extension notification ${method} (ignored, as ACP asks; further ones are not reported)`));
      return;
    }
    this.once(`standard:${method}`, () => this.log.warn(`unsupported ACP notification ${method}: possibly a newer protocol than this hub implements`));
  }

  protocolFault(text: string): void {
    if (text.startsWith("response for unknown id ")) {
      this.once(`stray:${text}`, () => this.log.warn(`${text} — the agent answered a request nobody made (a vendor bug); further identical answers are not reported`));
      return;
    }
    this.log.warn(text);
  }
}
