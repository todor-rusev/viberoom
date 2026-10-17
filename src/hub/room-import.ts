// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { carriedParticipants } from "../carry-plan.js";
import { ARRIVING, HELD_FILE_RETRIES, removeArrivingFolder } from "../carry-write.js";
import { commitFiles, recoverFileTransactions, type FileChange, type FileOps } from "../file-transaction.js";
import type { HistoryStore } from "../history-store.js";
import type { StoredRoom } from "../hub.js";
import { isIdentity } from "../identity.js";
import { pastRoomSettings } from "../persona.js";
import type { Room } from "../room.js";
import { ROOM_ID_PATTERN, type AcceptedToken, type ArrivingReservation, type RoomRegistry } from "./room-registry.js";

const said = (error: unknown) => error instanceof Error ? error.message : String(error);

export interface ImportContext { readonly life: number }

export interface ImportCommit { built: string[]; unbuilt: string[] }

export interface RoomImportPorts {
  registry: RoomRegistry;
  dataDir(): string;
  log: { info(text: string): void; warn(text: string): void };
  history(): HistoryStore;
  fileOps(): FileOps;
  make(stored: StoredRoom, life: number): Room;
  discard(room: Room): void;
  announce(event: { type: "room.created"; room: unknown }): void;
  reconnectMode(room: Room): "load" | "replay";
  reconnect(room: Room, id: string, mode: "load" | "replay"): Promise<unknown>;
  memoryImported(id: string): void;
  wait(ms: number): Promise<void>;
}

export class Pause {
  readonly #taken = new Map<string, { room: Room; running?: string[] }>();
  readonly #handed = new Map<string, Room>();
  resumed?: Promise<void>;

  constructor(readonly context: ImportContext) {}

