// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {configuredHubWorld,assertNoFixtureSecrets} from './configured-hub-fixture.mjs';
import {createConfiguredNativeCaller} from './configured-native-caller.mjs';
import {createConfiguredNativeCaller as createPrivateCaller} from '../../private-trial/memory-retrieval-trial-d5/configured-native-caller.mjs';
import {createOwnedConfiguredHubFixture} from './owned-configured-hub-fixture.mjs';
import {projectRegisteredFixtureTemplate,configuredFixtureSetupEvidence} from './configured-fixture-local-template.mjs';
import {zepEpisodeRequest} from '../../dist/memory/zep-payload.js';
import {json,canonical,encode,sha256} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {dInputs,evidenceFolder} from './test-folders.mjs';

const privateInputs=await dInputs('D_PRIVATE_INPUT','D_PRIVATE_SOURCES');
const inputFile=()=>path.join(privateInputs.root,'PREPARED-PROFILE.json');
const load=()=>JSON.parse(fs.readFileSync(inputFile(),'utf8'));
const inheritedPins=()=>[inputFile(),privateInputs.preparation,privateInputs.sources]
  .map(file=>({file,sha256:sha256(fs.readFileSync(file))}));
const assertPins=pins=>{for(const pin of pins)assert.equal(sha256(fs.readFileSync(pin.file)),pin.sha256);};
async function legacyWorld(t,create=createConfiguredNativeCaller){
  return configuredHubWorld(t,{isolated:false,nativeProject:true,callerFactory:async w=>{
    w.basePrepared=w.prepared;w.caller=create({hub:w.hub,selection:w.selection});w.prepared=w.caller.prepare(w.prepared);
  }});
}
const rowView=w=>w.selection.opIds.map(id=>w.hub.history.memoryOutbox.deliveries.get(id));
const project=(w,prior=load(),projection=w.registeredTemplate)=>projectRegisteredFixtureTemplate({
  prior,projection,rooms:w.rooms,history:w.hub.history,rows:rowView(w)});

function withExpectedBindings(prior){
  const sources=JSON.parse(fs.readFileSync(privateInputs.sources,'utf8')).sources;
  const bound=json(prior),sequences=new Map();
  for(const planned of bound.payloads.rows){
    const source=sources.find(s=>s.id===planned.sourceId);assert.ok(source);
    assert.equal(sha256(source.text),planned.sourceBodySha256);
    const roomId=planned.members[0].identity.roomId,seq=(sequences.get(roomId)??0)+1;
    sequences.set(roomId,seq);
    const ts=Date.parse(source.at);assert.ok(Number.isFinite(ts));
    for(const member of planned.members){
      assert.equal(member.identity.roomId,roomId);assert.equal(member.identity.sourceId,source.id);
      assert.equal(member.identity.version,planned.sourceVersion);
      member.payload.binding={seq,source:{kind:'message',version:planned.sourceVersion,
        authorId:source.author,authorName:source.author,ts}};
    }
  }
  return bound;
}

for(const [name,create] of [['experiment',createConfiguredNativeCaller],['private',createPrivateCaller]]){
  test(`LT01 ${name} registered legacy template uses legal public names and exact persisted serializer payloads`,async t=>{
    const pins=inheritedPins(),prior=load(),before=canonical(prior),expectedPrior=withExpectedBindings(prior),
      w=await legacyWorld(t,create),local=project(w,expectedPrior);
    assert.equal(w.rooms.length,20);assert.equal(w.registeredTemplate.names.length,20);
    assert.ok(prior.payloads.physicalAddresses.every(a=>a.room.name.length>60),'actual pinned incompatible historical input');
    assert.ok(w.rooms.every(r=>r.name.length>0&&r.name.length<=60));
    assert.equal(new Set(w.rooms.map(r=>r.name)).size,20);assert.equal(w.fixtureSetup().stage,'ready');
    assert.equal(w.fixtureSetup().warmupCompleted,true);assert.equal(w.fixtureSetup().worldReturned,true);
    assert.equal(canonical(prior),before,'original template object is not mutated');assertPins(pins);
    let index=0;
    for(const planned of local.payloads.rows){
      const actualRoom=w.rooms.find(r=>r.uuid===planned.room.uuid);assert.ok(actualRoom);
      assert.equal(planned.room.name,actualRoom.name);
      for(const member of planned.members){
        const row=rowView(w)[index++],source=w.hub.history.getById(actualRoom.id,member.identity.sourceId);
        const prefix=`${source.fromName} [${source.from}]: `;
        const serializer=zepEpisodeRequest(actualRoom,{authorId:source.from,authorName:source.fromName,
          text:member.payload.request.data.slice(prefix.length),ts:source.ts,seq:source.seq});
        assert.equal(member.payload.request.sourceDescription,serializer.sourceDescription);
        const expected=json(member.payload);expected.request.metadata.op_id=row.opId;expected.request.metadata.copy_id=row.identity.copyId;
        assert.equal(canonical(expected),canonical(row.payload));
        assert.equal(row.state,'prepared');assert.equal(row.attempts,0);assert.deepEqual(row.externalIds,[]);
      }
    }
    assert.equal(index,34);assert.equal(w.HTTP.length,0);assert.equal(w.answerCopies.length,0);assert.equal(w.server.requests.length,0);
    assertNoFixtureSecrets(w,{profile:w.profile,binding:w.binding,projection:w.registeredTemplate});
  });
}

