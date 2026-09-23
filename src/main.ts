#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { exec, spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hub } from "./hub.js";
import { Logger, logDateTime, logToFile, sayTheLastWord } from "./log.js";
import { ensureDataRoot, networkFolderNotice } from "./data-root.js";
import { withRunAsNode } from "./own-runtime.js";
import { narrowToOwner, whoElseCanReach, wideOpenNotice } from "./private-path.js";
import { KEY_HEADER, OPENING_PARAM } from "./local-gate.js";
import { mintOpening, readKey } from "./local-key.js";
import { startServer, type BuildInfo, type RunningServer } from "./server.js";
import {
  appWindowArgs,
  recordedWindowPlacement,
  savedWindowPlacement,
  browserAdvice,
  findChromium,
  foreignHub,
  hubPortFor,
  hubUrl,
  isProcessAlive,
  logFilePath,
  openUrlCommand,
  pidFilePath,
  readPidFile,
  rotateLog,
  runtimeLogPath,
  runId,
  splitCommand,
  startReason,
  tailFile,
  writePidFile,
  type Command,
  type ForeignHub,
  type HubIdentity,
  type PidRecord,
} from "./launcher.js";
import { busyMessage, claimPort } from "./claim.js";
import { aumidSyncScript, installShortcuts, windowsShortcutPaths } from "./shortcuts.js";
import { autostartLogPath, autostartStatus, cliAutostartControl, installAutostart, recordAutoStart, refreshAutostart, type AutostartOptions } from "./autostart.js";
import { askEnter, renderInstalled, runMenu, unicodeSupported } from "./tui.js";
import { listRecipes } from "./recipes.js";
import { checkLogin } from "./login-status.js";