  get ids(): string[] { return [...this.#taken.keys()]; }

  handOver(id: string, room: Room): void {
    if (this.#taken.has(id)) this.#handed.set(id, room);
  }

  take(room: Room): void { this.#taken.set(room.id, { room }); }
  release(id: string): void { this.#taken.delete(id); this.#handed.delete(id); }
  ran(id: string, running: string[]): void { const taken = this.#taken.get(id); if (taken) taken.running = running; }
  rooms(): Room[] { return [...this.#taken.values()].map((taken) => taken.room); }
  entry(id: string): { room: Room; running?: string[] } | undefined {
    const taken = this.#taken.get(id);
    return taken && { room: this.#handed.get(id) ?? taken.room, running: taken.running };
  }
}

export class RoomImport {
  constructor(private readonly ports: RoomImportPorts) {}

  context(): ImportContext { return { life: this.ports.registry.life }; }

  living(context: ImportContext): boolean { return this.ports.registry.living(context.life); }

  private ended(context: ImportContext): Error {
    return new Error(this.ports.registry.ended ? "viberoom is shutting down; nothing was imported." : context.life !== this.ports.registry.life ? "viberoom was reset; nothing was imported." : "The import could not go on.");
  }

  private holds(room: Room, context: ImportContext): boolean {
    return this.living(context) && this.ports.registry.speaks(room);
  }

  private say(context: ImportContext, text: string): void {
    try { if (this.living(context)) this.ports.log.warn(text); } catch { }
  }

  settleArriving(): void {
    const { registry } = this.ports;
    if (registry.ended) return;
    const roomsDir = join(this.ports.dataDir(), "rooms");
    if (!existsSync(roomsDir)) return;
    const { remove = rmSync } = this.ports.fileOps(), history = this.ports.history();
    const unsettled: string[] = [];
    for (const entry of readdirSync(roomsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ROOM_ID_PATTERN.test(entry.name)) continue;
      const id = entry.name, folder = join(roomsDir, id);
      if (!existsSync(join(folder, ARRIVING))) continue;
      if (registry.isArriving(id)) continue;
      try {
        if (registry.rooms.has(id)) {
          remove(join(folder, ARRIVING), HELD_FILE_RETRIES);
          this.ports.log.info(`carry import: ${id} had arrived before viberoom stopped; its marker is cleared`);
          continue;
        }
        if (!registry.addressFree(id)) continue;
        history.dropRoom(id);
        removeArrivingFolder(folder, remove);
        this.ports.log.warn(`carry import: viberoom stopped while an import wrote ${id}; what it had written is removed`);
      } catch (error) {
        unsettled.push(`${id} (${said(error)})`);
      }
    }
    if (unsettled.length) throw new Error(`what an earlier import left half written could not all be removed yet: ${unsettled.join("; ")}. A program may be holding one of its files; viberoom tries again at its next start and before the next import.`);
  }

  settle(): void {
    if (this.ports.registry.ended) throw new Error("viberoom is shutting down; an earlier import is settled when it starts again.");
    recoverFileTransactions(this.ports.dataDir(), this.ports.history(), this.ports.fileOps());
    this.settleArriving();
  }

  async pause(context: ImportContext, ids: string[], options: { waiting: (names: string[]) => void; hurry: () => boolean }): Promise<Pause> {
    const { registry } = this.ports;
    if (!this.living(context)) throw this.ended(context);
    const pause = new Pause(context);
    const rooms = ids.map((id) => registry.get(id));
    const look = () => {
      if (!this.living(context)) throw this.ended(context);
      for (const room of pause.rooms()) if (!registry.speaks(room)) pause.release(room.id);
    };
    try {
      for (const room of rooms) {
        pause.take(room);
        room.closeDoor();
      }
      let cut = false;
      for (;;) {
        const writing = pause.rooms().flatMap((room) => room.writingVibemates().map((v) => ({ room, ...v })));
        if (!writing.length) break;
        if (!cut && options.hurry()) {
          cut = true;
          for (const w of writing) w.room.cancelTurn(w.id);
        }
        options.waiting(writing.map((w) => w.name));
        await this.ports.wait(300);
        look();
      }
      for (const room of pause.rooms()) {
        if (pause.entry(room.id)?.room !== room) continue;
        pause.ran(room.id, room.liveVibemates().map((v) => v.id));
        await room.shutdown();
        look();
      }
      return pause;
    } catch (error) {
      try { await this.resume(pause); } catch { }
      throw error;
    }
  }

  resume(pause: Pause): Promise<void> {
    return pause.resumed ??= Promise.resolve().then(() => this.resumeNow(pause));
  }

  private async resumeNow(pause: Pause): Promise<void> {
    const { context } = pause;
    for (const id of pause.ids) {
      const entry = pause.entry(id);
      if (!entry || !this.holds(entry.room, context)) continue;
      const { room, running } = entry;
      try {
        room.reopenDoor();
        if (!running) continue;
        const mode = this.ports.reconnectMode(room);
        for (const pid of running) {
          if (!this.holds(room, context)) break;
          const p = room.participants.get(pid);
          if (!p || p.kind !== "agent" || p.muted) continue;
          try {
            await this.ports.reconnect(room, pid, mode);
          } catch (error) {
            if (this.holds(room, context)) this.say(context, `room ${room.id}: ${p.name} did not come back after the import: ${said(error)}`);
          }
        }
      } catch (error) {
        if (this.holds(room, context)) this.say(context, `room ${room.id}: it did not open again after the import: ${said(error)}`);
      }
    }
  }

  commit(context: ImportContext, changes: { stored: StoredRoom; setup: boolean }[], files: FileChange[], writeRecord: () => void, pause?: Pause): ImportCommit {
    const { registry } = this.ports;
    if (!this.living(context)) throw this.ended(context);
    const projected = registry.project();
    if (!projected) throw this.ended(context);
    const changed = new Map(changes.map(c => [c.stored.id, c]));
    if (changed.size !== changes.length) throw new Error("The import targets a room more than once.");
    const seen = new Map<string, Room | undefined>();
    const dataDir = this.ports.dataDir();
    for (const { stored, setup } of changes) {
      if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(stored.id) || !isIdentity(stored.uuid) || !stored.name.trim() || stored.name.length > 60) throw new Error("The import has invalid room metadata.");
      const room = registry.rooms.get(stored.id);
      seen.set(stored.id, room);
      if (room && room.uuid !== stored.uuid) throw new Error("The target room changed. Preview the import again.");
      if (!room && resolve(stored.dir) !== resolve(dataDir, "rooms", stored.id, "workspace")) throw new Error("A carried room must start with its own local working folder.");
      if (room?.historyDiverted) throw new Error(`The conversation in ${room.name} has unsaved writes. Let those finish before importing.`);
      if (JSON.stringify(stored.scope) !== JSON.stringify(room?.toStored().scope)) throw new Error("The import has invalid room metadata.");
      if (setup && room?.hasConnectedAgents) throw new Error(`The vibemates in ${room.name} are still running. Look at the import again.`);
    }
    for (const change of changes) change.stored = { ...change.stored, settings: pastRoomSettings(change.stored.settings ?? {}) };
    for (const change of changes) {
      const room = registry.rooms.get(change.stored.id);
      if (!change.setup || !room) continue;
      change.stored = { ...change.stored, participants: carriedParticipants(room.toStored().participants, change.stored.participants as unknown as Record<string, unknown>[]) };
    }
    const named = new Set(projected.rooms.map(stored => stored.id));
    const fresh = new Set(changes.filter(c => !named.has(c.stored.id)).map(c => c.stored.id));
    const building = changes.filter(c => c.setup || !registry.rooms.has(c.stored.id)).map(c => c.stored);
    const rooms = projected.rooms.map(stored => changed.get(stored.id)?.stored ?? stored);
    for (const change of changes) if (fresh.has(change.stored.id)) rooms.push(change.stored);
    const workspaces: FileChange[] = [...fresh].map(id => ({ path: join("rooms", id, "workspace"), directory: [] }));
    const history = this.ports.history();
    let token: AcceptedToken | undefined;
    try {
      commitFiles(dataDir, history, [...workspaces, ...files, { path: "rooms.json", data: JSON.stringify({ version: 1, rooms }, null, 2) + "\n" }], () => {
        for (const { stored } of changes) if (!history.migration(stored.id)) history.adoptMirror(stored.id);
        writeRecord();
        if (!this.living(context)) throw this.ended(context);
        if (!registry.stillProjected(projected.serial)) throw new Error("The rooms changed while the import was written. Preview the import again.");
        token = registry.accept(building, context.life);
      }, this.ports.fileOps());
    } catch (error) {
      if (token) registry.withdraw(token);
      throw error;
    }
    const acceptance = token!;
    registry.confirm(acceptance);
    const built: string[] = [], unbuilt: string[] = [];
    const ours = new Map<string, Room>();
    for (const { stored, setup } of changes) {
      const before = registry.rooms.get(stored.id);
      if (before !== seen.get(stored.id)) { unbuilt.push(stored.id); continue; }
      if (before && !setup) {
        try {
          before.importCommitted();
          built.push(stored.id);
          ours.set(stored.id, before);
        } catch (error) {
          unbuilt.push(stored.id);
          this.say(context, `carry import: ${stored.id} shows the import after it is opened again (${said(error)})`);
        }
        continue;
      }
      if (!registry.acceptedBy(stored.id, acceptance)) { unbuilt.push(stored.id); continue; }
      const replacing = setup ? before : undefined;
      let room: Room | undefined;
      try {
        room = this.ports.make(stored, context.life);
        pause?.handOver(stored.id, room);
        room.restore(stored.participants, { quiet: true });
      } catch (error) {
        unbuilt.push(stored.id);
        try {
          if (room && this.holds(room, context)) this.ports.discard(room);
          else if (replacing && this.holds(replacing, context)) this.ports.discard(replacing);
        } catch (cause) {
          this.say(context, `carry import: ${stored.id} could not be taken off the map (${said(cause)})`);
        }
        this.say(context, `carry import: ${stored.id} is imported and is built at the next start (${said(error)})`);
        continue;
      }
      if (!registry.built(room, context.life, acceptance)) {
        unbuilt.push(stored.id);
        try { if (this.holds(room, context)) this.ports.discard(room); }
        catch (cause) { this.say(context, `carry import: ${stored.id} could not be taken off the map (${said(cause)})`); }
        continue;
      }
      built.push(stored.id);
      ours.set(stored.id, room);
      try {
        this.ports.announce({ type: "room.created", room: room.snapshot() });
      } catch (error) {
        this.say(context, `carry import: the windows see ${stored.id} when they load again (${said(error)})`);
      }
    }
    for (const { stored } of changes) {
      if (!ours.has(stored.id)) continue;
      try { this.ports.memoryImported(stored.id); }
      catch (error) { this.say(context, `carry import: the memory of ${stored.id} hears of the import at the next start (${said(error)})`); }
    }
    return { built, unbuilt };
  }

  owns(context: ImportContext, reservation: ArrivingReservation): boolean {
    return this.living(context) && this.ports.registry.holdsArriving(reservation);
  }
}
