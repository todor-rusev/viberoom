// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function chipFor(call, ports) {
    const open = ports.isOpen(call.toolCallId);
    const loaded = open ? ports.details(call) : { state: "ready", value: call };
    if (!loaded) return undefined;
    const detail = loaded.value;
    const input = !open || detail.rawInput === undefined ? "" : typeof detail.rawInput === "string" ? detail.rawInput : JSON.stringify(detail.rawInput, null, 1);
    return ports.UI.el("tool-call", { id: call.toolCallId, title: detail.title, kind: call.kind || undefined,
      variant: call.messageCheck ? "message-check" : call.historySearch ? "history-search" : "tool",
      status: ports.statuses.has(call.status) ? call.status : "pending", open, loadState: loaded.state,
      input: input || undefined, output: open ? detail.output || undefined : undefined });
  }
  const foldFor = (frame, open, UI) => UI.el("tool-fold", { count: frame.toolCalls?.length || 0,
    failed: (frame.toolCalls || []).filter(call => call.status === "failed").length, open });
  function bindFold(group, ports) {
    ports.listen(group, "toggle", () => {
      if (!group.isConnected) return;
      const list = group.querySelector(".list"), frame = ports.readCurrent();
      if (!frame) { if (!group.open) list.replaceChildren(); return; }
      const fragment = group.ownerDocument.createDocumentFragment();
      if (group.open && !list.childElementCount) for (const call of frame.toolCalls || []) {
        const chip = chipFor(call, ports);
        if (!chip) return;
        fragment.appendChild(chip);
      }
      const summary = foldFor(frame, group.open, ports.UI).querySelector("summary");
      if (!ports.stillCurrent(frame)) return;
      ports.setGroupOpen(frame.id, group.open);
      if (!ports.stillCurrent(frame)) return;
      const own = group.querySelector("summary");
      if (own.innerHTML !== summary.innerHTML) own.innerHTML = summary.innerHTML;
      own.title = group.open ? "Fold the tool calls away" : "Show every tool call";
      if (!group.open) list.replaceChildren();
      else if (!list.childElementCount) list.appendChild(fragment);
    });
  }
  function draw(box, frame, ports) {
    const { held, patch } = ports, calls = frame.toolCalls || [], CSS = box.ownerDocument.defaultView.CSS;
    if (held) { if (ports.stillCurrent(frame)) box.dataset.held = "1"; return; }
    const some = frame.streaming && patch && box.dataset.held !== "1" && !box.querySelector(":scope > details");
    if (some) {
      const chips = new Map();
      for (const id of patch) {
        const call = calls.find(item => item.toolCallId === id);
        if (!call) continue;
        const chip = chipFor(call, ports);
        if (!chip) return;
        chips.set(id, chip);
      }
      if (!ports.stillCurrent(frame)) return;
      for (const [id, chip] of chips) {
        const call = calls.find(item => item.toolCallId === id);
        const old = box.querySelector(`:scope > [data-ui="tool-call"] > [data-tool="${CSS.escape(id)}"]`);
        if (old) old.parentElement.replaceWith(chip);
        else {
          const later = calls.slice(calls.indexOf(call) + 1).map(item => box.querySelector(`:scope > [data-ui="tool-call"] > [data-tool="${CSS.escape(item.toolCallId)}"]`)).find(Boolean);
          box.insertBefore(chip, later ? later.parentElement : null);
        }
      }
      return;
    }
    const fragment = box.ownerDocument.createDocumentFragment(), folded = !frame.streaming && calls.length > 0;
    let host = fragment;
    if (folded) {
      const group = foldFor(frame, ports.groupOpen(frame.id), ports.UI);
      bindFold(group, ports); fragment.appendChild(group); host = group.querySelector(".list");
    }
    if (!folded || ports.groupOpen(frame.id)) for (const call of calls) {
      const chip = chipFor(call, ports);
      if (!chip) return;
      host.appendChild(chip);
    }
    if (!ports.stillCurrent(frame)) return;
    delete box.dataset.held;
    box.replaceChildren(fragment);
  }
  Object.defineProperty(draw, "current", { value: true });
  root.VIBEROOM_MESSAGE_TOOLS = Object.freeze({ draw });
})(typeof window !== "undefined" ? window : globalThis);
