// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import {createOwnedBridgeFixture} from '../trial-journal/owned-bridge-local-fixture.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZepClient } from '@getzep/zep-cloud';
import { DTrial, prepareWritePermits } from './profile.mjs';
import { fixtureProfile, bindAllEpisodes, modelAttempt } from './fixture.mjs';
import { budgetRecorder } from './budget-recorder.mjs';
import { RunJournal } from '../trial-journal/journal.mjs';
import { prepareConnected } from '../memory-retrieval-comparison-d3/prepare.mjs';
import { createSdkReadPort, createHttpAnswerPort } from '../memory-retrieval-comparison-d3/ports.mjs';
import { RunBudget, encode, sha256, canonical, PROMPT } from '../memory-retrieval-comparison-d3/contracts.mjs';
import { runOwnedComparison } from './comparison-bridge.mjs';
import {dInputFile,evidenceFolder} from './test-folders.mjs';

const clone = structuredClone;
const bridgePreparation = await dInputFile('D_BRIDGE_PREPARATION', 'BOUND-PREPARATION.json');
let evidenceNumber = 0;
const bridgeEvidence=evidenceFolder('D_BRIDGE_EVIDENCE_DIR');
const wire = value => Array.isArray(value) ? value.map(wire) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k === 'metadata' ? k : k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), k === 'metadata' ? v : wire(v)])) : value;

