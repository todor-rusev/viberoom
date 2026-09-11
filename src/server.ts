// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { Logger } from "./log.js";
import type { Hub, HubEvent } from "./hub.js";
import { createReadStream, existsSync as fileExists } from "node:fs";
import { createInterface } from "node:readline";
import { classifyOpenTarget, describeOpen, detectEditor, editorCommand, isExecutablePath, openCommand, type DetectedEditor } from "./open.js";
import { imageMediaType, languageOf, looksBinary, parseCsv, sliceLines, viewerKind, IMAGE_VIEW_MAX_BYTES, STREAM_MAX_BYTES, VIEWER_MAX_BYTES, WINDOW_MAX_LINES } from "./viewer.js";
import { createFolder, homeFolder, listFolders, listRoots } from "./fsbrowse.js";
import { contentTypeOf, isStoredFileName, IMAGE_MAX_BYTES, IMAGES_PER_MESSAGE, type ImageInput } from "./files.js";
import { QUOTES_PER_MESSAGE, type QuoteInput } from "./quotes.js";
import { commandTarget, parseRoomCommand } from "./commands.js";
import { acceptUpgrade, type WebSocketPeer } from "./ws.js";

let editorFound: DetectedEditor | null | undefined;
function currentEditor(): DetectedEditor | null {
  if (editorFound === undefined) editorFound = detectEditor(process.env, process.platform, fileExists);
  return editorFound;
}

const STATIC_FILES: Record<string, { file: string; type: string; dir?: "ui" | "assets" | "node_modules" }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styleguide": { file: "styleguide.html", type: "text/html; charset=utf-8" },
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
  "/vendor/mermaid.min.js": { file: "mermaid/dist/mermaid.min.js", type: "text/javascript; charset=utf-8", dir: "node_modules" },
  "/vendor/marked.umd.js": { file: "marked/lib/marked.umd.js", type: "text/javascript; charset=utf-8", dir: "node_modules" },
  "/vendor/prism.js": { file: "prismjs/prism.js", type: "text/javascript; charset=utf-8", dir: "node_modules" },
};

const PRISM_LANGUAGE = /^\/vendor\/prism-lang\/([a-z0-9-]{1,32})\.js$/;

const UI_FILE = /^\/([a-z0-9_-]+\.(js|css|html|svg|json|png|ico))$/i;
const UI_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json; charset=utf-8",
  png: "image/png",
  ico: "image/x-icon",
};

export interface RunningServer {
  url: string;
  server: Server;
  close(): void;
}

import { checkForUpdate, installUpdate, restartWithNewBuild, runsFromSourceCheckout } from "./update.js";
import { publicRecipes } from "./recipes.js";

export interface BuildInfo {
  name: string;
  version: string;
  build: string;
  staleSource?: string | null;
}

