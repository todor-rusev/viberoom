// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';import {ZepClient} from '@getzep/zep-cloud';
import {configuredHubWorld,FIXTURE_PROJECT,assertNoFixtureSecrets} from './configured-hub-fixture.mjs';
import {createConfiguredNativeCaller} from './configured-native-caller.mjs';
import {DTrial} from './profile.mjs';import {RunJournal} from '../trial-journal/journal.mjs';
import {runWholeTrial} from './whole-executor.mjs';import {createProductStep} from './product-step.mjs';
import {launchBindingCurrent} from './private-launch.mjs';
import {createSdkReadPort,createHttpAnswerPort} from '../memory-retrieval-comparison-d3/ports.mjs';
import {canonical,json,sha256} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {NATIVE_PROFILE,NATIVE_FINAL,digest} from './native-project.mjs';
import {createOwnedNativeTrialLifetime} from './owned-native-trial-lifetime.mjs';

const manualTrialLifetimes=new WeakMap();
async function nativeWorld(t){
  const lifetime=createOwnedNativeTrialLifetime(t);
  const w=await configuredHubWorld(t,{nativeProject:true,isolated:true,callerFactory:async w=>{
  w.caller=createConfiguredNativeCaller({hub:w.hub,selection:w.selection,source:w.source});w.prepared=w.caller.prepare(w.prepared);
}});
  lifetime.attach(w);manualTrialLifetimes.set(w,lifetime);return w;
}

