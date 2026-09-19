// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";

  const GEAR = `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`;
  const BELL_OFF = `<path d="M6 8a6 6 0 0 1 10.5-4M18 8v5l2 3H4l2-3V8"/><path d="M10 20a2 2 0 0 0 4 0M3 3l18 18"/>`;

  const ICONS = {
    rooms: `<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>`,
    chat: `<path d="M20 12a8 8 0 0 1-8 8H5l-1.5 1.5V12a8 8 0 1 1 16 0z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="2.6"/>`,
    skills: `<path d="M2 4.5h5.5a4 4 0 0 1 4 4V20a3 3 0 0 0-3-3H2z"/><path d="M22 4.5h-5.5a4 4 0 0 0-4 4V20a3 3 0 0 1 3-3H22z"/>`,
    puzzle: `<path d="M10 4a2 2 0 1 1 4 0h3a1 1 0 0 1 1 1v3a2 2 0 1 1 0 4v3a1 1 0 0 1-1 1h-3a2 2 0 1 1-4 0H7a1 1 0 0 1-1-1v-3a2 2 0 1 1 0-4V5a1 1 0 0 1 1-1h3z"/>`,
    settings: GEAR,
    user: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
    plus: `<path d="M12 5v14M5 12h14"/>`,
    search: `<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>`,
    inbox: `<path d="M5 4h14l3 10v6H2v-6z"/><path d="M2 14h6l2 3h4l2-3h6"/>`,
    filter: `<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>`,
    back: `<path d="M15 18l-6-6 6-6"/>`,
    forward: `<path d="M9 18l6-6-6-6"/>`,
    collapse: `<path d="M11 7l-5 5 5 5M18 7l-5 5 5 5"/>`,
    expand: `<path d="M6 7l5 5-5 5M13 7l5 5-5 5"/>`,
    close: `<path d="M18 6L6 18M6 6l12 12"/>`,
    down: `<path d="M6 9l6 6 6-6"/>`,
    stop: `<rect x="6" y="6" width="12" height="12" rx="2"/>`,
    refresh: `<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>`,
    bell: `<path d="M6 8a6 6 0 1 1 12 0v5l2 3H4l2-3V8z"/><path d="M10 20a2 2 0 0 0 4 0"/>`,
    "bell-off": BELL_OFF,
    hush: BELL_OFF,
    unmute: `<path d="M19 5H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h7.5l3.5 3.5V17h3a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/>`,
    mute: `<path d="M5.5 17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8.2"/><path d="M16.4 5H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3v3.5L12.5 17H9"/><path d="M5 20.5L16 3"/>`,
    at: `<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>`,
    trash: `<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`,
    pencil: `<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>`,
    pin: `<path d="M9 4h6l-.8 6.5L17 13v2H7v-2l2.8-2.5L9 4z"/><path d="M12 15v6"/>`,
    "pin-long": `<path d="M9 2h6l-.8 5.85L17 10.1v1.8H7v-1.8l2.8-2.25L9 2z"/><path d="M12 11.9v11.6"/>`,
    quote: `<path d="M9 6.5C6.5 7.8 5 10 5 12.6V17h5v-5H7.4c.2-1.4 1-2.5 2.4-3.2zM19 6.5c-2.5 1.3-4 3.5-4 6.1V17h5v-5h-2.6c.2-1.4 1-2.5 2.4-3.2z"/>`,
    maximize: `<path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7"/>`,
    minimize: `<path d="M20 4l-6 6M14 4v6h6M4 20l6-6M10 20v-6H4"/>`,
    "zoom-in": `<circle cx="11" cy="11" r="6"/><path d="M11 8.5v5M8.5 11h5M20 20l-4.3-4.3"/>`,
    "zoom-out": `<circle cx="11" cy="11" r="6"/><path d="M8.5 11h5M20 20l-4.3-4.3"/>`,
    send: `<path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/>`,
    folder: `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>`,
    spark: `<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 15l.6 1.6 1.6.6-1.6.6L19 19.4l-.6-1.6-1.6-.6 1.6-.6z"/>`,
    check: `<path d="M20 6L9 17l-5-5"/>`,
    alert: `<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>`,
    info: `<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>`,
    more: `<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>`,
    logout: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>`,
    link: `<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`,
    wand: `<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>`,
    bolt: `<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>`,
    save: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>`,
    copy: `<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
    eye: `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
    unplugged: `<path d="M2.5 12h2.5"/><rect x="5" y="7.5" width="6" height="9" rx="2"/><path d="M11 10h3M11 14h3"/><path d="M18 8.5v7M18 12h3.5"/>`,
    lock: `<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
    sun: `<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>`,
    geek: `<rect x="2.5" y="10" width="8" height="7" rx="2.5"/><rect x="13.5" y="10" width="8" height="7" rx="2.5"/><path d="M10.5 13h3M2.5 12l1.8-4.5M21.5 12l-1.8-4.5"/>`,
    clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
    tool: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>`,
    smile: `<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>`,
    "arrow-down": `<path d="M12 5v14M19 12l-7 7-7-7"/>`,
    "arrow-up": `<path d="M12 19V5M5 12l7-7 7 7"/>`,
    "chevrons-down": `<path d="M7 6l5 5 5-5M7 13l5 5 5-5"/>`,
    "last-reply": `<path d="M20 12a8 8 0 0 1-8 8H5l-1.5 1.5V12a8 8 0 1 1 16 0z"/><path d="M12 8v7M9 12.5l3 3 3-3"/>`,
    "chevrons-up": `<path d="M7 11l5-5 5 5M7 18l5-5 5 5"/>`,
    database: `<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>`,
    hand: `<path d="M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.3L2.6 15.6a2 2 0 0 1 2.8-2.8L7 14.4"/>`,
  };

  function install() {
    if (document.getElementById("viberoom-icons")) return;
    const style = document.createElement("style");
    style.id = "viberoom-icons";
    style.textContent = Object.entries(ICONS)
      .map(([name, body]) => `.i-${name}{--icon:url("${dataUri(body)}")}`)
      .join("\n");
    document.head.appendChild(style);
  }

  function dataUri(body) {
    const markup = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#000' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>${body.replace(/"/g, "'").replace(/currentColor/g, "#000")}</svg>`;
    return "data:image/svg+xml," + markup.replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E");
  }

  function svg(name, cls) {
    if (!ICONS[name]) name = "info";
    return `<span class="i i-${name}${cls ? ` ${cls}` : ""}" aria-hidden="true"></span>`;
  }

  const SCENES = {
    browser: `<rect class="paper-fill" x="14" y="16" width="72" height="52" rx="6"/><path class="chrome" d="M16.5 28h67" stroke-linecap="butt"/><circle class="chrome" cx="21" cy="22" r="1.6"/><circle class="chrome" cx="27" cy="22" r="1.6"/><circle class="chrome" cx="33" cy="22" r="1.6"/><rect class="chrome" x="40" y="19" width="40" height="6" rx="3"/><rect class="outline" x="14" y="16" width="72" height="52" rx="6"/><circle class="stroke" cx="50" cy="42" r="6"/><path class="stroke" d="M37 60c3-8 23-8 26 0"/><path class="accent arrow" d="M92 30l16-16M108 14h-10M108 14v10"/>`,
    code: `<rect class="paper-fill" x="10" y="14" width="60" height="44" rx="6"/><path class="chrome" d="M12.5 26h55" stroke-linecap="butt"/><circle class="chrome" cx="17" cy="20" r="1.6"/><circle class="chrome" cx="23" cy="20" r="1.6"/><circle class="chrome" cx="29" cy="20" r="1.6"/><rect class="outline" x="10" y="14" width="60" height="44" rx="6"/><rect class="stroke" x="21" y="36" width="38" height="12" rx="3"/><rect class="accent-fill" x="64" y="40" width="48" height="26" rx="7"/><path class="on-accent" d="M74 53h6M84 53h6M94 53h6" stroke-width="3.2"/>`,
    question: `<path class="paper" d="M22 12h76a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H48l-14 11V50H22a8 8 0 0 1-8-8V20a8 8 0 0 1 8-8z"/><path class="accent" d="M54 25a6 6 0 1 1 8.4 5.5c-1.6.8-2.4 1.8-2.4 3.5" stroke-width="2.6"/><circle class="accent-fill" cx="60" cy="40" r="1.6"/><rect class="stroke" x="36" y="62" width="56" height="12" rx="4"/><path class="accent" d="M42 68h2" stroke-width="2.6"/>`,
    terminal: `<rect class="dark" x="12" y="12" width="96" height="58" rx="7"/><path class="on-dark" d="M26 30l8 6-8 6"/><path class="on-dark" d="M40 42h14"/><rect class="accent-fill" x="58" y="36" width="4" height="10" rx="1"/>`,
    package: `<path class="paper" d="M22 36l38-16 38 16v28l-38 16-38-16z"/><path class="stroke" d="M22 36l38 16 38-16M60 52v28"/><path class="accent arrow" d="M60 6v20M52 18l8 8 8-8"/>`,
    done: `<circle class="ok-fill" cx="60" cy="40" r="26"/><path class="on-ok" d="M46 41l9 9 19-19" stroke-width="4"/>`,
    bot: `<rect class="paper" x="36" y="3" width="48" height="74" rx="9"/><path class="chrome" d="M52 8h16" stroke-width="3"/><rect class="chrome" x="42" y="16" width="26" height="12" rx="5"/><circle class="paper-fill" cx="49" cy="22" r="1.8"/><circle class="paper-fill" cx="55" cy="22" r="1.8"/><circle class="paper-fill" cx="61" cy="22" r="1.8"/><rect class="accent-fill" x="50" y="34" width="28" height="12" rx="6"/><text class="txt-on-accent" x="64" y="42.3" text-anchor="middle" font-size="6.2">/newbot</text><rect class="chrome" x="42" y="52" width="34" height="12" rx="5"/><path class="paper-line" d="M47 56.5h22M47 60.5h14"/><rect class="outline" x="52" y="70" width="16" height="2.4" rx="1.2"/>`,
    key: `<path class="paper" d="M16 10h88a7 7 0 0 1 7 7v40a7 7 0 0 1-7 7H34l-12 10V64h-6a7 7 0 0 1-7-7V17a7 7 0 0 1 7-7z"/><path class="chrome" d="M24 22h56M24 30h40" stroke-width="3"/><rect class="accent-soft key-row" x="22" y="38" width="80" height="16" rx="5"/><rect class="accent" x="22" y="38" width="80" height="16" rx="5"/><text class="txt" x="28" y="49.4" font-size="6.6">123456789:AAF···</text>`,
    name: `<rect class="paper" x="24" y="3" width="72" height="74" rx="9"/><path class="chrome" d="M52 8h16" stroke-width="3"/><circle class="accent-fill" cx="39" cy="27" r="5.5"/><text class="txt" x="49" y="25" font-size="4.4">viberoom on my-pc</text><path class="chrome" d="M49 31h24" stroke-width="2"/><path class="chrome" d="M30 39h60" stroke-width="1"/><circle class="dark" cx="39" cy="49" r="5.5"/><text class="txt" x="49" y="47" font-size="4.4">viberoom on mac</text><path class="chrome" d="M49 53h18" stroke-width="2"/><rect class="outline" x="52" y="70" width="16" height="2.4" rx="1.2"/>`,
    phone: `<rect class="paper" x="6" y="10" width="66" height="46" rx="5"/><path class="stroke" d="M39 56v8M27 66h24"/><rect class="accent-fill" x="27" y="21" width="6" height="6"/><rect class="paper-fill" x="29" y="23" width="2" height="2"/><rect class="accent-fill" x="45" y="21" width="6" height="6"/><rect class="paper-fill" x="47" y="23" width="2" height="2"/><rect class="accent-fill" x="27" y="39" width="6" height="6"/><rect class="paper-fill" x="29" y="41" width="2" height="2"/><rect class="accent-fill" x="36" y="22" width="2" height="2"/><rect class="accent-fill" x="40" y="24" width="2" height="2"/><rect class="accent-fill" x="37" y="28" width="2" height="2"/><rect class="accent-fill" x="43" y="30" width="2" height="2"/><rect class="accent-fill" x="30" y="31" width="2" height="2"/><rect class="accent-fill" x="34" y="33" width="2" height="2"/><rect class="accent-fill" x="47" y="34" width="2" height="2"/><rect class="accent-fill" x="38" y="38" width="2" height="2"/><rect class="accent-fill" x="44" y="40" width="2" height="2"/><rect class="accent-fill" x="48" y="44" width="2" height="2"/><rect class="accent-fill" x="37" y="43" width="2" height="2"/><rect class="accent-fill" x="41" y="34" width="2" height="2"/><rect class="paper" x="82" y="18" width="30" height="54" rx="6"/><rect class="outline" x="92" y="66" width="10" height="2" rx="1"/><rect class="accent" x="88" y="30" width="18" height="18" rx="2" stroke-dasharray="4 3"/><rect class="accent-fill" x="91" y="33" width="4" height="4"/><rect class="accent-fill" x="99" y="33" width="4" height="4"/><rect class="accent-fill" x="91" y="41" width="4" height="4"/><rect class="accent-fill" x="98" y="41" width="2" height="2"/><rect class="accent-fill" x="101" y="44" width="2" height="2"/><path class="accent scan" d="M74 34h7"/>`,
    rooms: `<rect class="paper" x="36" y="3" width="48" height="74" rx="9"/><path class="chrome" d="M52 8h16" stroke-width="3"/><rect class="accent-fill" x="52" y="15" width="26" height="12" rx="6"/><text class="txt-on-accent" x="65" y="23.3" text-anchor="middle" font-size="6.2">/rooms</text><rect class="chrome" x="42" y="33" width="34" height="26" rx="5"/><path class="paper-line" d="M47 40h20M47 46h24M47 52h16"/><circle class="ok-fill" cx="75" cy="60" r="6"/><path class="on-ok" d="M72 60l2.2 2.2 4-4" stroke-width="1.8"/><rect class="outline" x="52" y="70" width="16" height="2.4" rx="1.2"/>`,
    files: `<rect class="paper" x="36" y="3" width="48" height="74" rx="9"/><path class="chrome" d="M52 8h16" stroke-width="3"/><rect class="chrome" x="42" y="16" width="34" height="22" rx="5"/><path class="paper-line" d="M47 23h12M47 28h18M47 33h10"/><path class="paper" d="M63 19h6l4 4v9h-10z" stroke-width="1.6"/><rect class="accent-fill" x="42" y="44" width="34" height="11" rx="5.5"/><text class="txt-on-accent" x="59" y="51.8" text-anchor="middle" font-size="6">Send</text><rect class="outline" x="52" y="70" width="16" height="2.4" rx="1.2"/>`,
    "bot-mini": `<rect class="paper" x="40" y="24" width="40" height="32" rx="9"/><circle class="accent-fill" cx="52" cy="40" r="3.6"/><circle class="accent-fill" cx="68" cy="40" r="3.6"/><path class="stroke" d="M60 24v-7"/><circle class="accent-fill" cx="60" cy="13" r="3.2"/><path class="stroke" d="M53 49h14"/>`,
    "key-mini": `<circle class="paper" cx="42" cy="40" r="12"/><circle class="accent-fill" cx="42" cy="40" r="3.4"/><path class="stroke" d="M54 40h32M78 40v9M86 40v6"/>`,
    "phone-mini": `<rect class="paper" x="44" y="12" width="32" height="56" rx="7"/><path class="chrome" d="M54 17h12" stroke-width="3"/><circle class="ok-fill" cx="60" cy="42" r="9"/><path class="on-ok" d="M55.5 42l3.2 3.2 5.8-5.8" stroke-width="2"/>`,
    failed: `<path class="bad-fill" d="M60 13l30 52H30z"/><path class="on-bad" d="M60 33v14M60 55v1" stroke-width="4"/>`,
  };

  function scene(name) {
    const body = SCENES[name] || SCENES.failed;
    return `<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  window.Icons = { install, svg, scene, names: Object.keys(ICONS), scenes: Object.keys(SCENES) };
})();
