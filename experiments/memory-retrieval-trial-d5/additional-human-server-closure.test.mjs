// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {createOwnedConfiguredHubFixture,writeOwnedConfiguredFixtureTerminal} from './owned-configured-hub-fixture.mjs';
import {withHumanServer} from './human-server.mjs';
import {validateReturnedFixtureClosure} from './fixture-closure.mjs';
import {canonicalBytes,canonicalDocument} from '../../private-trial/canonical-files.mjs';
import {json} from '../memory-retrieval-comparison-d3/contracts.mjs';

const origin={fixtureId:'synthetic-additional-fixture',processId:50};
function data(){
  const names=['additional-server-constructor-attempt','additional-server-returned','additional-server-start-attempt','additional-server-start-returned',
    'additional-server-close-attempt','additional-server-close-returned','additional-server-close-event','additional-server-close-checked'];
  const records=[{sequence:1,event:'server-close'},...names.map((event,index)=>({sequence:index+2,event,additionalServer:1}))];
  return {schema:'owned-configured-hub-fixture-closure-v1',actualD:'NOT_RUN',status:'closed',cleanupPhase:'complete',maximumRecords:4096,
    recordCount:records.length,dropped:0,truncated:false,serverCloseObservationMs:5000,productShutdownStageMs:'unchanged-default',
    rootAttempted:true,rootReturned:true,trialAttempted:true,trialReturned:true,directoryRemoved:true,
    server:{constructorAttempted:true,constructorReturned:true,startAttempted:true,startReturned:true,stopAttempts:1,closed:true},
    hubs:[{ordinal:1,constructorAttempted:true,constructorReturned:true,shutdownAttempts:1,shutdownResolved:true,closed:true,
      stages:[{stage:'history',ms:0,timedOut:false}],categories:[]}],additionalServers:[{schema:'owned-additional-human-server-v1',...origin,ordinal:1,role:'human-server',
      constructorAttempted:true,constructorReturned:true,startAttempted:true,startReturned:true,closeAttempts:1,closeCallReturned:true,
      closeEventObserved:true,listeningAfterClose:false,closed:true,loggerCategories:[],categories:[]}],categories:[],records};
}
async function world(t,options={}){
  const owner=createOwnedConfiguredHubFixture(t,options),root=owner.allocateRoot();owner.createTrialDirectory();owner.constructServer();await owner.startServer();const hub=owner.constructHub();
  const w={hub,constructAdditionalHumanServer:()=>owner.constructAdditionalHumanServer(),startAdditionalHumanServer:s=>owner.startAdditionalHumanServer(s,hub),
    observeAdditionalHumanServerClose:(s,close)=>owner.observeAdditionalHumanServerClose(s,close),refuseAdditionalServerFailure:c=>owner.refuseAdditionalServerFailure(c)};
  return {owner,root,hub,w};
}
const refused=r=>{assert.equal(r.status,'refused');assert.equal(r.directoryRemoved,false);};
const validateTerminal=checkpoint=>validateReturnedFixtureClosure(checkpoint.closure,{fixtureId:checkpoint.fixtureId,processId:checkpoint.provenance.processId});

test('AS01 closed synthetic DATA joins all actual-source row fields without creating ownership',()=>{
  const v=data(),before=json(v);validateReturnedFixtureClosure(v,origin);assert.deepEqual(v,before);
  assert.deepEqual(canonicalDocument(canonicalBytes(v)),v);
  const eventFirst=data();[eventFirst.records[6].event,eventFirst.records[7].event]=[eventFirst.records[7].event,eventFirst.records[6].event];
  validateReturnedFixtureClosure(eventFirst,origin);
});

test('AS02 constructor start and close unknown DATA cannot become closed from a positive status label',()=>{
  for(const key of ['constructorAttempted','constructorReturned','startAttempted','startReturned','closeCallReturned','closeEventObserved','closed']){
    const v=data();v.additionalServers[0][key]=false;assert.throws(()=>validateReturnedFixtureClosure(v,origin));
  }
  for(const change of [r=>{r.listeningAfterClose=true;},r=>{r.listeningAfterClose=null;},r=>{r.closeAttempts=0;},r=>{r.closeAttempts=2;},r=>{delete r.startReturned;}]){
    const v=data();change(v.additionalServers[0]);assert.throws(()=>validateReturnedFixtureClosure(v,origin));
  }
});

test('AS03 exact same fixture worker finite row shape and Logger DATA are required',()=>{
  for(const change of [r=>{r.fixtureId='another-fixture';},r=>{r.processId=51;},r=>{r.processId=true;},r=>{r.ordinal=2;},r=>{r.role='another-role';},
    r=>{r.loggerCategories=['shutdown-warning'];},r=>{r.categories=['additional-server-start-incomplete'];},r=>{r.extra=true;}]){
    const v=data();change(v.additionalServers[0]);assert.throws(()=>validateReturnedFixtureClosure(v,origin));
  }
  assert.throws(()=>validateReturnedFixtureClosure(data()));
});

