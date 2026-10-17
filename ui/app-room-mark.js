// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function hue(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const mark = root.VIBEROOM_TOKENS.active().elements.roomMark;
    const from = Number(mark.hueFrom);
    const span = Number(mark.hueSpan);
    const place = h % 360;
    if (!Number.isFinite(from) || !Number.isFinite(span) || span >= 360) return place;
    return Math.round(((from + (place * span) / 360) % 360 + 360) % 360);
  }
  function html({ id, name, emoji = "" }, size = "md") {
    const picture = root.Avatars.faceUrl(emoji);
    return root.UI.html("room-mark", { hue: hue(id), picture: picture || undefined, emoji: !picture && emoji ? emoji : undefined, letter: emoji ? undefined : String(name).trim()[0] || "?", size });
  }
  root.VIBEROOM_ROOM_MARK = Object.freeze({ hue, html });
})(typeof window !== "undefined" ? window : globalThis);
