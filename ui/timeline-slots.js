// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  const HOLD_SLOTS = 3;

  const FAINT_AT = 0.1;
  const FULL_AT = 4;

  const INK_FLOOR = 0.7;

  const MIXED_SHARE = 0.6;

  function slotsOf({ pos, authors, total, slots }) {
    const places = Math.max(1, Math.floor(slots));
    const height = total > 0 ? total : 1;
    const counts = new Array(places).fill(0);
    const first = new Array(places).fill(-1);
    const held = Array.from({ length: places }, () => new Map());
    for (let i = 0; i < pos.length; i++) {
      const at = Math.min(places - 1, Math.max(0, Math.floor((pos[i] / height) * places)));
      const who = authors[i];
      if (first[at] < 0) first[at] = i;
      counts[at]++;
      held[at].set(who, (held[at].get(who) ?? 0) + 1);
    }
    const expected = (pos.length / places) || 1;
    const out = counts.map((count, at) => {
      let author = null, most = 0;
      for (const [who, times] of held[at]) if (times > most) { author = who; most = times; }
      const ratio = count / expected;
      const span = Math.log(FULL_AT) - Math.log(FAINT_AT);
      const strength = count ? Math.min(1, Math.max(0, (Math.log(ratio) - Math.log(FAINT_AT)) / span)) : 0;
      return { count, first: first[at], from: (at / places) * height, to: ((at + 1) / places) * height,
        author, share: count ? most / count : 0, strength, separator: false };
    });
    markChanges(out);
    return out;
  }

  function markChanges(slots) {
    let previous = null;
    for (let at = 0; at < slots.length; at++) {
      const who = slots[at].author;
      if (who === null || who === previous) continue;
      let holds = 0;
      for (let ahead = at; ahead < slots.length && holds < HOLD_SLOTS; ahead++) {
        if (slots[ahead].author === null) continue;
        if (slots[ahead].author !== who) break;
        holds++;
      }
      if (holds < HOLD_SLOTS) continue;
      if (previous !== null) slots[at].separator = true;
      previous = who;
    }
  }

  const PIN_MERGE = 0.4;

  function pinGroups(pins, slotH, glyphH) {
    const groups = [];
    for (const pin of pins) {
      const last = groups[groups.length - 1];
      const apart = last ? (pin.at - last.at) * slotH : Infinity;
      const covered = glyphH > 0 ? (glyphH - apart) / glyphH : 0;
      if (last && covered > PIN_MERGE) {
        last.count += pin.count;
        last.places.push(pin.at);
        last.at = last.places[Math.floor(last.places.length / 2)];
      } else groups.push({ at: pin.at, count: pin.count, places: [pin.at] });
    }
    return groups;
  }

  function itemAt(pos, slot, within) {
    if (!slot || slot.count <= 0) return -1;
    const wanted = slot.from + Math.min(1, Math.max(0, within)) * (slot.to - slot.from);
    let best = -1, distance = Infinity;
    for (let i = slot.first; i < slot.first + slot.count && i < pos.length; i++) {
      const away = Math.abs(pos[i] - wanted);
      if (away < distance) { distance = away; best = i; }
    }
    return best;
  }

  globalThis.VIBEROOM_TIMELINE = { slotsOf, itemAt, pinGroups, HOLD_SLOTS, MIXED_SHARE, INK_FLOOR, PIN_MERGE };
})();
