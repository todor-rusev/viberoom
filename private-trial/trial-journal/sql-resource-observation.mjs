// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,hash} from './data.mjs';
import {PRODUCT_SELECTOR,PRIVATE_SELECTOR,localResourceFamily,journalSourcePaths} from './local-resource-families.mjs';

const roots=new Map(),connections=new WeakMap(),seeds=new Map(),MAXIMUM=4096;
const modulePath=fileURLToPath(import.meta.url),app=resolve(dirname(modulePath),'../..');
const namespace=modulePath.replaceAll('\\','/').endsWith('/experiments/trial-journal/sql-resource-observation.mjs')?'experiment':
  modulePath.replaceAll('\\','/').endsWith('/private-trial/trial-journal/sql-resource-observation.mjs')?'private':null;
const key=root=>process.platform==='win32'?root.toLowerCase():root;
const physical=root=>fs.realpathSync(root);
const pin=path=>{const b=fs.readFileSync(path);return {path,bytes:b.length,sha256:hash(b)};};
function directoryIdentity(root){const path=physical(root),s=fs.statSync(path,{bigint:true});assert.ok(s.isDirectory()&&!fs.lstatSync(path).isSymbolicLink());
  return {path,device:String(s.dev),inode:String(s.ino),birthtimeNs:String(s.birthtimeNs),platform:process.platform};}
function observeOpen(entry,field){try{const actual=entry.db.isOpen;assert.equal(typeof actual,'boolean');entry.row[field]=actual;}
  catch{entry.watch.unknowns.add('journal-open-state-unconfirmed');entry.row[field]=null;}}

