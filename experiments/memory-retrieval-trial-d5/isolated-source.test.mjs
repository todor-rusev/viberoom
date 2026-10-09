// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {configuredHubWorld,assertNoFixtureSecrets} from './configured-hub-fixture.mjs';
import {createConfiguredNativeCaller} from './configured-native-caller.mjs';
import {createIsolatedSource} from './isolated-source.mjs';import {createProductStep} from './product-step.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';import {canonical} from '../memory-retrieval-comparison-d3/contracts.mjs';

const world=(t,options={})=>configuredHubWorld(t,{nativeProject:true,isolated:true,...options,callerFactory:async w=>{
  w.caller=createConfiguredNativeCaller({hub:w.hub,selection:w.selection,source:w.source});w.prepared=w.caller.prepare(w.prepared);
}});
const rows=w=>w.source.rows();const state=w=>RunJournal.inspect(w.ownerRoot);
const beforeClaim=w=>{assert.equal(state(w).state.run.claim,null);assert.equal(state(w).state.attempts.length,0);assert.equal(w.answerCopies.length,0);assert.equal(w.HTTP.length,0);};
const barrier=()=>new Promise(resolve=>setImmediate(resolve));

test('actual Hub account + SAME HistoryStore cached C preparation owns 20 fresh private UUIDs/34 rows without key copy/room registration',async t=>{
  const w=await world(t,{ordinaryModel:''});beforeClaim(w);assert.equal(w.source.history,w.hub.history);assert.equal(rows(w).length,34);
  assert.equal(new Set(w.rooms.map(r=>r.uuid)).size,20);assert.equal(new Set(rows(w).map(r=>r.identity.sourceId)).size,17);assert.equal(w.profile.questions.queries.length,44);
  const ordinary=/^[a-z0-9][a-z0-9-]{0,39}$/;
  for(const room of w.rooms){assert.equal(ordinary.test(room.id),false);assert.equal(w.hub.rooms.has(room.id),false);assert.ok(w.profile.manifest.topology.some(g=>g.roomUuid===room.uuid&&g.graphId==='viberoom-'+room.uuid));}
  assert.ok(rows(w).every(r=>r.attempts===0&&r.state==='prepared'&&r.externalIds.length===0));
  const stored=JSON.parse(fs.readFileSync(path.join(w.hub.dataDir,'rooms.json'),'utf8'));
  assert.equal(JSON.stringify(stored).includes(w.source.namespaceId),false);
  assert.equal(w.hub.privateTrialNamespaceUnregistered(w.rooms.map(r=>r.id),w.rooms.map(r=>r.uuid)),true);
  assertNoFixtureSecrets(w,{profile:w.profile,binding:w.binding,rows:rows(w)});
});

test('freshness rejects existing source/copy/route/ops namespace, never adopts its saved private rows',async t=>{
  const w=await world(t),before=canonical(rows(w)),context=w.hub.memoryTrialAccountContext(w.selection);
  assert.throws(()=>createIsolatedSource({hub:w.hub,accountContext:context,payloads:w.profile.payloads,
    namespaceId:w.source.namespaceId,roomUuids:w.rooms.map(r=>r.uuid)}),/namespace_occupied/);
  assert.equal(canonical(rows(w)),before);beforeClaim(w);
});

test('normal registered UUID collision or unresolved import refuses a new private namespace',async t=>{
  const w=await world(t),context=w.hub.memoryTrialAccountContext(w.selection),uuids=w.rooms.map(()=>randomUUID()),normal=[...w.hub.rooms.values()][0];uuids[0]=normal.uuid;
  assert.throws(()=>createIsolatedSource({hub:w.hub,accountContext:context,payloads:w.profile.payloads,roomUuids:uuids}),/namespace_registered_or_arriving/);
  w.hub.arriving.add('ordinary-import');try{assert.throws(()=>createIsolatedSource({hub:w.hub,accountContext:context,payloads:w.profile.payloads}),/namespace_registered_or_arriving/);}finally{w.hub.arriving.delete('ordinary-import');}
  beforeClaim(w);
});

