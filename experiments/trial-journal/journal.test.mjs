// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {RunJournal} from './journal.mjs';
import {data,canonical} from './data.mjs';
import {UNKNOWN_REPLAY_WAIT_MS} from '../../dist/memory/delivery.js';
const policy={schema:'viberoom-trial-journal-policy-v1',identity:{purpose:'fixture'},kinds:{episode:2,model:2,read:2},limits:{localEstimatedCredits:3,maxRequestBytes:2048,maxResponseBytes:100,maxAggregateBytes:150,runMs:60000}};
function world(t,options={}){const root=mkdtempSync(join(tmpdir(),'viberoom-trial-journal-'));let owner=null;t.after(()=>{owner?.close();rmSync(root,{recursive:true,force:true});});const card=RunJournal.prepare(root,structuredClone(options.policy??policy)),approval={id:'fixture-human-receipt',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+60000).toISOString()};owner=options.noClaim?null:RunJournal.claim(root,{approval,verifyApproval:()=>true,current:()=>true,validateRequest:()=>true,...options});return {root,card,approval,owner};}
const req={method:'POST',url:'http://127.0.0.1/model',body:{question:'fixture'},maxRetries:0};
function permit(owner,id='model:1',kind='model',estimate=0){return owner.permit({id,kind,request:req,estimate});}
const received={status:200,raw:'{}',latencyMs:1,known:true};
test('default outcome policy keeps an unapproved 404 unknown and terminal',t=>{const {owner}=world(t);permit(owner);assert.equal(owner.outcome(owner.admit('model:1',req),{...received,status:404}),false);assert.equal(owner.summary().state.attempts[0].outcome,'unknown');assert.throws(()=>permit(owner,'model:2'),/trial_stopped/);});
test('reviewed exact negative read is received evidence without releasing consumption',t=>{const request={method:'GET',url:'http://127.0.0.1/owned',body:null,maxRetries:0};const {owner}=world(t,{acceptObservedResponse:(p,r)=>p.kind==='read' && canonical(p.request)===canonical(request) && r.status===404});owner.permit({id:'read:1',kind:'read',request,estimate:0});assert.equal(owner.outcome(owner.admit('read:1',request),{...received,status:404}),true);assert.equal(owner.summary().state.attempts[0].status,404);assert.equal(owner.summary().state.permits[0].consumed,1);assert.throws(()=>owner.admit('read:1',request),/replay_forbidden/);});
test('negative-read classifier crossing deadline preserves capture as unknown and closes admission',t=>{let tick=0;const {owner}=world(t,{clock:()=>tick,acceptObservedResponse:()=>{tick=60001;return true;}});permit(owner);assert.equal(owner.outcome(owner.admit('model:1',req),{...received,status:404}),false);assert.equal(owner.summary().state.attempts[0].outcome,'unknown');assert.equal(JSON.parse(owner.summary().state.attempts[0].capture).raw,'{}');assert.throws(()=>permit(owner,'model:2'),/trial_stopped/);});
test('positive: admission is durable before outcome; no replay even after success',t=>{const {owner,root}=world(t);permit(owner);const a=owner.admit('model:1',req);assert.equal(RunJournal.inspect(root).state.attempts[0].outcome,'dispatch_uncertain');assert.equal(owner.outcome(a,received),true);assert.throws(()=>owner.admit('model:1',req),/replay_forbidden/);assert.equal(owner.summary().state.attempts.length,1);});
test('repeated exact registration writes nothing; replacement refused',t=>{const {owner}=world(t);permit(owner);const before=canonical(owner.summary().state);permit(owner);assert.equal(canonical(owner.summary().state),before);assert.throws(()=>owner.permit({id:'model:1',kind:'model',request:{...req,body:{question:'different'}},estimate:0}),/permit_changed/);});
test('unplanned kind, request drift, registration count and credit bounds',t=>{const {owner}=world(t);assert.throws(()=>permit(owner,'delete:1','delete'));permit(owner,'episode:1','episode',2);assert.throws(()=>permit(owner,'episode:2','episode',2),/registration_estimate_cap/);permit(owner);permit(owner,'model:2');assert.throws(()=>permit(owner,'model:3'),/registration_cap/);assert.throws(()=>owner.admit('model:1',{...req,maxRetries:1}),/not_exactly_permitted/);});
test('an unfinished attempt forbids another request and keeps reservations',t=>{const {owner}=world(t);permit(owner,'episode:1','episode',2);permit(owner,'episode:2','episode',1);owner.admit('episode:1',req);assert.throws(()=>owner.admit('episode:2',req),/unfinished_attempt/);assert.equal(owner.summary().state.permits.find(p=>p.id==='episode:1').consumed,1);assert.equal(owner.summary().state.attempts.length,1);});
for(const status of [null,429,500])test(`unknown/status ${status} stops the entire run without releasing consumption`,t=>{const {owner}=world(t);permit(owner);const a=owner.admit('model:1',req);assert.equal(owner.outcome(a,{...received,status}),false);assert.throws(()=>permit(owner,'model:2'),/trial_stopped/);const s=owner.summary().state;assert.equal(s.attempts[0].outcome,'unknown');assert.equal(s.permits[0].consumed,1);});
test('response per-request cap captures bounded evidence and stops',t=>{const {owner}=world(t);permit(owner);const a=owner.admit('model:1',req);assert.equal(owner.outcome(a,{...received,raw:'x'.repeat(101)}),false);const s=owner.summary().state;assert.equal(s.run.response_bytes,101);assert.equal(JSON.parse(s.attempts[0].capture).raw.length,100);assert.equal(s.run.stopped,'response_cap');});
test('aggregate response cap is shared across all operation kinds',t=>{const {owner}=world(t);permit(owner);permit(owner,'read:1','read');owner.outcome(owner.admit('model:1',req),{...received,raw:'x'.repeat(80)});assert.equal(owner.outcome(owner.admit('read:1',req),{...received,raw:'y'.repeat(80)}),false);assert.equal(JSON.parse(owner.summary().state.attempts[1].capture).raw.length,70);});
test('truncated Unicode capture retains whole scalars within the byte bound',t=>{const {owner}=world(t);permit(owner);const a=owner.admit('model:1',req);assert.equal(owner.outcome(a,{...received,raw:'x'.repeat(99)+'😀'}),false);const raw=JSON.parse(owner.summary().state.attempts[0].capture).raw;assert.equal(raw,'x'.repeat(99));assert.ok(Buffer.byteLength(raw)<=100);});
test('lost authority after dispatch preserves raw diagnostics as unknown',t=>{let allowed=true;const {owner}=world(t,{current:()=>allowed});permit(owner);const a=owner.admit('model:1',req);allowed=false;assert.equal(owner.outcome(a,received),false);assert.equal(JSON.parse(owner.summary().state.attempts[0].capture).raw,'{}');});
test('monotonic run deadline refuses dispatch',t=>{let tick=0;const {owner}=world(t,{clock:()=>tick});permit(owner);tick=60000;assert.throws(()=>owner.admit('model:1',req),/trial_deadline/);assert.equal(owner.summary().state.attempts.length,0);});
test('final current crossing the run deadline rolls back admission, including after reopen',t=>{
  let tick=0,armed=false,calls=0;
  const {owner,root,approval}=world(t,{clock:()=>tick,current:()=>{if(armed && ++calls===2)tick=60001;return true;}});
  permit(owner);const before=canonical(owner.summary().state);armed=true;
  assert.throws(()=>owner.admit('model:1',req),/trial_deadline/);assert.equal(calls,2);
  assert.equal(canonical(RunJournal.inspect(root).state),before);
  assert.throws(()=>RunJournal.claim(root,{approval,verifyApproval:()=>true,current:()=>true,validateRequest:()=>true}),/trial_already_claimed/);
});
test('final current immediately inside the deadline admits exactly one uncertain attempt',t=>{
  let tick=0,armed=false,calls=0;
  const {owner,root}=world(t,{clock:()=>tick,current:()=>{if(armed && ++calls===2)tick=59999;return true;}});
  permit(owner);armed=true;const handle=owner.admit('model:1',req);assert.equal(calls,2);
  const state=RunJournal.inspect(root).state;assert.equal(state.permits[0].consumed,1);assert.equal(state.attempts[0].id,handle.id);assert.equal(state.attempts[0].outcome,'dispatch_uncertain');
});
for(const operation of ['permit','permit-repeat','binding','binding-repeat'])test(`final current deadline refusal preserves the entire ${operation} state`,t=>{
  let tick=0,armed=false,calls=0;
  const {owner,root}=world(t,{clock:()=>tick,current:()=>{if(armed && ++calls===2)tick=60000;return true;}});
  if(operation==='permit-repeat')permit(owner);
  if(operation==='binding-repeat')owner.save('acks',{uuid:'fixture'});
  const before=canonical(owner.summary().state);armed=true;
  assert.throws(()=>operation.startsWith('permit')?permit(owner):owner.save('acks',{uuid:'fixture'}),/trial_deadline/);
  assert.equal(calls,2);assert.equal(canonical(RunJournal.inspect(root).state),before);
});
test('deadline is checked after the SQL profile checkpoint while rollback is possible',t=>{
  let armed=false,reads=0;
  const {owner,root}=world(t,{clock:()=>armed && ++reads>=5?60000:0});permit(owner);
  const before=canonical(owner.summary().state);armed=true;
  assert.throws(()=>owner.admit('model:1',req),/trial_deadline/);assert.equal(reads,5);
  assert.equal(canonical(RunJournal.inspect(root).state),before);
});
test('the final claim callback cannot consume an expired one-shot claim',t=>{
  const {root,approval}=world(t,{noClaim:true});let tick=0,calls=0;
  assert.throws(()=>RunJournal.claim(root,{approval,verifyApproval:()=>true,validateRequest:()=>true,clock:()=>tick,current:()=>{if(++calls===2)tick=60000;return true;}}),/trial_deadline/);
  assert.equal(calls,2);assert.equal(RunJournal.inspect(root).state.run.claim,null);
  const owner=RunJournal.claim(root,{approval,verifyApproval:()=>true,current:()=>true,validateRequest:()=>true});owner.close();
  assert.ok(RunJournal.inspect(root).state.run.claim);
});
test('claim time is rechecked after its final profile checkpoint',t=>{
  const {root,approval}=world(t,{noClaim:true});let reads=0;
  assert.throws(()=>RunJournal.claim(root,{approval,verifyApproval:()=>true,validateRequest:()=>true,current:()=>true,clock:()=>++reads>=4?60000:0}),/trial_deadline/);
  assert.equal(reads,4);assert.equal(RunJournal.inspect(root).state.run.claim,null);
});
test('an expiring request verifier cannot commit a permit',t=>{
  let tick=0,armed=false;const {owner,root}=world(t,{clock:()=>tick,validateRequest:()=>{if(armed)tick=60000;return true;}});
  const before=canonical(owner.summary().state);armed=true;
  assert.throws(()=>permit(owner),/trial_deadline/);assert.equal(canonical(RunJournal.inspect(root).state),before);
});
test('expired outcome capture remains diagnostic and retains uncertain consumption',t=>{
  let tick=0;const {owner,root}=world(t,{clock:()=>tick});permit(owner);const handle=owner.admit('model:1',req);tick=60000;
  assert.equal(owner.outcome(handle,received),false);const state=RunJournal.inspect(root).state;
  assert.equal(state.permits[0].consumed,1);assert.equal(state.attempts[0].outcome,'unknown');assert.equal(JSON.parse(state.attempts[0].capture).raw,'{}');
  assert.throws(()=>permit(owner,'model:2'),/trial_stopped/);
});
for(const operation of ['admit','permit','binding','claim'])test(`approval expiry in the final current refuses ${operation} without a row commit`,t=>{
  const originalNow=Date.now;let wallNow=originalNow(),armed=false,calls=0,expires=0;Date.now=()=>wallNow;
  try{
    const current=()=>{if(armed && ++calls===2)wallNow=expires;return true;};
    const {owner,root,approval}=world(t,{clock:()=>0,current,noClaim:operation==='claim'});expires=Date.parse(approval.expiresAt);
    if(operation==='admit')permit(owner);
    const before=canonical(RunJournal.inspect(root).state);armed=true;
    const invoke=()=>operation==='admit'?owner.admit('model:1',req):operation==='permit'?permit(owner):operation==='binding'?owner.save('acks',{uuid:'fixture'}):RunJournal.claim(root,{approval,verifyApproval:()=>true,validateRequest:()=>true,current,clock:()=>0});
    assert.throws(invoke,/trial_deadline/);assert.equal(calls,2);assert.equal(canonical(RunJournal.inspect(root).state),before);
  }finally{Date.now=originalNow;}
});
test('approval immediately before expiry remains valid at final admission',t=>{
  const originalNow=Date.now;let wallNow=originalNow(),armed=false,calls=0,expires=0;Date.now=()=>wallNow;
  try{
    const {owner,root,approval}=world(t,{clock:()=>0,current:()=>{if(armed && ++calls===2)wallNow=expires-1;return true;}});expires=Date.parse(approval.expiresAt);
    permit(owner);armed=true;const handle=owner.admit('model:1',req);assert.equal(calls,2);assert.equal(RunJournal.inspect(root).state.attempts[0].id,handle.id);
  }finally{Date.now=originalNow;}
});
test('unknown response after approval expiry remains captured without releasing consumption',t=>{
  const originalNow=Date.now;let wallNow=originalNow();Date.now=()=>wallNow;
  try{
    const {owner,root,approval}=world(t,{clock:()=>0});permit(owner);const handle=owner.admit('model:1',req);wallNow=Date.parse(approval.expiresAt);
    assert.equal(owner.outcome(handle,{...received,status:null,known:false}),false);const state=RunJournal.inspect(root).state;
    assert.equal(state.permits[0].consumed,1);assert.equal(state.attempts[0].outcome,'unknown');assert.equal(JSON.parse(state.attempts[0].capture).raw,'{}');
    assert.equal(state.run.stopped,'unknown_or_authority_lost');
  }finally{Date.now=originalNow;}
});
for(const expiry of ['run','approval'])test(`received evidence becomes unknown when final outcome current crosses ${expiry} expiry`,t=>{
  const originalNow=Date.now;let wallNow=originalNow(),tick=0,armed=false,calls=0,expires=0;Date.now=()=>wallNow;
  try{
    const {owner,root,approval}=world(t,{clock:()=>tick,current:()=>{if(armed && ++calls===2){if(expiry==='run')tick=60000;else wallNow=expires;}return true;}});expires=Date.parse(approval.expiresAt);
    permit(owner);const handle=owner.admit('model:1',req);armed=true;
    assert.equal(owner.outcome(handle,received),false);assert.equal(calls,2);
    const state=RunJournal.inspect(root).state;assert.equal(state.permits[0].consumed,1);assert.equal(state.attempts[0].outcome,'unknown');
    assert.equal(JSON.parse(state.attempts[0].capture).raw,'{}');assert.equal(state.run.stopped,'unknown_or_authority_lost');
  }finally{Date.now=originalNow;}
});
test('one-shot claim is never reopened after clean close',t=>{const {root,approval}=world(t,{noClaim:true});const args={approval,verifyApproval:()=>true,current:()=>true,validateRequest:()=>true};const a=RunJournal.claim(root,args);a.close();assert.throws(()=>RunJournal.claim(root,args),/trial_already_claimed/);assert.equal(RunJournal.inspect(root).resumable,false);});
for(const change of ['fingerprint','expiry','denied','not-current'])test(`claim gate ${change} has no durable authorization`,t=>{const {root,approval}=world(t,{noClaim:true});const receipt={...approval};if(change==='fingerprint')receipt.cardSha256='0'.repeat(64);if(change==='expiry')receipt.expiresAt='2000-01-01T00:00:00Z';assert.throws(()=>RunJournal.claim(root,{approval:receipt,verifyApproval:()=>change!=='denied',current:()=>change!=='not-current',validateRequest:()=>true}));assert.equal(RunJournal.inspect(root).state.run.claim,null);});
test('copying a prepared folder cannot copy authority',t=>{const {root}=world(t,{noClaim:true}),parent=mkdtempSync(join(tmpdir(),'viberoom-trial-copy-')),copy=join(parent,'copy');t.after(()=>rmSync(parent,{recursive:true,force:true}));cpSync(root,copy,{recursive:true});assert.throws(()=>RunJournal.inspect(copy));});
test('second preparation cannot erase an existing registry',t=>{const {root,owner}=world(t);permit(owner);assert.throws(()=>RunJournal.prepare(root,policy),/EEXIST/);assert.equal(owner.summary().state.permits.length,1);});
test('immutable saved binding, refused verifier, cancellation are preserved',t=>{const {owner}=world(t);assert.throws(()=>owner.save('acks',{uuid:'a'},()=>false),/binding_not_verified/);assert.equal(owner.get('acks'),null);assert.equal(owner.save('acks',{uuid:'a'}),true);assert.equal(owner.save('acks',{uuid:'a'}),false);assert.throws(()=>owner.save('acks',{uuid:'b'}),/immutable_binding_changed/);owner.stop('cancelled');assert.throws(()=>permit(owner),/trial_stopped/);assert.equal(owner.get('acks').uuid,'a');});
test('accessors, sparse arrays, proxies and hidden values are refused without calls',()=>{let calls=0;const v={get secret(){calls++;return 1;}};for(const input of [v,[,1],new Proxy({},{}),Object.defineProperty({},'x',{value:1})])assert.throws(()=>data(input));assert.equal(calls,0);});
test('SQL trigger collateral changes roll back the allowed write and the collateral ledger',t=>{const {root,owner}=world(t),db=new DatabaseSync(join(root,'trial-journal.sqlite'));db.exec("create table ledger(id integer primary key,reserved integer);insert into ledger values(1,1);create trigger collateral after insert on permits begin update ledger set reserved=0 where id=1;end");assert.throws(()=>permit(owner),/unexpected_trial_sql_delta/);assert.equal(db.prepare('select reserved from ledger').get().reserved,1);assert.equal(owner.summary().state.permits.length,0);db.close();});
test('readonly authority refusal occurs before claim commit',t=>{let changed=false;const {root,approval}=world(t,{noClaim:true});assert.throws(()=>RunJournal.claim(root,{approval,verifyApproval:()=>true,current:()=>{changed=true;return false;},validateRequest:()=>true}),/authority_not_current/);assert.equal(changed,true);assert.equal(RunJournal.inspect(root).state.run.claim,null);});
test('crash after durable admission leaves unknown attempt and forbids restart',t=>{const {root,approval}=world(t,{noClaim:true});const child=spawnSync(process.execPath,[fileURLToPath(new URL('./child.mjs',import.meta.url)),root,JSON.stringify(approval),'crash'],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);const s=RunJournal.inspect(root);assert.equal(s.state.attempts[0].outcome,'dispatch_uncertain');assert.equal(s.state.permits[0].consumed,1);assert.throws(()=>RunJournal.claim(root,{approval,verifyApproval:()=>true,current:()=>true,validateRequest:()=>true}),/trial_already_claimed/);});
test('two independent processes race for one claim; exactly one wins',async t=>{const {root,approval}=world(t,{noClaim:true});const run=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[fileURLToPath(new URL('./child.mjs',import.meta.url)),root,JSON.stringify(approval),'claim'],{stdio:'ignore'});p.once('error',reject);p.once('exit',resolve);});assert.deepEqual((await Promise.all([run(),run()])).sort(),[0,2]);assert.ok(RunJournal.inspect(root).state.run.claim);});

