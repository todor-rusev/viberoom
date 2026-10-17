// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  const cursorOf = m => ({ order: m.displayOrder ?? m.seq, seq: m.seq });
  const compareCursor = (a, b) => a.order - b.order || a.seq - b.seq;
  const compareMessages = (a, b) => compareCursor(cursorOf(a), cursorOf(b)) || a.id.localeCompare(b.id);
  const unique = rows => [...new Map(rows.map(m => [m.id, m])).values()].sort(compareMessages);
  const knownMessages = room => [...new Map([...(room.pinnedOlder || []), ...room.messages].map(m => [m.id, m])).values()];
  const messageIndexes = new WeakMap();
  let identityRevision = 0;
  function messageIndex(rows) {
    if (!rows?.length) return undefined;
    let index = messageIndexes.get(rows);
    if (!index || index.length !== rows.length || index.revision !== identityRevision) {
      index = { length: rows.length, revision: identityRevision, byId: new Map(rows.map((m, at) => [m.id, { message: m, at }])) };
      messageIndexes.set(rows, index);
    }
    return index;
  }
  const indexedMessage = (rows, id) => messageIndex(rows)?.byId.get(id)?.message;
  const heldMessageById = (room, id) => indexedMessage(room.messages, id);
  const heldMessageIndex = (room, id) => messageIndex(room.messages)?.byId.get(id)?.at ?? -1;
  const messageById = (room, id) => heldMessageById(room, id) || indexedMessage(room.pinnedOlder, id);
  const messageInCollection = (room, id, collection) => collection === "olderPins" ? indexedMessage(room.pinnedOlder, id)
    : collection === "held" ? heldMessageById(room, id) : messageById(room, id);
  function sortMessages(room) {
    room.messages.sort(compareMessages);
    messageIndexes.delete(room.messages);
  }
  function insertMessage(room, message) {
    const rows = room.messages;
    let lo = 0, hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compareMessages(rows[mid], message) <= 0) lo = mid + 1;
      else hi = mid;
    }
    rows.splice(lo, 0, message);
    return lo;
  }
  function renameMessage(message, id) {
    if (message.id === id) return;
    message.id = id;
    identityRevision++;
  }
  const rangeKey = room => room.history?.oldest ? `${room.history.oldest.order}:${room.history.oldest.seq}` : null;
  const capture = room => ({ room, version: room.history?.version, epoch: room.history?.epoch,
    generation: room.historyGeneration || 0, range: rangeKey(room) });
  const sameRange = (room, ticket) => room === ticket.room && (room.historyGeneration || 0) === ticket.generation && rangeKey(room) === ticket.range;
  const current = (room, ticket) => sameRange(room, ticket) && room.history?.version === ticket.version;
  function mergePage(room, page, ticket) {
    if (!current(room, ticket) || !ticket.version || page.version !== ticket.version) return false;
    room.messages = unique([...page.messages, ...room.messages]);
    const loaded = new Set(room.messages.map(m => m.id));
    room.pinnedOlder = (room.pinnedOlder || []).filter(m => !loaded.has(m.id));
    room.history = { ...room.history, epoch: page.epoch, revision: page.revision, version: page.version,
      total: page.total, chats: page.chats, hidden: page.remainingBefore,
      oldest: page.remainingBefore && room.messages.length ? cursorOf(room.messages[0]) : null };
    return true;
  }
  function retainUnchanged(previous, fresh) {
    if (!previous?.history?.version || previous.history.version !== fresh.history?.version) return false;
    fresh.messages = unique([...previous.messages.filter(m => m.seq > 0 && !m.streaming), ...fresh.messages]);
    if (previous.history.indexed) fresh.history.indexed = true;
    const loaded = new Set(fresh.messages.map(m => m.id));
    fresh.pinnedOlder = (fresh.pinnedOlder || []).filter(m => !loaded.has(m.id));
    fresh.history.hidden = Math.max(0, fresh.history.total - fresh.messages.filter(m => m.seq > 0 && !m.streaming).length);
    fresh.history.oldest = fresh.history.hidden && fresh.messages.length ? cursorOf(fresh.messages[0]) : null;
    return true;
  }
  function acceptSnapshot(room, fresh, ticket) {
    if (room !== ticket.room) return false;
    if (ticket.epoch && fresh.history?.epoch !== ticket.epoch) return false;
    if (room.history?.epoch === fresh.history?.epoch && fresh.history?.revision < room.history?.revision) return false;
    return true;
  }
  function count(room, chatsOnly = false) {
    const stored = chatsOnly ? room.history?.chats : room.history?.total;
    if (stored !== undefined) return stored + room.messages.filter(m => m.streaming && (!chatsOnly || m.kind === "chat")).length;
    return room.messages.filter(m => !chatsOnly || m.kind === "chat").length + (room.history?.hidden || 0);
  }
  function syncCount(room) {
    if (room.history?.total === undefined) return;
    if (room.history.indexed) {
      room.history.hidden = 0;
      room.history.oldest = null;
      return;
    }
    room.history.hidden = Math.max(0, room.history.total - room.messages.filter(m => m.seq > 0 && !m.streaming).length);
    room.history.oldest = room.history.hidden && room.messages.length ? cursorOf(room.messages[0]) : null;
  }
  root.HistoryWindow = { cursorOf, compareCursor, compareMessages, knownMessages, heldMessageById, heldMessageIndex, messageById, messageInCollection, renameMessage, sortMessages, insertMessage, capture, sameRange, current, mergePage, retainUnchanged, acceptSnapshot, count, syncCount };
})(typeof window !== "undefined" ? window : globalThis);
