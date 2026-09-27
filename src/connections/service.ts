// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { OPERATIONS } from "../tool-spec.js";
import type { Vault } from "../vault.js";
import { CATALOG, CONNECTION_ID, KEYED_SYSTEMS, ownConnectionId, type CatalogEntry } from "./catalog.js";
import { ConnectionError } from "./errors.js";
import { checkEnvNames, checkLaunch, commandLine, sameLaunch, type LocalLaunch } from "./local-launch.js";
import { McpLocal, type McpLocalOptions } from "./mcp-local.js";
import { McpAuthRequired, McpRemote } from "./mcp-remote.js";
import type { McpSession, McpTool, ToolResult } from "./mcp-session.js";
import { checkOutbound } from "./outbound.js";
import {
  authorizeUrl, discover, exchangeCode, LoopbackListener, makePkce, newState, parseChallenge, refreshTokens, register, revokeTokens,
  SignInError, type ClientRegistration, type ServerAuth, type TokenSet,
} from "./oauth.js";

export const CONNECTIONS_FILE = "connections.json";

export type ToolRule = "read" | "write";
export type ConnectionState =
  | "connected"
  | "reconnect"
  | "changed";

export interface PinnedTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  rule: ToolRule;
}

export type OwnSystem =
  | { id: string; name: string; mcpUrl: string; addedAt: string }
  | { id: string; name: string; launch: LocalLaunch; env: string[]; addedAt: string };

interface System {
  id: string;
  name: string;
  blurb: string;
  group: ConnectionView["group"];
  mcpUrl?: string;
  launch?: LocalLaunch;
  env?: string[];
  mark?: CatalogEntry["mark"];
  own: boolean;
}

export interface ConnectionRecord {
  id: string;
  url?: string;
  auth: ServerAuth | null;
  state: ConnectionState;
  connectedAt: string;
  server?: { name?: string; version?: string };
  tools: PinnedTool[];
  toolsHash: string;
  offInRooms: string[];
  port: number;
  pending?: { tools: PinnedTool[]; toolsHash: string; seenAt: string };
}

type SecretPart = "client" | "tokens" | "env";

interface FileShape { version: 1; connections: ConnectionRecord[]; own?: OwnSystem[] }

export interface ConnectionView {
  id: string;
  name: string;
  blurb: string;
  group: CatalogEntry["group"] | "own";
  mark?: { url: string; hex: string };
  url?: string;
  address?: string;
  access?: "sign-in" | "keys" | "none";
  command?: string;
  env?: string[];
  envReady?: boolean;
  state: ConnectionState | "not-connected" | "signing-in";
  connectedAt?: string;
  server?: string;
  tools?: { name: string; title?: string; rule: ToolRule }[];
  offInRooms?: string[];
  changes?: string[];
}

export { ConnectionError };

export interface ConnectionsOptions {
  dataDir: string;
  vault: () => Vault | null;
  fetch: typeof fetch;
  openBrowser: (url: string) => void;
  clientVersion: string;
  now?: () => number;
  catalog?: readonly CatalogEntry[];
  checkAddress?: (raw: string) => URL;
  changed?: () => void;
  local?: Pick<McpLocalOptions, "resolve" | "spawn" | "stop" | "idleMs">;
}

export function toolsHash(tools: readonly PinnedTool[]): string {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable((value as Record<string, unknown>)[k])])) : value;
  const rows = [...tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(stable);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export function pinTools(tools: readonly McpTool[], fromCatalog: boolean): PinnedTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    ...(tool.title ?? tool.annotations?.title ? { title: tool.title ?? tool.annotations?.title } : {}),
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
    rule: fromCatalog && tool.annotations?.readOnlyHint === true ? "read" : "write",
  }));
}

