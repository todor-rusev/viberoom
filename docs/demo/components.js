// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";
  const UI = globalThis.UI;

  UI.define("logo-tile", {
    group: "logoTile",
    describe: "A vendor's mark on a tile: the vendor's own drawing laid over the look's ink through a mask, so it reads on any paper; a letter stands in where there is no drawing, a glyph from the icon set for the marks the room adds (muted). As a badge it sits in a face's corner.",
    props: {
      icon: { type: "string", note: "the drawing's url (a recipe's icon); empty for a letter" },
      letter: { type: "string", note: "the letter shown without a drawing" },
      glyph: { type: "icon", note: "an icon from the set instead of a drawing (the mute mark)" },
      size: { type: "enum", values: ["sm", "md", "lg", "badge"], default: "md", note: "badge: the corner of a face, sized by the face" },
      tone: { type: "enum", values: ["plain", "muted"], default: "plain" },
      title: { type: "string" },
    },
    build: ({ icon, letter, glyph, size, tone, title }, ui) =>
      ui.h("span", { "data-size": size, "data-tone": tone !== "plain" ? tone : null, title, style: icon ? `--logo:url("${icon}")` : null, role: title ? "img" : null, "aria-label": title || null },
        icon ? ui.h("span", { class: "mark" }) : glyph ? ui.icon(glyph) : ui.h("span", { class: "letter" }, (letter || "?").slice(0, 1).toUpperCase())),
    states: ["rest"],
    samples: [
      { label: "a drawing", props: { icon: "vendor-icons/claude.svg", title: "Claude" } },
      { label: "another", props: { icon: "vendor-icons/codex.svg", size: "lg", title: "Codex" } },
      { label: "a letter", props: { letter: "F", size: "sm", title: "Fake" } },
      { label: "a badge", props: { icon: "vendor-icons/gemini.svg", size: "badge", title: "Gemini" } },
      { label: "muted", props: { glyph: "mute", size: "badge", tone: "muted", title: "muted: receives no prompts" } },
    ],
  });

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
      badge: { type: "node", note: "markup of the mark in the corner (a logo-tile), as ui.raw" },
      status: { type: "enum", values: FACE_STATUSES, note: "the dot at the foot" },
      me: { type: "boolean", default: false, note: "the human's own face: wears the accent ring" },
      kind: { type: "enum", values: ["tile", "card", "bare"], default: "tile", note: "card: on the profile card, on paper with a shadow; bare: no tile (the rail)" },
      ring: { type: "boolean", default: false, note: "a ring in the paper's colour, for faces that overlap in a stack" },
      dim: { type: "enum", values: ["asleep", "unstaffed"], note: "greyed: asleep a little, unstaffed more" },
      title: { type: "string" },
    },
    build: ({ name, label, color, size, emoji, badge, status, me, kind, ring, dim, title }, ui) =>
      ui.h("span", { class: "avatar", role: "img", "aria-label": name, title, "data-kind": kind !== "tile" ? kind : null, "data-me": me || null, "data-ring": ring || null, "data-dim": dim || null, style: `--face-color:${color};--face-size:${size}px;width:${size}px;height:${size}px` },
        ui.h("span", { class: "tile", "data-emoji": emoji || null, style: `font-size:${Math.round(emoji ? size * 0.56 : size * 0.38)}px` }, label),
        badge,
        status ? ui.h("span", { class: "status", "data-status": status }) : null),
    states: ["rest"],
    samples: (() => {
      const p = globalThis.VIBEROOM_TOKENS.current.palette;
      return [
        { label: "initials", props: { name: "Maken", label: "MA", color: p.primary, size: 44 } },
        { label: "an emoji, a vendor", props: { name: "Sam", label: "🦊", emoji: true, color: p.orange, size: 44, badge: UI.raw(UI.html("logo-tile", { icon: "vendor-icons/claude.svg", size: "badge", title: "Claude" })), status: "thinking" } },
        { label: "you", props: { name: "You", label: "🧑‍💻", emoji: true, color: p.indigo, size: 44, me: true } },
        { label: "asleep", props: { name: "Rex", label: "🦖", emoji: true, color: p.green, size: 44, dim: "asleep", status: "offline", badge: UI.raw(UI.html("logo-tile", { glyph: "mute", size: "badge", tone: "muted", title: "muted" })) } },
        { label: "on the card", props: { name: "You", label: "🧑‍💻", emoji: true, color: p.indigo, size: 64, kind: "card" } },
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
      icon: { type: "icon", note: "the accent kind: an icon on the accent gradient" },
      size: { type: "enum", values: ["md", "lg"], default: "md" },
      title: { type: "string" },
    },
    build: ({ hue, letter, emoji, icon, size, title }, ui) => {
      const kind = icon ? "accent" : emoji ? "emoji" : "letter";
      const style = icon ? null : `--room-hue:${Number(hue) || 0};--room-hue-2:${((Number(hue) || 0) + 30) % 360}`;
      return ui.h("span", { "data-kind": kind, "data-size": size !== "md" ? size : null, style, title }, icon ? ui.icon(icon) : emoji ? emoji : (letter || "?").slice(0, 1).toUpperCase());
    },
    states: ["rest"],
    samples: [
      { label: "a letter", props: { hue: 200, letter: "V", title: "Vibes" } },
      { label: "an emoji", props: { hue: 40, emoji: "🎭", title: "Theatre" } },
      { label: "large", props: { hue: 300, letter: "P", size: "lg" } },
      { label: "the accent", props: { icon: "skills", title: "All skills" } },
    ],
  });

  UI.define("unseen-line", {
    group: "unseenLine",
    describe: "The line across the room above which a vibemate (or several) has seen nothing: a rule on either side of a small label. The rule's drawing is the look's (a wave in VibeClassic, a dashed rule in Terminal); the label names who, and its tooltip says why.",
    props: {
      label: { type: "string", required: true, note: "who has not seen what is above" },
      title: { type: "string", note: "the tooltip: where a vibemate's knowledge of the room starts" },
    },
    build: ({ label, title }, ui) => ui.h("div", { title }, ui.h("span", { class: "line" }), ui.h("span", { class: "label" }, `↑ ${label}`), ui.h("span", { class: "line" })),
    states: ["rest"],
    samples: [
      { label: "one vibemate", props: { label: "Maken has not seen anything above this line" } },
      { label: "two", props: { label: "Maken and Sam have not seen anything above this line" } },
    ],
  });

  UI.define("number-field", {
    group: "numberField",
    describe: "A number to type or step: the field with two small steps at its right edge, drawn from the look instead of the browser's own spinner (U126). A step raises the same input and change events a typed value does, so a form saves on it. The id, the bounds and the step are the caller's.",
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
        ui.h("input", { type: "number", id, value, min, max, step, placeholder, disabled, ...ui.dataAttrs(data) }),
        ui.h("span", { class: "steps", "aria-hidden": "true" },
          ui.h("button", { type: "button", "data-act": "up", tabindex: "-1", title: "More" }),
          ui.h("button", { type: "button", "data-act": "down", tabindex: "-1", title: "Less" }))),
    states: ["rest", "disabled"],
    samples: [
      { label: "seconds", props: { value: "4", min: 0, max: 120, step: 0.5 } },
      { label: "empty, with a placeholder", props: { value: "", min: 1, max: 100, placeholder: "no limit" } },
    ],
  });

  UI.define("adjust-row", {
    group: "adjustRow",
    describe: "One thing the human may adjust in a look (U125): its name and what it colours on the left, the control on the right — a swatch with its value for a colour, a slider with its value for a scale — and, once the value differs from the look's own, the way back. Settings → Appearance lists them by group from the adjustables in tokens.js; the page keeps data-state and the value in step as the human picks.",
    props: {
      key: { type: "string", required: true, note: "the adjustable's key (data-key), what the hub keeps it under" },
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
    describe: "A line the hub writes into the room (U114): news in muted words; a tone colours it (attention, error, hush); the one row that leads somewhere carries a ref and is a button with a backing, the only row that ever wears one.",
    props: {
      text: { type: "string", required: true },
      tone: { type: "enum", values: ["news", "attention", "error", "hush"], default: "news", note: "what kind of news the hub says it is" },
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
      { label: "hush", props: { text: "Hush: everyone waits until you write again.", tone: "hush", face: UI.raw('<span class="hush-face">🤫</span>') } },
      { label: "leads to a reply", props: { text: "Maken finished the reply started at 16:21 · 2m 30s", ref: "sample", title: "go to the reply", face: UI.raw(UI.html("face", { name: "Maken", label: "🔨", emoji: true, color: globalThis.VIBEROOM_TOKENS.current.palette.primary, size: 20 })) } },
    ],
  });

  const BUTTON_KINDS = ["plain", "primary", "secondary", "soft", "ghost", "danger", "danger-solid", "dark", "warn", "inverse", "link", "ok", "paper"];
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
    describe: "A fragment of a file, or a picture, under the message that names it: a dark card whose head says the file's name and the lines shown and offers to open the whole file; its body is the code or the drawing. What could not be shown says why in the body instead.",
    props: {
      name: { type: "string", required: true },
      lines: { type: "string", note: "what part is shown, in words: 'lines 120–160', or a picture's size once it loaded" },
      kind: { type: "enum", values: ["code", "image"], default: "code" },
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
      status: { type: "enum", values: ["pending", "in_progress", "completed", "failed"], default: "pending" },
      open: { type: "boolean", default: false, note: "open, the card shows the call; the body is built only then" },
      input: { type: "string", note: "shown up to 4000 characters" },
      output: { type: "string" },
    },
    build: ({ id, title, kind, status, open, input, output }, ui) =>
      ui.h("div", { "data-status": status, "data-state": open ? "open" : null },
        ui.build("chip", { label: `${title}${kind ? ` · ${kind}` : ""} · ${status}`, icon: "tool", tone: TOOL_TONE[status] || "plain", button: true, title: open ? "Collapse" : "Expand", data: { tool: id } }),
        open
          ? ui.h("div", { class: "body" },
              ui.h("div", { class: "sec" }, ui.h("b", null, "call"), ui.h("pre", null, title)),
              input ? ui.h("div", { class: "sec" }, ui.h("b", null, "input"), ui.h("pre", null, input.slice(0, 4000))) : null,
              output ? ui.h("div", { class: "sec" }, ui.h("b", null, "output"), ui.h("pre", null, output)) : ui.h("div", { class: "sec quiet" }, "no output recorded"))
          : null),
    states: ["rest"],
    samples: [
      { label: "done", props: { id: "t1", title: "Read file", kind: "read", status: "completed" } },
      { label: "failed", props: { id: "t2", title: "Bash", kind: "execute", status: "failed" } },
      { label: "running", props: { id: "t3", title: "Grep", kind: "search", status: "in_progress" } },
      { label: "pending", props: { id: "t4", title: "Edit", kind: "edit" } },
      { label: "open", props: { id: "t5", title: "Read file", kind: "read", status: "completed", open: true, input: "{ \"path\": \"src/room.ts\" }", output: "export class Room { … }" } },
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
      kind: { type: "enum", values: ["permission", "proposal"], required: true },
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
        ui.h("div", { class: "title" }, ui.icon(kind === "permission" ? "lock" : "pencil"), " ", who, " ", lead || (kind === "permission" ? "asks for permission:" : "proposes changes to the room"), subject ? [" ", ui.h("strong", null, subject)] : null, subjectKind ? [" ", ui.h("span", { class: "kind" }, subjectKind)] : null),
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
      { label: "decided", props: { kind: "permission", who: "Maken", subject: "Bash", outcome: "chosen: allow" } },
    ],
  });

  UI.define("reply-note", {
    group: "replyNote",
    describe: "A line the hub attaches to a reply, inside its bubble: an adapter's notice before the words, or the fact that the reply was stopped, right after them. The words stay; the note says what happened to them.",
    props: {
      text: { type: "string", required: true },
      tone: { type: "enum", values: ["info", "attention"], default: "info", note: "info: a quiet fact; attention: something that changed the reply" },
      icon: { type: "icon", default: "info" },
      hook: { type: "string" },
    },
    build: ({ text, tone, icon, hook }, ui) => ui.h("div", { "data-tone": tone === "info" ? null : tone, class: hook || null }, ui.icon(icon), ui.h("span", null, text)),
    states: ["rest"],
    samples: [
      { label: "a quiet fact", props: { text: "This reply was written in plan mode." } },
      { label: "an adapter's notice", props: { text: "Auto mode is unavailable for this account; running in the default mode.", tone: "attention" } },
      { label: "stopped", props: { text: "Stopped by Sam", tone: "attention", icon: "stop" } },
    ],
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
})();
