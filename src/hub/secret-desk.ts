// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { randomBytes, randomUUID } from "node:crypto";
import type { PairLink } from "../channels/pairing.js";
import type { ChannelsView } from "../channels/router.js";
import { ConsentChangedError } from "../consent-changed.js";
import { commandLine, type LocalLaunch } from "../connections/local-launch.js";
import { checkHeaderNames } from "../connections/mcp-remote.js";
import { SignInError } from "../connections/oauth.js";
import { ConnectionError, type ConnectionView } from "../connections/service.js";
import type { Hub } from "../hub.js";
import { consentWords, memoryReadiness } from "../memory/config.js";
import { providerEntry } from "../memory/registry.js";
import { TrialBudgetCard, type TrialBudgetSubject } from "../memory/trial-budget-card.js";
import { qrSvg } from "../qr.js";
import type { Room } from "../room.js";
import { readingConsentWords, readingReadiness, voiceConsentWords, voiceReadiness } from "../voice/config.js";
import { voiceProvider } from "../voice/registry.js";
import { CONSENT_FEATURE_WORDS, READ_HERE_WORDS, SECRET_CARD_MS, secretLabel, type ConsentFeature, type SecretRequest } from "./secret-cards.js";

export interface SecretDeskPorts {
  rooms(): ReadonlyMap<string, Room>;
  announce(request: SecretRequest): void;
  log: { info(text: string): void; warn(text: string): void };
  voice: Pick<Hub["voice"], "proveKey" | "set" | "store">;
  memoryStore: Pick<Hub["memoryStore"], "get">;
  setTelegram(patch: { token: string; enabled: boolean }): Promise<ChannelsView>;
  setMemory(patch: Record<string, unknown>): ReturnType<Hub["setMemory"]>;
  pairLink(): { url: string; link: PairLink };
  cancelPairLink(link: PairLink): void;
  connections: Pick<Hub["connections"], "view" | "findByUrl" | "findByLaunch" | "addOwn" | "addOwnLocal" | "setKeys" | "connect" | "cancelSignIn" | "savedKeys">;
  connectSystem(id: string, cardId: string): Promise<ConnectionView>;
}

export class SecretDesk {
  private readonly cards = new Map<string, SecretRequest>();
  private readonly budgets = new WeakMap<SecretRequest, TrialBudgetCard>();
  private readonly askedIn = new WeakMap<SecretRequest, Room>();
  private readonly answering = new WeakSet<SecretRequest>();
  private readonly links = new WeakMap<SecretRequest, PairLink>();
  private readonly signIns = new WeakMap<SecretRequest, Promise<ConnectionView>>();
  private readonly timers = new Map<SecretRequest, ReturnType<typeof setTimeout>>();
  private disposed = false;
  private generation = 0;

  constructor(private readonly ports: SecretDeskPorts) {}

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  reset(): void {
    this.generation++;
    this.revokeTrialBudgetCards("hub_reset");
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.cards.clear();
  }

  private living(life: number): boolean {
    return !this.disposed && this.generation === life;
  }

  private gone(life: number): Error {
    return new Error(this.disposed ? "viberoom is shutting down; no card is asked now" : life !== this.generation ? "viberoom was reset; this card is no longer asked" : "the card is no longer asked");
  }

  private held(request: SecretRequest): boolean {
    return !this.disposed && this.cards.get(request.id) === request;
  }

  private open(request: SecretRequest): boolean {
    return request.state === "open" && this.held(request);
  }

  private timeOut(request: SecretRequest): void {
    if (!this.open(request)) return;
    const timer = setTimeout(() => this.expireSecrets(), request.expiresAt - Date.now() + 50);
    timer.unref();
    this.timers.set(request, timer);
  }

  private guarded(subject: TrialBudgetSubject, life: number): TrialBudgetSubject {
    return {
      snapshot: () => {
        const whole = subject.snapshot();
        if (!this.living(life)) throw this.gone(life);
        return whole;
      },
      current: () => subject.current() === true && this.living(life),
      ready: () => subject.ready() === true && this.living(life),
      start: (approval, verify) => subject.start(approval, verify),
      revoke: () => subject.revoke(),
    };
  }

