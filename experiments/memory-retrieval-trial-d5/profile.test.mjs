// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createOwnedProfileFixture} from '../trial-journal/owned-profile-local-fixture.mjs';
import {join} from 'node:path';
import {ZepClient} from '@getzep/zep-cloud';
import {DTrial,trialPolicy,validateDRequest,prepareWritePermits} from './profile.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';
import {fixtureProfile,trialWorld,bindAllEpisodes,modelAttempt} from './fixture.mjs';
import {budgetRecorder} from './budget-recorder.mjs';
import {canonical,hash} from '../trial-journal/data.mjs';
import {encode} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {evidenceFolder} from './test-folders.mjs';
const profileEvidence=evidenceFolder('D_PROFILE_EVIDENCE');

test('whole LONG policy: the questions × inputs × modes are one-attempt jobs, every planned episode is one exact SDK write, the estimate is their sum',()=>{const p=fixtureProfile(),policy=trialPolicy(p);
  const episodes=p.payloads.rows.flatMap(r=>r.members).length,jobs=p.questions.queries.length*p.payloads.variants.length*3;
  assert.equal(p.questions.queries.length,44);assert.equal(p.payloads.variants.length,2);assert.equal(policy.kinds.model,jobs);assert.equal(p.manifest.jobs.length,jobs);assert.equal(policy.kinds.episode,episodes);
  const estimate=p.writePermits.filter(w=>w.kind==='episode').reduce((n,w)=>n+w.estimate,0);assert.ok(estimate>=episodes);assert.equal(policy.limits.localEstimatedCredits,estimate);
  for(const w of p.writePermits)assert.equal(validateDRequest(w,policy),true);});
