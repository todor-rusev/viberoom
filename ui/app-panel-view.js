// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  const PANEL_SECTIONS = {
    room: [
      { id: "general", label: "General", glyph: "rooms", tone: "violet" },
      { id: "rules", label: "Rules", glyph: "journal", tone: "amber" },
      { id: "conversation", label: "Conversation", glyph: "chat", tone: "sky" },
      { id: "start", label: "Start", glyph: "power", tone: "mint" },
      { id: "briefs", label: "Briefs", glyph: "sliders", geek: true },
    ],
    vibemate: [
      { id: "persona", label: "Persona", glyph: "smile", tone: "peach" },
      { id: "agent", label: "Agent", glyph: "bot", tone: "violet" },
      { id: "skills", label: "Skills", glyph: "skills", tone: "orchid" },
      { id: "timing", label: "Timing", glyph: "clock", geek: true },
      { id: "stats", label: "Stats", glyph: "gauge", geek: true },
    ],
  };
  const PANEL_PREFIX = { room: "rp", vibemate: "pp" };
  function profileHeader(p, { avatar, esc, UI, STATUS_LABEL, STATUS_TONE }) {
    return `${avatar(p, 88, { vendor: true, status: true, muted: p.muted })}
        <div class="who">
          <h3>${esc(p.name)}</h3>
          <div class="tagline">${esc(p.tagline || "no vibersona")}</div>
          <div class="badges">${UI.html("badge", { label: p.agentVendor || p.agentType || "vibemate" })}${UI.html("badge", { label: STATUS_LABEL[p.status] || p.status, tone: STATUS_TONE[p.status] || "plain" })}${p.muted ? UI.html("badge", { label: "muted", tone: "muted" }) : ""}</div>
        </div>`;
  }
  function panelTitle(title, sub, side, UI) {
    const toward = side === "left" ? "collapse" : "expand";
    return `<div class="panel-title"><div><h3>${title}</h3>${sub ? `<div class="hint">${sub}</div>` : ""}</div>${UI.html("icon-button", { icon: toward, title: "Close", kind: "ghost", size: "sm", id: "details-close" })}</div>`;
  }
  function roomProfileHeader(room, { roomMark, esc }) {
    const rs = room.settings || {};
    return `${roomMark(room, "lg")}
        <div class="who">
          <h3>${esc(room.name)}</h3>
          <div class="tagline">${esc(rs.topic || "no topic")}</div>
        </div>`;
  }
  function panelSectionShown(kind, recall) {
    const saved = recall(`panel.${kind}.section`);
    return PANEL_SECTIONS[kind].some((c) => c.id === saved) ? saved : PANEL_SECTIONS[kind][0].id;
  }
  function panelSectionsHtml(kind, bodies, formId, { UI, recall }) {
    const items = PANEL_SECTIONS[kind];
    const prefix = PANEL_PREFIX[kind];
    const shown = panelSectionShown(kind, recall);
    return `${UI.html("settings-nav", { items, current: shown, layout: "row", prefix, label: `Sections of the ${kind === "room" ? "room's" : "vibemate's"} settings` })}
      <div id="${formId}" class="panel-sections" data-kind="${kind}">
        ${items.map((c) => UI.html("settings-category", { id: c.id, title: c.label, glyph: c.glyph, tone: c.tone || "slate", geek: !!c.geek, current: c.id === shown, form: "section", prefix, body: UI.raw(bodies[c.id] || "") })).join("")}
        <p class="hint panel-nothing" role="status" hidden></p>
      </div>`;
  }
  function panelSearchHtml(kind, placeholder, query, { ic, esc }) {
    return `<label class="search panel-search"><span class="search-icon">${ic("search")}</span><input type="search" id="panel-search" data-panel-kind="${kind}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" value="${esc(query || "")}"></label>`;
  }
  root.VIBEROOM_PANEL_VIEW = Object.freeze({ profileHeader, panelTitle, roomProfileHeader,
    panelSectionShown, panelSectionsHtml, panelSearchHtml });
})(globalThis);
