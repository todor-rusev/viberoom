// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {configuredHubWorld,assertNoFixtureSecrets} from './configured-hub-fixture.mjs';
import {launchBindingCurrent,launchBindingWalks} from './private-launch.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';
import {DTrial} from './profile.mjs';
import {canonical} from '../memory-retrieval-comparison-d3/contracts.mjs';

for(const ordinaryModel of ['', 'different-ordinary-sieve-model'])test(`actual Hub metadata accepts independent trial model with sieve model ${JSON.stringify(ordinaryModel)}`,async t=>{
  const w=await configuredHubWorld(t,{ordinaryModel});
  const metadata=w.hub.memoryTrialContext(w.selection).snapshot();assert.ok(metadata);
  assert.equal(metadata.answer.model,w.profile.manifest.answerControls.model);
  assert.equal(w.hub.memoryStore.get().filter.model,ordinaryModel);
  assert.equal(w.answerCopies.length,0);assert.equal(w.HTTP.length,0);
  assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);assertNoFixtureSecrets(w,{metadata,binding:w.binding});
});

test('actual Hub -> SQLite claim -> allowlisted copy -> C dispatch -> every planned ACK -> the whole comparison on loopback; repeat is one-shot',async t=>{
  const w=await configuredHubWorld(t,{approvalMs:3600000}),result=await w.launch(),state=RunJournal.inspect(w.ownerRoot);
  const graphs=w.profile.manifest.topology.length,episodes=w.profile.writePermits.filter(p=>p.kind==='episode').length,jobs=w.profile.manifest.jobs.length;
  assert.equal(result.status,'captured-unjudged',result.error);assert.equal(result.records.length,jobs);assert.ok(result.records.every(r=>r.status==='captured-unjudged'));
  assert.equal(w.answerCopies.length,1);assert.ok(w.answerCopies[0].claim);assert.equal(w.answerCopies[0].stopped,null);assert.equal(w.answerCopies[0].attempts,0);
  assert.equal(w.server.requests.filter(r=>r.method==='POST'&&r.path==='/graph/create').length,graphs);
  assert.equal(w.server.requests.filter(r=>r.method==='PUT'&&r.path==='/entity-types').length,graphs);
  assert.equal(w.server.requests.filter(r=>r.method==='POST'&&r.path==='/graph').length,episodes);
  const ack=state.state.bindings.find(b=>b.name==='ingestion-acks');assert.ok(ack);assert.equal(JSON.parse(ack.value).episodes.length,episodes);
  for(const member of w.binding.members){const row=w.hub.history.memoryOutbox.deliveries.get(member.opId);assert.equal(row.acknowledged,true);assert.equal(row.externalIds.length,1);}
  assert.equal(w.events.filter(e=>e.kind==='finish').length,1);assert.equal(w.HTTP.filter(r=>r.kind==='model').length,jobs);
  assert.ok(state.state.run.stopped);assertNoFixtureSecrets(w,{state,events:w.events,result});
  const before=canonical(state),requests=w.HTTP.length,copies=w.answerCopies.length;
  await assert.rejects(w.launch());assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),before);assert.equal(w.HTTP.length,requests);assert.equal(w.answerCopies.length,copies);
});

