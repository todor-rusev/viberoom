// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {RunJournal} from './journal.mjs';
import {openObservedJournalDatabase,closeObservedJournalDatabase} from './sql-resource-observation.mjs';
import {canonical,hash} from './data.mjs';
import {localResourceFamily,journalSourcePaths,CHILD_RESOURCE_SCHEMA} from './local-resource-families.mjs';
import {createOwnedLocalFixture} from '../../private-trial/trial-journal/owned-local-fixture-core.mjs';
import {validateReturnedLocalResourceClosureV3} from '../../private-trial/trial-journal/local-resource-closure-v3.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
function synthetic(family='whole-executor',{child=true,http=family==='comparison-bridge'}={}){
  const d=localResourceFamily(family),app=resolve(tmpdir(),'synthetic-v3-source'),root=resolve(tmpdir(),'synthetic-v3-root'),external=resolve(tmpdir(),'synthetic-v3-external');
  const fixtureId='11111111-1111-4111-8111-111111111111',writer={processId:11,parentProcessId:10};
  const initial={path:root,device:'1',inode:'2',birthtimeNs:'3',platform:process.platform};
  const code=path=>({path,bytes:1,sha256:hash(Buffer.from('x'))});
  const pins={selectorPin:code(join(app,d.selector)),sourceOwnerPin:code(join(app,d.ownerSource)),
    coreSourcePin:code(join(app,'private-trial/trial-journal/owned-local-fixture-core.mjs')),
    descriptorSourcePin:code(join(app,'private-trial/trial-journal/local-resource-families.mjs')),
    validatorSourcePin:code(join(app,'private-trial/trial-journal/local-resource-closure-v3.mjs')),
    sharedValidatorSourcePin:code(join(app,'private-trial/trial-journal/local-resource-closure-v2.mjs')),
    childRootsSourcePin:code(join(app,'private-trial/trial-journal/owned-journal-child-roots.mjs')),
    observerSourcePins:d.namespaces.map(namespace=>({namespace,pin:code(join(app,journalSourcePaths(namespace).observer))})),
    journalSourcePins:d.namespaces.map(namespace=>({namespace,pin:code(join(app,journalSourcePaths(namespace).journal))}))};
  const rawPin=(name,record)=>{const b=Buffer.from(canonical(record)+'\n');return {path:join(external,name),bytes:b.length,sha256:hash(b)};};
  const ownershipRecord={schema:'resident-owned-local-fixture-root-v3',family,fixtureId,selector:d.selector,...pins,nodeVersion:process.version,writer,initial};
  const ownershipPin=rawPin(`local-ledger-ownership-${fixtureId}.json`,ownershipRecord);
  const childRoots=[],childRootRecords=[];
  if(child){
    const id='copy:1',path=join(root,'copy-1'),childInitial={...initial,path,inode:'4',birthtimeNs:'5'};
    const attemptRecord={schema:'resident-owned-journal-copy-attempt-v1',fixtureId,family,selector:d.selector,writer,parentInitial:initial,id,path,...pins};
    const attemptPin=rawPin(`local-ledger-${fixtureId}-copy-1-directory-acquire.json`,attemptRecord);
    const childOrigin={schema:'resident-owned-journal-copy-root-v1',fixtureId,family,selector:d.selector,writer,parentInitial:initial,id,initial:childInitial,attemptPin,...pins};
    const childPin=rawPin(`local-ledger-${fixtureId}-copy-1-directory-origin.json`,childOrigin);
    childRoots.push({id,path,mkdirAttempted:true,mkdirReturned:true,initial:childInitial,attemptPin,ownershipPin:childPin,copyAttempted:true,copyReturned:true,
      closeAttempts:1,beforeRemoval:childInitial,removed:true,afterRemoval:'absent',status:'closed'});
    childRootRecords.push({attemptPin,attemptRecord,ownershipPin:childPin,ownershipRecord:childOrigin});
  }
  const base={constructorAttempted:true,constructorReturned:true,openAfterConstructor:true,startAttempted:false,startReturned:false,
    closeAttempts:1,closeCallReturned:true,closeEventObserved:null,openAfterClose:false};
  const acquired=[{...base,id:'seed:experiment:1',kind:'file-journal-seed',path:join(root,'owner','trial-journal.sqlite')},
    {...base,id:'journal:experiment:1',kind:'sqlite-journal',path:join(root,'owner','trial-journal.sqlite')}];
  if(http)acquired.unshift({...base,id:'server:1',kind:'http',path:null,openAfterConstructor:false,startAttempted:true,startReturned:true,closeEventObserved:true});
  if(child)acquired.push({...base,id:'journal:experiment:copy:1:1',kind:'sqlite-journal',path:join(childRoots[0].path,'trial-journal.sqlite')});
  const acquisitionRecords=acquired.map(row=>{
    const isSql=row.kind!=='http',copied=row.id.includes(':copy:'),namespace=isSql?'experiment':null;
    const record={schema:'resident-owned-local-resource-acquisition-v3',fixtureId,selector:d.selector,writer,initial,id:row.id,kind:row.kind,path:row.path,namespace,
      observerSourcePin:isSql?pins.observerSourcePins[0].pin:null,journalSourcePin:isSql?pins.journalSourcePins[0].pin:null,
      rootId:isSql?(copied?'copy:1':'owner'):null,rootOriginPin:copied?childRoots[0].ownershipPin:null};
    return {pin:rawPin(`local-ledger-${fixtureId}-${row.id.replaceAll(':','-')}-acquire.json`,record),record};
  });
  const terminal={schema:CHILD_RESOURCE_SCHEMA,family,fixtureId,selector:d.selector,...pins,nodeVersion:process.version,writer,
    root:{initial,ownershipPin,beforeRemoval:initial,removed:true,afterRemoval:'absent'},acquired,acquisitionPins:acquisitionRecords.map(x=>x.pin),released:acquired.map(x=>x.id),
    constructorUnknowns:[],teardownUnknowns:[],loggerCategories:[],traceComplete:true,status:'closed',childRoots};
  return clone({terminal,retainedWriter:{...writer,birthIdentity:'133000000000000001',...pins,ownershipPin,ownershipRecord,acquisitionRecords,childRootRecords}});
}
const verify=x=>validateReturnedLocalResourceClosureV3(x.terminal,{selector:x.terminal.selector,nodeVersion:process.version,retainedWriter:x.retainedWriter});
const refuses=change=>{const x=synthetic();change(x);assert.throws(()=>verify(x));};
const rehash=(tuple,record)=>{const b=Buffer.from(canonical(record)+'\n');tuple.bytes=b.length;tuple.sha256=hash(b);};

