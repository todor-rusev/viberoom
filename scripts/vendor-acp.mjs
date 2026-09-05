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
  console.log(`vendored claude-agent-acp ${readJson(join(to, "package.json")).version} (${rewritten} files point at the vendored SDK ${sdkPkg.version})`);
}

console.log(`vendored codex-acp ${readJson(join(out, "codex-acp", "package.json")).version}`);
