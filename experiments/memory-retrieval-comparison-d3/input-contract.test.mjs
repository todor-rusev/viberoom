// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import { inputContract } from './input-contract.mjs';
import { prepareConnected } from './prepare.mjs';
import { encode, sha256 } from './contracts.mjs';
import { PROFILE_SCHEMA } from './answer-profile.mjs';
import { PolicyRefusal } from '../trial-journal/policy-assert.mjs';

const historicalNames = ['baseline-off-current', 'original-profile'];
const currentCatalogue = [
  { name: 'excerpts-profile', memoryInput: 'excerpts', title: 'Economical' },
  { name: 'original-profile', memoryInput: 'whole', title: 'Original' },
];
const clone = value => structuredClone(value);

function payload(current = false) {
  const names = current ? currentCatalogue.map(v => v.name) : historicalNames;
  const physicalAddresses = [], rows = [];
  for (const logicalRoom of ['room-a', 'room-b']) for (const variant of names) {
    const room = { uuid: `${variant}-${logicalRoom}`, name: logicalRoom };
    physicalAddresses.push({ logicalRoom, variant, room, plannedGraphId: `graph-${room.uuid}` });
    rows.push({ variant, ...(current ? { input: currentCatalogue.find(v => v.name === variant).memoryInput } : {}),
      sourceId: `source-${logicalRoom}`, logicalRoom, room, sourceVersion: 'v1', sourceBodySha256: 'a'.repeat(64),
      members: [{ identity: { sourceId: `source-${logicalRoom}` },
        payload: { request: { type: 'message', data: 'Synthetic original.', metadata: { source_id: `source-${logicalRoom}` } } } }] });
  }
  return { schema: 'viberoom-retrieval-offline-payload-plan-v1', corpusSha256: 'b'.repeat(64), runId: 'synthetic-contract',
    ...(current ? { variants: clone(currentCatalogue), dropped: [] } : {}), physicalAddresses, rows };
}
function preparedInput(payloads) {
  const questions = { schema: 'viberoom-retrieval-question-projection-v1', corpusSha256: payloads.corpusSha256,
    snapshotAt: '2026-10-03T00:00:00Z', queries: [{ id: 'q1', room: 'room-a', query: 'What was decided?' }] };
  return { questions, payloads, preparation: { schema: 'viberoom-retrieval-offline-preparation-v1', corpusSha256: payloads.corpusSha256,
    runId: payloads.runId, paidExecutionAllowed: false, actualD: 'NOT_RUN',
    files: [['questions.json', questions], ['payloads.json', payloads]].map(([name, value]) => ({ name, sha256: sha256(encode(value)), bytes: encode(value).length })),
    plannedEpisodePostCount: payloads.rows.length, budget: { estimatedIngestionCredits: 4, authorizedCredits: 0 } },
    answerControls: { model: 'synthetic-unused', cacheState: 'cold', requestProfile: { schema: PROFILE_SCHEMA,
      reasoningEffort: 'none', temperature: null, maxCompletionTokens: 1024, choices: 1, serviceTier: 'default', store: false,
      maxInputTextUtf8Bytes: 8192, maxRequestUtf8Bytes: 32768 } }, codePins: [{ path: 'synthetic-test-only', sha256: 'c'.repeat(64) }] };
}

test('historical full and room subset retain the fixed pair and alternating order', () => {
  for (const data of [payload(), (() => { const p = payload(); p.physicalAddresses = p.physicalAddresses.filter(a => a.logicalRoom === 'room-a'); p.rows = p.rows.filter(r => r.logicalRoom === 'room-a'); return p; })()]) {
    const before = encode(data), contract = inputContract(data);
    assert.equal(contract.form, 'historical-d2-v1');
    assert.deepEqual(contract.variants, ['baseline-off-current', 'original-profile']);
    assert.deepEqual([contract.rotate(0), contract.rotate(1), contract.rotate(2)], [
      ['baseline-off-current', 'original-profile'], ['original-profile', 'baseline-off-current'], ['baseline-off-current', 'original-profile'],
    ]);
    assert.deepEqual(encode(data), before);
  }
});
test('current explicit catalogue retains its declared order and row input binding', () => {
  const p = payload(true), c = inputContract(p);
  assert.equal(c.form, 'current-d2-variants');
  assert.deepEqual(c.rotate(0), ['excerpts-profile', 'original-profile']);
  assert.deepEqual(c.rotate(1), ['original-profile', 'excerpts-profile']);
  assert.throws(() => c.variants.reverse(), TypeError);
});
test('a dropped excerpt and kept whole for the same source are lawful distinct triples', () => {
  const p = payload(true);
  assert.equal(prepareConnected(preparedInput(p)).manifest.jobs.length, 6);
  const row = p.rows.find(r => r.variant === 'excerpts-profile' && r.logicalRoom === 'room-a');
  p.rows = p.rows.filter(r => r !== row);
  p.dropped.push({ variant: row.variant, sourceId: row.sourceId, logicalRoom: row.logicalRoom });
  assert.equal(inputContract(p).form, 'current-d2-variants');
  assert.ok(p.rows.some(r => r.variant === 'original-profile' && r.sourceId === row.sourceId));
  assert.throws(() => prepareConnected(preparedInput(p)), { name: 'PolicyRefusal', actual: 0, expected: true, operator: '==' });
});

