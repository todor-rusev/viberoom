// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from './policy-assert.mjs';
import invariant from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,fsyncSync,realpathSync,statSync} from 'node:fs';
import {join,normalize} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SqlReadOnlyFence,sqliteTotalChanges} from '../../dist/memory/sql-read-only-fence.js';
import {UNKNOWN_REPLAY_WAIT_MS} from '../../dist/memory/delivery.js';
import {data,fields,text,int,canonical,hash,frozen} from './data.mjs';
import {openObservedJournalDatabase,closeObservedJournalDatabase,openObservedJournalSeed,syncObservedJournalSeed,closeObservedJournalSeed} from './sql-resource-observation.mjs';

const filename='trial-journal.sqlite';
export function rootIdentity(root){const path=realpathSync(root),s=statSync(path,{bigint:true});assert.ok(s.isDirectory());return {path:process.platform==='win32'?normalize(path).toLowerCase():normalize(path),device:String(s.dev),inode:String(s.ino),platform:process.platform};}
function policy(input){
  const p=data(input);fields(p,p.replay===undefined?['schema','identity','kinds','limits']:['schema','identity','kinds','limits','replay']);assert.equal(p.schema,'viberoom-trial-journal-policy-v1');
  assert.ok(Object.keys(p.kinds).length);for(const [kind,cap] of Object.entries(p.kinds)){text(kind);int(cap,1);}
  fields(p.limits,['localEstimatedCredits','maxRequestBytes','maxResponseBytes','maxAggregateBytes','runMs']);
  for(const [k,v] of Object.entries(p.limits))int(v,k==='localEstimatedCredits'?0:1);
  if(p.replay!==undefined){fields(p.replay,['kinds','reserve']);assert.ok(Array.isArray(p.replay.kinds)&&p.replay.kinds.length);for(const k of p.replay.kinds){text(k);assert.ok(Object.hasOwn(p.kinds,k),'replay_kind_unplanned');}assert.equal(new Set(p.replay.kinds).size,p.replay.kinds.length);fields(p.replay.reserve,['attempts','credits']);int(p.replay.reserve.attempts,0);int(p.replay.reserve.credits,0);}
  return p;
}
function read(db){return {run:data(db.prepare('select * from run').get()),permits:db.prepare('select * from permits order by id').all().map(dataRow),attempts:db.prepare('select * from attempts order by id').all().map(dataRow),bindings:db.prepare('select * from bindings order by name').all().map(dataRow)};}
const dataRow=row=>data(row);
function validateStored(db,root){const s=read(db);assert.equal(s.run.id,1);const p=JSON.parse(s.run.policy);policy(p);assert.equal(hash(p),s.run.policy_hash);assert.equal(canonical(rootIdentity(root)),s.run.root);return s;}
function open(root,readOnly=false){return openObservedJournalDatabase(join(realpathSync(root),filename),{readOnly});}

export function episodeListingEvidence(state,{graphId,opId,afterAttemptId}){
  const suffix='/graph/episodes/graph/'+encodeURIComponent(graphId);let latest=null;
  for(const a of state.attempts){
    if(a.id<=afterAttemptId || a.outcome!=='received' || a.capture===null)continue;
    const read=state.permits.find(r=>r.id===a.permit);if(!read || read.kind!=='read')continue;
    const r=JSON.parse(read.request);let path;try{path=new URL(r.url).pathname;}catch{continue;}
    if(r.method!=='POST' || !path.endsWith(suffix))continue;
    const capture=JSON.parse(a.capture);if(capture.truncated || !(capture.status>=200 && capture.status<300))continue;
    let episodes;try{episodes=JSON.parse(capture.raw);}catch{continue;}
    if(!Array.isArray(episodes))continue;
    const mine=episodes.filter(e=>e && typeof e==='object' && e.metadata?.op_id===opId);
    if(mine.length>1)continue;
    latest={attemptId:a.id,startedAt:a.at,present:mine.length===1,uuid:mine.length===1 && typeof mine[0].uuid==='string'?mine[0].uuid:null};
  }
  return latest;
}