function enrichedFetch(w,{changeGraph=null,beforeRequest=null}={}){
  const original=w.fetchImpl;return async(request,init)=>{
    const url=new URL(String(request)),relative=url.pathname.slice(new URL(w.server.url).pathname.length);
    beforeRequest?.({url,relative,init});const response=await original(request,init);
    if(init.method==='GET'&&/^\/graph\/[^/]+$/.test(relative)&&response.status===200){
      const body=await response.json();body.project_uuid=FIXTURE_PROJECT;changeGraph?.({body,graphId:decodeURIComponent(relative.slice(7))});
      return new Response(JSON.stringify(body),{status:200,headers:response.headers});
    }
    if(init.method==='POST'&&relative==='/graph/search')return new Response(JSON.stringify({edges:[]}),{status:200,headers:response.headers});
    if(url.href===w.profile.origins.answerEndpoint)return new Response(JSON.stringify({choices:[{message:{content:'Synthetic capture; unjudged.'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{status:200,headers:response.headers});
    return response;
  };
}

function sql(w,statement){const db=new DatabaseSync(path.join(w.ownerRoot,'trial-journal.sqlite'));try{db.exec(statement);}finally{db.close();}}
function saved(w,name){const row=RunJournal.inspect(w.ownerRoot).state.bindings.find(b=>b.name===name);return row?JSON.parse(row.value):null;}
function assertNoRetrievalOrModel(w){assert.equal(w.HTTP.some(r=>r.path.endsWith('/graph/search')||r.kind==='model'),false);}

test('native configured preparation is explicit provisional account scope, with no project UUID/key/claim/I/O',async t=>{
  const w=await nativeWorld(t);assert.equal(w.profile.schema,NATIVE_PROFILE);assert.equal(w.profile.nativeProject.account.projectBinding.projectId,null);
  assert.ok(w.profile.nativeProject.provisionalAuthorities.every(a=>!Object.hasOwn(a,'projectId')&&a.projectBinding.projectId===null));
  assert.equal(w.answerCopies.length,0);assert.equal(w.HTTP.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
  assertNoFixtureSecrets(w,{profile:w.profile,binding:w.binding});
});

test('actual private Hub -> claim -> C 34 ACK -> 20 durable T0 observations -> final set -> T1 read-only; no extra HTTP',async t=>{
  const baseline=await configuredHubWorld(t);const baselineResult=await baseline.launch({fetchImpl:enrichedFetch(baseline)});
  const w=await nativeWorld(t),original=enrichedFetch(w);let retrievals=0;
  const result=await w.launch({fetchImpl:async(request,init)=>{
    const url=new URL(String(request));
    if(url.pathname.endsWith('/graph/search')||url.href===w.profile.origins.answerEndpoint){
      const set=saved(w,'native-project-binding-set');assert.ok(set);assert.equal(set.observations.length,20);assert.equal(set.projectUuid,FIXTURE_PROJECT);retrievals++;
    }
    return original(request,init);
  }});
  const state=RunJournal.inspect(w.ownerRoot),set=saved(w,'native-project-binding-set');assert.ok(set);assert.equal(set.observations.length,20);
  assert.equal(saved(w,'ingestion-acks').episodes.length,34);assert.equal(state.state.bindings.filter(b=>b.name.startsWith('project-observation:')).length,20);
  const signature=world=>{
    const addresses=new Map(world.profile.manifest.topology.map(g=>[g.graphId,g.variant+':'+g.logicalRoom]));
    for(const ack of saved(world,'ingestion-acks').episodes)addresses.set(ack.uuid,ack.permitId);
    return world.HTTP.map(r=>({method:r.method,path:r.path.split('/').map(s=>addresses.get(decodeURIComponent(s))??s).join('/'),kind:r.kind}));
  };
  assert.deepEqual(signature(w),signature(baseline),'same actual C + T0 + retrieval/model + T1 HTTP trace; no added requests');
  assert.equal(baselineResult.observations.filter(o=>o.phase==='T1').length,20);
  const firstT0=Math.min(...set.observations.map(o=>saved(w,'project-observation:'+o.graphId).durableAttemptId));
  assert.equal(w.HTTP.filter(r=>r.attemptId>=firstT0&&r.method==='GET'&&w.profile.manifest.topology.some(g=>r.path.endsWith('/graph/'+g.graphId))).length,40);
  assert.equal(result.observations.filter(o=>o.phase==='T0').length,20);assert.equal(result.observations.filter(o=>o.phase==='T1').length,20);
  assert.equal(w.HTTP.filter(r=>r.kind==='model').length,264);assert.equal(result.records.length,264);
  for(const o of set.observations){const observation=saved(w,'project-observation:'+o.graphId);assert.equal(digest(observation),o.observationSha256);
    const a=state.state.attempts.find(a=>a.id===observation.durableAttemptId);assert.equal(a.outcome,'received');assert.equal(sha256(JSON.parse(a.capture).raw),observation.rawResponseSha256);
  }
  assert.ok(retrievals>0);assert.equal(w.events.filter(e=>e.kind==='native-handoff').length,1);assert.equal(w.events.find(e=>e.kind==='native-handoff').value.schema,NATIVE_FINAL);
  assert.equal(w.events.filter(e=>e.kind==='finish').length,1);assert.equal(w.answerCopies.length,1);assertNoFixtureSecrets(w,{state,result,events:w.events});
  const previous=canonical(state),requests=w.HTTP.length;await assert.rejects(w.launch());assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),previous);assert.equal(w.HTTP.length,requests);
});

for(const [name,mutate] of [
  ['native null project',body=>{body.project_uuid=null;}],['missing native project',body=>{delete body.project_uuid;}],
  ['raw alias collision',body=>{body.projectUuid='different-camel-project';}],
])test(`${name} refuses before LIST of that graph or any retrieval/model and retains one consumed Graph read`,async t=>{
  const w=await nativeWorld(t),result=await w.launch({fetchImpl:enrichedFetch(w,{changeGraph:({body})=>mutate(body)})});
  assert.equal(result.status,'held');assert.equal(saved(w,'native-project-binding-set'),null);assertNoRetrievalOrModel(w);
  assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);const before=w.HTTP.length;await assert.rejects(w.launch());assert.equal(w.HTTP.length,before);
});

test('mixed native projects cannot publish a complete set or retrieval/model allowance',async t=>{
  const w=await nativeWorld(t),foreign=w.profile.manifest.topology[1].graphId;
  const result=await w.launch({fetchImpl:enrichedFetch(w,{changeGraph:({body,graphId})=>{if(graphId===foreign)body.project_uuid='22222222-2222-4222-8222-222222222222';}})});
  assert.equal(result.status,'held');assert.equal(saved(w,'native-project-binding-set'),null);assertNoRetrievalOrModel(w);assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);
});

test('T1 project change checks the existing T0 set and cannot replace observations',async t=>{
  const w=await nativeWorld(t),seen=new Map();let completeBeforeT1;
  const result=await w.launch({fetchImpl:enrichedFetch(w,{changeGraph:({body,graphId})=>{
    const n=(seen.get(graphId)??0)+1;seen.set(graphId,n);
    if(saved(w,'native-project-binding-set')){completeBeforeT1??=canonical(saved(w,'native-project-binding-set'));body.project_uuid='33333333-3333-4333-8333-333333333333';}
  }})});
  assert.equal(result.status,'held');assert.ok(completeBeforeT1);assert.equal(canonical(saved(w,'native-project-binding-set')),completeBeforeT1);
  assert.equal(RunJournal.inspect(w.ownerRoot).state.bindings.filter(b=>b.name.startsWith('project-observation:')).length,20);
});

async function ownedWorld(t,w,{mutateCapture=null,mutateSnapshot=null,beforePorts=null}={}){
  const context=w.hub.memoryTrialAccountContext(w.selection),initial=context.snapshot();assert.ok(initial);
  const scopePorts={history:w.hub.history,get rooms(){return w.source.rooms;},cap:()=>context.snapshot()?.cap,
    current:()=>{const now=context.snapshot();return w.source.current()&&!!now&&now.configurationRevision===initial.configurationRevision&&now.loadedRevision===initial.loadedRevision;},accountSnapshot:()=>w.binding.account};
  const current=()=>launchBindingCurrent(scopePorts,w.binding),lifetime=manualTrialLifetimes.get(w);assert.ok(lifetime,'manual_trial_lifetime_not_registered');
  const owner=lifetime.claim(current);
  const ownerCurrent=()=>{try{return owner.check()===true;}catch{return false;}};
  const product=createProductStep({...scopePorts,settings:{apiKey:'SYNTHETIC_CONFIGURED_ZEP_KEY',baseUrl:w.server.url},current:ownerCurrent,preparedRows:w.binding.members.map(m=>w.hub.history.memoryOutbox.deliveries.get(m.opId))});
  const originalFetch=async(request,init)=>{
    const state=owner.summary();assert.equal(state.state.attempts.at(-1).outcome,'dispatch_uncertain');
    const url=new URL(String(request));w.HTTP.push({method:init.method,path:url.pathname,kind:url.href===w.profile.origins.answerEndpoint?'model':'zep'});
    const response=await fetch(request,init);if(init.method==='GET'&&/^\/graph\/[^/]+$/.test(url.pathname.slice(new URL(w.server.url).pathname.length))&&response.status===200){const body=await response.json();body.project_uuid=FIXTURE_PROJECT;return new Response(JSON.stringify(body),{status:200,headers:response.headers});}return response;
  };
  const run=()=>runWholeTrial({owner,profile:w.profile,scope:w.scope,preparation:w.preparation,current:ownerCurrent,productStep:product.productStep,readLocalRoutes:product.projectLocalRoutes,fetchImpl:originalFetch,verifyReceipt:ack=>product.verifyReceipt(ack),record:(kind,value)=>w.events.push({kind,value}),comparisonPorts:({budget,nativeCapability})=>{
    w.nativeCapability=nativeCapability;
    beforePorts?.({nativeCapability,owner});
    const capability=mutateCapture?Object.freeze({...nativeCapability,T0:Object.freeze({captureGraph:input=>nativeCapability.T0.captureGraph(mutateCapture(json(input)))})}):nativeCapability;
    const real=createSdkReadPort({ZepClient,baseUrl:w.profile.origins.readBase,apiKey:'SYNTHETIC_CONFIGURED_ZEP_KEY',purpose:'local-fixture',budget,current,fetchImpl:originalFetch,nativeProject:capability});
    const readPort=mutateCapture||mutateSnapshot?Object.freeze({...real,observe:async(graphId,phase)=>{
      const snapshot=await real.observe(graphId,phase===nativeCapability.T0?capability.T0:phase);
      return mutateSnapshot?mutateSnapshot(json(snapshot)):snapshot;
    }}):real;
    return {readPort,answerPort:createHttpAnswerPort({endpointUrl:w.profile.origins.answerEndpoint,answerControls:w.profile.manifest.answerControls,purpose:'local-fixture',budget,current,fetchImpl:originalFetch})};
  }});
  return {owner,run};
}

for(const [name,mutate] of [
  ['wrong budget attempt',input=>({...input,attemptNumber:input.attemptNumber-1})],
  ['wrong raw response',input=>({...input,raw:input.raw+' '})],
  ['wrong typed project',input=>({...input,capture:{...input.capture,row:{...input.capture.row,projectUuid:'foreign'}}})],
  ['wrong SDK layout',input=>({...input,capture:{...input.capture,layout:{...input.capture.layout,sha256:'0'.repeat(64)}}})],
  ['wrong graph',input=>({...input,graphId:'not-allowlisted'})],
])test(`actual SQLite/SDK ${name} join refusal closes the owner before LIST/retrieval`,async t=>{
  const w=await nativeWorld(t),owned=await ownedWorld(t,w,{mutateCapture:mutate}),result=await owned.run();
  assert.equal(result.status,'held');assert.equal(saved(w,'native-project-binding-set'),null);assertNoRetrievalOrModel(w);
  assert.ok(owned.owner.summary().state.run.stopped);
});

for(const [name,probe] of [
  ['incomplete T0 set',cap=>cap.completeT0([])],
  ['T1 before final handoff',cap=>cap.T1.captureGraph({graphId:'not-yet-bound',attemptNumber:1,raw:'{}',capture:{}})],
])test(`closed capability rejects ${name} before retrieval/context/model`,async t=>{
  const w=await nativeWorld(t),owned=await ownedWorld(t,w,{beforePorts:({nativeCapability})=>probe(nativeCapability)});
  await assert.rejects(owned.run());assert.equal(saved(w,'native-project-binding-set'),null);assertNoRetrievalOrModel(w);assert.ok(owned.owner.summary().state.run.stopped);
});

test('normal T0 inventory validation rejects a foreign source version before complete set/retrieval',async t=>{
  const w=await nativeWorld(t),owned=await ownedWorld(t,w,{mutateSnapshot:snapshot=>{
    assert.ok(snapshot.episodes.length);snapshot.episodes[0].metadata.version='foreign-source-version';return snapshot;
  }}),result=await owned.run();
  assert.equal(result.status,'held');assert.equal(saved(w,'native-project-binding-set'),null);assertNoRetrievalOrModel(w);
  assert.equal(RunJournal.inspect(w.ownerRoot).state.bindings.filter(b=>b.name.startsWith('project-observation:')).length,1);
  assert.ok(owned.owner.summary().state.run.stopped);
});

test('repeated T0 hook cannot resave or continue the same received read',async t=>{
  const w=await nativeWorld(t);let repeated=false;
  const owned=await ownedWorld(t,w,{mutateCapture:input=>{if(!repeated){repeated=true;w.nativeCapability.T0.captureGraph(input);}return input;}});
  const result=await owned.run();assert.equal(result.status,'held');assert.equal(RunJournal.inspect(w.ownerRoot).state.bindings.filter(b=>b.name.startsWith('project-observation:')).length,1);
  assertNoRetrievalOrModel(w);assert.ok(owned.owner.summary().state.run.stopped);
});

for(const name of ['project-observation:','native-project-binding-set'])test(`failed ${name} save plus rejected terminal SQL revokes SAME owner/direct admission/restart`,async t=>{
  const w=await nativeWorld(t);sql(w,`CREATE TRIGGER native_save_refused BEFORE INSERT ON bindings WHEN ${name==='project-observation:'?"new.name LIKE 'project-observation:%'":"new.name='native-project-binding-set'"} BEGIN SELECT RAISE(ABORT,'synthetic native binding refused'); END;
    CREATE TRIGGER native_stop_refused BEFORE UPDATE OF stopped ON run WHEN new.stopped IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic terminal refused'); END;`);
  const owned=await ownedWorld(t,w);await assert.rejects(owned.run());const state=owned.owner.summary();assert.equal(state.state.run.stopped,null);assert.equal(saved(w,'native-project-binding-set'),null);assertNoRetrievalOrModel(w);
  const before=canonical(state),number=state.state.attempts.length+1,graph=w.profile.manifest.topology[0].graphId;
  assert.throws(()=>owned.owner.recordAttempt({number,kind:'read',status:'attempted',response:null,request:{method:'GET',url:w.server.url+'/graph/'+graph,body:null,maxRetries:0}}),/trial_stopped/);
  assert.equal(canonical(owned.owner.summary()),before);assert.throws(()=>DTrial.claim(w.ownerRoot,{approval:w.approval,verifyApproval:()=>true,current:()=>true}),/trial_already_claimed/);
});

test('first native Graph unknown response ends held and prevents set, retrieval, any later request and another wrapper',async t=>{
  const w=await nativeWorld(t);let failed=false,atUnknown=null;const normal=enrichedFetch(w);
  const result=await w.launch({fetchImpl:async(request,init)=>{
    if(saved(w,'ingestion-acks')&&init.method==='GET'&&!failed){failed=true;atUnknown=w.HTTP.length;throw Error('synthetic native unknown');}return normal(request,init);
  }});
  assert.ok(failed,'the scenario was reached');assert.equal(result.status,'held');assert.equal(result.summary.reason,'budget_outcome_unknown');
  assert.equal(saved(w,'native-project-binding-set'),null);assertNoRetrievalOrModel(w);
  assert.equal(w.HTTP.length,atUnknown,'nothing is sent after the unknown answer');
  const state=RunJournal.inspect(w.ownerRoot).state;
  assert.equal(state.attempts.filter(a=>a.outcome==='unknown').length,1);assert.equal(state.run.stopped,'unknown_or_authority_lost');
  const before=w.HTTP.length;await assert.rejects(w.launch());assert.equal(w.HTTP.length,before,'no second wrapper sends anything');
});

for(const [name,change] of [
  ['source version',w=>{const m=w.binding.members[0],s=w.hub.history.getById(m.roomId,m.sourceId);w.hub.history.upsert(m.roomId,{...s,text:s.text+' changed across native await'});}],
  ['current copy',w=>{const m=w.binding.members[0],r=w.rooms.find(r=>r.id===m.roomId);w.hub.history.memoryOutbox.deliveries.rotateCopy('zep',r.id,r.uuid);}],
  ['consent',w=>w.hub.memoryStore.update(c=>delete c.consent.zep)],
  ['cap',w=>w.hub.memoryStore.update(c=>{c.providers.zep.monthlyCreditCap=1;})],
  ['configuration A-B-A',w=>{const old=w.hub.memoryStore.get().providers.zep.baseUrl;w.hub.memoryStore.update(c=>{c.providers.zep.baseUrl='http://127.0.0.1:1/v2';});w.hub.memoryStore.update(c=>{c.providers.zep.baseUrl=old;});}],
])test(`actual ${name} change across first native Graph await prevents final set/retrieval`,async t=>{
  const w=await nativeWorld(t),normal=enrichedFetch(w);let changed=false,result,error;
  try{result=await w.launch({fetchImpl:async(request,init)=>{const response=await normal(request,init);if(saved(w,'ingestion-acks')&&init.method==='GET'&&!changed){changed=true;change(w);}return response;}});}catch(e){error=e;}
  assert.ok(changed);assert.ok(error||result?.status==='held');assert.equal(saved(w,'native-project-binding-set'),null);assertNoRetrievalOrModel(w);assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);
  const requests=w.HTTP.length;await assert.rejects(w.launch());assert.equal(w.HTTP.length,requests);
});

test('native launch check reads no delivery row while nothing is written; a write by either connection or a value in memory changes the next answer',async t=>{
  const w=await nativeWorld(t),outbox=w.hub.history.memoryOutbox,ports=w.caller.scopePorts(w.profile,w.scope),check=()=>launchBindingCurrent(ports,w.binding);
  let rowReads=0;const get=outbox.deliveries.get;outbox.deliveries.get=function(...args){rowReads++;return get.apply(this,args);};
  t.after(()=>{outbox.deliveries.get=get;});
  const repeated=expected=>{rowReads=0;for(let i=0;i<20;i++)assert.equal(check(),expected);assert.equal(rowReads,0);};
  const changed=expected=>{rowReads=0;assert.equal(check(),expected);assert.ok(rowReads>0,'a write reads the rows again');repeated(expected);};
  assert.equal(check(),true);repeated(true);
  const room=w.binding.members[0].roomId,copy=w.hub.history.db.prepare("select copy_id from memory_delivery_copy where provider='zep' and room=?").get(room).copy_id;
  const move="update memory_delivery_copy set copy_id=? where provider='zep' and room=?";
  w.hub.history.db.prepare(move).run('moved-copy',room);changed(false);
  w.hub.history.db.prepare(move).run(copy,room);changed(true);
  const other=new DatabaseSync(w.hub.history.path);
  try{other.prepare(move).run('moved-copy',room);changed(false);other.prepare(move).run(copy,room);changed(true);}
  finally{other.close();}
  const zep=w.hub.memoryStore.get().providers.zep,cap=zep.monthlyCreditCap;
  zep.monthlyCreditCap=cap+1;try{rowReads=0;assert.equal(check(),false);assert.equal(rowReads,0);}finally{zep.monthlyCreditCap=cap;}
  repeated(true);
  assert.equal(w.HTTP.length,0);assert.equal(w.answerCopies.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
});

test('owner monotonic expiry during native receive retains unknown evidence but no set or new I/O',async t=>{
  const w=await nativeWorld(t),normal=enrichedFetch(w);let mono=0,expired=false,result,error;
  try{result=await w.launch({claimClock:()=>mono,fetchImpl:async(request,init)=>{const response=await normal(request,init);if(saved(w,'ingestion-acks')&&init.method==='GET'&&!expired){expired=true;mono=w.profile.manifest.limits.runMs+1;}return response;}});}catch(e){error=e;}
  assert.ok(expired);assert.ok(error||result?.status==='held');assert.equal(saved(w,'native-project-binding-set'),null);assertNoRetrievalOrModel(w);
  const state=RunJournal.inspect(w.ownerRoot);assert.ok(state.state.run.stopped);assert.ok(state.state.attempts.some(a=>a.outcome==='unknown'));
});