test('WB01 synthetic whole SQL-only and HTTP variants and bridge v3 have closed child joins without genuine authority',()=>{
  for(const [family,http,child] of [['whole-executor',false,false],['whole-executor',false,true],['whole-executor',true,true],['comparison-bridge',true,true]]){
    const x=synthetic(family,{http,child}),v=verify(x);assert.equal(canonical(v),canonical(x.terminal));assert.ok(Object.isFrozen(v));assert.equal(Object.hasOwn(v,'paid'),false);
  }
});
test('WB02 v3 child native row cannot be orphaned, renamed, outside its parent or duplicated',()=>{
  refuses(x=>{x.terminal.childRoots=[];x.retainedWriter.childRootRecords=[];});refuses(x=>{x.terminal.childRoots[0].id='copy:2';});
  refuses(x=>{x.terminal.childRoots[0].path=join(dirname(x.terminal.root.initial.path),'foreign-copy');});
  refuses(x=>{x.terminal.acquired.push(clone(x.terminal.acquired.at(-1)));});
});
test('WB03 even rehashed child records must join exact parent, writer, source owner and CreateNew attempt',()=>{
  for(const mutate of [v=>{v.parentInitial.inode='99';},v=>{v.writer.processId++;},v=>{v.sourceOwnerPin.path=join(dirname(v.sourceOwnerPin.path),'foreign.mjs');}]){
    const x=synthetic(),raw=x.retainedWriter.childRootRecords[0];mutate(raw.attemptRecord);rehash(raw.attemptPin,raw.attemptRecord);
    x.terminal.childRoots[0].attemptPin=clone(raw.attemptPin);assert.throws(()=>verify(x));
  }
  refuses(x=>{x.retainedWriter.childRootRecords[0].ownershipRecord.attemptPin.sha256='b'.repeat(64);});
  refuses(x=>{x.terminal.childRoots[0].attemptPin=null;});
});
test('WB04 native acquisition bytes must name the exact registered child origin and source namespace',()=>{
  const x=synthetic(),raw=x.retainedWriter.acquisitionRecords.at(-1);raw.record.rootId='owner';raw.record.rootOriginPin=null;rehash(raw.pin,raw.record);
  x.terminal.acquisitionPins[x.terminal.acquisitionPins.length-1]=clone(raw.pin);assert.throws(()=>verify(x));
  refuses(v=>{v.retainedWriter.acquisitionRecords.at(-1).record.rootOriginPin.sha256='c'.repeat(64);});
  refuses(v=>{v.retainedWriter.acquisitionRecords.at(-1).record.namespace='private';});
  refuses(v=>{v.retainedWriter.childRootRecords[0].attemptPin.bytes++;});
});
test('WB05 child copy, native close and removal uncertainties remain separate refusals',()=>{
  for(const [key,value] of [['mkdirReturned',false],['copyReturned',false],['closeAttempts',2],['removed',false],['afterRemoval','present'],['status','unknown']])
    refuses(x=>{x.terminal.childRoots[0][key]=value;});
  refuses(x=>{x.terminal.acquired.at(-1).openAfterClose=null;});refuses(x=>{x.terminal.acquired.at(-1).closeCallReturned=false;});
  refuses(x=>{x.terminal.teardownUnknowns=[{id:'copy:1',category:'journal-child-acquisition-unknown'}];});
});
test('WB06 fixed bridge needs an actually started closed HTTP row; whole optional HTTP is not generic empty-resource permission',()=>{
  const x=synthetic('comparison-bridge',{http:false});assert.throws(()=>verify(x));
  refuses(v=>{v.terminal.acquired=[];v.terminal.released=[];});
  const y=synthetic('comparison-bridge');y.terminal.acquired[0].closeEventObserved=false;assert.throws(()=>verify(y));
  const z=synthetic('comparison-bridge');z.terminal.acquired[0].startReturned=false;assert.throws(()=>verify(z));
});
test('WB07 retained/source/constructor/trace mismatches never become v3 acceptance',()=>{
  refuses(x=>{x.retainedWriter.sharedValidatorSourcePin.sha256='d'.repeat(64);});refuses(x=>{x.terminal.childRootsSourcePin.path=join(dirname(x.terminal.childRootsSourcePin.path),'foreign.mjs');});
  refuses(x=>{x.retainedWriter.birthIdentity='0';});refuses(x=>{x.terminal.constructorUnknowns=['journal:experiment:copy:1:1'];});
  refuses(x=>{x.terminal.traceComplete=false;});refuses(x=>{x.terminal.schema='resident-owned-local-resource-closure-v2';});
});
test('WB08 closed v3 DATA rejects huge/accessor/proxy/extra child data without invoking supplied getters',()=>{
  refuses(x=>{x.terminal.childRoots=new Array(1e9);});refuses(x=>{x.terminal.childRoots=new Proxy([],{});});refuses(x=>{x.terminal.childRoots[0].extra=true;});
  const x=synthetic();let reads=0;Object.defineProperty(x.terminal.childRoots[0],'removed',{enumerable:true,get(){reads++;return true;}});assert.throws(()=>verify(x));assert.equal(reads,0);
});

