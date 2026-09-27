// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { OutboundRefused } from "./outbound.js";

export class SignInError extends Error {
  constructor(message: string, readonly kind: "failed" | "reconnect" | "cancelled" = "failed") { super(message); }
}


export interface ServerAuth {
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  revocationEndpoint?: string;
  issParameter: boolean;
  tokenAuthMethods: string[];
  scopes: string[];
}

const JSON_ACCEPT = { accept: "application/json" };

async function readJson(fetcher: typeof fetch, url: string, what: string): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetcher(url, { headers: JSON_ACCEPT, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (error instanceof OutboundRefused) throw error;
    throw new SignInError(`${what} could not be reached (${new URL(url).host})`);
  }
  if (res.status === 404 || res.status === 405) { await res.body?.cancel(); return null; }
  if (!res.ok) { await res.body?.cancel(); throw new SignInError(`${what} answered ${res.status} (${new URL(url).host})`); }
  try {
    const body = await res.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    throw new SignInError(`${what} is not JSON (${new URL(url).host})`);
  }
}

function wellKnown(base: string, suffix: string): string[] {
  const url = new URL(base);
  const path = url.pathname.replace(/\/$/, "");
  return path ? [`${url.origin}/.well-known/${suffix}${path}`, `${url.origin}/.well-known/${suffix}`] : [`${url.origin}/.well-known/${suffix}`];
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export function parseChallenge(header: string | null): { resourceMetadata?: string; scope?: string } {
  if (!header || !/^\s*bearer\b/i.test(header)) return {};
  const param = (name: string) => header.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1];
  return { resourceMetadata: param("resource_metadata"), scope: param("scope") };
}

export function sameIssuer(a: string, b: string): boolean {
  if (a === b) return true;
  const bare = (s: string): string => (s.endsWith("/") ? s.slice(0, -1) : s);
  if (bare(a) !== bare(b)) return false;
  try {
    const url = new URL(bare(a) + "/");
    return url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash && `${url.origin}/` === bare(a) + "/";
  } catch {
    return false;
  }
}

export async function discover(mcpUrl: string, fetcher: typeof fetch, challenge: { resourceMetadata?: string; scope?: string } = {}): Promise<ServerAuth> {
  const candidates = challenge.resourceMetadata ? [challenge.resourceMetadata] : wellKnown(mcpUrl, "oauth-protected-resource");
  let prm: Record<string, unknown> | null = null;
  for (const url of candidates) if ((prm = await readJson(fetcher, url, "the server's sign-in description"))) break;
  if (!prm) throw new SignInError(`${new URL(mcpUrl).host} does not describe how to sign in (no protected-resource metadata)`);
  const resource = typeof prm.resource === "string" ? prm.resource : "";
  const mcp = new URL(mcpUrl);
  let named: URL;
  try { named = new URL(resource); } catch { throw new SignInError(`${mcp.host} names no resource in its sign-in description`); }
  if (named.origin !== mcp.origin || !mcp.pathname.startsWith(named.pathname.replace(/\/+$/, ""))) {
    throw new SignInError(`${mcp.host} describes a different resource (${resource}); refusing the mix-up`);
  }
  const issuer = strings(prm.authorization_servers)[0];
  if (!issuer) throw new SignInError(`${mcp.host} names no sign-in server`);

  let as: Record<string, unknown> | null = null;
  const issuerUrl = new URL(issuer);
  const asCandidates = [...wellKnown(issuer, "oauth-authorization-server"), ...wellKnown(issuer, "openid-configuration")];
  if (issuerUrl.pathname.replace(/\/$/, "")) asCandidates.push(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  for (const url of [...new Set(asCandidates)]) if ((as = await readJson(fetcher, url, "the sign-in server's description"))) break;
  if (!as) throw new SignInError(`${issuerUrl.host} does not describe its sign-in endpoints`);
  if (typeof as.issuer !== "string" || !sameIssuer(as.issuer, issuer)) throw new SignInError(`${issuerUrl.host} calls itself "${String(as.issuer)}", not "${issuer}"; refusing the mix-up`);
  if (!strings(as.code_challenge_methods_supported).includes("S256")) {
    throw new SignInError(`${issuerUrl.host} does not offer PKCE with S256, which the MCP specification requires`);
  }
  const authorizationEndpoint = typeof as.authorization_endpoint === "string" ? as.authorization_endpoint : "";
  const tokenEndpoint = typeof as.token_endpoint === "string" ? as.token_endpoint : "";
  if (!authorizationEndpoint || !tokenEndpoint) throw new SignInError(`${issuerUrl.host} names no sign-in or token endpoint`);

  const scopes = challenge.scope ? challenge.scope.split(/\s+/).filter(Boolean) : strings(prm.scopes_supported);
  if (strings(as.scopes_supported).includes("offline_access") && !scopes.includes("offline_access")) scopes.push("offline_access");

  return {
    resource,
    issuer: as.issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: typeof as.registration_endpoint === "string" ? as.registration_endpoint : undefined,
    revocationEndpoint: typeof as.revocation_endpoint === "string" ? as.revocation_endpoint : undefined,
    issParameter: as.authorization_response_iss_parameter_supported === true,
    tokenAuthMethods: strings(as.token_endpoint_auth_methods_supported).length ? strings(as.token_endpoint_auth_methods_supported) : ["client_secret_basic"],
    scopes,
  };
}


export interface ClientRegistration {
  clientId: string;
  clientSecret?: string;
  authMethod: "none" | "client_secret_basic" | "client_secret_post";
  redirectUri: string;
  issuer: string;
}

export async function register(auth: ServerAuth, redirectUri: string, fetcher: typeof fetch): Promise<ClientRegistration> {
  if (!auth.registrationEndpoint) throw new SignInError(`${new URL(auth.issuer).host} does not let a new program register itself`);
  const methods = auth.tokenAuthMethods;
  const authMethod: ClientRegistration["authMethod"] = methods.includes("none") ? "none"
    : methods.includes("client_secret_basic") ? "client_secret_basic" : methods.includes("client_secret_post") ? "client_secret_post" : "none";
  let res: Response;
  try {
    res = await fetcher(auth.registrationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...JSON_ACCEPT },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        client_name: "viberoom",
        application_type: "native",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: authMethod,
        ...(auth.scopes.length ? { scope: auth.scopes.join(" ") } : {}),
      }),
    });
  } catch (error) {
    if (error instanceof OutboundRefused) throw error;
    throw new SignInError(`the registration at ${new URL(auth.registrationEndpoint).host} could not be reached`);
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || typeof body.client_id !== "string" || !body.client_id) {
    const reason = typeof body.error_description === "string" ? body.error_description : typeof body.error === "string" ? body.error : `status ${res.status}`;
    throw new SignInError(`${new URL(auth.issuer).host} refused to register viberoom: ${reason}`);
  }
  const clientSecret = typeof body.client_secret === "string" && body.client_secret ? body.client_secret : undefined;
  const granted = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : authMethod;
  const method: ClientRegistration["authMethod"] = granted === "client_secret_post" ? "client_secret_post" : granted === "none" || !clientSecret ? "none" : "client_secret_basic";
  return { clientId: body.client_id, clientSecret, authMethod: method, redirectUri, issuer: auth.issuer };
}


