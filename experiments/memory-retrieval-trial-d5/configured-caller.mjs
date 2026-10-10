// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {canonical,json,encode,sha256,Held} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {captureLaunchBinding,bindLaunchProfile,launchPrivateTrial} from './private-launch.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';
import {pinWatch} from './profile.mjs';
import {refusalAsNo} from '../trial-journal/policy-assert.mjs';
const digest=value=>sha256(encode(value)),require=condition=>{if(!condition)throw new Held('configured_trial_contract_refused');};
const fields=(object,names)=>require(object&&canonical(Object.keys(object).sort())===canonical([...names].sort()));
const app=fileURLToPath(new URL('../../',import.meta.url));
const callerDependencies=['experiments/memory-retrieval-trial-d5/configured-caller.mjs','experiments/memory-retrieval-trial-d5/private-launch.mjs','experiments/trial-journal/policy-assert.mjs',
  'dist/hub.js','dist/memory/configured-trial.js','dist/memory/chat-endpoint.js','dist/memory/service.js','dist/memory/config.js','dist/memory/zep.js','dist/memory/change-token-cache.js','dist/memory/policy-refusal.js'];

export function configuredCredentialClosure({hub,selected,ownerRoot,profile,readSnapshot,answerOnly=false}){return async({claimId,signal})=>{
      const actual=RunJournal.inspect(ownerRoot);require(actual.state.run.claim===claimId&&actual.state.run.stopped===null&&canonical(actual.policy.identity)===canonical(profile));
      signal.throwIfAborted();const before=readSnapshot();let zepSettings,answerKey;
      try{
        const config=hub.memoryStore.get(),zep=config.providers.zep;
        require(selected.answerKeyOwner==='memory.filter.apiKey');
        if(!answerOnly){require(config.provider==='zep');zepSettings={apiKey:zep.apiKey,...(typeof zep.baseUrl==='string'&&zep.baseUrl?{baseUrl:zep.baseUrl}:{})};}
        answerKey=config.filter.apiKey;
        require((answerOnly||typeof zepSettings.apiKey==='string')&&typeof answerKey==='string');
      }catch{throw new Held('private_credentials_load_failed');}
      signal.throwIfAborted();require(canonical(before.account)===canonical(readSnapshot().account));
      return answerOnly?{answerKey}:{zepSettings,answerKey};
    };}