const policy={schema:'viberoom-trial-journal-policy-v1',identity:{purpose:'inert-whole-bridge-resource-control'},kinds:{read:1},
  limits:{localEstimatedCredits:0,maxRequestBytes:256,maxResponseBytes:256,maxAggregateBytes:256,runMs:1000}};
function world(t,{family='whole-executor',negative=false}={}){
  let fixture=null,evidence=null,hook=null;
  t.after(async()=>{if(fixture){const terminal=await fixture.finalize();if(negative){assert.equal(terminal.status,'unknown');assert.ok(fs.existsSync(fixture.root));await assert.rejects(hook(),/owned_cleanup_refused/);}
    else assert.equal(terminal.status,'closed');}
    if(evidence&&!negative){assert.equal(dirname(evidence),fs.realpathSync(tmpdir()));assert.equal(fs.realpathSync(evidence),evidence);fs.rmSync(evidence,{recursive:true,force:false});}});
  evidence=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'whole-bridge-ledger-control-')));
  fixture=createOwnedLocalFixture(negative?{after(fn){assert.equal(hook,null);hook=fn;}}:t,{family,evidenceRoot:evidence});
  return {fixture,evidence};
}
function published(w){const names=fs.readdirSync(w.evidence).filter(n=>n.startsWith('local-ledger-terminal-'));assert.equal(names.length,1);
  const b=fs.readFileSync(join(w.evidence,names[0])),record=JSON.parse(b);assert.equal(b.toString('utf8'),canonical(record)+'\n');return {bytes:b,record};}
