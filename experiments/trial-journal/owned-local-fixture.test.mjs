// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createOwnedProductFixture} from './owned-local-fixture.mjs';
import {RunJournal} from './journal.mjs';
import {canonical,hash} from './data.mjs';
import {validateReturnedLocalResourceClosure,LOCAL_RESOURCE_SCHEMA,PRODUCT_SELECTOR} from './local-resource-closure.mjs';

const clone=x=>JSON.parse(JSON.stringify(x));
function synthetic(){
  const root=join(tmpdir(),'synthetic-local-ledger-only'),evidence=join(tmpdir(),'synthetic-external-evidence-only');
  const initial={path:root,device:'1',inode:'2',birthtimeNs:'3',platform:process.platform};
  const pin=(name,record=null)=>{const bytes=record===null?Buffer.from('synthetic source pin only'):Buffer.from(canonical(record)+'\n');
    return {path:join(evidence,name),bytes:bytes.length,sha256:hash(bytes)};};
  const writer={processId:11,parentProcessId:10},fixtureId='11111111-1111-4111-8111-111111111111';
  const pins={selectorPin:pin('selector.mjs'),sourceOwnerPin:pin('owner.mjs'),observerSourcePin:pin('observer.mjs'),validatorSourcePin:pin('validator.mjs')};
  const acquired=[{id:'server:1',kind:'http',path:null,constructorAttempted:true,constructorReturned:true,openAfterConstructor:false,
    startAttempted:true,startReturned:true,closeAttempts:1,closeCallReturned:true,closeEventObserved:true,openAfterClose:false},
    ...[['history:1','sqlite-history',join(root,'history.db')],['journal:1','sqlite-journal',join(root,'owner','trial-journal.sqlite')]].map(([id,kind,path])=>
      ({id,kind,path,constructorAttempted:true,constructorReturned:true,openAfterConstructor:true,startAttempted:false,startReturned:false,
        closeAttempts:1,closeCallReturned:true,closeEventObserved:null,openAfterClose:false}))];
  const ownershipRecord={schema:'resident-owned-local-fixture-root-v1',family:'product-step',fixtureId,
    selector:PRODUCT_SELECTOR,...pins,nodeVersion:process.version,writer,initial};
  const ownershipPin=pin('ownership.json',ownershipRecord);
  const acquisitionRecords=acquired.map((r,n)=>{const record={schema:'resident-owned-local-resource-acquisition-v1',fixtureId,
    selector:PRODUCT_SELECTOR,writer,initial,id:r.id,kind:r.kind,path:r.path};return {pin:pin(`acquire-${n}.json`,record),record};});
  const terminal={schema:LOCAL_RESOURCE_SCHEMA,family:'product-step',fixtureId,selector:PRODUCT_SELECTOR,...pins,nodeVersion:process.version,writer,
    root:{initial,ownershipPin,beforeRemoval:initial,removed:true,afterRemoval:'absent'},acquired,acquisitionPins:acquisitionRecords.map(x=>x.pin),
    released:acquired.map(x=>x.id),constructorUnknowns:[],teardownUnknowns:[],loggerCategories:[],traceComplete:true,status:'closed'};
  const retainedWriter={...writer,birthIdentity:'133000000000000001',...pins,ownershipPin,ownershipRecord,acquisitionRecords};
  return {terminal:clone(terminal),retainedWriter:clone(retainedWriter)};
}
const verify=x=>validateReturnedLocalResourceClosure(x.terminal,{selector:PRODUCT_SELECTOR,nodeVersion:process.version,retainedWriter:x.retainedWriter});
const refuses=mutate=>{const value=synthetic();mutate(value);assert.throws(()=>verify(value));};

