// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {RunJournal} from './journal.mjs';
import {canonical,hash} from './data.mjs';
import {localResourceFamily,journalSourcePaths,SHARED_RESOURCE_SCHEMA} from './local-resource-families.mjs';
import {createOwnedLocalFixture} from '../../private-trial/trial-journal/owned-local-fixture-core.mjs';
import {validateReturnedLocalResourceClosure} from '../../private-trial/trial-journal/local-resource-closure-v2.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
function synthetic(family='product-step'){
  const d=localResourceFamily(family),app=resolve(tmpdir(),'synthetic-source-only'),root=resolve(tmpdir(),'synthetic-ledger-only'),external=resolve(tmpdir(),'synthetic-external-only');
  const fixtureId='11111111-1111-4111-8111-111111111111',writer={processId:11,parentProcessId:10};
  const initial={path:root,device:'1',inode:'2',birthtimeNs:'3',platform:process.platform};
  const pin=path=>({path,bytes:1,sha256:hash(Buffer.from('x'))});
  const pins={selectorPin:pin(join(app,d.selector)),sourceOwnerPin:pin(join(app,d.ownerSource)),
    coreSourcePin:pin(join(app,'private-trial/trial-journal/owned-local-fixture-core.mjs')),
    descriptorSourcePin:pin(join(app,'private-trial/trial-journal/local-resource-families.mjs')),
    validatorSourcePin:pin(join(app,'private-trial/trial-journal/local-resource-closure-v2.mjs')),
    observerSourcePins:d.namespaces.map(namespace=>({namespace,pin:pin(join(app,journalSourcePaths(namespace).observer))})),
    journalSourcePins:d.namespaces.map(namespace=>({namespace,pin:pin(join(app,journalSourcePaths(namespace).journal))}))};
  const rawPin=(name,record)=>{const b=Buffer.from(canonical(record)+'\n');return {path:join(external,name),bytes:b.length,sha256:hash(b)};};
  const base={constructorAttempted:true,constructorReturned:true,openAfterConstructor:true,startAttempted:false,startReturned:false,
    closeAttempts:1,closeCallReturned:true,closeEventObserved:null,openAfterClose:false};
  const acquired=[];
  if(d.http==='double')acquired.push({...base,id:'server:1',kind:'http',path:null,openAfterConstructor:false,startAttempted:true,startReturned:true,closeEventObserved:true});
  if(d.histories)acquired.push({...base,id:'history:1',kind:'sqlite-history',path:join(root,'history.db')});
  for(const namespace of d.namespaces){acquired.push({...base,id:`seed:${namespace}:1`,kind:'file-journal-seed',path:join(root,'owner','trial-journal.sqlite')});
    acquired.push({...base,id:`journal:${namespace}:1`,kind:'sqlite-journal',path:join(root,'owner','trial-journal.sqlite')});}
  const ownershipRecord={schema:'resident-owned-local-fixture-root-v2',family,fixtureId,selector:d.selector,...pins,nodeVersion:process.version,writer,initial};
  const ownershipPin=rawPin(`local-ledger-ownership-${fixtureId}.json`,ownershipRecord);
  const acquisitionRecords=acquired.map(row=>{const namespace=row.id.startsWith('journal:')||row.id.startsWith('seed:')?row.id.split(':')[1]:null;
    const record={schema:'resident-owned-local-resource-acquisition-v2',fixtureId,selector:d.selector,writer,initial,id:row.id,kind:row.kind,path:row.path,namespace,
      observerSourcePin:namespace===null?null:pins.observerSourcePins.find(p=>p.namespace===namespace).pin,
      journalSourcePin:namespace===null?null:pins.journalSourcePins.find(p=>p.namespace===namespace).pin};
    return {pin:rawPin(`local-ledger-${fixtureId}-${row.id.replaceAll(':','-')}-acquire.json`,record),record};});
  const terminal={schema:SHARED_RESOURCE_SCHEMA,family,fixtureId,selector:d.selector,...pins,nodeVersion:process.version,writer,
    root:{initial,ownershipPin,beforeRemoval:initial,removed:true,afterRemoval:'absent'},acquired,acquisitionPins:acquisitionRecords.map(p=>p.pin),released:acquired.map(r=>r.id),
    constructorUnknowns:[],teardownUnknowns:[],loggerCategories:[],traceComplete:true,status:'closed'};
  return clone({terminal,retainedWriter:{...writer,birthIdentity:'133000000000000001',...pins,ownershipPin,ownershipRecord,acquisitionRecords}});
}
const verify=x=>validateReturnedLocalResourceClosure(x.terminal,{selector:x.terminal.selector,nodeVersion:process.version,retainedWriter:x.retainedWriter});
const refuses=(change,family='product-step')=>{const x=synthetic(family);change(x);assert.throws(()=>verify(x));};
test('SF01 all three closed source families validate synthetic DATA without a genuine resource or paid brand',()=>{
  for(const family of ['product-step','private-launch','profile']){const x=synthetic(family),result=verify(x);assert.equal(canonical(result),canonical(x.terminal));assert.ok(Object.isFrozen(result));assert.equal(Object.hasOwn(result,'paid'),false);}
});
test('SF02 unknown family or selector, absent mandatory resources and arbitrary factory paths refuse',()=>{
  assert.throws(()=>localResourceFamily('unimplemented-family'),/not_implemented/);assert.throws(()=>localResourceFamily({family:'profile'}));
  refuses(x=>{x.terminal.selector='experiments/memory-retrieval-trial-d5/whole-executor.test.mjs';});
  refuses(x=>{x.terminal.sourceOwnerPin.path=join(dirname(x.terminal.sourceOwnerPin.path),'arbitrary.mjs');});
  refuses(x=>{x.terminal.acquired=[];x.terminal.released=[];});refuses(x=>{x.terminal.acquired=x.terminal.acquired.filter(r=>r.kind!=='file-journal-seed');});
});
test('SF03 exact ordered dual native namespaces and source/journal raw joins are mandatory',()=>{
  refuses(x=>{x.terminal.observerSourcePins.reverse();},'private-launch');
  refuses(x=>{x.retainedWriter.journalSourcePins[1].pin.sha256='b'.repeat(64);},'private-launch');
  refuses(x=>{x.retainedWriter.acquisitionRecords.at(-1).record.namespace='experiment';},'private-launch');
  refuses(x=>{x.terminal.acquired.at(-1).id='journal:experiment:1';},'private-launch');
  const subset=synthetic('private-launch');subset.terminal.acquired=subset.terminal.acquired.filter(r=>!r.id.includes(':private:'));
  subset.terminal.released=subset.terminal.acquired.map(r=>r.id);subset.retainedWriter.acquisitionRecords=subset.retainedWriter.acquisitionRecords.filter(r=>r.record.namespace!=='private');
  subset.terminal.acquisitionPins=subset.retainedWriter.acquisitionRecords.map(r=>r.pin);assert.equal(verify(subset).observerSourcePins.length,2);
});
test('SF04 close call, real SQLite open state and HTTP event are separate required facts',()=>{
  refuses(x=>{x.terminal.acquired[0].closeEventObserved=false;});refuses(x=>{x.terminal.acquired.at(-1).openAfterClose=null;});
  refuses(x=>{x.terminal.acquired.at(-2).closeAttempts=2;});refuses(x=>{x.terminal.acquired.at(-2).closeCallReturned=false;});
});
test('SF05 unknown constructor/logger/trace/removal never promotes to an owned closed origin',()=>{
  refuses(x=>{x.terminal.constructorUnknowns=['journal:experiment:1'];});refuses(x=>{x.terminal.teardownUnknowns=[{id:'x',category:'unknown'}];});
  refuses(x=>{x.terminal.loggerCategories=[{id:'history:1',category:'close-warning'}];});refuses(x=>{x.terminal.traceComplete=false;});
  refuses(x=>{x.terminal.root.removed=false;});refuses(x=>{x.terminal.root.beforeRemoval.inode='99';});
});
test('SF06 raw original bytes and retained writer birth/version/selector equality stay exact',()=>{
  refuses(x=>{x.retainedWriter.acquisitionRecords[0].pin.bytes++;});refuses(x=>{x.retainedWriter.ownershipRecord.fixtureId='22222222-2222-4222-8222-222222222222';});
  refuses(x=>{x.retainedWriter.processId++;});for(const value of [true,0,'0','01','-1'])refuses(x=>{x.retainedWriter.birthIdentity=value;});
  refuses(x=>{x.terminal.nodeVersion='v0.0.0';});refuses(x=>{x.terminal.root.ownershipPin.path=join(x.terminal.root.initial.path,'nested','inside.json');});
});
test('SF07 source family resource limits reject a HistoryStore or server count from the wrong family',()=>{
  refuses(x=>{x.terminal.acquired.push({...clone(x.terminal.acquired[0]),id:'history:1',kind:'sqlite-history',path:join(x.terminal.root.initial.path,'history.db')});},'profile');
  refuses(x=>{x.terminal.acquired.push({...clone(x.terminal.acquired[0]),id:'server:2'});});
});
test('SF08 huge sparse/accessor/proxy/extra data refuses before invoking caller getters',()=>{
  const x=synthetic();x.terminal.acquired=new Array(1e9);assert.throws(()=>verify(x),/array_bound/);
  const y=synthetic();let reads=0;Object.defineProperty(y.terminal,'status',{enumerable:true,get(){reads++;return 'closed';}});assert.throws(()=>verify(y));assert.equal(reads,0);
  refuses(z=>{z.terminal.extra=true;});refuses(z=>{z.terminal.acquired=new Proxy([],{});});
});
const policy={schema:'viberoom-trial-journal-policy-v1',identity:{purpose:'inert-shared-resource-control'},kinds:{read:1},
  limits:{localEstimatedCredits:0,maxRequestBytes:256,maxResponseBytes:256,maxAggregateBytes:256,runMs:1000}};
