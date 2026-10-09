#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const unpatched = args.includes("--unpatched");
const outAt = args.indexOf("--out");
if (outAt >= 0 && !args[outAt + 1]) throw new Error("--out needs a folder");
const out = outAt >= 0 ? resolve(args[outAt + 1]) : join(root, "vendor", "acp");
if (unpatched && outAt < 0) throw new Error("--unpatched writes elsewhere than vendor/acp/: give --out");
const vendorRoot = join(root, "vendor");
if (unpatched && (out === vendorRoot || out.startsWith(vendorRoot + sep))) throw new Error("--unpatched does not write into vendor/, which the npm package carries: give a folder outside it");
const VENDORED = new Set(["claude-agent-acp", "claude-agent-sdk", "codex-acp"]);
if (outAt >= 0 && existsSync(out) && readdirSync(out).some((name) => !VENDORED.has(name))) {
  throw new Error(`--out ${out} holds other things; give a new or empty folder`);
}
function packageDir(name) {
  const dir = join(root, "node_modules", name);
  if (!existsSync(join(dir, "package.json"))) throw new Error(`${name} is not installed; run npm install first`);
  return dir;
}
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function writeManifest(dir, pkg) {
  const kept = { name: pkg.name, version: pkg.version, type: pkg.type, license: pkg.license, main: pkg.main };
  writeFileSync(join(dir, "package.json"), JSON.stringify(kept, null, 2) + "\n");
}

function copyLicence(from, to) {
  for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    if (existsSync(join(from, name))) cpSync(join(from, name), join(to, name));
  }
}

function jsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...jsFiles(path));
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) files.push(path);
  }
  return files;
}

rmSync(out, { recursive: true, force: true });

{
  const from = packageDir("@agentclientprotocol/codex-acp");
  const to = join(out, "codex-acp");
  mkdirSync(join(to, "dist"), { recursive: true });
  cpSync(join(from, "dist", "index.js"), join(to, "dist", "index.js"));
  writeManifest(to, readJson(join(from, "package.json")));
  copyLicence(from, to);
  if (!unpatched) {
    patchCodexAdapter(join(to, "dist", "index.js"));
    patchCodexStandingBrief(join(to, "dist", "index.js"));
    patchCodexBackgroundDelivery(join(to, "dist", "index.js"));
  }
}

