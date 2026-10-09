// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import {lstatSync, readdirSync} from 'node:fs';
import {join, isAbsolute, win32} from 'node:path';

export const PRODUCT_SOURCE_POLICY = 'product-typescript-with-explicit-oracles';
export const PRODUCT_SCRIPTS = Object.freeze([
  'install.mjs', 'update.mjs', 'render-icon.mjs', 'vendor-acp.mjs', 'vendor-ui.mjs',
  'prune-dist.mjs', 'stamp-build.mjs', 'product-lock.mjs', 'graph-release-layout.mjs',
  'graph-release-layout.json', 'public-source-policy.mjs',
].map(p => 'scripts/' + p));
export const PRODUCT_RUNTIME_ASSETS = Object.freeze(['dist/build.json']);

export function publicRelativePath(value) {
  assert.ok(typeof value === 'string' && value.length && !value.includes('\\') && !isAbsolute(value) && !win32.isAbsolute(value), 'public_inventory_relative_path');
  assert.ok(value.split('/').every(p => p && p !== '.' && p !== '..' && !p.includes(':')), 'public_inventory_relative_path');
  return value;
}

export function ownedFiles(root, folder) {
  publicRelativePath(folder);
  const files = [];
  function walk(relative) {
    const path = join(root, relative), state = lstatSync(path);
    assert.ok(!state.isSymbolicLink(), 'public_inventory_link_refused');
    if (state.isDirectory()) for (const name of readdirSync(path).sort()) walk(relative + '/' + name);
    else { assert.ok(state.isFile(), 'public_inventory_regular_file'); files.push(publicRelativePath(relative)); }
  }
  walk(folder);
  return files.sort();
}

export function productSourceInventory(root) {
  const all = ownedFiles(root, 'src');
  const privateTests = all.filter(p => p.endsWith('.ts') && /\.test(?:\.|$)/.test(p));
  const sources = all.filter(p => p.endsWith('.ts') && !/\.test(?:\.|$)/.test(p));
  assert.ok(sources.some(p => !p.endsWith('.d.ts')), 'public_inventory_product_source_required');
  const sourceEmit = sources.filter(p => !p.endsWith('.d.ts')).map(source => ({source, emit: 'dist/' + source.slice(4, -3) + '.js'}));
  return {sources, sourceEmit, privateTests, runtimeAssets: [...PRODUCT_RUNTIME_ASSETS]};
}
