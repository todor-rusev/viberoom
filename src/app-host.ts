// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {
  HOST_CONTRACT, HOST_MAX_REQUEST_TIMEOUT_MS, HOST_REPLY_TYPES, HOST_REQUEST_TIMEOUT_MS,
  parseHostMessage, parseProductMessage, validHostRun,
  type Hello, type HostAutostartState, type HostClose, type HostErrorCode, type HostInfo,
  type HostMessage, type HostNotification, type HostProgress, type HostRequest, type HostSettings,
  type HostStopping, type HostSuccessReply, type ProductMessage, type ProductNotificationBody,
  type ProductRequestBody, type ProductUpdateState,
} from "./host-protocol.js";
import type { UpdateInfo } from "./update.js";

export interface AppHostTransport {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  removeListener(event: "message", listener: (event: { data: unknown }) => void): unknown;
  removeListener(event: "close", listener: () => void): unknown;
}

export type AppHostErrorCode = HostErrorCode | "closed" | "transport";
export class AppHostError extends Error {
  constructor(readonly code: AppHostErrorCode, message: string) { super(message); this.name = "AppHostError"; }
}
export type HostProtocolIssue = "stale" | "invalid" | "unknown" | "unexpected-reply" | "not-ready" | "callback-failed";
export interface AppHostOptions {
  run: string;
  requestTimeoutMs?: number;
  issueTicket(signal: AbortSignal): string | Promise<string>;
  onClose(request: HostClose, signal: AbortSignal): void | Promise<void>;
  onAutostartState?(state: HostAutostartState): void;
  onAppUpdateState?(state: UpdateInfo): void;
  onProductUpdateState?(state: ProductUpdateState): void;
  onProtocolError?(issue: HostProtocolIssue): void;
  onClosed?(error: AppHostError): void;
}
interface PendingRequest {
  type: ProductRequestBody["type"];
  timer: ReturnType<typeof setTimeout>;
  resolve(reply: HostSuccessReply): void;
  reject(error: AppHostError): void;
}
interface IncomingRequest { type: HostRequest["type"]; controller: AbortController; timer: ReturnType<typeof setTimeout> }
const MAX_PENDING = 128;
const MAX_SEEN_REQUESTS = 4096;

export class AppHost {
  readonly run: string;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly incoming = new Map<string, IncomingRequest>();
  private readonly seen = new Set<string>();
  private sequence = 0;
  private phase: "new" | "hello" | "connected" | "ready" | "stopping" | "closed" = "new";
  private failure: AppHostError | null = null;
  private hostValue: HostInfo | null = null;
  private autostartValue: HostAutostartState | null = null;
  private appUpdateValue: UpdateInfo | null = null;
  private productUpdateValue: ProductUpdateState | null = null;
  private readonly received = (event: { data: unknown }): void => { this.receive(event?.data); };
  private readonly disconnected = (): void => { this.close(); };