export function startServer(hub: Hub, port: number, log: Logger, info: BuildInfo, onShutdownRequest: () => void, onRestartRequest?: () => void): Promise<RunningServer> {
  const uiDir = fileURLToPath(new URL("../ui/", import.meta.url));
  const assetsDir = fileURLToPath(new URL("../assets/", import.meta.url));
  const resolveModule = createRequire(import.meta.url).resolve;
  const packageDir = (name: string): string => dirname(resolveModule(`${name}/package.json`));
  const staticPath = (entry: { file: string; dir?: "ui" | "assets" | "node_modules" }): string => {
    if (entry.dir !== "node_modules") return (entry.dir === "assets" ? assetsDir : uiDir) + entry.file;
    const slash = entry.file.indexOf("/");
    return join(packageDir(entry.file.slice(0, slash)), entry.file.slice(slash + 1));
  };
  const clients = new Set<ServerResponse>();
  const sockets = new Set<WebSocketPeer>();
  const snapshot = (): unknown => ({ ...(hub.snapshot() as Record<string, unknown>), version: { ...info, pid: process.pid } });

  const broadcast = (event: HubEvent): void => {
    const json = JSON.stringify(event);
    const payload = `event: ${event.type}\ndata: ${json}\n\n`;
    for (const res of clients) res.write(payload);
    for (const peer of sockets) peer.send(json);
  };
  hub.on("event", broadcast);

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(": ping\n\n");
    for (const peer of sockets) {
      if (!peer.alive) peer.close(1001, "no pong");
      else peer.ping();
    }
  }, 20_000);

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`${req.method} ${req.url}: ${message}`);
      if (!res.headersSent) sendJson(res, 400, { error: message });
      else res.end();
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const peer = acceptUpgrade(req, socket, head);
    if (!peer) return;
    sockets.add(peer);
    peer.onClose(() => sockets.delete(peer));
    peer.send(JSON.stringify({ type: "snapshot", snapshot: snapshot() }));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    const font = req.method === "GET" && path.match(/^\/fonts\/([a-z0-9-]+\.(woff2|css))$/i);
    if (font) {
      try {
        const body = await readFile(`${uiDir}fonts/${font[1]}`);
        res.writeHead(200, { "Content-Type": font[2].toLowerCase() === "css" ? "text/css; charset=utf-8" : "font/woff2", "Cache-Control": "public, max-age=86400" });
        res.end(body);
      } catch {
        sendJson(res, 404, { error: "no such font" });
      }
      return;
    }

    const prismLanguage = req.method === "GET" && path.match(PRISM_LANGUAGE);
    if (prismLanguage) {
      try {
        const body = await readFile(staticPath({ file: `prismjs/components/prism-${prismLanguage[1]}.min.js`, dir: "node_modules" }));
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" });
        res.end(body);
      } catch {
        sendJson(res, 404, { error: `no highlighting for "${prismLanguage[1]}"` });
      }
      return;
    }

    if (req.method === "GET" && path === "/looks-custom.css") {
      const css = await hub.looks.css();
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(css);
      return;
    }

    if (req.method === "GET" && STATIC_FILES[path]) {
      const entry = STATIC_FILES[path];
      const body = await readFile(staticPath(entry));
      res.writeHead(200, { "Content-Type": entry.type, "Cache-Control": entry.dir === "node_modules" ? "public, max-age=3600" : "no-cache" });
      res.end(body);
      return;
    }

    const uiFile = req.method === "GET" && path.match(UI_FILE);
    if (uiFile) {
      let body: Buffer;
      try {
        body = await readFile(`${uiDir}${uiFile[1]}`);
      } catch {
        sendJson(res, 404, { error: `no such file: ${uiFile[1]}` });
        return;
      }
      res.writeHead(200, { "Content-Type": UI_TYPES[uiFile[2].toLowerCase()], "Cache-Control": "no-cache" });
      res.end(body);
      return;
    }

    if (req.method === "GET" && path === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: snapshot\ndata: ${JSON.stringify({ type: "snapshot", snapshot: snapshot() })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "GET" && path === "/api/fs/dirs") {
      const at = url.searchParams.get("path");
      if (!at) {
        sendJson(res, 200, { ok: true, roots: listRoots(), home: homeFolder() });
        return;
      }
      try {
        sendJson(res, 200, { ok: true, ...(await listFolders(at)) });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") sendJson(res, 404, { error: `no such folder: ${at}` });
        else if (code === "EACCES" || code === "EPERM") sendJson(res, 403, { error: `no access to ${at}` });
        else throw error;
      }
      return;
    }

    if (req.method === "GET" && path === "/api/resolve") {
      const asked = url.searchParams.get("path") ?? "";
      const inRoom = await resolveInRoom(hub, url.searchParams.get("room"), asked);
      const target = inRoom ?? (classifyOpenTarget(asked)?.kind === "path" ? classifyOpenTarget(asked)!.value : null);
      if (!target) {
        sendJson(res, 404, { error: "not a file of this room's folder" });
        return;
      }
      try {
        const info = await stat(target);
        sendJson(res, 200, { ok: true, path: target, kind: info.isFile() ? "file" : info.isDirectory() ? "dir" : "other" });
      } catch {
        sendJson(res, 404, { error: `no such file or folder: ${target}` });
      }
      return;
    }

    if (req.method === "GET" && path === "/api/image") {
      const asked = url.searchParams.get("path") ?? "";
      const inRoom = await resolveInRoom(hub, url.searchParams.get("room"), asked);
      const target = classifyOpenTarget(inRoom ?? asked);
      if (!target || target.kind !== "path") throw new Error("only absolute paths, or a path inside the room's folder, can be shown");
      const media = imageMediaType(target.value);
      if (!media) throw new Error("not a picture the room can show");
      let info;
      try {
        info = await stat(target.value);
      } catch {
        sendJson(res, 404, { error: `no such file: ${target.value}` });
        return;
      }
      if (!info.isFile()) throw new Error(`not a file: ${target.value}`);
      if (info.size > IMAGE_VIEW_MAX_BYTES) throw new Error(`too big to show here (${Math.round(info.size / 1024 / 1024)} MB); it opens with the default app`);
      res.writeHead(200, { "Content-Type": media, "Content-Length": String(info.size), "Cache-Control": "no-cache" });
      createReadStream(target.value).pipe(res);
      return;
    }

    if (req.method === "GET" && path === "/api/file") {
      const asked = url.searchParams.get("path") ?? "";
      const relative = await resolveInRoom(hub, url.searchParams.get("room"), asked);
      const target = classifyOpenTarget(relative ?? asked);
      if (!target || target.kind !== "path") throw new Error("only absolute paths, or a path inside the room's folder, can be viewed");
      const kind = viewerKind(target.value);
      let info;
      try {
        info = await stat(target.value);
      } catch {
        sendJson(res, 404, { error: `no such file: ${target.value}` });
        return;
      }
      if (!info.isFile()) throw new Error(`not a file: ${target.value}`);
      const asNumber = (name: string): number | undefined => {
        const raw = url.searchParams.get(name);
        if (raw === null || raw === "") return undefined;
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`${name} must be a line number`);
        return Math.max(1, Math.floor(value));
      };
      const from = asNumber("from");
      const to = asNumber("to");
      const language = languageOf(target.value);
      if (info.size > VIEWER_MAX_BYTES) {
        if (kind !== "text") throw new Error(`too big to view here (${Math.round(info.size / 1024)} kB); open it in an editor`);
        const window = await readLineWindow(target.value, from ?? 1, to);
        if (window.binary) throw new Error("not a text file; opening it with the default app instead");
        sendJson(res, 200, { ok: true, kind, path: target.value, language, text: window.text, from: window.from, to: window.to, lines: window.lines, more: true, bytes: info.size });
        return;
      }
      const buffer = await readFile(target.value);
      if (looksBinary(buffer.subarray(0, 8192))) throw new Error("not a text file; opening it with the default app instead");
      const text = buffer.toString("utf8");
      if (kind === "csv") {
        sendJson(res, 200, { ok: true, kind, path: target.value, rows: parseCsv(text) });
        return;
      }
      if (kind === "markdown" && from === undefined) {
        sendJson(res, 200, { ok: true, kind, path: target.value, text, lines: text.split(/\r?\n/).length });
        return;
      }
      const window = sliceLines(text, from, to);
      sendJson(res, 200, { ok: true, kind, path: target.value, language, ...window, bytes: info.size });
      return;
    }

    const roomFile = req.method === "GET" && path.match(/^\/api\/rooms\/([^/]+)\/files\/([^/]+)$/);
    if (roomFile) {
      const room = hub.getRoom(decodeURIComponent(roomFile[1]));
      const name = decodeURIComponent(roomFile[2]);
      if (!isStoredFileName(name)) {
        sendJson(res, 400, { error: "not an attachment name" });
        return;
      }
      try {
        const bytes = await readFile(join(room.filesDir(), name));
        res.writeHead(200, { "Content-Type": contentTypeOf(name), "Cache-Control": "public, max-age=31536000, immutable" });
        res.end(bytes);
      } catch {
        sendJson(res, 404, { error: "no such attachment" });
      }
      return;
    }

    if (req.method === "GET" && path === "/api/editor") {
      sendJson(res, 200, { editor: currentEditor(), settings: hub.settings.editor });
      return;
    }

    if (req.method === "GET" && path === "/api/state") {
      sendJson(res, 200, snapshot());
      return;
    }

    if (req.method === "GET" && path === "/api/update") {
      if (url.searchParams.get("check") === "1") hub.setUpdate(await checkForUpdate(hub.dataDir, info.version, { force: true }));
      sendJson(res, 200, hub.update ?? { current: info.version, latest: null, available: false, checkedAt: null, error: null });
      return;
    }
    if (req.method === "POST" && path === "/api/update/install") {
      const mainUrl = new URL("./main.js", import.meta.url).href;
      if (runsFromSourceCheckout(mainUrl)) throw new Error("this viberoom runs from a source checkout; update it with git pull and npm run update");
      const latest = hub.update?.available ? hub.update.latest : null;
      if (!latest) throw new Error("no newer version is known; check for updates first");
      log.info(`installing viberoom ${latest} (npm install -g)`);
      const result = await installUpdate(latest, hub.dataDir);
      if (!result.ok) throw new Error(`npm install failed: ${result.output.slice(-600) || "no output"}`);
      log.info(`viberoom ${latest} installed; starting the new build, which replaces this hub`);
      sendJson(res, 200, { ok: true, version: latest });
      setTimeout(() => restartWithNewBuild(mainUrl, port, hub.dataDir), 300);
      return;
    }

    if (req.method === "GET" && path === "/api/version") {
      sendJson(res, 200, { ...info, dataDir: hub.dataDir, pid: process.pid });
      return;
    }

    if (req.method === "GET" && path === "/api/skills") {
      sendJson(res, 200, { skills: hub.listSkills() });
      return;
    }

    const skillGet = req.method === "GET" && path.match(/^\/api\/skills\/([^/]+)$/);
    if (skillGet) {
      const skill = hub.skills.get(decodeURIComponent(skillGet[1]));
      if (!skill) {
        sendJson(res, 404, { error: "no such skill" });
        return;
      }
      sendJson(res, 200, { skill });
      return;
    }

    if (req.method === "GET" && path === "/api/mcp/room") {
      const target = hub.resolveMcpToken(url.searchParams.get("token") ?? "");
      if (!target) {
        sendJson(res, 403, { error: "unknown skills token (the session it belonged to is gone)" });
        return;
      }
      sendJson(res, 200, target.room.describeRoomForAgent(target.participantId));
      return;
    }

    if (req.method === "GET" && path === "/api/mcp/looks") {
      const target = hub.resolveMcpToken(url.searchParams.get("token") ?? "");
      if (!target) {
        sendJson(res, 403, { error: "unknown skills token (the session it belonged to is gone)" });
        return;
      }
      sendJson(res, 200, await target.room.describeLooksForAgent(target.participantId));
      return;
    }

    if (req.method === "GET" && path === "/api/mcp/message") {
      const target = hub.resolveMcpToken(url.searchParams.get("token") ?? "");
      if (!target) {
        sendJson(res, 403, { error: "unknown skills token (the session it belonged to is gone)" });
        return;
      }
      const seq = Number(url.searchParams.get("seq"));
      if (!Number.isInteger(seq)) throw new Error("seq must be the message number, the N of #N");
      sendJson(res, 200, target.room.readMessageForAgent(target.participantId, seq, Number(url.searchParams.get("around") ?? 0)));
      return;
    }

    if (req.method === "GET" && path === "/api/mcp/skill") {
      const target = hub.resolveMcpToken(url.searchParams.get("token") ?? "");
      if (!target) {
        sendJson(res, 403, { error: "unknown skills token (the session it belonged to is gone)" });
        return;
      }
      const loaded = target.room.loadSkillForAgent(target.participantId, url.searchParams.get("name") ?? "");
      sendJson(res, 200, loaded);
      return;
    }

    if (req.method === "GET" && path === "/api/settings") {
      sendJson(res, 200, hub.settings);
      return;
    }

    const recipeOptions = req.method === "GET" && path.match(/^\/api\/recipes\/([^/]+)\/options$/);
    if (recipeOptions) {
      const anyRoom = [...hub.rooms.values()][0];
      if (!anyRoom) throw new Error("create a room first");
      const info = await anyRoom.discoverOptions(decodeURIComponent(recipeOptions[1]), url.searchParams.get("refresh") === "1");
      sendJson(res, 200, info);
      return;
    }

    const editPreview = req.method === "GET" && path.match(/^\/api\/rooms\/([^/]+)\/messages\/([^/]+)\/edit-preview$/);
    if (editPreview) {
      const room = hub.getRoom(decodeURIComponent(editPreview[1]));
      sendJson(res, 200, room.previewEdit(decodeURIComponent(editPreview[2])));
      return;
    }

    const roomGet = req.method === "GET" && path.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomGet) {
      sendJson(res, 200, hub.getRoom(decodeURIComponent(roomGet[1])).snapshot());
      return;
    }

    if (req.method === "GET" && path === "/api/templates") {
      sendJson(res, 200, { templates: hub.templates.list() });
      return;
    }

    if (req.method === "GET" && path === "/api/looks") {
      sendJson(res, 200, { looks: hub.looks.list() });
      return;
    }
    if (req.method === "GET" && path === "/api/looks/describe") {
      sendJson(res, 200, await hub.looks.describe());
      return;
    }

    if (req.method === "GET" && path === "/api/rooms") {
      sendJson(res, 200, [...hub.rooms.values()].map((r) => r.snapshot()));
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    const body = (await readJson(req)) as Record<string, unknown>;

    if (path === "/api/settings") {
      sendJson(res, 200, { ok: true, settings: hub.updateSettings(body) });
      return;
    }

    if (path === "/api/looks/check") {
      const { checkLookSpec } = await import("./looks.js");
      try {
        const checked = await checkLookSpec(body.spec ?? body);
        sendJson(res, 200, { ok: checked.lint.ok, id: checked.spec.id, errors: checked.lint.errors, warnings: checked.lint.warnings, report: checked.lint.report });
      } catch (error) {
        sendJson(res, 200, { ok: false, errors: [{ level: "error", key: "spec", message: error instanceof Error ? error.message : String(error) }], warnings: [], report: [] });
      }
      return;
    }
    if (path === "/api/looks") {
      const saved = await hub.saveLook(body.spec ?? body, { author: "human", replace: body.replace === true || body.replace === "true" });
      sendJson(res, 200, { ok: true, look: saved.spec, warnings: saved.lint.warnings, report: saved.lint.report });
      return;
    }
    if (path === "/api/looks/remove") {
      const id = String(body.id ?? "");
      if (!hub.removeLook(id)) throw new Error(`no look "${id}" of your own to remove`);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === "/api/fs/mkdir") {
      sendJson(res, 200, { ok: true, path: await createFolder(String(body.parent ?? ""), String(body.name ?? "")) });
      return;
    }

    if (path === "/api/window") {
      hub.saveWindowPlacement(body);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === "/api/open") {
      const target = classifyOpenTarget(String(body.target ?? ""));
      if (!target) throw new Error("only http(s) or mailto links and absolute paths can be opened");
      let reveal = false;
      if (target.kind === "path") {
        try {
          const info = await stat(target.value);
          reveal = info.isFile() && isExecutablePath(target.value);
        } catch {
          sendJson(res, 404, { error: `no such file or folder: ${target.value}` });
          return;
        }
      }
      const cmd = (!reveal && editorCommand(target, hub.settings.editor, currentEditor(), process.platform)) || openCommand(target, process.platform, reveal);
      log.info(`open (${cmd.action}${cmd.editor ? ` via ${cmd.editor}` : ""}): ${target.value}${target.line !== undefined ? `:${target.line}` : ""}`);
      const child = spawn(cmd.command, cmd.args, { detached: true, stdio: "ignore", windowsHide: true });
      child.on("error", (error) => log.warn(`open failed: ${error.message}`));
      child.unref();
      sendJson(res, 200, { ok: true, action: cmd.action, editor: cmd.editor ?? null, message: describeOpen(target, cmd.action, cmd.editor) });
      return;
    }

    if (path === "/api/skills") {
      const skill = hub.saveSkill({
        name: String(body.name ?? ""),
        description: String(body.description ?? ""),
        argumentHint: optionalString(body.argumentHint) ?? undefined,
        body: String(body.body ?? ""),
        userInvocable: body.userInvocable === undefined ? undefined : body.userInvocable === true || body.userInvocable === "true",
        agentInvocable: body.agentInvocable === undefined ? undefined : body.agentInvocable === true || body.agentInvocable === "true",
      });
      sendJson(res, 200, { ok: true, skill });
      return;
    }

    const skillDelete = path.match(/^\/api\/skills\/([^/]+)\/delete$/);
    if (skillDelete) {
      hub.removeSkill(decodeURIComponent(skillDelete[1]));
      sendJson(res, 200, { ok: true });
      return;
    }

    const skillApprove = path.match(/^\/api\/skills\/([^/]+)\/approve$/);
    if (skillApprove) {
      sendJson(res, 200, { ok: true, skill: hub.approveSkill(decodeURIComponent(skillApprove[1])) });
      return;
    }

    const loginStart = path.match(/^\/api\/recipes\/([^/]+)\/login$/);
    if (loginStart) {
      sendJson(res, 200, { ok: true, flow: hub.startLogin(decodeURIComponent(loginStart[1]), body.terminal === true) });
      return;
    }
    const installStart = path.match(/^\/api\/recipes\/([^/]+)\/install$/);
    if (installStart) {
      sendJson(res, 200, { ok: true, flow: hub.startInstall(decodeURIComponent(installStart[1]), body.terminal === true) });
      return;
    }
    const loginAction = path.match(/^\/api\/login\/([^/]+)\/(input|cancel)$/);
    if (loginAction) {
      const id = decodeURIComponent(loginAction[1]);
      const flow = loginAction[2] === "input" ? hub.logins.input(id, String(body.text ?? "")) : hub.logins.cancel(id);
      sendJson(res, 200, { ok: true, flow });
      return;
    }

    if (path === "/api/recipes/check") {
      const id = optionalString(body.id);
      if (body.rescan === true || body.rescan === "true") await hub.rescan(id ? [id] : undefined);
      else await hub.checkLogins(id ? [id] : undefined, body.force === true || body.force === "true" ? 0 : 60_000);
      sendJson(res, 200, { ok: true, recipes: publicRecipes() });
      return;
    }

    if (path === "/api/mcp/design/lint" || path === "/api/mcp/templates") {
      const target = hub.resolveMcpToken(String(body.token ?? ""));
      if (!target) {
        sendJson(res, 403, { error: "unknown skills token (the session it belonged to is gone)" });
        return;
      }
      const design = {
        name: optionalString(body.name) ?? undefined,
        description: optionalString(body.description) ?? undefined,
        emoji: optionalString(body.emoji) ?? undefined,
        settings: body.settings && typeof body.settings === "object" && !Array.isArray(body.settings) ? (body.settings as Record<string, unknown>) : undefined,
        vibemates: Array.isArray(body.vibemates) ? (body.vibemates as Record<string, unknown>[]).map((v) => ({ ...v, name: String(v?.name ?? "") }) as import("./templates.js").TemplateVibemate) : undefined,
      };
      if (path === "/api/mcp/design/lint") {
        sendJson(res, 200, target.room.lintDesignForAgent(target.participantId, body.kind === "room" ? "room" : "template", design));
        return;
      }
      sendJson(res, 200, target.room.createTemplateForAgent(target.participantId, design, body.replace === true || body.replace === "true"));
      return;
    }

    if (path === "/api/mcp/looks/lint" || path === "/api/mcp/looks/create" || path === "/api/mcp/looks/propose") {
      const target = hub.resolveMcpToken(String(body.token ?? ""));
      if (!target) {
        sendJson(res, 403, { error: "unknown skills token (the session it belonged to is gone)" });
        return;
      }
      if (path === "/api/mcp/looks/lint") {
        sendJson(res, 200, await target.room.lintLookForAgent(target.participantId, body.spec ?? body));
        return;
      }
      if (path === "/api/mcp/looks/create") {
        sendJson(res, 200, await target.room.createLookForAgent(target.participantId, body.spec ?? body, body.replace === true || body.replace === "true"));
        return;
      }
      const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
      sendJson(
        res,
        200,
        await target.room.proposeLookChanges(target.participantId, String(body.why ?? ""), {
          look: typeof body.look === "string" ? body.look : undefined,
          adjust: body.adjust && typeof body.adjust === "object" && !Array.isArray(body.adjust) ? (body.adjust as Record<string, unknown>) : undefined,
          chatFontSize: num(body.chatFontSize),
          font: typeof body.font === "string" ? body.font : undefined,
          mono: typeof body.mono === "string" ? body.mono : undefined,
        }),
      );
      return;
    }

    if (path === "/api/mcp/propose") {
      const target = hub.resolveMcpToken(String(body.token ?? ""));
      if (!target) {
        sendJson(res, 403, { error: "unknown skills token (the session it belonged to is gone)" });
        return;
      }
      const vib = body.vibemates && typeof body.vibemates === "object" ? (body.vibemates as Record<string, unknown>) : {};
      const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).map((x) => ({ ...x, name: String(x?.name ?? "") })) : undefined);
      sendJson(
        res,
        200,
        target.room.proposeRoomChanges(target.participantId, String(body.why ?? ""), {
          settings: body.settings && typeof body.settings === "object" && !Array.isArray(body.settings) ? (body.settings as Record<string, unknown>) : undefined,
          vibemates: {
            add: list(vib.add) as import("./templates.js").TemplateVibemate[] | undefined,
            update: list(vib.update) as ({ name: string } & Partial<import("./templates.js").TemplateVibemate> & { newName?: string })[] | undefined,
            remove: Array.isArray(vib.remove) ? (vib.remove as unknown[]).map((x) => String(x)) : undefined,
          },
        }),
      );
      return;
    }

    const proposal = path.match(/^\/api\/rooms\/([^/]+)\/proposals\/([^/]+)$/);
    if (proposal) {
      const room = hub.getRoom(decodeURIComponent(proposal[1]));
      sendJson(res, 200, await room.resolveProposal(decodeURIComponent(proposal[2]), body.accept === true || body.accept === "true"));
      return;
    }

    if (path === "/api/mcp/skills" || path === "/api/mcp/attach") {
      const target = hub.resolveMcpToken(String(body.token ?? ""));
      if (!target) {
        sendJson(res, 403, { error: "unknown skills token (the session it belonged to is gone)" });
        return;
      }
      if (path === "/api/mcp/attach") {
        const to = Array.isArray(body.to) ? body.to.map((v) => String(v)) : body.to === undefined || body.to === null || body.to === "" || body.to === "me" ? "me" : [String(body.to)];
        sendJson(res, 200, target.room.attachSkillForAgent(target.participantId, String(body.name ?? ""), to));
        return;
      }
      sendJson(
        res,
        200,
        target.room.createSkillForAgent(target.participantId, {
          op: body.op === "update" ? "update" : "create",
          name: String(body.name ?? ""),
          description: String(body.description ?? ""),
          instructions: String(body.instructions ?? ""),
          argumentHint: optionalString(body.argument_hint) ?? undefined,
          userInvocable: body.user_invocable === undefined ? undefined : body.user_invocable === true || body.user_invocable === "true",
          agentInvocable: body.agent_invocable === undefined ? undefined : body.agent_invocable === true || body.agent_invocable === "true",
          dryRun: body.dry_run === true || body.dry_run === "true",
        }),
      );
      return;
    }

    if (path === "/api/mcp/ready") {
      const token = String(body.token ?? "");
      const target = hub.resolveMcpToken(token);
      if (target) target.room.skillToolReady(target.participantId, token);
      sendJson(res, 200, { ok: !!target });
      return;
    }

    if (path === "/api/profile/erase") {
      if (String(body.confirm ?? "") !== "erase") throw new Error('type "erase" to confirm');
      await hub.reset();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (path === "/api/restart") {
      if (!onRestartRequest) {
        sendJson(res, 400, { error: "this hub cannot restart itself" });
        return;
      }
      log.info("restart requested from the window");
      sendJson(res, 200, { ok: true });
      setTimeout(onRestartRequest, 50);
      return;
    }

    if (path === "/api/shutdown") {
      log.info("shutdown requested over the API");
      sendJson(res, 200, { ok: true });
      setTimeout(onShutdownRequest, 50);
      return;
    }

    if (path === "/api/rooms/from-template") {
      const vibemates = Array.isArray(body.vibemates) ? body.vibemates : [];
      const { room, notices } = await hub.createRoomFromTemplate({
        templateId: String(body.template ?? ""),
        name: String(body.name ?? ""),
        dir: optionalString(body.dir),
        vibemates: vibemates.map((v) => {
          const o = (v ?? {}) as Record<string, unknown>;
          return { name: String(o.name ?? ""), agentType: String(o.agentType ?? ""), model: optionalString(o.model), effort: optionalString(o.effort), mode: optionalString(o.mode) };
        }),
      });
      sendJson(res, 200, { ok: true, room: room.snapshot(), notices });
      return;
    }

    if (path === "/api/rooms") {
      const { room, notices } = hub.createRoom({
        name: String(body.name ?? ""),
        dir: optionalString(body.dir),
        settings: (body.settings as Record<string, unknown> | undefined) ?? {},
      });
      sendJson(res, 200, { ok: true, room: room.snapshot(), notices });
      return;
    }

    const roomAction = path.match(/^\/api\/rooms\/([^/]+)\/(send|typing|invite|settings|focus|rename|dir|delete|open|template-preview|save-template)$/);
    if (roomAction) {
      const room = hub.getRoom(decodeURIComponent(roomAction[1]));
      const action = roomAction[2];
      if (action === "open") {
        hub.markOpened(room.id);
        sendJson(res, 200, { ok: true, openRooms: hub.openRooms });
      } else if (action === "send") {
        const text = String(body.text ?? "");
        const command = parseRoomCommand(text);
        if (command) {
          const target = room.findByName(commandTarget(command.args));
          if (!target) throw new Error(`/${command.name} needs the name of a vibemate in this room, like /${command.name} @Name`);
          await room.respawnAgent(target.id);
          hub.saveRooms();
          sendJson(res, 200, { ok: true, command: command.name, participant: target.name });
          return;
        }
        const message = room.postHumanMessage(text, imageList(body.images), quoteList(body.quotes));
        sendJson(res, 200, { ok: true, id: message.id });
      } else if (action === "template-preview") {
        sendJson(res, 200, { template: { name: room.name, emoji: room.settings.emoji || "", ...room.templateOf() } });
      } else if (action === "save-template") {
        const edited = body.template && typeof body.template === "object" ? (body.template as Record<string, unknown>) : undefined;
        const template = hub.saveRoomAsTemplate(room.id, {
          name: String(body.name ?? ""),
          description: String(body.description ?? ""),
          emoji: body.emoji === undefined ? undefined : String(body.emoji),
          template: edited && {
            dir: optionalString(edited.dir) ?? undefined,
            settings: edited.settings && typeof edited.settings === "object" ? (edited.settings as Record<string, unknown>) : undefined,
            vibemates: Array.isArray(edited.vibemates) ? (edited.vibemates as never[]) : undefined,
          },
        });
        sendJson(res, 200, { ok: true, template });
      } else if (action === "typing") {
        room.humanTyping();
        sendJson(res, 200, { ok: true });
      } else if (action === "invite") {
        const participant = await room.inviteAgent({
          agentType: String(body.agentType ?? ""),
          name: String(body.name ?? ""),
          tagline: optionalString(body.tagline),
          role: optionalString(body.role),
          avatar: optionalString(body.avatar),
          replyDelay: body.replyDelay === undefined || body.replyDelay === null || body.replyDelay === "" ? undefined : Number(body.replyDelay),
          skills: stringList(body.skills),
          model: optionalString(body.model),
          effort: optionalString(body.effort),
          mode: optionalString(body.mode),
        });
        hub.saveRooms();
        sendJson(res, 200, { ok: true, participant });
      } else if (action === "settings") {
        const settings = room.updateSettings(body);
        hub.saveRooms();
        sendJson(res, 200, { ok: true, settings });
      } else if (action === "focus") {
        room.focus();
        sendJson(res, 200, { ok: true });
      } else if (action === "rename") {
        room.rename(String(body.name ?? ""));
        hub.saveRooms();
        sendJson(res, 200, { ok: true });
      } else if (action === "dir") {
        const result = await room.setDir(String(body.dir ?? ""));
        const notice = hub.workspaceNotice(result.dir);
        if (notice) room.postNotice(notice);
        hub.saveRooms();
        sendJson(res, 200, { ok: true, ...result });
      } else {
        await hub.removeRoom(room.id);
        sendJson(res, 200, { ok: true });
      }
      return;
    }

    const messagePin = path.match(/^\/api\/rooms\/([^/]+)\/messages\/([^/]+)\/pin$/);
    if (messagePin) {
      const room = hub.getRoom(decodeURIComponent(messagePin[1]));
      const message = room.setPinned(decodeURIComponent(messagePin[2]), body.pinned === true || body.pinned === "true");
      sendJson(res, 200, { ok: true, pinned: !!message.pinned });
      return;
    }

    const messageEdit = path.match(/^\/api\/rooms\/([^/]+)\/messages\/([^/]+)\/edit$/);
    if (messageEdit) {
      const room = hub.getRoom(decodeURIComponent(messageEdit[1]));
      const mode = body.mode === "rewrite" ? "rewrite" : "notify";
      const result = await room.editMessage(decodeURIComponent(messageEdit[2]), String(body.text ?? ""), mode);
      hub.saveRooms();
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    const participantAction = path.match(/^\/api\/rooms\/([^/]+)\/participants\/([^/]+)\/(cancel|remove|config|persona|reconnect|mute|unmute|respawn|retry|staff|notes|take-notes)$/);
    if (participantAction) {
      const room = hub.getRoom(decodeURIComponent(participantAction[1]));
      const id = decodeURIComponent(participantAction[2]);
      const action = participantAction[3];
      if (action === "cancel") {
        sendJson(res, 200, { ok: true, stopped: room.cancelTurn(id) });
        return;
      } else if (action === "retry") {
        sendJson(res, 200, { ok: true, participant: room.retryTurn(id) });
        return;
      } else if (action === "respawn") {
        const replay = body.replay === undefined || body.replay === null || body.replay === "" ? undefined : Number(body.replay);
        await room.respawnAgent(id, { memory: body.memory === true || body.memory === "true", replay: replay !== undefined && Number.isFinite(replay) ? Math.max(0, Math.min(500, Math.round(replay))) : undefined });
      }
      else if (action === "notes") room.updateNotes(id, String(body.notes ?? ""));
      else if (action === "take-notes") await room.takeNotes(id);
      else if (action === "staff") {
        const participant = await room.staff(id, {
          agentType: String(body.agentType ?? ""),
          model: optionalString(body.model),
          effort: optionalString(body.effort),
          mode: optionalString(body.mode),
          name: optionalString(body.name),
          tagline: optionalString(body.tagline),
          role: optionalString(body.role),
          avatar: optionalString(body.avatar),
          skills: stringList(body.skills),
        });
        hub.saveRooms();
        sendJson(res, 200, { ok: true, participant });
        return;
      }
      else if (action === "remove") await room.removeParticipant(id);
      else if (action === "reconnect") {
        const mode = body.mode === "load" ? "load" : "replay";
        const replay = body.replay === undefined || body.replay === null || body.replay === "" ? undefined : Number(body.replay);
        await room.reconnect(id, { mode, replay: replay !== undefined && Number.isFinite(replay) ? Math.max(0, Math.min(500, Math.round(replay))) : undefined });
      }
      else if (action === "mute") room.setMuted(id, true);
      else if (action === "unmute") room.setMuted(id, false);
      else if (action === "persona") {
        const patch = {
          name: body.name === undefined ? undefined : String(body.name),
          tagline: body.tagline === undefined ? undefined : String(body.tagline),
          role: body.role === undefined ? undefined : String(body.role),
          avatar: body.avatar === undefined ? undefined : String(body.avatar),
          replyDelay: body.replyDelay === undefined ? undefined : body.replyDelay === null || body.replyDelay === "" ? null : Number(body.replyDelay),
          skills: stringList(body.skills),
        };
        if (body.restart === true || body.restart === "true") await room.restartWithPersona(id, patch);
        else room.updatePersona(id, patch);
      } else await room.setConfig(id, String(body.configId ?? ""), body.value as string | boolean);
      hub.saveRooms();
      sendJson(res, 200, { ok: true });
      return;
    }

    const permission = path.match(/^\/api\/rooms\/([^/]+)\/permissions\/([^/]+)$/);
    if (permission) {
      const room = hub.getRoom(decodeURIComponent(permission[1]));
      room.resolvePermission(decodeURIComponent(permission[2]), optionalString(body.optionId) ?? null);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "not found" });
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const url = `http://127.0.0.1:${actualPort}/`;
      resolve({
        url,
        server,
        close: () => {
          clearInterval(heartbeat);
          for (const res of clients) res.end();
          for (const peer of sockets) peer.close(1001, "hub closing");
          server.close();
        },
      });
    });
  });
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return String(value);
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
}

