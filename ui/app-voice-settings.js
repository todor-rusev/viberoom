// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (global) {
  "use strict";
  const VOICE_LANGUAGES = [["", "By its sound"], ...["bg", "en", "de", "fr", "es", "it", "pt", "nl", "pl", "uk", "ru", "el", "ro", "sr", "tr"].map((code) => [code, new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code])];
  const voiceRecipient = (provider) => (provider.id === "compatible" ? "your own server" : provider.label);
  function fieldMarkup(f, data, { UI, esc, noPeekHtml, keyHelp: KEY_GEEK }) {
    const row = (props) => UI.html("setting", props);
    return f.kind === "secret"
      ? row({ label: f.label, hint: f.hint || "", lead: UI.raw(noPeekHtml()), geek: KEY_GEEK, data, control: UI.raw(`<input type="password" class="input" data-voice-field="${esc(f.key)}" data-voice-kind="secret" aria-label="${esc(f.label)}" autocomplete="off" spellcheck="false" placeholder="${f.set ? "•••••• (set; paste to replace)" : esc(f.placeholder || "")}">`) })
      : row({ label: f.label, hint: f.hint || "", data, control: UI.raw(`<input type="text" class="input" data-voice-field="${esc(f.key)}" data-voice-kind="text" aria-label="${esc(f.label)}" spellcheck="false" value="${esc(f.value || "")}" placeholder="${esc(f.placeholder || "")}">`) });
  }

  function voiceMarkup({ voice: v, opened }, services) {
    const { UI, esc, ic, selectHtml, keyHelp: KEY_GEEK, noPeekHtml, consent } = services;
    const voiceFieldHtml = (field, data) => fieldMarkup(field, data, services);
    const consentGateHtml = props => consent.gate(props, UI);
    const consentLockHtml = (body, props) => consent.lock(body, { ...props, opened: opened === props.feature }, UI);
    const waitingOn = consent.waitingOn;
    if (!v) return '<p class="hint">The voice\'s settings come with the room; reload the window if they do not.</p>';
    const chosen = (v.providers || []).find((p) => p.id === v.provider) || null;
    const row = (props) => UI.html("setting", props);
    const options = [`<option value="off"${!chosen ? " selected" : ""}>Off</option>`]
      .concat((v.providers || []).map((p) => `<option value="${esc(p.id)}"${v.provider === p.id ? " selected" : ""}>${esc(p.label)}</option>`)).join("");
    const rest = chosen ? `${chosen.fields.filter((f) => f.use !== "reading").map((f) => voiceFieldHtml(f, waitingOn(v, f.key))).join("")}
        ${row({ label: "The language you speak", for: "sp-voice-language", hint: "Named, it helps the model; by its sound, the model hears it itself.", control: UI.raw(selectHtml("sp-voice-language", VOICE_LANGUAGES, v.language || "")) })}` : "";
    const gate = chosen ? consentGateHtml({ feature: "voice", icon: "mic", recipient: voiceRecipient(chosen), given: !!chosen.consent, lapsed: !!chosen.consentLapsed, words: chosen.consentText, view: v }) : "";
    return `<div class="page-hero">
        <b class="page-hero-title">Say it instead of typing it</b>
        <div class="hero-notes">
          <div class="hero-note is-what"><div class="hero-note-head">${ic("mic")}The microphone in the message field</div><p>Press it, speak, and press it again: your words land where the caret is, and you read them over before you send them. Press Send while it records, and it goes as a voice message. Escape lets a recording go.</p><p>Your vibemates get plain text, as when you type.</p></div>
          <div class="hero-note is-how"><div class="hero-note-head">${ic("lock")}Where your voice goes</div><p>A recording goes to the provider chosen below, which turns it into words: dictated, the words go into your field; sent as a voice message, the sound stays in the room with its words, as a message does.</p><p>A vibemate may ask for the words of a sound in the room too. A server on this computer keeps your voice here. In any room, <code>/set-up-voice</code> has a vibemate walk you through it.</p><p>${UI.html("button", { label: "Read more: choosing a service, and when nothing is heard", kind: "ghost", size: "sm", act: "voice-guide" })}</p></div>
        </div>
      </div>
      ${row({ label: "Provider", for: "sp-voice-provider", hint: chosen ? chosen.blurb : "Who turns your voice into words: a speech service of your choice, or a server of your own.", control: UI.raw(`<select class="select" id="sp-voice-provider" data-drawn-for="${esc(chosen ? chosen.id : "off")}">${options}</select>`) })}
      ${gate}
      ${chosen ? consentLockHtml(rest, { locked: !chosen.consent, feature: "voice" }) : ""}`;
  }

  function readingMarkup({ voice: v, localVoices: voices = [], language, opened }, services) {
    const { UI, esc, selectHtml, consent } = services;
    const voiceFieldHtml = (field, data) => fieldMarkup(field, data, services);
    const consentGateHtml = props => consent.gate(props, UI);
    const consentLockHtml = (body, props) => consent.lock(body, { ...props, opened: opened === props.feature }, UI);
    const waitingOn = consent.waitingOn;
    if (!v) return '<p class="hint">The voice\'s settings come with the room; reload the window if they do not.</p>';
    const r = v.reading || { reader: "off", voice: "", auto: "off", ready: false };
    const chosen = (v.providers || []).find((p) => p.id === v.provider) || null;
    const row = (props) => UI.html("setting", props);
    const readers = [["off", "Nobody"], ["system", "This computer's voices"], ["provider", chosen ? chosen.label : "The provider above"]];
    const options = readers.map(([id, label]) => `<option value="${id}"${r.reader === id ? " selected" : ""}${id === "provider" && !chosen ? " disabled" : ""}>${esc(label)}</option>`).join("");
    const hint = r.reader === "system" ? "Free, and the words stay on this computer: the voices its system has."
      : r.reader === "provider" ? `The provider of the card above reads, with its address and key: ${chosen ? chosen.label : "choose one there first"}.`
      : "This computer's voices are free and keep the words here; the provider above usually sounds more natural.";
    const rows = [
      row({ label: "Who reads", for: "sp-read-reader", hint, control: UI.raw(`<select class="select" id="sp-read-reader" data-drawn-for="${esc(r.reader)}" data-provider="${esc(chosen ? chosen.id : "off")}">${options}</select>`) }),
    ];
    if (r.reader === "system") {
      const lang = String(v.language || language || "").slice(0, 2).toLowerCase();
      const spoken = !lang || voices.some((voice) => String(voice.lang).toLowerCase().startsWith(lang));
      const hint = !voices.length ? "This computer offers the window no voice of its own: add one in the system's language settings, or let the provider read."
        : !spoken ? `None of this computer's voices speaks ${new Intl.DisplayNames(["en"], { type: "language" }).of(lang) || lang}: add one in the system's language settings, or let the provider read.`
        : "The voices of this computer's system; the system's language settings add more.";
      rows.push(row({ label: "Voice", for: "sp-read-voice", hint, control: UI.raw(selectHtml("sp-read-voice", [["", "The first in your language"], ...voices.map((voice) => [voice.name, `${voice.name} · ${voice.lang}`])], r.voice || "")) }));
    }
    const after = [];
    if (r.reader === "provider" && chosen) after.push(...chosen.fields.filter((f) => f.use === "reading").map((f) => voiceFieldHtml(f, waitingOn(r, f.key))));
    if (r.reader !== "off") {
      after.push(row({ label: "Read new replies", for: "sp-read-auto", hint: "In the room open in this window, while the window is on the screen, each after the one before; never while the microphone listens.", control: UI.raw(selectHtml("sp-read-auto", [["off", "Only when I press the speaker"], ["to-me", "The replies to me"], ["every", "Every reply"]], r.auto || "off")) }));
      if (r.ready) after.push(row({ label: "Hear it", hint: "Reads the last reply of the room open in this window, or a sentence when it has none.", control: UI.raw(UI.html("button", { label: "Read aloud", icon: "speaker", kind: "secondary", size: "sm", act: "read-try" })) }));
    }
    if (r.reader === "provider" && chosen) {
      rows.push(consentGateHtml({ feature: "reading", reader: "provider", icon: "speaker", recipient: voiceRecipient(chosen), given: !!chosen.readingConsent, lapsed: !!chosen.readingConsentLapsed, words: chosen.readingConsentText, view: r }));
      rows.push(consentLockHtml(after.join(""), { locked: !chosen.readingConsent, feature: "reading" }));
    } else rows.push(...after);
    return rows.join("");
  }

  function bindVoice(section, ports, active) {
    const { saveVoice, onAccepted, bindConsent } = ports;
    const bindSave = (...args) => ports.bindSave(...args, { listen: active.on, canStart: () => !active.disposed });
    bindConsent(section, active.signal);
    active.on(section, "click", (e) => { if (e.target.closest?.('[data-act="voice-guide"]')) ports.openVoiceGuide?.(); });
    for (const type of ["input", "change"]) active.on(section, type, (e) => e.stopPropagation());
    bindSave(section, async (current) => {
      const q = (sel) => section.querySelector(sel);
      const patch = { provider: q("#sp-voice-provider").value };
      if (patch.provider === q("#sp-voice-provider").dataset.drawnFor) {
        const settings = {};
        let any = false;
        section.querySelectorAll("[data-voice-field]").forEach((input) => {
          const value = input.value.trim();
          if (input.dataset.voiceKind === "secret" && !value) return;
          settings[input.dataset.voiceField] = value;
          any = true;
        });
        if (any) patch.settings = settings;
        if (q("#sp-voice-language")) patch.language = q("#sp-voice-language").value;
      }
      const res = await saveVoice(patch);
      onAccepted(res.view);
      if (!current()) return false;
    });
  }

  function bindReading(section, ports, active) {
    const { saveVoice, onAccepted, readProvider, bindConsent, tryReading } = ports;
    const bindSave = (...args) => ports.bindSave(...args, { listen: active.on, canStart: () => !active.disposed });
    bindConsent(section, active.signal);
    for (const type of ["input", "change"]) active.on(section, type, (e) => e.stopPropagation());
    bindSave(section, async (current) => {
      const q = (sel) => section.querySelector(sel);
      const select = q("#sp-read-reader");
      const reading = { reader: select.value };
      const patch = { reading };
      if (select.value === select.dataset.drawnFor) {
        if (q("#sp-read-voice")) reading.voice = q("#sp-read-voice").value;
        if (q("#sp-read-auto")) reading.auto = q("#sp-read-auto").value;
        if (select.dataset.provider === readProvider()) {
          const settings = {};
          let any = false;
          section.querySelectorAll("[data-voice-field]").forEach((input) => {
            const value = input.value.trim();
            if (input.dataset.voiceKind === "secret" && !value) return;
            settings[input.dataset.voiceField] = value;
            any = true;
          });
          if (any) patch.settings = settings;
        }
      }
      const res = await saveVoice(patch);
      onAccepted(res.view);
      if (!current()) return false;
    });
    const tryIt = section.querySelector('[data-act="read-try"]');
    if (tryIt) active.on(tryIt, "click", () => {
      tryReading();
    });
  }

  function mount(section, ports, bind) {
    if (!section?.ownerDocument || typeof ports?.saveVoice !== "function" || typeof ports.onAccepted !== "function") throw new TypeError("A voice Settings root and application actions are required");
    ports.signal?.throwIfAborted();
    const active = global.VIBEROOM_APP_LIFETIME.create({ window: section.ownerDocument.defaultView });
    const dispose = () => active.dispose();
    ports.signal?.addEventListener("abort", dispose, { once: true });
    active.own(() => ports.signal?.removeEventListener("abort", dispose));
    try { bind(section, ports, active); }
    catch (error) { dispose(); throw error; }
    return Object.freeze({ dispose });
  }
  const mountVoice = (section, ports) => mount(section, ports, bindVoice);
  const mountReading = (section, ports) => mount(section, ports, bindReading);
  for (const factory of [mountVoice, mountReading]) {
    Object.defineProperty(factory, "disposable", { value: true });
    Object.defineProperty(factory, "scoped", { value: true });
  }
  global.VIBEROOM_VOICE_SETTINGS = Object.freeze({ voiceMarkup, readingMarkup, mountVoice, mountReading });
})(globalThis);