  askTrialBudget(subject: TrialBudgetSubject): SecretRequest {
    if (this.disposed) throw new Error("viberoom is shutting down; no card is asked now");
    const life = this.generation;
    const session = new TrialBudgetCard(this.guarded(subject, life));
    const open = [...this.cards.values()].find(r => r.state === "open" && r.purpose === "trial-budget" &&
      r.trialBudget?.cardSha256 === session.view.cardSha256);
    if (open) return structuredClone(open);
    const request: SecretRequest = { id: randomUUID(), purpose: "trial-budget", askedBy: { kind: "window" },
      askedAt: session.view.offeredAt, expiresAt: session.view.offerExpiresAt, state: "open", trialBudget: session.view };
    this.cards.set(request.id, request); this.budgets.set(request, session);
    this.ports.announce(structuredClone(request));
    this.timeOut(request);
    return structuredClone(request);
  }

  decideTrialBudget(id: string, body: unknown): SecretRequest {
    const request = this.cards.get(id), session = request && this.budgets.get(request);
    if (!request || request.purpose !== "trial-budget" || !this.open(request) || !session)
      throw new Error("trial_budget_card_unavailable");
    try {
      const outcome = session.decide(body);
      this.settle(request, outcome.state === "claimed" ? "done" : "closed", outcome.state === "claimed" ? `Whole comparison claimed once: ${outcome.claimId}` : "not now");
      return structuredClone(request);
    } catch {
      if (this.open(request)) {
        request.refusal = "The exact whole-budget decision was refused; no new grant is available.";
        if (session.outcome().phase === "closed") this.settle(request, "closed", session.outcome().reason ?? "refused");
        else this.ports.announce(structuredClone(request));
      }
      throw new Error("trial_budget_decision_refused");
    }
  }

  revokeTrialBudgetCards(reason: string): void {
    for (const request of [...this.cards.values()]) {
      if (request.purpose !== "trial-budget") continue;
      const session = this.budgets.get(request);
      if (!this.settle(request, "closed", reason, () => session?.close(reason))) session?.close(reason);
    }
  }

  revokeTrialBudget(id: string): SecretRequest {
    const request = this.cards.get(id), session = request && this.budgets.get(request);
    if (!request || request.purpose !== "trial-budget" || !session) throw new Error("trial_budget_card_unavailable");
    session.close("human_revoked");
    if (!this.held(request)) return structuredClone(request);
    if (!this.settle(request, "closed", "Whole comparison authority withdrawn")) {
      request.outcome = "Whole comparison authority withdrawn";
      this.ports.announce(structuredClone(request));
    }
    return structuredClone(request);
  }

  openSecrets(): SecretRequest[] {
    return [...this.cards.values()].filter((r) => r.state === "open").map(r => r.purpose === "trial-budget" ? structuredClone(r) : r);
  }

  askSecret(purpose: SecretRequest["purpose"], askedBy: SecretRequest["askedBy"], prefill?: SecretRequest["prefill"], connection?: SecretRequest["connection"], consent?: SecretRequest["consent"]): SecretRequest {
    return this.put(this.generation, purpose, askedBy, prefill, connection, consent);
  }

