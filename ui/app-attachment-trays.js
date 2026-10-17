// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const CHIP_CHARS = 70;
  function uploadMark(item) {
    if (item.failed) return `<span class="up-mark failed" data-hint="${esc(item.failed)}">!</span>`;
    if (item.stored) return "";
    return `<span class="up-mark" style="--done:${item.progress || 0}%" data-hint="Sending to the room: ${item.progress || 0} %"></span>`;
  }
  function token(kind, n, model, { icon: ic, kinds: TIMED_KINDS, length: soundLength }) {
    if (kind === "img") {
      const shot = model.images.find((x) => x.n === n);
      return shot ? { icon: ic("image"), title: `Picture ${n}${shot.name ? `: ${shot.name}` : ""}` } : null;
    }
    if (TIMED_KINDS[kind]) {
      const item = model.timed[kind].pending.find((x) => x.n === n);
      const noun = TIMED_KINDS[kind].noun;
      return item ? { icon: ic(TIMED_KINDS[kind].icon), title: `${noun[0].toUpperCase()}${noun.slice(1)} ${n}: ${item.name}${item.seconds ? `, ${soundLength(item.seconds)}` : ""}` } : null;
    }
    const quote = model.quotes.find((x) => x.n === n);
    return quote ? { icon: ic("quote"), title: `Quote ${n}: ${quote.fromName} — ${quote.text.replace(/\s+/g, " ").slice(0, CHIP_CHARS)}${quote.text.length > CHIP_CHARS ? "…" : ""}` } : null;
  }
  const key = target => JSON.stringify([target?.scope, target?.id, target?.uuid, target?.createdAt, target?.draftRoomId]);
  function create({ media, quotes }, { window: view = media?.ownerDocument.defaultView, signal, read,
    icon: ic, length: soundLength, kinds, pictureMark, onDrop } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let mediaButtons = new WeakMap(), quoteButtons = new WeakMap();
    function accept(button, table) {
      const shown = table.get(button), current = read();
      if (!shown || !current.target?.id || key(current.target) !== shown.key || shown.item.n !== shown.n) return;
      const live = shown.kind === "img" ? current.images : shown.kind === "quote" ? current.quotes : current.timed[shown.kind]?.pending;
      if (!live?.includes(shown.item)) return;
      onDrop({ kind: shown.kind, n: shown.n, item: shown.item, target: { ...current.target } });
    }
    owner.on(media, "click", event => { const button = event.target.closest(".shot-drop"); if (button && media.contains(button)) accept(button, mediaButtons); });
    owner.on(quotes, "click", event => { const button = event.target.closest(".qc-drop"); if (button && quotes.contains(button)) accept(button, quoteButtons); });
    function renderMedia() {
      if (owner.disposed) return;
      const model = read(), images = model.images, timed = model.timed;
      mediaButtons = new WeakMap();
      media.hidden = !images.length && !Object.values(timed).some(draft => draft.pending.length);
      media.innerHTML = images
        .map((shot, i) => `<span class="shot-chip">${uploadMark(shot)}<img src="${esc(shot.url)}" alt="">${shot.stored ? pictureMark(model.target?.id, shot.stored.file) : ""}<span class="shot-n">${shot.n}</span><button type="button" class="shot-drop" data-i="${i}" title="Remove ${esc(shot.name)}">×</button></span>`)
        .concat(Object.entries(timed).flatMap(([kind, draft]) => draft.pending.map((item, i) => `<span class="shot-chip sound-chip">${uploadMark(item)}${ic(kinds[kind].icon)}<span class="sound-len">${esc(soundLength(item.seconds) || item.name)}</span><span class="shot-n">${item.n}</span><button type="button" class="shot-drop" data-timed="${kind}" data-i="${i}" title="Remove ${esc(item.name)}">×</button></span>`)))
        .join("");
      for (const button of media.querySelectorAll(".shot-drop")) {
        const kind = button.dataset.timed || "img", item = kind === "img" ? images[Number(button.dataset.i)] : timed[kind].pending[Number(button.dataset.i)];
        mediaButtons.set(button, { kind, item, n: item.n, key: key(model.target) });
      }
    }
    function renderQuotes() {
      if (owner.disposed) return;
      const model = read(), list = model.quotes;
      quoteButtons = new WeakMap();
      quotes.hidden = !list.length;
      quotes.innerHTML = list.map((q, i) => `<span class="quote-chip" title="${esc(q.text)}"><span class="qc-n">${q.n}</span><b>${esc(q.fromName)}</b><span class="qc-text">${esc(q.text.replace(/\s+/g, " ").slice(0, CHIP_CHARS))}${q.text.length > CHIP_CHARS ? "…" : ""}</span><button type="button" class="qc-drop" data-i="${i}" title="Remove this quote">×</button></span>`).join("");
      for (const button of quotes.querySelectorAll(".qc-drop")) {
        const item = list[Number(button.dataset.i)]; quoteButtons.set(button, { kind: "quote", item, n: item.n, key: key(model.target) });
      }
    }
    function dispose() {
      if (owner.disposed) return;
      owner.dispose(); mediaButtons = new WeakMap(); quoteButtons = new WeakMap();
      media.hidden = quotes.hidden = true; media.innerHTML = quotes.innerHTML = "";
    }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ renderMedia, renderQuotes, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_ATTACHMENT_TRAYS = Object.freeze({ create, uploadMark, token, previewChars: CHIP_CHARS });
})(globalThis);
