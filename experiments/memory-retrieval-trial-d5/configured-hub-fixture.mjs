// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOwnedConfiguredHubFixture,writeOwnedConfiguredFixtureTerminal} from './owned-configured-hub-fixture.mjs';
import {createRegisteredFixtureRooms,projectRegisteredFixtureTemplate,configuredFixtureSetupEvidence} from './configured-fixture-local-template.mjs';
import {consentWords} from '../../dist/memory/config.js';
import {providerEntry} from '../../dist/memory/registry.js';
import {createProductStep} from './product-step.mjs';
import {prepareProductProfile,prepareIsolatedProductProfile} from './product-profile.mjs';
import {createIsolatedSource} from './isolated-source.mjs';
import {createConfiguredCaller} from './configured-caller.mjs';
import {DTrial} from './profile.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';
import {json,canonical,encode,sha256} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {dInputs,evidenceFolder} from './test-folders.mjs';

const app=fileURLToPath(new URL('../../',import.meta.url)),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const pin=p=>({path:p,sha256:sha256(fs.readFileSync(p))}),digest=v=>sha256(encode(v));
let evidenceCase=0;
let terminalCase=0;
export const FIXTURE_PROJECT='11111111-1111-4111-8111-111111111111';

export function loopbackAnswerModel() {
  return body => {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const user = typeof messages[1]?.content === 'string' ? messages[1].content : '';
    const context = user.slice(user.indexOf('Context:\n') + 'Context:\n'.length).split('\n').find(line => line.trim()) ?? '';
    const answer = context ? `Loopback answer from the context: ${context.trim()}` : 'Loopback answer: the context holds nothing to answer from.';
    const promptTokens = Math.ceil(messages.reduce((n, m) => n + Buffer.byteLength(String(m.content ?? '')), 0) / 4), completionTokens = Math.ceil(Buffer.byteLength(answer) / 4);
    return {status: 200, body: {choices: [{message: {content: answer}}], usage: {prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens}}};
  };
}


