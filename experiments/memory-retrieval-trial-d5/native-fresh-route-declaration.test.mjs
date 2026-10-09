// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import * as experiment from './native-project.mjs';
import * as privateNative from '../../private-trial/memory-retrieval-trial-d5/native-project.mjs';
import {createConfiguredNativeCaller as experimentCaller} from './configured-native-caller.mjs';
import {createConfiguredNativeCaller as privateCaller} from '../../private-trial/memory-retrieval-trial-d5/configured-native-caller.mjs';
import {configuredHubWorld,assertNoFixtureSecrets} from './configured-hub-fixture.mjs';
import {canonical,json} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';
import {sqliteTotalChanges} from '../../dist/memory/sql-read-only-fence.js';
import {zepGraphId} from '../../dist/memory/zep-payload.js';
import {newGenerationId} from '../../dist/memory/graph-generations.js';
import {launchBindingCurrent} from './private-launch.mjs';

const modules=[{name:'experiment',native:experiment,caller:experimentCaller},{name:'private',native:privateNative,caller:privateCaller}];
const unobserved=()=>({revision:'',route:null,checkedAt:null,reason:null,followPending:false});
function ordinaryData(mod){
  const namespaceId='22222222-2222-4222-8222-222222222222',materializationSha256='c'.repeat(64);
  const account={accountId:'sha256:'+'a'.repeat(64),readBase:'http://127.0.0.1:49999/v2',revision:'sha256:'+'b'.repeat(64),projectBinding:json(mod.NATIVE_PENDING)};
  const rooms=Array.from({length:20},(_,i)=>{const uuid='11111111-1111-4111-8111-'+String(i+1).padStart(12,'0');return {id:`trial:${namespaceId}:${uuid}`,uuid,account:account.accountId};});
  const topology=rooms.map((r,i)=>({graphId:zepGraphId(r.uuid),logicalRoom:'room-'+i,roomUuid:r.uuid,variant:'baseline'}));
  const authorities=topology.map((g,i)=>({accountId:account.accountId,projectId:'LOCAL_UNVERIFIED_PROJECT',graphId:g.graphId,room:g.logicalRoom,roomUuid:g.roomUuid,copyId:'copy-'+i,
    generationId:'implicit-base:'+g.graphId,routeRevision:'',scopeRevision:materializationSha256,verificationId:materializationSha256,sourceState:'verified-current-authorized'}));
  const profile={schema:'viberoom-retrieval-long-trial-profile-v1',origins:{readBase:account.readBase},manifest:{topology},
    payloads:{rows:topology.map((g,i)=>({logicalRoom:g.logicalRoom,variant:g.variant,members:[{identity:{roomId:rooms[i].id,roomUuid:rooms[i].uuid,copyId:authorities[i].copyId}}]}))},review:{}};
  const scope={evidence:{privateNamespace:{schema:'same-hub-private-trial-source-v1',namespaceId,materialization:{sha256:materializationSha256}}},graphs:authorities.map(a=>({graphId:a.graphId,authority:a}))};
  const context={namespaceId,rooms,routes:rooms.map(r=>({roomId:r.id,head:unobserved(),attachment:null}))};
  return {prepared:{profile,scope,preparation:{}},account,context};
}
function rehash(mod,profile){
  const n=profile.nativeProject;n.accountScopeSha256=mod.digest({account:n.account,scopeIdentitySha256:n.scopeIdentitySha256,provisionalAuthorities:n.provisionalAuthorities,provisionalLocalRoutes:n.provisionalLocalRoutes});
}
async function sameHub(t,mod){
  return configuredHubWorld(t,{isolated:true,nativeProject:true,ordinaryModel:'',callerFactory:async w=>{
    w.caller=mod.caller({hub:w.hub,selection:w.selection,source:w.source});
    w.localPrepared=json(w.prepared);
    const before=sqliteTotalChanges(w.hub.history.db),rows=canonical(w.source.rows());
    const heads=w.rooms??w.source.rooms;
    w.localHeads=heads.map(r=>({uuid:r.uuid,head:w.hub.history.memoryOutbox.generations.head({provider:'zep',account:w.accountId??r.account,uuid:r.uuid})}));
    assert.equal(fs.existsSync(path.join(w.ownerRoot,'trial-journal.sqlite')),false,'native prepare occurs before any journal/card/claim');
    w.prepared=w.caller.prepare(w.prepared);
    assert.equal(sqliteTotalChanges(w.hub.history.db),before);assert.equal(canonical(w.source.rows()),rows);
    assert.equal(w.HTTP.length,0);assert.equal(w.answerCopies.length,0);
    assert.equal(fs.existsSync(path.join(w.ownerRoot,'trial-journal.sqlite')),false);
  }});
}
for(const mod of modules){
  const control=(id,name,body)=>test(`${mod.name} ${id} ${name}`,{concurrency:false},body);
  control('FR01','closed provisional-local DATA preserves exact empty head without mutating local authority',()=>{
    const input=ordinaryData(mod.native),before=canonical(input),prepared=mod.native.prepareNativeProductProfile(input.prepared,input.account,input.context);
    assert.equal(canonical(input),before);assert.equal(prepared.profile.nativeProject.schema,mod.native.NATIVE_DECLARATION);
    const n=mod.native.validateNativeDeclaration(prepared.profile);assert.equal(n.provisionalLocalRoutes.length,20);
    for(const [i,a] of n.provisionalAuthorities.entries()){
      assert.equal(a.routeRevision,'');assert.equal(a.generationId,'implicit-base:'+a.graphId);
      assert.equal(canonical(n.provisionalLocalRoutes[i].head),canonical(input.context.routes[i].head));
      assert.equal(n.provisionalLocalRoutes[i].schema,mod.native.PROVISIONAL_LOCAL_ROUTE);assert.equal(n.provisionalLocalRoutes[i].mode,'unobserved-implicit-base');
      assert.equal(Object.hasOwn(a,'projectId'),false);assert.deepEqual(a.projectBinding,mod.native.NATIVE_PENDING);
    }
    assert.throws(()=>mod.native.prepareNativeProductProfile(input.prepared,input.account),/native_provisional_local_route_context_required/);
  });
  control('FR02','finite mismatched/initialized/malformed local route DATA cannot justify empty revision',()=>{
    const input=ordinaryData(mod.native),prepared=mod.native.prepareNativeProductProfile(input.prepared,input.account,input.context);
    const changes=[
      n=>{n.provisionalLocalRoutes=[];},n=>{n.provisionalLocalRoutes[1]=json(n.provisionalLocalRoutes[0]);},
      n=>{n.provisionalLocalRoutes[0].extra=true;},n=>{n.provisionalLocalRoutes[0].mode='initialized-route';},
      n=>{n.provisionalLocalRoutes[0].graphId='viberoom-foreign';},n=>{n.provisionalLocalRoutes[0].generationId='implicit-base:foreign';},
      n=>{n.provisionalAuthorities[0].generationId='ordinary-initialized-generation';},
      n=>{n.provisionalLocalRoutes[0].roomUuid=n.provisionalLocalRoutes[1].roomUuid;},
      n=>{n.provisionalLocalRoutes[0].roomId=n.provisionalLocalRoutes[1].roomId;},
      n=>{n.provisionalLocalRoutes[0].namespaceId='33333333-3333-4333-8333-333333333333';},
      n=>{n.provisionalLocalRoutes[0].accountId='sha256:'+'d'.repeat(64);},
      n=>{n.provisionalLocalRoutes[0].materializationSha256='d'.repeat(64);},
      n=>{delete n.provisionalLocalRoutes[0].head.checkedAt;},
      n=>{n.provisionalLocalRoutes[0].head.revision='synthetic-initialized-data-mutation';},
      n=>{n.provisionalLocalRoutes[0].head.checkedAt=1;},
      n=>{n.provisionalLocalRoutes[0].head.route={graphId:n.provisionalAuthorities[0].graphId,epoch:0,copy:null};},
      n=>{n.provisionalLocalRoutes[0].head.reason='generation_read_failed';},
      n=>{n.provisionalLocalRoutes[0].head.followPending=true;},
      n=>{n.provisionalLocalRoutes[0].attachment={};},
      n=>{n.provisionalAuthorities[0].routeRevision='synthetic-nonempty-data-mutation';},
    ];
    for(const change of changes){const p=json(prepared.profile);change(p.nativeProject);rehash(mod.native,p);assert.throws(()=>mod.native.validateNativeDeclaration(p));}
    for(const change of [c=>{c.routes[0].head.checkedAt=1;},c=>{c.routes[0].head.route={graphId:'viberoom-foreign',epoch:0,copy:null};},c=>{c.rooms[0].account='sha256:'+'d'.repeat(64);},c=>{c.routes[0].roomId=c.routes[1].roomId;},c=>{c.namespaceId='33333333-3333-4333-8333-333333333333';}]){
      const modified=json(input);change(modified.context);assert.throws(()=>mod.native.prepareNativeProductProfile(modified.prepared,modified.account,modified.context));
    }
  });
  control('FR03','every ordinary identity/account field remains nonempty despite local empty route',()=>{
    const input=ordinaryData(mod.native),prepared=mod.native.prepareNativeProductProfile(input.prepared,input.account,input.context);
    for(const key of ['accountId','graphId','room','roomUuid','copyId','generationId','scopeRevision','verificationId']){
      const p=json(prepared.profile);p.nativeProject.provisionalAuthorities[0][key]='';rehash(mod.native,p);assert.throws(()=>mod.native.validateNativeDeclaration(p));
    }
    for(const key of ['accountId','readBase','revision']){const p=json(prepared.profile);p.nativeProject.account[key]='';rehash(mod.native,p);assert.throws(()=>mod.native.validateNativeDeclaration(p));}
    for(const value of [null,undefined,false,{},0]){
      const p=json(prepared.profile);p.nativeProject.provisionalAuthorities[0].routeRevision=value;
      assert.throws(()=>{rehash(mod.native,p);mod.native.validateNativeDeclaration(p);});
    }
    const p=json(prepared.profile);p.nativeProject.provisionalAuthorities[0].projectBinding.projectId='synthetic-project-mutation';rehash(mod.native,p);assert.throws(()=>mod.native.validateNativeDeclaration(p));
  });
  control('FR04','ordinary nonempty initialized-revision DATA stays distinct from unobserved local records',()=>{
    const input=ordinaryData(mod.native);
    for(const graph of input.prepared.scope.graphs){graph.authority.routeRevision='synthetic-ordinary-initialized-data';graph.authority.generationId='synthetic-ordinary-generation-data';}
    const prepared=mod.native.prepareNativeProductProfile(input.prepared,input.account);assert.deepEqual(prepared.profile.nativeProject.provisionalLocalRoutes,[]);
    assert.equal(mod.native.validateNativeDeclaration(prepared.profile).schema,mod.native.NATIVE_DECLARATION);
    const p=json(prepared.profile);p.nativeProject.provisionalAuthorities[0].routeRevision='';rehash(mod.native,p);assert.throws(()=>mod.native.validateNativeDeclaration(p),/native_empty_route_requires_local_declaration/);
    const legacy=json(prepared.profile);legacy.nativeProject.schema='viberoom-native-project-declaration-v2';assert.throws(()=>mod.native.validateNativeDeclaration(legacy));
  });
  control('FR05','actual SAME Hub absent head/declaration join has zero preparation SQL/key/HTTP/claim work',async t=>{
    const w=await sameHub(t,mod),before=sqliteTotalChanges(w.hub.history.db),n=mod.native.validateNativeDeclaration(w.profile);
    assert.equal(n.provisionalLocalRoutes.length,20);
    for(const r of n.provisionalLocalRoutes){
      const actual=w.hub.history.memoryOutbox.generations.head({provider:'zep',account:w.accountId,uuid:r.roomUuid});
      assert.equal(canonical(actual),canonical(unobserved()));assert.equal(canonical(r.head),canonical(actual));
      assert.equal(canonical(w.localHeads.find(h=>h.uuid===r.roomUuid).head),canonical(actual));
      const a=w.localPrepared.scope.graphs.find(g=>g.graphId===r.graphId).authority;assert.equal(a.routeRevision,actual.revision);assert.equal(actual.revision,'');
      assert.equal(r.roomId,w.source.rooms.find(room=>room.uuid===r.roomUuid).id);assert.equal(r.accountId,w.accountId);
    }
    const tampered=json(w.profile);tampered.nativeProject.provisionalLocalRoutes[0].head.checkedAt=1;rehash(mod.native,tampered);
    assert.throws(()=>w.caller.capture(tampered,w.scope),'actual public caller also validates the closed declaration');
    assert.equal(sqliteTotalChanges(w.hub.history.db),before);assert.equal(w.answerCopies.length,0);assert.equal(w.HTTP.length,0);
    assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);assert.deepEqual(w.profile.nativeProject.account.projectBinding,mod.native.NATIVE_PENDING);
    assertNoFixtureSecrets(w,{profile:w.profile,scope:w.scope,binding:w.binding});assert.equal(w.scope.actualD,'NOT_RUN');assert.equal(w.scope.liveAuthority,false);
  });
  control('FR06','genuine local head initialization cannot be relabelled as the prior absent route',async t=>{
    const w=await sameHub(t,mod),a=w.localPrepared.scope.graphs[0].authority,namespace={provider:'zep',account:w.accountId,uuid:a.roomUuid};
    const initialized=w.hub.history.memoryOutbox.generations.observe(namespace,{graphId:a.graphId,epoch:0,copy:null},Date.now());
    assert.equal(typeof initialized.revision,'string');assert.ok(initialized.revision.length>0);assert.ok(initialized.checkedAt!==null);assert.equal(initialized.route.graphId,a.graphId);
    const before=sqliteTotalChanges(w.hub.history.db),head=canonical(initialized);
    assert.throws(()=>w.caller.prepare(w.localPrepared));
    assert.equal(sqliteTotalChanges(w.hub.history.db),before);assert.equal(canonical(w.hub.history.memoryOutbox.generations.head(namespace)),head);
    assert.equal(w.HTTP.length,0);assert.equal(w.answerCopies.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
  });
  control('FR07','actual foreign initialized route/current drift refuses existing binding before claim',async t=>{
    const w=await sameHub(t,mod),a=w.localPrepared.scope.graphs[0].authority,namespace={provider:'zep',account:w.accountId,uuid:a.roomUuid};
    const ports={history:w.hub.history,rooms:w.source.rooms,current:()=>w.source.current(),cap:()=>w.hub.memoryTrialAccountContext(w.selection).snapshot()?.cap,accountSnapshot:()=>w.profile.nativeProject.account};
    assert.equal(launchBindingCurrent(ports,w.binding,{beforeClaim:true}),true);
    const graphId=newGenerationId(a.roomUuid,a.copyId);w.hub.history.memoryOutbox.generations.observe(namespace,{graphId,epoch:1,copy:a.copyId},Date.now());
    assert.equal(launchBindingCurrent(ports,w.binding,{beforeClaim:true}),false);assert.throws(()=>w.caller.capture(w.profile,w.scope));
    assert.equal(w.HTTP.length,0);assert.equal(w.answerCopies.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
  });
}