export function observeOwnedJournalRoot(root,{fixtureId,evidenceRoot=null,selector=PRODUCT_SELECTOR,family=null,rootId='owner',rootOriginPin=null}){
  assert.ok(typeof root==='string'&&resolve(root)===physical(root),'journal_physical_root_required');assert.match(fixtureId,/^[a-f0-9-]{36}$/);
  let observerSourcePin=null,journalSourcePin=null,extended=false;
  if(family!==null){const descriptor=localResourceFamily(family);assert.equal(descriptor.selector,selector);assert.ok(descriptor.namespaces.includes(namespace),'journal_module_namespace_not_owned');
    const paths=journalSourcePaths(namespace);observerSourcePin=pin(join(app,paths.observer));journalSourcePin=pin(join(app,paths.journal));extended=descriptor.extended===true;}
  else assert.ok(selector===PRODUCT_SELECTOR||selector===PRIVATE_SELECTOR,'journal_fixed_selector_required');
  if(extended){assert.ok(rootId==='owner'||/^copy:[1-9][0-9]*$/.test(rootId),'journal_fixed_root_id_required');
    assert.equal(root,join(dirname(root),rootId==='owner'?'owner':rootId.replace(':','-')),'journal_fixed_root_path_required');
    if(rootId==='owner')assert.equal(rootOriginPin,null);else {assert.ok(rootOriginPin&&typeof rootOriginPin.path==='string');assert.equal(canonical(pin(rootOriginPin.path)),canonical(rootOriginPin),'journal_copy_origin_changed');}}
  else{assert.equal(rootId,'owner');assert.equal(rootOriginPin,null);}
  if(evidenceRoot!==null)assert.ok(resolve(evidenceRoot)===physical(evidenceRoot),'journal_evidence_physical_root_required');
  const name=key(root);assert.equal(roots.has(name),false,'journal_observer_already_registered');
  const watch={root,fixtureId,evidenceRoot,selector,family,extended,rootId,rootOriginPin,rootInitial:directoryIdentity(root),observerSourcePin,journalSourcePin,initial:directoryIdentity(dirname(root)),
    evidenceIdentity:evidenceRoot===null?null:directoryIdentity(evidenceRoot),entries:[],unknowns:new Set(),detached:false};roots.set(name,watch);
  return Object.freeze({
    snapshot(){return {rows:watch.entries.map(e=>({...e.row})),acquisitionPins:watch.entries.map(e=>e.acquisitionPin===null?null:{...e.acquisitionPin}),unknowns:[...watch.unknowns].sort()};},
    closeReturned(db){const entry=connections.get(db);assert.ok(entry&&entry.watch===watch,'journal_native_not_owned');assert.equal(entry.row.closeAttempts,0,'journal_native_close_not_replayed');return closeObservedJournalDatabase(db);},
    closeOutstanding(){for(const entry of watch.entries){
      if(entry.seed){if(entry.fd===null)continue;if(entry.row.closeAttempts===0){try{closeObservedJournalSeed(entry.fd);}catch{}}}
      else {if(!entry.db)continue;observeOpen(entry,'openAfterClose');if(entry.row.openAfterClose===true&&entry.row.closeAttempts===0){try{closeObservedJournalDatabase(entry.db);}catch{}}}
    }},
    detach(){assert.equal(watch.detached,false,'journal_observer_already_detached');watch.detached=true;roots.delete(name);}
  });
}
function attempt(file,seed=false){
  const watch=roots.get(key(dirname(resolve(file))));if(!watch||seed&&watch.family===null)return null;
  if(watch.entries.length>=MAXIMUM){watch.unknowns.add('journal-observation-truncated');return null;}
  if(watch.extended){try{assert.equal(canonical(directoryIdentity(watch.root)),canonical(watch.rootInitial),'journal_root_identity_changed');
    if(watch.rootOriginPin!==null)assert.equal(canonical(pin(watch.rootOriginPin.path)),canonical(watch.rootOriginPin),'journal_copy_origin_changed');}
    catch(error){watch.unknowns.add('journal-root-provenance-refused');throw error;}}
  assert.equal(resolve(file),join(watch.root,'trial-journal.sqlite'),'journal_observer_file_changed');
  const n=watch.entries.filter(e=>e.seed===seed).length+1;
  const id=watch.family===null?`journal:${n}`:`${seed?'seed':'journal'}:${namespace}:${watch.rootId==='owner'?'':watch.rootId+':'}${n}`;
  const entry={watch,seed,db:null,fd:null,acquisitionPin:null,row:{id,kind:seed?'file-journal-seed':'sqlite-journal',path:resolve(file),
    constructorAttempted:false,constructorReturned:false,openAfterConstructor:null,startAttempted:false,startReturned:false,
    closeAttempts:0,closeCallReturned:false,closeEventObserved:null,openAfterClose:null}};watch.entries.push(entry);
  if(watch.evidenceRoot!==null){
    assert.equal(canonical(directoryIdentity(watch.evidenceRoot)),canonical(watch.evidenceIdentity),'journal_evidence_root_changed');
    const record={schema:watch.family===null?'resident-owned-local-resource-acquisition-v1':watch.extended?'resident-owned-local-resource-acquisition-v3':'resident-owned-local-resource-acquisition-v2',
      fixtureId:watch.fixtureId,selector:watch.selector,writer:{processId:process.pid,parentProcessId:process.ppid},initial:watch.initial,
      id:entry.row.id,kind:entry.row.kind,path:entry.row.path};
    if(watch.family!==null)Object.assign(record,{namespace,observerSourcePin:watch.observerSourcePin,journalSourcePin:watch.journalSourcePin});
    if(watch.extended)Object.assign(record,{rootId:watch.rootId,rootOriginPin:watch.rootOriginPin});
    const bytes=Buffer.from(canonical(record)+'\n'),filename=watch.family===null?`local-ledger-${watch.fixtureId}-journal-acquire-${n}.json`:
      `local-ledger-${watch.fixtureId}-${id.replaceAll(':','-')}-acquire.json`,path=join(watch.evidenceRoot,filename);
    try{fs.writeFileSync(path,bytes,{flag:'wx'});entry.acquisitionPin={path,bytes:bytes.length,sha256:hash(bytes)};}
    catch(error){watch.unknowns.add('journal-acquisition-record-refused');throw error;}
  }
  entry.row.constructorAttempted=true;return entry;
}
export function openObservedJournalDatabase(file,options){
  const entry=attempt(file),watch=roots.get(key(dirname(resolve(file))));let db;
  try{db=options===undefined?new DatabaseSync(file):new DatabaseSync(file,options);}
  catch(error){if(watch)watch.unknowns.add('journal-constructor-unknown');throw error;}
  if(entry){entry.db=db;entry.row.constructorReturned=true;connections.set(db,entry);observeOpen(entry,'openAfterConstructor');}return db;
}
export function closeObservedJournalDatabase(db){const entry=connections.get(db);if(entry)entry.row.closeAttempts++;
  try{const result=Reflect.apply(db.close,db,[]);if(entry)entry.row.closeCallReturned=true;return result;}
  catch(error){if(entry)entry.watch.unknowns.add('journal-close-refused');throw error;}
  finally{if(entry)observeOpen(entry,'openAfterClose');}
}
export function openObservedJournalSeed(file,flags){const entry=attempt(file,true);let fd;
  try{fd=fs.openSync(file,flags);}catch(error){if(entry)entry.watch.unknowns.add('journal-seed-constructor-unknown');throw error;}
  if(entry){entry.fd=fd;entry.row.constructorReturned=true;entry.row.openAfterConstructor=true;seeds.set(fd,entry);}return fd;
}
export function syncObservedJournalSeed(fd){return fs.fsyncSync(fd);}
export function closeObservedJournalSeed(fd){const entry=seeds.get(fd);if(entry)entry.row.closeAttempts++;
  try{const result=fs.closeSync(fd);if(entry){entry.row.closeCallReturned=true;entry.row.openAfterClose=false;}return result;}
  catch(error){if(entry)entry.watch.unknowns.add('journal-seed-close-refused');throw error;}
  finally{if(entry)seeds.delete(fd);}
}