export async function configuredHubWorld(t,{ordinaryModel='',nativeProject=false,callerFactory=null,isolated=false,monthlyCap=0,inputs=null,readers=!nativeProject,approvalMs=600000}={}) {
  const inputFiles=inputs?null:await dInputs('D_PRIVATE_INPUT','D_PRIVATE_SOURCES');
  const input=inputFiles?.root??null,sourcesFile=inputFiles?.sources??null;
  const configuredEvidence=evidenceFolder('D_CONFIGURED_EVIDENCE');
  let w=null,ownerRoot=null;
  const setup={stage:'ownership-registered',warmupCompleted:false,worldReturned:false};
  const ownership=createOwnedConfiguredHubFixture(t,{writeFinalCheckpoint:configuredEvidence?checkpoint=>{
    return writeOwnedConfiguredFixtureTerminal({root:configuredEvidence,prefix:'hub',ordinal:++terminalCase,checkpoint});
  }:null,writeEvidence:closure=>{
    if(configuredEvidence){
      const journalFile=ownerRoot===null?null:path.join(ownerRoot,'trial-journal.sqlite');
      const journalObservation=journalFile===null?'not-observed':fs.existsSync(journalFile)?'inspected':'absent';
      const state=journalObservation==='inspected'?RunJournal.inspect(ownerRoot):null;
      const evidence=configuredFixtureSetupEvidence({test:t.name,setup,world:w,closure,state,journalObservation});
      fs.writeFileSync(path.join(configuredEvidence,`hub-${++evidenceCase}.json`),encode(evidence),{flag:'wx'});
    }
  }});
  const root=ownership.allocateRoot();setup.stage='root-returned';
  ownerRoot=ownership.createTrialDirectory();setup.stage='trial-directory-returned';
  const server=ownership.constructServer();setup.stage='server-returned';
  if(readers){server.derivedFacts=true;server.projectUuid=FIXTURE_PROJECT;server.model=loopbackAnswerModel();}
  await ownership.startServer();setup.stage='server-started';
  const hub=ownership.constructHub();setup.stage='hub-returned';
  w={root,ownerRoot,server,hub,events:[],HTTP:[],answerCopies:[],nativeProject,closed:false,inputFiles};
  w.reopenHub=async()=>{const reopened=await ownership.reopenHub(hub);w.hubWasClosed=true;w.reopenedHub=reopened;return reopened;};
  w.fixtureClosure=()=>ownership.snapshot();
  w.refuseExternalClaimFailure=category=>ownership.refuseExternalClaimFailure(category);
  w.refuseAdditionalServerFailure=category=>ownership.refuseAdditionalServerFailure(category);
  w.constructAdditionalHumanServer=()=>ownership.constructAdditionalHumanServer();
  w.startAdditionalHumanServer=server=>ownership.startAdditionalHumanServer(server,w.hub);
  w.observeAdditionalHumanServerClose=(server,closeOperation)=>ownership.observeAdditionalHumanServerClose(server,closeOperation);
  const prior=inputs?json(inputs.prior):read(path.join(input,'PREPARED-PROFILE.json')),preparation=inputs?json(inputs.preparation):read(path.join(input,'BOUND-PREPARATION.json'));
  const sources=inputs?json(inputs.sources):read(sourcesFile).sources;
  const sieve=inputs?json(inputs.sieve??null):fs.existsSync(path.join(input,'SIEVE-VERDICTS.json'))?read(path.join(input,'SIEVE-VERDICTS.json')):null;
  const registered=isolated?null:createRegisteredFixtureRooms(hub,prior.payloads,{graphs:prior.manifest.topology.length});
  let rooms=registered===null?[]:registered.rooms;
  w.registeredTemplate=registered===null?null:json(registered.projection);setup.stage='registered-rooms';
  const {room:warm}=hub.createRoom({name:'configured-trial-warmup',settings:{remembers:true,readsOtherRooms:'off'}});
  const zepKey='SYNTHETIC_CONFIGURED_ZEP_KEY',answerKey='SYNTHETIC_CONFIGURED_ANSWER_KEY';
  hub.memoryStore.update(config=>{
    config.provider='zep';config.providers.zep={apiKey:zepKey,baseUrl:server.url,monthlyCreditCap:monthlyCap};
    config.filter={...config.filter,mode:'off',baseUrl:server.url+'/v1',apiKey:answerKey,model:ordinaryModel};
    config.consent.zep={at:Date.now(),words:consentWords(providerEntry('zep'),config.filter)};
  });
  setup.stage='warmup-requested';
  await hub.memory.searchFacts(warm.id,'synthetic adapter warm-up',{limit:1,across:false,waitMs:2000});
  w.warmupRequests=json(server.requests);assert.ok(w.warmupRequests.length>0);
  setup.warmupCompleted=true;setup.stage='warmup-complete';
  server.requests.length=0;
  let roomViews=rooms.map(r=>({id:r.id,uuid:r.uuid,name:r.name,remembers:true,input:r.settings.memoryInput,originalInput:r.settings.memoryInput==='whole'})),existing,materialization;
  const accountSelection={answerKeyOwner:'memory.filter.apiKey',answerEndpoint:server.url+'/v1/chat/completions',answerModel:prior.manifest.answerControls.model};
  if(isolated){
    assert.equal(nativeProject,true,'isolated source requires the versioned native account handoff');
    const accountContext=hub.memoryTrialAccountContext(accountSelection);assert.ok(accountContext.snapshot());
    w.source=createIsolatedSource({hub,accountContext,payloads:prior.payloads,sieve});
    materialization=w.source.materialize({plannedRows:prior.payloads.rows,sources});rooms=w.source.rooms;roomViews=rooms;
    existing={rows:w.source.rows,provider:{generations:{account:accountContext.snapshot().accountId}}};
  }else {
    existing=createProductStep({history:hub.history,settings:{apiKey:zepKey,baseUrl:server.url},rooms:roomViews,current:()=>true,cap:()=>0,sieve});
    for(const planned of prior.payloads.rows){
    const source=sources.find(s=>s.id===planned.sourceId),room=roomViews.find(r=>r.id===planned.members[0].identity.roomId);assert.ok(source&&room);
    hub.history.upsert(room.id,{id:source.id,seq:hub.history.maxSeq(room.id)+1,room:source.room,from:source.author,fromName:source.author,ts:Date.parse(source.at),kind:'chat',text:source.text});
    existing.prepare({source:hub.history.getById(room.id,source.id),roomId:room.id});
    }
  }
  setup.stage='sources-prepared';
  const preparedPath=path.join(root,'PREPARED.json');fs.writeFileSync(preparedPath,encode(isolated?materialization:existing.rows()));
  const codePaths=prior.codePins.map(p=>{const relative=path.relative(app,p.path);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'fixture_code_pin_outside_checkout');return path.join(app,relative);});
  codePaths.push(path.join(app,'experiments/memory-retrieval-trial-d5/configured-caller.mjs'));
  codePaths.push(path.join(app,'experiments/memory-retrieval-trial-d5/configured-hub-fixture.mjs'),
    path.join(app,'experiments/memory-retrieval-trial-d5/configured-fixture-local-template.mjs'));
  const codePins=[...new Set(codePaths)].map(pin);
  const localPrior=isolated?json(prior):projectRegisteredFixtureTemplate({prior,projection:registered.projection,rooms,history:hub.history,rows:existing.rows()});
  localPrior.purpose='local-fixture';
  const prepareInput={prior:localPrior,preparation,rows:existing.rows(),account:existing.provider.generations.account,
    origins:{readBase:server.url,answerEndpoint:server.url+'/v1/chat/completions'},codePins,preparationPin:pin(preparedPath)};
  w.prepared=isolated?prepareIsolatedProductProfile({...prepareInput,materialization,history:hub.history,routeObservations:rooms.map(r=>({uuid:r.uuid,
    head:hub.history.memoryOutbox.generations.head({provider:'zep',account:existing.provider.generations.account,uuid:r.uuid}),attachment:hub.history.memoryOutbox.generationAttachment('zep',r.id)}))}):prepareProductProfile(prepareInput);
  setup.stage='profile-prepared';
  w.selection=isolated?accountSelection:{roomIds:rooms.map(r=>r.id),opIds:existing.rows().map(r=>r.opId),...accountSelection};
  w.rooms=rooms;w.accountId=existing.provider.generations.account;
  const loaded=(isolated?hub.memoryTrialAccountContext(w.selection):hub.memoryTrialContext(w.selection)).snapshot();assert.ok(loaded,'real loaded Hub metadata is required');
  assert.equal(loaded.accountId,w.accountId);assert.equal(server.requests.length,0);
  const observedAnswerFilter=hub.memoryStore.get().filter;
  const observeAnswerCredential=()=>{
    const look=fs.existsSync(path.join(ownerRoot,'trial-journal.sqlite'))?RunJournal.peek(ownerRoot):null;
    w.answerCopies.push({claim:look?.claim??null,stopped:look?.stopped??null,attempts:look?.attempts??0});
    w.onAnswerCopy?.();return answerKey;
  };
  Object.defineProperty(observedAnswerFilter,'apiKey',{enumerable:true,configurable:true,get:observeAnswerCredential});
  w.answerCredentialCheckpoint=()=>{
    const filter=hub.memoryStore.get().filter,descriptor=Object.getOwnPropertyDescriptor(filter,'apiKey');
    assert.equal(filter,observedAnswerFilter,'answer credential observer filter changed');
    assert.ok(descriptor&&descriptor.get===observeAnswerCredential&&descriptor.set===undefined&&
      descriptor.enumerable===true&&descriptor.configurable===true&&!('value'in descriptor)&&!('writable'in descriptor),
      'answer credential observer accessor changed');
    const rows=Object.freeze(w.answerCopies.map(row=>Object.freeze({...row})));
    return Object.freeze({count:rows.length,rows});
  };
  if(!nativeProject){
    for(const graph of w.prepared.scope.graphs)graph.authority.projectId=FIXTURE_PROJECT;
    w.prepared.profile.review.serviceEmissionProofSha256=digest(w.prepared.scope);
    const evidence=path.join(root,'SYNTHETIC-PROJECT-EVIDENCE.txt');fs.writeFileSync(evidence,'Local fixture project, not vendor authority.\n');
    const subject={provider:'zep',accountId:w.accountId,readBase:server.url,projectId:FIXTURE_PROJECT,evidencePin:pin(evidence)};
    const review=path.join(root,'SYNTHETIC-PROJECT-REVIEW.json');fs.writeFileSync(review,encode({schema:'configured-project-source-review-v1',decision:'LOCAL_FIXTURE_ONLY',subjectSha256:digest(subject),reviewer:{name:'synthetic fixture reviewer',kind:'agent'}}));
    const association=path.join(root,'SYNTHETIC-PROJECT-ASSOCIATION.json');fs.writeFileSync(association,encode({schema:'configured-zep-project-association-v1',...subject,provenance:{kind:'synthetic-local-project',evidencePin:pin(evidence),reviewProofPin:pin(review)}}));
    const record=read(association);delete record.evidencePin;fs.writeFileSync(association,encode(record));
    w.caller=createConfiguredCaller({hub,selection:w.selection,projectAssociationPin:pin(association)});
  }else {assert.equal(typeof callerFactory,'function');await callerFactory(w);}
  w.binding=w.caller.capture(w.prepared.profile,w.prepared.scope);setup.stage='binding-captured';
  assert.equal(w.answerCopies.length,0,'metadata/capture must not copy the answer credential');assert.equal(server.requests.length,0);
  const bindingPath=path.join(root,'BINDING.json');fs.writeFileSync(bindingPath,encode(w.binding));
  const bound=w.caller.bindProfile({...w.prepared,bindingPin:pin(bindingPath),codePins:w.prepared.profile.codePins});
  Object.assign(w,bound);const card=DTrial.prepare(ownerRoot,w.profile);
  w.approval={id:'synthetic-configured-Hub',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+approvalMs).toISOString()};
  w.fetchImpl=async(request,init)=>{
    const url=new URL(String(request));assert.equal(url.origin,new URL(server.url).origin);
    const look=RunJournal.peek(ownerRoot),attempt=look.last;assert.ok(look.claim);assert.equal(look.stopped,null);assert.equal(attempt?.outcome,'dispatch_uncertain');
    const model=url.href===w.profile.origins.answerEndpoint;assert.equal(new Headers(init.headers).get('authorization'),model?`Bearer ${answerKey}`:`Api-Key ${zepKey}`);
    assert.equal(w.answerCopies.filter(p=>p.claim).length,1,'exactly one postclaim answer credential copy');
    w.HTTP.push({method:init.method,path:url.pathname,kind:model?'model':'zep',attemptId:attempt.id,claim:look.claim});
    return fetch(request,init);
  };
  const treeFile=inputs?.tree?.file??(inputFiles&&fs.existsSync(path.join(inputFiles.root,'TREE-INVENTORY.json'))?path.join(inputFiles.root,'TREE-INVENTORY.json'):null);
  w.tree=inputs?.tree?{file:inputs.tree.file,app:inputs.tree.app}:treeFile?{file:treeFile}:null;
  w.launch=async overrides=>{
    try{const result=await w.caller.launch({ownerRoot,profile:w.profile,scope:w.scope,preparation:w.preparation,binding:w.binding,approval:w.approval,verifyApproval:()=>true,fetchImpl:w.fetchImpl,record:(kind,value)=>w.events.push({kind,value}),tree:w.tree,...overrides});w.lastOutcome={result};return result;}
    catch(error){w.lastOutcome={error:{name:error.name,message:error.message}};throw error;}
  };
  setup.stage='ready';setup.worldReturned=true;
  w.fixtureSetup=()=>json(setup);return w;
}

export function assertNoFixtureSecrets(w,value){
  const observed=canonical(value);for(const marker of ['SYNTHETIC_CONFIGURED_ZEP_KEY','SYNTHETIC_CONFIGURED_ANSWER_KEY'])assert.equal(observed.includes(marker),false);
}