export function describeChanges(before: readonly PinnedTool[], after: readonly PinnedTool[]): string[] {
  const old = new Map(before.map((t) => [t.name, t]));
  const now = new Map(after.map((t) => [t.name, t]));
  const lines: string[] = [];
  for (const name of now.keys()) if (!old.has(name)) lines.push(`new tool: ${name}`);
  for (const name of old.keys()) if (!now.has(name)) lines.push(`removed: ${name}`);
  for (const [name, tool] of now) {
    const was = old.get(name);
    if (!was) continue;
    if (was.description !== tool.description) lines.push(`${name}: its description changed`);
    if (JSON.stringify(was.inputSchema) !== JSON.stringify(tool.inputSchema)) lines.push(`${name}: its arguments changed`);
    if (was.rule !== tool.rule) lines.push(`${name}: now counts as ${tool.rule === "read" ? "reading" : "writing"}`);
  }
  return lines;
}

class SignIn {
  listener: LoopbackListener | null = null;
  cancelled: string | null = null;
  done!: Promise<ConnectionView>;
  cancel(reason = "the sign-in was cancelled"): void {
    this.cancelled = reason;
    this.listener?.cancel(reason);
  }
  check(): void {
    if (this.cancelled) throw new SignInError(this.cancelled, "cancelled");
  }
}

export class Connections {
  private records = new Map<string, ConnectionRecord>();
  private sessions = new Map<string, McpSession>();
  private refreshing = new Map<string, Promise<TokenSet>>();
  private signIns = new Map<string, SignIn>();
  private readonly now: () => number;
  private verified = new Set<string>();

  private readonly catalog: readonly CatalogEntry[];
  private own = new Map<string, OwnSystem>();

  constructor(private readonly options: ConnectionsOptions) {
    this.now = options.now ?? Date.now;
    this.catalog = options.catalog ?? CATALOG;
    const path = join(options.dataDir, CONNECTIONS_FILE);
    if (existsSync(path)) {
      const file = JSON.parse(readFileSync(path, "utf8")) as Partial<FileShape>;
      for (const own of Array.isArray(file.own) ? file.own : []) {
        if (!own || typeof own.id !== "string" || !CONNECTION_ID.test(own.id) || this.entry(own.id) || typeof own.name !== "string") continue;
        if ("mcpUrl" in own && typeof own.mcpUrl === "string" && URL.canParse(own.mcpUrl)) this.own.set(own.id, own);
        else if ("launch" in own) {
          try { this.own.set(own.id, { ...own, launch: checkLaunch(own.launch ?? {}), env: checkEnvNames(own.env) }); } catch { }
        }
      }
      for (const record of Array.isArray(file.connections) ? file.connections : []) {
        if (record && typeof record.id === "string" && this.entry(record.id)) this.records.set(record.id, record);
      }
    }
  }

  private entry(id: string): System | undefined {
    const row = this.catalog.find((entry) => entry.id === id);
    if (row) return { ...row, own: false };
    const own = this.own.get(id);
    if (!own) return undefined;
    if ("launch" in own) return { id: own.id, name: own.name, blurb: commandLine(own.launch), group: "own", launch: own.launch, env: own.env, own: true };
    return { id: own.id, name: own.name, blurb: new URL(own.mcpUrl).host, group: "own", mcpUrl: own.mcpUrl, own: true };
  }

  private systems(): System[] {
    return [...this.own.keys(), ...this.catalog.map((entry) => entry.id)].map((id) => this.entry(id)!);
  }

  private save(): void {
    const file: FileShape = { version: 1, connections: [...this.records.values()], own: [...this.own.values()] };
    writeFileAtomic(join(this.options.dataDir, CONNECTIONS_FILE), JSON.stringify(file, null, 2) + "\n");
    this.options.changed?.();
  }

  private vault(): Vault {
    const vault = this.options.vault();
    if (!vault) throw new ConnectionError("the vault cannot be opened on this computer, so no connection can keep its access", "failed");
    return vault;
  }