  private put(life: number, purpose: SecretRequest["purpose"], askedBy: SecretRequest["askedBy"], prefill?: SecretRequest["prefill"], connection?: SecretRequest["connection"], consent?: SecretRequest["consent"]): SecretRequest {
    if (!this.living(life)) throw this.gone(life);
    const key = (c?: SecretRequest["connection"]) => c?.add ? `+${c.url ?? c.command}` : c?.id;
    const open = this.openSecrets().find((r) => r.purpose === purpose && (purpose !== "connection" || key(r.connection) === key(connection)) && (purpose !== "consent" || r.consent?.feature === consent?.feature));
    if (open) return open;
    const now = Date.now();
    const request: SecretRequest = { id: randomBytes(9).toString("base64url"), purpose, askedBy, askedAt: now, expiresAt: now + SECRET_CARD_MS, state: "open" };
    if (connection) request.connection = { ...connection };
    if (consent) request.consent = { ...consent };
    const given = Object.entries(prefill ?? {}).filter(([, value]) => typeof value === "string" && value !== "");
    if (given.length) request.prefill = Object.fromEntries(given);
    const issued = purpose === "telegram-pair" ? this.ports.pairLink() : undefined;
    const room = askedBy.kind === "vibemate" ? this.ports.rooms().get(askedBy.roomId) : undefined;
    const refuse = (): Error => { if (issued) this.ports.cancelPairLink(issued.link); return this.gone(life); };
    if (!this.living(life)) throw refuse();
    this.ports.log.info(`secret card ${request.id} (${purpose}) asked by ${askedBy.kind === "window" ? "the window" : `${askedBy.name} in room ${askedBy.roomId}`}`);
    if (!this.living(life)) throw refuse();
    if (issued) {
      request.link = { url: issued.url, expiresAt: issued.link.expiresAt, svg: qrSvg(issued.url) };
      request.expiresAt = issued.link.expiresAt;
      this.links.set(request, issued.link);
    }
    if (room) this.askedIn.set(request, room);
    this.cards.set(request.id, request);
    this.ports.announce(request);
    if (askedBy.kind === "vibemate" && room && this.ports.rooms().get(room.id) === room && this.open(request)) {
      const human = room.settings.humanName;
      room.channelRecord(purpose === "telegram-pair"
        ? `${askedBy.name} asked to pair a phone: a card with the link and its QR code is on ${human}'s screen.`
        : `${askedBy.name} asked for ${secretLabel(request)}: a card is on ${human}'s screen.`);
    }
    this.timeOut(request);
    return request;
  }

  async answerSecret(id: string, value: string): Promise<SecretRequest> {
    const request = this.cards.get(id);
    if (!request || !this.open(request)) throw new Error("that card is no longer open");
    if (request.purpose === "trial-budget") throw new Error("trial_budget_exact_decision_required");
    if (request.purpose === "telegram-pair" || request.purpose === "connection" || request.purpose === "consent") throw new Error("that card takes no value");
    if (!value && !(request.purpose === "voice-key" && request.prefill?.provider === "compatible")) throw new Error("the card is empty: paste the key, or close it without one");
    if (this.answering.has(request)) throw new Error("that card is being answered already");
    this.answering.add(request);
    try {
      let outcome: string;
      if (request.purpose === "voice-key") {
        const provider = request.prefill?.provider ?? "openai";
        const entry = voiceProvider(provider);
        if (!entry) throw new Error(`"${provider}" is not a voice provider`);
        const settings = { ...(value ? { apiKey: value } : {}), ...(request.prefill?.baseUrl ? { baseUrl: request.prefill.baseUrl } : {}), ...(request.prefill?.model ? { model: request.prefill.model } : {}) };
        const proven = await this.ports.voice.proveKey(provider, settings);
        if (!this.open(request)) return request;
        this.ports.voice.set({ provider, settings, ...(request.prefill?.language ? { language: request.prefill.language } : {}) });
        outcome = proven ? `${entry.label} is chosen, its key in the vault, and it answers` : `${entry.label} is chosen${value ? ", its key in the vault" : ""}`;
      } else if (request.purpose === "telegram-token") {
        const view = await this.ports.setTelegram({ token: value, enabled: true });
        const tg = view.telegram;
        if (!tg || (tg.state !== "connected" && tg.state !== "listening")) throw new Error(tg?.detail || "the bot did not start");
        outcome = `connected as @${tg.account}`;
      } else if (request.purpose === "memory-zep-key") {
        const result = await this.ports.setMemory({ provider: "zep", settings: { apiKey: value } });
        if (result.verified && !result.verified.ok) throw new Error(result.verified.reason || "Zep did not accept the key");
        outcome = "the Zep key is in the vault and the provider answers";
      } else {
        await this.ports.setMemory({
          filterMode: "llm", filterApiKey: value,
          ...(request.prefill?.baseUrl ? { filterBaseUrl: request.prefill.baseUrl } : {}),
          ...(request.prefill?.model ? { filterModel: request.prefill.model } : {}),
        });
        outcome = "the sieve key is in the vault";
      }
      this.settle(request, "done", outcome);
      return request;
    } catch (error) {
      if (this.open(request)) {
        request.refusal = error instanceof Error ? error.message : String(error);
        this.ports.announce(request);
      }
      throw error;
    } finally {
      this.answering.delete(request);
    }
  }

