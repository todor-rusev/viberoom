#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { exec, spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hub } from "./hub.js";
import { Logger } from "./log.js";
import { startServer, type BuildInfo, type RunningServer } from "./server.js";
import {
  appWindowArgs,
  recordedWindowPlacement,
  savedWindowPlacement,
  browserAdvice,
  findChromium,
  foreignHub,
  hubPortFor,
  isProcessAlive,
  logFilePath,
  openUrlCommand,
  pidFilePath,
  readPidFile,
  rotateLog,
  splitCommand,
  tailFile,
  writePidFile,
  type Command,
  type HubIdentity,
  type PidRecord,
} from "./launcher.js";
import { aumidSyncScript, installShortcuts, windowsShortcutPaths } from "./shortcuts.js";
import { askEnter, renderInstalled, runMenu, unicodeSupported } from "./tui.js";
import { listRecipes } from "./recipes.js";

interface CliOptions {
  command: Command;
  port: number;
  portGiven: boolean;
  dataDir: string;
  name: string | undefined;
  open: boolean;
  browser: boolean;
  menu: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const { command, rest } = splitCommand(argv);
  const options: CliOptions = {
    command,
    port: 4810,
    portGiven: false,
    dataDir: process.env.VIBEROOM_DATA_DIR ? resolve(process.env.VIBEROOM_DATA_DIR) : resolve(homedir(), ".viberoom"),
    name: undefined,
    open: true,
    browser: false,
    menu: true,
    force: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = (): string => {
      const value = rest[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--port":
        options.port = Number(next());
        options.portGiven = true;
        break;
      case "--name":
        options.name = next();
        break;
      case "--data-dir":
        options.dataDir = resolve(next());
        break;
      case "--open":
        options.open = true;
        options.menu = false;
        break;
      case "--no-open":
        options.open = false;
        options.menu = false;
        break;
      case "--force":
        options.force = true;
        break;
      case "--browser":
        options.browser = true;
        options.menu = false;
        break;
      case "-h":
      case "--help":
        options.command = "help";
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp(): void {
  process.stdout.write(`viberoom: group chat rooms for a human and several coding agents (Agent Client Protocol)

Usage: viberoom [command] [--port 4810] [--data-dir <dir>] [--name Human] [--no-open] [--browser]

Commands
  (none)       in a terminal: a small menu (desktop icon / app window / browser / run here);
               with --open, --no-open or --browser, or without a terminal: run the hub in this
               process and open the window; if a hub is already running, open it (or replace it
               when this build is newer)
  start        run the hub hidden in the background (log in <data-dir>/hub.log) and open the window
  stop         stop this data folder's hub (found through its pid file; a hub of another folder on
               the port is left alone; --port names a port explicitly)
  status       show whether this data folder's hub is running, its build and address
  open         open the window of the running hub
  logs         print the last lines of the background hub's log
  doctor       check Node, the browser, the coding agents and the hub; say what is missing and why

Options
  --port       localhost port for the web UI (default 4810)
  --data-dir   where settings, rooms, history, skills and transcripts live (default ~/.viberoom, or $VIBEROOM_DATA_DIR)
  --name       the human's display name (optional; the first start asks in the browser)
  --no-open    do not open a window
  --browser    open the default browser instead of a Chromium app window
`);
}

import { checkForUpdate, newerSourceThanBuild } from "./update.js";

function buildInfo(): BuildInfo {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { name: string; version: string };
  const built = statSync(fileURLToPath(import.meta.url)).mtime;
  return { name: pkg.name, version: pkg.version, build: built.toISOString(), staleSource: newerSourceThanBuild(import.meta.url) };
}

async function runningInstance(port: number): Promise<(HubIdentity & { url: string }) | null> {
  const url = `http://127.0.0.1:${port}/`;
  try {
    const res = await fetch(`${url}api/settings`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { humanName?: unknown };
    if (typeof body.humanName !== "string") return null;
  } catch {
    return null;
  }
  try {
    const res = await fetch(`${url}api/version`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { url, build: null, dataDir: null, pid: null };
    const info = (await res.json()) as { build?: unknown; dataDir?: unknown; pid?: unknown };
    return { url, build: typeof info.build === "string" ? info.build : null, dataDir: typeof info.dataDir === "string" ? info.dataDir : null, pid: typeof info.pid === "number" ? info.pid : null };
  } catch {
    return { url, build: null, dataDir: null, pid: null };
  }
}

function liveRecord(dataDir: string): PidRecord | null {
  const record = readPidFile(dataDir);
  return record && isProcessAlive(record.pid) ? record : null;
}

function otherHubMessage(port: number, other: string, mine: string): string {
  return `port ${port} is used by a viberoom hub whose rooms are in ${other}, not in ${mine}; it was left alone. Run this one on another port (--port ${port + 1}) or stop that hub first: viberoom stop --data-dir "${other}"`;
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number, stepMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return false;
}

async function isUp(url: string): Promise<boolean> {
  try {
    await fetch(`${url}api/settings`, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

async function stopInstance(url: string, log: Logger): Promise<boolean> {
  try {
    await fetch(`${url}api/shutdown`, { method: "POST", signal: AbortSignal.timeout(1500) });
  } catch (error) {
    log.warn(`could not ask the running hub to stop: ${String(error)}`);
    return false;
  }
  return waitUntil(async () => !(await isUp(url)), 10_000);
}

function migrateLegacyData(dataDir: string, log: Logger): void {
  const legacy = resolve(fileURLToPath(new URL("../data/", import.meta.url)));
  if (existsSync(join(dataDir, "rooms.json")) || !existsSync(join(legacy, "rooms.json"))) return;
  if (resolve(legacy) === resolve(dataDir)) return;
  mkdirSync(dataDir, { recursive: true });
  cpSync(legacy, dataDir, { recursive: true });
  log.info(`copied existing rooms and settings from ${legacy} to ${dataDir} (the old folder is left untouched)`);
}

function reapHiddenBrowser(profileDir: string, log: Logger): void {
  if (process.platform !== "win32") return;
  const needle = profileDir.replace(/'/g, "''");
  const script = `$ps = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*${needle}*' -and $_.CommandLine -notlike '*--type=*' }; foreach ($p in $ps) { $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($proc -and $proc.MainWindowHandle -eq 0) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; "killed $($p.ProcessId)" } elseif ($proc) { "open $($p.ProcessId)" } }`;
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10_000, windowsHide: true });
    for (const line of (r.stdout || "").split(/\r?\n/).filter(Boolean)) {
      if (line.startsWith("killed")) log.info(`closed a leftover browser process that had no window (pid ${line.slice(7)})`);
      else if (line.startsWith("open")) log.warn(`the app window is already open (browser pid ${line.slice(5)}); a second window joins it and the saved placement applies only after both are closed`);
    }
  } catch {
  }
}

function openWindow(url: string, options: CliOptions, log: Logger): void {
  const chromium = options.browser ? null : findChromium();
  if (chromium) {
    const profile = join(options.dataDir, "browser");
    const fresh = !existsSync(profile);
    mkdirSync(profile, { recursive: true });
    reapHiddenBrowser(profile, log);
    const recorded = fresh ? null : recordedWindowPlacement(options.dataDir);
    const placement = recorded ?? (fresh ? null : savedWindowPlacement(profile));
    const args = appWindowArgs(url, profile, fresh, placement);
    const where = placement
      ? `last seen (${recorded ? "window's own report" : "browser profile"}) at ${placement.left},${placement.top} ${placement.width}x${placement.height}${placement.maximized ? " maximized" : ""}${placement.workArea ? ` on the screen ${placement.workArea.left},${placement.workArea.top}-${placement.workArea.right},${placement.workArea.bottom}` : ""}; flags ${args.filter((a) => a.startsWith("--window-")).join(" ")}`
      : "no saved placement";
    log.info(`opening the app window with ${chromium}: ${where}`);
    try {
      appendFileSync(logFilePath(options.dataDir), `[${new Date().toISOString()}] [launcher] app window: ${where}\n`);
    } catch {
    }
    mkdirSync(options.dataDir, { recursive: true });
    spawn(chromium, args, { cwd: options.dataDir, detached: true, stdio: "ignore" }).unref();
    if (process.platform === "win32") {
      const shortcuts = windowsShortcutPaths(homedir(), process.env, true).filter((p) => existsSync(p));
      if (shortcuts.length) spawn("powershell", ["-NoProfile", "-Command", aumidSyncScript(profile, shortcuts)], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }
    return;
  }
  const advice = options.browser ? null : browserAdvice(null);
  if (advice) {
    log.warn(advice);
    process.stderr.write(`${advice}\n`);
    try {
      appendFileSync(logFilePath(options.dataDir), `[${new Date().toISOString()}] [launcher] ${advice}\n`);
    } catch {
    }
  }
  log.info("opening the default browser");
  exec(openUrlCommand(url), () => undefined);
}

async function runDoctor(options: CliOptions, info: BuildInfo): Promise<void> {
  const lines: string[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  lines.push(`viberoom ${info.version} (build ${info.build})`);
  lines.push(`${major >= 22 ? "ok  " : "FAIL"} node ${process.versions.node}${major >= 22 ? "" : " (viberoom needs Node 22 or newer: https://nodejs.org)"}`);
  const chromium = findChromium();
  lines.push(chromium ? `ok   browser for the app window: ${chromium}` : `warn ${browserAdvice(null)}`);
  const recipes = listRecipes();
  const found = recipes.filter((r) => !r.unavailableReason);
  lines.push(`${found.length ? "ok  " : "warn"} coding agents: ${found.length ? found.map((r) => r.vendor).join(", ") : "none found"}${found.length ? "" : " (install and log in to at least one: Claude Code, Codex, Gemini CLI, Cursor, OpenCode or GitHub Copilot)"}`);
  for (const r of recipes.filter((r) => r.unavailableReason)) lines.push(`     ${r.vendor}: ${r.unavailableReason} (${r.installHint})`);
  for (const r of found.filter((r) => r.loginState === "missing")) lines.push(`warn ${r.vendor}: installed, not logged in: run \`${r.loginCommand}\``);
  const running = await runningInstance(options.port);
  lines.push(running ? `ok   hub running at ${running.url} (build ${running.build ?? "unknown"})` : `info no hub on port ${options.port}: start one with "viberoom start" (or "viberoom start --browser" without a Chromium browser)`);
  lines.push(`     data: ${options.dataDir}`);
  lines.push(`     log:  ${logFilePath(options.dataDir)}`);
  process.stdout.write(lines.join("\n") + "\n");
  if (major < 22) process.exitCode = 1;
}


async function runHub(options: CliOptions, log: Logger, info: BuildInfo): Promise<void> {
  const background = options.command === "serve";
  if (!background) {
    const running = await runningInstance(options.port);
    const other = foreignHub(running, options.dataDir);
    if (other) throw new Error(otherHubMessage(options.port, other, options.dataDir));
    if (running && running.build === info.build) {
      log.info(`viberoom is already running at ${running.url} (same build); opening it.`);
      process.stdout.write(`${running.url}\n`);
      if (options.open) openWindow(running.url, options, log);
      return;
    }
    if (running) {
      log.info(`an older viberoom build is running at ${running.url}; replacing it with the build from ${info.build}`);
      if (!(await stopInstance(running.url, log))) {
        throw new Error(`the older viberoom hub on port ${options.port} did not stop; stop it (viberoom stop, or Ctrl+C in its terminal) and run viberoom again`);
      }
    }
  }

  migrateLegacyData(options.dataDir, log);
  const hub = new Hub(options.dataDir, log, options.name);
  if (options.name && hub.settings.humanName !== options.name) hub.updateSettings({ humanName: options.name });

  let shuttingDown = false;
  let server: RunningServer | undefined;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down: closing agent sessions");
    await hub.shutdown();
    server?.close();
    rmSync(pidFilePath(options.dataDir), { force: true });
    process.exit(0);
  };

  const listenDeadline = Date.now() + 15_000;
  for (;;) {
    try {
      server = await startServer(hub, options.port, log.child("http"), info, () => void shutdown(), () => handOverToFreshHub(options, log));
      break;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "EADDRINUSE") throw error;
      if (Date.now() > listenDeadline) throw new Error(`port ${options.port} is taken by another program (not a viberoom hub). Pick another port: viberoom --port 4811`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  hub.setHubUrl(server.url);
  if (hub.settings.checkForUpdates) {
    void checkForUpdate(hub.dataDir, info.version).then((update) => {
      hub.setUpdate(update);
      if (update.available) log.info(`viberoom ${update.latest} is available (this is ${update.current})`);
      else if (update.error) log.warn(`update check failed: ${update.error}`);
    });
  }
  writePidFile(options.dataDir, { pid: process.pid, port: options.port, build: info.build, startedAt: Date.now(), ...(background ? {} : { foreground: true }) });
  log.info(`viberoom ${info.version} (build ${info.build}) is open at ${server.url} (data: ${hub.dataDir}; rooms: ${[...hub.rooms.values()].map((r) => r.name).join(", ")})`);
  if (info.staleSource) log.warn(`the code on disk is newer than this build (${info.staleSource} changed after dist/ was compiled): the UI is served live, the hub is not; rebuild and restart with: node scripts/update.mjs`);
  process.stdout.write(`${server.url}\n`);
  if (options.open && !background) openWindow(server.url, options, log);

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGHUP", () => void shutdown());
}

function handOverToFreshHub(options: CliOptions, log: Logger): void {
  const args = [fileURLToPath(import.meta.url), "start", "--force", "--port", String(options.port), "--data-dir", options.dataDir, "--no-open"];
  if (options.name) args.push("--name", options.name);
  const child = spawn(process.execPath, args, { cwd: options.dataDir, detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  log.info(`restart requested from the window: a fresh hub is starting (pid ${child.pid})`);
}

async function startBackground(options: CliOptions, log: Logger, info: BuildInfo): Promise<void> {
  const port = hubPortFor(options.port, options.portGiven, liveRecord(options.dataDir));
  const url = `http://127.0.0.1:${port}/`;
  const running = await runningInstance(port);
  const other = foreignHub(running, options.dataDir);
  if (other) throw new Error(otherHubMessage(port, other, options.dataDir));
  if (running && running.build === info.build && !options.force) {
    log.info(`viberoom is already running at ${url} (same build).`);
    process.stdout.write(`${url}\n`);
    if (options.open) openWindow(url, options, log);
    return;
  }
  if (running) {
    log.info(`an older viberoom build is running at ${url}; replacing it with the build from ${info.build}`);
    if (!(await stopInstance(url, log))) throw new Error(`the older viberoom hub on port ${port} did not stop; try: viberoom stop`);
  }
  mkdirSync(options.dataDir, { recursive: true });
  const logPath = logFilePath(options.dataDir);
  rotateLog(logPath);
  const fd = openSync(logPath, "a");
  const args = [fileURLToPath(import.meta.url), "serve", "--port", String(port), "--data-dir", options.dataDir, "--no-open"];
  if (options.name) args.push("--name", options.name);
  const child = spawn(process.execPath, args, { cwd: options.dataDir, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  child.unref();
  closeSync(fd);
  log.info(`hub started in the background (pid ${child.pid}); log: ${logPath}`);
  const up = await waitUntil(async () => (await runningInstance(port))?.build === info.build, 20_000);
  if (!up) throw new Error(`the hub did not come up within 20 s; see ${logPath}`);
  process.stdout.write(`${url}\n`);
  if (options.open) openWindow(url, options, log);
}

async function stopBackground(options: CliOptions, log: Logger): Promise<void> {
  const live = liveRecord(options.dataDir);
  const port = hubPortFor(options.port, options.portGiven, live);
  const url = `http://127.0.0.1:${port}/`;
  const other = foreignHub(await runningInstance(port), options.dataDir);
  if (other) throw new Error(`the hub on port ${port} keeps its rooms in ${other}, not in ${options.dataDir}, so it was left running. To stop that one: viberoom stop --data-dir "${other}"`);
  if (await isUp(url)) {
    const ok = await stopInstance(url, log);
    if (ok) {
      log.info(`hub on port ${port} stopped`);
      rmSync(pidFilePath(options.dataDir), { force: true });
      return;
    }
  }
  if (live) {
    log.warn(`the hub did not answer on ${url}; terminating pid ${live.pid}`);
    try {
      process.kill(live.pid);
    } catch (error) {
      throw new Error(`could not terminate pid ${live.pid}: ${String(error)}`);
    }
    rmSync(pidFilePath(options.dataDir), { force: true });
    return;
  }
  rmSync(pidFilePath(options.dataDir), { force: true });
  log.info("no hub is running");
}

async function showStatus(options: CliOptions): Promise<void> {
  const record = readPidFile(options.dataDir);
  const live = record && isProcessAlive(record.pid) ? record : null;
  const port = hubPortFor(options.port, options.portGiven, live);
  const url = `http://127.0.0.1:${port}/`;
  const running = await runningInstance(port);
  if (running) {
    const other = foreignHub(running, options.dataDir);
    const who = other
      ? ` (a hub of another data folder: ${other}; this folder's hub is not running)`
      : live
        ? ` (${live.foreground ? "pid" : "background pid"} ${live.pid}, started ${new Date(live.startedAt).toLocaleString()})`
        : " (foreground or another data folder)";
    process.stdout.write(`running at ${url}${who}\nbuild: ${running.build ?? "unknown (older build)"}\ndata: ${other ?? options.dataDir}\nlog: ${logFilePath(other ?? options.dataDir)}\n`);
  } else {
    process.stdout.write(`not running on port ${port}${record ? ` (stale pid file: ${record.pid})` : ""}\n`);
    if (record && !isProcessAlive(record.pid)) rmSync(pidFilePath(options.dataDir), { force: true });
  }
}

async function main(): Promise<void> {
  const log = new Logger("hub");
  const options = parseArgs(process.argv.slice(2));
  const info = buildInfo();
  switch (options.command) {
    case "help":
      printHelp();
      return;
    case "start":
      await startBackground(options, log, info);
      return;
    case "stop":
      await stopBackground(options, log);
      return;
    case "status":
      await showStatus(options);
      return;
    case "open": {
      const port = hubPortFor(options.port, options.portGiven, liveRecord(options.dataDir));
      const url = `http://127.0.0.1:${port}/`;
      if (!(await isUp(url))) throw new Error(`no hub is running on port ${port}; start one with: viberoom start`);
      openWindow(url, options, log);
      return;
    }
    case "doctor":
      await runDoctor(options, info);
      return;
    case "logs": {
      const path = logFilePath(options.dataDir);
      process.stdout.write(`${path}\n${tailFile(path, 60)}\n`);
      return;
    }
    case "run":
      if (options.menu) {
        const choice = await runMenu("viberoom: rooms for you and your coding agents");
        if (choice === "quit") return;
        if (choice === "window" || choice === "browser") {
          options.browser = choice === "browser";
          await startBackground(options, log, info);
          return;
        }
        if (choice === "shortcut") {
          const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string };
          const result = installShortcuts({ root: fileURLToPath(new URL("..", import.meta.url)), dataDir: options.dataDir, node: process.execPath, version: pkg.version, desktop: true });
          const advice = browserAdvice(findChromium());
          process.stdout.write(renderInstalled({ files: result.files, notes: result.notes, platform: process.platform, browserAdvice: advice && advice.replace("viberoom opens", "the icon opens viberoom") }, { color: !process.env.NO_COLOR, unicode: unicodeSupported(), columns: process.stdout.columns }));
          if (await askEnter()) {
            process.stdout.write("\n");
            await startBackground(options, log, info);
          }
          return;
        }
      }
      await runHub(options, log, info);
      return;
    case "serve":
      await runHub(options, log, info);
      return;
  }
}

main().catch((error) => {
  process.stderr.write(`viberoom: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
