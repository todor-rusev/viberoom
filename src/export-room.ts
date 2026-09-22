// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { carryHash } from "./carry-history.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hub, StoredRoom } from "./hub.js";
import type { ChatMessage } from "./room.js";
import type { ExportContents, ExportManifest } from "./export-file.js";
import type { ExportFile } from "./export-file.js";
import { ExportUnreadable, readExport, writeExport } from "./export-file.js";
import { contentTypeOf, isStoredFileName } from "./files.js";
import { NAME_PATTERN, ROOM_SETTINGS_SPEC, coerceSetting, type RoomSettings } from "./persona.js";


const SETTINGS_TRAVEL = ["settings", "participants"] as const;

export function roomForExport(stored: Record<string, unknown>): { settings: Record<string, unknown>; participants: Record<string, unknown>[] } {
  const rawSettings = (stored.settings ?? {}) as Record<string, unknown>;
  const settings = Object.fromEntries(Object.keys(ROOM_SETTINGS_SPEC).filter(k => k !== "name" && k !== "humanName" && rawSettings[k] !== undefined).map(k => [k, rawSettings[k]]));
  const fields = ["id", "name", "agentType", "tagline", "role", "avatar", "color", "colorSlot", "launch", "muted", "createdByVibemate", "replyDelay", "skills"];
  const participants = ((stored.participants ?? []) as Record<string, unknown>[]).map(p => Object.fromEntries(fields.filter(k => p[k] !== undefined).map(k => [k, k === "launch" ? Object.fromEntries(["model", "effort", "mode"].filter(x => (p.launch as Record<string, unknown>)?.[x] !== undefined).map(x => [x, (p.launch as Record<string, unknown>)[x]])) : p[k]])));
  const names = new Set<string>(), ids = new Set<string>();
  for (const p of participants) {
    if (typeof p.id !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,199}$/u.test(p.id) || ["human", "system", "hub", "room"].includes(p.id.toLowerCase()) || typeof p.name !== "string" || !NAME_PATTERN.test(p.name) || ids.has(p.id.toLowerCase()) || names.has(p.name.toLowerCase())) throw new ExportUnreadable("The room has invalid, reserved or repeated participant identities.");
    ids.add(p.id.toLowerCase()); names.add(p.name.toLowerCase());
    for (const key of ["agentType", "tagline", "role", "avatar", "color"]) if (p[key] !== undefined && typeof p[key] !== "string") throw new ExportUnreadable(`The participant ${p.name} has invalid ${key}.`);
    if (p.color !== undefined && !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(p.color))) throw new ExportUnreadable(`The participant ${p.name} has an invalid colour.`);
    if (p.colorSlot !== undefined && (!Number.isSafeInteger(p.colorSlot) || Number(p.colorSlot) < 0) || p.replyDelay !== undefined && (typeof p.replyDelay !== "number" || !Number.isFinite(p.replyDelay) || p.replyDelay < 0 || p.replyDelay > 120)) throw new ExportUnreadable(`The participant ${p.name} has invalid colour or timing settings.`);
    if (p.skills !== undefined && (!Array.isArray(p.skills) || p.skills.some(x => typeof x !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(x)))) throw new ExportUnreadable(`The participant ${p.name} has invalid skills.`);
    if (p.launch) for (const v of Object.values(p.launch)) if (v !== null && typeof v !== "string") throw new ExportUnreadable(`The participant ${p.name} has invalid launch options.`);
  }
  for (const key of Object.keys(settings) as (keyof RoomSettings)[]) {
    const spec = ROOM_SETTINGS_SPEC[key];
    if (spec.kind === "boolean" && typeof settings[key] !== "boolean" || spec.kind === "text" && typeof settings[key] !== "string") throw new ExportUnreadable(`The room setting ${key} has the wrong type.`);
    settings[key] = coerceSetting(key, settings[key]);
  }
  return { settings, participants };
}

export interface ExportChoice {
  memory?: boolean;
  userMemory?: boolean;
  conversation?: boolean;
  settings?: boolean;
  resources?: boolean;
}

function picturesOf(messages: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const message of messages) {
    for (const image of ((message as { images?: { file?: string }[] }).images ?? [])) {
      const file = image?.file;
      if (typeof file === "string" && isStoredFileName(file) && !seen.has(file)) seen.add(file);
    }
  }
  return [...seen];
}