function readPin(tuple){const b=fs.readFileSync(tuple.path);assert.equal(b.length,tuple.bytes);assert.equal(hash(b),tuple.sha256);return JSON.parse(b);}
function rawJoins(w,terminal){
  const parent=readPin(terminal.root.ownershipPin);assert.equal(parent.schema,'resident-owned-local-fixture-root-v3');
  assert.equal(parent.writer.processId,process.pid);assert.equal(parent.writer.parentProcessId,process.ppid);
  for(const name of ['selectorPin','sourceOwnerPin','coreSourcePin','descriptorSourcePin','validatorSourcePin','sharedValidatorSourcePin','childRootsSourcePin']){
    assert.equal(canonical(parent[name]),canonical(terminal[name]));const bytes=fs.readFileSync(terminal[name].path);assert.equal(hash(bytes),terminal[name].sha256);assert.equal(bytes.length,terminal[name].bytes);
  }
  for(const name of ['observerSourcePins','journalSourcePins'])for(const tuple of terminal[name]){
    const bytes=fs.readFileSync(tuple.pin.path);assert.equal(hash(bytes),tuple.pin.sha256);assert.equal(bytes.length,tuple.pin.bytes);
    assert.equal(canonical(parent[name]),canonical(terminal[name]));
  }
  for(const child of terminal.childRoots){const attempt=readPin(child.attemptPin),origin=readPin(child.ownershipPin);
    assert.equal(attempt.schema,'resident-owned-journal-copy-attempt-v1');assert.equal(origin.schema,'resident-owned-journal-copy-root-v1');
    assert.equal(canonical(attempt.parentInitial),canonical(terminal.root.initial));assert.equal(canonical(origin.initial),canonical(child.initial));
    assert.equal(canonical(origin.attemptPin),canonical(child.attemptPin));assert.equal(origin.id,child.id);assert.equal(origin.fixtureId,terminal.fixtureId);
  }
  for(const tuple of terminal.acquisitionPins){const raw=readPin(tuple),row=terminal.acquired.find(r=>r.id===raw.id);assert.ok(row);assert.equal(raw.schema,'resident-owned-local-resource-acquisition-v3');
    assert.equal(raw.fixtureId,terminal.fixtureId);assert.equal(raw.selector,terminal.selector);assert.equal(canonical(raw.initial),canonical(terminal.root.initial));
    if(raw.rootId?.startsWith('copy:')){const child=terminal.childRoots.find(c=>c.id===raw.rootId);assert.ok(child);assert.equal(canonical(raw.rootOriginPin),canonical(child.ownershipPin));}
    else assert.equal(raw.rootOriginPin,null);
  }
  assert.equal(canonical(published(w).record),canonical(terminal));
}
async function startRaw(f){const server=f.constructHttpServer();server.on('request',(_req,res)=>res.end('local'));await f.startHttpServer();return server;}