test('ordinary startup/wake/config retry/search/registry do not send or retire private prepared rows',async t=>{
  const w=await world(t),before=canonical(rows(w));w.hub.memory.start();for(const room of w.rooms)w.hub.memory.wake(room.id);
  await barrier();for(const room of w.rooms)assert.equal(await w.hub.memory.searchFacts(room.id,'synthetic private search',{limit:1,across:false,waitMs:2000}),null);
  const registry=w.hub.memory.deliveryRegistry('zep').entries.filter(e=>w.rooms.some(r=>r.id===e.roomId));assert.equal(registry.length,34);assert.ok(registry.every(e=>e.roomLoaded===false&&e.attempts===0));
  w.hub.memory.configChanged();for(const room of w.rooms)w.hub.memory.wake(room.id);await barrier();
  assert.equal(canonical(rows(w)),before);assert.equal(w.source.current(),false,'old loaded-provider lifetime cannot resume after retry/config change');
  const targets=new Set(w.profile.manifest.topology.map(g=>g.graphId));assert.equal(w.server.requests.some(r=>targets.has(r.body?.graph_id)||[...targets].some(g=>r.path.endsWith('/'+g))),false);beforeClaim(w);
});

test('actual registered-room SDK search succeeds with private prepared rows present and leaves every private target and attempt unchanged',async t=>{
  const w=await world(t),privateRoomIds=new Set(w.rooms.map(r=>r.id)),targets=new Set(w.profile.manifest.topology.map(g=>g.graphId));
  const normal=[...w.hub.rooms.values()].find(r=>r.settings.remembers===true&&!privateRoomIds.has(r.id));assert.ok(normal,'actual registered remembering room required');
  assert.equal(w.source.history,w.hub.history);assert.equal(rows(w).length,34);assert.ok(rows(w).every(r=>r.state==='prepared'&&r.attempts===0));beforeClaim(w);
  const graphId='viberoom-'+normal.uuid,query='normal registered search beside private prepared rows',fact='Normal room search remains available while private trial rows wait.';
  w.server.graphs.set(graphId,{graph_id:graphId,id:1});
  w.server.edgesByGraph[graphId]=[{...w.server.edges[0],uuid:randomUUID(),fact,episodes:[]}];
  const privateRequests=()=>w.server.requests.filter(request=>[...targets].some(target=>canonical(request).includes(target)));
  const registry=()=>w.hub.memory.deliveryRegistry('zep').entries.filter(e=>privateRoomIds.has(e.roomId));
  const before={rows:canonical(rows(w)),trial:canonical(state(w).state),requests:canonical(privateRequests()),registry:canonical(registry())},firstRequest=w.server.requests.length;
  const found=await w.hub.memory.searchFacts(normal.id,query,{limit:1,across:false,waitMs:2000});assert.ok(found);assert.deepEqual(found.facts.map(f=>f.fact),[fact]);assert.equal(found.pending,0);
  const requests=w.server.requests.slice(firstRequest),searches=requests.filter(r=>r.method==='POST'&&r.path==='/graph/search');
  assert.equal(searches.length,1,'real normal SDK search must reach the loopback HTTP server');assert.equal(searches[0].body.graph_id,graphId);assert.equal(searches[0].body.query,query);
  assert.equal(searches[0].body.scope,'auto');assert.equal(searches[0].body.return_raw_results,true);assert.ok(Number.isInteger(searches[0].body.max_characters)&&searches[0].body.max_characters>0);
  assert.equal(canonical(privateRequests()),before.requests);assert.equal(canonical(rows(w)),before.rows);assert.equal(canonical(state(w).state),before.trial);assert.equal(canonical(registry()),before.registry);
  assert.equal(registry().length,34);assert.ok(registry().every(e=>e.roomLoaded===false&&e.state==='prepared'&&e.attempts===0));assert.equal(w.source.current(),true);beforeClaim(w);
  w.lastOutcome={ordinarySearchControl:{ordinaryRoomId:normal.id,graphId,query,requests,found,privateRowCount:rows(w).length,privateTargetRequests:privateRequests(),trial:state(w).state,privateRegistry:registry(),privateRowsUnchanged:true,privateTrialUnchanged:true}};
});

