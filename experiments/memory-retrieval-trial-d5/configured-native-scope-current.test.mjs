// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {configuredHubWorld,assertNoFixtureSecrets} from './configured-hub-fixture.mjs';
import {createConfiguredNativeCaller} from './configured-native-caller.mjs';
import {createConfiguredNativeCaller as createPrivateCaller} from '../../private-trial/memory-retrieval-trial-d5/configured-native-caller.mjs';
import {DTrial} from './profile.mjs';
import {DTrial as PrivateDTrial} from '../../private-trial/memory-retrieval-trial-d5/profile.mjs';
import {launchPrivateTrial} from './private-launch.mjs';
import {launchPrivateTrial as launchPrivateMirror} from '../../private-trial/memory-retrieval-trial-d5/private-launch.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';
import {SqlReadOnlyFence,sqliteTotalChanges} from '../../dist/memory/sql-read-only-fence.js';
import {newGenerationId} from '../../dist/memory/graph-generations.js';
import {canonical} from '../memory-retrieval-comparison-d3/contracts.mjs';

const implementations=[
  {name:'experiment',create:createConfiguredNativeCaller,Owner:DTrial,launch:launchPrivateTrial},
  {name:'private',create:createPrivateCaller,Owner:PrivateDTrial,launch:launchPrivateMirror},
];
async function world(t,implementation,{isolated=true}={}){
  return configuredHubWorld(t,{nativeProject:true,isolated,callerFactory:async w=>{
    w.basePrepared=w.prepared;
    if(isolated){
      const original=w.source,originalCurrent=original.current;
      const probe={selectedCalls:0,sourceCalls:0,handler:null};
      const countedSource=Object.freeze({...original,current:()=>{probe.sourceCalls++;return originalCurrent();}});
      const scopeCurrent=()=>{probe.selectedCalls++;return probe.handler===null?countedSource.current():probe.handler();};
      w.scopeControl={probe,original,originalCurrent,countedSource,scopeCurrent};
      w.caller=implementation.create({hub:w.hub,selection:w.selection,source:countedSource,scopeCurrent});
    }else w.caller=implementation.create({hub:w.hub,selection:w.selection});
    w.prepared=w.caller.prepare(w.prepared);
  }});
}
function reset(w){w.scopeControl.probe.selectedCalls=0;w.scopeControl.probe.sourceCalls=0;}
function unchanged(w){return canonical({rows:w.source?.rows()??null,
  account:(w.source?w.hub.memoryTrialAccountContext(w.selection):w.hub.memoryTrialContext(w.selection)).snapshot(),
  journal:RunJournal.inspect(w.ownerRoot),sources:w.binding.members.map(m=>w.hub.history.getById(m.roomId,m.sourceId))});}