test('AS04 omitted duplicated reordered or truncated DATA evidence refuses instead of trusting row booleans',()=>{
  for(const change of [v=>{delete v.additionalServers;},v=>{v.additionalServers=[];},v=>{v.additionalServers.push(json(v.additionalServers[0]));},
    v=>{v.records.pop();v.recordCount--;},v=>{v.records[2].event=v.records[1].event;},v=>{v.records[7].event='additional-server-close-attempt';},
    v=>{v.records[2].additionalServer=2;},v=>{v.records[2].extra=true;},v=>{v.records[2].sequence=1;},v=>{v.truncated=true;},v=>{v.dropped=1;}]){
    const v=data();change(v);assert.throws(()=>validateReturnedFixtureClosure(v,origin));
  }
  const empty=data();empty.additionalServers=[];empty.records=[{sequence:1,event:'server-close'}];empty.recordCount=1;
  validateReturnedFixtureClosure(empty);
});

test('AS05 genuine human Server close and same-worker final terminal precede successful fixture removal',async t=>{
  let evidence=null,evidenceIdentity=null,owner=null;
  t.after(async()=>{
    if(evidence===null)return;if(owner){const final=await owner.finalCheckpoint();assert.equal(final.checkpoint.closure.status,'closed');}
    assert.equal(path.dirname(path.resolve(evidence)),fs.realpathSync(tmpdir()));assert.ok(path.basename(evidence).startsWith('additional-human-server-evidence-'));
    const stat=fs.statSync(evidence,{bigint:true});assert.equal(fs.realpathSync(evidence),evidenceIdentity.real);assert.equal(stat.dev,evidenceIdentity.dev);assert.equal(stat.ino,evidenceIdentity.ino);
    fs.unlinkSync(path.join(evidence,'hub-terminal-1.json'));fs.rmdirSync(evidence);
  });
  evidence=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'additional-human-server-evidence-')));const stat=fs.statSync(evidence,{bigint:true});evidenceIdentity={real:evidence,dev:stat.dev,ino:stat.ino};
  const f=await world(t,{writeFinalCheckpoint:c=>writeOwnedConfiguredFixtureTerminal({root:evidence,prefix:'hub',ordinal:1,checkpoint:c})});owner=f.owner;
  let actualClosed=false;
  const value=await withHumanServer(f.w,async running=>{assert.equal(running.server.listening,true);running.server.once('close',()=>{actualClosed=true;});return 17;});
  assert.equal(value,17);assert.equal(actualClosed,true);const final=await owner.finalCheckpoint();assert.equal(final.persistence,'CREATE_NEW_RETURNED');validateTerminal(final.checkpoint);
  const rows=final.checkpoint.closure.additionalServers;assert.equal(rows.length,1);assert.equal(rows[0].processId,process.pid);assert.equal(rows[0].fixtureId,final.checkpoint.fixtureId);
  assert.equal(rows[0].closeAttempts,1);assert.equal(rows[0].closeCallReturned,true);assert.equal(rows[0].closeEventObserved,true);assert.deepEqual(rows[0].loggerCategories,[]);
  assert.equal(f.hub.history.db.isOpen,false);assert.equal(fs.existsSync(f.root),false);assert.equal(final.checkpoint.removalObservation,'ABSENT_AFTER_OWNED_REMOVAL');
  const raw=fs.readFileSync(path.join(evidence,'hub-terminal-1.json'));assert.ok(raw.equals(canonicalBytes(final.checkpoint)));assert.deepEqual(canonicalDocument(raw),final.checkpoint);
});

test('AS06 original body failure survives a genuine successful additional Server close',async t=>{
  const f=await world(t),primary=Error('synthetic body primary');
  await assert.rejects(withHumanServer(f.w,async()=>{throw primary;}),error=>error===primary);
  const final=await f.owner.finalCheckpoint();validateTerminal(final.checkpoint);assert.equal(final.checkpoint.closure.additionalServers[0].closeAttempts,1);assert.equal(fs.existsSync(f.root),false);
});