const replayPolicy={...structuredClone(policy),kinds:{episode:2,model:2,read:4},limits:{...policy.limits,localEstimatedCredits:2},replay:{kinds:['read','episode'],reserve:{attempts:1,credits:1}}};
const listing=(graph)=>({method:'POST',url:'http://127.0.0.1/v2/graph/episodes/graph/'+graph,body:{order_by:'uuid',direction:'asc'},maxRetries:0});
const episodeRequest=(graph,opId)=>({method:'POST',url:'http://127.0.0.1/v2/graph',body:{graph_id:graph,type:'text',data:'hello',metadata:{op_id:opId}},maxRetries:0});
const noAnswer={status:null,raw:'',latencyMs:null,known:false,uncertainty:'connection_closed_before_response'};
function replayWorld(t,options={}){
  const clock={now:Date.parse('2026-10-07T09:00:00Z')};
  const w=world(t,{policy:replayPolicy,wallClock:()=>clock.now,...options});w.clock=clock;
  w.owner.permit({id:'episode:1',kind:'episode',request:episodeRequest('g1','op-1'),estimate:1});
  return w;
}
function listed(owner,n,graph,raw){owner.permit({id:'read:'+n,kind:'read',request:listing(graph),estimate:0});return owner.outcome(owner.admit('read:'+n,listing(graph)),{...received,raw});}
test('a transport-uncertain episode write stays unknown and the run goes on; a status or a cap still ends it',t=>{
  const {owner}=replayWorld(t);
  assert.equal(owner.outcome(owner.admit('episode:1',episodeRequest('g1','op-1')),noAnswer),false);
  const s=owner.summary().state;assert.equal(s.attempts[0].outcome,'unknown');assert.equal(s.run.stopped,null);
  assert.equal(listed(owner,1,'g1','[]'),true,'the run still admits requests');
  owner.permit({id:'model:1',kind:'model',request:req,estimate:0});
  assert.equal(owner.outcome(owner.admit('model:1',req),{...received,status:500}),false);
  assert.equal(owner.summary().state.run.stopped,'unknown_or_authority_lost');assert.throws(()=>listed(owner,2,'g1','[]'),/trial_stopped/);
});
test('a transport-uncertain read stays unknown; the next read is a new attempt of its own',t=>{
  const {owner}=replayWorld(t);
  owner.permit({id:'read:1',kind:'read',request:listing('g1'),estimate:0});
  assert.equal(owner.outcome(owner.admit('read:1',listing('g1')),noAnswer),false);
  assert.equal(owner.summary().state.run.stopped,null);
  assert.equal(listed(owner,2,'g1','[]'),true);
  assert.deepEqual(owner.summary().state.attempts.map(a=>[a.permit,a.outcome]),[['read:1','unknown'],['read:2','received']]);
});
test('an unknown episode write goes once more only after a received listing of its graph without the episode, and never a third time',t=>{
  const {owner,clock}=replayWorld(t);
  const request=episodeRequest('g1','op-1');
  assert.equal(owner.outcome(owner.admit('episode:1',request),noAnswer),false);
  assert.throws(()=>owner.admit('episode:1',request),/replay_forbidden/,'no read yet');
  clock.now+=1000;listed(owner,0,'g1','[]');assert.throws(()=>owner.admit('episode:1',request),/replay_forbidden/,'a listing 1 s later proves nothing yet: the product waits UNKNOWN_REPLAY_WAIT_MS');
  clock.now+=UNKNOWN_REPLAY_WAIT_MS;
  listed(owner,1,'g2','[]');assert.throws(()=>owner.admit('episode:1',request),/replay_forbidden/,'another graph proves nothing');
  listed(owner,2,'g1',JSON.stringify([{uuid:'ep-1',metadata:{op_id:'op-1'}}]));assert.throws(()=>owner.admit('episode:1',request),/replay_forbidden/,'the episode is there: no replay');
  listed(owner,3,'g1',JSON.stringify([{uuid:'ep-9',metadata:{op_id:'op-9'}}]));
  assert.equal(owner.outcome(owner.admit('episode:1',request),received),true,'absent: one more submission');
  assert.throws(()=>owner.admit('episode:1',request),/replay_forbidden/,'never a third');
  const s=owner.summary().state;assert.deepEqual(s.attempts.filter(a=>a.permit==='episode:1').map(a=>a.outcome),['unknown','received']);
  assert.equal(s.permits.find(p=>p.id==='episode:1').consumed,2);assert.equal(s.run.stopped,null);
});
test('a received first attempt or a kind outside the section never readmits (a truncated capture ends the run by the cap)',t=>{
  const {owner}=replayWorld(t);
  const request=episodeRequest('g1','op-1');
  assert.equal(owner.outcome(owner.admit('episode:1',request),received),true);
  listed(owner,1,'g1','[]');assert.throws(()=>owner.admit('episode:1',request),/replay_forbidden/,'a received write is final');
  const plain=world(t);plain.owner.permit({id:'episode:1',kind:'episode',request,estimate:1});
  assert.equal(plain.owner.outcome(plain.owner.admit('episode:1',request),noAnswer),false);
  assert.equal(plain.owner.summary().state.run.stopped,'unknown_or_authority_lost','without the section every unknown ends the run');
  const unnamed=replayWorld(t);
  assert.equal(unnamed.owner.outcome(unnamed.owner.admit('episode:1',request),{status:null,raw:'',latencyMs:null,known:false}),false);
  assert.equal(unnamed.owner.summary().state.run.stopped,'unknown_or_authority_lost','an unknown without a named class ends the run even inside the section');
});

