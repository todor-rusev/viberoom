// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  function noPeekHtml(kind, label, { esc, scene }) {
    return `<span class="no-peek scene-art is-${kind}" role="img" aria-label="${esc(label)}">${scene("no-peek")}</span>`;
  }

  function consentTitle(feature, recipient, reader) {
    if (feature === "reading" && reader === "system") return "The replies are read aloud by this computer's own voices";
    const what = feature === "voice" ? "Your voice goes to" : feature === "reading" ? "The replies you have read aloud go to" : "What the rooms remember goes to";
    return `${what} ${recipient}`;
  }

  function gate({ feature, reader, icon, recipient, given, lapsed, words, view }, UI) {
    const title = consentTitle(feature, recipient, reader);
    if (given) {
      const missing = view && !view.ready && view.reason ? `Not on yet: ${view.reason}.` : "";
      const said = title.charAt(0).toLowerCase() + title.slice(1);
      return UI.html("consent-gate", { state: "given", title: `${missing ? "You agreed" : "On"}: ${said}`, missing, withdraw: { act: "consent-withdraw", data: { feature } } });
    }
    return UI.html("consent-gate", { state: lapsed ? "lapsed" : "ask", icon, title, words, answers: [{ label: lapsed ? "I agree" : "I agree, turn it on", kind: "primary", act: "consent-agree", data: { feature, reader: reader || "", words } }] });
  }

  function lock(body, { locked, feature, note = "Agree above to set it up", opened = false }, UI) {
    return UI.html("consent-lock", { locked, note, body, opened: !locked && opened });
  }

  function waitingOn(view, piece) {
    return view && !view.ready && view.missing === piece ? { attention: "" } : undefined;
  }

  function mount(section, { signal, saveConsent, onAccepted, onError, refresh }) {
    if (!section?.ownerDocument || typeof saveConsent !== "function" || typeof onAccepted !== "function") throw new TypeError("A consent root and application actions are required");
    signal?.throwIfAborted();
    const active = global.VIBEROOM_APP_LIFETIME.create({ window: section.ownerDocument.defaultView });
    const dispose = () => active.dispose();
    signal?.addEventListener("abort", dispose, { once: true });
    active.own(() => signal?.removeEventListener("abort", dispose));
    active.on(section, "click", async e => {
      const button = e.target.closest('[data-act="consent-agree"], [data-act="consent-withdraw"]');
      if (!button || !section.contains(button)) return;
      e.preventDefault();
      const { feature, reader, words } = button.dataset;
      const withdraw = button.dataset.act === "consent-withdraw";
      button.disabled = true;
      try {
        const result = await saveConsent(withdraw ? { feature, withdraw: true } : { feature, words, ...(reader ? { reader } : {}) });
        onAccepted(result, { feature, withdraw });
      } catch (error) {
        if (!active.disposed) { onError(error); refresh(); }
      } finally { if (!active.disposed) button.disabled = false; }
    });
    return Object.freeze({ dispose });
  }
  Object.defineProperty(mount, "disposable", { value: true });
  Object.defineProperty(mount, "scoped", { value: true });
  global.VIBEROOM_FEATURE_CONSENT = Object.freeze({ noPeekHtml, title: consentTitle, gate, lock, waitingOn, mount });
})(globalThis);
