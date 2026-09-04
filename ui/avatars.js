// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(() => {
  "use strict";

  function hash(text) {
    let h = 2166136261;
    for (const ch of String(text)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  function shade(hex, amount) {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amount));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amount));
    const b = Math.min(255, Math.max(0, (n & 255) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }

  function initials(name) {
    const parts = String(name).trim().split(/[\s_-]+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function avatarSvg(name, color, emoji, size) {
    const s = size || 40;
    const c1 = shade(color, 30);
    const c2 = shade(color, -25);
    const id = `g${hash(name + color).toString(36)}`;
    const label = emoji ? emoji : initials(name);
    const fontSize = emoji ? s * 0.55 : s * 0.42;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" role="img" aria-label="${escapeAttr(name)}">
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}" fill="url(#${id})"/>
  <circle cx="${s / 2}" cy="${s * 0.36}" r="${s * 0.34}" fill="#ffffff" opacity="0.10"/>
  <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, 'Segoe UI Emoji', sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${escapeText(label)}</text>
</svg>`;
  }

  function escapeText(value) {
    return String(value).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  }
  function escapeAttr(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function avatarHtml(participant, size, options) {
    const opts = options || {};
    const color = participant.color || "#5b5bf0";
    const s = size || 40;
    const emoji = participant.avatar;
    const label = emoji ? emoji : initials(participant.name);
    const fontSize = Math.round(emoji ? s * 0.56 : s * 0.38);
    const radius = Math.round(s * 0.32);
    const svg = `<span class="av-tile" role="img" aria-label="${escapeAttr(participant.name)}" style="background:color-mix(in srgb, ${escapeAttr(color)} 16%, #ffffff);color:${escapeAttr(color)};font-size:${fontSize}px;border-radius:${radius}px">${escapeText(label)}</span>`;
    const status = opts.status ? `<span class="avatar-status status-${escapeAttr(participant.status || "idle")}"></span>` : "";
    let badge = "";
    if (opts.vendor && participant.kind === "agent") {
      const recipe = opts.recipes ? opts.recipes.find((r) => r.id === participant.agentType) : null;
      const letter = escapeText((participant.agentVendor || participant.agentType || "?").slice(0, 1).toUpperCase());
      const title = escapeAttr(participant.agentLabel || participant.agentType || "");
      badge = recipe && recipe.icon
        ? `<span class="avatar-badge" title="${title}"><img src="${escapeAttr(recipe.icon)}" alt="" onerror="this.replaceWith(document.createTextNode('${letter}'))"></span>`
        : `<span class="avatar-badge" title="${title}">${letter}</span>`;
    }
    return `<span class="avatar" style="width:${size}px;height:${size}px">${svg}${badge}${status}</span>`;
  }

  const GALLERY = [
    "🦊", "🐼", "🦉", "🐯", "🐸", "🤖", "👩‍💻", "🧑‍🚀", "🧙", "🐙", "🦄", "🐺", "🧑‍🎨", "🕵️", "🧑‍🔬", "🐝", "🐧", "🦁", "🐨", "👾",
    "🐱", "🐶", "🦝", "🐢", "🐬", "🦋", "🦩", "🐲", "🦖", "🐳", "🦭", "🐹", "🦔", "🐻", "🐮", "🐵",
    "🧑‍🍳", "🧑‍🚒", "🧑‍⚕️", "🧑‍🏫", "🧑‍✈️", "🧛", "🧜", "🧞", "🦸", "🥷", "🤠", "👽", "👻", "🎃",
    "🌙", "⭐", "🔥", "🍀", "🌵", "🌈", "🎧", "🎸", "🚀", "🛸", "🧠", "🎯", "🧩", "💎", "🍕", "☕",
  ];

  function pickerElement(current, onPick) {
    const wrap = document.createElement("div");
    wrap.className = "avatar-picker";
    const render = (value) => {
      wrap.innerHTML = "";
      const none = document.createElement("button");
      none.type = "button";
      none.className = "none" + (!value ? " selected" : "");
      none.textContent = "Aa";
      none.title = "Initials";
      none.addEventListener("click", () => {
        onPick("");
        render("");
      });
      wrap.appendChild(none);
      for (const e of GALLERY) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = e;
        b.className = e === value ? "selected" : "";
        b.addEventListener("click", () => {
          onPick(e);
          render(e);
        });
        wrap.appendChild(b);
      }
    };
    render(current || "");
    wrap.setValue = render;
    return wrap;
  }

  window.Avatars = { avatarSvg, avatarHtml, initials, pickerElement, GALLERY };
})();