test('the reserve is one submission for the whole run: a second permit left unknown cannot replay once it is spent',t=>{
  const {owner,clock}=replayWorld(t);
  owner.permit({id:'episode:2',kind:'episode',request:episodeRequest('g1','op-2'),estimate:1});
  assert.equal(owner.outcome(owner.admit('episode:1',episodeRequest('g1','op-1')),noAnswer),false);
  assert.equal(owner.outcome(owner.admit('episode:2',episodeRequest('g1','op-2')),noAnswer),false);
  clock.now+=UNKNOWN_REPLAY_WAIT_MS;listed(owner,1,'g1','[]');
  assert.equal(owner.outcome(owner.admit('episode:1',episodeRequest('g1','op-1')),received),true,'the reserve: planned attempts 2, credits 2, plus one and one');
  assert.throws(()=>owner.admit('episode:2',episodeRequest('g1','op-2')),/replay_reserve_spent/);
  assert.equal(listed(owner,2,'g1','[]'),true,'after the replay the spent reserve counts in the allowance: a read still goes');
  assert.equal(owner.summary().state.run.stopped,null);
});

test('the wait is the product\'s, measured from the unknown attempt\'s start: one millisecond short is refused, the wait itself admits',t=>{
  const {owner,clock}=replayWorld(t);const request=episodeRequest('g1','op-1'),started=clock.now;
  assert.equal(owner.outcome(owner.admit('episode:1',request),noAnswer),false);
  clock.now=started+UNKNOWN_REPLAY_WAIT_MS-1;listed(owner,1,'g1','[]');assert.throws(()=>owner.admit('episode:1',request),/replay_forbidden/);
  clock.now=started+UNKNOWN_REPLAY_WAIT_MS;listed(owner,2,'g1','[]');assert.equal(owner.outcome(owner.admit('episode:1',request),received),true);
  const at=owner.summary().state.attempts.map(a=>[a.permit,a.at-started]);
  assert.deepEqual(at,[['episode:1',0],['read:1',UNKNOWN_REPLAY_WAIT_MS-1],['read:2',UNKNOWN_REPLAY_WAIT_MS],['episode:1',UNKNOWN_REPLAY_WAIT_MS]],'every admission carries the wall clock\'s time');
});