const malformed = [
  ['legacy third variant', false, p => { p.physicalAddresses[0].variant = 'foreign'; }],
  ['legacy missing room variant', false, p => { p.physicalAddresses.splice(0, 1); }],
  ['legacy address without rows', false, p => { p.rows.shift(); }],
  ['legacy extra top-level field', false, p => { p.extra = true; }],
  ['legacy mixed with current catalogue', false, p => { p.variants = clone(currentCatalogue); }],
  ['current extra top-level field', true, p => { p.extra = true; }],
  ['current missing dropped', true, p => { delete p.dropped; }],
  ['current empty catalogue', true, p => { p.variants = []; }],
  ['current duplicate catalogue name', true, p => { p.variants.push(clone(p.variants[0])); }],
  ['current extra catalogue field', true, p => { p.variants[0].extra = true; }],
  ['current missing catalogue field', true, p => { delete p.variants[0].title; }],
  ['current invalid catalogue title', true, p => { p.variants[0].title = {}; }],
  ['current unknown memory input', true, p => { p.variants[0].memoryInput = 'off'; }],
  ['current foreign address variant', true, p => { p.physicalAddresses[0].variant = 'foreign'; }],
  ['current missing room variant', true, p => { p.physicalAddresses.splice(0, 1); }],
  ['current duplicate address in an unqueried room', true, p => { p.physicalAddresses.push(clone(p.physicalAddresses[2])); }],
  ['current orphan row', true, p => { p.rows[0].logicalRoom = 'foreign-room'; }],
  ['current row address identity mismatch', true, p => { p.rows[0].room = { uuid: 'foreign', name: 'room-a' }; }],
  ['current duplicate kept triple', true, p => { p.rows.push(clone(p.rows[0])); }],
  ['current mismatched row input', true, p => { p.rows[0].input = 'whole'; }],
  ['current nonarray dropped', true, p => { p.dropped = {}; }],
  ['current extra dropped field', true, p => { p.dropped.push({ variant: 'excerpts-profile', sourceId: 'not-kept', logicalRoom: 'room-a', extra: true }); }],
  ['current missing dropped field', true, p => { p.dropped.push({ variant: 'excerpts-profile', sourceId: 'not-kept' }); }],
  ['current orphan dropped room', true, p => { p.dropped.push({ variant: 'excerpts-profile', sourceId: 'not-kept', logicalRoom: 'foreign' }); }],
  ['current orphan dropped variant', true, p => { p.dropped.push({ variant: 'foreign', sourceId: 'not-kept', logicalRoom: 'room-a' }); }],
  ['current duplicate dropped triple', true, p => { const d = { variant: 'excerpts-profile', sourceId: 'not-kept', logicalRoom: 'room-a' }; p.dropped.push(d, clone(d)); }],
  ['current same triple kept and dropped', true, p => { const r = p.rows[0]; p.dropped.push({ variant: r.variant, sourceId: r.sourceId, logicalRoom: r.logicalRoom }); }],
];
for (const [name, current, mutate] of malformed) test(name + ' is refused', () => {
  const p = payload(current); mutate(p); assert.throws(() => inputContract(p), PolicyRefusal);
});

test('MANIFEST hash refusal precedes interpretation of malformed legacy/current shapes', () => {
  for (const current of [false, true]) {
    const p = payload(current); p.extra = true;
    const input = preparedInput(p);
    input.preparation.files.find(f => f.name === 'payloads.json').sha256 = '0'.repeat(64);
    assert.throws(() => prepareConnected(input), /D2 prepared input hash differs/);
  }
});
test('MANIFEST schema refusal precedes interpretation of a malformed catalogue', () => {
  const p = payload(true); p.variants = null;
  const input = preparedInput(p); input.preparation.schema = 'foreign';
  assert.throws(() => prepareConnected(input), /viberoom-retrieval-offline-preparation-v1/);
});
