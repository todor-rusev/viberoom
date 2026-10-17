// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const deltas = new Set(["chunk", "thought", "toolcall", "plan"]);
  const isDelta = event => deltas.has(event.type);
  function create({ window: view = root, signal, recordOf, get, releasePage, restorePending, consumeRestore,
    captureReader, foldAll, widenToIndex, replayEvent, returningWithoutAnchor, accepted, stopped, onError, replaceRange }) {
    signal?.throwIfAborted();
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const { HistoryWindow } = root;
    const cursorOf = HistoryWindow.cursorOf;
    const before = (a, b) => HistoryWindow.compareCursor(a, b) < 0;
    function dispose() { lifetime.dispose(); }
    if (signal)
      lifetime.on(signal, "abort", dispose, { once: true });
    async function refreshHeld(roomId, wanted = {}) {
      if (lifetime.disposed) return false;
      const room = recordOf(roomId);
      if (!room) return false;
      const indexOnly = !!wanted.indexOnly && !!room.history?.bodyProtocol && !room.history.indexed
        && !restorePending(room) && !wanted.from && !wanted.all && wanted.seq === undefined && !wanted.messageId;
      if (lifetime.disposed) return false;
      const request = Symbol("history request");
      room.historyRequest = request;
      const current = () => !lifetime.disposed && recordOf(roomId) === room && room.historyRequest === request;
      try {
        room.historyGeneration = (room.historyGeneration || 0) + 1;
        releasePage(room);
        if (!current()) return false;
        room.historyRestoring = !indexOnly;
        room.historyIndexLoading = indexOnly ? request : false;
        room.historyEvents = [];
        const reader = indexOnly ? null : wanted.reader !== undefined ? wanted.reader : captureReader(roomId, false);
        if (!current()) return false;
        const oldMessage = reader && HistoryWindow.knownMessages(room).find(m => m.id === reader.id);
        const from = wanted.from || (room.messages[0] && cursorOf(room.messages[0]));
        for (let attempt = 0; attempt < 3; attempt++) {
          const ticket = HistoryWindow.capture(room);
          const q = new URLSearchParams();
          if (ticket.epoch)
            q.set("epoch", ticket.epoch);
          if (room.history?.bodyProtocol)
            q.set("index", "1");
          else if (wanted.all || foldAll(roomId))
            q.set("all", "1");
          else if (from)
            q.set("from", `${from.order}:${from.seq}`);
          if (wanted.seq !== undefined)
            q.set("seq", wanted.seq);
          if (wanted.messageId)
            q.set("message", wanted.messageId);
          if (!current()) return false;
          const fresh = await lifetime.wait(get(`/api/rooms/${encodeURIComponent(roomId)}?${q}`));
          if (!current()) return false;
          if (!HistoryWindow.acceptSnapshot(room, fresh, ticket))
            continue;
          const liveReader = indexOnly ? captureReader(roomId, true) : reader;
          if (!current()) return false;
          const oldReaderMessage = indexOnly ? liveReader && HistoryWindow.messageById(room, liveReader.id) : oldMessage;
          if (!replaceRange(room, fresh) || !current()) return false;
          room.indexError = null;
          const arrived = room.historyEvents;
          room.historyEvents = null;
          for (const event of arrived) {
            if (!current()) return false;
            if (event.streamSequence > (fresh.history?.streamSequence ?? Infinity))
              replayEvent(roomId, event);
          }
          if (!current()) return false;
          consumeRestore(room);
          if (!current()) return false;
          room.historyRestoring = false;
          room.historyIndexLoading = false;
          room.historyGeneration = (room.historyGeneration || 0) + 1;
          let anchor = liveReader;
          const targetIndex = wanted.messageId ? room.messages.findIndex(m => m.id === wanted.messageId)
            : wanted.seq !== undefined ? room.messages.findIndex(m => m.seq === wanted.seq) : -1;
          if (targetIndex >= 0) {
            widenToIndex(room, targetIndex);
            if (!current()) return false;
            anchor = { id: room.messages[targetIndex].id, into: 12 };
          }
          if (anchor && !HistoryWindow.knownMessages(room).some(m => m.id === anchor.id)) {
            const replacement = oldReaderMessage && room.messages.find(m => !before(cursorOf(m), cursorOf(oldReaderMessage)));
            anchor = replacement ? { ...anchor, id: replacement.id } : null;
          }
          if (wanted.returning && !anchor) {
            returningWithoutAnchor(roomId);
            if (!current()) return false;
          }
          accepted(roomId, { anchor, targetIndex }, current);
          return current();
        }
        throw new Error("The conversation is changing. Try loading its history again.");
      }
      catch (error) {
        if (current()) {
          room.indexError = error.message;
          onError(error);
        }
        return false;
      }
      finally {
        if (room.historyRequest === request) {
          const resumeDrawing = room.historyRestoring;
          room.historyEvents = null;
          room.historyRestoring = false;
          room.historyIndexLoading = false;
          if (current())
            stopped(roomId, { indexOnly, resumeDrawing }, current);
        }
      }
    }
    function bufferDelta(room, event) {
      if (lifetime.disposed || recordOf(room.id) !== room) return;
      if (room.historyEvents && isDelta(event)) room.historyEvents.push(event);
    }
    function invalidateRange(room) {
      if (lifetime.disposed || recordOf(room.id) !== room) return;
      room.historyGeneration = (room.historyGeneration || 0) + 1;
    }
    return Object.freeze({ refreshHeld, bufferDelta, invalidateRange, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "delegatesMembership", { value: true });
  root.VIBEROOM_HISTORY_RECONCILIATION = Object.freeze({ create, isDelta });
})(globalThis);