test('LT02 whole inherited/projected payload refuses content/type/time/provenance/part/version/description drift',async t=>{
  const w=await legacyWorld(t),original=withExpectedBindings(load()),before=canonical(original),rowsBefore=canonical(rowView(w));
  assert.doesNotThrow(()=>project(w,original),'binding mutations start from a valid independently bound template');
  const mutations=[
    p=>{p.payloads.rows[0].sourceId='different-planned-source-id';},
    p=>{p.payloads.rows[0].members[0].payload.request.data+=' changed';},
    p=>{p.payloads.rows[0].members[0].payload.request.type='fact';},
    p=>{p.payloads.rows[0].members[0].payload.request.createdAt='2000-01-01T00:00:00.000Z';},
    p=>{p.payloads.rows[0].members[0].payload.request.sourceDescription='changed historical description';},
    p=>{p.payloads.rows[0].members[0].payload.request.metadata.carry_hash='sha256:'+'f'.repeat(64);},
    p=>{p.payloads.rows[0].members[0].payload.request.metadata.origin=['foreign','message'];},
    p=>{p.payloads.rows[0].members[0].payload.request.metadata.part='2/2';},
    p=>{p.payloads.rows[0].members[0].identity.part='2/2';},
    p=>{p.payloads.rows[0].members[0].identity.version='sha256:'+'f'.repeat(64);},
    p=>{p.payloads.rows[0].sourceVersion='sha256:'+'f'.repeat(64);},
    p=>{p.payloads.rows[0].sourceBodySha256='f'.repeat(64);},
    p=>{p.payloads.rows[0].members[0].payload.format='changed-format';},
    p=>{p.payloads.rows[0].members[0].payload.estimatedCredits++;},
    p=>{p.payloads.rows[0].members[0].payload.request.extra='not-a-name-substitution';},
  ];
  for(const change of mutations){const changed=json(original);change(changed);assert.throws(()=>project(w,changed));}
  for(const [change,refusal] of [
    [p=>{p.payloads.rows[0].members[0].payload.binding.seq++;},/fixture_planned_seq_changed/],
    [p=>{p.payloads.rows[0].members[0].payload.binding.source.authorName='foreign';},/fixture_projected_payload_changed/],
  ]){const changed=json(original);change(changed);assert.throws(()=>project(w,changed),refusal);}
  const map=json(w.registeredTemplate);map.names[0].localName+=' alternate';assert.throws(()=>project(w,original,map));
  assert.equal(canonical(original),before);assert.equal(canonical(rowView(w)),rowsBefore);
  assert.equal(w.HTTP.length,0);assert.equal(w.answerCopies.length,0);
});

test('LT03 actual same-Hub persisted source drift cannot be adopted with a projected room name',async t=>{
  const w=await legacyWorld(t),row=rowView(w)[0],source=w.hub.history.getById(row.identity.roomId,row.identity.sourceId);
  w.hub.history.upsert(row.identity.roomId,{...source,text:source.text+' actual changed source'});
  assert.throws(()=>project(w),/fixture_source_body_changed/);
  assert.equal(w.HTTP.length,0);assert.equal(w.answerCopies.length,0);assert.equal(w.server.requests.length,0);
});

