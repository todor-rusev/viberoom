// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type StaticDir = "ui" | "assets" | "node_modules" | "vendor";

export const STATIC_FILES: Record<string, { file: string; type: string; dir?: StaticDir }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styleguide": { file: "styleguide.html", type: "text/html; charset=utf-8" },
  "/guide": { file: "guide.html", type: "text/html; charset=utf-8" },
  "/manifest.json": { file: "manifest.json", type: "application/manifest+json; charset=utf-8" },
  "/icon.svg": { file: "icon.svg", type: "image/svg+xml", dir: "assets" },
  "/icon-256.png": { file: "icon-256.png", type: "image/png", dir: "assets" },
  "/icon-512.png": { file: "icon-512.png", type: "image/png", dir: "assets" },
  "/favicon.ico": { file: "icon.ico", type: "image/x-icon", dir: "assets" },
  "/vendor-icons/claude.svg": { file: "vendors/claude.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor-icons/codex.svg": { file: "vendors/codex.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor-icons/gemini.svg": { file: "vendors/gemini.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor-icons/cursor.svg": { file: "vendors/cursor.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor-icons/opencode.svg": { file: "vendors/opencode.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor-icons/copilot.svg": { file: "vendors/copilot.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor-icons/grok.svg": { file: "vendors/grok.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor-icons/hermes.svg": { file: "vendors/hermes.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor/marked.umd.js": { file: "marked/lib/marked.umd.js", type: "text/javascript; charset=utf-8", dir: "node_modules" },
  "/vendor/prism.js": { file: "prismjs/prism.js", type: "text/javascript; charset=utf-8", dir: "node_modules" },
};

export const UI_FILE = /^\/([a-z0-9_-]+\.(js|css|html|svg|json|png|ico))$/i;

export const UI_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json; charset=utf-8",
  png: "image/png",
  ico: "image/x-icon",
};

export const LOOKS_CUSTOM_CSS = "/looks-custom.css";

export const uiDir = fileURLToPath(new URL("../ui/", import.meta.url));
export const assetsDir = fileURLToPath(new URL("../assets/", import.meta.url));
export const vendorDir = fileURLToPath(new URL("../vendor/", import.meta.url));
const resolveModule = createRequire(import.meta.url).resolve;
const packageDir = (name: string): string => dirname(resolveModule(`${name}/package.json`));
export function staticPath(entry: { file: string; dir?: StaticDir }): string {
  if (entry.dir === "vendor") return vendorDir + entry.file;
  if (entry.dir !== "node_modules") return (entry.dir === "assets" ? assetsDir : uiDir) + entry.file;
  const slash = entry.file.indexOf("/");
  return join(packageDir(entry.file.slice(0, slash)), entry.file.slice(slash + 1));
}

export interface UiResource {
  href: string;
  kind: "file" | "dependency" | "generated";
  path?: string;
}

export interface UiManifest {
  styles: UiResource[];
  scripts: UiResource[];
}

export function uiResource(href: string): UiResource | null {
  const path = href.split(/[?#]/)[0];
  if (path === LOOKS_CUSTOM_CSS) return { href, kind: "generated" };
  const entry = STATIC_FILES[path];
  if (entry) return { href, kind: entry.dir === "node_modules" ? "dependency" : "file", path: staticPath(entry) };
  const own = UI_FILE.exec(path);
  return own ? { href, kind: "file", path: uiDir + own[1] } : null;
}

export function uiManifest(html: string = readFileSync(join(uiDir, "index.html"), "utf8")): UiManifest {
  const manifest: UiManifest = { styles: [], scripts: [] };
  for (const [tag] of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<(?:link|script)\b[^>]*>/gi)) {
    const attributes = new Map([...tag.matchAll(/\s([a-z][a-z0-9-]*)(?:\s*=\s*"([^"]*)")?/gi)].map((m) => [m[1].toLowerCase(), m[2] ?? ""]));
    const isScript = /^<script/i.test(tag);
    const href = isScript ? attributes.get("src") : attributes.get("rel") === "stylesheet" ? attributes.get("href") : undefined;
    if (href === undefined) continue;
    const resource = uiResource(href);
    if (!resource) throw new Error(`ui/index.html loads ${href}, which the hub does not serve`);
    (isScript ? manifest.scripts : manifest.styles).push(resource);
  }
  return manifest;
}