test('LR01 closed synthetic resource DATA joins all raw origin tuples without granting a production brand',()=>{
  const x=synthetic(),result=verify(x);assert.equal(canonical(result),canonical(x.terminal));assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.hasOwn(result,'readiness'),false);assert.equal(Object.hasOwn(result,'paid'),false);
});
test('LR02 every original ownership/acquisition/source pin is mandatory and exact',()=>{
  for(const k of ['selectorPin','sourceOwnerPin','observerSourcePin','validatorSourcePin'])refuses(x=>{x.retainedWriter[k].sha256='b'.repeat(64);});
  refuses(x=>{delete x.retainedWriter.ownershipRecord;});refuses(x=>{x.retainedWriter.ownershipRecord.fixtureId='22222222-2222-4222-8222-222222222222';});
  refuses(x=>{x.retainedWriter.acquisitionRecords.pop();});refuses(x=>{x.retainedWriter.acquisitionRecords[1].record.kind='sqlite-journal';});
  refuses(x=>{x.terminal.acquisitionPins[0].sha256='b'.repeat(64);});
});
test('LR03 empty or duplicate resources cannot become a local-ledger origin',()=>{
  refuses(x=>{x.terminal.acquired=[];x.terminal.released=[];});
  refuses(x=>{x.terminal.acquired.push(clone(x.terminal.acquired[0]));});
  refuses(x=>{x.terminal.released[1]='server:1';});refuses(x=>{x.terminal.acquired[2].path=join(tmpdir(),'other.db');});
});
test('LR04 constructor unknown, teardown unknown, trace loss and logger failure remain refusals',()=>{
  refuses(x=>{x.terminal.constructorUnknowns=['journal:1'];});refuses(x=>{x.terminal.teardownUnknowns=[{id:'history:1',category:'history-close-refused'}];});
  refuses(x=>{x.terminal.loggerCategories=[{id:'history:1',category:'close-warning'}];});
  refuses(x=>{x.terminal.traceComplete=false;});refuses(x=>{x.terminal.status='unknown';});
});
test('LR05 a close return alone cannot replace native SQLite state or Server close event',()=>{
  for(const k of ['constructorReturned','closeCallReturned'])refuses(x=>{x.terminal.acquired[1][k]=false;});
  refuses(x=>{x.terminal.acquired[1].openAfterClose=true;});refuses(x=>{x.terminal.acquired[1].openAfterClose=null;});
  refuses(x=>{x.terminal.acquired[0].closeEventObserved=false;});refuses(x=>{x.terminal.acquired[0].startReturned=false;});
  refuses(x=>{x.terminal.acquired[1].closeAttempts=2;});
});
test('LR06 actual selector/version/writer birth joins cannot be inferred from names or booleans',()=>{
  refuses(x=>{x.terminal.selector='private-trial/full-protocol.test.mjs';});refuses(x=>{x.terminal.nodeVersion='v0.0.0';});
  refuses(x=>{x.retainedWriter.processId++;});refuses(x=>{x.retainedWriter.parentProcessId++;});
  for(const birth of [true,133000000000000001,'0','-1','01'])refuses(x=>{x.retainedWriter.birthIdentity=birth;});
});
test('LR07 physical directory/removal evidence is mandatory and exact',()=>{
  refuses(x=>{x.terminal.root.beforeRemoval.inode='9';});refuses(x=>{x.terminal.root.removed=false;});
  refuses(x=>{x.terminal.root.afterRemoval='present';});refuses(x=>{x.terminal.root.ownershipPin.path=join(x.terminal.root.initial.path,'inside.json');});
});
test('LR08 bounded ordinary DATA refuses sparse oversized arrays/accessors/extra fields before acceptance',()=>{
  const x=synthetic();x.terminal.acquired=new Array(1e9);assert.throws(()=>verify(x),/array_bound/);
  const y=synthetic();let reads=0;Object.defineProperty(y.terminal,'status',{enumerable:true,get(){reads++;return 'closed';}});
  assert.throws(()=>verify(y));assert.equal(reads,0);refuses(z=>{z.terminal.extra=true;});
});

const policy={schema:'viberoom-trial-journal-policy-v1',identity:{purpose:'inert-local-resource-control'},kinds:{read:1},
  limits:{localEstimatedCredits:0,maxRequestBytes:256,maxResponseBytes:256,maxAggregateBytes:256,runMs:1000}};
function environment(t,{negative=false}={}){
  let evidence=null,fixture=null,negativeHook=null,terminal=null;
  t.after(async()=>{
    if(fixture){terminal=await fixture.finalize();
      if(negative){assert.equal(terminal.status,'unknown');assert.ok(fs.existsSync(fixture.root));if(negativeHook)await assert.rejects(negativeHook(),/owned_cleanup_refused/);}
      else assert.equal(terminal.status,'closed');}
    if(evidence&&!negative){const absolute=fs.realpathSync(evidence);assert.equal(dirname(absolute),fs.realpathSync(tmpdir()));
      assert.ok(absolute===evidence);fs.rmSync(absolute,{recursive:true,force:false});}
  });
  evidence=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'owned-local-ledger-control-')));
  const context=negative?{after(fn){assert.equal(negativeHook,null);negativeHook=fn;}}:t;
  fixture=createOwnedProductFixture(context,{evidenceRoot:evidence});
  return {fixture,evidence,readTerminal:()=>terminal};
}
function rawTerminal(evidence){const names=fs.readdirSync(evidence).filter(n=>n.startsWith('local-ledger-terminal-'));assert.equal(names.length,1);
  const bytes=fs.readFileSync(join(evidence,names[0])),value=JSON.parse(bytes.toString('utf8'));assert.equal(bytes.toString('utf8'),canonical(value)+'\n');return value;}