export class RunJournal {
  #db;#fence;#root;#policy;#session;#current;#validateRequest;#acceptObservedResponse;#clock;#wallClock;#started;#expires;#ended=false;
  #state=null;#version=null;#fullReads=0;
  #frozenPolicy;
  static prepare(root,input){
    const p=policy(input),binding=rootIdentity(root),file=join(realpathSync(root),filename);
    const fd=openObservedJournalSeed(file,'wx');try{syncObservedJournalSeed(fd);}finally{closeObservedJournalSeed(fd);}
    const db=openObservedJournalDatabase(file);
    try{
      db.exec(`pragma busy_timeout=5000;pragma journal_mode=WAL;pragma synchronous=FULL;
        create table run(id integer primary key check(id=1),root text not null,policy text not null,policy_hash text not null,claim text,approval text,begun_at integer,stopped text,response_bytes integer not null default 0);
        create table permits(id text primary key,kind text not null,request text not null,estimate integer not null,consumed integer not null default 0);
        create table attempts(id integer primary key,permit text not null,at integer not null,outcome text not null,status integer,capture text,response_bytes integer not null default 0);
        create index attempts_permit on attempts(permit);
        create table bindings(name text primary key,value text not null);`);
      db.prepare('insert into run(id,root,policy,policy_hash) values(1,?,?,?)').run(canonical(binding),JSON.stringify(p),hash(p));
      return frozen({schema:'viberoom-trial-journal-card-v1',root:binding,policy:p,cardSha256:hash({root:binding,policy:p})});
    }finally{closeObservedJournalDatabase(db);}
  }
  static inspect(root){const db=open(root,true);try{const s=validateStored(db,root),p=JSON.parse(s.run.policy);return {cardSha256:hash({root:JSON.parse(s.run.root),policy:p}),policy:p,state:s,resumable:false,invoiceCost:null};}finally{closeObservedJournalDatabase(db);}}
  static peek(root){
    const db=open(root,true);
    try{
      const run=db.prepare('select claim,stopped from run where id=1').get(),counts=db.prepare("select count(*) n,sum(outcome='dispatch_uncertain') open from attempts").get();
      const last=db.prepare('select id,permit,outcome from attempts order by id desc limit 1').get();
      return frozen({claim:run?.claim??null,stopped:run?.stopped??null,attempts:Number(counts.n),open:Number(counts.open??0),
        last:last?{id:Number(last.id),permit:String(last.permit),outcome:String(last.outcome)}:null});
    }finally{closeObservedJournalDatabase(db);}
  }
  static claim(root,{approval,verifyApproval,current,validateRequest,acceptObservedResponse=()=>false,clock=()=>performance.now(),wallClock=()=>Date.now()}){
    invariant.equal(typeof wallClock,'function');
    invariant.equal(typeof verifyApproval,'function');invariant.equal(typeof current,'function');invariant.equal(typeof validateRequest,'function');
    invariant.equal(typeof acceptObservedResponse,'function');
    const receipt=data(approval);fields(receipt,['id','cardSha256','expiresAt']);text(receipt.id);assert.match(receipt.cardSha256,/^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(receipt.expiresAt)) && Date.now()<Date.parse(receipt.expiresAt));
    const owner=new RunJournal();owner.#db=open(root);owner.#db.exec('pragma busy_timeout=5000;pragma synchronous=FULL');
    owner.#root=root;owner.#fence=new SqlReadOnlyFence(owner.#db);owner.#clock=clock;owner.#wallClock=wallClock;owner.#started=clock();owner.#expires=Date.parse(receipt.expiresAt);
    try{
      const s=validateStored(owner.#db,root);owner.#policy=JSON.parse(s.run.policy);owner.#frozenPolicy=frozen(owner.#policy);owner.#session=randomUUID();owner.#current=current;owner.#validateRequest=validateRequest;owner.#acceptObservedResponse=acceptObservedResponse;
      assert.equal(receipt.cardSha256,hash({root:JSON.parse(s.run.root),policy:owner.#policy}),'stale_trial_card');
      owner.#tx(expected=>{
        assert.equal(expected.run.claim,null,'trial_already_claimed');assert.equal(expected.run.stopped,null);
        assert.ok(owner.#fence.run(()=>verifyApproval(frozen(receipt),owner.#frozenPolicy)===true),'approval_not_verified');
        assert.ok(owner.#fence.run(()=>current(owner.#frozenPolicy)===true),'authority_not_current');
        const at=Date.now(),approvalText=canonical(receipt);
        owner.#db.prepare('update run set claim=?,approval=?,begun_at=? where id=1 and claim is null and stopped is null').run(owner.#session,approvalText,at);
        Object.assign(expected.run,{claim:owner.#session,approval:approvalText,begun_at:at});owner.#guard();return {value:owner,writes:1,written:{run:true}};
      },false,true);
      return owner;
    }catch(e){closeObservedJournalDatabase(owner.#db);throw e;}
  }
  #deadline(){
    const elapsed=this.#clock()-this.#started;
    assert.ok(Number.isFinite(elapsed) && elapsed>=0 && elapsed<this.#policy.limits.runMs && Date.now()<this.#expires,'trial_deadline');
  }
  #snapshot(){
    const version=this.#dataVersion();
    if(this.#state!==null && version===this.#version)return this.#state;
    const s=validateStored(this.#db,this.#root);this.#fullReads++;
    if(this.#policy!==undefined)assert.equal(canonical(JSON.parse(s.run.policy)),canonical(this.#policy),'trial_policy_changed');
    this.#state=s;this.#version=version;return s;
  }
  #dataVersion(){return Number(this.#db.prepare('pragma data_version').get().data_version);}
  fullStateReads(){return this.#fullReads;}
  #verifyWritten(expected,{run=false,permits=[],attempts=[],bindings=[]}){
    const counts=this.#db.prepare('select (select count(*) from permits) p,(select count(*) from attempts) a,(select count(*) from bindings) b').get();
    assert.ok(Number(counts.p)===expected.permits.length && Number(counts.a)===expected.attempts.length && Number(counts.b)===expected.bindings.length,'trial_rows_changed');
    const same=(row,want)=>assert.ok(row!==undefined && want!==undefined && canonical(data(row))===canonical(want),'trial_rows_changed');
    if(run)same(this.#db.prepare('select * from run').get(),expected.run);
    for(const id of permits)same(this.#db.prepare('select * from permits where id=?').get(id),expected.permits.find(p=>p.id===id));
    for(const id of attempts)same(this.#db.prepare('select * from attempts where id=?').get(id),expected.attempts.find(a=>a.id===id));
    for(const name of bindings)same(this.#db.prepare('select * from bindings where name=?').get(name),expected.bindings.find(b=>b.name===name));
  }
  #guard(){
    assert.equal(this.#ended,false,'trial_stopped');
    const s=this.#snapshot();
    assert.equal(s.run.claim,this.#session,'session_lost');assert.equal(s.run.stopped,null,'trial_stopped');
    this.#deadline();
    assert.ok(this.#fence.run(()=>this.#current(this.#frozenPolicy)===true),'authority_not_current');
    this.#deadline();
    assert.equal(this.#ended,false,'trial_stopped');
  }
  #tx(operation,guard=true,deadline=guard,guardAfter=guard){
    return this.#fence.preserveConnection(ownerCurrent=>{
      this.#db.exec('savepoint trial_owner');
      try{
        if(guard)this.#guard();const expected=this.#snapshot(),before=sqliteTotalChanges(this.#db);
        const {value,writes,written={}}=operation(expected);
        if(guard&&!guardAfter)invariant.equal(writes,0,'single_guard_transaction_writes');
        if(guardAfter)this.#guard();
        assert.equal(sqliteTotalChanges(this.#db)-before,BigInt(writes),'unexpected_trial_sql_delta');
        this.#verifyWritten(expected,written);
        assert.ok(ownerCurrent(),'trial_sql_profile_changed');
        if(deadline)this.#deadline();
        this.#db.exec('release trial_owner');return value;
      }catch(e){
        this.#state=null;this.#version=null;
        this.#db.exec('rollback to trial_owner;release trial_owner');throw e;
      }
    });
  }
  permit(input){
    const p=data(input);fields(p,['id','kind','request','estimate']);assert.match(p.id,/^[A-Za-z0-9:_-]{1,256}$/);text(p.kind);int(p.estimate);
    assert.ok(Object.hasOwn(this.#policy.kinds,p.kind),'unplanned_kind');
    const request=canonical(p.request);assert.ok(Buffer.byteLength(request)<=this.#policy.limits.maxRequestBytes,'request_byte_cap');
    return this.#tx(expected=>{
      assert.ok(this.#fence.run(()=>this.#validateRequest(frozen(p),this.#frozenPolicy)===true),'request_policy_refused');
      const wanted={id:p.id,kind:p.kind,request,estimate:p.estimate,consumed:0},old=expected.permits.find(r=>r.id===p.id);
      if(old){assert.equal(canonical({...old,consumed:0}),canonical(wanted),'permit_changed');return {value:p.id,writes:0};}
      assert.ok(expected.permits.filter(r=>r.kind===p.kind).length<this.#policy.kinds[p.kind],'registration_cap');
      assert.ok(expected.permits.reduce((n,r)=>n+r.estimate,0)+p.estimate<=this.#policy.limits.localEstimatedCredits,'registration_estimate_cap');
      this.#db.prepare('insert into permits(id,kind,request,estimate) values(?,?,?,?)').run(p.id,p.kind,request,p.estimate);
      expected.permits.push(wanted);expected.permits.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);return {value:p.id,writes:1,written:{permits:[p.id]}};
    });
  }
  admit(id,input){
    text(id);const request=canonical(input);
    return this.#tx(expected=>{
      assert.ok(!expected.attempts.some(a=>a.outcome==='dispatch_uncertain'),'unfinished_attempt');
      const p=expected.permits.find(r=>r.id===id);assert.ok(p && p.request===request,'request_not_exactly_permitted');
      const replay=p.consumed!==0;if(replay)assert.ok(this.#replayAdmissible(expected,p),'replay_forbidden');
      const used=expected.attempts.map(a=>expected.permits.find(p=>p.id===a.permit)),reserve=this.#policy.replay?.reserve??{attempts:0,credits:0};
      const replays=expected.permits.reduce((n,r)=>n+Math.max(0,r.consumed-1),0);if(replay)assert.ok(replays<reserve.attempts,'replay_reserve_spent');
      const reserved=replay||replays>0;
      assert.ok(used.filter(r=>r.kind===p.kind).length<this.#policy.kinds[p.kind]+(reserved?reserve.attempts:0),'attempt_cap');
      assert.ok(used.reduce((n,r)=>n+r.estimate,0)+p.estimate<=this.#policy.limits.localEstimatedCredits+(reserved?reserve.credits:0),'attempt_estimate_cap');
      const at=this.#wallClock();int(at,0,Number.MAX_SAFE_INTEGER);this.#db.prepare('update permits set consumed=consumed+1 where id=?').run(id);p.consumed+=1;
      const number=Number(this.#db.prepare("insert into attempts(permit,at,outcome) values(?,?,'dispatch_uncertain')").run(id,at).lastInsertRowid);
      expected.attempts.push({id:number,permit:id,at,outcome:'dispatch_uncertain',status:null,capture:null,response_bytes:0});
      return {value:frozen({id:number,permit:id,kind:p.kind}),writes:2,written:{permits:[id],attempts:[number]}};
    });
  }
  #replayAdmissible(expected,p){
    if(!(this.#policy.replay?.kinds??[]).includes(p.kind) || p.kind!=='episode' || p.consumed!==1)return false;
    const own=expected.attempts.filter(a=>a.permit===p.id);
    if(own.length!==1 || own[0].outcome!=='unknown' || own[0].status!==null)return false;
    const request=JSON.parse(p.request),graphId=request.body?.graph_id,opId=request.body?.metadata?.op_id;
    if(typeof graphId!=='string' || !graphId || typeof opId!=='string' || !opId)return false;
    const evidence=episodeListingEvidence(expected,{graphId,opId,afterAttemptId:own[0].id});
    return evidence!==null && !evidence.present && evidence.startedAt>=own[0].at+UNKNOWN_REPLAY_WAIT_MS;
  }
  outcome(handle,input){
    handle=data(handle);fields(handle,['id','permit','kind']);int(handle.id,1);
    const result=data(input);fields(result,result.uncertainty===undefined?['status','raw','latencyMs','known']:['status','raw','latencyMs','known','uncertainty']);
    if(result.uncertainty!==undefined)invariant.equal(result.uncertainty,'connection_closed_before_response','unknown_uncertainty_class');
    assert.ok(result.status===null || Number.isSafeInteger(result.status) && result.status>=100 && result.status<=599);
    invariant.equal(typeof result.raw,'string');assert.equal(Buffer.from(result.raw).toString('utf8'),result.raw,'invalid_utf8_capture');invariant.ok(result.latencyMs===null || typeof result.latencyMs==='number' && result.latencyMs>=0);invariant.equal(typeof result.known,'boolean');
    return this.#tx(expected=>{
      assert.equal(expected.run.claim,this.#session);const a=expected.attempts.find(a=>a.id===handle.id && a.permit===handle.permit);assert.ok(a && a.outcome==='dispatch_uncertain','outcome_already_recorded');
      invariant.equal(expected.permits.find(p=>p.id===handle.permit)?.kind,handle.kind);
      const bytes=Buffer.byteLength(result.raw),room=Math.max(0,Math.min(this.#policy.limits.maxResponseBytes,this.#policy.limits.maxAggregateBytes-expected.run.response_bytes));
      const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(result.raw).subarray(0,room),{stream:true});
      const cap=bytes>room;let current=false;try{this.#guard();current=true;}catch{}
      const success=result.status!==null && result.status>=200 && result.status<300;
      const permit=expected.permits.find(p=>p.id===handle.permit);
      let known=result.known && current && !cap && (success || this.#fence.run(()=>this.#acceptObservedResponse(frozen({...permit,request:JSON.parse(permit.request)}),frozen(result),this.#frozenPolicy)===true));
      const transportUncertain=!known && result.uncertainty==='connection_closed_before_response' && result.status===null && !result.known && current && !cap && (this.#policy.replay?.kinds??[]).includes(permit.kind);
      if(!known && !transportUncertain)this.#ended=true;
      const outcome=known?'received':'unknown',capture=canonical({...result,raw,truncated:cap,observedBytes:bytes});
      this.#db.prepare('update attempts set outcome=?,status=?,capture=?,response_bytes=? where id=?').run(outcome,result.status,capture,bytes,a.id);
      Object.assign(a,{outcome,status:result.status,capture,response_bytes:bytes});
      const stopped=known||transportUncertain?expected.run.stopped:(cap?'response_cap':'unknown_or_authority_lost');
      this.#db.prepare('update run set response_bytes=response_bytes+?,stopped=? where id=1').run(bytes,stopped);
      expected.run.response_bytes+=bytes;expected.run.stopped=stopped;let writes=2;
      if(known){
        try{this.#guard();}catch{
          known=false;this.#db.prepare("update attempts set outcome='unknown' where id=?").run(a.id);a.outcome='unknown';
          this.#ended=true;
          this.#db.prepare("update run set stopped='unknown_or_authority_lost' where id=1").run();expected.run.stopped='unknown_or_authority_lost';writes+=2;
        }
      }
      return {value:known,writes,written:{run:true,attempts:[a.id]}};
    },false);
  }
  stop(reason='stopped'){text(reason);this.#ended=true;return this.#tx(expected=>{assert.equal(expected.run.claim,this.#session);if(expected.run.stopped!==null)return {value:false,writes:0};this.#db.prepare('update run set stopped=? where id=1').run(reason);expected.run.stopped=reason;return {value:true,writes:1,written:{run:true}};},false);}
  save(name,input,verify=()=>true){assert.match(name,/^[A-Za-z0-9:_-]{1,256}$/);const value=canonical(input);assert.ok(Buffer.byteLength(value)<=this.#policy.limits.maxResponseBytes,'binding_byte_cap');invariant.equal(typeof verify,'function');return this.#tx(expected=>{assert.ok(this.#fence.run(()=>verify(frozen(input))===true),'binding_not_verified');const old=expected.bindings.find(b=>b.name===name);if(old){assert.equal(old.value,value,'immutable_binding_changed');return {value:false,writes:0};}this.#db.prepare('insert into bindings(name,value) values(?,?)').run(name,value);expected.bindings.push({name,value});expected.bindings.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);return {value:true,writes:1,written:{bindings:[name]}};});}
  get(name){const row=this.#db.prepare('select value from bindings where name=?').get(name);return row?JSON.parse(row.value):null;}
  check(){return this.#tx(()=>({value:true,writes:0}),true,true,false);}
  claim(){const s=this.#snapshot();assert.equal(s.run.claim,this.#session,'trial_claim_changed');return s.run.claim;}
  lastAdmission(){
    const s=this.#snapshot();assert.equal(s.run.claim,this.#session,'trial_claim_changed');
    const attempt=s.attempts.at(-1);return attempt?data({attempt,permit:s.permits.find(p=>p.id===attempt.permit)??null}):null;
  }
  summary(){return RunJournal.inspect(this.#root);}
  close(){this.#ended=true;closeObservedJournalDatabase(this.#db);}
}