async function early(t,{constructorBlock=false}={}){
  const evidenceFile=path.join(evidenceFolder('D_CONFIGURED_EVIDENCE',{required:true}),`local-template-${randomUUID()}.json`);
  const setup={stage:'ownership-registered',warmupCompleted:false,worldReturned:false};let world=null;
  const owned=createOwnedConfiguredHubFixture(t,{onCleanup:report=>assert.equal(report.status,constructorBlock?'refused':'closed'),
    writeEvidence:closure=>fs.writeFileSync(evidenceFile,encode(configuredFixtureSetupEvidence({test:t.name,setup,world,closure,
      state:null,journalObservation:'absent'})),{flag:'wx'})});
  const root=owned.allocateRoot();setup.stage='root-returned';owned.createTrialDirectory();setup.stage='trial-directory-returned';
  const server=owned.constructServer();setup.stage='server-returned';await owned.startServer();setup.stage='server-started';
  let hub=null;
  if(constructorBlock){fs.writeFileSync(path.join(root,'hub'),'synthetic real constructor path blocker',{flag:'wx'});assert.throws(()=>owned.constructHub());}
  else{
    hub=owned.constructHub();setup.stage='hub-returned';world={root,server,hub,HTTP:[],answerCopies:[],events:[]};
    const {room}=hub.createRoom({name:'local-template-early-public-error'});
    assert.throws(()=>room.rename('x'.repeat(61)),/room name must be 1-60 characters/);
    assert.equal(room.name,'local-template-early-public-error');
  }
  const result=await owned.cleanup();assert.equal(fs.existsSync(evidenceFile),true);
  const evidence=JSON.parse(fs.readFileSync(evidenceFile,'utf8'));return {root,hub,result,evidence,evidenceFile};
}

test('LT04 early valid-owner public setup error persists null warmup and actual checked Hub/SQLite/Server closure',async t=>{
  const {root,hub,result,evidence}=await early(t);
  assert.equal(result.status,'closed');assert.equal(result.directoryRemoved,true);assert.equal(fs.existsSync(root),false);
  assert.equal(hub.history.db.isOpen,false);assert.equal(evidence.setup.stage,'hub-returned');
  assert.equal(evidence.setup.worldReturned,false);assert.equal(evidence.setup.warmupCompleted,false);assert.equal(evidence.warmupRequests,null);
  assert.equal(evidence.available.world,true);assert.deepEqual(evidence.available.hubOrdinals,[1]);
  assert.equal(evidence.closure.cleanupPhase,'evidence');assert.equal(evidence.closure.directoryRemoved,false,'pre-removal evidence does not predict removal');
  assert.equal(evidence.closure.server.closed,true);assert.equal(evidence.closure.hubs[0].closed,true);
  assert.equal(evidence.closure.hubs[0].stages.at(-1).stage,'history');assert.ok(evidence.closure.hubs[0].stages.every(s=>s.timedOut===false));
  assert.equal(evidence.journalObservation,'absent');assert.equal(evidence.state,null);
});

test('LT05 constructor unknown persists available-handle evidence and retains its own directory despite Server close',async t=>{
  const {root,result,evidence}=await early(t,{constructorBlock:true});
  assert.equal(result.status,'refused');assert.equal(result.directoryRemoved,false);assert.equal(fs.existsSync(root),true);
  assert.equal(evidence.available.world,false);assert.deepEqual(evidence.available.hubOrdinals,[]);
  assert.equal(evidence.setup.stage,'server-started');assert.equal(evidence.HTTP,null);assert.equal(evidence.answerCopies,null);assert.equal(evidence.events,null);
  assert.equal(evidence.warmupRequests,null);assert.equal(evidence.closure.server.closed,true);
  assert.equal(evidence.closure.hubs[0].constructorReturned,false);assert.equal(evidence.closure.hubs[0].closed,false);
  assert.equal(evidence.closure.hubs[0].shutdownAttempts,0);assert.ok(evidence.closure.categories.includes('hub-acquisition-incomplete'));
});

test('LT06 partial evidence keeps strict undefined/secret/observation refusal instead of converting unknown to success',async t=>{
  const owned=createOwnedConfiguredHubFixture(t),base={test:t.name,setup:{stage:'ownership-registered',warmupCompleted:false,worldReturned:false},
    world:null,closure:owned.snapshot(),state:null,journalObservation:'not-observed'};
  const report=configuredFixtureSetupEvidence(base);assert.equal(report.warmupRequests,null);assert.equal(report.journalObservation,'not-observed');
  assert.equal(report.available.root,false);assert.equal(report.available.world,false);assert.equal(report.HTTP,null);
  assert.throws(()=>configuredFixtureSetupEvidence({...base,state:undefined}));
  assert.throws(()=>configuredFixtureSetupEvidence({...base,journalObservation:'inspected'}));
  assert.throws(()=>configuredFixtureSetupEvidence({...base,setup:{...base.setup,warmupCompleted:true}}));
  assert.throws(()=>configuredFixtureSetupEvidence({...base,setup:{...base.setup,stage:'ready',worldReturned:true}}));
  assert.throws(()=>configuredFixtureSetupEvidence({...base,test:'SYNTHETIC_CONFIGURED_ZEP_KEY'}),/fixture_evidence_secret/);
  assert.throws(()=>configuredFixtureSetupEvidence({...base,world:{HTTP:[],answerCopies:[],events:undefined}}));
});