for(const [name,change] of [
  ['card model',w=>{const profile=structuredClone(w.profile);profile.manifest.answerControls.model='substituted-trial-model';return {profile};}],
  ['card endpoint',w=>{const profile=structuredClone(w.profile);profile.origins.answerEndpoint=w.server.url+'/other/chat/completions';return {profile};}],
  ['configured consent',w=>{w.hub.memoryStore.update(c=>delete c.consent.zep);return {};}],
  ['configured cap',w=>{w.hub.memoryStore.update(c=>{c.providers.zep.monthlyCreditCap=1;});return {};}],
  ['room opt-in',w=>{w.rooms[0].updateSettings({remembers:false});return {};}],
  ['SQLite source version',w=>{const m=w.binding.members[0],s=w.hub.history.getById(m.roomId,m.sourceId);w.hub.history.upsert(m.roomId,{...s,text:s.text+' changed'});return {};}],
  ['SQLite current copy',w=>{const m=w.binding.members[0],r=w.rooms.find(r=>r.id===m.roomId);w.hub.history.memoryOutbox.deliveries.rotateCopy('zep',r.id,r.uuid);return {};}],
])test(`actual configured Hub refuses ${name} before new credential copy/claim/I/O`,async t=>{
  const w=await configuredHubWorld(t),override=change(w),beforeCopies=w.answerCopies.length;
  await assert.rejects(w.launch(override));assert.equal(w.answerCopies.length,beforeCopies);assert.equal(w.HTTP.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
});

test('actual Hub refuses substituted answer credential owner without selecting a fallback',async t=>{
  const w=await configuredHubWorld(t),copies=w.answerCopies.length;
  assert.throws(()=>w.hub.memoryTrialContext({...w.selection,answerKeyOwner:'agent-or-environment-key'}),/answer_owner_required/);
  assert.equal(w.answerCopies.length,copies);assert.equal(w.HTTP.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
});

test('actual configured postclaim transport failure leaves durable unknown and cannot copy/retry after restart',async t=>{
  const w=await configuredHubWorld(t);let calls=0;
  await assert.rejects(w.launch({fetchImpl:async()=>{calls++;const state=RunJournal.inspect(w.ownerRoot);assert.ok(state.state.run.claim);assert.equal(state.state.attempts.at(-1).outcome,'dispatch_uncertain');throw Error('synthetic fetch failure');}}));
  const state=RunJournal.inspect(w.ownerRoot);assert.equal(calls,1);assert.equal(state.state.attempts.length,1);assert.equal(state.state.attempts[0].outcome,'unknown');assert.ok(state.state.run.stopped);
  const before=canonical(state),copies=w.answerCopies.length;await assert.rejects(w.launch());assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),before);assert.equal(w.answerCopies.length,copies);assert.equal(calls,1);assertNoFixtureSecrets(w,state);
  assert.throws(()=>DTrial.claim(w.ownerRoot,{approval:w.approval,verifyApproval:()=>true,current:()=>true}),/trial_already_claimed/);
});

test('actual Hub room revocation during postclaim answer copy refuses before any request',async t=>{
  const w=await configuredHubWorld(t);w.onAnswerCopy=()=>{w.onAnswerCopy=null;w.rooms[0].updateSettings({remembers:false});};
  await assert.rejects(w.launch());assert.equal(w.answerCopies.length,1);assert.ok(w.answerCopies[0].claim);assert.equal(w.HTTP.length,0);
  const state=RunJournal.inspect(w.ownerRoot);assert.ok(state.state.run.stopped);assert.equal(state.state.attempts.length,0);assertNoFixtureSecrets(w,state);
});

test('actual Hub parallel wrappers retain one claimed leader and one credential copy',async t=>{
  const w=await configuredHubWorld(t);let entered,release,calls=0;
  const ready=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
  const leader=w.launch({fetchImpl:async()=>{calls++;entered();await blocked;throw Error('synthetic leader transport refusal');}});
  const rejected=assert.rejects(leader);await ready;
  await assert.rejects(w.launch());assert.equal(RunJournal.inspect(w.ownerRoot).state.run.stopped,null);assert.equal(w.answerCopies.length,1);assert.equal(calls,1);
  release();await rejected;assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);assert.equal(w.HTTP.length,0);
});

