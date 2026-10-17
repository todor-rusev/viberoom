// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  function nowName(m, p) {
    return p && p.name && m.fromName && p.name !== m.fromName ? `<span class="now-name" title="${esc(m.fromName)} is called ${esc(p.name)} now">Now: ${esc(p.name)}</span>` : "";
  }
  function agentsNote(el, m, { icon: ic }) {
    el.className = "msg hidden";
    el.innerHTML = `<details class="hidden-turn"><summary>${ic("info")} room → vibemates · ${esc(m.text.split(":")[0])}</summary><div class="hidden-body"><div class="hidden-label">What the vibemates were told</div><div class="hidden-text">${esc(m.text)}</div></div></details>`;
  }
  function hubRow(el, m, { UI, face, fullTime }) {
    const details = m.details || {};
    const tone = ["attention", "error", "hush"].includes(details.tone) ? details.tone : "news";
    const drawn = face(details, tone);
    el.className = "msg system";
    el.innerHTML = UI.html("hub-row", { text: m.text, tone, ref: details.refId || undefined, face: drawn ? UI.raw(drawn) : undefined, title: details.refId ? `${fullTime(m.ts)} · go to the reply` : fullTime(m.ts) });
  }
  function bubble(el, m, p, { UI, icon: ic, face, time, fullTime }) {
    const mine = m.from === "human";
    el.className = "msg " + (mine ? "mine" : "agent");
    el.innerHTML = `
      <div class="bubble-col">
        <div class="msg-head"><span class="head-av">${face}</span><span class="name" style="--who:${p.color}">${esc(m.fromName)}</span>${nowName(m, p)}<span class="edited" hidden></span>${mine ? UI.html("icon-button", { icon: "pencil", title: "Edit this message", kind: "ghost", size: "xs", act: "edit" }) : UI.html("icon-button", { icon: "speaker", title: "Read it aloud", kind: "ghost", size: "xs", act: "read" })}${UI.html("icon-button", { icon: "quote", title: "Quote this message in your next one", kind: "ghost", size: "xs", act: "quote" })}${UI.html("icon-button", { icon: "pin", title: "Pin this message", kind: "ghost", size: "xs", act: "pin" })}${UI.html("icon-button", { icon: "copy", title: "Copy this message, formatted; the tool calls stay here", kind: "ghost", size: "xs", act: "copy" })}${UI.html("icon-button", { icon: "arrow-up", title: "Go to their previous message", kind: "ghost", size: "xs", act: "up" })}${UI.html("icon-button", { icon: "arrow-down", title: "Go to their next message", kind: "ghost", size: "xs", act: "down" })}<span class="time" title="${esc(fullTime(m.ts))}">${time(m.ts)}</span></div>
        <div class="bubble">
          ${m.skill ? `<div class="skill-invoke" title="skill invocation: the vibemates that have this skill got its instructions with this message">${ic("skills")} skill <b>${esc(m.skill.name)}</b></div>` : ""}
          <div class="edit-box" hidden></div>
          <details class="thought" hidden><summary>thoughts</summary><div class="thought-text"></div></details>
          <div class="agent-notices"></div>
          <div class="tools-line"><div class="tools"></div></div>
          <div class="plan" hidden></div>
          <div class="text"></div>
          <div class="shots"></div>
          <div class="sounds" hidden></div>
          <div class="videos" hidden></div>
          ${UI.html("button", { label: "Show more", kind: "link", act: "more", hidden: true })}
          <div class="stop-note"></div>
          <div class="perms"></div>
          <div class="waiting" hidden></div>
        </div>
        <div class="meta"></div>
      </div>`;
  }
  root.VIBEROOM_MESSAGE_BUBBLE = Object.freeze({ nowName, agentsNote, hubRow, bubble });
})(typeof window !== "undefined" ? window : globalThis);
