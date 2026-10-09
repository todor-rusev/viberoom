// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { prepareConnected, DEFAULT_LIMITS } from './prepare.mjs';
import { createSdkReadPort, createHttpAnswerPort } from './ports.mjs';
import { runComparison } from './run.mjs';
import { verifySnapshot, formatContext } from './lineage.mjs';
import { RunBudget, sha256, encode, canonical, PROMPT, json, awaited } from './contracts.mjs';
import { captureAnswerControls, buildAnswerRequest, PROFILE_SCHEMA } from './answer-profile.mjs';
import { captureSdkEpisode, verifyEpisodePair, validateEpisodeProjection } from './episode-projection.mjs';
import { captureSdkEntity, verifyEntityScope } from './entity-projection.mjs';
import { captureSdkGraph, captureSdkSearch, verifySearchEnvelope, verifyGraphLayout } from './envelope-projection.mjs';
import { captureDeclaredObject, captureDeclaredArray } from './native-projection.mjs';
import {builtD3Datasets,evidenceFolder} from '../memory-retrieval-trial-d5/test-folders.mjs';

const require = createRequire(import.meta.url), { ZepClient } = require('@getzep/zep-cloud');
const fixtureDir = process.env.D3_FIXTURE_DIR || await builtD3Datasets();
const load = async (dataset, name) => JSON.parse(await readFile(join(fixtureDir, dataset, name), 'utf8'));
const d3Evidence = evidenceFolder('D3_EVIDENCE_DIR');
const full = { questions: await load('D1', 'questions.json'), payloads: await load('D1', 'payloads.json'), preparation: await load('D1', 'MANIFEST.json') };
const long = { questions: await load('LONG', 'questions.json'), payloads: await load('LONG', 'payloads.json'), preparation: await load('LONG', 'MANIFEST.json') };
const controls = { model: 'gpt-5.6-luna', cacheState: 'cold', requestProfile: { schema: PROFILE_SCHEMA,
  reasoningEffort: 'none', temperature: null, maxCompletionTokens: 1024, choices: 1, serviceTier: 'default', store: false,
  maxInputTextUtf8Bytes: 8192, maxRequestUtf8Bytes: 16384 } };
