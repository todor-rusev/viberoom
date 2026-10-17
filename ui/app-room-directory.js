// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ prepareRecord = () => true } = {}) {
    let rooms = new Map(), disposed = false;
    const own = value => root.VIBEROOM_OWNED_JSON.clone(value, "Room record");
    function indexOf(index) {
      return Object.freeze({
        get: id => disposed ? undefined : index.get(id),
        has: id => !disposed && index.has(id),
        *keys() { for (const id of index.keys()) { if (disposed) return; yield id; } },
        *values() { for (const room of index.values()) { if (disposed) return; yield room; } },
        *[Symbol.iterator]() { for (const pair of index) { if (disposed) return; yield pair; } },
      });
    }
    function membershipOf(index) {
      return Object.freeze({
        has: id => !disposed && index.has(id),
        *keys() { for (const id of index.keys()) { if (disposed) return; yield id; } },
      });
    }
    let borrowed = indexOf(rooms), membership = membershipOf(rooms);
    const producer = Object.freeze({
      borrowIndex: () => borrowed,
      acceptSnapshot(values) {
        if (disposed) return;
        const next = new Map();
        for (const value of values) {
          const room = own(value);
          if (prepareRecord(room) === false || disposed) return;
          next.set(room.id, room);
        }
        rooms = next; borrowed = indexOf(rooms); membership = membershipOf(rooms);
      },
      acceptCreated(value) {
        if (disposed) return;
        const room = own(value);
        if (prepareRecord(room) === false || disposed) return;
        rooms.set(room.id, room);
      },
      remove: id => { if (!disposed) rooms.delete(id); },
    });
    function dispose() { if (!disposed) { disposed = true; rooms.clear(); } }
    return Object.freeze({ get reader() { return membership; }, producer, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "preparesRecords", { value: true });
  root.VIBEROOM_ROOM_DIRECTORY = Object.freeze({ create });
})(globalThis);