function noCopyOrDispatch(w){
  assert.equal(w.answerCopies.length,0);assert.equal(w.HTTP.length,0);assert.equal(w.server.requests.length,0);
  assertNoFixtureSecrets(w,{profile:w.profile,binding:w.binding,journal:RunJournal.inspect(w.ownerRoot)});
}
function afterExactClaim(t,implementation,change){
  const original=implementation.Owner.claim;let count=0;
  implementation.Owner.claim=function(...args){const owner=original.apply(this,args);count++;
    assert.ok(owner.summary().state.run.claim,'observe only after the real durable claim');change(owner);return owner;};
  t.after(()=>{implementation.Owner.claim=original;});return ()=>count;
}
function finalBoundary(t,w,implementation,{expireInside=false}={}){
  const probe={setupFinished:false,checksAfterSetup:0,inCheck:false,last:false,
    guardedCalls:0,unguardedCalls:0,checkSucceeded:false,loaderReads:0,clockAtLoader:null};
  let tick=0;
  const context=w.hub.memoryTrialAccountContext(w.selection),initial=context.snapshot();assert.ok(initial);
  const selected=w.scopeControl.scopeCurrent;
  w.scopeControl.probe.handler=()=>{
    if(probe.last){
      if(probe.inCheck){probe.guardedCalls++;if(expireInside&&probe.guardedCalls===2)tick=w.profile.manifest.limits.runMs;}
      else {probe.unguardedCalls++;tick=w.profile.manifest.limits.runMs;}
    }
    return w.scopeControl.countedSource.current();
  };
  const claims=afterExactClaim(t,implementation,owner=>{
    const beginSetup=owner.beginSetup,check=owner.check;
    owner.beginSetup=function(...args){const value=beginSetup.apply(this,args);probe.setupFinished=true;return value;};
    owner.check=function(...args){
      if(probe.setupFinished)probe.checksAfterSetup++;
      probe.last=probe.setupFinished&&probe.checksAfterSetup===2;probe.inCheck=true;
      try{const value=check.apply(this,args);if(probe.last)probe.checkSucceeded=true;return value;}
      finally{probe.inCheck=false;}
    };
  });
  const scopePorts={history:w.hub.history,rooms:w.source.rooms,
    current:()=>canonical(context.snapshot())===canonical(initial)&&selected()===true,
    cap:()=>context.snapshot()?.cap,accountSnapshot:()=>w.profile.nativeProject.account};
  const args={ownerRoot:w.ownerRoot,profile:w.profile,scope:w.scope,preparation:w.preparation,binding:w.binding,
    scopePorts,approval:w.approval,verifyApproval:()=>true,claimClock:()=>tick,clock:()=>0,
    fetchImpl:w.fetchImpl,record:(kind,value)=>w.events.push({kind,value})};
  Object.defineProperty(args,'loadCredentials',{get(){probe.loaderReads++;probe.clockAtLoader=tick;
    throw Error('synthetic_scope_current_loader_entry_stop');}});
  return {probe,args,claims,tick:()=>tick};
}
for(const implementation of implementations){
  const control=(id,title,body)=>test(`${implementation.name} ${id} ${title}`,{concurrency:false},body);

  control('SC01','legacy source default and explicit null retain exact preparation/capture with the delegated source',async t=>{
    const w=await world(t,implementation),before=unchanged(w),original=w.source.current;
    const omitted=implementation.create({hub:w.hub,selection:w.selection,source:w.source});
    const explicitNull=implementation.create({hub:w.hub,selection:w.selection,source:w.source,scopeCurrent:null});
    const a=omitted.prepare(w.basePrepared),b=explicitNull.prepare(w.basePrepared),c=w.caller.prepare(w.basePrepared);
    assert.equal(canonical(a),canonical(b));assert.equal(canonical(a),canonical(c));
    assert.equal(canonical(omitted.capture(a.profile,a.scope)),canonical(explicitNull.capture(b.profile,b.scope)));
    assert.equal(canonical(omitted.capture(a.profile,a.scope)),canonical(w.caller.capture(c.profile,c.scope)));
    assert.equal(w.source.current,original);assert.equal(unchanged(w),before);noCopyOrDispatch(w);
  });

  control('SC02','registered legacy source-null branch is unchanged and cannot acquire a delegate',async t=>{
    const w=await world(t,implementation,{isolated:false}),before=unchanged(w);
    const omitted=implementation.create({hub:w.hub,selection:w.selection});
    const explicitNull=implementation.create({hub:w.hub,selection:w.selection,source:null,scopeCurrent:null});
    assert.equal(canonical(omitted.prepare(w.basePrepared)),canonical(explicitNull.prepare(w.basePrepared)));
    let calls=0;assert.throws(()=>implementation.create({hub:w.hub,selection:w.selection,scopeCurrent:()=>{calls++;return true;}}),/configured_native_contract_refused/);
    assert.equal(calls,0);assert.equal(unchanged(w),before);noCopyOrDispatch(w);
  });

  control('SC03','each metadata preparation invokes exactly one selected delegate and no independent source callback',async t=>{
    const w=await world(t,implementation),before=unchanged(w);reset(w);
    const value=w.caller.prepare(w.basePrepared);assert.equal(value.profile.nativeProject.account.accountId,w.accountId);
    assert.equal(w.scopeControl.probe.selectedCalls,1);assert.equal(w.scopeControl.probe.sourceCalls,1);
    reset(w);w.scopeControl.probe.handler=()=>false;
    assert.throws(()=>w.caller.prepare(w.basePrepared),/configured_native_contract_refused/);
    assert.equal(w.scopeControl.probe.selectedCalls,1);assert.equal(w.scopeControl.probe.sourceCalls,0);
    assert.equal(w.source.current,w.scopeControl.originalCurrent);assert.equal(unchanged(w),before);noCopyOrDispatch(w);
  });

  control('SC04','nonfunctions/serialized booleans and absent/foreign source owners refuse before invoking a delegate',async t=>{
    const w=await world(t,implementation),before=unchanged(w);
    for(const scopeCurrent of [true,false,0,'()=>true',{},Promise.resolve(true),JSON.parse('{"scopeCurrent":true}')]){
      assert.throws(()=>implementation.create({hub:w.hub,selection:w.selection,source:w.source,scopeCurrent}),/configured_native_contract_refused/);
    }
    let calls=0;const scopeCurrent=()=>{calls++;return true;};
    for(const source of [null,{...w.source,history:{}},{...w.source,schema:'foreign-source'}, {...w.source,current:null}]){
      assert.throws(()=>implementation.create({hub:w.hub,selection:w.selection,source,scopeCurrent}),/configured_native_contract_refused/);
    }
    assert.equal(calls,0);assert.equal(unchanged(w),before);noCopyOrDispatch(w);
  });

  control('SC05','only synchronous primitive true admits metadata; Promise/async/thenable/error results refuse',async t=>{
    const w=await world(t,implementation),before=unchanged(w);let thenCalls=0;
    const rejected=Promise.reject(Error('synthetic_rejected_scope_promise'));rejected.catch(()=>{});
    for(const scopeCurrent of [()=>false,()=>undefined,()=>0,()=>1,()=> 'true',()=>({}),()=>new Boolean(true),
      ()=>Promise.resolve(true),()=>rejected,async()=>true,()=>({then(){thenCalls++;}}),()=>{throw Error('synthetic_scope_current_error');}]){
      const caller=implementation.create({hub:w.hub,selection:w.selection,source:w.source,scopeCurrent});
      assert.throws(()=>caller.prepare(w.basePrepared));
    }
    assert.equal(thenCalls,0,'no thenable is awaited/coerced into authority');assert.equal(unchanged(w),before);noCopyOrDispatch(w);
  });

  control('SC06','existing same-store readonly fence false outcome stays a held delegate result without mutation',async t=>{
    const w=await world(t,implementation),db=w.hub.history.db,fence=new SqlReadOnlyFence(db),before=unchanged(w),changes=sqliteTotalChanges(db);
    let calls=0;const target=w.rooms[0].id;
    const caller=implementation.create({hub:w.hub,selection:w.selection,source:w.source,scopeCurrent:()=>{calls++;
      return fence.run(()=>{w.hub.history.upsert(target,{id:'scope-current-refused-write',seq:999,room:'local',from:'human',fromName:'Synthetic',ts:0,kind:'chat',text:'refused'});return true;});}});
    assert.throws(()=>caller.prepare(w.basePrepared),/configured_native_contract_refused/);assert.equal(calls,1);
    assert.equal(w.hub.history.getById(target,'scope-current-refused-write',true),null);assert.equal(sqliteTotalChanges(db),changes);
    assert.equal(unchanged(w),before);noCopyOrDispatch(w);
  });

  control('SC07','delegated true cannot remove current loaded account/cap/consent/answer endpoint/model fences',async t=>{
    for(const {mutate,persisted} of [
      {mutate:w=>w.hub.memoryStore.update(c=>delete c.consent.zep),persisted:c=>assert.equal(Object.hasOwn(c.consent,'zep'),false)},
      {mutate:w=>w.hub.memoryStore.update(c=>{c.providers.zep.monthlyCreditCap=1;}),persisted:c=>assert.equal(c.providers.zep.monthlyCreditCap,1)},
      {mutate:w=>w.hub.memoryStore.update(c=>{c.providers.zep.baseUrl='http://127.0.0.1:1/v2';}),persisted:c=>assert.equal(c.providers.zep.baseUrl,'http://127.0.0.1:1/v2')},
      {mutate:w=>{w.profile.origins.answerEndpoint=w.server.url+'/wrong/chat/completions';},persisted:null},
      {mutate:w=>{w.profile.manifest.answerControls.model='wrong-explicit-answer-model';},persisted:null},
    ]){
      const w=await world(t,implementation);w.scopeControl.probe.handler=()=>true;
      const initial=w.answerCredentialCheckpoint(),revision=w.hub.memoryStore.trialRevision();
      assert.equal(initial.count,0);noCopyOrDispatch(w);
      mutate(w);
      const beforeCapture=w.answerCredentialCheckpoint();
      if(persisted!==null){
        assert.notEqual(w.hub.memoryStore.trialRevision(),revision);
        persisted(JSON.parse(readFileSync(w.hub.memoryStore.path,'utf8')));
        assert.ok(beforeCapture.count>0,'actual persistence must remain observed');
        for(const row of beforeCapture.rows)assert.deepEqual(row,{claim:null,stopped:null,attempts:0});
      }else{
        assert.equal(w.hub.memoryStore.trialRevision(),revision);noCopyOrDispatch(w);
      }
      const stateBefore=RunJournal.inspect(w.ownerRoot).state;
      assert.equal(stateBefore.run.claim,null);assert.equal(stateBefore.attempts.length,0);
      assert.equal(w.HTTP.length,0);assert.equal(w.server.requests.length,0);
      assert.throws(()=>w.caller.capture(w.profile,w.scope));
      assert.deepEqual(w.answerCredentialCheckpoint(),beforeCapture,'capture added credential reads or lost its observer');
      const stateAfter=RunJournal.inspect(w.ownerRoot).state;
      assert.equal(stateAfter.run.claim,null);assert.equal(stateAfter.attempts.length,0);
      assert.equal(w.HTTP.length,0);assert.equal(w.server.requests.length,0);
      assertNoFixtureSecrets(w,{profile:w.profile,binding:w.binding,journal:RunJournal.inspect(w.ownerRoot)});
      if(persisted===null)noCopyOrDispatch(w);
    }
  });

  control('SC08','delegated true cannot remove member/current-copy/import/source/namespace/route ownership fences',async t=>{
    for(const mutate of [
      w=>{const row=w.source.rows()[0];w.hub.history.memoryOutbox.deliveries.rotateCopy('zep',row.identity.roomId,row.identity.roomUuid);},
      w=>{const m=w.binding.members[0],s=w.hub.history.getById(m.roomId,m.sourceId);w.hub.history.upsert(m.roomId,{...s,text:s.text+' changed source'});},
      w=>{const row=w.source.rows()[0];w.hub.history.memoryOutbox.importSource(row.identity.roomId,row.identity.sourceId,row.identity.version);},
      w=>{w.hub.createRoom({name:'scope-current-namespace-collision',uuid:w.rooms[0].uuid,settings:{remembers:false}});},
      w=>{w.scope.members[0].opId='missing-scope-current-member';},
      w=>{const r=w.rooms[0];w.hub.history.memoryOutbox.generations.failedRead({provider:'zep',account:w.accountId,uuid:r.uuid},'synthetic_scope_current_route_hold',0);},
      w=>{const row=w.source.rows()[0],r=w.rooms.find(r=>r.id===row.identity.roomId);w.hub.history.memoryOutbox.generations.observe({provider:'zep',account:w.accountId,uuid:r.uuid},
        {graphId:newGenerationId(r.uuid,row.identity.copyId),epoch:1,copy:row.identity.copyId},0);},
      w=>{const row=w.source.rows()[0],r=w.rooms.find(r=>r.id===row.identity.roomId);w.hub.history.memoryOutbox.followGeneration({provider:'zep',account:w.accountId,uuid:r.uuid},r.id,'foreign-synthetic-copy',
        'synthetic-scope-current-revision',{graphId:row.payload.request.graphId,epoch:0,copy:null});},
    ]){
      const w=await world(t,implementation);w.scopeControl.probe.handler=()=>true;mutate(w);
      assert.throws(()=>w.caller.capture(w.profile,w.scope));noCopyOrDispatch(w);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
    }
  });

  control('SC09','actual configured caller RAW delegate refuses after durable claim before credential copy or dispatch',async t=>{
    const w=await world(t,implementation);let postClaimCalls=0;
    const claims=afterExactClaim(t,implementation,()=>{w.scopeControl.probe.handler=()=>{postClaimCalls++;return false;};});
    await assert.rejects(w.launch());assert.equal(claims(),1);assert.ok(postClaimCalls>0);
    const state=RunJournal.inspect(w.ownerRoot).state;assert.ok(state.run.claim);assert.ok(state.run.stopped);
    assert.equal(state.attempts.length,0);assert.equal(state.permits.length,0);noCopyOrDispatch(w);
  });

  for(const expireInside of [false,true])control(expireInside?'SC10B':'SC10A',
    expireInside?'last guarded RAW delegate expiry refuses before inherited loader entry':'RAW delegate adds no callback from final owner check to inherited loader entry',async t=>{
      const w=await world(t,implementation),b=finalBoundary(t,w,implementation,{expireInside});
      await assert.rejects(implementation.launch(b.args),expireInside?/launch_authority_changed/:/private_credentials_load_failed/);
      assert.equal(b.claims(),1);assert.equal(b.probe.setupFinished,true);assert.equal(b.probe.checksAfterSetup,2);
      assert.equal(b.probe.guardedCalls,2);assert.equal(b.probe.unguardedCalls,0);assert.equal(b.probe.checkSucceeded,!expireInside);
      assert.equal(b.probe.loaderReads,expireInside?0:1);assert.equal(b.probe.clockAtLoader,expireInside?null:0);
      assert.equal(b.tick(),expireInside?w.profile.manifest.limits.runMs:0);
      const state=RunJournal.inspect(w.ownerRoot).state;assert.ok(state.run.claim);assert.ok(state.run.stopped);
      assert.equal(state.attempts.length,0);assert.equal(state.permits.length,0);noCopyOrDispatch(w);
    });
}