function world(t,{family='product-step',negative=false}={}){
  let evidence=null,fixture=null,hook=null;
  t.after(async()=>{if(fixture){const terminal=await fixture.finalize();if(negative){assert.equal(terminal.status,'unknown');assert.ok(fs.existsSync(fixture.root));await assert.rejects(hook(),/owned_cleanup_refused/);}
    else assert.equal(terminal.status,'closed');}
    if(evidence&&!negative){assert.equal(dirname(evidence),fs.realpathSync(tmpdir()));assert.equal(fs.realpathSync(evidence),evidence);fs.rmSync(evidence,{recursive:true,force:false});}});
  evidence=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'shared-local-ledger-control-')));
  fixture=createOwnedLocalFixture(negative?{after(fn){assert.equal(hook,null);hook=fn;}}:t,{family,evidenceRoot:evidence});
  return {fixture,evidence};
}
function published(w){const names=fs.readdirSync(w.evidence).filter(n=>n.startsWith('local-ledger-terminal-'));assert.equal(names.length,1);
  const b=fs.readFileSync(join(w.evidence,names[0])),v=JSON.parse(b);assert.equal(b.toString('utf8'),canonical(v)+'\n');return v;}
test('SF09 shared product owner observes actual seed FD, static SQLite, HistoryStore and HTTP closure once',async t=>{
  const w=world(t),f=w.fixture;await f.startDouble();const history=f.constructHistory();RunJournal.prepare(f.ownerRoot,policy);RunJournal.inspect(f.ownerRoot);
  const terminal=await f.finalize();assert.equal(terminal.status,'closed');assert.equal(history.db.raw.isOpen,false);assert.equal(fs.existsSync(f.root),false);
  assert.equal(terminal.acquired.filter(r=>r.kind==='file-journal-seed').length,1);assert.equal(terminal.acquired.filter(r=>r.kind==='sqlite-journal').length,2);
  assert.ok(terminal.acquired.every(r=>r.closeAttempts===1&&r.openAfterClose===false));assert.equal(published(w).schema,SHARED_RESOURCE_SCHEMA);
});
test('SF10 profile SQL-only source owner has genuine seed/SQLite acquisitions rather than fake empty resources',async t=>{
  const w=world(t,{family:'profile'}),f=w.fixture;RunJournal.prepare(f.ownerRoot,policy);RunJournal.inspect(f.ownerRoot);
  const terminal=await f.finalize();assert.equal(terminal.status,'closed');assert.equal(terminal.acquired.some(r=>r.kind==='http'||r.kind==='sqlite-history'),false);
  assert.ok(terminal.acquired.some(r=>r.id==='seed:experiment:1'));assert.equal(fs.existsSync(f.root),false);assert.throws(()=>f.constructHistory(),/after_cleanup/);
});
test('SF11 profile actual raw Server uses original request listener and bounded close callback plus genuine event',async t=>{
  const w=world(t,{family:'profile'}),f=w.fixture,server=f.constructHttpServer();let requests=0;server.on('request',(_req,res)=>{requests++;res.end('local');});
  await f.startHttpServer();RunJournal.prepare(f.ownerRoot,policy);const response=await fetch(`http://127.0.0.1:${server.address().port}`);assert.equal(await response.text(),'local');assert.equal(requests,1);
  const terminal=await f.finalize(),row=terminal.acquired.find(r=>r.kind==='http');assert.equal(row.closeAttempts,1);assert.equal(row.closeCallReturned,true);assert.equal(row.closeEventObserved,true);assert.equal(server.listening,false);
});
test('SF12 swallowed HistoryStore close warning retains the first failure without close replay',async t=>{
  const w=world(t,{negative:true}),f=w.fixture;await f.startDouble();const h=f.constructHistory();RunJournal.prepare(f.ownerRoot,policy);
  const actual=h.db.close;let calls=0;h.db.close=()=>{calls++;throw Error('synthetic_before_real_native_close');};
  try{const terminal=await f.finalize();assert.equal(terminal.status,'unknown');assert.equal(calls,1);assert.equal(h.db.raw.isOpen,true);assert.equal(published(w).status,'unknown');}
  finally{h.db.close=actual;Reflect.apply(actual,h.db,[]);}
});
test('SF13 actual unknown SQLite constructor keeps directory and immutable refusal',async t=>{
  const w=world(t,{family:'profile',negative:true}),f=w.fixture;fs.mkdirSync(join(f.ownerRoot,'trial-journal.sqlite'));
  assert.throws(()=>RunJournal.inspect(f.ownerRoot));const terminal=await f.finalize();assert.equal(terminal.status,'unknown');assert.equal(terminal.constructorUnknowns.length,1);
  assert.equal(terminal.root.removed,false);assert.equal(published(w).status,'unknown');
});
test('SF14 first actual seed close interception refuses and cannot replay during core cleanup',async t=>{
  const w=world(t,{family:'profile',negative:true}),f=w.fixture;const originalOpen=fs.openSync,originalClose=fs.closeSync;let fd=null,calls=0;
  fs.openSync=function(path,...args){const actual=Reflect.apply(originalOpen,fs,[path,...args]);if(path===join(f.ownerRoot,'trial-journal.sqlite'))fd=actual;return actual;};
  fs.closeSync=function(actual){if(actual===fd){calls++;throw Error('synthetic_before_native_seed_close');}return Reflect.apply(originalClose,fs,[actual]);};
  try{assert.throws(()=>RunJournal.prepare(f.ownerRoot,policy),/synthetic_before_native_seed_close/);const terminal=await f.finalize();assert.equal(terminal.status,'unknown');assert.equal(calls,1);
    const row=terminal.acquired.find(r=>r.kind==='file-journal-seed');assert.equal(row.closeAttempts,1);assert.equal(row.closeCallReturned,false);assert.equal(row.openAfterClose,null);}
  finally{fs.openSync=originalOpen;fs.closeSync=originalClose;if(fd!==null)Reflect.apply(originalClose,fs,[fd]);}
});
test('SF15 seed acquisition raw namespace/source tuples come from the actual same module and original FD calls',async t=>{
  const w=world(t,{family:'profile'}),f=w.fixture;RunJournal.prepare(f.ownerRoot,policy);const terminal=await f.finalize();
  for(const tuple of terminal.acquisitionPins){const bytes=fs.readFileSync(tuple.path),record=JSON.parse(bytes);assert.equal(hash(bytes),tuple.sha256);assert.equal(bytes.length,tuple.bytes);
    const row=terminal.acquired.find(r=>r.id===record.id);assert.ok(row);assert.equal(record.namespace,'experiment');assert.equal(canonical(record.observerSourcePin),canonical(terminal.observerSourcePins[0].pin));
    assert.equal(canonical(record.journalSourcePin),canonical(terminal.journalSourcePins[0].pin));assert.equal(row.closeAttempts,1);}
  assert.equal(terminal.traceComplete,true);assert.equal(terminal.status,'closed');assert.equal(published(w).family,'profile');
});
