// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import type { Hub } from "./hub.js";

export interface RoomSummary {
  id: string;
  uuid: string;
  name: string;
  scope: string | null;
  dir: string;
}

export interface RoomsApi {
  list(query?: { scope?: string | null }): RoomSummary[];
  create(input: { name: string; dir?: string | null; scope?: string | null }): { room: RoomSummary; notices: string[] };
}

export function roomsApi(hub: Hub): RoomsApi {
  const summary = (room: { id: string; uuid: string; name: string; scope: string | null; dir: string }): RoomSummary =>
    ({ id: room.id, uuid: room.uuid, name: room.name, scope: room.scope, dir: room.dir });
  return {
    list: (query = {}) => [...hub.rooms.values()].filter((room) => query.scope === undefined || room.scope === query.scope).map(summary),
    create: (input) => {
      const { room, notices } = hub.createRoom({ name: input.name, dir: input.dir, scope: input.scope });
      return { room: summary(room), notices };
    },
  };
}
