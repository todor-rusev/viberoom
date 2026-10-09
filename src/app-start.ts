// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { AppHost, type AppHostTransport } from "./app-host.js";
import { validHostRun, type Hello, type HostAutostartState, type HostClose, type HostInfo, type HostProgress, type HostStopping, type ProductUpdateState } from "./host-protocol.js";
import type { UpdateInfo } from "./update.js";

export type RefusalKind = "foreign-hub" | "port-busy" | "folder-owned" | "data-format" | "contract";

export class RefusedStart extends Error {
  constructor(readonly kind: RefusalKind, message: string) {
    super(message);
    this.name = "RefusedStart";
  }
}

export type StopReason = Exclude<HostStopping["reason"], "refused">;

export interface AppHandlers {
  ticket(): string;
  close(request: HostClose): Promise<void>;
}

export interface AppListeners {
  autostart?(state: HostAutostartState): void;
  appUpdate?(state: UpdateInfo): void;
  productUpdate?(state: ProductUpdateState): void;
}

export interface AppStart {
  readonly channel: AppHost;
  hello(value: Hello): Promise<HostInfo>;
  progress(stage: string, done?: number, total?: number): void;
  ready(url: string): void;
  stopping(reason: StopReason, text?: string, withinMs?: number): void;
  failed(error: unknown): Promise<void>;
  handle(handlers: AppHandlers): void;
  listen(listeners: AppListeners): void;
}

const PROGRESS_MS = 2_000;
const LAST_WORD_MS = 200;

function sentence(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\0/g, "").trim();
  return (text || "the start failed").slice(0, 4000);
}

export function appStart(transport: AppHostTransport | undefined, run: string | undefined, onProtocolError?: (issue: string) => void): AppStart {
  if (!transport) throw new Error("--host app is the viberoom application's own start: it runs as a process of the application");
  if (!run || !validHostRun(run)) throw new Error("--host app needs the application's run identifier (VIBEROOM_RUN)");
  let handlers: AppHandlers | null = null;
  let listeners: AppListeners = {};
  let said: HostProgress | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const channel = new AppHost(transport, {
    run,
    issueTicket: () => {
      if (!handlers) throw new Error("the room is not ready");
      return handlers.ticket();
    },
    onClose: async (request) => {
      if (handlers) await handlers.close(request);
    },
    onAutostartState: (state) => listeners.autostart?.(state),
    onAppUpdateState: (state) => listeners.appUpdate?.(state),
    onProductUpdateState: (state) => listeners.productUpdate?.(state),
    onProtocolError,
  });
  const stopTimer = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const tell = (): void => {
    if (!said) return;
    try {
      channel.progress(said);
    } catch {
      stopTimer();
    }
  };
  return {
    channel,
    hello: (value) => channel.hello(value),
    progress(next, done, total) {
      said = { stage: next, ...(done !== undefined ? { done } : {}), ...(total !== undefined ? { total } : {}) };
      tell();
      if (!timer) {
        timer = setInterval(tell, PROGRESS_MS);
        timer.unref?.();
      }
    },
    ready(url) {
      stopTimer();
      channel.ready(url);
    },
    stopping(reason, text, withinMs) {
      stopTimer();
      try {
        channel.stopping({ reason, ...(text ? { text } : {}), ...(withinMs ? { withinMs: Math.ceil(withinMs) } : {}) });
      } catch {
      }
    },
    async failed(error) {
      stopTimer();
      try {
        channel.stopping(error instanceof RefusedStart ? { reason: "refused", kind: error.kind, text: sentence(error) } : { reason: "fatal", text: sentence(error) });
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, LAST_WORD_MS));
    },
    handle(next) {
      handlers = next;
    },
    listen(next) {
      listeners = next;
    },
  };
}