let fixtureNumber = 0;
const clone = value => structuredClone(value);
function inputs() {
  const selected = clone(full), room = selected.questions.queries[0].room;
  selected.questions.queries = selected.questions.queries.slice(0, 1);
  selected.payloads.physicalAddresses = selected.payloads.physicalAddresses.filter(p => p.logicalRoom === room);
  selected.payloads.rows = selected.payloads.rows.filter(r => r.logicalRoom === room);
  for (const [name, value] of [['questions.json', selected.questions], ['payloads.json', selected.payloads]]) {
    const f = selected.preparation.files.find(f => f.name === name); f.sha256 = sha256(encode(value)); f.bytes = encode(value).length;
  }
  return selected;
}
function prepared(data = inputs(), limits = DEFAULT_LIMITS) {
  return { ...data, ...prepareConnected({ ...data, answerControls: controls, limits, codePins: [{ path: 'synthetic-test-only', sha256: 'a'.repeat(64) }] }) };
}
function observed(bundle) {
  const snapshots = new Map(), authorities = [];
  for (const [g, graph] of bundle.manifest.topology.entries()) {
    const rows = bundle.payloads.rows.filter(r => r.variant === graph.variant && r.logicalRoom === graph.logicalRoom);
    const episodes = rows.flatMap(r => r.members.map((m, n) => ({ uuid: `episode-${g}-${r.sourceId}-${n}`, content: m.payload.request.data,
      metadata: clone(m.payload.request.metadata), createdAt: m.payload.request.createdAt, processed: true, source: 'message' })));
    const nodes = [{ uuid: `node-${g}-a`, name: 'Synthetic subject', summary: 'Observed derivative summary.', createdAt: '2026-10-03T00:00:00Z' },
      { uuid: `node-${g}-b`, name: 'Synthetic object', summary: 'Observed derivative second summary.', createdAt: '2026-10-03T00:00:00Z' }];
    const edges = [{ uuid: `edge-${g}`, fact: 'Synthetic subject uses synthetic object.', name: 'USES', createdAt: '2026-10-03T00:00:00Z',
      validAt: '2026-09-01T00:00:00Z', sourceNodeUuid: nodes[0].uuid, targetNodeUuid: nodes[1].uuid, episodes: episodes.map(e => e.uuid) }];
    snapshots.set(graph.graphId, { graph: { graphId: graph.graphId, projectUuid: 'synthetic-project' }, episodes: episodes.map(e => ({ ...e, createdAt: '2026-10-02T23:21:06.535692Z', session_id: null })),
      originals: clone(episodes), edges, nodes, startedAt: '2026-10-03T00:00:00Z', finishedAt: '2026-10-03T00:00:00Z' });
    authorities.push({ accountId: 'synthetic-account', projectId: 'synthetic-project', graphId: graph.graphId,
      room: graph.logicalRoom, roomUuid: graph.roomUuid, copyId: rows[0].members[0].identity.copyId,
      generationId: 'synthetic-generation', routeRevision: '1', scopeRevision: '1', verificationId: 'synthetic-local-proof',
      sourceState: 'verified-current-authorized', members: rows.flatMap(r => r.members.map((m, n) => ({ episodeId: `episode-${g}-${r.sourceId}-${n}`,
        opId: m.opId, sourceId: r.sourceId, version: r.sourceVersion, part: m.identity.part }))) });
  }
  return { snapshots, authorities };
}
const wire = value => Array.isArray(value) ? value.map(wire) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k === 'metadata' || ['sdkGraphLayout','sdkEntityLayouts','sdkEnvelopeLayout'].includes(k) ? k : k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), k === 'metadata' ? v : wire(v)])) : value;
async function harness(bundle = prepared(), options = {}) {
  const obs = observed(bundle), calls = [], events = []; let sequence = 0;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString(), body = raw ? JSON.parse(raw) : null;
    const u = new URL(req.url, 'http://127.0.0.1'); const call = { method: req.method, path: u.pathname, body, sequence: ++sequence }; calls.push(call);
    let value = null;
    if (u.pathname === '/answer') value = { choices: [{ message: { content: 'Synthetic fixture answer [s01].' } }], usage: { prompt_tokens: 23, completion_tokens: 7, total_tokens: 30 } };
    else if (u.pathname === '/graph/search') {
      const s = obs.snapshots.get(body.graph_id);
      value = body.scope === 'auto' ? { context: 'OPAQUE_UNTRUSTED_CONTEXT', edges: s.edges.map((e, i) => ({ ...e, selectionRank: i })),
        nodes: [], episodes: [], response: { serverLatencyMs: 1 } } : { edges: s.edges.map(e => ({ ...e, score: .9, relevance: .8 })) };
    } else if (/^\/graph\/episodes\/graph\//.test(u.pathname)) value = obs.snapshots.get(decodeURIComponent(u.pathname.split('/').at(-1))).episodes;
    else if (/^\/graph\/edge\/graph\//.test(u.pathname)) value = obs.snapshots.get(decodeURIComponent(u.pathname.split('/').at(-1))).edges;
    else if (/^\/graph\/node\/graph\//.test(u.pathname)) value = obs.snapshots.get(decodeURIComponent(u.pathname.split('/').at(-1))).nodes;
    else if (/^\/graph\/episodes\/[^/]+$/.test(u.pathname)) value = [...obs.snapshots.values()].flatMap(s => s.originals).find(e => e.uuid === decodeURIComponent(u.pathname.split('/').at(-1)));
    else if (/^\/graph\//.test(u.pathname)) value = obs.snapshots.get(decodeURIComponent(u.pathname.split('/').at(-1)))?.graph;
    if (options.response) value = options.response(call, value, obs) ?? value;
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay(call)));
    if (options.status) res.statusCode = options.status(call);
    if (options.headers) for (const [k, v] of Object.entries(options.headers(call))) res.setHeader(k, v);
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(wire(value)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fixtureId = ++fixtureNumber;
  const budget = new RunBudget(bundle.manifest.limits, undefined, options.recordAttempt ?? (value => { events.push({ kind: 'before-io-attempt', value }); return true; })), current = options.current ?? (() => true);
  const readPort = createSdkReadPort({ ZepClient, baseUrl: origin, apiKey: 'synthetic-local-key', purpose: 'local-fixture', budget, current });
  const answerPort = createHttpAnswerPort({ endpointUrl: origin + '/answer', answerControls: controls, purpose: 'local-fixture', budget, current });
  const permit = { schema: 'viberoom-retrieval-external-job-permit-v1', purpose: 'local-fixture', manifestSha256: sha256(encode(bundle.manifest)),
    runId: bundle.manifest.runId, ownerClaimId: 'synthetic-owned-fixture', approved: true, expiresAt: new Date(Date.now() + 60000).toISOString(),
    currentAuthoritySha256: sha256(encode(obs.authorities)), serviceEmissionBinding: null, wholeTrialBudgetApproved: false, readOrigin: origin, answerOrigin: origin };
  const run = async overrides => {
    const result = await runComparison({ ...bundle, budget, authorities: obs.authorities, readPort, answerPort, permit, current,
      record: (kind, value) => events.push({ kind, value }), ...overrides });
    if (d3Evidence) await writeFile(join(d3Evidence, `fixture-${fixtureId}-${calls.length}-${events.length}.json`), encode({ synthetic: true, fixtureId, calls, events, result }), { flag: 'wx' });
    return result;
  };
  return { ...obs, calls, events, bundle, budget, permit, readPort, answerPort, run,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

test('D1 and optional44 retain separate exact preparation and budget pins, inactive by default', () => {
  const a = prepared(full), b = prepared(long);
  assert.equal(a.manifest.jobs.length, 240); assert.equal(b.manifest.jobs.length, 264);
  assert.equal(a.manifest.ingestion.localEstimatedCredits, 34); assert.equal(b.manifest.ingestion.localEstimatedCredits, 69);
  assert.equal(a.manifest.paidExecutionAllowed, false); assert.equal(a.manifest.actualD, 'NOT_RUN');
  assert.equal(a.manifest.ingestion.fullInvoiceUpperBound, null); assert.notEqual(a.manifest.corpusSha256, b.manifest.corpusSha256);
  assert.ok(a.manifest.jobs.every(j => !Object.hasOwn(j, 'claims') && !Object.hasOwn(j, 'evidence')));
});
test('actualSDK + localanswer: six comparisons, four shared searches, direct originals and T0/T1 capture', async () => {
  const h = await harness(); try {
    const r = await h.run(); assert.equal(r.status, 'captured-unjudged'); assert.equal(r.records.length, 6);
    assert.equal(r.summary.modelCalls, 6); assert.equal(h.calls.filter(c => c.path === '/graph/search').length, 4);
    assert.equal(r.observations.length, 4); assert.ok(h.calls.filter(c => /^\/graph\/episodes\/[^/]+$/.test(c.path)).length > 0);
    assert.ok(r.records.every(row => row.contextUtf8Bytes <= 4096 && row.inputTokens === 23 && row.answerCost === null));
    for (const c of h.calls.filter(c => c.path === '/graph/search')) {
      if (c.body.scope === 'auto') { assert.equal(c.body.return_raw_results, true); assert.equal(c.body.max_characters, 12000); assert.equal(c.body.reranker, undefined); assert.equal(c.body.limit, undefined); }
      else { assert.equal(c.body.scope, 'edges'); assert.equal(c.body.reranker, 'cross_encoder'); assert.equal(c.body.limit, 12); }
    }
    assert.ok(r.attempts.every(a => !Object.hasOwn(a.request, 'headers') && a.request.maxRetries === 0));
    assert.ok(r.attempts.filter(a => a.kind === 'model').every(a => a.request.body.messages[0].content === PROMPT));
    for (const c of h.calls.filter(c => c.path === '/answer')) {
      assert.equal(c.body.model, 'gpt-5.6-luna'); assert.equal(c.body.max_completion_tokens, 1024);
      assert.equal(c.body.reasoning_effort, 'none'); assert.equal(c.body.n, 1); assert.equal(c.body.service_tier, 'default'); assert.equal(c.body.store, false);
      assert.equal(Object.hasOwn(c.body, 'temperature'), false); assert.equal(Object.hasOwn(c.body, 'max_tokens'), false);
    }
    assert.ok(r.records.every(row => !row.context.includes('OPAQUE_UNTRUSTED_CONTEXT')));
    assert.equal(h.events.filter(e => e.kind === 'before-io-attempt').length, r.attempts.length);
    assert.equal(r.actualD, 'LOCAL_FIXTURE_ONLY'); assert.equal(r.semanticQuality, 'NOT_ADJUDICATED');
  } finally { await h.close(); }
});

test('actualSDK faithfully retains date-different LIST/direct GET plus measured session_id:null', async () => {
  const nulls = e => ({ ...e, session_id: null, roleType: null, role: null, score: null, threadId: null });
  const h = await harness(undefined, { response: (c, v) => /^\/graph\/episodes\/[^/]+$/.test(c.path) ? nulls(v) : c.path.startsWith('/graph/episodes/graph/') ? v.map(nulls) : v });
  try {
    const r = await h.run(); assert.equal(r.status, 'captured-unjudged');
    for (const observation of r.observations) {
      assert.ok(observation.episodeEndpointObservations.length);
      for (const p of observation.episodeEndpointObservations) {
        assert.equal(p.list.createdAt, '2026-10-02T23:21:06.535692Z');
        const row = h.bundle.payloads.rows.flatMap(row => row.members).find(m => m.payload.request.metadata.op_id === observation.raw.originals.find(e => e.uuid === p.episodeId).metadata.op_id);
        assert.equal(p.directGet.createdAt, row.payload.request.createdAt); assert.notEqual(p.list.sha256, p.directGet.sha256);
        assert.deepEqual(p.list.undefinedOptionalFields, ['role', 'roleType', 'score', 'threadId']);
        assert.deepEqual(p.directGet.undefinedOptionalFields, ['role', 'roleType', 'score', 'threadId']);
      }
      assert.ok(observation.raw.episodes.every(e => e.session_id === null));
      assert.ok(observation.raw.originals.every(e => e.session_id === null));
    }
    assert.equal(h.calls.filter(c => c.path === '/answer').length, 6);
    assert.ok(r.attempts.filter(a => /^\/graph\/episodes(?:\/graph)?\//.test(new URL(a.request.url).pathname)).every(a => JSON.stringify(JSON.parse(a.response)).includes('"role_type":null')));
  } finally { await h.close(); }
});

test('actualSDK changed direct GET event time holds before model even with valid precise LIST time', async () => {
  const h = await harness(undefined, { response: (c, v) => /^\/graph\/episodes\/[^/]+$/.test(c.path) ? { ...v, createdAt: '2026-10-02T23:21:06.535692Z' } : v });
  try { const r = await h.run(); assert.equal(r.status, 'held'); assert.equal(h.calls.filter(c => c.path === '/answer').length, 0); }
  finally { await h.close(); }
});

for (const field of ['uuid', 'content', 'metadata']) test(`actualSDK direct GET changed ${field} refuses unchanged lawful LIST`, async () => {
  const h = await harness(undefined, { response: (c, v) => {
    if (!/^\/graph\/episodes\/[^/]+$/.test(c.path)) return v;
    return { ...v, [field]: field === 'metadata' ? { ...v.metadata, carry_hash: 'sha256:' + '0'.repeat(64) } : field === 'uuid' ? 'foreign-episode' : v.content + ' changed' };
  } });
  try { const r = await h.run(); assert.equal(r.status, 'held'); assert.equal(h.calls.filter(c => c.path === '/answer').length, 0); }
  finally { await h.close(); }
});

function oneProjection() {
  const request = clone(full.payloads.rows[0].members[0].payload.request);
  const get = { uuid: 'synthetic-projection-only', content: request.data, metadata: clone(request.metadata), processed: true, createdAt: request.createdAt, source: request.type };
  return { request, get, list: { ...clone(get), createdAt: '2026-10-02T23:21:06.535692Z', session_id: null } };
}
test('precise event equality preserves offsets/trailing zeroes and rejects sub-millisecond event drift', () => {
  const p = oneProjection(); p.request.createdAt = p.request.metadata.source_at = '2026-09-01T09:00:00.1234567Z';
  p.get.metadata = clone(p.request.metadata); p.get.createdAt = '2026-09-01T12:00:00.123456700+03:00'; p.list.metadata = clone(p.get.metadata);
  assert.doesNotThrow(() => verifyEpisodePair(p.list, p.get, p.request, p.get.uuid));
  p.get.createdAt = '2026-09-01T09:00:00.1234568Z';
  assert.equal(Date.parse(p.get.createdAt), Date.parse(p.request.createdAt));
  assert.throws(() => verifyEpisodePair(p.list, p.get, p.request, p.get.uuid), /event time/);
  for (const invalid of ['2026-02-30T09:00:00Z', '2026-09-01T09:00:00', '2026-09-01T09:00:60Z', '2026-09-01']) {
    assert.throws(() => validateEpisodeProjection({ ...p.list, createdAt: invalid }, 'list'), /precise/);
  }
});
test('only measured null-only session passthrough is accepted; unknown fields are set aside; other null layouts hold', () => {
  const p = oneProjection(); assert.doesNotThrow(() => verifyEpisodePair(p.list, p.get, p.request, p.get.uuid));
  assert.doesNotThrow(() => verifyEpisodePair(p.list, { ...p.get, session_id: null }, p.request, p.get.uuid));
  for (const unknown of [{ sessionId: null }, { unknown_native_field: null }]) {
    assert.doesNotThrow(() => verifyEpisodePair({ ...p.list, ...unknown }, p.get, p.request, p.get.uuid));
    assert.deepEqual(captureSdkEpisode({ ...p.list, ...unknown }).unknownNativeFields, unknown);
  }
  for (const bad of [{ session_id: 'not-measured' }, { threadId: null }, { processed: null }, { roleType: null }]) {
    assert.throws(() => verifyEpisodePair({ ...p.list, ...bad }, p.get, p.request, p.get.uuid));
  }
  const sdkUndefined = captureSdkEpisode({ ...p.get, threadId: undefined, score: undefined });
  assert.deepEqual(sdkUndefined.undefinedOptionalFields, ['score', 'threadId']);
  assert.equal(Object.hasOwn(sdkUndefined.row, 'threadId'), false);
  assert.ok(!Object.hasOwn(captureSdkEpisode({ ...p.get, unknown_native_field: undefined }), 'unknownNativeFields'));
  for (const bad of [{ metadata: undefined }, { session_id: undefined }]) assert.throws(() => captureSdkEpisode({ ...p.get, ...bad }));
  let calls = 0; const getter = { ...p.get }; Object.defineProperty(getter, 'threadId', { enumerable: true, get() { calls++; return undefined; } });
  assert.throws(() => captureSdkEpisode(getter), /Accessor/); assert.equal(calls, 0);
  assert.throws(() => verifyEpisodePair({ ...p.list, sourceDescription: 'foreign' }, { ...p.get, sourceDescription: 'foreign' }, p.request, p.get.uuid), /description/);
});
test('GET and submitted source_at cannot disagree even if both endpoint bodies/provenance agree', () => {
  const p = oneProjection(); p.request.metadata.source_at = '2026-09-02T09:00:00Z';
  p.get.metadata = clone(p.request.metadata); p.list.metadata = clone(p.request.metadata);
  assert.throws(() => verifyEpisodePair(p.list, p.get, p.request, p.get.uuid), /Submitted event time/);
});
test('raw endpoint fingerprint changes independently of precise lawful stable inventory identity', () => {
  const b = prepared(), o = observed(b), graph = b.manifest.topology[0], authority = o.authorities[0], snapshot = o.snapshots.get(graph.graphId);
  const rows = b.payloads.rows.filter(r => r.variant === graph.variant && r.logicalRoom === graph.logicalRoom);
  const first = verifySnapshot(snapshot, authority, rows), secondSnapshot = clone(snapshot);
  secondSnapshot.episodes[0].createdAt = '2026-10-03T12:00:00.999999Z';
  const second = verifySnapshot(secondSnapshot, authority, rows);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.episodeEndpointObservations[0].list.sha256, second.episodeEndpointObservations[0].list.sha256);
  assert.equal(first.episodeEndpointObservations[0].directGet.sha256, second.episodeEndpointObservations[0].directGet.sha256);
});
test('auto episode time and optional layout stay strict pending a measured search projection contract', () => {
  const b = prepared(), o = observed(b), graph = b.manifest.topology[0], snapshot = o.snapshots.get(graph.graphId);
  const rows = b.payloads.rows.filter(r => r.variant === graph.variant && r.logicalRoom === graph.logicalRoom), v = verifySnapshot(snapshot, o.authorities[0], rows);
  const get = snapshot.originals[0], options = { maxNodes: 12, snapshotAt: b.manifest.snapshotAt };
  assert.doesNotThrow(() => formatContext({ episodes: [get] }, v, 'auto-raw', options));
  for (const changed of [{ ...get, createdAt: snapshot.episodes[0].createdAt }, { ...get, session_id: null }]) {
    assert.throws(() => formatContext({ episodes: [changed] }, v, 'auto-raw', options), /episode_changed_or_unobserved/);
  }
});
test('exact retained independent date-only counterexample refuses old source and passes corrected contract', async () => {
  assert.ok(process.env.D3_PROJECTION_EVIDENCE && process.env.D3_OLD_LINEAGE);
  const retained = JSON.parse(await readFile(process.env.D3_PROJECTION_EVIDENCE, 'utf8')), f = retained.fixture;
  const { verifySnapshot: oldVerify } = await import(pathToFileURL(process.env.D3_OLD_LINEAGE));
  assert.throws(() => oldVerify(f.snapshot, f.authority, [f.row]), /LIST\/original GET differs/);
  const corrected = verifySnapshot(f.snapshot, f.authority, [f.row]);
  assert.equal(corrected.episodeEndpointObservations[0].list.createdAt, retained.SDK.parsedPairs[0].rawListCreatedAt);
  assert.equal(corrected.episodeEndpointObservations[0].directGet.createdAt, f.row.members[0].payload.request.createdAt);
  if (d3Evidence) await writeFile(join(d3Evidence, 'exact-independent-counterexample-after.json'), encode({
    syntheticSchema4Fixture: true, retainedProviderMetadataIsNotSchema4: true, oldDateOnlyFalseHold: true,
    oldObservedResult: retained.counterexample, corrected: { fingerprint: corrected.fingerprint, endpoints: corrected.episodeEndpointObservations },
  }), { flag: 'wx' });
});
test('actual installed SDK loopback preserves both exact retained nullable/time layouts without schema4 certification', async () => {
  const retained = JSON.parse(await readFile(process.env.D3_PROJECTION_EVIDENCE, 'utf8')), calls = [];
  const pairs = retained.retainedRaw.pairs;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const path = new URL(req.url, 'http://127.0.0.1').pathname; calls.push({ method: req.method, path });
    const pair = pairs.find(p => path.endsWith(p.uuid)) ?? pairs[calls.filter(c => c.method === 'POST').length - 1];
    assert.ok(pair); res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.method === 'GET' ? pair.get.raw : [pair.list.raw]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, client = new ZepClient({ apiKey: 'synthetic-loopback-only', baseUrl: origin });
  try {
    const results = [];
    for (const pair of pairs) {
      const get = await client.graph.episode.get(pair.uuid, { maxRetries: 0 });
      const list = (await client.graph.episode.listByGraphId('synthetic-retained-layout', { limit: 50, orderBy: 'uuid', direction: 'asc' }, { maxRetries: 0 }))[0];
      if (d3Evidence) await writeFile(join(d3Evidence, `retained-sdk-descriptors-${pair.uuid}.json`), encode({
        calls: clone(calls), get: Object.entries(get).map(([key, value]) => ({ key, type: typeof value, isNull: value === null })),
        list: Object.entries(list).map(([key, value]) => ({ key, type: typeof value, isNull: value === null })),
      }), { flag: 'wx' });
      const projected = verifyEpisodePair(list, get, { data: get.content, metadata: get.metadata, createdAt: get.metadata.source_at,
        type: get.source, sourceDescription: get.sourceDescription }, pair.uuid);
      assert.equal(list.createdAt, pair.list.raw.created_at); assert.equal(get.createdAt, pair.get.raw.created_at);
      assert.equal(get.session_id, null); assert.equal(list.session_id, null);
      assert.notEqual(get.metadata.schema, 4); results.push({ get, list, projected });
    }
    assert.equal(calls.length, 4);
    if (d3Evidence) await writeFile(join(d3Evidence, 'retained-sdk-loopback-layouts.json'), encode({
      qualification: 'Exact previously captured B18l-offline-control-v1 layouts over owned loopback; not new Cloud/schema4 evidence', calls, results,
    }), { flag: 'wx' });
  } finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
});

test('exact retained EntityEdge/Node rows pass actualSDK loopback closed capture; old generic json refusal preserved', async () => {
  assert.ok(process.env.D3_NATIVE_COLLECTION_EVIDENCE);
  const retained = JSON.parse(await readFile(process.env.D3_NATIVE_COLLECTION_EVIDENCE, 'utf8')), calls = [];
  const graphId = 'synthetic-retained-layout-graph';
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const path = new URL(req.url, 'http://127.0.0.1').pathname, kind = path.includes('/edge/') ? 'edge' : 'node';
    calls.push({ method: req.method, path }); res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify([retained.results.find(r => r.collection === kind).rawFirst]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new ZepClient({ apiKey: 'synthetic-loopback-only', baseUrl: `http://127.0.0.1:${server.address().port}` });
  try {
    const results = [];
    for (const kind of ['edge', 'node']) {
      const method = kind === 'edge' ? client.graph.edge.getByGraphId.bind(client.graph.edge) : client.graph.node.getByGraphId.bind(client.graph.node);
      const input = (await method(graphId, { limit: 50, orderBy: 'uuid', direction: 'asc' }, { maxRetries: 0 }))[0];
      assert.throws(() => json(input));
      const c = captureSdkEntity(input, kind, { graphId, endpoint: 'list' });
      const fixtureBindings = new Map(c.row.episodes.map(id => [id, { fixtureOnlyCurrentBinding: true }]));
      assert.doesNotThrow(() => verifyEntityScope(c.row, kind, graphId, fixtureBindings, c.layout, 'list'));
      assert.equal(c.row.graph_id, ''); assert.deepEqual(c.layout.undefinedOptionalFields, ['score']);
      assert.equal(c.layout.requestGraphId, graphId); assert.equal(c.layout.graphIdQualification, 'empty-native-placeholder-request-scope-only');
      if (kind === 'node') { assert.equal(c.row.episodes_truncated, false); assert.deepEqual(c.row.episodes, retained.results.find(r => r.collection === kind).rawFirst.episodes); }
      results.push({ kind, captured: c });
    }
    assert.equal(calls.length, 2);
    if (d3Evidence) await writeFile(join(d3Evidence, 'retained-native-entity-layouts.json'), encode({
      qualification: 'Two exact retained LIST row layouts over owned loopback with synthetic request scope/current bindings; no real current authority or schema4 backfill', calls, results,
    }), { flag: 'wx' });
  } finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
});

const entityNativeLayout = (call, value, obs, truncated = false) => {
  if (call.path.startsWith('/graph/edge/graph/')) return value.map(e => ({ ...e, graph_id: '', score: null }));
  if (call.path.startsWith('/graph/node/graph/')) {
    const graphId = decodeURIComponent(call.path.split('/').at(-1)), ids = obs.snapshots.get(graphId).episodes.map(e => e.uuid);
    return value.map(n => ({ ...n, graph_id: '', score: null, episodes: clone(ids), episodes_truncated: truncated }));
  }
  if (call.path === '/graph/search') return { ...value, edges: value.edges.map(e => ({ ...e, graph_id: '' })) };
  return value;
};
test('actualSDK full read/search flow binds empty native graph placeholders and lawful node associations', async () => {
  const h = await harness(undefined, { response: entityNativeLayout });
  try {
    const r = await h.run(); assert.equal(r.status, 'captured-unjudged'); assert.equal(r.summary.modelCalls, 6);
    for (const o of r.observations) {
      assert.ok(o.raw.nodes.every(n => n.graph_id === '' && n.episodes_truncated === false));
      assert.ok(o.entityEndpointObservations.every(e => e.layout.requestGraphId === o.graphId && e.layout.undefinedOptionalFields.includes('score')));
      assert.ok(o.entityEndpointObservations.every(e => e.layout.graphIdQualification === 'empty-native-placeholder-request-scope-only'));
    }
    assert.ok(r.records.filter(x => x.job.mode === 'edges-plus-selected-node-summaries').every(x => x.context.includes('nativeNodeEpisodeIds') && x.context.includes('not native lineage')));
    assert.ok(r.attempts.filter(a => /\/graph\/(?:edge|node)\/graph\//.test(new URL(a.request.url).pathname)).every(a => a.response.includes('"score":null')));
  } finally { await h.close(); }
});
test('truncated native node associations hold selected summaries while preserving standalone edge comparisons', async () => {
  const h = await harness(undefined, { response: (c,v,o) => entityNativeLayout(c,v,o,true) });
  try {
    const r = await h.run(); assert.equal(r.status, 'incomplete'); assert.equal(r.summary.modelCalls, 4);
    const nodes = r.records.filter(x => x.job.mode === 'edges-plus-selected-node-summaries');
    assert.equal(nodes.length, 2); assert.ok(nodes.every(x => x.status === 'held' && x.error === 'node_episode_associations_truncated'));
    assert.ok(r.records.filter(x => x.job.mode === 'edges-cross-encoder').every(x => x.status === 'captured-unjudged'));
    assert.ok(r.observations.every(o => o.raw.nodes.every(n => n.episodes_truncated === true)));
  } finally { await h.close(); }
});
test('actualSDK foreign nonempty native graph ID refuses before any answer', async () => {
  const h = await harness(undefined, { response: (c,v) => c.path.startsWith('/graph/edge/graph/') ? v.map(e => ({ ...e, graph_id: 'foreign-physical-graph' })) : v });
  try { const r = await h.run(); assert.equal(r.status,'held'); assert.equal(h.calls.filter(c=>c.path==='/answer').length,0); }
  finally { await h.close(); }
});
test('actualSDK node list cannot conceal foreign episode association among lawful bindings', async () => {
  const h = await harness(undefined, { response: (c,v,o) => {
    const value = entityNativeLayout(c,v,o);
    return c.path.startsWith('/graph/node/graph/') ? value.map(n => ({ ...n, episodes: [...n.episodes,'foreign-episode'] })) : value;
  } });
  try { const r = await h.run(); assert.equal(r.status,'held'); assert.equal(h.calls.filter(c=>c.path==='/answer').length,0); }
  finally { await h.close(); }
});
test('entity capture sets unknown fields aside and rejects required undefined, invalid arrays/time/fields and getters', () => {
  const b=prepared(),o=observed(b),graph=b.manifest.topology[0],s=o.snapshots.get(graph.graphId);
  for (const kind of ['edge','node']) {
    const row=kind==='edge'?s.edges[0]:s.nodes[0];
    const labels=kind==='edge'?{sourceNodeLabels:[''],targetNodeLabels:[]}:{labels:['']};
    assert.doesNotThrow(()=>captureSdkEntity({...row,...labels},kind,{graphId:graph.graphId,endpoint:'list'}));
    assert.deepEqual(captureSdkEntity({...row,unknown_native:null},kind,{graphId:graph.graphId,endpoint:'list'}).layout.unknownNativeFields,{unknown_native:null});
    assert.ok(!Object.hasOwn(captureSdkEntity({...row,unknown_native:undefined},kind,{graphId:graph.graphId,endpoint:'list'}).layout,'unknownNativeFields'));
    for(const bad of [{uuid:undefined},{graph_id:undefined},{score:'wrong'},
      {createdAt:'2026-02-30T12:00:00Z'},{attributes:[]},{selectionRank:-1}]) assert.throws(()=>captureSdkEntity({...row,...bad},kind,{graphId:graph.graphId,endpoint:'list'}));
    let calls=0; const getter={...row};Object.defineProperty(getter,'score',{enumerable:true,get(){calls++;return undefined;}});
    assert.throws(()=>captureSdkEntity(getter,kind,{graphId:graph.graphId,endpoint:'list'}),/Accessor/);assert.equal(calls,0);
  }
  for(const bad of [{episodes:['one']},{episodes_truncated:false},{episodes:['one'],episodes_truncated:'false'},
    {episodes:['one','one'],episodes_truncated:false},{episodes:[1],episodes_truncated:false}]) {
    assert.throws(()=>captureSdkEntity({...s.nodes[0],...bad},'node',{graphId:graph.graphId,endpoint:'list'}));
  }
});
test('empty graph placeholder requires captured correct scope and layout hash; nonempty exact scope accepted', () => {
  const b=prepared(),o=observed(b),g=b.manifest.topology[0],s=o.snapshots.get(g.graphId),ids=new Map(s.episodes.map(e=>[e.uuid,{}]));
  const c=captureSdkEntity({...s.edges[0],graph_id:'',score:undefined},'edge',{graphId:g.graphId,endpoint:'list'});
  assert.throws(()=>verifyEntityScope(c.row,'edge',g.graphId,ids,undefined,'list'),/captured request scope/);
  for(const change of [{requestGraphId:'foreign'},{endpoint:'search'},{sha256:'0'.repeat(64)},
    {undefinedOptionalFields:['unknown']}]) assert.throws(()=>verifyEntityScope(c.row,'edge',g.graphId,ids,{...c.layout,...change},'list'));
  const exact={...s.edges[0],graph_id:g.graphId};assert.doesNotThrow(()=>verifyEntityScope(exact,'edge',g.graphId,ids,undefined,'list'));
});
test('typed node search may omit LIST passthrough association but supplied associations must match exact current inventory', () => {
  const b=prepared(),o=observed(b),g=b.manifest.topology[0],s=o.snapshots.get(g.graphId),a=o.authorities[0];
  s.nodes=s.nodes.map(n=>({...n,episodes:s.episodes.map(e=>e.uuid),episodes_truncated:false}));
  const v=verifySnapshot(s,a,b.payloads.rows.filter(r=>r.variant===g.variant&&r.logicalRoom===g.logicalRoom));
  const {episodes,episodes_truncated,...typed}=s.nodes[0],options={maxNodes:12,snapshotAt:b.manifest.snapshotAt};
  const c=formatContext({nodes:[typed]},v,'auto-raw',options);
  assert.ok(c.context.includes('nativeNodeEpisodeIds'));assert.equal(c.derivativeQualification,'Incident episode association is not proof of every node-summary sentence');
  for(const changed of [{...s.nodes[0],episodes:[...episodes,'foreign']},{...s.nodes[0],episodes:episodes.slice(1)},
    {...s.nodes[0],summary:s.nodes[0].summary+' changed'}]) assert.throws(()=>formatContext({nodes:[changed]},v,'auto-raw',options));
});

test('exact independent primary SDK search envelopes absent/null both capture over actualSDK loopback', async () => {
  assert.ok(process.env.D3_OUTER_ENVELOPE_EVIDENCE);
  const prior=JSON.parse(await readFile(process.env.D3_OUTER_ENVELOPE_EVIDENCE,'utf8')),calls=[];let index=0;
  const server=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);
    calls.push({method:req.method,path:new URL(req.url,'http://127.0.0.1').pathname});res.setHeader('content-type','application/json');
    res.end(JSON.stringify(prior.cases[index++].wire));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const budget=new RunBudget(DEFAULT_LIMITS),graphId='synthetic-physical-graph';
  const port=createSdkReadPort({ZepClient,baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic-only',purpose:'local-fixture',budget,current:()=>true});
  try {
    const rows=[];for(const fixture of prior.cases){const captured=await port.search(graphId,'Synthetic question','edges-cross-encoder');
      assert.equal(captured.edges[0].uuid,fixture.wire.edges[0].uuid);assert.doesNotThrow(()=>verifySearchEnvelope(captured,graphId));rows.push(captured);}
    assert.deepEqual(rows[0].sdkEnvelopeLayout.undefinedOptionalFields,[]);
    assert.deepEqual(rows[1].sdkEnvelopeLayout.undefinedOptionalFields,['context','episodes','nodes','observations','threadSummaries']);
    assert.deepEqual(rows[1].sdkEnvelopeLayout.responseLayout.undefinedOptionalFields,['serverLatencyMs']);
    assert.deepEqual(rows[1].response,{});assert.equal(budget.models,0);assert.equal(calls.length,2);
    assert.equal(JSON.parse(budget.attempts[1].response).nodes,null);
    if(d3Evidence)await writeFile(join(d3Evidence,'exact-outer-envelope-after.json'),encode({
      syntheticPrimarySDKDerived:true,nativeSearchResponseNotObserved:true,priorOutcomes:prior.cases.map(c=>c.outcome),captured:rows,calls,attempts:budget.attempts,models:0}),{flag:'wx'});
  }finally{await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
});
test('actualSDK complete search flow accepts declared optional-null envelope with explicit layouts and lawful edges', async()=>{
  const h=await harness(undefined,{response:(c,v)=>c.path==='/graph/search'?{...v,nodes:null,episodes:null,observations:null,context:null,
    response:{serverLatencyMs:null},threadSummaries:null}:v});
  try {const r=await h.run();assert.equal(r.status,'captured-unjudged');assert.equal(r.summary.modelCalls,6);
    const retrievals=h.events.filter(e=>e.kind==='retrieval');assert.equal(retrievals.length,4);
    assert.ok(retrievals.every(e=>e.value.raw.sdkEnvelopeLayout.undefinedOptionalFields.includes('nodes')));
    assert.ok(retrievals.every(e=>e.value.raw.sdkEnvelopeLayout.responseLayout.undefinedOptionalFields[0]==='serverLatencyMs'));
    assert.ok(r.attempts.filter(a=>new URL(a.request.url).pathname==='/graph/search').every(a=>a.response.includes('"nodes":null')));
  }finally{await h.close();}
});
test('actualSDK Graph optional-null layout preserves strict IDs and arbitrary graph UUID rather than room UUID', async()=>{
  const h=await harness(undefined,{response:(c,v)=>/^\/graph\/[^/]+$/.test(c.path)&&c.path!=='/graph/search'?{...v,
    createdAt:null,description:null,id:null,name:null,timeZone:null,updatedAt:null,uuid:'synthetic-independent-native-graph-uuid'}:v});
  try {const r=await h.run();assert.equal(r.status,'captured-unjudged');
    assert.ok(r.observations.every(o=>o.raw.graph.uuid==='synthetic-independent-native-graph-uuid'&&o.raw.graph.graphId===o.graphId));
    assert.ok(r.observations.every(o=>canonical(o.raw.sdkGraphLayout.undefinedOptionalFields)===canonical(['createdAt','description','id','name','timeZone','updatedAt'])));
  }finally{await h.close();}
});
test('supplied present/empty Search collections and latency remain explicit capture; opaque context is unused', async()=>{
  const h=await harness(undefined,{response:(c,v)=>c.path==='/graph/search'?{...v,context:'OPAQUE_CONTEXT_MUST_NOT_REACH_MODEL',nodes:[],episodes:[],observations:[],
    threadSummaries:[],response:{serverLatencyMs:2}}:v});
  try {const r=await h.run();assert.equal(r.status,'captured-unjudged');assert.equal(r.summary.modelCalls,6);
    assert.ok(h.events.filter(e=>e.kind==='retrieval').every(e=>e.value.raw.response.serverLatencyMs===2&&e.value.raw.sdkEnvelopeLayout.undefinedOptionalFields.length===0));
    assert.ok(r.records.every(x=>!x.context.includes('OPAQUE_CONTEXT')));
  }finally{await h.close();}
});
test('actualSDK malformed/unknown/conflicting Search envelopes hold before any model attempt', async()=>{
  for(const bad of [{nodes:{}},{context:3},{response:{serverLatencyMs:'wrong'}},{threadSummaries:{}},{sdkGraphLayout:null},
    {sdkEnvelopeLayout:{}},{sdkEntityLayouts:{}},{response:{serverLatencyMs:{}}}]){
    const h=await harness(undefined,{response:(c,v)=>c.path==='/graph/search'?{...v,...bad}:v});
    try {const r=await h.run();assert.ok(r.status==='incomplete'||r.status==='held');assert.equal(h.calls.filter(c=>c.path==='/answer').length,0);
      assert.equal(r.summary.modelCalls,0);}finally{await h.close();}
  }
});
test('actualSDK Graph missing/conflicting required scope or unknown shape holds before collection/model', async()=>{
  for(const bad of [{graphId:null},{projectUuid:null},{graphId:'foreign'},{createdAt:3},{updatedAt:{}},{sdkGraphLayout:null},{id:'not-number'}]){
    const h=await harness(undefined,{response:(c,v)=>/^\/graph\/[^/]+$/.test(c.path)&&c.path!=='/graph/search'?{...v,...bad}:v});
    try {const r=await h.run();assert.equal(r.status,'held');assert.equal(h.calls.length,1);assert.equal(r.summary.modelCalls,0);}finally{await h.close();}
  }
});
test('omitted/null raw collections remain captured unknown scope rather than certified absence/model fallback', async()=>{
  for(const value of [{},{edges:null,nodes:null,episodes:null,context:null}]){
    const h=await harness(undefined,{response:(c,v)=>c.path==='/graph/search'?value:v});
    try {const r=await h.run();assert.equal(r.status,'incomplete');assert.equal(r.summary.modelCalls,0);
      assert.equal(h.calls.filter(c=>c.path==='/answer').length,0);assert.ok(r.records.every(row=>row.status==='held'));
    }finally{await h.close();}
  }
});
test('shared declared descriptor and envelope layout guard rejects unknown undefined/accessors/proxies/nonfinite/tampering',()=>{
  const graph={graphId:'g',projectUuid:'p'};
  for(const bad of [{unknown:undefined},{graphId:undefined},{projectUuid:undefined},{id:Infinity},{createdAt:'2026-02-30T00:00:00Z'}])assert.throws(()=>captureSdkGraph({...graph,...bad},'g'));
  for(const bad of [{unknown:undefined},{response:{serverLatencyMs:Infinity}},{response:{serverLatencyMs:-1}},{nodes:3},{sdkEnvelopeLayout:{}}])assert.throws(()=>captureSdkSearch(bad,'g'));
  let calls=0;const getter={};Object.defineProperty(getter,'nodes',{enumerable:true,get(){calls++;return undefined;}});
  assert.throws(()=>captureSdkSearch(getter,'g'),/Accessor/);assert.equal(calls,0);
  assert.throws(()=>captureSdkSearch(new Proxy({},{}),'g'));
  const array=[];Object.defineProperty(array,'0',{enumerable:true,get(){calls++;return {};}});
  assert.throws(()=>captureDeclaredArray(array));assert.equal(calls,0);
  assert.throws(()=>captureDeclaredObject({unknown:undefined},{keys:['known'],optionalUndefined:['known']}));
  const captured=captureSdkSearch({edges:[],nodes:undefined,response:{serverLatencyMs:undefined}},'g');
  assert.doesNotThrow(()=>verifySearchEnvelope(captured,'g'));
  for(const mutate of [v=>v.sdkEnvelopeLayout.requestGraphId='foreign',v=>v.sdkEnvelopeLayout.sha256='0'.repeat(64),
    v=>v.sdkEnvelopeLayout.undefinedOptionalFields=['edges'],v=>v.sdkEnvelopeLayout.responseLayout.undefinedOptionalFields=['unknown']]){
    const changed=clone(captured);mutate(changed);assert.throws(()=>verifySearchEnvelope(changed,'g'));
  }
});
test('unapproved/incorrect external manifest permits refuse before any read/model attempt', async () => {
  const h = await harness(); try { await assert.rejects(h.run({ permit: { ...h.permit, approved: false } })); assert.equal(h.calls.length, 0);
    await assert.rejects(h.run({ permit: { ...h.permit, manifestSha256: '0'.repeat(64) } })); assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});
test('initial current false/truthy/Promise refuses with no network', async () => {
  for (const value of [false, 1, Promise.resolve(true)]) {
    const h = await harness(undefined, { current: () => value }); try { const r = await h.run(); assert.equal(r.status, 'held'); assert.equal(h.calls.length, 0); } finally { await h.close(); }
  }
});
test('current authority changing during a real awaited response stops before model', async () => {
  let valid = true; const h = await harness(undefined, { current: () => valid, response: (c, v) => { if (c.path === '/graph/search') valid = false; return v; } });
  try { const r = await h.run(); assert.equal(r.status, 'held'); assert.equal(h.calls.filter(c => c.path === '/answer').length, 0); assert.ok(r.attempts.some(a => a.status === 'unknown')); } finally { await h.close(); }
});
test('expired permit and endpoint drift deny before native calls', async () => {
  const h = await harness(); try {
    const r = await h.run({ permit: { ...h.permit, expiresAt: '2000-01-01T00:00:00Z' } }); assert.equal(r.status, 'held'); assert.equal(h.calls.length, 0);
    await assert.rejects(h.run({ permit: { ...h.permit, readOrigin: 'http://127.0.0.1:1' } }));
  } finally { await h.close(); }
});
test('native LIST vs strict original GET body drift holds before retrieval', async () => {
  const h = await harness(undefined, { response: (c, v) => /^\/graph\/episodes\/[^/]+$/.test(c.path) ? { ...v, content: v.content + ' changed' } : v });
  try { const r = await h.run(); assert.equal(r.status, 'held'); assert.equal(h.calls.filter(c => c.path === '/graph/search').length, 0); } finally { await h.close(); }
});
test('permissiveSDK missing edge episodes holds local shape; no answer for malformed result', async () => {
  const h = await harness(undefined, { response: (c, v) => { if (c.path === '/graph/search') { const x = clone(v); delete x.edges[0].episodes; return x; } return v; } });
  try { const r = await h.run(); assert.equal(r.status, 'incomplete'); assert.ok(r.records.every(x => x.status === 'held')); assert.equal(h.calls.filter(c => c.path === '/answer').length, 0); } finally { await h.close(); }
});
test('an unknown Entity key is set aside and changes no result; a changed edge direction is locally held', async () => {
  const statuses = async mutate => {
    const h = await harness(undefined, { response: (c, v) => c.path === '/graph/search' ? mutate(v) : v });
    try { const r = await h.run(); return { records: r.records.map(x => x.status), answers: h.calls.filter(c => c.path === '/answer').length }; } finally { await h.close(); }
  };
  const plain = await statuses(v => v), mystery = await statuses(v => ({ ...v, edges: v.edges.map(e => ({ ...e, mystery: true })) }));
  assert.ok(plain.records.some(s => s !== 'held')); assert.deepEqual(mystery, plain);
  const turned = await statuses(v => ({ edges: v.edges.map(e => ({ ...e, targetNodeUuid: 'unobserved' })) }));
  assert.ok(turned.records.every(s => s === 'held')); assert.equal(turned.answers, 0);
});
test('malformed optional native result collections remain held, never empty-success', async () => {
  const h = await harness(undefined, { response: (c, v) => c.path === '/graph/search' ? { ...v, episodes: {} } : v });
  try { const r = await h.run(); assert.equal(r.status, 'held'); assert.equal(r.error, 'native_wire_GraphSearchResults_episodes_array');
    assert.equal(r.attempts.at(-1).status, 'unknown'); assert.ok(r.attempts.at(-1).response.includes('"episodes":{}'));
    assert.equal(r.records.length, 1); assert.equal(r.records[0].status, 'unknown');
    assert.equal(r.records[0].error, r.error); assert.equal(r.records[0].usableForComparison, false);
    assert.equal(r.summary.modelCalls, 0); assert.equal(h.calls.filter(c => c.path === '/answer').length, 0); }
  finally { await h.close(); }
});
test('finite signed native scores are retained; only selectionRank uses a nonnegative integer contract', async () => {
  const h = await harness(undefined, { response: (c, v) => c.path === '/graph/search' ? { ...v, edges: v.edges.map(e => ({ ...e, score: -2.5, relevance: -.2 })) } : v });
  try { const r = await h.run(); assert.equal(r.status, 'captured-unjudged'); assert.equal(r.summary.modelCalls, 6); }
  finally { await h.close(); }
  const b = prepared(), o = observed(b), g = b.manifest.topology[0], raw = o.snapshots.get(g.graphId);
  const v = verifySnapshot(raw, o.authorities[0], b.payloads.rows.filter(r => r.variant === g.variant && r.logicalRoom === g.logicalRoom));
  for (const rank of [-1, .5]) assert.throws(() => formatContext({ edges: raw.edges.map(e => ({ ...e, selectionRank: rank })) }, v, 'auto-raw', { maxNodes: 12, snapshotAt: b.manifest.snapshotAt }));
});
test('auto opaque-only and thread summary without native lineage remain held diagnostics', async () => {
  for (const raw of [{ context: 'OPAQUE_SECRET' }, { threadSummaries: [{ uuid: 't', createdAt: '2026-10-03T00:00:00Z', name: 'T', summary: 'Untraced summary' }] }]) {
    const h = await harness(undefined, { response: (c, v) => c.path === '/graph/search' && c.body.scope === 'auto' ? raw : v });
    try { const r = await h.run(); assert.ok(r.records.filter(x => x.job.mode === 'auto-raw').every(x => x.status === 'held')); assert.equal(h.calls.filter(c => c.path === '/answer').length, 4); } finally { await h.close(); }
  }
});
test('T1 observed inventory drift retains raw answers but invalidates whole comparison', async () => {
  let gets = 0; const h = await harness(undefined, { response: (c, v) => { if (/^\/graph\/viberoom-/.test(c.path) && ++gets > 2) return { ...v, name: 'changed' }; return v; } });
  try { const r = await h.run(); assert.equal(r.status, 'held'); assert.equal(r.error, 'observed_inventory_drift'); assert.ok(r.records.every(x => x.answer && x.usableForComparison === false)); } finally { await h.close(); }
});
test('HTTP error records one uncertain read, stops and does not retry/fallback', async () => {
  const h = await harness(undefined, { status: () => 500 }); try { const r = await h.run(); assert.equal(r.status, 'held'); assert.equal(h.calls.length, 1); assert.equal(r.summary.reads, 1); assert.equal(r.summary.modelCalls, 0); } finally { await h.close(); }
});
test('body/aggregate shared caps stop with bounded raw prefix and attempted status', async () => {
  const b = prepared(undefined, { ...DEFAULT_LIMITS, maxResponseBytes: 100, maxAggregateBytes: 150 });
  const h = await harness(b); try { const r = await h.run(); assert.equal(r.status, 'held'); assert.ok(r.attempts.some(a => a.status === 'unknown')); assert.ok(r.attempts.every(a => a.response === null || Buffer.byteLength(a.response) <= 100)); } finally { await h.close(); }
});
test('page continuation cap and cycle hold instead of inferring complete inventory', async () => {
  const h = await harness(undefined, { headers: c => c.path.startsWith('/graph/episodes/graph/') ? { 'Zep-Next-Cursor': 'same-cursor' } : {} });
  try { const r = await h.run(); assert.equal(r.status, 'held'); assert.equal(h.calls.filter(c => c.path === '/answer').length, 0); } finally { await h.close(); }
});
test('noncooperative awaited local port timeout prevents late continuation', async () => {
  const budget = new RunBudget({ ...DEFAULT_LIMITS, requestMs: 15, runMs: 100 });
  await assert.rejects(awaited(budget, () => new Promise(resolve => setTimeout(() => resolve('late'), 30))), /deadline_unknown/);
  assert.equal(budget.stopped, true); await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(budget.models, 0);
});
test('answer failure/missing usage preserves null metrics and never retries a model', async () => {
  for (const invalid of [true, false]) {
    const h = await harness(undefined, { response: (c, v) => c.path === '/answer' ? invalid ? { choices: [] } : { choices: v.choices } : v });
    try { const r = await h.run(); if (invalid) { assert.equal(r.status, 'held'); assert.equal(h.calls.filter(c => c.path === '/answer').length, 1); }
      else { assert.equal(r.status, 'captured-unjudged'); assert.ok(r.records.every(x => x.inputTokens === null && x.outputTokens === null)); }
    } finally { await h.close(); }
  }
});
test('strict identities deny wrong account graph/project/copy/version/ordinal/native source extras', () => {
  const b = prepared(), o = observed(b), g = b.manifest.topology[0], raw = o.snapshots.get(g.graphId), a = o.authorities[0];
  const rows = b.payloads.rows.filter(r => r.variant === g.variant && r.logicalRoom === g.logicalRoom);
  for (const mutate of [x => x.projectId = 'wrong', x => x.copyId = 'wrong', x => x.room = 'foreign', x => x.members[0].version = 'wrong', x => x.members[0].part = '1/2', x => x.members.push(clone(x.members[0]))]) {
    const changed = clone(a); mutate(changed); assert.throws(() => verifySnapshot(raw, changed, rows));
  }
  const extra = clone(raw); extra.episodes.push({ ...extra.episodes[0], uuid: 'foreign' }); assert.throws(() => verifySnapshot(extra, a, rows));
});
test('all edge episode lineage must be authorized/current; one compatible reference does not hide another', () => {
  const b = prepared(), o = observed(b), g = b.manifest.topology[0], raw = clone(o.snapshots.get(g.graphId));
  raw.edges[0].episodes.push('foreign-episode');
  assert.throws(() => verifySnapshot(raw, o.authorities[0], b.payloads.rows.filter(r => r.variant === g.variant && r.logicalRoom === g.logicalRoom)));
});
test('UTF8 cap counts provenance and whole multibyte items; no hidden second node allowance', () => {
  const b = prepared(), o = observed(b), g = b.manifest.topology[0], raw = o.snapshots.get(g.graphId);
  raw.edges[0].fact = 'Чай☕'.repeat(260); raw.nodes[0].summary = '茶'.repeat(300); raw.nodes[1].summary = '🙂'.repeat(300);
  const v = verifySnapshot(raw, o.authorities[0], b.payloads.rows.filter(r => r.variant === g.variant && r.logicalRoom === g.logicalRoom));
  const c = formatContext({ edges: raw.edges }, v, 'edges-plus-selected-node-summaries', { maxNodes: 12, snapshotAt: b.manifest.snapshotAt });
  assert.ok(c.utf8Bytes <= 4096); assert.equal(c.utf8Bytes, Buffer.byteLength(c.context)); assert.ok(c.omissions.length > 0);
  assert.equal(Buffer.from(c.context).toString('utf8'), c.context); assert.ok(c.context.includes('provenance'));
});
test('long baseline native context cannot acquire missing local full-original tail through source joins', () => {
  const b = prepared(long), o = observed(b), g = b.manifest.topology.find(g => g.variant === 'baseline-off-current' && g.logicalRoom === 'library');
  const row = b.payloads.rows.find(r => r.variant === g.variant && r.sourceId === 's18'), original = long.payloads.rows.find(r => r.variant === 'original-profile' && r.sourceId === 's18');
  assert.ok(row.condenserUsed && row.members[0].payload.request.data !== original.members[0].payload.request.data);
  const raw = o.snapshots.get(g.graphId), v = verifySnapshot(raw, o.authorities.find(a => a.graphId === g.graphId), b.payloads.rows.filter(r => r.variant === g.variant && r.logicalRoom === g.logicalRoom));
  const ep = raw.originals.find(e => e.metadata.source_id === 's18');
  const c = formatContext({ episodes: [ep] }, v, 'auto-raw', { maxNodes: 12, snapshotAt: b.manifest.snapshotAt });
  const tail = original.members[0].payload.request.data.slice(-120);
  assert.ok(!ep.content.includes(tail)); assert.ok(!c.context.includes(tail));
  assert.ok(c.context.includes(ep.content)); assert.ok(!c.context.includes(original.members[0].payload.request.data));
  assert.equal(v.sourceMap.get('s18').bodySha256, row.sourceBodySha256); assert.notEqual(sha256(ep.content), row.sourceBodySha256);
});
test('getter/proxy arrays, gold-projection extras and incompatible shared caps fail closed before I/O', () => {
  const x = inputs(); x.questions.queries[0].claims = ['leaked']; assert.throws(() => prepared(x));
  const getter = []; Object.defineProperty(getter, '0', { enumerable: true, get() { throw new Error('getter executed'); } });
  assert.throws(() => json(getter), /Accessor/); assert.throws(() => json(new Proxy({}, {})), /proxy/);
  assert.throws(() => prepared(undefined, { ...DEFAULT_LIMITS, maxReads: 1 }), /Shared budget/);
});
test('D2 input fingerprint drift is refused before creating connected jobs', () => {
  const x = inputs(); x.payloads.rows[0].members[0].payload.request.data += ' changed'; assert.throws(() => prepared(x), /D2 prepared input hash/);
});
test('external durable attempt recorder refusal stops before HTTP or model launch', async () => {
  const h = await harness(undefined, { recordAttempt: () => false });
  try { const r = await h.run(); assert.equal(r.status, 'held'); assert.equal(r.error, 'attempt_record_refused'); assert.equal(h.calls.length, 0); assert.equal(r.attempts.length, 1); }
  finally { await h.close(); }
});
test('fact validity labels preserve observed time/direction; future invalidation is not current deletion', () => {
  const b = prepared(), o = observed(b), g = b.manifest.topology[0], raw = o.snapshots.get(g.graphId);
  raw.edges[0].invalidAt = '2030-01-01T00:00:00Z';
  const v = verifySnapshot(raw, o.authorities[0], b.payloads.rows.filter(r => r.variant === g.variant && r.logicalRoom === g.logicalRoom));
  const c = formatContext({ edges: raw.edges }, v, 'edges-cross-encoder', { maxNodes: 12, snapshotAt: b.manifest.snapshotAt }); assert.ok(c.context.includes(raw.edges[0].fact));
  const changed = clone(raw.edges); changed[0].sourceNodeUuid = changed[0].targetNodeUuid; assert.throws(() => formatContext({ edges: changed }, v, 'edges-cross-encoder', { maxNodes: 12, snapshotAt: b.manifest.snapshotAt }));
});
test('explicit profile is independent of model-name heuristics and fails unsupported/legacy data closed', async () => {
  assert.equal(buildAnswerRequest({ ...controls, model: 'explicit-arbitrary-test-model' }, { prompt: 'P', question: 'Q', context: '' }).body.model, 'explicit-arbitrary-test-model');
  for (const mutate of [p => p.schema = 'legacy', p => p.reasoningEffort = 'automatic', p => p.choices = 2,
    p => p.serviceTier = 'auto', p => p.store = true, p => p.maxCompletionTokens = 0, p => p.max_tokens = 20,
    p => p.temperature = 'default']) {
    const c = clone(controls); mutate(c.requestProfile); assert.throws(() => captureAnswerControls(c));
    let launched = 0;
    assert.throws(() => createHttpAnswerPort({ endpointUrl: 'http://127.0.0.1:1/answer', answerControls: c, purpose: 'local-fixture',
      budget: new RunBudget(DEFAULT_LIMITS), current: () => true, fetchImpl: () => { launched++; } })); assert.equal(launched, 0);
  }
});
test('captured immutable controls survive caller mutation; explicit temperature zero is sent once', async () => {
  const h = await harness(); try {
    const mutable = clone(controls); mutable.requestProfile.temperature = 0;
    const p = createHttpAnswerPort({ endpointUrl: h.answerPort.origin + '/answer', answerControls: mutable, purpose: 'local-fixture',
      budget: h.budget, current: () => true });
    mutable.model = 'caller-drift'; mutable.requestProfile.reasoningEffort = 'max'; mutable.requestProfile.temperature = 1;
    assert.ok(Object.isFrozen(p.answerControls) && Object.isFrozen(p.answerControls.requestProfile));
    const r = await p.answer({ prompt: 'P', question: 'Q', context: '', approval: 'approved-job' });
    assert.equal(r.answer.length > 0, true); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.model, 'gpt-5.6-luna');
    assert.equal(h.calls[0].body.reasoning_effort, 'none'); assert.equal(h.calls[0].body.temperature, 0);
  } finally { await h.close(); }
});
test('oversized UTF8 input fails before I/O/attempt consumption', async () => {
  const h = await harness(); try {
    await assert.rejects(h.answerPort.answer({ prompt: 'P', question: 'Q', context: 'я'.repeat(5000), approval: 'approved-job' }), /byte_bound/);
    assert.equal(h.calls.length, 0); assert.equal(h.budget.models, 0); assert.equal(h.budget.attempts.length, 0);
  } finally { await h.close(); }
});
test('JSON escaped request bound is independent of text bound and rejects before I/O', async () => {
  const h = await harness(); try {
    const c = clone(controls); c.requestProfile.maxInputTextUtf8Bytes = 1000; c.requestProfile.maxRequestUtf8Bytes = 1000;
    const p = createHttpAnswerPort({ endpointUrl: h.answerPort.origin + '/answer', answerControls: c, purpose: 'local-fixture', budget: h.budget, current: () => true });
    await assert.rejects(p.answer({ prompt: 'P', question: 'Q', context: '"'.repeat(600), approval: 'approved-job' }), /byte_bound/);
    assert.equal(h.calls.length, 0); assert.equal(h.budget.models, 0);
    const valid = buildAnswerRequest(controls, { prompt: 'P', question: 'Q', context: 'Чай☕' });
    assert.equal(valid.requestUtf8Bytes, Buffer.byteLength(JSON.stringify(valid.body)));
    assert.equal(valid.inputTextUtf8Bytes, valid.body.messages.reduce((n,m) => n + Buffer.byteLength(m.content),0));
  } finally { await h.close(); }
});
test('modern cached/reasoning/cache-write usage is captured without invented zero or invoice', async () => {
  const h = await harness(undefined, { response: (c,v) => c.path === '/answer' ? { ...v, service_tier: 'default',
    usage: { prompt_tokens: 23, completion_tokens: 7, total_tokens: 30,
      prompt_tokens_details: { cached_tokens: 9, cache_write_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 2 } } } : v });
  try { const r = await h.run(); assert.equal(r.status,'captured-unjudged');
    assert.ok(r.records.every(x => x.cachedInputTokens===9 && x.cacheWriteInputTokens===3 && x.reasoningOutputTokens===2 && x.serviceTier==='default' && x.answerCost===null));
    assert.ok(r.attempts.filter(a=>a.kind==='model').every(a=>JSON.parse(a.response).usage.completion_tokens_details.reasoning_tokens===2));
  } finally { await h.close(); }
  const plain = await harness(); try { const r=await plain.run(); assert.ok(r.records.every(x=>x.cachedInputTokens===null && x.cacheWriteInputTokens===null && x.reasoningOutputTokens===null)); } finally { await plain.close(); }
});
test('usage exceeding completion cap or invalid subcounts is an unknown one-attempt stop', async () => {
  for (const usage of [{prompt_tokens:23,completion_tokens:1025,total_tokens:1048},
    {prompt_tokens:23,completion_tokens:7,total_tokens:30,completion_tokens_details:{reasoning_tokens:8}},
    {prompt_tokens:23,completion_tokens:7,total_tokens:30,prompt_tokens_details:{cached_tokens:-1}}]) {
    const h=await harness(undefined,{response:(c,v)=>c.path==='/answer'?{...v,usage}:v});
    try { const r=await h.run(); assert.equal(r.status,'held'); assert.equal(h.calls.filter(c=>c.path==='/answer').length,1); assert.equal(r.summary.modelCalls,1);
      assert.ok(r.attempts.find(a=>a.kind==='model').response); assert.equal(r.summary.invoiceCost,null);
    } finally { await h.close(); }
  }
});
test('whole240/264-job manifests bind one modern profile and aggregate request/completion budgets', () => {
  const a=prepared(full), b=prepared(long);
  assert.equal(a.manifest.answerRequestBudget.aggregateCompletionTokensAtMost,240*1024);
  assert.equal(b.manifest.answerRequestBudget.aggregateCompletionTokensAtMost,264*1024);
  assert.equal(b.manifest.answerRequestBudget.aggregateSerializedRequestUtf8BytesAtMost,264*16384);
  assert.equal(b.manifest.answerRequestBudget.aggregateInputTextUtf8BytesAtMost,264*8192);
  assert.equal(b.manifest.answerRequestBudget.exactVendorInputTokenUpperBound,null);
  assert.equal(b.manifest.answerRequestBudget.invoiceCostUpperBound,null);
  const bad=clone(controls);bad.requestProfile.maxInputTextUtf8Bytes=1000;
  assert.throws(()=>prepareConnected({...full,answerControls:bad,codePins:[{path:'synthetic',sha256:'a'.repeat(64)}]}),/text input bound/);
});

test('exact retained native Graph passthrough survives installed SDK and scoped capture; prior refusal remains recorded',async()=>{
  assert.ok(process.env.D3_GRAPH_ENVELOPE_EVIDENCE);
  const prior=JSON.parse(await readFile(process.env.D3_GRAPH_ENVELOPE_EVIDENCE,'utf8')),calls=[];
  assert.equal(prior.outcome,'FAIL_COMPATIBILITY');const graphId=prior.wire.graph_id;
  const server=createServer((req,res)=>{calls.push({method:req.method,path:req.url});res.setHeader('content-type','application/json');
    res.end(JSON.stringify(req.url==='/graph/'+encodeURIComponent(graphId)?prior.wire:[]));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,budget=new RunBudget(DEFAULT_LIMITS);
  try{
    const parsed=await new ZepClient({baseUrl:origin,apiKey:'synthetic-only'}).graph.get(graphId,{maxRetries:0});
    const port=createSdkReadPort({ZepClient,baseUrl:origin,apiKey:'synthetic-only',purpose:'local-fixture',budget,current:()=>true});
    const captured=await port.observe(graphId);
    assert.equal(captured.graph.canonical_graph_uuid,prior.wire.canonical_graph_uuid);
    assert.notEqual(captured.graph.canonical_graph_uuid,graphId);assert.notEqual(captured.graph.uuid,graphId);
    assert.deepEqual(captured.sdkGraphLayout.passthroughFields,['canonical_graph_uuid']);
    assert.doesNotThrow(()=>verifyGraphLayout(captured.graph,graphId,captured.sdkGraphLayout));
    const previous=await import(pathToFileURL(join(process.env.D3_PRIOR_ENVELOPE_DIR,'envelope-projection.mjs')));
    assert.throws(()=>previous.captureSdkGraph(parsed,graphId),/Unknown native field/);
    assert.deepEqual(JSON.parse(budget.attempts[0].response),prior.wire);assert.equal(budget.models,0);assert.equal(calls.length,5);
    if(d3Evidence)await writeFile(join(d3Evidence,'retained-graph-passthrough-after.json'),encode({
      nativeRetainedWire:prior.wire,source:prior.source,captured,calls,attempts:budget.attempts,oldOutcome:prior.outcome,
      qualification:'Exact retained Graph replay; synthetic empty inventories are not current authority, absence or schema4 proof'}),{flag:'wx'});
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('actualSDK outer JSON passthrough remains exact evidence and never model context or authority',async()=>{
  const extra={null:null,flag:true,values:[1,'Ω',{nested:false}]};
  const h=await harness(undefined,{response:(c,v)=>c.path==='/graph/search'?{...v,opaque_evidence:extra,
    response:{serverLatencyMs:1,opaque_billing:{invoice:'OPAQUE_NOT_MODEL_OR_COST'}}}:/^\/graph\/[^/]+$/.test(c.path)?{...v,canonical_graph_uuid:'OPAQUE_GRAPH_UUID',opaque_graph:extra}:v});
  try{const r=await h.run();assert.equal(r.status,'captured-unjudged');assert.equal(r.summary.modelCalls,6);
    assert.ok(r.observations.every(o=>canonical(o.raw.graph.opaque_graph)===canonical(extra)&&o.raw.sdkGraphLayout.passthroughFields.includes('opaque_graph')));
    const retrievals=h.events.filter(e=>e.kind==='retrieval');assert.ok(retrievals.every(e=>canonical(e.value.raw.opaque_evidence)===canonical(extra)));
    assert.ok(retrievals.every(e=>e.value.raw.sdkEnvelopeLayout.responseLayout.passthroughFields.includes('opaque_billing')));
    assert.ok(r.records.every(row=>!row.context.includes('OPAQUE')&&!row.context.includes('opaque_evidence')));
    assert.equal(r.summary.invoiceCost,null);
  }finally{await h.close();}
});
test('passthrough descriptor/layout guard preserves JSON extras but rejects unknown undefined/accessors/reserved data and tampering',()=>{
  const graph={graphId:'g',projectUuid:'p',extra:{a:null,b:[1,false]}};
  const g=captureSdkGraph(graph,'g');assert.deepEqual(g.row.extra,graph.extra);assert.doesNotThrow(()=>verifyGraphLayout(g.row,'g',g.layout));
  for(const bad of [{extra:undefined},{extra:Infinity},{sdkGraphLayout:null},{sdkEntityLayouts:{}},{sdkEnvelopeLayout:null}]){
    assert.throws(()=>captureSdkGraph({...graph,...bad},'g'));assert.throws(()=>captureSdkSearch(bad,'g'));
  }
  let calls=0;const getter={...graph};Object.defineProperty(getter,'extra',{enumerable:true,get(){calls++;return 1;}});
  assert.throws(()=>captureSdkGraph(getter,'g'));assert.equal(calls,0);
  assert.throws(()=>captureSdkSearch({extra:new Proxy({}, {})},'g'));
  const metadataGetter={};Object.defineProperty(metadataGetter,'opaque',{enumerable:true,get(){calls++;return null;}});
  assert.throws(()=>captureSdkSearch({response:metadataGetter},'g'));assert.equal(calls,0);
  const s=captureSdkSearch({edges:[],opaque:{value:'saved'},response:{opaque:null}},'g');assert.doesNotThrow(()=>verifySearchEnvelope(s,'g'));
  for(const bad of [{created_at:'2026-10-03T00:00:00Z'},{graph_id:'g'},{project_uuid:'p'},{time_zone:'UTC'},{updated_at:'2026-10-03T00:00:00Z'}])assert.throws(()=>captureSdkGraph({...graph,...bad},'g'));
  assert.throws(()=>captureSdkSearch({thread_summaries:[]},'g'));
  assert.throws(()=>captureSdkSearch({response:{serverLatencyMs:1,server_latency_ms:1}},'g'));
  for(const mutate of [v=>v.opaque.value='changed',v=>v.sdkEnvelopeLayout.passthroughFields=[],v=>v.response.opaque=true,
    v=>v.sdkEnvelopeLayout.responseLayout.passthroughFields=['serverLatencyMs']]){const changed=clone(s);mutate(changed);assert.throws(()=>verifySearchEnvelope(changed,'g'));}
  const changed=clone(g);changed.row.extra.b[0]=2;assert.throws(()=>verifyGraphLayout(changed.row,'g',changed.layout));
  assert.throws(()=>verifyGraphLayout(g.row,'foreign',g.layout));
  assert.deepEqual(captureSdkEpisode({uuid:'e',content:'x',createdAt:'2026-10-03T00:00:00Z',metadata:{},processed:true,outerExtra:null}).unknownNativeFields,{outerExtra:null});
  assert.deepEqual(captureSdkEntity({uuid:'n',name:'n',summary:'s',createdAt:'2026-10-03T00:00:00Z',outerExtra:null},'node',{graphId:'g',endpoint:'list'}).layout.unknownNativeFields,{outerExtra:null});
});
test('primary-derived nested nullable DTOs normalize only declared optionals through actualSDK with exact row layouts',async()=>{
  const prior=JSON.parse(await readFile(process.env.D3_NESTED_DTO_EVIDENCE,'utf8'));assert.equal(prior.strictParserAccepted,true);assert.ok(prior.oldCaptureError);
  const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(prior.wire));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const budget=new RunBudget(DEFAULT_LIMITS);
  try{const port=createSdkReadPort({ZepClient,baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic-only',purpose:'local-fixture',budget,current:()=>true});
    const row=await port.search('g','synthetic','auto-raw');assert.doesNotThrow(()=>verifySearchEnvelope(row,'g'));
    for(const kind of ['episodes','observations','threadSummaries']){
      const l=row.sdkEnvelopeLayout.collectionLayouts[kind][0];assert.equal(l.endpoint,'search');assert.equal(l.kind,kind);assert.equal(l.uuid,row[kind][0].uuid);
      assert.deepEqual(l.undefinedOptionalFields,prior.layout[kind][0].filter(f=>f.type==='undefined').map(f=>f.key).sort());
    }
    assert.equal(budget.models,0);assert.deepEqual(JSON.parse(budget.attempts[0].response),prior.wire);
    for(const kind of ['observations','threadSummaries']){const s=captureSdkSearch({[kind]:[{...row[kind][0],unknown:null}]},'g');
      assert.deepEqual(s.sdkEnvelopeLayout.collectionLayouts[kind][0].unknownNativeFields,{unknown:null});assert.ok(!Object.hasOwn(s[kind][0],'unknown'));verifySearchEnvelope(s,'g');}
    assert.throws(()=>captureSdkSearch({observations:[{...row.observations[0],name:undefined}]},'g'));
    if(d3Evidence)await writeFile(join(d3Evidence,'nested-sdk-nullable-after.json'),encode({
      syntheticPrimarySDKDerived:true,wire:prior.wire,captured:row,attempts:budget.attempts,models:0,noNativeSearchClaim:true}),{flag:'wx'});
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('actualSDK nullable auto Episode rank/role capture preserves exact source body/time/provenance authority',async()=>{
  const make=changed=>harness(undefined,{response:(c,v,obs)=>c.path==='/graph/search'&&c.body.scope==='auto'?{...v,episodes:[{
    ...obs.snapshots.get(c.body.graph_id).originals[0],score:null,role:null,...changed}]}:v});
  const h=await make({});try{const r=await h.run();assert.equal(r.status,'captured-unjudged');assert.equal(r.summary.modelCalls,6);
    const auto=h.events.filter(e=>e.kind==='retrieval'&&e.value.raw.episodes?.length);assert.equal(auto.length,2);
    assert.ok(auto.every(e=>canonical(e.value.raw.sdkEnvelopeLayout.collectionLayouts.episodes[0].undefinedOptionalFields)===canonical(['role','score'])));
  }finally{await h.close();}
  const extra=await make({unknown:null});try{const r=await extra.run();assert.equal(r.status,'captured-unjudged');assert.equal(r.summary.modelCalls,6);
    const auto=extra.events.filter(e=>e.kind==='retrieval'&&e.value.raw.episodes?.length);assert.equal(auto.length,2);
    assert.ok(auto.every(e=>canonical(e.value.raw.sdkEnvelopeLayout.collectionLayouts.episodes[0].unknownNativeFields)===canonical({unknown:null})));
  }finally{await extra.close();}
  for(const changed of [{createdAt:'2026-09-12T00:00:00Z'},{uuid:'foreign'},{content:'changed native body'},{metadata:{source_at:'2026-09-12T00:00:00Z'}},
    {processed:null}]){
    const bad=await make(changed);try{const r=await bad.run();assert.equal(r.status,'incomplete');assert.equal(r.records.filter(x=>x.mode==='auto-raw'&&x.status==='captured-unjudged').length,0);}
    finally{await bad.close();}
  }
});
test('actualSDK declared optional diagnostic observation/thread capture remains held for identity/lineage rather than model fallback',async()=>{
  for(const kind of ['observations','threadSummaries']){
    const h=await harness(undefined,{response:(c,v)=>c.path==='/graph/search'?{...v,[kind]:[{uuid:'synthetic-'+kind,name:'Synthetic',
      createdAt:'2026-10-03T00:00:00Z',summary:'Unverified diagnostic.',labels:null,score:null,
      ...(kind==='observations'?{episodeIds:null}:{lastSummarizedAt:null})}]}:v});
    try{const r=await h.run();assert.equal(r.status,'incomplete');assert.equal(r.summary.modelCalls,0);
      assert.equal(h.calls.filter(c=>c.path==='/answer').length,0);assert.ok(r.records.every(row=>row.status==='held'));
      const rows=h.events.filter(e=>e.kind==='retrieval');assert.ok(rows.every(e=>e.value.raw.sdkEnvelopeLayout.collectionLayouts[kind][0].undefinedOptionalFields.includes('score')));
    }finally{await h.close();}
  }
});

test('an edge with fields the profile does not know is captured, the unknown fields set aside in its layout', () => {
  const edge = { uuid: 'e-1', graph_id: 'g', sourceNodeUuid: 'n-1', targetNodeUuid: 'n-2', createdAt: '2026-10-08T14:40:00Z', score: 0.9, relevance: 0.8,
    selectionRank: 1, name: 'CHOSE', fact: 'The garden club chose bed North for the basil.', scope: 'edge', episodes: ['ep-1'], validAt: '2026-09-01T09:00:00Z',
    episode_reference_time: '2026-09-01T09:00:00Z', attributes: {}, sourceNodeName: 'Garden club', targetNodeName: 'Bed North' };
  const c = captureSdkEntity({ ...edge, an_unknown_field: { nested: [1] }, left_undefined: undefined }, 'edge', { graphId: 'g', endpoint: 'search' });
  assert.deepEqual(c.layout.unknownNativeFields, { episode_reference_time: '2026-09-01T09:00:00Z', an_unknown_field: { nested: [1] } });
  for (const name of ['episode_reference_time', 'an_unknown_field', 'left_undefined']) assert.ok(!Object.hasOwn(c.row, name));
  const episodes = new Map([['ep-1', {}]]);
  assert.doesNotThrow(() => verifyEntityScope(c.row, 'edge', 'g', episodes, c.layout, 'search'));
  const known = { ...edge }; delete known.episode_reference_time;
  assert.ok(!Object.hasOwn(captureSdkEntity(known, 'edge', { graphId: 'g', endpoint: 'search' }).layout, 'unknownNativeFields'));
  assert.throws(() => captureSdkEntity({ ...edge, score: 'high' }, 'edge', { graphId: 'g', endpoint: 'search' }));
  assert.throws(() => verifyEntityScope(c.row, 'edge', 'g', episodes, { ...c.layout, unknownNativeFields: { fact: 'other' } }, 'search'), /Declared field set aside/);
  assert.throws(() => verifyEntityScope(c.row, 'edge', 'g', episodes, { ...c.layout, unknownNativeFields: {} }, 'search'), /Malformed unknown/);
  assert.throws(() => verifyEntityScope(c.row, 'edge', 'g', episodes,
    { ...c.layout, unknownNativeFields: { ...c.layout.unknownNativeFields, episode_reference_time: '2026-09-02T09:00:00Z' } }, 'search'), /Entity layout hash differs/);
  const { unknownNativeFields: dropped, ...withoutRecord } = c.layout;
  assert.ok(dropped); assert.throws(() => verifyEntityScope(c.row, 'edge', 'g', episodes, withoutRecord, 'search'), /Entity layout hash differs/);
});

test('a selected node without a summary enters the context by name and costs no question', async () => {
  const empty = (c, v) => /^\/graph\/node\/graph\//.test(c.path) ? v.map(n => ({ ...n, summary: '' })) : v;
  const h = await harness(undefined, { response: empty });
  try {
    const r = await h.run();
    const summaryModes = r.records.filter(x => x.job.mode === 'edges-plus-selected-node-summaries');
    assert.ok(summaryModes.length); assert.ok(summaryModes.every(x => x.status === 'captured-unjudged'), 'a node without a summary held a question');
    assert.ok(summaryModes.some(x => x.context.includes('"kind":"node-without-summary"')));
    assert.ok(!summaryModes.some(x => x.context.includes('"kind":"node-summary-derivative-association"')));
    assert.ok(summaryModes.every(x => x.context.includes('"kind":"edge-fact"')), 'the facts must stay in the context');
  } finally { await h.close(); }
});
test('auto-raw: a returned node without a summary enters by name with its labels and attributes, and costs no question', async () => {
  const blank = n => ({ ...n, summary: '', labels: ['Place'], attributes: { region: 'north' } });
  const respond = (c, v, obs) => {
    if (/^\/graph\/node\/graph\//.test(c.path)) return v.map(blank);
    if (c.path === '/graph/search' && c.body.scope === 'auto') return { ...v, nodes: obs.snapshots.get(c.body.graph_id).nodes.map((n, i) => ({ ...blank(n), selectionRank: i })) };
    return v;
  };
  const h = await harness(undefined, { response: respond });
  try {
    const r = await h.run(), auto = r.records.filter(x => x.job.mode === 'auto-raw');
    assert.ok(auto.length); assert.ok(auto.every(x => x.status === 'captured-unjudged'), 'a node without a summary held an auto-raw question');
    const block = auto.map(x => x.context).find(c => c.includes('"kind":"node-without-summary"'));
    assert.ok(block, 'no node came in without its summary');
    assert.ok(block.includes('"labels":["Place"]') && block.includes('"attributes":{"region":"north"}'), 'labels and attributes must come in');
  } finally { await h.close(); }
});
