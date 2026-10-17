// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import type { StoredRoom } from "../hub.js";
import type { Room, StoredParticipant } from "../room.js";

export const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface RoomsFile {
  version: 1;
  rooms: StoredRoom[];
}

export interface AcceptedToken {
  readonly life: number;
}

export interface ArrivingReservation {
  readonly id: string;
}

export interface RoomRegistryPorts {
  dataDir(): string;
  log: { info(text: string): void; warn(text: string): void };
  renamedSkills(): ReadonlyMap<string, string>;
  announce(event: { type: "rooms.opened"; roomIds: string[] }): void;
}

export class RoomRegistry {
  readonly rooms = new Map<string, Room>();
  readonly openRooms: string[] = [];
  readonly #arriving = new Map<string, ArrivingReservation>();
  readonly #addresses = new Map<string, ArrivingReservation>();
  readonly #accepted = new Map<string, { record: StoredRoom; token: AcceptedToken }>();
  readonly #replaced = new WeakMap<AcceptedToken, Map<string, { record: StoredRoom; token: AcceptedToken } | undefined>>();
  #generation = 0;
  #disposed = false;
  #serial = 0;
  renamedAttachments = false;

  constructor(private readonly ports: RoomRegistryPorts) {}

  get life(): number { return this.#generation; }

  get ended(): boolean { return this.#disposed; }

  living(life: number): boolean {
    return !this.#disposed && this.#generation === life;
  }

  holds(room: Room): boolean {
    return this.rooms.get(room.id) === room;
  }

  speaks(room: Room): boolean {
    return !this.#disposed && this.holds(room);
  }

  adopt(room: Room, life: number, reservation?: ArrivingReservation): boolean {
    if (!this.living(life)) return false;
    const held = this.#addresses.get(room.id);
    if (held && held !== reservation) return false;
    this.rooms.set(room.id, room);
    this.#serial++;
    return true;
  }

  drop(room: Room): boolean {
    if (!this.holds(room)) return false;
    this.rooms.delete(room.id);
    this.#serial++;
    const at = this.openRooms.indexOf(room.id);
    if (at >= 0) this.openRooms.splice(at, 1);
    return true;
  }

  get(id: string): Room {
    const room = this.rooms.get(id);
    if (!room) throw new Error(`no such room: ${id}`);
    return room;
  }

  markOpened(id: string): void {
    this.get(id);
    if (this.#disposed || this.openRooms.includes(id)) return;
    this.openRooms.push(id);
    this.ports.announce({ type: "rooms.opened", roomIds: [...this.openRooms] });
  }


  get arriving(): ReadonlySet<string> {
    return new Set(this.#arriving.keys());
  }

  isArriving(id: string): boolean {
    return this.#arriving.has(id);
  }

  reserveArriving(id: string): ArrivingReservation {
    if (!this.addressFree(id)) throw new Error(`the address ${id} is taken`);
    const reservation: ArrivingReservation = Object.freeze({ id });
    this.#arriving.set(id, reservation);
    return reservation;
  }

  holdsArriving(reservation: ArrivingReservation): boolean {
    return this.#arriving.get(reservation.id) === reservation;
  }

  releaseArriving(reservation: ArrivingReservation): void {
    if (this.holdsArriving(reservation)) this.#arriving.delete(reservation.id);
  }

  freeId(name: string): string {
    let id = slugify(name);
    if (!ROOM_ID_PATTERN.test(id)) id = `room-${Date.now().toString(36)}`;
    let candidate = id;
    for (let n = 2; !this.addressFree(candidate); n++) candidate = `${id}-${n}`;
    return candidate;
  }

  addressFree(id: string): boolean {
    return !this.rooms.has(id) && !this.#arriving.has(id) && !this.#addresses.has(id) && !this.#accepted.has(id);
  }


  accept(records: StoredRoom[], life: number): AcceptedToken {
    if (this.#generation !== life) throw new Error("viberoom was reset; nothing was imported.");
    const token: AcceptedToken = Object.freeze({ life });
    const replaced = new Map<string, { record: StoredRoom; token: AcceptedToken } | undefined>();
    for (const record of records) {
      replaced.set(record.id, this.#accepted.get(record.id));
      this.#accepted.set(record.id, { record: structuredClone(record), token });
    }
    this.#replaced.set(token, replaced);
    this.#serial++;
    return token;
  }

  acceptedBy(id: string, token: AcceptedToken): boolean {
    return this.#accepted.get(id)?.token === token;
  }

  built(room: Room, life: number, token: AcceptedToken): boolean {
    if (!this.living(life) || !this.holds(room) || !this.acceptedBy(room.id, token)) return false;
    this.#accepted.delete(room.id);
    this.#serial++;
    return true;
  }

  confirm(token: AcceptedToken): void {
    this.#replaced.delete(token);
  }

  withdraw(token: AcceptedToken): void {
    const replaced = this.#replaced.get(token);
    let any = false;
    for (const [id, entry] of [...this.#accepted]) {
      if (entry.token !== token) continue;
      const before = replaced?.get(id);
      if (before) this.#accepted.set(id, before);
      else this.#accepted.delete(id);
      any = true;
    }
    if (any) this.#serial++;
  }

  get accepted(): ReadonlySet<string> {
    return new Set(this.#accepted.keys());
  }

  reserveAddress(id: string): ArrivingReservation {
    if (!this.addressFree(id)) throw new Error(`the address ${id} is taken`);
    const reservation: ArrivingReservation = Object.freeze({ id });
    this.#addresses.set(id, reservation);
    return reservation;
  }

  releaseAddress(reservation: ArrivingReservation): void {
    if (this.#addresses.get(reservation.id) === reservation) this.#addresses.delete(reservation.id);
  }

  importedAddress(name: string, reserved: ReadonlySet<string> = new Set()): string {
    let base = slugify(name);
    if (!ROOM_ID_PATTERN.test(base)) base = `room-${randomBytes(6).toString("hex")}`;
    let id = base;
    for (let n = 2; !this.addressFree(id) || reserved.has(id) || existsSync(join(this.ports.dataDir(), "rooms", id)); n++) id = `${base.slice(0, 32)}-${n}`;
    return id;
  }


  get path(): string {
    return join(this.ports.dataDir(), "rooms.json");
  }

  readFile(): RoomsFile | null {
    if (!existsSync(this.path)) return null;
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as RoomsFile;
    } catch (error) {
      this.ports.log.warn(`rooms.json unreadable (${String(error)}); starting with no rooms`);
      return null;
    }
  }

  keepAttachments(participants: StoredParticipant[]): StoredParticipant[] {
    const renamed = this.ports.renamedSkills();
    if (!renamed.size) return participants;
    return participants.map((p) => {
      const skills = p.skills?.map((s) => renamed.get(s.toLowerCase()) ?? s);
      if (!skills || skills.every((s, i) => s === p.skills![i])) return p;
      this.ports.log.info(`${p.name}: attached skills follow the renamed copy (${skills.join(", ")})`);
      this.renamedAttachments = true;
      return { ...p, skills };
    });
  }

  save(): boolean {
    return this.write(false);
  }

  saveFinal(): boolean {
    return this.write(true);
  }

  private write(final: boolean): boolean {
    if (this.#disposed && !final) return false;
    const serial = ++this.#serial;
    const still = () => this.#serial === serial && (final || !this.#disposed);
    const rooms = this.records(still);
    if (!rooms) return false;
    const path = this.path;
    if (!still()) return false;
    writeFileAtomic(path, JSON.stringify({ version: 1, rooms } satisfies RoomsFile, null, 2));
    return true;
  }

  project(): { rooms: StoredRoom[]; serial: number } | undefined {
    if (this.#disposed) return undefined;
    const serial = ++this.#serial;
    const rooms = this.records(() => this.stillProjected(serial));
    return rooms && { rooms, serial };
  }

  private records(still: () => boolean): StoredRoom[] | undefined {
    const rooms: StoredRoom[] = [];
    for (const room of [...this.rooms.values()]) {
      const accepted = this.#accepted.get(room.id);
      if (accepted) { rooms.push(structuredClone(accepted.record)); continue; }
      rooms.push(room.toStored());
      if (!still()) return undefined;
    }
    for (const [id, accepted] of this.#accepted) if (!this.rooms.has(id)) rooms.push(structuredClone(accepted.record));
    return rooms;
  }

  stillProjected(serial: number): boolean {
    return !this.#disposed && this.#serial === serial;
  }

  reset(): void {
    this.#generation++;
    this.#serial++;
    this.rooms.clear();
    this.openRooms.length = 0;
    this.#arriving.clear();
    this.#addresses.clear();
    this.#accepted.clear();
    this.renamedAttachments = false;
  }

  dispose(): void {
    this.#disposed = true;
  }
}
