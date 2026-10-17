// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanFace, freshFace } from "../faces.js";
import { isIdentity, newIdentity } from "../identity.js";
import { CREATED_MODE, type NewRoomPlan } from "../new-room.js";
import type { RoomSettings } from "../persona.js";
import type { Room } from "../room.js";
import { roomSettingsFromTemplate, type RoomTemplate, type TemplateLibrary } from "../templates.js";
import type { ArrivingReservation, RoomRegistry } from "./room-registry.js";

const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".cursorrules"];

type Seat = { agentType: string; invite: () => Promise<unknown>; unstaffed: () => unknown; failed: (error: unknown) => void; made?: (seated: unknown) => void };
const said = (error: unknown) => error instanceof Error ? error.message : String(error);
type Answer = { status: "created" | "refused"; room?: string; notices: string[] };

export interface RoomLifecyclePorts {
  registry: RoomRegistry;
  dataDir(): string;
  log: { info(text: string): void; warn(text: string): void };
  make(input: { id: string; name: string; dir: string; settings: Partial<RoomSettings>; createdAt: number; uuid: string; scope?: string; life: number; reservation: ArrivingReservation }): Room;
  templates: Pick<TemplateLibrary, "get" | "save">;
  hasSkill(name: string): boolean;
  installed(): ReadonlySet<string>;
  humanName(): string;
  announce(event: { type: "room.created"; room: unknown } | { type: "room.removed"; roomId: string } | { type: "templates" }): void;
  saveRooms(): void;
  keeperReview(): void;
  memory: { detachRoom(id: string): void; forgetRoom(id: string, expected: { uuid: string; provider: string; life: number }): void };
  forgetter(): { id: string; label: string; keySet: boolean } | null;
  identityDrops(room: Room): Array<() => void>;
  dropByAddress(id: string): void;
}

export class RoomLifecycle {
  readonly #removals = new WeakMap<Room, Promise<void>>();
  readonly #answers = new WeakMap<Room, Map<string, Promise<Answer>>>();

  constructor(private readonly ports: RoomLifecyclePorts) {}

  private gone(life: number): Error {
    return new Error(this.ports.registry.ended ? "viberoom is shutting down; no room is made now" : life !== this.ports.registry.life ? "viberoom was reset; this room is not made" : "the room is no longer there");
  }

  private holds(room: Room, life: number): boolean {
    return this.ports.registry.living(life) && this.ports.registry.speaks(room);
  }

  workspaceNotice(dir: string): string | null {
    const found = INSTRUCTION_FILES.filter((f) => existsSync(join(dir, f)));
    if (existsSync(join(dir, ".cursor", "rules"))) found.push(".cursor/rules");
    return found.length ? `The working directory contains ${found.join(", ")}; agents will read these by their own conventions in addition to the room brief.` : null;
  }

  createRoom(input: { name: string; dir?: string | null; settings?: Partial<RoomSettings>; uuid?: string; scope?: string | null }, life = this.ports.registry.life): { room: Room; notices: string[] } {
    const { registry } = this.ports;
    if (!registry.living(life)) throw this.gone(life);
    const name = input.name.trim();
    if (!name || name.length > 60) throw new Error("room name must be 1-60 characters");
    if (input.scope != null && !isIdentity(input.scope)) throw new Error("a room's project must be named by its identity");
    const id = registry.freeId(name);
    const reservation = registry.reserveAddress(id);
    try {
      const notices: string[] = [];
      let dir: string;
      if (input.dir && input.dir.trim()) {
        dir = resolve(input.dir.trim());
        if (!existsSync(dir)) throw new Error(`working directory does not exist: ${dir}`);
        const notice = this.workspaceNotice(dir);
        if (notice) notices.push(notice);
      } else {
        dir = join(this.ports.dataDir(), "rooms", id, "workspace");
        mkdirSync(dir, { recursive: true });
      }
      const settings = input.settings?.emoji === undefined
        ? { ...input.settings, emoji: freshFace("room", [...registry.rooms.values()].map((r) => r.settings.emoji)) }
        : { ...input.settings, emoji: cleanFace(input.settings.emoji, "room") };
      const room = this.ports.make({ id, name, dir, settings, createdAt: Date.now(), uuid: isIdentity(input.uuid) ? input.uuid : newIdentity(), scope: input.scope ?? undefined, life, reservation });
      for (const notice of notices) room.postNotice(notice);
      this.ports.saveRooms();
      this.ports.announce({ type: "room.created", room: room.snapshot() });
      this.ports.log.info(`created room "${name}" (${id}) with workspace ${dir}`);
      return { room, notices };
    } finally {
      registry.releaseAddress(reservation);
    }
  }

  private async seat(room: Room, life: number, seats: Seat[]): Promise<void> {
    for (const one of seats) {
      if (!this.holds(room, life)) throw this.gone(life);
      let seated: unknown;
      try {
        seated = one.agentType ? await one.invite() : one.unstaffed();
      } catch (error) {
        one.failed(error);
        continue;
      }
      if (!this.holds(room, life)) throw this.gone(life);
      one.made?.(seated);
    }
  }

