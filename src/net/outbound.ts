// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { AsyncLocalStorage } from "node:async_hooks";
import { promises as dns, type LookupAddress } from "node:dns";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP, type LookupFunction } from "node:net";
import { Agent, buildConnector, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
import { z } from "zod";

export const KEEP_ALIVE_MS = 60_000;
export const CONNECT_MS = 15_000;
export const REFRESH_AFTER_MS = 60_000;
export const MAX_STALE_MS = 24 * 60 * 60_000;
export const RECHECK_WAIT_MS = 15_000;
export const SAVE_AFTER_MS = 1_000;
export const SLOW_LOOKUP_MS = 2_000;
export const LOG_EVERY_MS = 5 * 60_000;

export interface OutboundLog {
  info(message: string): void;
  warn(message: string): void;
}

export type SystemLookup = (hostname: string, options: { family: number; hints?: number }) => Promise<LookupAddress[]>;

const systemLookup: SystemLookup = (hostname, { family, hints }) =>
  dns.lookup(hostname, { family, all: true, ...(hints !== undefined ? { hints } : {}) });

export interface KnownName {
  hostname: string;
  family: number;
  hints?: number;
  addresses: LookupAddress[];
  at: number;
}

export interface NameStore {
  load(): KnownName[];
  save(names: KnownName[]): void;
}

interface Asking { promise: Promise<LookupAddress[]>; state: { waited: boolean } }

const keyOf = (hostname: string, family: number): string => `${hostname.toLowerCase()} ${family}`;

export class HostCache {
  private readonly known = new Map<string, KnownName>();
  private readonly asking = new Map<string, Asking>();
  private readonly noted = new Map<string, { at: number; skipped: number }>();
  private readonly system: SystemLookup;
  readonly now: () => number;
  private readonly store: NameStore | null;
  private readonly recheckWaitMs: number;
  private readonly saveAfterMs: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly log?: OutboundLog, options: { system?: SystemLookup; now?: () => number; store?: NameStore; recheckWaitMs?: number; saveAfterMs?: number } = {}) {
    this.system = options.system ?? systemLookup;
    this.now = options.now ?? Date.now;
    this.store = options.store ?? null;
    this.recheckWaitMs = options.recheckWaitMs ?? RECHECK_WAIT_MS;
    this.saveAfterMs = options.saveAfterMs ?? SAVE_AFTER_MS;
    if (this.store) this.restore(this.store);
  }

  readonly lookup: LookupFunction = lookupWith((hostname, family, hints) => this.addresses(hostname, family, hints));

  addresses(hostname: string, family = 0, hints?: number): Promise<LookupAddress[]> {
    const key = keyOf(hostname, family);
    const known = this.known.get(key);
    if (!known || this.now() - known.at > MAX_STALE_MS) return this.ask(key, hostname, family, hints, true);
    if (this.now() - known.at >= REFRESH_AFTER_MS) this.ask(key, hostname, family, hints, false).catch(() => {});
    return Promise.resolve(known.addresses);
  }

  async connectionFailed(hostname: string, port: string | number, error: unknown, dial: { at: number; served?: readonly string[]; again?: boolean }): Promise<boolean> {
    const again = dial.again ?? true;
    const said = `no connection to ${hostname}:${port} (${describeNetworkError(error)})`;
    const names = [...this.known.entries()].filter(([, known]) => known.hostname.toLowerCase() === hostname.toLowerCase());
    if (!again || !names.length) {
      this.note(`${hostname} connection`, `${said}${again ? "" : "; the second dial failed too"}`);
      return false;
    }
    const tried = new Set([...triedAddresses(error), ...(dial.served ?? [])]);
    let outcome: "moved" | "same" | "silent" = "same";
    for (const [key, before] of names) {
      const answer = before.at >= dial.at ? before.addresses : await this.recheck(key, before);
      if (!answer) { if (outcome !== "moved") outcome = "silent"; continue; }
      const suspects = tried.size ? tried : new Set(before.addresses.map((a) => a.address));
      const untried = answer.filter((a) => !suspects.has(a.address));
      if (!untried.length) continue;
      const current = this.known.get(key);
      if (current) this.remember(key, { ...current, addresses: [...untried, ...answer.filter((a) => suspects.has(a.address))] });
      outcome = "moved";
    }
    const next = outcome === "moved" ? "the system names another address for it now, and the connection is dialled once more"
      : outcome === "silent" ? "the system's DNS does not answer either, so the hub keeps the address it had"
      : "the system names the same address, which the hub keeps";
    this.note(`${hostname} connection`, `${said}; ${next}`);
    return outcome === "moved";
  }

  connectionRefused(hostname: string, port: string | number, error: Error): void {
    this.note(`${hostname} refused`, `refused a connection to ${hostname}:${port}: ${error.message}`);
  }

  save(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (!this.store) return;
    try { this.store.save([...this.known.values()]); }
    catch (error) { this.note("store write", `the remembered addresses could not be written (${describeNetworkError(error)}); they are kept in memory`); }
  }

  private async recheck(key: string, before: KnownName): Promise<LookupAddress[] | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), this.recheckWaitMs); timer.unref?.(); });
    try {
      return await Promise.race([this.ask(key, before.hostname, before.family, before.hints, true).catch(() => null), late]);
    } finally { clearTimeout(timer); }
  }

  private ask(key: string, hostname: string, family: number, hints: number | undefined, waiting: boolean): Promise<LookupAddress[]> {
    const pending = this.asking.get(key);
    if (pending) {
      pending.state.waited ||= waiting;
      return pending.promise;
    }
    const started = this.now();
    const state = { waited: waiting };
    const promise = this.system(hostname, { family, ...(hints !== undefined ? { hints } : {}) })
      .then((addresses) => {
        if (!addresses.length) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND", hostname });
        this.remember(key, { hostname, family, ...(hints !== undefined ? { hints } : {}), addresses, at: this.now() });
        const ms = this.now() - started;
        if (ms >= SLOW_LOOKUP_MS) {
          const meanwhile = state.waited ? "a connection waited for it" : "meanwhile the hub used the address it had";
          this.note(`${hostname} slow`, `the system's DNS took ${seconds(ms)} to find ${hostname}; ${meanwhile}`, state.waited);
        }
        return addresses;
      }, (error: unknown) => {
        const known = this.known.get(key);
        const kept = !!known && this.now() - known.at <= MAX_STALE_MS;
        if (known && !kept) this.forget(key);
        const after = kept ? "; the hub keeps the address it had" : known ? "; the address it had is older than a day, so it is not used any more" : "";
        this.note(`${hostname} lookup`, `the system's DNS did not find ${hostname} in ${seconds(this.now() - started)} (${describeNetworkError(error)})${after}`);
        throw error;
      })
      .finally(() => { if (this.asking.get(key)?.promise === promise) this.asking.delete(key); });
    this.asking.set(key, { promise, state });
    return promise;
  }

  private remember(key: string, name: KnownName): void {
    this.known.set(key, name);
    this.saveSoon();
  }

  private forget(key: string): void {
    if (this.known.delete(key)) this.saveSoon();
  }

  private saveSoon(): void {
    if (!this.store || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.save(), this.saveAfterMs);
    this.saveTimer.unref?.();
  }

  private restore(store: NameStore): void {
    let names: KnownName[];
    try { names = store.load(); }
    catch (error) {
      this.note("store read", `the remembered addresses could not be read (${describeNetworkError(error)}); every name is asked anew`);
      return;
    }
    for (const name of names) if (this.now() - name.at <= MAX_STALE_MS) this.known.set(keyOf(name.hostname, name.family), name);
  }

  private note(kind: string, message: string, warn = true): void {
    if (!this.log) return;
    const now = this.now();
    const last = this.noted.get(kind);
    if (last && now - last.at < LOG_EVERY_MS) { last.skipped++; return; }
    this.noted.set(kind, { at: now, skipped: 0 });
    const line = `${message}${last?.skipped ? ` (${last.skipped} more like it since ${clock(last.at)})` : ""}`;
    if (warn) this.log.warn(line); else this.log.info(line);
  }
}

