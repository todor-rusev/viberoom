// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Logger } from "./log.js";
import type { Hub, HubEvent } from "./hub.js";
import { existsSync as fileExists } from "node:fs";
import { classifyOpenTarget, describeOpen, detectEditor, editorCommand, isExecutablePath, openCommand, type DetectedEditor } from "./open.js";
import { parseCsv, viewerKind, VIEWER_MAX_BYTES } from "./viewer.js";
import { createFolder, homeFolder, listFolders, listRoots } from "./fsbrowse.js";
import { contentTypeOf, isStoredFileName, IMAGE_MAX_BYTES, IMAGES_PER_MESSAGE, type ImageInput } from "./files.js";
import { commandTarget, parseRoomCommand } from "./commands.js";

let editorFound: DetectedEditor | null | undefined;
function currentEditor(): DetectedEditor | null {
  if (editorFound === undefined) editorFound = detectEditor(process.env, process.platform, fileExists);
  return editorFound;
}

const STATIC_FILES: Record<string, { file: string; type: string; dir?: "ui" | "assets" | "node_modules" }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/avatars.js": { file: "avatars.js", type: "text/javascript; charset=utf-8" },
  "/icons.js": { file: "icons.js", type: "text/javascript; charset=utf-8" },
  "/theme.css": { file: "theme.css", type: "text/css; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
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
  "/vendor-icons/hermes.svg": { file: "vendors/hermes.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor-icons/grok.svg": { file: "vendors/grok.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor-icons/antigravity.svg": { file: "vendors/antigravity.svg", type: "image/svg+xml", dir: "assets" },
  "/vendor/mermaid.min.js": { file: "mermaid/dist/mermaid.min.js", type: "text/javascript; charset=utf-8", dir: "node_modules" },
  "/vendor/marked.umd.js": { file: "marked/lib/marked.umd.js", type: "text/javascript; charset=utf-8", dir: "node_modules" },
};

export interface RunningServer {
  url: string;
  server: Server;
  close(): void;
}

export interface BuildInfo {
  name: string;
  version: string;
  build: string;
}

export function startServer(hub: Hub, port: number, log: Logger, info: BuildInfo, onShutdownRequest: () => void): Promise<RunningServer> {
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
  const snapshot = (): unknown => ({ ...(hub.snapshot() as Record<string, unknown>), version: info });

  const broadcast = (event: HubEvent): void => {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(payload);
  };
  hub.on("event", broadcast);

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(": ping\n\n");
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

    if (req.method === "GET" && STATIC_FILES[path]) {
      const entry = STATIC_FILES[path];
      const body = await readFile(staticPath(entry));
      res.writeHead(200, { "Content-Type": entry.type, "Cache-Control": entry.dir === "ui" || !entry.dir ? "no-cache" : "public, max-age=3600" });
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

    if (req.method === "GET" && path === "/api/file") {
      const target = classifyOpenTarget(url.searchParams.get("path") ?? "");
      if (!target || target.kind !== "path") throw new Error("only absolute paths can be viewed");
      const kind = viewerKind(target.value);
      if (!kind) throw new Error("only Markdown and CSV files can be viewed in the room");
      let info;
      try {
        info = await stat(target.value);
      } catch {
        sendJson(res, 404, { error: `no such file: ${target.value}` });
        return;
      }
      if (!info.isFile()) throw new Error(`not a file: ${target.value}`);
      if (info.size > VIEWER_MAX_BYTES) throw new Error(`too big to view here (${Math.round(info.size / 1024)} kB); open it in an editor`);
      const text = await readFile(target.value, "utf8");
      sendJson(res, 200, kind === "csv" ? { ok: true, kind, path: target.value, rows: parseCsv(text) } : { ok: true, kind, path: target.value, text });
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

    if (req.method === "GET" && path === "/api/version") {
      sendJson(res, 200, info);
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

    const roomAction = path.match(/^\/api\/rooms\/([^/]+)\/(send|typing|invite|settings|focus|rename|dir|delete|open)$/);
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
        const message = room.postHumanMessage(text, imageList(body.images));
        sendJson(res, 200, { ok: true, id: message.id });
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

    const participantAction = path.match(/^\/api\/rooms\/([^/]+)\/participants\/([^/]+)\/(cancel|remove|config|persona|reconnect|mute|unmute|respawn|staff)$/);
    if (participantAction) {
      const room = hub.getRoom(decodeURIComponent(participantAction[1]));
      const id = decodeURIComponent(participantAction[2]);
      const action = participantAction[3];
      if (action === "cancel") room.cancelTurn(id);
      else if (action === "respawn") await room.respawnAgent(id);
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
        room.updatePersona(id, {
          name: body.name === undefined ? undefined : String(body.name),
          tagline: body.tagline === undefined ? undefined : String(body.tagline),
          role: body.role === undefined ? undefined : String(body.role),
          avatar: body.avatar === undefined ? undefined : String(body.avatar),
          replyDelay: body.replyDelay === undefined ? undefined : body.replyDelay === null || body.replyDelay === "" ? null : Number(body.replyDelay),
          skills: stringList(body.skills),
        });
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
