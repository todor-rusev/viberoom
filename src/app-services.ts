// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { AppHost } from "./app-host.js";
import type { AutostartControl } from "./autostart.js";
import type { HostInfo } from "./host-protocol.js";
import type { NoPower, Power } from "./keep-awake.js";
import type { Logger } from "./log.js";
import type { RetiredLauncher } from "./mac-app.js";

export function appAutostart(channel: Pick<AppHost, "autostartState" | "setAutostart">): AutostartControl {
  return { status: () => channel.autostartState, setEnabled: (enabled) => channel.setAutostart(enabled) };
}

export const APP_MEANS = "the application";

export function notKeptAwakeNotice(why: string): string {
  return `This computer could not be kept awake while vibemates work (${why}). It may go to sleep by itself and pause their work until it wakes; Settings → System shows the choice for sleep.`;
}

export interface AppPowerOptions {
  channel: Pick<AppHost, "holdAwake" | "releaseAwake">;
  onBattery(): Promise<boolean | null>;
  log: Logger;
  failed(why: string): boolean;
}

export function appPower(o: AppPowerOptions): Power {
  let told = false;
  return {
    means: APP_MEANS,
    hold(reason, ended) {
      let released = false;
      o.channel.holdAwake(reason).catch((error: unknown) => {
        if (released) return;
        const why = `the application did not take the hold: ${error instanceof Error ? error.message : String(error)}`;
        ended(why);
        if (!told) told = o.failed(why);
      });
      return {
        release() {
          released = true;
          o.channel.releaseAwake(reason).catch((error: unknown) => o.log.warn(`the application did not take the release of the hold: ${error instanceof Error ? error.message : String(error)}`));
        },
      };
    },
    onBattery: () => o.onBattery(),
  };
}

export function wakefulnessOf(o: { platform: NodeJS.Platform; byApp: boolean; system: () => Power | NoPower; app: (onBattery: () => Promise<boolean | null>) => Power }): Power | NoPower {
  if (!o.byApp || o.platform === "win32") return o.system();
  const system = o.system();
  return o.app(system.means !== null ? () => system.onBattery() : async () => null);
}

export function retireLauncherFor(host: HostInfo, retire: () => RetiredLauncher | null, log: Logger): RetiredLauncher | null {
  if (host.platform !== "darwin" || (host.kind !== "store" && host.kind !== "installer")) return null;
  try {
    const retired = retire();
    if (retired) log.info(retired.action === "removed" ? `the npm command's launcher gave way to the application: ${retired.from} removed` : `a source checkout's launcher stays beside the application, renamed: ${retired.to}`);
    return retired;
  } catch (error) {
    log.warn(`the old launcher could not be retired: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