  closeSecret(id: string, options: { copied?: boolean } = {}): SecretRequest {
    const request = this.cards.get(id);
    if (!request) throw new Error("no such card");
    if (request.purpose === "trial-budget") {
      this.settle(request, "closed", "not now", () => this.budgets.get(request)?.close());
      return structuredClone(request);
    }
    if (request.purpose === "telegram-pair") {
      const link = options.copied ? undefined : this.links.get(request);
      this.settle(request, "closed", options.copied ? "closed: the link was copied and stays good until it runs out" : "closed without pairing", () => { if (link) this.ports.cancelPairLink(link); });
      return request;
    }
    if (request.purpose === "connection" || request.purpose === "consent") {
      this.settle(request, "closed", "not now", () => this.cancelOwnSignIn(request));
      return request;
    }
    this.settle(request, "closed", "closed without a key");
    return request;
  }

  pairLinkWithdrawn(): void {
    for (const request of this.openSecrets()) {
      if (request.purpose !== "telegram-pair") continue;
      this.settle(request, "closed", "closed: the link was withdrawn");
    }
  }

  private cancelOwnSignIn(request: SecretRequest): void {
    const id = request.connection?.id, own = this.signIns.get(request);
    if (id && own) this.ports.connections.cancelSignIn(id, own);
  }

  askConsent(feature: ConsentFeature, askedBy: SecretRequest["askedBy"], reader?: "system" | "provider"): SecretRequest | null {
    const life = this.generation;
    const who = feature === "reading" ? reader ?? "provider" : undefined;
    if (this.featureOn(feature, who)) return null;
    return this.put(life, "consent", askedBy, undefined, undefined, { feature, words: this.consentWordsNow(feature, who), recipient: this.consentRecipient(feature, who), ...(who ? { reader: who } : {}) });
  }

  private consentRecipient(feature: ConsentFeature, reader?: "system" | "provider"): string {
    if (feature === "memory") return providerEntry(this.ports.memoryStore.get().provider)?.label ?? "the provider";
    if (feature === "reading" && reader === "system") return "this computer's own voices";
    const entry = voiceProvider(this.ports.voice.store.get().provider);
    return !entry ? "the provider" : entry.id === "compatible" ? "your own server" : entry.label;
  }

  private featureOn(feature: ConsentFeature, reader?: "system" | "provider"): boolean {
    if (feature === "memory") return memoryReadiness(this.ports.memoryStore.get()).ready;
    const state = this.ports.voice.store.get();
    if (feature === "voice") return voiceReadiness(state).ready;
    return state.reading.reader === reader && readingReadiness(state).ready;
  }

  private consentWordsNow(feature: ConsentFeature, reader?: "system" | "provider"): string {
    if (feature === "memory") {
      const state = this.ports.memoryStore.get();
      const entry = providerEntry(state.provider);
      if (!entry) throw new Error("no memory provider is chosen yet: its key card, or Settings → Long-term memory, comes first");
      return consentWords(entry, state.filter);
    }
    if (feature === "reading" && reader === "system") return READ_HERE_WORDS;
    const state = this.ports.voice.store.get();
    const entry = voiceProvider(state.provider);
    if (!entry) throw new Error("no voice provider is chosen yet: its key card, or Settings → Voice, comes first");
    const settings = state.providers[entry.id] ?? {};
    return feature === "voice" ? voiceConsentWords(entry, settings) : readingConsentWords(entry, settings);
  }