export function createConfiguredCaller({hub,selection,projectAssociationPin=null}){
  require(hub&&typeof hub.memoryTrialContext==='function');
  const context=hub.memoryTrialContext(selection),selected=json(selection),projectPin=projectAssociationPin===null?null:json(projectAssociationPin);
  const pins=pinWatch({keepBytes:true});
  const verifyPin=pin=>{require(pin&&typeof pin.path==='string'&&/^[a-f0-9]{64}$/.test(pin.sha256));const bytes=pins.bytes(pin);require(bytes!==null);return bytes;};
  const readPin=pin=>JSON.parse(verifyPin(pin).toString('utf8'));
  function project(loaded,purpose){
    if(projectPin===null)throw new Held('configured_project_association_missing');
    const association=readPin(projectPin);fields(association,['schema','provider','accountId','readBase','projectId','provenance']);
    require(association.schema==='configured-zep-project-association-v1'&&association.provider==='zep'&&association.accountId===loaded.accountId&&association.readBase===loaded.readBase);
    require(typeof association.projectId==='string'&&association.projectId.length>0&&association.projectId!=='LOCAL_UNVERIFIED_PROJECT');
    const p=association.provenance;fields(p,['kind','evidencePin','reviewProofPin']);
    require(p.kind==='reviewed-provider-project'||purpose==='local-fixture'&&p.kind==='synthetic-local-project');
    verifyPin(p.evidencePin);const review=readPin(p.reviewProofPin);
    fields(review,['schema','decision','subjectSha256','reviewer']);
    fields(review.reviewer,['name','kind']);require(typeof review.reviewer.name==='string'&&review.reviewer.name.length>0&&['human','agent'].includes(review.reviewer.kind));
    require(review.schema==='configured-project-source-review-v1'&&review.subjectSha256===digest({provider:association.provider,accountId:association.accountId,readBase:association.readBase,projectId:association.projectId,evidencePin:p.evidencePin}));
    require(p.kind==='synthetic-local-project'?review.decision==='LOCAL_FIXTURE_ONLY':review.decision==='ACCEPTED_PROJECT_ASSOCIATION');
    return {association,pins:[projectPin,p.evidencePin,p.reviewProofPin].map(json)};
  }
  function snapshot(profile,scope){
    const loaded=context.snapshot();if(!loaded)throw new Held('configured_provider_absent_stale_or_scope_changed');
    require(loaded.readBase===profile.origins.readBase&&loaded.answer.owner===selected.answerKeyOwner&&loaded.answer.endpoint===profile.origins.answerEndpoint&&loaded.answer.model===profile.manifest.answerControls.model);
    const reviewed=project(loaded,profile.purpose);
    require(canonical([...loaded.members.map(m=>m.opId)].sort())===canonical([...scope.members.map(m=>m.opId)].sort()));
    for(const room of loaded.rooms){
      const graph=scope.graphs.find(g=>g.authority.roomUuid===room.uuid);require(graph&&graph.authority.accountId===loaded.accountId&&graph.authority.projectId===reviewed.association.projectId);
      const route=loaded.routes.find(r=>r.roomId===room.id);require(route&&!route.head.reason&&!route.head.followPending&&(!route.head.route||route.head.route.graphId===graph.graphId));
      if(route.attachment)require(route.attachment.account===loaded.accountId&&route.attachment.uuid===room.uuid&&!route.attachment.check&&loaded.members.filter(m=>m.identity.roomId===room.id).every(m=>m.identity.copyId===route.attachment.copy));
    }
    const revision='sha256:'+digest({configurationRevision:loaded.configurationRevision,loadedRevision:loaded.loadedRevision,
      answer:loaded.answer,selection:selected,projectPins:reviewed.pins});
    return {...loaded,account:{accountId:loaded.accountId,projectId:reviewed.association.projectId,readBase:loaded.readBase,revision},projectPins:reviewed.pins};
  }
  function ports(profile,scope){
    return {history:hub.history,get rooms(){return snapshot(profile,scope).rooms;},
      current:()=>refusalAsNo(()=>{snapshot(profile,scope);return true;}),
      cap:()=>snapshot(profile,scope).cap,accountSnapshot:()=>snapshot(profile,scope).account,
      snapshot:()=>{let s;try{s=snapshot(profile,scope);}catch{return {current:false,account:null,cap:null,rooms:[]};}return {current:true,account:s.account,cap:s.cap,rooms:s.rooms};}};
  }
  function requiredPins(profile,scope){
    const metadata=snapshot(profile,scope);
    const pins=callerDependencies.map(relative=>{const file=path.join(app,relative);if(!fs.existsSync(file))throw new Held('configured_owner_build_pending');return {path:file,sha256:sha256(fs.readFileSync(file))};});
    return [...metadata.projectPins,...pins];
  }
  function bindProfile({profile,scope,preparation,bindingPin,codePins}){
    const scopePorts=ports(profile,scope),binding=captureLaunchBinding({...scopePorts,profile,scope});
    require(bindingPin&&bindingPin.sha256===digest(binding));
    const required=requiredPins(profile,scope),merged=[...codePins];
    for(const pin of required){const old=merged.find(p=>p.path===pin.path);if(old)require(old.sha256===pin.sha256);else merged.push(pin);}
    return {...bindLaunchProfile({profile,scope,preparation,binding,bindingPin,codePins:merged}),binding};
  }
  async function launch(input){
    pins.forget();
    const profile=json(input.profile),scope=json(input.scope),ownerRoot=input.ownerRoot,scopePorts=ports(profile,scope);
    for(const pin of requiredPins(profile,scope))require(profile.codePins.some(p=>p.path===pin.path&&p.sha256===pin.sha256));
    const loadCredentials=configuredCredentialClosure({hub,selected,ownerRoot,profile,readSnapshot:()=>snapshot(profile,scope)});
    return launchPrivateTrial({...input,profile,scope,scopePorts,loadCredentials});
  }
  return Object.freeze({capture:(profile,scope)=>captureLaunchBinding({...ports(profile,scope),profile,scope}),
    requiredPins,bindProfile,launch,scopePorts:(profile,scope)=>ports(json(profile),json(scope))});
}