{
  const sdkFrom = packageDir("@anthropic-ai/claude-agent-sdk");
  const sdkTo = join(out, "claude-agent-sdk");
  const sdkPkg = readJson(join(sdkFrom, "package.json"));
  const adapterPkg = readJson(join(packageDir("@agentclientprotocol/claude-agent-acp"), "package.json"));
  const pinned = adapterPkg.dependencies?.["@anthropic-ai/claude-agent-sdk"];
  if (pinned !== sdkPkg.version) throw new Error(`claude-agent-acp ${adapterPkg.version} is built against @anthropic-ai/claude-agent-sdk ${pinned}, but ${sdkPkg.version} is installed; set the SDK's devDependency in package.json to ${pinned}`);
  mkdirSync(sdkTo, { recursive: true });
  for (const file of sdkPkg.files ?? []) {
    if (existsSync(join(sdkFrom, file))) cpSync(join(sdkFrom, file), join(sdkTo, file), { recursive: true });
  }
  writeManifest(sdkTo, sdkPkg);
  copyLicence(sdkFrom, sdkTo);

  const from = packageDir("@agentclientprotocol/claude-agent-acp");
  const to = join(out, "claude-agent-acp");
  mkdirSync(to, { recursive: true });
  cpSync(join(from, "dist"), join(to, "dist"), {
    recursive: true,
    filter: (src) => statSync(src).isDirectory() || src.endsWith(".js"),
  });
  writeManifest(to, readJson(join(from, "package.json")));
  copyLicence(from, to);

  const sdkEntry = join(sdkTo, "sdk.mjs");
  let rewritten = 0;
  for (const file of jsFiles(join(to, "dist"))) {
    let rel = relative(dirname(file), sdkEntry).split(sep).join("/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    const before = readFileSync(file, "utf8");
    const after = before.replace(/(["'])@anthropic-ai\/claude-agent-sdk\1/g, `$1${rel}$1`);
    if (after !== before) {
      writeFileSync(file, after);
      rewritten += 1;
    }
  }
  if (!unpatched) {
    patchClaudeAdapter(join(to, "dist", "acp-agent.js"));
    patchClaudeBackgroundDelivery(join(to, "dist", "acp-agent.js"));
  }
  console.log(`vendored claude-agent-acp ${readJson(join(to, "package.json")).version} (${rewritten} files point at the vendored SDK ${sdkPkg.version})${unpatched ? ", unpatched" : ""}`);
}

console.log(`vendored codex-acp ${readJson(join(out, "codex-acp", "package.json")).version}${unpatched ? ", unpatched" : ""}`);

function backgroundPatcher(file, vendor) {
  let source = readFileSync(file, "utf8");
  return {
    once(anchor, replacement) {
      const first = source.indexOf(anchor);
      if (first < 0 || source.indexOf(anchor, first + 1) >= 0) throw new Error(`${vendor} changed: background-delivery anchor missing or ambiguous: ${anchor.slice(0, 80)}`);
      source = source.replace(anchor, replacement);
    },
    finish(imports) {
      const shebang = source.startsWith("#!") ? source.slice(0, source.indexOf("\n") + 1) : "";
      writeFileSync(file, shebang + `import { ${imports} } from "../../../../dist/acp-message-delivery.js";\n` + source.slice(shebang.length));
    },
  };
}

function patchClaudeBackgroundDelivery(file) {
  const patch = backgroundPatcher(file, "claude-agent-acp");
  patch.once('        let stopReason = "end_turn";', `        let stopReason = "end_turn";
        const backgroundDelivery = new ClaudeMessageDelivery(backgroundMessagesEnabled(this.clientCapabilities),
            notification => sendUpdate(notification),
            message => this.client.extNotification(BACKGROUND_MESSAGE_METHOD, message));`);
  patch.once('            if (update.sessionUpdate === "agent_message_chunk") {', `            if (routedNotification.sessionId === params.sessionId && backgroundDelivery.capture(routedNotification)) return;
            if (update.sessionUpdate === "agent_message_chunk") {`);
  patch.once('                if (session.emitRawSDKMessages &&', `                // An active request alone does not own SDK prose. The native UUID stamp does.
                if (message.parent_tool_use_id === null && (message.type === "stream_event" || message.type === "assistant")) {
                    const stamps = Array.isArray(message.user_message_uuids) ? message.user_message_uuids
                        : typeof message.user_message_uuid === "string" ? [message.user_message_uuid] : [];
                    if (stamps.some(uuid => (session.turnQueue ?? []).some(turn => turn.promptUuid === uuid && !turn.settled &&
                        !["discarded", "refused", "cancelled"].includes(turn.commandFinished)))) backgroundDelivery.bindOwned();
                }
                if (session.emitRawSDKMessages &&`);
  patch.once('                            session.orphanCommands.delete(message.user_message_uuid);', `                            backgroundDelivery.reset();
                            session.orphanCommands.delete(message.user_message_uuid);`);
  patch.once('                            if (viberoomResults.has(message.uuid)) {', `                            if (viberoomResults.has(message.uuid)) {
                                backgroundDelivery.reset();`);
  patch.once('                            const deliveredAssistantText = session.emittedAssistantText;', `                            // Final attribution follows the existing absorbed/orphan result contract.
                            // Flush before delivery tracking and before resolving the ACP prompt.
                            if (session.cancelled) backgroundDelivery.reset();
                            else if (isAutonomousResult) {
                                await backgroundDelivery.deliverBackground({ sessionId: params.sessionId,
                                    messageId: typeof message.uuid === "string" ? message.uuid : "",
                                    stopReason: ["cancelled"].includes(message.stop_reason) || ["aborted_streaming", "aborted_tools"].includes(message.terminal_reason) ? "cancelled"
                                        : message.is_error || message.subtype !== "success" || ["refusal", "max_tokens"].includes(message.stop_reason) ? "error" : "end_turn" },
                                    typeof message.result === "string" && message.num_turns !== 0 ? message.result : "");
                            } else if (session.activeTurn && !session.activeTurn.settled) await backgroundDelivery.deliverOwned();
                            else backgroundDelivery.reset();
                            const deliveredAssistantText = session.emittedAssistantText;`);
  patch.once('                        finally {\n                            if (!isAutonomousResult) {', `                        finally {
                            backgroundDelivery.reset();
                            if (!isAutonomousResult) {`);
  patch.once('                steering: {', `                "viberoom.backgroundMessages": 1,
                steering: {`);
  patch.finish("ClaudeMessageDelivery, backgroundMessagesEnabled, BACKGROUND_MESSAGE_METHOD");
}

function patchCodexBackgroundDelivery(file) {
  const patch = backgroundPatcher(file, "codex-acp");
  patch.once('    this.session = new ACPSessionConnection(connection, sessionState.sessionId);', `    this.session = new ACPSessionConnection(connection, sessionState.sessionId);
    this.backgroundDelivery = sessionState.viberoomBackgroundDelivery ??= new CodexMessageDelivery(
      backgroundMessagesEnabled(sessionState.viberoomClientCapabilities), sessionState.sessionId,
      notification => this.session.update(notification.update, notification.sessionId),
      message => connection.notify(BACKGROUND_MESSAGE_METHOD, message));`);
  patch.once('    if (updateEvent) {\n      await this.session.update(updateEvent, this.subagents.notificationSessionId(notification));\n    }', `    if (updateEvent) {
      const targetSession = this.subagents.notificationSessionId(notification);
      if (targetSession !== this.sessionState.sessionId || notification.params?.threadId !== this.sessionState.sessionId || !this.backgroundDelivery.capture(notification.params?.turnId,
        { sessionId: targetSession, update: updateEvent })) await this.session.update(updateEvent, targetSession);
    }
    if (notification.params?.threadId === this.sessionState.sessionId && notification.method === "item/completed" && notification.params.item.type === "agentMessage") {
      await this.backgroundDelivery.completedItem(notification.params.turnId, notification.params.item.id, notification.params.item.text);
    }
    if (notification.params?.threadId === this.sessionState.sessionId && notification.method === "turn/completed") {
      await this.backgroundDelivery.terminal(notification.params.turn.id,
        notification.params.turn.status === "interrupted" ? "cancelled" : notification.params.turn.status === "completed" ? "end_turn" : "error");
    }`);
  patch.once('    const activePrompt = this.trackActivePrompt(params.sessionId);', `    sessionState.viberoomClientCapabilities = this.clientCapabilities;
    // The handler creates the persistent delivery registry before turn/start can emit any event.
    const activePrompt = this.trackActivePrompt(params.sessionId);`);
  patch.once('      eventHandler = promptEventHandler;', `      eventHandler = promptEventHandler;
      promptEventHandler.backgroundDelivery.beginPrompt();
      let backgroundStartPending = true;
      activePrompt.viberoomBackgroundStart = async (turnId) => {
        // The native start returned an exact ID even if replaying buffered ACP text now fails.
        activePrompt.viberoomBackgroundNativeStart = false;
        await promptEventHandler.backgroundDelivery.claimPrompt(turnId);
        if (backgroundStartPending) {
          backgroundStartPending = false;
          await promptEventHandler.backgroundDelivery.endPromptStart();
        }
      };
      activePrompt.viberoomBackgroundEnd = async () => {
        if (backgroundStartPending) {
          backgroundStartPending = false;
          await promptEventHandler.backgroundDelivery.endPromptStart(activePrompt.viberoomBackgroundNativeStart === true);
        }
      };
      activePrompt.viberoomBackgroundPrepare = () => {
        if (!backgroundStartPending) {
          promptEventHandler.backgroundDelivery.beginPrompt();
          backgroundStartPending = true;
        }
      };`);
  patch.once('      onTurnStarted?.(turnStarted.turn.id);', '      await onTurnStarted?.(turnStarted.turn.id);');
  patch.once('      onTurnStarted?.(reviewStarted.turn.id, reviewStarted.reviewThreadId);', '      await onTurnStarted?.(reviewStarted.turn.id, reviewStarted.reviewThreadId);');
  patch.once('        this.handleCommandTurnStarted(sessionState, options, turnId, threadId);', '        return this.handleCommandTurnStarted(sessionState, options, turnId, threadId);');
  patch.once('      options.onTurnStarted(turnId, threadId);', '      return options.onTurnStarted(turnId, threadId);');
  patch.once('      const commandPromise = this.availableCommands.tryHandleCommand(params.prompt, sessionState, {', `      // /goal's native response has no turn ID. Keep its existing command lane isolated; the
      // bridge resumes after the command's explicit completion for later goal continuations.
      const viberoomLegacyGoal = this.availableCommands.parseCommand(params.prompt)?.name === "goal";
      if (viberoomLegacyGoal) promptEventHandler.backgroundDelivery.beginLegacyCommand();
      activePrompt.viberoomBackgroundLegacyEnd = () => {
        if (viberoomLegacyGoal) promptEventHandler.backgroundDelivery.endLegacyCommand();
      };
      const commandPromise = this.availableCommands.tryHandleCommand(params.prompt, sessionState, {`);
  patch.once('        onTurnStartPending: () => {\n          sessionState.lastTokenUsage = null;', `        onTurnStartPending: () => {
          activePrompt.viberoomBackgroundNativeStart = true;
          sessionState.lastTokenUsage = null;`);
  patch.once('        onTurnStarted: (turnId, threadId) => {\n          const turn = { threadId, turnId };', `        onTurnStarted: async (turnId, threadId) => {
          if (!viberoomLegacyGoal) await activePrompt.viberoomBackgroundStart(turnId);
          const turn = { threadId, turnId };`);
  patch.once('      if (commandResult.handled) {\n        promptNotificationsActive = false;', `      if (!commandResult.handled) {
        activePrompt.viberoomBackgroundLegacyEnd?.();
        activePrompt.viberoomBackgroundLegacyEnd = undefined;
      }
      if (commandResult.handled) {
        if (viberoomLegacyGoal) activePrompt.viberoomBackgroundNativeStart = false;
        promptNotificationsActive = false;`);
  patch.once('      const sendPromptPromise = this.runWithProcessCheck(', `      activePrompt.viberoomBackgroundNativeStart = true;
      const sendPromptPromise = this.runWithProcessCheck(`);
  patch.once('              (turnId) => {\n                const turn = { threadId: params.sessionId, turnId };', `              async (turnId) => {
                await activePrompt.viberoomBackgroundStart(turnId);
                const turn = { threadId: params.sessionId, turnId };`);
  patch.once('          (turnId) => {\n            const turn = { threadId: params.sessionId, turnId };', `          async (turnId) => {
            await activePrompt.viberoomBackgroundStart(turnId);
            const turn = { threadId: params.sessionId, turnId };`);
  patch.once('          const implementationPromise = this.runWithProcessCheck(', `          activePrompt.viberoomBackgroundPrepare();
          activePrompt.viberoomBackgroundNativeStart = true;
          const implementationPromise = this.runWithProcessCheck(`);
  patch.once('      promptNotificationsActive = false;\n      try {\n        await this.codexAcpClient.waitForSessionNotifications(params.sessionId);', `      promptNotificationsActive = false;
      activePrompt.viberoomBackgroundLegacyEnd?.();
      await activePrompt.viberoomBackgroundEnd?.();
      try {
        await this.codexAcpClient.waitForSessionNotifications(params.sessionId);`);
  patch.once('      _meta: {\n        steering: {', `      _meta: {
        "viberoom.backgroundMessages": 1,
        steering: {`);
  patch.finish("CodexMessageDelivery, backgroundMessagesEnabled, BACKGROUND_MESSAGE_METHOD");
}

function patchCodexAdapter(file) {
  let source = readFileSync(file, "utf8");
  const once = (anchor, replacement) => {
    const first = source.indexOf(anchor);
    if (first < 0 || source.indexOf(anchor, first + 1) >= 0) throw new Error(`codex-acp changed: the console-window patch anchor is missing or ambiguous: ${anchor.slice(0, 70)}`);
    source = source.replace(anchor, replacement);
  };
  once(
    'codex = process.platform === "win32" ? spawn(`"${codexPath}" app-server`, { shell: true, env: spawnEnv }) : spawn(codexPath, ["app-server"], { env: spawnEnv });',
    'codex = process.platform === "win32" && /\\.(?:cmd|bat)$/i.test(codexPath) ? spawn(`"${codexPath}" app-server`, { shell: true, env: spawnEnv, windowsHide: true }) : spawn(codexPath, ["app-server"], { env: spawnEnv, windowsHide: true });',
  );
  once(
    'codex = spawn(process.execPath, [bundledCodexPath, "app-server"], { env: spawnEnv });',
    'codex = spawn(process.execPath, [bundledCodexPath, "app-server"], { env: spawnEnv, windowsHide: true });',
  );
  writeFileSync(file, source);
  console.log("patched codex-acp: codex app-server starts without a console window on Windows, an .exe without cmd.exe");
}

function patchCodexStandingBrief(file) {
  let source = readFileSync(file, "utf8");
  const once = (anchor, replacement) => {
    const first = source.indexOf(anchor);
    if (first < 0 || source.indexOf(anchor, first + 1) >= 0) throw new Error(`codex-acp changed: the standing-brief patch anchor is missing or ambiguous: ${anchor.slice(0, 70)}`);
    source = source.replace(anchor, replacement);
  };
  once(
    "  async newSession(request) {\n",
    `  /** viberoom: the session's config with \`_meta.systemPrompt.append\` added to the developer instructions it has. */
  async viberoomStanding(config, request) {
    const append = request?._meta?.systemPrompt?.append;
    if (typeof append !== "string" || !append.trim()) return config;
    let own = config?.developer_instructions;
    if (typeof own !== "string") {
      try {
        own = (await this.codexClient.configRead({ includeLayers: false, cwd: request.cwd }))?.config?.developer_instructions;
      } catch (error) {
        own = void 0;
        // the room's rules still go; that the person's own instructions could not be kept is said, in the room's record
        console.error("viberoom: config/read failed (" + (error?.message ?? error) + "); the thread's developer instructions are the room's alone");
      }
    }
    return { ...config, developer_instructions: typeof own === "string" && own.trim() ? own + "\\n\\n" + append : append };
  }
  async newSession(request) {
`,
  );
  once(
    "      config: await this.createSessionConfig(request.cwd, additionalDirectories, request.mcpServers),\n",
    "      config: await this.viberoomStanding(await this.createSessionConfig(request.cwd, additionalDirectories, request.mcpServers), request),\n",
  );
  for (const method of ["resumeSession", "loadSession"]) {
    once(
      `  async ${method}(request, onSubscribed) {
    const additionalDirectories = readAdditionalDirectories(request.cwd, request.additionalDirectories, request._meta);
    await this.refreshSkills(request.cwd, additionalDirectories);
    const response = await this.resumeThread({
      excludeTurns: true,
      config: await this.createSessionConfig(request.cwd, additionalDirectories, request.mcpServers ?? []),`,
      `  async ${method}(request, onSubscribed) {
    const additionalDirectories = readAdditionalDirectories(request.cwd, request.additionalDirectories, request._meta);
    await this.refreshSkills(request.cwd, additionalDirectories);
    const response = await this.resumeThread({
      excludeTurns: true,
      config: await this.viberoomStanding(await this.createSessionConfig(request.cwd, additionalDirectories, request.mcpServers ?? []), request),`,
    );
  }
  writeFileSync(file, source);
  console.log("patched codex-acp: the standing part of the brief joins the developer instructions of every thread");
}

function patchClaudeAdapter(file) {
  let source = readFileSync(file, "utf8");
  const once = (anchor, replacement) => {
    const first = source.indexOf(anchor);
    if (first < 0 || source.indexOf(anchor, first + 1) >= 0) throw new Error(`claude-agent-acp changed: the absorbed-prompt patch anchor is missing or ambiguous: ${anchor.slice(0, 70)}`);
    source = source.replace(anchor, replacement);
  };
  once(
    "        const ensureActiveTurn = async (resultUserMessageUuid) => {",
    "        const ensureActiveTurn = async (resultUserMessageUuid, dispatchedTurn, explicitOwnership) => {",
  );
  once(`        const ensureActiveTurn = async (resultUserMessageUuid, dispatchedTurn, explicitOwnership) => {
            if (session.activeTurn) {
                if (!isHeldOpen(session.activeTurn)) {
                    return;`,
    `        const ensureActiveTurn = async (resultUserMessageUuid, dispatchedTurn, explicitOwnership) => {
            if (session.activeTurn) {
                if (!isHeldOpen(session.activeTurn)) {
                    if (explicitOwnership && dispatchedTurn && session.activeTurn !== dispatchedTurn) activateTurn(dispatchedTurn);
                    return;`);
  once(`                await settleActive(session.activeTurn.deferredSettle);
            }
            // Orphan accounting runs BEFORE the head check`,
    `                await settleActive(session.activeTurn.deferredSettle);
            }
            // A live command named by the SDK is not an inferred orphan or a FIFO guess.
            if (explicitOwnership && dispatchedTurn) {
                activateTurn(dispatchedTurn);
                return;
            }
            // Orphan accounting runs BEFORE the head check`);
  once(
    `            const head = firstUnsettledQueuedTurn();
            if (!head) {
                return;
            }
            activateTurn(head);`,
    `            const head = dispatchedTurn && !dispatchedTurn.settled ? dispatchedTurn : firstUnsettledQueuedTurn();
            if (!head) {
                return;
            }
            activateTurn(head);`,
  );
  once(
    "                        const isAutonomousResult = message.origin != null && AUTONOMOUS_RESULT_ORIGINS.has(message.origin.kind);",
    `                        // Prefer the SDK's explicit ownership list; lifecycle inference is for older producers.
                        const consumedUuids = Array.isArray(message.user_message_uuids)
                            ? new Set(message.user_message_uuids.filter((uuid) => typeof uuid === "string")) : null;
                        const absorbedPrompts = (session.turnQueue ?? []).filter((t) =>
                            !t.settled && !t.commandResultSeen && t.deferredSettle === undefined && t.steeredSettle === undefined
                            && !["discarded", "refused", "cancelled"].includes(t.commandFinished)
                            && (consumedUuids ? consumedUuids.has(t.promptUuid)
                                : (t.commandStarted || t.commandFinished === "completed" || session.activeTurn === t)));
                        // viberoom: never apply one result twice, including a repeated human result.
                        const viberoomResults = (session.viberoomResultUuids ??= new Set());
                        if (typeof message.uuid === "string") {
                            if (viberoomResults.has(message.uuid)) {
                                session.owedTrailingIdles++;
                                break;
                            }
                            viberoomResults.add(message.uuid);
                        }
                        // A stamped result of an already cancelled command cannot mark a newer command
                        // as having consumed its result. Drain only that known orphan, before bookkeeping.
                        if (typeof message.user_message_uuid === "string" && session.orphanCommands?.has(message.user_message_uuid)
                            && !(consumedUuids && absorbedPrompts.length)) {
                            session.orphanCommands.delete(message.user_message_uuid);
                            session.pendingEmptyInterruptionDiagnosticCommands?.delete(message.user_message_uuid);
                            session.owedTrailingIdles++;
                            break;
                        }
                        // Snapshot before result bookkeeping marks dispatched commands as having seen a result.
                        const dispatchedOwner = absorbedPrompts.includes(session.activeTurn) ? session.activeTurn : absorbedPrompts[0];
                        const isAutonomousResult = consumedUuids
                            ? absorbedPrompts.length === 0
                            : message.origin != null && AUTONOMOUS_RESULT_ORIGINS.has(message.origin.kind) && absorbedPrompts.length === 0;`,
  );
  once(
    "                                await ensureActiveTurn(message.user_message_uuid);",
    `                                await ensureActiveTurn(consumedUuids && dispatchedOwner ? dispatchedOwner.promptUuid : message.user_message_uuid, dispatchedOwner, consumedUuids !== null);
                                // Only after the adapter accepted the owner (orphan/cancel checks included).
                                // Share its terminal outcome rather than reactivating each command and resetting
                                // the stop reason/usage, or bypassing early refusal/error/deferral exits.
                                if (dispatchedOwner && session.activeTurn === dispatchedOwner) {
                                    const rest = absorbedPrompts.filter((turn) => turn !== dispatchedOwner);
                                    if (rest.length) {
                                        const share = (reason, settle) => {
                                            for (const extra of rest) {
                                                if (extra.settled) continue;
                                                session.fileChangeReporter?.finish(extra.fileChangeReport, reason);
                                                extra.settled = true;
                                                extra.usageMarkdownAbort?.abort();
                                                session.turnQueue = (session.turnQueue ?? []).filter((turn) => turn !== extra);
                                                settle(extra);
                                            }
                                        };
                                        const { resolve, reject } = dispatchedOwner;
                                        dispatchedOwner.resolve = (value) => {
                                            resolve(value);
                                            share(value.stopReason === "cancelled" ? "cancelled" : "notReported", (extra) => extra.resolve(value));
                                        };
                                        // the error and its title (0.86.0 rejects with both), for the owner and each absorbed command
                                        dispatchedOwner.reject = (error, title) => {
                                            reject(error, title);
                                            share("providerError", (extra) => extra.reject(error, title));
                                        };
                                    }
                                }`,
  );
  once("        const recordResultForOrphanCommands = () => {", "        const recordResultForOrphanCommands = (consumedUuids) => {");
  once("                if (!turn.settled && turn.commandStarted && !turn.commandFinished) {",
    "                if (!turn.settled && turn.commandStarted && !turn.commandFinished && (!consumedUuids || consumedUuids.has(turn.promptUuid))) {");
  once(`            if (session.activeTurn && session.orphanCommands?.size) {
                for (const [uuid, state] of session.orphanCommands) {
                    if (state === "started" || state === "zombie") {`,
    `            if (session.activeTurn && session.orphanCommands?.size) {
                for (const [uuid, state] of session.orphanCommands) {
                    if ((state === "started" || state === "zombie") && (!consumedUuids || consumedUuids.has(uuid))) {`);
  once("                        recordResultForOrphanCommands();", "                        recordResultForOrphanCommands(consumedUuids);");
  once(
    "                        const viberoomResults = (session.viberoomResultUuids ??= new Set());",
    `                        console.error("viberoom-trace result uuid=" + (typeof message.uuid === "string" ? message.uuid : "none") + " turn=" + (session.activeTurn ? (session.activeTurn.settled ? "settled" : "open") : "none")
                            + " origin=" + (message.origin && message.origin.kind ? message.origin.kind : "none")
                            + " absorbed=" + absorbedPrompts.length
                            + " activeCmd=" + (session.activeTurn ? (session.activeTurn.commandStarted ? "started" : "-") + "/" + (session.activeTurn.commandFinished || "-") + "/" + (session.activeTurn.commandResultSeen ? "seen" : "-") : "none")
                            + " seen=" + (session.viberoomResultUuids && typeof message.uuid === "string" && session.viberoomResultUuids.has(message.uuid) ? "again" : "first"));
                        const viberoomResults = (session.viberoomResultUuids ??= new Set());`,
  );
  once(
    `            if (isSteering(session.activeTurn)) {
                session.activeTurn.steeredSettle = outcome;
                session.activeTurn.steeredAwaitingResult = false;
                return;
            }`,
    `            if (isSteering(session.activeTurn)) {
                session.activeTurn.viberoomHeldAt ??= Date.now();
                console.error("viberoom-trace held store=steeredSettle reason=steered");
                session.activeTurn.steeredSettle = outcome;
                session.activeTurn.steeredAwaitingResult = false;
                return;
            }`,
  );
  once(
    "                session.activeTurn.deferredSettle = outcome;",
    `                session.activeTurn.viberoomHeldAt ??= Date.now();
                console.error("viberoom-trace held store=deferredSettle reason=subagents tasks=" + [...(session.activeTurn.spawnedTaskIds ?? [])].join(","));
                session.activeTurn.deferredSettle = outcome;`,
  );
  once(
    `            if (isHeldOpen(turn) && !turnAwaitingSubagents(turn)) {
                await settleActive(turn.deferredSettle);
            }`,
    `            if (isHeldOpen(turn) && !turnAwaitingSubagents(turn)) {
                console.error("viberoom-trace released after=" + (turn.viberoomHeldAt ? Math.round((Date.now() - turn.viberoomHeldAt) / 1000) + "s" : "unknown"));
                turn.viberoomHeldAt = undefined;
                await settleActive(turn.deferredSettle);
            }`,
  );
  once(
    "                this.logger.error(`Session ${params.sessionId}: cancel floor elapsed without the SDK yielding; forcing \"cancelled\". The underlying query may still be wedged — a new session may be required.`);",
    `                const forced = session.activeTurn;
                console.error("viberoom-trace forced turn=" + (forced ? (forced.settled ? "settled" : "open") : "none")
                    + " result=" + (forced && forced.commandResultSeen ? "seen" : "none")
                    + " command=" + ((forced && forced.commandFinished) || "dispatched")
                    + " held=" + (forced && forced.deferredSettle !== undefined ? "deferredSettle" : forced && forced.steeredSettle !== undefined ? "steeredSettle" : "no")
                    + " owedIdles=" + (session.owedTrailingIdles || 0));
                this.logger.error(\`Session \${params.sessionId}: cancel floor elapsed without the SDK yielding; forcing "cancelled". The underlying query may still be wedged — a new session may be required.\`);`,
  );
  once(
    "                    const frame = message;\n                    switch (frame.state) {",
    `                    const frame = message;
                    const viberoomKnown = findUnsettledTurn(frame.command_uuid);
                    console.error("viberoom-trace lifecycle uuid=" + frame.command_uuid + " state=" + frame.state
                        + " turn=" + (session.activeTurn ? (session.activeTurn.settled ? "settled" : "open") : "none")
                        + " command=" + (viberoomKnown ? (viberoomKnown === session.activeTurn ? "active" : "queued") : "unknown"));
                    switch (frame.state) {`,
  );
  writeFileSync(file, source);
  console.log("patched claude-agent-acp: a prompt absorbed into an autonomous cycle completes");
  console.log("patched claude-agent-acp: the result, the hold and its release say so in the room's record");
  console.log("patched claude-agent-acp: a command finished before its cycle's result still completes; lifecycle frames are traced");
}
