// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const projectionRules = Object.freeze({
    timelineHeaders: Object.freeze(["id", "from", "kind", "pinned", "seq", "displayOrder", "ts"]),
    writes: Object.freeze({ chunk: "text", thought: "thought", toolcall: "tools", plan: "plan", acceptDelivery: "delivery",
      clearBodyErrors: "bodyState", failBodies: "bodyState", upsert: "all", adopt: "all" }),
    fields: Object.freeze(Object.fromEntries(Object.entries({ text: ["text"], thought: ["thought"], tools: ["toolCalls"], plan: ["plan"],
      delivery: ["bodyDelivery"], bodyState: ["bodyMissing", "bodyChars", "bodyError"] }).map(([part, fields]) => [part, Object.freeze(fields)]))),
  });
  function create({ window: view = root, signal, recordOf, aboveHeld, adopted, removed, delivered, bufferDelta,
    projectionChanged = () => {}, projectionRemoved = () => {}, projectionReset = () => {}, collectionsChanged = () => {} }) {
    signal?.throwIfAborted();
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const { HistoryWindow, WindowBodies } = root;
    let revisions = new WeakMap();
    let identities = new WeakMap(), snapshots = new WeakMap(), collections = new WeakMap(), pendingCollections = new WeakMap(), chatCountsCache = new WeakMap();
    const current = room => { if (lifetime.disposed) return false; const held = recordOf(room.id); return !lifetime.disposed && held === room; };
    function dispose() { lifetime.dispose(); revisions = new WeakMap(); identities = new WeakMap(); snapshots = new WeakMap(); collections = new WeakMap(); pendingCollections = new WeakMap(); chatCountsCache = new WeakMap(); }
    if (signal) lifetime.on(signal, "abort", dispose, { once: true });
    const revision = message => lifetime.disposed ? 0 : revisions.get(message) || 0;
    const snapshotRevision = message => lifetime.disposed ? 0 : snapshots.get(message) || 0;
    function collectionsOf(room) {
      if (!current(room)) return undefined;
      let value = collections.get(room);
      if (!value) { value = Object.freeze(Object.fromEntries(["held", "olderPins", "pins", "heldHeaders", "olderPinHeaders", "heldChats", "historyOverview"].map(key => [key, Object.freeze({})]))); collections.set(room, value); }
      return value;
    }
    function chatCounts(room) {
      const stamp = collectionsOf(room)?.heldChats;
      if (!stamp) return undefined;
      const cached = chatCountsCache.get(room);
      if (cached?.stamp === stamp) return current(room) && collections.get(room)?.heldChats === stamp ? cached.value : undefined;
      let held = 0, streaming = 0;
      for (const row of room.messages) if (row.kind === "chat") { held++; if (row.streaming) streaming++; }
      if (!current(room) || collections.get(room)?.heldChats !== stamp) return undefined;
      const value = Object.freeze({ held, streaming });
      chatCountsCache.set(room, { stamp, value });
      return value;
    }
    function markCollections(room, changed) {
      if (lifetime.disposed) return false;
      const value = collections.get(room) || Object.fromEntries(["held", "olderPins", "pins", "heldHeaders", "olderPinHeaders", "heldChats", "historyOverview"].map(key => [key, Object.freeze({})]));
      if (changed.held) changed = { ...changed, heldChats: true, historyOverview: true };
      const next = { ...value };
      for (const key of Object.keys(changed)) if (changed[key]) next[key] = Object.freeze({});
      collections.set(room, Object.freeze(next));
      const pending = { ...pendingCollections.get(room) };
      for (const key of Object.keys(changed)) if (changed[key]) pending[key] = true;
      pendingCollections.set(room, Object.freeze(pending));
      return true;
    }
    function publishCollections(room) {
      if (lifetime.disposed) return false;
      const change = pendingCollections.get(room);
      pendingCollections.delete(room);
      if (!change) return true;
      collectionsChanged(room, change);
      return current(room);
    }
    function identity(message) {
      if (lifetime.disposed || !message) return undefined;
      if (!identities.has(message)) identities.set(message, Object.freeze({}));
      return identities.get(message);
    }
    function markSnapshot(message) { snapshots.set(message, snapshotRevision(message) + 1); }
    function markEdited(message) { revisions.set(message, revision(message) + 1); markSnapshot(message); }
    function changedProjection(room, message, write, toolIds, toolVersions) {
      const token = identities.get(message), part = projectionRules.writes[write], fields = projectionRules.fields[part];
      if (token) projectionChanged(room, Object.freeze({ token, snapshotRevision: snapshotRevision(message),
        part, timelineHeadersChanged: !fields || fields.some(field => projectionRules.timelineHeaders.includes(field)), ...(toolIds ? { toolIds: Object.freeze(toolIds) } : {}),
        ...(toolVersions ? { toolVersions: Object.freeze(toolVersions.map(tool => Object.freeze({ toolCallId: tool.toolCallId,
          detailsAvailable: tool.detailsAvailable, detailsRevision: tool.detailsRevision }))) } : {}) }));
      return current(room) && publishCollections(room);
    }
    function removedProjections(room, sources) {
      const tokens = sources.map(message => identities.get(message)).filter(Boolean);
      if (tokens.length) projectionRemoved(room, Object.freeze(tokens));
      return current(room) && publishCollections(room);
    }
    function resetProjections(room) { projectionReset(room); return current(room) && publishCollections(room); }
    function retainRows(room, keep) {
      const heldCount = room.messages.length, pinCount = room.pinnedOlder?.length || 0;
      const gone = [], filter = rows => rows.filter(message => { if (keep(message)) return true; gone.push(message); return false; });
      room.messages = filter(room.messages); room.pinnedOlder = filter(room.pinnedOlder || []);
      if (gone.length) markCollections(room, { held: heldCount !== room.messages.length, olderPins: pinCount !== room.pinnedOlder.length,
        heldHeaders: heldCount !== room.messages.length, olderPinHeaders: pinCount !== room.pinnedOlder.length, pins: true });
      return gone;
    }
    function patch(room, event) {
      if (!current(room)) return null;
      const message = HistoryWindow.heldMessageById(room, event.id);
      if (!message?.streaming) return null;
      const base = revision(message);
      switch (event.type) {
        case "chunk": message.text += event.text; break;
        case "thought": message.thought = (message.thought || "") + event.text; break;
        case "toolcall": {
          message.toolCalls ||= [];
          const at = message.toolCalls.findIndex(call => call.toolCallId === event.toolCall.toolCallId);
          if (at >= 0) message.toolCalls[at] = event.toolCall;
          else message.toolCalls.push(event.toolCall);
          break;
        }
        case "plan": message.plan = event.entries; break;
        default: return null;
      }
      if (room.history?.bodyProtocol) WindowBodies.invalidate(message);
      markEdited(message);
      if (!changedProjection(room, message, event.type, event.type === "toolcall" && event.toolCall.toolCallId ? [event.toolCall.toolCallId] : undefined,
        event.type === "toolcall" ? [event.toolCall] : undefined)) return null;
      return Object.freeze({ message, base, revision: revision(message) });
    }
    function acceptDelivery(room, updates, showing) {
      if (!current(room)) return false;
      for (const update of updates || []) {
        const message = HistoryWindow.messageById(room, update.id);
        if (!message || (message.bodyDelivery?.version ?? 0) > update.delivery.version) continue;
        message.bodyDelivery = update.delivery;
        WindowBodies.invalidate(message);
        markSnapshot(message);
        if (!changedProjection(room, message, "acceptDelivery")) return false;
        delivered(room, message, showing);
        if (!current(room)) return false;
      }
      return true;
    }
    function remove(room, id) {
      if (!current(room)) return false;
      const gone = retainRows(room, message => message.id !== id);
      HistoryWindow.syncCount(room);
      return removedProjections(room, gone);
    }
    function adopt(room, localId, realId) {
      if (!current(room) || !realId || localId === realId) return null;
      if (room.messages.some(m => m.id === realId)) {
        if (!remove(room, localId)) return null;
        removed(room, localId);
        return current(room) ? Object.freeze({ kind: "removed" }) : null;
      }
      const message = room.messages.find(m => m.id === localId);
      if (!message) return null;
      HistoryWindow.renameMessage(message, realId);
      delete message.pending;
      markEdited(message);
      if (!markCollections(room, { held: true, heldHeaders: true, pins: true })) return null;
      if (!changedProjection(room, message, "adopt")) return null;
      WindowBodies.renameUse(room, localId, realId);
      adopted(room, localId, realId);
      return current(room) ? Object.freeze({ kind: "adopted", message }) : null;
    }
    function upsert(room, incoming) {
      if (!current(room)) return null;
      if (incoming.from === "human" && !incoming.pending && !HistoryWindow.heldMessageById(room, incoming.id)) {
        const local = room.messages.find(m => m.pending && m.from === "human" && m.text === incoming.text);
        if (local) adopt(room, local.id, incoming.id);
        if (!current(room)) return null;
      }
      let index = HistoryWindow.heldMessageIndex(room, incoming.id);
      const above = index < 0 && aboveHeld(room, incoming);
      if (!current(room)) return null;
      if (above) {
        const gone = [];
        room.pinnedOlder = (room.pinnedOlder || []).filter(m => { if (m.id !== incoming.id) return true; gone.push(m); return false; });
        if (incoming.pinned && incoming.kind === "chat") {
          room.pinnedOlder.push(incoming);
          room.pinnedOlder.sort((a, b) => HistoryWindow.compareCursor(HistoryWindow.cursorOf(a), HistoryWindow.cursorOf(b)) < 0 ? -1 : 1);
        }
        HistoryWindow.syncCount(room);
        const kept = incoming.pinned && incoming.kind === "chat", previous = gone[0];
        const moved = !!previous !== !!kept || !!(previous && kept && HistoryWindow.compareMessages(previous, incoming));
        if ((gone.length || kept) && !markCollections(room, { olderPins: moved, olderPinHeaders: true, pins: moved })) return null;
        if (!removedProjections(room, gone)) return null;
        return Object.freeze({ kind: "above" });
      }
      const wasFinal = index >= 0 && !room.messages[index].streaming;
      if (index >= 0) {
        const held = room.messages[index], previousOrder = { id: incoming.id, seq: held.seq, displayOrder: held.displayOrder }, wasPin = !!held.pinned && held.kind === "chat", previousKind = held.kind, previousStreaming = !!held.streaming;
        if (!("pinned" in incoming)) delete held.pinned;
        if (!("pinLabel" in incoming)) delete held.pinLabel;
        if (incoming.seq > 0 && !("displayOrder" in incoming)) delete held.displayOrder;
        Object.assign(held, incoming);
        if (room.history?.bodyProtocol && !incoming.bodyMissing) {
          delete held.bodyMissing; delete held.bodyChars; delete held.bodyError;
          WindowBodies.changed(room, held);
        }
        markEdited(held);
        const moved = HistoryWindow.compareMessages(previousOrder, held) !== 0;
        if (moved) {
          HistoryWindow.sortMessages(room);
          index = HistoryWindow.heldMessageIndex(room, incoming.id);
        }
        if (!markCollections(room, { held: moved, heldHeaders: true, heldChats: moved || previousKind !== held.kind || previousStreaming !== !!held.streaming, historyOverview: true, pins: moved || wasPin !== (!!held.pinned && held.kind === "chat") })) return null;
        if (!changedProjection(room, held, "upsert")) return null;
      } else { index = HistoryWindow.insertMessage(room, incoming); if (!markCollections(room, { held: true, heldHeaders: true, pins: true })) return null; }
      HistoryWindow.syncCount(room);
      if (!publishCollections(room)) return null;
      return Object.freeze({ kind: "row", index, wasFinal, message: room.messages[index] });
    }
    function truncate(room, fromSeq) {
      if (!current(room)) return false;
      const gone = retainRows(room, message => message.seq <= fromSeq);
      return removedProjections(room, gone);
    }
    function replaceRange(room, fresh) {
      if (!current(room)) return false;
      if (fresh.history?.indexed) WindowBodies.retain(room, fresh);
      room.messages = (fresh.messages || []).sort(HistoryWindow.compareMessages);
      room.history = fresh.history;
      room.pinnedOlder = fresh.pinnedOlder || [];
      room.bodyChanges = new Map();
      if (!markCollections(room, { held: true, olderPins: true, pins: true, heldHeaders: true, olderPinHeaders: true })) return false;
      return resetProjections(room);
    }
    function retainSnapshot(previous, room) {
      return current(room) && HistoryWindow.retainUnchanged(previous, room) && resetCollections(room);
    }
    function resetCollections(room) { return markCollections(room, { held: true, olderPins: true, pins: true, heldHeaders: true, olderPinHeaders: true }) && resetProjections(room); }
    function mergePage(room, page, ticket) { return current(room) && HistoryWindow.mergePage(room, page, ticket) && resetCollections(room); }
    function mergeBodies(room, page, generation) {
      if (!current(room)) return false;
      const result = WindowBodies.merge(room, page, generation);
      if (result.accepted && result.replaced.length) {
        const selectionChanged = result.replaced.some(before => {
          const after = HistoryWindow.heldMessageById(room, before.id);
          return !after || before.kind !== after.kind || !!before.streaming !== !!after.streaming;
        });
        if (!markCollections(room, { heldHeaders: true, heldChats: selectionChanged })) return false;
      }
      return result.accepted && removedProjections(room, result.replaced);
    }
    function touchBodies(room, ids) { if (current(room)) WindowBodies.touch(room, ids); }
    function clearBodyErrors(room, ids) {
      if (!current(room)) return;
      for (const id of ids) {
        const message = HistoryWindow.heldMessageById(room, id);
        if (message && Object.hasOwn(message, "bodyError")) {
          delete message.bodyError; markSnapshot(message);
          if (!markCollections(room, { heldHeaders: true })) return;
          if (!changedProjection(room, message, "clearBodyErrors")) return;
        }
      }
    }
    function failBodies(room, ids, reason) {
      if (!current(room)) return;
      for (const id of ids) {
        const message = HistoryWindow.heldMessageById(room, id);
        if (message?.bodyMissing && (!Object.hasOwn(message, "bodyError") || message.bodyError !== reason)) {
          message.bodyError = reason; markSnapshot(message);
          if (!markCollections(room, { heldHeaders: true })) return;
          if (!changedProjection(room, message, "failBodies")) return;
        }
      }
    }
    function trimBodies(room, protectedIds = new Set()) {
      if (!current(room) || !room.history?.bodyProtocol) return;
      if (!room.history.indexed) {
        const keep = new Set(room.messages.slice(-80).map(message => message.id));
        const gone = [];
        room.messages = room.messages.filter(message => { if (keep.has(message.id) || message.streaming || message.pending) return true; gone.push(message); return false; });
        HistoryWindow.syncCount(room);
        if (gone.length && !markCollections(room, { held: true, heldHeaders: true, pins: true })) return;
        removedProjections(room, gone);
        return;
      }
      const result = WindowBodies.trim(room, protectedIds);
      const gone = [];
      if (result.evictedIds.length && !markCollections(room, { heldHeaders: true })) return;
      for (const id of result.evictedIds) {
        const message = HistoryWindow.heldMessageById(room, id);
        if (message) { markSnapshot(message); gone.push(message); }
      }
      return removedProjections(room, gone) ? result : undefined;
    }
    function acceptEventMetadata(room, event) {
      if (!current(room)) return false;
      if (room.history?.bodyProtocol) {
        const affected = event.type === "message.delivery" ? (event.updates || []).map(update => update.id)
          : [event.message?.id || event.messageId || event.id].filter(Boolean);
        const changes = room.bodyChanges ||= new Map();
        for (const id of affected) changes.set(id, event.streamSequence || 0);
        if (room.history.indexed) for (const id of affected) (room.dirtyHeights ||= new Set()).add(id);
      }
      const delta = root.VIBEROOM_HISTORY_RECONCILIATION.isDelta(event);
      if ((delta || event.type === "message" || event.type === "message.delivery") && event.streamSequence !== undefined && event.streamSequence <= (room.history?.streamSequence ?? -1)) return false;
      bufferDelta(room, event);
      if (!current(room)) return false;
      if (event.history) {
        if (room.history?.epoch && room.history.epoch !== event.history.epoch) return false;
        if (room.history?.revision > event.history.revision && event.type !== "participant") return false;
        if (!room.history || event.history.streamSequence >= (room.history.streamSequence ?? -1)) {
          room.history = { ...room.history, ...event.history };
          if (!markCollections(room, { historyOverview: true })) return false;
        }
        const message = event.type === "message" && event.message;
        if (message && message.seq > 0 && message.kind === "chat") {
          const latest = (room.history.latest ||= {});
          if (!latest[message.from] || message.seq >= latest[message.from].seq) latest[message.from] = { seq: message.seq, usage: message.usage };
        }
      }
      if (room.history && event.streamSequence !== undefined) room.history.streamSequence = Math.max(room.history.streamSequence ?? -1, event.streamSequence);
      return publishCollections(room);
    }
    function optimisticOrder(room) {
      return current(room) ? room.messages.reduce((last, m) => Math.max(last, m.displayOrder ?? m.seq ?? 0), 0) + 1 : null;
    }
    return Object.freeze({ signal: lifetime.signal, collectionsOf, chatCounts, upsert, remove, truncate, adopt, replaceRange, optimisticOrder, patch, revision, identity, snapshotRevision, acceptDelivery,
      retainSnapshot, mergePage, mergeBodies, touchBodies, clearBodyErrors, failBodies, trimBodies, acceptEventMetadata, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "streaming", { value: true });
  Object.defineProperty(create, "history", { value: true });
  Object.defineProperty(create, "metadata", { value: true });
  Object.defineProperty(create, "projections", { value: true });
  Object.defineProperty(create, "toolVersions", { value: true });
  Object.defineProperty(create, "ranges", { value: true });
  Object.defineProperty(create, "overview", { value: true });
  root.VIBEROOM_CONVERSATION_STATE = Object.freeze({ create, projectionRules });
})(globalThis);