test('LR09 actual Server event plus native HistoryStore and static journal connections have independent closure rows',async t=>{
  const {fixture,evidence}=environment(t);await fixture.startDouble();const history=fixture.constructHistory();
  RunJournal.prepare(fixture.ownerRoot,policy);RunJournal.inspect(fixture.ownerRoot);
  const terminal=await fixture.finalize();assert.equal(terminal.status,'closed');assert.equal(history.db.raw.isOpen,false);
  assert.equal(fs.existsSync(fixture.root),false);assert.equal(terminal.acquired.filter(r=>r.kind==='sqlite-journal').length,2);
  assert.ok(terminal.acquired.every(r=>r.openAfterClose===false&&r.closeCallReturned));assert.equal(rawTerminal(evidence).status,'closed');
});
test('LR10 actual HistoryStore close/reopen preserves both returned owners and one close attempt each',async t=>{
  const {fixture}=environment(t);await fixture.startDouble();const first=fixture.constructHistory();fixture.closeHistory(first);
  const second=fixture.constructHistory();RunJournal.prepare(fixture.ownerRoot,policy);const terminal=await fixture.finalize();
  assert.equal(first.db.raw.isOpen,false);assert.equal(second.db.raw.isOpen,false);
  assert.equal(terminal.acquired.filter(r=>r.kind==='sqlite-history').length,2);assert.ok(terminal.acquired.every(r=>r.closeAttempts===1));
});
test('LR11 genuine HistoryStore swallowed close warning retains refusal without replay or invented native closure',async t=>{
  const {fixture,evidence}=environment(t,{negative:true});await fixture.startDouble();const history=fixture.constructHistory();RunJournal.prepare(fixture.ownerRoot,policy);
  const original=history.db.close;history.db.close=()=>{throw Error('synthetic-close-fault');};
  let terminal;try{terminal=await fixture.finalize();assert.equal(terminal.status,'unknown');assert.ok(terminal.loggerCategories.length);
    assert.equal(terminal.acquired.find(r=>r.kind==='sqlite-history').openAfterClose,true);assert.ok(fs.existsSync(fixture.root));}
  finally{history.db.close=original;Reflect.apply(original,history.db,[]);assert.equal(history.db.raw.isOpen,false);}
  assert.equal(rawTerminal(evidence).status,'unknown');
});
test('LR12 actual native journal constructor failure stays unknown and retains its preconstructor ownership',async t=>{
  const {fixture,evidence}=environment(t,{negative:true});await fixture.startDouble();fixture.constructHistory();
  fs.mkdirSync(join(fixture.ownerRoot,'trial-journal.sqlite'));
  assert.throws(()=>RunJournal.inspect(fixture.ownerRoot));
  const terminal=await fixture.finalize();assert.equal(terminal.status,'unknown');assert.ok(terminal.constructorUnknowns.includes('journal:1'));
  assert.equal(terminal.acquired.find(r=>r.id==='journal:1').constructorReturned,false);assert.ok(fs.existsSync(fixture.root));
  assert.equal(rawTerminal(evidence).status,'unknown');
});
test('LR13 no external evidence root grants no published receipt while genuine local cleanup remains checked',async t=>{
  const fixture=createOwnedProductFixture(t);await fixture.startDouble();fixture.constructHistory();RunJournal.prepare(fixture.ownerRoot,policy);
  const terminal=await fixture.finalize();assert.equal(terminal.status,'closed');assert.ok(terminal.acquisitionPins.every(p=>p===null));
  assert.equal(fs.existsSync(fixture.root),false);assert.throws(()=>validateReturnedLocalResourceClosure(terminal,{selector:PRODUCT_SELECTOR,nodeVersion:process.version,retainedWriter:{}}));
});
test('LR14 final checkpoint is memoized once, CreateNew and byte exact; repeat finalization does not close or write again',async t=>{
  const {fixture,evidence}=environment(t);await fixture.startDouble();fixture.constructHistory();RunJournal.prepare(fixture.ownerRoot,policy);
  const first=await fixture.finalize(),files=fs.readdirSync(evidence).sort(),bytes=canonical(rawTerminal(evidence));
  const second=await fixture.finalize();assert.equal(second,first);assert.deepEqual(fs.readdirSync(evidence).sort(),files);
  assert.equal(canonical(rawTerminal(evidence)),bytes);assert.ok(second.acquired.every(r=>r.closeAttempts===1));
});
