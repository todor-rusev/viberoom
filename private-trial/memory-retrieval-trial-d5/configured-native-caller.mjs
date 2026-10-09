// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {canonical,json,encode,sha256,Held} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {captureLaunchBinding,bindLaunchProfile,launchPrivateTrial} from './private-launch.mjs';
import {configuredCredentialClosure} from './configured-caller.mjs';
import {ChangeTokenCache} from '../../dist/memory/change-token-cache.js';
import {refusalAsNo} from '../trial-journal/policy-assert.mjs';
import {NATIVE_PROFILE,NATIVE_PENDING,prepareNativeProductProfile,validateNativeDeclaration,digest} from './native-project.mjs';
const require=condition=>{if(!condition)throw new Held('configured_native_contract_refused');};
const app=fileURLToPath(new URL('../../',import.meta.url));
const dependencies=['private-trial/memory-retrieval-trial-d5/configured-native-caller.mjs','private-trial/memory-retrieval-trial-d5/configured-caller.mjs',
  'private-trial/memory-retrieval-trial-d5/native-project.mjs','private-trial/memory-retrieval-trial-d5/private-launch.mjs',
  'private-trial/memory-retrieval-trial-d5/isolated-source.mjs','private-trial/memory-retrieval-trial-d5/product-profile.mjs','private-trial/memory-retrieval-trial-d5/product-step.mjs',
  'private-trial/memory-retrieval-trial-d5/profile.mjs','private-trial/memory-retrieval-trial-d5/whole-executor.mjs','private-trial/memory-retrieval-trial-d5/comparison-bridge.mjs',
  'private-trial/memory-retrieval-comparison-d3/run.mjs','private-trial/memory-retrieval-comparison-d3/ports.mjs','private-trial/trial-journal/journal.mjs','private-trial/trial-journal/policy-assert.mjs',
  'dist/hub.js','dist/history-store.js','dist/memory/configured-trial.js','dist/memory/chat-endpoint.js','dist/memory/service.js','dist/memory/config.js','dist/memory/zep.js','dist/memory/zep-payload.js','dist/memory/graph-generations.js','dist/memory/change-token-cache.js','dist/memory/policy-refusal.js'];