export type Admit = (address: string, hostname: string) => Error | undefined;

const refusals = new WeakSet<Error>();

interface Dialling { served: string[] }
const dialling = new AsyncLocalStorage<Dialling>();

export function outboundDispatcher(hosts: HostCache | (() => HostCache), options: { connectMs?: number; keepAliveMs?: number; admit?: Admit } = {}): Dispatcher {
  const names = typeof hosts === "function" ? hosts : () => hosts;
  const { admit } = options;
  const find = admit
    ? async (hostname: string, family: number, hints?: number) => {
      const addresses = await names().addresses(hostname, family, hints);
      for (const { address } of addresses) {
        const refused = admit(address, hostname);
        if (refused) { refusals.add(refused); throw refused; }
      }
      return addresses;
    }
    : (hostname: string, family: number, hints?: number) => names().addresses(hostname, family, hints);
  const dial = buildConnector({ timeout: options.connectMs ?? CONNECT_MS, lookup: lookupWith(find) });
  const connect: buildConnector.connector = (target, callback) => {
    const port = target.port || (target.protocol === "https:" ? 443 : 80);
    const literal = target.hostname.replace(/^\[|\]$/g, "");
    const refused = admit && isIP(literal) ? admit(literal, literal) : undefined;
    if (refused) {
      names().connectionRefused(target.hostname, port, refused);
      callback(refused, null);
      return;
    }
    const at = names().now();
    const first: Dialling = { served: [] };
    dialling.run(first, () => dial(target, (...args) => {
      const [error] = args;
      if (!error) return callback(...args);
      if (refusals.has(error)) {
        names().connectionRefused(target.hostname, port, error);
        return callback(...args);
      }
      void names().connectionFailed(target.hostname, port, error, { at, served: first.served }).then((again) => {
        if (!again) return callback(...args);
        const second: Dialling = { served: [] };
        dialling.run(second, () => dial(target, (...retried) => {
          const [failed] = retried;
          if (failed && refusals.has(failed)) names().connectionRefused(target.hostname, port, failed);
          else if (failed) void names().connectionFailed(target.hostname, port, failed, { at, served: second.served, again: false });
          callback(...retried);
        }));
      });
    }));
  };
  const dispatcher = new Agent({ connect, keepAliveTimeout: options.keepAliveMs ?? KEEP_ALIVE_MS });
  ours.add(dispatcher);
  return dispatcher;
}