  private async applyConsent(feature: ConsentFeature, reader: "system" | "provider" | undefined, words: string, changed: string, still: () => boolean): Promise<string | null> {
    if (this.consentWordsNow(feature, reader) !== words) throw new Error(changed);
    if (!still()) return null;
    try {
      if (feature === "memory") await this.ports.setMemory({ consent: true, consentWords: words });
      else if (feature === "voice") this.ports.voice.set({ consent: true, consentWords: words });
      else this.ports.voice.set(reader === "system" ? { reading: { reader: "system" } } : { reading: { reader: "provider", consent: true }, consentWords: words });
    } catch (error) {
      throw error instanceof ConsentChangedError ? new Error(changed) : error;
    }
    return this.featureState(feature);
  }

  async agreeTo(feature: ConsentFeature, words: string, reader?: "system" | "provider"): Promise<string> {
    const life = this.generation;
    const who = feature === "reading" ? reader ?? "provider" : undefined;
    const state = await this.applyConsent(feature, who, words, "What leaves this computer changed since the page showed it: read the words again.", () => this.living(life));
    if (state === null) throw new Error(this.disposed ? "viberoom is shutting down; the consent was not given" : "viberoom was reset; the consent was not given");
    return state;
  }

  async withdrawConsent(feature: ConsentFeature): Promise<void> {
    if (feature === "memory") await this.ports.setMemory({ consent: false });
    else if (feature === "voice") this.ports.voice.set({ consent: false });
    else this.ports.voice.set({ reading: { consent: false } });
  }

  private featureState(feature: ConsentFeature): string {
    const readiness = feature === "memory" ? memoryReadiness(this.ports.memoryStore.get()) : feature === "voice" ? voiceReadiness(this.ports.voice.store.get()) : readingReadiness(this.ports.voice.store.get());
    const name = CONSENT_FEATURE_WORDS[feature];
    return readiness.ready ? `${name} is on` : `${name} is not on yet: ${readiness.reason}`;
  }

  async giveConsent(id: string): Promise<SecretRequest> {
    const request = this.cards.get(id);
    if (!request || !this.open(request) || request.purpose !== "consent" || !request.consent) throw new Error("that card is no longer open");
    if (this.answering.has(request)) throw new Error("that card is being answered already");
    this.answering.add(request);
    const consent = request.consent;
    const { feature, reader } = consent;
    try {
      let outcome: string | null;
      try {
        outcome = await this.applyConsent(feature, reader, consent.words, "What leaves this computer changed since the card opened: read the words again.", () => this.open(request));
      } catch (error) {
        const words = (() => { try { return this.consentWordsNow(feature, reader); } catch { return consent.words; } })();
        const recipient = words !== consent.words ? this.consentRecipient(feature, reader) : consent.recipient;
        if (this.open(request)) {
          if (words !== consent.words) {
            consent.words = words;
            consent.recipient = recipient;
            consent.changed = true;
          }
          request.refusal = error instanceof Error ? error.message : String(error);
          this.ports.announce(request);
        }
        throw error;
      }
      if (outcome !== null) this.settle(request, "done", outcome);
      return request;
    } finally {
      this.answering.delete(request);
    }
  }

  connectionsView(): ConnectionView[] {
    const ids = new Map([...this.ports.rooms().values()].map((room) => [room.uuid, room.id]));
    return this.ports.connections.view().map((view) => view.offInRooms ? { ...view, offInRooms: view.offInRooms.flatMap((uuid) => ids.has(uuid) ? [ids.get(uuid)!] : []) } : view);
  }

  askConnection(id: string, askedBy: SecretRequest["askedBy"]): SecretRequest {
    return this.connectionCard(this.generation, id, askedBy);
  }

