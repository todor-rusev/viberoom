// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
(function (root) {
  "use strict";

  const STARTED = Symbol.for("viberoom.app.standalone.started");
  const VENDORS = Symbol.for("viberoom.app.document.vendors");
  const PLACEMENT = Symbol.for("viberoom.app.standalone.placement");
  const STARTUP_ERROR = Symbol.for("viberoom.app.startup.error");
  const RELOAD_ATTEMPT = "viberoom.ui.startup-reload";
  class IncompatibleWindow extends Error {
    constructor(missing) {
      super(`The window files are incompatible. Missing: ${missing.join(", ")}`);
      this.code = "ui_incompatible";
      this.missing = Object.freeze(missing);
    }
  }
  function checkStartup(doc, uiRoot) {
    const missing = [];
    if (!uiRoot) missing.push("#viberoom-root");
    const requirements = [
      ["VIBEROOM_APP_LIFETIME.create"], ["VIBEROOM_APP_DOM_LIFETIME.create"],
      ["VIBEROOM_APP_TRANSPORT.create", "disposable"], ["VIBEROOM_AGENT_UPDATES.create", "disposable"],
      ["VIBEROOM_SETTINGS_MODEL.create", "disposable", "batched"],
      ["VIBEROOM_OWNED_JSON.copy"], ["VIBEROOM_OWNED_JSON.clone"], ["VIBEROOM_OWNED_JSON.copyOrdered"], ["VIBEROOM_ROOM_FACTS.create", "disposable", "roster", "cards"], ["VIBEROOM_ROOM_READER.create", "disposable", "identities"], ["VIBEROOM_ROOM_DIRECTORY.create", "disposable", "preparesRecords"], ["VIBEROOM_HISTORY_LOADING.create", "disposable", "releasesPages", "delegatesConversation"], ["VIBEROOM_HISTORY_RECONCILIATION.create", "disposable", "delegatesMembership"], ["VIBEROOM_CONVERSATION_STATE.create", "disposable", "streaming", "history", "metadata", "projections", "toolVersions", "ranges", "overview"], ["VIBEROOM_MESSAGE_PROJECTIONS.create", "disposable", "tools", "textFrames", "headers"], ["VIBEROOM_CONVERSATION_READER.create", "disposable", "overview", "quiet", "timelinePreviews", "timelineHeaders"], ["VIBEROOM_TOOL_DETAILS.create", "disposable"], ["VIBEROOM_HISTORY_RECONCILIATION.isDelta"], ["VIBEROOM_HUB_STATUS_MODEL.create", "disposable"],
      ["VIBEROOM_SERVICE_FACTS_MODEL.create", "disposable"],
      ["VIBEROOM_VENDOR_FLOW_MODEL.create", "disposable"], ["VIBEROOM_PICTURE_STATUS_MODEL.create", "disposable"],
      ["VIBEROOM_APP_REQUESTS.create", "disposable"],
      ["VIBEROOM_SETTINGS_COMMANDS.create", "disposable"],
      ["VIBEROOM_ROOM_COMMANDS.create", "meantRecovery"], ["VIBEROOM_ME_PAGE.render"], ["VIBEROOM_ERASE_DIALOG.create", "disposable", "scoped"], ["VIBEROOM_ERASE_DIALOG.markup"], ["VIBEROOM_PROFILE_DIALOG.create", "disposable", "scoped"], ["VIBEROOM_PROFILE_DIALOG.markup"], ["VIBEROOM_LOOK_DIALOG.create", "disposable", "scoped"], ["VIBEROOM_LOOK_DIALOG.markup"], ["VIBEROOM_RECONNECT.create", "disposable", "scoped"], ["VIBEROOM_RECONNECT.markup"],
      ["VIBEROOM_ROOM_MARK.html"], ["VIBEROOM_ROOM_MARK.hue"],
      ["VIBEROOM_RAIL.create", "disposable", "scoped"], ["VIBEROOM_RAIL.markup"],
      ["VIBEROOM_ROOM_PANEL.sections"], ["VIBEROOM_ROOM_PANEL.patch"],
      ["VIBEROOM_CONFIRM_DIALOG.create", "disposable", "scoped"], ["VIBEROOM_CONFIRM_DIALOG.markup"],
      ["VIBEROOM_FOLDER_PICKER.create", "disposable", "scoped"], ["VIBEROOM_FOLDER_PICKER.markup"],
      ["VIBEROOM_FOLDER_CHANGE.create", "disposable", "scoped"], ["VIBEROOM_FOLDER_CHANGE.pendingMarkup"],
      ["VIBEROOM_FILE_VIEWER.create", "disposable", "scoped"], ["VIBEROOM_FILE_VIEWER.markup"],
      ["VIBEROOM_MESSAGE_PARTS.hidden"], ["VIBEROOM_MESSAGE_PARTS.shots"], ["VIBEROOM_MESSAGE_PARTS.sounds"], ["VIBEROOM_MESSAGE_PARTS.videos"], ["VIBEROOM_MESSAGE_PARTS.liveMeta"], ["VIBEROOM_MESSAGE_PARTS.liveSign"], ["VIBEROOM_MESSAGE_PARTS.seen"],
      ["VIBEROOM_MESSAGE_TOOLS.draw", "current"],
      ["VIBEROOM_MESSAGE_TEXT.words", "current"], ["VIBEROOM_MESSAGE_TEXT_WORK.create", "disposable"], ["VIBEROOM_MESSAGE_TEXT.liveTail"], ["VIBEROOM_MESSAGE_TEXT.fold"],
      ["VIBEROOM_MESSAGE_BUBBLE.bubble"], ["VIBEROOM_MESSAGE_BUBBLE.hubRow"], ["VIBEROOM_MESSAGE_BUBBLE.agentsNote"], ["VIBEROOM_MESSAGE_BUBBLE.nowName"],
      ["VIBEROOM_MESSAGE_ACTIONS.bind"], ["VIBEROOM_MESSAGE_DEVTOOLS.create", "disposable", "scoped"], ["VIBEROOM_MESSAGE_RENDERER.create"], ["VIBEROOM_CODE_COLOURS.create", "disposable", "scoped", "textTargets"], ["VIBEROOM_CODE_COLOURS.languageOf"], ["VIBEROOM_CODE_COLOURS.withGutter"],
      ["VIBEROOM_DIAGRAM_RENDERER.create", "disposable", "scoped", "textTargets"],
      ["VIBEROOM_MESSAGE_PREVIEWS.create", "disposable", "scoped", "textTargets"],
      ["VIBEROOM_MESSAGE_COPY.create", "disposable", "scoped"],
      ["VIBEROOM_MESSAGE_REFERENCE.create", "disposable", "scoped"],
      ["VIBEROOM_MESSAGE_WAITING.create", "disposable", "scoped"],
      ["VIBEROOM_INLINE_EDITOR.create", "disposable", "scoped"],
      ["VIBEROOM_QUOTE_SELECTION.create", "disposable", "scoped"],
      ["VIBEROOM_CONVERSATION_SELECTION.create", "disposable", "scoped"],
      ["VIBEROOM_CONVERSATION_SEARCH.create", "disposable", "scoped"], ["VIBEROOM_CONVERSATION_SEARCH.searchNamesHtml"],
      ["VIBEROOM_LIGHTBOX.create", "disposable", "scoped"], ["VIBEROOM_LIGHTBOX.markup"],
      ["VIBEROOM_DIAGRAM_VIEW.create", "disposable", "scoped"], ["VIBEROOM_DIAGRAM_VIEW.markup"],
      ["VIBEROOM_PARTICIPANTS.rows"], ["VIBEROOM_PARTICIPANTS.patch"],
      ["VIBEROOM_SECRET_DIALOG.create", "disposable", "scoped"], ["VIBEROOM_SECRET_DIALOG.markup"], ["VIBEROOM_TELEGRAM_SETUP.dialogMarkup"],
      ["VIBEROOM_LOGIN_DIALOG.create", "disposable", "scoped"], ["VIBEROOM_LOGIN_DIALOG.markup"], ["VIBEROOM_LOGIN_DIALOG.presentation"],
      ["VIBEROOM_EDIT_DIALOG.create", "disposable", "scoped"], ["VIBEROOM_EDIT_DIALOG.markup"],
      ["VIBEROOM_INVITE_DIALOG.create", "disposable", "scoped"], ["VIBEROOM_INVITE_DIALOG.markup"],
      ["VIBEROOM_AGENT_PANEL.render"], ["VIBEROOM_AGENT_PANEL.troubleActions"], ["VIBEROOM_AGENT_PANEL.troubleRow"], ["VIBEROOM_AGENT_CONFIG.render"], ["VIBEROOM_AGENT_CONFIG.flattenOptions"],
      ["VIBEROOM_HOME.create", "disposable", "scoped"], ["VIBEROOM_HOME.markup"],
      ["VIBEROOM_ROOMS.grid", "disposable", "scoped"], ["VIBEROOM_ROOMS.side", "disposable", "scoped"],
      ["VIBEROOM_SKILLS_PAGE.render"], ["VIBEROOM_SKILLS_PAGE.markup"],
      ["VIBEROOM_CONNECTIONS_PAGE.create", "disposable"], ["VIBEROOM_CONNECTIONS_PAGE.mark"],
      ["VIBEROOM_ONBOARDING_PAGE.render"], ["VIBEROOM_ONBOARDING_PAGE.mark"], ["VIBEROOM_ONBOARDING_PAGE.bind", "disposable"],
      ["VIBEROOM_ROOM_DIALOG.create", "disposable", "scoped"], ["VIBEROOM_ROOM_DIALOG.markup"], ["VIBEROOM_ROOM_DIALOG.optionsMarkup"],
      ["VIBEROOM_TEMPLATE_DIALOG.create", "disposable", "scoped"], ["VIBEROOM_TEMPLATE_DIALOG.markup"], ["VIBEROOM_TEMPLATE_PICKER.create", "disposable", "scoped"], ["VIBEROOM_TEMPLATE_PICKER.markup"], ["VIBEROOM_TEMPLATE_FORM.render"], ["VIBEROOM_TEMPLATE_FORM.read"],
      ["VIBEROOM_SCREEN_LIFETIME.create", "disposable"],
      ["VIBEROOM_SETTINGS_VIEW.render"], ["VIBEROOM_SETTINGS_VIEW.dataFolderRow"], ["VIBEROOM_SETTINGS_VIEW.configurationProblemHtml"], ["VIBEROOM_SETTINGS_SCREEN.create", "disposable", "scoped"], ["VIBEROOM_SETTINGS_SCREEN.categories"], ["VIBEROOM_SETTINGS_SCREEN.control"], ["VIBEROOM_SETTINGS_SCREEN.fold"], ["VIBEROOM_SETTINGS_SCREEN.roomValueRow"], ["VIBEROOM_SETTINGS_SCREEN.roomListFold"], ["VIBEROOM_SETTINGS_SCREEN.summary"], ["VIBEROOM_SETTINGS_SCREEN.words"], ["VIBEROOM_SETTINGS_SCREEN.almostOn"], ["VIBEROOM_SETTINGS_SCREEN.placeBar"], ["VIBEROOM_TELEGRAM_SETUP.markup"], ["VIBEROOM_TELEGRAM_SETUP.create", "disposable", "scoped"],
      ["VIBEROOM_TELEGRAM_SETUP.ownsTokenCard"], ["VIBEROOM_TELEGRAM_SETUP.maskLink"],
      ["VIBEROOM_CHANNELS_SETTINGS.markup"], ["VIBEROOM_CHANNELS_SETTINGS.mount", "disposable", "scoped"],
      ["VIBEROOM_DIAGNOSTICS_SETTINGS.markup"], ["VIBEROOM_DIAGNOSTICS_SETTINGS.mount", "disposable", "scoped"], ["VIBEROOM_MEMORY_SETTINGS.markup"],
      ["VIBEROOM_MEMORY_SETTINGS.mount", "disposable", "scoped"],
      ["VIBEROOM_FEATURE_CONSENT.title"], ["VIBEROOM_FEATURE_CONSENT.noPeekHtml"], ["VIBEROOM_FEATURE_CONSENT.gate"], ["VIBEROOM_FEATURE_CONSENT.lock"],
      ["VIBEROOM_FEATURE_CONSENT.waitingOn"], ["VIBEROOM_FEATURE_CONSENT.mount", "disposable", "scoped"],
      ["VIBEROOM_VOICE_SETTINGS.voiceMarkup"], ["VIBEROOM_VOICE_SETTINGS.readingMarkup"],
      ["VIBEROOM_VOICE_SETTINGS.mountVoice", "disposable", "scoped"], ["VIBEROOM_VOICE_SETTINGS.mountReading", "disposable", "scoped"], ["VIBEROOM_SETTINGS_FORM.mount", "disposable", "scoped"],
      ["VIBEROOM_COMPOSER_MENU.create", "disposable", "scoped"],
      ["VIBEROOM_ATTACHMENT_TRAYS.create", "disposable", "scoped"], ["VIBEROOM_ATTACHMENT_TRAYS.token"],
      ["VIBEROOM_SKILL_CHECKS.render"], ["VIBEROOM_SKILL_CHECKS.read"],
      ["VIBEROOM_GUIDE_VIEW.create", "disposable", "scoped"],
      ["VIBEROOM_CONTROLS.mount", "disposable", "scoped"],
      ["VIBEROOM_COMPOSER_EMOJI.create", "disposable", "scoped"],
      ["VIBEROOM_TOAST_VIEW.create", "disposable", "scoped"],
      ["VIBEROOM_RUNTIME_NOTICES.create", "disposable", "scoped"],
      ["VIBEROOM_COMPOSER_SIZING.create", "disposable", "scoped"],
      ["VIBEROOM_CORNER_NOTES.create", "disposable", "scoped"],
      ["VIBEROOM_WEDGE_CARD.create", "disposable", "scoped"], ["VIBEROOM_WEDGE_CARD.html"], ["VIBEROOM_WEDGE_CARD.words"],
      ["VIBEROOM_ATTENTION_VIEW.create", "disposable"],
      ["VIBEROOM_TIMELINE_READER.create", "disposable", "facts", "colorBatch", "contentChanges"],
      ["VIBEROOM_TIMELINE_VIEW.create", "disposable", "scoped", "facts", "checkedPatch", "colorBatch"],
      ["VIBEROOM_CONVERSATION_LIST_READER.create", "disposable", "facts"],
      ["VIBEROOM_CONVERSATION_LIST.create", "disposable", "facts"],
      ["VIBEROOM_EMPTY_CONVERSATION.create", "disposable", "scoped", "facts"],
      ["VIBEROOM_EMPTY_CONVERSATION.quietRoom"], ["VIBEROOM_EMPTY_CONVERSATION.quietKey"],
      ["VIBEROOM_WORKING_NOW.create", "disposable", "scoped"],
      ["VIBEROOM_PINS.create", "disposable", "scoped", "readerScopes"],
      ["VIBEROOM_CONTEXT_RING.create"], ["VIBEROOM_CONTEXT_RING.lifeOf"], ["VIBEROOM_CONTEXT_RING.pathFor"],
      ["VIBEROOM_PANEL_WIDTH.create", "disposable", "scoped"],
      ["VIBEROOM_DIALOG_SIZING.create", "disposable", "scoped"],
      ["VIBEROOM_PANEL_NAVIGATION.create", "disposable", "scoped"],
      ["VIBEROOM_SETTING_FOLD.create", "disposable", "scoped"], ["VIBEROOM_SETTING_FOLD.markup"],
      ...["profileHeader", "panelTitle", "roomProfileHeader", "panelSectionShown", "panelSectionsHtml", "panelSearchHtml"].map(name => [`VIBEROOM_PANEL_VIEW.${name}`]),
      ["VIBEROOM_RULES_EDITOR.create", "disposable", "scoped"], ["VIBEROOM_RULES_EDITOR.toNodes"], ["VIBEROOM_RULES_EDITOR.text"],
      ["Composer.attach", "disposable"], ["Composer.markersIn"], ["VIBEROOM_READER.create", "disposable"],
      ["VIBEROOM_VOICE.attach", "disposable"], ["Icons.playOnHover", "disposable"],
      ["VIBEROOM_HINTS.install", "disposable"], ["VIBEROOM_CONTEXT_MENU.install", "disposable"],
      ["VIBEROOM_SAVE.install", "disposable"], ["VIBEROOM_LAYOUT.create"],
      ["UI.html"], ["UI.el"], ["UI.h"], ["UI.raw"], ["UI.setState"], ["UI.type"],
      ["Icons.install"], ["Icons.svg"], ["Icons.rig"], ["Icons.scene"], ["Icons.play"],
      ["Avatars.avatarHtml"], ["Avatars.castColour"], ["Avatars.faceUrl"],
      ["Avatars.pickerElement", "scoped"], ["Avatars.facePicker", "scoped"], ["Avatars.searchableGrid", "scoped"],
      ["ViberoomCarry.open", "scoped"], ["ViberoomMemory.open", "scoped"],
      ["ViberoomRecovery.open", "scoped"], ["ViberoomAutomations.open", "scoped"], ["ViberoomAutomations.refresh"],
      ["Fold.anchorAt"], ["Fold.anchorSurplus"], ["Fold.foldIndexFor"], ["Fold.partsOf"],
      ["KeyedList.patch"], ["KeyedList.patchPaged"],
      ["ListIndex.build"], ["ListIndex.measured"], ["ListIndex.repriceRow"], ["ListIndex.total"],
      ["ListIndex.rangeFor"], ["ListIndex.topOf"], ["ListIndex.heightAt"],
      ["HistoryWindow.messageById"], ["HistoryWindow.messageInCollection"], ["WindowBodies.previewText"], ["HistoryWindow.count"], ["HistoryWindow.syncCount"], ["HistoryWindow.knownMessages"],
      ["HistoryWindow.heldMessageById"], ["HistoryWindow.heldMessageIndex"], ["HistoryWindow.capture"],
      ["HistoryWindow.sameRange"], ["HistoryWindow.mergePage"], ["HistoryWindow.acceptSnapshot"],
      ["HistoryWindow.compareMessages"], ["HistoryWindow.sortMessages"], ["HistoryWindow.insertMessage"],
      ["HistoryWindow.retainUnchanged"], ["HistoryWindow.compareCursor"], ["HistoryWindow.renameMessage"],
      ["WindowBodies.trim", "reportsEvictions"], ["WindowBodies.merge", "reportsReplacements"], ["WindowBodies.renameUse"], ["WindowBodies.retain"], ["WindowBodies.touch"],
      ["WindowBodies.changed"], ["WindowBodies.invalidate"], ["Passage.find"],
      ["VIBEROOM_TOKENS.make"], ["VIBEROOM_TIMELINE.slotsOf"], ["VIBEROOM_TIMELINE.itemAt"],
      ["VIBEROOM_TIMELINE.pinGroups"], ["VIBEROOM_DRAFTS.save"], ["VIBEROOM_DRAFTS.load"],
      ["VIBEROOM_DRAFTS.remove"], ["VIBEROOM_DRAFTS.withoutMarkers"],
    ];
    for (const [path, ...capabilities] of requirements) {
      const value = path.split(".").reduce((object, key) => object?.[key], root);
      if (typeof value !== "function") missing.push(path);
      else for (const capability of capabilities) if (value[capability] !== true) missing.push(`${path}.${capability}`);
    }
    if (typeof root.UI?.type === "function") {
      for (const name of ["button", "message-ref", "file-card", "icon-button", "logo-tile", "setting", "number-field",
        "settings-group", "room-mark", "hub-row", "ask-card", "badge", "row-button", "reply-note", "tool-call",
        "tool-fold", "unseen-line", "skeleton", "message-peek", "look-card", "settings-nav", "settings-category",
        "switch", "adjust-row", "slider-field", "choice", "settings-glyph", "consent-gate", "consent-lock", "login-dialog", "chip"]) {
        if (!root.UI.type(name)) missing.push(`UI.type(${name})`);
      }
    }
    if (missing.length) throw new IncompatibleWindow(missing);
  }
  function recoverStartup(doc, error) {
    const incompatible = error instanceof IncompatibleWindow;
    let notice = doc[STARTUP_ERROR];
    if (!notice) {
      notice = doc.createElement("p");
      notice.id = "viberoom-startup-error";
      notice.setAttribute("role", "alert");
      notice.textContent = incompatible
        ? "The window files are from different versions. Restart viberoom."
        : "The window could not start. Restart viberoom.";
      for (const [name, value] of Object.entries({ display: "block", visibility: "visible", opacity: "1", position: "fixed",
        top: "0", left: "0", right: "0", "z-index": "2147483647", margin: "0", padding: "1rem", background: "Canvas",
        color: "CanvasText", "font-family": "system-ui, sans-serif", "font-size": "16px", "line-height": "1.5" })) {
        notice.style.setProperty(name, value, "important");
      }
      (doc.body || doc.documentElement).appendChild(notice);
      doc[STARTUP_ERROR] = notice;
      root.console?.error("The Viberoom window could not start", incompatible ? error.missing : "startup_failed");
    }
    if (!incompatible) return;
    try {
      const storage = doc.defaultView.sessionStorage;
      if (storage.getItem(RELOAD_ATTEMPT) !== null) return;
      storage.setItem(RELOAD_ATTEMPT, "1");
      if (storage.getItem(RELOAD_ATTEMPT) !== "1") return;
      doc.defaultView.location.reload();
    } catch { }
  }
  function appVendors(document) {
    if (document[VENDORS]) return document[VENDORS];
    const window = document.defaultView;
    const state = { prism: null, languages: new Map(), mermaid: null, mermaidTurn: Promise.resolve(), mermaidSeq: 0 };
    const needs = { tsx: ["jsx", "typescript"], jsx: [], cpp: ["c"], php: ["markup-templating"], twig: ["markup-templating"], scss: [], docker: [] };
    function script(src, result, optional = false) {
      return new Promise((resolve, reject) => {
        const element = document.createElement("script");
        const finish = (failed) => {
          element.onload = element.onerror = null;
          if (failed && !optional) reject(new Error("the code colouring script could not be loaded"));
          else resolve(failed ? null : result());
        };
        element.src = src;
        element.onload = () => finish(false);
        element.onerror = () => finish(true);
        document.head.appendChild(element);
      });
    }
    state.loadPrism = () => {
      if (window.Prism?.highlight) return Promise.resolve(window.Prism);
      window.Prism = window.Prism || {};
      window.Prism.manual = true;
      state.prism ??= script("/vendor/prism.js", () => window.Prism);
      return state.prism;
    };
    state.loadLanguage = (id) => {
      if (!id) return Promise.resolve(null);
      if (window.Prism?.languages?.[id]) return Promise.resolve(id);
      if (!state.languages.has(id)) {
        const load = state.loadPrism()
          .then(() => Promise.all((needs[id] || []).map(need => state.loadLanguage(need))))
          .then(() => window.Prism.languages[id] ? id : script(`/vendor/prism-lang/${encodeURIComponent(id)}.js`, () => window.Prism.languages[id] ? id : null, true))
          .catch(() => null);
        state.languages.set(id, load);
      }
      return state.languages.get(id);
    };
    Object.defineProperty(document, VENDORS, { value: state });
    return state;
  }
  function productProfile(value) {
    if (value === undefined) return Object.freeze({ name: "viberoom" });
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("The product profile must be an object");
    const unknown = Object.keys(value).find(key => !["name", "start"].includes(key));
    if (unknown) throw new TypeError(`The product profile has no setting "${unknown}"`);
    const name = typeof value.name === "string" ? value.name.trim() : "";
    if (!name || name.length > 40) throw new TypeError("A product's name must be 1-40 characters");
    if (value.start !== undefined && typeof value.start !== "function") throw new TypeError("A product's start must be a function");
    return Object.freeze({ name, ...(value.start ? { start: value.start } : {}) });
  }
  function startStandalone(doc = root.document) {
    if (!doc || doc !== root.document || doc.nodeType !== 9) throw new TypeError("Start the standalone UI in its own document");
    const uiRoot = doc.getElementById("viberoom-root");
    const product = productProfile(root.VIBEROOM_PRODUCT);
    return startApp(doc, uiRoot, {}, { customLooks: doc.getElementById("looks-custom"), bodyShortcuts: true, embedded: false, product, title: product.name });
  }
  function embeddedDocument(uiRoot) {
    const doc = uiRoot?.ownerDocument;
    if (!doc || doc !== root.document || !uiRoot.isConnected || uiRoot.id !== "viberoom-root") throw new TypeError("Mount a connected canonical Viberoom root in its own document");
    if (!doc.querySelector('meta[name="viberoom-embed"]')) throw new Error("Mark an embedded document with viberoom-embed before loading app.js");
    return doc;
  }
  function mount(uiRoot, options = {}) {
    const doc = embeddedDocument(uiRoot);
    if (typeof options.roomId !== "string" || !options.roomId || typeof options.scope !== "string" || !options.scope) throw new TypeError("An embedded room needs its roomId and project scope");
    return startApp(doc, uiRoot, { ...options, initialView: "room" }, { customLooks: null, bodyShortcuts: false, embedded: true });
  }
  function mountApplication(uiRoot, options = {}) {
    const doc = embeddedDocument(uiRoot), screens = options.sharedScreens ?? [];
    if (!Array.isArray(screens) || screens.some(screen => screen !== "settings")) throw new TypeError("Choose supported shared screens");
    const sharedSettings = screens.includes("settings"), initialView = options.initialView ?? (options.roomId ? "room" : "host");
    if (!["room", "settings", "host"].includes(initialView)) throw new TypeError("Choose an initial room, Settings or host screen");
    if (initialView === "settings" && !sharedSettings) throw new TypeError("Include shared Settings before opening them");
    if (initialView === "room" && (typeof options.roomId !== "string" || !options.roomId || typeof options.scope !== "string" || !options.scope)) throw new TypeError("An embedded room needs its roomId and project scope");
    const policy = options.documentPolicy ?? {};
    if (!policy || typeof policy !== "object" || Array.isArray(policy) || Object.entries(policy).some(([key, value]) => !["appearance", "notifications", "attention"].includes(key) || typeof value !== "boolean")) throw new TypeError("Choose boolean appearance, notifications and attention document policies");
    if (options.title !== undefined && (typeof options.title !== "string" || !options.title.trim())) throw new TypeError("An application title must be non-empty text");
    const documentPolicy = Object.freeze({ appearance: policy.appearance === true, notifications: policy.notifications === true, attention: policy.attention === true });
    const customLooks = documentPolicy.appearance ? doc.getElementById("looks-custom") || doc.querySelector('link[href^="/looks-custom.css"]') : null;
    return startApp(doc, uiRoot, { ...options, initialView }, { customLooks, bodyShortcuts: false, embedded: true, applicationHost: true, sharedSettings,
      documentPolicy, title: options.title?.trim() || doc.title || "viberoom" });
  }
  function startApp(doc, uiRoot, options, standalone) {
    const slot = doc[STARTED] || { current: null };
    if (slot.current) {
      if (!standalone.embedded && slot.current.standalone && slot.current.uiRoot === uiRoot && slot.current.handle) return slot.current.handle;
      throw new Error("Viberoom has already started in this document");
    }
    checkStartup(doc, uiRoot);
    if (!doc[STARTED]) Object.defineProperty(doc, STARTED, { value: slot });
    const instance = { lifetime: root.VIBEROOM_APP_LIFETIME.create({ window: doc.defaultView }), uiRoot, standalone: !standalone.embedded, handle: null };
    slot.current = instance;
    instance.lifetime.own(() => { if (slot.current === instance) slot.current = null; });
    try {
      instance.handle = runStandalone(doc, instance.lifetime, uiRoot, standalone, options);
      doc[STARTUP_ERROR]?.remove(); delete doc[STARTUP_ERROR];
      if (!standalone.embedded) {
        try { doc.defaultView.sessionStorage.removeItem(RELOAD_ATTEMPT); }
        catch { }
      }
      return instance.handle;
    }
    catch (error) {
      try { instance.lifetime.dispose(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "Application startup and cleanup failed"); }
      throw error;
    }
  }

  function runStandalone(document, lifetime, uiRoot, standalone, options = {}) {
  const sharedSettings = standalone.sharedSettings === true;
  const ownsAppearance = !standalone.embedded || standalone.documentPolicy?.appearance === true;
  const ownsNotifications = !standalone.embedded || standalone.documentPolicy?.notifications === true;
  const ownsAttention = !standalone.embedded || standalone.documentPolicy?.attention === true;
  const { timeout: setTimeout, clearTimeout, interval: setInterval, clearInterval,
    frame: requestAnimationFrame, cancelFrame: cancelAnimationFrame } = lifetime;
  const net = lifetime.use(VIBEROOM_APP_TRANSPORT.create({ window: document.defaultView, signal: lifetime.signal }));
  const screenLifetimes = lifetime.use(VIBEROOM_SCREEN_LIFETIME.create({ window: document.defaultView, signal: lifetime.signal }));
  const vendors = appVendors(document);
  const objectUrls = new Set(), metadataProbes = new Set();
  lifetime.own(() => {
    for (const cancel of [...metadataProbes]) cancel();
    for (const url of [...objectUrls]) revokeObjectUrl(url);
  });
  function createObjectUrl(blob) {
    if (lifetime.disposed) throw lifetime.signal.reason;
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    return url;
  }
  function revokeObjectUrl(url) {
    if (objectUrls.delete(url)) URL.revokeObjectURL(url);
  }
  const instanceDomResources = VIBEROOM_APP_DOM_LIFETIME.create({ root: uiRoot, lifetime });
  let listListenerCapture = null;
  const domResources = Object.freeze({ ...instanceDomResources,
    nodeListener: (node, type, callback, options) => {
      const release = instanceDomResources.nodeListener(node, type, callback, options);
      if (node && listListenerCapture) listListenerCapture.bindings.push({ node, release });
      return release;
    },
  });
  const settingsModel = lifetime.use(VIBEROOM_SETTINGS_MODEL.create({
    onError: error => console.warn("A settings reader callback failed", error?.name || "Error"),
  }));
  const hubStatus = lifetime.use(VIBEROOM_HUB_STATUS_MODEL.create());
  const serviceFacts = lifetime.use(VIBEROOM_SERVICE_FACTS_MODEL.create());
  const vendorFlows = lifetime.use(VIBEROOM_VENDOR_FLOW_MODEL.create());
  const pictureStatus = lifetime.use(VIBEROOM_PICTURE_STATUS_MODEL.create());
  const roomFacts = lifetime.use(VIBEROOM_ROOM_FACTS.create({ signal: lifetime.signal, recordOf: id => state.rooms.get(id) }));
  const roomDirectory = lifetime.use(VIBEROOM_ROOM_DIRECTORY.create({ prepareRecord: room => roomFacts.producer.prepareRecord(room) }));
  const roomReader = lifetime.use(VIBEROOM_ROOM_READER.create({ signal: lifetime.signal,
    recordOf: id => state.rooms.get(id), factsOf: id => roomFacts.reader.read(id) }));
  const ports = options.ports || {};
  let stopped = false, snapshotSeen = false, navigation = null, navigating = false, renderedSerial = 0;
  let scope = options.scope ?? null, readySettled = false, resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const normalDialogs = new Map();
  const abortNavigation = () => new DOMException("The room selection was superseded", "AbortError");
  function notifyHost(name, value) {
    const serial = renderedSerial;
    queueMicrotask(() => {
      if (stopped || lifetime.disposed || name === "onRoomChanged" && serial !== renderedSerial) return;
      try { ports[name]?.(value); } catch (error) { console.warn("The application host callback failed", error); }
    });
  }
  function failReady(error) { if (!readySettled) { readySettled = true; rejectReady(error); } }
  function registerDialog(handle) {
    if (stopped || lifetime.disposed) { handle.dispose(); return; }
    if (!uiRoot.contains(handle.dialog)) throw new Error("The room dialog must belong to its view");
    const release = lifetime.on(handle.dialog, "close", () => { normalDialogs.delete(handle.dialog); release(); });
    normalDialogs.set(handle.dialog, { handle, release });
  }
  const dialogPorts = { root: uiRoot, signal: lifetime.signal, onOpen: registerDialog };
  async function closeForNavigation() {
    if ($("#confirm-dialog")?.open) return false;
    for (const [dialog, record] of [...normalDialogs]) {
      if (!dialog.isConnected || !dialog.open) { record.release(); normalDialogs.delete(dialog); continue; }
      if (await lifetime.wait(record.handle.close()) === false) return false;
    }
    for (const dialog of $$("dialog[open]")) {
      if (normalDialogs.has(dialog)) continue;
      await lifetime.wait(new Promise(resolve => {
        const release = lifetime.on(dialog, "close", () => { release(); resolve(); }, { once: true });
        closeDialog(dialog);
      }));
    }
    return true;
  }
  function targetRoom(target) {
    const room = state.rooms.get(target.roomId);
    if (!room) throw Object.assign(new Error("This room is not available."), { code: "room_missing" });
    if (state.embedded && room.scope !== target.scope) throw Object.assign(new Error("This room belongs to a different project."), { code: "scope_mismatch" });
    return room;
  }
  function update(target) {
    if (stopped || lifetime.disposed) return Promise.reject(lifetime.signal.reason || abortNavigation());
    if (!target || typeof target.roomId !== "string" || !target.roomId || (state.embedded && (typeof target.scope !== "string" || !target.scope))) return Promise.reject(new TypeError("Choose a roomId and project scope"));
    if (keyless) return Promise.reject(Object.assign(new Error("This window has no key for the room."), { code: "no_key" }));
    if (snapshotSeen) { try { targetRoom(target); } catch (error) { return Promise.reject(error); } }
    if (!navigation && uiRoot.dataset.roomId === target.roomId && state.view === "room" && state.currentRoomId === target.roomId && scope === target.scope) return Promise.resolve(true);
    return beginNavigation({ roomId: target.roomId, scope: target.scope ?? scope, applied: false });
  }
  function requestSettings(category) {
    return requestSharedView("settings", category);
  }
  function leaveView() { return requestSharedView("host"); }
  function requestSharedView(view, category) {
    if (stopped || lifetime.disposed) return Promise.reject(lifetime.signal.reason || abortNavigation());
    if (view === "settings" ? !sharedSettings : !standalone.applicationHost) return Promise.reject(Object.assign(new Error("This shared screen is not included in this application."), { code: "screen_unavailable" }));
    if (category !== undefined && (typeof category !== "string" || !category)) return Promise.reject(new TypeError("Choose a Settings category"));
    if (keyless) return Promise.reject(Object.assign(new Error("This window has no key for Settings."), { code: "no_key" }));
    return beginNavigation({ view, category, applied: false });
  }
  function beginNavigation(request) {
    navigation?.reject(abortNavigation());
    const promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    promise.catch(() => {});
    navigation = request;
    void navigate();
    return promise;
  }
  async function navigate() {
    if (navigating || !navigation || !snapshotSeen || stopped || lifetime.disposed) return;
    navigating = true;
    try {
      while (navigation && !navigation.applied && !stopped && !lifetime.disposed) {
        const request = navigation;
        try {
          if (request.view === "settings" || request.view === "host") {
            const categoryExists = () => !request.category || settingsCategories().some(category => category.id === request.category);
            if (!categoryExists()) throw Object.assign(new Error("This Settings category is not available."), { code: "settings_category_missing" });
            if (state.view !== request.view) {
              const allowed = await closeForNavigation();
              if (navigation !== request || stopped || lifetime.disposed) continue;
              if (!allowed) { navigation = null; request.resolve(false); continue; }
              if (!categoryExists()) throw Object.assign(new Error("This Settings category is not available."), { code: "settings_category_missing" });
            }
            if (request.view === "host") setView("host");
            else if (state.view === "settings" && settingsScreen && !settingsScreen.disposed) {
              if (request.category) showSettingsCategory(request.category);
            } else {
              if (request.category) remember("settings.category", request.category);
              setView("settings");
            }
            navigation = null;
            renderedSerial++;
            request.resolve(true);
            if (!readySettled) { readySettled = true; resolveReady(); }
            continue;
          }
          targetRoom(request);
          if (state.currentRoomId !== request.roomId || state.view !== "room" || scope !== request.scope) {
            const allowed = await closeForNavigation();
            if (navigation !== request || stopped || lifetime.disposed) continue;
            if (!allowed) { navigation = null; request.resolve(false); continue; }
          }
          targetRoom(request);
          request.applied = true;
          selectRoom(request.roomId, { coordinator: true, scope: request.scope, keepDetails: state.currentRoomId === request.roomId });
          roomRendered();
        } catch (error) {
          if (navigation === request) { navigation = null; request.reject(error); failReady(error); }
        }
      }
    } finally { navigating = false; }
  }
  function roomRendered() {
    const request = navigation, room = currentRoom();
    if (!request?.applied || !room || room.id !== request.roomId || state.view !== "room" || listRoomId !== room.id || draftRoomId !== room.id || room.historyRestoring) return;
    const content = [...els.messages.querySelectorAll(":scope > .msgs-page > .msg[data-id]:not(.history-placeholder, .hidden)")].some(node => {
      const message = HistoryWindow.messageById(room, node.dataset.id);
      return message && !message.bodyMissing;
    });
    const quiet = quietFacts(room);
    if (!quiet || navigation !== request || currentRoom() !== room || state.view !== "room" || lifetime.disposed) return;
    const empty = quiet?.eligible && !!els.messages.querySelector(":scope > .empty-room") && (quiet.heldCount > 0 || !(quiet.historyTotal > 0));
    if ((!content && !empty) || room.indexError && !room.messages.length || els.messages.querySelector(".conversation-loading")) return;
    navigation = null;
    renderedSerial++;
    uiRoot.dataset.roomId = room.id;
    if (state.embedded) uiRoot.dataset.scope = scope;
    request.resolve(true);
    if (!readySettled) { readySettled = true; resolveReady(); }
    notifyHost("onRoomChanged", { roomId: room.id, scope });
  }
  function dispose() {
    if (stopped) return;
    stopped = true;
    try { keepDraft(); } finally { lifetime.dispose(); }
  }
  function hideUnavailableRoom() {
    clearConversationSelection(); hideEmptyGuide(); closeDetails();
    els.messages.replaceChildren(); els.chatView.hidden = true; els.sideRoom.hidden = true;
    delete uiRoot.dataset.roomId;
  }
  lifetime.own(() => {
    stopped = true;
    navigation?.reject(lifetime.signal.reason); navigation = null;
    failReady(lifetime.signal.reason);
    for (const record of normalDialogs.values()) record.release();
    normalDialogs.clear();
  });

  const state = {
    embedded: standalone.embedded === true,
    get settings() { return settingsModel.reader.read().settings; },
    get roomDefaults() { return settingsModel.reader.read().roomDefaults; },
    get looks() { return settingsModel.reader.read().looks; },
    get recipes() { return serviceFacts.reader.read().recipes; },
    get skills() { return serviceFacts.reader.read().skills; },
    get channels() { return serviceFacts.reader.read().channels; },
    get connections() { return serviceFacts.reader.read().connections; },
    get connectionStorageProblem() { return serviceFacts.reader.read().connectionStorageProblem; },
    get memoryProvider() { return serviceFacts.reader.read().memoryProvider; },
    get version() { return hubStatus.reader.read().version; },
    get installation() { return hubStatus.reader.read().installation; },
    get dataFolder() { return hubStatus.reader.read().dataFolder; },
    get update() { return hubStatus.reader.read().update; },
    get restart() { return hubStatus.reader.read().restart; },
    get autostart() { return hubStatus.reader.read().autostart; },
    get keepAwake() { return hubStatus.reader.read().keepAwake; },
    get perMessage() { return hubStatus.reader.read().perMessage; },
    get automationPending() { return hubStatus.reader.read().automationPending; },
    get automationJobs() { return hubStatus.reader.read().automationJobs; },
    get rooms() { return roomDirectory.producer.borrowIndex(); },
    currentRoomId: null,
    view: "home",
    selection: { kind: "room" },
    detailsOpen: false,
    unread: new Map(),
    openRooms: [],
    search: "",
    roomSearch: "",
    expanded: new Set(),
    watched: new Set(),
    skillEditor: null,
    skillsRoom: null,
    get voice() { return serviceFacts.reader.read().voice; },
  };

  const UI_ZOOM_BASE = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
  let Layout = VIBEROOM_LAYOUT.create(parseFloat(getComputedStyle(document.documentElement).zoom) || 1);
  const agentUpdates = lifetime.use(VIBEROOM_AGENT_UPDATES.create({
    root: uiRoot,
    post: (...args) => post(...args), recipes: () => state.recipes,
    onStatus: text => { const el = state.view === "settings" && byId("sp-agent-update-status"); if (el) el.textContent = text; },
    onError: error => showError(error),
    onChange: () => { if ($("#invite-dialog")?.open) renderInviteTiles(); },
  }));

  const $ = (selector) => uiRoot.querySelector(selector);
  const $$ = (selector) => uiRoot.querySelectorAll(selector);
  const owns = (node) => !!node && uiRoot.contains(node);
  const isBodyKey = (event) => standalone.bodyShortcuts === true && event.target === document.body && document.activeElement === document.body;
  function listenKey(handler, options) {
    const releaseRoot = lifetime.on(uiRoot, "keydown", handler, options);
    const releaseBody = lifetime.on(document, "keydown", event => { if (isBodyKey(event)) handler(event); }, options);
    return () => { releaseRoot(); releaseBody(); };
  }
  const byId = (id) => $(`[id="${String(id).replace(/[\x00-\x1f\x7f"\\]/g, ch => `\\${ch.charCodeAt(0).toString(16)} `)}"]`);
  const roomDialogIds = new Set(["invite-dialog", "login-dialog", "confirm-dialog", "edit-dialog", "reconnect-dialog", "folder-dialog", "folder-change-dialog", "file-dialog"]);
  function globalControl(node) {
    if (!state.embedded || !node?.closest) return false;
    if (sharedSettings && node.closest("#look-dialog, #secret-dialog")) return false;
    if (sharedSettings && state.view === "settings" && node.closest("#page-view, #erase-dialog, #agent-updates-dialog")) return false;
    if (node.closest("#rail, #side-rooms, #home-view, #rooms-view, #page-view, #back-to-rooms")) return true;
    const dialog = node.closest("dialog");
    return !!dialog && !roomDialogIds.has(dialog.id) && !dialog.matches(".memory-dialog, .recovery-dialog, .automations-dialog, .carry-dialog");
  }
  if (state.embedded) {
    uiRoot.classList.add("viberoom-embedded");
    if (sharedSettings) uiRoot.classList.add("viberoom-shared-settings");
    for (const type of ["click", "submit", "input", "change", "keydown"]) lifetime.on(uiRoot, type, event => {
      if (globalControl(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  const product = startProductFeatures();
  const rail = lifetime.use(VIBEROOM_RAIL.create($("#rail"), {
    window: document.defaultView, signal: lifetime.signal, glyph: name => window.Icons.rig(name),
    brand: { title: standalone.product?.name || "viberoom", src: "/icon-256.png?v=12", word: standalone.product?.name || "viberoom" },
    items: [
      ...(product.replacesNewRoom ? [] : [{ act: "new-room", id: "rail-new-room", cls: "new", glyph: "plus", label: "Open a room" }]),
      ...product.views.map(view => ({ nav: view.id, glyph: view.glyph, label: view.label, ...(view.title ? { title: view.title } : {}) })),
      ...(product.rail ? [{ list: "rail-product", label: product.rail.label, item: "rail-product-item" }, { rule: true }] : []),
      { nav: "rooms", glyph: "rooms", label: "Rooms" },
      { list: "rail-rooms", label: "Open rooms", item: "rail-room" },
      { nav: "skills", glyph: "skills", label: "Skills" },
      { nav: "connections", glyph: "plug", label: "Connections" },
      { nav: "settings", glyph: "settings", label: "Settings" },
      { rule: true },
      { nav: "onboarding", glyph: "ship", label: "Onboarding", title: "Onboarding: set viberoom up and get the most out of it" },
    ],
    onNavigate: nav => { setView(nav); remember("view", nav); },
    onAct: act => { if (act === "new-room") openRoomDialog(); },
    onPick: (list, id) => list === "rail-product" ? product.rail.onPick(id) : selectRoom(id, { keepDetails: true }),
    onBrand: () => setView("home"),
    onToggle: open => setRailOpen(open),
  }));
  const confirmBox = lifetime.use(VIBEROOM_CONFIRM_DIALOG.create($("#confirm-dialog"), { window: document.defaultView, signal: lifetime.signal, openDialog }));
  const fileViewer = lifetime.use(VIBEROOM_FILE_VIEWER.create($("#file-dialog"), {
    window: document.defaultView, signal: lifetime.signal, icon: name => window.Icons.svg(name), csvTable, codeWithGutter, highlightBlocks, renderDiagrams, toast, onError: showError,
    readFile: (path, around) => get(`/api/file?path=${encodeURIComponent(path)}${around ? `&from=${around.from}&to=${around.to}` : ""}`),
    renderMarkdown: text => renderMarkdown(currentRoom(), text), rowHeight: row => Layout.rect(row).height,
    openInEditor: target => post("/api/open", { target }), openDialog, closeDialog,
  }));
  function inviteSnapshot() {
    return { recipes: state.recipes.map(recipe => ({ ...recipe, updateAction: agentUpdates.tileAction(recipe) })),
      bulkAction: agentUpdates.bulkAction(), settings: { vendorPresets: state.settings?.vendorPresets, bypassPermissionsByDefault: state.settings?.bypassPermissionsByDefault },
      ...vendorFlows.reader.inviteStates() };
  }
  const inviteDialog = lifetime.use(VIBEROOM_INVITE_DIALOG.create($("#invite-dialog"), {
    window: document.defaultView, signal: lifetime.signal, UI, icon: name => window.Icons.svg(name), vendorLogo, getSnapshot: inviteSnapshot,
    makePicker: (current, callback, field, options) => window.Avatars.pickerElement(current, callback, field, options),
    renderSkillChecks, checkedSkills, openDialog, closeDialog, openLoginDialog, onError: showError,
    readOptions: (recipe, refresh, signal) => get(`/api/recipes/${encodeURIComponent(recipe)}/options${refresh ? "?refresh=1" : ""}`, { signal }),
    checkRecipes: value => post("/api/recipes/check", value, value.force ? { deadline: 3 * 60000 } : undefined),
    invite: (room, value) => roomCommands.forRoom(room).invite(value),
    staff: (room, id, value) => roomCommands.forRoom(room).participant(id).staff(value),
  }));
  const els = {
    inviteBtn: $("#invite-btn"),
    app: $("#app"),
    noKey: $("#no-key"),
    conn: $("#conn"),
    sideRooms: $("#side-rooms"),
    sideRoom: $("#side-room"),
    roomSearch: $("#room-search"),
    roomList: $("#room-list"),
    backToRooms: $("#back-to-rooms"),
    sideRoomName: $("#side-room-name"),
    chatRoomName: $("#chat-room-name"),
    roster: $("#roster"),
    participantsMe: $("#participants-me"),
    sideRoomCount: $("#side-room-count"),
    participants: $("#participants"),
    reconnectAllBtn: $("#reconnect-all-btn"),
    focusBtn: $("#focus-btn"),
    homeView: $("#home-view"),
    roomsView: $("#rooms-view"),
    roomsGrid: $("#rooms-grid"),
    roomsSub: $("#rooms-sub"),
    chatView: $("#chat-view"),
    chatRoomSub: $("#chat-room-sub"),
    chatInfoBtn: $("#chat-info-btn"),
    carryBtn: $("#carry-btn"),
    search: $("#search"),
    messages: $("#messages"),
    jumpLatest: $("#jump-latest"),
    doneNotes: $("#done-notes"),
    mentionMenu: $("#mention-menu"),
    emojiMenu: $("#emoji-menu"),
    emojiBtn: $("#emoji-btn"),
    sideRoomEmoji: $("#side-room-emoji"),
    composer: $("#composer"),
    shotsTray: $("#shots-tray"),
    quotesTray: $("#quotes-tray"),
    lightbox: $("#lightbox"),
    input: $("#input"),
    pageView: $("#page-view"),
    pageInner: $("#page-inner"),
    details: $("#details"),
    detailsInner: $("#details-inner"),
    detailsResizer: $("#details-resizer"),
    toasts: $("#toasts"),
    pfDialog: $("#profile-dialog"),
    roomDialog: $("#room-dialog"),
    sideRoomsTitle: $("#side-rooms-title"),
    sideToggle: $("#side-toggle"),
    rcDialog: $("#reconnect-dialog"),
    loginDialog: $("#login-dialog"),
    secretDialog: $("#secret-dialog"),
    setupDialog: $("#setup-dialog"),
    eraseDialog: $("#erase-dialog"),
  };
  const composer = lifetime.use(Composer.attach(els.input, {
    resolveToken: (kind, n) => composerToken(kind, n),
    resolveMention: (name) => composerMention(name),
    onText: (text) => reconcileAttachments(text),
    onChange: () => composerChanged(),
    onPaste: (e) => pasteIntoComposer(e),
  }));

  const reader = VIBEROOM_READER.create({
    fetchSpeech: async (text, signal) => {
      const res = await net.request("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ text }), signal, deadlineMs: 75_000 });
      if (!res.ok) throw new Error((await readJson(res, signal)).error || `HTTP ${res.status}`);
      return net.read(res, "blob");
    },
    onChange: (key, st, error) => {
      drawReading(key, st);
      if (error) toast(error.message, "warn");
    },
  });
  lifetime.use(reader);
  if (window.speechSynthesis?.addEventListener) lifetime.on(window.speechSynthesis, "voiceschanged", () => { if (state.view === "settings" && $("#sp-read-voice")) renderSettingsPage(); });

  const voiceControl = lifetime.use(VIBEROOM_VOICE.attach({
    UI,
    root: uiRoot,
    onListen: () => reader.stop(),
    button: $("#mic-btn"),
    panel: $("#voice-panel"),
    readiness: () => state.voice?.ready ? { ready: true } : { ready: false, reason: `${state.voice?.reason || "No provider is chosen yet"}: Settings → Voice.`, almost: almostOn(state.voice) },
    openSettings: () => openSettings("voice"),
    transcribe: async (recording) => (await post("/api/voice/transcribe", { ...recording, room: currentRoom()?.id })).text,
    insert: (text) => {
      const start = composer.selectionStart, end = composer.selectionEnd, value = composer.value;
      const before = value.slice(0, start), after = value.slice(end);
      composer.setRangeText(`${before && !/\s$/.test(before) ? " " : ""}${text}${after && !/^\s/.test(after) ? " " : ""}`, start, end, "end");
      composer.focus();
    },
    sendRecording: (recording) => {
      if (lifetime.disposed) return;
      const item = { name: "voice message", mimeType: recording.mimeType, url: createObjectUrl(recording.blob), seconds: recording.seconds };
      if (addTimed("audio", item)) sendToRoom(item, recording.blob, "audio");
      els.composer.requestSubmit();
    },
    say: (text) => toast(text, "warn"),
  }));
  listenKey(event => {
    if (!isBodyKey(event) || event.key !== "Escape" || !voiceControl.listening) return;
    event.preventDefault(); event.stopPropagation(); voiceControl.cancel();
  }, true);

  const slowTasks = [];
  function busyLabel() {
    try {
      const room = currentRoom();
      const parts = [];
      const streaming = room ? room.messages.filter((m) => m.streaming).length : 0;
      if (streaming) parts.push(`${streaming} reply streaming`);
      if (document.activeElement === els.input) parts.push("composer focused");
      if (room) parts.push(`${HistoryWindow.count(room)} messages`);
      return parts.join(" \u00b7 ");
    } catch {
      return "";
    }
  }
  function noteSlow(name, ms) {
    if (blankWatch.since && blankWatch.redraws.length < 6 && !name.startsWith("browser task") && /render|drawn|caught up|streamed/.test(name)) blankWatch.redraws.push(name);
    if (!(ms >= 8)) return;
    slowTasks.push({ at: Date.now(), ms: Math.round(ms), name, busy: busyLabel() });
    if (slowTasks.length > 60) slowTasks.splice(0, slowTasks.length - 40);
  }
  function noteFinding(name) {
    slowTasks.push({ at: Date.now(), ms: 0, name, busy: busyLabel() });
    if (slowTasks.length > 60) slowTasks.splice(0, slowTasks.length - 40);
  }

  const BLANK_MIN_PX = 250;
  const blankWatch = { since: 0, scrolled: false, redraws: [], clear: 1, wired: false };
  function measureBlank() {
    const list = els.messages;
    if (!list) return null;
    const entering = els.chatView?.getAnimations?.().some(animation => animation.animationName === "fade-in"
      && animation.playState === "running" && animation.playbackRate > 0
      && Number.isFinite(animation.effect?.getComputedTiming?.().endTime));
    if (entering) return null;
    const b = Layout.rect(list);
    if (!b.height) return null;
    const quiet = list.querySelector(":scope > .empty-room");
    if (quiet) {
      const room = currentRoom(), facts = room && quietFacts(room), box = Layout.rect(quiet);
      const visible = typeof quiet.checkVisibility !== "function" || quiet.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
      const current = facts?.eligible && quietDrawnFrom.get(quiet) === facts.roomIdentity && quiet.dataset.quiet === VIBEROOM_EMPTY_CONVERSATION.quietKey(facts);
      if (current && visible && box.height > 0 && box.bottom > b.top && box.top < b.bottom) {
        return { blankPx: 0, blankTop: 0, listPx: Math.round(b.height), scrollTop: Math.round(list.scrollTop), painted: 0, unpainted: [], pages: [], under: [], msgs: list.querySelectorAll(".msg").length, quiet: true };
      }
    }
    const painted = [];
    const unpainted = [];
    const near = new Set();
    const pages = [];
    for (const page of list.querySelectorAll(".msgs-page")) {
      const pr = Layout.rect(page);
      if (pr.bottom < b.top || pr.top > b.bottom) continue;
      near.add(page);
      const inside = page.firstElementChild;
      const shown = inside && typeof inside.checkVisibility === "function" ? inside.checkVisibility({ contentVisibilityAuto: true }) : true;
      if (pages.length < 3) pages.push({ h: Math.round(pr.height), kids: page.children.length, skipped: !shown });
    }
    for (const e of list.querySelectorAll(".msg")) {
      const page = e.parentElement;
      if (page && page.classList.contains("msgs-page") && !near.has(page)) continue;
      const r = Layout.rect(e);
      if (r.bottom < b.top || r.top > b.bottom) continue;
      const ok = typeof e.checkVisibility === "function" ? e.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }) : true;
      const ink = e.querySelector(".bubble") || (e.classList.contains("system") || e.classList.contains("hidden") ? e.firstElementChild : null);
      const br = ink && Layout.rect(ink);
      if (ok && br && br.height > 0) painted.push([Math.max(br.top, b.top), Math.min(br.bottom, b.bottom)]);
      else if (unpainted.length < 5) unpainted.push({ seq: e.dataset.seq || "", cls: e.className, h: Math.round(r.height), op: getComputedStyle(e).opacity, skipped: !ok, ...animationOf(e) });
    }
    painted.sort((x, y) => x[0] - y[0]);
    let gap = 0;
    let gapAt = b.top;
    let cover = b.top;
    for (const [top, bottom] of painted) {
      if (top - cover > gap) {
        gap = top - cover;
        gapAt = cover;
      }
      cover = Math.max(cover, bottom);
    }
    if (b.bottom - cover > gap) {
      gap = b.bottom - cover;
      gapAt = cover;
    }
    const under = gap > 40 ? document.elementsFromPoint(Math.round(b.left + b.width / 2), Math.round(gapAt + gap / 2)).slice(0, 5).map((e) => `${e.tagName}.${(e.className || "").toString().split(" ")[0] || ""}`) : [];
    return { blankPx: Math.round(gap), blankTop: Math.round(gapAt - b.top), listPx: Math.round(b.height), scrollTop: Math.round(list.scrollTop), painted: painted.length, unpainted, pages, under, msgs: list.querySelectorAll(".msg").length };
  }
  function animationOf(el) {
    try {
      const run = typeof el.getAnimations === "function" ? el.getAnimations()[0] : null;
      if (!run) return { anim: "none" };
      return { anim: String(run.playState), animAt: Math.round(Number(run.currentTime) || 0) };
    } catch {
      return { anim: "unknown" };
    }
  }

  function reportBlank(stage, extra) {
    const room = currentRoom();
    if (!room || !blankWatch.facts) return;
    void post("/api/window/finding", {
      kind: "blank-fragment",
      roomId: room.id,
      since: blankWatch.since,
      stage,
      ...blankWatch.facts,
      ...extra,
    }).catch(() => {});
  }
  function watchBlank() {
    if (!els.messages) return;
    if (!blankWatch.wired) {
      blankWatch.wired = true;
      lifetime.on(els.messages, "scroll", () => { if (blankWatch.since) blankWatch.scrolled = true; }, { passive: true });
    }
    if (document.hidden || state.view !== "room") return;
    const facts = measureBlank();
    if (!facts) return;
    const blank = facts.blankPx > BLANK_MIN_PX && facts.blankPx > facts.listPx / 3;
    if (blank && !blankWatch.since && blankWatch.clear > 0) {
      blankWatch.since = Date.now();
      blankWatch.scrolled = false;
      blankWatch.redraws = [];
      const room = currentRoom();
      blankWatch.facts = { ...facts, streaming: !!room && room.messages.some((m) => m.streaming) };
      noteFinding(`blank fragment began: ${JSON.stringify(blankWatch.facts)}`);
      reportBlank("began", {});
    } else if (!blank && blankWatch.since) {
      const seconds = Math.round((Date.now() - blankWatch.since) / 1000);
      noteFinding(`blank fragment ended after ${seconds} s: ${blankWatch.scrolled ? "a scroll came in between" : "no scroll"}; redraws in between: ${blankWatch.redraws.join(" | ") || "none"}`);
      reportBlank("ended", { seconds, scrolled: blankWatch.scrolled, redraws: blankWatch.redraws.slice(0, 8) });
      blankWatch.since = 0;
      blankWatch.clear = 0;
    } else if (!blank) blankWatch.clear++;
  }
  setInterval(watchBlank, 3000);
  const LONG_FRAMES = typeof PerformanceObserver === "function" && (PerformanceObserver.supportedEntryTypes || []).includes("long-animation-frame");
  try {
    domResources.observe(PerformanceObserver, (list) => {
      for (const e of list.getEntries()) noteSlow(`browser task${LONG_FRAMES ? heldBy(e) : ""}`, e.duration);
    }).observer.observe({ entryTypes: [LONG_FRAMES ? "long-animation-frame" : "longtask"] });
  } catch {
  }
  function heldBy(entry) {
    const scripts = [...(entry.scripts || [])];
    const script = [...scripts].sort((a, b) => b.duration - a.duration)[0];
    const before = entry.renderStart ? Math.max(0, Math.round(entry.renderStart - entry.startTime)) : Math.round(entry.duration);
    const after = Math.max(0, Math.round(entry.duration) - before);
    const named = script ? [script.sourceFunctionName || script.invoker, String(script.sourceURL || "").split(/[/\\]/).pop()].filter(Boolean).join(" in ") : "";
    const forced = Math.round(scripts.reduce((sum, s) => sum + (s.forcedStyleAndLayoutDuration || 0), 0));
    const layout = forced >= 1 ? `, ${forced} ms of it forced layout` : "";
    const blocked = Math.round(entry.blockingDuration || 0);
    if (blocked >= 1) return ` · ${blocked} ms blocking: ${before} ms before drawing${named ? `, the longest script ${named}` : ""}${layout}, ${after} ms style & paint`;
    const own = Math.round(scripts.reduce((sum, s) => sum + (s.duration || 0), 0));
    return ` · no task over 50 ms: the frame waited ${before} ms to be drawn${own ? `; its scripts ${own} ms${named ? `, the longest ${named}` : ""}${layout}` : ""}, ${after} ms style & paint`;
  }

  const bursts = new Map();
  let burstTimer = 0;
  function noteBurst(kind, ms) {
    const seen = bursts.get(kind) || { times: 0, total: 0, worst: 0 };
    seen.times++;
    seen.total += ms;
    seen.worst = Math.max(seen.worst, ms);
    bursts.set(kind, seen);
    clearTimeout(burstTimer);
    burstTimer = setTimeout(flushBursts, 400);
  }
  function flushBursts() {
    for (const [kind, seen] of bursts) {
      noteSlow(seen.times === 1 ? `hub said ${kind}` : `hub said ${kind} ×${seen.times} (worst ${Math.round(seen.worst)} ms)`, seen.total);
    }
    bursts.clear();
  }

  const FONTS = globalThis.VIBEROOM_TOKENS.fonts;
  const STATUS_LABEL = { unstaffed: "needs a coding agent", starting: "starting…", idle: "ready", queued: "waiting…", thinking: "thinking…", working: "vibing…", writing: "vibing…", notes: "taking notes…", asking: "waiting for you", error: "needs you", offline: "offline", left: "left" };
  const STATUS_TONE = { idle: "ready", queued: "waiting", starting: "waiting", thinking: "thinking", working: "writing", writing: "writing", notes: "outline", asking: "attention", error: "attention", offline: "asleep", left: "asleep", unstaffed: "attention" };
  const TOOL_STATUSES = new Set(["pending", "in_progress", "completed", "failed"]);
  const TOKENS = globalThis.VIBEROOM_TOKENS;
  const FALLBACK_COLOR = () => TOKENS.active().elements.face.fallback;
  const colourOf = (p) => window.Avatars.castColour(p);
  const WORKING_SVG = '<span class="working-box">'
    + '<svg class="working body" viewBox="0 0 44 35" aria-hidden="true"><circle cx="20" cy="6.5" r="5.6" fill="currentColor"/><path d="M6 35L13.7 16.5a4 4 0 0 1 8 0L14 35z" fill="currentColor"/></svg>'
    + '<svg class="working arm far" viewBox="0 0 44 35" aria-hidden="true"><path d="M22 25.6h10.5" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/></svg>'
    + '<svg class="working still" viewBox="0 0 44 35" aria-hidden="true"><path d="M19 19.5L23 27" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/></svg>'
    + '<svg class="working arm near" viewBox="0 0 44 35" aria-hidden="true"><path d="M23 27h10.5" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/></svg>'
    + '<svg class="working still" viewBox="0 0 44 35" aria-hidden="true" title="working…"><rect x="26" y="30.2" width="15.5" height="3" rx="1" fill="currentColor"/><path d="M35.9 30.2L41.1 14h2.4l-5.1 16.2z" fill="currentColor"/></svg>'
    + '</span>';
  const THINKING_DOTS = '<span class="pending" title="thinking…"><i></i><i></i><i></i></span>';

  function rawShownStatus(room, p) {
    if (p.status !== "thinking") return p.status;
    if (p.notesTurn) return "notes";
    if ((room.permissions || []).some((perm) => perm.participantId === p.id)) return "asking";
    const draft = room.messages.find((m) => m.streaming && m.from === p.id);
    if (!draft) return "thinking";
    if ((draft.toolCalls || []).some((c) => c.status === "pending" || c.status === "in_progress")) return "working";
    return draft.text ? "writing" : "thinking";
  }
  const SHOWN_HOLD_MS = 1000;
  const shownHold = new Map();
  function shownStatus(room, p) {
    const raw = rawShownStatus(room, p);
    if (raw !== "thinking" && raw !== "working" && raw !== "writing") { shownHold.delete(p.id); return raw; }
    const now = Date.now();
    const held = shownHold.get(p.id);
    if (!held || raw === "working" || raw === held.status) { shownHold.set(p.id, { status: raw, candidate: null, since: now }); return raw; }
    if (held.candidate !== raw) { held.candidate = raw; held.since = now; }
    const left = SHOWN_HOLD_MS - (now - held.since);
    if (left > 0) { scheduleRosterRedraw(left + 50); return held.status; }
    shownHold.set(p.id, { status: raw, candidate: null, since: now });
    return raw;
  }
  function bubbleWorking(room, m) {
    const p = findById(room, m.from);
    const shown = p && p.kind === "agent" ? shownStatus(room, p) : null;
    if (shown === "working" || shown === "writing") return true;
    if (shown === "thinking" || shown === "notes") return false;
    return !!(m.text || (m.toolCalls && m.toolCalls.length));
  }
  function stopNoteText(m) { return VIBEROOM_MESSAGE_PARTS.stopNoteText(m); }
  function failNoteText(m) { return VIBEROOM_MESSAGE_PARTS.failNoteText(m); }
  function refreshLiveTails() {
    const room = currentRoom();
    if (!room) return;
    const byId = new Map(HistoryWindow.knownMessages(room).map((m) => [m.id, m]));
    for (const tail of els.messages.querySelectorAll(".msg[data-id] .live-tail")) {
      const m = byId.get(tail.closest(".msg").dataset.id);
      if (m && m.streaming) tail.classList.toggle("no-figure", !bubbleWorking(room, m));
    }
  }
  let rosterRedrawTimer = null;
  let rosterRedrawAt = 0;
  function scheduleRosterRedraw(ms) {
    const at = Date.now() + ms;
    if (rosterRedrawTimer && at >= rosterRedrawAt) return;
    if (rosterRedrawTimer) clearTimeout(rosterRedrawTimer);
    rosterRedrawAt = at;
    rosterRedrawTimer = setTimeout(() => { rosterRedrawTimer = null; renderSideRoom(); refreshLiveTails(); }, ms);
  }
  const ROOM_EMOJI = [
    "🎭", "🚀", "🧪", "🛠️", "🎨", "📚", "🧠", "💬", "🔬", "🎯", "🐙", "☕", "🌈", "🏗️", "🎮", "🔥", "🧩", "📈", "🗺️", "🎧", "🌱", "🏠", "🛸", "🧭",
    "🧑‍💻", "⚒️", "🔨", "🔧", "🔩", "⚙️", "🧰", "🪛", "🧱", "🏭", "🔌", "🖥️", "💻", "⌨️", "🤖", "🐛", "🐞", "⚡", "🔋",
    "📊", "📉", "🧮", "🔍", "🔭", "🧬", "⚗️", "🧲", "📡", "🛰️", "🗄️", "💾", "🗃️", "🌐", "🔗", "☁️",
    "✍️", "📝", "📖", "📰", "📜", "📎", "📌", "🗂️", "🏷️", "✉️", "📣", "🗣️", "🤝", "👥",
    "🖌️", "🖼️", "📷", "🎬", "🎥", "🎵", "🎹", "🎸", "🎤", "🎲", "♟️", "🧸", "🎪", "🎁",
    "📅", "⏰", "⏳", "🗳️", "⚖️", "🧾", "💰", "📦", "🚚", "🛒", "🏦", "🏢", "🎓", "🏫", "🏁", "🏆", "💎",
    "🔐", "🔑", "🛡️", "🚨", "🚦", "🧯", "🩺", "🧹", "♻️", "🧑‍🍳", "🧑‍🔬", "🧑‍🎨", "🧑‍🏫", "🧑‍🚀", "🕵️", "🧙",
    "🦉", "🦊", "🐼", "🐝", "🐢", "🐬", "🦄", "🐲", "🌍", "🌙", "⭐", "🌊", "🏔️", "🏝️", "🌲", "🍀", "🌸", "🍕", "🍎", "✨", "💡", "🔮", "🪄", "❤️",
  ];
  const pickerSlots = new Map();
  lifetime.own(() => { for (const picker of pickerSlots.values()) picker.dispose(); pickerSlots.clear(); });
  function replacePicker(slot, create) {
    lifetime.signal.throwIfAborted();
    pickerSlots.get(slot)?.dispose();
    const picker = create({ root: uiRoot, signal: lifetime.signal });
    pickerSlots.set(slot, picker);
    return picker;
  }
  const CLAMP_CHARS = 700;
  const CLAMP_PREFIX_CHARS = 1200;
  function clampedSource(text) {
    if (!text || text.length <= CLAMP_PREFIX_CHARS) return text;
    const paragraph = text.lastIndexOf("\n\n", CLAMP_PREFIX_CHARS);
    let head = text.slice(0, paragraph > CLAMP_PREFIX_CHARS / 2 ? paragraph : CLAMP_PREFIX_CHARS);
    if (!head.endsWith("\n") && head.slice(head.lastIndexOf("\n") + 1).trimStart().startsWith("|")) head = head.slice(0, head.lastIndexOf("\n") + 1);
    const lines = head.split("\n");
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end--;
    let from = end;
    while (from > 0 && lines[from - 1].trimStart().startsWith("|")) from--;
    const table = lines.slice(from, end);
    if (table.length && !table.some((line) => /^\s*\|[\s:|-]+\|\s*$/.test(line))) head = lines.slice(0, from).join("\n");
    if ((head.match(/^```/gm) || []).length % 2) head += "\n```";
    return head;
  }

  window.Icons.install();
  lifetime.use(window.Icons.playOnHover(uiRoot));
  const ic = (name, cls) => window.Icons.svg(name, cls);
  const rig = (name, cls) => window.Icons.rig(name, cls);
  $$("[data-icon]").forEach((el) => (el.innerHTML = ic(el.dataset.icon)));
  $$("[data-rig]").forEach((el) => (el.innerHTML = rig(el.dataset.rig)));


  const apiCalls = lifetime.use(VIBEROOM_APP_REQUESTS.create({ window: document.defaultView, transport: net,
    signal: lifetime.signal, isHeld: () => state.awaitingShell,
    onStall: () => toast("Still waiting for the room… It may be busy or restarting; this window reconnects on its own.", "warn"),
    onTimeout: () => resyncStream(),
  }));
  const settingsOperations = lifetime.use(VIBEROOM_SETTINGS_COMMANDS.create({ window: document.defaultView,
    requests: { get, post }, signal: lifetime.signal,
  }));
  const settingsCommands = settingsOperations.commands, settingsQueries = settingsOperations.queries;
  const roomCommands = VIBEROOM_ROOM_COMMANDS.create({ post });
  const ROOM_DEADLINE_MS = 60000;
  const deadline = (ms) => AbortSignal.timeout(ms || ROOM_DEADLINE_MS);
  async function readJson(response, signal) {
    return apiCalls.readJson(response, signal);
  }
  async function post(path, body, options) {
    if (state.embedded && !sharedSettings && /^\/api\/(?:profile|settings|restart|update|autostart|data-folder|looks|channels)(?:[/?]|$)/.test(path)) throw new Error("Open application settings to change this.");
    if (state.embedded && /^\/api\/rooms(?:[?]|$)/.test(path)) throw new Error("Open a room from the project's navigation.");
    return apiCalls.post(path, body, options);
  }
  async function get(path, options) {
    return apiCalls.get(path, options);
  }
  const roomApi = (suffix) => `/api/rooms/${encodeURIComponent(state.currentRoomId)}${suffix}`;
  async function uploadFile(roomId, blob, { as, name, type }, onProgress = () => {}) {
    net.signal.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const query = new URLSearchParams({ as, name: name || "", type: type || blob.type || "" });
    xhr.open("POST", `/api/rooms/${encodeURIComponent(roomId)}/files?${query}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    let shown = -1;
    try {
      await net.send(xhr, blob, (e) => {
        if (!e.lengthComputable) return;
        const percent = Math.floor((e.loaded / e.total) * 100);
        if (percent !== shown) onProgress((shown = percent));
      });
    } catch (error) {
      if (net.signal.aborted) throw error;
      if (error?.name === "NetworkError") throw new Error(`${name || "the file"} could not be sent to the room`);
      if (error?.name === "AbortError") throw new Error(`sending ${name || "the file"} was stopped`);
      throw error;
    }
    net.signal.throwIfAborted();
    let data = {};
    try { data = JSON.parse(xhr.responseText || "{}"); } catch { }
    if (xhr.status >= 200 && xhr.status < 300) return data;
    throw new Error(data.error || `HTTP ${xhr.status}`);
  }


  function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function hoverDelayMs(slow) {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(slow ? "--hover-delay-slow" : "--hover-delay"));
    return Number.isFinite(v) ? v : 0;
  }
  const hints = lifetime.use(VIBEROOM_HINTS.install({ root: uiRoot, layout: Layout, delayMs: () => hoverDelayMs(true) }));
  listenKey(event => { if (isBodyKey(event)) hints.hide(); }, true);
  lifetime.use(VIBEROOM_CONTEXT_MENU.install({ root: uiRoot }));
  lifetime.use(VIBEROOM_SAVE.install({ root: uiRoot, onError: (error) => showError(error) }));
  function editingInDetails() {
    const el = owns(document.activeElement) ? document.activeElement : null;
    const typing = !!el && !!el.closest && (!!el.closest("#details") || !!el.closest("#page-view")) && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    return typing || !!$('#details [data-ui="setting"] > .fold:not([hidden]), #page-view [data-ui="setting"] > .fold:not([hidden])');
  }
  function currentRoom() {
    const room = state.rooms.get(state.currentRoomId) || null;
    return state.embedded && room?.scope !== scope ? null : room;
  }
  function roomRecordKey(room) {
    return room?.id && Number.isFinite(room.createdAt) ? JSON.stringify([room.id, room.createdAt]) : null;
  }
  function roomOfRecord(key) {
    const room = typeof key === "string" ? state.rooms.get(JSON.parse(key)[0]) : null;
    return room && roomRecordKey(room) === key ? room : null;
  }
  function findByName(room, name) {
    const lower = name.toLowerCase();
    return (room ? room.participants : []).find((p) => p.name.toLowerCase() === lower) || null;
  }
  function findById(room, id) {
    return (room ? room.participants : []).find((p) => p.id === id) || null;
  }
  const messageRenderer = VIBEROOM_MESSAGE_RENDERER.create({ marked: window.marked, esc, UI, icon: ic, table: csvTable, findByName, colourOf, prismLanguageOf, time, holdsSelection });
  function openLink(target, isUrl) { return messageRenderer.openLink(...arguments); }
  function linkify(html) { return messageRenderer.linkify(...arguments); }
  function parseCsv(text) { return messageRenderer.parseCsv(...arguments); }
  function csvBlock(raw) { return messageRenderer.csvBlock(...arguments); }
  function mermaidBlock(code) { return messageRenderer.mermaidBlock(...arguments); }
  function mentions(room, html, addressed = []) { return messageRenderer.mentions(...arguments); }
  function decorate(room, html, addressed) { return messageRenderer.decorate(...arguments); }
  function renderStreamingWords(room, words, text, addressed) { return messageRenderer.renderStreamingWords(...arguments); }
  let selectionDuringPatch = null;
  let selectionDuringPatchOwner = null;
  let chatSelection = null;
  function selectionSnapshot(selection) {
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    return { anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset, focusNode: selection.focusNode, focusOffset: selection.focusOffset, isCollapsed: false, range: selection.getRangeAt(0).cloneRange() };
  }
  const editors = new Map();
  function editingHere() {
    for (const held of editors.values()) if (held.roomId === state.currentRoomId) return true;
    return false;
  }
  function forgetGoneEditors(room) {
    for (const [id, held] of editors) if (held.roomId === room.id && !room.messages.some((m) => m.id === id)) editors.delete(id);
  }
  let textPress = null;
  const deferredMessageParts = new WeakMap();
  function holdsSelection(el) {
    if (textPress && el.contains(textPress)) return true;
    const sel = selectionDuringPatch || chatSelection;
    if (!sel || sel.isCollapsed) return false;
    if (el.contains(sel.anchorNode) || el.contains(sel.focusNode)) return true;
    return !!sel.range && sel.range.intersectsNode(el);
  }
  function canPaintMessagePart(el, part) {
    if (holdsSelection(el)) {
      const pending = deferredMessageParts.get(el) || new Set();
      pending.add(part); deferredMessageParts.set(el, pending);
      return false;
    }
    const pending = deferredMessageParts.get(el);
    pending?.delete(part);
    if (!pending?.size) deferredMessageParts.delete(el);
    return true;
  }
  function humanHoldsText() {
    return heldTextSelection || !!textPress || editingHere();
  }
  function renderMarkdown(room, text, addressed) { return messageRenderer.renderMarkdown(...arguments); }
  function renderText(room, text, images, quotes, addressed, audio, video, numbers) { return messageRenderer.renderText(...arguments); }
  function soundRefs(html, audio) { return messageRenderer.soundRefs(...arguments); }
  function videoRefs(html, video) { return messageRenderer.videoRefs(...arguments); }
  function messageRefs(html, numbers) { return messageRenderer.messageRefs(...arguments); }
  function quoteRefs(html, quotes) { return messageRenderer.quoteRefs(...arguments); }
  function quoteCard(q) { return messageRenderer.quoteCard(...arguments); }
  function imageRefs(html, images) { return messageRenderer.imageRefs(...arguments); }
  function renderTextLight(room, text, addressed) { return messageRenderer.renderTextLight(...arguments); }

  const codeColours = lifetime.use(VIBEROOM_CODE_COLOURS.create(uiRoot, {
    window: document.defaultView, signal: lifetime.signal, esc,
    loadPrism: () => vendors.loadPrism(), loadLanguage: id => vendors.loadLanguage(id),
  }));
  function loadPrism() { return codeColours.loadPrism(); }
  function loadLanguage(id) { return codeColours.loadLanguage(id); }
  function prismLanguageOf(word) { return VIBEROOM_CODE_COLOURS.languageOf(word); }
  function highlight(code, language) { return codeColours.highlight(code, language); }
  function highlightBlocks(root, canPaint) { return codeColours.blocks(root, canPaint); }
  function codeWithGutter(code, language, firstLine) { return VIBEROOM_CODE_COLOURS.withGutter(code, language, firstLine, esc); }


  const { VIEWABLE_RE, IMAGE_RE } = VIBEROOM_MESSAGE_PREVIEWS;
  const messagePreviews = lifetime.use(VIBEROOM_MESSAGE_PREVIEWS.create(uiRoot, { window: document.defaultView, signal: lifetime.signal, UI, esc,
    currentRoom, roomRecordKey, requests: { get, post, transport: net }, renderMarkdown, csvTable, codeWithGutter, highlightBlocks, renderDiagrams,
    viewFile, openLightbox, soundLength: (...args) => soundLength(...args), toast, icon: ic, onError: showError,
  }));
  function readableInRoom() { return messagePreviews.readableInRoom(...arguments); }
  function imageUrl() { return messagePreviews.imageUrl(...arguments); }
  function mediaUrl() { return messagePreviews.mediaUrl(...arguments); }
  function splitLine() { return messagePreviews.splitLine(...arguments); }
  function docPreview() { return messagePreviews.docPreview(...arguments); }
  function docRange() { return messagePreviews.docRange(...arguments); }
  function previewCard() { return messagePreviews.previewCard(...arguments); }
  function fetchPreview() { return messagePreviews.fetchPreview(...arguments); }
  function placeFragmentCard() { return messagePreviews.placeFragmentCard(...arguments); }
  function imageCard() { return messagePreviews.imageCard(...arguments); }
  function mediaCard() { return messagePreviews.mediaCard(...arguments); }
  function renderPreviews() { return messagePreviews.renderPreviews(...arguments); }
  function resolveInRoom() { return messagePreviews.resolveInRoom(...arguments); }
  function textNodesOf() { return messagePreviews.textNodesOf(...arguments); }
  function linkRelativePaths() { return messagePreviews.linkRelativePaths(...arguments); }
  const cssEscape = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));
  function csvTable(rows) {
    if (!rows.length) return '<p class="lead">Empty file.</p>';
    const cell = (tag, v) => `<${tag}>${esc(v)}</${tag}>`;
    const [head, ...body] = rows;
    const width = Math.max(head.length, ...body.map((r) => r.length));
    const pad = (r) => r.concat(Array(Math.max(0, width - r.length)).fill(""));
    return `<div class="csv-wrap"><table class="csv"><thead><tr>${pad(head).map((v) => cell("th", v)).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${pad(r).map((v) => cell("td", v)).join("")}</tr>`).join("")}</tbody></table></div><p class="csv-count">${body.length} row${body.length === 1 ? "" : "s"} · ${width} column${width === 1 ? "" : "s"}</p>`;
  }
  function viewFile(path, line) { return fileViewer.open(path, line); }


  const DIAGRAM_PRESETS = TOKENS.diagrams.presets;
  const diagrams = lifetime.use(VIBEROOM_DIAGRAM_RENDERER.create(uiRoot, { window: document.defaultView, signal: lifetime.signal,
    tokens: TOKENS, settings: () => state.settings && state.settings.diagrams, loadMermaid, withMermaid, renderMermaid,
    ownerOf: diagramOwner, isCurrent: currentDiagram, reportFailure: reportDiagramFailure, onError: showError, noteSlow, esc, icon: ic,
  }));
  function diagramSettings() { return diagrams.diagramSettings(...arguments); }
  function diagramPreset() { return diagrams.diagramPreset(...arguments); }
  function diagramFontPx() { return diagrams.diagramFontPx(...arguments); }
  function diagramStage() { return diagrams.diagramStage(...arguments); }
  function mermaidThemeVariables() { return diagrams.mermaidThemeVariables(...arguments); }
  function diagramPalette() { return diagrams.diagramPalette(...arguments); }
  function mermaidCss() { return diagrams.mermaidCss(...arguments); }
  function diagramFonts() { return diagrams.diagramFonts(...arguments); }
  function paintDiagram() { return diagrams.paintDiagram(...arguments); }
  function renderDiagrams() { return diagrams.renderDiagrams(...arguments); }
  function drawDiagrams() { return diagrams.drawDiagrams(...arguments); }
  function showDiagramRepairing() { return diagrams.showDiagramRepairing(...arguments); }
  function showDiagramError() { return diagrams.showDiagramError(...arguments); }
  function rerenderDiagrams() { return diagrams.rerenderDiagrams(...arguments); }
  function loadMermaid() {
    if (lifetime.disposed) return Promise.reject(lifetime.signal.reason);
    vendors.mermaid ??= import("/vendor/mermaid/mermaid.esm.min.mjs").then((module) => module.default, () => { throw new Error("could not load Mermaid from the room"); });
    return lifetime.wait(vendors.mermaid);
  }
  function withMermaid(work) {
    const run = vendors.mermaidTurn.then(() => {
      if (lifetime.disposed) throw lifetime.signal.reason;
      return work();
    });
    vendors.mermaidTurn = run.catch(() => {});
    return lifetime.wait(run);
  }
  async function renderMermaid(mermaid, src, prefix = "mm") {
    if (lifetime.disposed) throw lifetime.signal.reason;
    const id = `${prefix}-${++vendors.mermaidSeq}`, stage = diagramStage(id);
    try { return await mermaid.render(id, src, stage); }
    finally { stage.remove(); }
  }
  function diagramOwner(block) {
    const el = block.closest(".msg[data-id]"), words = block.closest(".words");
    if (!el) return null;
    const target = words && textWork.targetOf(words), read = target && currentText(words, target);
    if (!read) return undefined;
    const frame = read.frame;
    const index = [...words.querySelectorAll(".mermaid-block")].filter((b) => !b.closest('[data-ui="file-card"]')).indexOf(block) + 1;
    return Object.freeze({ target, index, fromName: frame.fromName, repair: (frame.diagramRepairs || []).find(r => r.block === index),
      repairable: frame.kind === "chat" && frame.from !== "human" && !frame.streaming && !block.classList.contains("preview") && !block.closest('[data-ui="file-card"]') });
  }
  function currentDiagram(block, owner) {
    if (owner === undefined) return false;
    if (owner === null) return !block.closest(".msg");
    return !!currentText(block, owner.target);
  }
  async function reportDiagramFailure(block, owner, src, error, live = () => true) {
    if (!owner.repairable || !currentDiagram(block, owner) || !live()) return;
    let answer = null;
    try {
      answer = await sendDiagramFailure(block, owner, src, error);
    } catch (failure) {
      if (failure?.code === "room_replaced" || failure?.status === 409) return;
    }
    if (!currentDiagram(block, owner) || !live()) return;
    if (answer && answer.state === "repairing") showDiagramRepairing(block, owner);
    else showDiagramError(block, src, error);
  }
  function sendDiagramFailure(block, owner, src, error) {
    const read = currentText(block, owner.target);
    if (!read) return;
    const uuid = owner.target.roomIdentity.uuid;
    const query = uuid ? `?room=${encodeURIComponent(uuid)}` : "";
    return post(`/api/rooms/${encodeURIComponent(owner.target.roomId)}/messages/${encodeURIComponent(read.frame.id)}/diagram${query}`, { block: owner.index, source: src, error });
  }
  const timeFormatter = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
  const fullTimeFormatter = new Intl.DateTimeFormat([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const shortDateFormatter = new Intl.DateTimeFormat([], { day: "numeric", month: "short" });
  const dayFormatter = new Intl.DateTimeFormat([], { weekday: "short", day: "numeric", month: "short" });
  const dayLabels = new Map();
  let dayLabelsFor = null;
  function time(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? "Invalid Date" : timeFormatter.format(d);
  }
  function fullTime(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? "Invalid Date" : fullTimeFormatter.format(d);
  }
  function relTime(ts) {
    if (!ts) return "";
    const d = Date.now() - ts;
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.floor(d / 60000)} min ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)} h ago`;
    return shortDateFormatter.format(new Date(ts));
  }
  function localDay(ts) {
    const d = new Date(ts);
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  }
  function dayLabel(ts) {
    const now = Date.now();
    if (!dayLabelsFor || now >= dayLabelsFor.until) {
      const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
      dayLabelsFor = { today: localDay(now), until: midnight.getTime() };
      dayLabels.clear();
    }
    const day = localDay(ts);
    if (Number.isNaN(day)) return "Invalid Date";
    let label = dayLabels.get(day);
    if (label === undefined) {
      label = day === dayLabelsFor.today ? "Today" : day === dayLabelsFor.today - 1 ? "Yesterday" : dayFormatter.format(new Date(ts));
      dayLabels.set(day, label);
    }
    return label;
  }
  function fmtTokens(n) {
    if (n === undefined || n === null) return "";
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }
  function fmtDuration(ms) {
    if (!ms || ms < 0) return "";
    const total = Math.round(ms / 1000);
    if (total < 60) return `${(ms / 1000).toFixed(1)} s`;
    const ss = String(total % 60).padStart(2, "0");
    const m = Math.floor(total / 60);
    if (m < 60) return `${m}:${ss} min`;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${ss} h`;
  }
  function fmtCost(cost) {
    return cost ? `${cost.amount.toFixed(3)} ${cost.currency}` : "";
  }
  function nearBottom() {
    const el = els.messages;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }
  function atEnd() {
    const el = els.messages;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 12;
  }
  function replyStreaming() {
    const room = currentRoom();
    return !!room && room.messages.some((m) => m.streaming);
  }
  function deliberateReturn() {
    return atEnd() && !replyStreaming();
  }
  let stuck = true;
  let readingAway = false;
  const CALM = (() => { const v = new URLSearchParams(location.search).get("calm"); return ["hold", "reserve", "reserve-cap"].includes(v) ? v : "off"; })();
  const calm = { held: false, reserve: 0, initial: 0, baseContent: 0 };
  if (CALM !== "off" && !state.embedded) document.documentElement.dataset.calm = CALM;
  function calmStart(id) {
    if (CALM === "hold") {
      scrollToBottom("a live reply begins");
      stuck = false;
      calm.held = true;
      els.jumpLatest.hidden = false;
      return;
    }
    const el = els.messages;
    const bubble = el.querySelector(`.msg[data-id="${id}"]`);
    if (!bubble) return scrollToBottom("a live reply begins");
    calmRelease();
    const third = Math.round(el.clientHeight / 3);
    let reserve = Math.max(0, el.clientHeight - third - bubble.offsetHeight);
    if (CALM === "reserve-cap") reserve = Math.min(reserve, Math.round(el.clientHeight / 2));
    calm.reserve = reserve;
    calm.initial = reserve;
    el.style.paddingBottom = `${reserve}px`;
    calm.baseContent = el.scrollHeight - reserve;
    el.scrollTop = Math.max(0, topInList(bubble) - third);
    lastScrollTop = el.scrollTop;
    stuck = false;
    calm.held = true;
    els.jumpLatest.hidden = false;
  }
  function calmAfterGrowth() {
    if (!calm.held || CALM === "hold" || humanHoldsText()) return;
    const el = els.messages;
    const grown = el.scrollHeight - calm.reserve - calm.baseContent;
    const next = Math.max(0, calm.initial - grown);
    if (next !== calm.reserve) {
      calm.reserve = next;
      el.style.paddingBottom = next ? `${next}px` : "";
    }
    if (next === 0) {
      calm.held = false;
      stuck = true;
      scrollToBottom("the room under the reply is used up");
    }
  }
  function calmRelease() {
    if (calm.reserve > 0) {
      calm.reserve = 0;
      calm.initial = 0;
      els.messages.style.paddingBottom = "";
    }
    calm.held = false;
  }
  let settling = 0;
  let settled = 0;
  const endJumps = [];
  function noteJump(why, byHand, viewport) {
    const el = els.messages;
    const top = viewport?.beforeTop ?? el.scrollTop;
    const entry = { at: Date.now(), why: why || "(unnamed)", byHand, following: stuck, readingAway, streaming: replyStreaming(), from: Math.round(top), fromEnd: Math.round(viewport ? viewport.total - top - viewport.height : el.scrollHeight - top - el.clientHeight) };
    endJumps.push(entry);
    if (endJumps.length > 30) endJumps.splice(0, endJumps.length - 20);
    if (!byHand && !stuck && entry.fromEnd > 12) reportJump(entry);
  }
  function noteHeldPlace(why) {
    const el = els.messages;
    endJumps.push({ at: Date.now(), why, held: true, following: stuck, readingAway, streaming: replyStreaming(), from: Math.round(el.scrollTop), fromEnd: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight) });
    if (endJumps.length > 30) endJumps.splice(0, endJumps.length - 20);
  }
  let lastListChange = null;
  let arrivalFromEnd = 0;
  function noteArrival(byHand) {
    const el = els.messages;
    const fromEnd = Math.round(el.scrollHeight - el.scrollTop - el.clientHeight);
    if (byHand) { arrivalFromEnd = fromEnd; return; }
    const was = arrivalFromEnd;
    if (stuck || fromEnd > 12 || was <= 40) return;
    arrivalFromEnd = 0;
    const last = lastListChange ? `${lastListChange.why}, ${Date.now() - lastListChange.at} ms ago` : "no change of the list noted";
    const entry = { at: Date.now(), why: `arrived at the end by itself (last: ${last})`, following: false, readingAway, streaming: replyStreaming(), from: Math.round(el.scrollTop), fromEnd: was };
    endJumps.push(entry);
    if (endJumps.length > 30) endJumps.splice(0, endJumps.length - 20);
    reportJump(entry);
  }
  function reportJump(entry) {
    const room = currentRoom();
    if (!room) return;
    const anchor = readerAnchor();
    void post("/api/window/finding", {
      kind: "end-jump",
      roomId: room.id,
      why: entry.why,
      fromEnd: entry.fromEnd,
      scrollTop: entry.from,
      readingAway: entry.readingAway,
      streaming: entry.streaming,
      holdsText: humanHoldsText(),
      msgs: room.messages.length,
      anchorId: anchor ? anchor.id : "",
      into: anchor ? Math.round(anchor.into) : 0,
    }).catch(() => {});
  }
  function scrollToBottom(why, { byHand = false, viewport } = {}) {
    calmRelease();
    glideStop("the list went to its end");
    noteJump(why, byHand, viewport);
    els.messages.scrollTop = viewport?.total ?? els.messages.scrollHeight;
    els.jumpLatest.hidden = true;
    stuck = true;
    readingAway = false;
    settled = 0;
    if (!settling) settleBottom(20);
  }
  function followEnd(why) {
    if (stuck && !humanHoldsText()) scrollToBottom(why);
  }
  function settleBottom(frames) {
    settling = frames;
    requestAnimationFrame(() => {
      const el = els.messages;
      const short = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      if (stuck && short && !humanHoldsText()) el.scrollTop = el.scrollHeight;
      settled = short ? 0 : settled + 1;
      settling = settled >= 2 ? 0 : frames - 1;
      if (settling > 0) settleBottom(settling);
    });
  }
  function avatar(p, size, opts) {
    return window.Avatars.avatarHtml(p, size, Object.assign({ recipes: state.recipes }, opts || {}));
  }
  function meAvatarData() {
    const s = state.settings || {};
    return { name: s.humanName || "You", color: TOKENS.active().elements.face.humanInk, avatar: s.humanAvatar, kind: "human" };
  }
  const messageCopy = lifetime.use(VIBEROOM_MESSAGE_COPY.create(uiRoot, { window: document.defaultView, signal: lifetime.signal, tokens: TOKENS,
    currentRoom, roomRecordKey, isRecordLive: key => !!roomOfRecord(key), renderText, pictureData, diagramPng, shotUrl, toast, onError: showError,
  }));
  function copyClone() { return messageCopy.copyClone(...arguments); }
  function copyableHtml() { return messageCopy.copyableHtml(...arguments); }
  function portableHtml() { return messageCopy.portableHtml(...arguments); }
  function copyMessage() { return messageCopy.copyMessage(...arguments); }



  function readAsDataUrl(blob) {
    if (lifetime.disposed) return Promise.reject(lifetime.signal.reason);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      let settled = false, release = () => {};
      const finish = (settle, value) => {
        if (settled) return;
        settled = true;
        reader.onload = reader.onerror = reader.onabort = null;
        if (reader.readyState === 1) reader.abort();
        release(); settle(value);
      };
      release = lifetime.own(() => finish(reject, lifetime.signal.reason));
      reader.onload = () => finish(resolve, String(reader.result));
      reader.onerror = () => finish(reject, reader.error);
      reader.onabort = () => finish(reject, reader.error || new DOMException("The file read was aborted", "AbortError"));
      try { reader.readAsDataURL(blob); } catch (error) { finish(reject, error); }
    });
  }
  async function pictureData(src) {
    const response = await net.request(src, { deadlineMs: 30000 });
    if (!response.ok) throw new Error(`the picture did not load (${response.status})`);
    const blob = await net.read(response, "blob");
    net.signal.throwIfAborted();
    const data = await readAsDataUrl(blob);
    net.signal.throwIfAborted();
    return data;
  }
  function diagramPng(src) {
    return withMermaid(async () => {
      const mermaid = await loadMermaid();
      if (lifetime.disposed) throw lifetime.signal.reason;
      const d = diagramSettings();
      const preset = DIAGRAM_PRESETS[d.preset] || DIAGRAM_PRESETS.pop;
      const vars = Object.assign({}, preset, { fontFamily: "Arial, Helvetica, sans-serif", fontSize: "14px" });
      delete vars.label;
      delete vars.palette;
      if (preset.palette) preset.palette.forEach((c, i) => (vars[`pie${i + 1}`] = c.fill));
      if (d.primary) {
        vars.primaryColor = d.primary;
        delete vars.primaryBorderColor;
        delete vars.primaryTextColor;
      }
      mermaid.initialize({ startOnLoad: false, theme: "base", securityLevel: "strict", htmlLabels: false, themeVariables: vars, themeCSS: mermaidCss(), flowchart: { htmlLabels: false, curve: "basis", padding: 14, nodeSpacing: 44, rankSpacing: 52 } });
      const { svg } = await renderMermaid(mermaid, src, "mm-copy");
      if (lifetime.disposed) throw lifetime.signal.reason;
      const holder = document.createElement("div");
      holder.innerHTML = svg;
      const root = holder.querySelector("svg");
      if (preset.palette && !d.primary) paintDiagram(root, preset.palette, preset.primaryTextColor || TOKENS.portable.ink);
      const box = root.viewBox && root.viewBox.baseVal;
      const width = Math.ceil(box && box.width ? box.width : 600), height = Math.ceil(box && box.height ? box.height : 400);
      root.setAttribute("width", String(width));
      root.setAttribute("height", String(height));
      root.removeAttribute("style");
      const image = new Image();
      const releaseImage = lifetime.own(() => image.removeAttribute("src"));
      try {
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
        await lifetime.wait(image.decode());
        if (lifetime.disposed) throw lifetime.signal.reason;
        const canvas = document.createElement("canvas"), scale = 2;
        canvas.width = width * scale;
        canvas.height = height * scale;
        const g = canvas.getContext("2d");
        g.fillStyle = TOKENS.portable.paper;
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(image, 0, 0, canvas.width, canvas.height);
        return { src: canvas.toDataURL("image/png"), width, height };
      } finally { releaseImage(); }
    });
  }


  const toastView = lifetime.use(VIBEROOM_TOAST_VIEW.create(els.toasts, { signal: lifetime.signal, icon: ic, window }));
  function toast(text, level, action) { toastView.show(text, level, action); }
  const notice = toast;
  function showError(error) {
    if (lifetime.disposed) return;
    toast(error && error.message ? error.message : String(error), "error");
  }
  const TRANSCRIPT_LABEL = { off: "off", errors: "when something fails", full: "all activity" };
  function followsAppWords(now) {
    return now ? `Use the app setting (now: ${now})` : "Use the app setting";
  }
  const SHARES_HISTORY_HINT = "Vibemates of the other rooms may find messages written here, and their memory may read what this room's memory learned. Hidden and deleted messages are never shared. Off: this room is searched only from inside it.";
  const REMEMBERS_HINT = "A room feeds the long-term memory: its messages, sifted, become facts the vibemates recall later. On for a new room; each room keeps its own switch. Does nothing until the memory is set up and agreed to.";
  const READS_OTHER_ROOMS = [["off", "No"], ["on-search", "When a vibemate searches"], ["every-turn", "Also in each turn's memory block"]];
  const MEMORY_INPUT = [["excerpts", "Economical: the message's own excerpts"], ["whole", "Most accurate: the whole message"]];
  const MEMORY_INPUT_HINT = "What a kept message becomes in the long-term memory. Economical: the sieve names the sentences that carry the information and the code checks them letter for letter against the message; nothing is retold. Most accurate: the whole message, with Zep; it may cost more.";
  const MEMORY_INPUT_GEEK = "Short kept messages go whole in every mode. In the economical mode a long message goes as its excerpts, in the message's order with a mark where something was left out; an excerpt the message does not contain, out of order, or more than two thirds of the message sends the message's own first lines instead, never a retelling. The Memory button on a bubble (Settings → Development) shows the excerpts and their check.";
  const READS_OTHER_ROOMS_HINT = "Vibemates here may search the rooms that share their history: their messages, and what their memory learned. With the last, in a room that remembers, each turn's memory block reads those rooms too.";
  const READS_OTHER_ROOMS_GEEK = "Only a room that shares its history can be searched, and only a room that remembers has a memory to read; each borrowed fact names the room it was heard in. Where the rooms talk of different things, the other rooms' facts in a turn's block are mostly noise and seldom useful, so a vibemate's own search is the usual way to them.";
  const DIAGNOSTIC_LOG_HELP = "Save details to help investigate problems with a vibemate. Choose All activity while checking a reply that gets stuck. Diagnostic files keep up to 64 MB across rooms, 5 MB per file, for up to seven days. Older details are removed and unusually large entries are shortened. Conversations are saved separately and are not shortened.";
  function geekTip(text) {
    return `<button type="button" class="geek-tip" title="For geeks">${ic("geek")}for geeks</button><span class="geek-text" hidden>${text}</span>`;
  }
  lifetime.use(VIBEROOM_CONTROLS.mount(uiRoot, { signal: lifetime.signal, window }));
  function vendorLogo(r, size) {
    return UI.html("logo-tile", { icon: r.icon || "", letter: r.vendor[0], size: size || "md", title: r.vendor });
  }
  function devBuild() {
    return !!(state.version && state.version.sourceCheckout);
  }
  function slowTasksHtml() {
    if (!slowTasks.length) return '<p class="hint">Nothing over 8 ms so far in this window.</p>';
    const rows = [...slowTasks]
      .reverse()
      .slice(0, 25)
      .map((t) => `<tr><td>${esc(new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</td><td class="ms"><b>${t.ms} ms</b></td><td title="${esc(t.name)}">${esc(t.name)}</td><td class="hint" title="${esc(t.busy)}">${esc(t.busy)}</td></tr>`);
    return `<div class="slow-scroll"><table class="slow-table">${rows.join("")}</table></div>`;
  }
  function endJumpsHtml() {
    if (!endJumps.length) return '<p class="hint">The chat has not moved to the newest message by itself in this window.</p>';
    const rows = [...endJumps]
      .reverse()
      .slice(0, 20)
      .map((j) => `<tr><td>${esc(new Date(j.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</td><td title="${esc(j.why)}">${j.held ? "held: " : ""}${esc(j.why)}</td><td class="dim">${j.following ? "following the end" : `${j.fromEnd} px above the end`}${j.streaming ? " · a reply was streaming" : ""}</td></tr>`)
      .join("");
    return `<div class="slow-scroll"><table class="slow-table">${rows}</table></div>`;
  }
  function endJumpsText() {
    return [...endJumps].reverse().map((j) => `${new Date(j.at).toLocaleTimeString()} - ${j.held ? "held: " : ""}${j.why} - ${j.following ? "following the end" : `${j.fromEnd} px above the end`}${j.streaming ? " - a reply was streaming" : ""}`).join("\n");
  }
  let boxTrace = { state: "idle" };
  const boxTraceStatus = () => ({
    idle: "Not recorded yet. Press Record, then do what lags (type, scroll, let a vibemate answer) for the next 15 s.",
    recording: "Recording for 15 s: do what lags now.",
    done: `${boxTrace.summary}\n${boxTrace.file}`,
    failed: `The trace was not recorded: ${boxTrace.error}`,
  })[boxTrace.state];
  function boxTraceHtml() {
    if (!(window.ViberoomDesktop && window.ViberoomDesktop.can("trace"))) return "";
    return settingRow({ label: "Trace of the whole app", hint: "Every process of this app for 15 s, the graphics card's included, for a moment when the window lags or stutters: press Record, then do what lags. The file stays on this computer; copy the summary into the room.", status: boxTraceStatus(), statusId: "sp-trace-status",
      control: UI.raw(UI.html("button", { label: "Record 15 s", kind: "secondary", size: "sm", id: "sp-trace-record", disabled: boxTrace.state === "recording" }) + UI.html("button", { label: "Copy the summary", kind: "secondary", size: "sm", id: "sp-trace-copy" })) });
  }
  function paintBoxTrace() {
    if (state.view !== "settings") return;
    const status = $("#sp-trace-status");
    if (status) status.textContent = boxTraceStatus();
    const record = $("#sp-trace-record");
    if (record) record.disabled = boxTrace.state === "recording";
  }
  lifetime.on(window, "message", (event) => {
    if (state.embedded && !sharedSettings) return;
    const answer = event.data;
    if (event.source !== window || event.origin !== location.origin || !["done", "failed"].includes(answer?.viberoomTrace)) return;
    boxTrace = answer.viberoomTrace === "done" ? { state: "done", file: String(answer.file), summary: String(answer.summary) } : { state: "failed", error: String(answer.error) };
    paintBoxTrace();
  });

  function slowTasksText() {
    return [...slowTasks].reverse().map((t) => `${new Date(t.at).toLocaleTimeString()} - ${t.ms ? `${t.ms} ms - ` : ""}${t.name}${t.busy ? ` - ${t.busy}` : ""}`).join("\n");
  }
  function wheelTraceText() {
    const since = performance.now() - 120_000;
    const lines = [];
    let start = 0;
    for (const w of wheelTrace) {
      if (w.at < since) continue;
      if (w.kind === "wheel" && w.gap === null) {
        start = w.at;
        lines.push(`a gesture at ${new Date(performance.timeOrigin + w.at).toLocaleTimeString()}${w.busy ? ` (${w.busy})` : ""}`);
      }
      const t = `+${Math.round(w.at - start)} ms`.padStart(10);
      if (w.kind === "wheel") lines.push(`${t}  wheel ${w.dy} ${["px", "lines", "pages"][w.mode] || "?"}${w.gap === null ? "" : `, ${w.gap} ms after the last`}, heard ${w.waited} ms late -> ${w.took}`);
      else if (w.kind === "frame") lines.push(`${t}  a late frame, ${w.late} ms after the last, ${w.step} px in one move`);
      else if (w.kind === "shift") lines.push(`${t}  the list moved ${w.px} px under the motion, which went on with it`);
      else lines.push(`${t}  the motion stopped: ${w.why}`);
    }
    if (!lines.length) return "";
    return [`viberoom ${state.version?.version || "?"}, devicePixelRatio ${window.devicePixelRatio}, CSS zoom ${Layout.scale}`, ...lines].join("\n");
  }
  function wheelTraceSummary() {
    const first = wheelTrace.findLastIndex((w) => w.kind === "wheel" && w.gap === null);
    if (first < 0) return "No wheel on the chat yet in this window.";
    const gesture = wheelTrace.slice(first);
    const wheels = gesture.filter((w) => w.kind === "wheel");
    const taken = wheels.filter((w) => /^(step|glide)/.test(w.took));
    const how = taken.length ? taken[0].took.split(/[: ]/)[0] : "";
    const late = gesture.filter((w) => w.kind === "frame").length;
    const waited = Math.max(...wheels.map((w) => w.waited));
    return `The last gesture: ${wheels.length} wheel event${wheels.length === 1 ? "" : "s"}, ${taken.length ? `${taken.length} taken by the ${how}` : "all native"}; heard up to ${waited} ms late${late ? `; ${late} late frame${late === 1 ? "" : "s"}` : ""}.`;
  }
  function bindCopy(button, textOf, empty, { listen = domResources.nodeListener } = {}) {
    if (!button) return;
    const current = () => !lifetime.disposed && uiRoot.contains(button);
    listen(button, "click", async () => {
      if (!current()) return;
      const words = button.querySelector(".label");
      const label = words.textContent;
      try {
        await lifetime.wait(navigator.clipboard.writeText(textOf() || empty));
        if (!current()) return;
        words.textContent = "Copied";
        lifetime.timeout(() => { if (current()) words.textContent = label; }, 1500);
      } catch (e) {
        if (current()) showError(e);
      }
    });
  }
  function settingRow(props) {
    return UI.html("setting", props);
  }
  function selectHtml(id, options, value, label) {
    return `<select class="select" id="${id}"${label ? ` aria-label="${esc(label)}"` : ""}>${options.map(([v, label]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
  }
  function numberHtml(props) {
    return UI.raw(UI.html("number-field", props));
  }
  function actHtml(props) {
    return UI.raw(UI.html("button", { kind: "secondary", size: "sm", ...props }));
  }
  function settingsCard(id, title, body, tone = "plain") {
    return UI.html("settings-group", { id, title, body: UI.raw(body), tone });
  }
  function revealSettingsFor(field) {
    const page = field?.closest?.('[data-ui="settings-category"]');
    if (page && page.hidden) {
      if (page.closest("#details-inner")) showPanelSection(page.dataset.category);
      else showSettingsCategory(page.dataset.category, { arrive: false });
    }
    for (let group = field?.closest?.("details"); group; group = group.parentElement?.closest("details")) group.open = true;
  }
  lifetime.on(uiRoot, "invalid", (e) => revealSettingsFor(e.target), true);
  const SAVED_MARK_MS = 2000;
  const recentlySaved = new Map();
  lifetime.own(() => recentlySaved.clear());
  function saveContext(container) {
    const details = !!container.closest("#details-inner");
    const room = details ? currentRoom() : null;
    return { view: state.view, details, roomId: room?.id || null, roomKey: roomRecordKey(room),
      kind: details ? state.selection.kind : null, id: details ? state.selection.id : null };
  }
  function sameSaveContext(a, b) {
    return a.view === b.view && a.details === b.details && a.roomId === b.roomId && a.roomKey === b.roomKey && a.kind === b.kind && a.id === b.id;
  }
  function saveContextTarget(context) {
    if (lifetime.disposed) return false;
    return !context.details || (context.roomKey !== null && roomRecordKey(currentRoom()) === context.roomKey
      && roomRecordKey(state.rooms.get(context.roomId)) === context.roomKey && state.selection.kind === context.kind && state.selection.id === context.id);
  }
  function saveContextCurrent(context) {
    return saveContextTarget(context) && state.view === context.view && (!context.details || state.detailsOpen);
  }
  function markSaved(fieldId, ms) {
    if (lifetime.disposed) return;
    const el = fieldId && byId(fieldId);
    const label = el && el.closest('[data-ui="setting"]')?.querySelector(".name-line");
    if (!label) return;
    const old = label.querySelector(".fsaved");
    if (old) old.remove();
    label.insertAdjacentHTML("beforeend", `<span class="fsaved">${ic("check")}Saved</span>`);
    const mark = label.lastElementChild;
    lifetime.timeout(() => mark.remove(), ms == null ? SAVED_MARK_MS : ms);
  }
  function bindSave(container, onSave, { listen = domResources.nodeListener, canStart = () => true, canShow = () => true } = {}) {
    if (!container) return;
    const context = saveContext(container), current = () => saveContextCurrent(context) && canShow();
    const target = () => saveContextTarget(context);
    const canSave = () => target() && canStart();
    let dirty = false;
    let saving = false;
    let again = false;
    let lastField = null;
    const arm = () => {
      if (canSave()) dirty = true;
    };
    const save = async () => {
      if (!canSave()) { dirty = false; again = false; return; }
      if (!dirty) return;
      if (saving) {
        again = true;
        return;
      }
      saving = true;
      dirty = false;
      const field = lastField;
      lastField = null;
      try {
        const outcome = await lifetime.wait(onSave(current, target));
        if (current()) {
          if (outcome === false) revealSettingsFor(byId(field) || container);
          if (field && outcome !== false) {
            recentlySaved.set(field, { at: Date.now(), context });
            markSaved(field);
          }
        }
      } catch (e) {
        if (current()) {
          dirty = true;
          revealSettingsFor(byId(field) || container);
          showError(e);
        }
      } finally { saving = false; }
      if (again) {
        again = false;
        if (canSave()) void save();
      }
    };
    for (const [id, saved] of recentlySaved) {
      const at = typeof saved === "number" ? saved : saved.at;
      const left = SAVED_MARK_MS - (Date.now() - at);
      if (left <= 0) { recentlySaved.delete(id); continue; }
      if (typeof saved !== "number" && !sameSaveContext(saved.context, context)) continue;
      if (current() && container.querySelector(`#${CSS.escape(id)}`)) markSaved(id, left);
    }
    const own = (e) => !!e.target.closest?.("[data-own-save]");
    listen(container, "input", (e) => { if (!own(e)) arm(); });
    listen(container, "change", (e) => {
      if (own(e)) return;
      arm();
      if (e.target.id) lastField = e.target.id;
      save();
    });
    listen(container, "keydown", (e) => {
      if (e.key !== "Enter") return;
      const t = e.target;
      if (t.tagName === "INPUT" || (e.ctrlKey && (t.tagName === "TEXTAREA" || t.isContentEditable))) {
        e.preventDefault();
        t.blur();
      }
    });
    listen(container, "focusout", (e) => {
      if (e.target.isContentEditable) {
        if (e.target.id) lastField = e.target.id;
        save();
      }
    });
  }
  function roomMark(room, size = "md") {
    return VIBEROOM_ROOM_MARK.html({ id: room.id, name: room.name, emoji: (room.settings && room.settings.emoji) || "" }, size);
  }
  function lookSampleHtml() {
    const withIcon = state.recipes.filter((r) => r.icon);
    const lead = withIcon[0] || state.recipes[0];
    const sam = { name: "Sam", kind: "agent", color: TOKENS.active().elements.face.avatarDefault, avatar: "🦊", agentType: lead ? lead.id : "", agentLabel: lead ? lead.vendor : "" };
    const marks = (withIcon.length ? withIcon : state.recipes).slice(0, 3).map((r) => vendorLogo(r, "sm")).join("");
    return `<div class="msg agent"><div class="bubble-col"><div class="msg-head"><span class="head-av">${avatar(sam, 32, { vendor: true })}</span><span class="name" style="--who:${sam.color}">Sam</span><span class="time">16:21</span></div><div class="bubble">A reply, on this look's paper, in its ink, with <code>code</code> a step smaller.</div><div class="meta"><span>seen</span></div></div></div>
      <div class="msg mine"><div class="bubble-col"><div class="bubble">Your message.</div></div></div>
      <div class="sample-row">${UI.html("hub-row", { text: "Sam finished the reply started at 16:21 · 2m 30s", ref: "sample", title: "a row the room writes", face: UI.raw(avatar(sam, 20, {})) })}</div>
      <div class="sample-row">${UI.html("room-mark", { hue: 200, letter: "V", title: "a room" })}${UI.html("room-mark", { hue: 40, emoji: "🎭", title: "a room with an emoji" })}${marks}${UI.html("button", { label: "Send", kind: "primary", size: "sm" })}</div>`;
  }
  function roomTitle(room) {
    const emoji = (room.settings && room.settings.emoji) || "";
    return emoji && !window.Avatars.faceUrl(emoji) ? `${room.name} ${emoji}` : room.name;
  }
  function flash(id) {
    const s = byId(id);
    if (!s) return;
    s.textContent = "saved";
    setTimeout(() => {
      const again = byId(id);
      if (again) again.textContent = "";
    }, 2200);
  }

  const scrollHintScopes = new WeakMap();
  function attachScrollHints(box) {
    if (!box) return;
    if (scrollHintScopes.has(box)) return scrollHintScopes.get(box);
    const inside = box.tagName === "DIALOG";
    const frame = box.parentElement;
    if (!frame && !inside) return;
    const scope = domResources.scope();
    const made = [];
    const position = frame?.style.position;
    const positioned = !inside && getComputedStyle(frame).position === "static";
    scrollHintScopes.set(box, scope.release);
    scope.own(() => {
      scrollHintScopes.delete(box);
      delete box.dataset.hinted;
      for (const node of made) node.remove();
      if (positioned && frame.style.position === "relative") frame.style.position = position;
    });
    box.dataset.hinted = "1";
    if (positioned) frame.style.position = "relative";
    const make = (dir) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `scroll-hint ${dir}`;
      b.title = dir === "up" ? "There is more above" : "There is more below";
      b.innerHTML = ic(dir === "up" ? "chevrons-up" : "chevrons-down");
      b.hidden = true;
      scope.on(b, "click", () => box.scrollBy({ top: (dir === "up" ? -1 : 1) * Math.max(120, box.clientHeight * 0.85), behavior: "smooth" }));
      if (inside) {
        const slot = document.createElement("div");
        slot.className = `scroll-hint-slot ${dir}`;
        made.push(slot);
        slot.appendChild(b);
        if (dir === "up") box.prepend(slot);
        else box.append(slot);
      } else { made.push(b); frame.appendChild(b); }
      return b;
    };
    const up = make("up");
    const down = make("down");
    const update = () => {
      const hidden = box.scrollHeight - box.clientHeight;
      up.hidden = !(hidden > 8 && box.scrollTop > 8);
      down.hidden = !(hidden > 8 && box.scrollTop < hidden - 8);
    };
    let queued = false;
    const updateSoon = () => {
      if (queued) return;
      queued = true;
      scope.frame(() => {
        queued = false;
        update();
      });
    };
    scope.on(box, "scroll", update, { passive: true });
    scope.observer(ResizeObserver, updateSoon).observe(box);
    scope.observer(MutationObserver, updateSoon).observe(box, { childList: true, subtree: true });
    const dialog = inside ? box : box.closest("dialog");
    if (dialog) scope.on(dialog, "close", scope.release, { once: true });
    update();
    return scope.release;
  }

  const dialogCloseTimers = new WeakMap();
  function openDialog(dialog) {
    if (state.embedded && globalControl(dialog)) return;
    if (dialogCloseTimers.has(dialog)) {
      clearTimeout(dialogCloseTimers.get(dialog));
      dialogCloseTimers.delete(dialog);
      dialog.classList.remove("closing");
    }
    if (dialog.open) return;
    attachScrollHints(dialog);
    dialog.classList.remove("closing");
    restoreDialogSize(dialog);
    dialog.showModal();
    if (dialog.classList.contains("light-dismiss") && !dialog.lightDismissWired) {
      dialog.lightDismissWired = true;
      const outside = (e) => {
        const r = Layout.rect(dialog);
        return Layout.length(e.clientX) < r.left || Layout.length(e.clientX) > r.right || Layout.length(e.clientY) < r.top || Layout.length(e.clientY) > r.bottom;
      };
      let fromBackdrop = false;
      domResources.nodeListener(dialog, "pointerdown", (e) => {
        fromBackdrop = e.target === dialog && outside(e);
      });
      domResources.nodeListener(dialog, "click", (e) => {
        if (e.target !== dialog || !fromBackdrop) return;
        if (outside(e)) closeDialog(dialog);
      });
    }
    dialog.querySelectorAll(".scrolls").forEach(attachScrollHints);
    watchDialogSize(dialog);
  }

  const dialogSizing = lifetime.use(VIBEROOM_DIALOG_SIZING.create(uiRoot, {
    window, signal: lifetime.signal, layout: () => Layout, recall, remember,
    forget: key => localStorage.removeItem(`viberoom.${key}`),
  }));
  function restoreDialogSize(dialog) { dialogSizing.restore(dialog); }
  function watchDialogSize(dialog) { dialogSizing.watch(dialog); }
  function wireCornerTouch(dialog) { dialogSizing.wireTouch(dialog); }
  function wireDialogNodes(changes) {
    for (const change of changes) {
      for (const node of change.addedNodes) if (node instanceof HTMLDialogElement && node.classList.contains("dialog")) wireCornerTouch(node);
      for (const node of change.removedNodes) {
        if (!(node instanceof Element)) continue;
        for (const box of [node, ...node.querySelectorAll("dialog, [data-hinted]")]) {
          if (uiRoot.contains(box)) continue;
          scrollHintScopes.get(box)?.();
          dialogSizing.releaseNode(box);
        }
      }
    }
  }
  domResources.observe(MutationObserver, wireDialogNodes).observer.observe(uiRoot, { childList: true });
  function closeDialog(dialog) {
    if (!dialog.open || dialogCloseTimers.has(dialog)) return;
    dialog.classList.add("closing");
    const timer = setTimeout(() => {
      if (dialogCloseTimers.get(dialog) !== timer) return;
      dialogCloseTimers.delete(dialog);
      dialog.classList.remove("closing");
      if (dialog.open) dialog.close();
    }, 190);
    dialogCloseTimers.set(dialog, timer);
  }
  function confirmDialog(text, opts) {
    return choiceDialog(text, opts).then((choice) => choice === "ok");
  }
  function choiceDialog(text, opts) { return confirmBox.choose(text, opts); }

  const BRIEF_TEXT_MAX = 32000;
  function briefTextLimit(room) {
    const r = room || currentRoom();
    return (r && r.settings && Number(r.settings.briefTextLimit)) || 8000;
  }
  function bindCount(el, countEl, limitOf) {
    if (!el || !countEl) return;
    const tick = () => {
      const n = (el.isContentEditable ? rulesText(el) : el.value).length;
      const limit = limitOf();
      countEl.textContent = `${n} / ${limit}`;
      countEl.classList.toggle("over", n > limit);
    };
    domResources.nodeListener(el, "input", tick);
    tick();
  }
  async function fitBriefText(text, what, limit, limitInput, { room = currentRoom(), current = () => true } = {}) {
    const roomId = room?.id, key = roomRecordKey(room);
    const active = () => !lifetime.disposed && current() && key !== null && roomRecordKey(currentRoom()) === key && roomRecordKey(state.rooms.get(roomId)) === key;
    if (!active()) return null;
    const actions = roomCommands.forRoom(room);
    if (text.length <= limit) return text;
    const needed = Math.min(BRIEF_TEXT_MAX, Math.ceil(text.length / 500) * 500);
    const canRaise = text.length <= BRIEF_TEXT_MAX;
    const choice = await choiceDialog(`${what} is ${text.length} characters; this room's limit is ${limit}. Cut it at the limit, or raise the limit for this room?${canRaise ? "" : ` ${BRIEF_TEXT_MAX} is the most a room can allow.`}`, { title: "Over the room's limit", okLabel: `Cut at ${limit}`, altLabel: canRaise ? `Raise the limit to ${needed}` : "", cancelLabel: "Go back", primary: "cancel" });
    if (!active()) return null;
    if (choice === "ok") return text.slice(0, limit);
    if (choice !== "alt") return null;
    if (limitInput) limitInput.value = String(needed);
    else await actions.saveSettings({ briefTextLimit: needed });
    if (!active()) return null;
    return text;
  }
  function remember(key, value) {
    try {
      localStorage.setItem(`viberoom.${key}`, String(value));
    } catch {
    }
  }
  function recall(key) {
    try {
      return localStorage.getItem(`viberoom.${key}`);
    } catch {
      return null;
    }
  }
  function forget(key) {
    try {
      localStorage.removeItem(`viberoom.${key}`);
    } catch {
    }
  }


  function enterScreen(view) {
    const room = view === "skills" && state.skillsRoom ? state.rooms.get(state.skillsRoom) : null;
    return screenLifetimes.enter(JSON.stringify([view, room ? roomRecordKey(room) : null]));
  }
  function setView(view) {
    if (state.embedded && view !== "room" && !(sharedSettings && view === "settings") && !(standalone.applicationHost && view === "host")) { notifyHost("onNavigate", { view }); return; }
    enterScreen(view);
    if (view !== "room") clearConversationSelection();
    if (state.view === "room" && view !== "room") {
      glideStop("the conversation was left");
      keepReturnPlace(state.currentRoomId);
    }
    if (view === "room" && state.view !== "room") prepareRoomPlace(state.currentRoomId);
    if (state.view === "settings" && view !== "settings") dropPairLink(true);
    const arriving = view !== state.view;
    state.view = view;
    if (view !== "room") { toolDetails.clear(); textWork.clear(); }
    els.app.classList.remove("view-home", "view-rooms", "view-room", "view-skills", "view-settings", "view-connections", "view-onboarding", "view-me", "view-host", ...product.views.map(item => `view-${item.id}`));
    els.app.classList.add(`view-${view}`);
    els.homeView.hidden = view !== "home";
    els.roomsView.hidden = view !== "rooms";
    els.chatView.hidden = view !== "room";
    els.pageView.hidden = !(view === "skills" || view === "settings" || view === "connections" || view === "onboarding" || view === "me" || product.has?.(view));
    els.sideRooms.hidden = view === "room";
    els.sideRoom.hidden = view !== "room";
    if (view !== "room") { closeDetails(); hideEmptyGuide(); }
    renderRail();
    if (view === "home") {
      renderSideRooms();
      renderHome();
    } else if (view === "rooms") {
      renderSideRooms();
      renderRoomsGrid();
    } else if (view === "room") {
      renderSideRoom();
      renderChatHead();
      showRoomList("the room was opened");
    } else if (view === "skills") {
      renderSideRooms();
      renderSkillsPage();
    } else if (view === "settings") {
      renderSideRooms();
      renderSettingsPage();
      void refreshBuildAge();
    } else if (view === "connections") {
      renderSideRooms();
      renderConnectionsPage();
    } else if (view === "onboarding") {
      renderSideRooms();
      renderOnboardingPage();
    } else if (view === "me") {
      renderSideRooms();
      renderMePage();
    } else if (product.has?.(view)) {
      renderSideRooms();
      renderProductView(view);
    }
    if (arriving && view !== "room") arriveAll(view);
  }

  async function refreshBuildAge() {
    try {
      const fresh = await net.read(await net.request("/api/version", { deadlineMs: 4000 }), "json");
      if (net.signal.aborted) return;
      const before = (state.version && state.version.staleBuild) || null;
      hubStatus.acceptVersion(fresh);
      if ((fresh.staleBuild || null) !== before && state.view === "settings") renderSettingsPage();
    } catch {
    }
  }

  function selectRoom(id, opts) {
    if (state.embedded && !opts?.coordinator) {
      const room = state.rooms.get(id);
      if (room?.scope !== scope) { notifyHost("onNavigate", { roomId: id, scope: room?.scope }); return; }
      void update({ roomId: id, scope }).catch(showError);
      return;
    }
    if (id !== state.currentRoomId) clearConversationSelection();
    if (!state.rooms.has(id)) return;
    const switching = state.currentRoomId !== id;
    const panelWas = state.detailsOpen ? state.selection.kind : null;
    if (state.currentRoomId !== id) {
      glideStop("the room changed");
      cornerNotes.clear();
      keepReturnPlace(state.currentRoomId);
      prepareRoomPlace(id);
    }
    if (opts?.coordinator) scope = opts.scope;
    state.currentRoomId = id;
    if (draftRoomId !== id) bringDraft(id);
    state.unread.delete(id);
    unseenHere = 0;
    showAttention();
    remember("room", id);
    if (!state.openRooms.includes(id)) {
      state.openRooms.push(id);
      post(`/api/rooms/${encodeURIComponent(id)}/open`).catch(() => {});
    }
    setView("room");
    if (!(opts && opts.keepDetails)) closeDetails();
    else if (switching && panelWas === "room") openDetails({ kind: "room" });
    else if (switching) closeDetails();
    if (!state.detailsOpen) state.selection = { kind: "room" };
    maybeOfferReconnect();
  }

  const POP_SEEN_MS = 30000;
  const noticeScopes = new WeakMap();
  function removeNotice(pop) { noticeScopes.get(pop)?.(); pop.remove(); }
  function closesWhenSeen(pop, close) {
    noticeScopes.get(pop)?.();
    const scope = domResources.scope();
    noticeScopes.set(pop, scope.release);
    scope.own(() => noticeScopes.delete(pop));
    let seen = 0, since = 0, counting = false, timer = 0;
    const done = scope.release;
    function tick() {
      scope.clearTimeout(timer);
      if (!pop.isConnected) return done();
      if (counting) { seen += Date.now() - since; counting = false; }
      if (seen >= POP_SEEN_MS) { done(); return close(); }
      if (!document.hidden && !pop.matches(":hover")) {
        counting = true;
        since = Date.now();
        timer = scope.timeout(tick, POP_SEEN_MS - seen);
      }
    }
    scope.on(document, "visibilitychange", tick);
    scope.on(pop, "pointerenter", tick);
    scope.on(pop, "pointerleave", tick);
    tick();
    return scope.release;
  }
  const runtimeNotices = lifetime.use(VIBEROOM_RUNTIME_NOTICES.create($("#rail-pops"), {
    signal: lifetime.signal, window, connectionLabel: $("#conn-label"),
    read: () => ({ embedded: state.embedded, update: state.update, restart: state.restart, version: state.version,
      dataFolder: state.dataFolder, downSince, transportAlive: !net.signal.aborted }),
    UI, esc, setText, recall, remember, forget, post, onError: showError, openSettings,
    runOf: version => runOf(version), hubWords: hubSwapWords, nameList, waitedFor, checkAgain, closesWhenSeen, removeNotice,
  }));

  function renderUpdatePop() { runtimeNotices.update(); }
  const runOf = (version) => (version && version.pid && version.startedAt ? { id: `${version.pid}.${version.startedAt}`, build: version.build || "", startedAs: version.startedAs || "by-hand" } : null);
  function hubSwap(before, now) {
    if (!now || !before || !before.id) return null;
    if (before.id === now.id) return null;
    return { id: now.id, was: before.build || "", build: now.build || "", startedAs: now.startedAs || "by-hand" };
  }
  function buildWhen(build) {
    const at = new Date(build);
    if (!build || Number.isNaN(at.getTime())) return "an unknown time";
    const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
  }
  function hubSwapWords(swap) {
    const build = swap.was === swap.build
      ? "The build is the same one as before."
      : `The build is now the one from ${esc(buildWhen(swap.build))} — you were on ${esc(buildWhen(swap.was))}.`;
    const how = swap.startedAs === "at-login" ? "It came up with the computer."
      : swap.startedAs === "replacing-another" ? "It replaced the one that was running."
      : "It was started by hand.";
    return `<b>viberoom restarted.</b> ${build} ${how}`;
  }
  function noteHubRun() {
    if (state.embedded) return;
    const now = runOf(state.version);
    if (!now) return;
    let before = null;
    try {
      before = JSON.parse(recall("hubRun") || "null");
    } catch {
      before = null;
    }
    const swap = hubSwap(before, now);
    if (swap) remember("hubSwap", JSON.stringify(swap));
    remember("hubRun", JSON.stringify({ id: now.id, build: now.build }));
    renderHubPop();
  }
  function renderHubPop() { runtimeNotices.hub(); }
  function renderRestartPop() { runtimeNotices.restart(); }


  function nameList(names) {
    return names.length <= 1 ? (names[0] || "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  function waitedFor(since) {
    const s = Math.max(0, Math.round((Date.now() - since) / 1000));
    if (s < 60) return "a moment";
    const m = Math.round(s / 60);
    return m === 1 ? "a minute" : `${m} minutes`;
  }


  function renderRail() {
    const s = state.settings;
    rail.update({
      view: state.view,
      open: els.app.classList.contains("rail-open"),
      lists: { "rail-rooms": activeRooms().map((room) => ({
        id: room.id, mark: roomMark(room), name: room.name, title: roomTitle(room),
        active: room.id === state.currentRoomId && state.view === "room", unread: state.unread.get(room.id) || 0,
      })), ...(product.rail ? { "rail-product": product.rail.entries() } : {}) },
      ...(s ? { me: { avatar: avatar(meAvatarData(), 44, { kind: "bare" }), label: s.humanName } } : {}),
    });
    if (productPage && state.view === productPage.id) productPage.handle.update?.();
  }

  function startProductFeatures() {
    const start = standalone.product?.start;
    if (!start) return Object.freeze({ views: [], rail: null, rooms: null, home: null, replacesNewRoom: false });
    let changedQueued = false;
    const ports = Object.freeze({
      signal: lifetime.signal,
      get: async (path, options) => { await Promise.resolve(); lifetime.signal.throwIfAborted(); return get(path, options); },
      post: async (path, body, options) => { await Promise.resolve(); lifetime.signal.throwIfAborted(); return post(path, body, options); },
      UI: window.UI, grid: VIBEROOM_ROOMS.grid, icon: name => window.Icons.svg(name),
      rooms: () => productRoomSummaries(),
      currentRoomId: () => (state.view === "room" ? state.currentRoomId : null),
      showView: id => setView(id),
      openRoom: roomId => selectRoom(roomId, { keepDetails: true }),
      changed: () => {
        if (changedQueued) return;
        changedQueued = true;
        queueMicrotask(() => { changedQueued = false; productChanged(); });
      },
    });
    const given = start(ports);
    if (!given || typeof given !== "object") throw new TypeError("The product's features must be an object");
    const unknown = Object.keys(given).find(key => !["views", "rail", "rooms", "home", "replacesNewRoom"].includes(key));
    if (unknown) throw new TypeError(`The product's features have no "${unknown}"`);
    const taken = new Set(["home", "rooms", "room", "skills", "connections", "settings", "onboarding", "me", "host"]);
    const views = (given.views ?? []).map((view) => {
      if (!view || !/^[a-z][a-z0-9-]{1,30}$/.test(view.id) || taken.has(view.id)) throw new TypeError(`A product page needs its own id: ${view?.id}`);
      if (typeof view.mount !== "function" || typeof view.label !== "string" || typeof view.glyph !== "string") throw new TypeError(`The product page ${view.id} needs a glyph, a label and mount`);
      taken.add(view.id);
      return Object.freeze({ id: view.id, glyph: view.glyph, label: view.label, title: typeof view.title === "string" ? view.title : null, mount: view.mount });
    });
    const rail = given.rail ? Object.freeze({ label: String(given.rail.label || ""), entries: given.rail.entries, onPick: given.rail.onPick }) : null;
    if (rail && (typeof rail.entries !== "function" || typeof rail.onPick !== "function" || !rail.label)) throw new TypeError("The product's menu group needs a label, entries and onPick");
    if (given.replacesNewRoom && !views.length) throw new TypeError("Only a product page can take the place of \"+\"");
    const rooms = given.rooms ? Object.freeze({ target: given.rooms.target, missing: typeof given.rooms.missing === "string" ? given.rooms.missing : null }) : null;
    const home = given.home ? Object.freeze({ places: given.home.places, onPick: given.home.onPick, onOpen: given.home.onOpen, onAll: given.home.onAll,
      words: given.home.words ? Object.freeze({ ...given.home.words }) : null }) : null;
    if (home && (typeof home.places !== "function" || typeof home.onPick !== "function")) throw new TypeError("The product's Home needs places and onPick");
    if (home?.words && Object.entries(home.words).some(([key, value]) => !(key in VIBEROOM_HOME.words) || typeof value !== "string")) throw new TypeError("The product's Home words are words Home has, each text");
    if (rooms && typeof rooms.target !== "function") throw new TypeError("The product's rooms need a target");
    return Object.freeze({ views, rail, rooms, home, replacesNewRoom: !!given.replacesNewRoom, has: id => views.some(view => view.id === id) });
  }
  function productRoomSummaries() {
    return (sortedRooms() || []).map(({ room, stats }) => Object.freeze({ id: room.id, uuid: room.uuid, name: room.name, scope: room.scope ?? null,
      unread: stats.unread, thinking: stats.thinking, last: stats.last }));
  }
  let productPage = null;
  function renderProductView(id) {
    const screen = enterScreen(id);
    if (!screen) return;
    if (productPage?.id === id && productPage.signal === screen.signal) { productPage.handle.update?.(); return; }
    const view = product.views.find(item => item.id === id);
    els.pageInner.replaceChildren();
    const handle = view.mount(els.pageInner, { signal: screen.signal }) || {};
    const visit = { id, handle, signal: screen.signal };
    productPage = visit;
    screen.signal.addEventListener("abort", () => {
      if (productPage === visit) productPage = null;
      try { handle.dispose?.(); } catch (error) { console.error(error); }
    }, { once: true });
  }
  function productChanged() {
    if (net.signal.aborted) return;
    renderRail();
    if (state.view !== "room" && state.view !== "skills") renderSideRooms();
    if (state.view === "rooms") renderRoomsGrid();
    else if (state.view === "home") renderHome();
  }

  function shownRoom(room) {
    if (!product.rooms) return true;
    const target = product.rooms.target();
    return !!target && room.scope === target.scope;
  }

  function activeRooms() {
    const ids = state.openRooms.filter((id) => state.rooms.has(id));
    if (state.currentRoomId && state.rooms.has(state.currentRoomId) && !ids.includes(state.currentRoomId)) ids.push(state.currentRoomId);
    return ids.map((id) => state.rooms.get(id)).filter(shownRoom);
  }

  let unseenHere = 0;
  const attentionView = lifetime.use(VIBEROOM_ATTENTION_VIEW.create(uiRoot, { window: document.defaultView, signal: lifetime.signal, onAttention: data => notifyHost("onAttention", data) }));
  const ARRIVAL_FRESH_MS = 120_000;
  function attending() {
    return document.visibilityState === "visible" && document.hasFocus();
  }
  function unseenCount() {
    let n = unseenHere;
    for (const count of state.unread.values()) n += count;
    return n;
  }
  function showAttention() {
    attentionView.update({ embedded: state.embedded, rooms: roomDirectory.reader, unread: state.unread, currentRoomId: state.currentRoomId,
      unseenHere, appBadge: (state.settings || {}).appBadge, documentAttention: ownsAttention, title: standalone.title || "viberoom" });
  }
  function attentionBack() {
    if (!attending()) return;
    unseenHere = 0;
    showAttention();
  }
  lifetime.on(window, "focus", attentionBack);
  lifetime.on(document, "visibilitychange", attentionBack);
  function noticeArrival(room, m) {
    const reply = m.kind === "chat" && m.from !== "human";
    const needsYou = m.kind === "system" && m.details?.tone === "attention" && m.details?.about === "room";
    if (!reply && !needsYou) return;
    const looking = attending();
    if (reply && room.id !== state.currentRoomId) state.unread.set(room.id, (state.unread.get(room.id) || 0) + 1);
    else if (reply && !looking) unseenHere++;
    showAttention();
    const fresh = Date.now() - (m.ts || 0) < ARRIVAL_FRESH_MS;
    if (!looking && fresh) knock(room, m, needsYou);
    if (reply && fresh && (m.to || []).includes("human")) offerKnock(room, m);
    if (reply) readArrival(room, m);
  }

  function readAloud(m, queued = false) {
    const r = state.voice?.reading;
    if (!r || r.reader === "off" || !r.ready) {
      if (!queued) {
        toast(`${r?.reason || "No reader is chosen yet"}: Settings → Voice.`, "warn");
        openSettings("voice");
      }
      return;
    }
    const answer = m.answerFrom > 0 && m.answerFrom < String(m.text || "").length ? m.text.slice(m.answerFrom) : m.text;
    const text = VIBEROOM_READER.speakable(answer);
    if (!text) return void (!queued && toast("There are no words to read in it: only code or pictures.", "warn"));
    const how = r.reader === "system" ? { mode: "system", voice: r.voice, language: state.voice.language || navigator.language } : { mode: "provider" };
    if (queued) reader.queue(m.id, text, how);
    else reader.read(m.id, text, how);
  }
  function readArrival(room, m) {
    const r = state.voice?.reading;
    if (!r || r.auto === "off" || !r.ready || r.reader === "off") return;
    if (room.id !== state.currentRoomId || document.visibilityState !== "visible" || voiceControl.listening) return;
    if (Date.now() - (m.ts || 0) >= ARRIVAL_FRESH_MS) return;
    if (r.auto === "to-me" && !(m.to || []).includes("human")) return;
    readAloud(m, true);
  }
  function drawReading(key, st) {
    const el = els.messages.querySelector(`.msg[data-id="${CSS.escape(key)}"]`);
    if (el) drawReadingOn(el, st);
  }
  function drawReadingOn(el, st) {
    const on = st === "loading" || st === "reading";
    el.classList.toggle("reading", on);
    const button = el.querySelector('.msg-head [data-act="read"]');
    if (!button) return;
    button.innerHTML = ic(on ? "stop" : "speaker");
    UI.setState(button, on ? "on" : null);
    const words = on ? "Stop reading" : "Read it aloud";
    button.removeAttribute("title");
    button.dataset.hint = words;
    button.setAttribute("aria-label", words);
    button.setAttribute("aria-pressed", String(on));
  }
  function knock(room, m, needsYou) {
    const mode = (state.settings || {}).notifyReplies || "every";
    if (mode === "to-me" && !needsYou && !(m.to || []).includes("human")) return;
    const words = String(m.text || "").replace(/```[\s\S]*?```/g, " [code] ").replace(/[*_`>#|]/g, "").replace(/\s+/g, " ").trim();
    ring(room, needsYou ? room.name : `${m.fromName} · ${room.name}`, words);
  }
  function knockAsked(room, perm) {
    if (room.id === state.currentRoomId && attending()) return;
    const p = findById(room, perm.participantId);
    const tc = perm.toolCall || {};
    ring(room, `${p ? p.name : "A vibemate"} is waiting for you · ${room.name}`, `Asks for permission: ${tc.title || tc.toolCallId || "a tool call"}`);
  }
  function ring(room, title, words) {
    if (!ownsNotifications) return;
    const mode = (state.settings || {}).notifyReplies || "every";
    if (mode === "off" || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const note = new Notification(title, {
        body: words.length > 180 ? `${words.slice(0, 179)}…` : words,
        tag: `viberoom-room-${room.id}`, renotify: true, icon: "/icon-256.png?v=12",
      });
      note.onclick = lifetime.guard(() => { window.focus(); selectRoom(room.id); note.close(); });
    } catch { }
  }
  function askToKnock() {
    if (!ownsNotifications) return Promise.resolve();
    if (typeof Notification === "undefined" || Notification.permission !== "default") return Promise.resolve();
    if ((state.settings || {}).notifyReplies === "off") return Promise.resolve();
    remember("notify-asked", "1");
    return Notification.requestPermission().catch(() => {});
  }

  let knockOffer = null;
  function knockAskable() {
    return ownsNotifications && typeof Notification !== "undefined" && Notification.permission === "default"
      && (state.settings || {}).notifyReplies !== "off" && !recall("notify-asked");
  }
  function offerKnock(room, m) {
    if (knockOffer || !knockAskable()) return;
    knockOffer = { roomId: room.id, afterSeq: m.seq };
    if (room.id === state.currentRoomId && state.view === "room") syncKnockOffer(room);
  }
  function syncKnockOffer(room) {
    const stale = els.messages.querySelector('[data-ui="ask-card"][data-kind="notify"]');
    if (knockOffer && !knockOffer.outcome && !knockAskable()) knockOffer = null;
    if (!knockOffer || knockOffer.roomId !== room.id) return void (stale && stale.remove());
    const card = UI.el("ask-card", {
      kind: "notify", who: "viberoom",
      body: '<div class="prop-why">Turn it on, and your system asks you once whether to allow it.</div>',
      outcome: knockOffer.outcome,
      choices: [{ label: "Turn on", tone: "ok", act: "knock", data: { answer: "on" } }, { label: "Not now", act: "knock", data: { answer: "later" } }],
      data: { key: "notify" },
    });
    if (stale) stale.replaceWith(card);
    else placeCard(card, room, { afterSeq: knockOffer.afterSeq });
  }
  async function answerKnockOffer(answer) {
    if (!knockOffer || knockOffer.outcome) return;
    const offer = knockOffer;
    if (answer === "on") {
      await askToKnock();
      const allowed = typeof Notification === "undefined" ? "default" : Notification.permission;
      offer.outcome = allowed === "granted" ? "Notifications are on."
        : allowed === "denied" ? "Your system said no. Settings → Notifications says how to allow them later."
        : "Nothing was decided. Settings → Notifications can ask again.";
    } else {
      remember("notify-asked", "1");
      offer.outcome = "Not now. Settings → Notifications can turn them on.";
    }
    const room = state.rooms.get(offer.roomId);
    if (knockOffer === offer && room && room.id === state.currentRoomId && state.view === "room") syncKnockOffer(room);
  }
  function notifyPermissionRow(row) {
    if (!ownsNotifications) return "";
    const allowed = typeof Notification === "undefined" ? "none" : Notification.permission;
    if (allowed === "granted") return "";
    if (allowed === "none") return row({ label: "Not on this system", status: "This window cannot show notifications of the system. The count on the icon still works.", statusTone: "warn" });
    if (allowed === "denied") return row({ label: "Blocked on this computer", status: "The system or the browser was told no. Allow notifications for viberoom in the browser's site settings (the icon left of the address) or in the system's settings.", statusTone: "warn" });
    return row({ label: "Not allowed yet", hint: "viberoom offers it once, under the first reply a vibemate gives you; or ask now.", control: actHtml({ label: "Allow…", id: "sp-notify-allow" }) });
  }

  function setRailOpen(open) {
    els.app.classList.toggle("rail-open", open);
    remember("railOpen", open ? "1" : "0");
    renderRail();
  }


  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  const drawnHtml = new WeakMap();
  function setHtml(el, html) {
    if (drawnHtml.get(el) === html) return;
    el.innerHTML = html;
    drawnHtml.set(el, html);
  }

  function arrival(el) {
    el.classList.add("arrive");
    const done = lifetime.guard((event) => {
      if (event && event.target !== el) return;
      el.classList.remove("arrive");
      el.removeEventListener("animationend", done);
    });
    el.addEventListener("animationend", done);
    setTimeout(done, 1200);
  }

  function arriveAll(view) {
    for (const list of view === "rooms" ? [els.roomList, els.roomsGrid] : [els.roomList]) {
      for (const node of list.children) if (!node.classList.contains("arrive")) arrival(node);
    }
  }

  let overviewFrame = 0;
  function renderOverviewSoon() {
    if (overviewFrame) return;
    overviewFrame = requestAnimationFrame(() => {
      overviewFrame = 0;
      renderRail();
      if (state.view === "rooms" || state.view === "home") {
        renderSideRooms();
        renderRoomsGrid();
      }
    });
  }
  function overviewChanged() {
    if (!lifetime.disposed && (state.view === "rooms" || state.view === "home")) renderOverviewSoon();
  }
  setInterval(() => {
    if (state.view === "rooms" || state.view === "home") renderOverviewSoon();
  }, 60000);


  function rosterStats(room) {
    const facts = roomReader.forRecord(room);
    if (!facts) return undefined;
    const agents = Object.freeze(facts.participants.filter(p => p.kind === "agent"));
    return Object.freeze({ facts, agents,
      online: agents.filter(p => p.status !== "offline" && p.status !== "left" && p.status !== "unstaffed").length,
      waiting: agents.filter(p => p.status === "unstaffed").length,
      thinking: agents.some(p => p.status === "thinking") });
  }
  function roomStats(room) {
    const roster = rosterStats(room), overview = roster && conversationReader.overviewFor(room);
    if (!overview || roomReader.forRecord(room) !== roster.facts) return undefined;
    return Object.freeze({ ...roster, overview, last: overview.last, unread: state.unread.get(room.id) || 0 });
  }
  function sameOverview(a, b) {
    return !!a && !!b && Object.keys(a).every(key => Object.is(a[key], b[key]));
  }
  function overviewCurrent(room, stats) {
    return !lifetime.disposed && state.rooms.get(room.id) === room && roomReader.forRecord(room) === stats.facts
      && sameOverview(stats.overview, conversationReader.overviewFor(room)) && roomReader.forRecord(room) === stats.facts;
  }
  function overviewText(room, stats, kind) {
    if (!overviewCurrent(room, stats)) return undefined;
    const result = conversationReader.overviewTextFor(room, kind);
    if (!result) return undefined;
    const { text, ...metadata } = result;
    return sameOverview(stats.overview, metadata) && overviewCurrent(room, stats) ? result : undefined;
  }
  function overviewEntriesCurrent(entries) {
    return entries.length === [...state.rooms.keys()].length && entries.every(({ room, stats }) => overviewCurrent(room, stats));
  }
  function sortedRooms() {
    const entries = [];
    for (const room of [...state.rooms.values()]) {
      const stats = roomStats(room);
      if (!stats) return undefined;
      entries.push({ room, stats });
    }
    return overviewEntriesCurrent(entries) ? entries.sort((a, b) => b.stats.last - a.stats.last) : undefined;
  }


  let sideList = null;
  function sideRows() {
    sideList ||= lifetime.use(VIBEROOM_ROOMS.side(els.roomList, {
      window: document.defaultView, signal: lifetime.signal, UI, arrive: arrival,
      onRow: (key, { goto }) => {
        if (key.startsWith("room:")) return selectRoom(key.slice(5));
        const roomId = key === "skills:all" ? null : key.slice(7);
        if (roomId && goto) return selectRoom(roomId);
        state.skillsRoom = roomId;
        renderSideSkills();
        renderSkillsPage();
      },
    }));
    return sideList;
  }

  function renderSideSkills() {
    setText(els.sideRoomsTitle, "Skills by room");
    const q = state.roomSearch.toLowerCase();
    const snapshot = sortedRooms();
    if (!snapshot) return;
    const rooms = snapshot.filter(({ stats }) => !q || stats.facts.name.toLowerCase().includes(q));
    const chosen = state.skillsRoom || null;
    const entries = [
      { key: "skills:all", mark: UI.html("room-mark", { icon: "skills", title: "All skills" }), name: "All skills", preview: `${(state.skills || []).length} in the library`, selected: chosen === null },
      ...rooms.map(({ stats }) => {
        const room = stats.facts;
        const held = new Set();
        for (const p of room.participants) for (const s of p.skills || []) held.add(s.toLowerCase());
        const selected = room.id === chosen;
        return { key: `skills:${room.id}`, mark: roomMark(room), name: room.name, preview: held.size ? `${held.size} skill${held.size === 1 ? "" : "s"} in use` : "no skills attached", selected, goto: selected };
      }),
    ];
    if (overviewEntriesCurrent(snapshot)) sideRows().update({ entries });
  }

  function renderSideRooms() {
    if (state.view === "skills") return renderSideSkills();
    setText(els.sideRoomsTitle, "Rooms");
    const q = state.roomSearch.toLowerCase();
    const snapshot = sortedRooms();
    if (!snapshot) return;
    const rooms = snapshot.filter(({ room, stats }) => shownRoom(room) && (!q || stats.facts.name.toLowerCase().includes(q) || (stats.facts.settings.topic || "").toLowerCase().includes(q)));
    const entries = [];
    for (const { room, stats: st } of rooms) {
      const facts = st.facts, last = st.overview.hasChat ? overviewText(room, st, "side") : null;
      if (st.overview.hasChat && !last) return;
      const preview = last ? `${last.fromName}: ${last.text}` : facts.settings.topic || `${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}`;
      entries.push({ key: `room:${facts.id}`, mark: roomMark(facts), name: facts.name, live: st.thinking, preview,
        when: relTime(st.last), unread: st.unread, selected: facts.id === state.currentRoomId });
    }
    if (overviewEntriesCurrent(snapshot)) sideRows().update({ empty: q ? "No room matches." : "No rooms yet.", entries });
  }


  const HUSH_FACE = '<span class="hush-face" aria-hidden="true"></span>';
  const HOME_SYSTEMS = 8;
  let home = null;
  function renderHome() {
    home ||= lifetime.use(VIBEROOM_HOME.create(els.homeView, {
      window: document.defaultView, signal: lifetime.signal, UI, icon: ic, hushFace: HUSH_FACE,
      ...(product.home?.words ? { words: { ...VIBEROOM_HOME.words, ...product.home.words } } : {}),
      onOpen: () => { if (product.home?.onOpen) return product.home.onOpen(); setView("rooms"); remember("view", "rooms"); },
      onLook: () => openSettings("appearance"),
      onOnboarding: () => { setView("onboarding"); remember("view", "onboarding"); },
      onAll: () => (product.home?.onAll ? product.home.onAll() : setView("rooms")),
      onPick: (id) => (product.home ? product.home.onPick(id) : selectRoom(id)),
    }));
    const s = state.settings || {};
    const vendors = state.recipes.filter((r) => !r.unavailableReason);
    const systems = state.connections || [];
    const joined = systems.filter((c) => c.state !== "not-connected");
    const snapshot = sortedRooms();
    if (!snapshot) return;
    const places = [];
    for (const { room, stats: st } of product.home ? [] : snapshot.slice(0, 4)) {
      const facts = st.facts, last = st.overview.hasChat ? overviewText(room, st, "home") : null;
      if (st.overview.hasChat && !last) return;
      const sub = last ? `${last.fromName}: ${last.text}` : facts.settings.topic || `${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}`;
      places.push({ id: facts.id, mark: roomMark(facts), name: facts.name, sub, unread: st.unread, when: relTime(st.last) });
    }
    if (!overviewEntriesCurrent(snapshot)) return;
    home.update({
      greeting: `${state.freshVibe ? "Welcome" : "Welcome back"}, ${s.humanName || "there"} 👋`,
      places: product.home ? product.home.places() : places,
      vendors: (vendors.length ? vendors : state.recipes).map((r) => `<span class="home-vendor" title="${esc(r.vendor)}${r.unavailableReason ? " (not installed)" : ""}"${r.unavailableReason ? ' style="opacity:.45"' : ""}>${vendorLogo(r, "sm")}</span>`).join(""),
      systems: (joined.length ? joined : systems.filter((c) => c.mark).slice(0, HOME_SYSTEMS)).map((c) => `<span class="home-vendor">${connectionMark(c, "sm")}</span>`).join(""),
    });
  }


  const GRID_DOORS = [
    { entry: "door:open", icon: "plus", title: "Open a room", hint: "a space for you and some vibemates" },
    { entry: "door:template", icon: "rooms", title: "Start from a template", hint: "rules and vibemates, ready to summon" },
  ];
  let roomsGrid = null;
  function renderRoomsGrid() {
    if (state.view === "home") return renderHome();
    roomsGrid ||= lifetime.use(VIBEROOM_ROOMS.grid(els.roomsGrid, {
      window: document.defaultView, signal: lifetime.signal, icon: ic, doors: GRID_DOORS, arrive: arrival,
      onDoor: (entry) => (entry === "door:template" ? openTemplateDialog() : openRoomDialog()),
      onPick: (roomId) => selectRoom(roomId),
    }));
    const rooms = sortedRooms();
    if (!rooms) return;
    const shown = rooms.filter(({ room }) => shownRoom(room));
    setText(els.roomsSub, shown.length ? `${shown.length} room${shown.length === 1 ? "" : "s"}. Pick one, or open a new one.` : "No rooms yet. Open one and summon some vibemates.");
    const entries = [];
    for (const { room, stats: st } of rooms) {
      if (!shownRoom(room)) continue;
      const facts = st.facts;
      const last = !facts.settings.topic && st.overview.hasChat ? overviewText(room, st, "grid") : null;
      if (!facts.settings.topic && st.overview.hasChat && !last) return;
      entries.push({ id: facts.id, current: facts.id === state.currentRoomId, mark: roomMark(facts), name: facts.name, unread: st.unread, thinking: st.thinking,
        topic: facts.settings.topic || (last ? last.text : "Nothing said yet."),
        faces: st.agents.slice(0, 5).map(p => avatar(p, 26, { vendor: true, ring: true })).join(""),
        vibemates: st.agents.length, messages: st.overview.count, when: relTime(st.last) });
    }
    if (overviewEntriesCurrent(rooms)) roomsGrid.update(entries);
  }


  function offlineAgents(room, includeChosen = false) {
    return room ? room.participants.filter((p) => p.kind === "agent" && p.status === "offline" && (includeChosen || (!p.muted && !p.asleep))) : [];
  }

  function renderSideRoom() {
    updateCastGate(currentRoom());
    renderWedgeBanner(currentRoom());
    const room = currentRoom();
    if (!room) return;
    els.sideRoomName.textContent = room.name;
    els.chatRoomName.textContent = room.name;
    const roomFace = room.settings.emoji || "", roomPicture = window.Avatars.faceUrl(roomFace);
    if (roomPicture) els.sideRoomEmoji.innerHTML = `<img class="room-pic" src="${roomPicture}" alt="">`;
    else els.sideRoomEmoji.textContent = roomFace;
    const st = rosterStats(room);
    if (!st) return;
    els.sideRoomCount.textContent = `${st.agents.length} vibemate${st.agents.length === 1 ? "" : "s"}${st.agents.length ? ` · ${st.online} online` : ""}${st.waiting ? ` · ${st.waiting} waiting` : ""}`;
    const rowSpec = VIBEROOM_PARTICIPANTS.rows({
      doc: document, UI, avatar, meAvatarData, vendorLoggedOut, troubleHtml, wakeWord, patchLifeRing, STATUS_LABEL, STATUS_TONE,
      shownStatus: (p) => shownStatus(room, p),
      isSelected: (p) => state.detailsOpen && state.selection.kind === "participant" && state.selection.id === p.id,
    });
    VIBEROOM_PARTICIPANTS.patch(els.participantsMe, els.participants, room.participants, rowSpec);
    renderLifePop();
    renderHushButton(room);
    els.reconnectAllBtn.hidden = offlineAgents(room).length === 0;
  }

  function renderHushButton(room, busy) {
    const b = els.focusBtn;
    const label = b.querySelector(".label");
    b.classList.toggle("busy", !!busy);
    b.classList.toggle("on", !busy && !!room.focused);
    b.setAttribute("aria-pressed", room.focused ? "true" : "false");
    if (busy) {
      label.textContent = "Hushing…";
      b.title = "Stopping every running reply";
    } else if (room.focused) {
      label.textContent = "Hushed · waiting for you";
      b.title = "The vibemates stay quiet until you write again";
    } else {
      label.textContent = "Hush the room";
      b.title = "Stop every running reply; vibemates stay quiet until you speak again";
    }
  }

  function insertMention(name) {
    const start = composer.selectionStart || composer.value.length;
    const before = composer.value.slice(0, start);
    const prefix = before && !/\s$/.test(before) ? " " : "";
    composer.setRangeText(`${prefix}@${name} `, start, start, "end");
    composer.focus();
  }


  function renderChatHead() {
    renderAutomationBadge();
    composer.refresh();
    const room = currentRoom();
    renderWorkingNow();
    if (!room) return void setHtml(els.chatRoomSub, "");
    const directory = room.dir.split(/[\\/]/).filter(Boolean).slice(-1)[0] || room.dir;
    setHtml(els.chatRoomSub,
      `<button type="button" data-ui="button" data-kind="ghost" data-size="sm" class="dir-chip open-link" data-open-kind="directory" data-open="${esc(room.dir)}" title="${esc(`Open folder: ${room.dir}`)}" aria-label="${esc(`Open folder: ${room.dir}`)}"><span class="pad" aria-hidden="true"></span>${rig("folder-solid")}<span class="dir-label">${esc(directory)}</span></button>`);
  }

  function renderAutomationBadge() {
    const count = state.automationPending?.[currentRoom()?.id] || 0;
    const button = $("#automations-btn");
    if (button) {
      setHtml(button, `<span class="pad" aria-hidden="true"></span>${rig("clock-solid")}<span class="automation-count" aria-hidden="true" hidden></span>`);
      const badge = button.querySelector(".automation-count");
      setText(badge, count ? String(count) : "");
      badge.hidden = !count;
      button.title = count ? `Automations: ${count} proposal${count === 1 ? "" : "s"} to review` : "Automations: scheduled tasks and reminders";
      button.setAttribute("aria-label", button.title);
    }
  }


  function messageMatches(m) {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return m.text.toLowerCase().includes(q) || (m.fromName || "").toLowerCase().includes(q) || (m.quotes || []).some((x) => (x.text || "").toLowerCase().includes(q));
  }

  function nowNameHtml(m, p) { return VIBEROOM_MESSAGE_BUBBLE.nowName(m, p); }

  function refreshNowNames(room, p) {
    for (const el of els.messages.querySelectorAll(`.msg.agent[data-from="${cssEscape(p.id)}"]`)) {
      const name = el.querySelector(".msg-head .name");
      if (!name) continue;
      el.querySelector(".msg-head .now-name")?.remove();
      const html = nowNameHtml({ fromName: name.textContent }, p);
      if (html) name.insertAdjacentHTML("afterend", html);
    }
  }
  function renderHidden(el, m) { VIBEROOM_MESSAGE_PARTS.hidden(el, m, { icon: ic }); }

  function landing(el) {
    el.classList.add("landing");
    const own = lifetime.guard((e) => { if (e.target === el) done(); });
    const done = () => { el.classList.remove("landing"); el.removeEventListener("animationend", own); };
    el.addEventListener("animationend", own);
    setTimeout(done, 1200);
    return el;
  }

  function messageElement(room, m, options) {
    const previousCapture = listListenerCapture;
    listListenerCapture = options?.bindings || null;
    try {
    const { el, painted } = buildMessageElement(room, m);
    if (painted) noteDrawn(el, m);
    if (painted && editors.get(m.id)?.roomId === room.id) openInlineEditor(el, room, m, { focus: false });
    return el;
    } finally { listListenerCapture = previousCapture; }
  }
  function buildMessageElement(room, m) {
    const el = document.createElement("div");
    if (listListenerCapture) { listListenerCapture.root = el; el.dataset.listSample = ""; }
    el.dataset.id = m.id;
    el.dataset.seq = m.seq;
    el.dataset.from = m.from;
    el.dataset.streaming = m.streaming ? "1" : "0";
    const data = messageProjections.forMessage(room, m)?.message;
    if (!data) return { el, painted: false };
    if (m.bodyMissing) { fillBodyPlaceholder(el, room, data); return { el, painted: true }; }
    if (state.watched.has(m.id)) observeWatched(el);
    if (m.kind === "hidden") {
      el.className = "msg hidden";
      renderHidden(el, data);
      return { el, painted: true };
    }
    if (m.kind === "system") {
      if (m.audience === "agents") VIBEROOM_MESSAGE_BUBBLE.agentsNote(el, data, { icon: ic });
      else VIBEROOM_MESSAGE_BUBBLE.hubRow(el, data, { UI, fullTime, face: (details, tone) => {
        const who = details.agentId ? findById(room, details.agentId) : null;
        return who ? avatar(who, 20, {}) : tone === "hush" ? HUSH_FACE : "";
      } });
      return { el, painted: true };
    }
    const p = findById(room, m.from) || { name: m.fromName, color: FALLBACK_COLOR(), kind: m.from === "human" ? "human" : "agent" };
    const mine = m.from === "human";
    VIBEROOM_MESSAGE_BUBBLE.bubble(el, data, p, { UI, icon: ic, time, fullTime, face: avatar(mine ? meAvatarData() : p, 32, { vendor: true, me: mine }) });
    bindMessageActions(el, room.id, roomRecordKey(room));
    const painted = updateMessageElement(el, room, m) !== false;
    if (painted && !mine && reader.state(m.id) !== "idle") drawReadingOn(el, reader.state(m.id));
    return { el, painted };
  }

  const devPromptsOn = () => devBuild() && state.settings?.devShowPrompts === true;
  const devMemoryIngestionOn = () => devBuild() && state.settings?.devShowMemoryIngestion === true;
  const messageDevtools = lifetime.use(VIBEROOM_MESSAGE_DEVTOOLS.create(els.messages, {
    UI, esc, bindCopy,
    enabled: kind => kind === "memory" ? devMemoryIngestionOn() : devPromptsOn(),
    targetOf: el => { const room = currentRoom(), roomKey = roomRecordKey(room); return roomKey && { roomId: room.id, roomKey, messageId: el.dataset.id }; },
    current: target => roomRecordKey(currentRoom()) === target.roomKey && roomRecordKey(state.rooms.get(target.roomId)) === target.roomKey,
    read: (kind, target, options) => get(`/api/rooms/${encodeURIComponent(target.roomId)}/messages/${encodeURIComponent(target.messageId)}/${kind === "memory" ? "memory-ingestion" : "prompt"}`, options),
  }));
  function placeDevMemoryIngestion(el) { messageDevtools.placeMemory(el); }
  function placeDevPrompt(el) { messageDevtools.placePrompt(el); }

  function setExpanded(el, roomId, m, open) {
    const anchor = open ? { id: m.id, into: Layout.rect(el).top - Layout.rect(els.messages).top } : null;
    if (open) leaveTheEnd();
    if (open) state.expanded.add(m.id);
    else state.expanded.delete(m.id);
    updateMessageElement(el, state.rooms.get(roomId), m);
    if (anchor) {
      restoreReader(anchor);
      rememberReader();
    }
  }
  const OWN_CLICKS = 'a, button, summary, input, textarea, select, label, [contenteditable="true"], [role="button"], .shot, [data-ui="tool-call"], .edit-box, .perms';
  function clickShowsMore(e, el) {
    if (state.settings?.showMoreOnClick === false) return false;
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (!el.querySelector(".bubble > .text.clamped") || e.target.closest(OWN_CLICKS)) return false;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) for (let i = 0; i < sel.rangeCount; i++) if (sel.getRangeAt(i).intersectsNode(el)) return false;
    return true;
  }

  function bindMessageActions(el, roomId, roomKey) {
    const asItIsNow = () => {
      if (el.dataset.listSample !== undefined) return null;
      const now = state.rooms.get(roomId);
      if (!now || roomRecordKey(now) !== roomKey) return null;
      return now.messages.find((x) => x.id === el.dataset.id) || (now.pinnedOlder || []).find((x) => x.id === el.dataset.id) || null;
    };
    VIBEROOM_MESSAGE_ACTIONS.bind(el, {
      listen: (node, type, fn) => domResources.nodeListener(node, type, fn), current: asItIsNow, showsMore: (e) => clickShowsMore(e, el),
      more: (now) => {
        const opening = !state.expanded.has(now.id);
        setExpanded(el, roomId, now, opening);
        if (!opening) scrollToMessage(el, "center");
      },
      unfold: (now) => setExpanded(el, roomId, now, true),
      edit: (now) => openInlineEditor(el, state.rooms.get(roomId), now),
      read: (now) => readAloud(now),
      quote: (now) => addQuote(now, ""),
      copy: (now) => copyMessage(el, now),
      pin: async (now) => {
        try {
          const room = roomKey ? roomOfRecord(roomKey) : state.rooms.get(roomId);
          if (room) await roomCommands.forRoom(room).pinMessage(now.id, !now.pinned);
        } catch (error) {
          showError(error);
        }
      },
      enter: () => { if (roomRecordKey(currentRoom()) === roomKey) refreshWalkArrows(el); },
      walk: async (act, back) => {
        if (roomRecordKey(currentRoom()) !== roomKey) return;
        const target = walkFrom(el, back);
        if (!target) return;
        if (!await jumpToId(target.id) || lifetime.disposed) return;
        const landed = drawnRow(target.id);
        if (!landed) return;
        refreshWalkArrows(landed);
        const next = landed.querySelector(`.msg-head [data-act="${act}"]`);
        if (next && !next.hidden) next.focus();
      },
    });
  }

  function walkFrom(el, back) {
    const room = currentRoom();
    if (!room) return null;
    const parts = foldParts(room);
    const rows = el.closest(".history-pins") ? parts.above : parts.drawn;
    const at = rows.findIndex(m => m.id === el.dataset.id);
    if (at < 0) return null;
    for (let i = at + (back ? -1 : 1); i >= 0 && i < rows.length; i += back ? -1 : 1) {
      const m = rows[i];
      if (m.kind === "chat" && m.from === el.dataset.from && messageMatches(m)) return m;
    }
    return null;
  }

  function refreshWalkArrows(el) {
    const up = el.querySelector('.msg-head [data-act="up"]');
    const down = el.querySelector('.msg-head [data-act="down"]');
    if (up) up.hidden = !walkFrom(el, true);
    if (down) down.hidden = !walkFrom(el, false);
  }

  function shotUrl(roomId, image) {
    if (image.url) return image.url;
    const version = state.rooms.get(roomId)?.resourceVersions?.[image.file];
    return `/api/rooms/${encodeURIComponent(roomId)}/files/${encodeURIComponent(image.file)}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
  }

  const pictureState = (roomId, file) => (roomId && file && pictureStatus.reader.get(roomId, file)) || null;
  function pictureMark(roomId, file) {
    const s = pictureState(roomId, file);
    if (!s) return "";
    if (s.state === "failed") return `<span class="picture-mark failed" data-hint="${esc(`The vibemates will not see this picture: ${s.reason}`)}">!</span>`;
    return '<span class="picture-mark" data-hint="Preparing for the vibemates…"><span class="picture-spin"></span></span>';
  }
  function refreshPictureMarks(roomId, file) {
    if (currentRoom()?.id !== roomId) return;
    for (const tile of $$(`.bubble .shot[data-file="${CSS.escape(file)}"]`)) {
      tile.querySelector(".picture-mark")?.remove();
      tile.insertAdjacentHTML("beforeend", pictureMark(roomId, file));
    }
    if (pendingShots.some((shot) => shot.stored?.file === file)) renderShotsTray();
  }
  function renderShots(box, room, m) { VIBEROOM_MESSAGE_PARTS.shots(box, m, { url: item => shotUrl(room.id, item), pictureMark: file => pictureMark(room.id, file) }); }
  function renderSounds(box, room, m) { VIBEROOM_MESSAGE_PARTS.sounds(box, m, { url: item => shotUrl(room.id, item), icon: ic, length: soundLength }); }
  function renderVideos(box, room, m) { VIBEROOM_MESSAGE_PARTS.videos(box, m, { url: item => shotUrl(room.id, item), icon: ic, length: soundLength }); }

  const lightbox = lifetime.use(VIBEROOM_LIGHTBOX.create(els.lightbox, { window, signal: lifetime.signal, listenKey }));
  function openLightbox(src, title) { lightbox.open(src, title); }
  const diagramViewer = lifetime.use(VIBEROOM_DIAGRAM_VIEW.create($("#diagram-view"), {
    window, signal: lifetime.signal, layout: () => Layout, icon: ic, listenKey,
  }));
  function openDiagram(block) { diagramViewer.open(block); }
  lifetime.on(els.messages, "click", (e) => {
    const hubRow = e.target.closest('[data-ui="hub-row"][data-ref]');
    if (hubRow) return void jumpToId(hubRow.dataset.ref);
    const shot = e.target.closest(".shot");
    if (shot) return void openLightbox(shot.dataset.src, shot.title);
    const goto = e.target.closest(".quote .q-goto");
    if (goto) {
      const card = goto.closest(".quote");
      return void revealQuote(card.dataset, card.querySelector(".q-text")?.textContent || "");
    }
    const numbered = e.target.closest('[data-ui="message-ref"]');
    if (numbered) {
      if (!window.getSelection().isCollapsed) return;
      hidePeek();
      return void goToNumber(Number(numbered.dataset.seq));
    }
    const heard = e.target.closest(".audio-ref");
    if (heard) {
      const video = heard.classList.contains("video-ref");
      const player = heard.closest(".msg")?.querySelector(video ? `.clip[data-n="${heard.dataset.n}"] video` : `.sound[data-n="${heard.dataset.n}"] audio`);
      if (player && video) player.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (player) player.paused ? void player.play().catch(() => {}) : player.pause();
      return;
    }
    const ref = e.target.closest(".img-ref");
    if (!ref) return;
    const msg = ref.closest(".msg");
    const target = msg && msg.querySelector(`.shot[data-n="${ref.dataset.n}"]`);
    if (target) openLightbox(target.dataset.src, target.title);
  });

  function bodySupplied(p, m) {
    if (m.bodyDelivery) {
      const reader = m.bodyDelivery.readers?.[p.id];
      const exact = !!reader && reader.epoch === p.deliveryEpoch && reader.version === m.bodyDelivery.version;
      if (exact || m.from === "human") return exact;
    }
    return p.lastSeenSeq != null && p.lastSeenSeq >= m.seq;
  }

  function waitingFor(room, m) {
    if (m.from !== "human" || m.kind !== "chat" || m.pending || !(m.seq > 0)) return [];
    return room.participants.filter(p => {
      if (p.kind !== "agent" || p.status !== "thinking") return false;
      if (m.to?.length && !m.to.includes(p.id)) return false;
      if (p.activeTurnId && Number.isSafeInteger(p.activeTurnInputThrough) && m.seq <= p.activeTurnInputThrough) return false;
      if (p.lastSeenSeq == null || p.lastSeenSeq >= m.seq) return false;
      if (m.bodyDelivery) return m.bodyDelivery.readers?.[p.id]?.epoch === p.deliveryEpoch && !!p.deliveryEpoch && !bodySupplied(p, m);
      return p.lastSeenSeq != null && p.lastSeenSeq < m.seq;
    });
  }

  const messageWaiting = lifetime.use(VIBEROOM_MESSAGE_WAITING.create(els.messages, {
    signal: lifetime.signal, UI, icon: ic, esc, onError: showError,
  }));
  function renderWaiting(el, room, m) {
    const agents = waitingFor(room, m), bodyVersion = m.bodyDelivery?.version;
    const stoppable = agents.filter(p => p.activeTurnId && bodyVersion).map(p => ({ id: p.id, name: p.name, turnId: p.activeTurnId }));
    messageWaiting.draw(el, { agents, bodyVersion, stoppable }, () => {
      if (currentRoom() !== room) return null;
      const pending = waitingFor(room, m);
      const current = stoppable.filter(p => pending.some(now => now.id === p.id && now.activeTurnId === p.turnId));
      if (!current.length || m.bodyDelivery?.version !== bodyVersion) { resyncStream(); return null; }
      return async () => {
        const stopped = await Promise.all(current.map(p => post(`/api/rooms/${encodeURIComponent(room.id)}/participants/${encodeURIComponent(p.id)}/cancel`,
          {turnId:p.turnId, messageId:m.id, bodyVersion})));
        if (stopped.some(result => result.stopped === "nothing")) resyncStream();
      };
    });
  }

  const openTools = new Set();
  function toolViewTarget(room, message) {
    if (lifetime.disposed) return undefined;
    const roomIdentity = roomReader.identityForRecord(room);
    return roomIdentity ? Object.freeze({ roomId: room.id, roomIdentity, sourceToken: conversationState.identity(message) }) : undefined;
  }
  function currentToolFrame(node, target, attached = false) {
    if (lifetime.disposed || state.view !== "room" || state.currentRoomId !== target.roomId || (attached && !node.isConnected)) return undefined;
    const room = state.rooms.get(target.roomId);
    if (!room || roomReader.identityForRecord(room) !== target.roomIdentity) return undefined;
    const message = HistoryWindow.messageById(room, node.dataset.id);
    if (!message || conversationState.identity(message) !== target.sourceToken) return undefined;
    const projection = messageProjections.forMessage(room, message);
    if (!projection || projection.message.bodyMissing) return undefined;
    const data = projection.message;
    return Object.freeze({ id: data.id, streaming: data.streaming, toolCalls: data.toolCalls });
  }
  function toolViewPorts(node, target) {
    return { UI, statuses: TOOL_STATUSES,
      readCurrent: () => currentToolFrame(node, target, true),
      stillCurrent: frame => {
        const now = currentToolFrame(node, target);
        return !!now && now.id === frame.id && now.streaming === frame.streaming && now.toolCalls === frame.toolCalls;
      },
      isOpen: id => openTools.has(id),
      details: call => toolDetails.read({ ...target, messageId: node.dataset.id, toolCallId: call.toolCallId, revision: call.detailsRevision }),
      groupOpen: id => openToolGroups.has(id),
      setGroupOpen: (id, open) => { if (open) openToolGroups.add(id); else openToolGroups.delete(id); },
      listen: (element, type, callback) => domResources.nodeListener(element, type, callback),
    };
  }
  function currentToolDetails(target) {
    if (lifetime.disposed || state.view !== "room" || state.currentRoomId !== target.roomId) return null;
    const room = state.rooms.get(target.roomId);
    if (!room || roomReader.identityForRecord(room) !== target.roomIdentity) return null;
    const message = HistoryWindow.messageById(room, target.messageId);
    if (!message || conversationState.identity(message) !== target.sourceToken) return null;
    const tool = messageProjections.forTool(room, message, target.toolCallId);
    if (!tool || tool.toolCall.detailsRevision !== target.revision) return null;
    return { room, message, call: tool.toolCall, token: tool.token, snapshotRevision: tool.snapshotRevision };
  }
  function fetchToolDetails(target, options) {
    if (!currentToolDetails(target)) return Promise.reject(new DOMException("The tool call changed before its details were read.", "AbortError"));
    const part = encodeURIComponent, query = target.roomIdentity.uuid ? `?room=${part(target.roomIdentity.uuid)}` : "";
    return get(`/api/rooms/${part(target.roomId)}/messages/${part(target.messageId)}/tools/${part(target.toolCallId)}${query}`, options);
  }
  function repaintToolDetails(target) {
    const current = currentToolDetails(target);
    if (!current) return;
    const node = els.messages.querySelector(`.msg[data-id="${CSS.escape(target.messageId)}"]`);
    if (node && node.isConnected && drawnFrom.get(node) === target.sourceToken) updateMessageElement(node, current.room, current.message, new Set(["tools"]), new Set([target.toolCallId]));
  }
  function resetMessageViews(room) {
    messageProjections.reset(room);
    toolDetails.reset(room);
    textWork.reset(room);
    conversationReader.reset(room);
    overviewChanged();
    quietChanged(room);
  }
  function currentText(node, target, mounted = true) {
    if (lifetime.disposed || state.view !== "room" || state.currentRoomId !== target.roomId) return undefined;
    const room = state.rooms.get(target.roomId);
    if (!room || roomReader.identityForRecord(room) !== target.roomIdentity) return undefined;
    const bubble = node.matches(".msg") ? node : node.closest(".msg");
    if (!bubble || (mounted && (!node.isConnected || !els.messages.contains(bubble) || drawnFrom.get(bubble) !== target.sourceToken))) return undefined;
    const source = HistoryWindow.messageById(room, bubble.dataset.id);
    if (!source || conversationState.identity(source) !== target.sourceToken) return undefined;
    const read = messageProjections.forText(room, source);
    return read?.textToken === target.textToken ? { room, frame: read.frame } : undefined;
  }
  function textViewPorts(node, target) {
    function facts(frame) {
      const value = currentText(node, target, false);
      if (!value || value.frame !== frame) return undefined;
      const room = roomReader.forRecord(value.room);
      return currentText(node, target, false)?.frame === frame ? room : undefined;
    }
    return {
      current: frame => currentText(node, target, false)?.frame === frame,
      begin: box => { const value = currentText(node, target, false); return value ? textWork.bind(box, target, value.room) : false; },
      stream: (box, frame) => { const room = facts(frame); if (room) renderStreamingWords(room, box, frame.text, frame.to); },
      render: (source, frame) => { const room = facts(frame); return room ? renderText(room, source, frame.images, frame.quotes, frame.to, frame.audio, frame.video, frame.numbersHere) : ""; },
      clamp: clampedSource,
      previews: (box, frame) => { if (facts(frame)) renderPreviews(box, frame, () => !!currentText(node, target)); },
      paths: (box, frame) => { if (facts(frame)) linkRelativePaths(box, frame, () => !!currentText(node, target)); },
      schedule: box => textWork.schedule(box, Date.now() - lastTypedAt < TYPING_WINDOW_MS ? TYPING_WINDOW_MS : 0),
    };
  }
  function finishText(node, target, live) {
    const bubble = node.closest(".msg");
    if (!live() || !canPaintMessagePart(bubble, "text") || !live()) return;
    renderDiagrams(node);
    if (!live()) return;
    highlightBlocks(node, live);
  }
  const openToolGroups = new Set();
  lifetime.on(els.messages, "click", (e) => {
    const stop = e.target.closest('.live-tail [data-act="stop"]');
    if (stop) {
      const msgEl = stop.closest(".msg");
      const from = msgEl && msgEl.dataset.from;
      if (!from) return;
      stop.disabled = true;
      stop.textContent = "Stopping…";
      return void post(roomApi(`/participants/${encodeURIComponent(from)}/cancel`))
        .then((r) => {
          if (r && r.stopped === "nothing") resyncStream();
        })
        .catch((error) => {
          showError(error);
          stop.disabled = false;
          stop.textContent = "Stop";
        });
    }
    const choice = e.target.closest('[data-ui="ask-card"] [data-ui="button"][data-act]');
    if (choice) {
      const card = choice.closest('[data-ui="ask-card"]');
      if (choice.dataset.act === "permit") post(roomApi(`/permissions/${encodeURIComponent(card.dataset.key)}`), { optionId: choice.dataset.option || null }).catch((error) => {
        if (error.status === 410) resolvePermissionCard(card.dataset.key, null, "already ended");
        else showError(error);
      });
      else if (choice.dataset.act === "decide") post(roomApi(`/proposals/${encodeURIComponent(card.dataset.key)}`), { accept: choice.dataset.answer === "apply" }).catch(showError);
      else if (choice.dataset.act === "make-room") post(roomApi(`/new-rooms/${encodeURIComponent(card.dataset.key)}`), { create: choice.dataset.answer === "create" }).catch(showError);
      else if (choice.dataset.act === "try-look") tryLook(choice.dataset.look);
      else if (choice.dataset.act === "knock") void answerKnockOffer(choice.dataset.answer);
      else if (choice.dataset.act === "adopt-copy") {
        void adoptRoomCopy(choice);
      }
      return;
    }
    const retry = e.target.closest("[data-tool-retry]");
    const chip = retry ? retry.closest('[data-ui="tool-call"]').querySelector(':scope > [data-ui="chip"]') : e.target.closest('[data-ui="tool-call"] > [data-ui="chip"]');
    if (!chip) return;
    const msgEl = chip.closest(".msg");
    const room = currentRoom();
    const m = room && msgEl && HistoryWindow.knownMessages(room).find((x) => x.id === msgEl.dataset.id);
    if (!m) return;
    const target = toolViewTarget(room, m), call = m.toolCalls?.find(item => item.toolCallId === chip.dataset.tool);
    if (!target || !call) return;
    toolDetails.forget({ ...target, messageId: m.id, toolCallId: call.toolCallId, revision: call.detailsRevision });
    if (!retry && openTools.has(chip.dataset.tool)) openTools.delete(chip.dataset.tool);
    else openTools.add(chip.dataset.tool);
    updateMessageElement(msgEl, room, m);
  });
  function updateMessageElement(el, room, m, parts, toolIds) {
    const data = messageProjections.forMessage(room, m)?.message;
    if (!data) return false;
    el.dataset.seq = String(m.seq);
    el.dataset.from = m.from;
    if (room.history?.indexed) (room.dirtyHeights ||= new Set()).add(m.id);
    if (m.bodyMissing) { fillBodyPlaceholder(el, room, data); noteDrawn(el, m); return true; }
    if (el.classList.contains("history-placeholder") || !el.classList.contains("msg")) { el.replaceWith(messageElement(room, m)); return true; }
    applyMessageElement(el, room, m, parts, toolIds, data);
    noteDrawn(el, m);
    return true;
  }
  function applyMessageElement(el, room, m, parts, toolIds, data) {
    const P = VIBEROOM_MESSAGE_PARTS;
    P.branch(el, data, data.branch ? (room.sources || []).find(source => source.uuid === data.branch.source)?.label : undefined);
    const want = (part) => !m.streaming || !parts || parts.has(part) || deferredMessageParts.get(el)?.has(part);
    el.dataset.streaming = m.streaming ? "1" : "0";
    el.classList.toggle("hidden-by-search", !messageMatches(m));
    const wasPinned = el.classList.contains("pinned");
    el.classList.toggle("pinned", !!m.pinned);
    const pinBtn = el.querySelector('.msg-head [data-act="pin"]');
    if (pinBtn) pinBtn.title = m.pinned ? "Unpin this message" : "Pin this message";
    if (wasPinned !== !!m.pinned) renderTimeline(true);
    P.edited(el, data);
    if (m.kind === "hidden") {
      const wasOpen = el.querySelector("details")?.open;
      renderHidden(el, data);
      if (wasOpen) el.querySelector("details").open = true;
      return;
    }
    if (m.kind === "system") return;
    const text = el.querySelector(".text");
    const more = el.querySelector('[data-act="more"]');
    const textRead = messageProjections.forText(room, m), roomIdentity = roomReader.identityForRecord(room);
    if (!textRead || !roomIdentity) return;
    const frame = textRead.frame, target = Object.freeze({ roomId: room.id, roomIdentity, sourceToken: textRead.token, textToken: textRead.textToken });
    const long = !frame.streaming && frame.text.length > CLAMP_CHARS && !state.watched.has(frame.id);
    const expanded = state.expanded.has(m.id);
    const T = VIBEROOM_MESSAGE_TEXT;
    T.words(text, frame, {
      ...textViewPorts(el, target),
      paint: want("text") && canPaintMessagePart(el, "text"), long, expanded,
    });
    if (!currentText(el, target, false)) return;
    T.liveTail(el, text, frame, { working: bubbleWorking(room, m), calm: CALM,
      markup: () => `${WORKING_SVG}${THINKING_DOTS}${UI.html("button", { label: "Stop", kind: "ghost", size: "xs", act: "stop", title: "Stop this reply; what is written stays in the room" })}` });
    T.fold(text, more, { long, expanded });
    const note = props => UI.html("reply-note", props);
    P.stopNote(el.querySelector(".stop-note"), data, { note });
    renderShots(el.querySelector(".shots"), room, data);
    renderSounds(el.querySelector(".sounds"), room, data);
    renderVideos(el.querySelector(".videos"), room, data);
    renderWaiting(el, room, m);
    placeDevPrompt(el);
    placeDevMemoryIngestion(el);
    if (m.thought && want("thought") && canPaintMessagePart(el, "thought")) P.thought(el.querySelector(".thought"), data);
    P.notices(el.querySelector(".agent-notices"), data, { note });
    if (want("tools")) {
      const target = toolViewTarget(room, m);
      if (target) VIBEROOM_MESSAGE_TOOLS.draw(el.querySelector(".tools"), Object.freeze({ id: data.id, streaming: data.streaming, toolCalls: data.toolCalls }), {
        ...toolViewPorts(el, target), held: !canPaintMessagePart(el, "tools"), patch: parts && toolIds ? toolIds : null,
      });
    }
    if (want("plan")) P.plan(el.querySelector(".plan"), data);
    const meta = el.querySelector(".meta");
    if (!m.streaming && m.from !== "human") {
      meta.innerHTML = P.stats(data, { icon: ic, duration: fmtDuration, tokens: fmtTokens });
      fillSeen(el, room, m);
    } else if (m.from === "human") fillSeen(el, room, m);
    else meta.innerHTML = liveMetaHtml(room, m) ? `<span class="stats">${liveMetaHtml(room, m)}</span>` : "";
  }
  function liveMetaHtml(room, m) {
    const data = messageProjections.forMessage(room, m)?.message;
    return data ? VIBEROOM_MESSAGE_PARTS.liveMeta(data, { lastSign: lastSignFor(room, m), icon: ic, duration: fmtDuration }) : "";
  }
  function lastSignFor(room, m) {
    const who = room && findById(room, m.from);
    return (who && who.lastSignAt) || m.ts;
  }
  function liveSignHtml(room, m) {
    const data = messageProjections.forMessage(room, m)?.message;
    return data ? VIBEROOM_MESSAGE_PARTS.liveSign(data, { lastSign: lastSignFor(room, m), icon: ic, duration: fmtDuration }) : undefined;
  }
  function tickLive() {
    const room = currentRoom();
    if (!room) return;
    for (const span of els.messages.querySelectorAll(".meta .live")) {
      const node = span.closest(".msg"), m = node && HistoryWindow.messageById(room, node.dataset.id);
      if (m && drawnFrom.get(node) === conversationState.identity(m) && m.streaming) {
        const html = liveSignHtml(room, m);
        if (html !== undefined) span.innerHTML = html;
      }
    }
  }

  function lastHumanMessage(room) {
    for (let i = room.messages.length - 1; i >= 0; i--) {
      const m = room.messages[i];
      if (m.kind === "chat" && m.from === "human") return m;
    }
    return null;
  }
  function seenHtml(room, m) {
    const data = messageProjections.forMessage(room, m)?.message;
    return data ? VIBEROOM_MESSAGE_PARTS.seen(data, room.participants, { bodySupplied }) : undefined;
  }
  function fillSeen(el, room, m) {
    if (m.kind !== "chat" || m.streaming) return;
    const seen = seenHtml(room, m);
    if (seen === undefined) return;
    const html = (m.via ? `<span class="stats" data-hint="written from a phone paired to viberoom">via ${esc(m.via.platform === "telegram" ? "Telegram" : m.via.platform)}</span>${seen ? '<span class="sep">·</span>' : ""}` : "") + seen;
    if (m.from === "human") {
      const meta = el.querySelector(".meta");
      if (!meta) return;
      if (meta.innerHTML !== html) meta.innerHTML = html;
      meta.classList.toggle("seen", !!html);
    } else {
      const meta = el.querySelector(".meta");
      let span = meta && meta.querySelector(".seen-by");
      if (!span && meta && html) {
        span = document.createElement("span");
        span.className = "seen-by";
        meta.appendChild(span);
      }
      if (span) {
        if (span.innerHTML !== html) span.innerHTML = html;
        span.hidden = !html;
      }
    }
  }
  function refreshSeen(room) {
    const present = room.participants.filter((p) => p.kind === "agent" && p.status !== "left" && p.status !== "offline");
    const floor = present.length ? Math.min(...present.map((p) => (p.lastSeenSeq == null ? 0 : p.lastSeenSeq))) : Infinity;
    for (const el of els.messages.querySelectorAll(".msg.mine, .msg.agent")) {
      const seq = Number(el.dataset.seq);
      const hasLabel = el.querySelector(".meta.seen, .seen-by:not([hidden])");
      const m = HistoryWindow.messageById(room, el.dataset.id);
      if (!m) continue;
      if ((m.from !== "human" || !m.bodyDelivery) && seq <= floor && !hasLabel && !el.classList.contains("waiting")) continue;
      fillSeen(el, room, m);
      if (m.from === "human" && (m.bodyDelivery || seq > floor || el.classList.contains("waiting"))) renderWaiting(el, room, m);
    }
  }

  function visibilityMarkers(room) {
    const bySeq = new Map();
    for (const p of room.participants) {
      if (p.kind !== "agent" || p.sawFromSeq === undefined || p.sawFromSeq === null) continue;
      if (!bySeq.has(p.sawFromSeq)) bySeq.set(p.sawFromSeq, []);
      bySeq.get(p.sawFromSeq).push(p);
    }
    return bySeq;
  }
  function visibilityFingerprint(room) {
    return [...visibilityMarkers(room).entries()].map(([seq, ps]) => `${seq}:${ps.map((p) => p.id).join(",")}`).sort().join("|");
  }
  function dividerElement(agents) {
    const names = agents.map((p) => p.name);
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const searching = agents.filter(p => p.skillChannel === "tool");
    const they = agents.length === 1 ? "it" : "they";
    const detail = searching.length === agents.length ? `but ${they} can still read the earlier messages.`
      : searching.length ? "but some of these vibemates can still read the earlier messages." : "Earlier messages remain in the room history.";
    const title = "This marks the starting context supplied to the session, not everything the vibemate remembers." +
      (searching.length ? ` History search is available to ${searching.map(p => p.name).join(", ")}.` : "");
    const el = UI.el("unseen-line", { label: `${who} started from here`, detail, title });
    el.dataset.startSeq = agents[0].sawFromSeq;
    return el;
  }
  function refreshStartingLines(room) {
    for (const [seq, agents] of visibilityMarkers(room)) {
      const line = els.messages.querySelector(`[data-ui="unseen-line"][data-start-seq="${seq}"]`);
      if (line) line.replaceWith(dividerElement(agents));
    }
  }

  const PAGE_SIZE = 50;
  function placeInList(el, host = els.messages) {
    let page = host.lastElementChild;
    if (!page || !page.classList.contains("msgs-page") || page.childElementCount >= PAGE_SIZE) {
      page = document.createElement("div");
      page.className = "msgs-page";
      page.dataset.page = "";
      host.appendChild(page);
    }
    page.appendChild(el);
  }
  function topInList(el) {
    const page = el.parentElement;
    if (!page || !page.classList.contains("msgs-page")) return el.offsetTop;
    const first = page.firstElementChild;
    const laidOut = !first || typeof first.checkVisibility !== "function" || first.checkVisibility({ contentVisibilityAuto: true });
    if (els.messages.classList.contains("searching") || laidOut) {
      let top = 0;
      for (let node = el; node && node !== els.messages; node = node.offsetParent) top += node.offsetTop;
      return top;
    }
    let i = 0;
    for (let n = el.previousElementSibling; n; n = n.previousElementSibling) i++;
    return page.offsetTop + (page.offsetHeight * i) / page.childElementCount;
  }

  function readerAnchor(scrollTop) {
    const m = els.messages;
    const top = scrollTop ?? m.scrollTop;
    let previous = null;
    for (const el of m.querySelectorAll(".msg[data-id]")) {
      const y = topInList(el);
      if (y > top) return previous ? { id: previous.el.dataset.id, into: previous.y - top } : { id: el.dataset.id, into: y - top };
      previous = { el, y };
    }
    return previous ? { id: previous.el.dataset.id, into: previous.y - top } : null;
  }
  let settledReader = null;
  function rememberReader(viewport) {
    if (state.view !== "room" || !currentRoom()) return;
    const anchor = stuck ? null : readerAnchor(viewport?.beforeTop);
    if (anchor && viewport) anchor.into += viewport.aboveDelta - (viewport.top - viewport.beforeTop);
    settledReader = { roomId: state.currentRoomId, anchor, stamp: pricesStamp(viewport?.width), following: stuck };
  }
  let readerRestoreCleanup = null;
  function restoreReader(anchor) {
    if (readerRestoreCleanup) readerRestoreCleanup();
    if (!anchor) return false;
    const el = els.messages.querySelector(`.msg[data-id="${CSS.escape(anchor.id)}"]`);
    if (!el) return false;
    if (els.messages.classList.contains("windowed")) {
      els.messages.scrollTop += Layout.rect(el).top - Layout.rect(els.messages).top - anchor.into;
      return true;
    }
    const page = el.closest(".msgs-page");
    const pageVisibility = page?.style.contentVisibility || "";
    if (page) page.style.contentVisibility = "visible";
    const measured = [];
    if (page) for (const row of page.children) {
      if (row.classList.contains("msg")) {
        measured.push([row, row.style.contentVisibility]);
        row.style.contentVisibility = "visible";
      }
      if (row === el) break;
    }
    let released = false;
    const releaseWhenHidden = lifetime.guard(() => { if (document.hidden) release(); });
    const release = () => {
      if (released) return;
      released = true;
      document.removeEventListener("visibilitychange", releaseWhenHidden);
      for (const [row, visibility] of measured) row.style.contentVisibility = visibility;
      if (page) page.style.contentVisibility = pageVisibility;
      if (readerRestoreCleanup === release) readerRestoreCleanup = null;
    };
    readerRestoreCleanup = release;
    document.addEventListener("visibilitychange", releaseWhenHidden);
    const put = () => {
      let top = 0;
      for (let node = el; node && node !== els.messages; node = node.offsetParent) top += node.offsetTop;
      els.messages.scrollTop = Math.max(0, top - anchor.into);
    };
    put();
    if (document.hidden) { release(); return true; }
    let left = 6;
    let was = els.messages.scrollTop;
    const settle = () => {
      if (readerRestoreCleanup !== release) return;
      if (!el.isConnected) { release(); return; }
      put();
      const now = els.messages.scrollTop;
      if (--left > 0 && Math.abs(now - was) > 1) {
        was = now;
        requestAnimationFrame(settle);
      } else release();
    };
    requestAnimationFrame(settle);
    return true;
  }
  let listRoomId = null;
  const returnPlaces = new Map();
  let returnTo = null;
  function prepareRoomPlace(roomId) {
    const back = returnPlaces.get(roomId) || null;
    returnTo = back ? { roomId, anchor: back } : null;
    stuck = !back;
    readingAway = !!back;
    lastScrollTop = 0;
    lastUserScrollAt = 0;
    wheelGesture.lastAt = 0;
    wheelGesture.beganAtEnd = false;
  }
  function keepReturnPlace(roomId) {
    if (!roomId) return;
    if (state.view === "room" && state.currentRoomId === roomId) rememberReader();
    const left = settledReader?.roomId === roomId && !settledReader.following ? settledReader.anchor : null;
    if (left) returnPlaces.set(roomId, left);
    else returnPlaces.delete(roomId);
  }
  function showRoomList(why) {
    const room = currentRoom();
    let back = returnTo?.roomId === room?.id ? returnTo.anchor : null;
    returnTo = null;
    if (back && !HistoryWindow.knownMessages(room).some((m) => m.id === back.id)) {
      back = null;
      stuck = true;
      readingAway = false;
    }
    if (room?.restoreFrom && !room.historyRestoring) void refreshHeld(room.id, back ? { ...room.restoreFrom, reader: back, returning: true } : room.restoreFrom);
    else if (room?.history?.bodyProtocol && !room.history.indexed && !room.historyRestoring && !room.historyIndexLoading) {
      void refreshHeld(room.id, { indexOnly: true });
    }
    if (room?.historyRestoring) return renderMessages(why);
    return renderMessages(why, back || undefined);
  }
  const { FOLD_SHOWN, FOLD_STEP } = Fold;
  const foldAnchor = new Map();
  function foldShown(room) {
    const own = room && room.settings ? room.settings.foldAfter : null;
    const app = state.settings ? state.settings.foldAfter : null;
    return own || app || FOLD_SHOWN;
  }
  function foldSettingChanged(roomId) {
    const roomIds = roomId ? [roomId] : [...state.rooms.values()].filter((r) => !(r.settings && r.settings.foldAfter)).map((r) => r.id);
    for (const id of roomIds) foldAnchor.delete(id);
    const room = currentRoom();
    if (!room || !roomIds.includes(room.id)) return;
    if (room.history?.version && remoteHidden(room) && foldShown(room) > room.messages.length) {
      room.restoreFrom = {};
      if (state.view === "room") void refreshHeld(room.id);
      else listRoomId = null;
      return;
    }
    if (state.view === "room") renderMessages("the fold setting changed");
    else listRoomId = null;
  }
  function foldIndex(room) {
    if (room.history?.indexed) return 0;
    let anchor = foldAnchor.get(room.id);
    const shown = foldShown(room);
    if (!anchor && room.messages.length >= shown) {
      const index = room.messages.length - shown;
      const first = room.messages[index];
      anchor = room.history?.version && index === 0 && remoteHidden(room) && first.seq > 0
        ? { id: first.id, order: first.displayOrder ?? first.seq }
        : Fold.anchorAt(room.messages, index);
      foldAnchor.set(room.id, anchor);
    }
    return Fold.foldIndexFor(room.messages, anchor, shown);
  }
  const remoteHidden = (room) => (room?.history?.indexed ? 0 : room && room.history ? room.history.hidden : 0);
  const foldHidden = (room) => foldIndex(room) + remoteHidden(room);
  function setFoldIndex(room, index) {
    if (room.history?.indexed) return;
    const anchor = Fold.anchorAt(room.messages, index);
    const first = room.messages[Math.max(0, index)];
    foldAnchor.set(room.id, anchor.all && remoteHidden(room) && first
      ? { id: first.id, order: first.displayOrder ?? first.seq } : anchor);
  }
  function foldParts(room) {
    const local = Fold.partsOf(room.messages, foldIndex(room));
    const remote = remoteHidden(room);
    if (!remote) return local;
    const held = new Set(room.messages.map((m) => m.id));
    const older = (room.pinnedOlder || []).filter((p) => !held.has(p.id));
    return { hidden: local.hidden + remote, drawn: local.drawn, above: [...older, ...local.above] };
  }
  const cursorOf = (m) => ({ order: m.displayOrder != null ? m.displayOrder : m.seq, seq: m.seq });
  const before = (a, b) => a.order < b.order || (a.order === b.order && a.seq < b.seq);
  function trimBodyCache(room, extra = []) { return historyLoading.trimBodyCache(room, extra); }
  function fillBodyPlaceholder(el, room, m) {
    el.className = `msg history-placeholder ${m.from === "human" ? "mine" : "agent"}`;
    const size = measuredRows.get(m.id) ?? (rowPrices.fallback ? priceItem({ kind: "msg", m }) : 100);
    el.style.minHeight = `${Math.max(64, size)}px`;
    el.style.setProperty("--dummy-w", `${Math.round(Math.min(86, 30 + 2.2 * Math.sqrt(m.bodyChars || String(m.text || "").length || 1)))}%`);
    el.setAttribute("aria-busy", m.bodyError ? "false" : "true");
    const label = m.bodyError ? "This message could not be loaded." : "Loading message…";
    if (el.dataset.loadLabel === label) return;
    el.dataset.loadLabel = label;
    el.innerHTML = m.bodyError
      ? `<span class="placeholder-label">${esc(m.fromName || "Room")} · ${esc(label)}</span><button class="linklike">Try again</button>`
      : `${UI.html("skeleton", { lines: 0, shape: "bubble", still: true })}<span class="placeholder-label for-readers">${esc(m.fromName || "Room")} · ${esc(label)}</span>`;
    domResources.nodeListener(el.querySelector("button"), "click", () => {
      const visible = [...els.messages.querySelectorAll(".msg[data-id]")].map(node => node.dataset.id);
      void loadBodies(room, [...new Set([m.id, ...visible])], true).catch(error => { if (!lifetime.disposed) showError(error); });
    });
  }
  const CATCH_UP_MS = 2000;
  const CATCH_UPS = 4;
  const historyLoading = lifetime.use(VIBEROOM_HISTORY_LOADING.create({
    window: document.defaultView, signal: lifetime.signal,
    recordOf: id => state.rooms.get(id), isShowing: room => currentRoom() === room && state.view === "room",
    visibleIds: () => [...els.messages.querySelectorAll(".msg[data-id]")].map(node => node.dataset.id),
    get, refreshHeld: roomId => refreshHeld(roomId), renderSoon: renderMessagesSoon, onError: showError,
    conversation: { trimBodies: (room, ids) => conversationState.trimBodies(room, ids),
      clearBodyErrors: (room, ids) => conversationState.clearBodyErrors(room, ids),
      failBodies: (room, ids, reason) => conversationState.failBodies(room, ids, reason),
      mergeBodies: (room, page, generation) => conversationState.mergeBodies(room, page, generation),
      mergePage: (room, page, ticket) => conversationState.mergePage(room, page, ticket) },
    catchUpMs: CATCH_UP_MS, catchUps: CATCH_UPS,
  }));
  const quietReads = new Set();
  let timelineReader = null, timelineReady = false, listReader = null;
  function quietChanged(room, change) {
    if (change?.timelineHeadersChanged === false) timelineReader?.contentChanged(room);
    else timelineReader?.changed(room);
    listReader?.changed(room);
    if (!lifetime.disposed && currentRoom() === room && state.view === "room"
      && (quietReads.has(room) || els.messages.querySelector(":scope > .empty-room"))) renderMessagesSoon("quiet-room facts changed");
  }
  const conversationState = lifetime.use(VIBEROOM_CONVERSATION_STATE.create({
    window: document.defaultView, signal: lifetime.signal, recordOf: id => state.rooms.get(id), aboveHeld: (room, message) => aboveHeld(room, message),
    adopted: (room, localId, realId) => adoptLocalMessageInView(room, localId, realId),
    removed: (room, id) => removeMessageFromView(room.id, id),
    delivered: (room, message, showing) => showMessageDelivery(room, message, showing),
    bufferDelta: (room, event) => historyReconciliation.bufferDelta(room, event),
    projectionChanged: (room, change) => { messageProjections.changed(room, change); toolDetails.changed(room, change); textWork.changed(room, change); conversationReader.changed(room); overviewChanged(); quietChanged(room, change); },
    projectionRemoved: (room, tokens) => { messageProjections.removed(room, tokens); toolDetails.removed(room, tokens); textWork.removed(room, tokens); conversationReader.changed(room); overviewChanged(); quietChanged(room); },
    projectionReset: room => resetMessageViews(room),
    collectionsChanged: (room, change) => { conversationReader.collectionsChanged(room, change); overviewChanged(); quietChanged(room); },
  }));
  const messageProjections = lifetime.use(VIBEROOM_MESSAGE_PROJECTIONS.create({
    window: document.defaultView, signal: conversationState.signal, recordOf: id => state.rooms.get(id),
    messageOf: (room, id) => HistoryWindow.messageById(room, id),
    headerMessageOf: (room, id, collection) => HistoryWindow.messageInCollection(room, id, collection),
    stampOf: source => ({ token: conversationState.identity(source), contentRevision: conversationState.revision(source),
      snapshotRevision: conversationState.snapshotRevision(source) }),
  }));
  const conversationReader = lifetime.use(VIBEROOM_CONVERSATION_READER.create({
    window: document.defaultView, signal: conversationState.signal, recordOf: id => state.rooms.get(id),
    identityOf: room => roomReader.identityForRecord(room), collectionsOf: room => conversationState.collectionsOf(room),
    rowsOf: (room, collection) => collection === "held" ? room.messages : room.pinnedOlder || [],
    messageOf: (room, id) => HistoryWindow.messageById(room, id), headerOf: (room, source, collection) => messageProjections.forHeader(room, source, collection),
    stampOf: source => ({ token: conversationState.identity(source), snapshotRevision: conversationState.snapshotRevision(source) }),
    overviewMetaOf: room => ({ counts: conversationState.chatCounts(room), lastChat: room.history?.lastChat,
      lastChatAt: room.history?.lastChatAt, chats: room.history?.chats, hidden: room.history?.hidden }),
    quietHistoryOf: room => ({ bodyProtocol: room.history?.bodyProtocol, indexed: room.history?.indexed, total: room.history?.total }),
  }));
  const toolDetails = lifetime.use(VIBEROOM_TOOL_DETAILS.create({
    window: document.defaultView, signal: conversationState.signal,
    current: target => {
      const value = currentToolDetails(target);
      return value ? { record: value.room, roomIdentity: target.roomIdentity, token: value.token, snapshotRevision: value.snapshotRevision, call: value.call } : undefined;
    },
    get: fetchToolDetails, isOpen: id => openTools.has(id), repaint: repaintToolDetails,
  }));
  const textWork = lifetime.use(VIBEROOM_MESSAGE_TEXT_WORK.create({
    window: document.defaultView, signal: conversationState.signal, current: (node, target) => !!currentText(node, target), finish: finishText,
  }));
  const historyReconciliation = lifetime.use(VIBEROOM_HISTORY_RECONCILIATION.create({
    window: document.defaultView, signal: lifetime.signal, recordOf: id => state.rooms.get(id), get,
    releasePage: room => historyLoading.releasePage(room),
    restorePending: room => !!room.restoreFrom, consumeRestore: room => { room.restoreFrom = null; },
    captureReader: (id, requireRoomView) => id === state.currentRoomId && (!requireRoomView || state.view === "room") && !stuck ? readerAnchor() : null,
    foldAll: id => !!foldAnchor.get(id)?.all,
    widenToIndex: (room, index) => setFoldIndex(room, Math.min(foldIndex(room), Math.max(0, index - Fold.FOLD_STEP))),
    replayEvent: (id, event) => onRoomEvent(id, event),
    returningWithoutAnchor: id => { if (id === state.currentRoomId) { stuck = true; readingAway = false; } },
    accepted: (id, { anchor, targetIndex }, current) => {
      if (id === state.currentRoomId && state.view === "room") {
        if (targetIndex >= 0) leaveTheEnd();
        renderMessages("the loaded history was refreshed", anchor);
        if (current()) renderSideRoom();
      } else if (listRoomId === id) listRoomId = null;
    },
    stopped: (id, { indexOnly, resumeDrawing }, current) => {
      const room = state.rooms.get(id);
      if (indexOnly && id === state.currentRoomId && state.view === "room") updateHistoryLoading(room, els.messages.querySelector(".history-load"));
      if (!current()) return;
      if (resumeDrawing) {
        if (id === state.currentRoomId && state.view === "room") {
          renderMessages("history loading stopped");
          if (current()) renderSideRoom();
        } else if (listRoomId === id) listRoomId = null;
      }
    }, onError: showError, replaceRange: (room, fresh) => conversationState.replaceRange(room, fresh),
  }));
  function caughtUp(room, epoch, revision, waitMs = CATCH_UP_MS) { return historyLoading.caughtUp(room, epoch, revision, waitMs); }
  function loadBodies(room, ids, retry = false) { return historyLoading.loadBodies(room, ids, retry); }
  function wantBodies(room) { return historyLoading.wantBodies(room); }
  function syncHistoryCount(room) { return HistoryWindow.syncCount(room); }
  const aboveHeld = (room, m) => !!(room.history && room.history.oldest && before(cursorOf(m), room.history.oldest));
  function loadOlder(room, count) { return historyLoading.loadOlder(room, count); }
  function refreshHeld(roomId, wanted = {}) { return historyReconciliation.refreshHeld(roomId, wanted); }
  const ARRIVE_STAGGER_CAP = 8;
  async function growFold(more, why, roomId) {
    const room = state.rooms.get(roomId);
    if (!room || !foldHidden(room) || room.loadingOlder || room.historyRestoring || room.historyIndexLoading) return;
    const generation = room.historyGeneration || 0;
    let oldIndex = foldIndex(room);
    if (remoteHidden(room) && (more === "all" || oldIndex < more)) {
      const firstShown = room.messages[oldIndex] ? room.messages[oldIndex].id : null;
      const got = await loadOlder(room, more === "all" ? "all" : more - oldIndex);
      if (got === null || state.rooms.get(roomId) !== room || (room.historyGeneration || 0) !== generation) return;
      if (firstShown) {
        const at = room.messages.findIndex((m) => m.id === firstShown);
        if (at >= 0) oldIndex = at;
      } else oldIndex = room.messages.length;
    }
    setFoldIndex(room, more === "all" ? 0 : oldIndex - more);
    if (roomId !== state.currentRoomId || state.view !== "room" || listRoomId !== room.id) return;
    const ceiling = els.messages.querySelector(".fold-ceiling");
    if (more === "all" || !ceiling) return renderMessages(why);
    const t0 = performance.now();
    const stretch = room.messages.slice(foldIndex(room), oldIndex);
    const standing = new Set([...els.messages.querySelectorAll(".msg[data-id]")].map((el) => el.dataset.id));
    arriving = new Set(stretch.map((m) => m.id));
    try {
      renderMessages(why);
    } finally {
      arriving = null;
    }
    const arrived = stretch
      .filter((m) => !standing.has(m.id))
      .map((m) => els.messages.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`))
      .filter(Boolean);
    noteSlow(`${stretch.length} older messages drawn (${why})`, performance.now() - t0);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const animate = !document.hidden && currentRoom() === room && state.view === "room";
      arrived.forEach((el, i) => {
        el.classList.remove("history-arriving");
        if (!animate || !el.isConnected) return;
        el.style.setProperty("--arrive", String(Math.min(ARRIVE_STAGGER_CAP, arrived.length - 1 - i)));
        el.classList.replace("history-static", "history-arrived");
        const own = lifetime.guard((e) => { if (e.target !== el) return; el.style.removeProperty("--arrive"); el.removeEventListener("animationend", own); });
        el.addEventListener("animationend", own);
      });
    }));
  }

  async function revealQuote(ref, fragment = "") {
    const seq = Number(ref.seq);
    if (seq > 0) return revealSeq(seq, fragment);
    const live = ref.quotedId ? els.messages.querySelector(`.msg[data-id="${CSS.escape(ref.quotedId)}"]`) : null;
    if (live) return jumpToPassage(live, fragment);
    toast("That reply never finished, so there is no message to go to.", "warn");
    return false;
  }
  async function revealSeq(seq, fragment = "") {
    const room = currentRoom();
    if (lifetime.disposed || !room || !Number.isFinite(seq)) return false;
    let index = room.messages.findIndex((m) => m.seq === seq);
    let loaded = false;
    if (index < 0 && remoteHidden(room)) {
      loaded = await refreshHeld(room.id, { seq, reader: null });
      if (lifetime.disposed || !loaded || state.rooms.get(room.id) !== room || currentRoom() !== room) return false;
      index = room.messages.findIndex((m) => m.seq === seq);
    }
    if (index < 0) return false;
    if (room.messages[index].bodyMissing) {
      const bodiesLoaded = await loadBodies(room, [room.messages[index].id], true);
      if (lifetime.disposed || currentRoom() !== room) return false;
      if (!bodiesLoaded) {
        toast("This message could not be loaded. Try again when the connection is back.", "warn");
        return false;
      }
    }
    if (currentRoom() !== room) return false;
    if (loaded || index < foldIndex(room)) {
      setFoldIndex(room, Math.max(0, index - FOLD_STEP));
    }
    if (!els.messages.querySelector(`.msg[data-seq="${CSS.escape(String(seq))}"]`)) {
      leaveTheEnd();
      renderMessages("a message was asked for", { id: room.messages[index].id, into: 12 });
    }
    return jumpToPassage(els.messages.querySelector(`.msg[data-seq="${CSS.escape(String(seq))}"]`), fragment);
  }

  function messageBySeq(room, seq) {
    return (room && HistoryWindow.knownMessages(room).find((m) => m.seq === seq)) || null;
  }
  async function goToNumber(seq) {
    const room = currentRoom();
    if (!room) return;
    if (room.history?.indexed && !messageBySeq(room, seq)) return void toast(`This room has no message #${seq}.`, "warn");
    if (!await revealSeq(seq) && !lifetime.disposed && currentRoom() === room && !messageBySeq(room, seq)) toast(`Message #${seq} could not be reached; it may be older than this room holds.`, "warn");
  }
  const PEEK_CHARS = 240;
  function peekProps(room, seq) {
    const m = messageBySeq(room, seq);
    if (!m) {
      return room?.history?.indexed ? { seq, text: "This room has no message with this number.", missing: true } : { seq, text: "Its words are not loaded yet; a click goes to them." };
    }
    const p = findById(room, m.from);
    const who = m.from === "human" ? Object.assign(meAvatarData(), { color: (p || {}).color }) : p;
    const words = String(m.text || "").trim().replace(/\s+/g, " ");
    const cut = m.bodyMissing ? String(m.text || "").length >= PEEK_CHARS && (m.bodyChars || 0) > PEEK_CHARS : words.length > PEEK_CHARS;
    const heard = words ? "" : (m.audio || []).map((sound) => String(sound.words || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
    const text = words ? `${words.slice(0, PEEK_CHARS).trimEnd()}${cut ? "…" : ""}`
      : heard ? `${heard.slice(0, PEEK_CHARS).trimEnd()}${heard.length > PEEK_CHARS ? "…" : ""}`
      : m.images?.length ? `[${m.images.length} image${m.images.length === 1 ? "" : "s"}]`
      : m.audio?.length ? `[${m.audio.length} sound${m.audio.length === 1 ? "" : "s"}]`
      : m.video?.length ? `[${m.video.length} video${m.video.length === 1 ? "" : "s"}]` : "";
    return { seq, name: m.fromName || (who && who.name) || "Room", color: p ? colourOf(p) : undefined, face: who ? UI.raw(avatar(who, 18, {})) : undefined, when: `${dayLabel(m.ts)} ${time(m.ts)}`, text };
  }
  const messageReference = lifetime.use(VIBEROOM_MESSAGE_REFERENCE.create(uiRoot, {
    signal: lifetime.signal, messages: els.messages, UI, Layout, currentRoom, roomRecordKey, viewOf: () => state.view,
    hoverDelayMs, props: peekProps, listenKey,
  }));
  function hidePeek() { messageReference.hide(); }

  function releaseFold(room) {
    if (room?.history?.indexed) { trimBodyCache(room); return false; }
    const anchor = room && foldAnchor.get(room.id);
    if (!anchor || !Fold.anchorSurplus(room.messages, anchor, foldShown(room))) return false;
    foldAnchor.delete(room.id);
    if (room.id !== state.currentRoomId || state.view !== "room" || listRoomId !== room.id) return true;
    const started = performance.now();
    const before = els.messages.querySelectorAll(".msg[data-id]").length;
    renderMessages("the list gave the fold back");
    const removed = before - els.messages.querySelectorAll(".msg[data-id]").length;
    noteSlow(`the list gave back ${removed} rows`, performance.now() - started);
    return true;
  }

  lifetime.on(els.messages, "copy", (event) => {
    const selection = getSelection();
    const room = currentRoom();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !room) return;
    const chosen = selection.getRangeAt(0);
    if ([...els.messages.querySelectorAll(".history-placeholder")].some(node => chosen.intersectsNode(node))) {
      event.preventDefault(); event.stopImmediatePropagation();
      toast("Some selected messages are still loading. Load or retry them before copying.", "warn");
      return;
    }
    const parts = [];
    const shaped = [];
    let whole = false;
    for (const msg of els.messages.querySelectorAll(".msg[data-id]")) {
      const words = msg.querySelector(".text > .words");
      if (!words || !selection.containsNode(words, true)) continue;
      const m = room.messages.find((x) => x.id === msg.dataset.id);
      if (m && msg.querySelector(".text.clamped") && selection.containsNode(words, false)) {
        parts.push(m.text);
        shaped.push(copyableHtml(msg, m));
        whole = true;
        continue;
      }
      const inside = document.createRange();
      inside.selectNodeContents(words);
      if (chosen.compareBoundaryPoints(Range.START_TO_START, inside) > 0) inside.setStart(chosen.startContainer, chosen.startOffset);
      if (chosen.compareBoundaryPoints(Range.END_TO_END, inside) < 0) inside.setEnd(chosen.endContainer, chosen.endOffset);
      parts.push(inside.toString());
      const shape = document.createElement("div");
      shape.appendChild(inside.cloneContents());
      shaped.push(shape.innerHTML);
    }
    if (!whole || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", parts.filter((p) => p && p.trim()).join("\n\n"));
    event.clipboardData.setData("text/html", shaped.filter((p) => p && p.trim()).join("<br><br>"));
    event.preventDefault();
  });

  const FOLD_SETTLE_MS = 2000;
  let foldSettleTimer = 0;
  function foldSettleSoon() {
    clearTimeout(foldSettleTimer);
    if (!stuck) return;
    const settling = state.currentRoomId;
    foldSettleTimer = setTimeout(() => {
      const room = currentRoom();
      if (stuck && room && room.id === settling && state.view === "room" && !room.messages.some((m) => m.streaming)) releaseFold(room);
    }, FOLD_SETTLE_MS);
  }

  function ceilingElement(room, hidden, pinned) {
    const el = document.createElement("div");
    el.className = "fold-ceiling";
    el.innerHTML = `<span class="history-rule" aria-hidden="true"></span>`;
    el.appendChild(historyLoadElement(room, hidden, pinned));
    el.insertAdjacentHTML("beforeend", `<span class="history-rule" aria-hidden="true"></span>`);
    return el;
  }
  const historyHintObserver = domResources.observe(IntersectionObserver, entries => {
    for (const entry of entries) if (els.messages.contains(entry.target)) entry.target.classList.toggle("in-view", entry.isIntersecting);
  }, { root: els.messages }).observer;
  function historyLoadElement(room, hidden, pinned) {
    const el = document.createElement("div");
    el.className = "history-load";
    el.innerHTML = `<div class="history-next">` +
      `<span class="history-scroll-icon" aria-hidden="true">${ic("chevrons-up")}</span>` +
      `<span class="fc-hint">Scroll up to load more</span></div>` +
      `<span class="fc-label" role="status"><strong class="fc-what">${hidden} earlier message${hidden === 1 ? "" : "s"} hidden.</strong>` +
      `<span class="fc-pins"${pinned ? "" : " hidden"}>Only pinned are shown.</span></span>` +
      UI.html("button", { label: "Load whole history", icon: "chevrons-up", kind: "secondary", size: "sm", act: "fold-all", title: "Show all earlier messages at once" });
    domResources.nodeListener(el.querySelector('[data-act="fold-all"]'), "click", () => requestOlder(room, "all", "the whole history was asked for"));
    updateHistoryLoading(room, el);
    historyHintObserver.observe(el);
    return el;
  }
  function updateHistoryBoundary(room, hidden, pinned) {
    const controls = els.messages.querySelector(".history-load");
    const ceiling = els.messages.querySelector(".fold-ceiling");
    if (!hidden) {
      if (controls) { historyHintObserver.unobserve(controls); controls.remove(); }
      ceiling?.remove();
      return;
    }
    if (ceiling) {
      ceiling.querySelector(".fc-what").textContent = `${hidden} earlier message${hidden === 1 ? "" : "s"} hidden.`;
      ceiling.querySelector(".fc-pins").hidden = !pinned;
    }
  }
  function updateHistoryLoading(room, controls) {
    if (!controls) return;
    const busy = !!room.historyLoadAction || !!room.loadingOlder || !!room.historyRestoring || !!room.historyIndexLoading;
    const all = controls.querySelector('[data-act="fold-all"]');
    controls.setAttribute("aria-busy", String(busy));
    all.disabled = busy;
    if (room.historyLoadAction?.more === "all") {
      all.dataset.state = "loading";
      all.setAttribute("aria-label", "Loading whole history");
    } else {
      delete all.dataset.state;
      all.removeAttribute("aria-label");
    }
  }
  function historyLoadingPaint() {
    if (lifetime.disposed) return Promise.reject(lifetime.signal.reason);
    return new Promise((resolve, reject) => {
      let settled = false, frame = 0, timer = 0, afterFrame = 0, release = () => {};
      const finish = (settle, value) => {
        if (settled) return;
        settled = true;
        lifetime.cancelFrame(frame); lifetime.clearTimeout(timer); lifetime.clearTimeout(afterFrame);
        release(); settle(value);
      };
      release = lifetime.own(() => finish(reject, lifetime.signal.reason));
      timer = lifetime.timeout(() => finish(resolve), 100);
      frame = lifetime.frame(() => { afterFrame = lifetime.timeout(() => finish(resolve), 0); });
    });
  }
  async function requestOlder(room, more, why) {
    if (currentRoom() !== room || state.view !== "room" || room.historyLoadAction || room.loadingOlder || room.historyRestoring || room.historyIndexLoading) return;
    const controls = els.messages.querySelector(".history-load");
    if (!controls || controls.getAttribute("aria-busy") === "true") return;
    const action = { more };
    room.historyLoadAction = action;
    updateHistoryLoading(room, controls);
    try {
      if (more === "all") await historyLoadingPaint();
      if (lifetime.disposed) return;
      if (state.rooms.get(room.id) === room) await growFold(more, why, room.id);
    } catch (error) { if (!lifetime.disposed) showError(error); }
    finally {
      if (room.historyLoadAction === action) delete room.historyLoadAction;
      if (!lifetime.disposed && currentRoom() === room && state.view === "room") updateHistoryLoading(room, els.messages.querySelector(".history-load"));
    }
  }
  let foldBusy = false;
  function historyBoundaryReached() {
    const ceiling = els.messages.querySelector(".fold-ceiling");
    if (!ceiling) return false;
    const box = Layout.rect(els.messages), boundary = Layout.rect(ceiling);
    return boundary.bottom >= box.top && boundary.top <= box.bottom;
  }
  function requestHistoryAtTop(intent = false) {
    if (state.view !== "room" || foldBusy || !historyBoundaryReached()) return;
    if (!intent && Date.now() - lastUserScrollAt > 700) return;
    const room = currentRoom();
    if (!room || !foldHidden(room)) return;
    foldBusy = true;
    setTimeout(async () => {
      try {
        if (currentRoom() === room && state.view === "room" && historyBoundaryReached()) await requestOlder(room, FOLD_STEP, "the reader reached the ceiling");
      } finally { foldBusy = false; }
    }, 180);
  }
  let historyScrollTop = 0;
  lifetime.on(els.messages, "scroll", () => {
    const top = els.messages.scrollTop, up = top < historyScrollTop;
    historyScrollTop = top;
    if (up) requestHistoryAtTop();
  }, { passive: true });
  function canPullEarlier(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    if (els.messages.contains(event.target)) for (let node = event.target; node && node !== els.messages; node = node.parentElement) {
      if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight && /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)) return false;
    }
    return true;
  }
  lifetime.on(els.messages, "wheel", event => { if (event.deltaY < 0 && canPullEarlier(event)) requestHistoryAtTop(true); }, { passive: true });
  listenKey(event => {
    if (!["ArrowUp", "PageUp", "Home"].includes(event.key) || !canPullEarlier(event) || event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (event.target === uiRoot || isBodyKey(event) || els.messages.contains(event.target)) requestHistoryAtTop(true);
  });

  function dayElement(day, ts) {
    const el = document.createElement("div");
    el.className = "day";
    el.textContent = day;
    el.title = new Date(ts).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return el;
  }

  const drawnFrom = new WeakMap();
  const drawnEdit = new WeakMap();
  let arriving = null;
  let listGeneration = 0;
  let listSearch = null;
  function drawnCurrent(el, m) {
    return drawnFrom.get(el) === conversationState.identity(m) && drawnEdit.get(el) === conversationState.revision(m) && listGeneration === Number(el.dataset.gen);
  }
  function pendingPatch(el, m) {
    const entry = m.streaming ? dirty.get(m.id) : null;
    if (!entry || !entry.parts || deferredMessageParts.has(el)) return null;
    if (drawnFrom.get(el) !== conversationState.identity(m) || listGeneration !== Number(el.dataset.gen)) return null;
    if (drawnEdit.get(el) !== entry.base || conversationState.revision(m) !== entry.base + entry.patches) return null;
    return entry;
  }
  function noteDrawn(el, m) {
    drawnFrom.set(el, conversationState.identity(m));
    drawnEdit.set(el, conversationState.revision(m));
    el.dataset.gen = String(listGeneration);
    el.dataset.w = String((m.text || "").length);
  }

  let listIdentities = new WeakMap();
  lifetime.own(() => { listIdentities = new WeakMap(); });
  const listSelections = new WeakMap();
  const listSampleScopes = new WeakMap();
  function listContext() {
    if (lifetime.disposed || state.view !== "room") return undefined;
    const record = currentRoom(), search = state.search, drawing = listGeneration;
    if (!record) return undefined;
    const held = () => !lifetime.disposed && state.view === "room" && currentRoom() === record && state.rooms.get(record.id) === record
      && state.search === search && listGeneration === drawing;
    let roomIdentity = listIdentities.get(record);
    if (!roomIdentity) {
      roomIdentity = roomReader.identityForRecord(record);
      if (!roomIdentity || !held()) return undefined;
      listIdentities.set(record, roomIdentity);
    }
    return held() ? { record, roomIdentity, search, drawing, held } : undefined;
  }
  listReader = lifetime.use(VIBEROOM_CONVERSATION_LIST_READER.create({
    window: document.defaultView, signal: lifetime.signal, current: listContext,
    rowsOf: (record, ticket) => { const selected = listSelections.get(ticket); return selected?.record === record ? selected.items : undefined; },
    stampOf: (record, source) => HistoryWindow.messageById(record, source.id) === source ? {
      token: conversationState.identity(source), snapshotRevision: conversationState.snapshotRevision(source), arriving: !!arriving?.has(source.id),
    } : undefined,
    dayLabel,
  }));
  function refusedList(facts) {
    if (facts?.sampleToken && !listSampleScopes.has(facts.sampleToken)) return;
    if (!lifetime.disposed && state.view === "room" && listIdentities.get(currentRoom()) === facts?.roomIdentity)
      renderMessagesSoon("list facts changed during drawing");
  }
  function readListRows(record, items, phase = "visible") {
    const context = listContext();
    if (!context || context.record !== record) return undefined;
    const facts = listReader.currentFacts(), ticket = Object.freeze({});
    if (!facts) return undefined;
    listSelections.set(ticket, { record, items });
    try {
      const rows = listReader.rowsFor(facts, ticket, phase);
      if (!rows) { refusedList(facts); return undefined; }
      return { facts, rows };
    } finally { listSelections.delete(ticket); }
  }
  function withListRoom(facts, work) {
    if (!listFactsHeld(facts)) return undefined;
    const record = currentRoom(), value = work(record);
    return listFactsHeld(facts) && currentRoom() === record ? value : undefined;
  }
  function listFactsHeld(facts) {
    return listReader.valid(facts) && (!facts.sampleToken || (listSampleScopes.has(facts.sampleToken) && !listSampleScopes.get(facts.sampleToken).disposed));
  }
  function listSampleNode(facts, build) {
    const sample = facts.sampleToken && listSampleScopes.get(facts.sampleToken);
    const bindings = sample ? { root: null, bindings: [] } : null, previous = listListenerCapture;
    listListenerCapture = bindings;
    try {
      const node = build(bindings);
      if (bindings && node) { bindings.root ||= node; node.dataset.listSample = ""; }
      return node;
    } finally {
      listListenerCapture = previous;
      if (sample && bindings.root) {
        for (const { node, release } of bindings.bindings) if (bindings.root.contains(node)) sample.own(release);
        for (const boundary of bindings.root.querySelectorAll(".history-load")) sample.own(() => historyHintObserver.unobserve(boundary));
      }
    }
  }
  function withListMessage(facts, row, work) {
    return withListRoom(facts, record => {
      const source = HistoryWindow.messageById(record, row.id);
      if (!source) return undefined;
      const held = () => listFactsHeld(facts) && HistoryWindow.messageById(record, row.id) === source
        && conversationState.identity(source) === row.sourceToken && conversationState.snapshotRevision(source) === row.snapshotRevision;
      if (!held()) return undefined;
      const value = work(record, source, held);
      return held() ? value : undefined;
    });
  }
  const patchListRows = KeyedList.patch, patchListPages = KeyedList.patchPaged;
  const conversationList = lifetime.use(VIBEROOM_CONVERSATION_LIST.create(els.messages, {
    signal: lifetime.signal, valid: listFactsHeld, refused: refusedList, dayElement, dividerElement, ic,
    patchRows: (facts, live, paged, node, rows, spec) => {
      if (!live() || !listFactsHeld(facts) || !live()) return undefined;
      (paged ? patchListPages : patchListRows)(node, rows, spec);
      return live() && listFactsHeld(facts) && live() ? true : undefined;
    },
    messageElement: (facts, row) => withListMessage(facts, row, (record, source) => listSampleNode(facts, bindings => messageElement(record, source, { bindings }))),
    syncMessage: (facts, node, row) => withListMessage(facts, row, (record, source, held) => {
      if (source.bodyMissing) {
        fillBodyPlaceholder(node, record, source);
        if (!held()) return undefined;
        noteDrawn(node, source); return true;
      }
      if (!deferredMessageParts.has(node) && drawnCurrent(node, source)) return true;
      const pending = pendingPatch(node, source);
      if (!held()) return undefined;
      if (pending && pending.room === record) { dirty.delete(source.id); updateMessageElement(node, record, source, pending.parts, pending.toolIds); }
      else updateMessageElement(node, record, source);
      return true;
    }),
    ceilingElement: (facts, hidden, pinned) => withListRoom(facts, record => listSampleNode(facts, () => ceilingElement(record, hidden, pinned))),
    updateHistoryBoundary: (facts, hidden, pinned) => withListRoom(facts, record => { updateHistoryBoundary(record, hidden, pinned); return true; }),
    setSelectionDuringPatch: (facts, ticket, value) => {
      if (!listFactsHeld(facts)) return undefined;
      selectionDuringPatchOwner = ticket; selectionDuringPatch = value; return true;
    },
    clearSelectionDuringPatch: ticket => {
      if (selectionDuringPatchOwner === ticket) { selectionDuringPatchOwner = null; selectionDuringPatch = null; }
    },
  }));
  const itemLists = new WeakMap();
  function listItems(room) {
    const cacheKey = room.history?.indexed ? `${room.history.version}|${visibilityFingerprint(room)}|${new Date().toDateString()}` : null;
    const cached = cacheKey && itemLists.get(room);
    if (cached && cached.key === cacheKey && cached.messages === room.messages && cached.count === room.messages.length) return cached.items;
    const items = [];
    const { hidden, drawn, above } = foldParts(room);
    if (hidden) {
      if (above.length) items.push({ kind: "pins", name: "pins", above });
      items.push({ kind: "ceiling", name: "ceiling", hidden, pinned: above.length });
    }
    else if (!state.search) items.push({ kind: "beginning", name: "beginning" });
    const markers = visibilityMarkers(room);
    const placed = new Set();
    let lastDay = "";
    for (const m of drawn) {
      const day = dayLabel(m.ts);
      if (day !== lastDay) {
        items.push({ kind: "day", name: `day:${day}:${m.id}`, day, ts: m.ts });
        lastDay = day;
      }
      for (const [seq, agents] of markers) {
        if (placed.has(seq) || !(m.seq >= seq)) continue;
        if (m.seq > 0) {
          placed.add(seq);
          items.push({ kind: "mark", name: `mark:${seq}:${agents.map((p) => p.id).join(",")}`, agents });
        }
      }
      items.push({ kind: "msg", name: m.id, m });
    }
    for (const [seq, agents] of markers) {
      if (!placed.has(seq)) items.push({ kind: "mark", name: `mark:${seq}:${agents.map((p) => p.id).join(",")}`, agents });
    }
    if (cacheKey) itemLists.set(room, { key: cacheKey, messages: room.messages, count: room.messages.length, items });
    return items;
  }

  const SAMPLE_ROWS = 40;
  const rowPrices = { stamp: "", perKind: new Map(), fallback: null, middle: 0, gap: 0, chrome: 0, said: new Set() };
  const rowInsets = new Map();
  function rowFlowBox(node, borderSize) {
    const style = getComputedStyle(node);
    const top = parseFloat(style.marginTop) || 0, bottom = parseFloat(style.marginBottom) || 0;
    let height = borderSize;
    if (height === undefined) {
      height = parseFloat(style.height);
      if (!Number.isFinite(height)) height = node.offsetHeight;
      else if (style.boxSizing !== "border-box") height += (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
        + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    }
    return { height: Math.max(0, height + top + bottom), inset: top };
  }
  function itemKind(item) {
    if (item.kind !== "msg") return item.kind;
    const m = item.m;
    const long = !m.streaming && (m.bodyChars ?? (m.text || "").length) > CLAMP_CHARS && !state.watched.has(m.id);
    return long && !state.expanded.has(m.id) ? "clamped" : "open";
  }
  const itemWeight = (item) => (item.kind === "msg" ? item.m.bodyChars ?? (item.m.text || "").length : 0);
  function priceItem(item) {
    if (item.kind === "space") return item.px;
    const kind = itemKind(item);
    const price = rowPrices.perKind.get(kind);
    if (price) return price.floor + price.rate * itemWeight(item);
    if (!rowPrices.said.has(kind)) {
      rowPrices.said.add(kind);
      noteFinding(`the list has a row of a kind it has no price for (${kind}); its height is being guessed`);
    }
    return rowPrices.middle;
  }
  const pricesStamp = (width = els.messages.clientWidth) =>
    `${width}|${document.documentElement.dataset.look || ""}|${document.documentElement.style.getPropertyValue("--chat-fs")}`;

  function priceRows(room, items) {
    const stamp = pricesStamp();
    if (rowPrices.stamp === stamp) return !!rowPrices.fallback;
    if (!room || !items?.length || !els.messages.clientWidth) return false;
    items = items.filter(item => item.kind !== "msg" || !item.m.bodyMissing);
    if (!items.length) return false;
    const step = Math.max(1, Math.floor(items.length / SAMPLE_ROWS));
    const sample = [];
    const kinds = new Set();
    for (let i = 0; i < items.length && sample.length < SAMPLE_ROWS; i += step) {
      sample.push({ item: items[i] });
      kinds.add(itemKind(items[i]));
    }
    for (let i = 0; i < items.length; i++) {
      const kind = itemKind(items[i]);
      if (kinds.has(kind)) continue;
      kinds.add(kind);
      sample.push({ item: items[i] });
    }

    const host = document.createElement("div");
    host.style.cssText = "height:0;overflow:hidden;flex:0 0 0px";
    const page = document.createElement("div");
    page.className = "msgs-page";
    page.style.contentVisibility = "visible";
    host.appendChild(page);
    const selectedRows = readListRows(room, sample.map(({ item }) => item), "sample");
    if (!selectedRows) return false;
    const sampleScope = domResources.scope(), sampleToken = Object.freeze({});
    listSampleScopes.set(sampleToken, sampleScope);
    selectedRows.facts = Object.freeze({ ...selectedRows.facts, sampleToken });
    host.inert = true;
    const held = () => listFactsHeld(selectedRows.facts);
    const clones = [];
    try {
    for (const item of selectedRows.rows) {
      const row = conversationList.row(selectedRows.facts, item);
      if (!row || !held()) return false;
      if (!conversationList.fill(selectedRows.facts, row, item, true) || !held()) return false;
      row.style.contentVisibility = "visible";
      page.appendChild(row);
      clones.push(row);
    }
    els.messages.appendChild(host);
    if (!held()) return false;
    for (const inner of page.querySelectorAll(".msg, .msgs-page")) inner.style.contentVisibility = "visible";
    const boxes = [];
    for (const clone of clones) {
      const box = rowFlowBox(clone);
      if (!held()) return false;
      boxes.push(box);
    }
    const heights = boxes.map(box => box.height);
    const gap = parseFloat(getComputedStyle(page).rowGap) || 0;
    if (!held()) return false;
    const chrome = Math.max(0, rowFlowBox(page).height - heights.reduce((sum, h) => sum + h, 0) - gap * Math.max(0, heights.length - 1));
    if (!held()) return false;
    host.remove();

    const byKind = new Map();
    sample.forEach(({ item }, at) => {
      const kind = itemKind(item);
      const seen = byKind.get(kind) || { w: [], h: [] };
      seen.w.push(itemWeight(item));
      seen.h.push(heights[at]);
      byKind.set(kind, seen);
    });
    const perKind = new Map([...byKind].map(([kind, seen]) => [kind, fitHeight(seen.w, seen.h)]));
    const fallback = fitHeight(sample.map(({ item }) => itemWeight(item)), heights);
    if (!held()) return false;
    sample.forEach(({ item }, at) => rowInsets.set(itemKind(item), boxes[at].inset));
    rowPrices.perKind = perKind;
    rowPrices.fallback = fallback;
    rowPrices.middle = heights.reduce((sum, h) => sum + h, 0) / heights.length;
    rowPrices.said.clear();
    rowPrices.gap = gap;
    rowPrices.chrome = chrome;
    rowPrices.stamp = stamp;
    return true;
    } finally { listSampleScopes.delete(sampleToken); sampleScope.release(); host.remove(); }
  }

  function fitHeight(weights, heights) {
    const n = heights.length;
    if (!n) return { floor: 0, rate: 0 };
    const floor = Math.min(...heights);
    const carried = weights.reduce((sum, w) => sum + w, 0);
    const above = heights.reduce((sum, h) => sum + h, 0) - n * floor;
    return { floor, rate: carried > 0 ? Math.max(0, above / carried) : 0 };
  }

  const MARGIN_SCREENS = 1;
  let keepingScroll = null;
  function followWindow() {
    const room = currentRoom();
    if (!room || state.view !== "room" || !drawnWindow || room.historyRestoring) return;
    if (rowPrices.stamp !== pricesStamp()) { repriceSoon(); return; }
    const screen = els.messages.clientHeight;
    const top = stuck ? Math.max(0, ListIndex.total(listAccount) - screen) : els.messages.scrollTop;
    const needed = ListIndex.rangeFor(listAccount, Math.max(0, top - screen / 4), top + screen * 1.25);
    if (needed.from >= drawnWindow.from && needed.to <= drawnWindow.to) return;
    const next = drawnRange(listAccount.items);
    if (!next || (next.from === drawnWindow.from && next.to === drawnWindow.to)) return;
    keepingScroll = { top: els.messages.scrollTop, eye: eyeRow() };
    try {
      renderMessages("the window moved");
    } finally {
      keepingScroll = null;
    }
  }
  function eyeRow() {
    const box = Layout.rect(els.messages);
    for (const row of els.messages.querySelectorAll(".msg[data-id]")) {
      const r = Layout.rect(row);
      if (r.bottom > box.top + 4 && r.top < box.bottom) return { id: row.dataset.id, at: r.top - box.top };
    }
    return null;
  }
  function eyeMovement(eye) {
    if (!eye) return null;
    const row = els.messages.querySelector(`.msg[data-id="${CSS.escape(eye.id)}"]`);
    if (!row) return null;
    const box = Layout.rect(els.messages);
    const target = eye.part ? row.querySelector(eye.part) || row : row;
    return Layout.rect(target).top - box.top - eye.at;
  }
  function holdTheEye(eye) {
    const moved = eyeMovement(eye);
    if (moved === null) return;
    if (Math.abs(moved) > 0.5) els.messages.scrollTop += moved;
  }

  function settleSpacers(eye, beforeCommit) {
    if (!drawnWindow || !listAccount) return false;
    const above = els.messages.querySelector('.msgs-space[data-id="space:above"]');
    const belowNode = els.messages.querySelector('.msgs-space[data-id="space:below"]');
    const opening = listAccount.before ? listAccount.before(0) : 0;
    const want = Math.max(0, ListIndex.topOf(listAccount, drawnWindow.from) - opening - listAccount.gap);
    const below = Math.max(0, ListIndex.total(listAccount) - ListIndex.topOf(listAccount, drawnWindow.to));
    const aboveHeight = Math.round(want), belowHeight = Math.round(below);
    const moved = eyeMovement(eye);
    const top = moved === null ? null : els.messages.scrollTop + moved + (above ? aboveHeight - (parseFloat(above.style.height) || 0) : 0);
    if (beforeCommit) {
      const beforeTop = els.messages.scrollTop, height = els.messages.clientHeight;
      const aboveDelta = above ? aboveHeight - (parseFloat(above.style.height) || 0) : 0;
      const belowDelta = belowNode ? belowHeight - (parseFloat(belowNode.style.height) || 0) : 0;
      const total = Math.max(height, els.messages.scrollHeight + aboveDelta + belowDelta);
      beforeCommit({ beforeTop, aboveDelta, total, height, width: els.messages.clientWidth,
        top: Math.max(0, Math.min(total - height, top ?? (stuck && !humanHoldsText() ? total - height : beforeTop))) });
    }
    if (belowNode && belowNode.style.height !== `${belowHeight}px`) belowNode.style.height = `${belowHeight}px`;
    if (above && above.style.height !== `${aboveHeight}px`) above.style.height = `${aboveHeight}px`;
    if (top !== null) els.messages.scrollTop = top;
    return top !== null;
  }
  function followWindowSoon() {
    if (!drawnWindow) return;
    requestViewportWork({ follow: true });
  }


  function drawnRange(items, anchor = null) {
    if (!listAccount || !rowPrices.fallback || listAccount.items.length !== items.length) return null;
    const screen = els.messages.clientHeight || 0;
    if (!screen) return null;
    let top = stuck && !keepingScroll ? Math.max(0, ListIndex.total(listAccount) - screen) : els.messages.scrollTop;
    if (anchor) {
      const at = items.findIndex(item => item.name === anchor.id || (item.kind === "pins" && item.above.some(m => m.id === anchor.id)));
      if (at >= 0) {
        let inset = rowInsets.get(itemKind(items[at])) || 0;
        if (items[at].kind === "pins") {
          const child = drawnRow(anchor.id), block = child?.closest(".history-pins");
          if (block) inset += Layout.rect(child).top - Layout.rect(block).top;
        }
        top = Math.max(0, ListIndex.topOf(listAccount, at) + inset - anchor.into);
      }
    }
    return widenForSelection(ListIndex.rangeFor(listAccount, top - screen * MARGIN_SCREENS, top + screen * (1 + MARGIN_SCREENS)), items);
  }
  function widenForSelection(range, items) {
    const selection = window.getSelection();
    if (!range) return range;
    const rowAt = node => {
      const el = node?.nodeType === 3 ? node.parentElement : node;
      const row = el?.closest?.(".msg[data-id]");
      return row && els.messages.contains(row) ? items.findIndex(item => item.kind === "msg" && item.name === row.dataset.id) : -1;
    };
    const nodes = selection && !selection.isCollapsed && selection.rangeCount ? [selection.anchorNode, selection.focusNode] : [];
    if (textPress) nodes.push(textPress);
    const ends = nodes.map(rowAt).filter(at => at >= 0);
    if (!ends.length) return range;
    return { from: Math.min(range.from, ...ends), to: Math.max(range.to, ...ends.map(at => at + 1)) };
  }
  let heldTextSelection = false;
  let heldTextElement = null, releasedTextEye = null;
  function textPart(node) {
    const el = node?.nodeType === 3 ? node.parentElement : node;
    return el?.closest?.(".words, .thought, .tools") || el?.closest?.(".msg[data-id]") || null;
  }
  function rememberReleasedText() {
    const part = heldTextElement, row = part?.closest(".msg[data-id]");
    if (row && els.messages.contains(row)) releasedTextEye = {
      roomId: state.currentRoomId, id: row.dataset.id,
      part: ["words", "thought", "tools"].find(name => part.classList.contains(name)),
      at: Layout.rect(part).top - Layout.rect(els.messages).top,
    };
    if (releasedTextEye?.part) releasedTextEye.part = `.${releasedTextEye.part}`;
    heldTextElement = null;
  }
  lifetime.on(document, "selectionchange", () => {
    const selection = window.getSelection();
    chatSelection = selectionSnapshot(selection);
    const wasHeld = heldTextSelection;
    const inside = !!selection && !selection.isCollapsed && (els.messages.contains(selection.anchorNode) || els.messages.contains(selection.focusNode));
    heldTextSelection = inside;
    if (inside) heldTextElement = textPart(els.messages.contains(selection.anchorNode) ? selection.anchorNode : selection.focusNode);
    if (inside && !wasHeld) leaveTheEnd();
    if (wasHeld && !inside && state.view === "room") {
      rememberReleasedText();
      renderMessagesSoon("the text selection was released");
      resumeAfterText();
    }
  });
  function leaveTheEnd() {
    stuck = false;
    readingAway = true;
    calm.held = false;
    els.jumpLatest.hidden = false;
  }
  function resumeAfterText() {
    if (stuck || humanHoldsText()) return;
    if (deliberateReturn()) scrollToBottom("the text selection was released at the end");
  }
  function windowedItems(items, range) {
    if (!range) return items;
    const opening = listAccount.before ? listAccount.before(0) : 0;
    const above = Math.max(0, ListIndex.topOf(listAccount, range.from) - opening - listAccount.gap);
    const below = Math.max(0, ListIndex.total(listAccount) - ListIndex.topOf(listAccount, range.to));
    const shown = items.slice(range.from, range.to);
    return [
      ...(range.from ? [{ kind: "space", name: "space:above", px: above }] : []),
      ...shown,
      ...(range.to < items.length ? [{ kind: "space", name: "space:below", px: below }] : []),
    ];
  }

  let listAccount = null;
  let drawnWindow = null;
  const measuredRows = new Map();
  let measuredRoom = null;
  let measuredStamp = "";
  let measuredPins = "";
  let measuredCeiling = "";
  const observedRows = new Set();
  let measuredIndexes = new Map();
  const rowSizeObserver = domResources.observe(ResizeObserver, (entries) => {
    requestViewportWork({ rows: entries.map(entry => ({ target: entry.target, borderSize: entry.borderBoxSize?.[0]?.blockSize })) });
  }).observer;
  function applyObservedRows(entries) {
    if (!drawnWindow || !listAccount || state.view !== "room") return;
    if (rowPrices.stamp !== pricesStamp()) { repriceSoon(); return; }
    const eye = stuck ? null : eyeRow();
    let changed = false;
    for (const entry of entries) {
      const node = entry.target;
      if (!node.isConnected || !els.messages.contains(node)) continue;
      const at = measuredIndexes.get(node.dataset.id);
      if (at === undefined) continue;
      if (listAccount.items[at]?.m?.bodyMissing) continue;
      const measured = rowFlowBox(node, entry.borderSize);
      const px = measured.height;
      rowInsets.set(itemKind(listAccount.items[at]), measured.inset);
      if (!(px > 0)) continue;
      if (ListIndex.heightAt(listAccount, at) !== px) changed = ListIndex.measured(listAccount, at, px) || changed;
      measuredRows.set(node.dataset.id, px);
    }
    return changed ? { eye } : null;
  }
  function commitObservedRows(eye) {
    if (stuck && !humanHoldsText()) calmRelease();
    const plans = prepareTimelineFrame(viewportRunning?.full);
    let viewport;
    const held = settleSpacers(eye, measured => {
      viewport = measured;
      measureTimelineFrame(plans, viewport);
      rememberReader(viewport);
    });
    if (stuck && !humanHoldsText()) scrollToBottom("visible message size changed", { viewport });
    else if (!held) holdTheEye(eye);
    renderTimelineAfterList();
    followWindowSoon();
  }
  function observeDrawnRows() {
    reconcileWatched();
    const rows = new Set([...els.messages.querySelectorAll(":scope > .msgs-page > [data-id]")].filter(row => !row.classList.contains("msgs-space")));
    for (const row of observedRows) if (!rows.has(row)) { rowSizeObserver.unobserve(row); observedRows.delete(row); }
    for (const row of rows) if (!observedRows.has(row)) { observedRows.add(row); rowSizeObserver.observe(row); }
  }
  function refreshAccount(room, items) {
    if (!priceRows(room, items)) return;
    const stamp = pricesStamp();
    const sameGeometry = measuredRoom === room.id && measuredStamp === stamp;
    const changed = room.dirtyHeights || new Set();
    if (sameGeometry && listAccount?.items === items) {
      for (const id of changed) {
        const at = measuredIndexes.get(id);
        if (at !== undefined) ListIndex.repriceRow(listAccount, at, measuredRows.get(id) ?? priceItem(items[at]));
      }
      changed.clear();
      return;
    }
    changed.clear();
    if (measuredRoom !== room.id || measuredStamp !== stamp) {
      measuredRows.clear();
      measuredRoom = room.id;
      measuredStamp = stamp;
    }
    const pins = items.find(item => item.kind === "pins")?.above.map(m => m.id).join("|") || "";
    const ceiling = items.find(item => item.kind === "ceiling");
    const ceilingKey = ceiling ? `${ceiling.hidden}:${ceiling.pinned}` : "";
    if (pins !== measuredPins) { measuredRows.delete("pins"); measuredPins = pins; }
    if (ceilingKey !== measuredCeiling) { measuredRows.delete("ceiling"); measuredCeiling = ceilingKey; }
    const opening = parseFloat(getComputedStyle(els.messages).paddingTop) || 0;
    const before = (i) => (i === 0 ? opening : 0);
    listAccount = ListIndex.build(items, priceItem, rowPrices.gap, before);
    measuredIndexes = new Map(items.map((item, i) => [item.name, i]));
    const kept = new Set();
    items.forEach((item, i) => {
      kept.add(item.name);
      if (measuredRows.has(item.name)) ListIndex.measured(listAccount, i, measuredRows.get(item.name));
    });
    for (const id of measuredRows.keys()) if (!kept.has(id)) measuredRows.delete(id);
    ListIndex.shown = listAccount;
  }
  function takeRealHeights(offset = 0) {
    if (!listAccount) return;
    const missed = [];
    let at = offset;
    for (const page of els.messages.children) {
      if (!page.classList.contains("msgs-page")) continue;
      let anyReal = false;
      for (let i = 0; i < page.childElementCount && !anyReal; i++) anyReal = !listAccount.items[at + i]?.m?.bodyMissing;
      if (!anyReal) { at += page.childElementCount; continue; }
      const first = page.firstElementChild;
      const drawn = !first || typeof first.checkVisibility !== "function" || first.checkVisibility({ contentVisibilityAuto: true });
      if (!drawn) { at += page.childElementCount; continue; }
      for (const row of page.children) {
        if (row.classList.contains("msgs-space")) continue;
        if (listAccount.items[at]?.m?.bodyMissing) { at++; continue; }
        const itself = typeof row.checkVisibility !== "function" || row.checkVisibility({ contentVisibilityAuto: true });
        if (!itself) { at++; continue; }
        const measured = rowFlowBox(row);
        const real = measured.height;
        const item = listAccount.items[at];
        if (item) rowInsets.set(itemKind(item), measured.inset);
        if (item && real > 0) measuredRows.set(item.name, real);
        missed.push(Math.abs(ListIndex.heightAt(listAccount, at) - real));
        ListIndex.measured(listAccount, at++, real);
      }
    }
    if (missed.length < 8) return;
    missed.sort((a, b) => a - b);
    const typical = missed[missed.length >> 1];
    if (typical > 40 && !accountSaidItMisses) {
      accountSaidItMisses = true;
      noteFinding(`the list's account is out by about ${Math.round(typical)} px on a row it can see`);
    }
  }
  let accountSaidItMisses = false;

  function guessPages(room, items) {
    if (!priceRows(room, items)) return;
    let at = 0;
    for (const page of els.messages.children) {
      if (!page.classList.contains("msgs-page")) continue;
      const rows = page.childElementCount;
      if (!rows) continue;
      let sum = rowPrices.chrome + rowPrices.gap * (rows - 1);
      for (let i = 0; i < rows; i++) sum += priceItem(items[at + i]);
      at += rows;
      page.style.containIntrinsicSize = `auto ${Math.round(sum)}px`;
    }
  }

  const REPRICE_AFTER_MS = 400;
  let repriceTimer = 0;
  function repriceSoon() {
    clearTimeout(repriceTimer);
    repriceTimer = setTimeout(() => {
      if (state.view !== "room" || !currentRoom() || !els.messages.children.length) return;
      if (rowPrices.stamp === pricesStamp()) return;
      renderMessages("the window changed shape");
    }, REPRICE_AFTER_MS);
  }

  function measureBornAbove(born, anchorAt) {
    if (anchorAt < 0) return;
    const shown = [];
    for (const { node, at } of born) {
      if (at >= anchorAt) break;
      for (const el of [node.parentElement, node]) {
        if (!el || el === els.messages) continue;
        shown.push([el, el.style.contentVisibility]);
        el.style.contentVisibility = "visible";
      }
    }
    if (!shown.length) return;
    els.messages.offsetHeight;
    for (const [el, was] of shown) el.style.contentVisibility = was;
  }

  let afterRender = [];
  function afterListRender(fn) { afterRender.push(fn); }
  let listPaintFrame = 0;
  let viewportFrame = 0;
  let viewportWork = null;
  let viewportRunning = null;
  function requestViewportWork(change) {
    const roomId = state.currentRoomId;
    if (!viewportWork || viewportWork.roomId !== roomId) viewportWork = { roomId, rows: new Map() };
    if (change.list && !viewportWork.list) viewportWork.list = change.list;
    for (const flag of ["follow", "timeline", "full", "view", "resize", "composer"]) if (change[flag]) viewportWork[flag] = true;
    for (const entry of change.rows || []) viewportWork.rows.set(entry.target, entry);
    if (!viewportFrame) viewportFrame = requestAnimationFrame(flushViewportWork);
    return viewportFrame;
  }
  function flushViewportWork() {
    viewportFrame = 0;
    const work = viewportWork;
    viewportWork = null;
    listPaintFrame = 0;
    if (!work || state.view !== "room" || state.currentRoomId !== work.roomId) return;
    viewportRunning = work;
    try {
      const resized = work.rows.size ? applyObservedRows([...work.rows.values()]) : null;
      const composerHeight = work.composer ? `${els.composer.offsetHeight}px` : null;
      if (work.list) renderMessages(work.list);
      else if (work.follow || resized) followWindow();
      if (resized && !work.drawn) commitObservedRows(resized.eye);
      else if (!work.drawn) {
        if (work.timeline) renderTimeline(work.full);
        else if (work.view) updateTimelineView();
      }
      if (composerHeight !== null) {
        for (const el of composerFollowers) if (el.style.getPropertyValue("--composer-h") !== composerHeight) el.style.setProperty("--composer-h", composerHeight);
      }
      if (work.resize) repriceSoon();
      els.jumpLatest.hidden = stuck;
      updateWorkingNow();
    } finally {
      viewportRunning = null;
    }
  }
  function renderMessagesSoon(why) {
    listPaintFrame = requestViewportWork({ list: why });
  }
  const quietDrawnFrom = new WeakMap();
  const emptyConversation = lifetime.use(VIBEROOM_EMPTY_CONVERSATION.create(uiRoot, {
    signal: lifetime.signal, messages: els.messages, currentFacts: currentQuietFacts, Layout, esc,
    scene: name => window.Icons.scene(name),
  }));
  function quietFacts(room) {
    if (!room || lifetime.disposed) return undefined;
    const entered = !quietReads.has(room);
    if (entered) quietReads.add(room);
    try {
      const facts = roomReader.forRecord(room);
      if (!facts) return undefined;
      const conversation = conversationReader.quietFor(room);
      if (!conversation || roomReader.forRecord(room) !== facts
        || roomReader.identityForRecord(room) !== conversation.roomIdentity || lifetime.disposed) return undefined;
      const mates = (facts.participants || []).filter(p => p.kind === "agent" && p.status !== "left" && p.status !== "unstaffed").length;
      return Object.freeze({ ...conversation, id: facts.id, name: facts.name, mates });
    } finally { if (entered) quietReads.delete(room); }
  }
  function currentQuietFacts() {
    if (lifetime.disposed || state.view !== "room") return undefined;
    const room = currentRoom(), facts = quietFacts(room);
    return !lifetime.disposed && state.view === "room" && currentRoom() === room ? facts : undefined;
  }
  function hideEmptyGuide() { emptyConversation.hide(); }
  function showEmptyGuide() { emptyConversation.show(); }


  function renderMessages(why, savedAnchor) {
    const anotherRoom = listRoomId !== (currentRoom()?.id ?? null);
    if (anotherRoom) glideStop("another room");
    drawList(why, savedAnchor);
    if (anotherRoom) lastScrollTop = els.messages.scrollTop;
    if (state.embedded || navigation) roomRendered();
  }
  function drawList(why, savedAnchor) {
    if (viewportRunning) viewportRunning.drawn = true;
    lastListChange = { why, at: Date.now() };
    if (viewportWork?.roomId === state.currentRoomId) viewportWork.list = null;
    listPaintFrame = 0;
    const t0 = performance.now();
    const room = currentRoom();
    if (room?.historyRestoring) {
      if (listRoomId !== room.id) {
        const controls = els.messages.querySelector(".history-load");
        if (controls) historyHintObserver.unobserve(controls);
        els.messages.innerHTML = `<div class="conversation-loading" role="status">${UI.html("skeleton", { lines: 3, shape: "bubble" })}${UI.html("skeleton", { lines: 2, shape: "bubble" })}<span class="placeholder-label">Loading conversation…</span></div>`;
      }
      listRoomId = room.id;
      return;
    }
    const releasedEye = releasedTextEye?.roomId === room?.id ? releasedTextEye : null;
    releasedTextEye = null;
    listRoomId = room ? room.id : null;
    const resized = settledReader?.roomId === room?.id && settledReader.stamp !== pricesStamp();
    const anchor = savedAnchor !== undefined ? savedAnchor
      : keepingScroll ? (keepingScroll.eye ? { id: keepingScroll.eye.id, into: keepingScroll.eye.at } : null)
      : resized ? settledReader.anchor : stuck ? null : readerAnchor();
    if (resized && !humanHoldsText()) { stuck = settledReader.following; if (!stuck) readingAway = true; }
    const eyeBefore = stuck || humanHoldsText() ? null : eyeRow();
    els.messages.classList.toggle("searching", !!state.search);
    if (!room) { els.messages.innerHTML = ""; return; }
    if (room.history?.bodyProtocol && !room.history.indexed && room.indexError && !room.messages.length) {
      els.messages.innerHTML = `<div class="empty" role="status">The conversation could not be loaded. <button class="linklike">Try again</button></div>`;
      els.messages.querySelector("button").onclick = lifetime.guard(() => void refreshHeld(room.id));
      return;
    }
    const quiet = quietFacts(room);
    if (!quiet || currentRoom() !== room || state.view !== "room" || lifetime.disposed) return;
    if (quiet.eligible) {
      const shown = els.messages.querySelector(".empty-room");
      if (!shown || quietDrawnFrom.get(shown) !== quiet.roomIdentity || shown.dataset.quiet !== VIBEROOM_EMPTY_CONVERSATION.quietKey(quiet)) {
        const html = emptyConversation.html(quiet);
        if (html === undefined) return;
        els.messages.innerHTML = html;
        const node = els.messages.querySelector(":scope > .empty-room");
        if (node) quietDrawnFrom.set(node, quiet.roomIdentity);
      }
      showEmptyGuide();
      return;
    }
    hideEmptyGuide();
    if (listSearch !== (state.search || "")) {
      listSearch = state.search || "";
      listGeneration++;
    }
    const items = listItems(room);
    const leaving = els.messages.querySelector(".history-load");
    if (leaving && !items.some((item) => item.kind === "ceiling")) historyHintObserver.unobserve(leaving);
    refreshAccount(room, items);
    drawnWindow = drawnRange(items, anchor);
    els.messages.classList.toggle("windowed", !!drawnWindow);
    const shown = windowedItems(items, drawnWindow);
    const selectedRows = readListRows(room, shown);
    const born = selectedRows && conversationList.patch(selectedRows.facts, selectedRows.rows, { drawnWindow, pageSize: PAGE_SIZE, textPress });
    if (!born) return;
    if (anchor) measureBornAbove(born, shown.findIndex((item) => item.kind === "msg" && item.name === anchor.id));
    if (!drawnWindow) guessPages(room, items);
    for (const perm of room.permissions) renderPermission(room, perm);
    for (const prop of room.proposals || []) renderProposal(room, prop);
    for (const asked of room.newRooms || []) renderNewRoom(room, asked);
    syncRecovery(room);
    syncKnockOffer(room);
    refreshSeen(room);
    if (drawnWindow && readerRestoreCleanup) readerRestoreCleanup();
    if (stuck && !humanHoldsText()) calmRelease();
    const timelinePlans = prepareTimelineFrame(viewportRunning?.full);
    takeRealHeights(drawnWindow ? drawnWindow.from : 0);
    observeDrawnRows();
    const place = releasedEye || keepingScroll?.eye || (!humanHoldsText() && (anchor ? { id: anchor.id, at: anchor.into } : eyeBefore));
    let viewport;
    const held = settleSpacers(place, measured => {
      viewport = measured;
      measureTimelineFrame(timelinePlans, viewport);
      rememberReader(viewport);
    });
    if (releasedEye) { if (!held) holdTheEye(releasedEye); }
    else if (keepingScroll) {
      if (keepingScroll.eye) { if (!held) holdTheEye(keepingScroll.eye); }
      else els.messages.scrollTop = keepingScroll.top;
    } else if (!held && !restoreReader(anchor) && !humanHoldsText()) {
      if (stuck) scrollToBottom("the list was rebuilt", { viewport });
      else {
        if (eyeBefore && els.messages.querySelector(`.msg[data-id="${CSS.escape(eyeBefore.id)}"]`)) holdTheEye(eyeBefore);
        noteHeldPlace(anchor ? "the list was rebuilt and the place was not found" : "the list was rebuilt without a place to return to");
      }
    }
    renderTimelineAfterList();
    if (!viewport) rememberReader();
    if (room.history?.indexed) {
      conversationState.touchBodies(room, shown.filter(item => item.kind === "msg").map(item => item.name));
      wantBodies(room);
    }
    followWindowSoon();
    const ready = afterRender;
    afterRender = [];
    for (const fn of ready) fn();
    const tally = (globalThis.VIBEROOM_LIST ||= { renders: 0, lastWhy: "", byWhy: {}, log: [] });
    tally.renders += 1;
    tally.lastWhy = why || "unnamed";
    tally.byWhy[tally.lastWhy] = (tally.byWhy[tally.lastWhy] || 0) + 1;
    (tally.log ||= []).push({ why: tally.lastWhy, at: Math.round(performance.now()), ms: Math.round(performance.now() - t0) });
    if (tally.log.length > 400) tally.log.shift();
    noteSlow(`full render of the list (${why || "unnamed"})`, performance.now() - t0);
  }

  function upsertMessage(roomId, m) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    const result = conversationState.upsert(room, m);
    if (!result) return;
    if (result.kind === "above") {
      if (roomId === state.currentRoomId && state.view === "room") renderMessages("a message above the held part changed");
      return;
    }
    const { index: idx, wasFinal } = result;
    const inView = roomId === state.currentRoomId && state.view === "room";
    const existing = inView ? els.messages.querySelector(`.msg[data-id="${m.id}"]`) : null;
    const showing = inView && (!room.historyRestoring || !!existing);
    if (!wasFinal && !m.streaming) noticeArrival(room, room.messages[idx]);
    if (!showing) {
      if (listRoomId === room.id) listRoomId = null;
      renderOverviewSoon();
      return;
    }
    if (!stuck && !humanHoldsText() && restedAtEnd(Date.now())) {
      stuck = true;
      readingAway = false;
    }
    const stick = stuck;
    if (existing && !wasFinal && !m.streaming && m.kind === "chat") watchGrown(existing, m.id);
    if (existing) updateMessageElement(existing, room, room.messages[idx]);
    else {
      const mine = idx >= 0 ? room.messages[idx] : m;
      const at = idx;
      if (at >= 0 && at < foldIndex(room)) {
        if (mine.pinned && mine.kind === "chat") renderMessages("a folded message was pinned");
        return;
      }
      if (drawnWindow) {
        { const t = globalThis.VIBEROOM_LIST; if (t) { (t.arrivals ||= []).push({ id: m.id, streaming: !!m.streaming, kind: m.kind, at: Math.round(performance.now()), window: `${drawnWindow.from}..${drawnWindow.to}`, idx }); if (t.arrivals.length > 400) t.arrivals.shift(); } }
        renderMessagesSoon("a message arrived in the virtual list");
        afterListRender(() => {
          const born = els.messages.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`);
          if (born) landing(born);
        });
        if (m.streaming && m.from !== "human") renderSideRoom();
        else if (!stick && m.kind === "chat") noteNew(room, m);
        if (!wasFinal && !m.streaming && m.kind === "chat" && m.from !== "human") noteFinished(room, m);
        return;
      }
      const empty = els.messages.querySelector(".empty");
      if (empty) empty.remove();
      placeInList(landing(messageElement(room, m)));
      if (m.from === "human") refreshSeen(room);
      if (m.streaming && m.from !== "human") renderSideRoom();
      else if (!stick && m.kind === "chat") noteNew(room, m);
    }
    if (stick) {
      if (CALM !== "off" && m.streaming && m.from !== "human" && !existing && !humanHoldsText()) calmStart(m.id);
      else if (!humanHoldsText()) scrollToBottom("a message arrived");
    } else if (calm.held) calmAfterGrowth();
    if (m.streaming) updateWorkingNow();
    if (!wasFinal && !m.streaming && m.kind === "chat" && m.from !== "human") noteFinished(room, m);
    if (m.from === "human") renderTimeline();
  }

  function removeMessage(roomId, id) {
    const room = state.rooms.get(roomId);
    if (!room || !conversationState.remove(room, id)) return;
    removeMessageFromView(roomId, id);
  }
  function removeMessageFromView(roomId, id) {
    if (roomId !== state.currentRoomId) return;
    const el = els.messages.querySelector(`.msg[data-id="${id}"]`);
    if (el) el.remove();
    measuredRows.delete(id);
    if (state.view === "room") renderMessagesSoon("a message was removed");
  }

  const dirty = new Map();
  let flushScheduled = false;
  let lastTypedAt = 0;
  const TYPING_FLUSH_MS = 250;
  const STREAM_FLUSH_MS = 30;
  const TYPING_WINDOW_MS = 1500;
  const watchingTheBottom = () => stuck;
  const watchedNodes = new Set();
  function observeWatched(el) { if (el.dataset.listSample !== undefined) return; watchedNodes.add(el); watchedLeave.observe(el); }
  function unwatchNode(el) { watchedLeave.unobserve(el); watchedNodes.delete(el); }
  function reconcileWatched() {
    for (const el of watchedNodes) if (!els.messages.contains(el)) unwatchNode(el);
  }
  const watchedLeave = domResources.observe(IntersectionObserver, (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) continue;
      const el = entry.target;
      const id = el.dataset.id;
      if (!state.watched.has(id)) { unwatchNode(el); continue; }
      if (!els.messages.contains(el)) {
        unwatchNode(el);
        if (els.messages.querySelector(`[data-id="${CSS.escape(id)}"]`)) continue;
      }
      const box = Layout.rect(els.messages);
      const r = Layout.fromRect(entry.boundingClientRect);
      const below = r.top >= box.bottom;
      const above = r.bottom <= box.top;
      if (!below && !(above && stuck)) continue;
      state.watched.delete(id);
      unwatchNode(el);
      const room = currentRoom();
      const m = room && room.messages.find((x) => x.id === id);
      if (m && el.isConnected) updateMessageElement(el, room, m);
    }
  }, { root: els.messages, threshold: 0 }).observer;
  function watchGrown(el, id) {
    state.watched.add(id);
    observeWatched(el);
  }
  function patchMessage(roomId, event, part, toolId) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    const result = conversationState.patch(room, event);
    if (!result) return;
    const { message: m, base } = result, id = event.id;
    if (roomId !== state.currentRoomId || state.view !== "room") return;
    if (part === "tools" && m.from !== "human") scheduleRosterRedraw(60);
    const entry = dirty.get(id) || { room, parts: new Set(), toolIds: new Set(), base, patches: 0 };
    entry.patches += 1;
    if (part && entry.parts) entry.parts.add(part);
    else entry.parts = null;
    if (part === "tools" && entry.toolIds) {
      if (toolId) entry.toolIds.add(toolId);
      else entry.toolIds = null;
    }
    dirty.set(id, entry);
    if (flushScheduled) return;
    flushScheduled = true;
    const slow = Date.now() - lastTypedAt < TYPING_WINDOW_MS || !watchingTheBottom();
    setTimeout(() => requestAnimationFrame(flushPatches), slow ? TYPING_FLUSH_MS : STREAM_FLUSH_MS);
  }
  function flushPatches() {
    flushScheduled = false;
    if (Date.now() - lastTypedAt < TYPING_WINDOW_MS && navigator.scheduling?.isInputPending?.()) {
      flushScheduled = true;
      setTimeout(() => requestAnimationFrame(flushPatches), TYPING_FLUSH_MS);
      return;
    }
    const t0 = performance.now();
    const batch = [...dirty];
    dirty.clear();
    let touched = false;
    for (const [id, { room, parts, toolIds }] of batch) {
      if (state.rooms.get(room.id) !== room || room.historyRestoring || room.id !== state.currentRoomId || state.view !== "room") continue;
      const m = HistoryWindow.heldMessageById(room, id);
      const el = m && els.messages.querySelector(`.msg[data-id="${id}"]`);
      if (!el) continue;
      const selectedRows = readListRows(room, [{ kind: "msg", name: id, m }], "stream");
      if (!selectedRows || !withListMessage(selectedRows.facts, selectedRows.rows[0], (record, source) => {
        updateMessageElement(el, record, source, parts, toolIds); return true;
      })) { if (selectedRows) refusedList(selectedRows.facts); continue; }
      touched = true;
    }
    if (touched) {
      if (calm.held) calmAfterGrowth();
      else followEnd("a reply grew");
    }
    if (touched) updateWorkingNow();
    if (touched) noteSlow("streamed frame", performance.now() - t0);
  }


  const inlineEditor = lifetime.use(VIBEROOM_INLINE_EDITOR.create(els.messages, {
    signal: lifetime.signal, UI, Layout, editors, roomRecordKey, currentRoom, viewOf: () => state.view,
    leaveTheEnd, resumeAfterText, onPrepared: openEditDialog, onError: showError,
    readPreview: (room, m, options) => get(`/api/rooms/${encodeURIComponent(room.id)}/messages/${encodeURIComponent(m.id)}/edit-preview`, options),
  }));
  function openInlineEditor(...args) { return inlineEditor.open(...args); }

  const editDialog = lifetime.use(VIBEROOM_EDIT_DIALOG.create($('#edit-dialog'), {
    window: document.defaultView, signal: lifetime.signal, icon: ic, openDialog, closeDialog, onError: showError,
    editMessage: (room, id, next, mode) => roomCommands.forRoom(room).editMessage(id, { text: next, mode }),
    onRewritten: result => toast(`Rewritten from here: ${result.removed} record${result.removed === 1 ? '' : 's'} removed${result.restarted.length ? `; restarted ${result.restarted.join(', ')}` : ''}.`, 'info'),
  }));
  function openEditDialog(room, message, next, preview) {
    return editDialog.open({ id: room.id, uuid: room.uuid, createdAt: room.createdAt }, message.id, next, preview);
  }


  function placeCard(card, room, at) {
    const anchorId = cardAnchor(room, at);
    if (anchorId) {
      const anchor = els.messages.querySelector(`.msg[data-id="${CSS.escape(anchorId)}"]`);
      if (anchor) { anchor.insertAdjacentElement("afterend", card); return true; }
      return false;
    }
    const firstId = room.messages[0] && room.messages[0].id;
    const first = firstId ? els.messages.querySelector(`.msg[data-id="${CSS.escape(firstId)}"]`) : null;
    if (first) { first.insertAdjacentElement("beforebegin", card); return true; }
    return false;
  }
  function cardAnchor(room, at) {
    if (Number.isFinite(at.afterSeq)) {
      let best = null;
      for (const m of room.messages) if (m.seq > 0 && m.seq <= at.afterSeq && (!best || m.seq > best.seq)) best = m;
      return best ? best.id : null;
    }
    const ts = at.ts || Date.now();
    let anchorId = null;
    for (const m of room.messages) if (m.ts <= ts) anchorId = m.id;
    return anchorId;
  }
  const OPTION_TONE = { allow_once: "ok", allow_always: "ok", reject_once: "no", reject_always: "no" };
  const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|\uDB40[\uDC00-\uDC7F]/g;
  function markInvisible(text) {
    let found = 0;
    const shown = text.replace(INVISIBLE, (ch) => { found++; return `⟦U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}⟧`; });
    return found ? `⚠ ${found} invisible character${found === 1 ? "" : "s"}, shown as ⟦U+…⟧\n${shown}` : text;
  }
  function renderPermission(room, perm) {
    const existing = els.messages.querySelector(`[data-ui="ask-card"][data-kind="permission"][data-key="${CSS.escape(perm.key)}"]`);
    const p = findById(room, perm.participantId);
    const tc = perm.toolCall || {};
    const choices = (perm.options || []).map((option) => ({ label: option.name, tone: OPTION_TONE[option.kind] || "plain", act: "permit", title: option.kind, data: { option: option.optionId } }));
    choices.push({ label: "Dismiss (cancelled)", act: "permit" });
    const card = UI.el("ask-card", { kind: "permission", who: p ? p.name : perm.participantId, subject: tc.title || tc.toolCallId || "tool call", subjectKind: tc.kind || undefined, input: tc.rawInput ? markInvisible(JSON.stringify(tc.rawInput, null, 1)) : undefined, choices, data: { key: perm.key } });
    if (existing) return void existing.replaceWith(card);
    const draft = [...room.messages].reverse().find((m) => m.streaming && m.from === perm.participantId);
    const host = draft ? els.messages.querySelector(`.msg[data-id="${draft.id}"] .perms`) : null;
    if (host) host.appendChild(card);
    else placeCard(card, room, perm);
    followEnd("a permission card");
  }
  function resolvePermissionCard(key, optionId, outcome) {
    for (const card of $$(`[data-ui="ask-card"][data-kind="permission"][data-key="${CSS.escape(key)}"]`)) {
      UI.setState(card, "resolved");
      card.querySelector(".choices").replaceChildren(Object.assign(document.createElement("span"), { className: "outcome", textContent: outcome || (optionId ? `chosen: ${optionId}` : "dismissed") }));
    }
  }

  function proposalValue(v) {
    if (v === null || v === undefined || v === "") return "(empty)";
    if (typeof v === "object") return v.mode === "fixed" ? v.language : v.mode || JSON.stringify(v);
    return String(v);
  }
  function proposalDiffHtml(p) {
    const rows = [];
    for (const c of p.settings || []) {
      if (c.key === "customRules") {
        const before = String(c.from || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const after = String(c.to || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const lines = [...before.filter((l) => !after.includes(l)).map((l) => `<div class="prop-line del">− ${esc(l)}</div>`), ...after.filter((l) => !before.includes(l)).map((l) => `<div class="prop-line add">+ ${esc(l)}</div>`)];
        rows.push(`<div class="prop-row"><b>Room rules</b>${lines.join("")}</div>`);
      } else rows.push(`<div class="prop-row"><b>${esc(c.key)}</b> <span class="prop-from">${esc(proposalValue(c.from))}</span> → <span class="prop-to">${esc(proposalValue(c.to))}</span></div>`);
    }
    for (const c of p.appearance || []) rows.push(`<div class="prop-row"><b>${esc(c.key)}</b> <span class="prop-from">${esc(proposalValue(c.from))}</span> → <span class="prop-to">${esc(proposalValue(c.to))}</span></div>`);
    for (const v of p.vibemates || []) {
      if (v.op === "update") rows.push(`<div class="prop-row"><b>${esc(v.name)}</b>${(v.fields || []).map((f) => `<div class="prop-line">${esc(f.field)}: <span class="prop-from">${esc(f.from || "(empty)")}</span> → <span class="prop-to">${esc(f.to || "(empty)")}</span></div>`).join("")}</div>`);
      else rows.push(`<div class="prop-row"><b>${v.op === "add" ? "New vibemate" : "Remove"}</b> ${esc(v.name)}${v.op === "add" ? ' <span class="hint">(you pick its coding agent)</span>' : ""}</div>`);
    }
    return rows.join("");
  }
  function modelName(room, agentType, model) {
    if (!model) return "";
    for (const other of (room.participants || [])) {
      if (agentType && other.agentType && other.agentType !== agentType) continue;
      for (const option of other.configOptions || []) {
        if (option.type !== "select") continue;
        const found = flattenOptions(option.options).find((c) => String(c && c.value) === String(model));
        if (found && found.name) return found.name;
      }
    }
    return model;
  }

  function renderNewRoom(room, p) {
    const existing = els.messages.querySelector(`[data-ui="ask-card"][data-kind="new-room"][data-key="${CSS.escape(p.key)}"]`);
    const plan = p.plan || {};
    const cast = (plan.vibemates || []).map((v) => `${esc(v.name)}${v.model ? ` (${esc(modelName(room, v.agentType, v.model))})` : ""}`);
    const who = cast.length > 1 ? `${cast.slice(0, -1).join(", ")} and ${cast[cast.length - 1]}` : cast[0] || "";
    const sessions = (plan.price && plan.price.sessions) || 0;
    const wanted = String(plan.name || "").trim().toLowerCase();
    const nameTaken = [...state.rooms.values()].some((r) => String(r.name || "").trim().toLowerCase() === wanted);
    const body =
      (p.plan && p.plan.why ? `<div class="prop-why">${esc(p.plan.why)}</div>` : "") +
      `<div class="prop-row">${who} — <b>${sessions} new session${sessions === 1 ? "" : "s"}</b></div>` +
      `<div class="prop-line">No working folder yet · not reachable from a messenger · ${cast.length === 1 ? "it starts in a mode that asks before it acts" : "they all start in a mode that asks before they act"}.</div>` +
      (nameTaken ? `<div class="prop-line">There is already a room called ${esc(plan.name || "")}.</div>` : "");
    const outcome = p.status === "pending" ? undefined : p.status === "created" ? "created" : "not created";
    const card = UI.el("ask-card", {
      kind: "new-room", who: p.participantName, lead: `proposes a room called ${plan.name || ""}`, body, outcome,
      choices: [{ label: "Create", tone: "ok", act: "make-room", data: { answer: "create" } }, { label: "No", tone: "no", act: "make-room", data: { answer: "no" } }],
      data: { key: p.key },
    });
    if (existing) existing.replaceWith(card);
    else {
      placeCard(card, room, p);
      followEnd("a new-room card");
    }
  }

  function renderProposal(room, p) {
    const existing = els.messages.querySelector(`[data-ui="ask-card"][data-kind="proposal"][data-key="${CSS.escape(p.key)}"]`);
    const lookRow = (p.appearance || []).find((c) => c.key === "look");
    const lookTarget = lookRow && TOKENS.looks[lookRow.to];
    const windowNote = p.appearance && p.appearance.length
      ? `<div class="prop-window"><span class="note">${ic("eye")} This changes the whole window, not this room alone.</span>${lookTarget ? `<div class="prop-look">${UI.html("look-card", { look: lookTarget, tag: lookTag(lookTarget), title: lookTarget.label })}${p.status === "pending" ? UI.html("button", { label: document.documentElement.dataset.tried === lookTarget.id ? "Back" : "Try it on", kind: "soft", size: "xs", act: "try-look", data: { look: lookTarget.id }, title: "This window only, until you apply or reject" }) : ""}</div>` : ""}</div>`
      : "";
    const elsewhere = p.room ? (state.rooms.get(p.room.id)?.name || p.room.name) : null;
    const roomNote = elsewhere ? `<div class="prop-window"><span class="note">${ic("info")} Apply changes the room ${esc(elsewhere)}, not this one.</span></div>` : "";
    const body =
      (p.why ? `<div class="prop-why">${esc(p.why)}</div>` : "") +
      `<div class="prop-diff">${proposalDiffHtml(p)}</div>` +
      roomNote +
      windowNote +
      (p.warnings && p.warnings.length ? `<ul class="prop-warn">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "") +
      (p.touchesOwn ? `<div class="prop-own">${ic("info")} This changes the rules or ${esc(p.participantName)}'s own persona: it decides how ${esc(p.participantName)} itself will behave.</div>` : "");
    const outcome = p.status === "pending" ? undefined : p.status === "applied" ? `applied${p.skipped && p.skipped.length ? ` · not applied: ${p.skipped.join("; ")}` : ""}` : "rejected";
    const card = UI.el("ask-card", { kind: "proposal", who: p.participantName, ...(elsewhere ? { lead: "proposes changes to the room", subject: elsewhere } : {}), body, outcome, choices: [{ label: "Apply", tone: "ok", act: "decide", data: { answer: "apply" } }, { label: "Reject", tone: "no", act: "decide", data: { answer: "reject" } }], data: { key: p.key } });
    if (existing) existing.replaceWith(card);
    else {
      placeCard(card, room, p);
      followEnd("a proposal card");
    }
  }
  function renderRecovery(room, r) {
    const existing = els.messages.querySelector('[data-ui="ask-card"][data-kind="recovery"]');
    const when = r.lastTs ? new Date(r.lastTs).toLocaleString() : null;
    const body = `<div class="prop-why">${r.rows} message${r.rows === 1 ? "" : "s"}${when ? `, the last from ${esc(when)}` : ""}. The copy may lack the newest changes. Until you decide, the room is read-only: nothing new is written and no vibemate answers. To use the original instead, put history.jsonl back in the room's folder and restart.</div>`;
    const card = UI.el("ask-card", { kind: "recovery", who: "The room", lead: "has no history file, only its own copy of the conversation", body, outcome: r.status === "adopted" ? "the copy is the record now; the room is open" : undefined, choices: [{ label: "Use the copy the room has", tone: "ok", act: "adopt-copy" }], data: { key: "recovery" } });
    if (existing) existing.replaceWith(card);
    else placeCard(card, room, r);
  }
  function syncRecovery(room) {
    if (room.recovery) renderRecovery(room, room.recovery);
    else {
      const stale = els.messages.querySelector('[data-ui="ask-card"][data-kind="recovery"]');
      if (stale) stale.remove();
    }
    applyReadOnly(room);
  }
  async function adoptRoomCopy(choice) {
    if (lifetime.disposed) return;
    const room = currentRoom(), key = roomRecordKey(room), uuid = room?.uuid;
    if (!room || key === null) return;
    const actions = roomCommands.forRoom(room);
    const active = () => {
      if (lifetime.disposed) return false;
      const target = roomOfRecord(key);
      return target !== null && target.uuid === uuid;
    };
    choice.disabled = true;
    try {
      const answer = await actions.adoptCopy();
      if (active()) applyRecoveryAnswer(room.id, answer);
    } catch (error) {
      if (!active()) return;
      showError(error); choice.disabled = false;
    }
  }
  function applyRecoveryAnswer(roomId, r) {
    const target = state.rooms.get(roomId);
    if (!target || !r) return;
    if (!roomFacts.producer.acceptRecovery(target, r)) return;
    if (roomId === state.currentRoomId && state.view === "room") syncRecovery(target);
  }
  const COMPOSER_PLACEHOLDER = composer.placeholder;
  function applyReadOnly(room) {
    const held = !!(room && room.readOnly);
    composer.disabled = held;
    composer.placeholder = held ? "Read-only until the room's record is settled (see the room line and the card)" : COMPOSER_PLACEHOLDER;
  }
  function resolveProposalCard(room, proposal) {
    if (proposal) renderProposal(room, proposal);
  }


  const panelWidth = lifetime.use(VIBEROOM_PANEL_WIDTH.create({
    app: els.app, panel: els.details, grip: els.detailsResizer,
  }, {
    window, signal: lifetime.signal, layout: () => Layout, recall, remember,
    defaultWidth: () => Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--details-w")) || 0),
    readTarget: () => ({ key: detailsKey(), side: panelSide(),
      identity: JSON.stringify([state.scope, state.currentRoomId, currentRoom()?.uuid, currentRoom()?.createdAt, state.selection.kind, state.selection.id]) }),
  }));
  function detailsKey() {
    return state.selection.kind === "participant" ? "participant" : state.selection.kind;
  }
  function panelSide() {
    return state.selection.kind === "participant" ? "left" : "right";
  }
  function applyDetailsWidth(px, persist) { panelWidth.apply(px, persist); }
  function fitDetailsWidth() { panelWidth.fit(); }
  let rulesEditor = null;
  lifetime.own(() => rulesEditor?.dispose());
  function openDetails(selection) {
    panelWidth.cancel();
    state.selection = selection;
    state.detailsOpen = true;
    els.app.dataset.panel = panelSide();
    els.details.classList.remove("closing");
    els.details.hidden = false;
    fitDetailsWidth();
    renderDetails();
    if (state.view === "room") renderSideRoom();
    renderRail();
  }
  function closeDetails() {
    panelWidth.cancel();
    rulesEditor?.dispose(); rulesEditor = null;
    if (!state.detailsOpen) return;
    state.detailsOpen = false;
    els.details.classList.add("closing");
    setTimeout(() => {
      if (!state.detailsOpen) {
        els.details.hidden = true;
        els.details.classList.remove("closing");
        delete els.app.dataset.panel;
      }
    }, 190);
    if (state.view === "room") renderSideRoom();
    renderRail();
  }
  function renderDetails() {
    if (!state.detailsOpen) return;
    rulesEditor?.dispose(); rulesEditor = null;
    const room = currentRoom();
    if (!room) {
      els.detailsInner.innerHTML = '<div class="empty">Open a room to begin.</div>';
      return;
    }
    if (state.selection.kind === "participant") {
      const p = findById(room, state.selection.id);
      if (p && p.kind === "agent") return renderAgentPanel(room, p);
    }
    renderRoomPanel(room);
  }
  function profileHeader(p) {
    return VIBEROOM_PANEL_VIEW.profileHeader(p, { avatar, esc, UI, STATUS_LABEL, STATUS_TONE });
  }
  function refreshDetailsHeader(p) {
    const header = els.detailsInner.querySelector(".profile");
    if (header) header.innerHTML = profileHeader(p);
  }
  function panelTitle(title, sub) {
    return VIBEROOM_PANEL_VIEW.panelTitle(title, sub, panelSide(), UI);
  }
  function panelFollows(p) {
    return state.detailsOpen && state.selection?.kind === "participant" && state.selection.id !== p.id;
  }
  function wireDetailsClose() {
    const b = $("#details-close");
    if (b) domResources.nodeListener(b, "click", closeDetails);
  }

  const panelNavigation = lifetime.use(VIBEROOM_PANEL_NAVIGATION.create(els.detailsInner, {
    window, signal: lifetime.signal, UI, layout: () => Layout, remember, panelSectionShown,
    placeBar: placeSettingsBar, listenKey,
  }));
  function panelSectionShown(kind) {
    return VIBEROOM_PANEL_VIEW.panelSectionShown(kind, recall);
  }
  function panelSectionsHtml(kind, bodies, formId) {
    return VIBEROOM_PANEL_VIEW.panelSectionsHtml(kind, bodies, formId, { UI, recall });
  }
  function showPanelSection(id, opts) {
    return panelNavigation.show(id, opts);
  }
  function fitPanelTabs(nav) {
    return panelNavigation.fit(nav);
  }
  function wirePanel() {
    return panelNavigation.wire();
  }

  function searchWords(query) {
    return VIBEROOM_PANEL_NAVIGATION.searchWords(query);
  }
  function holdsEvery(text, words) {
    return VIBEROOM_PANEL_NAVIGATION.holdsEvery(text, words);
  }
  function panelSearchHtml(kind, placeholder) {
    return VIBEROOM_PANEL_VIEW.panelSearchHtml(kind, placeholder, panelNavigation.query(kind), { ic, esc });
  }
  function applyPanelSearch() {
    return panelNavigation.apply();
  }
  const settingFolds = lifetime.use(VIBEROOM_SETTING_FOLD.create(uiRoot, { window, signal: lifetime.signal }));
  function pickNowHtml(now, title) {
    return VIBEROOM_SETTING_FOLD.markup(now, title, UI);
  }
  function closeSettingFold(row) {
    settingFolds.close(row);
  }
  function roomPanelState(room) {
    return JSON.stringify([room.name, room.dir, room.settings, room.customRulesText, room.focused, room.startingWithHub, room.hopLimit]);
  }
  function refreshRoomHeader(room) {
    const header = els.detailsInner.dataset.panel === "room" && els.detailsInner.querySelector(".profile");
    if (header) {
      const html = roomProfileHeader(room);
      if (html !== undefined) header.innerHTML = html;
    }
  }
  function roomProfileHeader(room) {
    const context = roomReader.forRecord(room);
    return context ? VIBEROOM_PANEL_VIEW.roomProfileHeader(context, { roomMark, esc }) : undefined;
  }

  function wakeWord(p) {
    return p.fell || p.status === "error" ? "Reconnect" : "Wake up";
  }

  function renderAgentPanel(room, p) {
    const context = roomReader.forRecord(room);
    if (!context) return;
    const participantActions = roomCommands.forRoom(room).participant(p.id);
    const offline = p.status === "offline";
    window.VIBEROOM_AGENT_PANEL.render(els.detailsInner, context, p, { recipes: state.recipes }, {
      UI, settingsCard, settingRow, wakeWord, vendorLogo, avatar, pickNowHtml, relTime, fmtTokens, numberHtml, skillChannelText, contextWords, lifeOf, contextEventText,
      lastReplyWords: (_context, participant) => panelLastReplyWords(room, participant), fmtCost, panelTitle, profileHeader, ic, wedgeCardHtml, vendorLoggedOut, panelSearchHtml, panelSectionsHtml
    });
    if (!roomReader.forRecord(room)) return;
    wireDetailsClose();
    els.detailsInner.querySelectorAll('.trouble [data-act^="trouble-"]').forEach((btn) => domResources.nodeListener(btn, "click", () => troubleAction(room, p, btn.dataset.act.slice("trouble-".length), btn).catch(showError)));
    const respawnBtn = els.detailsInner.querySelector('button[data-act="respawn"]');
    if (respawnBtn) domResources.nodeListener(respawnBtn, "click", () => respawnWith(p, 0));
    const respawnMem = els.detailsInner.querySelector('button[data-act="respawn-mem"]');
    if (respawnMem) domResources.nodeListener(respawnMem, "click", () => respawnWith(p, Number($("#pp-respawn-n").value) || 0));
    domResources.nodeListener($("#pp-take-notes"), "click", async (e) => {
      e.currentTarget.disabled = true;
      try { await post(roomApi(`/participants/${encodeURIComponent(p.id)}/take-notes`)); } catch (error) { showError(error); e.currentTarget.disabled = false; }
    });
    bindSave($("#pp-notes-card"), () => post(roomApi(`/participants/${encodeURIComponent(p.id)}/notes`), { notes: $("#pp-notes").value }));
    els.detailsInner.querySelectorAll(".action").forEach((btn) => {
      domResources.nodeListener(btn, "click", async () => {
        const act = btn.dataset.act;
        try {
          if (act === "mention") insertMention(p.name);
          else if (act === "remove") {
            if (await confirmDialog(`${p.name} leaves the room and its session is closed. The history stays.`, { title: `Remove ${p.name}?`, okLabel: "Remove", danger: true })) {
              await post(roomApi(`/participants/${encodeURIComponent(p.id)}/remove`));
              closeDetails();
            }
          } else if (act === "reconnect") openReconnectDialog(room, p);
          else await post(roomApi(`/participants/${encodeURIComponent(p.id)}/${act}`));
        } catch (e) {
          showError(e);
        }
      });
    });
    $("#pp-avatar-picker").appendChild(
      replacePicker("participant", options => window.Avatars.pickerElement(p.avatar || "", (emoji) => {
        $("#pp-avatar").value = emoji;
        $("#pp-avatar").dispatchEvent(new Event("change", { bubbles: true }));
        closeSettingFold($("#pp-avatar-row"));
      }, $("#pp-avatar"), options)),
    );
    renderSkillChecks($("#pp-skills"), p.skills || []);
    bindSave($("#pp-skills-section"), () => participantActions.savePersona({ skills: checkedSkills($("#pp-skills")) }));
    bindSave($("#pp-timing"), () => participantActions.savePersona({ replyDelay: $("#pp-delay").value === "" ? null : Number($("#pp-delay").value) }));
    bindCount($("#pp-role"), $("#pp-role-count"), () => briefTextLimit(currentRoom()));
    bindSave($("#pp-persona"), async (current, target) => {
      const patch = { name: $("#pp-name").value, tagline: $("#pp-tagline").value, role: $("#pp-role").value, avatar: $("#pp-avatar").value };
      const role = await fitBriefText(patch.role, `${p.name}'s vibio`, briefTextLimit(room), undefined, { room, current: target });
      if (!target() || role === null) return false;
      await participantActions.savePersona({ ...patch, role });
      return true;
    });
    renderConfig($("#pp-config"), p, offline, room);
    wirePanel();
    $("#pp-recipe").querySelectorAll(".agent-tile").forEach((tile) =>
      domResources.nodeListener(tile, "click", async () => {
        const rec2 = state.recipes.find((r) => r.id === tile.dataset.agent);
        if (!rec2 || rec2.id === p.agentType) return;
        const extraHtml = `<label class="lp-with">With ${p.notes ? "its own notes and " : ""}the last ${UI.html("number-field", { id: "cf-replay", value: String(room.settings?.replayAfterRestart ?? 10), min: 0, max: 500 })} messages</label>`;
        let n = 0;
        const ok = await choiceDialog(`${p.name} moves to ${rec2.vendor}: a new session that gets only what you pick below. You keep the history; the rest of its memory is gone.`, { title: `Run ${p.name} on ${rec2.vendor}?`, okLabel: `Move to ${rec2.vendor}`, danger: true, extraHtml, beforeClose: () => { n = Number($("#cf-replay").value) || 0; } });
        if (ok !== "ok") return;
        tile.disabled = true;
        try {
          await post(roomApi(`/participants/${encodeURIComponent(p.id)}/restaff`), { agentType: rec2.id, replay: n });
        } catch (e) {
          showError(e);
        } finally {
          tile.disabled = false;
        }
      }),
    );
  }


  const configChanging = new Map();
  function flattenOptions(options) { return window.VIBEROOM_AGENT_CONFIG.flattenOptions(options); }
  function acceptConfigReply(roomId, reply) {
    const room = state.rooms.get(roomId), p = reply?.participant;
    if (!room || !p) return null;
    if (roomFacts.producer.configReplyAllowed(room, reply)) {
      const showing = state.currentRoomId === roomId && state.view === "room";
      const before = showing ? visibilityFingerprint(room) : "";
      if (!roomFacts.producer.acceptConfigReply(room, reply)) return null;
      if (showing) {
        if (visibilityFingerprint(room) !== before) renderMessagesSoon("reported settings changed the participant");
        renderSideRoom(); renderChatHead();
      }
    }
    return findById(room, p.id);
  }
  const installationChecked = new Map();
  function checkInstallation(agentType) {
    if (!agentType) return;
    const last = installationChecked.get(agentType) || 0;
    if (Date.now() - last < 5000) return;
    installationChecked.set(agentType, Date.now());
    post(`/api/recipes/${encodeURIComponent(agentType)}/installation-check`, {}).catch(() => { });
  }
  function renderConfig(panel, p, offline, targetRoom = currentRoom()) {
    const targetKey = roomRecordKey(targetRoom), targetUuid = targetRoom?.uuid;
    const participantActions = roomCommands.forRoom(targetRoom).participant(p.id);
    const sameRoom = () => targetKey !== null && roomRecordKey(state.rooms.get(targetRoom.id)) === targetKey && state.rooms.get(targetRoom.id)?.uuid === targetUuid;
    panel.dataset.configRoom = targetRoom.id;
    panel.dataset.configParticipant = p.id;
    if (offline || p.status === "starting") {
      window.VIBEROOM_AGENT_CONFIG.render(panel, p, offline, { UI, settingsCard, settingRow });
      return;
    }
    checkInstallation(p.agentType);
    const roomId = targetRoom.id;
    const key = `${roomId}:${targetUuid || targetKey}:${p.id}`;
    const change = async (control, onChange, value, id) => {
      if (configChanging.has(key)) return;
      const token = Symbol("settings change");
      configChanging.set(key, token);
      const focused = document.activeElement === control;
      for (const node of panel.querySelectorAll("select,input")) node.disabled = true;
      try {
        const reply = await onChange(value);
        if (!sameRoom()) return;
        const actual = acceptConfigReply(roomId, reply);
        if (id && state.currentRoomId === roomId && !actual?.pendingSettings?.length) { recentlySaved.set(id, Date.now()); markSaved(id); }
      } catch (error) { if (sameRoom()) showError(error); }
      finally {
        if (configChanging.get(key) === token) configChanging.delete(key);
        const now = state.rooms.get(roomId)?.participants.find(who => who.id === p.id) || p;
        const shown = panel.isConnected ? panel : panel.id ? byId(panel.id) : null;
        if (sameRoom() && shown?.dataset.configParticipant === p.id && shown.dataset.configRoom === roomId && state.currentRoomId === roomId) {
          renderConfig(shown, now, ["offline", "left"].includes(now.status), state.rooms.get(roomId));
          if (focused && id) byId(id)?.focus({ preventScroll: true });
        }
      }
    };
    window.VIBEROOM_AGENT_CONFIG.render(panel, p, offline, {
      UI, settingsCard, settingRow, busy: configChanging.has(key), change,
      setConfig: participantActions.setConfig,
      listen: (node, type, callback) => domResources.nodeListener(node, type, callback),
      restartInstalled: participantActions.restartInstalled, onError: showError,
    });
  }

  const ONBOARDING_CARDS = [
    { id: "room", tone: "lav", art: () => rig("rooms"), title: "Your first room", words: "Summon your vibemates into a room and talk to all of them at once.", action: "Open a room", go: "new-room",
      done: () => [...state.rooms.keys()].some((id) => id !== guideRoomId()), ask: "Show me how to make my first room." },
    { id: "memory", tone: "mint", art: () => window.Icons.scene("memory-scribe"), title: "Long-term memory", words: "Your vibemates remember what the rooms said, across days and rooms.", action: "Set it up", go: "settings:memory",
      done: () => !!state.memoryProvider?.view?.ready, ask: "Show me how to set up the long-term memory." },
    { id: "messenger", tone: "sky", art: () => window.Icons.scene("rooms"), title: "Your phone", words: "Talk to your rooms from Telegram or Discord, wherever you are.", action: "Connect your phone", go: "settings:channels",
      done: () => (state.channels?.pairings || []).some((p) => !p.unpairedAt), ask: "Show me how to connect my phone." },
    { id: "voice", tone: "rose", art: () => ic("mic"), title: "Voice", words: "Speak to your rooms, and hear the replies read aloud.", action: "Set up the voice", go: "settings:voice",
      done: () => !!state.voice?.ready, ask: "Show me how to set up the voice." },
    { id: "connections", tone: "warm", art: () => window.Icons.scene("connect-plug"), title: "Connections", words: "Jira, Notion, Linear and the others, in every room.", action: "Connect a system", go: "connections",
      done: () => (state.connections || []).some((c) => c.state === "connected"), ask: "Show me how to connect a system." },
    { id: "automations", tone: "lav", art: () => window.Icons.scene("auto-task"), title: "Automations",
      words: () => { const room = automationsRoom(); return room ? `Reminders and tasks your vibemates do on time, in a room of yours: these open for ${room.name}, the room you were in last.` : "Reminders and tasks your vibemates do on time. They live in a room: open one first."; },
      action: () => (automationsRoom() ? "Open Automations" : "Open a room first"), go: "automations",
      done: () => (state.automationJobs || 0) > 0, ask: "Show me how to set up an automation." },
    { id: "look", tone: "peach", art: () => rig("palette"), title: "The look", words: "Colours, light and corners: make the window yours.", action: "Change the look", go: "settings:appearance",
      done: () => { const a = state.settings?.appearance || {}; const look = TOKENS.looks[a.look] ? a.look : TOKENS.current.id; return look !== TOKENS.current.id || Object.keys(a.custom?.[look] || {}).length > 0; },
      ask: "Show me how to change the look." },
  ];
  const automationsRoom = () => (state.currentRoomId && state.rooms.get(state.currentRoomId)) || null;
  function onboardingCard(c) {
    return { id: c.id, tone: c.tone, art: c.art(), title: c.title, words: typeof c.words === "function" ? c.words() : c.words,
      action: typeof c.action === "function" ? c.action() : c.action, go: c.go, done: c.done() };
  }
  function markOnboardingCards() {
    if (state.view !== "onboarding") return;
    VIBEROOM_ONBOARDING_PAGE.mark(els.pageInner, ONBOARDING_CARDS.map(onboardingCard), UI);
  }
  function renderOnboardingPage() {
    VIBEROOM_ONBOARDING_PAGE.render(els.pageInner, ONBOARDING_CARDS.map(onboardingCard), {
      UI, ship: rig("ship"), play: (glyph) => window.Icons.play(glyph), frame: requestAnimationFrame,
      still: () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    });
  }
  function onboardingGo(go) {
    if (go === "new-room") return openRoomDialog();
    if (go === "automations") {
      const room = automationsRoom();
      if (!room) return openRoomDialog();
      selectRoom(room.id);
      return void window.ViberoomAutomations.open(room.id, (id) => currentRoom()?.id === room.id ? jumpToId(id).catch(showError) : false, confirmDialog, dialogPorts);
    }
    if (go.startsWith("settings:")) return openSettings(go.slice("settings:".length));
    setView(go);
    remember("view", go);
  }
  const guideRoomId = () => { const id = recall("onboarding.guideRoom"); return id && state.rooms.has(id) ? id : null; };
  let guideRoomMaking = null;
  async function onboardingAsk(id) {
    const card = ONBOARDING_CARDS.find((c) => c.id === id);
    if (!card) return;
    try {
      let roomId = guideRoomId();
      if (!roomId) {
        guideRoomMaking ||= post("/api/rooms/from-template", { template: "viberoom-guide", name: "viberoom guide", dir: null, vibemates: [{ name: "Guide", agentType: "" }] })
          .finally(() => (guideRoomMaking = null));
        const res = await guideRoomMaking;
        if (!res.room?.id) return;
        roomDirectory.producer.acceptCreated(res.room);
        remember("onboarding.guideRoom", res.room.id);
        roomId = res.room.id;
        for (const n of res.notices || []) toast(n, "info");
      }
      selectRoom(roomId);
      const value = composer.value;
      if (!value.includes(card.ask)) composer.setRangeText(`${value && !/\s$/.test(value) ? " " : ""}${card.ask}`, value.length, value.length, "end");
      composer.focus();
    } catch (error) {
      showError(error);
    }
  }

  function renderMePage() {
    const s = state.settings || {};
    VIBEROOM_ME_PAGE.render(els.pageInner, {
      humanName: s.humanName, humanAvatar: s.humanAvatar, humanDescription: s.humanDescription,
      heroAvatar: avatar(meAvatarData(), 88, { kind: "card" }), smallAvatar: avatar(meAvatarData(), 36, { kind: "card" }),
    }, {
      UI, settingsCard, settingRow, pickNowHtml, actHtml, bindSave,
      listen: (node, type, callback) => domResources.nodeListener(node, type, callback),
      makePicker: (current, onPick, field) => replacePicker("me", options => window.Avatars.pickerElement(current, onPick, field, options)),
      saveProfile: patch => settingsCommands.saveSettings(patch), closeFold: closeSettingFold, onErase: openEraseDialog,
    });
  }

  function renderRoomPanel(room) {
    const context = roomReader.forRecord(room);
    if (!context) return;
    const actions = roomCommands.forRoom(room);
    const rs = room.settings;
    const memoryView = state.memoryProvider?.view;
    const memoryProvider = memoryView?.providers.find(p => p.id === memoryView.provider);
    const forget = memoryProvider?.roomForget;
    const sections = VIBEROOM_ROOM_PANEL.sections(context, {
      forget, memoryLabel: memoryProvider?.label, followsAppTranscripts: followsAppWords(TRANSCRIPT_LABEL[(state.settings || {}).transcripts || "off"]),
    }, {
      UI, settingsCard, settingRow, selectHtml, numberHtml, actHtml, pickNowHtml, roomMark, faceUrl: (face) => window.Avatars.faceUrl(face),
      words: { SHARES_HISTORY_HINT, READS_OTHER_ROOMS_HINT, READS_OTHER_ROOMS_GEEK, READS_OTHER_ROOMS, MEMORY_INPUT_HINT, MEMORY_INPUT_GEEK, MEMORY_INPUT, DIAGNOSTIC_LOG_HELP },
    });
    const profile = roomProfileHeader(room);
    if (profile === undefined) return;
    els.detailsInner.dataset.panel = "room";
    els.detailsInner.innerHTML = `
      ${panelTitle("Room settings", esc(room.name))}
      <div class="profile">${profile}</div>
      ${panelSearchHtml("room", "Search this room's settings")}
      ${panelSectionsHtml("room", sections, "rp-form")}
      <p class="hint panel-foot">The vibemates get the changes on their next turn.</p>`;
    wireDetailsClose();
    rulesToNodes($("#rp-rules"), room.customRulesText != null ? room.customRulesText : rs.customRules || "", room);
    attachRichMentions($("#rp-rules"), $("#rp-rules-menu"));
    bindCount($("#rp-rules"), $("#rp-rules-count"), () => Number($("#rp-text-limit").value) || briefTextLimit(room));
    domResources.nodeListener($("#rp-text-limit"), "input", () => $("#rp-rules").dispatchEvent(new Event("input")));
    $("#rp-emoji-picker").appendChild(
      replacePicker("room", options => window.Avatars.facePicker({ ...options, kind: "room", current: rs.emoji || "", emoji: ROOM_EMOJI, none: { label: "—", title: "None: the room's letter" }, field: $("#rp-emoji"), onPick: (face) => {
        $("#rp-emoji").value = face;
        $("#rp-emoji").dispatchEvent(new Event("change", { bubbles: true }));
        closeSettingFold($("#rp-emoji-row"));
      } })),
    );
    const dirField = $("#rp-dir");
    const folderFormCurrent = () => !lifetime.disposed && dirField.isConnected && !!roomReader.forRecord(room);
    domResources.nodeListener($("#rp-dir-browse"), "click", () => openFolderPicker(dirField.value, (dir) => {
      if (!folderFormCurrent()) return;
      dirField.value = dir;
      dirField.dispatchEvent(new Event("change", { bubbles: true }));
    }));
    domResources.nodeListener(dirField, "change", () => {
      if (folderFormCurrent()) void changeRoomFolder(room, dirField.value.trim(), dirField).catch(showError);
    });
    refreshFolderPending(room);
    domResources.nodeListener($("#rp-template"), "click", () => openSaveTemplateDialog(room));
    bindSave($("#rp-form"), async (current, target) => {
        const name = $("#rp-name").value;
        const limitInput = { value: $("#rp-text-limit").value }, originalLimit = limitInput.value;
        const patch = VIBEROOM_ROOM_PANEL.patch($, () => rulesText($("#rp-rules")));
        if (name.trim() !== room.name) await actions.rename(name);
        if (!target()) return false;
        const rules = await fitBriefText(patch.customRules, "The room rules text", Number(limitInput.value) || briefTextLimit(room), limitInput, { room, current: target });
        if (!target() || rules === null) return false;
        patch.customRules = rules;
        patch.briefTextLimit = Number(limitInput.value);
        if (limitInput.value !== originalLimit && byId("rp-text-limit")) byId("rp-text-limit").value = limitInput.value;
        await actions.saveSettings(patch);
    });
    domResources.nodeListener($("#rp-delete"), "click", async () => {
      if (!(await confirmDialog("Closes this room's vibemates on this computer and moves its history and files to your viberoom trash folder. Stops pending memory work here. Other copies and the shared cloud memory remain.", { title: `Close this copy of "${room.name}"?`, okLabel: "Close this copy", danger: true }))) return;
      try {
        await actions.close();
      } catch (e) {
        showError(e);
      }
    });
    if (forget) wireRoomMemoryForget(room, memoryProvider);
    domResources.nodeListener($("#rp-memory-recovery"), "click", () => window.ViberoomRecovery.open(room.id, { ...dialogPorts, openDialog, closeDialog, confirm: confirmDialog }));
    wirePanel();
  }

  function refreshFolderPending(room) {
    const container = $("#rp-folder-pending"), facts = roomReader.forRecord(room);
    if (!container || !facts || state.selection.kind !== "room") return;
    const html = VIBEROOM_FOLDER_CHANGE.pendingMarkup(facts.participants || [], UI);
    if (container.dataset.folderWarning === html) return;
    container.innerHTML = html; container.dataset.folderWarning = html;
    domResources.nodeListener(container.querySelector("#rp-folder-restart"), "click", () => {
      if (container.isConnected && roomReader.forRecord(room)) void changeRoomFolder(room, room.dir, null, true).catch(showError);
    });
  }

  async function changeRoomFolder(room, dir, field, restartOnly = false) {
    const facts = roomReader.forRecord(room);
    if (!facts || !dir || (!restartOnly && dir === facts.dir)) return;
    const from = facts.dir, actions = roomCommands.forRoom(facts);
    const current = () => {
      if (lifetime.disposed) return false;
      const held = roomReader.forRecord(room);
      return !!held && held.dir === from;
    };
    const participants = (facts.participants || []).filter(p => p.kind === "agent" && (restartOnly
      ? p.folderPending : p.folderPending || !["offline", "left", "unstaffed"].includes(p.status)));
    const choice = await folderChange.choose({ name: facts.name, from, to: dir, participants, restartOnly,
      allowLater: facts.folderRestartChoice === true, current });
    if (!current()) return;
    if (!choice) {
      if (field?.isConnected && field.value.trim() === dir) field.value = from;
      return;
    }
    try {
      if (restartOnly) await actions.restartInFolder();
      else await actions.changeDirectory(dir, choice);
    } catch (error) {
      if (current() && field?.isConnected && field.value.trim() === dir) field.value = from;
      throw error;
    }
  }

  function wireRoomMemoryForget(room, provider) {
    const button = $("#rp-memory-forget"), status = $("#rp-memory-forget-status");
    const url = `/api/rooms/${encodeURIComponent(room.id)}/memory-forget`;
    const originalButton = button.innerHTML;
    let timer, revision = 0;
    const refresh = async () => {
      clearTimeout(timer);
      if (!status.isConnected) return;
      const checking = ++revision;
      try {
        const result = await get(url);
        if (!status.isConnected || checking !== revision) return;
        if (result.provider !== provider.id) { button.disabled = true; status.textContent = "The memory provider changed. Reopen this panel."; return; }
        const deletion = result.deletion;
        button.disabled = deletion?.state === "pending";
        if (deletion?.state === "failed") {
          button.textContent = "Retry deletion…";
          status.textContent = `Cloud deletion failed: ${deletion.reason || "No reason was recorded."} ${deletion.retryable ? "It will retry automatically; you can also retry now." : "Correct the problem and retry deletion."}`;
          if (deletion.retryable) timer = setTimeout(refresh, 1500);
        } else if (deletion?.state === "pending") {
          button.innerHTML = originalButton;
          status.textContent = "Cloud deletion pending. It waits for earlier requests from this copy and retries if the provider is unavailable.";
          timer = setTimeout(refresh, 1500);
        } else {
          button.innerHTML = originalButton;
          status.textContent = deletion?.state === "confirmed"
            ? `${provider.roomForget.completed} Confirmed: ${new Date(deletion.updatedAt).toLocaleString()}.`
            : "No recorded confirmation of deletion for this room.";
        }
      } catch (error) {
        if (status.isConnected && checking === revision) {
          status.textContent = `Could not check deletion: ${error.message}`;
          timer = setTimeout(refresh, 1500);
        }
      }
    };
    domResources.nodeListener(button, "click", async () => {
      const words = `${provider.roomForget.description}\n\nThis turns off remembering in this copy and discards its pending memory writes. Your conversation and files stay. Turning remembering back on sends only new messages; older history is not sent again.`;
      if (!(await confirmDialog(words, { title: `Forget cloud memory of "${room.name}"?`, okLabel: "Forget cloud memory", danger: true }))) return;
      ++revision;
      clearTimeout(timer);
      button.disabled = true;
      try {
        await post(url, { provider: provider.id, confirm: true });
        const remembers = $("#rp-remembers");
        if (remembers && button.isConnected) remembers.checked = false;
        await refresh();
      } catch (error) { button.disabled = false; showError(error); }
    });
    void refresh();
  }


  function dataFolderRow() { return VIBEROOM_SETTINGS_VIEW.dataFolderRow(state.dataFolder, { UI, esc }); }

  function autostartStatusText() {
    const a = state.autostart;
    if (!a) return "Not known yet.";
    const when = (ts) => (ts ? new Date(ts).toLocaleString() : "never");
    const parts = [];
    if (a.unavailable) parts.push(a.unavailable);
    if (a.enabled) parts.push(`Set up on ${when(a.installedAt)}.`);
    if (a.foreign) parts.push("Another viberoom, with another data folder, starts at sign-in; switching this on takes its place.");
    parts.push(`Last automatic start: ${when(a.lastAutoStartAt)}.`);
    if (a.targetMissing) parts.push(`The sign-in entry points at a missing file (${a.target || a.script}): switch it off, or start viberoom again from where it is now.`);
    else if (a.stale) parts.push("The entry points at an older copy of viberoom; the next start fixes it.");
    if (a.note) parts.push(a.note);
    return esc(parts.join(" "));
  }

  const KEEP_AWAKE_CHOICES = [["always", "Always", "sun", "amber"], ["plugged-in", "When plugged in", "plug", "mint"], ["never", "Never", "moon", "violet"]];
  function keepAwakeStatusText() {
    const k = state.keepAwake;
    if (!k) return "";
    const names = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);
    const are = (list) => (list.length === 1 ? "is" : "are");
    const alive = k.working.filter((name) => !k.quiet.includes(name));
    if (k.means === null) return `This computer cannot be kept awake from here: ${k.missing}.`;
    if (k.holding) return `Awake now: ${names(alive)} ${are(alive)} working.`;
    if (k.missing && k.choice !== "never" && k.working.length) return `Not kept awake: ${k.missing}.`;
    if (!k.working.length) return "No vibemate is working: the computer sleeps as usual.";
    if (k.choice === "never") return `${names(k.working)} ${are(k.working)} working, and the computer sleeps as usual.`;
    if (!alive.length) return `${names(k.quiet)} ${k.quiet.length === 1 ? "has" : "have"} been silent for over an hour: the computer may sleep.`;
    if (k.onBattery) return "On its battery: the computer sleeps as usual until it is plugged in.";
    return "";
  }
  function keepAwakeTone() {
    const k = state.keepAwake;
    return k && (k.means === null || (k.missing && !k.holding && k.choice !== "never" && k.working.length)) ? "warn" : "plain";
  }

  const SETTINGS_CATEGORIES = VIBEROOM_SETTINGS_SCREEN.baseCategories;
  const SETTINGS_PAGE_SHOWN = "settings-page-shown";
  function settingsCategories() {
    return VIBEROOM_SETTINGS_SCREEN.categories({ folder: state.dataFolder, voice: state.voice,
      memory: state.memoryProvider?.view, installation: state.installation ?? (standalone.applicationHost ? { updates: null, autostart: false, restart: false } : undefined), development: devBuild() });
  }
  function markSettingsRail() {
    const button = rail.navButton("settings");
    if (!button) return;
    const waiting = settingsCategories().filter((c) => c.attention).map((c) => c.attention);
    if (waiting.length) button.dataset.attention = "";
    else delete button.dataset.attention;
    button.dataset.hint = waiting.length ? `Settings: ${waiting[0]}${waiting.length > 1 ? ` (and ${waiting.length - 1} more)` : ""}` : "Settings";
  }
  function almostOn(view) { return VIBEROOM_SETTINGS_SCREEN.almostOn(view); }
  function settingsCategoryShown(categories) {
    const saved = recall("settings.category");
    return categories.some((c) => c.id === saved) ? saved : categories[0].id;
  }
  function openSettings(category) {
    if (state.embedded) { notifyHost("onNavigate", { view: "settings", category }); return; }
    if (category) remember("settings.category", category);
    setView("settings");
    remember("view", "settings");
  }
  function showSettingsCategory(id, options) { return settingsScreen?.show(id, options) || false; }
  function placeSettingsBar(nav) { VIBEROOM_SETTINGS_SCREEN.placeBar(nav, lifetime.frame); }
  function showCategoryOf(entry, id, opts) {
    return entry.closest("#details-inner") ? showPanelSection(id, opts) : showSettingsCategory(id, opts);
  }
  lifetime.on(uiRoot, "click", (e) => {
    const b = e.target.closest && e.target.closest('[data-ui="settings-nav"] button[data-category]');
    if (b?.closest("#details-inner")) showCategoryOf(b, b.dataset.category);
  });
  listenKey((e) => {
    const b = e.target.closest && e.target.closest('[data-ui="settings-nav"] button[data-category]');
    if (!b?.closest("#details-inner") || e.altKey || e.ctrlKey || e.metaKey) return;
    const nav = b.closest('[data-ui="settings-nav"]');
    const all = [...nav.querySelectorAll("button[data-category]")];
    const at = all.indexOf(b);
    const [next, back] = nav.dataset.layout === "row" ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
    const to = { [next]: at + 1, [back]: at - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    showCategoryOf(b, all[(to + all.length) % all.length].dataset.category, { focus: true });
  });

  const ROOM_VALUE_ROWS = VIBEROOM_SETTINGS_SCREEN.roomRows;
  function roomsByName() {
    return [...state.rooms.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function roomContextsByName() {
    const contexts = [];
    if (lifetime.disposed) return Object.freeze(contexts);
    for (const room of roomsByName()) {
      const context = roomReader.forRecord(room);
      if (lifetime.disposed) return Object.freeze([]);
      if (context) contexts.push(context);
    }
    return Object.freeze(contexts);
  }
  function roomValueWords(spec, value) { return VIBEROOM_SETTINGS_SCREEN.words(spec, value); }
  function roomValuesSummary(spec, rooms) { return VIBEROOM_SETTINGS_SCREEN.summary(spec, rooms.map(settingsRoom)); }
  function roomValueRow(room, id, control) { return VIBEROOM_SETTINGS_SCREEN.roomValueRow(room, id, control, { esc, roomMark }); }
  function roomListFold(summary, title, attrs, rowsHtml) { return VIBEROOM_SETTINGS_SCREEN.roomListFold(summary, title, attrs, rowsHtml, UI); }
  function roomValueHtml(rowId, room) {
    return roomValueRow(room, `rv-${rowId}-${room.id}`, roomValueControl(rowId, room));
  }
  function roomValueControl(rowId, room, label) {
    return VIBEROOM_SETTINGS_SCREEN.control(rowId, settingsRoom(room), label, { UI, selectHtml });
  }
  function roomValues(rowId) {
    return VIBEROOM_SETTINGS_SCREEN.fold(rowId, settingsRooms(), { UI, esc, selectHtml });
  }

  function showRoomValue(key, roomId, kept) { settingsScreen?.refreshValue(key, roomId, kept); }
  function showRoomValues(room) { settingsScreen?.refreshRoom(settingsRoom(room)); }
  function settingsRoom(room) {
    return { id: room.id, identity: roomRecordKey(room), name: room.name, mark: roomMark(room, "sm"),
      settings: Object.fromEntries([...new Set(Object.values(ROOM_VALUE_ROWS).map(row => row.key))].map(key => [key, room.settings?.[key]])) };
  }
  function settingsRooms() { return roomsByName().map(settingsRoom); }

  async function saveSettingsRoom(id, identity, patch) {
    const before = state.rooms.get(id);
    if (!before || roomRecordKey(before) !== identity) return null;
    const result = await roomCommands.forRoom(before).saveSettings(patch);
    if (lifetime.disposed) return null;
    const room = state.rooms.get(id);
    if (!room || roomRecordKey(room) !== identity) return null;
    if (result?.settings) roomFacts.producer.acceptSettings(room, result.settings);
    return result;
  }

  function settingsPageMarkup() {
    const categories = settingsCategories(), development = devBuild();
    return VIBEROOM_SETTINGS_VIEW.render({
      data: { settings: state.settings, roomDefaults: state.roomDefaults, recipes: state.recipes,
        installation: state.installation ?? (standalone.applicationHost ? { updates: null, autostart: false, restart: false } : undefined),
        version: state.version ? { ...state.version, name: standalone.title || state.version.name } : null, autostart: state.autostart },
      theme: TOKENS, fonts: FONTS, diagrams: DIAGRAM_PRESETS, UI, esc, vendorLogo,
      fields: { row: settingRow, card: settingsCard, select: selectHtml, number: numberHtml, action: actHtml },
      labels: { DIAGNOSTIC_LOG_HELP, KEEP_AWAKE_CHOICES, READS_OTHER_ROOMS, READS_OTHER_ROOMS_GEEK,
        READS_OTHER_ROOMS_HINT, REMEMBERS_HINT, SHARES_HISTORY_HINT, WHEEL_STEP_DEFAULT },
      categories, shown: settingsCategoryShown(categories), development,
      roomValues: Object.fromEntries(["sp-turns","sp-delay","sp-hops","sp-brief-turns","sp-brief-tokens","sp-text-limit","sp-header-rules","sp-tools","sp-share-history","sp-reads-others","sp-remembers","sp-transcripts-mode"].map(id => [id, roomValues(id)])),
      parts: { lookSample: lookSampleHtml(), lookTags: Object.fromEntries(Object.values(TOKENS.looks).map(l => [l.id, lookTag(l)])),
        diagramSample: mermaidBlock("graph LR\n  A[You] --> B(Vibemate)\n  B --> C{Agreed?}\n  C -->|yes| D[Done]\n  C -->|no| B").replace('class="mermaid-block"', 'class="mermaid-block preview"'),
        diagnostics: VIBEROOM_DIAGNOSTICS_SETTINGS.markup({ mode: state.settings?.transcripts || "off",
          roomValues: roomValues("sp-transcripts-mode"), help: DIAGNOSTIC_LOG_HELP, trace: boxTraceHtml() },
          { UI, row: settingRow, select: selectHtml, action: actHtml }),
        notifyPermission: notifyPermissionRow(settingRow), channels: channelsSectionHtml(), voice: voiceSectionHtml(),
        reading: readingSectionHtml(), memory: memorySectionHtml(), updateStatus: updateStatusText(),
        agentUpdateStatus: agentUpdates.status(), autostartStatus: autostartStatusText(),
        keepAwakeStatus: keepAwakeStatusText(), keepAwakeTone: keepAwakeTone(), dataFolder: dataFolderRow(),
        boxTrace: boxTraceHtml(), slowTasks: development ? slowTasksHtml() : "", endJumps: development ? endJumpsHtml() : "",
        wheelTrace: development ? wheelTraceSummary() : "" },
    });
  }

  let settingsRender = null, settingsScreen = null;
  function renderSettingsPage() {
    if (!settingsScreen || settingsScreen.disposed) {
      const screen = enterScreen("settings");
      settingsScreen = VIBEROOM_SETTINGS_SCREEN.create(els.pageInner, {
        signal: screen.lifetime.signal, markup: settingsPageMarkup, mountParts: mountSettingsParts,
        UI, pageShown: SETTINGS_PAGE_SHOWN, remember: id => remember("settings.category", id),
        motion: { reduced: () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, play: glyph => window.Icons.play(glyph) },
        rooms: settingsRooms, saveRoom: saveSettingsRoom, markSaved, onError: showError,
      });
    }
    settingsScreen.render();
  }

  function mountSettingsParts(root, owner) {
    settingsRender = owner;
    bindDiagnosticLogControls();
    settingsRender.on($("#sp-carry"), "click", () => void openCarry(null));
    bindChannelControls();
    bindMemoryControls();
    bindVoiceControls();
    bindReadingControls();
    settingsRender.use(VIBEROOM_SETTINGS_FORM.mount(els.pageInner.querySelector(".settings-page"), {
      signal: settingsRender.signal,
      read: () => ({ settings: settingsModel.reader.read().settings, looks: settingsModel.reader.read().looks,
        writingNames: [...state.rooms.values()].flatMap(r => (r.participants || []).filter(p => p.kind === "agent" && p.status === "thinking").map(p => p.name)) }),
      commands: settingsCommands, queries: settingsQueries, theme: TOKENS, fonts: FONTS, UI, esc,
      fields: { card: settingsCard, row: settingRow, nameList },
      dialogs: { confirm: confirmDialog, choice: choiceDialog, restartSessionsChecked: () => !!$("#cf-sessions-once")?.checked },
      bindings: { copy: bindCopy, save: settingsSaveBinder(), vendorChoices: fillVendorChoices },
      previews: { applyCustomVars, renderDiagrams, loadMermaid, pageShown: SETTINGS_PAGE_SHOWN },
      diagnostics: { slowTasksText, wheelTraceText, startTrace: () => {
        boxTrace = { state: "recording" }; paintBoxTrace(); window.postMessage({ viberoomTrace: "start" }, location.origin);
      }, traceText: () => boxTrace.state === "done" ? boxTraceStatus() : "" },
      effects: { showError, toast, requestNotificationPermission: askToKnock,
        refresh: () => { if (state.view === "settings") renderSettingsPage(); },
        acceptAutostart: value => { if (!lifetime.disposed) hubStatus.acceptAutostart(value || state.autostart); },
        acceptDataFolder: value => { if (!lifetime.disposed) { hubStatus.acceptDataFolder(value); markSettingsRail(); } },
        acceptUpdate: value => { if (!lifetime.disposed) hubStatus.acceptUpdate(value); },
        updateStatusText, refreshUpdateNotice: renderUpdatePop, openAgentUpdates: () => agentUpdates.open(),
        saveFile: value => VIBEROOM_SAVE.saveFile(value) },
    }));
  }

  function partsStatusText(u) {
    const p = u.parts.product, a = u.parts.application;
    let mine = `viberoom ${p.current}`;
    if (p.stage === "downloading") mine += `: ${p.latest} is downloading, ${p.progress ?? 0} %`;
    else if (p.stage === "ready") mine += `: ${p.latest} is downloaded and checked; Update now restarts the room into it`;
    else if (p.stage === "waiting") mine += `: ${p.latest} is downloaded and checked, and can start after ${new Date(p.runnableAt).toLocaleString()}, once it has been out for a day`;
    else if (p.checking) mine += ": checking now";
    else if (p.outcome === "needs-application" || p.waitsForApplication) mine += `: viberoom ${p.waitsForApplication || "a newer version"} is out and needs a newer application`;
    else if (p.outcome === "too-new") mine += ": a newer version is out, and is taken once it has been out for a day";
    else if (p.outcome === "later") mine += ": could not check now; it tries again later";
    else if (p.outcome === "refused") mine += ": a newer version could not be taken; the next one is waited for";
    else if (p.outcome === "current" || p.outcome === "found") mine += ", the latest";
    else mine += ", not checked yet";
    let app = a ? `application ${a.current}` : "the application";
    if (u.parts.byStore) app += ", which the store it came from keeps up to date";
    else if (!a) app += ": not checked yet";
    else if (a.available && a.stage === "downloading") app += `: ${a.latest} is downloading, ${a.progress ?? 0} %`;
    else if (a.available && a.stage === "ready") app += `: ${a.latest} is ready; Restart to update`;
    else if (a.available) app += `: ${a.latest} is out`;
    else if (a.error) app += ": could not check now; it tries again later";
    else app += ", the latest";
    const when = u.checkedAt ? `; checked ${new Date(u.checkedAt).toLocaleString()}` : "";
    return `${mine} · ${app}${when}.`;
  }


  function updateStatusText() {
    const u = state.update;
    if (u && u.parts) return partsStatusText(u);
    const v = state.version ? state.version.version : "?";
    if (!u || !u.checkedAt) return `This is viberoom ${v}; not checked yet.`;
    const when = new Date(u.checkedAt).toLocaleString();
    if (u.available && u.stage === "downloading") return `viberoom ${u.latest} is downloading, ${u.progress ?? 0} % (this is ${u.current}); checked ${when}.`;
    if (u.available && u.stage === "ready") return `viberoom ${u.latest} is downloaded and ready: Restart to update (this is ${u.current}); checked ${when}.`;
    if (u.available) return `viberoom ${u.latest} is available (this is ${u.current}); checked ${when}.`;
    if (u.error) return `Could not check for a newer version (${u.error}); checked ${when}.`;
    return `This is viberoom ${u.current}, the latest; checked ${when}.`;
  }

  const channelsKeep = { newRoot: "", newDeep: true, rename: false };

  function configurationProblemHtml(id, problem) { return VIBEROOM_SETTINGS_VIEW.configurationProblemHtml(id, problem, { settingsCard, settingRow }); }

  function channelsSectionHtml() {
    return VIBEROOM_CHANNELS_SETTINGS.markup({ channels: state.channels || undefined,
      draft: { ...channelsKeep }, year: new Date().getFullYear() }, { UI, esc, ic, geekTip, configurationProblemHtml });
  }

  const KEY_GEEK = "This field is write-only. The value goes from it straight into this computer's vault — sealed with Windows DPAPI, macOS Keychain or the Linux Secret Service — and the settings file keeps only a vault:… reference. It never comes back to this screen, never enters a room, a prompt, the record or a vibemate's context; they learn only that a key is set. As a second net, every line of the hub's log is scrubbed of the stored values and of key shapes.";

  function noPeekHtml(kind = "row", label = "No vibemate sees this field: it has turned its back and covers its eyes") { return VIBEROOM_FEATURE_CONSENT.noPeekHtml(kind, label, { esc, scene: name => window.Icons.scene(name) }); }


  function consentTitle(feature, recipient, reader) {
    return VIBEROOM_FEATURE_CONSENT.title(feature, recipient, reader);
  }
  function consentGateHtml(props) {
    return VIBEROOM_FEATURE_CONSENT.gate(props, UI);
  }
  let consentOpened = null;
  function consentLockHtml(body, props) {
    return VIBEROOM_FEATURE_CONSENT.lock(body, { ...props, opened: consentOpened === props.feature }, UI);
  }
  function waitingOn(view, piece) {
    return VIBEROOM_FEATURE_CONSENT.waitingOn(view, piece);
  }
  function bindFeatureConsent(section, signal = settingsRender?.signal) {
    if (!section) return;
    const control = VIBEROOM_FEATURE_CONSENT.mount(section, { signal,
      saveConsent: settingsCommands.saveConsent,
      onAccepted: lifetime.guard((res, { feature, withdraw }) => {
        serviceFacts.acceptFeatures(res.voice, res.memoryProvider);
        consentOpened = withdraw ? null : feature;
        try { featuresChanged(); } finally { consentOpened = null; }
      }),
      onError: showError, refresh: () => void refreshFeatureViews(),
    });
    settingsRender?.use(control);
  }
  function readingSectionHtml() {
    return VIBEROOM_VOICE_SETTINGS.readingMarkup({ voice: state.voice, opened: consentOpened,
      language: navigator.language, localVoices: VIBEROOM_READER.localVoices(window.speechSynthesis).map(({ name, lang }) => ({ name, lang })) }, voiceSettingsMarkupPorts());
  }
  function voiceSettingsMarkupPorts() {
    return { UI, esc, ic, selectHtml, keyHelp: KEY_GEEK, noPeekHtml, consent: VIBEROOM_FEATURE_CONSENT };
  }
  function voiceSectionHtml() {
    return VIBEROOM_VOICE_SETTINGS.voiceMarkup({ voice: state.voice, opened: consentOpened }, voiceSettingsMarkupPorts());
  }

  function bindVoiceControls() {
    const section = $("#sp-voice");
    if (!section) return;
    settingsRender.use(VIBEROOM_VOICE_SETTINGS.mountVoice(section, voiceSettingsActionPorts()));
  }

  function bindReadingControls() {
    const section = $("#sp-voice-reading");
    if (!section) return;
    settingsRender.use(VIBEROOM_VOICE_SETTINGS.mountReading(section, voiceSettingsActionPorts()));
  }
  function voiceSettingsActionPorts() {
    return { signal: settingsRender.signal, readProvider: () => state.voice?.provider || "off",
      saveVoice: settingsCommands.saveVoice, bindSave: settingsSaveBinder(), bindConsent: bindFeatureConsent, openVoiceGuide: () => voiceGuideView.open(),
      onAccepted: lifetime.guard(view => { serviceFacts.acceptVoice(view); featuresChanged(); }),
      tryReading: () => {
        const last = [...(currentRoom()?.messages || [])].reverse().find(m => m.kind === "chat" && m.from !== "human" && !m.streaming && !m.bodyMissing && VIBEROOM_READER.speakable(m.text));
        readAloud(last || { id: "settings-sample", text: "This is how your vibemates sound when their replies are read aloud." });
      },
    };
  }
  function settingsSaveBinder() {
    const screen = enterScreen("settings");
    return (container, action, options) => bindSave(container, action, { ...options, canShow: screen.isCurrent });
  }

  const MEMORY_ROOM_COLUMNS = VIBEROOM_MEMORY_SETTINGS.roomColumns;
  function memoryRoomDisplay() {
    const rooms = roomsByName();
    const columns = MEMORY_ROOM_COLUMNS.map(id => ({ id, label: ROOM_VALUE_ROWS[id].column }));
    return { columns, summary: roomValuesSummary(ROOM_VALUE_ROWS["sp-mem-remembers"], rooms),
      items: rooms.map(room => ({ id: room.id, name: room.name, mark: roomMark(room, "sm"),
        cells: Object.fromEntries(columns.map(({ id, label }) => [id, roomValueControl(id, room, `${room.name}: ${label}`)])) })) };
  }
  function memorySectionHtml() {
    return VIBEROOM_MEMORY_SETTINGS.markup({ memory: state.memoryProvider, rooms: memoryRoomDisplay(), opened: consentOpened },
      { UI, esc, ic, selectHtml, keyHelp: KEY_GEEK, noPeekHtml, scene: name => window.Icons.scene(name), consent: VIBEROOM_FEATURE_CONSENT });
  }

  async function refreshFeatureViews() {
    try {
      const [voice, memory] = await Promise.all([settingsQueries.voice(), settingsQueries.memoryProvider()]);
      serviceFacts.acceptFeatures(voice.view, memory);
      featuresChanged();
    } catch {
    }
  }
  let memoryProviderLoad = null;
  function loadMemoryProvider() {
    if (state.memoryProvider || memoryProviderLoad) return;
    memoryProviderLoad = settingsQueries.memoryProvider().then((m) => {
      serviceFacts.acceptMemoryProvider(m);
      featuresChanged();
    }).catch(() => {}).finally(() => { memoryProviderLoad = null; });
  }
  function featuresChanged({ page = true } = {}) {
    voiceControl.redraw();
    markSettingsRail();
    markOnboardingCards();
    if (page && state.view === "settings") renderSettingsPage();
  }

  function bindMemoryControls() {
    const section = $("#sp-memory");
    if (!section) return;
    settingsRender.use(VIBEROOM_MEMORY_SETTINGS.mount(section, {
      signal: settingsRender.signal, readMemory: () => state.memoryProvider,
      saveMemory: settingsCommands.saveMemoryProvider, deliveries: settingsQueries.memoryDeliveries,
      deliveryAction: settingsCommands.memoryDeliveryAction,
      onAccepted: lifetime.guard(value => { serviceFacts.acceptMemoryProvider(value); featuresChanged(); }),
      bindSave: settingsSaveBinder(), bindConsent: bindFeatureConsent, loadMetadata: loadMemoryProvider,
      rows: { UI, row: settingRow }, confirm: confirmDialog, onError: showError,
      openRecovery: id => window.ViberoomRecovery.open(id, { ...dialogPorts, openDialog, closeDialog, confirm: confirmDialog }),
    }));
  }





  function dropPairLink(cancelAtHub) {
    const link = state.pairLink;
    state.pairLink = null;
    if (cancelAtHub && link && !link.copied && link.expiresAt > Date.now()) return settingsCommands.cancelPairLink().catch(() => {});
  }

  function bindChannelControls() {
    const section = $("#sp-channels");
    if (!section) return;
    const screen = enterScreen("settings");
    settingsRender.use(VIBEROOM_CHANNELS_SETTINGS.mount(section, {
      signal: settingsRender.signal, UI, telegram: state.channels?.telegram,
      saveTelegram: settingsCommands.saveTelegram, requestToken: settingsCommands.requestTelegramToken,
      unpair: settingsCommands.unpairTelegram, bindSave: settingsSaveBinder(),
      onAccepted: lifetime.guard(res => { serviceFacts.acceptChannels(res.channels || state.channels); }),
      onDraft: patch => Object.assign(channelsKeep, patch),
      redraw: focus => { if (screen.isCurrent()) { renderSettingsPage(); if (focus) $("#sp-tg-name")?.focus(); } },
      rename: channelsKeep.rename, chooseFolder: openFolderPicker, confirmUnpair: choiceDialog,
      openSetup: openSetupWizard, openGuide, onError: showError,
    }));
  }

  function bindDiagnosticLogControls() {
    settingsRender.use(VIBEROOM_DIAGNOSTICS_SETTINGS.mount($("#sp-transcripts"), {
      signal: settingsRender.signal, pageShown: SETTINGS_PAGE_SHOWN,
      readRequests: settingsQueries.diagnosticRequests, readLogs: settingsQueries.diagnosticLogs,
      clearLogs: settingsCommands.clearDiagnosticLogs,
      saveMode: transcripts => settingsCommands.saveSettings({ transcripts }), bindSave: settingsSaveBinder(),
      copyText: text => navigator.clipboard.writeText(text), confirm: confirmDialog, onError: showError,
      manualCopy: async text => {
        const closed = choiceDialog("Automatic copying is unavailable. Select and copy the details below.", {
          title: "Tool connection details", okLabel: "Close", hideCancel: true,
          extraHtml: `<textarea class="textarea" id="diagnostic-copy-text" rows="10" readonly spellcheck="false" aria-label="Tool connection details">${esc(text)}</textarea>`,
        });
        const field = $("#diagnostic-copy-text"); field?.focus(); field?.select(); await closed;
      },
    }));
  }

  function renderSkillsPage() {
    const screen = enterScreen("skills");
    if (!screen) return;
    const room = state.skillsRoom ? state.rooms.get(state.skillsRoom) : null;
    if (state.skillsRoom && !room) state.skillsRoom = null;
    VIBEROOM_SKILLS_PAGE.render(els.pageInner, {
      screen, skills: state.skills || [], room, holdersOf: (name) => (room ? skillHolders(room, name) : []), editor: state.skillEditor,
    }, {
      UI, icon: ic, settingsCard, settingRow, geekTip,
      listen: (node, type, callback) => domResources.nodeListener(node, type, (...args) => {
        if (screen.isCurrent()) return callback(...args);
      }, { signal: screen.signal }),
      requests: {
        list: (options) => get("/api/skills", options),
        get: (name, options) => get(`/api/skills/${encodeURIComponent(name)}`, options),
        save: (value) => post("/api/skills", value),
        remove: (name) => post(`/api/skills/${encodeURIComponent(name)}/delete`),
        approve: (name) => post(`/api/skills/${encodeURIComponent(name)}/approve`),
      },
      toast, showError, confirm: confirmDialog,
      onAll: () => {
        state.skillsRoom = null;
        renderSideRooms();
        renderSkillsPage();
      },
      setEditor: (value) => {
        state.skillEditor = value;
        renderSkillsPage();
      },
      setSkills: (list) => {
        serviceFacts.acceptSkills(list);
        renderSkillsPage();
      },
    });
  }


  function connectionMark(c, size) {
    return VIBEROOM_CONNECTIONS_PAGE.mark(c, size, UI);
  }
  let connectionsPage = null;
  function renderConnectionsPage() {
    connectionsPage ||= lifetime.use(VIBEROOM_CONNECTIONS_PAGE.create(els.pageInner, {
      UI, icon: ic, scene: (name) => window.Icons.scene(name), settingsCard, settingRow, geekTip, roomListFold, roomValueRow, configurationProblemHtml,
      view: () => ({ connections: state.connections || [], rooms: roomContextsByName(), storageProblem: state.connectionStorageProblem,
        detail: state.cnDetail, addKind: state.cnAddKind, last: state.cnLast }),
      setDetail: (id) => { state.cnDetail = id; },
      setLast: (id) => { state.cnLast = id; },
      setAddKind: (kind) => { state.cnAddKind = kind; },
      setConnections: (list) => { serviceFacts.acceptConnections(list); },
      rerender: () => renderConnectionsPage(),
      requests: {
        act: (id, act) => post(`/api/connections/${encodeURIComponent(id)}/${act}`, {}),
        addOwn: (body) => post("/api/connections/own", body),
        room: (id, body) => post(`/api/connections/${encodeURIComponent(id)}/room`, body),
      },
      toast, showError, confirm: confirmDialog,
      isShown: () => state.view === "connections",
      scrollTop: () => { els.pageView.scrollTop = 0; },
    }));
    connectionsPage.render();
  }


  function renderSkillChecks(container, selected) {
    VIBEROOM_SKILL_CHECKS.render(container, selected, state.skills, { esc, UI });
  }
  function checkedSkills(container) {
    return VIBEROOM_SKILL_CHECKS.read(container);
  }
  function skillHolders(room, name) {
    const lower = name.toLowerCase();
    return room.participants.filter((p) => p.kind === "agent" && (p.skills || []).some((s) => s.toLowerCase() === lower));
  }
  function skillChannelText(p) {
    if (p.status === "offline") return "";
    if (p.skillChannel === "tool") return "Loads skills through the load_skill tool (the room's MCP server; no permission prompts).";
    if (p.skillChannel === "marker") return "Loads skills with the [skill:name] marker in a hidden turn (this vibemate did not take the room's MCP server).";
    if (p.skillChannel === "pending") return "Deciding how this session loads skills…";
    return "";
  }

  function openInvite() {
    const room = currentRoom();
    if (!room) return toast("Open a room first.", "warn");
    return inviteDialog.open({ id: room.id, uuid: room.uuid, createdAt: room.createdAt, settings: { replyDelay: room.settings.replyDelay } });
  }
  function openStaffDialog(participant) {
    const room = currentRoom();
    if (!room) return;
    return inviteDialog.open({ id: room.id, uuid: room.uuid, createdAt: room.createdAt, settings: { replyDelay: room.settings.replyDelay } }, participant);
  }
  function renderInviteTiles() { inviteDialog.update(); }
  function renderInviteLogin() { inviteDialog.update({ tiles: false }); }


  const vendorChoicesAsked = new Map();
  async function fillVendorChoices(vendor, { signal, root = uiRoot } = {}) {
    const asked = vendorChoicesAsked.get(vendor);
    if (asked && Date.now() - asked < 5000) return;
    vendorChoicesAsked.set(vendor, Date.now());
    let info;
    try { info = await get(`/api/recipes/${encodeURIComponent(vendor)}/options`, { signal }); }
    catch { vendorChoicesAsked.delete(vendor); return; }
    if (signal?.aborted) return;
    const categories = { model: "model", effort: "thought_level", mode: "mode" };
    for (const [key, category] of Object.entries(categories)) {
      const list = root.querySelector(`#${CSS.escape(`sp-list-${vendor}-${key}`)}`);
      if (!list) continue;
      const option = info.configOptions.find((o) => o.category === category && o.type === "select");
      const values = option ? flattenOptions(option.options)
        : key === "mode" && info.modes?.availableModes ? info.modes.availableModes.map((m) => ({ value: m.id, name: m.name })) : [];
      list.replaceChildren(...values.map((v) => { const o = document.createElement("option"); o.value = v.value; if (v.name && v.name !== v.value) o.label = v.name; return o; }));
    }
  }

  const vendorDialog = lifetime.use(VIBEROOM_LOGIN_DIALOG.create(els.loginDialog, {
    window: document.defaultView, signal: lifetime.signal, UI, openDialog, closeDialog, toast, onError: showError,
    readFacts: id => ({ recipe: state.recipes.find(recipe => recipe.id === id), install: vendorFlows.reader.install(id), login: vendorFlows.reader.login(id) }),
    startLogin: startLoginFlow, startInstall: startInstallFlow,
    checkRecipe: value => post('/api/recipes/check', value, { deadline: 3 * 60000 }),
    cancelFlow: id => post(`/api/login/${encodeURIComponent(id)}/cancel`, {}),
    sendAnswer: (id, text) => post(`/api/login/${encodeURIComponent(id)}/input`, { text }),
    openUrl: url => window.open(url, '_blank', 'noopener'), copyText: text => navigator.clipboard.writeText(text),
  }));
  function openLoginDialog(id, purpose) { return vendorDialog.open(id, purpose); }
  function renderLoginDialog(force) { return vendorDialog.render(force); }



  const SETUP_STEPS = VIBEROOM_TELEGRAM_SETUP.steps;

  let telegramSetup = null;
  const setup = { botfatherQr: "", get open() { return !!telegramSetup?.isOpen; } };
  const BOTFATHER_URL = "https://t.me/BotFather";
  const GUIDE_PATH = "/guide.html";

  const guideView = lifetime.use(VIBEROOM_GUIDE_VIEW.create(uiRoot, { window, signal: lifetime.signal, UI, src: GUIDE_PATH, listenKey }));
  function openGuide() {
    guideView.open();
  }
  const voiceGuideView = lifetime.use(VIBEROOM_GUIDE_VIEW.create(uiRoot, { window, signal: lifetime.signal, UI, src: "/voice-guide.html", listenKey }));

  async function loadBotfatherQr() {
    if (setup.botfatherQr) return;
    try {
      const res = await get(`/api/qr?text=${encodeURIComponent(BOTFATHER_URL)}`);
      setup.botfatherQr = res.svg || "";
      renderSetupWizard();
    } catch {
    }
  }

  function isSetupSecretCard(card) { return VIBEROOM_TELEGRAM_SETUP.ownsTokenCard(card); }
  function setupSecretCard() {
    return [...secretCards.values()].find(isSetupSecretCard) || null;
  }

  function setupFacts() {
    const c = state.channels || {};
    const tg = c.telegram || null;
    const card = setupSecretCard();
    const paired = (c.pairings || []).filter((p) => !p.unpairedAt).map((p) => p.name || p.senderId);
    return { tg, machine: c.machine || "this computer", card, paired, link: state.pairLink, now: Date.now(), botfatherQr: setup.botfatherQr, guide: true };
  }

  const pairLinkWords = url => VIBEROOM_TELEGRAM_SETUP.maskLink(url);

  function openSetupWizard(at) { setupController().open(at); }

  function closeSetupWizard() { telegramSetup?.close(); }

  function renderSetupWizard() { telegramSetup?.render(); }

  function setupController() {
    if (telegramSetup) return telegramSetup;
    telegramSetup = lifetime.use(VIBEROOM_TELEGRAM_SETUP.create(els.setupDialog, {
      signal: lifetime.signal, readFacts: setupFacts,
      markupPorts: { UI, esc, ic, scene: name => window.Icons.scene(name), noPeekHtml, geekTip, time },
      openDialog, closeDialog, openGuide, loadQr: loadBotfatherQr,
      requestToken: settingsCommands.requestTelegramToken, answerToken: settingsCommands.answerTelegramToken,
      closeToken: settingsCommands.closeTelegramToken, saveName: name => settingsCommands.saveTelegram({ name }),
      onNameAccepted: lifetime.guard(res => { serviceFacts.acceptChannels(res.channels || state.channels); }),
      makeLink: settingsCommands.makePairLink, discardLink: settingsCommands.cancelPairLink, dropLink: () => dropPairLink(true),
      onLinkAccepted: lifetime.guard(res => { state.pairLink = { url: res.url, expiresAt: res.expiresAt, svg: res.svg || "", copied: false }; }),
      markCopied: url => { if (state.pairLink?.url === url) state.pairLink.copied = true; },
      copyText: text => navigator.clipboard.writeText(text), openBotfather: () => settingsCommands.openTelegramBotfather(),
      toast, onError: showError, onClosed: () => { if (state.view === "settings") renderSettingsPage(); },
    }));
    return telegramSetup;
  }

  const secretCards = new Map();
  const secretCopied = new Set();
  const secretDialog = lifetime.use(VIBEROOM_SECRET_DIALOG.create(els.secretDialog, {
    window: document.defaultView, signal: lifetime.signal, UI, icon: ic, time, pairLinkWords, consentTitle, noPeekHtml, geekTip, keyHelp: KEY_GEEK,
    readCard: openSecretCard, wasCopied: id => secretCopied.has(id), refresh: renderSecretDialog, openDialog, closeDialog, toast, onError: showError,
    decideBudget: (id,value) => post(`/api/private-trial/budget/${encodeURIComponent(id)}`,value),
    revokeBudget: id => post(`/api/private-trial/budget/${encodeURIComponent(id)}/revoke`,{}),
    closeCard: (id,value) => post(`/api/secrets/${encodeURIComponent(id)}/close`,value),
    connectCard: (id,value) => post(`/api/secrets/${encodeURIComponent(id)}/connect`,value),
    consentCard: id => post(`/api/secrets/${encodeURIComponent(id)}/consent`,{}),
    saveKey: (id,value) => post(`/api/secrets/${encodeURIComponent(id)}`,value),
    copyLink: async (id,url) => {await navigator.clipboard.writeText(url);secretCopied.add(id);},
  }));
  function renderSecretDialog() {
    if(state.embedded && !sharedSettings)return;
    const card=openSecretCard();
    if(setup.open && isSetupSecretCard(card)){secretDialog.hide();renderSetupWizard();return;}
    if(!card){
      if(setup.open)renderSetupWizard();
      const wasOpen=els.secretDialog.open;secretDialog.hide();
      if(wasOpen){
        const settled=[...secretCards.values()].filter(r=>r.state!=='open').sort((a,b)=>b.askedAt-a.askedAt)[0];
        if(settled && settled.state==='done')toast(settled.purpose==='trial-budget'?`Graph comparison: ${settled.outcome}.`:settled.purpose==='telegram-pair'?`Phone ${settled.outcome}.`:settled.purpose==='telegram-token'?`Telegram bot ${settled.outcome}.`:settled.purpose==='connection'?`${settled.connection?.name}: ${settled.outcome}.`:settled.purpose==='consent'?`${settled.outcome.charAt(0).toUpperCase()}${settled.outcome.slice(1)}.`:`Saved: ${settled.outcome}.`,'success');
      }
      return;
    }
    secretDialog.render(card,{voiceLabel:(state.voice?.providers||[]).find(provider=>provider.id===card.prefill?.provider)?.label});
  }
  function openSecretCard() {
    return [...secretCards.values()].find((r) => r.state === "open") || null;
  }
  function loadSecretCards(cards) {
    secretCards.clear();
    for (const card of cards || []) secretCards.set(card.id, card);
    renderSecretDialog();
  }


  async function startLoginFlow(recipeId, terminal) {
    const { flow } = await post(`/api/recipes/${encodeURIComponent(recipeId)}/login`, terminal ? { terminal: true } : {});
    vendorFlows.acceptLoginReply(flow);
    renderLoginHosts();
  }
  async function startInstallFlow(recipeId, terminal) {
    const { flow } = await post(`/api/recipes/${encodeURIComponent(recipeId)}/install`, terminal ? { terminal: true } : {});
    vendorFlows.acceptInstallReply(flow);
    renderLoginHosts();
  }
  function renderLoginHosts() {
    if ($("#invite-dialog")?.open) renderInviteLogin();
    if (els.rcDialog.open) renderReconnectLogin();
    if (els.loginDialog.open) renderLoginDialog();
  }
  lifetime.on(uiRoot, "click", (e) => {
    const b = e.target.closest && e.target.closest('[data-act="open-login-dialog"]');
    if (!b) return;
    e.preventDefault();
    openLoginDialog(b.dataset.recipe, b.dataset.purpose || "login");
  });

  const vendorLoggedOut = (p) => p.kind === "agent" && (p.trouble?.kind === "login" || (p.status === "offline" && state.recipes.find((r) => r.id === p.agentType)?.loginState === "missing"));

  function troubleHtml(p) { return VIBEROOM_AGENT_PANEL.troubleRow(p, state.recipes, { UI, esc }); }
  async function troubleAction(room, p, act, btn) {
    if (btn) btn.disabled = true;
    try {
      if (act === "retry") await post(roomApi(`/participants/${encodeURIComponent(p.id)}/retry`));
      else if (act === "respawn" && p.trouble?.stage === "start") await post(roomApi(`/participants/${encodeURIComponent(p.id)}/respawn`), { memory: true, replay: room.settings?.replayAfterRestart ?? 10 });
      else if (act === "respawn") await respawnWith(p, room.settings?.replayAfterRestart ?? 10);
      else if (act === "login") openLoginDialog(p.agentType, "login");
    } finally {
      if (btn) btn.disabled = false;
    }
  }



  const reconnectPrompted = new Set();
  function renderReconnectDefault(room = currentRoom()) {
    const own = room && room.settings ? room.settings.reconnectMode : "inherit";
    const chosen = own === "load" || own === "replay" ? own : (state.settings || {}).reconnectMode;
    return chosen === "load" ? "load" : "replay";
  }
  function reconnectSnapshot(room) {
    return { id: room.id, uuid: room.uuid, createdAt: room.createdAt, name: room.name,
      replay: room.settings.replayAfterRestart ?? 10, defaultMode: renderReconnectDefault(room),
      participants: room.participants.filter(p => p.kind === "agent").map(p => {
        const recipe = state.recipes.find(r => r.id === p.agentType);
        const stuck = p.trouble?.kind === "login" || recipe?.loginState === "missing";
        return { id: p.id, name: p.name, asleep: p.asleep, fell: p.fell, muted: p.muted, status: p.status,
          supportsLoad: p.supportsLoad, sessionId: !!p.sessionId, tagline: p.tagline, agentVendor: p.agentVendor,
          stuck: !!stuck, recipe: recipe ? { id: recipe.id, vendor: recipe.vendor } : null,
          mark: avatar(p, 28, { vendor: true, unplugged: !["idle", "queued", "thinking", "writing", "starting"].includes(p.status) && stuck }),
          wakeWord: wakeWord(p) };
      }) };
  }
  const reconnectDialog = lifetime.use(VIBEROOM_RECONNECT.create(els.rcDialog, {
    window: document.defaultView, signal: lifetime.signal, UI, icon: ic, openDialog, closeDialog,
    saveDefault: async mode => {
      await settingsCommands.saveSettings({ reconnectMode: mode });
      settingsModel.batch(() => {
        if (state.settings) settingsModel.acceptSettings({ ...state.settings, reconnectMode: mode });
        toast(mode === "load" ? "Welcome back will offer the full session first." : "Welcome back will offer the replay first.", "success");
      });
    },
    defaultMode: target => renderReconnectDefault(state.rooms.get(target.id)),
    saveReplay: (room, replay) => roomCommands.forRoom(room).saveSettings({ replayAfterRestart: replay }),
    reconnect: (room, id, value) => roomCommands.forRoom(room).participant(id).reconnect(value),
    onLogin: openLoginDialog, onBack: text => toast(text, "success"), onError: showError,
  }));
  function openReconnectDialog(room, only) {
    const offline = offlineAgents(room, !!only).filter(p => !only || p.id === only.id);
    if (!offline.length) return;
    if (!only) reconnectPrompted.add(room.id);
    return reconnectDialog.open(reconnectSnapshot(room), { offlineIds: offline.map(p => p.id), onlyId: only?.id });
  }
  function refreshReconnectDialog(room) { reconnectDialog.update(reconnectSnapshot(room)); }
  function renderReconnectLogin() {
    const room = currentRoom();
    if (room && els.rcDialog.open) reconnectDialog.update(reconnectSnapshot(room), { loginOnly: true });
  }
  function maybeOfferReconnect() {
    if (state.embedded) return;
    const room = currentRoom();
    if (!room || state.view !== "room" || reconnectPrompted.has(room.id) || els.rcDialog.open || profilePending()) return;
    if (room.startingWithHub) return;
    if (offlineAgents(room).length) openReconnectDialog(room);
  }


  const templatePicker = lifetime.use(VIBEROOM_TEMPLATE_PICKER.create($("#template-dialog"), {
    window: document.defaultView, signal: lifetime.signal, icon: ic,
    getMarkupPorts: () => ({ UI, esc, ic, avatar, fallbackColor: FALLBACK_COLOR(), faceUrl: value => window.Avatars.faceUrl(value),
      recipes: state.recipes.map(recipe => ({ id: recipe.id, vendor: recipe.vendor, unavailable: !!recipe.unavailableReason })) }),
    listTemplates: () => get("/api/templates"), createRoom: roomCommands.createFromTemplate,
    target: product.rooms ? () => product.rooms.target() : undefined,
    openDialog, closeDialog, chooseFolder: openFolderPicker,
    onCreated: result => { if (result.room?.id) roomDirectory.producer.acceptCreated(result.room); for (const notice of result.notices || []) toast(notice, "info"); },
    onSelect: room => { if (shownRoom(room)) selectRoom(room.id); },
  }));
  function openTemplateDialog() {
    if (product.rooms && !product.rooms.target()) {
      if (product.rooms.missing) toast(product.rooms.missing, "info");
      return false;
    }
    return templatePicker.open();
  }

  function renderTemplateForm(t) {
    return VIBEROOM_TEMPLATE_FORM.render(t, { UI, esc, settingRow, settingsCard, selectHtml, numberHtml, avatar, fallbackColor: FALLBACK_COLOR(), readsChoices: READS_OTHER_ROOMS,
      recipes: state.recipes.map(recipe => ({ id: recipe.id, vendor: recipe.vendor, unavailable: !!recipe.unavailableReason })),
    });
  }
  const templateDialog = lifetime.use(VIBEROOM_TEMPLATE_DIALOG.create($("#save-template-dialog"), {
    window: document.defaultView, signal: lifetime.signal, icon: ic,
    renderForm: renderTemplateForm, readForm: VIBEROOM_TEMPLATE_FORM.read,
    previewTemplate: room => roomCommands.forRoom(room).previewTemplate(),
    saveTemplate: (room, value) => roomCommands.forRoom(room).saveTemplate(value),
    openDialog, closeDialog, chooseFolder: openFolderPicker,
    onSaved: result => toast(`Template "${result.template.name}" created. It is first under "Start from a template".`, "success"),
  }));
  function openSaveTemplateDialog(room) {
    const context = roomReader.forRecord(room);
    return context ? templateDialog.open(context) : false;
  }

  const newRoomDialog = lifetime.use(VIBEROOM_ROOM_DIALOG.create(els.roomDialog, {
    window: document.defaultView, signal: lifetime.signal, icon: ic, scene: () => window.Icons.scene("door"),
    getDefaults: () => {
      const defaults = { ...(state.roomDefaults || {}), ...(state.settings?.roomDefaults || {}) };
      return { sharesHistory: defaults.sharesHistory, readsOtherRooms: defaults.readsOtherRooms };
    },
    options: defaults => VIBEROOM_ROOM_DIALOG.optionsMarkup(defaults, { row: settingRow, card: settingsCard,
      select: selectHtml, UI, sharesHint: SHARES_HISTORY_HINT, readsHint: READS_OTHER_ROOMS_HINT, readsChoices: READS_OTHER_ROOMS }),
    createRoom: roomCommands.createRoom, openDialog, closeDialog, chooseFolder: openFolderPicker,
    target: product.rooms ? () => product.rooms.target() : undefined,
    onCreated: result => {
      if (result?.room?.id) roomDirectory.producer.acceptCreated(result.room);
      for (const notice of result?.notices || []) toast(notice, "info");
    },
    onSelect: room => { if (shownRoom(room)) selectRoom(room.id); },
  }));
  function openRoomDialog() {
    const opened = newRoomDialog.open();
    if (!opened && product.rooms?.missing) toast(product.rooms.missing, "info");
    return opened;
  }


  const profilePending = () => !!state.settings && !state.settings.profileCompleted;
  function maybeOfferProfile() {
    if (state.embedded) return;
    splashDone.then(lifetime.guard(offerProfile));
  }
  const lookDialog = lifetime.use(VIBEROOM_LOOK_DIALOG.create($("#look-dialog"), {
    window: document.defaultView, signal: lifetime.signal, UI, icon: ic, openDialog, closeDialog,
    getLooks: () => {
      const requested = (state.settings.appearance || {}).look;
      return { current: TOKENS.looks[requested] ? requested : TOKENS.current.id,
        looks: Object.values(TOKENS.looks).map(look => ({ look, tag: lookTag(look) })) };
    },
    saveLook: look => settingsCommands.saveSettings({ appearance: { look } }),
    onError: error => toast(error.message, "error"),
    onClosed: () => {
      if (!state.freshVibe || state.onboardingOffered) return;
      state.onboardingOffered = true; setView("onboarding"); remember("view", "onboarding");
    },
  }));
  const profileDialog = lifetime.use(VIBEROOM_PROFILE_DIALOG.create(els.pfDialog, {
    window: document.defaultView, signal: lifetime.signal, icon: ic, scene: () => window.Icons.scene("welcome"),
    makePicker: (current, onPick, field, options) => window.Avatars.pickerElement(current, onPick, field, options),
    saveProfile: async value => {
      const first = !(state.settings || {}).profileCompleted;
      if (first) state.freshVibe = true;
      const result = await settingsCommands.saveSettings(value);
      if (result.settings) settingsModel.acceptSettings(result.settings);
      return { first };
    },
    onSaved: (_result, value) => {
      if (state.view === "home") renderHome();
      toast(`Welcome, ${value.humanName}. Open a room and summon a vibemate.`, "info");
    },
    onContinue: () => { if (state.freshVibe) offerLook(); }, openDialog, closeDialog,
  }));
  function offerProfile() {
    if (state.embedded) return;
    const s = state.settings;
    if (!profilePending() || els.pfDialog.open) return;
    return profileDialog.open({ humanName: s.humanName, humanAvatar: s.humanAvatar, humanDescription: s.humanDescription });
  }
  function offerLook() { return lookDialog.open(); }

  const eraseDialog = lifetime.use(VIBEROOM_ERASE_DIALOG.create(els.eraseDialog, {
    window: document.defaultView, signal: lifetime.signal, UI, icon: ic, openDialog, closeDialog,
    eraseProfile: settingsCommands.eraseProfile,
    onErased: () => { try { localStorage.clear(); } catch {} location.href = "/"; },
  }));
  function openEraseDialog() { if (state.embedded) return; return eraseDialog.open(); }


  function renderAll() {
    enterScreen(state.view);
    renderRail();
    if (state.view === "home") {
      renderSideRooms();
      renderHome();
    } else if ((state.view === "rooms" || state.view === "home")) {
      renderSideRooms();
      renderRoomsGrid();
    } else if (state.view === "room") {
      renderSideRoom();
      renderChatHead();
      renderMessages("every view rendered");
    } else if (state.view === "skills") renderSkillsPage();
    else if (state.view === "settings") renderSettingsPage();
    renderDetails();
  }


  const CUSTOM_VARS = [...new Set(TOKENS.adjustables.flatMap((f) => Object.keys(f.vars(f.kind === "scale" ? "1" : TOKENS.current.palette.black))))];
  function customVars(v) {
    const out = {};
    for (const f of TOKENS.adjustables) if (v[f.key]) Object.assign(out, f.vars(v[f.key]));
    return out;
  }
  function applyCustomVars(el, values) {
    for (const name of CUSTOM_VARS) el.style.removeProperty(name);
    for (const [name, value] of Object.entries(customVars(values || {}))) el.style.setProperty(name, value);
  }
  function registerLooks(specs) {
    if (!ownsAppearance) return;
    for (const id of Object.keys(TOKENS.looks)) if (TOKENS.looks[id].custom) delete TOKENS.looks[id];
    for (const spec of specs || []) {
      try {
        TOKENS.looks[spec.id] = TOKENS.make(spec);
      } catch (error) {
        console.warn(`look ${spec.id} could not be built: ${error.message}`);
      }
    }
  }
  let lookRetried = "";
  function verifyLookPainted(look) {
    requestAnimationFrame(() => {
      const want = String(TOKENS.looks[look]?.palette?.primary || "").toLowerCase();
      const got = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim().toLowerCase();
      if (!want || got === want) { lookRetried = ""; return; }
      if (lookRetried === look) {
        console.warn(`look ${look}: the window paints ${got}, the look says ${want}; the stylesheet did not arrive`);
        return;
      }
      lookRetried = look;
      const link = standalone.customLooks;
      if (!link) return;
      domResources.nodeListener(link, "load", () => applyAppearance(), { once: true });
      refreshLooksCss();
    });
  }
  function refreshLooksCss() {
    const link = standalone.customLooks;
    if (link) link.href = `/looks-custom.css?v=${Date.now()}`;
  }
  function lookTag(look) {
    return look.custom ? `${(state.settings && state.settings.humanName) || "Your"}'s look` : undefined;
  }
  function tryLook(id) {
    if (!ownsAppearance) { notifyHost("onNavigate", { view: "settings", category: "appearance" }); return; }
    const root = document.documentElement;
    if (root.dataset.tried === id || !TOKENS.looks[id]) {
      applyAppearance();
      return;
    }
    if (id === TOKENS.current.id) delete root.dataset.look;
    else root.dataset.look = id;
    applyCustomVars(root, (((state.settings || {}).appearance || {}).custom || {})[id] || {});
    root.dataset.tried = id;
    refreshTryButtons();
  }
  function refreshTryButtons() {
    const tried = document.documentElement.dataset.tried || "";
    $$('[data-ui="ask-card"] [data-act="try-look"]').forEach((b) => {
      const label = b.querySelector(".label") || b;
      label.textContent = tried === b.dataset.look ? "Back" : "Try it on";
    });
  }
  const UI_SCALE_CAP = 1.35;
  let appliedScheme = null;
  function applyAppearance() {
    if (!ownsAppearance) return;
    const a = (state.settings || {}).appearance || {};
    const root = document.documentElement;
    delete root.dataset.tried;
    const scale = (a.chatFontSize || 14.5) / 14.5;
    root.style.setProperty("--chat-fs", String(scale));
    root.style.setProperty("--fs-scale", String(Math.min(scale, UI_SCALE_CAP)));
    const zoom = UI_ZOOM_BASE * ((a.scale || 100) / 100);
    root.style.setProperty("--ui-scale", String(zoom));
    if (Layout.scale !== zoom) Layout = VIBEROOM_LAYOUT.create(zoom);
    const look = TOKENS.looks[a.look] ? a.look : TOKENS.current.id;
    if (look === TOKENS.current.id) delete root.dataset.look;
    else root.dataset.look = look;
    root.classList.toggle("more-on-click", (state.settings || {}).showMoreOnClick !== false);
    if (TOKENS.looks[look].custom) verifyLookPainted(look);
    const scheme = TOKENS.looks[look].scheme;
    if (appliedScheme && appliedScheme !== scheme) {
      $$(".mermaid-block[data-rendered]").forEach((b) => delete b.dataset.rendered);
      renderDiagrams(uiRoot);
    }
    appliedScheme = scheme;
    if (look !== TOKENS.current.id && (!a.font || a.font === "nunito")) root.style.removeProperty("--font");
    else root.style.setProperty("--font", (FONTS.text[a.font] || FONTS.text.nunito).stack);
    root.style.setProperty("--mono", (FONTS.mono[a.mono] || FONTS.mono["jetbrains-mono"]).stack);
    const frame = document.querySelector('meta[name="theme-color"]');
    if (frame) frame.content = TOKENS.looks[look].elements.browser.themeColor;
    applyCustomVars(root, (a.custom || {})[look] || {});
    contextRing.reshape($$("#participants .avatar .life"));
    refreshTryButtons();
  }

  let hubIdentity = null;
  function loadSnapshot(snapshot) {
    settingsModel.batch(() => applySnapshot(snapshot));
  }
  function applySnapshot(snapshot) {
    const v = snapshot.version;
    const identity = v && v.build ? `${v.version} ${v.build} ${v.pid ?? ""}` : null;
    if (identity && hubIdentity && identity !== hubIdentity) {
      if (state.embedded) { notifyHost("onReload", { reason: "hub-changed", version: v }); return; }
      if (shellLeadsConnection()) {
        if (stream) { const ws = stream; stream = null; ws.close(); }
        els.conn.classList.remove("ok");
        if (!downSince) downSince = Date.now();
        renderGonePop();
        awaitShell();
        return;
      }
      location.reload();
      return;
    }
    if (identity) hubIdentity = identity;
    const previousRooms = state.rooms;
    const previousSettings = state.settings;
    const previousReader = previousRooms.get(state.currentRoomId)?.history && state.view === "room" && !stuck ? readerAnchor() : null;
    settingsModel.acceptSnapshot({ settings: snapshot.settings || {}, roomDefaults: snapshot.roomDefaults || null, looks: snapshot.looks || [] });
    showAttention();
    hubStatus.acceptAutomations(snapshot.automationPending || {}, snapshot.automationJobs || 0);
    registerLooks(state.looks);
    applyAppearance();
    hubStatus.acceptUpdate(snapshot.update || null);
    renderUpdatePop();
    hubStatus.acceptRestart(snapshot.restart || null);
    renderRestartPop();
    hubStatus.acceptVersion(snapshot.version || null);
    noteHubRun();
    serviceFacts.acceptSkills(snapshot.skills || []);
    serviceFacts.acceptRecipes(snapshot.recipes || []);
    if (!state.embedded || sharedSettings) {
      agentUpdates.setView(snapshot.agentUpdates || null);
      for (const flow of snapshot.logins || []) agentUpdates.setFlow(flow);
    }
    vendorFlows.acceptSnapshot(snapshot.logins || []);
    serviceFacts.acceptChannels(snapshot.channels || null);
    serviceFacts.acceptConnections(snapshot.connections || [], snapshot.connectionStorageProblem || null);
    serviceFacts.acceptVoice(snapshot.voice || null);
    serviceFacts.acceptMemoryProvider(snapshot.memoryProvider || state.memoryProvider);
    hubStatus.acceptAutostart(snapshot.autostart || null);
    hubStatus.acceptInstallation(snapshot.installation || null);
    hubStatus.acceptKeepAwake(snapshot.keepAwake || null);
    hubStatus.acceptDataFolder(snapshot.dataFolder || null);
    hubStatus.acceptPerMessage(snapshot.perMessage || null);
    pictureStatus.acceptSnapshot(snapshot.pictures || []);
    featuresChanged({ page: false });
    roomDirectory.producer.acceptSnapshot(snapshot.rooms || []);
    for (const previous of previousRooms.values()) resetMessageViews(previous);
    for (const room of state.rooms.values()) {
      roomFacts.producer.acceptRosterSnapshot(room, room.history?.streamSequence ?? -1);
      const previous = previousRooms.get(room.id);
      const before = previous && (previous.settings?.foldAfter ?? previousSettings?.foldAfter ?? FOLD_SHOWN);
      const after = room.settings?.foldAfter ?? state.settings?.foldAfter ?? FOLD_SHOWN;
      if (previous && before !== after) {
        foldAnchor.delete(room.id);
        if (listRoomId === room.id) listRoomId = null;
      }
      if (previous && room.history?.version) {
        const retained = conversationState.retainSnapshot(previous, room);
        if (!retained) {
          const anchor = foldAnchor.get(room.id);
          const first = (anchor?.id && previous.messages.find(m => m.id === anchor.id)) || previous.messages[0];
          const from = first && cursorOf(first);
          if (before === after && remoteHidden(room) && (anchor?.all || (from && room.history.oldest && HistoryWindow.compareCursor(from, room.history.oldest) < 0))) {
            room.restoreFrom = { all: !!anchor?.all, from, reader: room.id === state.currentRoomId ? previousReader : null };
          } else if (listRoomId === room.id) listRoomId = null;
        }
      }
    }
    state.openRooms = [...(snapshot.openRooms || [])];
    if (state.embedded) {
      snapshotSeen = true;
      showAttention();
      if (navigation?.applied) {
        try { targetRoom(navigation); setView("room"); renderDetails(); roomRendered(); }
        catch (error) { navigation?.reject(error); navigation = null; failReady(error); hideUnavailableRoom(); }
      }
      else if (navigation) void navigate();
      else if (sharedSettings && state.view === "settings") setView("settings");
      else if (standalone.applicationHost && state.view === "host") setView("host");
      else if (currentRoom()) { setView("room"); renderDetails(); }
      else hideUnavailableRoom();
      return;
    }
    const params = new URLSearchParams(location.search);
    const wanted = params.get("room");
    const remembered = recall("room");
    let openRoom = false;
    if (wanted && state.rooms.has(wanted)) {
      state.currentRoomId = wanted;
      openRoom = true;
    } else if (!state.rooms.has(state.currentRoomId)) {
      state.currentRoomId = state.rooms.has(remembered) ? remembered : null;
      openRoom = !!state.currentRoomId && recall("view") === "room";
    } else openRoom = state.view === "room";
    if (state.currentRoomId && draftRoomId !== state.currentRoomId) bringDraft(state.currentRoomId);
    const participant = params.get("participant");
    if (participant && currentRoom() && findById(currentRoom(), participant)) {
      state.selection = { kind: "participant", id: participant };
      state.detailsOpen = true;
      els.details.hidden = false;
    }
    if (params.get("setup") === "telegram") {
      const step = params.get("step");
      history.replaceState(null, "", location.pathname);
      openSettings("channels");
      requestAnimationFrame(() => openSetupWizard(step && SETUP_STEPS.includes(step) ? step : "next"));
      renderDetails();
      maybeOfferProfile();
      standaloneSnapshotReady();
      return;
    }
    setView(openRoom && state.currentRoomId && (wanted || state.view === "room") ? "room" : state.view === "room" ? "rooms" : state.view);
    renderDetails();
    maybeOfferProfile();
    maybeOfferReconnect();
    standaloneSnapshotReady();
    const held = recall(HELD_LIVE);
    if (held) {
      forget(HELD_LIVE);
      try {
        reportHeldTurns(JSON.parse(held));
      } catch {
      }
    }
  }

  function standaloneSnapshotReady() {
    snapshotSeen = true;
    if (!readySettled) { readySettled = true; resolveReady(); }
  }

  function showMessageDelivery(room, message, showing) {
    if (!showing) return;
    const el = els.messages.querySelector(`.msg[data-id="${CSS.escape(message.id)}"]`);
    if (el) { fillSeen(el, room, message); renderWaiting(el, room, message); }
  }

  function onRoomEvent(roomId, event) {
    const room = state.rooms.get(roomId);
    if (!room) return;
    if (!conversationState.acceptEventMetadata(room, event)) return;
    const current = roomId === state.currentRoomId;
    const showing = current && state.view === "room";
    switch (event.type) {
      case "participant": {
        if (!roomFacts.producer.participantEventAllowed(room, event)) return;
        const before = showing ? visibilityFingerprint(room) : "";
        const accepted = roomFacts.producer.acceptParticipant(room, event);
        if (!accepted) return;
        const { previous, participant, channelChanged } = accepted;
        quietChanged(room);
        if (showing && previous && previous.name !== participant.name) refreshNowNames(room, participant);
        if (showing) {
          if (visibilityFingerprint(room) !== before) {
            renderMessagesSoon(`what ${participant.name} has seen moved`);
          }
          else refreshSeen(room);
          if (channelChanged) refreshStartingLines(room);
          renderSideRoom();
          renderChatHead();
          if (state.detailsOpen && state.selection.kind === "room") refreshFolderPending(room);
          if (els.rcDialog.open) refreshReconnectDialog(room);
          if (state.detailsOpen && state.selection.kind === "participant" && state.selection.id === participant.id) {
            if (!editingInDetails()) renderDetails();
            else {
              refreshDetailsHeader(participant);
              const config = p => JSON.stringify([p?.mode, p?.configOptions, p?.pendingSettings, p?.status === "starting", !!p?.installOutdated, p?.status === "thinking" && !!p?.installOutdated]);
              if (config(previous) !== config(participant)) {
                const panel = $("#pp-config");
                if (panel) renderConfig(panel, participant, ["offline", "left"].includes(participant.status));
              }
            }
          }
        }
        renderOverviewSoon();
        return;
      }
      case "participant.removed":
        if (!roomFacts.producer.removeParticipant(room, event)) return;
        quietChanged(room);
        if (state.selection.kind === "participant" && state.selection.id === event.id) closeDetails();
        if (showing) {
          renderMessages("a vibemate left");
          renderSideRoom();
          renderChatHead();
        }
        renderOverviewSoon();
        return;
      case "message":
        upsertMessage(roomId, event.message);
        trimBodyCache(room);
        return;
      case "message.delivery":
        conversationState.acceptDelivery(room, event.updates, showing);
        return;
      case "message.removed":
        removeMessage(roomId, event.id);
        forgetGoneEditors(room);
        return;
      case "record.replaced":
        messagePreviews.clear(roomRecordKey(room));
        historyReconciliation.invalidateRange(room);
        void refreshHeld(roomId);
        return;
      case "messages.truncated":
        historyReconciliation.invalidateRange(room);
        if (!conversationState.truncate(room, event.fromSeq)) return;
        forgetGoneEditors(room);
        if (foldAnchor.get(roomId)?.id && !room.messages.some(m => m.id === foldAnchor.get(roomId).id)) foldAnchor.delete(roomId);
        if (!roomFacts.producer.retainPermissions(room, room.messages.filter(m => m.streaming).map(m => m.from))) return;
        if (room.history?.version) {
          if (showing) for (const el of els.messages.querySelectorAll(".msg[data-seq]")) if (Number(el.dataset.seq) > event.fromSeq) el.remove();
          void refreshHeld(roomId);
          return;
        }
        if (showing) renderMessages("the history was rewritten");
        return;
      case "chunk":
        patchMessage(roomId, event, "text");
        return;
      case "thought":
        patchMessage(roomId, event, "thought");
        return;
      case "toolcall":
        patchMessage(roomId, event, "tools", event.toolCall.toolCallId);
        return;
      case "plan":
        patchMessage(roomId, event, "plan");
        return;
      case "permission": {
        const permission = roomFacts.producer.acceptPermission(room, event.permission);
        if (!permission) return;
        if (showing) renderPermission(room, permission);
        else toast(`${(findById(room, permission.participantId) || {}).name || "A vibemate"} in "${room.name}" asks for permission.`, "warn");
        knockAsked(room, permission);
        if (roomId === state.currentRoomId) renderSideRoom();
        return;
      }
      case "permission.resolved":
        if (!roomFacts.producer.resolvePermission(room, event.key)) return;
        if (showing) resolvePermissionCard(event.key, event.optionId);
        if (roomId === state.currentRoomId) renderSideRoom();
        return;
      case "proposal": {
        const proposal = roomFacts.producer.acceptProposal(room, event.proposal);
        if (!proposal) return;
        if (showing) renderProposal(room, proposal);
        else toast(`${esc(proposal.participantName)} proposes changes to "${room.name}".`, "warn");
        return;
      }
      case "new-room": {
        const proposal = roomFacts.producer.acceptNewRoom(room, event.proposal);
        if (!proposal) return;
        if (showing) renderNewRoom(room, proposal);
        else toast(`${esc(proposal.participantName)} proposes a new room from "${room.name}".`, "warn");
        return;
      }
      case "new-room.resolved": {
        const asked = roomFacts.producer.resolveNewRoom(room, event.key, event.status, event.roomId);
        if (showing && asked) renderNewRoom(room, asked);
        return;
      }
      case "recovery":
        applyRecoveryAnswer(room.id, event.recovery);
        return;
      case "proposal.resolved": {
        const p = roomFacts.producer.resolveProposal(room, event.key, event.status, event.skipped);
        if (showing) resolveProposalCard(room, p);
        return;
      }
      case "room": {
        const foldBefore = room.settings ? room.settings.foldAfter : null;
        const panelBefore = roomPanelState(room);
        if (!roomFacts.producer.acceptLimitsAndSettings(room, event)) return;
        if ((event.settings ? event.settings.foldAfter : null) !== foldBefore) foldSettingChanged(room.id);
        if (lifetime.disposed || state.rooms.get(roomId) !== room) return;
        showRoomValues(room);
        if (!roomFacts.producer.acceptHeader(room, event)) return;
        quietChanged(room);
        if (showing) {
          renderSideRoom();
          renderChatHead();
          if (state.detailsOpen && state.selection.kind === "room" && roomPanelState(room) !== panelBefore) {
            if (!editingInDetails()) renderDetails();
            else refreshRoomHeader(room);
          }
        }
        renderOverviewSoon();
        return;
      }
      case "notice":
        if (current) toast(event.text, event.level);
        return;
      default:
        return;
    }
  }

  const HUB_EVENTS = {
    autostart: m => {
      hubStatus.acceptAutostart(m.autostart);
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
    },
    "keep-awake": m => {
      hubStatus.acceptKeepAwake(m.keepAwake);
      const line = byId("sp-keep-awake-status");
      if (!line) return;
      line.textContent = keepAwakeStatusText();
      if (keepAwakeTone() === "warn") line.dataset.tone = "warn";
      else delete line.dataset.tone;
    },
    automations: m => {
      hubStatus.acceptAutomations(m.pending || {}, m.jobs || 0);
      renderAutomationBadge();
      markOnboardingCards();
      void window.ViberoomAutomations.refresh();
    },
    snapshot: (m) => {
      loadSnapshot(m.snapshot);
      loadSecretCards(m.snapshot.secrets);
      splashReady();
    },
    "room.event": (m) => onRoomEvent(m.roomId, m.event),
    picture: (m) => {
      pictureStatus.acceptChange(m.room, m.file, m.state);
      refreshPictureMarks(m.room, m.file);
    },
    restart: (m) => {
      hubStatus.acceptRestartPending(m.restart);
      renderRestartPop();
      if (state.view === "settings") renderSettingsPage();
    },
    recipes: (m) => {
      serviceFacts.acceptRecipes(m.recipes || []);
      if ($("#invite-dialog")?.open) renderInviteTiles();
      if (els.rcDialog.open) renderReconnectLogin();
      if (els.loginDialog.open) renderLoginDialog();
      if (state.view === "room") renderSideRoom();
    },
    login: (m) => {
      if (m.flow.purpose === "update") { if (!state.embedded || sharedSettings) agentUpdates.setFlow(m.flow); return; }
      vendorFlows.acceptEvent(m.flow);
      renderLoginHosts();
      if ($("#invite-dialog")?.open) renderInviteTiles();
    },
    secret: (m) => {
      secretCards.set(m.request.id, m.request);
      renderSecretDialog();
      const r = m.request;
      if (r.state !== "open" && (r.purpose === "consent" || r.purpose === "voice-key" || r.purpose === "memory-zep-key" || r.purpose === "memory-sieve-key")) void refreshFeatureViews();
    },
    "room.created": (m) => {
      roomDirectory.producer.acceptCreated(m.room);
      renderOverviewSoon();
      markOnboardingCards();
    },
    "rooms.opened": (m) => {
      state.openRooms = m.roomIds || [];
      renderRail();
    },
    "room.removed": (m) => {
      const { roomId } = m;
      const previous = state.rooms.get(roomId);
      roomDirectory.producer.remove(roomId);
      if (previous) resetMessageViews(previous);
      if (state.embedded) showAttention();
      if (state.embedded && navigation?.roomId === roomId) {
        const error = Object.assign(new Error("This room is not available."), { code: "room_missing" });
        navigation.reject(error); navigation = null; failReady(error);
      }
      Drafts.remove(localStorage, roomId);
      draftComposers.delete(roomId);
      if (draftRoomId === roomId) draftRoomId = null;
      state.openRooms = state.openRooms.filter((id) => id !== roomId);
      if (state.currentRoomId === roomId) {
        state.currentRoomId = null;
        state.selection = { kind: "room" };
        closeDetails();
        if (state.embedded) hideUnavailableRoom();
        setView("rooms");
      }
      renderOverviewSoon();
      markOnboardingCards();
    },
    skills: (m) => {
      serviceFacts.acceptSkills(m.skills || []);
      if (state.view === "skills" && !editingInDetails()) renderSkillsPage();
      if (state.detailsOpen && !editingInDetails()) renderDetails();
    },
    looks: (m) => settingsModel.batch(() => {
      settingsModel.acceptLooks(m.looks || []);
      registerLooks(state.looks);
      refreshLooksCss();
      applyAppearance();
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
    }),
    settings: (m) => settingsModel.batch(() => {
      const foldBefore = state.settings ? state.settings.foldAfter : null;
      settingsModel.acceptSettings(m.settings || {});
      showAttention();
      if ((m.settings ? m.settings.foldAfter : null) !== foldBefore) foldSettingChanged(null);
      applyAppearance();
      if (devBuild()) for (const el of els.messages.querySelectorAll(".msg.agent")) placeDevPrompt(el);
      if (devBuild()) for (const el of els.messages.querySelectorAll(".msg[data-id]")) placeDevMemoryIngestion(el);
      rerenderDiagrams();
      renderRail();
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
      if (state.view === "me" && !editingInDetails()) renderMePage();
      if (state.view === "room") renderSideRoom();
      markOnboardingCards();
    }),
    update: (m) => {
      hubStatus.acceptUpdate(m.update);
      renderUpdatePop();
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
    },
    "agent.updates": (m) => { if (!state.embedded || sharedSettings) agentUpdates.setView(m.updates); },
    connections: (m) => {
      serviceFacts.acceptConnections(m.connections || [], m.storageProblem || null);
      if (state.view === "connections") renderConnectionsPage();
      else if (state.view === "home") renderHome();
      markOnboardingCards();
    },
    channels: (m) => {
      serviceFacts.acceptChannels(m.channels || null);
      if (state.pairLink && !(m.channels && m.channels.pairLinkUntil)) dropPairLink(false);
      if (state.view === "settings" && !editingInDetails()) renderSettingsPage();
      if (setup.open) renderSetupWizard();
      markOnboardingCards();
    },
    reset: () => { if (state.embedded) notifyHost("onReload", { reason: "reset" }); else location.href = "/"; },
  };
  const HELD_LIVE = "heldLive";
  function heldTurnsNow() {
    const rooms = new Map();
    const note = (roomId, id, how) => {
      if (!roomId || !id) return;
      const room = state.rooms.get(roomId);
      const entry = rooms.get(roomId) || { roomId, lastStreamSequence: (room && room.history && room.history.streamSequence) ?? -1, ids: new Map() };
      entry.ids.set(id, { ...(entry.ids.get(id) || {}), ...how });
      rooms.set(roomId, entry);
    };
    for (const [roomId, room] of state.rooms) {
      for (const m of room.messages || []) if (m.streaming && m.from !== "human") note(roomId, m.id, { model: true });
    }
    for (const stop of $$('.live-tail [data-act="stop"]')) {
      const bubble = stop.closest(".msg");
      if (bubble && bubble.dataset.id) note(state.currentRoomId, bubble.dataset.id, { onScreen: true });
    }
    return [...rooms.values()].map((room) => ({ roomId: room.roomId, lastStreamSequence: room.lastStreamSequence, ids: [...room.ids].map(([id, how]) => ({ id, ...how })) }));
  }
  function rememberHeldTurns() {
    if (!stream) return void forget(HELD_LIVE);
    const rooms = heldTurnsNow();
    if (rooms.length) remember(HELD_LIVE, JSON.stringify({ at: Date.now(), rooms }));
    else forget(HELD_LIVE);
  }
  function reportHeldTurns(record) {
    for (const room of record.rooms || []) {
      const fresh = state.rooms.get(room.roomId);
      if (!fresh) continue;
      for (const held of room.ids || []) {
        const message = (fresh.messages || []).find((m) => m.id === held.id);
        if (!message || message.streaming) continue;
        void post("/api/window/finding", {
          roomId: room.roomId,
          messageId: held.id,
          heldSince: record.at,
          lastStreamSequence: room.lastStreamSequence,
          heldBy: held.model ? (held.onScreen ? "both" : "record") : "screen",
          afterReload: true,
        }).catch(() => {});
      }
    }
  }
  let stream = null;
  let releaseTimer = null;
  let retryTimer = null;
  let retryDelay = 1000;
  const SPLASH_LONGEST_MS = 6000;
  const splash = byId("splash");
  let splashLeft = () => {};
  const splashDone = splash ? new Promise(resolve => {
    let settled = false, release = () => {};
    splashLeft = () => { if (settled) return; settled = true; release(); resolve(); };
    release = lifetime.own(splashLeft);
  }) : Promise.resolve();
  splashDone.then(lifetime.guard(() => uiRoot.classList.add("arrived")));
  function splashGone() {
    if (lifetime.disposed || !splash || splash.classList.contains("gone")) return;
    splash.classList.add("gone");
    splashLeft();
    lifetime.timeout(() => splash.remove(), 400);
  }
  function splashReady() {
    if (lifetime.disposed) return;
    const arriving = splash?.getAnimations({ subtree: true }).filter((a) => a.playState !== "finished") ?? [];
    if (!arriving.length) return splashGone();
    lifetime.wait(Promise.all(arriving.map((a) => a.finished.catch(() => {})))).then(lifetime.guard(splashGone), error => { if (!lifetime.disposed) showError(error); });
  }
  if (splash) lifetime.timeout(splashGone, SPLASH_LONGEST_MS);

  let keyless = false;
  const keylessAnswer = (answer) => !!answer && answer.keyed === false;
  async function askKey() {
    let answer = null;
    try {
      answer = await net.read(await net.request("/api/version", { deadlineMs: 4000 }), "json");
    } catch {
      return;
    }
    if (net.signal.aborted || keyless || !keylessAnswer(answer)) return;
    keyless = true;
    if (state.embedded) {
      const error = Object.assign(new Error("This window has no key for the room."), { code: "no_key" });
      navigation?.reject(error); navigation = null; failReady(error);
    }
    clearTimeout(retryTimer);
    if (stream) { const ws = stream; stream = null; ws.close(); }
    els.noKey.hidden = false;
    uiRoot.classList.add("keyless");
    splashGone();
  }
  const shellLeadsConnection = () => !state.embedded && !!window.ViberoomDesktop?.can("connection-led-by-shell");
  function awaitShell(again = false) {
    if (state.embedded) return;
    if (net.signal.aborted) return;
    if (state.awaitingShell && !again) return;
    state.awaitingShell = true;
    window.postMessage({ viberoomConnection: "lost" }, location.origin);
  }
  function connect() {
    if (net.signal.aborted) return;
    if (keyless) return;
    if (stream) return;
    clearTimeout(retryTimer);
    const ws = net.socket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`, {
      open: () => {
        if (stream !== ws) return;
        state.awaitingShell = false;
        retryDelay = 1000;
        downSince = 0;
        els.conn.classList.add("ok");
        renderGonePop();
      },
      message: (e) => {
        if (stream !== ws) return;
        const m = JSON.parse(e.data);
        const handle = HUB_EVENTS[m.type];
        if (!handle) return;
        const started = performance.now();
        handle(m);
        if (net.signal.aborted) return;
        noteBurst(m.type, performance.now() - started);
      },
      error: () => { if (stream === ws) els.conn.classList.remove("ok"); },
      close: () => {
        if (stream !== ws) return;
        els.conn.classList.remove("ok");
        stream = null;
        if (!downSince) downSince = Date.now();
        renderGonePop();
        if (shellLeadsConnection()) return void awaitShell();
        void askKey();
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 10000);
      },
    });
    stream = ws;
  }
  function releaseStream() {
    if (net.signal.aborted) return;
    if (!stream) return;
    const ws = stream;
    stream = null;
    ws.close();
    downSince = 0;
    renderGonePop();
    els.conn.classList.remove("ok");
    els.conn.title = "Paused while this tab is in the background; resumes when you come back";
  }
  const connLabel = $("#conn-label");


  let downSince = 0;

  lifetime.own(() => { stream = null; clearTimeout(retryTimer); clearTimeout(releaseTimer); });
  function renderGonePop() { runtimeNotices.connection(); }

  function checkAgain() {
    if (net.signal.aborted) return;
    if (shellLeadsConnection()) return void awaitShell(true);
    retryDelay = 1000;
    resyncStream();
  }

  function resyncStream() {
    if (net.signal.aborted) return;
    if (!stream && shellLeadsConnection()) return void awaitShell();
    releaseStream();
    els.conn.title = "Connection to the room";
    connect();
  }
  function followVisibility() {
    if (net.signal.aborted) return;
    clearTimeout(releaseTimer);
    if (shellLeadsConnection()) return;
    if (document.hidden) releaseTimer = setTimeout(releaseStream, 15000);
    else {
      els.conn.title = "Connection to the room";
      connect();
    }
  }
  lifetime.on(document, "visibilitychange", followVisibility);


  const composerSizing = lifetime.use(VIBEROOM_COMPOSER_SIZING.create({
    app: els.app, input: els.input, composer: els.composer, grip: $("#composer-grip"),
  }, {
    window, signal: lifetime.signal, layout: () => Layout,
    readHeight: () => recall("composerH"), writeHeight: height => remember("composerH", height),
    onManualChange: () => { composerShiftBefore = null; },
  }));
  function autosizeSoon() { composerSizing.soon(); }
  function autosize() { composerSizing.size(); }

  let composerShiftQueued = false, composerShiftBefore = null;
  function watchComposerShift() {
    if (!els.messages || composerShiftQueued) return;
    composerShiftQueued = true;
    requestAnimationFrame(() => {
      composerShiftQueued = false;
      const list = els.messages;
      if (!list || state.view !== "room") { composerShiftBefore = null; return; }
      const now = { roomId: state.currentRoomId, top: list.scrollTop, view: list.clientHeight };
      const before = composerShiftBefore;
      composerShiftBefore = now;
      if (!before || before.roomId !== now.roomId || before.view === now.view) return;
      const moved = Math.round(now.top - before.top);
      if (!moved) return;
      const grew = Math.round(now.view - before.view);
      const room = Math.round(list.scrollHeight - now.view);
      noteFinding(`the field changed height: the list ${grew >= 0 ? "grew" : "shrank"} by ${Math.abs(grew)} px and the reader moved ${moved} px (${Math.round(before.top)} → ${Math.round(now.top)} of ${room}${before.top >= room - grew - 2 ? ", from the very bottom" : ""})`);
    });
  }
  function invalidateComposerBounds() { composerSizing.invalidate(); }
  lifetime.on(els.messages, "scroll", () => { composerShiftBefore = null; }, { passive: true });
  autosize();
  watchComposerShift();

  const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const perMessage = (kind) => state.perMessage?.[kind] ?? Infinity;
  let pendingShots = [];
  let shotSeq = 0;
  const shotMarker = (n) => `[img ${n}]`;

  const TIMED_KINDS = {
    audio: { noun: "sound", icon: "mic", types: ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/flac"], player: () => new Audio() },
    video: { noun: "video", icon: "video", types: ["video/mp4", "video/webm", "video/ogg", "video/quicktime"], player: () => document.createElement("video") },
  };
  const timedDraft = Object.fromEntries(Object.keys(TIMED_KINDS).map((kind) => [kind, { pending: [], detached: [], seq: 0 }]));
  const timedMarker = (kind, n) => `[${kind} ${n}]`;
  const soundType = (type) => String(type || "").split(";")[0].trim().toLowerCase();
  const timedKindOf = (type) => Object.keys(TIMED_KINDS).find((kind) => TIMED_KINDS[kind].types.includes(soundType(type))) || null;
  const timedCount = () => Object.values(timedDraft).reduce((n, draft) => n + draft.pending.length, 0);
  const soundLength = (seconds) => (seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : "");
  function addTimed(kind, item) {
    if (lifetime.disposed) { revokeObjectUrl(item.url); return; }
    const spec = TIMED_KINDS[kind], draft = timedDraft[kind];
    if (draft.pending.length >= perMessage(kind)) {
      revokeObjectUrl(item.url);
      return void showError(new Error(`up to ${perMessage(kind)} ${spec.noun}s per message`));
    }
    item.n = ++draft.seq;
    draft.pending.push(item);
    renderShotsTray();
    insertMarker(timedMarker(kind, item.n));
    return true;
  }

  const LARGE_FILE_BYTES = 100 * 1024 * 1024;
  const sizeWords = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 / 1024)} MB`);
  async function mayCopy(file) {
    if (file.size <= LARGE_FILE_BYTES) return true;
    return confirmDialog(`${file.name || "This file"} is ${sizeWords(file.size)}. It will be copied into this room's folder, and the room keeps it there.`, { title: "A large file", okLabel: `Copy ${sizeWords(file.size)} into the room` });
  }
  function sendToRoom(item, blob, as) {
    if (net.signal.aborted) return;
    const room = currentRoom();
    item.progress = 0;
    item.upload = uploadFile(room.id, blob, { as, name: item.name, type: item.mimeType }, (percent) => { item.progress = percent; renderShotsTray(); })
      .then((stored) => { net.signal.throwIfAborted(); item.stored = stored; renderShotsTray(); return stored; }, (error) => { if (!net.signal.aborted) { item.failed = error.message || String(error); renderShotsTray(); } throw error; });
    item.upload.catch(() => {});
  }
  async function addTimedFiles(kind, files) {
    const room = currentRoom();
    const active = () => !lifetime.disposed && currentRoom() === room && state.rooms.get(room.id) === room;
    if (!room || !active()) return;
    const spec = TIMED_KINDS[kind];
    for (const file of files) {
      if (!active()) return;
      const allowed = await mayCopy(file);
      if (!active()) return;
      if (!allowed) continue;
      const probe = spec.player();
      const url = createObjectUrl(file);
      let settled = false;
      const finish = (seconds, cancelled = false) => {
        if (settled) return;
        settled = true;
        metadataProbes.delete(cancel);
        probe.removeEventListener("loadedmetadata", loaded);
        probe.removeEventListener("error", failed);
        try { probe.removeAttribute("src"); probe.load(); } catch {}
        if (cancelled || !active()) { revokeObjectUrl(url); return; }
        const item = { name: file.name || spec.noun, mimeType: soundType(file.type), url, ...(Number.isFinite(seconds) && seconds > 0 ? { seconds: Math.round(seconds * 10) / 10 } : {}) };
        if (addTimed(kind, item)) sendToRoom(item, file, kind);
      };
      const loaded = () => finish(probe.duration), failed = () => finish(NaN), cancel = () => finish(NaN, true);
      metadataProbes.add(cancel);
      probe.addEventListener("loadedmetadata", loaded);
      probe.addEventListener("error", failed);
      probe.preload = "metadata";
      probe.src = url;
    }
  }

  const composerClear = $("#composer-clear");
  function updateComposerClear() {
    const hidden = !(composer.value.trim() || pendingShots.length || timedCount() || pendingQuotes.length);
    if (composerClear.hidden !== hidden) composerClear.hidden = hidden;
    keepDraftSoon();
  }
  function composerChanged() {
    updateComposerClear();
    autosizeSoon();
    watchComposerShift();
  }
  lifetime.on(composerClear, "click", () => {
    composer.value = "";
    composer.focus();
  });
  function renderShotsTray() { updateComposerClear(); attachmentTrays.renderMedia(); }

  function clearShots(keep = []) {
    for (const draft of Object.values(timedDraft)) {
      for (const item of [...draft.pending, ...draft.detached]) if (item.url && !keep.includes(item)) revokeObjectUrl(item.url);
      draft.pending = [];
      draft.detached = [];
      draft.seq = 0;
    }
    for (const shot of [...pendingShots, ...detachedShots]) if (shot.url && !keep.includes(shot)) revokeObjectUrl(shot.url);
    pendingShots = [];
    detachedShots = [];
    shotSeq = 0;
    renderShotsTray();
  }

  let detachedShots = [];
  let detachedQuotes = [];
  function reconcileAttachments(text) {
    const named = new Set(Composer.markersIn(text).map((m) => `${m.kind} ${m.n}`));
    const split = (live, waiting, kind) => {
      const all = [...live, ...waiting].sort((a, b) => a.n - b.n);
      return [all.filter((x) => named.has(`${kind} ${x.n}`)), all.filter((x) => !named.has(`${kind} ${x.n}`))];
    };
    const [shots, shotsAway] = split(pendingShots, detachedShots, "img");
    const [quotes, quotesAway] = split(pendingQuotes, detachedQuotes, "quote");
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    let shotsMoved = !same(shots, pendingShots);
    for (const [kind, draft] of Object.entries(timedDraft)) {
      const [live, away] = split(draft.pending, draft.detached, kind);
      if (!same(live, draft.pending)) shotsMoved = true;
      draft.pending = live;
      draft.detached = away;
    }
    const quotesMoved = !same(quotes, pendingQuotes);
    pendingShots = shots; detachedShots = shotsAway;
    pendingQuotes = quotes; detachedQuotes = quotesAway;
    if (shotsMoved) renderShotsTray();
    if (quotesMoved) renderQuotesTray();
  }
  function composerToken(kind, n) {
    return VIBEROOM_ATTACHMENT_TRAYS.token(kind, n, { images: pendingShots, quotes: pendingQuotes, timed: timedDraft }, {
      icon: ic, kinds: TIMED_KINDS, length: soundLength,
    });
  }
  function composerMention(name) {
    const room = currentRoom();
    if (!room) return null;
    if (name.toLowerCase() === "all") return { color: "" };
    const p = findByName(room, name);
    return p && p.kind === "agent" ? { color: colourOf(p) } : null;
  }

  function insertMarker(text) {
    const value = composer.value;
    const start = composer.selectionStart ?? value.length;
    const end = composer.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const tail = /^\s/.test(after) ? "" : " ";
    const marker = `${lead}${text}${tail}`;
    const caret = start + marker.length + (tail ? 0 : 1);
    composer.setRangeText(marker, start, end, "end");
    composer.setSelectionRange(caret, caret);
  }

  function removeMarker(marker) {
    const pattern = new RegExp(` ?${marker.replace(/[[\]]/g, "\\$&")}`, "gi");
    const value = composer.value;
    const caret = composer.selectionStart ?? value.length;
    const removedBefore = (value.slice(0, caret).match(pattern) || []).join("").length;
    const next = value.replace(pattern, "");
    if (next === value) return;
    composer.value = next;
    const at = Math.max(0, caret - removedBefore);
    composer.setSelectionRange(at, at);
  }

  async function addShotFiles(files) {
    const room = currentRoom();
    const active = () => !lifetime.disposed && currentRoom() === room && state.rooms.get(room.id) === room;
    if (!room || !active()) return;
    for (const file of files) {
      if (!active()) return;
      if (!SHOT_TYPES.includes(file.type)) {
        showError(new Error(`${file.name || "that image"} is a ${file.type || "kind"} the room cannot show (png, jpeg, webp and gif only)`));
        continue;
      }
      if (pendingShots.length >= perMessage("images")) return void showError(new Error(`up to ${perMessage("images")} images per message`));
      const allowed = await mayCopy(file);
      if (!active()) return;
      if (!allowed) continue;
      const shot = { n: ++shotSeq, name: file.name || "", mimeType: file.type, url: createObjectUrl(file) };
      pendingShots.push(shot);
      renderShotsTray();
      insertMarker(shotMarker(shot.n));
      sendToRoom(shot, file, "images");
    }
  }

  function imageFilesFrom(transfer) {
    if (!transfer) return [];
    return Array.from(transfer.files || []).filter((f) => f && f.type && f.type.startsWith("image/"));
  }
  function filesFrom(transfer) {
    return transfer ? Array.from(transfer.files || []).filter(Boolean) : [];
  }

  const attachBtn = $("#attach-btn");
  const attachInput = $("#attach-input");
  const uploads = new Map();
  lifetime.own(() => { uploads.clear(); els.composer.classList.remove("uploading"); });
  function renderDocumentUploads() {
    if (net.signal.aborted) return;
    const room = currentRoom();
    els.composer.classList.toggle("uploading", !!room && draftRoomId === room.id && (uploads.get(roomRecordKey(room)) || 0) > 0);
  }
  function addFiles(files) {
    const pictures = files.filter((f) => f.type && f.type.startsWith("image/"));
    const timed = files.filter((f) => !pictures.includes(f) && timedKindOf(f.type));
    const documents = files.filter((f) => !pictures.includes(f) && !timed.includes(f));
    if (pictures.length) addShotFiles(pictures);
    for (const kind of Object.keys(TIMED_KINDS)) {
      const ofKind = timed.filter((f) => timedKindOf(f.type) === kind);
      if (ofKind.length) addTimedFiles(kind, ofKind);
    }
    if (documents.length) attachDocuments(documents);
  }
  function insertLine(text) {
    const value = composer.value;
    const start = composer.selectionStart ?? value.length;
    const end = composer.selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = before && !/\n$/.test(before) ? "\n" : "";
    const tail = after && !/^\n/.test(after) ? "\n" : "";
    composer.setRangeText(`${lead}${text}${tail}`, start, end, "end");
  }
  function commitDocumentLine(room, line) {
    const key = roomRecordKey(room);
    if (net.signal.aborted || !key || roomRecordKey(state.rooms.get(room.id)) !== key) return false;
    if (roomRecordKey(currentRoom()) === key && draftRoomId === room.id) {
      insertLine(line);
      return true;
    }
    const draft = Drafts.load(localStorage, room.id) || draftOf({ text: "", img: [], audio: [], video: [], quotes: [] });
    const text = `${draft.text}${draft.text && !/\n$/.test(draft.text) ? "\n" : ""}${line}`;
    if (!Drafts.save(localStorage, room.id, { ...draft, text, at: Date.now() })) {
      throw new Error(`The file was uploaded to ${room.name || "the room"}, but this browser could not save its link in that room's draft: ${line}`);
    }
    return true;
  }
  async function attachDocuments(files) {
    const room = currentRoom();
    const key = roomRecordKey(room);
    const active = () => !net.signal.aborted && key && roomRecordKey(currentRoom()) === key && draftRoomId === room.id && roomRecordKey(state.rooms.get(room.id)) === key;
    const lines = [];
    if (!key || !active()) return lines;
    for (const file of files) {
      if (!active()) return lines;
      const allowed = await mayCopy(file);
      if (!active()) return lines;
      if (!allowed) continue;
      uploads.set(key, (uploads.get(key) || 0) + 1);
      renderDocumentUploads();
      try {
        const r = await uploadFile(room.id, file, { as: "document", name: file.name || "", type: file.type });
        if (net.signal.aborted) return lines;
        if (commitDocumentLine(room, r.line)) lines.push(r.line);
      } catch (error) {
        if (!net.signal.aborted) showError(error);
      } finally {
        const remaining = (uploads.get(key) || 0) - 1;
        if (remaining > 0) uploads.set(key, remaining);
        else uploads.delete(key);
        renderDocumentUploads();
        if (active() && state.view === "room") composer.focus();
      }
    }
    return lines;
  }
  function longPaste(text) {
    return text.length >= 10000 || text.split("\n").length >= 200;
  }
  async function pasteAsDocument(text) {
    const room = currentRoom(), key = roomRecordKey(room);
    const now = new Date(), two = (n) => String(n).padStart(2, "0");
    const name = `pasted-${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}.txt`;
    const [line] = await attachDocuments([new File([text], name, { type: "text/plain" })]);
    if (!line) {
      let kept = false;
      try { kept = !!room && commitDocumentLine(room, text); }
      catch { showError(new Error(`The long text could not be kept as a file, nor in the draft of ${room.name || "the room"}.`)); }
      if (kept) toast("The long text could not be kept as a file, so it went into the message as it was.", "warn");
      return;
    }
    const back = pastedRoomShown(room, key) && composer.value.includes(line) ? { label: "Paste as text", run: () => restorePastedText(room, key, line, text) } : undefined;
    toast(`The long text went in as the file ${name}. The vibemates read it from there, and the message stays short.`, "info", back);
  }
  function pastedRoomShown(room, key) {
    return state.view === "room" && !!key && roomRecordKey(currentRoom()) === key && draftRoomId === room.id;
  }
  function restorePastedText(room, key, line, text) {
    if (!pastedRoomShown(room, key)) return;
    const at = composer.value.indexOf(line);
    if (at < 0) return;
    composer.setRangeText(text, at, at + line.length, "end");
    composer.focus();
  }
  lifetime.on(attachBtn, "click", () => attachInput.click());
  lifetime.on(attachInput, "change", () => {
    addFiles(Array.from(attachInput.files || []));
    attachInput.value = "";
  });

  let pendingQuotes = [];
  let quoteSeq = 0;
  const quoteMarker = (n) => `[quote ${n}]`;
  const CHIP_CHARS = VIBEROOM_ATTACHMENT_TRAYS.previewChars;
  const attachmentTrays = lifetime.use(VIBEROOM_ATTACHMENT_TRAYS.create({ media: els.shotsTray, quotes: els.quotesTray }, {
    window, signal: lifetime.signal, icon: ic, length: soundLength, kinds: TIMED_KINDS, pictureMark,
    read: () => {
      const room = currentRoom();
      return { target: room && { scope: room.scope, id: room.id, uuid: room.uuid, createdAt: room.createdAt, draftRoomId },
        images: pendingShots, timed: timedDraft, quotes: pendingQuotes };
    },
    onDrop: ({ kind, n }) => removeMarker(kind === "img" ? shotMarker(n) : kind === "quote" ? quoteMarker(n) : timedMarker(kind, n)),
  }));
  function renderQuotesTray() { updateComposerClear(); attachmentTrays.renderQuotes(); }

  function clearQuotes() {
    pendingQuotes = [];
    detachedQuotes = [];
    quoteSeq = 0;
    renderQuotesTray();
  }

  const Drafts = window.VIBEROOM_DRAFTS;
  const draftComposers = new Map();
  const DRAFT_KEEP_MS = 400;
  let draftTimer = 0;
  let draftRoomId = null;
  function draftOf({ text, img, audio, video, quotes, seq = {} }) {
    const files = { img, audio, video };
    const kept = (list) => list.filter((x) => x.stored?.file).map((x) => ({ n: x.n, file: x.stored.file, name: x.name, mimeType: x.mimeType, ...(x.seconds ? { seconds: x.seconds } : {}) }));
    const top = (list, from = 0) => list.reduce((most, x) => Math.max(most, x.n || 0), from);
    return {
      text,
      files: Object.fromEntries(Object.entries(files).map(([kind, list]) => [kind, kept(list)])),
      quotes: quotes.map((q) => ({ ...q })),
      unsent: Object.entries(files).flatMap(([kind, list]) => list.filter((x) => !x.stored?.file).map((x) => ({ kind, n: x.n, name: x.name || "" }))),
      seq: { img: top(img, seq.img), audio: top(audio, seq.audio), video: top(video, seq.video), quote: top(quotes, seq.quote) },
      at: Date.now(),
    };
  }
  function draftNow() {
    return draftOf({ text: composer.value, img: pendingShots, audio: timedDraft.audio.pending, video: timedDraft.video.pending, quotes: pendingQuotes,
      seq: { img: shotSeq, audio: timedDraft.audio.seq, video: timedDraft.video.seq, quote: quoteSeq } });
  }
  function keepDraft() {
    clearTimeout(draftTimer);
    draftTimer = 0;
    if (draftRoomId && state.rooms.has(draftRoomId)) {
      Drafts.save(localStorage, draftRoomId, draftNow());
      draftComposers.set(draftRoomId, { key: roomRecordKey(state.rooms.get(draftRoomId)), value: composer.snapshot() });
    }
  }
  function keepDraftSoon() {
    if (!draftRoomId) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(keepDraft, DRAFT_KEEP_MS);
  }
  function bringDraft(roomId) {
    keepDraft();
    draftRoomId = null;
    clearShots();
    clearQuotes();
    composer.reset("");
    const draft = Drafts.load(localStorage, roomId);
    if (draft) {
      const fileOf = (kind, f) => {
        const stored = { file: f.file };
        return { n: f.n, name: f.name, mimeType: f.mimeType, ...(f.seconds ? { seconds: f.seconds } : {}), url: shotUrl(roomId, stored), stored, upload: Promise.resolve(stored) };
      };
      pendingShots = draft.files.img.map((f) => fileOf("img", f));
      for (const kind of Object.keys(timedDraft)) {
        timedDraft[kind].pending = (draft.files[kind] || []).map((f) => fileOf(kind, f));
        timedDraft[kind].seq = draft.seq[kind];
      }
      shotSeq = draft.seq.img;
      pendingQuotes = draft.quotes;
      quoteSeq = draft.seq.quote;
      const markerOf = (u) => (u.kind === "img" ? shotMarker(u.n) : timedMarker(u.kind, u.n));
      composer.reset(draft.unsent.length ? Drafts.withoutMarkers(draft.text, draft.unsent.map(markerOf)) : draft.text);
      const editing = draftComposers.get(roomId);
      if (editing?.key === roomRecordKey(state.rooms.get(roomId)) && editing.value.text === composer.value) composer.restore(editing.value);
      else draftComposers.delete(roomId);
      renderShotsTray();
      renderQuotesTray();
      if (draft.unsent.length) {
        const names = draft.unsent.map((u) => u.name || markerOf(u)).join(", ");
        toast(`${names} had not reached the room when you left this draft, so ${draft.unsent.length === 1 ? "it is" : "they are"} not attached: attach ${draft.unsent.length === 1 ? "it" : "them"} again.`, "warn");
      }
    }
    draftRoomId = roomId;
    renderDocumentUploads();
    keepDraft();
  }
  lifetime.on(window, "pagehide", keepDraft);

  function addQuote(m, text) {
    if (!m || m.kind !== "chat" || m.pending) return void showError(new Error("only a message the room has can be quoted"));
    if (pendingQuotes.length >= perMessage("quotes")) return void showError(new Error(`up to ${perMessage("quotes")} quotes per message`));
    const fragment = String(text || "").trim() || String(m.text || "").trim();
    if (!fragment) return void showError(new Error("there is no text to quote in that message"));
    const n = ++quoteSeq;
    pendingQuotes.push({ n, id: m.id, seq: m.seq, from: m.from, fromName: m.fromName, ts: m.ts, text: fragment });
    renderQuotesTray();
    insertMarker(quoteMarker(n));
    composer.focus();
  }

  function messageOfNode(node) {
    const el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    const msg = el && el.closest && el.closest(".msg[data-id]");
    const room = currentRoom();
    if (!msg || !els.messages.contains(msg) || !room) return null;
    const m = HistoryWindow.knownMessages(room).find((x) => x.id === msg.dataset.id);
    return m && m.kind === "chat" ? m : null;
  }

  function bubbleSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    const m = messageOfNode(range.startContainer);
    if (!m || m !== messageOfNode(range.endContainer)) return null;
    if (!range.startContainer.parentElement || !range.startContainer.parentElement.closest(".bubble .text")) return null;
    return { m, text, rect: Layout.rect(range) };
  }

  const quoteSelection = lifetime.use(VIBEROOM_QUOTE_SELECTION.create(uiRoot, {
    signal: lifetime.signal, messages: els.messages, Layout, icon: ic, esc, selection: bubbleSelection, onQuote: addQuote, currentRoom,
    currentKey: () => state.view === "room" && currentRoom() ? roomRecordKey(currentRoom()) : null,
  }));
  function quoteTheSelection() { return quoteSelection.quote(); }
  function pastedQuotes(transfer) {
    const room = currentRoom();
    const html = transfer && room ? transfer.getData("text/html") : "";
    if (!html || !html.includes("data-viberoom-seq")) return [];
    const box = document.createElement("div");
    box.innerHTML = html;
    return [...box.querySelectorAll("[data-viberoom-seq]")]
      .filter((node) => node.dataset.viberoomRoom === room.id)
      .map((node) => ({ m: HistoryWindow.knownMessages(room).find((x) => x.seq === Number(node.dataset.viberoomSeq)), text: node.textContent }))
      .filter((q) => q.m);
  }

  function pasteIntoComposer(e) {
    const files = filesFrom(e.clipboardData);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
      return;
    }
    const quotes = pastedQuotes(e.clipboardData);
    if (quotes.length) {
      e.preventDefault();
      for (const q of quotes) addQuote(q.m, q.text);
      return;
    }
    const text = String(e.clipboardData?.getData("text/plain") || "").replace(/\r\n?/g, "\n");
    if (!longPaste(text)) return;
    e.preventDefault();
    void pasteAsDocument(text);
  }
  for (const target of [els.composer, els.messages]) {
    domResources.nodeListener(target, "dragover", (e) => {
      if (!imageFilesFrom(e.dataTransfer).length && !(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"))) return;
      e.preventDefault();
      els.composer.classList.add("drop-target");
    });
    domResources.nodeListener(target, "dragleave", () => els.composer.classList.remove("drop-target"));
    domResources.nodeListener(target, "drop", (e) => {
      const files = filesFrom(e.dataTransfer);
      els.composer.classList.remove("drop-target");
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
      composer.focus();
    });
  }
  let typingSentAt = 0;
  lifetime.on(els.input, "input", () => {
    lastTypedAt = Date.now();
    if (!currentRoom() || !composer.value.trim()) return;
    const now = Date.now();
    if (now - typingSentAt < 2000) return;
    typingSentAt = now;
    post(roomApi("/typing"), {}).catch(() => undefined);
  });
  lifetime.on(els.roster, "click", (e) => {
    const li = e.target.closest("li[data-id]");
    const room = currentRoom();
    if (!li || !room) return;
    const p = findById(room, li.dataset.id);
    if (!p) return;
    if (p.kind === "agent") quietGlance(li);
    const fix = e.target.closest('[data-act^="trouble-"]');
    if (fix) {
      troubleAction(room, p, fix.dataset.act.slice("trouble-".length), fix).catch(showError);
      return;
    }
    const action = e.target.closest('[data-ui="row-button"]');
    if (action) {
      const act = action.dataset.act;
      if (act === "panel") return openDetails({ kind: "participant", id: p.id });
      if (act === "last-reply") return void goToLastReply(room, p);
      if (act === "wake") return openReconnectDialog(room, p);
      return;
    }
    if (e.target.closest("button")) return;
    if (p.kind === "human") setView("me");
    else if (p.status === "unstaffed") openStaffDialog(p);
    else {
      if (panelFollows(p)) openDetails({ kind: "participant", id: p.id });
      void goToLastReply(room, p);
    }
  });
  const castBanner = $("#cast-banner");
  lifetime.on(castBanner, "click", (e) => {
    const card = e.target.closest(".cast-card");
    const room = card && currentRoom();
    const p = room && findById(room, card.dataset.id);
    if (p && p.status === "unstaffed") openStaffDialog(p);
  });
  function updateCastGate(room) {
    const waiting = room ? room.participants.filter((p) => p.kind === "agent" && p.status === "unstaffed") : [];
    castBanner.hidden = waiting.length === 0;
    castBanner.innerHTML = waiting.length
      ? `<div class="cast-lead"><strong>Summon ${waiting.map((p) => esc(p.name)).join(" and ")} to begin.</strong> ${waiting.length === 1 ? "It comes" : "They come"} from the template with the character set; pick the coding agent that runs ${waiting.length === 1 ? "it" : "each"}.</div><div class="cast-list">${waiting.map((p) => `<button type="button" class="cast-card" data-id="${esc(p.id)}">${avatar(p, 44, { dim: "unstaffed" })}<b>${esc(p.name)}</b>${p.tagline ? `<span>"${esc(p.tagline)}"</span>` : ""}<em>Summon ${esc(p.name)}</em></button>`).join("")}</div>`
      : "";
    composer.disabled = waiting.length > 0;
    composer.placeholder = waiting.length ? `Summon ${waiting.map((p) => p.name).join(" and ")} to start the conversation` : "Message the room… @Name or /skill";
    els.composer.classList.toggle("gated", waiting.length > 0);
  }

  function wedgeCardHtml(p, now) { return VIBEROOM_WEDGE_CARD.html(p, now, { UI, avatar }); }
  function wedgedOnes(room) {
    return room ? room.participants.filter((p) => p.kind === "agent" && p.quiet && !p.muted) : [];
  }
  const wedgeCards = lifetime.use(VIBEROOM_WEDGE_CARD.create($("#wedge-banner"), {
    signal: lifetime.signal, scope: uiRoot, UI, avatar,
    find: (id) => { const room = currentRoom(); return (room && findById(room, id)) || null; },
    over: () => toast("That turn is over.", "info"),
    act: (act, p, turnId) => {
      const room = currentRoom(), roomKey = roomRecordKey(room);
      if (!roomKey) return;
      const at = (path) => `/api/rooms/${encodeURIComponent(room.id)}/participants/${encodeURIComponent(p.id)}/${path}`;
      if (act === "nudge") return post(at("nudge"), { by: "the window" }).catch(showError);
      if (act === "stop") return post(at("cancel"), { turnId }).catch(showError);
      const n = room.settings?.replayAfterRestart ?? 10;
      return confirmDialog(`${p.name} comes back in a fresh session with ${p.notes ? "its own notes and " : ""}the last ${n} messages of this room. Its memory of this turn is gone; the room's history is not.`,
        { title: `A fresh start for ${p.name}?`, okLabel: "Fresh start", danger: true })
        .then((ok) => {
          if (!ok) return;
          const now = roomOfRecord(roomKey), still = now && findById(now, p.id);
          if (!still?.quiet || still.quiet.turnId !== turnId) return void toast("That turn is over.", "info");
          return post(at("respawn"), { memory: true, replay: n });
        })
        .catch(showError);
    },
  }));
  function renderWedgeBanner(room) { wedgeCards.render(wedgedOnes(room)); }
  lifetime.on(els.roster, "dblclick", (e) => {
    if (e.target.closest("button, [data-ui=\"row-button\"]")) return;
    const li = e.target.closest("li[data-id]");
    const p = li && findById(currentRoom(), li.dataset.id);
    if (p && p.kind === "agent") insertMention(p.name);
  });
  async function goToLastReply(room, p) {
    if (lifetime.disposed || currentRoom() !== room) return;
    const draft = room.messages.find((m) => m.from === p.id && m.streaming);
    const rows = els.messages.querySelectorAll(".msg[data-id]");
    if (draft && rows.length && rows[rows.length - 1].dataset.id === draft.id) return void scrollToBottom("a working vibemate's last line was asked for", { byHand: true });
    if (draft && await jumpToId(draft.id, "end")) return;
    if (lifetime.disposed || currentRoom() !== room) return;
    const latest = room.history?.latest?.[p.id];
    if (latest && await revealSeq(latest.seq)) return;
    if (lifetime.disposed || currentRoom() !== room) return;
    if (jumpToMessage([...els.messages.querySelectorAll(`.msg.agent[data-from="${cssEscape(p.id)}"]`)].pop())) return;
    const spoke = latest || room.messages.some((m) => m.from === p.id && m.kind === "chat");
    toast(spoke ? `${p.name}'s last reply could not be reached` : `${p.name} has not replied in this room yet`);
  }
  function optimisticOrder(room) { return conversationState.optimisticOrder(room); }
  lifetime.on(els.composer, "submit", async (event) => {
    event.preventDefault();
    if (voiceControl.listening) return void voiceControl.send();
    const text = composer.value.trim();
    const room = currentRoom();
    if ((!text && !pendingShots.length && !timedCount() && !pendingQuotes.length) || !room) return;
    const displayOrder = optimisticOrder(room);
    if (displayOrder === null) return;
    const shots = pendingShots;
    const sounds = timedDraft.audio.pending;
    const clips = timedDraft.video.pending;
    const quotes = pendingQuotes;
    composer.reset("");
    clearShots([...shots, ...sounds, ...clips]);
    clearQuotes();
    typingSentAt = 0;
    const local = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, seq: 0, displayOrder, from: "human", fromName: (state.settings || {}).humanName || "You", to: [], toNames: [], text, ts: Date.now(), kind: "chat", pending: true };
    if (shots.length) local.images = shots.map((shot) => ({ file: "", name: shot.name, mimeType: shot.mimeType, bytes: 0, n: shot.n, url: shot.url }));
    if (sounds.length) local.audio = sounds.map((sound) => ({ file: "", name: sound.name, mimeType: sound.mimeType, bytes: 0, n: sound.n, url: sound.url, ...(sound.seconds ? { seconds: sound.seconds } : {}), hearing: true }));
    if (clips.length) local.video = clips.map((clip) => ({ file: "", name: clip.name, mimeType: clip.mimeType, bytes: 0, n: clip.n, url: clip.url, ...(clip.seconds ? { seconds: clip.seconds } : {}) }));
    if (quotes.length) local.quotes = quotes.map((q) => ({ ...q }));
    const localId = local.id;
    upsertMessage(room.id, local);
    try {
      await Promise.all([...shots, ...sounds, ...clips].map((item) => item.upload));
      const named = (list) => list.map((x) => ({ file: x.stored.file, name: x.name, mimeType: x.mimeType, n: x.n, ...(x.seconds ? { seconds: x.seconds } : {}) }));
      const r = await post(roomApi("/send"), { text, images: named(shots), audio: named(sounds), video: named(clips), quotes: quotes.map((q) => ({ n: q.n, id: q.id, seq: q.seq, text: q.text })) }, sounds.length ? { deadline: 180000 } : undefined);
      if (r.command) removeMessage(room.id, localId);
      else adoptLocalMessage(room.id, localId, r.id);
      if (shots.length || sounds.length || clips.length) lifetime.timeout(() => { for (const item of [...shots, ...sounds, ...clips]) if (item.url) revokeObjectUrl(item.url); }, 60000);
    } catch (error) {
      removeMessage(room.id, localId);
      showError(error);
      if (state.currentRoomId !== room.id) {
        Drafts.save(localStorage, room.id, draftOf({ text, img: shots, audio: sounds, video: clips, quotes }));
        return void toast(`Your message to ${room.name} was not sent; it waits in that room's box.`, "warn");
      }
      pendingShots = shots;
      timedDraft.audio.pending = sounds;
      timedDraft.video.pending = clips;
      pendingQuotes = quotes;
      const back = draftOf({ text, img: shots, audio: sounds, video: clips, quotes }).seq;
      shotSeq = back.img; timedDraft.audio.seq = back.audio; timedDraft.video.seq = back.video; quoteSeq = back.quote;
      composer.reset(text);
      renderShotsTray();
      renderQuotesTray();
    }
  });
  function adoptLocalMessage(roomId, localId, realId) {
    const room = state.rooms.get(roomId);
    if (room) conversationState.adopt(room, localId, realId);
  }
  function adoptLocalMessageInView(room, localId, realId) {
    const roomId = room.id;
    if (room.history?.indexed) itemLists.delete(room);
    for (const chosen of [state.expanded, state.watched]) if (chosen.delete(localId)) chosen.add(realId);
    if (measuredRoom === roomId && measuredRows.has(localId)) { measuredRows.set(realId, measuredRows.get(localId)); measuredRows.delete(localId); }
    if (settledReader?.roomId === roomId && settledReader.anchor?.id === localId) settledReader.anchor.id = realId;
    const el = els.messages.querySelector(`.msg[data-id="${localId}"]`);
    if (el) el.dataset.id = realId;
    cornerNotes.adopt(localId, realId);
  }


  function rulesToNodes(editor, text, room) {
    const context = roomReader.forRecord(room);
    if (context) VIBEROOM_RULES_EDITOR.toNodes(editor, text, context, { findByName, avatar, colourOf });
  }
  function rulesText(editor) { return VIBEROOM_RULES_EDITOR.text(editor); }
  function currentRoomContext() {
    if (lifetime.disposed) return undefined;
    const room = currentRoom(), context = roomReader.forRecord(room);
    return context && !lifetime.disposed && currentRoom() === room ? context : undefined;
  }
  function attachRichMentions(editor, menuEl) {
    rulesEditor?.dispose();
    rulesEditor = VIBEROOM_RULES_EDITOR.create(editor, menuEl, {
      window, signal: lifetime.signal, readRoom: currentRoomContext, findByName, avatar, colourOf,
    });
  }

  const composerMenu = lifetime.use(VIBEROOM_COMPOSER_MENU.create(composer, els.mentionMenu, {
    window, signal: lifetime.signal, readRoom: currentRoomContext, readSkills: () => state.skills,
    skillHolders, avatar, icon: ic, onChange: autosizeSoon,
  }));
  lifetime.on(els.input, "keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.composer.requestSubmit();
    }
  });


  const sidePane = $(".side");
  const BUBBLE_CAP = 1400;
  const mainPane = $(".main");
  function bubblesKeepTheirWidth() {
    if (!mainPane) return false;
    const now = mainPane.clientWidth;
    const other = now + (els.app.classList.contains("side-collapsed") ? -220 : 220);
    return Math.min(now, other) - 84 >= BUBBLE_CAP;
  }
  function setSideOpen(open) {
    const glide = bubblesKeepTheirWidth();
    els.app.classList.toggle("glide", glide);
    els.app.classList.toggle("side-collapsed", !open);
    if (glide) {
      clearTimeout(setSideOpen.timer);
      setSideOpen.timer = setTimeout(() => els.app.classList.remove("glide"), 400);
    } else if (sidePane) {
      sidePane.classList.remove("arrive");
      void sidePane.offsetWidth;
      sidePane.classList.add("arrive");
      domResources.nodeListener(sidePane, "animationend", () => sidePane.classList.remove("arrive"), { once: true });
    }
    remember("sideOpen", open ? "1" : "0");
    els.sideToggle.title = open ? "Fold this column" : "Unfold this column";
    els.sideToggle.innerHTML = ic(open ? "collapse" : "expand");
  }
  lifetime.on(els.sideToggle, "click", () => setSideOpen(els.app.classList.contains("side-collapsed")));
  let lastScrollTop = 0;
  let lastMovedAt = 0;
  let lastUserScrollAt = 0;
  for (const type of ["wheel", "touchmove", "keydown", "mousedown"]) {
    lifetime.on(els.messages, type, () => (lastUserScrollAt = Date.now()), { passive: true });
  }
  const WHEEL_GESTURE_GAP_MS = 300;
  const wheelGesture = { lastAt: 0, beganAtEnd: false };
  function restedAtEnd(now) {
    return atEnd() && els.messages.scrollTop === lastScrollTop && now - lastMovedAt > WHEEL_GESTURE_GAP_MS;
  }
  function wheelPastEnd(e) {
    const now = Date.now();
    if (now - wheelGesture.lastAt > WHEEL_GESTURE_GAP_MS) wheelGesture.beganAtEnd = restedAtEnd(now);
    wheelGesture.lastAt = now;
    if (e.deltaY > 0 && wheelGesture.beganAtEnd && !stuck && atEnd() && !humanHoldsText()) scrollToBottom("the wheel pushed past the end", { byHand: true });
  }
  lifetime.on(els.messages, "wheel", wheelPastEnd, { passive: true });
  const WHEEL_NOTCH_PX = 100;
  const WHEEL_STEP_DEFAULT = 20;
  const WHEEL_STEP_MS = 150;
  const GLIDE_TAU_MS = 240;
  const GLIDE_MIN_SPEED = 0.02;
  const GLIDE_NOTCH_MIN_PX = 40;
  const GLIDE_STREAM_GAP_MS = 25;
  const GLIDE_RATCHET_GAP_MS = 40;
  const GLIDE_RATCHET_MIN_PX = 8;
  const glide = { speed: 0, target: -1, from: 0, since: 0, at: 0, expectedTop: -1, raf: 0, gesture: { lastAt: 0, takes: false, stream: false, prevAbs: 0 } };
  const wheelTrace = [];
  globalThis.VIBEROOM_WHEEL = wheelTrace;
  const GLIDE_LATE_FRAME_MS = 24;
  function traceWheel(entry) {
    if (!devBuild()) return;
    wheelTrace.push({ at: performance.now(), ...entry });
    if (wheelTrace.length > 600) wheelTrace.splice(0, wheelTrace.length - 400);
  }
  function glideStop(why) {
    if (why && (glide.raf || glide.speed || glide.target >= 0)) traceWheel({ kind: "stop", why });
    glide.speed = 0;
    glide.target = -1;
    glide.expectedTop = -1;
    if (glide.raf) cancelAnimationFrame(glide.raf);
    glide.raf = 0;
  }
  function wheelFollowsShift() {
    if (glide.expectedTop < 0) return;
    const shift = els.messages.scrollTop - glide.expectedTop;
    if (Math.abs(shift) <= 1) return;
    if (glide.target >= 0) { glide.from += shift; glide.target += shift; }
    traceWheel({ kind: "shift", px: Math.round(shift) });
  }
  function wheelSettings() {
    const s = state.settings || {};
    return { percent: Number.isFinite(s.wheelStepPercent) ? s.wheelStepPercent : WHEEL_STEP_DEFAULT, glides: s.wheelInertia === true };
  }
  function wheelDistance(e, height, percent) {
    if (e.deltaMode === 2) return e.deltaY * height * 0.8;
    const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / WHEEL_NOTCH_PX;
    return notches * (percent / 100) * height;
  }
  function glideFrame(now) {
    glide.raf = 0;
    const el = els.messages;
    wheelFollowsShift();
    const late = now - glide.at;
    const dt = Math.min(64, Math.max(0, late));
    glide.at = now;
    const step = glide.speed * dt;
    glide.speed *= Math.exp(-dt / GLIDE_TAU_MS);
    const limit = el.scrollHeight - el.clientHeight;
    const top = Math.max(0, Math.min(limit, el.scrollTop + step));
    el.scrollTop = top;
    glide.expectedTop = el.scrollTop;
    if (late > GLIDE_LATE_FRAME_MS) traceWheel({ kind: "frame", late: Math.round(late), step: Math.round(step) });
    if ((top <= 0 && glide.speed < 0) || (top >= limit && glide.speed > 0)) return glideStop("an edge");
    if (Math.abs(glide.speed) < GLIDE_MIN_SPEED) return glideStop("came to rest");
    glide.raf = requestAnimationFrame(glideFrame);
  }
  function stepFrame(now) {
    glide.raf = 0;
    const el = els.messages;
    wheelFollowsShift();
    const late = now - glide.at;
    glide.at = now;
    const limit = el.scrollHeight - el.clientHeight;
    const target = Math.max(0, Math.min(limit, glide.target));
    const done = Math.min(1, Math.max(0, now - glide.since) / WHEEL_STEP_MS);
    const before = el.scrollTop;
    el.scrollTop = done >= 1 ? target : glide.from + (target - glide.from) * (1 - (1 - done) ** 3);
    glide.expectedTop = el.scrollTop;
    if (late > GLIDE_LATE_FRAME_MS) traceWheel({ kind: "frame", late: Math.round(late), step: Math.round(el.scrollTop - before) });
    if (done >= 1) return glideStop(target <= 0 || target >= limit ? "an edge" : "arrived");
    glide.raf = requestAnimationFrame(stepFrame);
  }
  function innerScrollTakes(e) {
    for (let node = e.target; node && node !== els.messages; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)
        && (e.deltaY < 0 ? node.scrollTop > 0 : node.scrollTop < node.scrollHeight - node.clientHeight - 1)) return true;
    }
    return false;
  }
  lifetime.on(els.messages, "wheel", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || !e.deltaY) return;
    const now = performance.now();
    const gesture = glide.gesture;
    const gap = e.timeStamp - gesture.lastAt;
    const fresh = gap > WHEEL_GESTURE_GAP_MS;
    gesture.lastAt = e.timeStamp;
    let upgraded = false;
    if (fresh) {
      gesture.takes = e.deltaMode !== 0 || Math.abs(e.deltaY) >= GLIDE_NOTCH_MIN_PX;
      gesture.stream = false;
    } else if (!gesture.takes && !gesture.stream) {
      if (gap < GLIDE_STREAM_GAP_MS) gesture.stream = true;
      else if (gap >= GLIDE_RATCHET_GAP_MS && Math.abs(e.deltaY) >= GLIDE_RATCHET_MIN_PX
        && Math.abs(Math.abs(e.deltaY) - gesture.prevAbs) < 2) gesture.takes = upgraded = true;
    }
    gesture.prevAbs = Math.abs(e.deltaY);
    const heard = { kind: "wheel", dy: Math.round(e.deltaY * 10) / 10, mode: e.deltaMode, gap: fresh ? null : Math.round(gap), waited: Math.round(now - e.timeStamp), ...(fresh ? { busy: busyLabel() } : {}) };
    if (!gesture.takes) {
      traceWheel({ ...heard, took: gesture.stream ? "native: a stream" : "native" });
      return glideStop("a wheel event the wheel does not take");
    }
    if (innerScrollTakes(e)) {
      traceWheel({ ...heard, took: "native: a box inside scrolls" });
      return glideStop("a box inside takes the wheel");
    }
    const el = els.messages;
    const { percent, glides } = wheelSettings();
    const distance = wheelDistance(e, el.clientHeight, percent);
    if (distance > 0 ? el.scrollTop >= el.scrollHeight - el.clientHeight - 1 : el.scrollTop <= 0) {
      traceWheel({ ...heard, took: "native: at the edge" });
      return glideStop("a push at the edge");
    }
    e.preventDefault();
    if (distance < 0 && stuck) leaveTheEnd();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (glides && !still) {
      const brake = Math.sign(distance) !== Math.sign(glide.speed) && glide.speed !== 0;
      traceWheel({ ...heard, took: brake ? "glide: a brake" : upgraded ? "glide: the ratchet's second notch" : "glide" });
      if (glide.target >= 0) glideStop();
      if (Math.sign(distance) !== Math.sign(glide.speed)) glide.speed = 0;
      if (!glide.raf) {
        glide.at = now;
        glide.expectedTop = -1;
        glide.raf = requestAnimationFrame(glideFrame);
      }
      glide.speed += distance / GLIDE_TAU_MS;
      return;
    }
    traceWheel({ ...heard, took: still ? "step: at once (reduced motion)" : upgraded ? "step: the ratchet's second notch" : "step" });
    if (glide.speed) glideStop();
    const limit = el.scrollHeight - el.clientHeight;
    glide.target = Math.max(0, Math.min(limit, (glide.target >= 0 ? glide.target : el.scrollTop) + distance));
    if (still) {
      el.scrollTop = glide.target;
      glide.target = -1;
      return;
    }
    glide.from = el.scrollTop;
    glide.since = now;
    if (!glide.raf) {
      glide.at = now;
      glide.expectedTop = -1;
      glide.raf = requestAnimationFrame(stepFrame);
    }
  }, { passive: false });
  for (const type of ["pointerdown", "keydown", "touchstart"]) lifetime.on(els.messages, type, (e) => glideStop(`a ${e.type}`), { passive: true });
  lifetime.on(els.messages, "pointerdown", (e) => {
    if (e.button !== 0 || (e.target.closest && e.target.closest("button, a, input, textarea, select, summary, [role=button]"))) return;
    textPress = e.target.nodeType === 3 ? e.target.parentElement : e.target;
    heldTextElement = textPart(textPress);
  });
  const releasePress = () => {
    if (!textPress) return;
    textPress = null;
    if (state.view === "room" && !humanHoldsText()) {
      rememberReleasedText();
      renderMessagesSoon("the text press was released");
      resumeAfterText();
    }
  };
  for (const type of ["pointerup", "pointercancel"]) lifetime.on(document, type, releasePress, { passive: true });
  lifetime.on(window, "blur", releasePress);
  lifetime.on(els.messages, "scroll", () => {
    if (state.view !== "room") return;
    if (els.messages.scrollTop !== lastScrollTop) lastMovedAt = Date.now();
    if (rowPrices.stamp !== pricesStamp()) { repriceSoon(); return; }
    const top = els.messages.scrollTop;
    const byHand = Date.now() - lastUserScrollAt < 700;
    const stillAtEnd = els.messages.scrollHeight - top - els.messages.clientHeight <= 1;
    noteArrival(byHand);
    if (byHand && calm.reserve > 0) calmRelease();
    if (byHand) {
      if (top < lastScrollTop) {
        stuck = false;
        readingAway = true;
      } else if (top > lastScrollTop && !humanHoldsText() && deliberateReturn()) {
        stuck = true;
        readingAway = false;
      }
    } else if (!calm.held && top < lastScrollTop && !stillAtEnd) {
      stuck = false;
      readingAway = true;
    }
    if (stuck) calm.held = false;
    lastScrollTop = top;
    rememberReader();
    followWindowSoon();
    requestViewportWork({ view: true });
    if (stuck) cornerNotes.clear();
    else cornerNotes.prune();
    foldSettleSoon();
  });
  lifetime.on(els.jumpLatest, "click", () => scrollToBottom("Latest was pressed", { byHand: true }));
  lifetime.on(uiRoot, "mousedown", (e) => {
    if (!state.detailsOpen) return;
    if (e.target.closest("#details, #side, .rail, .chat-actions, dialog, .mention-menu, .lightbox, .tl-pop, #pins-panel")) return;
    closeDetails();
  });
  setSideOpen(recall("sideOpen") !== "0");
  lifetime.use(VIBEROOM_ONBOARDING_PAGE.bind(els.pageInner, {
    window: document.defaultView, isShown: () => state.view === "onboarding", onGo: onboardingGo, onAsk: (id) => void onboardingAsk(id),
  }));
  domResources.observe(MutationObserver, renderGonePop).observer.observe(els.conn, { attributes: true, attributeFilter: ["class"] });
  if (recall("railOpen") === "1") els.app.classList.add("rail-open");
  lifetime.on(els.backToRooms, "click", () => {
    setView("rooms");
    remember("view", "rooms");
  });
  lifetime.on(els.roomSearch, "input", () => {
    state.roomSearch = els.roomSearch.value.trim();
    renderSideRooms();
  });
  let searchTimer = 0;
  lifetime.on(els.search, "input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 120);
  });
  let storeSearchTimer = 0;
  let allConversationSelection = null;
  const conversationSelection = $("#conversation-selection");
  const conversationSelectionView = lifetime.use(VIBEROOM_CONVERSATION_SELECTION.create(uiRoot, {
    signal: lifetime.signal, bar: conversationSelection, messages: els.messages,
    selected: () => allConversationSelection, onCopy: () => void copyWholeConversation(), onClear: clearConversationSelection,
  }));
  function clearConversationSelection() {
    allConversationSelection = null;
    conversationSelectionView.render(null);
  }
  async function copyWholeConversation() {
    if (net.signal.aborted) return;
    const selected = allConversationSelection;
    if (!selected || selected.busy) return;
    selected.busy = true;
    conversationSelectionView.busy(selected, true);
    try {
      const response = await net.request(`/api/rooms/${encodeURIComponent(selected.roomId)}/export?format=md&version=${encodeURIComponent(selected.version)}`, { deadlineMs: 30000 });
      if (!response.ok) {
        const detail = await net.read(response, "json");
        throw new Error(detail.code === "history_changed" ? "The conversation changed. Select it again to copy the current record." : detail.error || "The conversation could not be loaded.");
      }
      const text = await net.read(response, "text");
      if (net.signal.aborted || allConversationSelection !== selected || !currentRoom() || roomRecordKey(currentRoom()) !== selected.roomKey) return;
      await navigator.clipboard.writeText(text);
      if (!net.signal.aborted) toast("Whole saved conversation copied as Markdown.", "ok");
    } catch (error) { if (!net.signal.aborted && allConversationSelection === selected) showError(error); }
    finally { if (!net.signal.aborted) { selected.busy = false; conversationSelectionView.busy(selected, false); } }
  }
  function shortcutLetter(event) {
    if (/^[a-z]$/i.test(event.key || "")) return event.key.toLowerCase();
    const place = /^Key([A-Z])$/.exec(event.code || "");
    return place ? place[1].toLowerCase() : "";
  }
  function isShortcut(event, letter) {
    return Boolean(event.ctrlKey || event.metaKey) && !event.altKey && shortcutLetter(event) === letter;
  }
  function findFieldOnScreen() {
    if (fileViewer.isOpen()) return fileViewer.findField();
    if ($("dialog[open]")) return null;
    if (state.view === "room") return els.search;
    if (state.view === "home" || state.view === "rooms") return els.roomSearch;
    return null;
  }
  function openFindOnScreen(event) {
    if (!isShortcut(event, "f")) return;
    const field = findFieldOnScreen();
    if (!field) return;
    event.preventDefault();
    if (field === els.search) clearConversationSelection();
    field.focus();
    field.select();
  }
  listenKey(openFindOnScreen);
  listenKey(event => {
    if (state.view !== "room" || $("dialog[open]")) return;
    if (event.key === "Escape" && allConversationSelection) {
      clearConversationSelection(); event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (isShortcut(event, "a")) {
      const room = currentRoom();
      if (!room) return;
      event.preventDefault(); window.getSelection()?.removeAllRanges();
      allConversationSelection = { roomId: room.id, roomKey: roomRecordKey(room), version: room.history?.version || "", busy: false };
      conversationSelectionView.render(allConversationSelection);
      els.messages.focus({ preventScroll: true });
    } else if (isShortcut(event, "c") && allConversationSelection) {
      event.preventDefault(); void copyWholeConversation();
    }
  });
  const searchPanel = $("#search-panel");
  const storeSearch = { scope: recall("searchScope") || "all", sort: "rank", seq: 0 };
  let storeSearchRead = null;
  function cancelStoreSearch() {
    storeSearch.seq++; clearTimeout(storeSearchTimer); storeSearchRead?.abort(); storeSearchRead = null;
  }
  lifetime.own(cancelStoreSearch);
  const conversationSearch = lifetime.use(VIBEROOM_CONVERSATION_SEARCH.create(uiRoot, {
    signal: lifetime.signal, panel: searchPanel, field: els.search, esc, icon: ic, fullTime,
    authorOf: hit => currentRoom() ? findById(currentRoom(), hit.from) : null,
    onHide: cancelStoreSearch, onPick: pickSearchHit,
    onQuery: value => { els.search.value = value; void searchStore(value.trim()); },
    onSetting: (key, value) => { storeSearch[key] = value; if (key === "scope") remember("searchScope", value); void searchStore(els.search.value.trim()); },
  }));

  lifetime.on(els.search, "input", () => {
    cancelStoreSearch();
    const q = els.search.value.trim();
    if (q.length < 2) {
      conversationSearch.hide();
      return;
    }
    storeSearchTimer = setTimeout(() => searchStore(q), 300);
  });
  lifetime.on(els.search, "keydown", (e) => {
    if (e.key === "Escape") conversationSearch.hide();
    if (e.key === "Enter" && els.search.value.trim().length >= 2) {
      clearTimeout(storeSearchTimer);
      searchStore(els.search.value.trim());
    }
  });
  async function searchStore(q) {
    if (q.length < 2) { conversationSearch.hide(); return; }
    const room = currentRoom();
    if (!room) return;
    const mine = ++storeSearch.seq, roomKey = roomRecordKey(room);
    const roomKeys = new Map([...state.rooms].map(([id, item]) => [id, roomRecordKey(item)]));
    storeSearchRead?.abort();
    const controller = storeSearchRead = new AbortController();
    const params = new URLSearchParams({ q, rooms: storeSearch.scope === "room" ? room.id : "all", sort: storeSearch.sort, limit: "40" });
    let data;
    try {
      data = await get(`/api/search?${params}`, { signal: controller.signal });
    } catch (error) {
      data = { hits: [], unavailable: error.message };
    }
    if (lifetime.disposed || controller.signal.aborted || mine !== storeSearch.seq || state.view !== "room" || !currentRoom() || roomRecordKey(currentRoom()) !== roomKey) return;
    if (storeSearchRead === controller) storeSearchRead = null;
    renderSearchPanel(q, data, roomKeys);
  }
  function renderSearchPanel(q, data, roomKeys) {
    const hits = data.hits.map(hit => ({ ...hit, roomKey: roomKeys?.get(hit.roomId) || null }));
    conversationSearch.render(q, { ...data, hits }, storeSearch);
  }
  function searchNamesHtml(names) { return VIBEROOM_CONVERSATION_SEARCH.searchNamesHtml(names, { esc, icon: ic }); }
  function pickSearchHit(hit) {
    const target = hit.roomKey && roomOfRecord(hit.roomKey);
    if (!target) return void toast("That room is unavailable or has changed. Search again.", "info");
    els.search.value = "";
    applySearch();
    const jump = () => { const room = currentRoom(); if (state.view === "room" && room && roomRecordKey(room) === hit.roomKey) void revealSeq(Number(hit.seq)); };
    if (target.id === state.currentRoomId) return jump();
    selectRoom(target.id);
    requestAnimationFrame(() => requestAnimationFrame(jump));
  }
  function applySearch() {
    const wasFiltered = !!state.search;
    state.search = "";
    const room = currentRoom();
    if (!room) return;
    els.messages.classList.remove("searching");
    for (const el of els.messages.querySelectorAll(".hidden-by-search")) el.classList.remove("hidden-by-search");
    if (wasFiltered) renderMessagesSoon("the local search filter was cleared");
  }
  lifetime.on(els.inviteBtn, "click", openInvite);
  lifetime.on(els.reconnectAllBtn, "click", () => openReconnectDialog(currentRoom()));
  $$("[data-close]").forEach((b) => domResources.nodeListener(b, "click", () => closeDialog(b.closest("dialog"))));
  lifetime.on(els.focusBtn, "click", async () => {
    const room = currentRoom();
    if (!room || room.focused || els.focusBtn.classList.contains("busy")) return;
    renderHushButton(room, true);
    try {
      await post(roomApi("/focus"));
    } catch (e) {
      showError(e);
      renderHushButton(room);
    }
  });
  lifetime.use(VIBEROOM_COMPOSER_EMOJI.create(uiRoot, {
    button: els.emojiBtn, menu: els.emojiMenu, signal: lifetime.signal, window, Avatars: window.Avatars, listenKey,
    onPick: emoji => composer.setRangeText(emoji, composer.selectionStart, composer.selectionEnd, "end"),
    onFocus: () => composer.focus(),
  }));
  let pathOpenSequence = 0;
  lifetime.on(uiRoot, "click", async (e) => {
    const link = e.target.closest && e.target.closest(".open-link");
    if (link) {
      const sequence = ++pathOpenSequence, originView = state.view;
      e.preventDefault();
      try {
        const target = link.dataset.open;
        const directory = link.dataset.openKind === "directory";
        if (!directory && IMAGE_RE.test(target) && !/^(https?:|mailto:)/i.test(target) && /[\\/]/.test(target)) {
          openLightbox(imageUrl(target), target.split(/[\\/]/).pop());
          return;
        }
        if (!directory && readableInRoom(target)) {
          const spec = splitLine(target);
          const file = spec ? spec.path : target;
          const room = currentRoom();
          const roomKey = roomRecordKey(room);
          const found = await resolveInRoom(room ? room.id : "", file);
          if (sequence !== pathOpenSequence || state.view !== originView || roomRecordKey(currentRoom()) !== roomKey) return;
          if (!found || found.kind === "file") {
            await viewFile(file, spec && !VIEWABLE_RE.test(file) ? spec.from : 0);
            return;
          }
        }
        const r = await post("/api/open", { target });
        if (r.action !== "open-url") toast(r.message, "info");
      } catch (err) {
        showError(err);
      }
      return;
    }
    const src = e.target.closest && e.target.closest(".mm-src");
    if (src) {
      const code = src.closest(".mermaid-block, .csv-block").querySelector(".mm-code");
      code.hidden = !code.hidden;
      src.textContent = code.hidden ? "source" : "hide source";
      return;
    }
    const expand = e.target.closest && e.target.closest(".mm-expand");
    if (expand) openDiagram(expand.closest(".mermaid-block"));
  });
  lifetime.on(els.chatInfoBtn, "click", () => openDetails({ kind: "room" }));
  domResources.nodeListener($("#automations-btn"), "click", () => {
    const room = currentRoom();
    if (room) void window.ViberoomAutomations.open(room.id, id => currentRoom()?.id === room.id ? jumpToId(id).catch(showError) : false, confirmDialog, dialogPorts);
  });

  async function openCarry(room) {
    if (lifetime.disposed) return;
    const context = room == null ? room : roomReader.forRecord(room);
    if (room != null && !context) return;
    await window.ViberoomCarry.open(context, { ...dialogPorts, openRoom: (id) => selectRoom(id) });
  }

  lifetime.on(els.carryBtn, "click", () => {
    const room = currentRoom();
    if (room) void openCarry(room);
  });
  listenKey((event) => {
    if (event.key === "Escape" && state.detailsOpen && !$("dialog[open]") && !editingInDetails()) closeDetails();
  });
  lifetime.on(window, "beforeunload", () => remember("view", state.view));


  const MINE_SLOT_H = 2;
  let timelineIdentities = new WeakMap();
  lifetime.own(() => { timelineIdentities = new WeakMap(); });
  function timelineContext() {
    if (lifetime.disposed || state.view !== "room") return undefined;
    const record = currentRoom(), search = state.search;
    if (!record) return undefined;
    const held = () => !lifetime.disposed && state.view === "room" && currentRoom() === record
      && state.rooms.get(record.id) === record && state.search === search;
    let roomIdentity = timelineIdentities.get(record);
    if (!roomIdentity) {
      roomIdentity = roomReader.identityForRecord(record);
      if (!roomIdentity || !held()) return undefined;
      timelineIdentities.set(record, roomIdentity);
    }
    return roomIdentity && held() ? { record, roomIdentity, search, held } : undefined;
  }
  let timelinePositions = new WeakMap();
  lifetime.own(() => { timelinePositions = new WeakMap(); });
  function timelineNumbers(account, rows, heights) {
    ListIndex.total(account);
    let cache = timelinePositions.get(account);
    if (!cache || cache.source !== account.tops) {
      cache = { source: account.tops, rows: new WeakMap() };
      timelinePositions.set(account, cache);
    }
    let value = cache.rows.get(rows);
    if (!value || heights && !value.heights) {
      value = Object.freeze({ tops: value?.tops || Object.freeze(rows.map(row => ListIndex.topOf(account, row.at))),
        heights: heights ? Object.freeze(rows.map(row => ListIndex.heightAt(account, row.at))) : undefined });
      cache.rows.set(rows, value);
    }
    return !heights && value.heights ? Object.freeze({ tops: value.tops, heights: undefined }) : value;
  }
  timelineReader = lifetime.use(VIBEROOM_TIMELINE_READER.create({
    window: document.defaultView, signal: lifetime.signal, current: timelineContext, keyOf: roomRecordKey, itemsOf: listItems,
    accountOf: () => listAccount, headersFor: (room, ids) => conversationReader.timelineHeadersFor(room, ids),
    matches: (room, id, search) => conversationReader.timelineMatchesFor(room, id, search),
    headerStampOf: room => conversationState.collectionsOf(room)?.heldHeaders,
    positionsOf: timelineNumbers,
    previewsFor: (room, ids) => conversationReader.timelinePreviewsFor(room, ids),
    colorsFor: (room, froms) => {
      const facts = roomReader.forRecord(room);
      const held = () => !lifetime.disposed && state.view === "room" && currentRoom() === room && state.rooms.get(room.id) === room;
      if (!facts || !held()) return undefined;
      const result = [];
      for (const from of froms) {
        const participant = findById(facts, from), color = participant ? colourOf(participant) : FALLBACK_COLOR();
        if (!held()) return undefined;
        result.push(Object.freeze({ from, color }));
      }
      return held() ? Object.freeze(result) : undefined;
    },
    authorFor: (room, from, wantsAvatar) => {
      const facts = roomReader.forRecord(room);
      const held = () => !lifetime.disposed && state.view === "room" && currentRoom() === room && state.rooms.get(room.id) === room;
      if (!facts || !held()) return undefined;
      const participant = findById(facts, from), color = participant ? colourOf(participant) : FALLBACK_COLOR();
      if (!held()) return undefined;
      const face = wantsAvatar && participant ? avatar(participant, 16, {}) : "";
      return held() ? Object.freeze({ color, avatar: face }) : undefined;
    },
    changed: room => { if (timelineReady && currentRoom() === room && state.view === "room") renderTimelineSoon(false); },
  }));
  function createTimeline(root, opts) {
    const patch = KeyedList.patch;
    return lifetime.use(VIBEROOM_TIMELINE_VIEW.create(root, opts, {
      signal: lifetime.signal, currentFacts: timelineReader.currentFacts, holds: timelineReader.holds, valid: timelineReader.valid,
      mapFor: timelineReader.mapFor, rowsFor: timelineReader.rowsFor, positionsFor: timelineReader.positionsFor,
      previewsFor: timelineReader.previewsFor, authorFor: timelineReader.authorFor, colorsFor: timelineReader.colorsFor, Layout,
      patchSlots: (facts, live, list, items, spec) => {
        if (!live() || !timelineReader.valid(facts) || !live()) return undefined;
        patch(list, items, spec);
        return live() && timelineReader.valid(facts) && live() ? true : undefined;
      },
      drawnRow: (identity, id) => timelineReader.holds(identity) ? drawnRow(id) : null,
      jumpToId: (identity, id) => timelineReader.holds(identity) ? jumpToId(id) : false,
      esc, ic, hoverDelayMs, requestViewportWork, markUserScroll: () => { lastUserScrollAt = Date.now(); },
      messages: els.messages, app: els.app, timeline: globalThis.VIBEROOM_TIMELINE,
    }));
  }
  function bubbleInView(id) {
    const head = els.messages.querySelector(`.msg[data-id="${id}"] .msg-head`);
    if (!head) return false;
    const box = Layout.rect(els.messages);
    const r = Layout.rect(head);
    return r.bottom > box.top && r.top < box.bottom;
  }
  const cornerNotes = lifetime.use(VIBEROOM_CORNER_NOTES.create(els.doneNotes, {
    signal: lifetime.signal, avatar, inView: bubbleInView, onPick: (id) => void jumpToId(id),
  }));
  function noteFinished(room, m) {
    if (room.id !== state.currentRoomId || state.view !== "room") return;
    cornerNotes.offer(m.id, () => {
      const p = findById(room, m.from) || { name: m.fromName, color: FALLBACK_COLOR(), kind: "agent" };
      return { kind: "done", p, text: `${p.name} finished`, sub: `started ${time(m.ts)}${m.durationMs ? ` · ${spanText(m.durationMs)}` : ""}` };
    });
  }
  function noteNew(room, m) {
    if (room.id !== state.currentRoomId || state.view !== "room") return;
    cornerNotes.offer(m.id, () => {
      const p = findById(room, m.from) || { name: m.fromName, color: FALLBACK_COLOR(), kind: "agent" };
      return { kind: "new", p, text: `${p.name} wrote below`, sub: time(m.ts) };
    });
  }
  function spanText(ms) {
    if (!ms) return "";
    return fmtDuration(ms);
  }
  async function jumpToId(id, align = "center") {
    if (lifetime.disposed || !id) return false;
    const initial = currentRoom();
    if (initial?.history?.indexed && initial.messages.find(m => m.id === id)?.bodyMissing) {
      const bodiesLoaded = await loadBodies(initial, [id], true);
      if (lifetime.disposed || currentRoom() !== initial) return false;
      if (!bodiesLoaded) {
        toast("This message could not be loaded. Try again when the connection is back.", "warn");
        return false;
      }
      if (currentRoom() !== initial) return false;
    }
    if (jumpToMessage(els.messages.querySelector(`.msg[data-id="${cssEscape(id)}"]`), null, align)) return true;
    const room = currentRoom();
    const held = room && HistoryWindow.knownMessages(room).find((m) => m.id === id);
    const revealed = held && held.seq > 0 && await revealSeq(held.seq);
    if (lifetime.disposed || currentRoom() !== initial) return false;
    if (revealed) return true;
    const refreshed = room && await refreshHeld(room.id, { messageId: id, reader: { id, into: 12 } });
    if (lifetime.disposed || currentRoom() !== initial) return false;
    if (refreshed) {
      const ready = drawnRow(id);
      if (ready) return jumpToMessage(ready, null, align);
      const at = room.messages.findIndex(m => m.id === id);
      if (at >= 0) {
        setFoldIndex(room, Math.max(0, at - FOLD_STEP));
        leaveTheEnd();
        renderMessages("a message was asked for by id", { id, into: 12 });
        return jumpToMessage(els.messages.querySelector(`.msg[data-id="${cssEscape(id)}"]`), null, align);
      }
    }
    toast("That message could not be reached; it may be older than this room holds.");
    return false;
  }

  function jumpToPassage(el, fragment) {
    if (!el || !el.isConnected) return false;
    const room = currentRoom();
    const m = messageOfNode(el);
    const text = String(fragment || "").trim();
    if (!room || !m || !text || wholeMessage(m, text)) return jumpToMessage(el);
    const words = () => el.querySelector(".bubble > .text > .words");
    let passage = Passage.find(words(), text);
    if (!passage && el.querySelector(".bubble > .text.clamped")) {
      setExpanded(el, room.id, m, true);
      passage = Passage.find(words(), text);
      if (!passage) setExpanded(el, room.id, m, false);
    }
    return jumpToMessage(el, passage);
  }
  function wholeMessage(m, text) {
    const whole = String(m.text || "").trim();
    return whole === text || (text.length >= QUOTE_TEXT_MAX && whole.startsWith(text));
  }
  const QUOTE_TEXT_MAX = 4000;
  let passageCleanup = null;
  function lightPassage(range) {
    passageCleanup?.();
    if (!globalThis.CSS?.highlights || typeof Highlight !== "function") return false;
    CSS.highlights.set("viberoom-quote-passage", new Highlight(range));
    const out = () => {
      CSS.highlights.delete("viberoom-quote-passage");
      releasePointer();
      releaseKey();
      if (passageCleanup === out) passageCleanup = null;
    };
    passageCleanup = out;
    const releasePointer = lifetime.on(uiRoot, "pointerdown", out, true);
    const releaseKey = listenKey(out, true);
    return true;
  }

  function jumpToMessage(el, passage = null, align = "center") {
    if (!el || !el.isConnected) return false;
    glideStop("a jump to a message");
    leaveTheEnd();
    scrollToMessage(el, passage ? "center" : align, passage);
    if (passage && lightPassage(passage)) return true;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    return true;
  }
  const MESSAGE_EDGE = 16;
  function scrollTopFor(r, align) {
    const m = els.messages;
    const box = Layout.rect(m);
    if (align === "end") return m.scrollTop + (r.bottom - box.bottom) + MESSAGE_EDGE;
    if (r.height > box.height - 2 * MESSAGE_EDGE) return m.scrollTop + (r.top - box.top) - MESSAGE_EDGE;
    return m.scrollTop + (r.top - box.top) - (box.height - r.height) / 2;
  }
  function seenAsAsked(r, align) {
    const box = Layout.rect(els.messages);
    if (align === "end") return r.bottom <= box.bottom && r.bottom >= box.top + box.height / 2;
    if (r.height > box.height - 2 * MESSAGE_EDGE) return r.top >= box.top && r.top <= box.top + 2 * MESSAGE_EDGE;
    return inView(r);
  }
  function scrollToMessage(el, align, passage = null) {
    const target = () => Layout.rect(passage || el);
    if (seenAsAsked(target(), align)) return;
    glideStop("a message brought into view");
    leaveTheEnd();
    const m = els.messages;
    const from = m.scrollTop;
    m.scrollTop = scrollTopFor(target(), align);
    requestAnimationFrame(() => {
      const to = scrollTopFor(target(), align);
      m.scrollTop = to + (to < from ? 240 : -240);
      m.scrollTo({ top: to, behavior: "smooth" });
    });
  }
  function inView(r) {
    const box = Layout.rect(els.messages);
    const shown = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
    return shown >= Math.min(r.height, box.height) - 1;
  }
  const drawnRow = (id) => els.messages.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
  const timelines = [
    createTimeline($("#timeline"), { mine: true, slotH: MINE_SLOT_H }),
    createTimeline($("#timeline-left"), { colored: true }),
  ];
  let timelineFramePrepared = false;
  function readViewportGeometry() {
    const m = els.messages, beforeTop = m.scrollTop, height = m.clientHeight;
    const total = m.scrollHeight || 1;
    return { beforeTop, aboveDelta: 0, width: m.clientWidth, total, height,
      top: stuck && !humanHoldsText() ? Math.max(0, total - height) : beforeTop };
  }
  function prepareTimelineFrame(force) { return timelines.map(t => t.prepare(force)); }
  function measureTimelineFrame(plans, viewport) {
    timelines.forEach((t, i) => t.measure(plans[i], viewport));
    timelineFramePrepared = true;
  }
  function releaseTimelineFrame() {
    for (const t of timelines) t.releaseGeometry();
    timelineFramePrepared = false;
  }
  function renderTimeline(force) {
    const t0 = performance.now();
    if (!timelineFramePrepared) {
      const plans = prepareTimelineFrame(force);
      measureTimelineFrame(plans, readViewportGeometry());
    }
    try { for (const t of timelines) t.render(force); }
    finally { releaseTimelineFrame(); }
    renderPins();
    noteSlow("timeline strips", performance.now() - t0);
  }
  function renderTimelineAfterList() {
    if (viewportRunning?.full) { renderTimeline(true); return; }
    if (timelines.every((t) => t.mapped())) {
      renderTimelineSoon(false);
      if (timelineFramePrepared) { updateTimelineView(); releaseTimelineFrame(); }
    }
    else renderTimeline();
  }
  function updateTimelineView(viewport) {
    if (!viewport && !timelineFramePrepared) viewport = readViewportGeometry();
    const views = timelines.map((t) => t.readView(viewport));
    timelines.forEach((t, i) => t.updateView(views[i]));
  }
  function rescaleTimeline() { for (const t of timelines) t.rescale(); }
  function followConversation() { requestViewportWork({ timeline: true }); }
  attachScrollHints(els.pageInner);
  attachScrollHints(els.detailsInner);
  $$("dialog.dialog").forEach((d) => attachScrollHints(d));
  const composerFollowers = [els.mentionMenu, els.emojiMenu];
  domResources.observe(ResizeObserver, () => {
    requestViewportWork({ composer: true, timeline: true });
    renderTimelineSoon(true);
  }).observer.observe(els.composer);
  domResources.observe(ResizeObserver, () => {
    requestViewportWork({ timeline: true, resize: true });
    renderTimelineSoon(true);
  }).observer.observe(els.messages);
  lifetime.wait(document.fonts.ready).then(lifetime.guard(() => renderTimeline()), error => { if (!lifetime.disposed) showError(error); });
  let timelineTimer = 0;
  let timelineFull = false;
  timelineReady = true;
  function renderTimelineSoon(full) {
    timelineFull = timelineFull || full;
    if (timelineTimer) return;
    const typing = Date.now() - lastTypedAt < TYPING_WINDOW_MS;
    timelineTimer = setTimeout(() => {
      timelineTimer = 0;
      if (Date.now() - lastTypedAt < TYPING_WINDOW_MS) renderTimelineSoon(false);
      else {
        const full = timelineFull;
        timelineFull = false;
        requestViewportWork({ timeline: true, full });
      }
    }, typing ? TYPING_WINDOW_MS : 300);
  }
  domResources.observe(MutationObserver, (records) => {
    const structural = records.some((r) => r.target === els.messages || (r.target.classList && r.target.classList.contains("msgs-page")));
    if (structural) reconcileWatched();
    renderTimelineSoon(structural);
  }).observer.observe(els.messages, { childList: true, subtree: true });

  const workingNow = lifetime.use(VIBEROOM_WORKING_NOW.create($("#working-now"), {
    signal: lifetime.signal, avatar, noteFinding,
    onPick: (id) => {
      const room = currentRoom();
      if (!room) return;
      const m = [...room.messages].reverse().find((x) => x.from === id && x.kind === "chat");
      if (m?.streaming) void jumpToId(m.id);
      else scrollToBottom("the working figure was clicked", { byHand: true });
    },
  }));
  function renderWorkingNow() {
    const room = currentRoom();
    workingNow.render(room && state.view === "room" ? room.participants.filter((p) => p.kind === "agent" && p.status === "thinking") : []);
  }
  function updateWorkingNow() { workingNow.update(); }

  const contextRing = VIBEROOM_CONTEXT_RING.create({ window, fmtTokens });
  function lifeOf(p) { return contextRing.lifeOf(p); }
  function contextWords(p) { return contextRing.words(p); }
  function recentContextEvent(p) { return contextRing.recentEvent(p); }
  function contextEventText(p, ev) { return contextRing.eventText(p, ev); }
  function patchLifeRing(li, p) { contextRing.patch(li, p); }
  function lastReplyUsage(room, p) {
    const last = [...room.messages].reverse().find((m) => m.from === p.id && m.usage) || (room.history?.latest?.[p.id]?.usage ? room.history.latest[p.id] : null);
    return last ? last.usage : null;
  }
  function lastReplyWords(room, p) {
    const usage = lastReplyUsage(room, p);
    return usage ? `${fmtTokens(usage.inputTokens)} in, ${fmtTokens(usage.outputTokens)} out` : "—";
  }
  function panelLastReplyWords(room, participant) {
    if (lifetime.disposed || state.rooms.get(room.id) !== room) return "—";
    return lastReplyWords(room, participant);
  }
  let lifePop = null;
  let hoverTimer = null;
  let quietRow = null;
  function quietGlance(li) {
    quietRow = li;
    clearTimeout(hoverTimer);
    closeLifePop();
  }
  function openLifePop(p, li) {
    closeLifePop();
    const el = document.createElement("div");
    el.className = "life-pop";
    uiRoot.appendChild(el);
    lifePop = { id: p.id, anchor: li, el };
    domResources.nodeListener(el, "mouseenter", () => clearTimeout(hoverTimer));
    domResources.nodeListener(el, "mouseleave", () => lifePop && scheduleHoverClose());
    renderLifePop();
  }
  function scheduleHoverClose() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (lifePop && !lifePop.el.matches(":hover") && !lifePop.anchor.matches(":hover")) closeLifePop();
    }, 180);
  }
  const asksGlance = (el, li) => !!el && li.contains(el) && !el.closest("button");
  lifetime.on(els.roster, "mouseover", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li || li === quietRow) return;
    const room = currentRoom();
    const p = room && findById(room, li.dataset.id);
    if (!p || p.kind !== "agent" || p.status === "unstaffed") return;
    if (lifePop && lifePop.id === p.id) return void clearTimeout(hoverTimer);
    if (!asksGlance(e.target, li)) return void clearTimeout(hoverTimer);
    if (asksGlance(e.relatedTarget, li)) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openLifePop(p, li), hoverDelayMs(true));
  });
  lifetime.on(els.roster, "mouseout", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li || (e.relatedTarget && li.contains(e.relatedTarget))) return;
    if (li === quietRow) quietRow = null;
    clearTimeout(hoverTimer);
    if (lifePop && lifePop.id === li.dataset.id) scheduleHoverClose();
  });
  function closeLifePop() {
    if (!lifePop) return;
    lifePop.el.remove();
    lifePop = null;
  }
  function renderLifePop() {
    if (!lifePop) return;
    const room = currentRoom();
    const p = room && findById(room, lifePop.id);
    if (!p || state.view !== "room" || !lifePop.anchor.isConnected) return closeLifePop();
    const el = lifePop.el;
    const { left, tone } = lifeOf(p);
    const usage = lastReplyUsage(room, p);
    el.innerHTML = `<div class="lp-main">
        <div class="lp-head">${avatar(p, 28, {})}<div><b>${esc(p.name)}</b><div class="lp-sub">${tone === "fresh" ? "fresh session: nothing used yet" : tone === "unknown" ? (p.contextUsed ? `context: ${fmtTokens(p.contextUsed)} tokens in use, window size not reported` : "context not reported by this agent") : `context ${fmtTokens(p.contextUsed)} of ${fmtTokens(p.contextSize)} used · <b>${left} % left</b>`}</div></div></div>
        <div class="life-bar life-${tone}"><i style="width:${left ?? 0}%"></i></div>
        ${p.contextEvent ? `<div class="lp-event${recentContextEvent(p) && p.contextEvent.kind !== "threshold" ? " fresh" : ""}">${ic("info")} ${esc(contextEventText(p, p.contextEvent))}</div>` : ""}
        <div class="kv lp-kv">
          <span>Last reply</span><span>${usage ? `<span title="tokens in">${ic("arrow-down")} ${fmtTokens(usage.inputTokens)}</span> <span title="tokens out">${ic("arrow-up")} ${fmtTokens(usage.outputTokens)}</span>` : "—"}</span>
          <span>Cost (estimate)</span><span>${fmtCost(p.cost) || "—"}</span>
          <span>Turns</span><span>${p.turns}</span>
          <span>Notes</span><span>${p.notesTurn ? "being written" : p.notes ? `written ${p.notesWrittenAt ? relTime(p.notesWrittenAt) : "earlier"}` : "none yet"}</span>
        </div>
        <div class="lp-sub lp-foot">A click goes to its last reply; the gear opens its panel.</div>
      </div>`;
    const r = Layout.rect(lifePop.anchor);
    el.style.left = `${Math.round(r.right + 12)}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(r.top - 10, Layout.length(window.innerHeight) - el.offsetHeight - 8)))}px`;
  }
  async function respawnWith(p, n) {
    const text =
      n > 0
        ? `${p.name} starts over with a new session that gets only ${p.notes ? "its own notes and " : ""}the last ${n} messages of this room. You keep the history; the rest of its memory is gone.`
        : `${p.name} forgets this whole conversation and starts over. You keep the history; it does not.`;
    const ok = await confirmDialog(text, { title: `A fresh start for ${p.name}?`, okLabel: "Fresh start", danger: true });
    if (!ok) return;
    closeLifePop();
    try {
      await post(roomApi(`/participants/${encodeURIComponent(p.id)}/respawn`), { memory: n > 0, replay: n });
    } catch (e) {
      showError(e);
    }
  }
  lifetime.on(uiRoot, "click", (e) => {
    if (lifePop && !e.target.closest(".life-pop")) closeLifePop();
  });
  listenKey((e) => {
    if (e.key === "Escape" && lifePop) closeLifePop();
  });

  const pinYearFormatter = new Intl.DateTimeFormat([], { day: "numeric", month: "short", year: "numeric" });
  function pinWhen(ts, now = Date.now()) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    if (localDay(ts) === localDay(now)) return time(ts);
    const day = (d.getFullYear() === new Date(now).getFullYear() ? shortDateFormatter : pinYearFormatter).format(d);
    return `${day}, ${time(ts)}`;
  }
  function roomForReaderIdentity(identity) {
    if (lifetime.disposed || !identity) return undefined;
    const room = state.rooms.get(identity.id);
    return room && roomReader.identityForRecord(room) === identity ? room : undefined;
  }
  function canRenderPins(identity) {
    if (identity === null) return !lifetime.disposed;
    const room = roomForReaderIdentity(identity);
    return !!room && state.view === "room" && room === currentRoom();
  }
  function pinRow(identity, pin) {
    const room = roomForReaderIdentity(identity);
    if (!room) return undefined;
    const id = pin.header.id, fresh = conversationReader.headerFor(room, id);
    if (!fresh || fresh.token !== pin.token || fresh.headerToken !== pin.headerToken) return undefined;
    const preview = conversationReader.previewFor(room, id, 160), facts = roomReader.forRecord(room);
    if (!preview || !facts) return undefined;
    const now = conversationReader.headerFor(room, id);
    if (!now || now.token !== pin.token || now.headerToken !== pin.headerToken || !roomForReaderIdentity(identity)) return undefined;
    const m = now.header, p = findById(facts, m.from);
    const who = m.from === "human" ? Object.assign(meAvatarData(), { color: (p || {}).color }) : p;
    const text = preview.preview || (preview.imageCount ? `[${preview.imageCount} image${preview.imageCount === 1 ? "" : "s"}]` : "");
    return Object.freeze({ id: m.id, mine: m.from === "human", face: who ? avatar(who, 16, {}) : "", text, label: m.pinLabel || "", placeholder: preview.preview.slice(0, 80), when: pinWhen(m.ts) });
  }
  const pins = lifetime.use(VIBEROOM_PINS.create({ button: $("#pins-btn"), panel: $("#pins-panel"), outside: uiRoot }, {
    signal: lifetime.signal, icon: ic, glyph: () => rig("pin-solid"),
    describe: (pin, identity) => pinRow(identity, pin),
    canRender: canRenderPins,
    refresh: () => renderPins(),
    onJump: (identity, id) => { const room = roomForReaderIdentity(identity); if (room && room === currentRoom()) void jumpToId(id); },
    onUnpin: async (identity, id) => {
      const room = roomForReaderIdentity(identity);
      if (!room) return;
      try {
        await roomCommands.forRoom(room).pinMessage(id, false);
      } catch (error) {
        showError(error);
      }
    },
    onLabel: async (identity, id, label) => {
      const room = roomForReaderIdentity(identity);
      if (!room) return;
      try {
        await roomCommands.forRoom(room).labelPin(id, label);
      } catch (error) {
        showError(error);
      }
    },
  }));
  function renderPins() {
    const room = currentRoom();
    if (!room || state.view !== "room") { pins.render([], null); return; }
    const identity = roomReader.identityForRecord(room), list = identity && conversationReader.pinsFor(room);
    if (identity && list) pins.render(list, identity);
  }

  const folderPicker = lifetime.use(VIBEROOM_FOLDER_PICKER.create($("#folder-dialog"), {
    window: document.defaultView, signal: lifetime.signal, UI, icon: ic,
    readDirs: path => get(path === undefined ? "/api/fs/dirs" : `/api/fs/dirs?path=${encodeURIComponent(path)}`),
    makeDir: (parent, name) => post("/api/fs/mkdir", { parent, name }),
    recentDirs: () => [...state.rooms.values()].map(room => room.dir),
    openDialog, closeDialog,
  }));
  function openFolderPicker(initial, onChoose) { return folderPicker.open(initial, onChoose); }
  const folderChange = lifetime.use(VIBEROOM_FOLDER_CHANGE.create($("#folder-change-dialog"), {
    window: document.defaultView, signal: lifetime.signal, icon: ic, openDialog, closeDialog,
  }));

  if (!state.embedded && !document[PLACEMENT] && window.matchMedia("(display-mode: standalone)").matches) {
    const placementOwner = VIBEROOM_APP_LIFETIME.create({ window });
    Object.defineProperty(document, PLACEMENT, { value: placementOwner });
    const placement = () => ({
      left: window.screenX,
      top: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
      maximized: window.outerWidth >= screen.availWidth - 2 && window.outerHeight >= screen.availHeight - 2,
      screen: { left: screen.availLeft, top: screen.availTop, width: screen.availWidth, height: screen.availHeight },
    });
    const minimized = (p) => p.left <= -30000 || p.top <= -30000 || p.width < 100 || p.height < 100;
    const overlaps = (p) => p.left < p.screen.left + p.screen.width - 40 && p.left + p.width > p.screen.left + 40 && p.top < p.screen.top + p.screen.height - 40 && p.top + p.height > p.screen.top;
    const first = placement();
    if (!minimized(first) && !overlaps(first)) {
      window.resizeTo(Math.min(first.width, first.screen.width), Math.min(first.height, first.screen.height));
      window.moveTo(first.screen.left, first.screen.top);
    }
    let lastReport = "";
    let reportTimer = null;
    const report = (keepalive) => {
      const p = placement();
      if (minimized(p)) return;
      const json = JSON.stringify(p);
      if (json === lastReport) return;
      lastReport = json;
      fetch("/api/window", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: json, keepalive, signal: deadline(10000) }).catch(() => {});
    };
    const scheduleReport = () => {
      placementOwner.clearTimeout(reportTimer);
      reportTimer = placementOwner.timeout(() => report(false), 800);
    };
    placementOwner.on(window, "resize", scheduleReport);
    placementOwner.interval(scheduleReport, 3000);
    placementOwner.on(window, "pagehide", () => report(true));
  }

  setInterval(tickLive, 1000);

  lifetime.on(window, "pagehide", rememberHeldTurns);

  lifetime.on(uiRoot, "click", event => { const button = event.target.closest("[data-memory-open]"); if (button) void window.ViberoomMemory.open(currentRoom()?.id, button.dataset.memoryOpen, dialogPorts); });
  function releaseDomState() {
    readerRestoreCleanup?.();
    passageCleanup?.();
    textPress = null; heldTextElement = null; chatSelection = null; selectionDuringPatch = null; selectionDuringPatchOwner = null;
    observedRows.clear(); watchedNodes.clear();
  }
  lifetime.own(releaseDomState);
  lifetime.own(() => {
    for (const dialog of $$("dialog[open]")) dialog.close();
    for (const collection of [state.unread, state.expanded, state.watched,
      bursts, shownHold, editors, dayLabels, recentlySaved, openTools,
      openToolGroups, returnPlaces, foldAnchor, measuredRows, measuredIndexes, rowInsets, dirty, draftComposers,
      rowPrices.perKind, rowPrices.said, configChanging, installationChecked, vendorChoicesAsked,
      secretCards, secretCopied, reconnectPrompted]) collection.clear();
    listAccount = drawnWindow = viewportWork = viewportRunning = null;
    state.openRooms.length = 0; afterRender.length = 0;
    pendingShots.length = 0; pendingQuotes.length = 0; detachedShots.length = 0; detachedQuotes.length = 0;
    for (const kind of Object.values(timedDraft)) { kind.pending.length = 0; kind.detached.length = 0; }
  });
  if (state.embedded) {
    if (options.initialView === "settings") void requestSettings(options.category);
    else if (options.initialView === "host") void leaveView();
    else void update({ roomId: options.roomId, scope: options.scope });
  }
  connect();
  void askKey();
  return Object.freeze({ ready, update, openSettings: requestSettings, leaveView, dispose, settings: settingsModel.reader });
  }
  root.VIBEROOM_APP = Object.freeze({ startStandalone, mount, mountApplication });
  const document = root.document;
  if (document && !document.querySelector('meta[name="viberoom-embed"]')) {
    try { startStandalone(document); }
    catch (error) { recoverStartup(document, error); }
  }
})(globalThis);