  async createRoomFromTemplate(input: {
    templateId: string;
    name: string;
    dir?: string | null;
    scope?: string | null;
    vibemates: { name: string; agentType: string; model?: string | null; effort?: string | null; mode?: string | null }[];
  }): Promise<{ room: Room; notices: string[] }> {
    const life = this.ports.registry.life;
    if (!this.ports.registry.living(life)) throw this.gone(life);
    const template = this.ports.templates.get(input.templateId);
    if (!template) throw new Error(`no such template: ${input.templateId}`);
    const { room, notices } = this.createRoom({ name: input.name, dir: input.dir || template.dir || null, settings: roomSettingsFromTemplate(template), scope: input.scope ?? null }, life);
    const installed = this.ports.installed();
    const seats = template.vibemates.map((tv, i) => {
      const choice = { ...(input.vibemates[i] ?? { name: tv.name, agentType: "" }) };
      if (!choice.agentType && tv.agentType) {
        if (installed.has(tv.agentType)) choice.agentType = tv.agentType;
        else notices.push(`${choice.name || tv.name}: the template runs it on ${tv.agentType}, which is not installed here; pick another agent in the roster.`);
      }
      const name = choice.name || tv.name;
      const skills = (tv.skills ?? []).filter((skill) => {
        const ok = this.ports.hasSkill(skill);
        if (!ok) notices.push(`${name}: skill "${skill}" is not in the library; not attached.`);
        return ok;
      });
      const seat: Seat = {
        agentType: choice.agentType,
        invite: () => room.inviteAgent({ agentType: choice.agentType, name, tagline: tv.tagline, role: tv.role, avatar: tv.avatar, skills, replyDelay: tv.replyDelay, model: choice.model ?? tv.model, effort: choice.effort ?? tv.effort, mode: choice.mode ?? tv.mode, textCheck: "notice" }),
        unstaffed: () => room.addUnstaffed({ name, tagline: tv.tagline, role: tv.role, avatar: tv.avatar, skills, textCheck: "notice" }),
        failed: (error) => { notices.push(`${name} could not be ${choice.agentType ? "summoned" : "added"}: ${said(error)}`); },
      };
      return seat;
    });
    await this.seat(room, life, seats);
    if (!this.holds(room, life)) throw this.gone(life);
    if (room.settings.customRules.length > room.settings.briefTextLimit) notices.push(`The room rules from the template are ${room.settings.customRules.length} characters, over this room's limit of ${room.settings.briefTextLimit}; kept as they are, but the next edit has to fit.`);
    this.ports.saveRooms();
    return { room, notices };
  }

  async createProposedRoom(plan: NewRoomPlan, by: { proposer: string; human: string }, life = this.ports.registry.life): Promise<{ room: Room; notices: string[] }> {
    const { room, notices } = this.createRoom({ name: plan.name, dir: null, settings: { reachableFromMessengers: false } }, life);
    const installed = this.ports.installed();
    const seats = plan.vibemates.map((one) => {
      const agentType = one.agentType && installed.has(one.agentType) ? one.agentType : "";
      if (one.agentType && !agentType) notices.push(`${one.name}: ${one.agentType} is not installed here; it waits in the roster until you cast it.`);
      const seat: Seat = {
        agentType,
        invite: () => room.inviteAgent({ agentType, name: one.name, tagline: one.tagline, role: one.role, avatar: one.avatar, model: one.model, effort: one.effort, mode: CREATED_MODE, textCheck: "notice" }),
        unstaffed: () => room.addUnstaffed({ name: one.name, tagline: one.tagline, role: one.role, avatar: one.avatar, textCheck: "notice" }),
        failed: (error) => { notices.push(`${one.name} could not be added: ${said(error)}`); },
        made: (seated) => { (seated as { createdByVibemate?: boolean }).createdByVibemate = true; },
      };
      return seat;
    });
    await this.seat(room, life, seats);
    if (!this.holds(room, life)) throw this.gone(life);
    this.ports.registry.markOpened(room.id);
    room.hubRecord(`${by.proposer} proposed this room; ${by.human} created it.`);
    this.ports.saveRooms();
    return { room, notices };
  }

