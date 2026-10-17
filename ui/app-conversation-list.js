// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function create(messages, ports) {
    if (typeof ports.patchRows !== "function") throw new TypeError("The conversation list needs a checked patch port");
    const document = messages.ownerDocument, window = document.defaultView, CSS = window.CSS;
    ports.signal?.throwIfAborted();
    const owner = global.VIBEROOM_APP_LIFETIME.create({ window });
    const STOP = Symbol("list view changed");
    let disposed = false, action = 0, active = null;
    owner.own(() => { disposed = true; });
    function held() { return !disposed && !!active && active.action === action && ports.valid(active.facts) && !disposed && active.action === action; }
    function check() { if (!held()) throw STOP; }
    function read(port, ...args) { check(); const value = port(...args); check(); return value; }
    const need = value => { if (value === undefined) throw STOP; return value; };
    const live = () => !disposed && !!active && active.action === action;
    const KeyedList = {
      patch: (...args) => need(read(ports.patchRows, active.facts, live, false, ...args)),
      patchPaged: (...args) => need(read(ports.patchRows, active.facts, live, true, ...args)),
    };
    const messageElement = (facts, row) => need(read(ports.messageElement, facts, row));
    const dayElement = (...args) => need(read(ports.dayElement, ...args));
    const dividerElement = (...args) => need(read(ports.dividerElement, ...args));
    const ceilingElement = (facts, ...args) => need(read(ports.ceilingElement, facts, ...args));
    const ic = name => read(ports.ic, name);
    const els = { messages };


    function listRow(facts, item) {
      check();
      switch (item.kind) {
        case "space": {
          const el = document.createElement("div");
          el.className = "msgs-space";
          el.setAttribute("aria-hidden", "true");
          return el;
        }
        case "msg": {
          const el = messageElement(facts, item);
          if (item.arriving) el.classList.add("history-static", "history-arriving");
          return el;
        }
        case "day": return dayElement(item.day, item.ts);
        case "beginning": {
          const el = document.createElement("div");
          el.className = "conversation-start";
          el.textContent = "The room starts here";
          return el;
        }
        case "mark": return dividerElement(item.authors);
        case "ceiling": return ceilingElement(facts, item.hidden, item.pinned);
        default: {
          const pins = document.createElement("section");
          pins.className = "history-pins";
          pins.setAttribute("aria-label", "Pinned messages from earlier history");
          pins.innerHTML = `<span class="history-rule" aria-hidden="true"></span><div class="history-pins-label">${ic("pin")}<span></span></div><div class="history-pins-rows"></div>`;
          return pins;
        }
      }
    }


    function fillListRow(facts, node, item, fresh) {
      check();
      if (item.kind === "space") {
        const height = `${Math.max(0, Math.round(item.px))}px`;
        if (node.style.height !== height) node.style.height = height;
        return;
      }
      if (item.kind === "pins") return fillPins(facts, node, item);
      if (fresh) return;
      switch (item.kind) {
        case "msg":
          need(read(ports.syncMessage, facts, node, item));
          return;
        case "ceiling":
          need(read(ports.updateHistoryBoundary, facts, item.hidden, item.pinned));
          return;
        default:
          return;
      }
    }


    function fillPins(facts, node, item) {
      check();
      node.querySelector(".history-pins-label").lastElementChild.textContent = `${item.count} pinned from earlier`;
      KeyedList.patch(node.querySelector(".history-pins-rows"), item.rows, {
        key: "id",
        id: (row) => { check(); return row.name; },
        make: (row) => {
          const el = listRow(facts, row);
          if (row.kind === "msg") el.classList.add("above-fold");
          return el;
        },
        fill: (el, row, _at, born) => fillListRow(facts, el, row, born),
      });
      check();
    }
    function patch(facts, shown, { drawnWindow, pageSize: PAGE_SIZE, textPress } = {}) {
      check();
      const loadedIds = new Set(shown.filter(item => item.kind === "msg" && !item.bodyMissing).map(item => item.name));
      for (const node of els.messages.querySelectorAll(".history-placeholder")) if (loadedIds.has(node.dataset.id)) node.remove();
      const born = [];
      const selection = window.getSelection();
      const savedSelection = selection && (!selection.isCollapsed || textPress) && selection.rangeCount
        && els.messages.contains(selection.anchorNode) && els.messages.contains(selection.focusNode)
        ? { anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset, focusNode: selection.focusNode, focusOffset: selection.focusOffset, isCollapsed: selection.isCollapsed, rangeCount: 1, range: selection.getRangeAt(0).cloneRange(), getRangeAt() { return this.range; } } : null;
      const selectionTicket = Object.freeze({});
      const typing = els.messages.contains(document.activeElement) && document.activeElement.matches(".edit-area")
        ? { id: document.activeElement.closest(".msg[data-id]")?.dataset.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd, direction: document.activeElement.selectionDirection, scroll: document.activeElement.scrollTop }
        : null;
      try {
      need(read(ports.setSelectionDuringPatch, facts, selectionTicket, savedSelection));
      const firstRow = drawnWindow && drawnWindow.from ? 1 : 0;
      KeyedList.patchPaged(els.messages, shown, {
        key: "id",
        pageSize: PAGE_SIZE,
        pageOf: drawnWindow ? (item, at) => { check(); return Math.floor((item.name === "space:above" ? drawnWindow.from : item.name === "space:below" ? drawnWindow.to - 1 : drawnWindow.from + at - firstRow) / PAGE_SIZE); } : undefined,
        makePage: () => {
          check();
          const page = document.createElement("div");
          page.className = "msgs-page";
          return page;
        },
        id: (item) => { check(); return item.name; },
        make: (item) => listRow(facts, item),
        fill: (node, item, at, fresh) => {
          check();
          if (fresh) born.push({ node, at });
          fillListRow(facts, node, item, fresh);
        },
      });
      check();
      } finally {
        ports.clearSelectionDuringPatch(selectionTicket);
        const area = held() && typing?.id ? els.messages.querySelector(`.msg[data-id="${CSS.escape(typing.id)}"] .edit-area`) : null;
        if (area && document.activeElement !== area) {
          check();
          area.focus({ preventScroll: true });
          check();
          area.setSelectionRange(typing.start, typing.end, typing.direction);
          check();
          area.scrollTop = typing.scroll;
        }
        if (held() && savedSelection?.anchorNode.isConnected && savedSelection.focusNode.isConnected) {
          const { anchorNode, anchorOffset, focusNode, focusOffset } = savedSelection;
          const current = window.getSelection();
          if (current && (current.anchorNode !== anchorNode || current.anchorOffset !== anchorOffset || current.focusNode !== focusNode || current.focusOffset !== focusOffset)) {
            check();
            current.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
            check();
          }
        }
      }

      return born;
    }
    function run(fn, facts, args) {
      if (disposed) return undefined;
      const previous = active;
      active = { facts, action: ++action };
      try { check(); return fn(facts, ...args); }
      catch (error) { if (error !== STOP) throw error; ports.refused?.(facts); return undefined; }
      finally { active = previous; }
    }
    const dispose = () => owner.dispose();
    if (ports.signal) owner.on(ports.signal, "abort", dispose, { once: true });
    const complete = fn => (facts, ...args) => run((facts, ...values) => { fn(facts, ...values); check(); return true; }, facts, args);
    return Object.freeze({ row: (facts, ...args) => run(listRow, facts, args), fill: complete(fillListRow),
      pins: complete(fillPins), patch: (facts, ...args) => run(patch, facts, args), dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "facts", { value: true });
  global.VIBEROOM_CONVERSATION_LIST = Object.freeze({ create });
})(globalThis);