const costPolicy={...structuredClone(policy),kinds:{read:600,model:2,episode:2},limits:{...policy.limits,maxResponseBytes:4096,maxAggregateBytes:4_000_000,runMs:600_000}};
const readRequest=n=>({method:'GET',url:'http://127.0.0.1/owned/'+n,body:null,maxRetries:0});
function readOnce(owner,n){owner.permit({id:'read:'+n,kind:'read',request:readRequest(n),estimate:0});return owner.outcome(owner.admit('read:'+n,readRequest(n)),{...received,raw:'{"n":'+n+'}'});}
for(const count of [50,500])test(`${count} operations read the journal in full not once while nothing else writes it`,t=>{
  const {owner}=world(t,{policy:costPolicy});const before=owner.fullStateReads();
  for(let n=1;n<=count;n++)assert.equal(readOnce(owner,n),true);
  assert.equal(owner.fullStateReads()-before,0,'no full read per operation');
  const s=owner.summary().state;assert.equal(s.attempts.length,count);assert.ok(s.attempts.every(a=>a.outcome==='received'));
});
test('an owner check asks the authority once; an admission still asks before and after its write',t=>{
  let calls=0;const {owner}=world(t,{current:()=>{calls++;return true;}});permit(owner);
  calls=0;assert.equal(owner.check(),true);assert.equal(calls,1,'one guard for a transaction without writes');
  calls=0;owner.admit('model:1',req);assert.equal(calls,2,'a guard before and after a transaction with writes');
});
test('a write by another connection is seen at the next operation: one full read, and the disk decides',t=>{
  const {owner,root}=world(t,{policy:costPolicy});readOnce(owner,1);
  const other=new DatabaseSync(join(root,'trial-journal.sqlite'));
  try{
  assert.equal(readOnce(owner,2),true);
  other.exec("update permits set estimate=1 where id='read:1'");
  const before=owner.fullStateReads();assert.equal(readOnce(owner,5),true);assert.equal(owner.fullStateReads()-before,1,'exactly one full read');
  assert.equal(owner.summary().state.permits.find(p=>p.id==='read:1').estimate,1,"the row on the disk is the one the journal now holds");
  assert.equal(readOnce(owner,3),true);assert.equal(owner.fullStateReads()-before,1,'and none after it');
  other.exec("update run set stopped='stopped elsewhere' where id=1");
  assert.throws(()=>readOnce(owner,4),/trial_stopped/,'what another connection wrote is the truth');
  }finally{other.close();}
});
test('a transaction that fails after changing the state in memory discards it: the next one reads the disk and sees exactly that',t=>{
  let allowed=true;const {owner}=world(t,{policy:costPolicy,current:()=>allowed,validateRequest:()=>{allowed=false;return true;}});
  assert.throws(()=>owner.permit({id:'read:1',kind:'read',request:readRequest(1),estimate:0}),/authority_not_current/);
  allowed=true;const before=owner.fullStateReads();
  assert.deepEqual(owner.summary().state.permits,[],'the rolled back permit is not on the disk');
  assert.throws(()=>owner.admit('read:1',readRequest(1)),/request_not_exactly_permitted/,'nor in the journal\'s state: it was read again');
  assert.equal(owner.fullStateReads()-before,1);
});