  resolveNewRoom(from: Room, key: string, create: boolean): Promise<Answer> {
    let answers = this.#answers.get(from);
    const running = answers?.get(key);
    if (running) return running;
    if (!answers) { answers = new Map(); this.#answers.set(from, answers); }
    let settle!: { resolve(value: Answer): void; reject(error: unknown): void };
    const answer = new Promise<Answer>((resolve, reject) => { settle = { resolve, reject }; });
    answers.set(key, answer);
    this.answer(from, key, create).then((value) => settle.resolve(value), (error) => settle.reject(error)).finally(() => {
      if (this.#answers.get(from)?.get(key) === answer) this.#answers.get(from)!.delete(key);
    });
    return answer;
  }

  private async answer(from: Room, key: string, create: boolean): Promise<Answer> {
    const life = this.ports.registry.life;
    const proposing = () => this.holds(from, life), refused = () => new Error("no such proposed room");
    if (!proposing()) throw refused();
    const proposal = from.pendingNewRoom(key);
    if (!proposal) throw refused();
    if (!create) {
      from.settleNewRoom(key, "refused");
      return { status: "refused", notices: [] };
    }
    const human = this.ports.humanName();
    const { room, notices } = await this.createProposedRoom(proposal.plan, { proposer: proposal.participantName, human }, life);
    if (!this.holds(room, life)) throw this.gone(life);
    if (proposing()) from.settleNewRoom(key, "created", room.id);
    return { status: "created", room: room.id, notices };
  }

  saveRoomAsTemplate(room: Room, input: { name: string; description: string; emoji?: string; template?: Partial<Pick<RoomTemplate, "dir" | "settings" | "vibemates">> }): RoomTemplate {
    const life = this.ports.registry.life;
    const holds = () => this.holds(room, life), changed = () => new Error("The room changed. Open it again to save it as a template.");
    if (!holds()) throw changed();
    const name = input.name.trim();
    if (!name) throw new Error("the template needs a name");
    const base = room.templateOf();
    const edited = input.template ?? {};
    const saved = this.ports.templates.save({
      name,
      description: input.description.trim(),
      emoji: (input.emoji ?? room.settings.emoji) || undefined,
      dir: edited.dir?.trim() || base.dir,
      settings: { ...base.settings, ...(edited.settings ?? {}) },
      vibemates: edited.vibemates ?? base.vibemates,
    });
    if (!this.ports.registry.ended) this.ports.announce({ type: "templates" });
    return saved;
  }

  forgetRoomMemory(room: Room, providerId: string): void {
    const life = this.ports.registry.life;
    const holds = () => this.holds(room, life), changed = () => new Error("The room changed. Reopen the room settings.");
    if (!holds()) throw changed();
    const forgetter = this.ports.forgetter();
    if (!forgetter || providerId !== forgetter.id) throw new Error("The memory provider changed or cannot forget a room. Reopen the room settings.");
    if (!forgetter.keySet) throw new Error(`Set the ${forgetter.label} key in Settings before requesting deletion.`);
    const expected = { uuid: room.uuid, provider: providerId, life };
    room.updateSettings({ remembers: false });
    this.ports.saveRooms();
    this.ports.memory.forgetRoom(room.id, expected);
  }

  removeRoom(room: Room): Promise<void> {
    const running = this.#removals.get(room);
    if (running) return running;
    let settle!: { resolve(): void; reject(error: unknown): void };
    const removal = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
    this.#removals.set(room, removal);
    this.remove(room).then(() => settle.resolve(), (error) => settle.reject(error)).finally(() => {
      if (this.#removals.get(room) === removal) this.#removals.delete(room);
    });
    return removal;
  }

  private async remove(room: Room): Promise<void> {
    const { registry } = this.ports;
    const life = registry.life, id = room.id, uuid = room.uuid;
    const living = () => registry.living(life);
    if (!living()) throw new Error("viberoom is shutting down; no room is removed now");
    const folder = join(this.ports.dataDir(), "rooms", id), root = join(folder, "..", "..");
    if (!registry.speaks(room)) return;
    this.ports.memory.detachRoom(id);
    await room.shutdown();
    if (!living()) return;
    const dropped = registry.drop(room);
    if (!dropped || !living()) {
      if (living()) this.ports.log.info(`room ${id} was replaced while it was being removed; nothing more is removed`);
      return;
    }
    if (![...registry.rooms.values()].some((other) => other.uuid === uuid)) {
      try {
        for (const drop of this.ports.identityDrops(room)) drop();
      } catch (error) {
        this.ports.log.warn(`history store: room ${id} not dropped: ${said(error)}`);
      }
    }
    const addressFree = registry.addressFree(id);
    if (addressFree) {
      try {
        this.ports.dropByAddress(id);
      } catch (error) {
        this.ports.log.warn(`history store: room ${id} not dropped: ${said(error)}`);
      }
    }
    this.ports.saveRooms();
    if (!addressFree) {
      this.ports.log.info(`removed room ${id}; its address is another room's now, so its folder stays`);
      return;
    }
    this.ports.announce({ type: "room.removed", roomId: id });
    if (existsSync(folder)) {
      const trash = join(root, "trash");
      mkdirSync(trash, { recursive: true });
      const target = join(trash, `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      try {
        renameSync(folder, target);
        this.ports.log.info(`removed room ${id}; its folder is in ${target}`);
      } catch (error) {
        this.ports.log.warn(`removed room ${id}, but its folder could not be moved to trash: ${said(error)}`);
      }
    } else this.ports.log.info(`removed room ${id}`);
    this.ports.keeperReview();
  }
}
