// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  function hidden(el, m, { icon: ic }) {
    const d = m.details || {};
    if (d.skill) {
      el.innerHTML = `
        <details class="hidden-turn">
          <summary>${ic("skills")} room ↔ ${esc(m.fromName)} · ${esc(m.text)}${d.via ? ` (${esc(d.via)})` : ""}${d.outcome ? ` · <em>${esc(d.outcome)}</em>` : ""}</summary>
          <div class="hidden-body">
            ${d.original ? `<div class="hidden-label">Held reply (nobody in the room saw it)</div><div class="hidden-text">${esc(d.original)}</div>` : ""}
            <div class="hidden-label">What happened</div>
            <div>${d.via === "tool" ? "The vibemate called the room's load_skill tool during its turn and received the skill text as the tool result." : "The vibemate asked for the skill with the marker; the room attached the skill and re-ran the turn on the same messages."}</div>
          </div>
        </details>`;
      return;
    }
    el.innerHTML = `
      <details class="hidden-turn">
        <summary>${ic("tool")} room ↔ ${esc(m.fromName)} · ${esc(m.text)}${d.outcome ? ` · <em>${esc(d.outcome)}</em>` : " · <em>waiting for the corrected reply…</em>"}</summary>
        <div class="hidden-body">
          <div class="hidden-label">Held reply (nobody in the room saw it)</div>
          <div class="hidden-text">${esc(d.original || "")}</div>
          <div class="hidden-label">Corrections sent in a hidden turn</div>
          <ul>${(d.corrections || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        </div>
      </details>`;
  }

  function shots(box, m, { url, pictureMark }) {
    if (!box) return;
    const images = m.images || [];
    box.hidden = !images.length;
    if (!images.length) return void (box.innerHTML = "");
    box.innerHTML = images
      .map((image, i) => `<button type="button" class="shot" data-n="${image.n || i + 1}" data-file="${esc(image.file || "")}" data-src="${esc(url(image))}" title="${esc(image.name)}"><img src="${esc(url(image))}" alt="${esc(image.name)}">${pictureMark(image.file)}<span class="shot-n">${image.n || i + 1}</span></button>`)
      .join("");
  }

  function sounds(box, m, { url, icon: ic, length }) {
    if (!box) return;
    const list = m.audio || [];
    box.hidden = !list.length;
    const html = list
      .map((sound, i) => {
        const n = sound.n || i + 1;
        const said = sound.hearing ? '<p class="sound-note">Hearing it…</p>'
          : sound.words !== undefined ? (sound.words.trim() ? `<p class="sound-words">${esc(sound.words)}</p>` : '<p class="sound-note">No words were heard in it.</p>')
          : `<p class="sound-note">No words: ${esc(sound.unheard || "it was not heard")}</p>`;
        return `<figure class="sound" data-n="${n}"><figcaption><span class="shot-n">${n}</span>${ic("mic")}<span class="sound-name">${esc(sound.name)}</span>${sound.seconds ? `<span class="sound-len">${length(sound.seconds)}</span>` : ""}</figcaption><audio controls preload="metadata" src="${esc(url(sound))}"></audio>${said}</figure>`;
      })
      .join("");
    if (box.dataset.drawn === html) return;
    box.dataset.drawn = html;
    box.innerHTML = html;
  }

  function videos(box, m, { url, icon: ic, length }) {
    if (!box) return;
    const list = m.video || [];
    box.hidden = !list.length;
    const html = list
      .map((clip, i) => {
        const n = clip.n || i + 1;
        return `<figure class="clip" data-n="${n}"><figcaption><span class="shot-n">${n}</span>${ic("video")}<span class="clip-name">${esc(clip.name)}</span>${clip.seconds ? `<span class="clip-len">${length(clip.seconds)}</span>` : ""}</figcaption><video controls playsinline preload="metadata" src="${esc(url(clip))}"></video></figure>`;
      })
      .join("");
    if (box.dataset.drawn === html) return;
    box.dataset.drawn = html;
    box.innerHTML = html;
  }

  const DOING = { read: "reading", edit: "editing", delete: "deleting", move: "moving files", search: "searching", execute: "running a command", think: "thinking", fetch: "fetching" };
  function whatIsHappening(m) {
    const calls = m.toolCalls || [];
    const running = [...calls].reverse().find((c) => c.status === "pending" || c.status === "in_progress");
    if (running) return DOING[running.kind] || "working";
    return m.text ? "writing" : "thinking";
  }
  function staleLabel(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 20) return "";
    if (seconds < 60) return `last sign ${Math.floor(seconds / 10) * 10}s ago`;
    return `last sign ${Math.floor(seconds / 60)}m ago`;
  }
  function liveSign(m, { lastSign, icon: ic, duration, now = Date.now() }) {
    const stale = staleLabel(now - lastSign);
    const doing = whatIsHappening(m);
    const calls = (m.toolCalls || []).length;
    const elapsed = duration(Math.max(0, now - (m.ts || now))) || "0 s";
    const parts = [`<span title="Time spent on this reply">${ic("clock")} ${elapsed}</span>`, `<span>${esc(doing)}</span>`];
    if (calls) parts.push(`<span title="Tool calls in this reply">${ic("tool")} ${calls} tool ${calls === 1 ? "call" : "calls"}</span>`);
    if (stale) parts.push(`<span title="Time since the last sign of activity">${stale}</span>`);
    return parts.join('<span class="sep">·</span>');
  }
  function liveMeta(m, look) {
    if (!m.streaming || !m.ts) return "";
    return `<span class="live" data-from="${esc(m.from)}" data-since="${m.ts}" title="what this reply is doing, and when it last showed a sign">${liveSign(m, look)}</span>`;
  }

  function seen(m, participants, { bodySupplied }) {
    const present = participants.filter((p) => p.kind === "agent" && p.status !== "left" && p.status !== "offline" && p.id !== m.from);
    if (!present.length) return "";
    const holding = present.filter((p) => bodySupplied(p, m));
    if (m.from === "human" && m.bodyDelivery) {
      return holding.length ? `<span class="ticks">✓✓</span> sent · seen by ${esc(holding.map(p => p.name).join(", "))}` : `<span class="ticks">✓</span> sent`;
    }
    if (holding.length === present.length) return "";
    const you = m.from !== "human";
    if (!holding.length) return `<span class="ticks">✓</span> sent${you ? " · seen by you" : ""}`;
    return `<span class="ticks">✓✓</span> seen by ${esc([...(you ? ["you"] : []), ...holding.map((p) => p.name)].join(", "))}`;
  }

  function branch(el, m, label) {
    let mark = el.querySelector(".carry-branch");
    if (m.branch && el.querySelector(".msg-head")) {
      if (!mark) { mark = el.ownerDocument.createElement("span"); mark.className = "carry-branch"; el.querySelector(".msg-head .name")?.after(mark); }
      mark.textContent = `branch · ${label || "another copy"}`;
      mark.title = "This part of the conversation was kept from a parallel branch.";
    } else mark?.remove();
  }
  function edited(el, m) {
    const mark = el.querySelector(".edited");
    if (!mark) return;
    mark.hidden = !m.edited;
    if (m.edited) {
      mark.textContent = "edited";
      mark.title = `before: ${m.edited.previous}`;
    }
  }
  function stopNoteText(m) {
    if (m.cancelledBy === "room") return m.text ? "viberoom stopped during this turn" : "viberoom stopped before this turn wrote anything";
    if (m.cancelledBy === "agent") return m.text ? "The agent ended this turn; nobody here stopped it" : "The agent ended this turn before it wrote anything";
    if (!m.stoppedBy) return m.text ? "This turn was cut short" : "This turn was cut short before it wrote anything";
    return m.text ? `Stopped by ${m.stoppedBy}` : `Stopped by ${m.stoppedBy} before it wrote anything`;
  }
  function failNoteText(m) {
    return m.text ? `The turn failed after this: ${m.failed}` : `The turn failed before it wrote anything: ${m.failed}`;
  }
  function stopNote(box, m, { note }) {
    if (!box) return;
    box.innerHTML = m.streaming ? ""
      : m.stopReason === "cancelled" ? note({ text: stopNoteText(m), tone: "attention", icon: "stop" })
      : m.failed ? note({ text: failNoteText(m), tone: "error", icon: "alert" })
      : "";
  }
  function notices(box, m, { note }) {
    box.innerHTML = (m.notices || []).map((n) => note({ text: n, tone: "attention" })).join("");
  }
  function thought(box, m) {
    if (!m.thought) return;
    box.hidden = false;
    box.querySelector(".thought-text").textContent = m.thought;
  }
  function plan(box, m) {
    if (!m.plan || !m.plan.length) return;
    box.hidden = false;
    box.innerHTML = m.plan.map((e) => `<div class="plan-entry ${e.status}">${esc(e.content)}</div>`).join("");
  }
  function stats(m, { icon: ic, duration, tokens }) {
    const parts = [];
    if (m.stopReason && m.stopReason !== "end_turn" && m.stopReason !== "cancelled") parts.push(`<span>${esc(m.stopReason)}</span>`);
    if (m.durationMs) parts.push(`<span title="how long the reply took">${ic("clock")} ${duration(m.durationMs)}</span>`);
    if (m.usage) parts.push(`<span title="tokens in">${ic("arrow-down")} ${tokens(m.usage.inputTokens)}</span><span title="tokens out">${ic("arrow-up")} ${tokens(m.usage.outputTokens)}</span>${m.usage.cachedWriteTokens ? `<span title="tokens written to the cache">${ic("database")} ${tokens(m.usage.cachedWriteTokens)}</span>` : ""}`);
    return parts.length ? `<span class="stats">${parts.join('<span class="sep">·</span>')}</span>` : "";
  }

  root.VIBEROOM_MESSAGE_PARTS = Object.freeze({ hidden, shots, sounds, videos, whatIsHappening, staleLabel, liveSign, liveMeta, seen, DOING,
    branch, edited, stopNoteText, failNoteText, stopNote, notices, thought, plan, stats });
})(typeof window !== "undefined" ? window : globalThis);
