#!/usr/bin/env node
// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "vendor", "acp");
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
}

{
  const sdkFrom = packageDir("@anthropic-ai/claude-agent-sdk");
  const sdkTo = join(out, "claude-agent-sdk");
  const sdkPkg = readJson(join(sdkFrom, "package.json"));
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
  patchClaudeAdapter(join(to, "dist", "acp-agent.js"));
  console.log(`vendored claude-agent-acp ${readJson(join(to, "package.json")).version} (${rewritten} files point at the vendored SDK ${sdkPkg.version})`);
}

console.log(`vendored codex-acp ${readJson(join(out, "codex-acp", "package.json")).version}`);

function patchClaudeAdapter(file) {
  let source = readFileSync(file, "utf8");
  const once = (anchor, replacement) => {
    const first = source.indexOf(anchor);
    if (first < 0 || source.indexOf(anchor, first + 1) >= 0) throw new Error(`claude-agent-acp changed: the absorbed-prompt patch anchor is missing or ambiguous: ${anchor.slice(0, 70)}`);
    source = source.replace(anchor, replacement);
  };
  once(
    "        const ensureActiveTurn = (resultUserMessageUuid) => {",
    "        const ensureActiveTurn = (resultUserMessageUuid, dispatchedTurn) => {",
  );
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
    `                        // viberoom: never apply one result twice, including a repeated human result.
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
                        if (typeof message.user_message_uuid === "string" && session.orphanCommands?.has(message.user_message_uuid)) {
                            session.orphanCommands.delete(message.user_message_uuid);
                            session.pendingEmptyInterruptionDiagnosticCommands?.delete(message.user_message_uuid);
                            session.owedTrailingIdles++;
                            break;
                        }
                        // Snapshot before result bookkeeping marks dispatched commands as having seen a result.
                        const absorbedPrompts = (session.turnQueue ?? []).filter((t) => !t.settled && t.commandStarted && !t.commandFinished && !t.commandResultSeen);
                        const dispatchedOwner = session.activeTurn && !session.activeTurn.settled && session.activeTurn.deferredSettle === undefined
                            ? session.activeTurn : absorbedPrompts[0];
                        const isAutonomousResult = message.origin != null && AUTONOMOUS_RESULT_ORIGINS.has(message.origin.kind) && absorbedPrompts.length === 0;`,
  );
  once(
    "                                ensureActiveTurn(message.user_message_uuid);",
    `                                ensureActiveTurn(message.user_message_uuid, dispatchedOwner);
                                // Only after the adapter accepted the owner (orphan/cancel checks included).
                                // Share its terminal outcome rather than reactivating each command and resetting
                                // the stop reason/usage, or bypassing early refusal/error/deferral exits.
                                if (dispatchedOwner && session.activeTurn === dispatchedOwner) {
                                    const rest = absorbedPrompts.filter((turn) => turn !== dispatchedOwner);
                                    if (rest.length) {
                                        const share = (reason, settle) => {
                                            for (const extra of rest) {
                                                if (extra.settled) continue;
                                                this.finishFileChangeAudit(session, extra, reason);
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
                                        dispatchedOwner.reject = (error) => {
                                            reject(error);
                                            share("providerError", (extra) => extra.reject(error));
                                        };
                                    }
                                }`,
  );
  once(
    "                        const viberoomResults = (session.viberoomResultUuids ??= new Set());",
    `                        console.error("viberoom-trace result uuid=" + (typeof message.uuid === "string" ? message.uuid : "none") + " turn=" + (session.activeTurn ? (session.activeTurn.settled ? "settled" : "open") : "none")
                            + " origin=" + (message.origin && message.origin.kind ? message.origin.kind : "none")
                            + " absorbed=" + ((session.turnQueue ?? []).filter((t) => !t.settled && t.commandStarted && !t.commandFinished && !t.commandResultSeen).length)
                            + " seen=" + (session.viberoomResultUuids && typeof message.uuid === "string" && session.viberoomResultUuids.has(message.uuid) ? "again" : "first"));
                        const viberoomResults = (session.viberoomResultUuids ??= new Set());`,
  );
  once(
    `            if (isSteering(session.activeTurn)) {
                session.activeTurn.steeredSettle = outcome;
                return;
            }`,
    `            if (isSteering(session.activeTurn)) {
                session.activeTurn.viberoomHeldAt ??= Date.now();
                console.error("viberoom-trace held store=steeredSettle reason=steered");
                session.activeTurn.steeredSettle = outcome;
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
                settleActive(turn.deferredSettle);
            }`,
    `            if (isHeldOpen(turn) && !turnAwaitingSubagents(turn)) {
                console.error("viberoom-trace released after=" + (turn.viberoomHeldAt ? Math.round((Date.now() - turn.viberoomHeldAt) / 1000) + "s" : "unknown"));
                turn.viberoomHeldAt = undefined;
                settleActive(turn.deferredSettle);
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
  writeFileSync(file, source);
  console.log("patched claude-agent-acp: a prompt absorbed into an autonomous cycle completes");
  console.log("patched claude-agent-acp: the result, the hold and its release say so in the room's record (F28)");
}