interface CliOptions {
  command: Command;
  port: number;
  portGiven: boolean;
  dataDirGiven: boolean;
  dataDir: string;
  name: string | undefined;
  open: boolean;
  browser: boolean;
  menu: boolean;
  force: boolean;
  autostart: boolean;
  autostartMode: "on" | "off" | "status" | null;
  reconnectOnce: "load" | "replay" | null;
  afterRestart: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const { command, rest } = splitCommand(argv);
  const options: CliOptions = {
    command,
    port: 4810,
    portGiven: false,
    dataDir: process.env.VIBEROOM_DATA_DIR ? resolve(process.env.VIBEROOM_DATA_DIR) : resolve(homedir(), ".viberoom"),
    dataDirGiven: !!process.env.VIBEROOM_DATA_DIR,
    name: undefined,
    open: true,
    browser: false,
    menu: true,
    force: false,
    autostart: false,
    autostartMode: null,
    reconnectOnce: null,
    afterRestart: false,
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
        options.dataDirGiven = true;
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
      case "--after-restart":
        options.afterRestart = true;
        break;
      case "--reconnect-once": {
        const mode = next();
        if (mode !== "load" && mode !== "replay") throw new Error("--reconnect-once takes load or replay");
        options.reconnectOnce = mode;
        break;
      }
      case "--autostart":
        options.autostart = true;
        options.open = false;
        options.menu = false;
        break;
      case "on":
      case "off":
      case "status":
        if (options.command !== "autostart") throw new Error(`unknown argument: ${arg}`);
        options.autostartMode = arg;
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
  process.stdout.write(`viberoom: bring your AI assistants together in one conversation

Usage: viberoom [command] [--port 4810] [--data-dir <dir>] [--name Human] [--no-open] [--browser]
       viberoom autostart on | off | status   start viberoom quietly when you sign in to this computer (or not)

Commands
  (none)       in a terminal: a small menu (desktop icon / app window / browser / run here);
               with --open, --no-open or --browser, or without a terminal: run the hub in this
               process and open the window; if a hub is already running, open it (or replace it
               when this build is newer)
  start        run the room hidden in the background (log in <data-dir>/hub.log) and open the window
  stop         stop this data folder's room (found through its pid file; a room of another folder on
               the port is left alone; --port names a port explicitly)
  status       show whether this data folder's room is running, its build and address
  open         open the window of the running room
  logs         print the last lines of the background room's log
  doctor       check Node, the browser, the coding agents and the room; say what is missing and why

Options
  --port       localhost port for the web UI (default 4810)
  --data-dir   where settings, rooms, history, skills and transcripts live (default ~/.viberoom, or $VIBEROOM_DATA_DIR)
  --name       the human's display name (optional; the first start asks in the browser)
  --no-open    do not open a window
  --autostart  the sign-in entry's start: quiet, and a running viberoom is left alone
  --browser    open the default browser instead of a Chromium app window
`);
}

import { checkForUpdate, newerSourceThanBuild } from "./update.js";

function buildInfo(): BuildInfo {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { name: string; version: string };
  const built = statSync(fileURLToPath(import.meta.url)).mtime;
  return {
    name: pkg.name, version: pkg.version, build: built.toISOString(),
    staleSource: newerSourceThanBuild(import.meta.url),
    sourceCheckout: existsSync(fileURLToPath(new URL("../src", import.meta.url))),
  };
}

async function runningInstance(port: number, dataDir: string): Promise<(HubIdentity & { url: string }) | null> {
  const url = hubUrl(port);
  try {
    const res = await fetch(`${url}api/version`, { headers: keyHeader(dataDir), signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const info = (await res.json()) as { name?: unknown; build?: unknown; dataDir?: unknown; pid?: unknown };
    if (info.name !== "viberoom") return null;
    return { url, build: typeof info.build === "string" ? info.build : null, dataDir: typeof info.dataDir === "string" ? info.dataDir : null, pid: typeof info.pid === "number" ? info.pid : null };
  } catch {
    return null;
  }
}

function keyHeader(dataDir: string): Record<string, string> {
  const key = readKey(dataDir);
  return key ? { [KEY_HEADER]: key } : {};
}

function liveRecord(dataDir: string): PidRecord | null {
  const record = readPidFile(dataDir);
  return record && isProcessAlive(record.pid) ? record : null;
}

function otherHubMessage(port: number, other: ForeignHub, mine: string): string {
  const how = other.dataDir
    ? `whose rooms are in ${other.dataDir}, not in ${mine}; it was left alone. Run this one on another port (--port ${port + 1}) or stop that one first: viberoom stop --data-dir "${other.dataDir}"`
    : `that belongs to another account on this machine, not to ${mine}; it was left alone, and it cannot be stopped from here. Run this one on another port (--port ${port + 1}), or ask whoever is signed in there to close it.`;
  return `port ${port} is used by another viberoom ${how}`;
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
    await fetch(`${url}api/version`, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

async function stopInstance(url: string, dataDir: string, log: Logger): Promise<boolean> {
  try {
    await fetch(`${url}api/shutdown`, { method: "POST", headers: keyHeader(dataDir), signal: AbortSignal.timeout(1500) });
  } catch (error) {
    log.warn(`could not ask the running room to stop: ${String(error)}`);
    return false;
  }
  return waitUntil(async () => !(await isUp(url)), 10_000);
}

function migrateLegacyData(dataDir: string, log: Logger): void {
  const legacy = resolve(fileURLToPath(new URL("../data/", import.meta.url)));
  if (existsSync(join(dataDir, "rooms.json")) || !existsSync(join(legacy, "rooms.json"))) return;
  if (resolve(legacy) === resolve(dataDir)) return;
  ensureDataRoot(dataDir);
  for (const entry of readdirSync(legacy)) cpSync(join(legacy, entry), join(dataDir, entry), { recursive: true });
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

function openingAddress(url: string, dataDir: string): string {
  const key = readKey(dataDir);
  return key ? `${url}?${OPENING_PARAM}=${mintOpening(key)}` : url;
}

function openWindow(address: string, options: CliOptions, log: Logger): void {
  ensureDataRoot(options.dataDir);
  const url = openingAddress(address, options.dataDir);
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
      appendFileSync(logFilePath(options.dataDir), `[${logDateTime()}] [launcher] app window: ${where}\n`);
    } catch {
    }
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
      appendFileSync(logFilePath(options.dataDir), `[${logDateTime()}] [launcher] ${advice}\n`);
    } catch {
    }
  }
  log.info("opening the default browser");
  exec(openUrlCommand(url), { windowsHide: true }, () => undefined);
}

async function runDoctor(options: CliOptions, info: BuildInfo): Promise<void> {
  const lines: string[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  lines.push(`viberoom ${info.version} (build ${info.build})`);
  const minor = Number(process.versions.node.split(".")[1]);
  const nodeOk = major >= 24 || (major === 23 && minor >= 8) || (major === 22 && minor >= 16);
  lines.push(`${nodeOk ? "ok  " : "FAIL"} node ${process.versions.node}${nodeOk ? "" : " (viberoom needs Node 22.16 or newer for its conversation store: https://nodejs.org)"}`);
  const chromium = findChromium();
  lines.push(chromium ? `ok   browser for the app window: ${chromium}` : `warn ${browserAdvice(null)}`);
  const onTheNetwork = networkFolderNotice(options.dataDir);
  if (onTheNetwork) lines.push(`warn ${onTheNetwork}`);
  const recipes = listRecipes();
  const found = recipes.filter((r) => !r.unavailableReason);
  lines.push(`${found.length ? "ok  " : "warn"} coding agents: ${found.length ? found.map((r) => r.vendor).join(", ") : "none found"}${found.length ? "" : " (install and log in to at least one: Claude Code, Codex, Gemini CLI, Cursor, OpenCode or GitHub Copilot)"}`);
  for (const r of recipes.filter((r) => r.unavailableReason)) lines.push(`     ${r.vendor}: ${r.unavailableReason} (${r.installHint})`);
  const probeDir = join(tmpdir(), "viberoom-doctor");
  mkdirSync(probeDir, { recursive: true });
  const checks = await Promise.all(found.map(async (r) => [r, await checkLogin(r.loginStatus, r.build({ model: null, mode: null }), probeDir)] as const));
  for (const [r, c] of checks) {
    const how = `${r.vendor} reports`;
    if (c.state === "ok") lines.push(`ok   ${r.vendor}: logged in (${how}: ${c.detail})`);
    else if (c.state === "missing") lines.push(`warn ${r.vendor}: installed, not logged in: run \`${r.loginCommand}\` (${how}: ${c.detail})`);
    else lines.push(`info ${r.vendor}: installed; whether it is logged in could not be told (${how}: ${c.detail})`);
  }
  const running = await runningInstance(options.port, options.dataDir);
  lines.push(running ? `ok   the room is running at ${running.url} (build ${running.build ?? "unknown"})` : `info no room on port ${options.port}: start one with "viberoom start" (or "viberoom start --browser" without a Chromium browser)`);
  lines.push(`     data: ${options.dataDir}`);
  lines.push(`     log:  ${logFilePath(options.dataDir)}`);
  const auto = autostartStatus(autostartOptions(options));
  if (!auto.enabled) lines.push('info autostart at sign-in: off (Settings, or "viberoom autostart on")');
  else if (auto.targetMissing) lines.push(`warn autostart entry points at a missing file (${auto.target ?? auto.script}): switch it off before removing viberoom ("viberoom autostart off")`);
  else lines.push(`ok   autostart at sign-in: on (${auto.entry})${auto.stale ? "; it points at an older copy of viberoom and the next start fixes it" : ""}`);
  lines.push(`     last automatic start: ${auto.lastAutoStartAt ? new Date(auto.lastAutoStartAt).toLocaleString() : "never"}; launcher log: ${auto.log}`);
  process.stdout.write(lines.join("\n") + "\n");
  if (major < 22) process.exitCode = 1;
}


async function runHub(options: CliOptions, log: Logger, info: BuildInfo): Promise<void> {
  const background = options.command === "serve";
  ensureDataRoot(options.dataDir);
  logToFile(logFilePath(options.dataDir), { alsoStderr: !background });
  faultFolder = options.dataDir;
  if (!background) {
    const running = await runningInstance(options.port, options.dataDir);
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
      if (!(await stopInstance(running.url, options.dataDir, log))) {
        throw new Error(`the older viberoom on port ${options.port} did not stop; stop it (viberoom stop, or Ctrl+C in its terminal) and run viberoom again`);
      }
      options.afterRestart = true;
    }
  }

  if (!options.dataDirGiven) migrateLegacyData(options.dataDir, log);
  const runStartedAt = Date.now();
  const hub = new Hub(options.dataDir, log, options.name);
  faultWitness = () => hub.writingNow();
  hub.restartWith = (sessions) => handOverToFreshHub(options, log, sessions);
  if (options.name && hub.settings.humanName !== options.name) hub.updateSettings({ humanName: options.name });

  let shuttingDown = false;
  let server: RunningServer | undefined;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down: closing agent sessions");
    await hub.shutdown({ onStage: (step) => log.info(`shutdown: ${step.stage} ${step.timedOut ? `gave up after ${step.ms} ms` : `in ${step.ms} ms`}`) });
    server?.close();
    rmSync(pidFilePath(options.dataDir), { force: true });
    process.exit(0);
  };

  let folderAccess = whoElseCanReach(hub.dataDir);
  const dataFolder = {
    path: hub.dataDir,
    state: () => folderAccess,
    narrow: () => {
      narrowToOwner(hub.dataDir, "dir");
      folderAccess = whoElseCanReach(hub.dataDir);
      return folderAccess;
    },
  };

  const claim = await claimPort<Awaited<ReturnType<typeof startServer>>>({
    bind: () => startServer(hub, options.port, log.child("http"), info, () => void shutdown(), { autostart: cliAutostartControl(autostartOptions(options)), dataFolder, run: { startedAs: startReason(options), startedAt: runStartedAt } }),
    ask: async () => {
      const who = await runningInstance(options.port, options.dataDir);
      return who ? { build: who.build, dataDir: who.dataDir, pid: who.pid, url: who.url } : null;
    },
    ours: (holder) => !foreignHub({ build: holder.build, dataDir: holder.dataDir, pid: holder.pid }, options.dataDir),
    onOurs: "wait",
  });
  if (claim.kind === "foreign") {
    const other = foreignHub({ build: claim.holder.build, dataDir: claim.holder.dataDir, pid: claim.holder.pid }, options.dataDir);
    throw new Error(otherHubMessage(options.port, other ?? { dataDir: claim.holder.dataDir }, options.dataDir));
  }
  if (claim.kind === "ours") throw new Error(`a viberoom for these rooms already answers at ${claim.holder.url} (build ${claim.holder.build ?? "unknown"}); this one stepped aside rather than open the same history twice`);
  if (claim.kind === "busy") throw new Error(busyMessage(options.port, claim.silentMs));
  server = claim.server;
  void hub.startServices({ url: server.url, run: { id: runId(process.pid, runStartedAt), build: info.build }, afterRestart: options.afterRestart, reconnectMode: options.reconnectOnce ?? undefined });
  if (hub.settings.checkForUpdates) {
    void checkForUpdate(hub.dataDir, info.version).then((update) => {
      hub.setUpdate(update);
      if (update.available) log.info(`viberoom ${update.latest} is available (this is ${update.current})`);
      else if (update.error) log.warn(`update check failed: ${update.error}`);
    });
  }
  writePidFile(options.dataDir, { pid: process.pid, port: options.port, build: info.build, startedAt: Date.now(), ...(background ? {} : { foreground: true }) });
  log.info(`viberoom ${info.version} (build ${info.build}) is open at ${server.url} (data: ${hub.dataDir}; rooms: ${[...hub.rooms.values()].map((r) => r.name).join(", ")})`);
  if (info.staleSource) log.warn(`the code on disk is newer than this build (${info.staleSource} changed after dist/ was compiled): the UI is served live, the room is not; rebuild and restart with: node scripts/update.mjs`);
  const reach = wideOpenNotice(hub.dataDir, dataFolder.state());
  if (reach) log.warn(reach);
  const onTheNetwork = networkFolderNotice(hub.dataDir);
  if (onTheNetwork) log.warn(onTheNetwork);
  if (process.stdout.isTTY) process.stdout.write(`${server.url}\n`);
  if (options.open && !background) openWindow(server.url, options, log);

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGHUP", () => void shutdown());
}

function handOverToFreshHub(options: CliOptions, log: Logger, sessions?: "load" | "replay"): void {
  const args = [fileURLToPath(import.meta.url), "start", "--force", "--port", String(options.port), "--data-dir", options.dataDir, "--no-open"];
  if (options.name) args.push("--name", options.name);
  if (sessions) args.push("--reconnect-once", sessions);
  args.push("--after-restart");
  const fd = openSync(runtimeLogPath(options.dataDir), "a");
  const child = spawn(process.execPath, args, { cwd: options.dataDir, detached: true, stdio: ["ignore", fd, fd], windowsHide: true, env: withRunAsNode() });
  child.unref();
  closeSync(fd);
  log.info(`restart requested from the window: a fresh room is starting (pid ${child.pid})`);
}

function autostartOptions(options: CliOptions): AutostartOptions {
  return { root: fileURLToPath(new URL("..", import.meta.url)), dataDir: options.dataDir, node: process.execPath };
}

async function startAtSignIn(options: CliOptions, log: Logger, info: BuildInfo): Promise<void> {
  const note = (line: string): void => {
    try {
      mkdirSync(join(options.dataDir, "launcher"), { recursive: true });
      appendFileSync(autostartLogPath(options.dataDir), `[${logDateTime()}] ${line}\n`);
    } catch {
    }
  };
  try {
    const port = hubPortFor(options.port, options.portGiven, liveRecord(options.dataDir));
    const running = await runningInstance(port, options.dataDir);
    if (running) {
      const other = foreignHub(running, options.dataDir);
      const whose = !other ? "this data folder" : (other.dataDir ?? "another account on this machine");
      note(`a viberoom already answers on port ${port} (${whose}, build ${running.build ?? "unknown"}); left alone`);
      recordAutoStart(options.dataDir);
      return;
    }
    const how = await launchHiddenHub(options, log, info, port);
    recordAutoStart(options.dataDir);
    note(how === "started" ? `started the room on port ${port} (build ${info.build})` : `a viberoom for these rooms was already answering on port ${port}; this start stepped aside`);
  } catch (error) {
    note(`could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function refreshSignInEntry(options: CliOptions, log: Logger): void {
  try {
    if (refreshAutostart(autostartOptions(options))) log.info("the sign-in entry named another build's paths: rewritten");
  } catch (error) {
    log.warn(`the sign-in entry could not be refreshed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runAutostartCommand(options: CliOptions): void {
  const o = autostartOptions(options);
  const status = options.autostartMode === "on" ? installAutostart(o, true) : options.autostartMode === "off" ? installAutostart(o, false) : autostartStatus(o);
  const lines = [
    status.enabled ? `autostart at sign-in: on (${status.entry})` : status.foreign ? `autostart at sign-in: off here; another viberoom data folder's entry starts at sign-in (${status.entry}); "autostart on" here takes it over` : "autostart at sign-in: off",
    ...(status.targetMissing ? [`warn the entry points at a missing file (${status.target ?? status.script}): switch it off before removing viberoom`] : []),
    ...(status.stale ? ["     the entry points at an older copy of viberoom; the next start fixes it"] : []),
    ...(status.note ? [`     ${status.note}`] : []),
    `set up: ${status.installedAt ? new Date(status.installedAt).toLocaleString() : "never"}; last automatic start: ${status.lastAutoStartAt ? new Date(status.lastAutoStartAt).toLocaleString() : "never"}`,
    `launcher log: ${status.log}`,
    ...(options.autostartMode ? [] : ["(viberoom autostart on | off)"]),
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

async function startBackground(options: CliOptions, log: Logger, info: BuildInfo): Promise<void> {
  if (options.autostart) return startAtSignIn(options, log, info);
  const port = hubPortFor(options.port, options.portGiven, liveRecord(options.dataDir));
  const url = hubUrl(port);
  const running = await runningInstance(port, options.dataDir);
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
    if (!(await stopInstance(url, options.dataDir, log))) throw new Error(`the older viberoom on port ${port} did not stop; try: viberoom stop`);
    options.afterRestart = true;
  }
  const how = await launchHiddenHub(options, log, info, port);
  if (how === "already-running") log.info(`a viberoom for these rooms was already answering at ${url}; this start stepped aside`);
  refreshSignInEntry(options, log);
  process.stdout.write(`${url}\n`);
  if (options.open) openWindow(url, options, log);
}

async function launchHiddenHub(options: CliOptions, log: Logger, info: BuildInfo, port: number): Promise<"started" | "already-running"> {
  ensureDataRoot(options.dataDir);
  const logPath = logFilePath(options.dataDir);
  const runtimePath = runtimeLogPath(options.dataDir);
  rotateLog(runtimePath);
  const fd = openSync(runtimePath, "a");
  const args = ["--disable-warning=ExperimentalWarning", fileURLToPath(import.meta.url), "serve", "--port", String(port), "--data-dir", options.dataDir, "--no-open"];
  if (options.name) args.push("--name", options.name);
  if (options.reconnectOnce) args.push("--reconnect-once", options.reconnectOnce);
  if (options.afterRestart) args.push("--after-restart");
  const child = spawn(process.execPath, args, { cwd: options.dataDir, detached: true, stdio: ["ignore", fd, fd], windowsHide: true, env: withRunAsNode() });
  child.unref();
  closeSync(fd);
  log.info(`the room started in the background (pid ${child.pid}); log: ${logPath}`);
  const up = await waitUntil(async () => (await runningInstance(port, options.dataDir))?.build === info.build, 20_000);
  if (up) return "started";
  const holder = await runningInstance(port, options.dataDir);
  if (holder && !foreignHub(holder, options.dataDir)) return "already-running";
  throw new Error(`the room did not come up within 20 s; see ${logPath}`);
}

async function stopBackground(options: CliOptions, log: Logger): Promise<void> {
  const live = liveRecord(options.dataDir);
  const port = hubPortFor(options.port, options.portGiven, live);
  const url = hubUrl(port);
  const other = foreignHub(await runningInstance(port, options.dataDir), options.dataDir);
  if (other) throw new Error(`the room on port ${port} keeps its rooms in ${other}, not in ${options.dataDir}, so it was left running. To stop that one: viberoom stop --data-dir "${other}"`);
  if (await isUp(url)) {
    const ok = await stopInstance(url, options.dataDir, log);
    if (ok) {
      log.info(`the room on port ${port} stopped`);
      rmSync(pidFilePath(options.dataDir), { force: true });
      return;
    }
  }
  if (live) {
    log.warn(`the room did not answer on ${url}; terminating pid ${live.pid}`);
    try {
      process.kill(live.pid);
    } catch (error) {
      throw new Error(`could not terminate pid ${live.pid}: ${String(error)}`);
    }
    rmSync(pidFilePath(options.dataDir), { force: true });
    return;
  }
  rmSync(pidFilePath(options.dataDir), { force: true });
  log.info("no room is running");
}

async function showStatus(options: CliOptions): Promise<void> {
  const record = readPidFile(options.dataDir);
  const live = record && isProcessAlive(record.pid) ? record : null;
  const port = hubPortFor(options.port, options.portGiven, live);
  const url = hubUrl(port);
  const running = await runningInstance(port, options.dataDir);
  if (running) {
    const other = foreignHub(running, options.dataDir);
    const who = other
      ? other.dataDir
        ? ` (a room of another data folder: ${other.dataDir}; this folder's room is not running)`
        : " (a room of another account on this machine; this folder's room is not running)"
      : live
        ? ` (${live.foreground ? "pid" : "background pid"} ${live.pid}, started ${new Date(live.startedAt).toLocaleString()})`
        : " (foreground or another data folder)";
    const mine = other ? other.dataDir : options.dataDir;
    process.stdout.write(`running at ${url}${who}\nbuild: ${running.build ?? "unknown (older build)"}\n` + (mine ? `data: ${mine}\nlog: ${logFilePath(mine)}\n` : ""));
  } else {
    process.stdout.write(`not running on port ${port}${record ? ` (stale pid file: ${record.pid})` : ""}\n`);
    if (record && !isProcessAlive(record.pid)) rmSync(pidFilePath(options.dataDir), { force: true });
  }
}

function assertNodeSupported(): void {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const ok = major >= 24 || (major === 23 && minor >= 8) || (major === 22 && minor >= 16);
  if (!ok) {
    process.stderr.write(`viberoom needs Node 22.16 or newer (23.8+, 24+): this is ${process.versions.node}. https://nodejs.org\n`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  assertNodeSupported();
  const log = new Logger("power");
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
      const url = hubUrl(port);
      if (!(await isUp(url))) throw new Error(`no room is running on port ${port}; start one with: viberoom start`);
      openWindow(url, options, log);
      return;
    }
    case "doctor":
      await runDoctor(options, info);
      return;
    case "autostart":
      runAutostartCommand(options);
      return;
    case "logs": {
      const path = logFilePath(options.dataDir);
      process.stdout.write(`${path}\n${tailFile(path, 60)}\n`);
      const runtime = tailFile(runtimeLogPath(options.dataDir), 40);
      if (runtime.trim()) process.stdout.write(`\n${runtimeLogPath(options.dataDir)} (what the runtime itself said)\n${runtime}\n`);
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
          const result = installShortcuts({ root: fileURLToPath(new URL("..", import.meta.url)), dataDir: options.dataDir, node: process.execPath, port: hubPortFor(options.port, options.portGiven, liveRecord(options.dataDir)), version: pkg.version, desktop: true });
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

let faultFolder: string | null = null;
let faultWitness: (() => string[]) | null = null;

sayTheLastWord({ remember: () => faultFolder, witness: () => faultWitness?.() });

main().catch((error) => {
  process.stderr.write(`viberoom: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