async function world(t, options = {}) {
  const w = { live: true, tick: 0, calls: [], events: [], modelOrders: [], stops: 0, fetches: 0 };
  const resources=createOwnedBridgeFixture(t,{evidenceRoot:bridgeEvidence}),root=resources.ownerRoot;w.root=root;w.resources=resources;
  const server=resources.constructHttpServer();server.on('request',async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString(), body = raw ? JSON.parse(raw) : null;
    const path = new URL(req.url, 'http://127.0.0.1').pathname.replace(/^\/v2/, '');
    const call = { method: req.method, path, body }; w.calls.push(call);
    let value;
    if (path === '/v1/chat/completions') value = { choices: [{ message: { content: 'Synthetic local answer.' } }], usage: { prompt_tokens: 23, completion_tokens: 7, total_tokens: 30 } };
    else if (path === '/graph/search') {
      const s = w.snapshots.get(body.graph_id);
      value = body.scope === 'auto' ? { edges: s.edges, nodes: [], episodes: [] } : { edges: s.edges };
    } else if (/^\/graph\/episodes\/graph\//.test(path)) value = w.snapshots.get(decodeURIComponent(path.split('/').at(-1))).episodes;
    else if (/^\/graph\/edge\/graph\//.test(path)) value = w.snapshots.get(decodeURIComponent(path.split('/').at(-1))).edges;
    else if (/^\/graph\/node\/graph\//.test(path)) value = w.snapshots.get(decodeURIComponent(path.split('/').at(-1))).nodes;
    else if (/^\/graph\/episodes\/[^/]+$/.test(path)) value = [...w.snapshots.values()].flatMap(s => s.originals).find(e => e.uuid === decodeURIComponent(path.split('/').at(-1)));
    else if (/^\/graph\//.test(path)) value = w.snapshots.get(decodeURIComponent(path.split('/').at(-1)))?.graph;
    value = options.response ? options.response(call, clone(value), w) : value;
    res.statusCode = options.httpStatus?.(call) ?? 200;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(wire(value)));
  });
  await resources.startHttpServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const p = fixtureProfile(); p.origins = { readBase: origin + '/v2', answerEndpoint: origin + '/v1/chat/completions' };
  const d2 = JSON.parse(readFileSync(bridgePreparation));
  const prepared = prepareConnected({ questions: p.questions, payloads: p.payloads, preparation: d2,
    answerControls: p.manifest.answerControls, limits: p.manifest.limits, codePins: p.codePins });
  p.manifest = prepared.manifest;
  p.writePermits = prepareWritePermits(p.payloads, p.origins.readBase);
  p.codePins = ['profile.mjs', 'comparison-bridge.mjs', 'budget-recorder.mjs', '../memory-retrieval-comparison-d3/run.mjs', '../memory-retrieval-comparison-d3/contracts.mjs', '../memory-retrieval-comparison-d3/ports.mjs'].map(relative => {
    const path = fileURLToPath(new URL(relative, import.meta.url)); return { path, sha256: sha256(readFileSync(path)) };
  });
  w.profile = p; w.preparation = d2;
  options.profile?.(p, w);
  const card = DTrial.prepare(root, p);
  const approval = { id: 'synthetic-local-bridge-only', cardSha256: card.cardSha256, expiresAt: new Date(Date.now() + 300000).toISOString() };
  w.approval = approval;
  const current = () => w.live && (options.current?.(w) ?? true);
  w.owner = DTrial.claim(root, { approval, verifyApproval: () => true,
    current: () => current() && (options.ownerCurrent?.(w) ?? true), clock: () => w.tick });resources.retainTrialOwner(w.owner);
  const stop = w.owner.stop.bind(w.owner);
  w.owner.stop = reason => { w.stops++; return stop(reason); };
  if (!options.noBinding) w.ack = bindAllEpisodes(w.owner, p);
  w.snapshots = new Map(); w.authorities = [];
  for (const [g, graph] of p.manifest.topology.entries()) {
    const rows = p.payloads.rows.filter(r => r.variant === graph.variant && r.logicalRoom === graph.logicalRoom);
    const originals = rows.flatMap(r => r.members.map(m => {
      const permit = p.writePermits.find(x => x.kind === 'episode' && x.request.body.metadata.op_id === m.opId);
      return { uuid: 'fixture-' + permit.id, content: m.payload.request.data, metadata: clone(m.payload.request.metadata),
        createdAt: m.payload.request.createdAt, processed: true, source: 'message' };
    }));
    const nodes = [{ uuid: `node-${g}-a`, name: 'Synthetic subject', summary: 'Synthetic first summary.', createdAt: '2026-10-03T00:00:00Z' },
      { uuid: `node-${g}-b`, name: 'Synthetic object', summary: 'Synthetic second summary.', createdAt: '2026-10-03T00:00:00Z' }];
    const edges = [{ uuid: `edge-${g}`, fact: 'Synthetic subject uses synthetic object.', name: 'USES', createdAt: '2026-10-03T00:00:00Z',
      validAt: '2026-09-01T00:00:00Z', sourceNodeUuid: nodes[0].uuid, targetNodeUuid: nodes[1].uuid, episodes: originals.map(e => e.uuid) }];
    w.snapshots.set(graph.graphId, { graph: { graphId: graph.graphId, projectUuid: 'synthetic-project' }, originals,
      episodes: originals.map(e => ({ ...clone(e), createdAt: '2026-10-02T23:21:06.535692Z', session_id: null })), edges, nodes });
    w.authorities.push({ accountId: 'synthetic-account', projectId: 'synthetic-project', graphId: graph.graphId,
      room: graph.logicalRoom, roomUuid: graph.roomUuid, copyId: rows[0].members[0].identity.copyId,
      generationId: 'synthetic-generation', routeRevision: '1', scopeRevision: '1', verificationId: 'synthetic-only', sourceState: 'verified-current-authorized',
      members: rows.flatMap(r => r.members.map(m => ({ episodeId: originals.find(e => e.metadata.op_id === m.opId).uuid,
        opId: m.opId, sourceId: r.sourceId, version: r.sourceVersion, part: m.identity.part }))) });
  }
  const claim = w.owner.summary().state.run.claim;
  const permit = { schema: 'viberoom-retrieval-external-job-permit-v1', purpose: 'local-fixture', manifestSha256: sha256(encode(p.manifest)),
    runId: p.manifest.runId, ownerClaimId: claim, approved: true, expiresAt: approval.expiresAt,
    currentAuthoritySha256: sha256(encode(w.authorities)), serviceEmissionBinding: null, wholeTrialBudgetApproved: false, readOrigin: origin, answerOrigin: origin };
  w.permit = permit;
  const fetchImpl = async (...args) => {
    w.fetches++;
    const state = w.owner.summary().state;
    assert.equal(state.attempts.filter(a => a.outcome === 'dispatch_uncertain').length, 1, 'exact current admission before actual I/O');
    const pending = state.attempts.at(-1);
    if (pending.permit.startsWith('model:')) w.modelOrders.push(Number(pending.permit.slice(6)));
    if (options.beforeFetch) await options.beforeFetch(args, w);
    const response = await fetch(...args);
    if (options.afterFetch) await options.afterFetch(args, w);
    return response;
  };
  w.run = async (overrides = {}) => {
    let result, error;
    try {
      result = await runOwnedComparison({ owner: w.owner, manifest: p.manifest, questions: p.questions, payloads: p.payloads,
        preparation: d2, permit, authorities: w.authorities, current, clock: () => w.tick,
        ports: ({ budget }) => { w.budget = budget; return {
          readPort: createSdkReadPort({ ZepClient, baseUrl: p.origins.readBase, apiKey: 'synthetic-loopback-key', purpose: 'local-fixture', budget, current, fetchImpl }),
          answerPort: createHttpAnswerPort({ endpointUrl: p.origins.answerEndpoint, answerControls: p.manifest.answerControls, purpose: 'local-fixture', budget, current, fetchImpl }),
        }; },
        record: (kind, value) => {
          if (kind === 'finish') assert.ok(w.owner.summary().state.run.stopped, 'durable stop before final publication');
          w.events.push({ kind, value }); options.record?.(kind, value, w);
        }, ...overrides });
      return result;
    } catch (e) { error = { name: e.name, message: e.message }; throw e; }
    finally {
      if (bridgeEvidence) writeFileSync(join(bridgeEvidence, `case-${++evidenceNumber}.json`), encode({
        localFixtureOnly: true, calls: w.calls, modelOrders: w.modelOrders, events: w.events, result: result ?? null, error: error ?? null,
        durable: w.owner.summary(), attempts: w.budget?.attempts ?? [], stops: w.stops,
      }), { flag: 'wx' });
    }
  };
  w.reopen = () => { w.owner.close(); w.closed = true; const stored = RunJournal.inspect(root); assert.equal(stored.resumable, false);
    assert.throws(() => DTrial.claim(root, { approval, verifyApproval: () => true, current: () => true }), /trial_already_claimed/); return stored; };
  return w;
}

test('real SQLite + installed SDK loopback: full LONG jobs, flush before every I/O, finish before publish', async t => {
  const w = await world(t), result = await w.run();
  assert.equal(result.status, 'captured-unjudged'); assert.equal(result.records.length, 264);
  assert.deepEqual(w.modelOrders, w.profile.manifest.jobs.map(j => j.order));
  assert.equal(result.actualD, 'LOCAL_FIXTURE_ONLY'); assert.equal(result.semanticQuality, 'NOT_ADJUDICATED');
  assert.equal(w.stops, 1); assert.equal(w.events.filter(e => e.kind === 'finish').length, 1);
  assert.ok(result.durableTrial.state.attempts.every(a => a.outcome === 'received'));
  assert.ok(w.reopen().state.run.stopped);
});

test('held early jobs skip models; later actual manifest order survives search reuse and request counters', async t => {
  const w = await world(t, { response(call, value, w) {
    if (call.path === '/graph/search' && call.body.query === w.profile.manifest.jobs[0].query && call.body.scope === 'edges')
      return { edges: value.edges.map(e => ({ ...e, fact: e.fact + ' changed' })) };
    return value;
  }, record(kind, value, w) { if (kind === 'answer' && value.job.order === 6) w.live = false; } });
  const result = await w.run();
  assert.equal(result.status, 'held'); assert.deepEqual(w.modelOrders, [3, 6]);
  assert.equal(result.records[0].attempts.model, 0); assert.equal(result.records[1].attempts.model, 0);
  assert.equal(result.records[1].retrievalSharing.reused, true);
  assert.equal(w.stops, 1); assert.ok(w.reopen().state.permits.filter(p => p.kind === 'model').every(p => [3, 6].includes(Number(p.id.slice(6)))));
});

for (const [label, overrides] of [
  ['wrong manifest job', w => ({ manifest: { ...clone(w.profile.manifest), jobs: w.profile.manifest.jobs.map((j, i) => i ? j : { ...j, query: 'other' }) } })],
  ['wrong source bytes', w => { const payloads = clone(w.profile.payloads); payloads.rows[0].members[0].payload.request.data += ' changed'; return { payloads }; }],
  ['wrong owner claim', w => ({ permit: { ...w.permit, ownerClaimId: 'foreign' } })],
  ['ports construction throws', () => ({ ports: () => { throw new Error('synthetic-port-construction'); } })],
]) test(`${label}: no I/O; existing claim finishes once and cannot restart`, async t => {
  const w = await world(t);
  const change = overrides(w);
  await assert.rejects(w.run(change)); assert.equal(w.fetches, 0); assert.equal(w.stops, 1);
  assert.equal(w.events.filter(e => e.kind === 'finish').length, 0); assert.ok(w.reopen().state.run.stopped);
});

test('no bound ingestion cannot obtain read admission or reach HTTP', async t => {
  const w = await world(t, { noBinding: true }), result = await w.run();
  assert.equal(result.status, 'held'); assert.equal(w.fetches, 0); assert.equal(w.owner.summary().state.attempts.length, 0); assert.equal(w.stops, 1);
});

for (const [label, beforeFetch, afterFetch] of [
  ['transport throw', async () => { throw new Error('synthetic network failure'); }, null],
  ['current revoked after receive', null, async (_args, w) => { w.live = false; }],
  ['late received response', null, async (_args, w) => { w.tick = w.profile.manifest.limits.runMs + 1; }],
]) test(`${label}: consumed attempt remains unknown after reopen; no next I/O`, async t => {
  const w = await world(t, { beforeFetch, afterFetch }), result = await w.run();
  assert.equal(result.status, 'held'); assert.equal(w.fetches, 1); assert.equal(w.stops, 1);
  const stored = w.reopen(), last = stored.state.attempts.at(-1);
  assert.equal(last.outcome, 'unknown'); assert.equal(stored.state.permits.find(p => p.id === last.permit).consumed, 1);
});

test('record callback throws; final owner stop precedes rejection and no later I/O', async t => {
  const w = await world(t, { record(kind) { if (kind === 'observation') throw new Error('synthetic-capture-failure'); } });
  const result = await w.run(); assert.equal(result.status, 'held'); assert.equal(w.stops, 1);
  assert.equal(w.events.filter(e => e.kind === 'finish').length, 1); assert.ok(w.reopen().state.run.stopped);
});

test('final publication throws after one durable finish; no finish retry', async t => {
  const w = await world(t);
  await assert.rejects(w.run({ current: () => false, record: kind => { if (kind === 'finish') throw new Error('final-publication-refused'); } }), /final-publication-refused/);
  assert.equal(w.fetches, 0); assert.equal(w.stops, 1); assert.ok(w.reopen().state.run.stopped);
});

test('SQL outcome side effect rolls back capture; unknown admission remains; finish failure forbids final publication', async t => {
  const w = await world(t, { beforeFetch(_args, w) {
    const db = w.resources.constructJournalDatabase();
    db.exec("create trigger collateral before update on attempts begin update permits set consumed=0 where id='episode:1'; end;"); w.resources.closeJournalDatabase(db);
  } });
  await assert.rejects(w.run(), /comparison_finish_failed/);
  assert.equal(w.fetches, 1); assert.equal(w.stops, 1); assert.equal(w.events.filter(e => e.kind === 'finish').length, 0);
  const stored = w.reopen(); assert.equal(stored.state.attempts.at(-1).outcome, 'dispatch_uncertain');
  assert.equal(stored.state.permits.find(p => p.id === 'episode:1').consumed, 1);
});

test('copied prepared/claimed physical root is not resumable or a new claim', async t => {
  const w = await world(t), copy = w.resources.copyJournalRoot();
  assert.throws(() => RunJournal.inspect(copy));
  const result = await w.run({ current: () => false }); assert.equal(result.status, 'held'); assert.equal(w.stops, 1);
});

test('deadline crossed in owner current callback refuses admission before HTTP and remains refused after reopen', async t => {
  const w = await world(t, { ownerCurrent(w) { if (w.budget) w.tick = w.profile.manifest.limits.runMs + 1; return true; } });
  const result = await w.run(); assert.equal(result.status, 'held'); assert.equal(w.fetches, 0); assert.equal(w.stops, 1);
  const stored = w.reopen(); assert.equal(stored.state.attempts.length, 34);
  assert.ok(stored.state.permits.filter(p => p.kind === 'read').every(p => p.consumed === 0));
});

test('finish SQL side effect rolls back terminal write and refuses final publication without a second finish', async t => {
  const w = await world(t), db = w.resources.constructJournalDatabase();
  db.exec("create trigger stop_collateral before update of stopped on run when new.stopped='comparison_finished_no_resume' begin update permits set consumed=0 where id='episode:1'; end;"); w.resources.closeJournalDatabase(db);
  await assert.rejects(w.run({ current: () => false }), /comparison_finish_failed/);
  assert.equal(w.fetches, 0); assert.equal(w.stops, 1); assert.equal(w.events.filter(e => e.kind === 'finish').length, 0);
  const stored = w.reopen(); assert.equal(stored.state.run.stopped, null);
  assert.equal(stored.state.permits.find(p => p.id === 'episode:1').consumed, 1);
});

test('unresolved admitted attempt is burnt once; late completion cannot rewrite terminal journal or saved result', async t => {
  const w = await world(t); let resolveFetch;
  const fetchPending = new Promise(resolve => { resolveFetch = resolve; });
  const result = await w.run({ ports: ({ budget }) => {
    w.budget = budget;
    const actual = createSdkReadPort({ ZepClient, baseUrl: w.profile.origins.readBase, apiKey: 'synthetic-only', purpose: 'local-fixture', budget,
      current: () => true, fetchImpl: () => fetchPending });
    const observe = async graph => {
      w.pending = actual.observe(graph);
      while (budget.attempts.length === 0) await new Promise(resolve => setImmediate(resolve));
      throw new Error('synthetic-terminal-before-late-response');
    };
    return { readPort: { ...actual, observe }, answerPort: createHttpAnswerPort({ endpointUrl: w.profile.origins.answerEndpoint,
      answerControls: w.profile.manifest.answerControls, purpose: 'local-fixture', budget, current: () => true, fetchImpl: () => { throw new Error('no model'); } }) };
  } });
  assert.equal(result.status, 'held'); assert.equal(w.stops, 1);
  assert.equal(result.attempts.at(-1).status, 'unknown');
  const before = canonical(w.owner.summary()), published = canonical(result);
  resolveFetch(new Response(JSON.stringify({ graph_id: w.profile.manifest.topology[0].graphId }), { status: 200 }));
  await assert.rejects(w.pending);
  assert.equal(canonical(w.owner.summary()), before); assert.equal(canonical(result), published);
  assert.equal(w.reopen().state.attempts.at(-1).outcome, 'unknown');
});

test('recorder wrong logical job and unknown unfinished attempt use actual D5 rollback/finish', async t => {
  const w = await world(t), budget = { attempts: [] }, a = modelAttempt(w.profile, 7, 1);
  const bad = budgetRecorder(w.owner, { getBudget: () => budget, getLogicalJobId: () => 1 });
  budget.attempts.push(a); assert.throws(() => bad.recordAttempt(a)); assert.equal(w.owner.summary().state.attempts.length, 34);
  budget.attempts.length = 0;
  const recorder = budgetRecorder(w.owner, { getBudget: () => budget, getLogicalJobId: () => 7 });
  budget.attempts.push(a); assert.equal(recorder.recordAttempt(a), true);
  assert.throws(() => recorder.flush(), /unfinished/);
  const first = recorder.finish(), second = recorder.finish(); assert.equal(first, second); assert.equal(w.stops, 1);
  assert.throws(() => recorder.recordAttempt(a), /already_finished/);
  assert.equal(w.reopen().state.attempts.at(-1).outcome, 'unknown');
});

test('exact retained failed-stop counterexample: same owner/card/claim/approval cannot run a second wrapper or direct admission', async t => {
  const w=await world(t),db=w.resources.constructJournalDatabase();
  const trigger="create trigger stop_collateral before update of stopped on run when new.stopped='comparison_finished_no_resume' begin update permits set consumed=0 where id='episode:1'; end;";
  db.exec(trigger);w.resources.closeJournalDatabase(db);
  const before=w.owner.summary();await assert.rejects(w.run({current:()=>false}),/comparison_finish_failed/);
  const afterFirst=w.owner.summary();assert.equal(afterFirst.state.run.stopped,null);assert.equal(w.fetches,0);assert.equal(w.stops,1);
  await assert.rejects(w.run(),/comparison_already_started/);
  const read={number:1,kind:'read',status:'attempted',response:null,request:{method:'GET',url:w.profile.origins.readBase+'/graph/'+w.profile.manifest.topology[0].graphId,body:null,maxRetries:0}};
  assert.throws(()=>w.owner.recordAttempt(read),/trial_stopped/);
  const write=w.profile.writePermits.find(p=>p.kind==='graph');assert.throws(()=>w.owner.admitWrite(write.id,write.request),/trial_stopped/);
  const afterSecond=w.owner.summary();assert.equal(canonical(afterSecond.state),canonical(afterFirst.state));
  assert.equal(afterSecond.cardSha256,before.cardSha256);assert.equal(afterSecond.state.run.claim,before.state.run.claim);assert.equal(afterSecond.state.run.approval,before.state.run.approval);
  assert.equal(w.fetches,0);assert.equal(w.calls.length,0);assert.equal(w.modelOrders.length,0);assert.equal(w.stops,1);assert.equal(afterSecond.state.attempts.length,34);
  const inspect=w.resources.constructJournalDatabase(true);assert.ok(inspect.prepare("select sql from sqlite_master where name='stop_collateral'").get().sql.includes('comparison_finished_no_resume'));w.resources.closeJournalDatabase(inspect);
  assert.equal(w.reopen().state.attempts.length,34);
});

test('parallel wrappers share one owner lifetime: rejected follower cannot finish or dispatch through leader', async t => {
  let release,enteredResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
  const w=await world(t,{beforeFetch:async(_args,w)=>{enteredResolve();await blocked;w.live=false;}});
  const leader=w.run();await entered;
  const before=canonical(w.owner.summary().state);await assert.rejects(w.run(),/comparison_already_started/);
  assert.equal(w.fetches,1);assert.equal(w.stops,0);assert.equal(canonical(w.owner.summary().state),before);
  release();const result=await leader;assert.equal(result.status,'held');assert.equal(w.stops,1);assert.equal(w.fetches,1);assert.equal(w.modelOrders.length,0);
  assert.equal(w.reopen().state.attempts.at(-1).outcome,'unknown');
});

test('successful comparison lifetime cannot be entered twice even with no initial HTTP', async t => {
  const w=await world(t),result=await w.run({current:()=>false});assert.equal(result.status,'held');assert.equal(w.stops,1);
  await assert.rejects(w.run(),/comparison_already_started/);assert.equal(w.stops,1);assert.equal(w.fetches,0);
  assert.ok(w.reopen().state.run.stopped);
});
test('generic owner wrapper acquires lifetime before its first manifest getter',async t=>{
 const w=await world(t);await assert.rejects(runOwnedComparison({owner:w.owner,get manifest(){throw Error('first generic input failure')}}),/first generic input failure/);
 assert.equal(w.stops,1);assert.equal(w.fetches,0);assert.equal(w.events.length,0);assert.notEqual(w.owner.summary().state.run.stopped,null);
 assert.throws(()=>w.owner.admitWrite(w.profile.writePermits[0].id,w.profile.writePermits[0].request));assert.ok(w.reopen().state.run.stopped);
});
test('generic lazy input loader failure uses its existing finish duty',async t=>{
 const w=await world(t);await assert.rejects(runOwnedComparison({owner:w.owner,loadInputs:()=>null}),TypeError);
 assert.equal(w.stops,1);assert.equal(w.fetches,0);await assert.rejects(w.run(),/comparison_already_started/);assert.equal(w.stops,1);
});
