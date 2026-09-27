// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";
  const UI = globalThis.UI;

  UI.define("settings-group", {
    group: "settingsGroup",
    describe: "A named group of settings, as a card on its own paper, on a page of Settings, in a section of a side panel and in a dialog alike. It stays open: the menu at the side of Settings and the tabs of a panel are what keep a page short. Its settings (the setting type) run from edge to edge, a hairline between two.",
    props: {
      id: { type: "string", required: true },
      title: { type: "string", required: true, note: "empty on a card that is the whole of its page, the only one of its section, or what a dialog asks: the page, the tab or the dialog says it" },
      body: { type: "node", required: true },
      tone: { type: "enum", values: ["plain", "danger"], default: "plain" },
    },
    build: ({ id, title, body, tone }, ui) => ui.h("section", { id, "data-tone": tone },
      title ? ui.h("h3", {}, title) : null,
      ui.h("div", { class: "group-body" }, body)),
    states: ["rest"],
    samples: [
      { label: "a card", props: { id: "sample-settings-card", title: "Updates", body: UI.raw('<p class="hint">Check for a newer viberoom once a day.</p>') } },
      { label: "danger", props: { id: "sample-settings-danger", title: "Danger zone", body: UI.raw('<p class="hint">Actions that remove this room.</p>'), tone: "danger" } },
    ],
  });

  const GLYPH_TONES = ["violet", "sky", "orchid", "amber", "mint", "peach", "slate", "geek", "pad"];
  UI.define("settings-glyph", {
    group: "settingsGlyph",
    describe: "A category's picture on a tile in the category's own tint. The ones for geeks share two quiet tiles, each standing off its ground: geek, the paper's, on the darker pad of the menu; pad, the pad's own tint, at the top of their page, on the paper. The glyph is a rig: it plays its gesture when the pointer arrives at the entry that holds it, and once when its page opens. Small in the menu, large at the top of the page.",
    props: {
      glyph: { type: "icon", required: true, note: "a glyph of ui/icons.js; one with parts (a rig) plays a gesture" },
      tone: { type: "enum", values: GLYPH_TONES, default: "slate" },
      size: { type: "enum", values: ["sm", "lg"], default: "sm" },
    },
    build: ({ glyph, tone, size }, ui) => ui.h("span", { "data-tone": tone, "data-size": size, "aria-hidden": "true" }, ui.raw(globalThis.Icons.rig(glyph))),
    states: ["rest"],
    samples: [
      { label: "appearance", props: { glyph: "palette", tone: "peach" } },
      { label: "vibemates", props: { glyph: "bot", tone: "violet" } },
      { label: "channels", props: { glyph: "phone", tone: "sky" } },
      { label: "memory", props: { glyph: "graph", tone: "orchid" } },
      { label: "export / import", props: { glyph: "transfer", tone: "amber" } },
      { label: "editor", props: { glyph: "code", tone: "mint" } },
      { label: "system", props: { glyph: "power", tone: "slate" } },
      { label: "for geeks, on the pad of the menu", props: { glyph: "sliders", tone: "geek" } },
      { label: "large, at the top of a page", props: { glyph: "graph", tone: "orchid", size: "lg" } },
      { label: "large, at the top of a page for geeks", props: { glyph: "sliders", tone: "pad", size: "lg" } },
    ],
  });

  UI.define("settings-nav", {
    group: "settingsNav",
    describe: "The menu of a set of categories, an entry per category with its picture and its word: a column at the side of Settings, a row of tabs over the sections of a side panel. The one shown carries the accent's bar, which slides to the next one picked; the categories for geeks follow a labelled rule, on a darker pad. The arrows, Home and End move along it and show what they reach; Tab goes on to the page. Where a row has little room, the tabs' own words go and the word of the one shown stays (compact); \"for geeks:\" stays with them, and only where there is less room still does it give way to its glasses (tight).",
    props: {
      items: { type: "list", required: true, note: "[{ id, label, glyph, tone, geek, attention }] in the order shown; those for geeks after the others" },
      current: { type: "string", required: true, note: "the id of the category shown" },
      label: { type: "string", default: "Settings", note: "what a screen reader calls the menu" },
      layout: { type: "enum", values: ["column", "row"], default: "column", note: "row: the tabs over the sections of a side panel" },
      prefix: { type: "string", default: "sp", note: "the start of its ids and of its pages' ids (settings-category): sp on the page of Settings, one of its own in each panel" },
    },
    build: ({ items, current, label, layout, prefix }, ui) => {
      const entry = (item) => ui.h("li", {},
        ui.h("button", { type: "button", id: `${prefix}-tab-${item.id}`, "data-category": item.id, "aria-controls": `${prefix}-cat-${item.id}`, "aria-current": item.id === current ? "page" : null, "data-state": item.id === current ? "on" : null, tabindex: item.id === current ? "0" : "-1", title: item.label },
          ui.raw(UI.html("settings-glyph", { glyph: item.glyph, tone: item.geek ? "geek" : item.tone || "slate" })),
          ui.h("span", { class: "label", "data-text": item.label }, item.label),
          item.attention ? ui.h("span", { class: "dot", role: "img", "aria-label": item.attention, title: item.attention }) : null));
      const plain = items.filter((item) => !item.geek);
      const geeks = items.filter((item) => item.geek);
      return ui.h("nav", { class: "quiet-glyphs", "aria-label": label, "data-layout": layout === "row" ? "row" : null },
        ui.h("span", { class: "bar", "aria-hidden": "true" }),
        ui.h("ul", { class: "entries" }, plain.map(entry)),
        geeks.length ? ui.h("div", { class: "geeks" },
          ui.h("p", { class: "rule", id: `${prefix}-nav-geeks`, title: "For geeks" }, ui.icon("geek"), ui.h("span", {}, layout === "row" ? "for geeks:" : "for geeks")),
          ui.h("ul", { class: "entries", "aria-labelledby": `${prefix}-nav-geeks` }, geeks.map(entry))) : null);
    },
    states: ["rest", "compact", "tight"],
    samples: [
      {
        label: "the tabs of a side panel",
        props: {
          current: "sample-conversation",
          layout: "row",
          prefix: "sample-rp",
          label: "Room settings",
          items: [
            { id: "sample-general", label: "General", glyph: "rooms", tone: "violet" },
            { id: "sample-rules", label: "Rules", glyph: "journal", tone: "amber" },
            { id: "sample-conversation", label: "Conversation", glyph: "chat", tone: "sky" },
            { id: "sample-briefs", label: "Briefs", glyph: "sliders", geek: true },
          ],
        },
      },
      {
        label: "a menu",
        props: {
          current: "channels",
          items: [
            { id: "s-appearance", label: "Appearance", glyph: "palette", tone: "peach" },
            { id: "channels", label: "Channels", glyph: "phone", tone: "sky" },
            { id: "s-system", label: "System", glyph: "power", tone: "slate", attention: "This folder is not private" },
            { id: "s-defaults", label: "Defaults for new rooms", glyph: "sliders", geek: true },
            { id: "s-trouble", label: "Troubleshooting", glyph: "pulse", geek: true },
          ],
        },
      },
    ],
  });

  UI.define("settings-category", {
    group: "settingsCategory",
    describe: "One category as a page of Settings, or as a section of a side panel: its picture, its name and a line on what it holds, then its groups as cards. The page of every other category stays in the form, hidden, so a save still sees every field. A section of a panel shows its name only while the panel searches (found): the tab above names it otherwise.",
    props: {
      id: { type: "string", required: true },
      title: { type: "string", required: true },
      about: { type: "string", default: "" },
      glyph: { type: "icon", required: true },
      tone: { type: "enum", values: GLYPH_TONES, default: "slate" },
      geek: { type: "boolean", default: false },
      current: { type: "boolean", default: false, note: "the page shown; the others are hidden" },
      body: { type: "node", required: true },
      form: { type: "enum", values: ["page", "section"], default: "page", note: "section: a section of a side panel, under the panel's tabs (settings-nav in a row)" },
      prefix: { type: "string", default: "sp", note: "the start of its id, the same as its menu's" },
    },
    build: ({ id, title, about, glyph, tone, geek, current, body, form, prefix }, ui) => {
      const section = form === "section";
      return ui.h("section", { id: `${prefix}-cat-${id}`, "data-category": id, "data-geek": geek || null, "data-form": section ? "section" : null, "aria-labelledby": `${prefix}-cat-${id}-title`, hidden: !current },
        ui.h("header", { class: "head" },
          ui.raw(UI.html("settings-glyph", { glyph, tone: geek ? "pad" : tone, size: section ? "sm" : "lg" })),
          ui.h("div", { class: "words" },
            geek ? ui.h("span", { class: "for-geeks" }, ui.icon("geek"), "for geeks") : null,
            ui.h(section ? "h4" : "h2", { id: `${prefix}-cat-${id}-title` }, title),
            about && !section ? ui.h("p", {}, about) : null)),
        ui.h("div", { class: "body" }, body));
    },
    states: ["rest", "found"],
    samples: [
      { label: "a page", props: { id: "sample-memory", title: "Long-term memory", about: "What the rooms that remember learn, and where it is kept.", glyph: "graph", tone: "orchid", current: true, body: UI.raw('<p class="hint">The groups of the category come here, as cards.</p>') } },
      { label: "a page for geeks", props: { id: "sample-defaults", title: "Defaults for new rooms", about: "Where every new room starts.", glyph: "sliders", geek: true, current: true, body: UI.raw('<p class="hint">Each room can change them later.</p>') } },
      { label: "a section of a panel, where the search found something", props: { id: "sample-rules", prefix: "sample-rp", form: "section", title: "Rules", glyph: "journal", tone: "amber", current: true, body: UI.raw('<p class="hint">Its cards come here; the name above shows only while the panel searches.</p>') } },
    ],
  });

  const HEX = /^#[0-9a-f]{6}$/i;
  function inkOn(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return 1.05 / (lum + 0.05) >= 3 ? "light" : "dark";
  }
  UI.define("logo-tile", {
    group: "logoTile",
    describe: "A vendor's mark on a tile: the vendor's own drawing laid over the look's ink through a mask, so it reads on any paper; a letter stands in where there is no drawing, a glyph from the icon set for the marks the room adds (muted). With a brand colour the tile wears it and the mark is white, or black where white would not stand out. As a badge it sits in a face's corner.",
    props: {
      icon: { type: "string", note: "the drawing's url (a recipe's icon); empty for a letter" },
      letter: { type: "string", note: "the letter shown without a drawing" },
      glyph: { type: "icon", note: "an icon from the set instead of a drawing (the mute mark)" },
      brand: { type: "string", note: "#rrggbb: the tile in the brand's colour, like its app icon (a catalogue system); data-brand says light or dark mark" },
      size: { type: "enum", values: ["sm", "md", "lg", "badge"], default: "md", note: "badge: the corner of a face, sized by the face" },
      tone: { type: "enum", values: ["plain", "muted", "unplugged"], default: "plain", note: "unplugged: the vendor is logged out (U147)" },
      title: { type: "string" },
    },
    build: ({ icon, letter, glyph, brand, size, tone, title }, ui) => {
      const branded = typeof brand === "string" && HEX.test(brand);
      const style = [icon ? `--logo:url("${icon}")` : "", branded ? `--logo-brand:${brand}` : ""].filter(Boolean).join(";");
      return ui.h("span", { "data-size": size, "data-tone": tone !== "plain" ? tone : null, "data-brand": branded ? inkOn(brand) : null, title, style: style || null, role: title ? "img" : null, "aria-label": title || null },
        icon ? ui.h("span", { class: "mark" }) : glyph ? ui.icon(glyph) : ui.h("span", { class: "letter" }, (letter || "?").slice(0, 1).toUpperCase()));
    },
    states: ["rest"],
    samples: (() => {
      const p = globalThis.VIBEROOM_TOKENS.current.palette;
      return [
      { label: "a drawing", props: { icon: "vendor-icons/claude.svg", title: "Claude" } },
      { label: "another", props: { icon: "vendor-icons/codex.svg", size: "lg", title: "Codex" } },
      { label: "a letter", props: { letter: "F", size: "sm", title: "Fake" } },
      { label: "a badge", props: { icon: "vendor-icons/gemini.svg", size: "badge", title: "Gemini" } },
      { label: "muted", props: { glyph: "mute", size: "badge", tone: "muted", title: "muted: receives no prompts" } },
      { label: "unplugged", props: { glyph: "unplugged", size: "badge", tone: "unplugged", title: "not logged in" } },
      { label: "a brand, light mark", props: { icon: "/connection-logos/linear.svg", brand: p.indigo, title: "Linear" } },
      { label: "a brand, dark mark", props: { icon: "/connection-logos/huggingface.svg", brand: p.spark, title: "Hugging Face" } },
      ];
    })(),
  });

  const facePicture = (url) => typeof url === "string" && /^faces\/[a-z][a-z0-9-]{1,31}\.webp$/.test(url);

  const FACE_STATUSES = ["idle", "queued", "starting", "thinking", "writing", "error", "offline", "left", "unstaffed"];
  UI.define("face", {
    group: "face",
    describe: "A participant's face: a tile in its colour's tint with the initials or the emoji in the colour itself; a vendor's mark in the corner (a logo-tile), a status dot at the foot (the roster patches its data-status on its own), the accent ring on the human's own. The size is the caller's (px); the colours are the look's. Composed through the .avatar hook: where it sits, how big, the life ring the roster lays over it.",
    props: {
      name: { type: "string", required: true },
      label: { type: "string", required: true, note: "the initials or the emoji" },
      color: { type: "string", required: true, note: "the participant's colour, #rrggbb" },
      size: { type: "number", required: true, note: "px" },
      emoji: { type: "boolean", default: false, note: "the label is an emoji: bigger" },
      picture: { type: "string", note: "a picture of viberoom's (/faces/<id>.webp) instead of the label, which stays its name for a reader" },
      badge: { type: "node", note: "markup of the mark in the corner (a logo-tile), as ui.raw" },
      status: { type: "enum", values: FACE_STATUSES, note: "the dot at the foot" },
      me: { type: "boolean", default: false, note: "the human's own face: wears the accent ring" },
      kind: { type: "enum", values: ["tile", "card", "bare"], default: "tile", note: "card: on the profile card, on paper with a shadow; bare: no tile (the rail)" },
      ring: { type: "boolean", default: false, note: "a ring in the paper's colour, for faces that overlap in a stack" },
      alert: { type: "boolean", default: false, note: "the vibemate needs the human (U144): a breathing ring in the attention colour" },
      dim: { type: "enum", values: ["asleep", "unstaffed"], note: "greyed: asleep a little, unstaffed more" },
      title: { type: "string" },
    },
    build: ({ name, label, color, size, emoji, picture, badge, status, me, kind, ring, alert, dim, title }, ui) =>
      ui.h("span", { class: "avatar", role: "img", "aria-label": name, title, "data-kind": kind !== "tile" ? kind : null, "data-me": me || null, "data-ring": ring || null, "data-alert": alert || null, "data-dim": dim || null, style: `--face-color:${color};--face-size:${size}px;width:${size}px;height:${size}px` },
        facePicture(picture)
          ? ui.h("span", { class: "tile", "data-picture": "" }, ui.h("img", { class: "glyph pic", src: picture, alt: "", draggable: "false", decoding: "async" }))
          : ui.h("span", { class: "tile", "data-emoji": emoji || null, style: `font-size:${Math.round(emoji ? size * 0.56 : size * 0.38)}px` },
            ui.h("span", { class: "glyph" }, label)),
        badge,
        status ? ui.h("span", { class: "status", "data-status": status }) : null),
    states: ["rest"],
    samples: (() => {
      const p = globalThis.VIBEROOM_TOKENS.current.palette;
      return [
        { label: "initials", props: { name: "Maken", label: "MA", color: p.primary, size: 44 } },
        { label: "an emoji, a vendor", props: { name: "Sam", label: "🦊", emoji: true, color: p.orange, size: 44, badge: UI.raw(UI.html("logo-tile", { icon: "vendor-icons/claude.svg", size: "badge", title: "Claude" })), status: "thinking" } },
        { label: "you", props: { name: "You", label: "🧑‍💻", emoji: true, color: p.indigo, size: 44, me: true } },
        { label: "needs you", props: { name: "Nia", label: "NI", color: p.primary, size: 44, alert: true, status: "error" } },
        { label: "asleep", props: { name: "Rex", label: "🦖", emoji: true, color: p.green, size: 44, dim: "asleep", status: "offline", badge: UI.raw(UI.html("logo-tile", { glyph: "mute", size: "badge", tone: "muted", title: "muted" })) } },
        { label: "on the card", props: { name: "You", label: "🧑‍💻", emoji: true, color: p.indigo, size: 64, kind: "card" } },
        { label: "a picture", props: { name: "Fox", label: "FO", picture: "/faces/fox.webp", color: p.orange, size: 64 } },
      ];
    })(),
  });

  UI.define("room-mark", {
    group: "roomMark",
    describe: "A room's mark: a square in the room's own hue with the first letter of its name, or its emoji on a paler square; the hue is the room's (from its id, set on the element), the recipe (how light, how saturated, the ink) is the look's. The accent kind is the mark of the whole, on the accent (all skills, no rooms yet).",
    props: {
      hue: { type: "number", note: "0–359, the room's own; not for the accent kind" },
      letter: { type: "string", note: "the first letter of the room's name" },
      emoji: { type: "string", note: "the room's emoji, instead of the letter" },
      picture: { type: "string", note: "a room picture of viberoom's (/faces/<id>.webp), instead of the emoji or the letter" },
      icon: { type: "icon", note: "the accent kind: an icon on the accent gradient" },
      size: { type: "enum", values: ["sm", "md", "lg"], default: "md", note: "sm: before a name in a list; md: a tile; lg: a panel's head" },
      title: { type: "string" },
    },
    build: ({ hue, letter, emoji, picture, icon, size, title }, ui) => {
      const kind = icon ? "accent" : facePicture(picture) ? "picture" : emoji ? "emoji" : "letter";
      const style = icon ? null : `--room-hue:${Number(hue) || 0};--room-hue-2:${((Number(hue) || 0) + 30) % 360}`;
      const glyph = icon ? ui.icon(icon)
        : kind === "picture" ? ui.h("img", { class: "rm-pic", src: picture, alt: "", draggable: "false", decoding: "async" })
        : ui.h("span", { class: "rm-glyph" }, emoji || (letter || "?").slice(0, 1).toUpperCase());
      return ui.h("span", { "data-kind": kind, "data-size": size !== "md" ? size : null, style, title }, glyph);
    },
    states: ["rest"],
    samples: [
      { label: "a letter", props: { hue: 200, letter: "V", title: "Vibes" } },
      { label: "an emoji", props: { hue: 40, emoji: "🎭", title: "Theatre" } },
      { label: "a picture", props: { hue: 200, picture: "/faces/ideas.webp", title: "Ideas" } },
      { label: "large", props: { hue: 300, letter: "P", size: "lg" } },
      { label: "small", props: { hue: 120, letter: "S", size: "sm" } },
      { label: "the accent", props: { icon: "skills", title: "All skills" } },
    ],
  });

  UI.define("unseen-line", {
    group: "unseenLine",
    describe: "A vibemate's starting position in the conversation, with a separate note about earlier history. The rule's drawing belongs to the look; this is distinct from the boundary of the history loaded in the window.",
    props: {
      label: { type: "string", required: true, note: "who started from this position" },
      detail: { type: "string", note: "how earlier messages can be reached" },
      title: { type: "string", note: "explanation of the starting context" },
    },
    build: ({ label, detail, title }, ui) => ui.h("div", { title }, ui.h("span", { class: "line", "aria-hidden": "true" }), ui.h("span", { class: "label" }, ui.h("span", { class: "caption" }, label), detail ? ui.h("span", { class: "detail" }, detail) : null), ui.h("span", { class: "line", "aria-hidden": "true" })),
    states: ["rest"],
    samples: [
      { label: "one vibemate", props: { label: "Maken started from here", detail: "but it can still read the earlier messages." } },
      { label: "two", props: { label: "Maken and Sam started from here", detail: "Earlier messages remain in the room history." } },
    ],
  });

  UI.define("skeleton", {
    group: "skeleton",
    describe: "Grey bones in the shape of the content that is on its way (a message body, the conversation), with one soft band of light sweeping over them. Decorative: the words that say what loads stay beside it for screen readers.",
    props: {
      lines: { type: "number", default: 3, note: "how many bones, 1–6; each is a little shorter than the one before" },
      shape: { type: "enum", values: ["lines", "bubble"], default: "lines", note: "bubble: the bones sit on a message-shaped card with a face beside it" },
    },
    build: ({ lines, shape }, ui) => {
      const bones = Array.from({ length: Math.max(1, Math.min(6, Math.round(Number(lines) || 3))) }, () => ui.h("i", {}));
      return ui.h("span", { "aria-hidden": "true", "data-shape": shape }, shape === "bubble" ? [ui.h("b", { class: "face" }), ui.h("span", { class: "card" }, bones)] : bones);
    },
    states: ["rest"],
    samples: [
      { label: "three lines", props: { lines: 3 } },
      { label: "a message on its way", props: { lines: 2, shape: "bubble" } },
    ],
  });

  UI.define("number-field", {
    group: "numberField",
    describe: "A number to type or step: the field with two small steps at its right edge, drawn from the look instead of the browser's own spinner (U126). Its input wears the house look of a field (.input) wherever it sits, so it is a field on a card of Settings as much as in a panel. A step raises the same input and change events a typed value does, so a form saves on it. The id, the bounds and the step are the caller's.",
    props: {
      id: { type: "string" },
      value: { type: "string", note: "the current value, as text; empty for none" },
      min: { type: "number" },
      max: { type: "number" },
      step: { type: "number" },
      placeholder: { type: "string" },
      hook: { type: "string", note: "a class the page composes with (where it sits, how wide)" },
      data: { type: "object", note: "data-* marks on the input, for the page's own handlers" },
      disabled: { type: "boolean", default: false },
    },
    build: ({ id, value, min, max, step, placeholder, hook, data, disabled }, ui) =>
      ui.h("span", { class: hook },
        ui.h("input", { type: "number", class: "input", id, value, min, max, step, placeholder, disabled, ...ui.dataAttrs(data) }),
        ui.h("span", { class: "steps", "aria-hidden": "true" },
          ui.h("button", { type: "button", "data-act": "up", tabindex: "-1", title: "More" }),
          ui.h("button", { type: "button", "data-act": "down", tabindex: "-1", title: "Less" }))),
    states: ["rest", "disabled"],
    samples: [
      { label: "seconds", props: { value: "4", min: 0, max: 120, step: 0.5 } },
      { label: "empty, with a placeholder", props: { value: "", min: 1, max: 100, placeholder: "no limit" } },
    ],
  });

  UI.define("slider-field", {
    group: "sliderField",
    describe: "A value picked by dragging along a range, the number written beside it in its unit: for a setting that is felt rather than typed, like the scale of the whole window (Settings → Appearance). The range raises the browser's own input and change events, so a form saves on it; the page keeps the number beside it in step as the human drags.",
    props: {
      id: { type: "string" },
      value: { type: "string", required: true, note: "the current value, as text" },
      min: { type: "number" },
      max: { type: "number" },
      step: { type: "number" },
      unit: { type: "string", note: "written after the number, e.g. %" },
      label: { type: "string", required: true, note: "what the range is, for a screen reader" },
      hook: { type: "string", note: "a class the page composes with" },
      data: { type: "object", note: "data-* marks on the range, for the page's own handlers" },
    },
    build: ({ id, value, min, max, step, unit, label, hook, data }, ui) =>
      ui.h("span", { class: hook },
        ui.h("input", { type: "range", id, value, min, max, step, "aria-label": label, ...ui.dataAttrs(data) }),
        ui.h("output", { class: "value", for: id }, `${value}${unit || ""}`)),
    states: ["rest"],
    samples: [
      { label: "a scale in per cent", props: { value: "100", min: 70, max: 150, step: 5, unit: "%", label: "Scale" } },
      { label: "near its end", props: { value: "145", min: 70, max: 150, step: 5, unit: "%", label: "Scale" } },
    ],
  });

  UI.define("adjust-row", {
    group: "adjustRow",
    describe: "One thing the human may adjust in a look (U125): its name and what it colours on the left, the control on the right — a swatch with its value for a colour, a slider with its value for a scale — and, once the value differs from the look's own, the way back. Settings → Appearance lists them by group from the adjustables in tokens.js; the page keeps data-state and the value in step as the human picks.",
    props: {
      key: { type: "string", required: true, note: "the adjustable's key (data-key), what the room keeps it under" },
      label: { type: "string", required: true },
      hint: { type: "string", note: "what it colours" },
      kind: { type: "enum", values: ["colour", "scale"], default: "colour" },
      value: { type: "string", required: true, note: "#rrggbb, or the scale as a number" },
      own: { type: "string", required: true, note: "the look's own value: the row shows the way back when value differs" },
      min: { type: "number", note: "scale only" },
      max: { type: "number", note: "scale only" },
      step: { type: "number", note: "scale only" },
    },
    build: ({ key, label, hint, kind, value, own, min, max, step }, ui) => {
      const changed = String(value).toLowerCase() !== String(own).toLowerCase();
      const input = kind === "scale"
        ? ui.h("input", { type: "range", value, min, max, step, "aria-label": label })
        : ui.h("input", { type: "color", value, "aria-label": label });
      return ui.h("div", { "data-key": key, "data-kind": kind, "data-state": changed ? "changed" : null },
        ui.h("span", { class: "what" }, ui.h("span", { class: "label" }, label), hint ? ui.h("span", { class: "hint" }, hint) : null),
        ui.h("span", { class: "ctl" }, input, ui.h("code", { class: "value" }, value),
          ui.h("button", { type: "button", class: "back", "data-act": "reset", title: `Back to the look's own, ${own}`, "aria-label": "Back to the look's own" }, ui.icon("refresh"))));
    },
    states: ["rest", "changed"],
    samples: (() => {
      const p = globalThis.VIBEROOM_TOKENS.current.palette;
      return [
        { label: "a colour, as designed", props: { key: "canvas", label: "Chat paper", hint: "behind the messages", value: p.bg, own: p.bg } },
        { label: "a colour, changed", props: { key: "accent", label: "Accent", hint: "buttons, links", value: p.orange, own: p.primary } },
        { label: "a scale", props: { key: "corners", label: "Corners", hint: "0 is square", kind: "scale", value: "1", own: "1", min: 0, max: 1.5, step: 0.05 } },
      ];
    })(),
  });

  UI.define("row-button", {
    group: "rowButton",
    describe: "A small action on a vibemate's row: open its panel, go to its last reply, wake it up. The row reveals the buttons on hover; all three wear one pill.",
    props: {
      icon: { type: "icon", required: true },
      title: { type: "string", required: true, note: "what it does, in words: the tooltip and the accessible name" },
      act: { type: "string", required: true, note: "the action app.js answers: panel | last-reply | wake" },
      disabled: { type: "boolean", default: false },
    },
    build: ({ icon, title, act, disabled }, ui) => ui.h("button", { type: "button", "data-act": act, title, "aria-label": title, disabled }, ui.icon(icon)),
    states: ["rest", "hover", "active", "disabled"],
    samples: [
      { label: "the panel", props: { icon: "settings", title: "Open the panel", act: "panel" } },
      { label: "its last reply", props: { icon: "last-reply", title: "Go to the last reply", act: "last-reply" } },
      { label: "wake it up", props: { icon: "refresh", title: "Wake it up: reconnect it to the room", act: "wake" } },
    ],
  });

  UI.define("hub-row", {
    group: "hubRow",
    describe: "A line the room writes into the chat (U114): news in muted words; a tone colours it (attention, error, hush); the one row that leads somewhere carries a ref and is a button with a backing, the only row that ever wears one.",
    props: {
      text: { type: "string", required: true },
      tone: { type: "enum", values: ["news", "attention", "error", "hush"], default: "news", note: "what kind of news the room says it is" },
      ref: { type: "string", note: "the id of the message the row leads to; with it the row is a button" },
      face: { type: "node", note: "markup of a face before the words (ui.raw): the vibemate's, or the shushing one" },
      title: { type: "string", note: "the tooltip: when, and where a click goes" },
    },
    build: ({ text, tone, ref, face, title }, ui) =>
      ref
        ? ui.h("button", { type: "button", "data-tone": tone, "data-ref": ref, title }, face, ui.h("span", {}, text))
        : ui.h("div", { "data-tone": tone, title }, face, ui.h("span", {}, text)),
    states: ["rest", "hover"],
    samples: [
      { label: "news", props: { text: "Maken is back in the room (session restored)." } },
      { label: "attention", props: { text: "Maken is at 84% of its context; it will leave notes with its next reply.", tone: "attention" } },
      { label: "error", props: { text: "Maken could not answer: no result", tone: "error" } },
      { label: "hush", props: { text: "Hush: everyone waits until you write again.", tone: "hush", face: UI.raw('<span class="hush-face" aria-hidden="true"></span>') } },
      { label: "leads to a reply", props: { text: "Maken finished the reply started at 16:21 · 2m 30s", ref: "sample", title: "go to the reply", face: UI.raw(UI.html("face", { name: "Maken", label: "🔨", emoji: true, color: globalThis.VIBEROOM_TOKENS.current.palette.primary, size: 20 })) } },
    ],
  });

  const BUTTON_KINDS = ["plain", "primary", "secondary", "soft", "ghost", "danger", "danger-quiet", "danger-solid", "dark", "warn", "inverse", "link", "ok", "paper"];
  const BUTTON_SIZES = ["md", "sm", "xs", "lg", "cta"];
  UI.define("button", {
    group: "btn",
    describe: "A button with words on it: the one type behind every Cancel, Summon, Save and Erase. Its kind says how loud it is and where it can sit (primary is the one thing to do; ghost is the way out; danger warns; danger-solid is the point of no return; dark sits on a code card; warn is a quiet amber word such as Stop; inverse sits on the accent; link is a word that acts), its size where it stands.",
    props: {
      label: { type: "string", required: true, note: "the words on it (wrapped in .label, so the page may change them)" },
      icon: { type: "icon", note: "a glyph before the words" },
      lead: { type: "node", note: "markup before the words that is not a glyph (a face), as ui.raw" },
      trail: { type: "node", note: "markup after the words (a hint), as ui.raw" },
      kind: { type: "enum", values: BUTTON_KINDS, default: "plain" },
      size: { type: "enum", values: BUTTON_SIZES, default: "md" },
      full: { type: "boolean", default: false, note: "as wide as its row" },
      pill: { type: "boolean", default: false },
      type: { type: "enum", values: ["button", "submit"], default: "button" },
      id: { type: "string" },
      act: { type: "string", note: "the action a delegated handler answers (data-act)" },
      value: { type: "string", note: "what a dialog form returns when this button submits it" },
      title: { type: "string" },
      disabled: { type: "boolean", default: false },
      hidden: { type: "boolean", default: false },
      autofocus: { type: "boolean", default: false },
      hook: { type: "string", note: "classes the page composes with (where it sits, its page states); no look of its own" },
      data: { type: "object", note: "data-* marks for the page's own handlers: { close: true, approveSkill: name }" },
    },
    build: ({ label, icon, lead, trail, kind, size, full, pill, type, id, act, value, title, disabled, hidden, autofocus, hook, data }, ui) =>
      ui.h(
        "button",
        {
          type,
          "data-kind": kind === "plain" ? null : kind,
          "data-size": size === "md" ? null : size,
          "data-full": full || null,
          "data-pill": pill || null,
          "data-act": act,
          id,
          value,
          title,
          disabled,
          hidden,
          autofocus,
          class: hook || null,
          ...ui.dataAttrs(data),
        },
        icon ? ui.icon(icon) : null,
        lead || null,
        ui.h("span", { class: "label" }, label),
        trail || null,
      ),
    states: ["rest", "hover", "active", "disabled", "loading"],
    samples: [
      { label: "plain", props: { label: "Check now" } },
      { label: "primary", props: { label: "Summon", kind: "primary" } },
      { label: "secondary", props: { label: "Later", kind: "secondary" } },
      { label: "soft", props: { label: "Browse", kind: "soft", icon: "folder" } },
      { label: "ghost", props: { label: "Cancel", kind: "ghost" } },
      { label: "danger", props: { label: "Respawn", kind: "danger", icon: "bolt", size: "sm" } },
      { label: "danger-quiet", props: { label: "Unpair", kind: "danger-quiet", size: "xs" } },
      { label: "danger-solid", props: { label: "Erase everything", kind: "danger-solid" } },
      { label: "small", props: { label: "Save", kind: "primary", size: "sm" } },
      { label: "large", props: { label: "Start vibing", kind: "primary", size: "lg" } },
      { label: "call to action", props: { label: "Summon a Vibemate", kind: "primary", size: "cta", icon: "spark" } },
      { label: "on a code card", props: { label: "open", kind: "dark", size: "xs" } },
      { label: "a quiet warning", props: { label: "Stop", kind: "warn", size: "xs" } },
      { label: "on the accent", props: { label: "Stop Ana and send now", kind: "inverse", size: "sm" } },
      { label: "a word that acts", props: { label: "Show more", kind: "link" } },
      { label: "yes, on a card", props: { label: "Allow", kind: "ok", size: "sm" } },
      { label: "plain, on a card", props: { label: "Dismiss", kind: "paper", size: "sm" } },
    ],
  });

  UI.define("icon-button", {
    group: "iconButton",
    describe: "A button that is only a glyph: close, settings, back, fold. Its title is its whole meaning, so it is required and doubles as the accessible name.",
    props: {
      icon: { type: "icon", required: true },
      title: { type: "string", required: true, note: "what it does, in words: the tooltip and the accessible name" },
      kind: { type: "enum", values: ["plain", "ghost", "primary", "danger", "inline"], default: "plain", note: "inline: a glyph in running text (the preview eye), with an on state" },
      size: { type: "enum", values: ["md", "sm", "xs"], default: "md" },
      id: { type: "string" },
      act: { type: "string" },
      disabled: { type: "boolean", default: false },
      hidden: { type: "boolean", default: false },
      hook: { type: "string", note: "classes the page composes with; no look of its own" },
      data: { type: "object" },
    },
    build: ({ icon, title, kind, size, id, act, disabled, hidden, hook, data }, ui) =>
      ui.h("button", { type: "button", "data-kind": kind === "plain" ? null : kind, "data-size": size === "md" ? null : size, "data-act": act, id, title, "aria-label": title, disabled, hidden, class: hook || null, ...ui.dataAttrs(data) }, ui.icon(icon)),
    states: ["rest", "hover", "active", "disabled", "on"],
    samples: [
      { label: "plain", props: { icon: "settings", title: "Room settings" } },
      { label: "ghost, small", props: { icon: "close", title: "Close", kind: "ghost", size: "sm" } },
      { label: "ghost, tiny (a bubble's head)", props: { icon: "pin", title: "Pin this message", kind: "ghost", size: "xs" } },
      { label: "primary", props: { icon: "send", title: "Send", kind: "primary" } },
      { label: "danger", props: { icon: "trash", title: "Remove", kind: "danger" } },
      { label: "inline (the preview eye)", props: { icon: "eye", title: "Preview", kind: "inline", size: "xs" } },
    ],
  });

  UI.define("choice", {
    group: "choice",
    describe: "One option of a few, as a pill: the chosen one is lit (on). What choosing does is the page's: a data mark says which option this is.",
    props: {
      label: { type: "string", required: true },
      lead: { type: "node", note: "markup before the words (a colour swatch), as ui.raw" },
      trail: { type: "node", note: "markup after the words (a hint), as ui.raw" },
      on: { type: "boolean", default: false, note: "the chosen one" },
      quiet: { type: "boolean", default: false, note: "the option that means none" },
      act: { type: "string" },
      id: { type: "string" },
      title: { type: "string" },
      hook: { type: "string" },
      data: { type: "object", note: "which option this is: { mode: 'auto' }, { preset: 'pop' }" },
    },
    build: ({ label, lead, trail, on, quiet, act, id, title, hook, data }, ui) =>
      ui.h("button", { type: "button", "data-state": on ? "on" : null, "data-quiet": quiet || null, "data-act": act, id, title, "aria-pressed": on ? "true" : "false", class: hook || null, ...ui.dataAttrs(data) }, lead || null, ui.h("span", { class: "label" }, label), trail || null),
    states: ["rest", "hover", "on"],
    samples: [
      { label: "an option", props: { label: "The default app" } },
      { label: "the chosen one", props: { label: "Auto", on: true } },
      { label: "none", props: { label: "No preset", quiet: true } },
    ],
  });

  UI.define("badge", {
    group: "badge",
    describe: "A small label that states a fact: a vibemate's state, its vendor, a mark on a skill or a template. Its tone is the room's state family (ready, waiting, thinking, writing, error, asleep) or a quiet look (plain, muted, outline) or attention; it never does anything by itself.",
    props: {
      label: { type: "string", required: true },
      tone: { type: "enum", values: ["plain", "ready", "waiting", "thinking", "writing", "error", "asleep", "attention", "muted", "outline"], default: "plain" },
      dot: { type: "boolean", default: false, note: "a dot before the words; it pulses while thinking or writing" },
      size: { type: "enum", values: ["md", "xs"], default: "md" },
      title: { type: "string" },
      hook: { type: "string" },
    },
    build: ({ label, tone, dot, size, title, hook }, ui) => ui.h("span", { "data-tone": tone === "plain" ? null : tone, "data-size": size === "md" ? null : size, title, class: hook || null }, dot ? ui.h("span", { class: "dot" }) : null, label),
    states: ["rest"],
    samples: [
      { label: "plain", props: { label: "vibemate" } },
      { label: "ready", props: { label: "ready", tone: "ready", dot: true } },
      { label: "waiting", props: { label: "waiting…", tone: "waiting" } },
      { label: "thinking", props: { label: "thinking…", tone: "thinking", dot: true } },
      { label: "writing", props: { label: "writing…", tone: "writing", dot: true } },
      { label: "error", props: { label: "error", tone: "error" } },
      { label: "asleep", props: { label: "offline", tone: "asleep" } },
      { label: "attention", props: { label: "summon", tone: "attention" } },
      { label: "muted", props: { label: "muted", tone: "muted" } },
      { label: "outline", props: { label: "built-in", tone: "outline" } },
      { label: "tiny", props: { label: "recommended", tone: "attention", size: "xs" } },
    ],
  });

  UI.define("chip", {
    group: "chip",
    describe: "A small tag that names a thing: the room's folder, a tool call, a template's run. As a button it opens or unfolds what it names; its tone follows the state of the thing (a tool call that completed, failed, is still running).",
    props: {
      label: { type: "string", required: true },
      icon: { type: "icon" },
      tone: { type: "enum", values: ["plain", "ready", "error", "thinking", "waiting"], default: "plain" },
      button: { type: "boolean", default: false, note: "a chip that does something when clicked" },
      act: { type: "string" },
      id: { type: "string" },
      title: { type: "string" },
      hidden: { type: "boolean", default: false },
      hook: { type: "string" },
      data: { type: "object" },
    },
    build: ({ label, icon, tone, button, act, id, title, hidden, hook, data }, ui) =>
      ui.h(button ? "button" : "span", { ...(button ? { type: "button" } : {}), "data-tone": tone === "plain" ? null : tone, "data-button": button || null, "data-act": act, id, title, hidden, class: hook || null, ...ui.dataAttrs(data) }, icon ? ui.icon(icon) : null, label),
    states: ["rest", "hover"],
    samples: [
      { label: "a name", props: { label: "src", icon: "folder" } },
      { label: "a button", props: { label: "3 pinned", icon: "pin", button: true } },
      { label: "a tool call, done", props: { label: "Read file · completed", icon: "tool", tone: "ready", button: true } },
      { label: "a tool call, failed", props: { label: "Bash · failed", icon: "tool", tone: "error", button: true } },
      { label: "a tool call, running", props: { label: "Grep · in_progress", icon: "tool", tone: "thinking", button: true } },
    ],
  });

  UI.define("file-card", {
    group: "fileCard",
    describe: "A fragment of a file, a picture, or a video or a sound, under the message that names it: a dark card whose head says the file's name and the lines shown and offers to open the whole file; its body is the code, the drawing or the player. What could not be shown says why in the body instead.",
    props: {
      name: { type: "string", required: true },
      lines: { type: "string", note: "what part is shown, in words: 'lines 120–160', or a picture's size once it loaded" },
      kind: { type: "enum", values: ["code", "image", "doc", "media"], default: "code", note: "doc: a rendered Markdown page or a CSV table instead of source; media: a video or a sound, with its player" },
      body: { type: "html", note: "the code view or the picture: markup the caller vouches for" },
      error: { type: "string", note: "why the file could not be shown; takes the body's place" },
      act: { type: "string", default: "open-file", note: "the head button's act" },
      openTitle: { type: "string", default: "Open the whole file in the room" },
      hook: { type: "string" },
      data: { type: "object" },
    },
    build: ({ name, lines, kind, body, error, act, openTitle, hook, data }, ui) =>
      ui.h("div", { "data-kind": kind === "code" ? null : kind, class: hook || null, ...ui.dataAttrs(data) },
        ui.h("div", { class: "head" }, ui.h("span", { class: "name" }, ui.icon("link"), name), ui.h("span", { class: "lines" }, lines || ""), ui.build("button", { label: "open", kind: "dark", size: "xs", act, title: openTitle })),
        ui.h("div", { class: "body" }, error ? ui.h("div", { class: "note" }, error) : body ? ui.raw(body) : null)),
    states: ["rest"],
    samples: [
      { label: "a fragment", props: { name: "room.ts", lines: "lines 120–124", body: "<pre style=\"margin:0;padding:10px 12px\">120  const key = randomUUID();\n121  const entry = { key, ts: Date.now() };\n122  this.pending.set(key, entry);\n123  this.push({ type: \"permission\", key });\n124  return entry;</pre>" } },
      { label: "a picture", props: { name: "mockup.png", lines: "640×400", kind: "image", openTitle: "Open it big", body: "<div style=\"width:200px;height:90px;border-radius:8px;background:var(--lav)\"></div>" } },
      { label: "a video", props: { name: "trailer.mp4", lines: "0:42 · 1920×1080", kind: "media", openTitle: "Open it with this computer's player", body: "<video controls preload=\"none\" style=\"width:100%\"></video>" } },
      { label: "a rendered document", props: { name: "notes.md", lines: "first 40 of 380 lines", kind: "doc", body: "<div class=\"file-view markdown doc-preview\"><h1>Tuesday</h1><p><b>What we decided.</b> The list keeps the reader where they are; a jump says who asked for it.</p></div>" } },
      { label: "could not be shown", props: { name: "gone.ts", error: "gone.ts could not be shown here: no such file." } },
    ],
  });

  const TOOL_TONE = { completed: "ready", failed: "error", in_progress: "thinking" };
  UI.define("tool-call", {
    group: "toolCall",
    describe: "A tool call in a reply: a chip with the tool's title, its kind and its status. Open, the chip is the head of a card that shows the call, its input and its output, bordered in the colour of its status.",
    props: {
      id: { type: "string", required: true, note: "the call's id; the chip carries it as data-tool for the page's handler" },
      title: { type: "string", required: true },
      kind: { type: "string" },
      variant: { type: "enum", values: ["tool", "message-check", "history-search"], default: "tool", note: "room-recorded message checks and history searches have their own icon and informational tone" },
      status: { type: "enum", values: ["pending", "in_progress", "completed", "failed"], default: "pending" },
      open: { type: "boolean", default: false, note: "open, the card shows the call; the body is built only then" },
      input: { type: "string", note: "shown up to 4000 characters" },
      output: { type: "string" },
      loadState: { type: "enum", values: ["ready", "loading", "error"], default: "ready" },
    },
    build: ({ id, title, kind, variant, status, open, input, output, loadState }, ui) =>
      ui.h("div", { "data-status": status, "data-state": open ? "open" : null, "data-variant": variant !== "tool" ? variant : null },
        ui.build("chip", { label: variant !== "tool" ? title : `${title}${kind ? ` · ${kind}` : ""} · ${status}`, icon: variant === "message-check" ? "inbox" : variant === "history-search" ? "search" : "tool", tone: TOOL_TONE[status] || "plain", button: true, title: open ? "Collapse" : "Expand", data: { tool: id } }),
        open
          ? ui.h("div", { class: "body" },
              loadState === "loading" ? ui.h("div", { class: "sec quiet", role: "status" }, "Loading tool details…") : null,
              loadState === "error" ? ui.h("div", { class: "sec quiet", role: "status" }, "Could not load tool details. ", ui.h("button", { type: "button", "data-tool-retry": id }, "Try again")) : null,
              ui.h("div", { class: "sec" }, ui.h("b", null, "call"), ui.h("pre", null, title)),
              input ? ui.h("div", { class: "sec" }, ui.h("b", null, "input"), ui.h("pre", null, input.slice(0, 4000))) : null,
              output ? ui.h("div", { class: "sec" }, ui.h("b", null, "output"), ui.h("pre", null, output)) : loadState === "ready" ? ui.h("div", { class: "sec quiet" }, "no output recorded") : null)
          : null),
    states: ["rest"],
    samples: [
      { label: "done", props: { id: "t1", title: "Read file", kind: "read", status: "completed" } },
      { label: "failed", props: { id: "t2", title: "Bash", kind: "execute", status: "failed" } },
      { label: "running", props: { id: "t3", title: "Grep", kind: "search", status: "in_progress" } },
      { label: "pending", props: { id: "t4", title: "Edit", kind: "edit" } },
      { label: "open", props: { id: "t5", title: "Read file", kind: "read", status: "completed", open: true, input: "{ \"path\": \"src/room.ts\" }", output: "export class Room { … }" } },
      { label: "checked, empty", props: { id: "c1", title: "Checked messages · Nothing new", variant: "message-check", status: "completed" } },
      { label: "checked, available", props: { id: "c2", title: "Checked messages · 3 new", variant: "message-check", status: "completed" } },
      { label: "returned", props: { id: "c3", title: "Returned 3 messages", variant: "message-check", status: "completed" } },
      { label: "check failed", props: { id: "c4", title: "Message check failed", variant: "message-check", status: "failed" } },
    ],
  });

  UI.define("tool-fold", {
    group: "toolFold",
    describe: "The tool calls of a finished reply, folded into one line: how many there were and how many failed. It opens to the calls, which the page puts in its list; the page remembers it open per message.",
    props: {
      count: { type: "number", required: true },
      failed: { type: "number", default: 0 },
      open: { type: "boolean", default: false },
    },
    build: ({ count, failed, open }, ui) =>
      ui.h("details", { open: !!open },
        ui.h("summary", { title: open ? "Fold the tool calls away" : "Show every tool call" }, ui.icon("tool"), ui.h("span", null, `${count} tool call${count === 1 ? "" : "s"}`), failed ? ui.h("span", { class: "failed" }, `· ${failed} failed`) : null),
        ui.h("div", { class: "list" })),
    states: ["rest", "hover"],
    samples: [
      { label: "one call", props: { count: 1 } },
      { label: "eight, one failed", props: { count: 8, failed: 1 } },
      { label: "open", props: { count: 3, open: true } },
    ],
  });

  const CHOICE_KIND = { ok: "ok", no: "danger" };
  UI.define("ask-card", {
    group: "askCard",
    describe: "A card the room puts in front of you for a decision: a permission a vibemate asks for, a proposal it makes. It says who asks and what, shows the details, and offers the choices as buttons; decided, it dims and keeps the outcome in the choices' place.",
    props: {
      kind: { type: "enum", values: ["permission", "proposal", "recovery", "new-room"], required: true },
      who: { type: "string", required: true, note: "who asks, by name" },
      lead: { type: "string", note: "what is asked, in words after the name; the default fits the kind" },
      subject: { type: "string", note: "what the ask is about, in bold: the tool call's title" },
      subjectKind: { type: "string", note: "a small word after the subject: the tool call's kind" },
      input: { type: "string", note: "the tool call's input, as text; shown up to 1200 characters" },
      body: { type: "html", note: "the details: a proposal's reason, its diff, its warnings; markup the caller vouches for" },
      choices: { type: "array", note: "[{ label, tone: ok | no | plain, act, data }]: a button each, answering with its act and data" },
      outcome: { type: "string", note: "what was decided; given, the card is resolved and shows this instead of its choices" },
      data: { type: "object" },
    },
    build: ({ kind, who, lead, subject, subjectKind, input, body, choices, outcome, data }, ui) =>
      ui.h("div", { "data-kind": kind, "data-state": outcome ? "resolved" : null, ...ui.dataAttrs(data) },
        ui.h("div", { class: "title" }, ui.icon(kind === "permission" ? "lock" : kind === "recovery" ? "info" : kind === "new-room" ? "rooms" : "pencil"), " ", who, " ", lead || (kind === "permission" ? "asks for permission:" : kind === "recovery" ? "has a decision for you" : kind === "new-room" ? "proposes a room" : "proposes changes to the room"), subject ? [" ", ui.h("strong", null, subject)] : null, subjectKind ? [" ", ui.h("span", { class: "kind" }, subjectKind)] : null),
        input ? ui.h("pre", { class: "input" }, input.slice(0, 1200)) : null,
        body ? ui.raw(body) : null,
        ui.h("div", { class: "choices" },
          outcome
            ? ui.h("span", { class: "outcome" }, outcome)
            : (choices || []).map((c) => ui.build("button", { label: c.label, kind: CHOICE_KIND[c.tone] || "paper", size: "sm", act: c.act, title: c.title, data: c.data })))),
    states: ["rest"],
    samples: [
      { label: "a permission", props: { kind: "permission", who: "Maken", subject: "Bash", subjectKind: "execute", input: "{ \"command\": \"npm test\" }", choices: [{ label: "Allow", tone: "ok", act: "permit", data: { option: "allow" } }, { label: "Deny", tone: "no", act: "permit", data: { option: "deny" } }, { label: "Dismiss (cancelled)", act: "permit" }] } },
      { label: "a proposal", props: { kind: "proposal", who: "Ana", body: "<div class=\"why\">The room keeps forgetting the deploy steps.</div>", choices: [{ label: "Apply", tone: "ok", act: "decide", data: { answer: "apply" } }, { label: "Reject", tone: "no", act: "decide", data: { answer: "reject" } }] } },
      { label: "a room", props: { kind: "new-room", who: "Ana", lead: "proposes a room called Review", body: "<div class=\"prop-row\">Rex (opus-5) and Wren (sonnet-5) — <b>2 new sessions</b></div><div class=\"prop-line\">No working folder yet · not reachable from a messenger · they all start in a mode that asks before it acts.</div>", choices: [{ label: "Create", tone: "ok", act: "make-room", data: { answer: "create" } }, { label: "No", tone: "no", act: "make-room", data: { answer: "no" } }] } },
      { label: "decided", props: { kind: "permission", who: "Maken", subject: "Bash", outcome: "chosen: allow" } },
    ],
  });

  UI.define("login-dialog", {
    group: "loginDialog",
    describe: "A vendor's sign-in or install, from any place in the room, in one modal (U147): the vendor's mark and a title, a scene (one drawing: a browser opening, a code to type, a question, a terminal, a package coming in, done, failed) that says what happens, one sentence, the task itself when there is one (a page to open, a code to type, a question to answer), the vendor's own lines behind 'for geeks', and the way out. The vendor handles sign-in; this dialog displays its output and forwards any answers entered here.",
    props: {
      vendor: { type: "string", required: true },
      icon: { type: "string", note: "the vendor's drawing (a recipe's icon); a letter without" },
      purpose: { type: "enum", values: ["login", "install"], default: "login" },
      state: { type: "enum", values: ["idle", "running", "done", "failed", "cancelled"], required: true, note: "idle: nothing started yet" },
      scene: { type: "enum", values: ["browser", "code", "question", "terminal", "package", "done", "failed"], required: true },
      words: { type: "string", required: true, note: "one sentence: what happens, or what happened" },
      confirmed: { type: "boolean", default: false, note: "a fresh vendor check confirmed readiness" },
      checking: { type: "boolean", default: false, note: "the vendor check is still running" },
      status: { type: "string", note: "the vendor's own word on its state, under the title" },
      kind: { type: "enum", values: ["command", "acp", "terminal", "url"], default: "command", note: "terminal: the human finishes in a window and presses I'm done; url: the vendor's page" },
      url: { type: "string", note: "the page to open" },
      code: { type: "string", note: "the code to type there" },
      wantsInput: { type: "boolean", default: false, note: "the vendor asks something: an answer field" },
      lines: { type: "array", note: "the vendor's own lines (for geeks)" },
      geek: { type: "string", note: "fine print markup (for geeks): the command, where the login lives" },
      terminal: { type: "boolean", default: false, note: "a terminal window is another way in (offered after a failure)" },
      flowId: { type: "string" },
      data: { type: "object" },
    },
    build: ({ vendor, icon, purpose, state, scene, words, confirmed, checking, status, kind, url, code, wantsInput, lines, geek, terminal, flowId, data }, ui) => {
      const installing = purpose === "install";
      const running = state === "running";
      const title = installing
        ? (state === "done" ? `${vendor} is installed` : state === "failed" ? `${vendor} was not installed` : `Install ${vendor}`)
        : (state === "done" ? confirmed ? `${vendor} is ready` : `${vendor}: check sign-in` : state === "failed" ? `${vendor} did not sign you in` : `Log in to ${vendor}`);
      const startLabel = installing
        ? (kind === "terminal" ? `Open a terminal to install ${vendor}` : kind === "url" ? "Open the page" : `Install ${vendor}`)
        : (kind === "terminal" ? `Open a terminal to sign in` : `Log in to ${vendor}`);
      const startAct = installing ? (kind === "url" ? "open-install-url" : "start-install") : "start-login";
      const foot = [];
      if (state === "idle") {
        foot.push(ui.build("button", { label: startLabel, kind: "primary", size: "md", act: startAct, icon: installing ? "tool" : "lock", data: kind === "url" && url ? { url } : undefined }));
        if (kind === "url") foot.push(ui.build("button", { label: "Check again", kind: "paper", act: "rescan", icon: "refresh", title: "Look for it on this machine again" }));
        foot.push(ui.build("button", { label: "Later", kind: "ghost", act: "close-login" }));
      } else if (running) {
        if (kind === "terminal") foot.push(ui.build("button", { label: "I'm done", kind: "primary", act: "recheck-login", icon: "check" }));
        foot.push(ui.build("button", { label: "Cancel", kind: "ghost", act: "cancel-login" }));
      } else if (state === "done") {
        if (!confirmed) {
          foot.push(ui.build("button", { label: checking ? "Checking…" : "Check again", disabled: checking, kind: "paper", act: "recheck-login", icon: "refresh" }));
          if (!checking) foot.push(ui.build("button", { label: "Open sign-in", kind: "paper", act: "start-login", icon: "lock" }));
        }
        foot.push(ui.build("button", { label: "Close", kind: "primary", act: "close-login" }));
      } else {
        foot.push(ui.build("button", { label: "Try again", kind: "primary", act: "retry-login", icon: "refresh" }));
        if (terminal && kind !== "terminal") foot.push(ui.build("button", { label: "Open a terminal instead", kind: "paper", act: "terminal-login" }));
        foot.push(ui.build("button", { label: "Close", kind: "ghost", act: "close-login" }));
      }
      return ui.h("div", { "data-state": state, "data-scene": scene, "data-purpose": purpose, "data-kind": kind, "data-flow": flowId || null, ...ui.dataAttrs(data) },
        ui.h("div", { class: "head" },
          ui.build("logo-tile", { icon: icon || "", letter: vendor.slice(0, 1), size: "lg", title: vendor }),
          ui.h("div", { class: "titles" }, ui.h("div", { class: "title" }, title), status ? ui.h("div", { class: "status" }, status) : null)),
        ui.h("div", { class: "stage", "data-scene": scene }, ui.raw(globalThis.Icons.scene(scene))),
        ui.h("p", { class: "words" }, words),
        url && running && !installing ? ui.h("div", { class: "task" },
          ui.h("div", { class: "step" }, ui.h("span", { class: "n" }, "1"), ui.h("span", { class: "say" }, "Open the sign-in page"), ui.build("button", { label: "Open it", kind: "primary", size: "sm", act: "open-login-url", icon: "link", data: { url } })),
          code ? ui.h("div", { class: "step" }, ui.h("span", { class: "n" }, "2"), ui.h("span", { class: "say" }, "Enter this code there"), ui.h("code", { class: "code" }, code), ui.build("button", { label: "Copy", kind: "ghost", size: "sm", act: "copy-login-code", icon: "copy", data: { code } })) : null) : null,
        wantsInput && running ? ui.h("div", { class: "answer" }, ui.h("input", { type: "text", name: "text", placeholder: "Your answer, then Enter", autocomplete: "off", "data-act": "login-answer" }), ui.build("button", { label: "Send", kind: "primary", size: "sm", act: "send-login-answer" })) : null,
        (lines && lines.length) || geek ? ui.h("details", { class: "fineprint" },
          ui.h("summary", null, ui.icon("geek"), "for geeks"),
          geek ? ui.h("p", { class: "fine" }, ui.raw(geek)) : null,
          lines && lines.length ? ui.h("pre", { class: "lines" }, lines.slice(-12).join("\n")) : null) : null,
        ui.h("div", { class: "foot" }, ...foot));
    },
    states: ["rest"],
    samples: [
      { label: "before anything runs", props: { vendor: "Grok", state: "idle", scene: "browser", kind: "acp", words: "Grok opens your browser. Sign in there and come back; viberoom waits.", status: "You are not signed in.", geek: "Sign in on Grok's website, then return here to continue." } },
      { label: "a code to type", props: { vendor: "Codex", state: "running", scene: "code", words: "Open the page and enter the code there; Codex notices when you are done.", url: "https://auth.openai.com/codex/device", code: "ABCD-1234", lines: ["Follow these steps to sign in with ChatGPT using device code authorization:", "1. Open this link in your browser", "   https://auth.openai.com/codex/device", "2. Enter this one-time code", "   ABCD-1234"] } },
      { label: "a question", props: { vendor: "Fake", state: "running", scene: "question", words: "Fake is asking you something: answer below.", wantsInput: true, lines: ["Paste the code here:"] } },
      { label: "in a terminal", props: { vendor: "Hermes", state: "running", scene: "terminal", kind: "terminal", words: "Finish the sign-in in the terminal window, then press I'm done.", lines: ["\"C:\\Users\\me\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\hermes.exe\" model"] } },
      { label: "installing", props: { vendor: "Gemini CLI", purpose: "install", state: "running", scene: "package", words: "npm is fetching Gemini CLI; the tile turns live when it is done.", lines: ["added 12 packages in 4s"] } },
      { label: "done", props: { vendor: "Grok", state: "done", scene: "done", words: "Grok confirms it is logged in.", status: "logged in with grok.com" } },
      { label: "failed", props: { vendor: "Copilot", state: "failed", scene: "failed", words: "Copilot's sign-in ended without success: access denied.", terminal: true, lines: ["error: access denied"] } },
    ],
  });

  UI.define("reply-note", {
    group: "replyNote",
    describe: "A line the room attaches to a reply, inside its bubble: an adapter's notice before the words, or the fact that the reply was stopped, right after them. The words stay; the note says what happened to them.",
    props: {
      text: { type: "string", required: true },
      tone: { type: "enum", values: ["info", "attention", "error"], default: "info", note: "info: a quiet fact; attention: something that changed the reply; error: the reply's turn failed" },
      icon: { type: "icon", default: "info" },
      hook: { type: "string" },
    },
    build: ({ text, tone, icon, hook }, ui) => ui.h("div", { "data-tone": tone === "info" ? null : tone, class: hook || null }, ui.icon(icon), ui.h("span", null, text)),
    states: ["rest"],
    samples: [
      { label: "a quiet fact", props: { text: "This reply was written in plan mode." } },
      { label: "the turn failed", props: { text: "The turn failed after this: usage limit reached", tone: "error", icon: "alert" } },
      { label: "an adapter's notice", props: { text: "Auto mode is unavailable for this account; running in the default mode.", tone: "attention" } },
      { label: "stopped", props: { text: "Stopped by Sam", tone: "attention", icon: "stop" } },
    ],
  });

  UI.define("message-ref", {
    group: "link",
    describe: "The number of another message of the room, as a message's words write it (a # and the number): a word that leads to it. A dotted rule says it stays in the room, where a path or a site opens elsewhere; under the pointer it raises a message-peek, a click goes to the message, and a drag over it selects it like the words around it.",
    props: {
      seq: { type: "number", required: true, note: "the message's number in the room: where it leads" },
      written: { type: "number", note: "the number as the words write it, when they were written on another copy of the room, which numbered that message so (src/message-numbers.ts)" },
      copy: { type: "string", note: "the name of that copy's computer" },
    },
    build: ({ seq, written, copy }, ui) => ui.h("span", { role: "link", "data-seq": String(seq), "data-written": written ? String(written) : null, "data-copy": written ? copy || null : null }, `#${written || seq}`),
    states: ["rest", "hover"],
    samples: [
      { label: "in words", props: { seq: 7144 } },
      { label: "written on another copy", props: { seq: 7807, written: 7738, copy: "studio-mac" } },
    ],
  });
  UI.define("hint", {
    group: "hint",
    describe: "The words a control keeps for the pointer, beside it after the hover delay: to the right of an item of the main menu, under any other control (above it when there is no room below). Every title in the window becomes one (ui/hints.js), so the system's grey box never rises; a button whose words were its only name keeps them as its accessible name.",
    props: {
      text: { type: "string", required: true, note: "the words, as the control's title says them" },
      side: { type: "enum", values: ["right", "below", "above"], default: "below", note: "where it stands, which is where it rises from" },
    },
    build: ({ text, side }, ui) => ui.h("div", { role: "tooltip", "data-side": side }, text),
    states: ["rest"],
    samples: [
      { label: "beside an item of the main menu", props: { text: "Connections", side: "right" } },
      { label: "under a button, two lines", props: { text: "Copy the message\nas Markdown", side: "below" } },
    ],
  });
  UI.define("message-peek", {
    group: "messagePeek",
    describe: "The card the number of another message raises under the pointer: whose words they are (the face and the name in the writer's colour), the number and the time, and how the message begins. A number the room holds no message under says so. It only shows; the number itself is what goes there.",
    props: {
      seq: { type: "number", required: true },
      name: { type: "string", note: "who wrote it, as they were named then; none when the room holds no such message" },
      color: { type: "string", note: "the writer's colour, #rrggbb" },
      face: { type: "node", note: "markup of the writer's face (a face, as ui.raw)" },
      when: { type: "string", note: "when it was written, in words" },
      text: { type: "string", required: true, note: "how the message begins; or why there is nothing to show" },
      missing: { type: "boolean", default: false, note: "the room holds no message with this number" },
      written: { type: "number", note: "the number as the words that raised it write it, when another copy of the room gave it" },
      copy: { type: "string", note: "the name of that copy's computer" },
      id: { type: "string", note: "for the reference that raised it to name it (aria-describedby)" },
      hook: { type: "string", note: "a class the page composes with (where it floats)" },
    },
    build: ({ seq, name, color, face, when, text, missing, written, copy, id, hook }, ui) =>
      ui.h("div", { id, class: hook || null, role: "tooltip", "data-state": missing ? "missing" : null },
        ui.h("div", { class: "head" }, face || null, name ? ui.h("b", { class: "who", style: color ? `color:${color}` : null }, name) : null,
          ui.h("span", { class: "when" }, when ? `#${seq} · ${when}` : `#${seq}`)),
        written ? ui.h("div", { class: "written" }, `Written as #${written} on ${copy || "another computer"}`) : null,
        ui.h("div", { class: "words" }, text)),
    states: ["rest", "missing"],
    samples: (() => {
      const p = globalThis.VIBEROOM_TOKENS.current.palette;
      return [
        { label: "a reply", props: { seq: 7144, name: "Maken", color: p.primary, face: UI.raw(UI.html("face", { name: "Maken", label: "MA", color: p.primary, size: 18 })), when: "Today 11:03", text: "The list keeps the reader where they are; a jump says who asked for it, and the room opens at its end or where its reader left it higher up." } },
        { label: "written on another copy", props: { seq: 7807, name: "Maken", color: p.primary, when: "Yesterday 23:32", written: 7738, copy: "studio-mac", text: "A scale for the whole window, in Settings: can we have one?" } },
        { label: "no such message", props: { seq: 99999, text: "This room has no message with this number.", missing: true } },
      ];
    })(),
  });

  UI.define("look-card", {
    group: "lookCard",
    describe: "A look, shown as a small picture of itself: its paper, a reply and your bubble on it, its accent, its corners, its name in its own font. The picker in Settings and the style guide's own switch are rows of these; the colours come from the look's tokens, so the card is right whatever look the page wears.",
    props: {
      look: { type: "object", required: true, note: "a look from VIBEROOM_TOKENS.looks: id, label, palette, shape, type, elements" },
      tag: { type: "string", note: "a small word under the name: whose look it is (one of the human's own)" },
      on: { type: "boolean", default: false },
      act: { type: "string" },
      title: { type: "string" },
      data: { type: "object" },
    },
    build: ({ look, tag, on, act, title, data }, ui) => {
      const p = look.palette;
      const e = look.elements;
      const r = (px) => `calc(${px}px * ${look.shape.rScale || 1})`;
      const canvas = (look.canvas && look.canvas.gradCanvas) || p.bg;
      const shadows = look.elevation || {};
      return ui.h("button", { type: "button", "data-look": look.id, "data-state": on ? "on" : null, "aria-pressed": on ? "true" : "false", "data-act": act, title: title || look.label, ...ui.dataAttrs(data) },
        ui.h("span", { class: "paper", style: `background:${canvas};border-radius:${r(10)}` },
          ui.h("span", { class: "reply", style: `background:${e.bubble.bg};color:${e.bubble.ink};border-radius:${r(8)};font-family:${look.type.font};box-shadow:${e.bubble.shadow || "none"}` }, "Aa"),
          ui.h("span", { class: "mine", style: `background:${e.bubble.mineBg};border-radius:${r(8)};box-shadow:${e.bubble.mineShadow || "none"}` }),
          ui.h("span", { class: "accent", style: `background:${p.primary};border-radius:${r(6)};box-shadow:${shadows.shadowPrimary || "none"}` })),
        ui.h("span", { class: "name", style: `font-family:${look.type.font}` }, look.label),
        tag ? ui.h("span", { class: "tag" }, tag) : null);
    },
    states: ["rest", "hover", "on"],
    samples: [
      ...Object.values(globalThis.VIBEROOM_TOKENS.looks).map((l) => ({ label: l.label, props: { look: l, on: l.id === globalThis.VIBEROOM_TOKENS.current.id } })),
      { label: "one of the human's own", props: { look: globalThis.VIBEROOM_TOKENS.current, tag: "Sam's look" } },
    ],
  });

  UI.define("switch", {
    group: "switch",
    describe: "The window's one switch: an outline in the quiet ink when off, filled with the accent when on, its knob sliding over, and On or Off beside it in words. A row of the setting type holds one when the setting is a switch, and the row's name is its label; standing alone (a card switched on and off as a whole), it is named for a reader by label, and a click on its words switches it too.",
    props: {
      id: { type: "string", note: "the input's id: a label elsewhere (a setting's name) names the switch by it" },
      name: { type: "string", note: "the input's name in its form, for a form read by names" },
      checked: { type: "boolean", default: false },
      disabled: { type: "boolean", default: false },
      label: { type: "string", note: "the name a reader hears when no label elsewhere names the switch: a card's own switch" },
      describedBy: { type: "string", note: "the ids of what describes it (a setting's words, its status)" },
      data: { type: "object", note: "data-* marks on the input, for the page's own handlers" },
    },
    build: ({ id, name, checked, disabled, label, describedBy, data }, ui) => ui.h("label", null,
      ui.h("span", { class: "state", "aria-hidden": "true" }, ui.h("span", { class: "on" }, "On"), ui.h("span", { class: "off" }, "Off")),
      ui.h("input", { type: "checkbox", role: "switch", id, name, checked, disabled, "aria-label": label, "aria-describedby": describedBy, ...ui.dataAttrs(data) })),
    states: ["rest", "hover"],
    samples: [
      { label: "on", props: { label: "Morning check-in", checked: true } },
      { label: "off", props: { label: "Morning check-in" } },
      { label: "off, and it cannot change now", props: { label: "Morning check-in", disabled: true } },
    ],
  });

  UI.define("consent-gate", {
    group: "consentGate",
    describe: "The consent at the head of a feature's card of Settings, the first thing on it and above what it unlocks. Asked, it says who receives, shows the exact words of what leaves this computer and offers its answers; asked again, when what leaves changed since it was given, it says that first. Given, it folds to one line with a way to withdraw, and says under it what the feature still misses to be on. The words are the hub's, byte for byte: the answer sends them back, and the hub gives the consent over them alone.",
    props: {
      state: { type: "enum", values: ["ask", "lapsed", "given"], required: true },
      icon: { type: "string", note: "ask: the feature's picture (mic, speaker, graph); the lock without" },
      title: { type: "string", required: true, note: "who receives, in words: 'Your voice goes to OpenAI'; given, what is on" },
      words: { type: "string", note: "ask and lapsed: the exact words agreed to" },
      missing: { type: "string", note: "given: what the feature still misses to be on; none, it is on" },
      answers: { type: "array", note: "ask and lapsed: [button props]: on a page the one agreement, on a card Not now beside it" },
      withdraw: { type: "object", note: "given: { act, data } of the way to withdraw it; the settings stay" },
    },
    build: ({ state, icon, title, words, missing, answers, withdraw }, ui) => state === "given"
      ? ui.h("div", { "data-state": "given", "data-on": missing ? null : "" },
          ui.h("div", { class: "given-line" },
            ui.h("span", { class: "mark" }, ui.icon("check")),
            ui.h("span", { class: "title" }, title),
            withdraw ? ui.build("button", { label: "Withdraw", kind: "ghost", size: "sm", act: withdraw.act, data: withdraw.data, title: "Nothing leaves this computer from then on; the settings stay" }) : null),
          missing ? ui.h("div", { class: "missing", role: "status" }, missing) : null)
      : ui.h("div", { "data-state": state, role: "group", "aria-label": state === "lapsed" ? "What leaves this computer changed" : title },
          ui.h("div", { class: "head" },
            ui.h("span", { class: "mark" }, ui.icon(state === "lapsed" ? "alert" : icon || "lock")),
            ui.h("span", { class: "heading" },
              ui.h("span", { class: "title" }, state === "lapsed" ? "What leaves this computer changed" : title),
              ui.h("span", { class: "sub" }, state === "lapsed" ? `${title}. It stays off until you agree to the words as they are now.` : "Nothing leaves this computer until you agree."))),
          ui.h("p", { class: "words" }, words || ""),
          ui.h("div", { class: "answers" }, (answers || []).map((b) => ui.build("button", b)))),
    states: ["rest"],
    samples: [
      { label: "asked", props: { state: "ask", icon: "mic", title: "Your voice goes to OpenAI", words: "Each recording, and each sound of a room a vibemate asks to hear, is sent whole to OpenAI (api.openai.com), which turns it into text under its own terms. A dictation's words go only into your message field; a voice message or a sound file keeps its words in the room, as the message does.", answers: [{ label: "I agree, turn it on", kind: "primary", act: "consent-agree" }] } },
      { label: "asked again: what leaves changed", props: { state: "lapsed", title: "Your voice goes to Groq", words: "Each recording, and each sound of a room a vibemate asks to hear, is sent whole to Groq (api.groq.com), which turns it into text under its own terms. A dictation's words go only into your message field; a voice message or a sound file keeps its words in the room, as the message does.", answers: [{ label: "I agree", kind: "primary", act: "consent-agree" }] } },
      { label: "given, a piece still missing", props: { state: "given", title: "You agreed: your voice goes to OpenAI", missing: "Not on yet: OpenAI API key is not set yet.", withdraw: { act: "consent-withdraw" } } },
      { label: "given, on", props: { state: "given", title: "On: your voice goes to OpenAI", withdraw: { act: "consent-withdraw" } } },
    ],
  });

  UI.define("consent-lock", {
    group: "consentGate",
    describe: "What a consent-gate unlocks, while the consent is not given: the rows stay in their place, blurred and faded, out of reach of the pointer, the keyboard and a screen reader (inert), under a pill that says what unlocks them. Unlocked a moment ago, they come clear with a short fade; still, where less motion is asked for.",
    props: {
      locked: { type: "boolean", default: false },
      note: { type: "string", note: "the pill's words, when locked" },
      body: { type: "html", required: true, note: "the rows it holds; markup the caller vouches for" },
      opened: { type: "boolean", default: false, note: "unlocked a moment ago: the rows come clear with the fade" },
    },
    build: ({ locked, note, body, opened }, ui) =>
      ui.h("div", { "data-locked": locked ? "" : null, "data-opened": opened && !locked ? "" : null },
        locked ? ui.h("div", { class: "pill" }, ui.icon("lock"), note || "Agree above to set it up") : null,
        ui.h("div", { class: "rows", inert: locked || null }, ui.raw(body || ""))),
    states: ["rest"],
    samples: [
      { label: "locked", props: { locked: true, note: "Agree above to set it up", body: '<div data-ui="setting" data-kind="control"><span class="words"><span class="name-line"><span class="name">Model</span></span><span class="hint">gpt-4o-transcribe by default.</span></span><span class="control"><input class="input" value="gpt-4o-transcribe"></span></div>' } },
      { label: "open", props: { body: '<div data-ui="setting" data-kind="control"><span class="words"><span class="name-line"><span class="name">Model</span></span><span class="hint">gpt-4o-transcribe by default.</span></span><span class="control"><input class="input" value="gpt-4o-transcribe"></span></div>' } },
    ],
  });

  UI.define("setting", {
    group: "setting",
    describe: "One setting on a card: its name and what it does on the left, its control on the right, a hairline between two of them. A card of these is a page of Settings, a section of a side panel, or the settings a dialog asks for. A switch is the switch type, named by the row; the name reaches over the whole row, so a click anywhere on the row switches it. Any other control is the caller's markup; stacked puts it under the words, as wide as the card. A status line under the words says what the setting reports, and the explanation for geeks folds out under the row. A picker that would take a screen when always open (a face, an emoji, a coding agent) folds out under the row too, when its control (a button with data-act setting-fold) opens it.",
    props: {
      label: { type: "string", required: true, note: "the setting's name" },
      for: { type: "string", note: "the id of the control the setting names: the name is its label, the Saved mark finds the row by it; a switch gets it as its own id" },
      hint: { type: "node", note: "what it does, in a line or two: text, or ui.raw for words with <code>" },
      kind: { type: "enum", values: ["control", "switch"], default: "control" },
      control: { type: "node", note: "kind control: the control's markup (a select, a number-field, buttons, choices), as ui.raw" },
      checked: { type: "boolean", default: false, note: "kind switch" },
      disabled: { type: "boolean", default: false, note: "kind switch" },
      name: { type: "string", note: "kind switch: the switch's name in its form, for a form read by names" },
      stacked: { type: "boolean", default: false, note: "the control under the words, as wide as the card" },
      lead: { type: "node", note: "a picture before the words (a vendor's mark), as ui.raw" },
      status: { type: "node", note: "a line under the words: what the setting reports (when it was checked, how much is kept)" },
      statusId: { type: "string", note: "the status line's id: the page rewrites it, and a reader hears the change; with it the line is there even while it is empty" },
      statusTone: { type: "enum", values: ["plain", "warn"], default: "plain" },
      geek: { type: "node", note: "the explanation for geeks, folded under the row until its glasses are pressed" },
      fold: { type: "node", note: "a picker folded under the row until the control opens it (a button with data-act setting-fold), as ui.raw; the page closes it after a pick" },
      id: { type: "string", note: "the row's own id, for a page that shows or hides it" },
      hidden: { type: "boolean", default: false },
      data: { type: "object", note: "data-* marks on the row, for the page's own handlers (a group of rows shown together)" },
    },
    build: ({ label, for: target, hint, kind, control, checked, disabled, name, stacked, lead, status, statusId, statusTone, geek, fold, id, hidden, data }, ui) => {
      const hintId = hint && target ? `${target}-hint` : null;
      const described = [hintId, status && statusId].filter(Boolean).join(" ") || undefined;
      const ctl = kind === "switch"
        ? ui.h("span", { class: "control" }, ui.build("switch", { id: target, name, checked, disabled, describedBy: described }))
        : control ? ui.h("span", { class: "control" }, control) : null;
      return ui.h("div", { id, hidden, "data-kind": kind, "data-stacked": stacked || null, "data-lead": lead ? "" : null, ...ui.dataAttrs(data) },
        lead ? ui.h("span", { class: "lead" }, lead) : null,
        ui.h("span", { class: "words" },
          ui.h("span", { class: "name-line" },
            target ? ui.h("label", { class: "name", for: target }, label) : ui.h("span", { class: "name" }, label),
            geek ? ui.h("button", { type: "button", class: "geek-tip", title: "For geeks", "aria-expanded": "false", "aria-controls": target ? `${target}-geek` : null }, ui.icon("geek"), "for geeks") : null),
          hint ? ui.h("span", { class: "hint", id: hintId }, hint) : null,
          status || statusId ? ui.h("span", { class: "status", id: statusId, role: statusId ? "status" : null, "data-tone": statusTone === "plain" ? null : statusTone }, status || null) : null),
        ctl,
        geek ? ui.h("span", { class: "geek-text", id: target ? `${target}-geek` : null, hidden: true }, geek) : null,
        fold ? ui.h("div", { class: "fold", id: target || id ? `${target || id}-fold` : null, hidden: true }, fold) : null);
    },
    states: ["rest", "hover"],
    samples: [
      { label: "a switch, on", props: { label: "Check for updates once a day", for: "sample-setting-updates", hint: "One request to the npm registry at start; nothing else leaves this computer.", kind: "switch", checked: true } },
      { label: "a switch, off, with what it reports", props: { label: "Start viberoom when you sign in", for: "sample-setting-autostart", hint: "A quiet start, without a window.", kind: "switch", status: "Last automatic start: never." } },
      { label: "a choice from a list", props: { label: "Turn taking in new rooms", for: "sample-setting-turns", hint: "Each room can change it in its own settings.", control: UI.raw('<select class="select" id="sample-setting-turns"><option>One vibemate at a time</option><option>All addressed vibemates at once</option></select>') } },
      { label: "a number", props: { label: "Reply delay, seconds", for: "sample-setting-delay", hint: "Before each turn a vibemate waits up to this long.", control: UI.raw(UI.html("number-field", { id: "sample-setting-delay", value: "4", min: 0, max: 120, step: 0.5 })) } },
      { label: "an action", props: { label: "Restart viberoom", hint: "Starts the room again with what is on disk.", control: UI.raw(UI.html("button", { label: "Restart…", kind: "secondary", size: "sm" })) } },
      { label: "stacked, with the explanation for geeks", props: { label: "Command", for: "sample-setting-command", hint: "{file}, {line} and {column} are filled in.", stacked: true, control: UI.raw('<input type="text" class="input" id="sample-setting-command" placeholder="code --goto {file}:{line}">'), geek: "Quotes group arguments, as in a shell." } },
      { label: "a picture and a warning", props: { label: "Codex", hint: "Found on this computer.", lead: UI.raw(UI.html("logo-tile", { letter: "C", title: "Codex" })), control: UI.raw(UI.html("badge", { label: "no login", tone: "thinking", dot: true })), status: "Not logged in: run codex login once.", statusTone: "warn" } },
      { label: "a picker that folds out under it", props: { label: "Emoji", id: "sample-setting-emoji", hint: "A face for the room, next to its name.", control: UI.raw(`<span class="pick-now" aria-hidden="true">🦉</span>${UI.html("button", { label: "Change…", kind: "secondary", size: "sm", act: "setting-fold" })}`), fold: UI.raw('<p class="hint">The grid of emoji opens here, with its search.</p>') } },
    ],
  });
})();