const base64url = (bytes: Buffer) => bytes.toString("base64url");

export interface Pkce { verifier: string; challenge: string }
export function makePkce(): Pkce {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

export function authorizeUrl(auth: ServerAuth, client: ClientRegistration, state: string, pkce: Pkce): string {
  const url = new URL(auth.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", client.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", auth.resource);
  if (auth.scopes.length) url.searchParams.set("scope", auth.scopes.join(" "));
  return url.href;
}

const equal = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const PAGE = (title: string, line: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title>`
  + `<body style="font:16px system-ui;margin:4em auto;max-width:32em;color:#333"><h1 style="font-size:1.3em">${title}</h1><p>${line}</p></body>`;

export class LoopbackListener {
  private server: Server | null = null;
  private settle: { resolve: (code: string) => void; reject: (error: Error) => void } | null = null;
  readonly result: Promise<string>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  port = 0;

  private constructor(private readonly expected: { state: string; issuer: string; issRequired: boolean }) {
    this.result = new Promise<string>((resolve, reject) => { this.settle = { resolve, reject }; });
    this.result.catch(() => undefined);
  }

  get redirectUri(): string { return `http://127.0.0.1:${this.port}/callback`; }

  static async open(port: number, expected: { state: string; issuer: string; issRequired: boolean }, timeoutMs = 10 * 60_000): Promise<LoopbackListener> {
    const listener = new LoopbackListener(expected);
    const server = createServer((req, res) => listener.handle(req.url ?? "", res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    listener.server = server;
    listener.port = (server.address() as AddressInfo).port;
    listener.timer = setTimeout(() => listener.finish(new SignInError("the sign-in was not finished within ten minutes", "cancelled")), timeoutMs);
    listener.timer.unref?.();
    return listener;
  }

  private handle(raw: string, res: import("node:http").ServerResponse): void {
    const url = new URL(raw, "http://127.0.0.1");
    const answer = (status: number, title: string, line: string) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
      res.end(PAGE(title, line));
    };
    if (url.pathname !== "/callback" || !this.settle) { answer(404, "Not here", "This address only finishes a viberoom sign-in."); return; }
    const state = url.searchParams.get("state") ?? "";
    if (!equal(state, this.expected.state)) { answer(400, "Not this sign-in", "This answer belongs to another sign-in. Start again from viberoom."); return; }
    const iss = url.searchParams.get("iss");
    if (iss !== null ? iss !== this.expected.issuer : this.expected.issRequired) {
      answer(400, "Sign-in refused", "The answer did not come from the system viberoom asked. Nothing was connected.");
      this.finish(new SignInError(`the answer came from "${iss ?? "an unnamed server"}", not from ${this.expected.issuer}; nothing was connected`));
      return;
    }
    const error = url.searchParams.get("error");
    if (error) {
      const denied = error === "access_denied";
      answer(200, denied ? "Not connected" : "Sign-in failed", denied ? "You declined; nothing was connected. You can close this tab." : "The system refused the sign-in. You can close this tab.");
      const detail = url.searchParams.get("error_description");
      this.finish(new SignInError(denied ? "the access was declined" : `the system refused the sign-in: ${detail ?? error}`, denied ? "cancelled" : "failed"));
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) { answer(400, "Sign-in failed", "The answer carried no code. Start again from viberoom."); this.finish(new SignInError("the answer carried no code")); return; }
    answer(200, "Connected", "viberoom has the access. You can close this tab and go back to the room.");
    this.finish(null, code);
  }

  cancel(reason = "the sign-in was cancelled"): void { this.finish(new SignInError(reason, "cancelled")); }

  private finish(error: Error | null, code?: string): void {
    const settle = this.settle;
    this.settle = null;
    if (this.timer) clearTimeout(this.timer);
    this.server?.close();
    this.server?.closeAllConnections?.();
    if (!settle) return;
    if (error) settle.reject(error); else settle.resolve(code!);
  }
}


export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

async function tokenRequest(auth: ServerAuth, client: ClientRegistration, form: Record<string, string>, fetcher: typeof fetch, now: () => number): Promise<TokenSet> {
  const body = new URLSearchParams({ ...form, resource: auth.resource });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", ...JSON_ACCEPT };
  if (client.authMethod === "client_secret_basic" && client.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`).toString("base64")}`;
  } else {
    body.set("client_id", client.clientId);
    if (client.authMethod === "client_secret_post" && client.clientSecret) body.set("client_secret", client.clientSecret);
  }
  let res: Response;
  try {
    res = await fetcher(auth.tokenEndpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    if (error instanceof OutboundRefused) throw error;
    throw new SignInError(`${new URL(auth.tokenEndpoint).host} could not be reached for a token`);
  }
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : "";
    const reconnect = code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client";
    throw new SignInError(`${new URL(auth.issuer).host} refused the token: ${code || `status ${res.status}`}`, reconnect ? "reconnect" : "failed");
  }
  if (typeof json.access_token !== "string" || !json.access_token) throw new SignInError(`${new URL(auth.issuer).host} answered without an access token`);
  if (typeof json.token_type === "string" && json.token_type.toLowerCase() !== "bearer") throw new SignInError(`${new URL(auth.issuer).host} gave a "${json.token_type}" token, not a bearer token`);
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : typeof json.expires_in === "string" ? Number(json.expires_in) : NaN;
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : undefined,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now() + expiresIn * 1000 : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined,
  };
}

export function exchangeCode(auth: ServerAuth, client: ClientRegistration, code: string, pkce: Pkce, fetcher: typeof fetch, now: () => number = Date.now): Promise<TokenSet> {
  return tokenRequest(auth, client, { grant_type: "authorization_code", code, redirect_uri: client.redirectUri, code_verifier: pkce.verifier }, fetcher, now);
}

export async function refreshTokens(auth: ServerAuth, client: ClientRegistration, refreshToken: string, fetcher: typeof fetch, now: () => number = Date.now): Promise<TokenSet> {
  const next = await tokenRequest(auth, client, { grant_type: "refresh_token", refresh_token: refreshToken }, fetcher, now);
  return { ...next, refreshToken: next.refreshToken ?? refreshToken };
}

export async function revokeTokens(auth: ServerAuth, client: ClientRegistration, tokens: TokenSet, fetcher: typeof fetch): Promise<boolean> {
  if (!auth.revocationEndpoint) return false;
  let revoked = true;
  for (const [token, hint] of [[tokens.refreshToken, "refresh_token"], [tokens.accessToken, "access_token"]] as const) {
    if (!token) continue;
    const body = new URLSearchParams({ token, token_type_hint: hint });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    if (client.authMethod === "client_secret_basic" && client.clientSecret) {
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`).toString("base64")}`;
    } else {
      body.set("client_id", client.clientId);
      if (client.authMethod === "client_secret_post" && client.clientSecret) body.set("client_secret", client.clientSecret);
    }
    try {
      const res = await fetcher(auth.revocationEndpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
      await res.body?.cancel();
      revoked &&= res.ok;
    } catch {
      revoked = false;
    }
  }
  return revoked;
}

export const newState = (): string => base64url(randomBytes(24));
