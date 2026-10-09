// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const temporary = [];
process.once('exit', () => { for (const dir of temporary) fs.rmSync(dir, {recursive: true, force: true}); });
function temporaryFolder(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temporary.push(dir);
  return dir;
}

async function loopbackInputs() {
  const loopback = await import('./loopback-inputs.mjs').catch(() => null);
  assert.ok(loopback, 'the D inputs are built from the repo\'s corpus, which this delivery does not carry');
  return loopback;
}

let built = null;
export function builtDInputs() {
  built ??= (async () => {
    const loopback = await loopbackInputs();
    const runId = JSON.parse(fs.readFileSync(new URL('./fixtures/payloads.json', import.meta.url), 'utf8')).runId;
    const root = path.join(temporaryFolder('viberoom-d-inputs-'), 'input');
    await loopback.prepareLoopbackInputs({workDir: root, runId, sieve: loopback.syntheticSieveVerdicts(loopback.loopbackProjection())});
    return {root, runId, sources: path.join(root, 'SOURCES.json'), preparation: path.join(root, 'BOUND-PREPARATION.json')};
  })();
  return built;
}

let d3Datasets = null;
export function builtD3Datasets() {
  d3Datasets ??= (async () => {
    const loopback = await loopbackInputs(), d2 = await import('../memory-retrieval-comparison-d2/prepare.mjs');
    const dir = temporaryFolder('viberoom-d3-datasets-'), inputs = await builtDInputs();
    fs.cpSync(path.join(inputs.root, 'd2'), path.join(dir, 'LONG'), {recursive: true});
    const combined = d2.combineCorpus(fs.readFileSync(loopback.CORPUS), null), sieve = path.join(dir, 'D1-SIEVE-VERDICTS.json');
    fs.writeFileSync(sieve, JSON.stringify(loopback.syntheticSieveVerdicts(d2.projectCorpus(combined.corpus, d2.sha256(combined.bytes)))));
    const app = fileURLToPath(new URL('../../', import.meta.url));
    const bundle = await d2.prepareBundle({corpus: loopback.CORPUS, sieveVerdicts: sieve, acceptedProject: app, originalProfileProject: app, runId: inputs.runId});
    fs.mkdirSync(path.join(dir, 'D1'));
    for (const [name, bytes] of Object.entries(bundle.files)) fs.writeFileSync(path.join(dir, 'D1', name), bytes);
    return dir;
  })();
  return d3Datasets;
}

export async function dInputs(folderVariable, sourcesVariable) {
  const root = process.env[folderVariable], sources = process.env[sourcesVariable];
  assert.equal(!root, !sources, `${folderVariable} and ${sourcesVariable} are set together or not at all`);
  if (root) return {root, sources, preparation: path.join(root, 'BOUND-PREPARATION.json')};
  return builtDInputs();
}

export async function dInputFile(variable, name) {
  return process.env[variable] || path.join((await builtDInputs()).root, name);
}

const evidence = new Map();
export function evidenceFolder(variable, {required = false} = {}) {
  const root = process.env[variable];
  if (!root && !required) return null;
  const key = root ? variable : `${variable} (temporary)`;
  if (!evidence.has(key)) {
    let dir;
    if (root) { dir = path.join(root, `${process.pid}-${randomUUID().slice(0, 8)}`); fs.mkdirSync(dir); }
    else dir = temporaryFolder('viberoom-d-evidence-');
    evidence.set(key, dir);
  }
  return evidence.get(key);
}
