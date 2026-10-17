// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { existsSync } from "node:fs";
import { join } from "node:path";
import { agentDiscovery } from "./agent-discovery.js";
import { RefusedStart, type StopReason } from "./app-start.js";
import { busyMessage, claimPort, reserveHubPort } from "./claim.js";
import { ensureDataRoot } from "./data-root.js";
import { waitForFolder } from "./folder-lock.js";
import { HISTORY_DB_FILE, newerFormatMessage, readDataFormat, SCHEMA_VERSION } from "./history-store.js";
import { upgradeHistory } from "./history-upgrade.js";
import { hostFromVersion, type Host } from "./host.js";
import { Hub } from "./hub.js";
import {
  foreignHub,
  hubUrl,
  isProcessAlive,
  pidFilePath,
  readPidFile,
  removePidFileOf,
  runId,
  writePidFile,
  HUB_ASK_MS,
  type ForeignHub,
  type HubIdentity,
  type PidRecord,
} from "./launcher.js";
import { KEY_HEADER } from "./local-gate.js";
import { readKey } from "./local-key.js";
import type { Logger } from "./log.js";
import { fileNameStore, installOutbound, saveOutboundNames } from "./net/outbound.js";
import { ownNpmPrefix } from "./own-runtime.js";
import { narrowToOwner, whoElseCanReach } from "./private-path.js";
import { recordGroupsIn, stopLeftoverGroups, type GroupRecord } from "./process-groups.js";
import { installVendorsInto, rescanRecipesAsync } from "./recipes.js";
import { startServer, type BuildInfo, type RunningServer, type ServerExtras } from "./server.js";

