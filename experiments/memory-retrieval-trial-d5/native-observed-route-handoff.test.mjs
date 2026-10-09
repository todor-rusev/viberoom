// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';import {ZepClient} from '@getzep/zep-cloud';
import * as experiment from './native-project.mjs';
import * as privateNative from '../../private-trial/memory-retrieval-trial-d5/native-project.mjs';
import {createConfiguredNativeCaller as experimentCaller} from './configured-native-caller.mjs';
import {createConfiguredNativeCaller as privateCaller} from '../../private-trial/memory-retrieval-trial-d5/configured-native-caller.mjs';
import {createProductStep as experimentProduct} from './product-step.mjs';
import {createProductStep as privateProduct} from '../../private-trial/memory-retrieval-trial-d5/product-step.mjs';
import {DTrial as ExperimentTrial} from './profile.mjs';import {DTrial as PrivateTrial} from '../../private-trial/memory-retrieval-trial-d5/profile.mjs';
import {runWholeTrial as experimentWhole} from './whole-executor.mjs';import {runWholeTrial as privateWhole} from '../../private-trial/memory-retrieval-trial-d5/whole-executor.mjs';
import {configuredHubWorld,FIXTURE_PROJECT,assertNoFixtureSecrets} from './configured-hub-fixture.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';
import {launchBindingCurrent} from './private-launch.mjs';
import * as experimentPorts from '../memory-retrieval-comparison-d3/ports.mjs';import * as privatePorts from '../../private-trial/memory-retrieval-comparison-d3/ports.mjs';
import {canonical,json} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {sqliteTotalChanges} from '../../dist/memory/sql-read-only-fence.js';
import {newGenerationId,generationPointer} from '../../dist/memory/graph-generations.js';

const modules=[{name:'experiment',native:experiment,caller:experimentCaller,product:experimentProduct,Trial:ExperimentTrial,whole:experimentWhole,ports:experimentPorts},
  {name:'private',native:privateNative,caller:privateCaller,product:privateProduct,Trial:PrivateTrial,whole:privateWhole,ports:privatePorts}];
const saved=(w,name)=>{const row=RunJournal.inspect(w.ownerRoot).state.bindings.find(b=>b.name===name);return row?JSON.parse(row.value):null;};
const namespace=(w,r)=>({provider:'zep',account:w.accountId,uuid:r.uuid});
const noRetrieval=w=>assert.equal(w.HTTP.some(r=>r.path.endsWith('/graph/search')||r.kind==='model'),false);
const stopped=w=>assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);
const attachment=(w,r)=>w.hub.history.memoryOutbox.generationAttachment('zep',r.id);
function changeAttachment(w,r,mutate){const a=attachment(w,r);assert.ok(a);mutate(a);
  w.hub.history.db.prepare('update memory_generation_attachment set state=? where provider=? and room=?').run(JSON.stringify(a),'zep',r.id);}
function changeBinding(w,name,mutate){const value=saved(w,name);assert.ok(value);mutate(value);const db=new DatabaseSync(path.join(w.ownerRoot,'trial-journal.sqlite'));
  try{db.prepare('update bindings set value=? where name=?').run(canonical(value),name);}finally{db.close();}}
