// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function create(scale) {
    if (!Number.isFinite(scale) || scale <= 0) throw new RangeError("A positive layout scale is required");
    const length = (value) => value / scale;
    const fromRect = (box) => ({
      x: length(box.x), y: length(box.y), left: length(box.left), top: length(box.top),
      right: length(box.right), bottom: length(box.bottom), width: length(box.width), height: length(box.height),
    });
    return Object.freeze({ scale, length, fromRect, rect: (element) => fromRect(element.getBoundingClientRect()) });
  }
  root.VIBEROOM_LAYOUT = Object.freeze({ create });
})(globalThis);
