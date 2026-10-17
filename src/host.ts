// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

export type AppKind = "store" | "installer" | "source";

export type AppVia = "flag" | "insideBox";

export type Host = { readonly by: "npm" } | { readonly by: "app"; readonly kind: AppKind | null; readonly via: AppVia };

export const NPM_HOST: Host = { by: "npm" };

export type InsideBox = "installer" | "store";

export function appHost(kind: AppKind | null, via: AppVia): Host {
  return { by: "app", kind, via };
}

export function hostOf(flag: "npm" | "app"): Host {
  return flag === "app" ? appHost(null, "flag") : NPM_HOST;
}

export function runByApp(host: Host): boolean {
  return host.by === "app";
}

export function storeApp(host: Host): boolean {
  return host.by === "app" && host.kind === "store";
}

export function productVersionsFromApp(host: Host): boolean {
  return host.by === "app" && host.via === "flag";
}

export function hostFields(host: Host): { host: Host; insideBox?: InsideBox } {
  if (host.by === "npm") return { host };
  return { host, insideBox: host.kind === "store" ? "store" : "installer" };
}

export function hostFromVersion(said: { host?: unknown; insideBox?: unknown }): Host {
  const reported = said.host as { by?: unknown; kind?: unknown; via?: unknown } | undefined;
  if (reported && reported.by === "npm") return NPM_HOST;
  if (reported && reported.by === "app") {
    const kind = reported.kind === "store" || reported.kind === "installer" || reported.kind === "source" ? reported.kind : null;
    return appHost(kind, reported.via === "insideBox" ? "insideBox" : "flag");
  }
  if (said.insideBox === "store" || said.insideBox === "installer") return appHost(said.insideBox, "insideBox");
  return NPM_HOST;
}