test('WB09 actual whole copied journal is fenced yet every returned child SQLite DB closes before child/root removal',async t=>{
  const w=world(t),f=w.fixture;RunJournal.prepare(f.ownerRoot,policy);const copy=f.copyJournalRoot();assert.throws(()=>RunJournal.inspect(copy));
  const terminal=await f.finalize();assert.equal(terminal.status,'closed');assert.equal(terminal.childRoots.length,1);assert.equal(terminal.childRoots[0].path,copy);
  assert.ok(terminal.acquired.some(r=>r.id==='journal:experiment:copy:1:1'&&r.closeAttempts===1&&r.openAfterClose===false));
  assert.equal(fs.existsSync(copy),false);assert.equal(fs.existsSync(f.root),false);rawJoins(w,terminal);
});
test('WB10 two actual child roots have unique native IDs, immutable preregistration and independent checked removals',async t=>{
  const w=world(t),f=w.fixture;RunJournal.prepare(f.ownerRoot,policy);for(let n=0;n<2;n++)assert.throws(()=>RunJournal.inspect(f.copyJournalRoot()));
  const terminal=await f.finalize();assert.equal(terminal.status,'closed');assert.deepEqual(terminal.childRoots.map(c=>c.id),['copy:1','copy:2']);
  const ids=terminal.acquired.map(r=>r.id);assert.equal(new Set(ids).size,ids.length);assert.ok(terminal.childRoots.every(c=>c.closeAttempts===1&&c.removed&&c.afterRemoval==='absent'));rawJoins(w,terminal);
});
test('WB11 actual bridge fault and readonly DBs share native ownership without changing SQL results or repeating close',async t=>{
  const w=world(t,{family:'comparison-bridge'}),f=w.fixture,server=await startRaw(f);RunJournal.prepare(f.ownerRoot,policy);
  const db=f.constructJournalDatabase();db.exec('create table fixture_fault(value integer);insert into fixture_fault values(7);');f.closeJournalDatabase(db);
  const ro=f.constructJournalDatabase(true);assert.equal(ro.prepare('select value from fixture_fault').get().value,7);f.closeJournalDatabase(ro);
  assert.throws(()=>f.closeJournalDatabase(db),/not_replayed/);const terminal=await f.finalize();assert.equal(terminal.status,'closed');assert.equal(db.isOpen,false);assert.equal(ro.isOpen,false);
  const http=terminal.acquired.find(r=>r.kind==='http');assert.equal(http.closeEventObserved,true);assert.equal(server.listening,false);rawJoins(w,terminal);
});
test('WB12 another genuine fixture DB cannot be adopted or closed by this bridge owner',async t=>{
  const a=world(t,{family:'comparison-bridge'}),b=world(t,{family:'comparison-bridge'});await startRaw(a.fixture);await startRaw(b.fixture);
  RunJournal.prepare(a.fixture.ownerRoot,policy);RunJournal.prepare(b.fixture.ownerRoot,policy);const db=b.fixture.constructJournalDatabase();
  assert.throws(()=>a.fixture.closeJournalDatabase(db),/not_owned/);assert.equal(db.isOpen,true);b.fixture.closeJournalDatabase(db);
  assert.equal((await a.fixture.finalize()).status,'closed');assert.equal((await b.fixture.finalize()).status,'closed');
});
test('WB13 failed actual copy retains the owned child and immutable refusal without another copy or deletion grant',async t=>{
  const w=world(t,{negative:true}),f=w.fixture;RunJournal.prepare(f.ownerRoot,policy);const original=fs.cpSync;let calls=0;
  fs.cpSync=function(){calls++;throw Error('synthetic_before_actual_copy');};try{assert.throws(()=>f.copyJournalRoot(),/synthetic_before_actual_copy/);}finally{fs.cpSync=original;}
  const terminal=await f.finalize();assert.equal(terminal.status,'unknown');assert.equal(calls,1);assert.equal(terminal.childRoots[0].copyReturned,false);
  assert.equal(terminal.childRoots[0].closeAttempts,0);assert.equal(fs.existsSync(terminal.childRoots[0].path),true);const before=published(w).bytes;
  assert.equal(await f.finalize(),terminal);assert.ok(published(w).bytes.equals(before));assert.equal(calls,1);
});
test('WB14 child origin drift refuses before SQLite acquisition and retains its first source/provenance refusal',async t=>{
  const w=world(t,{negative:true}),f=w.fixture;RunJournal.prepare(f.ownerRoot,policy);const copy=f.copyJournalRoot();
  const names=fs.readdirSync(w.evidence).filter(n=>n.endsWith('-copy-1-directory-origin.json'));assert.equal(names.length,1);
  fs.writeFileSync(join(w.evidence,names[0]),'changed-owned-fixture-data\n');assert.throws(()=>RunJournal.inspect(copy),/journal_copy_origin_changed/);
  const terminal=await f.finalize();assert.equal(terminal.status,'unknown');assert.equal(terminal.childRoots[0].removed,false);assert.equal(fs.existsSync(copy),true);
  assert.equal(terminal.acquired.some(r=>r.id.includes(':copy:')),false);
  assert.ok(terminal.teardownUnknowns.some(r=>r.category==='journal-root-provenance-refused'));assert.equal(published(w).record.status,'unknown');
});
test('WB15 actual bridge constructor failure records unknown native state and retains directory after checked Server closure',async t=>{
  const w=world(t,{family:'comparison-bridge',negative:true}),f=w.fixture,server=await startRaw(f);fs.mkdirSync(join(f.ownerRoot,'trial-journal.sqlite'));
  assert.throws(()=>f.constructJournalDatabase());const terminal=await f.finalize();assert.equal(terminal.status,'unknown');assert.ok(terminal.constructorUnknowns.length===1);
  assert.equal(terminal.root.removed,false);assert.equal(server.listening,false);assert.equal(terminal.acquired.find(r=>r.kind==='http').closeEventObserved,true);assert.equal(published(w).record.status,'unknown');
});
test('WB16 first intercepted actual child native close retains refusal even after separate test-owned first native recovery',async t=>{
  const w=world(t,{negative:true}),f=w.fixture;RunJournal.prepare(f.ownerRoot,policy);const copy=f.copyJournalRoot();
  const db=openObservedJournalDatabase(join(copy,'trial-journal.sqlite')),original=db.close;let calls=0;db.close=()=>{calls++;throw Error('synthetic_before_real_child_close');};
  try{assert.throws(()=>closeObservedJournalDatabase(db),/synthetic_before_real_child_close/);const terminal=await f.finalize();assert.equal(terminal.status,'unknown');assert.equal(calls,1);assert.equal(db.isOpen,true);
    assert.equal(terminal.childRoots[0].removed,false);assert.equal(published(w).record.status,'unknown');}
  finally{db.close=original;Reflect.apply(original,db,[]);}
});
test('WB17 changed internal child ownership bytes refuse removal even when external provenance and native state stayed known',async t=>{
  const w=world(t,{negative:true}),f=w.fixture;RunJournal.prepare(f.ownerRoot,policy);const copy=f.copyJournalRoot();assert.throws(()=>RunJournal.inspect(copy));
  fs.writeFileSync(join(copy,'OWNED-JOURNAL-COPY.json'),'changed-owned-fixture-data\n');const terminal=await f.finalize();
  assert.equal(terminal.status,'unknown');assert.equal(terminal.childRoots[0].removed,false);assert.equal(fs.existsSync(copy),true);
  const native=terminal.acquired.filter(r=>r.id.includes(':copy:'));assert.equal(native.length,1);assert.ok(native.every(r=>r.closeAttempts===1&&r.openAfterClose===false));
  assert.ok(terminal.teardownUnknowns.some(r=>r.category==='journal-child-removal-unconfirmed'));assert.equal(published(w).record.status,'unknown');
});
