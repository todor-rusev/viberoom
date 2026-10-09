// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createResidentPreparation} from './resident.mjs';
import {createPreparationLifetime,createResidentFences} from './resident-lifecycle.mjs';
import {createPrivateTrialEntry} from '../dist/memory/private-trial-entry.js';
import {startProductionPrivateTrial,stopProductionPrivateTrial} from '../dist/memory/private-trial-startup.js';
import {createOwnedConfiguredHubFixture,writeOwnedConfiguredFixtureTerminal} from '../experiments/memory-retrieval-trial-d5/owned-configured-hub-fixture.mjs';
import {loopbackAnswerModel,FIXTURE_PROJECT} from '../experiments/memory-retrieval-trial-d5/configured-hub-fixture.mjs';
import {resultRefusal} from './memory-retrieval-trial-d5/profile.mjs';
import {RunJournal} from './trial-journal/journal.mjs';
import {consentWords} from '../dist/memory/config.js';
import {providerEntry} from '../dist/memory/registry.js';
import policy,{Held} from './trial-journal/policy-assert.mjs';
import {builtDInputs,evidenceFolder} from '../experiments/memory-retrieval-trial-d5/test-folders.mjs';
import {withHumanServer,humanDecision,humanRevoke,decisionFor} from '../experiments/memory-retrieval-trial-d5/human-server.mjs';

const configuredEvidence=evidenceFolder('D_CONFIGURED_EVIDENCE');
let terminalCase=0;
const ANSWER_MODEL='loopback-answer-model';
async function world(t,{readers=false}={}){
  const ownership=createOwnedConfiguredHubFixture(t,{writeFinalCheckpoint:configuredEvidence?checkpoint=>{
    return writeOwnedConfiguredFixtureTerminal({root:configuredEvidence,prefix:'rv',ordinal:++terminalCase,checkpoint});
  }:null}),root=ownership.allocateRoot();
  const server=ownership.constructServer();
  if(readers){server.derivedFacts=true;server.projectUuid=FIXTURE_PROJECT;server.model=loopbackAnswerModel();}
  await ownership.startServer();const hub=ownership.constructHub();
  const {room}=hub.createRoom({name:'resident-v2-warmup',settings:{remembers:true,readsOtherRooms:'off'}});
  hub.memoryStore.update(config=>{
    config.provider='zep';config.providers.zep={apiKey:'SYNTHETIC_RESIDENT_ZEP',baseUrl:server.url,monthlyCreditCap:0};
    config.filter={...config.filter,mode:'off',baseUrl:server.url+'/v1',apiKey:'SYNTHETIC_RESIDENT_ANSWER',model:ANSWER_MODEL};
    config.consent.zep={at:Date.now(),words:consentWords(providerEntry('zep'),config.filter)};
  });
  await hub.memory.searchFacts(room.id,'synthetic adapter warm-up',{limit:1,across:false,waitMs:2000});
  assert.ok(server.requests.length>0);server.requests.length=0;
  let copies=0;
  Object.defineProperty(hub.memoryStore.get().filter,'apiKey',{enumerable:true,configurable:true,get(){copies++;return 'SYNTHETIC_RESIDENT_ANSWER';}});
  const selection={answerKeyOwner:'memory.filter.apiKey',answerEndpoint:server.url+'/v1/chat/completions',answerModel:ANSWER_MODEL};
  assert.ok(hub.memoryTrialAccountContext(selection).snapshot());
  t.after(()=>stopProductionPrivateTrial(hub));
  const human={constructAdditionalHumanServer:()=>ownership.constructAdditionalHumanServer(),startAdditionalHumanServer:s=>ownership.startAdditionalHumanServer(s,hub),
    observeAdditionalHumanServerClose:(s,close)=>ownership.observeAdditionalHumanServerClose(s,close),refuseAdditionalServerFailure:c=>ownership.refuseAdditionalServerFailure(c)};
  return {ownership,root,server,hub,selection,human,preparationRoot:path.join(hub.dataDir,'private-trial-preparation'),copies:()=>copies};
}
function quiet(w){assert.equal(w.copies(),0);assert.equal(w.server.requests.length,0);assert.equal(fs.existsSync(w.preparationRoot),false);}
async function deploy(w,purpose){
  const {deployPrivateTrial}=await import('../scripts/private-trial-deploy.mjs');
  const inputs=await builtDInputs();
  return deployPrivateTrial({dataDir:w.hub.dataDir,inputsDir:inputs.root,purpose,reviewer:{name:'resident test',kind:'agent'},selection:w.selection,checkout:{sha:'0'.repeat(40),origin:'synthetic'}});
}