export function createConfiguredNativeCaller({hub,selection,source=null,scopeCurrent=null}){
  require(hub&&typeof hub.memoryTrialContext==='function');
  if(source!==null)require(source.schema==='same-hub-private-trial-source-v1'&&source.history===hub.history&&typeof source.current==='function'&&typeof hub.memoryTrialAccountContext==='function');
  require(scopeCurrent===null||(source!==null&&typeof scopeCurrent==='function'));
  const selectedScopeCurrent=source===null?null:scopeCurrent??(()=>source.current());
  const context=source===null?hub.memoryTrialContext(selection):hub.memoryTrialAccountContext(selection),selected=json(selection);
  const sourceRows=new ChangeTokenCache();
  function readSourceRows(scope,accountId){
    const outbox=hub.history.memoryOutbox;
    return sourceRows.read(outbox.changeToken(),canonical([accountId,scope.members.map(m=>m.opId),source.rooms.map(r=>[r.id,r.uuid])]),()=>{
      const members=[];
      for(const m of scope.members){
        const row=outbox.deliveries.get(m.opId);
        if(!(row&&row.identity.provider==='zep'&&outbox.deliveries.currentCopy(row.identity)&&outbox.deliveries.accountMatches(row.identity,accountId)))return null;
        members.push({opId:m.opId,identity:json(row.identity)});
      }
      return {members,routes:source.rooms.map(room=>({roomId:room.id,head:outbox.generations.head({provider:'zep',account:accountId,uuid:room.uuid}),attachment:outbox.generationAttachment('zep',room.id)}))};
    });
  }
  function metadata(profile,scope){
    let loaded=context.snapshot();if(!loaded)throw new Held('configured_provider_absent_stale_or_scope_changed');
    if(source!==null){
      require(selectedScopeCurrent()===true&&hub.privateTrialNamespaceUnregistered(source.rooms.map(r=>r.id),source.rooms.map(r=>r.uuid)));
      const rows=readSourceRows(scope,loaded.accountId);require(rows!==null);
      const {members,routes}=rows;
      require(new Set(members.map(m=>m.identity.roomId)).size===profile.manifest.topology.length);
      loaded={...loaded,rooms:source.rooms,members,routes};
    }
    require(loaded.readBase===profile.origins.readBase&&loaded.answer.owner===selected.answerKeyOwner&&loaded.answer.endpoint===profile.origins.answerEndpoint&&loaded.answer.model===profile.manifest.answerControls.model);
    require(canonical(loaded.members.map(m=>m.opId).sort())===canonical(scope.members.map(m=>m.opId).sort()));
    for(const room of loaded.rooms){
      const graph=scope.graphs.find(g=>g.authority.roomUuid===room.uuid),route=loaded.routes.find(r=>r.roomId===room.id);require(graph&&graph.authority.accountId===loaded.accountId&&route&&!route.head.reason&&!route.head.followPending);
      require(!route.head.route||route.head.route.graphId===graph.graphId);
      if(route.attachment)require(route.attachment.account===loaded.accountId&&route.attachment.uuid===room.uuid&&!route.attachment.check&&loaded.members.filter(m=>m.identity.roomId===room.id).every(m=>m.identity.copyId===route.attachment.copy));
    }
    const account={accountId:loaded.accountId,readBase:loaded.readBase,revision:'sha256:'+digest({configurationRevision:loaded.configurationRevision,loadedRevision:loaded.loadedRevision,answer:loaded.answer,selection:selected}),projectBinding:json(NATIVE_PENDING)};
    if(profile.schema===NATIVE_PROFILE)require(canonical(profile.nativeProject.account)===canonical(account));
    return {...loaded,account};
  }
  function ports(profile,scope){return {history:hub.history,get rooms(){return metadata(profile,scope).rooms;},current:()=>refusalAsNo(()=>{metadata(profile,scope);return true;}),cap:()=>metadata(profile,scope).cap,accountSnapshot:()=>metadata(profile,scope).account,
    snapshot:()=>{let m;try{m=metadata(profile,scope);}catch{return {current:false,account:null,cap:null,rooms:[]};}return {current:true,account:m.account,cap:m.cap,rooms:m.rooms};}};}
  function requiredPins(profile,scope){require(profile.schema===NATIVE_PROFILE);validateNativeDeclaration(profile);metadata(profile,scope);return dependencies.map(relative=>{const file=path.join(app,relative);if(!fs.existsSync(file))throw new Held('configured_owner_build_pending');return {path:file,sha256:sha256(fs.readFileSync(file))};});}
  return Object.freeze({
    prepare:prepared=>{
      const observed=metadata(prepared.profile,prepared.scope);
      const localRoutes=source===null?null:{namespaceId:source.namespaceId,rooms:observed.rooms,routes:observed.routes};
      return prepareNativeProductProfile(prepared,observed.account,localRoutes);
    },
    capture:(profile,scope)=>{require(profile.schema===NATIVE_PROFILE);validateNativeDeclaration(profile);return captureLaunchBinding({...ports(profile,scope),profile,scope});},
    requiredPins,
    bindProfile:({profile,scope,preparation,bindingPin,codePins})=>{
      const binding=captureLaunchBinding({...ports(profile,scope),profile,scope});require(bindingPin.sha256===digest(binding));const merged=[...codePins];
      for(const pin of requiredPins(profile,scope)){const old=merged.find(p=>p.path===pin.path);if(old)require(old.sha256===pin.sha256);else merged.push(pin);}
      return {...bindLaunchProfile({profile,scope,preparation,binding,bindingPin,codePins:merged}),binding};
    },
    async launch(input){
      const profile=json(input.profile),scope=json(input.scope);require(profile.schema===NATIVE_PROFILE);
      const namespaceFresh=()=>source===null||hub.privateTrialNamespaceUnregistered(source.rooms.map(r=>r.id),source.rooms.map(r=>r.uuid),{fresh:true});
      require(namespaceFresh());
      for(const pin of requiredPins(profile,scope))require(profile.codePins.some(p=>p.path===pin.path&&p.sha256===pin.sha256));
      const loadCredentials=configuredCredentialClosure({hub,selected,ownerRoot:input.ownerRoot,profile,readSnapshot:()=>metadata(profile,scope)});
      const result=await launchPrivateTrial({...input,profile,scope,scopePorts:ports(profile,scope),loadCredentials});
      require(namespaceFresh());return result;
    },
    scopePorts:(profile,scope)=>ports(json(profile),json(scope)),
  });
}