  constructor(private readonly transport: AppHostTransport, private readonly options: AppHostOptions) {
    if (!validHostRun(options.run)) throw new AppHostError("invalid", "A valid public run identifier is required.");
    const timeout = options.requestTimeoutMs ?? HOST_REQUEST_TIMEOUT_MS;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > HOST_MAX_REQUEST_TIMEOUT_MS) {
      throw new AppHostError("invalid", "The host request deadline must be between 1 and 30000 ms.");
    }
    this.run = options.run;
    this.timeoutMs = timeout;
    transport.on("message", this.received);
    transport.on("close", this.disconnected);
  }

  get host(): HostInfo | null { return this.hostValue && { ...this.hostValue }; }
  get autostartState(): HostAutostartState | null { return this.autostartValue && { ...this.autostartValue }; }
  get appUpdateState(): UpdateInfo | null { return this.appUpdateValue && { ...this.appUpdateValue }; }
  get productUpdateState(): ProductUpdateState | null { return this.productUpdateValue && { ...this.productUpdateValue }; }
  get closed(): boolean { return this.phase === "closed"; }

  async hello(value: Hello): Promise<HostInfo> {
    this.ensureOpen();
    if (this.phase !== "new") throw new AppHostError("not-ready", "The host handshake has already started.");
    this.phase = "hello";
    try {
      const reply = await this.request({ ...value, type: "hello" });
      if (reply.type !== "host") throw new AppHostError("invalid", "Invalid host handshake.");
      if (!this.hostValue) {
        throw this.failure ?? new AppHostError("not-ready", "The product is stopping.");
      }
      this.ensureConnected();
      return { ...this.hostValue };
    } catch (error) {
      if (this.phase === "hello") this.close(error instanceof AppHostError ? error : undefined);
      throw error;
    }
  }

  progress(value: HostProgress): void { this.ensureStarting(); this.notify({ ...value, type: "progress" }); }
  async beginMigration(from: number, to: number): Promise<void> {
    this.ensureConnected(); await this.request({ type: "migration.begin", from, to });
  }
  endMigration(format: number, backup?: string | null): void { this.ensureConnected(); this.notify({ type: "migration.end", format, ...(backup ? { backup } : {}) }); }
  ready(url: string): void {
    this.ensureConnected();
    const message = this.productMessage({ type: "ready", url });
    this.phase = "ready";
    this.post(message);
  }
  stopping(value: HostStopping): void {
    this.ensureOpen();
    const message = this.productMessage({ ...value, type: "stopping" });
    this.beginStopping();
    this.post(message);
  }
  async restart(reconnect: "load" | "replay" | undefined, reason: "restart" | "update" = "restart"): Promise<void> {
    this.ensureConnected(); await this.request({ type: "restart", ...(reconnect ? { reconnect } : {}), reason });
  }
  async setAutostart(enabled: boolean): Promise<HostAutostartState> {
    this.ensureConnected();
    const reply = await this.request({ type: "autostart.set", enabled });
    if (reply.type !== "autostart.state") throw new AppHostError("invalid", "Invalid autostart reply.");
    return { ...reply.state };
  }
  async holdAwake(reason: string): Promise<void> { this.ensureConnected(); await this.request({ type: "awake.hold", reason }); }
  async releaseAwake(reason: string): Promise<void> { this.ensureConnected(); await this.request({ type: "awake.release", reason }); }
  async checkAppUpdate(): Promise<UpdateInfo> {
    this.ensureConnected();
    const reply = await this.request({ type: "app-update.check" });
    if (reply.type !== "app-update.state") throw new AppHostError("invalid", "Invalid app update reply.");
    return { ...reply.state };
  }
  async installAppUpdate(): Promise<void> { this.ensureConnected(); await this.request({ type: "app-update.install" }); }
  async checkProductUpdate(): Promise<ProductUpdateState> {
    this.ensureConnected();
    const reply = await this.request({ type: "product-update.check" });
    if (reply.type !== "product-update.state") throw new AppHostError("invalid", "Invalid product update reply.");
    return { ...reply.state };
  }
  async applyProductUpdate(): Promise<void> { this.ensureConnected(); await this.request({ type: "product-update.apply" }); }
  settings(value: HostSettings): void { this.ensureConnected(); this.notify({ ...value, type: "settings" }); }

  close(error = new AppHostError("closed", "The private host channel closed.")): void {
    if (this.closed) return;
    this.phase = "closed";
    this.failure = error;
    this.transport.removeListener("message", this.received);
    this.transport.removeListener("close", this.disconnected);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const request of this.incoming.values()) { clearTimeout(request.timer); request.controller.abort(error); }
    this.incoming.clear();
    this.seen.clear();
    this.callback(() => this.options.onClosed?.(error));
  }

  private ensureOpen(): void { if (this.failure) throw this.failure; }
  private ensureConnected(): void {
    this.ensureOpen();
    if (this.phase !== "connected" && this.phase !== "ready") throw new AppHostError("not-ready", "The host is not connected.");
  }
  private ensureStarting(): void {
    this.ensureOpen();
    if (this.phase !== "hello" && this.phase !== "connected") throw new AppHostError("not-ready", "The product is not starting.");
  }
  private productMessage(body: object): ProductMessage {
    const parsed = parseProductMessage({ ...body, v: HOST_CONTRACT, run: this.run }, this.run);
    if (!parsed.ok) throw new AppHostError("invalid", "Invalid product host message.");
    return parsed.message;
  }
  private notify(body: ProductNotificationBody): void { this.post(this.productMessage(body)); }
  private post(message: ProductMessage): void {
    this.ensureOpen();
    try { this.transport.postMessage(message); }
    catch {
      const error = new AppHostError("transport", "The private host channel could not send a message.");
      this.close(error);
      throw error;
    }
  }
  private request(body: ProductRequestBody): Promise<HostSuccessReply> {
    this.ensureOpen();
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new AppHostError("busy", "Too many pending host requests."));
    const id = `product-${++this.sequence}`;
    const message = this.productMessage({ ...body, id });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new AppHostError("timeout", `The ${body.type} host request timed out.`));
      }, this.timeoutMs);
      this.pending.set(id, { type: body.type, timer, resolve, reject });
      try { this.post(message); }
      catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }

  private receive(raw: unknown): void {
    if (this.closed) return;
    const parsed = parseHostMessage(raw, this.run);
    if (!parsed.ok) {
      this.report(parsed.reason);
      if (parsed.request) this.replyFailure(parsed.request, parsed.reason === "unknown" ? "unknown" : "invalid");
      return;
    }
    const message = parsed.message;
    if ("re" in message) { this.receiveReply(message); return; }
    if ("id" in message) { this.receiveRequest(message); return; }
    if (!this.hostValue || this.phase === "stopping") { this.report("not-ready"); return; }
    this.updateState(message);
  }

  private receiveReply(message: Extract<HostMessage, { re: string }>): void {
    const pending = this.pending.get(message.re);
    if (!pending || message.type !== (message.ok ? HOST_REPLY_TYPES[pending.type] : pending.type)) {
      this.report("unexpected-reply"); return;
    }
    this.pending.delete(message.re);
    clearTimeout(pending.timer);
    if (!message.ok) { pending.reject(new AppHostError(message.error, message.text ?? `The ${pending.type} host request failed.`)); return; }
    if (pending.type === "hello" && message.type === "host" && this.phase === "hello") {
      const { kind, version, appPath, platform, opener } = message;
      this.hostValue = { kind, version, appPath, platform, ...(opener ? { opener } : {}) };
      this.phase = "connected";
    }
    if (this.hostValue && this.phase !== "stopping") this.updateState(message);
    pending.resolve(message);
  }

  private updateState(message: HostNotification | HostSuccessReply): void {
    switch (message.type) {
      case "autostart.state":
        this.autostartValue = { ...message.state };
        this.callback(() => this.options.onAutostartState?.({ ...message.state })); break;
      case "app-update.state":
        this.appUpdateValue = { ...message.state };
        this.callback(() => this.options.onAppUpdateState?.({ ...message.state })); break;
      case "product-update.state":
        this.productUpdateValue = { ...message.state };
        this.callback(() => this.options.onProductUpdateState?.({ ...message.state })); break;
    }
  }

  private receiveRequest(request: HostRequest): void {
    if (this.seen.has(request.id) || this.incoming.has(request.id)) { this.replyFailure(request, "invalid"); return; }
    if (request.type !== "close" && this.incoming.size >= MAX_PENDING) { this.replyFailure(request, "busy"); return; }
    if (this.seen.size >= MAX_SEEN_REQUESTS) this.seen.delete(this.seen.values().next().value!);
    this.seen.add(request.id);
    if (request.type === "ticket.request" && this.phase !== "ready") { this.replyFailure(request, "not-ready"); return; }
    if (request.type === "close" && this.phase === "stopping") { this.replyFailure(request, "not-ready"); return; }
    if (request.type === "close") this.beginStopping();
    if (this.closed) return;
    const controller = new AbortController();
    const deadline = request.type === "close" ? request.deadlineMs : this.timeoutMs;
    const timer = setTimeout(() => {
      if (!this.incoming.delete(request.id)) return;
      controller.abort(new AppHostError("timeout", "The host request handler timed out."));
      this.replyFailure(request, "timeout");
    }, deadline);
    this.incoming.set(request.id, { type: request.type, controller, timer });
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      if (request.type === "ticket.request" && this.phase !== "ready") throw new AppHostError("not-ready", "The product is stopping.");
      return request.type === "ticket.request" ? this.options.issueTicket(controller.signal)
        : this.options.onClose({ reason: request.reason, deadlineMs: request.deadlineMs }, controller.signal);
    }).then(ticket => {
      if (!this.finishIncoming(request.id)) return;
      if (request.type === "ticket.request" && this.phase !== "ready") { this.replyFailure(request, "not-ready"); return; }
      try {
        const payload = request.type === "ticket.request" ? { ticket } : {};
        this.post(this.productMessage({ type: request.type, re: request.id, ok: true, ...payload }));
      } catch { this.replyFailure(request, "failed"); }
    }, () => {
      if (this.finishIncoming(request.id)) this.replyFailure(request, "failed");
    });
  }
  private finishIncoming(id: string): boolean {
    const incoming = this.incoming.get(id);
    if (!incoming) return false;
    clearTimeout(incoming.timer);
    this.incoming.delete(id);
    return true;
  }
  private beginStopping(): void {
    this.phase = "stopping";
    for (const [id, request] of this.incoming) {
      if (request.type !== "ticket.request") continue;
      this.finishIncoming(id);
      request.controller.abort(new AppHostError("not-ready", "The product is stopping."));
      this.replyFailure({ id, type: request.type }, "not-ready");
    }
  }
  private replyFailure(request: { id: string; type: string }, error: HostErrorCode): void {
    if (this.closed) return;
    try { this.post({ v: HOST_CONTRACT, run: this.run, type: request.type, re: request.id, ok: false, error }); }
    catch { }
  }
  private report(issue: HostProtocolIssue): void {
    try { void Promise.resolve(this.options.onProtocolError?.(issue)).catch(() => {}); }
    catch { }
  }
  private callback(action: () => unknown): void {
    try { void Promise.resolve(action()).catch(() => this.report("callback-failed")); }
    catch { this.report("callback-failed"); }
  }
}
