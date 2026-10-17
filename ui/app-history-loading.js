// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create({ window: view = root, signal, recordOf, isShowing, visibleIds,
    get, refreshHeld, renderSoon, onError, conversation, catchUpMs = 2000, catchUps = 4 }) {
    signal?.throwIfAborted();
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const { HistoryWindow } = root;
    const CATCH_UP_MS = catchUpMs, CATCH_UPS = catchUps;
    function dispose() { lifetime.dispose(); }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });

    async function recover(roomId) {
      try { return await lifetime.wait(refreshHeld(roomId)); }
      catch (error) { if (lifetime.disposed) return false; throw error; }
    }

    function releasePage(room) { if (!lifetime.disposed) room.loadingOlder = false; }

    function trimBodyCache(room, extra = []) {
      if (lifetime.disposed || !room.history?.bodyProtocol) return;
      if (!room.history.indexed) return conversation.trimBodies(room);
      const protectedIds = new Set(extra);
      if (isShowing(room)) {
        for (const id of visibleIds()) protectedIds.add(id);
      }
      conversation.trimBodies(room, protectedIds);
    }

    async function caughtUp(room, epoch, revision, waitMs = CATCH_UP_MS) {
      if (lifetime.disposed) throw lifetime.signal.reason;
      if (!epoch || epoch !== room.history?.epoch || !Number.isFinite(revision)) return false;
      const until = Date.now() + waitMs;
      for (;;) {
        if (lifetime.disposed) throw lifetime.signal.reason;
        if (recordOf(room.id) !== room || room.history?.epoch !== epoch) return false;
        if ((room.history?.revision ?? -1) >= revision) return true;
        if (Date.now() >= until) return false;
        await lifetime.delay(20);
      }
    }

    async function loadBodies(room, ids, retry = false) {
      if (lifetime.disposed || !room.history?.indexed || recordOf(room.id) !== room) return false;
      while (room.bodyFlight) {
        try { await lifetime.wait(room.bodyFlight); }
        catch (error) { if (lifetime.disposed && error === lifetime.signal.reason) return false; throw error; }
        if (lifetime.disposed || recordOf(room.id) !== room) return false;
      }
      const wanted = new Set(ids);
      const missing = [...wanted].map(id => HistoryWindow.heldMessageById(room, id)).filter(m => m?.bodyMissing && (retry || !m.bodyError)).slice(0, 64);
      const loaded = id => { const m = HistoryWindow.heldMessageById(room, id); return !!m && !m.bodyMissing; };
      if (!missing.length) return ids.every(loaded);
      conversation.clearBodyErrors(room, missing.map(message => message.id));
      const requested = missing.map(m => m.id);
      const flight = (async () => {
        try {
          let races = 0, catchUps = 0;
          for (let part = 0; part < requested.length + 2; part++) {
            if (lifetime.disposed || recordOf(room.id) !== room) return false;
            const remaining = requested.filter(id => HistoryWindow.heldMessageById(room, id)?.bodyMissing);
            if (!remaining.length) return requested.every(id => !!HistoryWindow.heldMessageById(room, id));
            const generation = room.historyGeneration;
            const q = new URLSearchParams({ version: room.history.version });
            for (const id of remaining) q.append("id", id);
            try {
              const page = await lifetime.wait(get(`/api/rooms/${encodeURIComponent(room.id)}/history/bodies?${q}`));
              if (lifetime.disposed || recordOf(room.id) !== room) return false;
              if (!conversation.mergeBodies(room, page, generation)) {
                if (catchUps < CATCH_UPS && page.revision > (room.history?.revision ?? Infinity) && await caughtUp(room, page.epoch, page.revision)) {
                  catchUps++;
                  continue;
                }
                if (++races > 1) break;
                continue;
              }
              const arrived = page.messages.filter(body => loaded(body.id));
              if (!arrived.length) { if (++races > 1) break; continue; }
              trimBodyCache(room, requested);
              if (isShowing(room)) {
                const drawn = new Set(visibleIds());
                if (arrived.some((body) => drawn.has(body.id))) renderSoon("message bodies arrived");
              }
              if (requested.every(loaded)) return true;
            } catch (error) {
              if (error.code !== "history_changed") throw error;
              if (catchUps < CATCH_UPS && await caughtUp(room, error.data?.epoch, error.data?.revision)) {
                catchUps++;
                continue;
              }
              if (++races > 1) throw error;
              if (!await recover(room.id)) throw error;
            }
          }
          throw new Error("The conversation changed while these messages loaded. Try again.");
        } catch (error) {
          if (lifetime.disposed) return false;
          if (recordOf(room.id) === room) {
            conversation.failBodies(room, wanted, error.message);
            if (isShowing(room)) renderSoon("message loading failed");
          }
          return false;
        }
      })();
      room.bodyFlight = flight;
      try { return await lifetime.wait(flight); }
      catch (error) { if (lifetime.disposed && error === lifetime.signal.reason) return false; throw error; }
      finally { if (room.bodyFlight === flight) room.bodyFlight = null; }
    }

    function wantBodies(room) {
      if (lifetime.disposed || room.bodiesWanted) return;
      room.bodiesWanted = true;
      void (async () => {
        try { while (room.bodyFlight) await lifetime.wait(room.bodyFlight); }
        finally { room.bodiesWanted = false; }
        if (lifetime.disposed || !isShowing(room)) return;
        const drawn = visibleIds();
        if (drawn.length) await loadBodies(room, drawn);
      })().catch(error => { if (!lifetime.disposed) onError(error); });
    }
    async function loadOlder(room, count) {
      if (lifetime.disposed || recordOf(room.id) !== room) return null;
      if (room.loadingOlder) return 0;
      if (!room.history?.version) { onError(new Error("Restart viberoom to load earlier messages.")); return null; }
      const loading = Symbol("history page request");
      room.loadingOlder = loading;
      let inFlight;
      try {
        let got = 0;
        while (room.history && room.history.hidden > 0 && (count === "all" || got < count)) {
          const limit = Math.min(1000, count === "all" ? room.history.hidden : count - got);
          const c = room.history.oldest;
          if (!c) break;
          const ticket = HistoryWindow.capture(room);
          inFlight = ticket;
          const res = await lifetime.wait(get(`/api/rooms/${encodeURIComponent(room.id)}/history?before=${c.order}:${c.seq}&limit=${limit}&version=${encodeURIComponent(ticket.version)}`));
          if (lifetime.disposed || recordOf(room.id) !== room || !HistoryWindow.sameRange(room, ticket)) return null;
          const rows = res.messages || [];
          if (!conversation.mergePage(room, res, ticket)) {
            await recover(room.id);
            return null;
          }
          got += rows.length;
          if (!rows.length) break;
        }
        return got;
      } catch (error) {
        if (!lifetime.disposed && recordOf(room.id) === room && (!inFlight || HistoryWindow.sameRange(room, inFlight))) {
          if (error.code === "history_changed") await recover(room.id);
          else onError(error);
        }
        return null;
      } finally {
        if (room.loadingOlder === loading) room.loadingOlder = false;
      }
    }

    return Object.freeze({ trimBodyCache, caughtUp, loadBodies, wantBodies, loadOlder, releasePage, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "releasesPages", { value: true });
  Object.defineProperty(create, "delegatesConversation", { value: true });
  root.VIBEROOM_HISTORY_LOADING = Object.freeze({ create });
})(globalThis);
