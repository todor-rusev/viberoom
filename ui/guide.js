// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
Icons.install();
if (window.self !== window.top) {
  document.querySelector(".g-back").hidden = true;
  for (const a of document.querySelectorAll("a[href]")) a.target = "_top";
}
for (const el of document.querySelectorAll("[data-scene]")) el.innerHTML = Icons.scene(el.dataset.scene);
fetch("/api/settings", { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).then((res) => {
  const a = ((res && res.settings) || {}).appearance || {};
  const look = TOKENS.looks[a.look] ? a.look : TOKENS.current.id;
  if (look !== TOKENS.current.id) document.documentElement.dataset.look = look;
}).catch(() => {});