function imageList(value: unknown): ImageInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, IMAGES_PER_MESSAGE).map((entry) => {
    const image = (entry ?? {}) as Record<string, unknown>;
    const n = Number(image.n);
    return { name: optionalString(image.name) ?? undefined, mimeType: String(image.mimeType ?? ""), data: String(image.data ?? ""), n: Number.isInteger(n) && n > 0 ? n : undefined };
  });
}

function inside(child: string, root: string): boolean {
  const [c, r] = process.platform === "linux" ? [child, root] : [child.toLowerCase(), root.toLowerCase()];
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

async function resolveInRoom(hub: Hub, roomId: string | null, asked: string): Promise<string | null> {
  const text = String(asked ?? "").trim();
  if (!roomId || !text || isAbsolute(text) || /^[a-z]:[\\/]/i.test(text) || /^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith("~")) return null;
  const room = hub.getRoom(roomId);
  const dir = room?.dir;
  if (!dir) return null;
  const full = resolve(dir, text);
  const root = resolve(dir);
  if (!inside(full, root)) return null;
  try {
    const realFull = await realpath(full);
    const realRoot = await realpath(root);
    return inside(realFull, realRoot) ? full : null;
  } catch {
    return full;
  }
}

async function readLineWindow(path: string, from: number, to?: number): Promise<{ text: string; from: number; to: number; lines: number; binary: boolean }> {
  const end = Math.max(from, Math.min(to ?? from + WINDOW_MAX_LINES - 1, from + WINDOW_MAX_LINES - 1));
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 256 * 1024 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const kept: string[] = [];
  let n = 0;
  let bytes = 0;
  let binary = false;
  try {
    for await (const line of lines) {
      n++;
      bytes += line.length + 1;
      if (n === 1 && looksBinary(Buffer.from(line.slice(0, 4096), "utf8"))) {
        binary = true;
        break;
      }
      if (n >= from && n <= end) kept.push(line);
      if (n >= end || bytes > STREAM_MAX_BYTES) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return { text: kept.join("\n"), from, to: Math.min(end, n), lines: n, binary };
}

function quoteList(value: unknown): QuoteInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, QUOTES_PER_MESSAGE).map((entry) => {
    const quote = (entry ?? {}) as Record<string, unknown>;
    const n = Number(quote.n);
    return { seq: Number(quote.seq), text: String(quote.text ?? ""), n: Number.isInteger(n) && n > 0 ? n : undefined };
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const BODY_MAX_BYTES = (IMAGE_MAX_BYTES * IMAGES_PER_MESSAGE * 4) / 3 + 64 * 1024;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_MAX_BYTES) {
        reject(new Error("the request is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