  private connectionCard(life: number, id: string, askedBy: SecretRequest["askedBy"]): SecretRequest {
    const view = this.ports.connections.view().find((v) => v.id === id);
    if (!view) throw new ConnectionError(`"${id}" is not a system viberoom connects to`, "unknown-tool");
    return this.put(life, "connection", askedBy, undefined, {
      id, name: view.name, blurb: view.blurb, mark: view.mark, ...(view.url ? { url: view.url } : {}),
      ...(view.command ? { command: view.command } : {}),
      ...(view.keys?.length ? { keys: view.keys, keysIn: view.keysIn, keysSaved: this.ports.connections.savedKeys(id) } : {}),
    });
  }

  askAddConnection(name: string, url: string, askedBy: SecretRequest["askedBy"], headers: readonly string[] = []): { request: SecretRequest; known: boolean } {
    const life = this.generation;
    const known = this.ports.connections.findByUrl(url);
    if (known) return { request: this.connectionCard(life, known, askedBy), known: true };
    const label = name.trim().replace(/\s+/g, " ");
    if (!label || label.length > 60) throw new ConnectionError("give the server a name of 1 to 60 characters", "failed");
    const href = new URL(url.trim()).href;
    const keys = checkHeaderNames([...headers]);
    return {
      request: this.put(life, "connection", askedBy, undefined, { id: "", name: label, blurb: new URL(href).host, url: href, ...(keys.length ? { keys, keysIn: "headers" as const } : {}), add: true }),
      known: false,
    };
  }

  askAddLocalConnection(name: string, launch: LocalLaunch, env: readonly string[], askedBy: SecretRequest["askedBy"]): { request: SecretRequest; known: boolean } {
    const life = this.generation;
    const known = this.ports.connections.findByLaunch(launch);
    if (known) return { request: this.connectionCard(life, known, askedBy), known: true };
    const label = name.trim().replace(/\s+/g, " ");
    if (!label || label.length > 60) throw new ConnectionError("give the server a name of 1 to 60 characters", "failed");
    const command = commandLine(launch);
    return { request: this.put(life, "connection", askedBy, undefined, { id: "", name: label, blurb: "a program on this computer", command, launch: { ...launch, args: [...launch.args] }, ...(env.length ? { keys: [...env], keysIn: "env" as const } : {}), add: true }), known: false };
  }

  async connectCard(cardId: string, keys: Record<string, unknown> = {}): Promise<ConnectionView> {
    const card = this.cards.get(cardId);
    if (!card?.connection || !this.open(card)) throw new Error("that card is no longer open");
    if (this.answering.has(card)) throw new Error("that card is being answered already");
    this.answering.add(card);
    try {
      try {
        if (card.connection.add) {
          card.connection.id = card.connection.launch
            ? this.ports.connections.addOwnLocal(card.connection.name, card.connection.launch, card.connection.keys ?? [])
            : this.ports.connections.addOwn(card.connection.name, card.connection.url!, card.connection.keys ?? []);
          card.connection.add = false;
          if (!this.open(card)) throw new Error("that card is no longer open");
        }
        if (card.connection.keys?.length) await this.ports.connections.setKeys(card.connection.id, keys);
      } catch (error) {
        if (this.open(card)) {
          card.refusal = error instanceof Error ? error.message : String(error);
          this.ports.announce(card);
        }
        throw error;
      }
      if (!this.open(card)) throw new Error("that card is no longer open");
      return await this.ports.connectSystem(card.connection.id, card.id);
    } finally {
      this.answering.delete(card);
    }
  }

