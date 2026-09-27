// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";

  const GEAR_HUB = `<circle cx="12" cy="12" r="3"/>`;
  const GEAR_TEETH = `<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`;
  const GEAR = GEAR_HUB + GEAR_TEETH;
  const BELL_OFF = `<path d="M6 8a6 6 0 0 1 10.5-4M18 8v5l2 3H4l2-3V8"/><path d="M10 20a2 2 0 0 0 4 0M3 3l18 18"/>`;
  const SOLID_GEAR = `<path fill="#000" fill-rule="evenodd" stroke-width=".8" d="M10 2h4l.7 3 1.6.9 2.9-.9 2 3.5-2.2 2.1v1.8l2.2 2.1-2 3.5-2.9-.9-1.6.9-.7 3h-4l-.7-3-1.6-.9-2.9.9-2-3.5L5 12.9v-1.8L2.8 9l2-3.5 2.9.9L9.3 5z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>`;

  const PARTS = {
    plus: { v: `<path d="M12 5v14"/>`, h: `<path d="M5 12h14"/>` },
    rooms: { tl: `<rect x="4" y="4" width="7" height="7" rx="2"/>`, tr: `<rect x="13" y="4" width="7" height="7" rx="2"/>`, bl: `<rect x="4" y="13" width="7" height="7" rx="2"/>`, br: `<rect x="13" y="13" width="7" height="7" rx="2"/>` },
    skills: { left: `<path d="M2 4.5h5.5a4 4 0 0 1 4 4V20a3 3 0 0 0-3-3H2z"/>`, right: `<path d="M22 4.5h-5.5a4 4 0 0 0-4 4V20a3 3 0 0 1 3-3H22z"/>` },
    settings: { hub: GEAR_HUB, teeth: GEAR_TEETH },
    "settings-solid": { gear: SOLID_GEAR },
    "transfer-solid": { down: `<path fill="#000" stroke-width="1.2" d="M5.5 3h3v11H12l-5 6-5-6h3.5z"/>`, up: `<path fill="#000" fill-opacity=".4" stroke-width="1.2" d="M15.5 21h3V10H22l-5-6-5 6h3.5z"/>` },
    "pin-solid": { head: `<path fill="#000" fill-opacity=".35" stroke-width="1.8" d="M8 3h8l-1 7 3 3v2H6v-2l3-3z"/>`, needle: `<path stroke-width="2.4" d="M12 15v7"/>` },
    "folder-solid": { back: `<path fill="#000" fill-opacity=".2" stroke-width="1.7" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`, front: `<path fill="#000" fill-opacity=".35" stroke-width="1.7" d="M3 11h18l-2 8H5z"/>` },
    "search-solid": { lens: `<circle cx="10.5" cy="10.5" r="6.5" fill="#000" fill-opacity=".18" stroke-width="2"/>`, handle: `<path d="M16 16l5 5" stroke-width="3.2"/>` },
    "clock-solid": { face: `<circle cx="12" cy="12" r="8.5" fill="#000" fill-opacity=".18" stroke-width="2.2"/>`, minute: `<path d="M12 7.5V12" stroke-width="2.4"/>`, hour: `<path d="M12 12l3.2 2.2" stroke-width="2.4"/>` },
    collapse: { lead: `<path d="M11 7l-5 5 5 5"/>`, trail: `<path d="M18 7l-5 5 5 5"/>` },
    expand: { trail: `<path d="M6 7l5 5-5 5"/>`, lead: `<path d="M13 7l5 5-5 5"/>` },
    transfer: { down: `<path d="M7 4v15M3 15l4 4 4-4"/>`, up: `<path d="M17 20V5M13 9l4-4 4 4"/>` },
    palette: {
      board: `<path d="M12 3.5c-5 0-9 3.7-9 8.4 0 4.8 3.9 8.6 8.7 8.6 1.2 0 1.9-.8 1.9-1.8 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h2.2c2.8 0 4.9-2.1 4.9-4.9C21.5 6.9 17.3 3.5 12 3.5z"/>`,
      a: `<circle cx="7.6" cy="11.4" r="1.3" fill="#000" stroke-width=".8"/>`,
      b: `<circle cx="10.2" cy="7.4" r="1.3" fill="#000" stroke-width=".8"/>`,
      c: `<circle cx="15" cy="7.6" r="1.3" fill="#000" stroke-width=".8"/>`,
    },
    bot: {
      head: `<rect x="4.5" y="8.5" width="15" height="11" rx="3.5"/><path d="M2.5 13v2.5M21.5 13v2.5M10 16.6h4"/>`,
      eyes: `<path d="M9.3 12.6v1.4M14.7 12.6v1.4" stroke-width="2.5"/>`,
      antenna: `<path d="M12 8.5V5.6"/><circle cx="12" cy="4.1" r="1.4"/>`,
    },
    phone: {
      body: `<rect x="3.5" y="3" width="10" height="18" rx="2.5"/><path d="M7.5 17.9h2"/>`,
      near: `<path d="M16.6 9.3a3.8 3.8 0 0 1 0 5.4"/>`,
      far: `<path d="M19.3 6.6a7.6 7.6 0 0 1 0 10.8"/>`,
    },
    graph: {
      links: `<path d="M8.6 6.9l6.8-.4M7.3 9.1l3.5 6.4M16.7 8.5l-3.5 7"/>`,
      a: `<circle cx="6.2" cy="7" r="2.2"/>`,
      b: `<circle cx="17.8" cy="6.4" r="2.2"/>`,
      c: `<circle cx="12" cy="17.8" r="2.4"/>`,
    },
    code: { left: `<path d="M8 7l-5 5 5 5"/>`, right: `<path d="M16 7l5 5-5 5"/>`, slash: `<path d="M13.6 4.5l-3.2 15"/>` },
    plug: {
      prongs: `<path d="M9 2.5v5M15 2.5v5" stroke-width="2.2"/>`,
      body: `<path d="M5.5 7.5h13v3a6.5 6.5 0 0 1-13 0z"/>`,
      cord: `<path d="M12 17v2.2a2.3 2.3 0 0 0 2.3 2.3H17"/>`,
    },
    power: { ring: `<path d="M17.7 6.9a8 8 0 1 1-11.4 0"/>`, bar: `<path d="M12 3v8.5"/>` },
    sliders: {
      rails: `<path d="M4 6.5h16M4 12h16M4 17.5h16"/>`,
      a: `<circle cx="8.5" cy="6.5" r="2.2" fill="#000"/>`,
      b: `<circle cx="15.5" cy="12" r="2.2" fill="#000"/>`,
      c: `<circle cx="10" cy="17.5" r="2.2" fill="#000"/>`,
    },
    journal: {
      cover: `<path d="M6.5 3.5h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM8.5 3.5v17"/>`,
      lines: `<path d="M11.5 12h5M11.5 15.5h3.5"/>`,
      ribbon: `<path d="M14.5 3.5v5l1.5-1.2 1.5 1.2v-5"/>`,
    },
    dial: {
      face: `<circle cx="12" cy="13.5" r="7"/><path d="M12 2.8v1.6M4.6 6.1l1.1 1.1M19.4 6.1l-1.1 1.1"/>`,
      pointer: `<path d="M12 13.5V9.2" stroke-width="2.2"/><circle cx="12" cy="13.5" r="1" fill="#000"/>`,
    },
    pulse: { beat: `<path d="M2 12.5h4.2l2.3-5 3.8 10 2.9-7.5 1.6 2.5H22"/>` },
    gauge: {
      arc: `<path d="M4.3 17.5a8.6 8.6 0 1 1 15.4 0M12 5.8v1.4M6.6 8.1l1 1M17.4 8.1l-1 1"/>`,
      needle: `<path d="M12 14.5l3.4-4.3"/><circle cx="12" cy="14.5" r="1.3" fill="#000"/>`,
    },
  };
  const whole = (name) => Object.values(PARTS[name]).join("");

  const TRAVELLERS = {
    skills: { leaf: PARTS.skills.right, "leaf-2": PARTS.skills.right },
    settings: { mate: `<g transform="translate(17.7 17.7) scale(.46) rotate(22.5) translate(-12 -12)" stroke-width="3">${GEAR}</g>` },
    "settings-solid": { mate: `<g transform="translate(16.8 16.8) scale(.46) rotate(30) translate(-12 -12)">${SOLID_GEAR}</g>` },
    "transfer-solid": { "down-next": PARTS["transfer-solid"].down, "up-next": PARTS["transfer-solid"].up },
    transfer: { "down-next": PARTS.transfer.down, "up-next": PARTS.transfer.up },
    collapse: { next: PARTS.collapse.trail },
    expand: { next: PARTS.expand.trail },
    pulse: { "beat-next": PARTS.pulse.beat },
  };

  const ICONS = {
    rooms: whole("rooms"),
    chat: `<path d="M20 12a8 8 0 0 1-8 8H5l-1.5 1.5V12a8 8 0 1 1 16 0z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="2.6"/>`,
    skills: whole("skills"),
    puzzle: `<path d="M10 4a2 2 0 1 1 4 0h3a1 1 0 0 1 1 1v3a2 2 0 1 1 0 4v3a1 1 0 0 1-1 1h-3a2 2 0 1 1-4 0H7a1 1 0 0 1-1-1v-3a2 2 0 1 1 0-4V5a1 1 0 0 1 1-1h3z"/>`,
    settings: whole("settings"),
    automation: `<path d="M2 11a10 10 0 0 1 17-6M19 1v4h-4M22 13a10 10 0 0 1-17 6M5 23v-4h4"/><g transform="translate(6 6) scale(.5)" stroke-width="3.4">${GEAR}</g>`,
    transfer: whole("transfer"),
    palette: whole("palette"),
    bot: whole("bot"),
    phone: whole("phone"),
    graph: whole("graph"),
    code: whole("code"),
    plug: whole("plug"),
    power: whole("power"),
    sliders: whole("sliders"),
    journal: whole("journal"),
    dial: whole("dial"),
    pulse: whole("pulse"),
    gauge: whole("gauge"),
    "settings-solid": whole("settings-solid"),
    "transfer-solid": whole("transfer-solid"),
    "pin-solid": whole("pin-solid"),
    "folder-solid": whole("folder-solid"),
    "search-solid": whole("search-solid"),
    "clock-solid": whole("clock-solid"),
    user: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
    plus: whole("plus"),
    search: `<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>`,
    inbox: `<path d="M5 4h14l3 10v6H2v-6z"/><path d="M2 14h6l2 3h4l2-3h6"/>`,
    filter: `<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>`,
    back: `<path d="M15 18l-6-6 6-6"/>`,
    forward: `<path d="M9 18l6-6-6-6"/>`,
    collapse: whole("collapse"),
    expand: whole("expand"),
    close: `<path d="M18 6L6 18M6 6l12 12"/>`,
    down: `<path d="M6 9l6 6 6-6"/>`,
    stop: `<rect x="6" y="6" width="12" height="12" rx="2"/>`,
    play: `<path d="M7 4l14 8-14 8z"/>`,
    pause: `<path d="M8 5v14M16 5v14" stroke-width="3"/>`,
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
    image: `<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 15.5l-4.5-4.5-9 8.5"/>`,
    maximize: `<path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7"/>`,
    minimize: `<path d="M20 4l-6 6M14 4v6h6M4 20l6-6M10 20v-6H4"/>`,
    "zoom-in": `<circle cx="11" cy="11" r="6"/><path d="M11 8.5v5M8.5 11h5M20 20l-4.3-4.3"/>`,
    "zoom-out": `<circle cx="11" cy="11" r="6"/><path d="M8.5 11h5M20 20l-4.3-4.3"/>`,
    send: `<path d="M4 12l16-8-6 16-2.5-6.5L4 12z"/>`,
    mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>`,
    video: `<rect x="3" y="6" width="12.5" height="12" rx="2.5"/><path d="M15.5 10.5l5-3v9l-5-3z"/>`,
    speaker: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>`,
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
    calendar: `<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7 15h10" stroke-width="2.4"/>`,
    "calendar-days": `<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14.5h.01M12 17.5h.01M16 14.5h.01" stroke-width="3"/>`,
    tool: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>`,
    smile: `<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>`,
    "arrow-down": `<path d="M12 5v14M19 12l-7 7-7-7"/>`,
    "arrow-up": `<path d="M12 19V5M5 12l7-7 7 7"/>`,
    "chevrons-down": `<path d="M7 6l5 5 5-5M7 13l5 5 5-5"/>`,
    "go-to-message": `<path d="M20 12a8 8 0 0 1-8 8H5l-1.5 1.5V12a8 8 0 1 1 16 0z"/><path d="M12 8v7M9 12.5l3 3 3-3"/>`,
    "chevrons-up": `<path d="M7 11l5-5 5 5M7 18l5-5 5 5"/>`,
    database: `<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>`,
    hand: `<path d="M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.3L2.6 15.6a2 2 0 0 1 2.8-2.8L7 14.4"/>`,
  };

  function install() {
    if (document.getElementById("viberoom-icons")) return;
    const style = document.createElement("style");
    style.id = "viberoom-icons";
    const glyphs = Object.entries(ICONS).map(([name, body]) => `.i-${name}{--icon:url("${dataUri(body)}")}`);
    const parts = Object.keys(PARTS).flatMap((name) => Object.entries(rigParts(name)).map(([part, body]) => `.rig-${name}>.p-${part}{--icon:url("${dataUri(body)}")}`));
    style.textContent = [...glyphs, ...parts].join("\n");
    document.head.appendChild(style);
  }

  function rigParts(name) {
    return { ...PARTS[name], ...TRAVELLERS[name] };
  }

  function dataUri(body) {
    const markup = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#000' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>${body.replace(/"/g, "'").replace(/currentColor/g, "#000")}</svg>`;
    return "data:image/svg+xml," + markup.replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E");
  }

  function svg(name, cls) {
    if (!ICONS[name]) name = "info";
    return `<span class="i i-${name}${cls ? ` ${cls}` : ""}" aria-hidden="true"></span>`;
  }

  function rig(name, cls) {
    if (!PARTS[name]) return svg(name, cls);
    const travellers = TRAVELLERS[name] || {};
    const parts = Object.keys(rigParts(name)).map((part) => `<span class="p p-${part}${part in travellers ? " travel" : ""}"></span>`).join("");
    return `<span class="i i-${name} rig rig-${name}${cls ? ` ${cls}` : ""}" aria-hidden="true">${parts}</span>`;
  }

  const HOSTS = "button, a[href], label, summary, [role='button']";
  function playOnHover(root) {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    root.addEventListener("pointerover", (event) => {
      const host = event.target instanceof Element ? event.target.closest(HOSTS) : null;
      if (!host || host.contains(event.relatedTarget) || still?.matches) return;
      for (const glyph of host.querySelectorAll(".rig")) play(glyph);
    });
  }

  function play(glyph) {
    if (glyph.classList.contains("play")) return;
    glyph.classList.add("play");
    Promise.allSettled(glyph.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => glyph.classList.remove("play"));
  }

  const SCENES = {
    automation: `<rect class="auto-paper" x="10" y="12" width="70" height="58" rx="10"/><path class="auto-calendar" d="M10 29h70M27 6v14M63 6v14"/><path class="auto-ticks" d="M24 41h7M42 41h7M24 53h7M42 53h7"/><g class="auto-clock"><circle class="auto-clock-face" cx="86" cy="51" r="23"/><path class="auto-hand" d="M86 36v15l10 6"/><path class="auto-spark" d="M101 13v10M96 18h10M7 76h5"/></g>`,
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
    "carry-out": `<rect class="paper" x="14" y="18" width="58" height="38" rx="5"/><path class="chrome" d="M22 28h30M22 36h20M22 44h26" stroke-width="3"/><path class="paper" d="M6 60h74l-6 8H12z"/><path class="accent cx-trail" d="M60 40c12-3 20-12 25-24" stroke-dasharray="2 5"/><g class="cx-pkg"><path class="paper" d="M82 14l15-6 15 6v15l-15 6-15-6z"/><path class="stroke" d="M82 14l15 6 15-6M97 20v15"/><path class="accent" d="M89.5 11l15 6" stroke-width="2"/></g>`,
    "carry-in": `<rect class="paper-fill" x="42" y="18" width="70" height="54" rx="7"/><path class="chrome" d="M44.5 30h65" stroke-linecap="butt"/><circle class="chrome" cx="49" cy="24" r="1.6"/><circle class="chrome" cx="55" cy="24" r="1.6"/><circle class="chrome" cx="61" cy="24" r="1.6"/><rect class="outline" x="42" y="18" width="70" height="54" rx="7"/><path class="chrome" d="M52 42h30M52 51h40M52 60h22" stroke-width="3"/><path class="accent cx-trail" d="M28 30c9 1 15 6 19 14" stroke-dasharray="2 5"/><g class="cx-pkg"><path class="paper" d="M4 13l15-6 15 6v15l-15 6-15-6z"/><path class="stroke" d="M4 13l15 6 15-6M19 19v15"/><path class="accent" d="M11.5 10l15 6" stroke-width="2"/></g>`,
    "auto-reminder": `<path class="paper" d="M18 34h44a7 7 0 0 1 7 7v17a7 7 0 0 1-7 7H36l-11 9v-9h-7a7 7 0 0 1-7-7V41a7 7 0 0 1 7-7z"/><path class="chrome" d="M21 45h30M21 54h20" stroke-width="3"/><circle class="accent-fill auto-dot" cx="66" cy="37" r="4.5"/><path class="accent auto-ring" d="M71 25c.8-4 2.8-7.6 5.8-10.4M113 25c-.8-4-2.8-7.6-5.8-10.4"/><path class="accent auto-ring is-far" d="M65.5 28c1-6 4-11.3 8.5-15M118.5 28c-1-6-4-11.3-8.5-15"/><g class="auto-bell"><path class="stroke" d="M92 13.5v4.5"/><path class="paper" d="M80 40V30a12 12 0 0 1 24 0v10l4.5 6h-33z"/><path class="stroke" d="M88 49a4 4 0 0 0 8 0"/><path class="accent" d="M85.5 29a7 7 0 0 1 4.5-4.6" stroke-width="2"/></g>`,
    "auto-task": `<rect class="paper" x="18" y="12" width="56" height="62" rx="8"/><rect class="chrome" x="34" y="7" width="24" height="10" rx="4"/><rect class="stroke" x="27" y="26" width="10" height="10" rx="3"/><rect class="stroke" x="27" y="42" width="10" height="10" rx="3"/><rect class="stroke" x="27" y="58" width="10" height="10" rx="3"/><path class="chrome" d="M44 31h20M44 47h16M44 63h18" stroke-width="3"/><path class="accent auto-checkmark" d="M29 31l2.6 2.6 5-5.6" stroke-width="2.6"/><path class="accent auto-checkmark is-second" d="M29 47l2.6 2.6 5-5.6" stroke-width="2.6"/><g class="auto-mate"><path class="stroke" d="M96 34v-6"/><circle class="accent-fill" cx="96" cy="25" r="3"/><rect class="accent-fill" x="81" y="34" width="30" height="26" rx="10"/><circle class="paper-fill" cx="90" cy="45" r="2.6"/><circle class="paper-fill" cx="102" cy="45" r="2.6"/><path class="on-accent" d="M91 52c3 2.4 7 2.4 10 0" stroke-width="2"/></g><path class="accent auto-glint" d="M112 12v8M108 16h8"/>`,
    "memory-scribe": [
      `<rect class="paper" x="4" y="32" width="66" height="76" rx="8"/><path class="chrome" d="M6.5 43h61" stroke-linecap="butt"/><circle class="chrome" cx="11" cy="37.5" r="1.5"/><circle class="chrome" cx="16" cy="37.5" r="1.5"/><circle class="chrome" cx="21" cy="37.5" r="1.5"/><rect class="chrome ms-msg m1" x="10" y="51" width="32" height="11" rx="5.5"/><rect class="accent-soft ms-msg m2" x="30" y="68" width="34" height="11" rx="5.5"/><rect class="chrome ms-msg m3" x="10" y="85" width="38" height="11" rx="5.5"/><g transform="translate(12 0)">`,
      `<path class="paper" d="M121 106V90c0-9 6-14 15-14h28c9 0 15 5 15 14v16"/><rect class="chrome" x="140" y="83" width="20" height="12" rx="3.5"/><circle class="accent-fill ms-rec" cx="145.5" cy="89" r="2.2"/><path class="stroke" d="M150.5 87h5M150.5 91h3.5" stroke-width="1.6"/><rect class="chrome" x="143" y="66" width="14" height="11" rx="2"/>`,
      `<g class="ms-head"><path class="stroke" d="M150 24v-8.5"/><circle class="accent ms-ping" cx="150" cy="11.5" r="4"/><circle class="accent-fill ms-bulb" cx="150" cy="11.5" r="4"/><rect class="paper" x="115" y="38" width="8" height="17" rx="4"/><rect class="paper" x="177" y="38" width="8" height="17" rx="4"/><rect class="paper" x="121" y="24" width="58" height="45" rx="15"/><rect class="chrome" x="128" y="31" width="44" height="31" rx="11"/><path class="stroke" d="M136 40.6q3.6-2.8 7.2 0M156.8 40.6q3.6-2.8 7.2 0" stroke-width="2"/>`,
      `<g class="ms-eyes"><g class="ms-blink"><circle class="ink-fill" cx="141" cy="48" r="3.4"/><circle class="ink-fill" cx="159" cy="48" r="3.4"/><circle class="paper-fill" cx="142.3" cy="46.7" r="1.1"/><circle class="paper-fill" cx="160.3" cy="46.7" r="1.1"/></g></g>`,
      `<ellipse class="blush-soft" cx="133.5" cy="54.5" rx="3.4" ry="2.2"/><ellipse class="blush-soft" cx="166.5" cy="54.5" rx="3.4" ry="2.2"/><path class="blush ms-tongue" d="M152 55.9C152.2 59.4 153.4 60.6 154.6 60.6S157 59.2 156.7 55.3Z"/><path class="stroke" d="M143.5 54.5q6.5 3.6 13 0" stroke-width="2"/></g>`,
      `<path class="chrome" d="M100 100H216L224 127H92Z"/><path class="outline" d="M100 100H216L224 127H92Z"/><path class="paper" d="M92 127H224V133H92Z"/><path class="stroke" d="M100 133V148M216 133V148"/>`,
      `<path class="accent-fill" d="M123 125.5L126.6 103.8Q127 102.5 128.4 102.5H187.6Q189 102.5 189.4 103.8L193 125.5Z"/><path class="paper" d="M158 106.5Q143.5 103 128.8 104.2L125.2 124H158Z"/><path class="paper" d="M158 106.5Q172.5 103 187.2 104.2L190.8 124H158Z"/><path class="accent" d="M133.5 113h4.64M139.94 113h3.87M145.61 113h4.39M133.5 116.5h7.85M143.15 116.5h7.85M133.5 120h2.91M138.21 120h6.79"/>`,
      `<g class="ms-leaf"><path class="paper" d="M158 106.5Q172.5 103 187.2 104.2L190.8 124H158Z"/><g class="ms-front"><path class="accent ms-ink i1" pathLength="1" d="M165 113h4.37M171.17 113h2.5M175.46 113h3.54"/><path class="accent ms-ink i2" pathLength="1" d="M165 116.5h3.42M170.22 116.5h5.13M177.15 116.5h2.85"/><path class="accent ms-ink i3" pathLength="1" d="M165 120h5.08M171.88 120h3.12"/></g><g class="ms-back" transform="matrix(-1 0 0 1 316 0)"><path class="accent" d="M133.5 113h4.64M139.94 113h3.87M145.61 113h4.39M133.5 116.5h7.85M143.15 116.5h7.85M133.5 120h2.91M138.21 120h6.79"/></g></g><path class="stroke" d="M158 106.5V124"/>`,
      `<path class="stroke" d="M124 88L118.5 102L127.5 114" stroke-width="7.6"/><path class="paper-line" d="M124 88L118.5 102L127.5 114" stroke-width="3.2"/><circle class="paper" cx="118.5" cy="102" r="3.8"/><g class="ms-hold"><circle class="paper" cx="127.5" cy="114" r="4.6"/></g>`,
      `<g class="ms-upper"><path class="stroke" d="M176 88L183.11 101.21" stroke-width="7.6"/><path class="paper-line" d="M176 88L183.11 101.21" stroke-width="3.2"/><g class="ms-fore"><path class="stroke" d="M183.11 101.21L169 106.3" stroke-width="7.6"/><path class="paper-line" d="M183.11 101.21L169 106.3" stroke-width="3.2"/><circle class="paper" cx="183.11" cy="101.21" r="3.8"/><g class="ms-hand"><g class="ms-scrawl"><path class="stroke" d="M165.4 110.3L178.29 95.85" stroke-width="4.6"/><path class="accent" d="M166.9 108.6L178.29 95.85" stroke-width="2"/><circle class="paper" cx="169" cy="106.3" r="4.6"/></g></g></g></g>`,
      `<circle class="paper" cx="124" cy="88" r="5.2"/><circle class="paper" cx="176" cy="88" r="5.2"/></g>`,
      `<g transform="translate(40 45)"><g class="ms-say s1"><path class="paper" d="M5 0h20a5 5 0 0 1 5 5v7a5 5 0 0 1-5 5H11l-6 5v-5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5z"/><path class="chrome" d="M6.5 6.5h17M6.5 10.5h11"/></g></g>`,
      `<g transform="translate(44 62)"><g class="ms-say s2"><path class="paper" d="M5 0h20a5 5 0 0 1 5 5v7a5 5 0 0 1-5 5H11l-6 5v-5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5z"/><circle class="accent-fill" cx="9" cy="8.5" r="1.7"/><circle class="accent-fill" cx="15" cy="8.5" r="1.7"/><circle class="accent-fill" cx="21" cy="8.5" r="1.7"/></g></g>`,
      `<g transform="translate(40 79)"><g class="ms-say s3"><path class="paper" d="M5 0h20a5 5 0 0 1 5 5v7a5 5 0 0 1-5 5H11l-6 5v-5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5z"/><path class="chrome" d="M6.5 6.5h14M6.5 10.5h17"/></g></g>`,
    ].join(""),
    "no-peek": [
      `<path class="stroke" d="M45 52h8" stroke-width="3.4"/><path class="accent-fill" d="M53 52c3.4-2.2 3.4-7.6 0-7.6s-3.4 5.4 0 7.6zM53 52c3.4 2.2 3.4 7.6 0 7.6s-3.4-5.4 0-7.6z"/><path class="outline" d="M53 52c3.4-2.2 3.4-7.6 0-7.6s-3.4 5.4 0 7.6zM53 52c3.4 2.2 3.4 7.6 0 7.6s-3.4-5.4 0-7.6z" stroke-width="1.5"/><path class="paper" d="M17 64V50c0-6 4-10 10-10h10c6 0 9.5 4 9.5 10v14"/>`,
      `<g transform="rotate(-6 30 38)"><g class="np-head"><rect class="chrome" x="26.5" y="33" width="9" height="8" rx="1.5"/><path class="stroke" d="M31 10c0-4 2-6 5.4-6.8"/><circle class="accent-fill" cx="37.4" cy="2.9" r="2.5"/><rect class="paper" x="15" y="10" width="30" height="26" rx="9"/><rect class="chrome" x="11" y="14.5" width="7" height="17" rx="3"/><rect class="outline" x="11" y="14.5" width="7" height="17" rx="3"/></g></g>`,
      `<path class="stroke" d="M31 46L18 43L12.6 28" stroke-width="6.4"/><path class="paper-line" d="M31 46L18 43L12.6 28" stroke-width="2.4"/><circle class="paper" cx="18" cy="43" r="3.2"/><g transform="rotate(-8 11.8 20.5)"><rect class="paper" x="8.1" y="12.6" width="7.6" height="15.6" rx="3.8"/><path class="stroke" d="M10.7 13.6v3.4M13.2 13.6v3.4" stroke-width="1.2"/><path class="paper" d="M15.3 21.2c2.3-.4 3.7.8 3.7 2.5s-1.4 2.7-3.5 2.3"/></g><circle class="paper" cx="31" cy="46" r="3.8"/>`,
      `<g class="np-drop"><path class="accent-soft" d="M52 7c1.8 2.6 2.5 4 2.5 5.1a2.5 2.5 0 0 1-5 0c0-1.1.7-2.5 2.5-5.1z"/><path class="accent" d="M52 7c1.8 2.6 2.5 4 2.5 5.1a2.5 2.5 0 0 1-5 0c0-1.1.7-2.5 2.5-5.1z" stroke-width="1.4"/></g>`,
    ].join(""),
    "connect-plug": [
      `<path class="outline" d="M6 140H234" stroke-width="1.6"/><rect class="paper" x="124" y="12" width="108" height="122" rx="10"/>`,
      `<rect class="chrome" x="132" y="20" width="92" height="30" rx="8"/><rect class="paper" x="138" y="26" width="18" height="18" rx="5"/><path class="accent" d="M143 30h5l3 3v8h-8z" stroke-width="1.6"/><path class="paper-line" d="M162 31h40M162 39h26" stroke-width="3"/>`,
      `<rect class="chrome" x="132" y="56" width="92" height="30" rx="8"/><rect class="accent-soft cp-lit" x="132" y="56" width="92" height="30" rx="8"/><rect class="paper" x="138" y="62" width="18" height="18" rx="5"/><rect class="accent" x="142" y="66" width="10" height="10" rx="2" stroke-width="1.6"/><path class="accent" d="M144.5 71l2 2 3.5-4" stroke-width="1.6"/><path class="paper-line" d="M162 67h40M162 75h26" stroke-width="3"/><path class="accent cp-wrote" pathLength="1" d="M192 75h14" stroke-width="3"/>`,
      `<rect class="chrome" x="132" y="92" width="92" height="30" rx="8"/><rect class="paper" x="138" y="98" width="18" height="18" rx="5"/><rect class="accent" x="141" y="102" width="12" height="10" rx="2" stroke-width="1.6"/><path class="accent" d="M142.5 110.5l3.5-4 3 3 1.5-1.5 2 2.5" stroke-width="1.4"/><path class="paper-line" d="M162 103h40M162 111h26" stroke-width="3"/>`,
      `<g transform="translate(-88 0)">`,
      `<rect class="paper" x="133" y="110" width="12" height="24" rx="5"/><rect class="paper" x="155" y="110" width="12" height="24" rx="5"/><rect class="paper" x="128" y="132" width="19" height="8" rx="4"/><rect class="paper" x="153" y="132" width="19" height="8" rx="4"/>`,
      `<path class="paper" d="M121 116V90c0-9 6-14 15-14h28c9 0 15 5 15 14v26z"/><rect class="chrome" x="140" y="83" width="20" height="12" rx="3.5"/><circle class="accent-fill cp-rec" cx="145.5" cy="89" r="2.2"/><path class="stroke" d="M150.5 87h5M150.5 91h3.5" stroke-width="1.6"/><rect class="chrome" x="143" y="66" width="14" height="11" rx="2"/>`,
      `<g class="cp-head"><path class="stroke" d="M150 24v-8.5"/><circle class="accent cp-ping" cx="150" cy="11.5" r="4"/><circle class="accent-fill cp-bulb" cx="150" cy="11.5" r="4"/><rect class="paper" x="115" y="38" width="8" height="17" rx="4"/><rect class="paper" x="177" y="38" width="8" height="17" rx="4"/><rect class="paper" x="121" y="24" width="58" height="45" rx="15"/><rect class="chrome" x="128" y="31" width="44" height="31" rx="11"/><path class="stroke" d="M136 40.6q3.6-2.8 7.2 0M156.8 40.6q3.6-2.8 7.2 0" stroke-width="2"/>`,
      `<g class="cp-eyes"><g class="cp-blink"><circle class="ink-fill" cx="141" cy="48" r="3.4"/><circle class="ink-fill" cx="159" cy="48" r="3.4"/><circle class="paper-fill" cx="142.3" cy="46.7" r="1.1"/><circle class="paper-fill" cx="160.3" cy="46.7" r="1.1"/></g></g>`,
      `<ellipse class="blush-soft" cx="133.5" cy="54.5" rx="3.4" ry="2.2"/><ellipse class="blush-soft" cx="166.5" cy="54.5" rx="3.4" ry="2.2"/><path class="blush cp-tongue" d="M152 55.9C152.2 59.4 153.4 60.6 154.6 60.6S157 59.2 156.7 55.3Z"/><path class="stroke" d="M143.5 54.5q6.5 3.6 13 0" stroke-width="2"/></g>`,
      `<g class="cp-lup"><path class="stroke" d="M124 88L118.5 102" stroke-width="7.6"/><path class="paper-line" d="M124 88L118.5 102" stroke-width="3.2"/><g class="cp-lfore"><path class="stroke" d="M118.5 102L127.5 114" stroke-width="7.6"/><path class="paper-line" d="M118.5 102L127.5 114" stroke-width="3.2"/><circle class="paper" cx="118.5" cy="102" r="3.8"/><circle class="paper" cx="127.5" cy="114" r="4.6"/></g></g>`,
      `<g class="cp-rup"><path class="stroke" d="M176 88L190.8 85.7" stroke-width="7.6"/><path class="paper-line" d="M176 88L190.8 85.7" stroke-width="3.2"/><g class="cp-rfore"><path class="stroke" d="M190.8 85.7L194 71" stroke-width="7.6"/><path class="paper-line" d="M190.8 85.7L194 71" stroke-width="3.2"/><circle class="paper" cx="190.8" cy="85.7" r="3.8"/><g class="cp-rhand"><path class="stroke" d="M199 76c0 9-5 14-11 17s-8 8-6 13" stroke-width="2.4"/><path class="stroke" d="M205 68.5h4.5M205 73.5h4.5" stroke-width="2"/><rect class="accent-fill" x="196" y="65" width="10" height="12" rx="2.5"/><circle class="paper" cx="194" cy="71" r="4.6"/></g></g></g>`,
      `<circle class="paper" cx="124" cy="88" r="5.2"/><circle class="paper" cx="176" cy="88" r="5.2"/></g>`,
      `<rect class="paper" x="119" y="28" width="9" height="14" rx="3"/><path class="stroke" d="M121.5 32.5h2.5M121.5 37.5h2.5" stroke-width="1.4"/><rect class="paper" x="119" y="64" width="9" height="14" rx="3"/><path class="stroke" d="M121.5 68.5h2.5M121.5 73.5h2.5" stroke-width="1.4"/><rect class="paper" x="119" y="100" width="9" height="14" rx="3"/><path class="stroke" d="M121.5 104.5h2.5M121.5 109.5h2.5" stroke-width="1.4"/>`,
      `<path class="accent cp-spark" d="M123.5 59v-5M129.5 60.5l3-4M123.5 83v5M129.5 81.5l3 4" stroke-width="1.8"/><g class="cp-ok"><circle class="ok-fill" cx="216" cy="62" r="6"/><path class="on-ok" d="M213 62l2.1 2.1 4-4.2" stroke-width="1.8"/></g>`,
      `<g transform="translate(140 62)"><g class="cp-sheet k1"><path class="paper" d="M0 0h10l4 4v13H0z"/><path class="chrome" d="M3 8h7M3 12h5" stroke-width="1.4"/></g></g>`,
      `<g transform="translate(140 62)"><g class="cp-sheet k2"><path class="paper" d="M0 0h10l4 4v13H0z"/><path class="chrome" d="M3 8h6M3 12h7" stroke-width="1.4"/></g></g>`,
      `<g transform="translate(140 62)"><g class="cp-sheet k3"><path class="paper" d="M0 0h10l4 4v13H0z"/><path class="chrome" d="M3 8h8M3 12h4" stroke-width="1.4"/></g></g>`,
      `<g class="cp-ask"><path class="paper" d="M6 1h26a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H22l-3 5-3-5H6a6 6 0 0 1-6-6V7a6 6 0 0 1 6-6z"/><path class="accent" d="M8.5 9a3.5 3.5 0 1 1 4.9 3.2c-.9.5-1.4 1-1.4 2" stroke-width="2"/><circle class="accent-fill" cx="12" cy="18" r="1.2"/><g class="cp-yes"><circle class="ok-fill" cx="27" cy="12" r="6"/><path class="on-ok" d="M24 12l2.1 2.1 4-4.2" stroke-width="1.8"/></g></g>`,
    ].join(""),
  };
  const BOXES = { "memory-scribe": "0 0 240 150", "no-peek": "0 0 64 64", "connect-plug": "0 0 240 150" };

  function scene(name) {
    const body = SCENES[name] || SCENES.failed;
    return `<svg viewBox="${(SCENES[name] && BOXES[name]) || "0 0 120 80"}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  window.Icons = { install, svg, rig, playOnHover, play, scene, names: Object.keys(ICONS), rigs: Object.keys(PARTS), scenes: Object.keys(SCENES) };
})();