for(const [label,change] of [
  ['missing job',p=>p.manifest.jobs.pop()],['duplicated question',p=>p.questions.queries[1]=p.questions.queries[0]],['different corpus',p=>p.manifest.corpusSha256='0'.repeat(64)],
  ['model allowance inflation',p=>p.manifest.limits.maxModelCalls+=1],['local estimate changed',p=>p.manifest.ingestion.localEstimatedCredits-=1],['an input the plan does not name',p=>p.manifest.topology[0].variant='other-input'],['graph count changed',p=>p.manifest.topology.pop()],
  ['episode dropped',p=>p.writePermits.pop()],['body edited',p=>p.writePermits.find(w=>w.kind==='episode').request.body.data+='edited'],['account-wide ontology',p=>delete p.writePermits.find(w=>w.kind==='ontology').request.body.graph_ids],
  ['ontology edited',p=>p.writePermits.find(w=>w.kind==='ontology').request.body.entity_types=[]],['delete endpoint',p=>p.writePermits[0].request.method='DELETE'],['non-loopback fixture',p=>p.origins.readBase='https://example.org/v2'],
  ['model store on',p=>p.manifest.answerControls.requestProfile.store=true],['multiple choices',p=>p.manifest.answerControls.requestProfile.choices=2]
])test(`profile refuses ${label}`,()=>{const p=fixtureProfile();change(p);assert.throws(()=>trialPolicy(p));});
test('SDK 3.28 episode serialization agrees with approved wire including source time/provenance',async()=>{const p=fixtureProfile();let captured;const client=new ZepClient({apiKey:'serialization-only',baseUrl:p.origins.readBase,fetcher:async args=>{captured=JSON.parse(JSON.stringify(args.body));return {ok:true,body:{uuid:'fixture'}};}});for(const [i,m] of p.payloads.rows.flatMap(r=>r.members).entries()){await client.graph.add(m.payload.request,{maxRetries:0});assert.equal(canonical(captured),canonical(p.writePermits.filter(w=>w.kind==='episode')[i].request.body));}});
test('comparison before immutable actual ingestion ACKs is refused',t=>{const {owner,profile}=trialWorld(t);assert.throws(()=>owner.recordAttempt(modelAttempt(profile),1),/comparison_ingestion_not_bound/);assert.equal(owner.summary().state.attempts.length,0);});
test('paid profile refuses a merely prepared/unaccepted D3 even with approval callback true',t=>{const resources=createOwnedProfileFixture(t,{evidenceRoot:profileEvidence}),root=resources.ownerRoot;const p=fixtureProfile();p.purpose='approved-paid-trial';p.origins={readBase:'https://memory.invalid/v2',answerEndpoint:'https://answers.invalid/v1/chat/completions'};for(const w of p.writePermits)w.request.url=w.request.url.replace('http://127.0.0.1:48700','https://memory.invalid');const card=DTrial.prepare(root,p);assert.throws(()=>DTrial.claim(root,{approval:{id:'unverified',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+60000).toISOString()},verifyApproval:()=>true,current:()=>true}),/d3_review_pending/);assert.equal(RunJournal.inspect(root).state.run.claim,null);});
test('ACK binding refuses missing, unknown or different actual product acceptance',t=>{const {owner,profile}=trialWorld(t);const p=profile.writePermits.find(w=>w.kind==='episode'),handle=owner.admitWrite(p.id,p.request);owner.outcome(handle,{status:202,raw:'{"uuid":"correct"}',latencyMs:1,known:true});assert.throws(()=>owner.bindIngestion({manifestSha256:hash(Buffer.from(JSON.stringify(profile.manifest,null,2)+'\n')),episodes:[]},()=>true));assert.equal(owner.summary().state.bindings.length,0);});
test('every planned episode\'s synthetic ACK binds before a model; exact logical job and limits are enforced',t=>{const {owner,profile}=trialWorld(t);const episodes=profile.writePermits.filter(w=>w.kind==='episode').length;const ack=bindAllEpisodes(owner,profile);assert.equal(ack.episodes.length,episodes);const a=modelAttempt(profile);assert.equal(owner.recordAttempt(a,1),true);const s=owner.summary();assert.equal(s.state.attempts.length,episodes+1);assert.equal(s.state.attempts[episodes].outcome,'dispatch_uncertain');assert.equal(owner.recordBudgetOutcome(1,{httpStatus:200,response:'{"choices":[]}',latencyMs:1,status:'received'}),true);assert.throws(()=>owner.recordAttempt(modelAttempt(profile,1,2),1),/replay_forbidden/);assert.equal(s.invoiceCost,null);});
for(const [label,change] of [['wrong job',a=>a.body.messages[1].content='Question:\nother\n\nContext:\nx'],['prompt edited',a=>a.body.messages[0].content+='edited'],['wrong model',a=>a.body.model='other'],['generic legacy max_tokens',a=>a.body.max_tokens=1024],['hidden retry',a=>a.maxRetries=1],['output cap changed',a=>a.body.max_completion_tokens=2048],['context >4096 bytes',a=>a.body.messages[1].content+='x'.repeat(4097)],['origin edited',a=>a.url='http://127.0.0.1:48702/v1/chat/completions']])test(`model request refuses ${label}`,()=>{const p=fixtureProfile(),a=modelAttempt(p),r={...a.request};delete r.inputTextUtf8Bytes;delete r.requestUtf8Bytes;change(r);assert.throws(()=>validateDRequest({id:'model:1',kind:'model',request:r,estimate:0},trialPolicy(p)));});
test('read allows owned graph, bounded pages/search; refuses outside scope and endpoint writes',()=>{const p=fixtureProfile(),policy=trialPolicy(p),graph=p.manifest.topology[0].graphId;
  const good=[{method:'GET',url:p.origins.readBase+'/graph/'+graph,body:null,maxRetries:0},{method:'POST',url:p.origins.readBase+'/graph/episodes/graph/'+graph,body:{limit:50,direction:'asc',order_by:'uuid'},maxRetries:0},{method:'POST',url:p.origins.readBase+'/graph/search',body:{graph_id:graph,query:p.questions.queries[0].query,scope:'edges',limit:12,reranker:'cross_encoder'},maxRetries:0}];
  for(const r of good)assert.equal(validateDRequest({id:'read:1',kind:'read',request:r,estimate:0},policy),true);
  for(const r of [{...good[0],url:p.origins.readBase+'/graph/foreign'}, {...good[1],body:{...good[1].body,limit:51}}, {...good[0],method:'DELETE'}, {...good[0],url:p.origins.readBase+'/graph/episodes/foreign'}]){assert.throws(()=>{assert.equal(validateDRequest({id:'read:1',kind:'read',request:r,estimate:0},policy),true);});}
});
test('budget adapter persists before I/O, flushes previous outcome, and burns unknown final attempt',t=>{const {owner,profile}=trialWorld(t);bindAllEpisodes(owner,profile);const budget={attempts:[]},recorder=budgetRecorder(owner,{getBudget:()=>budget,getLogicalJobId:()=>2});
  const a={number:1,kind:'read',status:'attempted',response:null,error:null,responseBytes:null,latencyMs:null,vendorCost:null,request:{method:'GET',url:profile.origins.readBase+'/graph/'+profile.manifest.topology[0].graphId,body:null,maxRetries:0}};budget.attempts.push(a);assert.equal(recorder.recordAttempt(a),true);assert.equal(owner.summary().state.attempts.at(-1).outcome,'dispatch_uncertain');Object.assign(a,{status:'received',httpStatus:200,response:'{}',latencyMs:1});
  const b=modelAttempt(profile,2,2);budget.attempts.push(b);assert.equal(recorder.recordAttempt(b),true);assert.equal(owner.summary().state.attempts.at(-2).outcome,'received');const s=recorder.finish();assert.equal(s.state.attempts.at(-1).outcome,'unknown');assert.ok(s.state.run.stopped);assert.equal(s.resumable,false);
});
test('pending native UUID is never admitted; bound UUID is allowed without general episode access',t=>{const {owner,profile}=trialWorld(t);const ack=bindAllEpisodes(owner,profile),a={number:1,kind:'read',status:'attempted',response:null,request:{method:'GET',url:profile.origins.readBase+'/graph/episodes/foreign',body:null,maxRetries:0}};assert.throws(()=>owner.recordAttempt(a));a.request.url=profile.origins.readBase+'/graph/episodes/'+ack.episodes[0].uuid;assert.equal(owner.recordAttempt(a),true);assert.equal(owner.summary().state.attempts.at(-1).outcome,'dispatch_uncertain');});
test('current code pin drift refuses claim before any attempt or credential loading',t=>{const resources=createOwnedProfileFixture(t,{evidenceRoot:profileEvidence}),root=resources.ownerRoot;const p=fixtureProfile(),path=join(root,'owned-code.mjs');writeFileSync(path,'before');p.codePins=[{path,sha256:hash(readFileSync(path))}];const card=DTrial.prepare(root,p);writeFileSync(path,'after');assert.throws(()=>DTrial.claim(root,{approval:{id:'local',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+60000).toISOString()},verifyApproval:()=>true,current:()=>true}));assert.equal(RunJournal.inspect(root).state.run.claim,null);});
test('all explicit jobs fit one common model/request profile',()=>{const p=fixtureProfile(),policy=trialPolicy(p);for(const j of p.manifest.jobs){const a=modelAttempt(p,j.order,j.order),r={...a.request};delete r.inputTextUtf8Bytes;delete r.requestUtf8Bytes;assert.equal(validateDRequest({id:`model:${j.order}`,kind:'model',request:r,estimate:0},policy),true);}});
test('real SDK/HTTP loopback sees durable admission first; unknown response permits no retry',async t=>{
  const resources=createOwnedProfileFixture(t,{evidenceRoot:profileEvidence}),root=resources.ownerRoot;let owner=null,seen=0,wire;
  const server=resources.constructHttpServer();server.on('request',async(req,res)=>{seen++;const chunks=[];for await(const c of req)chunks.push(c);wire=JSON.parse(Buffer.concat(chunks));const state=RunJournal.inspect(root).state;assert.equal(state.attempts.length,1);assert.equal(state.attempts[0].outcome,'dispatch_uncertain');res.destroy();});
  await resources.startHttpServer();
  const p=fixtureProfile();p.origins.readBase=`http://127.0.0.1:${server.address().port}/v2`;p.writePermits=prepareWritePermits(p.payloads,p.origins.readBase);
  const card=DTrial.prepare(root,p);owner=resources.retainTrialOwner(DTrial.claim(root,{approval:{id:'http-fixture',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+60000).toISOString()},verifyApproval:()=>true,current:()=>true}));
  const first=p.writePermits.find(w=>w.kind==='episode'),member=p.payloads.rows.flatMap(r=>r.members)[0];
  const client=new ZepClient({apiKey:'fixture-key-never-saved',baseUrl:p.origins.readBase,fetcher:async args=>{
    const request={method:args.method,url:args.url,body:JSON.parse(JSON.stringify(args.body)),maxRetries:args.maxRetries};const handle=owner.admitWrite(first.id,request);
    try{await fetch(request.url,{method:request.method,body:JSON.stringify(request.body),headers:{'content-type':'application/json'},redirect:'error'});assert.fail('response intentionally unknown');}
    catch{owner.outcome(handle,{status:null,raw:'',latencyMs:1,known:false});return {ok:false,error:{reason:'unknown'}};}
  }});
  await assert.rejects(client.graph.add(member.payload.request,{maxRetries:0}));assert.equal(seen,1);assert.equal(canonical(wire),canonical(first.request.body));assert.throws(()=>owner.admitWrite(first.id,first.request),/trial_stopped/);assert.equal(seen,1);assert.equal(JSON.stringify(owner.summary()).includes('fixture-key-never-saved'),false);
});
test('the paid trial speaks https, or plain http only to this machine; a local fixture only to this machine',()=>{
  const at=(purpose,base,answer)=>{const p=fixtureProfile();p.purpose=purpose;p.origins={readBase:base+'/v2',answerEndpoint:answer+'/v1/chat/completions'};
    for(const w of p.writePermits)w.request.url=w.request.url.replace('http://127.0.0.1:48700',base);return ()=>trialPolicy(p);};
  for(const base of ['https://memory.invalid','http://127.0.0.1:48700','http://localhost:48700'])assert.doesNotThrow(at('approved-paid-trial',base,base));
  for(const base of ['http://memory.invalid','http://10.0.0.2:48700'])assert.throws(at('approved-paid-trial',base,'https://answers.invalid'));
  assert.throws(at('approved-paid-trial','https://memory.invalid','http://answers.invalid'));
  assert.doesNotThrow(at('local-fixture','http://127.0.0.1:48700','http://127.0.0.1:48700'));
  for(const base of ['https://memory.invalid','https://127.0.0.1:48700'])assert.throws(at('local-fixture',base,'http://127.0.0.1:48700'));
});
test('the ingestion receipts digest is the saved record\'s, not the key order of the receipts handed in',t=>{
  const {owner,profile}=trialWorld(t);assert.throws(()=>owner.ingestionReceiptSha256(),/ingestion_not_bound/);
  const ack=bindAllEpisodes(owner,profile),saved=JSON.parse(canonical(ack));
  assert.notEqual(JSON.stringify(ack),JSON.stringify(saved),'the receipts handed in are not in the saved key order');
  assert.equal(owner.ingestionReceiptSha256(),hash(encode(saved)));assert.notEqual(owner.ingestionReceiptSha256(),hash(encode(ack)));
});