  async connectSystem(id: string, cardId?: string): Promise<ConnectionView> {
    const request = cardId ? this.cards.get(cardId) : undefined;
    if (cardId && (!request || !this.open(request) || request.purpose !== "connection" || request.connection?.id !== id)) throw new Error("that card is no longer open");
    if (request?.connection) {
      request.connection.signingIn = true;
      request.refusal = undefined;
      this.ports.announce(request);
    }
    if (this.disposed) throw new Error("viberoom is shutting down; no sign-in begins now");
    if (request && !this.open(request)) throw new Error("that card is no longer open");
    const attempt = this.ports.connections.connect(id);
    if (request) this.signIns.set(request, attempt);
    try {
      const view = await attempt;
      const tools = view.tools ?? [];
      const reads = tools.filter((t) => t.rule === "read").length;
      this.ports.log.info(`connection ${id}: connected, ${tools.length} tools`);
      for (const card of this.openSecrets()) {
        if (card.purpose !== "connection" || card.connection?.id !== id) continue;
        this.settle(card, "done", `connected, ${tools.length} tools (${reads} read, ${tools.length - reads} write and ask first)`);
      }
      return view;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ports.log.warn(`connection ${id}: the sign-in did not finish: ${message}`);
      if (request?.connection && this.open(request)) {
        request.connection.signingIn = false;
        request.refusal = error instanceof SignInError && error.kind === "cancelled" ? `Not connected: ${message}.` : `The sign-in failed: ${message}.`;
        this.ports.announce(request);
      }
      throw error;
    }
  }

  settlePairingCards(name: string): void {
    for (const request of this.openSecrets()) {
      if (request.purpose !== "telegram-pair") continue;
      this.settle(request, "done", `paired: ${name}`);
    }
  }

  expireSecrets(now = Date.now()): void {
    for (const request of [...this.cards.values()]) {
      if (!this.open(request) || request.expiresAt > now) continue;
      this.settle(request, "expired", request.purpose === "telegram-pair" ? "expired: not used within ten minutes" : "not answered within ten minutes", () => {
        if (request.purpose === "trial-budget") this.budgets.get(request)?.close("offer_expired");
        if (request.purpose === "connection") this.cancelOwnSignIn(request);
      });
    }
  }

  private settle(request: SecretRequest, state: "done" | "closed" | "expired", outcome: string, cleanup?: () => void): boolean {
    if (!this.open(request)) return false;
    request.state = state;
    request.outcome = outcome;
    if (state === "done") request.refusal = undefined;
    const timer = this.timers.get(request);
    if (timer) clearTimeout(timer);
    this.timers.delete(request);
    cleanup?.();
    if (!this.held(request)) return true;
    this.ports.log.info(`secret card ${request.id}: ${state} (${request.outcome})`);
    if (!this.held(request)) return true;
    this.ports.announce(request.purpose === "trial-budget" ? structuredClone(request) : request);
    if (request.askedBy.kind !== "vibemate") return true;
    const room = this.askedIn.get(request);
    if (!room || this.ports.rooms().get(room.id) !== room || !this.held(request)) return true;
    const human = room.settings.humanName;
    const participantId = request.askedBy.participantId;
    if (request.purpose === "telegram-pair") {
      room.cardOutcome(
        state === "done" ? `${human} paired the phone from the card: ${request.outcome}.`
          : state === "closed" ? `${human}'s pairing card closed: ${request.outcome}.`
          : "The pairing card was not used within ten minutes and closed by itself.",
        participantId,
      );
      return true;
    }
    if (request.purpose === "consent") {
      const feature = CONSENT_FEATURE_WORDS[request.consent?.feature ?? "voice"];
      room.cardOutcome(
        state === "done" ? `${human} gave their consent on the card: ${request.outcome}.`
          : state === "closed" ? `${human} closed the card for ${feature}: not now.`
          : `The card for ${feature} was not answered within ten minutes and closed by itself.`,
        participantId,
      );
      return true;
    }
    room.cardOutcome(
      state === "done" ? (request.purpose === "connection" ? `${human} connected ${request.connection?.name} from the card: ${request.outcome}.`
        : request.purpose === "voice-key" ? `${human} saved the voice provider's card: ${request.outcome}.`
        : `${human} entered ${secretLabel(request)} on the card: ${request.outcome}.`)
        : state === "closed" ? (request.purpose === "connection" ? `${human} closed the ${request.connection?.name} card: ${request.outcome}.` : `${human} closed the key card without a key.`)
        : "The key card was not answered within ten minutes and closed by itself.",
      participantId,
    );
    return true;
  }
}
