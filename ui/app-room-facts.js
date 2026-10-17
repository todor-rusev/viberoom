// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const fields = ["name", "dir", "folderRestartChoice", "settings", "customRulesText", "focused", "startingWithHub", "hopLimit", "hops", "readOnly", "recovery", "sources", "participants", "permissions", "proposals", "newRooms"];
  function create({ window: view = root, signal, recordOf } = {}) {
    const lifetime = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    if (signal) {
      if (signal.aborted) lifetime.dispose();
      else lifetime.on(signal, "abort", () => lifetime.dispose(), { once: true });
    }
    const facts = new WeakMap(), participantOrder = new WeakMap();
    const own = value => value === undefined ? undefined : root.VIBEROOM_OWNED_JSON.copyOrdered(value, "Room facts");
    function current(room) {
      if (lifetime.disposed || !room || !facts.has(room)) return false;
      const accepted = recordOf(room.id);
      return !lifetime.disposed && accepted === room;
    }
    function prepareRecord(room) {
      if (lifetime.disposed) return false;
      if (facts.has(room)) return true;
      const initial = Object.fromEntries(fields.filter(key => Object.hasOwn(room, key)).map(key => [key, own(room[key])]));
      if (lifetime.disposed) return false;
      Object.defineProperties(room, Object.fromEntries(fields.map(key => [key, {
        enumerable: true, configurable: false, get: () => facts.get(room)?.[key],
      }])));
      facts.set(room, Object.freeze(initial));
      participantOrder.set(room, new Map());
      return true;
    }
    function accept(room, changes) {
      if (!current(room)) return false;
      const detached = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, own(value)]));
      if (!current(room)) return false;
      facts.set(room, Object.freeze({ ...facts.get(room), ...detached }));
      return true;
    }
    function participantEventAllowed(room, event) {
      if (!current(room)) return false;
      return event.streamSequence === undefined || !(event.streamSequence < (participantOrder.get(room).get(event.participant.id) ?? -1));
    }
    function configReplyAllowed(room, reply) {
      if (!current(room) || !reply?.participant) return false;
      return reply.history?.epoch === room.history?.epoch && Number.isFinite(reply.history?.streamSequence)
        && reply.history.streamSequence >= (participantOrder.get(room).get(reply.participant.id) ?? -1)
        && room.participants.some(p => p.id === reply.participant.id);
    }
    function replaceParticipant(room, participant, sequence) {
      const previousFacts = facts.get(room), participants = [...previousFacts.participants];
      const at = participants.findIndex(p => p.id === participant.id), previous = at >= 0 ? participants[at] : null;
      if (at >= 0) participants[at] = participant;
      else participants.push(participant);
      if (sequence !== undefined) participantOrder.get(room).set(participant.id, sequence);
      facts.set(room, Object.freeze({ ...previousFacts, participants: Object.freeze(participants) }));
      return Object.freeze({ participant, previous, channelChanged: !!previous && previous.skillChannel !== participant.skillChannel });
    }
    function appendCard(room, field, value) {
      if (!current(room)) return null;
      const card = own(value);
      if (!current(room)) return null;
      const previous = facts.get(room), rows = field === "permissions" ? previous[field] : previous[field] || [];
      facts.set(room, Object.freeze({ ...previous, [field]: Object.freeze([...rows, card]) }));
      return card;
    }
    function resolveCard(room, field, key, values) {
      if (!current(room)) return null;
      if (!(facts.get(room)[field] || []).some(card => card.key === key)) return null;
      const changes = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, own(value)]));
      if (!current(room)) return null;
      const previous = facts.get(room), rows = previous[field] || [], at = rows.findIndex(card => card.key === key);
      if (at < 0) return null;
      const card = Object.freeze({ ...rows[at], ...changes }), next = [...rows]; next[at] = card;
      facts.set(room, Object.freeze({ ...previous, [field]: Object.freeze(next) }));
      return card;
    }
    const producer = Object.freeze({
      prepareRecord,
      acceptPermission: (room, permission) => appendCard(room, "permissions", permission),
      acceptProposal: (room, proposal) => appendCard(room, "proposals", proposal),
      acceptNewRoom: (room, proposal) => appendCard(room, "newRooms", proposal),
      resolvePermission(room, key) {
        if (!current(room)) return false;
        const previous = facts.get(room);
        facts.set(room, Object.freeze({ ...previous, permissions: Object.freeze(previous.permissions.filter(card => card.key !== key)) }));
        return true;
      },
      retainPermissions(room, streamingAuthors) {
        if (!current(room)) return false;
        const authors = new Set(streamingAuthors);
        if (!current(room)) return false;
        const previous = facts.get(room);
        facts.set(room, Object.freeze({ ...previous, permissions: Object.freeze((previous.permissions || []).filter(card => authors.has(card.participantId))) }));
        return true;
      },
      resolveProposal: (room, key, status, skipped) => resolveCard(room, "proposals", key, { skipped, status }),
      resolveNewRoom: (room, key, status, roomId) => resolveCard(room, "newRooms", key, { status, roomId }),
      participantEventAllowed, configReplyAllowed,
      acceptRosterSnapshot(room, sequence) {
        if (!current(room)) return false;
        participantOrder.set(room, new Map((room.participants || []).map(p => [p.id, sequence])));
        return true;
      },
      acceptParticipant(room, event) {
        if (!participantEventAllowed(room, event)) return null;
        const participant = own(event.participant);
        if (!participantEventAllowed(room, event)) return null;
        return replaceParticipant(room, participant, event.streamSequence);
      },
      acceptConfigReply(room, reply) {
        if (!configReplyAllowed(room, reply)) return null;
        const participant = own(reply.participant);
        if (!configReplyAllowed(room, reply)) return null;
        return replaceParticipant(room, participant, reply.history.streamSequence).participant;
      },
      removeParticipant(room, event) {
        if (!current(room)) return false;
        const previous = facts.get(room);
        if (event.streamSequence !== undefined) participantOrder.get(room).set(event.id, event.streamSequence);
        facts.set(room, Object.freeze({ ...previous, participants: Object.freeze(previous.participants.filter(p => p.id !== event.id)) }));
        return true;
      },
      acceptLimitsAndSettings(room, event) {
        if (!current(room)) return false;
        return accept(room, { hopLimit: event.hopLimit, hops: event.hops, settings: event.settings });
      },
      acceptSettings: (room, settings) => accept(room, { settings }),
      acceptHeader(room, event) {
        if (!current(room)) return false;
        return accept(room, { customRulesText: event.customRulesText != null ? event.customRulesText : room.customRulesText,
          focused: event.focused, startingWithHub: event.startingWithHub === true, name: event.name,
          ...(event.dir ? { dir: event.dir } : {}) });
      },
      acceptRecovery(room, recovery) {
        if (!recovery || !current(room)) return false;
        return accept(room, { recovery, ...(recovery.status === "adopted" ? { readOnly: false } : {}) });
      },
    });
    const reader = Object.freeze({ read(id) {
      if (lifetime.disposed) return undefined;
      const room = recordOf(id);
      return !lifetime.disposed && room ? facts.get(room) : undefined;
    } });
    return Object.freeze({ producer, reader, dispose: () => lifetime.dispose() });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "roster", { value: true });
  Object.defineProperty(create, "cards", { value: true });
  root.VIBEROOM_ROOM_FACTS = Object.freeze({ create });
})(globalThis);