const ours = new WeakSet<Dispatcher>();
let installedHosts: HostCache | null = null;

export function admittedDispatcher(admit: Admit): Dispatcher {
  const current = getGlobalDispatcher();
  if (nodeProxy(current)) return current;
  const standalone = new HostCache();
  return outboundDispatcher(() => installedHosts ?? standalone, { admit });
}

export const ADMITTED_DEADLINE_MS = 60_000;

export function admittedFetch(admit: Admit): typeof fetch {
  const dispatcher = admittedDispatcher(admit);
  return (input, init) => fetch(input, Object.assign({}, init, { signal: init?.signal ?? AbortSignal.timeout(ADMITTED_DEADLINE_MS), dispatcher }));
}

function lookupWith(find: (hostname: string, family: number, hints?: number) => Promise<LookupAddress[]>): LookupFunction {
  return (hostname, options, callback) => {
    const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : Number(options.family ?? 0);
    const dial = dialling.getStore();
    find(hostname, family, options.hints).then(
      (addresses) => {
        const handed = options.all ? addresses : addresses.slice(0, 1);
        dial?.served.push(...handed.map((a) => a.address));
        if (options.all) callback(null, addresses); else callback(null, addresses[0].address, addresses[0].family);
      },
      (error: NodeJS.ErrnoException) => callback(error, ""),
    );
  };
}

function nodeProxy(dispatcher: Dispatcher): boolean {
  return dispatcher.constructor.name === "EnvHttpProxyAgent";
}

export function installOutbound(log: OutboundLog, options: { system?: SystemLookup; store?: NameStore } = {}): Dispatcher {
  const current = getGlobalDispatcher();
  if (ours.has(current)) return current;
  if (nodeProxy(current)) {
    log.info("requests go out through the proxy Node set up from the environment (NODE_USE_ENV_PROXY); the proxy looks the names up");
    return current;
  }
  const hosts = new HostCache(log, options);
  const dispatcher = outboundDispatcher(hosts);
  installedHosts = hosts;
  setGlobalDispatcher(dispatcher);
  return dispatcher;
}

export function saveOutboundNames(): void {
  installedHosts?.save();
}

const STORED = z.object({
  version: z.literal(1),
  names: z.array(z.object({
    hostname: z.string().min(1),
    family: z.number().int(),
    hints: z.number().int().optional(),
    addresses: z.array(z.object({ address: z.string().refine((a) => isIP(a) !== 0, "an IP address"), family: z.number().int() })).min(1),
    at: z.number(),
  })),
});

export function fileNameStore(path: string): NameStore {
  return {
    load() {
      let text: string;
      try { text = readFileSync(path, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
      return STORED.parse(JSON.parse(text)).names.map(({ hints, ...name }) => ({ ...name, ...(hints !== undefined ? { hints } : {}) }));
    },
    save(names) {
      const next = `${path}.next`;
      writeFileSync(next, `${JSON.stringify({ version: 1, names }, null, 1)}\n`, { mode: 0o600 });
      renameSync(next, path);
    },
  };
}

function triedAddresses(error: unknown): string[] {
  const found = new Set<string>();
  const visit = (link: unknown, depth: number): void => {
    if (!link || typeof link !== "object" || depth > 4) return;
    const { address, errors, cause } = link as { address?: unknown; errors?: unknown; cause?: unknown };
    if (typeof address === "string" && isIP(address)) found.add(address);
    if (Array.isArray(errors)) for (const inner of errors) visit(inner, depth + 1);
    visit(cause, depth + 1);
  };
  visit(error, 0);
  return [...found];
}

export function describeNetworkError(error: unknown): string {
  const chain: string[] = [];
  let link: unknown = error;
  for (let depth = 0; link != null && depth < 6; depth++) {
    const { code, message, cause } = link as { code?: unknown; message?: unknown; cause?: unknown };
    const text = typeof message === "string" ? message : typeof link === "object" ? "" : String(link);
    chain.push(typeof code === "string" && !text.includes(code) ? (text ? `${code}: ${text}` : code) : text);
    link = typeof link === "object" ? cause : undefined;
  }
  const top = chain[0] || String(error);
  const deepest = chain.slice(1).reverse().find((said) => said && !top.includes(said));
  return deepest ? `${top} (${deepest})` : top;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function clock(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}