test('existing ordinary reservation AND same-DB legacy usage reject the trial C monthly claim without I/O',async t=>{
  const w=await world(t,{monthlyCap:7}),context=w.hub.memoryTrialAccountContext(w.selection),normal=[...w.hub.rooms.values()][0],history=w.hub.history,outbox=history.memoryOutbox;
  const view={id:normal.id,uuid:normal.uuid,name:normal.name,remembers:true,input:'excerpts',originalInput:false};
  const ordinary=createProductStep({history,preparationProvider:context.preparation(),rooms:[view],current:()=>true,cap:()=>7,sieve:{verdicts:[{sourceId:'ordinary-reservation',keep:true,excerpts:null}]}});
  history.upsert(normal.id,{id:'ordinary-reservation',seq:history.maxSeq(normal.id)+1,room:'ordinary',from:'human',fromName:'Synthetic human',ts:Date.now(),kind:'chat',text:'Ordinary reserved source.'});
  const [reserved]=ordinary.prepare({source:history.getById(normal.id,'ordinary-reservation'),roomId:normal.id});
  outbox.handoff(reserved.opId);assert.equal(outbox.deliveries.claim(reserved.opId,Date.now(),7),true);
  const target=rows(w).find(r=>!r.groupId),month=new Date().toISOString().slice(0,7),legacy=7-reserved.payload.estimatedCredits-target.payload.estimatedCredits+1;assert.ok(legacy>0);
  outbox.addUsage('zep',month,legacy);assert.equal(outbox.usage('zep',month),legacy+reserved.payload.estimatedCredits);
  outbox.handoff(target.opId);const before=canonical(outbox.deliveries.get(target.opId));
  assert.throws(()=>outbox.deliveries.claim(target.opId,Date.now(),7),/monthly reserved credit budget/);
  assert.equal(canonical(outbox.deliveries.get(target.opId)),before);assert.equal(outbox.deliveries.reserved('zep',month),reserved.payload.estimatedCredits);beforeClaim(w);
});

for(const [name,change] of [
  ['imported source',w=>{const r=rows(w)[0];w.hub.history.memoryOutbox.importSource(r.identity.roomId,r.identity.sourceId,r.identity.version);} ],
  ['private DTO opt-out',w=>{w.source.rooms[0].remembers=false;}],
])test(`${name} refuses preclaim with zero credential copies or requests`,async t=>{
  const w=await world(t);change(w);await assert.rejects(w.launch());beforeClaim(w);
});

test('reset invalidates the SAME configured revision synchronously even when the first awaited room shutdown fails',async t=>{
  const w=await world(t),revision=w.hub.memoryStore.trialRevision(),normal=[...w.hub.rooms.values()][0],shutdown=normal.shutdown;
  normal.shutdown=async()=>{throw Error('synthetic reset before completion');};
  try{const reset=w.hub.reset();assert.notEqual(w.hub.memoryStore.trialRevision(),revision);assert.equal(w.source.current(),false);await assert.rejects(reset,/synthetic reset before completion/);}
  finally{normal.shutdown=shutdown;}
  await assert.rejects(w.launch());beforeClaim(w);assert.equal(rows(w).length,34,'private persistence is not claimed erased');
});

test('shutdown/reopen preserves private SQLite rows without Hub registration, import or consumed-trial resume',async t=>{
  const w=await world(t),before=canonical(rows(w));const reopened=await w.reopenHub();assert.equal(w.source.current(),false);
  for(const room of w.rooms)assert.equal(reopened.rooms.has(room.id),false);
  assert.equal(canonical(w.profile.writePermits.filter(p=>p.kind==='episode').map(p=>reopened.history.memoryOutbox.deliveries.get(p.request.body.metadata.op_id))),before);
  assert.equal(reopened.memoryTrialAccountContext(w.selection).snapshot(),null);await assert.rejects(w.caller.launch({ownerRoot:w.ownerRoot,profile:w.profile,scope:w.scope,preparation:w.preparation,binding:w.binding,approval:w.approval,verifyApproval:()=>true,fetchImpl:w.fetchImpl,record:()=>{}}));beforeClaim(w);
});