test('RV01 missing fixed deployment refuses resident and typed entry before local writes',async t=>{
  const w=await world(t),resident=createResidentPreparation(w.hub,{reviewSha256:'a'.repeat(64)});
  const rooms=[...w.hub.rooms.keys()],month=new Date().toISOString().slice(0,7),usage=w.hub.history.memoryOutbox.usage('zep',month);
  assert.equal(resident.status(w.selection).state,'NOT_READY');assert.throws(()=>resident.prepare(w.selection));
  await assert.rejects(createPrivateTrialEntry(w.hub,{reviewSha256:'a'.repeat(64)}));
  assert.deepEqual([...w.hub.rooms.keys()],rooms);assert.equal(w.hub.history.memoryOutbox.usage('zep',month),usage);quiet(w);
});
test('RV02 a deployment without its inputs folder refuses before root/materialization',async t=>{
  const w=await world(t),deployed=await deploy(w,'approved-paid-trial');
  fs.renameSync(path.join(w.hub.dataDir,'private-trial-inputs'),path.join(w.hub.dataDir,'set-aside-inputs'));
  const resident=createResidentPreparation(w.hub,{reviewSha256:deployed.reviewSha256});
  assert.equal(resident.status(w.selection).state,'NOT_READY');assert.throws(()=>resident.prepare(w.selection));quiet(w);
});
test('RV03 inputs changed after the deployment refuse before root/materialization',async t=>{
  const w=await world(t),deployed=await deploy(w,'approved-paid-trial');
  fs.appendFileSync(path.join(w.hub.dataDir,'private-trial-inputs','SIEVE-VERDICTS.json'),' ');
  const resident=createResidentPreparation(w.hub,{reviewSha256:deployed.reviewSha256});
  assert.equal(resident.status(w.selection).state,'NOT_READY');assert.throws(()=>resident.prepare(w.selection));quiet(w);
});
test('RV04 a local deployment prepares, shows its inputs, and neither exposes a budget subject nor is offered by the product start',async t=>{
  const w=await world(t),deployed=await deploy(w,'local-fixture'),resident=createResidentPreparation(w.hub,{reviewSha256:deployed.reviewSha256});
  const status=resident.status(w.selection);assert.equal(status.state,'LOCAL_PREPARATION_READY');
  assert.deepEqual(status.inputs,{templateProfileSha256:deployed.templateProfileSha256,treeInventorySha256:deployed.treeInventorySha256});
  const prepared=resident.prepare(w.selection);assert.equal(prepared.state,'PREPARED');assert.equal(prepared.card.disclosure.purpose,'local-fixture');
  assert.equal(resident.status(w.selection).state,'PREPARED');assert.throws(()=>resident.budgetSubject(),/paid_budget_not_ready/);
  for(const name of ['launch','approve','claim','verifyApproval','credentials'])assert.equal(resident[name],undefined);
  assert.equal(w.copies(),0);assert.equal(w.server.requests.length,0);
  const other=await world(t);await deploy(other,'local-fixture');
  assert.deepEqual(await startProductionPrivateTrial(other.hub),{state:'REFUSED',reason:'refused'});
  assert.equal(other.hub.openSecrets().length,0);assert.equal(other.copies(),0);assert.equal(other.server.requests.length,0);
});
test('RV05 existing fixed preparation root cannot be adopted by a fresh resident',async t=>{
  const w=await world(t);fs.mkdirSync(w.preparationRoot);fs.writeFileSync(path.join(w.preparationRoot,'retained-marker'),'owned prior partial');
  const resident=createResidentPreparation(w.hub,{reviewSha256:'a'.repeat(64)});
  assert.throws(()=>resident.prepare(w.selection),/preparation_not_repeatable/);
  assert.equal(fs.readFileSync(path.join(w.preparationRoot,'retained-marker'),'utf8'),'owned prior partial');
  assert.equal(fs.existsSync(path.join(w.preparationRoot,'CARD.json')),false);assert.equal(w.copies(),0);assert.equal(w.server.requests.length,0);
});
test('RV06 a deployment is created new: an existing review, startup or inputs folder refuses before anything is written',async t=>{
  const w=await world(t),names=()=>fs.readdirSync(w.hub.dataDir).filter(n=>n.startsWith('private-trial')).sort();
  for(const name of ['private-trial-review.json','private-trial-startup.json']){
    const file=path.join(w.hub.dataDir,name);fs.writeFileSync(file,'retained');
    await assert.rejects(deploy(w,'approved-paid-trial'),/exists: a deployment is created new/);
    assert.deepEqual(names(),[name]);assert.equal(fs.readFileSync(file,'utf8'),'retained');fs.rmSync(file);
  }
  fs.mkdirSync(path.join(w.hub.dataDir,'private-trial-inputs'));
  await assert.rejects(deploy(w,'approved-paid-trial'),/owned_inputs_nonadoption/);assert.deepEqual(names(),['private-trial-inputs']);
  assert.deepEqual(fs.readdirSync(path.join(w.hub.dataDir,'private-trial-inputs')),[]);quiet(w);
});
test('RV07 a prepared resident is not current after the loaded account changes, with no lazy-load fallback',async t=>{
  const w=await world(t),deployed=await deploy(w,'local-fixture'),resident=createResidentPreparation(w.hub,{reviewSha256:deployed.reviewSha256});
  resident.prepare(w.selection);assert.equal(resident.status(w.selection).state,'PREPARED');
  const context=w.hub.memoryTrialAccountContext(w.selection),before=context.snapshot();
  assert.ok(before);w.hub.memoryStore.invalidateTrialRevision();
  assert.notDeepEqual(context.snapshot(),before,'actual account projection must retain configuration drift');
  assert.deepEqual(resident.status(w.selection),{state:'NOT_READY',reason:'prepared_owner_changed',launchEnabled:false});
  assert.throws(()=>resident.card(),/prepared_card_not_current/);assert.equal(w.copies(),0);assert.equal(w.server.requests.length,0);
});
test('RV08 internal CreateNew lifecycle retains partial folder and refuses replay',async t=>{
  const w=await world(t),lifetime=createPreparationLifetime(w.preparationRoot);
  lifetime.begin();fs.writeFileSync(path.join(w.preparationRoot,'partial-owner-data'),'explicit lifecycle policy probe',{flag:'wx'});lifetime.refuse();
  assert.equal(lifetime.phase,'REFUSED');assert.throws(()=>lifetime.begin(),/preparation_not_repeatable/);
  const fresh=createPreparationLifetime(w.preparationRoot);assert.throws(()=>fresh.begin(),/preparation_not_repeatable/);
  assert.equal(fs.readFileSync(path.join(w.preparationRoot,'partial-owner-data'),'utf8'),'explicit lifecycle policy probe');
  assert.equal(w.copies(),0);assert.equal(w.server.requests.length,0);
});
test('RV09 failed directory acquisition is sticky even with no returned folder',async t=>{
  const w=await world(t),root=path.join(w.root,'missing-parent','private-trial-preparation'),lifetime=createPreparationLifetime(root);
  assert.throws(()=>lifetime.begin(),/preparation_root_acquisition_refused/);assert.equal(lifetime.phase,'REFUSED');
  fs.mkdirSync(path.dirname(root));assert.throws(()=>lifetime.begin(),/preparation_not_repeatable/);assert.equal(fs.existsSync(root),false);quiet(w);
});
test('RV10 injected fence policy permits own claimed progress without preclaim inspection in current',()=>{
  let claimed=false,inspections=0,live=true,artifacts=true;
  const fences=createResidentFences({liveCurrent:()=>live,artifactCurrent:()=>artifacts,beforeClaim:()=>{inspections++;return !claimed;}});
  assert.equal(fences.beforeOffer(),true);assert.equal(inspections,1);claimed=true;
  assert.equal(fences.current(),true);assert.equal(inspections,1);
  assert.equal(fences.beforeOffer(),false);assert.equal(inspections,2);
  live=false;assert.equal(fences.current(),false);assert.equal(inspections,2);
  live=true;artifacts=false;assert.equal(fences.current(),false);assert.equal(inspections,2);
});
test('RV11 strict synchronous fence refuses promises, truthy values and refusals; a bug leaves as an error',()=>{
  for(const live of [()=>1,()=>Promise.resolve(true),()=>policy.fail('injected finite policy refusal'),()=>{throw new Held('injected hold');}]){
    let before=0;const fences=createResidentFences({liveCurrent:live,artifactCurrent:()=>true,beforeClaim:()=>{before++;return true;}});
    assert.equal(fences.current(),false);assert.equal(fences.beforeOffer(),false);assert.equal(before,0);
  }
  const bug=new TypeError('injected bug');let before=0;
  const fences=createResidentFences({liveCurrent:()=>{throw bug;},artifactCurrent:()=>true,beforeClaim:()=>{before++;return true;}});
  assert.throws(()=>fences.current(),error=>error===bug);assert.throws(()=>fences.beforeOffer(),error=>error===bug);assert.equal(before,0);
});
async function finished(root,limitMs=20*60_000){
  const result=path.join(root,'RESULT.json'),until=Date.now()+limitMs;
  for(;;){
    if(fs.existsSync(result))return JSON.parse(fs.readFileSync(result,'utf8'));
    const stopped=RunJournal.peek(root).stopped;
    if(stopped!==null){await new Promise(r=>setTimeout(r,2000));if(fs.existsSync(result))continue;assert.fail(`the trial stopped without a result: ${stopped}`);}
    assert.ok(Date.now()<until,'the trial did not finish in time');await new Promise(r=>setTimeout(r,500));
  }
}
test('RV12 the product start offers the card for a paid deployment, and its approval runs the whole trial once on loopback',async t=>{
  const w=await world(t,{readers:true}),deployed=await deploy(w,'approved-paid-trial');
  const offered=await startProductionPrivateTrial(w.hub);assert.equal(offered?.state,'OFFERED',JSON.stringify(offered));
  const request=w.hub.openSecrets().find(r=>r.id===offered.cardId),view=request.trialBudget,shown=view.whole.disclosure;
  assert.equal(shown.purpose,'approved-paid-trial');assert.deepEqual(shown.reviewer,{name:'resident test',kind:'agent'});
  assert.deepEqual(shown.inputs,{templateProfileSha256:deployed.templateProfileSha256,treeInventorySha256:deployed.treeInventorySha256,checkout:deployed.checkout});
  assert.equal(shown.dataEstimateCredits,view.whole.policy.limits.localEstimatedCredits);assert.equal(shown.answer.model,ANSWER_MODEL);
  assert.equal(w.copies(),0);assert.equal(w.server.requests.length,0);
  const decided=await withHumanServer(w.human,async running=>{const response=await humanDecision(running,request);assert.equal(response.status,200);return (await response.json()).request;});
  assert.match(decided.outcome,/^Whole comparison claimed once: /);
  const result=await finished(w.preparationRoot);
  assert.equal(result.status,'captured-unjudged',result.error??'');assert.equal(result.actualD,'CAPTURED_NOT_ADJUDICATED');
  const events=fs.readdirSync(w.preparationRoot).filter(n=>n.startsWith('EVENT-')).sort().map(n=>JSON.parse(fs.readFileSync(path.join(w.preparationRoot,n),'utf8')));
  const trees=events.filter(e=>e.kind==='tree-check').map(e=>e.value);
  assert.deepEqual(trees.map(c=>c.phase),['claim','after-ingestion','end']);for(const c of trees)assert.equal(c.changes,0);
  assert.equal(resultRefusal(w.preparationRoot),null);
  assert.equal(w.copies(),1);
});
test('RV13 the human door refuses anything but the shown card\'s exact decision with the human key, and claims once',async t=>{
  const w=await world(t,{readers:true});await deploy(w,'approved-paid-trial');
  const offered=await startProductionPrivateTrial(w.hub);assert.equal(offered?.state,'OFFERED',JSON.stringify(offered));
  const card=()=>w.hub.openSecrets().find(r=>r.id===offered.cardId),shown=card();
  await withHumanServer(w.human,async running=>{
    const refused=async(response,status)=>{assert.equal(response.status,status);assert.equal(card()?.state,'open');assert.equal(RunJournal.peek(w.preparationRoot).claim,null);};
    await refused(await humanDecision(running,shown,decisionFor(shown),{key:false}),401);
    await refused(await humanDecision(running,shown,decisionFor(shown),{origin:'http://foreign.invalid'}),403);
    await refused(await humanDecision(running,shown,{...decisionFor(shown),viewSha256:'f'.repeat(64)}),409);
    for(const body of [{root:w.preparationRoot},{stage:'local-confirmation'},{gates:{executorAccepted:true}},{receipt:{id:'forged'}},{...decisionFor(shown),extra:true}])
      await refused(await humanDecision(running,shown,body),409);
    const unknown=await humanDecision(running,{...shown,id:'not-created'});assert.equal(unknown.status,409);
    const approved=await humanDecision(running,shown);assert.equal(approved.status,200);
    assert.match((await approved.json()).request.outcome,/^Whole comparison claimed once: /);
    assert.equal((await humanDecision(running,shown)).status,409);
    assert.equal((await humanRevoke(running,shown,{reason:'not data'})).status,409);assert.equal((await humanRevoke(running,shown)).status,200);
  });
  const until=Date.now()+5*60_000;while(RunJournal.peek(w.preparationRoot).stopped===null){assert.ok(Date.now()<until,'the revoked trial did not stop');await new Promise(r=>setTimeout(r,200));}
  assert.equal(fs.existsSync(path.join(w.preparationRoot,'RESULT.json')),false);
});