test('actual Hub launch check reuses its database reads while nothing is written; a write, a pinned file or a value in memory changes the next answer',async t=>{
  const w=await configuredHubWorld(t),outbox=w.hub.history.memoryOutbox,check=()=>launchBindingCurrent(w.caller.scopePorts(w.profile,w.scope),w.binding);
  const member=w.binding.members[0],walks=()=>launchBindingWalks(w.binding);
  let rowReads=0;const get=outbox.deliveries.get;outbox.deliveries.get=function(...args){rowReads++;return get.apply(this,args);};
  t.after(()=>{outbox.deliveries.get=get;});
  const repeated=(expected,n=20)=>{const before=walks();rowReads=0;for(let i=0;i<n;i++)assert.equal(check(),expected);assert.equal(walks(),before);assert.equal(rowReads,0);};
  assert.equal(walks(),0);assert.equal(check(),true);assert.equal(walks(),1);
  repeated(true);
  const own=w.hub.history.db.prepare('insert into memory_imported_source values(?,?,?)'),ownDelete=w.hub.history.db.prepare('delete from memory_imported_source where room=? and source_id=?');
  own.run('unrelated-room','unrelated-source','test');assert.equal(check(),true);assert.equal(walks(),2);repeated(true);
  own.run(member.roomId,member.sourceId,'test');assert.equal(check(),false);assert.equal(walks(),3);repeated(false);
  ownDelete.run(member.roomId,member.sourceId);assert.equal(check(),true);assert.equal(walks(),4);repeated(true);
  const other=new DatabaseSync(w.hub.history.path);
  try{
    other.prepare('insert into memory_imported_source values(?,?,?)').run(member.roomId,member.sourceId,'test');
    assert.equal(check(),false);assert.equal(walks(),5);repeated(false);
    other.prepare('delete from memory_imported_source where room=? and source_id=?').run(member.roomId,member.sourceId);
    assert.equal(check(),true);assert.equal(walks(),6);repeated(true);
  }finally{other.close();}
  ownDelete.run('unrelated-room','unrelated-source');assert.equal(check(),true);assert.equal(walks(),7);
  const zep=w.hub.memoryStore.get().providers.zep,cap=zep.monthlyCreditCap;
  zep.monthlyCreditCap=cap+1;try{assert.equal(check(),false);}finally{zep.monthlyCreditCap=cap;}
  assert.equal(check(),true);assert.equal(walks(),7);
  const association=JSON.parse(fs.readFileSync(path.join(w.root,'SYNTHETIC-PROJECT-ASSOCIATION.json'),'utf8'));
  const evidence=association.provenance.evidencePin.path,bytes=fs.readFileSync(evidence),at=new Date('2026-01-01T00:00:00Z');
  fs.utimesSync(evidence,at,at);assert.equal(check(),true);
  const before=fs.statSync(evidence,{bigint:true});
  fs.writeFileSync(evidence,Buffer.from(bytes.toString('utf8').replace('Local','LOCAL')));fs.utimesSync(evidence,at,at);
  const after=fs.statSync(evidence,{bigint:true});
  assert.equal(after.size,before.size);assert.equal(after.mtimeNs,before.mtimeNs);assert.notEqual(after.ctimeNs,before.ctimeNs);
  assert.equal(check(),false);assert.equal(check(),false);
  fs.writeFileSync(evidence,bytes);fs.utimesSync(evidence,at,at);assert.equal(check(),true);
  repeated(true);assert.equal(walks(),7);
  assert.equal(w.HTTP.length,0);assert.equal(w.answerCopies.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
});

test('actual Hub record failure terminates the common claimed owner without publishing success',async t=>{
  const w=await configuredHubWorld(t);let records=0;
  await assert.rejects(w.launch({record:()=>{records++;throw Error('synthetic record refusal');}}),/synthetic record refusal/);
  const state=RunJournal.inspect(w.ownerRoot);assert.ok(state.state.run.stopped);assert.ok(records>0);assert.equal(w.HTTP.filter(r=>r.kind==='model').length,0);
  const requests=w.HTTP.length,copies=w.answerCopies.length;await assert.rejects(w.launch());assert.equal(w.HTTP.length,requests);assert.equal(w.answerCopies.length,copies);
});
