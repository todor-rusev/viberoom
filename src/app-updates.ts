// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { AppHost } from "./app-host.js";
import type { ProductUpdateState } from "./host-protocol.js";
import type { AppKind } from "./host.js";
import type { UpdateInfo, UpdateParts } from "./update.js";

export interface AppUpdatesHeard {
  application: UpdateInfo | null;
  product: ProductUpdateState | null;
}

export function updateOffer(heard: AppUpdatesHeard, productVersion: string, kind: AppKind, now: number): UpdateInfo {
  const p = heard.product;
  const waiting = !!p?.runnableAt && Date.parse(p.runnableAt) > now;
  const productLatest = p && (p.stage === "downloading" || p.stage === "verified") ? p.version : null;
  const product: UpdateParts["product"] = {
    current: productVersion,
    latest: productLatest,
    stage: p?.stage === "downloading" ? "downloading" : p?.stage === "verified" ? (waiting ? "waiting" : "ready") : null,
    ...(Number.isInteger(p?.progress) ? { progress: p!.progress } : {}),
    ...(waiting ? { runnableAt: p!.runnableAt } : {}),
    ...(p?.waitsForApplication ? { waitsForApplication: p.waitsForApplication } : {}),
    checking: p?.stage === "checking",
    ...(p?.checkOutcome ? { outcome: p.checkOutcome } : {}),
    ...(p?.checkedAt ? { checkedAt: p.checkedAt } : {}),
    reason: p?.reason ?? null,
  };
  const a = heard.application;
  const store = kind === "store";
  const application: UpdateParts["application"] = a
    ? { current: a.current, latest: a.latest, available: !store && a.available, ...(a.stage ? { stage: a.stage } : {}), ...(Number.isInteger(a.progress) ? { progress: a.progress } : {}), error: a.error }
    : null;
  const parts: UpdateParts = { product, application, byStore: store };
  if (application?.available && application.latest) {
    return { current: application.current, latest: application.latest, available: true, checkedAt: a!.checkedAt, error: a!.error,
      ...(application.stage ? { stage: application.stage } : {}), ...(application.progress !== undefined ? { progress: application.progress } : {}), parts: { ...parts, acts: "application" } };
  }
  const checkedAt = [a?.checkedAt, p?.checkedAt].filter((t): t is string => !!t).sort().pop() ?? null;
  if (product.latest && product.stage !== "waiting") {
    return { current: productVersion, latest: product.latest, available: true, checkedAt, error: null,
      stage: product.stage === "ready" ? "ready" : "downloading", ...(product.progress !== undefined ? { progress: product.progress } : {}), parts: { ...parts, acts: "product" } };
  }
  return { current: productVersion, latest: product.latest, available: false, checkedAt, error: a?.error ?? null, parts: { ...parts, acts: null } };
}

export interface AppUpdatesControl {
  state(): UpdateInfo;
  check(): Promise<UpdateInfo>;
  apply(): Promise<{ acts: "application" | "product"; version: string }>;
}

export function appUpdates(
  channel: Pick<AppHost, "appUpdateState" | "productUpdateState" | "checkAppUpdate" | "checkProductUpdate" | "installAppUpdate" | "applyProductUpdate">,
  heard: () => AppUpdatesHeard, productVersion: string, kind: AppKind, now: () => number = Date.now,
): AppUpdatesControl {
  const state = () => updateOffer(heard(), productVersion, kind, now());
  return {
    state,
    async check() {
      await Promise.allSettled([channel.checkAppUpdate(), channel.checkProductUpdate()]);
      return state();
    },
    async apply() {
      const offer = state();
      const acts = offer.parts?.acts;
      if (!offer.available || !acts || !offer.latest) throw new Error("no newer version is ready yet");
      const name = acts === "application" ? "the viberoom application" : "viberoom";
      if (offer.stage !== "ready") throw new Error(`${name} ${offer.latest} is still downloading (${offer.progress ?? 0} %); it can be installed when it is ready`);
      if (acts === "application") await channel.installAppUpdate();
      else await channel.applyProductUpdate();
      return { acts, version: offer.latest };
    },
  };
}

export interface OfferClock {
  now(): number;
  set(run: () => void, ms: number): unknown;
  clear(timer: unknown): void;
}
const realClock: OfferClock = {
  now: () => Date.now(),
  set: (run, ms) => { const timer = setTimeout(run, ms); timer.unref?.(); return timer; },
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function followOffer(control: Pick<AppUpdatesControl, "state">, publish: (offer: UpdateInfo) => void, clock: OfferClock = realClock): () => void {
  let dayComes: unknown = null;
  const changed = (): void => {
    const offer = control.state();
    publish(offer);
    if (dayComes !== null) clock.clear(dayComes);
    dayComes = null;
    const at = offer.parts?.product.stage === "waiting" ? Date.parse(offer.parts.product.runnableAt ?? "") : NaN;
    if (Number.isFinite(at)) dayComes = clock.set(changed, Math.min(Math.max(0, at - clock.now()) + 1_000, 2 ** 31 - 1));
  };
  return changed;
}
