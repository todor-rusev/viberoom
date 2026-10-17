// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";
  function markup({ icon = () => "" } = {}) {
    return `<form id="room-form" method="dialog">
      <div class="door-art scene-art wb-scene door-scene" id="room-art" role="img" aria-label="A door opens on a warm light; a vibemate steps onto the threshold and waves, another peeks round the jamb and waves too"></div>
      <h3><span class="h-ico">${icon("rooms")}</span>Open a new room</h3>
      <p class="lead">A room is a shared space for you and the vibemates you summon. Give it a name.</p>
      <label>Room name<input id="room-name" type="text" maxlength="60" required placeholder="e.g. Architecture review"></label>
      <label>Working directory <span class="hint">(optional)</span><button type="button" class="geek-tip" title="For geeks"><span>${icon("geek")}</span>for geeks</button><span class="geek-text" hidden>The folder the vibemates work in (their cwd). Leave it empty and viberoom keeps a folder per room. Instruction files in it (CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/rules) are read by the vibemates by their own conventions; the room tells you if it finds any.</span>
        <span class="dir-row"><input id="room-dir" type="text" placeholder="C:\\projects\\my-app"><button type="button" data-ui="button" data-kind="ghost" class="browse-btn" id="room-dir-browse" title="Choose a folder"><span>${icon("folder")}</span>Browse</button></span></label>
      <div id="room-options"></div>
      <p class="error" id="room-error" hidden></p>
      <div class="actions"><button type="button" data-ui="button" data-kind="ghost" data-room-close>Cancel</button><button type="submit" data-ui="button" data-kind="primary">Open the room</button></div>
    </form>`;
  }
  function optionsMarkup(defaults, { row, card, select, UI, sharesHint, readsHint, readsChoices }) {
    return card("room-options-card", "", [
      row({ label: "Share this room's history with the other rooms", for: "room-share-history", kind: "switch", checked: defaults.sharesHistory !== false, hint: sharesHint }),
      row({ label: "Search the other rooms", for: "room-reads-others", hint: readsHint, control: UI.raw(select("room-reads-others", readsChoices, defaults.readsOtherRooms || "on-search")) }),
      row({ label: "Reachable from messengers", for: "room-reachable", kind: "switch", checked: true, hint: "A phone paired to viberoom can open this room, write to it and read its replies. You can change this later in the room's settings." }),
    ].join(""));
  }
  function create(dialog, { window: view = dialog?.ownerDocument.defaultView, signal, icon, scene, getDefaults,
    options, createRoom, onCreated, onSelect, openDialog, closeDialog, chooseFolder, target } = {}) {
    signal?.throwIfAborted();
    const owner = root.VIBEROOM_APP_LIFETIME.create({ window: view });
    let visit = 0, disposed = false, pending = false;
    let opened = null;
    dialog.innerHTML = markup({ icon });
    const find = selector => dialog.querySelector(selector);
    const form = find("#room-form"), name = find("#room-name"), dir = find("#room-dir"), error = find("#room-error");
    const submit = find('[type="submit"]');
    const active = entered => !disposed && !signal?.aborted && visit === entered && dialog.open && !dialog.classList.contains("closing");
    const busy = () => { if (!disposed) { submit.disabled = pending; submit.textContent = pending ? "Opening…" : "Open the room"; } };
    function open() {
      if (disposed) return false;
      ++visit; error.hidden = true; error.textContent = ""; name.value = "";
      const chosen = target?.();
      opened = chosen ? { scope: chosen.scope, dir: chosen.dir } : null;
      if (target && !opened) { --visit; return false; }
      dir.value = opened?.dir || "";
      find("#room-options").innerHTML = options(getDefaults());
      find("#room-art").innerHTML = scene();
      busy(); openDialog(dialog); name.focus(); return true;
    }
    owner.on(dialog, "close", () => { if (!dialog.open) ++visit; });
    owner.on(find("[data-room-close]"), "click", () => closeDialog(dialog));
    owner.on(form, "submit", async event => {
      event.preventDefault();
      if (pending || disposed || !dialog.open) return;
      const entered = visit;
      const value = { name: name.value, dir: dir.value.trim() || null, settings: {
        sharesHistory: find("#room-share-history").checked, readsOtherRooms: find("#room-reads-others").value,
        reachableFromMessengers: find("#room-reachable").checked,
      }, ...(opened ? { scope: opened.scope } : {}) };
      pending = true; busy();
      let result;
      try { result = await createRoom(value); }
      catch (failure) {
        if (active(entered)) { error.textContent = failure.message; error.hidden = false; }
        return;
      } finally { pending = false; busy(); }
      if (disposed || signal?.aborted) return;
      onCreated(result);
      if (!active(entered)) return;
      closeDialog(dialog);
      if (result?.room?.id) onSelect(result.room);
    });
    owner.on(find("#room-dir-browse"), "click", () => {
      const entered = visit;
      chooseFolder(dir.value, chosen => { if (active(entered)) dir.value = chosen; });
    });
    function dispose() {
      if (disposed) return;
      disposed = true; ++visit; owner.dispose();
      if (dialog.open) closeDialog(dialog);
    }
    if (signal) owner.on(signal, "abort", dispose, { once: true });
    return Object.freeze({ open, dispose, get signal() { return owner.signal; } });
  }
  Object.defineProperty(create, "disposable", { value: true });
  Object.defineProperty(create, "scoped", { value: true });
  root.VIBEROOM_ROOM_DIALOG = Object.freeze({ markup, optionsMarkup, create });
})(typeof window !== "undefined" ? window : globalThis);