export async function runningInstance(port: number, dataDir: string, timeoutMs = HUB_ASK_MS, product = "viberoom"): Promise<(HubIdentity & { url: string; host: Host; version: string | null; stopsWithinMs: unknown; startedAt: number | null; stopChecksRun: boolean }) | null> {
  const url = hubUrl(port);
  try {
    const res = await fetch(`${url}api/version`, { headers: keyHeader(dataDir), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const info = (await res.json()) as { name?: unknown; build?: unknown; version?: unknown; dataDir?: unknown; pid?: unknown; host?: unknown; insideBox?: unknown; stopsWithinMs?: unknown; startedAt?: unknown; stopChecksRun?: unknown };
    if (info.name !== product) return null;
    return { url, build: typeof info.build === "string" ? info.build : null, version: typeof info.version === "string" ? info.version : null, dataDir: typeof info.dataDir === "string" ? info.dataDir : null, pid: typeof info.pid === "number" ? info.pid : null, host: hostFromVersion(info), stopsWithinMs: info.stopsWithinMs,
      startedAt: typeof info.startedAt === "number" ? info.startedAt : null, stopChecksRun: info.stopChecksRun === true };
  } catch {
    return null;
  }
}

export function keyHeader(dataDir: string): Record<string, string> {
  const key = readKey(dataDir);
  return key ? { [KEY_HEADER]: key } : {};
}

export function liveRecord(dataDir: string): PidRecord | null {
  const record = readPidFile(dataDir);
  return record && isProcessAlive(record.pid) ? record : null;
}

export function folderHeldMessage(dataDir: string, holder: PidRecord | null, name = "viberoom"): string {
  const who = holder ? `another process (pid ${holder.pid}, port ${holder.port})` : "another process";
  return `the rooms in ${dataDir} are open in ${who}; this ${name} did not open their stores. Use that application, or let it finish before starting again. If none is running, check the saved process record at ${pidFilePath(dataDir)}; a live pid alone does not identify its owner.`;
}

export const viberoomStop = (dataDir: string): string => `viberoom stop --data-dir "${dataDir}"`;

export function otherHubMessage(port: number, other: ForeignHub, mine: string, name = "viberoom", stopCommand: ((dataDir: string) => string) | null = viberoomStop): string {
  const how = other.dataDir
    ? `whose rooms are in ${other.dataDir}, not in ${mine}; it was left alone. Run this one on another port (--port ${port + 1}) or stop that one first${stopCommand ? `: ${stopCommand(other.dataDir)}` : ""}`
    : `that does not serve ${mine}: it serves another folder, or belongs to another account on this machine; it was left alone. Run this one on another port (--port ${port + 1}), or close that one where it runs.`;
  return `port ${port} is used by another ${name} ${how}`;
}

export interface HubRuntimeOptions {
  dataDir: string;
  port: number;
  log: Logger;
  product: string;
  productName?: string;
  stopCommand?: ((dataDir: string) => string) | null;
  build: string;
  name?: string;
  folderWaitMs: number;
  prepareFolder?: () => void;
  beforeStores?: (dataFormat: number) => Promise<void>;
  progress?: (stage: string, done?: number, total?: number) => void;
  migration?: { begin(from: number, to: number): Promise<void>; end(to: number, backup: string | null): void };
  configure?: (hub: Hub, run: { startedAt: number }) => void;
  stoppable?: (stop: (reason: StopReason) => Promise<void>) => void;
  stopping?: (reason: StopReason, withinMs: number) => void;
  server: (hub: Hub) => { info: BuildInfo; extras?: Omit<ServerExtras, "server" | "dataFolder"> };
  onStopRequest: () => void;
  opened?: (server: RunningServer) => void;
  services?: { afterRestart?: boolean; reconnectMode?: "load" | "replay" };
  foreground?: boolean;
  hubOptions?: { backgroundAgentChecks?: boolean };
}

export interface HubRuntime {
  hub: Hub;
  server: RunningServer;
  startedAt: number;
  dataFolder: NonNullable<ServerExtras["dataFolder"]>;
  stop(reason: StopReason): Promise<void>;
}

export async function startHubRuntime(options: HubRuntimeOptions): Promise<HubRuntime | null> {
  const { dataDir, port, log } = options;
  ensureDataRoot(dataDir);
  const folder = await waitForFolder(dataDir, { pid: process.pid, build: options.build }, { timeoutMs: options.folderWaitMs });
  const name = options.productName ?? options.product;
  if (!folder) throw new RefusedStart("folder-owned", folderHeldMessage(dataDir, liveRecord(dataDir), name));
  let reserved: { close(): unknown } | null = null;
  let built: Hub | null = null;
  let server: RunningServer | undefined;
  let starting: Promise<RunningServer> | null = null;
  let letting: Promise<void> | null = null;
  const letGo = (): Promise<void> => (letting ??= (async () => {
    const step = async (what: string, act: () => unknown): Promise<void> => {
      try {
        await act();
      } catch (error) {
        log.warn(`could not let go of ${what}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    await step("the server", async () => {
      if (!server && starting) server = await starting.catch(() => undefined);
      if (server) await server.close();
      else reserved?.close();
    });
    await step("the pid record", () => removePidFileOf(dataDir, process.pid));
    folder.release();
  })());
  try {
    const claim = await claimPort({
      bind: () => reserveHubPort(port),
      ask: async () => {
        const who = await runningInstance(port, dataDir, HUB_ASK_MS, options.product);
        return who ? { build: who.build, dataDir: who.dataDir, pid: who.pid, url: who.url } : null;
      },
      ours: (holder) => !foreignHub({ build: holder.build, dataDir: holder.dataDir, pid: holder.pid }, dataDir),
      onOurs: "wait",
    });
    if (claim.kind === "foreign") {
      const other = foreignHub({ build: claim.holder.build, dataDir: claim.holder.dataDir, pid: claim.holder.pid }, dataDir);
      throw new RefusedStart("foreign-hub", otherHubMessage(port, other ?? { dataDir: claim.holder.dataDir }, dataDir, name, options.stopCommand ?? null));
    }
    if (claim.kind === "ours") throw new RefusedStart("folder-owned", `a ${name} for these rooms already answers at ${claim.holder.url} (build ${claim.holder.build ?? "unknown"}); this one stepped aside before opening its history`);
    if (claim.kind === "busy") throw new RefusedStart("port-busy", busyMessage(port, claim.silentMs));
    reserved = claim.server;

    const leftovers = await stopLeftoverGroups(dataDir);
    const named = (groups: GroupRecord[]): string => groups.map((g) => `${g.label || "?"} (${g.pgid})`).join(", ");
    if (leftovers.stopped.length) log.info(`stopped ${leftovers.stopped.length} process group(s) a previous run left: ${named(leftovers.stopped)}`);
    if (leftovers.leftAlone.length) log.info(`left ${leftovers.leftAlone.length} recorded process group(s) alone, their numbers not provably this folder's any more: ${named(leftovers.leftAlone)}`);
    recordGroupsIn(dataDir);

    options.prepareFolder?.();
    const dataFormat = readDataFormat(dataDir);
    if (dataFormat > SCHEMA_VERSION) throw new RefusedStart("data-format", newerFormatMessage());
    await options.beforeStores?.(dataFormat);

    const startedAt = Date.now();
    installOutbound(log.child("net"), { store: fileNameStore(join(dataDir, "net-names.json")) });
    agentDiscovery.keepOffThread();
    const agentsLog = log.child("agents");
    agentDiscovery.onReport = (line, level) => agentsLog[level](line);
    installVendorsInto(ownNpmPrefix(dataDir));
    options.progress?.("finding-coding-agents");
    await rescanRecipesAsync();
    const migrating = existsSync(join(dataDir, HISTORY_DB_FILE)) && dataFormat < SCHEMA_VERSION;
    let upgradeBackup: string | null = null;
    if (migrating) {
      await options.migration?.begin(dataFormat, SCHEMA_VERSION);
      options.progress?.("migrating-history");
      ({ backup: upgradeBackup } = await upgradeHistory(dataDir, { log: log.child("history"), onProgress: (step) => options.progress?.(step.stage, step.done, step.total) }));
      options.progress?.("opening-stores");
    }
    const hub = new Hub(dataDir, log, options.name, options.hubOptions);
    built = hub;
    if (migrating) options.migration?.end(SCHEMA_VERSION, upgradeBackup);
    options.configure?.(hub, { startedAt });
    if (options.name && hub.settings.humanName !== options.name) hub.updateSettings({ humanName: options.name });

    let stopped: Promise<void> | null = null;
    const stop = (reason: StopReason): Promise<void> => (stopped ??= (async () => {
      try {
        options.stopping?.(reason, hub.shutdownWithinMs());
      } catch (error) {
        log.warn(`the host could not be told this hub is stopping: ${error instanceof Error ? error.message : String(error)}`);
      }
      log.info(`shutting down (${reason}): closing agent sessions`);
      try {
        await hub.shutdown({ onStage: (step) => log.info(`shutdown: ${step.stage} ${step.timedOut ? `gave up after ${step.ms} ms` : `in ${step.ms} ms`}`) });
      } finally {
        saveOutboundNames();
        await letGo();
      }
    })());
    options.stoppable?.(stop);

    let folderAccess = whoElseCanReach(dataDir);
    const dataFolder = {
      path: dataDir,
      state: () => folderAccess,
      narrow: () => {
        narrowToOwner(dataDir, "dir");
        folderAccess = whoElseCanReach(dataDir);
        return folderAccess;
      },
    };
    const asked = options.server(hub);
    starting = startServer(hub, port, log.child("http"), asked.info, options.onStopRequest, { ...asked.extras, server: claim.server, dataFolder });
    server = await starting;
    options.opened?.(server);
    if (stopped) {
      await stopped;
      return null;
    }
    void hub.startServices({ url: server.url, run: { id: runId(process.pid, startedAt), build: options.build }, afterRestart: options.services?.afterRestart, reconnectMode: options.services?.reconnectMode });
    writePidFile(dataDir, { pid: process.pid, port: Number(new URL(server.url).port) || port, build: options.build, startedAt: Date.now(), ...(options.foreground ? { foreground: true } : {}) });
    return { hub: hub, server, startedAt, dataFolder, stop };
  } catch (error) {
    if (built) {
      try {
        await built.shutdown();
      } catch (cleanup) {
        log.warn(`a failed start could not close its hub: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`);
      }
    }
    await letGo();
    throw error;
  }
}
