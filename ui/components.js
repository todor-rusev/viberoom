// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";
  const UI = globalThis.UI;

  UI.define("row-button", {
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
      { label: "leads to a reply", props: { text: "Maken finished the reply started at 16:21 · 2m 30s", ref: "sample", title: "go to the reply", face: UI.raw('<span class="avatar" style="width:20px;height:20px"><span class="av-tile" role="img" aria-label="Maken" style="font-size:11px;border-radius:6px">🔨</span></span>') } },
    ],
  });

  const BUTTON_KINDS = ["plain", "primary", "secondary", "soft", "ghost", "danger", "danger-solid", "dark", "warn", "inverse", "link", "ok", "paper"];
  const BUTTON_SIZES = ["md", "sm", "xs", "lg", "cta"];
  UI.define("button", {
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
})();
