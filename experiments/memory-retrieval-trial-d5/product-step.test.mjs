// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createOwnedProductFixture} from '../trial-journal/owned-product-local-fixture.mjs';
import {DTrial} from './profile.mjs';import {RunJournal} from '../trial-journal/journal.mjs';
import {createProductStep} from './product-step.mjs';import {prepareProductProfile} from './product-profile.mjs';import {runWholeTrial} from './whole-executor.mjs';
import {encode,sha256,Held,canonical} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {sourceVersion} from '../../dist/memory/provenance.js';
import {dInputs,evidenceFolder} from './test-folders.mjs';
const {root:priorRoot,sources:productSources}=await dInputs('D_PRODUCT_INPUT','D_PRODUCT_SOURCES');
const read=f=>JSON.parse(fs.readFileSync(join(priorRoot,f),'utf8'));
const productEvidence=evidenceFolder('D_PRODUCT_EVIDENCE');
let caseId=0;
async function world(t,options={}){
 const resources=createOwnedProductFixture(t,{evidenceRoot:productEvidence});
 const {root,ownerRoot,server}=resources;await resources.startDouble();
 const w={root,server,resources,live:true,events:[],stops:0,modelCalls:0};
 w.history=resources.constructHistory();const old=read('PREPARED-PROFILE.json'),prep=read('BOUND-PREPARATION.json');
 const sources=JSON.parse(fs.readFileSync(productSources,'utf8')).sources;
 const variants=new Map(old.payloads.variants.map(v=>[v.name,v])),sievePath=join(priorRoot,'SIEVE-VERDICTS.json'),sieve=fs.existsSync(sievePath)?read('SIEVE-VERDICTS.json'):null;
 w.rooms=old.payloads.physicalAddresses.map(g=>({id:'d2-'+g.variant+'-'+g.logicalRoom,uuid:g.room.uuid,name:g.room.name,remembers:true,input:variants.get(g.variant).memoryInput,originalInput:variants.get(g.variant).memoryInput==='whole'}));
 w.product=createProductStep({history:w.history,settings:{apiKey:'synthetic-owned-product-only',baseUrl:server.url},rooms:w.rooms,current:()=>w.live,cap:()=>options.creditCap??0,sieve});
 for(const p of old.payloads.rows){
  const source=sources.find(s=>s.id===p.sourceId),r=w.rooms.find(r=>r.id===p.members[0].identity.roomId);assert.ok(source&&r);
  const row={id:source.id,seq:w.history.maxSeq(r.id)+1,room:source.room,from:source.author,fromName:source.author,ts:Date.parse(source.at),kind:'chat',text:source.text};
  w.history.upsert(r.id,row);w.product.prepare({source:w.history.getById(r.id,row.id),roomId:r.id,variant:p.variant});
 }
 const preparationFile=join(root,'LOCAL-PREPARED.json');fs.writeFileSync(preparationFile,encode(w.product.rows()));
 const paths=old.codePins.map(p=>p.path.replace('memory-retrieval-long-executor-fixture-20261004','memory-retrieval-c-product-step-input-lifetime-20261004'));
 for(const p of ['experiments/memory-retrieval-trial-d5/product-step.mjs','experiments/memory-retrieval-trial-d5/product-profile.mjs','src/memory/zep.ts','dist/memory/zep.js'])paths.push(resolve(p));
 const codePins=[...new Set(paths)].map(path=>({path,sha256:sha256(fs.readFileSync(path))}));
 old.purpose='local-fixture';const prepared=prepareProductProfile({prior:old,preparation:prep,rows:w.product.rows(),account:w.product.provider.generations.account,
  origins:{readBase:server.url,answerEndpoint:new URL('/v1/chat/completions',server.url).href},codePins,preparationPin:{path:preparationFile,sha256:sha256(fs.readFileSync(preparationFile))}});
 w.profile=prepared.profile;w.scope=prepared.scope;w.preparation=prepared.preparation;
 options.profile?.(w.profile,w.scope);w.profile.review.serviceEmissionProofSha256=sha256(encode(w.scope));
 const card=DTrial.prepare(ownerRoot,w.profile);w.owner=DTrial.claim(ownerRoot,{approval:{id:'synthetic-local-product',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+600000).toISOString()},verifyApproval:()=>true,current:()=>w.live});
 resources.retainTrialOwner(w.owner);
 const stop=w.owner.stop.bind(w.owner);w.owner.stop=r=>{w.stops++;return stop(r)};
 const answer=server.answer.bind(server);server.answer=(method,path,body)=>{
  const ledger=RunJournal.inspect(ownerRoot);assert.equal(ledger.state.attempts.filter(a=>a.outcome==='dispatch_uncertain').length,1,'HTTP has prior durable admission and previous outcome flushed');
  options.beforeResponse?.(w,{method,path,body});return answer(method,path,body);
 };
 w.run=async(overrides={})=>{
  let result,error;try{result=await runWholeTrial({owner:w.owner,profile:w.profile,scope:w.scope,preparation:w.preparation,productStep:w.product.productStep,
   current:()=>w.live,fetchImpl:fetch,verifyReceipt:a=>options.verifyReceipt!==false&&w.product.verifyReceipt(a),record:(kind,value)=>w.events.push({kind,value}),
   comparisonPorts:()=>({readPort:{kind:'zep-sdk-3.28.0-read-only',origin:new URL(server.url).origin,purpose:'local-fixture',observe:async()=>{throw new Held('actual_D_NOT_RUN_product_control_only')},search:async()=>{throw Error('search forbidden')}},
    answerPort:{origin:new URL(server.url).origin,purpose:'local-fixture',answerControls:w.profile.manifest.answerControls,answer:async()=>{w.modelCalls++;throw Error('model forbidden')}}}),...overrides});}catch(e){error=e}
  if(productEvidence)fs.writeFileSync(join(productEvidence,`case-${++caseId}.json`),encode({node:process.version,localOnly:true,actualD:'NOT_RUN',modelCalls:w.modelCalls,stops:w.stops,HTTP:w.server.requests,rows:w.product.rows(),result,error:error?{name:error.name,message:error.message,stack:error.stack}:null,owner:w.owner.summary()}),{flag:'wx'});
  if(error)throw error;return result;
 };
 return w;
}
test('actual C: whole 20 graph setup + 34 original/baseline owner dispatches; ACK then deliberate comparison hold, no model',async t=>{
 const w=await world(t),result=await w.run();assert.equal(result.status,'held');assert.equal(result.error,'actual_D_NOT_RUN_product_control_only');
 assert.equal(w.server.graphs.size,20);assert.equal(w.server.requests.filter(r=>r.method==='POST'&&r.path==='/graph').length,34);
 assert.equal(w.owner.summary().state.bindings.length,1);assert.equal(w.modelCalls,0);assert.equal(w.stops,1);assert.equal(w.events.filter(e=>e.kind==='finish').length,1);
 assert.ok(w.product.rows().every(r=>r.state==='accepted'||r.state==='processed'));assert.ok(w.owner.summary().state.attempts.every(a=>a.outcome==='received'));
 const previous=canonical(w.owner.summary());await assert.rejects(w.run(),/comparison_already_started/);assert.equal(canonical(w.owner.summary()),previous);assert.equal(w.stops,1);
 assert.throws(()=>DTrial.claim(join(w.root,'owner'),{approval:{},verifyApproval:()=>true,current:()=>true}));
 const ordered=rows=>rows.toSorted((a,b)=>a.opId.localeCompare(b.opId));const savedRows=canonical(ordered(w.product.rows())),requests=w.server.requests.length;w.resources.closeHistory(w.history);w.history=w.resources.constructHistory();
 const restored=w.history.memoryOutbox.deliveries.list('zep');assert.equal(canonical(ordered(restored)),savedRows);
 const product=createProductStep({history:w.history,settings:{apiKey:'synthetic-owned-product-only',baseUrl:w.server.url},rooms:w.rooms,current:()=>true,cap:()=>0});
 const row=restored[0];assert.throws(()=>product.prepare({source:w.history.getById(row.identity.roomId,row.identity.sourceId),roomId:row.identity.roomId,variant:'baseline-off-current'}),/product_saved_source_requires_its_own_path/);
 assert.equal(w.server.requests.length,requests);
});
test('actual C source edit while native route awaits prevents episode POST and ACK',async t=>{
 let edited=false;const w=await world(t,{beforeResponse(w,r){if(!edited&&r.method==='GET'){edited=true;const row=w.product.rows()[0],s=w.history.getById(row.identity.roomId,row.identity.sourceId);w.history.upsert(row.identity.roomId,{...s,text:s.text+' changed'});}}});
 await assert.rejects(w.run());assert.equal(edited,true);assert.equal(w.server.requests.filter(r=>r.path==='/graph').length,0);assert.equal(w.owner.summary().state.bindings.length,0);assert.equal(w.modelCalls,0);assert.equal(w.stops,1);
});
test('actual C consent revoked after graph create forbids ontology PUT and future direct admission',async t=>{
 const w=await world(t,{beforeResponse(w,r){if(r.path==='/graph/create')w.live=false;}});await assert.rejects(w.run());assert.equal(w.server.requests.length,1);assert.equal(w.stops,1);
 assert.throws(()=>w.owner.admitWrite(w.profile.writePermits[1].id,w.profile.writePermits[1].request));assert.equal(w.server.requests.length,1);
});
test('actual C rotated copy before ingestion prevents all episode writes',async t=>{
 let changed=false;const w=await world(t,{beforeResponse(w,r){if(!changed&&r.method==='GET'){changed=true;const row=w.product.rows()[0];w.history.memoryOutbox.deliveries.rotateCopy('zep',row.identity.roomId,row.identity.roomUuid);}}});
 await assert.rejects(w.run());assert.equal(changed,true);assert.equal(w.server.requests.filter(r=>r.path==='/graph').length,0);assert.equal(w.stops,1);
});
test('actual C setup unknown has no replay, ACK or model fallback',async t=>{
 const w=await world(t);w.server.force.set('/graph/create',{status:503,body:{message:'synthetic unknown'}});await assert.rejects(w.run());assert.equal(w.server.requests.length,1);assert.equal(w.modelCalls,0);assert.equal(w.stops,1);
 assert.equal(w.owner.summary().state.attempts[0].outcome,'unknown');await assert.rejects(w.run());assert.equal(w.server.requests.length,1);
});
test('actual C import authority loss during native route prevents episode write',async t=>{
 let changed=false;const w=await world(t,{beforeResponse(w,r){if(!changed&&r.method==='GET'){changed=true;const row=w.product.rows()[0];w.history.memoryOutbox.importSource(row.identity.roomId,row.identity.sourceId,row.identity.version);}}});
 await assert.rejects(w.run());assert.equal(changed,true);assert.equal(w.server.requests.filter(r=>r.path==='/graph').length,0);assert.equal(w.stops,1);
});
test('actual C all receipts received but receipt verifier refuses binding; no paid fallback',async t=>{
 const w=await world(t,{verifyReceipt:false});await assert.rejects(w.run(),/binding_not_verified/);assert.equal(w.server.episodes.size,34);assert.equal(w.owner.summary().state.bindings.length,0);assert.equal(w.modelCalls,0);assert.equal(w.stops,1);
});
test('actual C changed account after native route response prevents episode POST',async t=>{
 let changed=false;const w=await world(t,{beforeResponse(w,r){if(!changed&&r.method==='GET'){changed=true;w.rooms[0].account='synthetic-wrong-account';}}});
 await assert.rejects(w.run());assert.equal(changed,true);assert.equal(w.server.episodes.size,0);assert.equal(w.stops,1);
});
test('actual C changed original opt-in during setup forbids its next write',async t=>{
 let changed=false;const w=await world(t,{beforeResponse(w,r){if(!changed&&r.path==='/graph/create'&&r.body.graph_id===w.profile.payloads.physicalAddresses.find(g=>g.variant==='original-profile').plannedGraphId){
  changed=true;const room=w.rooms.find(r=>r.originalInput);room.input='excerpts';room.originalInput=false;}}});
 await assert.rejects(w.run());assert.equal(changed,true);assert.equal(w.server.episodes.size,0);assert.equal(w.stops,1);
});
test('actual C unchanged legacy version but changed captured bytes refuses further I/O',async t=>{
 let changed=false;const w=await world(t,{beforeResponse(w,r){if(!changed&&r.method==='GET'){changed=true;const row=w.product.rows()[0],s=w.history.getById(row.identity.roomId,row.identity.sourceId),version=sourceVersion(s);
  const next={...s,audio:[{n:1,words:'   '}]};assert.equal(sourceVersion(next),version);w.history.upsert(row.identity.roomId,next);}}});
 await assert.rejects(w.run());assert.equal(changed,true);assert.equal(w.server.episodes.size,0);assert.equal(w.stops,1);
});
test('actual C unknown episode outcome preserves its reservation and cannot be dispatched again',async t=>{
 const w=await world(t);w.server.force.set('POST /graph',{status:503,body:{message:'synthetic send outcome unknown'}});await assert.rejects(w.run());
 assert.equal(w.server.requests.filter(r=>r.path==='/graph').length,1);const first=w.product.rows()[0];assert.equal(first.state,'unknown');assert.equal(w.history.memoryOutbox.deliveries.latestAttemptStatus(first.opId).reserved,true);
 assert.equal(w.modelCalls,0);await assert.rejects(w.run());assert.equal(w.server.requests.filter(r=>r.path==='/graph').length,1);assert.equal(w.stops,1);
 w.resources.closeHistory(w.history);w.history=w.resources.constructHistory();const saved=w.history.memoryOutbox.deliveries.get(first.opId);assert.equal(canonical(saved),canonical(first));
 assert.equal(w.history.memoryOutbox.deliveries.latestAttemptStatus(first.opId).reserved,true);assert.equal(w.server.requests.filter(r=>r.path==='/graph').length,1);
});

test('actual C existing monthly budget owner stops the next episode without ACK or fallback',async t=>{
 const w=await world(t,{creditCap:1});await assert.rejects(w.run());
 const posted=w.server.requests.filter(r=>r.method==='POST'&&r.path==='/graph');assert.equal(posted.length,1);
 const rows=w.product.rows();assert.equal(rows[0].attempts,1);assert.ok(['accepted','processed'].includes(rows[0].state));
 assert.equal(rows[1].attempts,0);assert.equal(rows[1].state,'prepared');assert.equal(rows[1].externalIds.length,0);
 assert.equal(w.history.memoryOutbox.deliveries.reserved('zep',new Date().toISOString().slice(0,7)),1);
 assert.equal(w.owner.summary().state.bindings.length,0);assert.equal(w.modelCalls,0);assert.equal(w.stops,1);
 await assert.rejects(w.run());assert.equal(w.server.requests.filter(r=>r.method==='POST'&&r.path==='/graph').length,1);
});
