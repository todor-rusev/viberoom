// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const WAVE_PERIOD = 1600;
  const WAVE_STEP = 280;
  const WAVE_RETIME = 420;

  function create(box, { window: view = box.ownerDocument.defaultView, signal, avatar, noteFinding, onPick } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    const document = box.ownerDocument;
    let waveEpoch = null;
    let waveFrame = 0;
    let twiceNoted = "";
    const bobOf = (el) => el.getAnimations().find((a) => a.animationName === "wn-bob") || null;
    function wavePlace(anim, i) {
      let target = waveEpoch + i * WAVE_STEP;
      const mine = anim.startTime;
      if (mine === null) {
        const now = document.timeline.currentTime ?? 0;
        target -= Math.ceil((target - now) / WAVE_PERIOD) * WAVE_PERIOD;
        return target;
      }
      return target + Math.round((mine - target) / WAVE_PERIOD) * WAVE_PERIOD;
    }
    function swimTo(el, i) {
      if (el.waveSlot === i) return;
      const anim = bobOf(el);
      if (!anim || waveEpoch === null) return;
      el.waveSlot = i;
      const target = wavePlace(anim, i);
      const from = anim.startTime;
      if (from === null || Math.abs(target - from) < 1) {
        anim.startTime = target;
        return;
      }
      const token = (el.waveToken = (el.waveToken || 0) + 1);
      const t0 = view.performance.now();
      const step = () => {
        if (el.waveToken !== token || !el.isConnected) return;
        const k = Math.min(1, (view.performance.now() - t0) / WAVE_RETIME);
        const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        anim.startTime = from + (target - from) * eased;
        if (k < 1) owner.frame(step);
      };
      owner.frame(step);
    }

    function render(listed) {
      if (owner.disposed) return;
      const working = [...new Map(listed.map((p) => [p.id, p])).values()];
      const names = new Set(working.map((p) => p.name));
      if (working.length !== listed.length || names.size !== working.length) {
        const said = JSON.stringify(listed.map((p) => ({ id: p.id, name: p.name })));
        if (said !== twiceNoted) noteFinding(`a working vibemate listed twice: ${(twiceNoted = said)}`);
      }
      const have = new Map();
      for (const el of [...box.children]) {
        if (have.has(el.dataset.id)) el.remove();
        else have.set(el.dataset.id, el);
      }
      const wanted = new Set(working.map((p) => p.id));
      for (const [id, el] of have) if (!wanted.has(id) && !el.classList.contains("leaving")) leaveWave(el);
      working.forEach((p) => {
        const title = `${p.name} is writing — click to go to the reply`;
        const face = `${p.avatar || ""}|${p.color || ""}|${p.name}`;
        const kept = have.get(p.id);
        if (kept) {
          if (kept.title !== title) kept.title = title;
          if (kept.classList.contains("leaving")) {
            kept.classList.remove("leaving");
            owner.clearTimeout(kept.leaveTimer);
          }
          if (kept.dataset.face !== face) {
            kept.innerHTML = avatar(p, 22, {});
            kept.dataset.face = face;
          }
          return;
        }
        const el = document.createElement("button");
        el.type = "button";
        el.className = "wn-av joining";
        el.dataset.id = p.id;
        el.dataset.face = face;
        el.title = title;
        el.innerHTML = avatar(p, 22, {});
        box.appendChild(el);
        if (waveEpoch === null) waveEpoch = document.timeline.currentTime ?? 0;
      });
      formWaveSoon();
      update();
    }
    function leaveWave(el) {
      el.classList.add("leaving");
      el.leaveTimer = owner.timeout(() => {
        el.remove();
        formWaveSoon();
        update();
      }, 220);
      formWaveSoon();
    }
    function formWaveSoon() {
      if (!waveFrame) waveFrame = owner.frame(() => { waveFrame = 0; formWave(); });
    }
    function formWave() {
      const staying = [...box.children].filter((el) => !el.classList.contains("leaving"));
      staying.forEach((el, i) => swimTo(el, i));
    }
    function update() {
      if (owner.disposed) return;
      box.hidden = !box.firstElementChild;
    }
    const figureOf = (e) => { const el = e.target.closest?.(".wn-av"); return el && el.parentNode === box ? el : null; };
    owner.on(box, "animationstart", (e) => {
      const el = figureOf(e);
      if (!el || e.target !== el || e.animationName !== "wn-bob") return;
      el.waveSlot = undefined;
      formWaveSoon();
    });
    owner.on(box, "animationend", (e) => {
      const el = figureOf(e);
      if (el && e.animationName === "wn-join") el.classList.remove("joining");
    });
    owner.on(box, "click", (e) => {
      const el = figureOf(e);
      if (el) onPick(el.dataset.id);
    });
    owner.own(() => { box.replaceChildren(); box.hidden = true; });
    const dispose = () => owner.dispose();
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ render, update, dispose });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_WORKING_NOW = Object.freeze({ create });
})(globalThis);
