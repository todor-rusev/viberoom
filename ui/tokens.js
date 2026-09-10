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
    lavGrey: "#3a4a3e", lilac: "#7ee0ff", seafoam: "#3ddc84", azure: "#5ab0ff", salmon: "#ff8578", magenta: "#ff7ab8",
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
    lavGrey: "#4a4b70", lilac: "#b9a7ff", seafoam: "#8fe3bd", azure: "#9cd2ff", salmon: "#ff9f9f", magenta: "#f2b8ff",
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
    lavGrey: "#c9c2b3", lilac: "#5b4a9a", seafoam: "#1f6e5a", azure: "#2a5d8f", salmon: "#a3472f", magenta: "#8a3f7a",
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

  const shape = {
    rScale: "1",
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

  const elementsOf = (p) => ({
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
      softBg: p.lav,
      softHoverBg: p.lav2,
      ghostInk: p.muted,
      ghostHoverBg: p.soft,
      dangerBg: p.rose,
      dangerInk: p.roseInk,
      dangerHoverBg: p.rose2,
      dangerSolidInk: p.white,
      dangerSolidHoverBg: p.roseDark,
      dangerSolidShadow: `0 8px 18px -8px ${alpha(p.roseInk, 0.8)}`,
      spinnerTrack: alpha(p.white, 0.5),
      spinnerHead: p.white,
      spinnerTrackQuiet: p.lav2,
      spinnerHeadQuiet: p.primary,
      disabledOpacity: "0.45",
      darkBg: alpha(p.white, 0.12),
      darkInk: p.white,
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
    },
    badge: {
      bg: p.lav,
      ink: p.primary,
      attentionBg: p.warm,
      attentionInk: p.warmInk,
      mutedBg: p.softer,
      mutedInk: p.muted,
      outlineBorder: p.lav2,
      outlineInk: p.muted,
      fsXs: "calc(10px * var(--fs-scale))",
    },
    chip: {
      bg: p.lav,
      ink: p.primary,
      hoverBg: p.lav2,
    },
    fileCard: {
      bg: p.deep,
      ink: p.deepInk,
      headBg: alpha(p.white, 0.06),
      headInk: p.deepHead,
      headMeta: p.deepMeta,
      noteInk: p.roseInk,
      imageBodyBg: alpha(p.white, 0.04),
      imageBg: p.white,
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
    },
    replyNote: {
      ink: p.muted,
      bg: p.soft,
      attentionInk: p.warmInk,
      attentionBg: p.warm,
      fs: "calc(12px * var(--fs-scale))",
    },
    lookCard: {
      w: "150px",
      paperH: "84px",
      bg: p.white,
      ink: p.ink,
      border: p.lav2,
      hoverBorder: p.periwinkleDeep,
      onBorder: p.primary,
    },
    choice: {
      bg: p.soft,
      ink: p.ink3,
      hoverBg: p.lav,
      onInk: p.primary,
      onBorder: p.primary,
      quietInk: p.muted,
      h: "32px",
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
      headBg: alpha(p.white, 0.06),
      headInk: p.deepHead,
      headMeta: p.deepMeta,
      headBtnBg: alpha(p.white, 0.12),
      headBtnInk: p.white,
      bodyBg: alpha(p.white, 0.04),
      sbTrack: alpha(p.black, 0.25),
      sbThumb: alpha(p.white, 0.3),
      sbThumbHover: alpha(p.white, 0.5),
      sbFirefox: alpha(p.white, 0.35),
      findHitBg: p.honey,
      findHitInk: p.deep,
    },
    syntax: {
      comment: p.muted,
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
      dotBg: p.faint,
      cardBg: p.white,
      fallback: p.grey,
      humanInk: p.indigo,
      avatarDefault: p.primary,
      avatarGloss: p.white,
      avatarLabelInk: p.white,
    },
    logoTile: {
      bg: p.white,
      ink: p.indigo,
      badgeBg: p.white,
      badgeBorder: p.white,
      badgeInk: p.indigo,
      mutedBg: p.warm,
      mutedInk: p.warmInk,
      sm: "30px",
      md: "36px",
      lg: "40px",
    },
    unseenLine: {
      ink: p.pink,
      bg: p.pinkTint,
      line: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='8' viewBox='0 0 16 8'><path d='M0 4 Q4 0 8 4 T16 4' fill='none' stroke='${p.pink.replace("#", "%23")}' stroke-width='1.6'/></svg>") repeat-x center / 16px 8px`,
      lineH: "8px",
      lineOpacity: "0.55",
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
      radius: "8px",
      bg: p.softer,
      ink: p.muted,
      hoverBg: p.primary,
      hoverInk: p.white,
      disabledOpacity: "0.4",
    },
    hubRow: {
      ink: p.muted,
      attentionInk: p.warmInk,
      errorInk: p.roseInk,
      actionBg: p.mint,
      actionInk: p.mintInk,
      actionHoverBg: p.mint2,
      faceSize: "18px",
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
  });

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
      }),
    }),
    plush: look("plush", "3D clayful", "light", plush, {
      shape: { rScale: "1.6" },
      canvas: (p) => ({
        gradCanvas: `radial-gradient(720px 480px at 100% 100%, ${alpha(p.ember, 0.14)}, transparent 70%), radial-gradient(640px 420px at 0% 0%, ${alpha(p.primaryLight, 0.16)}, transparent 70%), linear-gradient(165deg, ${p.canvasTop} 0%, ${p.canvasMid} 55%, ${p.canvasBottom} 100%)`,
        canvasPattern: "none",
        canvasPatternSize: "0 0",
      }),
      elevation: (() => {
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
        return {
          edge: panel, shadowTile: puff, shadowPop: panel, shadowPrimary: tinted, shadowDialog: frame,
          shadowInset: sunk, shadowCtl: sunk, shadowCtlHover: lifted, shadowCard: panel, shadowSoft: tinted,
          shadow: puff, shadow1: panel, shadow2: frame, shadowGlow: tinted,
          bevel: `linear-gradient(180deg, ${light(0.3)} 0%, ${light(0)} 45%)`,
          shadowRoom: "20px",
        };
      })(),
      elements: (p) => ({
        bubble: {
          shadow: `inset 0 2px 3px ${alpha(p.white, 0.95)}, inset 2px 0 2px -1px ${alpha(p.white, 0.6)}, inset 0 -6px 8px -2px ${alpha(p.shadowInk, 0.2)}, inset -2px 0 4px -2px ${alpha(p.shadowInk, 0.1)}, 0 2px 4px ${alpha(p.shadowInk, 0.12)}, 0 10px 18px -4px ${alpha(p.shadowInk, 0.26)}`,
          bg: p.soft,
          mineBg: p.primary,
          mineCtaInk: p.primaryDark,
          mineShadow: `inset 0 2px 3px ${alpha(p.white, 0.6)}, inset 2px 0 2px -1px ${alpha(p.white, 0.35)}, inset 0 -6px 8px -2px ${alpha(p.black, 0.16)}, inset -2px 0 4px -2px ${alpha(p.black, 0.06)}, 0 2px 4px ${alpha(p.shadowInk, 0.14)}, 0 10px 18px -4px ${alpha(p.shadowInk, 0.3)}`,
        },
        input: { shadow: `inset 0 3px 6px ${alpha(p.shadowInk, 0.18)}, inset 0 -1px 2px ${alpha(p.white, 0.8)}` },
        logoTile: { bg: p.soft, badgeBg: p.soft },
        face: { tint: "34%", corner: "0.2" },
        btn: { hoverInk: p.primaryDark }, iconButton: { hoverInk: p.primaryDark }, badge: { ink: p.primaryDark }, chip: { ink: p.primaryDark }, toolCall: { pendingInk: p.primaryDark }, toolFold: { hoverInk: p.primaryDark }, numberField: { stepHoverInk: p.primaryDark },
      }),
    }),
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
        bubble: { border: p.lav2, shadow: "none", mineShadow: "none" },
        unseenLine: { ink: p.muted, bg: p.soft, line: `repeating-linear-gradient(90deg, ${p.lav2} 0 6px, transparent 6px 12px)`, lineH: "1px", lineOpacity: "1" },
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
    { key: "mine", group: "Bubbles", label: "Your bubble", kind: "colour", of: (l) => l.palette.primary, vars: (v) => ({ "--bubble-mine-bg": v }) },
    { key: "ring", group: "Bubbles", label: "Bubble outline", hint: "a hairline around a reply; the bubble's own colour hides it", kind: "colour", of: (l) => hexOr(l.elements.bubble.border, l.elements.bubble.bg), vars: (v) => ({ "--bubble-border": v }) },
    { key: "ink", group: "Ink", label: "Words", kind: "colour", of: (l) => l.palette.ink, vars: (v) => ({ "--ink": v, "--ink-2": v, "--bubble-ink": v }) },
    { key: "muted", group: "Ink", label: "Quiet words", hint: "times, hints, labels", kind: "colour", of: (l) => l.palette.muted, vars: (v) => ({ "--muted": v, "--faint": v }) },
    { key: "accent", group: "Ink", label: "Accent", hint: "buttons, links, the ring on your face", kind: "colour", of: (l) => l.palette.primary, vars: (v) => ({ "--primary": v, "--grad-primary": `linear-gradient(135deg, ${v}, ${v})` }) },
    { key: "face", group: "Marks", label: "Face tile", hint: "the paper a face's colour is tinted into", kind: "colour", of: (l) => l.elements.face.paper, vars: (v) => ({ "--face-paper": v }) },
    { key: "logo", group: "Marks", label: "Logo tile", hint: "behind a vendor's mark", kind: "colour", of: (l) => l.elements.logoTile.bg, vars: (v) => ({ "--logo-tile-bg": v, "--logo-tile-badge-bg": v }) },
    { key: "logoInk", group: "Marks", label: "Logo ink", hint: "the mark itself", kind: "colour", of: (l) => l.elements.logoTile.ink, vars: (v) => ({ "--logo-tile-ink": v, "--logo-tile-badge-ink": v }) },
    { key: "corners", group: "Shape", label: "Corners", hint: "0 is square; every corner in the window scales with it", kind: "scale", min: 0, max: 1.5, step: 0.05, of: (l) => l.shape.rScale, vars: (v) => ({ "--r-scale": v }) },
  ];

  globalThis.VIBEROOM_TOKENS = { looks, current: looks.classic, active, diagrams, adjustables, cssGroups, cssVars, alpha, mix, kebab };
})();