test('AS07 first close callback policy failure is immutable despite actual event and independent Hub closure',async t=>{
  let f=null,server=null,running=null,first=null,actualClose=null,actualClosed=false;
  t.after(async()=>{if(!f||!server)return;if(first!==null){
      await first.catch(()=>{});assert.equal(actualClosed,true,'failed first close must still have a genuine close event');
      assert.equal(server.listening,false,'unknown first close cannot authorize successful test cleanup');return;}
    await f.owner.observeAdditionalHumanServerClose(server,()=>running?running.close():server.close());
    assert.equal(actualClosed,true);assert.equal(server.listening,false);});
  f=await world(t,{onCleanup:refused});server=f.owner.constructAdditionalHumanServer();
  actualClose=new Promise(resolve=>server.once('close',()=>{actualClosed=true;resolve();}));running=await f.owner.startAdditionalHumanServer(server,f.hub);
  const primary=Error('synthetic post-real-close policy failure');let calls=0;
  const close=async()=>{calls++;await running.close();await actualClose;throw primary;};
  first=f.owner.observeAdditionalHumanServerClose(server,close);await assert.rejects(first,error=>error===primary);
  assert.strictEqual(f.owner.observeAdditionalHumanServerClose(server,close),first);assert.equal(calls,1);
  const final=await f.owner.finalCheckpoint();refused(final.checkpoint.closure);assert.equal(final.checkpoint.closure.additionalServers[0].closeEventObserved,true);
  assert.equal(final.checkpoint.closure.additionalServers[0].closeCallReturned,false);assert.equal(f.hub.history.db.isOpen,false);assert.equal(fs.existsSync(f.root),true);
  assert.throws(()=>validateTerminal(final.checkpoint));assert.equal(calls,1);
});

test('AS08 actual Logger policy warning cannot be discarded after a genuine Server event',async t=>{
  const f=await world(t,{onCleanup:refused});
  await assert.rejects(withHumanServer(f.w,async running=>{f.owner.additionalLoggerFor(running.server).child('policy-probe').warn('synthetic fixed policy warning');}),/fixture_additional_server_closure_refused/);
  const final=await f.owner.finalCheckpoint();refused(final.checkpoint.closure);const row=final.checkpoint.closure.additionalServers[0];
  assert.equal(row.closeEventObserved,true);assert.equal(row.closed,false);assert.deepEqual(row.loggerCategories,['lifecycle-warning']);assert.equal(f.hub.history.db.isOpen,false);assert.equal(fs.existsSync(f.root),true);
  assert.equal(JSON.stringify(final.checkpoint).includes('synthetic fixed policy warning'),false);assert.throws(()=>validateTerminal(final.checkpoint));
});

test('AS09 shared cleanup never closes an open additional Server or removes its diagnostics',async t=>{
  let server=null,running=null,closePromise=null,actualClose=null,actualClosed=false;
  const closeOwned=()=>{if(closePromise!==null)return closePromise;closePromise=(async()=>{if(server){
      if(running)await running.close();else server.close();await actualClose;
      assert.equal(actualClosed,true);assert.equal(server.listening,false);
    }})();return closePromise;};
  t.after(closeOwned);
  const f=await world(t,{onCleanup:refused});server=f.owner.constructAdditionalHumanServer();
  actualClose=new Promise(resolve=>server.once('close',()=>{actualClosed=true;resolve();}));running=await f.owner.startAdditionalHumanServer(server,f.hub);
  try{
    const first=f.owner.finalCheckpoint(),final=await first;refused(final.checkpoint.closure);assert.equal(server.listening,true);
    assert.equal(final.checkpoint.closure.additionalServers[0].closeAttempts,0);assert.equal(final.checkpoint.closure.additionalServers[0].closeEventObserved,false);
    assert.equal(f.hub.history.db.isOpen,false);assert.equal(fs.existsSync(f.root),true);assert.throws(()=>validateTerminal(final.checkpoint));
    await closeOwned();assert.strictEqual(f.owner.finalCheckpoint(),first);assert.equal(final.checkpoint.closure.additionalServers[0].closeEventObserved,false);assert.equal(fs.existsSync(f.root),true);
  }finally{await closeOwned();}
});

test('AS10 a non-function close input cannot acquire callback or closure authority',async t=>{
  let f=null,server=null,running=null,closing=null;
  t.after(async()=>{if(!f||!server)return;closing??=f.owner.observeAdditionalHumanServerClose(server,()=>running?running.close():server.close());await closing;});
  f=await world(t);server=f.owner.constructAdditionalHumanServer();running=await f.owner.startAdditionalHumanServer(server,f.hub);
  for(const value of [true,false,null,{closed:true}])assert.throws(()=>f.owner.observeAdditionalHumanServerClose(server,value),/fixture_additional_server_close_operation_required/);
  assert.equal(f.owner.snapshot().additionalServers[0].closeAttempts,0);
  closing=f.owner.observeAdditionalHumanServerClose(server,()=>running.close());await closing;validateTerminal((await f.owner.finalCheckpoint()).checkpoint);
});
