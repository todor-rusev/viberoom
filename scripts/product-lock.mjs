// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { deepStrictEqual } from "node:assert";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sorted = value => Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
const runtimeRows = lock => Object.entries(lock.packages).filter(([path, entry]) => path && entry.dev !== true);

function checkReachableRuntime(lock) {
  const visited = new Set();
  const visit = owner => {
    if (visited.has(owner)) return;
    visited.add(owner);
    const entry = lock.packages[owner];
    const dependencies = { ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies };
    for (const name of Object.keys(dependencies)) {
      let base = owner, found;
      for (;;) {
        const candidate = `${base ? base + "/" : ""}node_modules/${name}`;
        if (lock.packages[candidate]) { found = candidate; break; }
        if (!base) break;
        const at = base.lastIndexOf("/node_modules/");
        base = at < 0 ? "" : base.slice(0, at);
      }
      const optionalPeer = entry.peerDependenciesMeta?.[name]?.optional && !entry.dependencies?.[name] && !entry.optionalDependencies?.[name];
      if (optionalPeer && (!found || lock.packages[found].dev === true)) continue;
      if (!found || lock.packages[found].dev === true) throw new Error(`Runtime dependency is missing or marked development-only: ${owner || "root"} -> ${name}`);
      visit(found);
    }
  };
  visit("");
}

export function publishableLock(pkg, lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""]) throw new Error("A version 3 package-lock.json is required");
  if (pkg.bundleDependencies !== true) throw new Error("The product must bundle all its runtime dependencies");
  const root = lock.packages[""];
  if (lock.name !== pkg.name || root.name !== pkg.name || lock.version !== pkg.version || root.version !== pkg.version) {
    throw new Error("The package name or version differs from package-lock.json; update the lock before packing");
  }
  for (const key of ["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"]) {
    try { deepStrictEqual(sorted(pkg[key]), sorted(root[key])); }
    catch { throw new Error(`${key} differ from package-lock.json; update the lock before packing`); }
  }
  checkReachableRuntime(lock);
  for (const [path, entry] of runtimeRows(lock)) {
    if (!/^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/i.test(path)) {
      throw new Error(`Unsupported runtime dependency path: ${path}`);
    }
    if (entry.link || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(entry.version ?? "")) {
      throw new Error(`Runtime dependency must have an exact registry version: ${path}`);
    }
    let source;
    try { source = new URL(entry.resolved); } catch { }
    const digest = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(entry.integrity ?? "")?.[1];
    if (source?.protocol !== "https:" || source.username || source.password || !digest || Buffer.from(digest, "base64").length !== 64) {
      throw new Error(`Runtime dependency needs an HTTPS tarball and sha512 integrity: ${path}`);
    }
    if (entry.hasInstallScript) throw new Error(`Runtime dependency needs an install script: ${path}`);
  }
  return JSON.parse(JSON.stringify(lock));
}

export function checkRuntimeFiles(root, lock) {
  for (const [relative, entry] of runtimeRows(lock)) {
    const directory = join(root, relative);
    const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    if (pkg.version !== entry.version) throw new Error(`Installed runtime version differs from the lock: ${relative}`);
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      try { deepStrictEqual(sorted(pkg[field]), sorted(entry[field])); }
      catch { throw new Error(`Installed dependency graph differs from the lock: ${relative} (${field})`); }
    }
    if (pkg.gypfile || ["preinstall", "install", "postinstall"].some(name => pkg.scripts?.[name])) {
      throw new Error(`Runtime dependency needs native compilation or an install script: ${relative}`);
    }
    const walk = directory => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) throw new Error(`Runtime dependency contains a symbolic link: ${relative}/${name}`);
        if (stat.isDirectory()) walk(path);
        else if (/\.node$/i.test(name) || name === "binding.gyp") throw new Error(`Native runtime dependency: ${relative}/${name}`);
      }
    };
    walk(directory);
  }
}

export function checkProductLock(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = publishableLock(pkg, JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")));
  checkRuntimeFiles(root, lock);
  return runtimeRows(lock).length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  console.log(`The product lock is ready: ${checkProductLock(root)} runtime dependencies, no native modules or install scripts`);
}
