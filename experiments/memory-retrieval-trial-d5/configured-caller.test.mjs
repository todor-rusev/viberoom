// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';
import {createConfiguredCaller} from './configured-caller.mjs';import {encode,sha256} from '../memory-retrieval-comparison-d3/contracts.mjs';
const selection={roomIds:Array.from({length:20},(_,n)=>'room-'+n),opIds:Array.from({length:34},(_,n)=>'op-'+n),answerKeyOwner:'memory.filter.apiKey',answerEndpoint:'http://127.0.0.1:4000/v1/chat/completions',answerModel:'fixture-model'};
function world(){
 let snapshots=0,secretReads=0;
 const metadata={accountId:'local-account',readBase:'http://127.0.0.1:4000',loadedRevision:'synthetic-loaded-instance',configurationRevision:'synthetic-store:0',cap:0,
  answer:{owner:selection.answerKeyOwner,endpoint:selection.answerEndpoint,model:selection.answerModel},rooms:[],members:[],routes:[]};
 const hub={memoryTrialContext:chosen=>{assert.deepEqual(chosen,selection);return {snapshot:()=>{snapshots++;return metadata}};},history:{},memoryStore:{get(){secretReads++;throw Error('secret getter must not run');}}};
 const profile={purpose:'approved-job',origins:{readBase:metadata.readBase,answerEndpoint:metadata.answer.endpoint},manifest:{answerControls:{model:metadata.answer.model}},review:{},codePins:[]},scope={members:[],graphs:[]};
 return {hub,metadata,profile,scope,snapshots:()=>snapshots,secretReads:()=>secretReads};
}
function projectRecord(t,w,kind='synthetic-local-project'){
 const root=fs.mkdtempSync(path.join(tmpdir(),'configured-project-source-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const save=(name,value)=>{const file=path.join(root,name);fs.writeFileSync(file,encode(value));return {path:file,sha256:sha256(fs.readFileSync(file))};};
 const evidencePin=save('EVIDENCE.json',{fixtureOnly:true,provider:'zep',project:'fixture-project',qualification:'not a vendor observation'});
 const subject={provider:'zep',accountId:w.metadata.accountId,readBase:w.metadata.readBase,projectId:'fixture-project',evidencePin};
 const reviewProofPin=save('REVIEW.json',{schema:'configured-project-source-review-v1',decision:'LOCAL_FIXTURE_ONLY',subjectSha256:sha256(encode(subject)),reviewer:{name:'fixture-agent',kind:'agent'}});
 const projectAssociationPin=save('PROJECT.json',{schema:'configured-zep-project-association-v1',provider:subject.provider,accountId:subject.accountId,readBase:subject.readBase,projectId:subject.projectId,provenance:{kind,evidencePin,reviewProofPin}});
 return {projectAssociationPin,evidencePin,reviewProofPin};
}
test('a configured Hub is used directly and missing genuine project association refuses before secret/claim',()=>{
 const w=world(),caller=createConfiguredCaller({hub:w.hub,selection});assert.throws(()=>caller.capture(w.profile,w.scope),/configured_project_association_missing/);assert.equal(w.secretReads(),0);assert.ok(w.snapshots()>0);
});
test('endpoint-compatible metadata cannot replace a wrong explicitly selected answer owner',()=>{
 const w=world();w.metadata.answer.owner='another-owner';const caller=createConfiguredCaller({hub:w.hub,selection});assert.throws(()=>caller.capture(w.profile,w.scope),/configured_trial_contract_refused/);assert.equal(w.secretReads(),0);
});
test('synthetic project provenance and local review can never qualify an approved-job association',t=>{
 const w=world(),pins=projectRecord(t,w),caller=createConfiguredCaller({hub:w.hub,selection,projectAssociationPin:pins.projectAssociationPin});assert.throws(()=>caller.capture(w.profile,w.scope),/configured_trial_contract_refused/);assert.equal(w.secretReads(),0);
});
test('renaming synthetic evidence to reviewed does not substitute for the named accepted source review',t=>{
 const w=world(),pins=projectRecord(t,w,'reviewed-provider-project'),caller=createConfiguredCaller({hub:w.hub,selection,projectAssociationPin:pins.projectAssociationPin});assert.throws(()=>caller.capture(w.profile,w.scope),/configured_trial_contract_refused/);assert.equal(w.secretReads(),0);
});
test('changed project evidence pin refuses before any postclaim credential copy',t=>{
 const w=world();w.profile.purpose='local-fixture';const pins=projectRecord(t,w);fs.appendFileSync(pins.evidencePin.path,' ');
 const caller=createConfiguredCaller({hub:w.hub,selection,projectAssociationPin:pins.projectAssociationPin});assert.throws(()=>caller.capture(w.profile,w.scope),/configured_trial_contract_refused/);assert.equal(w.secretReads(),0);
});
test('stale already-loaded metadata refuses rather than loading/verifying a provider or searching another key owner',()=>{
 const w=world();w.hub.memoryTrialContext=()=>({snapshot:()=>null});const caller=createConfiguredCaller({hub:w.hub,selection});assert.throws(()=>caller.capture(w.profile,w.scope),/configured_provider_absent_stale_or_scope_changed/);assert.equal(w.secretReads(),0);
});
test('absent project association blocks the launch before owner inspection or credential reads',async()=>{
 const w=world(),caller=createConfiguredCaller({hub:w.hub,selection});await assert.rejects(caller.launch({profile:w.profile,scope:w.scope,ownerRoot:'not-an-owner'}),/configured_project_association_missing/);assert.equal(w.secretReads(),0);
});