function carryPictures(dir: string, names: string[]): { files: ExportFile[]; gone: number } {
  const files: ExportFile[] = [];
  let gone = 0;
  for (const name of names) {
    const path = join(dir, name);
    if (!existsSync(path)) { gone++; continue; }
    const bytes = readFileSync(path);
    files.push({ file: name, mimeType: contentTypeOf(name), bytes: bytes.length, data: bytes.toString("base64") });
  }
  return { files, gone };
}

export function exportRoom(hub: Hub, roomId: string, product: string, choice: ExportChoice = { conversation: true, settings: true }): string {
  const room = hub.rooms.get(roomId);
  if (!room) throw new Error(`no such room: ${roomId}`);
  if (choice.settings !== false && hub.history.memory.read(`room:${room.uuid}`).notes.length) throw new Error("Use Export / Import to carry this room's learned memory with its setup.");
  const stored = room.toStored() as unknown as Record<string, unknown>;
  const { settings, participants } = roomForExport(stored);
  const messages = choice.conversation === false ? undefined : (hub.history.all(roomId) as unknown as Record<string, unknown>[]);
  const graves = choice.conversation === false ? undefined : hub.history.deleted(roomId).map((row) => ({ deletedAt: row.deletedAt, message: row.message as unknown as Record<string, unknown> }));
  const wantsPictures = choice.resources !== false;
  const resourceMessages = wantsPictures ? [...(messages ?? hub.history.all(roomId) as unknown as Record<string, unknown>[]), ...(graves ?? hub.history.deleted(roomId)).map(g => g.message as unknown as Record<string, unknown>)] : [];
  const files = wantsPictures ? carryPictures(room.filesDir(), picturesOf(resourceMessages)).files : undefined;
  return writeExport({
    room: { uuid: room.uuid, id: room.id, name: room.name },
    folder: hub.folderId,
    product,
    ...(messages ? { messages, graves } : {}),
    ...(files ? { files } : {}),
    ...(choice.settings === false ? {} : { settings, participants }),
  });
}

export type SettingsChoice = "take" | "keep-ours" | "none";

export interface ImportOutcome {
  made: boolean;
  messages: { inFile: number; added: number; replaced: number; same: number; keptOurs: number };
  graves: { inFile: number; applied: number; refused: number };
  pictures: { inFile: number; write: number; already: number; missing: number };
  settings: SettingsChoice;
  bothEdited: number;
  unknownParts: number;
}

export interface ImportReport extends ImportOutcome {
  room: { uuid: string; id: string; name: string };
}

export class ImportStale extends Error {}

export interface ImportPreview extends ImportOutcome {
  room: { uuid: string; id: string | null; name: string };
  at: { version: string | null };
  file: { product: string; at: string; parts: string[]; range: ExportManifest["range"] };
}

interface ImportPlan extends ImportPreview {
  take: ChatMessage[];
  bury: { id: string; at: number; message: ChatMessage }[];
  put: ExportFile[];
  contents: ExportContents;
}