async function world(t,mod,{initialized=false}={}){return configuredHubWorld(t,{nativeProject:true,isolated:true,callerFactory:async w=>{
  if(initialized){for(const g of w.prepared.scope.graphs){const r=w.source.rooms.find(r=>r.uuid===g.authority.roomUuid);assert.ok(r);
    const actual=w.hub.history.memoryOutbox.generations.observe(namespace(w,r),{graphId:g.graphId,epoch:0,copy:null},Date.now());assert.ok(actual.revision);g.authority.routeRevision=actual.revision;}
    w.prepared.profile.review.serviceEmissionProofSha256=mod.native.digest(w.prepared.scope);}
  w.caller=mod.caller({hub:w.hub,selection:w.selection,source:w.source});w.prepared=w.caller.prepare(w.prepared);
}});}
function receivedFetch(w,underlying=w.fetchImpl,changeGraph=()=>{}){return async(request,init)=>{
  const url=new URL(String(request)),relative=url.pathname.slice(new URL(w.server.url).pathname.length),response=await underlying(request,init);
  if(init.method==='GET'&&/^\/graph\/[^/]+$/.test(relative)&&response.status===200){const body=await response.json();body.project_uuid=FIXTURE_PROJECT;
    changeGraph({body,graphId:decodeURIComponent(relative.slice(7))});return new Response(JSON.stringify(body),{status:200,headers:response.headers});}
  if(init.method==='POST'&&relative==='/graph/search')return new Response(JSON.stringify({edges:[]}),{status:200,headers:response.headers});
  if(url.href===w.profile.origins.answerEndpoint)return new Response(JSON.stringify({choices:[{message:{content:'Synthetic local authority control.'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{status:200,headers:response.headers});
  return response;
};}

async function owned(t,w,mod,{project=null,beforePorts=()=>{},changeGraph=()=>{},onRecord=()=>{},observeCurrent=()=>{}}={},probe){
  const context=w.hub.memoryTrialAccountContext(w.selection),initial=context.snapshot();assert.ok(initial);
  const scopePorts={history:w.hub.history,rooms:w.source.rooms,cap:()=>context.snapshot()?.cap,
    current:()=>{const live=context.snapshot();return w.source.current()&&!!live&&live.configurationRevision===initial.configurationRevision&&live.loadedRevision===initial.loadedRevision;},accountSnapshot:()=>w.binding.account};
  const current=(...args)=>{observeCurrent(...args);return launchBindingCurrent(scopePorts,w.binding);};let owner=null,claimAttempted=false,primaryError=null;
  try{
    claimAttempted=true;
    owner=mod.Trial.claim(w.ownerRoot,{approval:w.approval,verifyApproval:()=>true,current});
    const ownerCurrent=(...args)=>{observeCurrent(...args);try{return owner.check()===true;}catch{return false;}};
    const product=mod.product({...scopePorts,settings:{apiKey:'SYNTHETIC_CONFIGURED_ZEP_KEY',baseUrl:w.server.url},current:ownerCurrent,preparedRows:w.binding.members.map(m=>w.hub.history.memoryOutbox.deliveries.get(m.opId))});
    let ioCurrent=ownerCurrent,capability=null;const rawFetch=async(request,init)=>{assert.equal(ioCurrent(),true);const state=owner.summary().state;
      assert.equal(state.attempts.at(-1).outcome,'dispatch_uncertain');const url=new URL(String(request));assert.equal(url.origin,new URL(w.server.url).origin);
      w.HTTP.push({method:init.method,path:url.pathname,kind:url.href===w.profile.origins.answerEndpoint?'model':'zep',attemptId:state.attempts.at(-1).id});return fetch(request,init);};
    const fetchImpl=receivedFetch(w,rawFetch,changeGraph);
    const run=()=>mod.whole({owner,profile:w.profile,scope:w.scope,preparation:w.preparation,current:ownerCurrent,productStep:product.productStep,
      readLocalRoutes:graphIds=>{const routes=product.projectLocalRoutes(graphIds);return project?routes.map((route,i)=>project({graphId:graphIds[i],route,product,owner})):routes;},fetchImpl,verifyReceipt:ack=>product.verifyReceipt(ack),
      record:(kind,value)=>{w.events.push({kind,value});onRecord({kind,value,owner,product,capability});},comparisonPorts:({budget,nativeCapability,current:observedCurrent})=>{
        capability=nativeCapability;ioCurrent=observedCurrent;beforePorts({product,owner,capability});
        return {readPort:mod.ports.createSdkReadPort({ZepClient,baseUrl:w.profile.origins.readBase,apiKey:'SYNTHETIC_CONFIGURED_ZEP_KEY',purpose:'local-fixture',budget,current:observedCurrent,fetchImpl,nativeProject:capability}),
          answerPort:mod.ports.createHttpAnswerPort({endpointUrl:w.profile.origins.answerEndpoint,answerControls:w.profile.manifest.answerControls,purpose:'local-fixture',budget,current:observedCurrent,fetchImpl})};}});
    return await probe({run,owner,product,get capability(){return capability;}});
  }catch(error){
    primaryError=error;
    if(claimAttempted&&owner===null){
      try{w.refuseExternalClaimFailure('external-claim-acquisition-incomplete');}
      catch(refusalError){primaryError=new AggregateError([error,refusalError],'raw_claim_and_refusal_failed');}
    }
    throw primaryError;
  }finally{
    if(owner!==null)try{owner.close();}
    catch(error){
      let closeError=error;
      try{w.refuseExternalClaimFailure('external-claim-close-unconfirmed');}
      catch(refusalError){closeError=new AggregateError([error,refusalError],'raw_close_and_refusal_failed');}
      if(primaryError)throw new AggregateError([primaryError,closeError],'raw_probe_and_close_failed');throw closeError;
    }
  }
}

function pure(mod){
  const roomUuid='11111111-1111-4111-8111-111111111111',namespaceId='22222222-2222-4222-8222-222222222222',graphId='viberoom-'+roomUuid;
  const roomId=`trial:${namespaceId}:${roomUuid}`,accountId='sha256:'+'a'.repeat(64),copyId='synthetic-copy',materializationSha256='b'.repeat(64);
  const member={episodeId:'synthetic-episode',opId:'synthetic-op',sourceId:'synthetic-source',version:'synthetic-version',part:'1/1'};
  const authority={accountId,projectBinding:mod.native.NATIVE_PENDING,graphId,room:'logical',roomUuid,copyId,generationId:'implicit-base:'+graphId,
    routeRevision:'',scopeRevision:materializationSha256,verificationId:materializationSha256,sourceState:'verified-current-authorized',members:[member]};
  const declared=json(authority);delete declared.members;
  const local={schema:mod.native.PROVISIONAL_LOCAL_ROUTE,mode:'unobserved-implicit-base',namespaceId,accountId,graphId,roomId,roomUuid,generationId:authority.generationId,materializationSha256,
    head:{revision:'',route:null,checkedAt:null,reason:null,followPending:false},attachment:null};
  const profile={manifest:{topology:[{graphId,logicalRoom:'logical',variant:'baseline-off-current'}]},payloads:{rows:[{logicalRoom:'logical',variant:'baseline-off-current',members:[{identity:{roomId,roomUuid,copyId}}]}]},
    nativeProject:{provisionalAuthorities:[declared],provisionalLocalRoutes:[local]}};
  const revision='synthetic-observed-data';
  const record={schema:mod.native.OBSERVED_LOCAL_ROUTE,accountId,graphId,roomId,roomUuid,copyId,
    room:{id:roomId,uuid:roomUuid,name:'Pure data room',remembers:true,originalInput:false,account:accountId,graphId:null,generationRevision:revision,generationCheck:false},
    head:{revision,route:{graphId,epoch:0,copy:null},checkedAt:1,reason:null,followPending:false},attachment:{account:accountId,uuid:roomUuid,copy:copyId,revision,graphId,check:false},members:[member]};
  return {record,authority,profile};
}
for(const mod of modules){const control=(id,name,fn)=>test(`${id} ${mod.name}: ${name}`,fn);
  control('OH01','closed pure observed DATA keeps actual revision; identity excludes checkedAt ONLY',()=>{
    const p=pure(mod),n=mod.native;assert.deepEqual(n.validateObservedLocalRoute(p.record,p.authority,p.profile),p.record);
    const changed=json(p.record);changed.head.checkedAt=2;assert.notEqual(n.digest(changed),n.digest(p.record));assert.equal(n.digest(n.localRouteIdentity(changed)),n.digest(n.localRouteIdentity(p.record)));
    const observation={schema:n.NATIVE_OBSERVATION,graphId:p.record.graphId,projectUuid:FIXTURE_PROJECT,localRoute:p.record};
    const resolved=n.resolvedObservedAuthority(p.authority,observation);assert.equal(resolved.routeRevision,p.record.head.revision);assert.equal(p.authority.routeRevision,'');assert.equal(resolved.projectId,FIXTURE_PROJECT);
  });
  control('OH02','finite missing/extra/type/identity/member mutations cannot satisfy observed DATA',()=>{
    const p=pure(mod);const mutations=[r=>{r.extra=true;},r=>{r.schema='old';},r=>{delete r.members;},r=>{r.members=[];},r=>{r.members.push(json(r.members[0]));},
      ...['accountId','graphId','roomId','roomUuid','copyId'].map(k=>r=>{r[k]='';}),
      ...['id','uuid','name','account','generationRevision'].map(k=>r=>{r.room[k]='';}),r=>{r.room.extra=true;},r=>{r.room.remembers=false;},r=>{r.room.originalInput=null;},r=>{r.room.graphId=r.graphId;},r=>{r.room.generationCheck=true;},
      r=>{r.head=null;},r=>{r.head.extra=true;},r=>{r.head.revision='';},r=>{r.head.route=null;},r=>{r.head.route.epoch=1;},r=>{r.head.route.copy='foreign';},r=>{r.head.route.graphId='foreign';},r=>{r.head.route.extra=true;},
      r=>{r.head.checkedAt=null;},r=>{r.head.checkedAt=-1;},r=>{r.head.reason='failed_read';},r=>{r.head.followPending=true;},r=>{r.attachment=null;},r=>{r.attachment.extra=true;},
      ...['account','uuid','copy','revision','graphId'].map(k=>r=>{r.attachment[k]='foreign';}),r=>{r.attachment.check=true;},
      ...['episodeId','opId','sourceId','version','part'].map(k=>r=>{r.members[0][k]='foreign';}),r=>{r.members[0].extra=true;}];
    for(const mutate of mutations){const r=json(p.record);mutate(r);assert.throws(()=>mod.native.validateObservedLocalRoute(r,p.authority,p.profile));}
    for(const k of ['revision','route','reason','followPending']){const r=json(p.record);if(k==='route')r.head.route.copy='changed';else r.head[k]=k==='followPending'?true:'changed';assert.notEqual(mod.native.digest(mod.native.localRouteIdentity(r)),mod.native.digest(mod.native.localRouteIdentity(p.record)));}
  });
  control('OH03','initialized declaration-v3 DATA requires exact existing revision and never an empty fallback',()=>{
    const p=pure(mod);p.authority.routeRevision=p.record.head.revision;p.profile.nativeProject.provisionalAuthorities[0].routeRevision=p.record.head.revision;p.profile.nativeProject.provisionalLocalRoutes=[];
    assert.deepEqual(mod.native.validateObservedLocalRoute(p.record,p.authority,p.profile),p.record);
    const changed=json(p.record);changed.head.revision='different';changed.room.generationRevision='different';changed.attachment.revision='different';
    assert.throws(()=>mod.native.validateObservedLocalRoute(changed,p.authority,p.profile),/native_initialized_route_revision_changed/);
    changed.head.revision='';assert.throws(()=>mod.native.validateObservedLocalRoute(changed,p.authority,p.profile));
  });
  control('OH04','actual private fresh 34 ACK/20 T0/final/T1 joins actual nonempty head+attachment, public substitutions unused',async t=>{
    const w=await world(t,mod);let substitutions=0;const fake=()=>{substitutions++;throw Error('public_projection_must_not_run');};
    const before=sqliteTotalChanges(w.hub.history.db);mod.native.validateNativeDeclaration(w.profile);
    assert.ok(w.profile.nativeProject.provisionalAuthorities.every(a=>a.routeRevision===''));assert.ok(w.profile.nativeProject.provisionalLocalRoutes.every(r=>r.head.revision===''));
    assert.equal(sqliteTotalChanges(w.hub.history.db),before);assert.equal(w.HTTP.length,0);assert.equal(w.answerCopies.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
    const result=await w.launch({fetchImpl:receivedFetch(w),readLocalRoute:fake,readLocalRoutes:fake,localRouteProjection:fake,productStep:fake});assert.equal(substitutions,0);
    const state=RunJournal.inspect(w.ownerRoot),set=saved(w,'native-project-binding-set');assert.ok(set);assert.equal(set.schema,mod.native.NATIVE_BINDING_SET);
    assert.equal(saved(w,'ingestion-acks').episodes.length,34);assert.equal(set.observations.length,20);assert.equal(result.observations.filter(o=>o.phase==='T0').length,20);assert.equal(result.observations.filter(o=>o.phase==='T1').length,20);
    for(const o of set.observations){const observation=saved(w,'project-observation:'+o.graphId),r=w.rooms.find(r=>r.uuid===observation.localRoute.roomUuid),head=w.hub.history.memoryOutbox.generations.head(namespace(w,r));
      assert.equal(observation.schema,mod.native.NATIVE_OBSERVATION);assert.equal(observation.localRoute.head.revision,head.revision);assert.ok(head.revision.length);assert.equal(attachment(w,r).revision,head.revision);
      assert.equal(mod.native.digest(observation),o.observationSha256);const authority=mod.native.resolvedObservedAuthority(w.profile.nativeProject.provisionalAuthorities.find(a=>a.graphId===o.graphId),observation);
      assert.equal(authority.routeRevision,head.revision);const a=state.state.attempts.find(a=>a.id===observation.durableAttemptId);assert.equal(a.outcome,'received');assert.equal(a.status,200);
      assert.equal(authority.routeRevision===authority.projectId,false);assert.equal(authority.routeRevision===mod.native.digest(authority),false);
    }
    assert.equal(w.events.filter(e=>e.kind==='native-handoff').length,1);assert.equal(w.events.filter(e=>e.kind==='finish').length,1);assert.equal(w.answerCopies.length,1);assertNoFixtureSecrets(w,{state,result});
    const prior=canonical(state),HTTP=w.HTTP.length;await assert.rejects(w.launch());assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),prior);assert.equal(w.HTTP.length,HTTP);
  });
  control('OH05','actual current DTO/request forwarding and trusted projection re-read without extra SQL/HTTP/keys/admission',async t=>{
    const w=await world(t,mod);let calls=0,reads=0,entryGuards=0,finalGuards=0,requestGuards=0,claim=null;
    await owned(t,w,mod,{observeCurrent:(...args)=>{
      if(args.length===1&&args[0]?.manifestSha256!==undefined){const dto=args[0];
        assert.deepEqual(Object.keys(dto).sort(),['authorities','manifestSha256','permit']);
        assert.equal(dto.manifestSha256,mod.native.digest(w.profile.manifest));assert.equal(dto.permit.manifestSha256,dto.manifestSha256);
        assert.equal(dto.permit.ownerClaimId,claim);assert.equal(dto.authorities.length,w.profile.manifest.topology.length);
        if(dto.permit.schema===mod.native.NATIVE_ENTRY){assert.equal(mod.native.digest(dto.authorities),dto.permit.provisionalAuthoritySha256);entryGuards++;}
        else{assert.equal(dto.permit.schema,mod.native.NATIVE_FINAL);assert.equal(mod.native.digest(dto.authorities),dto.permit.currentAuthoritySha256);finalGuards++;}
      }else if(args.length===1&&args[0]?.method!==undefined){const request=args[0];
        assert.deepEqual(Object.keys(request).sort(),['body','maxRetries','method','url']);assert.equal(request.maxRetries,0);
        assert.equal(new URL(request.url).origin,new URL(w.server.url).origin);requestGuards++;
      }
    },project:({route})=>{calls++;return route;},beforePorts:({product,owner,capability})=>{
      claim=owner.summary().state.run.claim;
      const before=sqliteTotalChanges(w.hub.history.db),state=canonical(owner.summary()),HTTP=w.HTTP.length,keys=w.answerCopies.length;
      for(const a of w.profile.nativeProject.provisionalAuthorities){const p=product.readLocalRoute(a.graphId);assert.ok(p.head.revision);assert.equal(p.members.length,a.members?.length??w.scope.members.filter(m=>m.graphId===a.graphId).length);reads++;}
      const callStart=calls;assert.equal(owner.check(),true);assert.equal(capability.routesCurrent(),true);assert.equal(owner.check(),true);assert.equal(capability.routesCurrent(),true);assert.ok(calls>=callStart+40);
      assert.equal(sqliteTotalChanges(w.hub.history.db),before);assert.equal(canonical(owner.summary()),state);assert.equal(w.HTTP.length,HTTP);assert.equal(w.answerCopies.length,keys);
    }},async({run})=>{const result=await run();assert.equal(result.status,'captured-unjudged');});assert.equal(reads,20);assert.ok(calls>40);
    assert.ok(entryGuards>0&&finalGuards>0&&requestGuards>0,'genuine_D3_entry_final_and_port_current_arguments_required');
  });
  control('OH06','genuine checkedAt-only refresh preserves original saved T0 timestamp/digest and final current',async t=>{
    const w=await world(t,mod);let observed=null,refresh=null;const result=await w.launch({fetchImpl:receivedFetch(w),record:(kind,value)=>{
      w.events.push({kind,value});if(kind==='observation'&&value.phase==='T0'&&observed===null){observed=saved(w,'project-observation:'+value.graphId);assert.ok(observed);
        const r=w.rooms.find(r=>r.uuid===observed.localRoute.roomUuid),head=observed.localRoute.head;
        refresh=w.hub.history.memoryOutbox.generations.observe(namespace(w,r),head.route,head.checkedAt+1);assert.equal(refresh.revision,head.revision);assert.notEqual(refresh.checkedAt,head.checkedAt);}
    }});assert.equal(result.status,'captured-unjudged');assert.ok(observed&&refresh);assert.equal(canonical(saved(w,'project-observation:'+observed.graphId)),canonical(observed));
    assert.equal(w.events.filter(e=>e.kind==='finish').length,1);
  });
  control('OH07','cached actual loaded preparation exposes no observed route capability',async t=>{
    const w=await world(t,mod),context=w.hub.memoryTrialAccountContext(w.selection),provider=context.preparation();assert.ok(provider);
    const before=sqliteTotalChanges(w.hub.history.db),cached=mod.product({history:w.hub.history,preparationProvider:provider,rooms:w.rooms,current:()=>w.source.current(),cap:()=>context.snapshot()?.cap});
    for(const name of ['readLocalRoute','readLocalRoutes','projectLocalRoutes'])assert.equal(Object.hasOwn(cached,name),false);assert.equal(sqliteTotalChanges(w.hub.history.db),before);assert.equal(w.HTTP.length,0);assert.equal(w.answerCopies.length,0);
  });
  control('OH21','one native check asks the trial current once; the routes alone are refused outside the owner check',async t=>{
    const w=await world(t,mod),graphs=w.profile.manifest.topology.length,marker='OH21 counted';
    let counting=false,asks=0,routesAsks=null,checkAsks=null,repeatedRouteReads=null,withoutCheck=null,afterAwait=null;
    const messages=error=>error?[error.message,...(error.errors??[]).flatMap(messages)]:[];
    await assert.rejects(owned(t,w,mod,{observeCurrent:()=>{if(counting)asks++;},beforePorts:({capability,product,owner})=>{
      try{capability.routesCurrent();withoutCheck='no refusal';}catch(error){withoutCheck=error.message;}
      counting=true;asks=0;try{assert.equal(owner.check(),true);checkAsks=asks;assert.equal(capability.routesCurrent(),true);routesAsks=asks-checkAsks;}finally{counting=false;}
      const routeReads=product.routeComputations();
      for(let n=0;n<5;n++){assert.equal(owner.check(),true);assert.equal(capability.routesCurrent(),true);}
      repeatedRouteReads=product.routeComputations()-routeReads;
      assert.equal(owner.check(),true);Promise.resolve().then(()=>{try{capability.routesCurrent();afterAwait='no refusal';}catch(error){afterAwait=error.message;}});
      throw new Error(marker);
    }},async({run})=>run()),error=>{assert.ok(messages(error).includes(marker),messages(error).join(' | '));return true;});
    t.diagnostic(`one owner check asked the trial current ${checkAsks} time(s); the routes after it ${routesAsks}`);
    assert.equal(withoutCheck,'native_routes_without_owner_check','the routes alone are not a current check');
    assert.equal(afterAwait,'native_routes_without_owner_check','an await closes the owner check\'s section');
    assert.equal(checkAsks,1);assert.equal(routesAsks,0,`the routes of ${graphs} graphs ask the trial current nothing`);
    assert.equal(repeatedRouteReads,0,'five more checks with nothing written read no route row');
  });
  for(const [suffix,mutate] of [
    ['source',(w,r)=>{const row=w.source.rows().find(row=>row.identity.roomId===r.id),s=w.hub.history.getById(r.id,row.identity.sourceId);w.hub.history.upsert(r.id,{...s,text:s.text+' changed'});} ],
    ['room',(w,r)=>{r.name+=' changed';}],['account',(w,r)=>{r.account='sha256:'+'f'.repeat(64);} ],
    ['head-failedRead',(w,r)=>w.hub.history.memoryOutbox.generations.failedRead(namespace(w,r),'generation_read_failed',Date.now())],
    ['foreign-generation',(w,r)=>{const copy=attachment(w,r).copy;w.hub.history.memoryOutbox.generations.observe(namespace(w,r),{graphId:newGenerationId(r.uuid,copy),epoch:1,copy},Date.now());}],
    ['attachment-revision',(w,r)=>changeAttachment(w,r,a=>{a.revision='foreign';})],['attachment-copy',(w,r)=>changeAttachment(w,r,a=>{a.copy='foreign';})],
    ['attachment-uuid',(w,r)=>changeAttachment(w,r,a=>{a.uuid='22222222-2222-4222-8222-222222222222';})],['attachment-account',(w,r)=>changeAttachment(w,r,a=>{a.account='sha256:'+'f'.repeat(64);})],
    ['attachment-check',(w,r)=>changeAttachment(w,r,a=>{a.check=true;})],
  ])control('OH08-'+suffix,'actual T0 route/source/room/account/attachment drift blocks further HTTP before retrieval',async t=>{
    const w=await world(t,mod);let mutated=false,HTTP=null;let result,error;
    try{result=await w.launch({fetchImpl:receivedFetch(w),record:(kind,value)=>{w.events.push({kind,value});if(!mutated&&kind==='observation'&&value.phase==='T0'){
      const o=saved(w,'project-observation:'+value.graphId);assert.ok(o);const r=w.rooms.find(r=>r.uuid===o.localRoute.roomUuid);HTTP=w.HTTP.length;mutate(w,r);mutated=true;}}});}catch(e){error=e;}
    assert.ok(mutated);assert.ok(error||result?.status==='held');assert.equal(w.HTTP.length,HTTP);assert.equal(saved(w,'native-project-binding-set'),null);noRetrieval(w);stopped(w);
  });
  control('OH09','actual FINAL attachment revision drift blocks first retrieval/model while preserving final set',async t=>{
    const w=await world(t,mod);let setBefore=null,HTTP=null;const result=await w.launch({fetchImpl:receivedFetch(w),record:(kind,value)=>{
      w.events.push({kind,value});if(kind==='native-handoff'){setBefore=canonical(saved(w,'native-project-binding-set'));HTTP=w.HTTP.length;changeAttachment(w,w.rooms[0],a=>{a.revision='foreign';});}
    }});assert.equal(result.status,'held');assert.ok(setBefore);assert.equal(canonical(saved(w,'native-project-binding-set')),setBefore);assert.equal(w.HTTP.length,HTTP);noRetrieval(w);stopped(w);
  });
  control('OH10','actual T1 Graph foreign pointer refuses without rewriting complete T0 set',async t=>{
    const w=await world(t,mod);let changed=false,setBefore=null;const result=await w.launch({fetchImpl:receivedFetch(w,w.fetchImpl,({body,graphId})=>{
      const set=saved(w,'native-project-binding-set');if(set&&!changed){setBefore=canonical(set);const r=w.rooms.find(r=>`viberoom-${r.uuid}`===graphId),copy=attachment(w,r).copy;
        body.description=generationPointer(r.uuid,{graphId:newGenerationId(r.uuid,copy),epoch:1,copy});changed=true;}
    })});assert.ok(changed);assert.equal(result.status,'held');assert.equal(canonical(saved(w,'native-project-binding-set')),setBefore);stopped(w);
  });
  for(const [suffix,description] of [['empty',''],['plain','ordinary graph description'],['missing',undefined],['malformed','{'],['nonbase','foreign-pointer']])
    control('OH11-'+suffix,'actual SDK Graph description joins the actual pointer parser semantics',async t=>{
      const w=await world(t,mod);let first=true;const result=await w.launch({fetchImpl:receivedFetch(w,w.fetchImpl,({body,graphId})=>{
        if(description==='foreign-pointer'){if(saved(w,'ingestion-acks')&&first){const r=w.rooms.find(r=>`viberoom-${r.uuid}`===graphId),copy=attachment(w,r).copy;body.description=generationPointer(r.uuid,{graphId:newGenerationId(r.uuid,copy),epoch:1,copy});first=false;}}
        else if(description==='{'){if(saved(w,'ingestion-acks'))body.description=description;}
        else if(description===undefined)delete body.description;else body.description=description;
      })});
      if(['malformed','nonbase'].includes(suffix)){assert.equal(result.status,'held');assert.equal(saved(w,'native-project-binding-set'),null);noRetrieval(w);}else{assert.equal(result.status,'captured-unjudged');assert.equal(saved(w,'native-project-binding-set').observations.length,20);}
    });
  control('OH12','mutated saved T0 observation cannot supply resolve/complete/final authority',async t=>{
    const w=await world(t,mod);let changed=false,HTTP=null;const result=await w.launch({fetchImpl:receivedFetch(w),record:(kind,value)=>{
      w.events.push({kind,value});if(!changed&&kind==='observation'&&value.phase==='T0'){HTTP=w.HTTP.length;changeBinding(w,'project-observation:'+value.graphId,o=>{
        o.localRoute.head.checkedAt++;o.localRouteIdentitySha256=mod.native.digest(mod.native.localRouteIdentity(o.localRoute));});changed=true;}
    }});assert.ok(changed);assert.equal(result.status,'held');assert.equal(w.HTTP.length,HTTP);assert.equal(saved(w,'native-project-binding-set'),null);noRetrieval(w);stopped(w);
  });
  control('OH13','trusted RAW substituted member projection refuses; private public override separately remains unavailable',async t=>{
    const w=await world(t,mod);let changed=false;await owned(t,w,mod,{project:({route:r})=>{r.members[0].episodeId='foreign-receipt';changed=true;return r;}},async({run})=>{
      await assert.rejects(run());assert.equal(saved(w,'native-project-binding-set'),null);noRetrieval(w);stopped(w);
    });assert.ok(changed);assert.equal(RunJournal.inspect(w.ownerRoot).state.bindings.filter(b=>b.name.startsWith('project-observation:')).length,0);
  });
  control('OH14','same existing owner refuses premature T0 resolve and direct admission after native revocation',async t=>{
    const w=await world(t,mod);await owned(t,w,mod,{beforePorts:({capability})=>assert.throws(()=>capability.resolveT0(w.profile.manifest.topology[0].graphId),/native_saved_observation_changed/)},async({run,owner})=>{
      const result=await run();assert.equal(result.status,'held');assert.equal(saved(w,'native-project-binding-set'),null);noRetrieval(w);stopped(w);
      const p=w.profile.writePermits[0];assert.throws(()=>owner.admitWrite(p.id,p.request));
    });
  });
  control('OH15','actual received owned T0 attempt cannot be replayed into a second saved observation',async t=>{
    const w=await world(t,mod);let replayed=false,HTTP=null;await owned(t,w,mod,{onRecord:({kind,value,owner,capability})=>{
      if(!replayed&&kind==='observation'&&value.phase==='T0'){
        const o=saved(w,'project-observation:'+value.graphId),a=owner.summary().state.attempts.find(a=>a.id===o.durableAttemptId);assert.ok(a);HTTP=w.HTTP.length;
        assert.throws(()=>capability.T0.captureGraph({graphId:o.graphId,attemptNumber:o.budgetAttemptNumber,raw:JSON.parse(a.capture).raw,
          capture:{row:value.raw.graph,layout:value.raw.sdkGraphLayout}}),/native_T0_graph_repeated/);replayed=true;
      }
    }},async({run})=>{const result=await run();assert.equal(result.status,'held');});assert.ok(replayed);assert.equal(w.HTTP.length,HTTP);
    assert.equal(RunJournal.inspect(w.ownerRoot).state.bindings.filter(b=>b.name.startsWith('project-observation:')).length,1);noRetrieval(w);stopped(w);
  });
  control('OH16','complete binding-set mutation refuses final current without reconstructing trusted observation pins',async t=>{
    const w=await world(t,mod);let mutated=false,HTTP=null;const result=await w.launch({fetchImpl:receivedFetch(w),record:(kind,value)=>{
      w.events.push({kind,value});if(kind==='native-handoff'){HTTP=w.HTTP.length;changeBinding(w,'native-project-binding-set',set=>{set.observations[0].observationSha256='f'.repeat(64);});mutated=true;}
    }});assert.ok(mutated);assert.equal(result.status,'held');assert.equal(w.HTTP.length,HTTP);noRetrieval(w);stopped(w);
  });
  control('OH17','failed observation save and failed terminal SQL retain stopped-unknown evidence and revoke same owner',async t=>{
    const w=await world(t,mod),db=new DatabaseSync(path.join(w.ownerRoot,'trial-journal.sqlite'));
    try{db.exec("CREATE TRIGGER observed_save_refused BEFORE INSERT ON bindings WHEN new.name LIKE 'project-observation:%' BEGIN SELECT RAISE(ABORT,'synthetic binding refusal'); END; CREATE TRIGGER observed_stop_refused BEFORE UPDATE OF stopped ON run WHEN new.stopped IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic stop refusal'); END;");}finally{db.close();}
    await owned(t,w,mod,{},async({run,owner})=>{
      await assert.rejects(run());assert.equal(saved(w,'native-project-binding-set'),null);assert.equal(owner.summary().state.run.stopped,null);noRetrieval(w);
      const before=w.HTTP.length,p=w.profile.writePermits[0];assert.throws(()=>owner.admitWrite(p.id,p.request));assert.equal(w.HTTP.length,before);
    });
  });
  control('OH18','actual credential-entry current loss prevents clients/HTTP and stops original claim owner',async t=>{
    const w=await world(t,mod);w.onAnswerCopy=()=>{w.rooms[0].name+=' changed at actual getter';};
    await assert.rejects(w.launch({fetchImpl:receivedFetch(w)}));assert.equal(w.answerCopies.length,1);
    assert.ok(w.answerCopies[0].claim);assert.equal(w.answerCopies[0].attempts,0);assert.equal(w.HTTP.length,0);stopped(w);
    assert.equal(saved(w,'native-project-binding-set'),null);assert.equal(RunJournal.inspect(w.ownerRoot).state.attempts.length,0);
  });
  control('OH19','actual initialized declaration-v3 retains genuine preclaim head revision exactly through ingestion/T0/T1',async t=>{
    const w=await world(t,mod,{initialized:true}),initial=new Map(w.profile.nativeProject.provisionalAuthorities.map(a=>[a.graphId,a.routeRevision]));
    assert.equal(w.profile.nativeProject.provisionalLocalRoutes.length,0);assert.ok([...initial.values()].every(value=>value.length));
    assert.equal(w.answerCopies.length,0);assert.equal(w.HTTP.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
    const result=await w.launch({fetchImpl:receivedFetch(w)});assert.equal(result.status,'captured-unjudged');
    for(const a of w.profile.nativeProject.provisionalAuthorities){const observation=saved(w,'project-observation:'+a.graphId),r=w.rooms.find(r=>r.uuid===a.roomUuid);
      assert.equal(observation.localRoute.head.revision,initial.get(a.graphId));assert.equal(attachment(w,r).revision,initial.get(a.graphId));assert.equal(mod.native.resolvedObservedAuthority(a,observation).routeRevision,initial.get(a.graphId));}
    assert.equal(w.events.filter(e=>e.kind==='finish').length,1);
  });
  control('OH20','actual T1 local head loss cannot grant a second Graph read or rewrite original T0 set',async t=>{
    const w=await world(t,mod);let changed=false,HTTP=null,setBefore=null;const result=await w.launch({fetchImpl:receivedFetch(w),record:(kind,value)=>{
      w.events.push({kind,value});if(!changed&&kind==='observation'&&value.phase==='T1'){
        setBefore=canonical(saved(w,'native-project-binding-set'));HTTP=w.HTTP.length;const r=w.rooms.find(r=>`viberoom-${r.uuid}`===value.graphId);
        w.hub.history.memoryOutbox.generations.failedRead(namespace(w,r),'generation_read_failed',Date.now());changed=true;}
    }});assert.ok(changed);assert.equal(result.status,'held');assert.equal(w.HTTP.length,HTTP);assert.equal(canonical(saved(w,'native-project-binding-set')),setBefore);stopped(w);
  });
}