  private secret<T>(id: string, part: SecretPart): T | null {
    const raw = this.options.vault()?.get(`connections.${id}.${part}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  private setSecret(id: string, part: SecretPart, value: unknown): void {
    if (value === null) this.options.vault()?.set(`connections.${id}.${part}`, "");
    else this.vault().set(`connections.${id}.${part}`, JSON.stringify(value));
  }


  view(): ConnectionView[] {
    return this.systems().map((entry) => {
      const record = this.records.get(entry.id);
      const base = {
        id: entry.id, name: entry.name, blurb: entry.blurb, group: entry.group,
        ...(entry.mark ? { mark: { url: `/connection-logos/${entry.id}.svg`, hex: entry.mark.hex } } : {}),
        ...(entry.own && entry.mcpUrl ? { url: entry.mcpUrl } : {}),
        ...(entry.mcpUrl ? { address: entry.mcpUrl } : {}),
        ...(entry.launch ? { command: commandLine(entry.launch), env: [...entry.env!], envReady: this.missingEnv(entry.id).length === 0 } : {}),
      };
      if (this.signIns.has(entry.id)) return { ...base, state: "signing-in" as const };
      if (!record) return { ...base, state: "not-connected" as const };
      return {
        ...base,
        state: record.state,
        connectedAt: record.connectedAt,
        access: record.auth ? "sign-in" as const : entry.launch && entry.env?.length ? "keys" as const : "none" as const,
        server: record.server?.name,
        tools: record.tools.map((t) => ({ name: t.name, ...(t.title ? { title: t.title } : {}), rule: t.rule })),
        offInRooms: [...record.offInRooms],
        ...(record.state === "changed" && record.pending ? { changes: describeChanges(record.tools, record.pending.tools) } : {}),
      };
    });
  }

  inRoom(roomId: string): { id: string; name: string; state: ConnectionState }[] {
    return [...this.records.values()]
      .filter((r) => !r.offInRooms.includes(roomId))
      .map((r) => ({ id: r.id, name: this.entry(r.id)!.name, state: r.state }));
  }

  tools(roomId: string): { name: string; connection: string; tool: PinnedTool }[] {
    const out: { name: string; connection: string; tool: PinnedTool }[] = [];
    for (const record of this.records.values()) {
      if (record.state !== "connected" || record.offInRooms.includes(roomId)) continue;
      for (const tool of record.tools) out.push({ name: `${record.id}.${tool.name}`, connection: record.id, tool });
    }
    return out;
  }

  resolve(roomId: string, fullName: string): { record: ConnectionRecord; tool: PinnedTool } {
    const dot = fullName.indexOf(".");
    const id = dot > 0 ? fullName.slice(0, dot) : fullName;
    const entry = this.entry(id);
    const record = this.records.get(id);
    if (!entry) throw new ConnectionError(`"${id}" is not a connection viberoom knows`, "unknown-tool");
    if (!record) throw new ConnectionError(`${entry.name} is not connected`, "not-connected");
    if (record.offInRooms.includes(roomId)) throw new ConnectionError(`${entry.name} is turned off in this room`, "off-in-room");
    if (record.state === "reconnect") throw new ConnectionError(`${entry.name} needs a new sign-in`, "reconnect");
    if (record.state === "changed") throw new ConnectionError(`${entry.name} changed its tools; the human must look before they run again`, "changed");
    const tool = record.tools.find((t) => t.name === fullName.slice(dot + 1));
    if (dot <= 0 || !tool) throw new ConnectionError(`${entry.name} has no tool "${fullName.slice(dot + 1)}"`, "unknown-tool");
    return { record, tool };
  }


  setRoom(id: string, roomId: string, on: boolean): void {
    const record = this.records.get(id);
    if (!record) throw new ConnectionError(`${this.entry(id)?.name ?? id} is not connected`, "not-connected");
    const off = new Set(record.offInRooms);
    if (on) off.delete(roomId); else off.add(roomId);
    record.offInRooms = [...off];
    this.save();
  }

  acceptChanges(id: string): void {
    const record = this.records.get(id);
    if (!record?.pending) return;
    record.tools = record.pending.tools;
    record.toolsHash = record.pending.toolsHash;
    delete record.pending;
    record.state = "connected";
    this.save();
  }

  findByUrl(raw: string): string | undefined {
    const href = this.address(raw).href;
    return this.systems().find((entry) => entry.mcpUrl && new URL(entry.mcpUrl).href === href)?.id;
  }

  findByLaunch(launch: LocalLaunch): string | undefined {
    const checked = checkLaunch(launch);
    return this.systems().find((entry) => entry.launch && sameLaunch(entry.launch, checked))?.id;
  }

  private address(raw: string): URL {
    return (this.options.checkAddress ?? checkOutbound)(raw.trim());
  }

  addOwn(name: string, raw: string): string {
    const url = this.address(raw);
    const known = this.findByUrl(url.href);
    if (known) return known;
    const { id, label } = this.ownName(name);
    this.own.set(id, { id, name: label, mcpUrl: url.href, addedAt: new Date(this.now()).toISOString() });
    this.save();
    return id;
  }

  addOwnLocal(name: string, launch: LocalLaunch, env: readonly string[] = []): string {
    const checked = checkLaunch(launch);
    const names = checkEnvNames(env);
    const known = this.findByLaunch(checked);
    if (known) return known;
    const { id, label } = this.ownName(name);
    this.own.set(id, { id, name: label, launch: checked, env: names, addedAt: new Date(this.now()).toISOString() });
    this.save();
    return id;
  }

  private ownName(name: string): { id: string; label: string } {
    const label = name.trim().replace(/\s+/g, " ");
    if (!label || label.length > 60) throw new ConnectionError("a server needs a name of 1 to 60 characters", "failed");
    const reserved = new Set<string>([...OPERATIONS.map((operation) => operation.name), ...KEYED_SYSTEMS.map((entry) => entry.id)]);
    return { id: ownConnectionId(label, (candidate) => reserved.has(candidate) || this.entry(candidate) !== undefined), label };
  }

  missingEnv(id: string): string[] {
    const saved = new Set(this.savedEnv(id));
    return (this.entry(id)?.env ?? []).filter((name) => !saved.has(name));
  }

  savedEnv(id: string): string[] {
    const entry = this.entry(id);
    if (!entry?.env?.length) return [];
    const values = this.secret<Record<string, string>>(id, "env") ?? {};
    return entry.env.filter((name) => !!values[name]);
  }

  async setEnv(id: string, values: Record<string, unknown>): Promise<void> {
    const entry = this.entry(id);
    if (!entry?.launch) throw new ConnectionError(`${entry?.name ?? id} is not a local server`, "unknown-tool");
    const kept = this.secret<Record<string, string>>(id, "env") ?? {};
    const next: Record<string, string> = {};
    for (const name of entry.env ?? []) {
      const value = typeof values[name] === "string" ? (values[name] as string).trim() : "";
      if (value.length > 8_000 || /[\u0000\r\n]/.test(value)) throw new ConnectionError(`the value of ${name} must be one line`, "failed");
      if (value || kept[name]) next[name] = value || kept[name];
    }
    this.setSecret(id, "env", next);
    await this.sessions.get(id)?.close();
  }

  async removeOwn(id: string): Promise<{ revoked: boolean | null }> {
    if (!this.own.has(id)) throw new ConnectionError(`"${id}" is not a server you added`, "unknown-tool");
    const result = await this.disconnect(id);
    this.own.delete(id);
    this.save();
    return result;
  }

  async disconnect(id: string): Promise<{ revoked: boolean | null }> {
    this.signIns.get(id)?.cancel("the connection was removed");
    const record = this.records.get(id);
    if (!record) return { revoked: null };
    const client = this.secret<ClientRegistration>(id, "client");
    const tokens = this.secret<TokenSet>(id, "tokens");
    let revoked: boolean | null = record.auth ? false : null;
    if (record.auth && client && tokens) revoked = await revokeTokens(record.auth, client, tokens, this.options.fetch).catch(() => false);
    await this.sessions.get(id)?.close();
    this.sessions.delete(id);
    this.setSecret(id, "tokens", null);
    this.setSecret(id, "client", null);
    this.setSecret(id, "env", null);
    this.records.delete(id);
    this.save();
    return { revoked };
  }


  signingIn(id: string): Promise<ConnectionView> | null {
    return this.signIns.get(id)?.done ?? null;
  }

  cancelSignIn(id: string): void {
    this.signIns.get(id)?.cancel();
  }

  connect(id: string): Promise<ConnectionView> {
    const entry = this.entry(id);
    if (!entry) return Promise.reject(new ConnectionError(`"${id}" is not a connection viberoom knows`, "unknown-tool"));
    const running = this.signIns.get(id);
    if (running) return running.done;
    const signIn = new SignIn();
    this.signIns.set(id, signIn);
    this.options.changed?.();
    signIn.done = (async () => {
      try {
        const known = this.records.get(id);
        const record: ConnectionRecord = {
          id, ...(entry.mcpUrl ? { url: entry.mcpUrl } : {}), auth: null, state: "connected", connectedAt: new Date(this.now()).toISOString(),
          tools: [], toolsHash: "", offInRooms: known?.offInRooms ?? [], port: 0,
        };
        await this.sessions.get(id)?.close();
        this.sessions.delete(id);
        let listed: McpTool[] | null = null;
        if (entry.launch) {
          const missing = this.missingEnv(id);
          if (missing.length) throw new ConnectionError(`${entry.name} needs ${missing.join(", ")} before it can start`, "failed");
          listed = await this.session(record).listTools();
        } else {
          let door = await this.door(entry.mcpUrl!);
          signIn.check();
          if (door.open) {
            try { listed = await this.session(record).listTools(); } catch (error) {
              if (!(error instanceof McpAuthRequired)) throw error;
              await this.sessions.get(id)?.close();
              this.sessions.delete(id);
              door = { open: false, ...error.challenge };
            }
          }
          if (!door.open) {
            const signedIn = await this.signIn(id, entry, signIn, door);
            record.auth = signedIn.auth;
            record.port = signedIn.port;
            listed = await this.session(record).listTools();
          }
        }
        signIn.check();
        const tools = pinTools(listed!, !entry.own);
        record.tools = tools;
        record.toolsHash = toolsHash(tools);
        record.server = this.session(record).serverInfo;
        this.records.set(id, record);
        this.verified.add(id);
      } finally {
        signIn.listener?.cancel();
        this.signIns.delete(id);
      }
      this.save();
      return this.view().find((v) => v.id === id)!;
    })();
    signIn.done.catch(() => this.options.changed?.());
    return signIn.done;
  }

  private async signIn(id: string, entry: System, signIn: SignIn, challenge: { resourceMetadata?: string; scope?: string }): Promise<{ auth: ServerAuth; port: number }> {
    this.vault();
    const auth = await discover(entry.mcpUrl!, this.options.fetch, challenge);
    signIn.check();
    let client = this.secret<ClientRegistration>(id, "client");
    if (client && client.issuer !== auth.issuer) client = null;
    const state = newState();
    const expected = { state, issuer: auth.issuer, issRequired: auth.issParameter };
    let listener: LoopbackListener;
    try {
      listener = await LoopbackListener.open(client ? Number(new URL(client.redirectUri).port) : 0, expected);
    } catch {
      client = null;
      listener = await LoopbackListener.open(0, expected);
    }
    signIn.listener = listener;
    signIn.check();
    if (!client) {
      client = await register(auth, listener.redirectUri, this.options.fetch);
      this.setSecret(id, "client", client);
    }
    signIn.check();
    const pkce = makePkce();
    this.options.openBrowser(authorizeUrl(auth, client, state, pkce));
    const code = await listener.result;
    const tokens = await exchangeCode(auth, client, code, pkce, this.options.fetch, this.now);
    this.setSecret(id, "tokens", tokens);
    return { auth, port: listener.port };
  }

  private async door(mcpUrl: string): Promise<{ open: true } | { open: false; resourceMetadata?: string; scope?: string }> {
    try {
      const res = await this.options.fetch(mcpUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "viberoom", version: this.options.clientVersion } } }),
        signal: AbortSignal.timeout(15_000),
      });
      await res.body?.cancel();
      if (res.ok) return { open: true };
      return { open: false, ...(res.status === 401 ? parseChallenge(res.headers.get("www-authenticate")) : {}) };
    } catch {
      return { open: false };
    }
  }


  private async accessToken(record: ConnectionRecord, refused?: { token: string | null }): Promise<string | null> {
    if (!record.auth) {
      if (!refused) return null;
      this.markReconnect(record);
      throw new ConnectionError(`${this.entry(record.id)!.name} now asks for a sign-in; connect it again`, "reconnect");
    }
    const tokens = this.secret<TokenSet>(record.id, "tokens");
    if (!tokens) { this.markReconnect(record); throw new ConnectionError(`${this.entry(record.id)!.name} has no access on this computer`, "reconnect"); }
    const fresh = tokens.expiresAt === undefined || tokens.expiresAt - 60_000 > this.now();
    if (fresh && (!refused || refused.token !== tokens.accessToken)) return tokens.accessToken;
    return (await this.refresh(record, tokens)).accessToken;
  }

  private refresh(record: ConnectionRecord, tokens: TokenSet): Promise<TokenSet> {
    const running = this.refreshing.get(record.id);
    if (running) return running;
    const next = (async () => {
      const client = this.secret<ClientRegistration>(record.id, "client");
      if (!tokens.refreshToken || !client || !record.auth) { this.markReconnect(record); throw new ConnectionError(`${this.entry(record.id)!.name} gave no way to renew its access`, "reconnect"); }
      try {
        const renewed = await refreshTokens(record.auth, client, tokens.refreshToken, this.options.fetch, this.now);
        this.setSecret(record.id, "tokens", renewed);
        return renewed;
      } catch (error) {
        if (error instanceof SignInError && error.kind === "reconnect") {
          this.markReconnect(record);
          throw new ConnectionError(`${this.entry(record.id)!.name} no longer accepts viberoom's access; sign in again`, "reconnect");
        }
        throw error;
      }
    })().finally(() => this.refreshing.delete(record.id));
    this.refreshing.set(record.id, next);
    return next;
  }

  private markReconnect(record: ConnectionRecord): void {
    if (record.state === "reconnect") return;
    record.state = "reconnect";
    this.save();
  }

  private session(record: ConnectionRecord): McpSession {
    let session = this.sessions.get(record.id);
    if (session) return session;
    const entry = this.entry(record.id)!;
    if (entry.launch) {
      session = new McpLocal(entry.launch, {
        clientVersion: this.options.clientVersion,
        cwd: join(this.options.dataDir, "connections", record.id),
        env: () => this.secret<Record<string, string>>(record.id, "env") ?? {},
        ...this.options.local,
      });
    } else {
      session = new McpRemote(entry.mcpUrl!, {
        fetch: this.options.fetch,
        clientVersion: this.options.clientVersion,
        token: () => this.accessToken(record),
        refused: async (_challenge, token) => { await this.accessToken(record, { token }); return true; },
      });
    }
    this.sessions.set(record.id, session);
    return session;
  }


  async verifyTools(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record || record.state !== "connected") return;
    const tools = pinTools(await this.withAuth(record, (session) => session.listTools()), !this.entry(id)!.own);
    const hash = toolsHash(tools);
    if (hash === record.toolsHash) return;
    record.pending = { tools, toolsHash: hash, seenAt: new Date(this.now()).toISOString() };
    record.state = "changed";
    this.save();
    throw new ConnectionError(`${this.entry(id)!.name} changed its tools; the human must look before they run again`, "changed");
  }

  async call(roomId: string, fullName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const { record, tool } = this.resolve(roomId, fullName);
    if (!this.verified.has(record.id)) {
      await this.verifyTools(record.id);
      this.verified.add(record.id);
    }
    return this.withAuth(record, (session) => session.callTool(tool.name, args));
  }

  private async withAuth<T>(record: ConnectionRecord, run: (session: McpSession) => Promise<T>): Promise<T> {
    try {
      return await run(this.session(record));
    } catch (error) {
      if (error instanceof McpAuthRequired) {
        if (!error.insufficientScope) this.markReconnect(record);
        throw new ConnectionError(error.insufficientScope
          ? `${this.entry(record.id)!.name} wants more access for this; sign in again to grant it`
          : `${this.entry(record.id)!.name} no longer accepts viberoom's access; sign in again`, "reconnect");
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    for (const signIn of this.signIns.values()) signIn.cancel("viberoom is closing");
    await Promise.all([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
  }
}