function planImport(hub: Hub, text: string): ImportPlan {
  hub.settleImports();
  const contents = readExport(text);
  if (contents.unknownParts) throw new ExportUnreadable("This archive includes parts this version cannot import. Update viberoom before bringing it in.");
  if (contents.settings) {
    const portable = roomForExport({ settings: contents.settings, participants: contents.participants });
    contents.settings = portable.settings;
    contents.participants = portable.participants;
  }
  const carried = contents.manifest.room;
  if (!carried?.uuid) throw new ExportUnreadable("this file does not say which room it holds; it was written by a viberoom older than room identities");

  const room = [...hub.rooms.values()].find((r) => r.uuid === carried.uuid);
  const made = !room;
  const live = room ? new Map(hub.history.all(room.id).map((m) => [m.id, m])) : new Map<string, ChatMessage>();
  const buried = room ? new Map(hub.history.deleted(room.id).map((row) => [row.message.id, row.deletedAt])) : new Map<string, number>();

  const normalize = (m: Record<string, unknown>): ChatMessage => ({ kind: "chat", fromName: String(m.from ?? ""), to: [], toNames: [], ...m } as unknown as ChatMessage);
  const incoming = contents.messages.map(normalize);
  const take: ChatMessage[] = [];
  const counted = { added: 0, replaced: 0, same: 0, keptOurs: 0 };
  let bothEdited = 0;
  for (const message of incoming) {
    const here = live.get(message.id);
    const grave = buried.get(message.id);
    if (!here && grave === undefined) { take.push(message); counted.added++; continue; }
    if (grave !== undefined || carryHash(here as ChatMessage, null) !== carryHash(message, null)) {
      throw new ExportUnreadable("This copy differs from the local conversation. Use Export / Import to review the branches before bringing it in.");
    }
    counted.same++;
  }

  const bury: { id: string; at: number; message: ChatMessage }[] = [];
  let refused = 0;
  for (const grave of contents.graves) {
    const id = String((grave.message as { id?: string }).id ?? "");
    const here = live.get(id);
    const heldGrave = buried.get(id);
    if (here) throw new ExportUnreadable("This copy removes a message that is still here. Use Export / Import to review the branches before bringing it in.");
    if (heldGrave === undefined) bury.push({ id, at: grave.deletedAt, message: normalize(grave.message) });
    else if (carryHash(hub.history.deleted(room!.id).find(g => g.message.id === id)!.message, heldGrave) !== carryHash(normalize(grave.message), grave.deletedAt)) throw new ExportUnreadable("Removed versions differ. Use Export / Import to review the branches.");
    else refused++;
  }

  const dir = room ? room.filesDir() : null;
  const arriving = new Map(contents.files.map((f) => [f.file, f]));
  const write: ExportFile[] = [];
  let already = 0;
  for (const file of contents.files) {
    if (dir && existsSync(join(dir, file.file)) && readFileSync(join(dir, file.file)).equals(Buffer.from(file.data, "base64"))) { already++; continue; }
    if (dir && existsSync(join(dir, file.file))) throw new ExportUnreadable("An attached file differs. Use Export / Import to review it without overwriting the local file.");
    write.push(file);
  }
  const wanted = picturesOf([...take, ...live.values()] as unknown as Record<string, unknown>[]);
  const missing = wanted.filter((name) => !arriving.has(name) && !(dir && existsSync(join(dir, name)))).length;

  return {
    room: { uuid: carried.uuid, id: room?.id ?? null, name: room?.name ?? carried.name },
    at: { version: room ? room.historyStamp().version : null },
    made,
    messages: { inFile: incoming.length, ...counted },
    graves: { inFile: contents.graves.length, applied: bury.length, refused },
    pictures: { inFile: contents.files.length, write: write.length, already, missing },
    settings: !contents.settings ? "none" : made ? "take" : "keep-ours",
    bothEdited,
    unknownParts: contents.unknownParts,
    file: { product: contents.manifest.product, at: contents.manifest.at, parts: contents.manifest.parts, range: contents.manifest.range },
    take,
    bury,
    put: write,
    contents,
  };
}

export function previewImport(hub: Hub, text: string): ImportPreview {
  const { take: _take, bury: _bury, put: _put, contents: _contents, ...preview } = planImport(hub, text);
  return preview;
}

export function importRoom(hub: Hub, text: string, agreedAt?: { version: string | null }): ImportReport {
  const plan = planImport(hub, text);
  if (agreedAt !== undefined && agreedAt.version !== plan.at.version) {
    throw new ImportStale("this room changed after you looked at what the file would do, so what you agreed to is no longer what would happen. Look again, then bring it in.");
  }
  const existing = [...hub.rooms.values()].find((r) => r.uuid === plan.room.uuid);
  const id = existing?.id ?? hub.importedRoomAddress(plan.room.name);
  const stored: StoredRoom = existing?.toStored() ?? { id, uuid: plan.room.uuid, name: plan.room.name, dir: join(hub.dataDir, "rooms", id, "workspace"), createdAt: Date.now(), settings: plan.contents.settings ?? {}, participants: plan.contents.participants as unknown as StoredRoom["participants"] };
  if (!existing || plan.take.length || plan.bury.length || plan.put.length) hub.commitRoomTransfer([{ stored, setup: !existing }], plan.put.map(file => ({ path: join("rooms", id, "files", file.file), data: Buffer.from(file.data, "base64") })), () => {
    for (const message of plan.take) hub.history.upsert(id, message);
    for (const grave of plan.bury) {
      hub.history.upsert(id, grave.message);
      hub.history.markDeleted(id, [grave.id], grave.at);
    }
  });
  const room = hub.getRoom(id);

  const { take: _take, bury: _bury, put: _put, contents: _contents, file: _file, room: _room, at: _at, ...outcome } = plan;
  return { ...outcome, room: { uuid: room.uuid, id: room.id, name: room.name } };
}


export const TRAVELS = SETTINGS_TRAVEL;
