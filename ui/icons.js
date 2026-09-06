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
    at: `<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>`,
    trash: `<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`,
    pencil: `<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>`,
    pin: `<path d="M9 4h6l-.8 6.5L17 13v2H7v-2l2.8-2.5L9 4z"/><path d="M12 15v6"/>`,
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
    eye: `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
    lock: `<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
    sun: `<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>`,
    geek: `<rect x="2.5" y="10" width="8" height="7" rx="2.5"/><rect x="13.5" y="10" width="8" height="7" rx="2.5"/><path d="M10.5 13h3M2.5 12l1.8-4.5M21.5 12l-1.8-4.5"/>`,
    clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
    tool: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>`,
    smile: `<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>`,
    "arrow-down": `<path d="M12 5v14M19 12l-7 7-7-7"/>`,
    "arrow-up": `<path d="M12 19V5M5 12l7-7 7 7"/>`,
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

  window.Icons = { install, svg, names: Object.keys(ICONS) };
})();
