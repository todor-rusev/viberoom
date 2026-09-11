// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";

  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return hex.length === 4
      ? [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17]
      : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const alpha = (hex, a) => `rgba(${rgb(hex).join(", ")}, ${a})`;
  const mix = (a, b, t) => {
    const [x, y, z] = rgb(a);
    const [i, j, k] = rgb(b);
    const at = (u, v) => Math.round(u + (v - u) * t);
    return `#${[at(x, i), at(y, j), at(z, k)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  };
  const NO_SHADOW = "0 0 0 0 transparent";

  const pop = {
    primary: "#5b5bf0",
    primaryLight: "#6a6af7",
    primaryDeep: "#4f4fe0",
    primaryDark: "#4343cc",
    violet: "#8b5cf6",
    iris: "#6d5dfc",
    ink: "#1c1b33",
    ink2: "#2c2b4a",
    ink3: "#5c5c80",
    indigo: "#1f1d3a",
    muted: "#8080a3",
    faint: "#b3b3cc",
    placeholder: "#a3a3c0",
    grey: "#9ca3af",
    white: "#ffffff",
    black: "#000000",
    bg: "#eef0fb",
    soft: "#f6f6fb",
    softer: "#f1f1f8",
    lav: "#eef0fb",
    lav2: "#e4e6fb",
    canvasTop: "#fdfdff",
    canvasMid: "#f7f7fe",
    canvasBottom: "#f0f1fd",
    shadowInk: "#322878",
    mint: "#d9f7e8",
    mint2: "#c4efdb",
    mintTint: "#e4f7ee",
    mintInk: "#1d8f6a",
    forest: "#14533f",
    green: "#2fc97e",
    warm: "#fff3cc",
    warm2: "#ffeaa8",
    warmInk: "#a07408",
    bronze: "#5a4200",
    amber: "#f5a524",
    honey: "#ffcf8f",
    spark: "#ffd166",
    peach: "#ffe3cc",
    peach2: "#ffe4d6",
    orange: "#ff8a3d",
    orangeLight: "#ff9447",
    orangeDeep: "#e8642a",
    orangeDark: "#c9461c",
    ember: "#ff7a45",
    emberDeep: "#f0452c",
    rose: "#fff0ee",
    rose2: "#ffe1dd",
    roseInk: "#e0554a",
    roseDark: "#c9463c",
    pink: "#be185d",
    pinkTint: "#fff1f7",
    sky: "#dcefff",
    blue: "#4f8ef7",
    blueDeep: "#2a6fbf",
    blueSoft: "#7aa7ff",
    orchid: "#f3e4fb",
    orchidInk: "#8a3fc2",
    orchidMid: "#b06be0",
    periwinkle: "#cdcdf9",
    periwinkleDeep: "#a9a9f5",
    deep: "#26244a",
    deepGutter: "#211f43",
    deepInk: "#f4f2ff",
    deepMuted: "#7c78ad",
    deepHead: "#e8e6ff",
    deepMeta: "#a9a5d8",
    lavGrey: "#c9c6ea",
    lilac: "#b9a7ff",
    seafoam: "#8fe3bd",
    azure: "#9cd2ff",
    salmon: "#ff9f9f",
    magenta: "#f2b8ff",
  };

  const terminal = {
    ...pop,
    primary: "#3ddc84", primaryLight: "#5ae69a", primaryDeep: "#2bc472", primaryDark: "#1fa85f",
    violet: "#7ee0ff",
    iris: "#0b0f0c",
    ink: "#d7e3d9", ink2: "#c3d1c6", ink3: "#9fb3a5", indigo: "#e6f0e8",
    muted: "#7c9282", faint: "#5b6f61", placeholder: "#5b6f61", grey: "#6f8276",
    white: "#0f1411", black: "#000000",
    bg: "#090c0a", soft: "#131a15", softer: "#10160f", lav: "#172019", lav2: "#1f2b22",
    canvasTop: "#0a0d0b", canvasMid: "#090c0a", canvasBottom: "#080a09",
    shadowInk: "#000000",
    mint: "#123a26", mint2: "#164a30", mintTint: "#0f2e1f", mintInk: "#3ddc84", forest: "#8fe3bd", green: "#3ddc84",
    warm: "#3a2f0c", warm2: "#4a3d10", warmInk: "#f5c542", bronze: "#ffe08a", amber: "#f5c542", honey: "#f5c542", spark: "#ffd166",
    peach: "#3a2414", peach2: "#4a2d18", orange: "#ff9a3d", orangeLight: "#ffab5c", orangeDeep: "#e8782a", orangeDark: "#ffb36b", ember: "#ff8a45", emberDeep: "#f0602c",
    rose: "#3a1512", rose2: "#4a1a16", roseInk: "#ff6b5e", roseDark: "#ff8578", pink: "#ff7ab8", pinkTint: "#2e1420",
    sky: "#0f2a3a", blue: "#5ab0ff", blueDeep: "#7cc0ff", blueSoft: "#8cc8ff",
    orchid: "#2a1a3a", orchidInk: "#c79bff", orchidMid: "#b58cf0",
    periwinkle: "#233126", periwinkleDeep: "#2f4234",
    deep: "#050705", deepGutter: "#0a0d0b", deepInk: "#d7e3d9", deepMuted: "#5b6f61", deepHead: "#c3d1c6", deepMeta: "#7c9282",
    lavGrey: "#5f7a67", lilac: "#7ee0ff", seafoam: "#3ddc84", azure: "#5ab0ff", salmon: "#ff8578", magenta: "#ff7ab8",
  };

  const classicDark = {
    ...pop,
    primary: "#8a8aff", primaryLight: "#9c9cff", primaryDeep: "#7474f7", primaryDark: "#6262e6",
    violet: "#b39cff",
    iris: "#202142",
    ink: "#f1efff", ink2: "#e0deff", ink3: "#c0bde6", indigo: "#f6f4ff",
    muted: "#a4a2cc", faint: "#8583b0", placeholder: "#7f7dab", grey: "#8e90b0",
    white: "#202142", black: "#000000",
    bg: "#0f1024", soft: "#262848", softer: "#232445", lav: "#2c2e56", lav2: "#3a3c6e",
    canvasTop: "#141530", canvasMid: "#111226", canvasBottom: "#0e0f21",
    shadowInk: "#000000",
    mint: "#1a4235", mint2: "#205241", mintTint: "#173a2f", mintInk: "#6ee8b3", forest: "#a8ecc9", green: "#4bdc98",
    warm: "#46381a", warm2: "#54441e", warmInk: "#f5c94f", bronze: "#ffe08a", amber: "#f5b73a", honey: "#f5c974", spark: "#ffd166",
    peach: "#3f2a1a", peach2: "#4a3020", orange: "#ff9a4d", orangeLight: "#ffab66", orangeDeep: "#f07c34", orangeDark: "#ffb36b", ember: "#ff8a55", emberDeep: "#f0603c",
    rose: "#401c1e", rose2: "#4d2325", roseInk: "#ff7a70", roseDark: "#ff8f86", pink: "#ff8ac4", pinkTint: "#351a2a",
    sky: "#1a2e46", blue: "#6aa4ff", blueDeep: "#8cb8ff", blueSoft: "#9fc4ff",
    orchid: "#2e2140", orchidInk: "#c9a3ff", orchidMid: "#b48cf0",
    periwinkle: "#34365c", periwinkleDeep: "#40437a",
    deep: "#0f1020", deepGutter: "#0b0c1a", deepInk: "#f4f2ff", deepMuted: "#7c78ad", deepHead: "#e8e6ff", deepMeta: "#a9a5d8",
    lavGrey: "#7c78ad", lilac: "#b9a7ff", seafoam: "#8fe3bd", azure: "#9cd2ff", salmon: "#ff9f9f", magenta: "#f2b8ff",
  };

  const clay = {
    ...pop,
    primary: "#d97757", primaryLight: "#e08a6d", primaryDeep: "#c4633f", primaryDark: "#a8502f",
    violet: "#9d76c4",
    iris: "#d97757",
    ink: "#1f1e1d", ink2: "#3d3929", ink3: "#5e5a4f", indigo: "#2a2622",
    muted: "#8a8577", faint: "#b3ada0", placeholder: "#a39e90", grey: "#9c988c",
    white: "#ffffff", black: "#000000",
    bg: "#f0eee6", soft: "#f7f5ef", softer: "#f3f0e8", lav: "#ebe7db", lav2: "#dfd9c8",
    canvasTop: "#faf9f5", canvasMid: "#f5f3ec", canvasBottom: "#efece3",
    shadowInk: "#4a3f2a",
    mint: "#dff0e1", mint2: "#cfe6d2", mintTint: "#e8f3e9", mintInk: "#2f7a4f", forest: "#1f5a3a", green: "#4caf77",
    warm: "#fbeecf", warm2: "#f6e2a8", warmInk: "#9a6b0f", bronze: "#5a4200", amber: "#d99a2b", honey: "#f2cc8f", spark: "#f0c96b",
    peach: "#fbe3d3", peach2: "#f8d9c4", orange: "#e67e3c", orangeLight: "#ee9256", orangeDeep: "#cf6a2c", orangeDark: "#a8502f", ember: "#e07a4d", emberDeep: "#c9553a",
    rose: "#f9e3df", rose2: "#f4d3cd", roseInk: "#c24d43", roseDark: "#a13d34", pink: "#b0356f", pinkTint: "#fbeef3",
    sky: "#e0ecf5", blue: "#4a7fb5", blueDeep: "#35618c", blueSoft: "#7ea6d0",
    orchid: "#ece3f2", orchidInk: "#7a4fa3", orchidMid: "#9d76c4",
    periwinkle: "#d8d4e6", periwinkleDeep: "#bdb7d6",
    deep: "#2b2622", deepGutter: "#241f1c", deepInk: "#f5f1e8", deepMuted: "#8c8477", deepHead: "#efe9dc", deepMeta: "#b8b0a0",
    lavGrey: "#cfc8b8", lilac: "#c3b1ff", seafoam: "#9ad8b6", azure: "#a9cbe8", salmon: "#f2a79a", magenta: "#e5b3e0",
  };

  const comfort = {
    ...pop,
    primary: "#2f6f68", primaryLight: "#3d7f78", primaryDeep: "#275e58", primaryDark: "#1f4d48",
    violet: "#5e6b8c",
    iris: "#2f6f68",
    ink: "#2b2a27", ink2: "#3a3833", ink3: "#5a574f", indigo: "#2b2a27",
    muted: "#6f6b62", faint: "#8d887c", placeholder: "#9a958a", grey: "#8f8b82",
    white: "#f9f6ef", black: "#000000",
    bg: "#efe9dd", soft: "#f4efe5", softer: "#f1ebe0", lav: "#e8e1d3", lav2: "#dcd3c2",
    canvasTop: "#f2ede3", canvasMid: "#efe9dd", canvasBottom: "#ebe4d6",
    shadowInk: "#4a4438",
    mint: "#e0ebe2", mint2: "#d1e2d5", mintTint: "#e8f0ea", mintInk: "#2f6b4f", forest: "#244f3c", green: "#4f9a72",
    warm: "#f4e9cf", warm2: "#ecdfb9", warmInk: "#7d5f12", bronze: "#5a4200", amber: "#c99a3c", honey: "#7d5f12", spark: "#c9a04f",
    peach: "#f3e2d3", peach2: "#efdac8", orange: "#c2703f", orangeLight: "#cd7f50", orangeDeep: "#a85c30", orangeDark: "#8a4a26", ember: "#b8623a", emberDeep: "#9c4a2a",
    rose: "#f2e0dc", rose2: "#ead2cc", roseInk: "#a34a3f", roseDark: "#8a3d34", pink: "#8f3d6a", pinkTint: "#f2e3ea",
    sky: "#dfe7ee", blue: "#3f6e9a", blueDeep: "#2f587d", blueSoft: "#6f93b8",
    orchid: "#e8e2ec", orchidInk: "#6b4f8c", orchidMid: "#8a6fa8",
    periwinkle: "#d9dbe6", periwinkleDeep: "#b9bdd0",
    deep: "#e9e3d6", deepGutter: "#e1dacb", deepInk: "#2b2a27", deepMuted: "#7a7468", deepHead: "#3a3833", deepMeta: "#6f6b62",
    lavGrey: "#7a7468", lilac: "#5b4a9a", seafoam: "#1f6e5a", azure: "#2a5d8f", salmon: "#a3472f", magenta: "#8a3f7a",
  };

  const plush = {
    ...pop,
    primary: "#917ad8", primaryLight: "#b4a2e6", primaryDeep: "#7f66cc", primaryDark: "#6a54b4",
    violet: "#c9b8f0",
    iris: "#917ad8",
    ink: "#5a3e36", ink2: "#634840", ink3: "#8a6f64", indigo: "#5a3e36",
    muted: "#8f7a6e", faint: "#b3a094", placeholder: "#b8a498", grey: "#b3a094",
    white: "#f9f0e1", black: "#000000",
    bg: "#f4e8ce", soft: "#fdf7ec", softer: "#f4e9d8", lav: "#f1e4d2", lav2: "#e8d7c1",
    canvasTop: "#fbf3e6", canvasMid: "#f7ecdd", canvasBottom: "#f1e5ec",
    shadowInk: "#7a5540",
    mint: "#c9e8c4", mint2: "#b4dfae", mintTint: "#dff1dc", mintInk: "#3f7a4a", forest: "#2f6038", green: "#6fcf7a",
    warm: "#fbe4a4", warm2: "#f7d774", warmInk: "#8a6a1c", bronze: "#5a4200", amber: "#f0c24a", honey: "#f7d774", spark: "#fbe07a",
    peach: "#f9dcc8", peach2: "#f5cbae", orange: "#f0a06a", orangeLight: "#f4b385", orangeDeep: "#e08a50", orangeDark: "#b8673a", ember: "#ec6f9d", emberDeep: "#d8598a",
    rose: "#f7c9d8", rose2: "#f2b3c9", roseInk: "#c2456f", roseDark: "#a63c64", pink: "#d85a8c", pinkTint: "#fbe3ec",
    sky: "#d5f0ec", blue: "#5fbdb3", blueDeep: "#33857c", blueSoft: "#8fd6cf",
    orchid: "#e6dff7", orchidInk: "#6a55b0", orchidMid: "#a893e2",
    periwinkle: "#ded5f3", periwinkleDeep: "#c5b8ea",
    deep: "#4a352e", deepGutter: "#3f2d27", deepInk: "#f9f1e4", deepMuted: "#a58f83", deepHead: "#f0e4d4", deepMeta: "#c2ada0",
    lavGrey: "#cdbfb0", lilac: "#c9b8f0", seafoam: "#8fd6cf", azure: "#9ccbe8", salmon: "#f4b385", magenta: "#f0a0c0",
  };

  const meaningOf = (p) => ({
    stReady: p.mint, stReadyInk: p.mintInk, stReadyDot: p.green,
    stWaiting: p.sky, stWaitingInk: p.blueDeep, stWaitingDot: p.blueSoft,
    stThinking: p.warm, stThinkingInk: p.warmInk, stThinkingDot: p.amber,
    stWriting: p.orchid, stWritingInk: p.orchidInk, stWritingDot: p.orchidMid,
    stError: p.rose, stErrorInk: p.roseInk, stErrorDot: p.roseInk,
    stAsleep: p.softer, stAsleepInk: p.muted, stAsleepDot: p.faint,
    attention: p.orange,
    attentionInk: p.orangeDark,
    attentionGrad: `linear-gradient(135deg, ${p.orangeLight}, ${p.orangeDeep})`,
    attentionShadow: `0 8px 18px -10px ${alpha(p.orangeDeep, 0.7)}`,
    unreadGrad: `linear-gradient(135deg, ${p.ember}, ${p.emberDeep})`,
    noteHover: p.warm2,
    done: p.mint,
    doneInk: p.mintInk,
    doneHover: p.mint2,
    tickMine: p.periwinkle,
    tickMineView: p.periwinkleDeep,
    tickFallback: p.grey,
  });

  const aliasesOf = (p) => ({
    gradPrimary: `linear-gradient(135deg, ${p.primaryLight}, ${p.primaryDeep})`,
    panel: p.white,
    card: p.white,
    primarySoft: p.lav,
    primarySofter: p.soft,
    primaryGhost: alpha(p.primary, 0.1),
    mintSoft: p.mint,
    warn: p.amber,
    warnSoft: p.warm,
    danger: p.roseInk,
    dangerSoft: p.rose,
    dangerDark: p.roseDark,
    info: p.blue,
    infoSoft: p.sky,
    muted2: p.faint,
    panelSoft: p.soft,
    panelTint: p.soft,
    border: p.lav,
    borderStrong: p.lav2,
    mine: `linear-gradient(135deg, ${p.primaryLight}, ${p.primaryDeep})`,
    mineBorder: "transparent",
    text: p.ink,
    ok: p.green,
  });

  const elevationOf = (p) => {
    const edge = `0 2px 0 ${alpha(p.ink, 0.04)}`;
    const tile = `0 4px 12px -4px ${alpha(p.ink, 0.15)}`;
    const dialog = `0 30px 60px -30px ${alpha(p.shadowInk, 0.4)}`;
    const primary = `0 8px 18px -8px ${alpha(p.primary, 0.8)}`;
    return {
      edge,
      shadowTile: tile,
      shadowPop: `0 10px 24px -10px ${alpha(p.ink, 0.25)}`,
      shadowPrimary: primary,
      shadowDialog: dialog,
      shadow1: edge,
      shadow2: dialog,
      shadowCard: edge,
      shadowCtl: "none",
      shadowCtlHover: tile,
      shadowGlow: primary,
      shadowInset: "none",
      shadowSoft: edge,
      shadow: edge,
      bevel: "none",
      shadowRoom: "0px",
      bevelPressed: "none",
    };
  };

  const canvasOf = (p) => ({
    gradCanvas: `radial-gradient(900px 520px at 100% 100%, ${alpha(p.primary, 0.06)}, transparent 70%), radial-gradient(640px 380px at 0% 0%, ${alpha(p.green, 0.04)}, transparent 70%), linear-gradient(165deg, ${p.canvasTop} 0%, ${p.canvasMid} 55%, ${p.canvasBottom} 100%)`,
    canvasPattern: `radial-gradient(circle at 1px 1px, ${alpha(p.primary, 0.13)} 0.9px, transparent 1.6px)`,
    canvasPatternSize: "22px 22px",
    gradPage: p.bg,
    sbW: "8px",
    sbThumb: alpha(p.primary, 0.22),
    sbThumbHover: alpha(p.primary, 0.45),
  });

  const fonts = {
    text: {
      nunito: { label: "Nunito (default)", stack: '"Nunito", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      inter: { label: "Inter", stack: '"Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      "noto-sans": { label: "Noto Sans", stack: '"Noto Sans", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      "open-sans": { label: "Open Sans", stack: '"Open Sans", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      "source-sans-3": { label: "Source Sans 3", stack: '"Source Sans 3", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      "ibm-plex-sans": { label: "IBM Plex Sans", stack: '"IBM Plex Sans", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      manrope: { label: "Manrope", stack: '"Manrope", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      rubik: { label: "Rubik", stack: '"Rubik", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      montserrat: { label: "Montserrat", stack: '"Montserrat", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      "golos-text": { label: "Golos Text", stack: '"Golos Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      "exo-2": { label: "Exo 2", stack: '"Exo 2", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      comfortaa: { label: "Comfortaa", stack: '"Comfortaa", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      "ubuntu-sans": { label: "Ubuntu Sans", stack: '"Ubuntu Sans", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      arial: { label: "Arial / Helvetica (system)", stack: 'Arial, Helvetica, "Liberation Sans", sans-serif' },
      system: { label: "System UI font", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Cantarell, sans-serif' },
    },
    mono: {
      "jetbrains-mono": { label: "JetBrains Mono (default)", stack: '"JetBrains Mono", ui-monospace, Consolas, Menlo, "DejaVu Sans Mono", monospace' },
      "fira-code": { label: "Fira Code", stack: '"Fira Code", ui-monospace, Consolas, Menlo, "DejaVu Sans Mono", monospace' },
      "source-code-pro": { label: "Source Code Pro", stack: '"Source Code Pro", ui-monospace, Consolas, Menlo, "DejaVu Sans Mono", monospace' },
      "ibm-plex-mono": { label: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, Consolas, Menlo, "DejaVu Sans Mono", monospace' },
      "pt-mono": { label: "PT Mono", stack: '"PT Mono", ui-monospace, Consolas, Menlo, "DejaVu Sans Mono", monospace' },
      "victor-mono": { label: "Victor Mono", stack: '"Victor Mono", ui-monospace, Consolas, Menlo, "DejaVu Sans Mono", monospace' },
      "anonymous-pro": { label: "Anonymous Pro", stack: '"Anonymous Pro", ui-monospace, Consolas, Menlo, "DejaVu Sans Mono", monospace' },
      "cascadia-code": { label: "Cascadia Code", stack: '"Cascadia Code", ui-monospace, Consolas, Menlo, "DejaVu Sans Mono", monospace' },
      system: { label: "System monospace", stack: 'ui-monospace, Consolas, Menlo, "DejaVu Sans Mono", "Courier New", monospace' },
    },
  };

  const shape = {
    rScale: "1",
    rCtlMin: "0px",
    rXs: "calc(8px * var(--r-scale))", rSm: "calc(12px * var(--r-scale))", rMd: "calc(14px * var(--r-scale))", rLg: "calc(18px * var(--r-scale))", rXl: "calc(18px * var(--r-scale))", rPill: "calc(99px * var(--r-scale))",
  };
  const type = {
    font: '"Nunito", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, Consolas, "Courier New", monospace',
    lineHeight: "1.45",
    fsScale: "1",
    fsXs: "calc(11px * var(--fs-scale))",
    fsSm: "calc(12px * var(--fs-scale))",
    fsMd: "calc(14px * var(--fs-scale))",
    fsLg: "calc(16px * var(--fs-scale))",
    fsXl: "calc(18px * var(--fs-scale))",
    fs2xl: "calc(22px * var(--fs-scale))",
  };
  const motion = {
    tFast: "120ms", tBase: "200ms", tSlow: "320ms",
    easeOut: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    easePop: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  };

  const elementsOf = (p) => {
    const dangerSolid = `0 8px 18px -8px ${alpha(p.roseInk, 0.8)}`;
    return {
    page: {
      bg: p.bg,
      ink: p.ink,
      selection: p.lav2,
    },
    focus: {
      ring: alpha(p.primary, 0.35),
    },
    link: {
      ink: p.primary,
      underline: alpha(p.primary, 0.35),
    },
    btn: {
      bg: p.softer,
      ink: p.ink3,
      hoverBg: p.lav,
      hoverInk: p.primary,
      onPrimary: p.white,
      secondaryBg: p.white,
      secondaryHoverBg: p.white,
      softBg: p.lav,
      softHoverBg: p.lav2,
      ghostInk: p.muted,
      ghostHoverBg: p.soft,
      dangerBg: p.rose,
      dangerInk: p.roseInk,
      dangerHoverBg: p.rose2,
      dangerSolidInk: p.white,
      dangerSolidHoverBg: p.roseDark,
      dangerSolidShadow: dangerSolid,
      spinnerTrack: alpha(p.white, 0.5),
      spinnerHead: p.white,
      spinnerTrackQuiet: p.lav2,
      spinnerHeadQuiet: p.primary,
      disabledOpacity: "0.45",
      darkBg: alpha(p.deepInk, 0.12),
      darkInk: p.deepInk,
      darkHoverBg: p.primary,
      warnInk: p.warmInk,
      warnHoverBg: p.warm,
      inverseBg: alpha(p.white, 0.92),
      inverseInk: p.orangeDark,
      inverseHoverBg: p.white,
      linkInk: p.primary,
      okBg: p.mint,
      okInk: p.mintInk,
      okHoverBg: p.mint2,
      paperBg: p.white,
      paperInk: p.ink3,
      paperHoverBg: p.soft,
      border: "0",
      case: "none",
      tracking: "0px",
      linkUnderline: "none",
      ghostBg: "transparent",
      shadow: "none",
      hoverShadow: "none",
      hoverLift: "0px",
      activeShadow: "none",
      primaryActiveShadow: "var(--shadow-primary)",
      primaryHoverFilter: "brightness(1.05)",
      secondaryHoverShadow: "var(--shadow-tile)",
      secondaryActiveShadow: "var(--shadow-tile)",
      dangerSolidHoverShadow: dangerSolid,
      dangerSolidActiveShadow: dangerSolid,
      okShadow: "none",
      warnShadow: "none",
      h: "42px",
      hSm: "34px",
      hXs: "24px",
      hLg: "48px",
      hCta: "46px",
      fs: "calc(13px * var(--fs-scale))",
      fsSm: "calc(12px * var(--fs-scale))",
      fsLg: "calc(15px * var(--fs-scale))",
      fsCta: "calc(14px * var(--fs-scale))",
    },
    iconButton: {
      ink: p.muted,
      hoverBg: p.soft,
      hoverInk: p.primary,
      disabledOpacity: "0.4",
      size: "36px",
      icon: "18px",
      sizeSm: "30px",
      iconSm: "16px",
      sizeXs: "18px",
      iconXs: "12px",
      sizePrimary: "44px",
      ghostInk: p.faint,
      hoverBgStrong: p.primary,
      inlineBg: p.lav2,
      inlineInk: p.ink3,
      inlineOnBg: alpha(p.primary, 0.1),
      inlineOnInk: p.primary,
      ghostBg: "transparent",
      shadow: "none",
      hoverShadow: "none",
      hoverLift: "0px",
      activeShadow: "none",
      primaryShadow: "var(--shadow-primary)",
      primaryHoverShadow: "var(--shadow-primary)",
      primaryActiveShadow: "var(--shadow-primary)",
    },
    badge: {
      bg: p.lav,
      ink: p.primary,
      attentionBg: p.warm,
      attentionInk: p.warmInk,
      mutedBg: p.softer,
      mutedInk: p.muted,
      outlineBorder: p.lav2,
      outlineW: "2px",
      outlineInk: p.muted,
      fsXs: "calc(10px * var(--fs-scale))",
      fill: "100%",
      border: "0",
      case: "none",
      tracking: "0px",
      shadow: "none",
    },
    chip: {
      bg: p.lav,
      ink: p.primary,
      hoverBg: p.lav2,
      fill: "100%",
      border: "0",
      shadow: "none",
      hoverShadow: "none",
      hoverLift: "0px",
      activeShadow: "none",
      activeDrop: "0px",
    },
    fileCard: {
      bg: p.deep,
      ink: p.deepInk,
      headBg: alpha(p.deepInk, 0.06),
      headInk: p.deepHead,
      headMeta: p.deepMeta,
      noteInk: p.roseInk,
      imageBodyBg: alpha(p.deepInk, 0.04),
      imageBg: p.white,
      shadow: "var(--edge)",
    },
    toolCall: {
      readyBg: p.mint,
      readyInk: p.mintInk,
      errorBg: p.rose,
      errorInk: p.roseInk,
      thinkingBg: p.warm,
      thinkingInk: p.warmInk,
      pendingBg: p.lav,
      pendingInk: p.primary,
      bodyBg: p.white,
      preBg: p.soft,
      preInk: p.ink,
      quietInk: p.muted,
      fs: "calc(12px * var(--fs-scale))",
      preFs: "calc(11.5px * var(--fs-scale))",
      labelFs: "calc(10.5px * var(--fs-scale))",
    },
    toolFold: {
      ink: p.muted,
      bg: p.soft,
      hoverBg: p.lav,
      hoverInk: p.primary,
      failedInk: p.roseInk,
      fs: "calc(11px * var(--fs-scale))",
      shadow: "none",
    },
    askCard: {
      bg: p.warm,
      ink: p.ink,
      quietInk: p.muted,
      resolvedOpacity: "0.7",
      fs: "calc(13px * var(--fs-scale))",
      kindFs: "calc(11px * var(--fs-scale))",
      inputFs: "calc(11px * var(--fs-scale))",
      outcomeFs: "calc(12px * var(--fs-scale))",
      shadow: "none",
    },
    replyNote: {
      ink: p.muted,
      bg: p.soft,
      attentionInk: p.warmInk,
      attentionBg: p.warm,
      fs: "calc(12px * var(--fs-scale))",
    },
    loginDialog: {
      ink: p.ink,
      quietInk: p.muted,
      fs: "calc(13.5px * var(--fs-scale))",
      border: p.lav2,
      sceneBg: p.soft,
      sceneInk: p.ink,
      sceneMuted: p.lav2,
      scenePaper: p.white,
      sceneAccent: p.primary,
      sceneDark: p.indigo,
      sceneOnDark: p.white,
      okBg: p.mintTint,
      okInk: p.mintInk,
      badBg: p.rose,
      badInk: p.roseInk,
      stepBg: p.primary,
      stepInk: p.white,
      codeBg: p.white,
      codeInk: p.ink,
      codeBorder: p.lav2,
      inputBg: p.white,
      inputBorder: p.lav2,
      linesBg: p.soft,
      linesInk: p.muted,
      geekInk: p.primary,
    },
    lookCard: {
      w: "150px",
      paperH: "84px",
      bg: p.white,
      ink: p.ink,
      border: p.lav2,
      hoverBorder: p.periwinkleDeep,
      onBorder: p.primary,
      shadow: "none",
    },
    choice: {
      bg: p.soft,
      ink: p.ink3,
      hoverBg: p.lav,
      onInk: p.primary,
      onBorder: p.primary,
      quietInk: p.muted,
      h: "32px",
      border: "transparent",
      shadow: "none",
      hoverShadow: "none",
      hoverLift: "0px",
      activeShadow: "none",
      activeDrop: "0px",
      onShadow: "none",
    },
    control: {
      knob: p.white,
      knobShadow: `0 1px 3px ${alpha(p.ink, 0.25)}`,
      boxBg: p.white,
      tick: p.white,
    },
    tile: {
      badgeBg: p.white,
      countInk: p.white,
    },
    roomMark: {
      ink: p.white,
      gradAngle: "135deg",
      gradFrom: "72% 66%",
      gradTo: "68% 52%",
      emoji: "70% 93%",
      shadow: "none",
      radius: "calc(14px * var(--r-scale))",
      radiusLg: "calc(16px * var(--r-scale))",
      radiusRail: "calc(13px * var(--r-scale))",
    },
    pop: {
      bg: p.white,
      shadow: `0 10px 28px -12px ${alpha(p.ink, 0.45)}`,
      arrowShadow: `3px 3px 4px -3px ${alpha(p.ink, 0.25)}`,
      darkBg: p.ink2,
      darkInk: p.white,
      darkShadow: `0 6px 16px -6px ${alpha(p.ink, 0.6)}`,
    },
    dialog: {
      backdrop: alpha(p.ink, 0.4),
    },
    scrim: {
      bg: alpha(p.ink, 0.72),
      shadow: `0 24px 60px -20px ${alpha(p.black, 0.6)}`,
      imageBg: p.white,
    },
    toast: {
      bg: p.ink,
      ink: p.white,
    },
    rail: {
      logoShadow: `0 8px 18px -6px ${alpha(p.primary, 0.6)}`,
      activeBg: p.white,
    },
    timeline: {
      viewBg: alpha(p.primary, 0.07),
      viewLeftBg: alpha(p.ink, 0.05),
      tickBlend: p.white,
      pinHalo: p.white,
      flash: alpha(p.primary, 0.55),
      flashOut: alpha(p.primary, 0),
    },
    bubble: {
      bg: p.white,
      ink: p.ink2,
      border: "transparent",
      shadow: `0 2px 0 ${alpha(p.ink, 0.06)}, 0 1px 3px ${alpha(p.ink, 0.04)}`,
      mineBg: `linear-gradient(135deg, ${p.primaryLight}, ${p.primaryDeep})`,
      mineInk: p.white,
      mineSoftInk: alpha(p.white, 0.85),
      mineWaitingInk: alpha(p.white, 0.92),
      mineShadow: `0 8px 18px -10px ${alpha(p.primary, 0.7)}`,
      mineRule: alpha(p.white, 0.35),
      mineBorder: alpha(p.white, 0.35),
      mineChipBg: alpha(p.white, 0.22),
      mineCodeBg: alpha(p.white, 0.18),
      mineThBg: alpha(p.white, 0.18),
      mineLinkUnderline: alpha(p.white, 0.5),
      mineQuoteBorder: alpha(p.white, 0.5),
      mineBtnBg: alpha(p.white, 0.92),
      mineBtnHoverBg: p.white,
      mineGhostHoverBg: alpha(p.white, 0.18),
      mineCtaBg: p.white,
      mineCtaInk: p.primary,
      insetBg: p.white,
      propRowBg: alpha(p.white, 0.6),
    },
    quote: {
      mineBg: alpha(p.white, 0.16),
      mineBorder: alpha(p.white, 0.55),
      mineHoverBg: alpha(p.white, 0.26),
      mineHoverBorder: p.white,
      mineHeadInk: alpha(p.white, 0.85),
      mineTextInk: p.white,
    },
    attach: {
      thumbBg: p.white,
      thumbShadow: `0 1px 3px ${alpha(p.ink, 0.16)}`,
      overlayBg: alpha(p.ink, 0.72),
      overlayInk: p.white,
      refBg: alpha(p.ink, 0.1),
      mineRefBg: alpha(p.white, 0.24),
      mineChipOpenBg: alpha(p.white, 0.42),
      mineChipOpenInk: p.ink,
    },
    table: {
      stripe: alpha(p.primary, 0.03),
    },
    code: {
      bg: p.deep,
      ink: p.deepInk,
      gutterBg: p.deepGutter,
      gutterInk: p.deepMuted,
      lineMarkInk: p.honey,
      lineMarkBg: alpha(p.honey, 0.16),
      headBg: alpha(p.deepInk, 0.06),
      headInk: p.deepHead,
      headMeta: p.deepMeta,
      headBtnBg: alpha(p.deepInk, 0.12),
      headBtnInk: p.deepInk,
      bodyBg: alpha(p.deepInk, 0.04),
      sbTrack: alpha(p.black, 0.25),
      sbThumb: alpha(p.deepInk, 0.3),
      sbThumbHover: alpha(p.deepInk, 0.5),
      sbFirefox: alpha(p.deepInk, 0.35),
      findHitBg: p.honey,
      findHitInk: p.deep,
    },
    syntax: {
      comment: p.deepMuted,
      punctuation: p.lavGrey,
      keyword: p.lilac,
      string: p.seafoam,
      number: p.honey,
      function: p.azure,
      tag: p.salmon,
      attr: p.magenta,
    },
    diagram: {
      barBg: p.white,
      barShadow: `0 12px 30px -12px ${alpha(p.black, 0.55)}`,
      nodeShadow: alpha(p.ink, 0.1),
      nodeInk: p.ink,
    },
    input: {
      bg: p.white,
      focusBorder: p.primary,
      shadow: "none",
    },
    profile: {
      bg: `linear-gradient(160deg, ${p.lav}, ${p.mintTint})`,
      badgeBg: p.white,
    },
    face: {
      paper: p.white,
      tint: "16%",
      corner: "0.32",
      ring: p.white,
      meRing: p.primary,
      alertRing: p.orange,
      dotBg: p.faint,
      cardBg: p.white,
      fallback: p.grey,
      humanInk: p.indigo,
      avatarDefault: p.primary,
      avatarGloss: p.white,
      avatarLabelInk: p.white,
      shadow: NO_SHADOW,
      cardShadow: "var(--shadow-pop)",
    },
    logoTile: {
      bg: p.white,
      ink: p.indigo,
      badgeBg: p.white,
      badgeBorder: p.white,
      badgeInk: p.indigo,
      mutedBg: p.warm,
      mutedInk: p.warmInk,
      unpluggedBg: p.lav,
      unpluggedInk: p.indigo,
      sm: "30px",
      md: "36px",
      lg: "40px",
      shadow: "var(--shadow-tile)",
      radius: "calc(12px * var(--r-scale))",
      radiusSm: "calc(10px * var(--r-scale))",
      radiusLg: "calc(13px * var(--r-scale))",
      radiusBadge: "calc(6px * var(--r-scale))",
    },
    unseenLine: {
      ink: p.pink,
      bg: p.pinkTint,
      line: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='8' viewBox='0 0 16 8'><path d='M0 4 Q4 0 8 4 T16 4' fill='none' stroke='${p.pink.replace("#", "%23")}' stroke-width='1.6'/></svg>") repeat-x center / 16px 8px`,
      lineH: "8px",
      lineOpacity: "0.55",
      labelBorder: "0",
      labelCase: "none",
      labelTracking: "0px",
      labelShadow: "none",
    },
    numberField: {
      stepW: "22px",
      stepInk: p.muted,
      stepHoverBg: p.lav,
      stepHoverInk: p.primary,
    },
    adjustRow: {
      swatchBorder: p.lav2,
      valueInk: p.muted,
      hintInk: p.muted,
      changedInk: p.primary,
      backInk: p.muted,
      backHoverBg: p.lav,
    },
    rowButton: {
      size: "24px",
      icon: "14px",
      radius: "calc(8px * var(--r-scale))",
      bg: p.softer,
      ink: p.muted,
      hoverBg: p.primary,
      hoverInk: p.white,
      disabledOpacity: "0.4",
      shadow: "none",
      activeShadow: "none",
    },
    hubRow: {
      ink: p.muted,
      attentionInk: p.warmInk,
      errorInk: p.roseInk,
      actionBg: p.mint,
      actionInk: p.mintInk,
      actionHoverBg: p.mint2,
      faceSize: "18px",
      prefix: "none",
      prefixGap: "0px",
      actionShadow: "var(--edge)",
    },
    hero: {
      ink: p.white,
      bg: `linear-gradient(120deg, ${p.primaryLight} 0%, ${p.primary} 45%, ${p.violet} 100%)`,
      shadow: `0 18px 40px -22px ${alpha(p.primary, 0.9)}`,
      blobA: alpha(p.white, 0.1),
      blobB: alpha(p.green, 0.18),
      ctaBg: p.white,
      ctaShadow: `0 10px 22px -10px ${alpha(p.ink, 0.5)}`,
      ghostBg: alpha(p.white, 0.16),
      ghostHoverBg: alpha(p.white, 0.26),
      faceBg: alpha(p.white, 0.55),
      bubbleShadow: `0 10px 24px -14px ${alpha(p.ink, 0.6)}`,
      bubble1Bg: p.white,
      bubble2Bg: p.mint,
      bubble2Ink: p.forest,
      bubble3Bg: p.warm,
      bubble3Ink: p.bronze,
      spark: p.spark,
    },
    feature: {
      emojiBg: alpha(p.white, 0.8),
      peachBg: p.peach2,
      shadow: "var(--edge)",
    },
    composer: {
      shadow: "none",
      bg: "transparent",
      radius: "0px",
      padX: "0px",
    },
    step: {
      bg: p.white,
      numInk: p.white,
    },
    tpl: {
      shadow: `0 1px 3px ${alpha(p.ink, 0.06)}`,
      checkInk: p.white,
    },
    browser: {
      themeColor: p.iris,
    },
    };
  };

  const popNodes = [
    { fill: "#e4e6fb", stroke: "#5b5bf0" },
    { fill: "#d9f7e8", stroke: "#1d8f6a" },
    { fill: "#fff3cc", stroke: "#b8860b" },
    { fill: "#ffe4d6", stroke: "#d2691e" },
    { fill: "#ffe3ec", stroke: "#d6336c" },
    { fill: "#dcefff", stroke: "#2a6fbf" },
    { fill: "#f1e3fb", stroke: "#8a3fb8" },
  ];
  const diagrams = {
    customBoxDefault: "#ece9ff",
    presets: {
      pop: { label: "Pop", palette: popNodes, primaryColor: "#e4e6fb", primaryBorderColor: "#5b5bf0", primaryTextColor: "#1c1b33", lineColor: "#8f8fb0", secondaryColor: "#d9f7e8", secondaryBorderColor: "#1d8f6a", tertiaryColor: "#fff3cc", tertiaryBorderColor: "#b8860b", textColor: "#1c1b33", clusterBkg: "#f8f8fd", clusterBorder: "#d9dbf5", edgeLabelBackground: "#ffffff", noteBkgColor: "#fff3cc", noteBorderColor: "#b8860b" },
      lavender: { label: "Lavender", primaryColor: "#ece9ff", primaryBorderColor: "#6d5dfc", primaryTextColor: "#24223d", lineColor: "#5a4be0", secondaryColor: "#e3f8f2", secondaryBorderColor: "#39c6a3", tertiaryColor: "#fff4d6", tertiaryBorderColor: "#f5a524", textColor: "#24223d", clusterBkg: "#f7f6fc", clusterBorder: "#d6d1f5", edgeLabelBackground: "#ffffff" },
      mint: { label: "Mint", primaryColor: "#e3f8f2", primaryBorderColor: "#39c6a3", primaryTextColor: "#0f3d33", lineColor: "#2a9d84", secondaryColor: "#ece9ff", secondaryBorderColor: "#6d5dfc", tertiaryColor: "#fff4d6", tertiaryBorderColor: "#f5a524", textColor: "#1b3a33", clusterBkg: "#f3fbf8", clusterBorder: "#b4ecdc", edgeLabelBackground: "#ffffff" },
      sunset: { label: "Sunset", primaryColor: "#ffe9d6", primaryBorderColor: "#f5a524", primaryTextColor: "#4a2b00", lineColor: "#d97706", secondaryColor: "#ffe9ec", secondaryBorderColor: "#ef5b6b", tertiaryColor: "#ece9ff", tertiaryBorderColor: "#6d5dfc", textColor: "#3b2a1a", clusterBkg: "#fff8f0", clusterBorder: "#fde1c2", edgeLabelBackground: "#ffffff" },
      slate: { label: "Slate", primaryColor: "#e9edf3", primaryBorderColor: "#64748b", primaryTextColor: "#1e293b", lineColor: "#475569", secondaryColor: "#f1f5f9", secondaryBorderColor: "#94a3b8", tertiaryColor: "#e2e8f0", tertiaryBorderColor: "#64748b", textColor: "#1e293b", clusterBkg: "#f8fafc", clusterBorder: "#cbd5e1", edgeLabelBackground: "#ffffff" },
    },
  };

  const look = (id, label, scheme, palette, wants = {}) => {
    const elements = elementsOf(palette);
    for (const [group, parts] of Object.entries(wants.elements ? wants.elements(palette) : {})) elements[group] = { ...(elements[group] || {}), ...parts };
    return {
      id,
      label,
      scheme,
      palette,
      meaning: meaningOf(palette),
      aliases: aliasesOf(palette),
      elevation: { ...elevationOf(palette), ...(wants.elevation || {}) },
      canvas: { ...canvasOf(palette), ...(wants.canvas ? wants.canvas(palette) : {}) },
      shape: { ...shape, ...(wants.shape || {}) },
      type: { ...type, ...(wants.type || {}) },
      motion: { ...motion, ...(wants.motion || {}) },
      elements,
      wants,
      custom: false,
    };
  };

  const flat = Object.fromEntries(Object.keys(elevationOf(pop)).map((key) => [key, "none"]));

  const looks = {
    classic: look("classic", "VibeClassic", "light", pop),
    "classic-dark": look("classic-dark", "VibeClassic Dark", "dark", classicDark, {
      elements: (p) => ({ logoTile: { bg: p.lav, ink: p.ink, badgeBg: p.lav, badgeInk: p.ink }, bubble: { border: mix(p.white, p.ink, 0.14) } }),
    }),
    clay: look("clay", "Clay", "light", clay, {
      type: { font: '"Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif' },
      canvas: (p) => ({ gradCanvas: p.bg, canvasPattern: "none", canvasPatternSize: "0 0" }),
      elements: (p) => ({ btn: { hoverInk: p.primaryDeep }, iconButton: { hoverInk: p.primaryDeep }, badge: { ink: p.primaryDeep }, chip: { ink: p.primaryDeep }, toolCall: { pendingInk: p.primaryDeep }, toolFold: { hoverInk: p.primaryDeep }, numberField: { stepHoverInk: p.primaryDeep } }),
    }),
    comfort: look("comfort", "Eye Comfort", "light", comfort, {
      type: { font: '"Open Sans", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif', lineHeight: "1.6" },
      canvas: (p) => ({ gradCanvas: p.bg, canvasPattern: "none", canvasPatternSize: "0 0" }),
      elevation: { shadowPrimary: "none", shadowGlow: "none" },
      elements: (p) => ({
        code: { headBg: alpha(p.ink, 0.04), headBtnBg: alpha(p.ink, 0.08), headBtnInk: p.ink, bodyBg: alpha(p.ink, 0.02), sbTrack: alpha(p.ink, 0.06), sbThumb: alpha(p.ink, 0.3) },
        bubble: { mineBg: `linear-gradient(135deg, ${p.primaryLight}, ${p.primaryDeep})`, shadow: `0 1px 2px ${alpha(p.ink, 0.06)}`, mineShadow: "none" },
        logoTile: { bg: p.white, ink: p.ink },
        btn: { darkHoverBg: p.lav2 },
      }),
    }),
    plush: (() => {
      const p = plush;
      const warm = (a) => alpha(p.shadowInk, a);
      const light = (a) => alpha(p.white, a);
      const dark = (a) => alpha(p.black, a);
      const puff = `inset 0 1.5px 2px ${light(0.95)}, inset 1px 0 1px ${light(0.5)}, inset 0 -4px 5px -2px ${warm(0.2)}, inset -1px 0 2px -1px ${warm(0.08)}, 0 0 0 1px ${warm(0.07)}, 0 1px 2px ${warm(0.14)}, 0 6px 12px -4px ${warm(0.3)}`;
      const tinted = `inset 0 1.5px 2px ${light(0.6)}, inset 1px 0 1px ${light(0.35)}, inset 0 -4px 5px -2px ${dark(0.16)}, inset -1px 0 2px -1px ${dark(0.06)}, 0 0 0 1px ${warm(0.08)}, 0 1px 2px ${warm(0.16)}, 0 6px 12px -4px ${warm(0.32)}`;
      const panel = `inset 0 2px 4px ${light(0.95)}, inset 0 -8px 12px -3px ${warm(0.18)}, inset 2px 0 3px -1px ${light(0.5)}, 0 3px 6px ${warm(0.1)}, 0 16px 32px -8px ${warm(0.28)}`;
      const frame = `inset 0 2px 4px ${light(0.95)}, inset 0 -10px 14px -4px ${warm(0.2)}, 0 6px 10px ${warm(0.12)}, 0 30px 60px -16px ${warm(0.4)}`;
      const sunk = `inset 0 3px 6px ${warm(0.18)}, inset 0 -1px 2px ${light(0.8)}`;
      const lifted = `inset 0 1.5px 2px ${light(0.95)}, inset 1px 0 1px ${light(0.5)}, inset 0 -4px 5px -2px ${warm(0.2)}, inset -1px 0 2px -1px ${warm(0.08)}, 0 0 0 1px ${warm(0.07)}, 0 2px 4px ${warm(0.16)}, 0 10px 18px -5px ${warm(0.34)}`;
      return look("plush", "3D clayful", "light", plush, {
        shape: { rScale: "1.6", rCtlMin: "var(--r-pill)" },
        canvas: (p) => ({
          gradCanvas: `radial-gradient(720px 480px at 100% 100%, ${alpha(p.ember, 0.14)}, transparent 70%), radial-gradient(640px 420px at 0% 0%, ${alpha(p.primaryLight, 0.16)}, transparent 70%), linear-gradient(165deg, ${p.canvasTop} 0%, ${p.canvasMid} 55%, ${p.canvasBottom} 100%)`,
          canvasPattern: "none",
          canvasPatternSize: "0 0",
        }),
        elevation: {
          edge: panel, shadowTile: puff, shadowPop: panel, shadowPrimary: tinted, shadowDialog: frame,
          shadowInset: sunk, shadowCtl: sunk, shadowCtlHover: lifted, shadowCard: panel, shadowSoft: tinted,
          shadow: puff, shadow1: panel, shadow2: frame, shadowGlow: tinted,
          bevel: `linear-gradient(180deg, ${light(0.3)} 0%, ${light(0)} 45%)`,
          shadowRoom: "20px",
        },
        elements: (p) => ({
          bubble: {
            shadow: `inset 0 2px 3px ${alpha(p.white, 0.95)}, inset 2px 0 2px -1px ${alpha(p.white, 0.6)}, inset 0 -6px 8px -2px ${alpha(p.shadowInk, 0.2)}, inset -2px 0 4px -2px ${alpha(p.shadowInk, 0.1)}, 0 2px 4px ${alpha(p.shadowInk, 0.12)}, 0 10px 18px -4px ${alpha(p.shadowInk, 0.26)}`,
            bg: p.soft,
            mineBg: `linear-gradient(${p.primary}, ${p.primary})`,
            mineCtaInk: p.primaryDark,
            mineShadow: `inset 0 2px 3px ${alpha(p.white, 0.6)}, inset 2px 0 2px -1px ${alpha(p.white, 0.35)}, inset 0 -6px 8px -2px ${alpha(p.black, 0.16)}, inset -2px 0 4px -2px ${alpha(p.black, 0.06)}, 0 2px 4px ${alpha(p.shadowInk, 0.14)}, 0 10px 18px -4px ${alpha(p.shadowInk, 0.3)}`,
          },
          input: { shadow: sunk },
          composer: { shadow: sunk, bg: p.softer, radius: "calc(14px * var(--r-scale))", padX: "12px" },
          logoTile: { bg: p.soft, badgeBg: p.soft, shadow: puff, radius: "calc(8px * var(--r-scale))", radiusSm: "calc(7px * var(--r-scale))", radiusLg: "calc(9px * var(--r-scale))", radiusBadge: "calc(8px * var(--r-scale))" },
          face: { tint: "34%", corner: "0.2", shadow: tinted, cardShadow: tinted },
          btn: {
            hoverInk: p.primaryDark,
            shadow: puff, hoverShadow: lifted, hoverLift: "-1px", activeShadow: sunk,
            primaryActiveShadow: sunk, primaryHoverFilter: "none",
            secondaryHoverShadow: lifted, secondaryActiveShadow: sunk,
            dangerSolidShadow: tinted, dangerSolidHoverShadow: lifted, dangerSolidActiveShadow: sunk,
            okShadow: tinted, warnShadow: tinted,
            ghostBg: p.softer, softBg: p.softer, secondaryBg: p.softer, paperBg: p.softer,
          },
          iconButton: { hoverInk: p.primaryDark, ghostInk: p.muted, shadow: puff, hoverShadow: lifted, hoverLift: "-1px", activeShadow: sunk, primaryShadow: puff, primaryHoverShadow: lifted, primaryActiveShadow: sunk, ghostBg: p.softer },
          rowButton: { shadow: puff, activeShadow: sunk, radius: "8px" },
          badge: { ink: p.primaryDark, shadow: tinted },
          chip: { ink: p.primaryDark, shadow: tinted, hoverShadow: lifted, hoverLift: "-1px", activeShadow: sunk, activeDrop: "1px" },
          choice: { shadow: tinted, hoverShadow: lifted, hoverLift: "-1px", activeShadow: sunk, activeDrop: "1px", onShadow: sunk },
          hubRow: { actionShadow: tinted },
          unseenLine: { labelShadow: tinted },
          lookCard: { shadow: puff },
          fileCard: { shadow: puff },
          askCard: { shadow: puff },
          toolFold: { hoverInk: p.primaryDark, shadow: puff },
          roomMark: { shadow: tinted, radius: "calc(10px * var(--r-scale))", radiusLg: "calc(12px * var(--r-scale))", radiusRail: "calc(10px * var(--r-scale))" },
          feature: { shadow: panel },
          toolCall: { pendingInk: p.primaryDark }, numberField: { stepHoverInk: p.primaryDark },
        }),
      });
    })(),
    terminal: look("terminal", "Terminal", "dark", terminal, {
      shape: { rScale: "0" },
      type: { font: type.mono },
      motion: { tFast: "0ms", tBase: "0ms", tSlow: "0ms" },
      elevation: flat,
      canvas: (p) => ({ gradCanvas: p.bg, canvasPattern: "none", canvasPatternSize: "0 0" }),
      elements: (p) => ({
        roomMark: { ink: p.ink, gradFrom: "38% 24%", gradTo: "34% 18%", emoji: "35% 20%" },
        tile: { badgeBg: p.lav2 },
        logoTile: { bg: p.lav2, ink: p.primary, badgeBg: p.lav2, badgeBorder: p.lav2, badgeInk: p.primary },
        bubble: { border: p.lav2, shadow: NO_SHADOW, mineShadow: NO_SHADOW },
        btn: { border: "1px solid currentColor", case: "uppercase", tracking: "0.06em", linkUnderline: "underline" },
        badge: { fill: "0%", border: "1px solid currentColor", case: "uppercase", tracking: "0.04em", outlineBorder: "currentColor", outlineW: "1px" },
        chip: { fill: "0%", border: "1px solid currentColor" },
        choice: { border: "currentColor", onBorder: "currentColor" },
        hubRow: { prefix: '">"', prefixGap: "6px" },
        unseenLine: { ink: p.muted, bg: "transparent", line: `repeating-linear-gradient(90deg, ${p.lav2} 0 6px, transparent 6px 12px)`, lineH: "1px", lineOpacity: "1", labelBorder: "1px solid currentColor", labelCase: "uppercase", labelTracking: "0.04em" },
      }),
    }),
  };

  const FLAT = ["palette", "meaning", "aliases", "elevation", "canvas", "shape", "type", "motion"];
  const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-zA-Z])(\d)/g, "$1-$2").toLowerCase();

  function cssGroups(theme) {
    const seen = new Set();
    const entry = (name, value) => {
      if (seen.has(name)) throw new Error(`two tokens claim ${name}`);
      seen.add(name);
      return [name, String(value)];
    };
    const groups = FLAT.map((section) => ({
      title: section,
      entries: Object.entries(theme[section] || {}).map(([key, value]) => entry(`--${kebab(key)}`, value)),
    }));
    for (const [group, parts] of Object.entries(theme.elements)) {
      groups.push({ title: `element: ${kebab(group)}`, entries: Object.entries(parts).map(([key, value]) => entry(`--${kebab(group)}-${kebab(key)}`, value)) });
    }
    return groups;
  }

  function cssVars(theme) {
    return Object.fromEntries(cssGroups(theme).flatMap((g) => g.entries));
  }

  const active = () => looks[globalThis.document?.documentElement?.dataset?.look] || looks.classic;

  const toHsl = (hex) => {
    const [r, g, b] = rgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  };
  const fromHsl = (h, s, l) => {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  };
  const deepFill = (hex) => { const [h, s] = toHsl(hex); return fromHsl(h, s < 0.1 ? 0 : Math.min(0.45, Math.max(0.25, s)), 0.24); };
  const litLine = (hex) => { const [h, s, l] = toHsl(hex); return fromHsl(h, s, Math.max(l, 0.62)); };
  const DIAGRAM_FILLS = ["primaryColor", "secondaryColor", "tertiaryColor", "clusterBkg", "noteBkgColor", "edgeLabelBackground"];
  const DIAGRAM_INKS = ["primaryTextColor", "textColor"];
  const DIAGRAM_LINES = ["lineColor"];
  diagrams.forScheme = (preset, scheme, ink) => {
    if (scheme !== "dark") return preset;
    const out = { ...preset };
    for (const key of DIAGRAM_FILLS) if (out[key]) out[key] = deepFill(out[key]);
    for (const key of DIAGRAM_INKS) if (out[key]) out[key] = ink;
    for (const key of DIAGRAM_LINES) if (out[key]) out[key] = litLine(out[key]);
    if (out.palette) out.palette = out.palette.map((c) => ({ fill: deepFill(c.fill), stroke: litLine(c.stroke) }));
    return out;
  };

  const hexOr = (value, fallback) => (/^#[0-9a-f]{6}$/i.test(value) ? value : fallback);
  const adjustables = [
    { key: "canvas", group: "Paper", label: "Chat paper", hint: "behind the messages", kind: "colour", of: (l) => l.palette.bg, vars: (v) => ({ "--grad-canvas": v, "--grad-page": v, "--canvas-pattern": "none" }) },
    { key: "panel", group: "Paper", label: "Panels", hint: "the rooms, the roster, the chat's frame, a vibemate's panel", kind: "colour", of: (l) => l.aliases.panel, vars: (v) => ({ "--panel": v }) },
    { key: "bubble", group: "Bubbles", label: "Reply bubble", kind: "colour", of: (l) => l.elements.bubble.bg, vars: (v) => ({ "--bubble-bg": v }) },
    { key: "mine", group: "Bubbles", label: "Your bubble", kind: "colour", of: (l) => l.palette.primary, vars: (v) => ({ "--bubble-mine-bg": `linear-gradient(${v}, ${v})` }) },
    { key: "ring", group: "Bubbles", label: "Bubble outline", hint: "a hairline around a reply; the bubble's own colour hides it", kind: "colour", of: (l) => hexOr(l.elements.bubble.border, l.elements.bubble.bg), vars: (v) => ({ "--bubble-border": v }) },
    { key: "ink", group: "Ink", label: "Words", kind: "colour", of: (l) => l.palette.ink, vars: (v) => ({ "--ink": v, "--ink-2": v, "--bubble-ink": v }) },
    { key: "muted", group: "Ink", label: "Quiet words", hint: "times, hints, labels", kind: "colour", of: (l) => l.palette.muted, vars: (v) => ({ "--muted": v, "--faint": v }) },
    { key: "accent", group: "Ink", label: "Accent", hint: "buttons, links, the ring on your face", kind: "colour", of: (l) => l.palette.primary, vars: (v) => ({ "--primary": v, "--grad-primary": `linear-gradient(135deg, ${v}, ${v})` }) },
    { key: "face", group: "Marks", label: "Face tile", hint: "the paper a face's colour is tinted into", kind: "colour", of: (l) => l.elements.face.paper, vars: (v) => ({ "--face-paper": v }) },
    { key: "logo", group: "Marks", label: "Logo tile", hint: "behind a vendor's mark", kind: "colour", of: (l) => l.elements.logoTile.bg, vars: (v) => ({ "--logo-tile-bg": v, "--logo-tile-badge-bg": v }) },
    { key: "logoInk", group: "Marks", label: "Logo ink", hint: "the mark itself", kind: "colour", of: (l) => l.elements.logoTile.ink, vars: (v) => ({ "--logo-tile-ink": v, "--logo-tile-badge-ink": v }) },
    { key: "corners", group: "Shape", label: "Corners", hint: "0 is square; every corner in the window scales with it", kind: "scale", min: 0, max: 1.5, step: 0.05, of: (l) => l.shape.rScale, vars: (v) => ({ "--r-scale": v }) },
  ];


  const SPEC_ID = /^[a-z][a-z0-9-]{0,30}$/;
  const HEX6 = /^#[0-9a-f]{6}$/i;
  const COLOUR_VALUE = /^(#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\([\d\s.,%]+\)|transparent|currentColor)$/i;
  const UNSAFE = /url\(|expression\(|javascript:|[<>{};\\@]/i;
  const FONT_STACK = /^[\w\s"',.-]+$/;
  const isColourDefault = (v) => COLOUR_VALUE.test(String(v).trim());

  const hueOf = (token, palette, where) => {
    const t = String(token).trim();
    if (t.startsWith("$")) {
      const name = t.slice(1);
      if (!(name in palette)) throw new Error(`${where}: no hue "${name}" in the palette`);
      return palette[name];
    }
    if (HEX6.test(t)) return t.toLowerCase();
    throw new Error(`${where}: "${t}" is neither a hue of the palette ($name) nor a colour (#rrggbb)`);
  };
  const numberIn = (token, where, min, max) => {
    const n = Number(String(token).trim());
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${where}: "${token}" is not a number between ${min} and ${max}`);
    return n;
  };
  const resolveValue = (raw, palette, where) => {
    if (typeof raw !== "string") throw new Error(`${where}: a value is a string`);
    const v = raw.trim();
    if (!v) throw new Error(`${where}: an empty value`);
    if (v.length > 400) throw new Error(`${where}: a value is at most 400 characters`);
    if (UNSAFE.test(v)) throw new Error(`${where}: a value may not carry url(), expression(), javascript: or < > { } ; \\ @`);
    const out = v
      .replace(/\b(alpha|mix)\(([^()]*)\)/g, (m, fn, args) => {
        const parts = args.split(",").map((s) => s.trim());
        if (fn === "alpha") {
          if (parts.length !== 2) throw new Error(`${where}: alpha takes a hue and a number: alpha($ink, 0.2)`);
          return alpha(hueOf(parts[0], palette, where), numberIn(parts[1], where, 0, 1));
        }
        if (parts.length !== 3) throw new Error(`${where}: mix takes two hues and a number: mix($white, $ink, 0.5)`);
        return mix(hueOf(parts[0], palette, where), hueOf(parts[1], palette, where), numberIn(parts[2], where, 0, 1));
      })
      .replace(/\$([a-zA-Z][a-zA-Z0-9]*)/g, (m, name) => hueOf(`$${name}`, palette, where));
    if (/\$/.test(out)) throw new Error(`${where}: a stray $ (a hue is $name)`);
    return out;
  };
  const checked = (defaultValue, value, where) => {
    if (isColourDefault(defaultValue) && !COLOUR_VALUE.test(value)) throw new Error(`${where}: a colour (the look has ${defaultValue}), not "${value}"`);
    return value;
  };
  const flatSection = (spec, section, defaults, baseWants, palette) => {
    const out = { ...(baseWants || {}) };
    for (const [key, raw] of Object.entries(spec || {})) {
      if (!(key in defaults)) throw new Error(`${section}.${key}: no such token (${Object.keys(defaults).join(", ")})`);
      out[key] = checked(defaults[key], resolveValue(raw, palette, `${section}.${key}`), `${section}.${key}`);
    }
    return out;
  };

  function make(spec) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("a look spec is an object");
    const id = String(spec.id ?? "").trim();
    if (!SPEC_ID.test(id)) throw new Error("id: a short lower-case id of letters, digits and hyphens (1-31), starting with a letter");
    if (looks[id] && !looks[id].custom) throw new Error(`id "${id}" belongs to a look viberoom ships; pick another`);
    const label = String(spec.label ?? "").trim();
    if (!label || label.length > 40) throw new Error("label: 1-40 characters, the name the picker shows");
    const baseId = spec.extends === undefined || spec.extends === null || spec.extends === "" ? "classic" : String(spec.extends);
    const base = looks[baseId];
    if (!base) throw new Error(`extends: no look "${baseId}" (${Object.keys(looks).filter((k) => !looks[k].custom).join(", ")})`);
    if (base.custom) throw new Error(`extends: "${baseId}" is a look of the human's own; a look extends one viberoom ships`);
    const scheme = spec.scheme === undefined || spec.scheme === null || spec.scheme === "" ? base.scheme : String(spec.scheme);
    if (scheme !== "light" && scheme !== "dark") throw new Error('scheme: "light" or "dark"');
    for (const key of Object.keys(spec)) {
      if (!["id", "label", "scheme", "extends", "author", "created", "updatedAt", "palette", "shape", "type", "motion", "elevation", "canvas", "elements"].includes(key)) throw new Error(`${key}: not a part of a look spec`);
    }
    const section = (name) => {
      const v = spec[name];
      if (v === undefined || v === null) return {};
      if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${name}: an object of keys and values`);
      return v;
    };
    const palette = { ...base.palette };
    for (const [name, raw] of Object.entries(section("palette"))) {
      if (!(name in palette)) throw new Error(`palette.${name}: no such hue (${Object.keys(palette).join(", ")})`);
      const v = resolveValue(raw, palette, `palette.${name}`);
      if (!HEX6.test(v)) throw new Error(`palette.${name}: a hue is a flat colour #rrggbb, not "${v}"`);
      palette[name] = v.toLowerCase();
    }
    const baseWants = base.wants || {};
    const typeWants = { ...(baseWants.type || {}) };
    for (const [key, raw] of Object.entries(section("type"))) {
      if (!(key in type)) throw new Error(`type.${key}: no such token (${Object.keys(type).join(", ")})`);
      const v = resolveValue(raw, palette, `type.${key}`);
      if (key === "font" || key === "mono") {
        const table = key === "font" ? fonts.text : fonts.mono;
        if (table[v]) typeWants[key] = table[v].stack;
        else if (FONT_STACK.test(v)) typeWants[key] = v;
        else throw new Error(`type.${key}: a font id (${Object.keys(table).join(", ")}) or a family stack`);
      } else typeWants[key] = v;
    }
    const specCanvas = section("canvas");
    const specElements = section("elements");
    const wants = {
      shape: flatSection(section("shape"), "shape", shape, baseWants.shape, palette),
      type: typeWants,
      motion: flatSection(section("motion"), "motion", motion, baseWants.motion, palette),
      elevation: flatSection(section("elevation"), "elevation", elevationOf(palette), baseWants.elevation, palette),
      canvas: (p) => flatSection(specCanvas, "canvas", canvasOf(p), baseWants.canvas ? baseWants.canvas(p) : {}, p),
      elements: (p) => {
        const defaults = elementsOf(p);
        const out = {};
        const fromBase = baseWants.elements ? baseWants.elements(p) : {};
        for (const [group, parts] of Object.entries(fromBase)) out[group] = { ...parts };
        for (const [group, parts] of Object.entries(specElements)) {
          if (!(group in defaults)) throw new Error(`elements.${group}: no such element (${Object.keys(defaults).join(", ")})`);
          if (!parts || typeof parts !== "object" || Array.isArray(parts)) throw new Error(`elements.${group}: an object of keys and values`);
          out[group] = { ...(out[group] || {}) };
          for (const [key, raw] of Object.entries(parts)) {
            if (!(key in defaults[group])) throw new Error(`elements.${group}.${key}: no such token (${Object.keys(defaults[group]).join(", ")})`);
            out[group][key] = checked(defaults[group][key], resolveValue(raw, p, `elements.${group}.${key}`), `elements.${group}.${key}`);
          }
        }
        return out;
      },
    };
    const made = look(id, label, scheme, palette, wants);
    made.custom = true;
    made.extends = base.id;
    made.author = spec.author === undefined || spec.author === null ? "" : String(spec.author).slice(0, 40);
    return made;
  }

  const docs = {
    sections: {
      palette: "the hues of the look, named after what they look like, never after what they are for; every element is derived from them, so a hue changed here reaches every place that wears it",
      shape: "corners: rScale multiplies every radius in the window (0 square, 1 as designed, 1.6 very round); rCtlMin is the least radius of a button, an icon button or a chip (0px keeps each one's own, 99px makes every control a pill); rXs…rPill are the named radii, each ONE length or calc() (they are used inside calc() and max(), so a multi-corner value breaks every corner)",
      type: "text: font and mono are the family stacks (in a spec: an id from fonts, or a stack), lineHeight the running text's, fsScale multiplies every text size, fsXs…fs2xl are the named sizes",
      motion: "the durations (tFast, tBase, tSlow; 0ms for none) and easings of the transitions",
      elevation: "the shadows and the light: edge (a hair under a panel), shadowTile (a raised tile), shadowPop (a floating balloon), shadowPrimary (the glow under the accent), shadowDialog, shadowCard, shadowCtl and shadowCtlHover (a control at rest and under the pointer), shadowInset (a sunken thing), shadowSoft (a small raised thing), shadow / shadow1 / shadow2 (older names), bevel (a light laid over a raised surface: a gradient, or none), bevelPressed (the same when pressed), shadowRoom (room around a message for its shadow, 0px unless the shadows reach out)",
      canvas: "the chat's paper: gradCanvas (the paint behind the messages: a colour, or gradients), canvasPattern and canvasPatternSize (a pattern over it, or none / 0 0), gradPage (the paper behind the panels), sbW / sbThumb / sbThumbHover (the scrollbar)",
      elements: "every UI element and what it wears: the group is the element, the key the part (bg, ink, hoverBg, border, shadow, radius…); a key ending in Ink is written on the key of the same stem ending in Bg (or on bg), and the pair must read at 3:1 or better; a key whose value is none / 0px / transparent is structure a look may switch on (a border, a shadow, a lift, capitals)",
    },
    palette: {
      primary: "the one accent: buttons, links, your bubble, the ring on your face",
      primaryLight: "the accent a step lighter (the start of its gradient)",
      primaryDeep: "the accent a step deeper (the end of its gradient)",
      primaryDark: "the accent's darkest step: the accent as an ink on its own tint",
      violet: "the far end of the welcome hero's sweep",
      iris: "the colour the browser paints its own window frame with",
      ink: "the words",
      ink2: "the words in a bubble",
      ink3: "quieter words: a button's, labels",
      indigo: "the human's initials on their face; a vendor's mark",
      muted: "quiet words: times, hints",
      faint: "the faintest words and dots",
      placeholder: "a field's placeholder",
      grey: "a face with no colour of its own",
      white: "the paper of panels, cards and bubbles (on a dark look: the dark paper)",
      black: "black, for shadows cast in black",
      bg: "the paper behind everything",
      soft: "the paper a step off the panel's: fields, tiles",
      softer: "the paper two steps off: buttons at rest",
      lav: "the accent's tint: tiles, chips, hover",
      lav2: "the accent's deeper tint: borders, a pressed chip",
      canvasTop: "the chat paper's sweep, top",
      canvasMid: "the chat paper's sweep, middle",
      canvasBottom: "the chat paper's sweep, bottom",
      shadowInk: "the colour shadows are cast in",
      mint: "green, pale: done, ready",
      mint2: "green, pale, a step deeper: hover on a green thing",
      mintTint: "green, the faintest tint",
      mintInk: "green as an ink on the pale green",
      forest: "green, dark: words on the hero's green bubble",
      green: "green, bright: the ready dot",
      warm: "yellow, pale: thinking, attention, a note",
      warm2: "yellow, pale, a step deeper: hover on a note",
      warmInk: "yellow as an ink on the pale yellow",
      bronze: "yellow, dark: words on the hero's yellow bubble",
      amber: "amber, bright: the thinking dot, a warning",
      honey: "honey: the number and the found line in code",
      spark: "the spark on the hero",
      peach: "peach, pale: a welcome tile",
      peach2: "peach, pale, a step deeper",
      orange: "orange: attention",
      orangeLight: "orange, light: the attention gradient's start",
      orangeDeep: "orange, deep: the attention gradient's end",
      orangeDark: "orange, dark: the attention ink",
      ember: "ember: unread, a glow",
      emberDeep: "ember, deep: the unread gradient's end",
      rose: "red, pale: an error, a danger button",
      rose2: "red, pale, a step deeper: hover on a danger button",
      roseInk: "red as an ink: errors, the danger ink, a failed call",
      roseDark: "red, dark: a solid danger button pressed",
      pink: "pink: the unseen line",
      pinkTint: "pink, the faintest tint: the unseen line's label",
      sky: "blue, pale: waiting, info",
      blue: "blue: info",
      blueDeep: "blue, deep: the waiting ink",
      blueSoft: "blue, soft: the waiting dot",
      orchid: "violet, pale: writing",
      orchidInk: "violet as an ink: the writing ink",
      orchidMid: "violet, mid: the writing dot",
      periwinkle: "periwinkle: your ticks on the timeline",
      periwinkleDeep: "periwinkle, deep: your ticks in view",
      deep: "the dark surface of code blocks and the file viewer",
      deepGutter: "the gutter of the dark surface",
      deepInk: "the words on the dark surface",
      deepMuted: "the quiet words on the dark surface",
      deepHead: "the head of the dark surface",
      deepMeta: "the meta words in that head",
      lavGrey: "code: punctuation",
      lilac: "code: keywords",
      seafoam: "code: strings",
      azure: "code: functions",
      salmon: "code: tags",
      magenta: "code: attributes",
    },
    elements: {
      page: "the page itself: its paper, its ink, the selection",
      focus: "the ring around whatever the keyboard is on",
      link: "a path or a link inside a message",
      btn: "button: a button with words; the colours of every kind (primary, secondary, soft, ghost, danger, danger-solid, dark, warn, inverse, link, ok, paper), its sizes, and its structure (border: width style colour; case; tracking; ghostBg; the shadows at rest / on hover / pressed; hoverLift: negative lifts)",
      iconButton: "icon-button: a button that is only a glyph; kinds primary, danger, ghost, inline; its sizes and structure (ghostBg, shadows, hoverLift)",
      badge: "badge: a small label that states a fact; the state tones come from the room's meaning colours; fill (100% filled, 0% an outline in its ink), border, case, tracking, shadow",
      chip: "chip: a small tag that names a thing; fill, border, shadow, hoverLift, activeDrop",
      fileCard: "file-card: a fragment of a file or a picture under the message that names it (the dark card)",
      toolCall: "tool-call: a chip that opens to the call; the status colours",
      toolFold: "tool-fold: the calls of a finished reply, in one line",
      askCard: "ask-card: a decision the room puts in front of you (a permission, a proposal)",
      replyNote: "reply-note: a line the hub attaches to a reply, inside its bubble",
      loginDialog: "login-dialog and login-scene: a vendor's sign-in or install in one modal (the scene's paper, ink, accent and dark; done in green, failed in rose; the code, the answer field, the vendor's lines)",
      lookCard: "look-card: a look as a small picture of itself (the picker)",
      choice: "choice: one option of a few, as a pill; border, shadows, hoverLift, activeDrop",
      control: "switches and checkboxes",
      tile: "the small marks that are not types yet: the ? badge of the life ring, the count pills",
      roomMark: "room-mark: a room's square mark in its own hue (ink, the recipe of the gradient, shadow, radius / radiusLg / radiusRail)",
      pop: "the little speech balloons the rail and the participants raise",
      dialog: "the glass behind a dialog",
      scrim: "the dark glass behind a picture or a diagram",
      toast: "a toast: the ink with the paper's colour on it",
      rail: "the main menu",
      timeline: "the strips beside the chat",
      bubble: "the message balloon: everyone else's (bg, ink, border, shadow) and your own (mineBg: always an image, a flat colour as linear-gradient(c, c); mineInk, mineShadow and the parts inside it)",
      quote: "a quoted message inside a balloon",
      attach: "pictures and file chips in a message",
      table: "a table in a message",
      code: "the file viewer and every code block",
      syntax: "the colours of the code itself",
      diagram: "a mermaid diagram opened full screen",
      input: "text fields (bg, focusBorder, shadow: none, or a sunken recipe)",
      profile: "the human's own card",
      face: "face: a participant's face (paper and tint of the tile, corner, rings — me, and alert while it needs you —, shadow, cardShadow)",
      logoTile: "logo-tile: a vendor's mark on a tile (bg, ink, the badge in a face's corner, the unplugged mark, shadow, radius / radiusSm / radiusLg / radiusBadge)",
      unseenLine: "unseen-line: the line above which a vibemate has seen nothing (ink, bg, the line's drawing, the label's border / case / tracking / shadow)",
      numberField: "number-field: a number with its own steps",
      adjustRow: "adjust-row: one thing the human may adjust in a look, in Settings",
      rowButton: "row-button: a small action on a vibemate's row",
      hubRow: "hub-row: a line the hub writes (ink, tones, the one that leads somewhere: actionBg / actionShadow; prefix / prefixGap: what stands before the line, none or a prompt)",
      hero: "the welcome screen's hero",
      feature: "the welcome screen's feature tiles (emojiBg, shadow)",
      composer: "the box you write in (shadow, bg, radius, padX: flat and bare, or sunk into the paper)",
      step: "the welcome screen's numbered steps",
      tpl: "the template list in Open a room",
      browser: "the colour the browser paints its window frame with",
    },
  };

  const KIND_SYNTAX = {
    border: 'a CSS border: width, style and colour, e.g. "2px solid $ink" (a width alone draws nothing); 0 for none',
    shadow: 'a CSS box-shadow list, e.g. "3px 4px 0 $ink" or "0 2px 6px alpha($ink, 0.2)", or none',
    radius: "ONE length or calc(), e.g. \"calc(14px * var(--r-scale))\": the named radii are used inside calc() and max(), so a multi-corner value (four lengths, or a slash) breaks every corner",
    lift: 'a length the thing moves on hover: NEGATIVE lifts it ("-2px"), positive pushes it down; 0px for none',
    drop: 'a length the thing sinks when pressed ("1px"); 0px for none',
    fill: 'a percentage of the tone\'s colour: "100%" filled, "0%" an outline in the ink',
    prefix: 'a quoted string written before the line, e.g. "\">\"", or none',
    case: "none, uppercase, lowercase or capitalize",
    tracking: 'a letter-spacing length, e.g. "0.06em" or 0px',
    scale: 'a number as a string ("1", "0.5", "1.6")',
    length: 'a CSS length, e.g. "12px"',
    gradient: "a CSS gradient image (linear-gradient / radial-gradient), a flat colour, or none",
    bevel: "a gradient image laid over a raised face, or none",
    font: "a font id from fonts (text or mono), or a family stack",
  };
  const kindOf = (section, key, value) => {
    const v = String(value);
    if (COLOUR_VALUE.test(v)) return "colour";
    if (section === "shape") return key === "rScale" ? "scale" : "radius";
    if (section === "type") return key === "font" || key === "mono" ? "font" : /^fs/.test(key) ? "length" : "scale";
    if (section === "elevation") return /^bevel/.test(key) ? "bevel" : key === "shadowRoom" ? "length" : "shadow";
    if (section === "canvas") return /^grad|Pattern$/.test(key) ? "gradient" : "length";
    if (/[Rr]adius/.test(key)) return "radius";
    if (/[Ss]hadow$/.test(key)) return "shadow";
    if (key === "border" || /Border$/.test(key)) return "border";
    if (/Lift$/.test(key)) return "lift";
    if (/Drop$/.test(key)) return "drop";
    if (key === "fill") return "fill";
    if (key === "prefix") return "prefix";
    if (key === "case" || /Case$/.test(key)) return "case";
    if (/[Tt]racking$/.test(key)) return "tracking";
    if (/Bg$|^bg$|Ink$|^ink$|Color$/.test(key) || /gradient\(/.test(v)) return "gradient";
    return null;
  };

  function describe() {
    const l = looks.classic;
    const keysOf = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
    const kinds = {};
    const structural = (kind) => kind && kind !== "colour" && kind !== "gradient";
    for (const section of ["shape", "type", "elevation", "canvas"]) for (const [k, v] of Object.entries(l[section])) { const kind = kindOf(section, k, v); if (structural(kind)) kinds[`${section}.${k}`] = kind; }
    for (const [g, parts] of Object.entries(l.elements)) for (const [k, v] of Object.entries(parts)) { const kind = kindOf("elements", k, v); if (structural(kind)) kinds[`elements.${g}.${k}`] = kind; }
    return {
      syntax: "A look spec is { id, label, scheme?, extends?, palette?, shape?, type?, motion?, elevation?, canvas?, elements? }. It extends one of the looks viberoom ships (VibeClassic unless said) and changes only the keys it gives. A value is a string: a colour \"#1a2b3c\"; \"$name\" for a hue of the palette; \"alpha($ink, 0.14)\" for a hue at an alpha; \"mix($white, $ink, 0.5)\" for a blend; anything else (a shadow, a size, a gradient, a font) as CSS, with those forms inside it. A key the look does not have is refused; a colour key takes only a colour; no url(), no braces.",
      sections: docs.sections,
      palette: Object.fromEntries(Object.keys(l.palette).map((n) => [n, { doc: docs.palette[n] || "", classic: l.palette[n] }])),
      shape: keysOf(l.shape),
      type: keysOf(l.type),
      motion: keysOf(l.motion),
      elevation: keysOf(l.elevation),
      canvas: keysOf(l.canvas),
      elements: Object.fromEntries(Object.entries(l.elements).map(([g, parts]) => [g, { doc: docs.elements[g] || "", keys: keysOf(parts) }])),
      kinds,
      kindSyntax: KIND_SYNTAX,
      fonts: { text: Object.keys(fonts.text), mono: Object.keys(fonts.mono) },
      looks: Object.values(looks).map((x) => ({ id: x.id, label: x.label, scheme: x.scheme, custom: !!x.custom, extends: x.extends || null })),
      adjustables: adjustables.map((a) => ({ key: a.key, group: a.group, label: a.label, hint: a.hint || "", kind: a.kind, min: a.min, max: a.max, step: a.step })),
    };
  }

  globalThis.VIBEROOM_TOKENS = { looks, current: looks.classic, active, diagrams, adjustables, cssGroups, cssVars, alpha, mix, kebab, fonts, make, describe, docs, kindOf };
})();
