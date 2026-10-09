// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import {isAbsolute,dirname,join,resolve,relative} from 'node:path';
import {types} from 'node:util';
import {canonical,hash,frozen} from './data.mjs';

import {SHARED_RESOURCE_SCHEMA,CHILD_RESOURCE_SCHEMA,localResourceSelector,journalSourcePaths} from './local-resource-families.mjs';
const SINGULAR=['selectorPin','sourceOwnerPin','coreSourcePin','descriptorSourcePin','validatorSourcePin'];
const NAMESPACED=['observerSourcePins','journalSourcePins'];
const extraPins=d=>d.extended?['sharedValidatorSourcePin','childRootsSourcePin']:[];
const pinFields=d=>[...SINGULAR,...extraPins(d)];
const TOP=['schema','family','fixtureId','selector',...SINGULAR,...NAMESPACED,
  'nodeVersion','writer','root','acquired','acquisitionPins','released','constructorUnknowns','teardownUnknowns','loggerCategories','traceComplete','status'];
const ROW=['id','kind','path','constructorAttempted','constructorReturned','openAfterConstructor','startAttempted','startReturned',
  'closeAttempts','closeCallReturned','closeEventObserved','openAfterClose'];
const same=(a,b)=>assert.equal(canonical(a),canonical(b),'local_resource_join_changed');
const fields=(v,n)=>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),[...n].sort());};
const number=(v,min=0)=>assert.ok(Number.isSafeInteger(v)&&v>=min,'local_resource_integer_invalid');
const text=v=>assert.ok(typeof v==='string'&&v.length&&v.length<=8192&&Buffer.from(v).toString('utf8')===v,'local_resource_text_invalid');
const decimal=v=>{text(v);assert.match(v,/^(0|[1-9][0-9]*)$/);};
function bounded(value,depth=0){
  assert.ok(depth<32&&!types.isProxy(value),'local_resource_data_invalid');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'){text(value);return value;}
  if(typeof value==='number'){number(value);return value;}
  assert.ok(value&&typeof value==='object'&&[Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(value)),'local_resource_plain_data_required');
  const array=Array.isArray(value);if(array)assert.ok(value.length<=4096,'local_resource_array_bound');
  const keys=Reflect.ownKeys(value);assert.ok(keys.length<=4097,'local_resource_key_bound');
  if(array)assert.deepEqual(keys,[...Array.from({length:value.length},(_,i)=>String(i)),'length']);
  const result=array?[]:{};
  for(const key of keys){if(array&&key==='length')continue;assert.equal(typeof key,'string');
    const d=Object.getOwnPropertyDescriptor(value,key);assert.ok(d&&d.enumerable&&Object.hasOwn(d,'value'),'local_resource_accessor_invalid');
    Object.defineProperty(result,key,{value:bounded(d.value,depth+1),enumerable:true,writable:true,configurable:true});}
  return result;
}
function pin(v){fields(v,['path','bytes','sha256']);text(v.path);assert.ok(isAbsolute(v.path)&&resolve(v.path)===v.path&&!v.path.includes('\0'));number(v.bytes,1);assert.match(v.sha256,/^[a-f0-9]{64}$/);}
function identity(v){fields(v,['path','device','inode','birthtimeNs','platform']);text(v.path);assert.ok(isAbsolute(v.path)&&!v.path.includes('\0'));
  for(const k of ['device','inode','birthtimeNs'])decimal(v[k]);assert.ok(['win32','linux','darwin'].includes(v.platform));}
function writer(v){fields(v,['processId','parentProcessId']);number(v.processId,1);number(v.parentProcessId,1);}
function recordPin(record,tuple){const bytes=Buffer.from(canonical(record)+'\n');assert.equal(tuple.bytes,bytes.length,'local_resource_raw_length_changed');assert.equal(tuple.sha256,hash(bytes),'local_resource_raw_digest_changed');}
function namespaced(v,descriptor,kind,app){
  assert.ok(Array.isArray(v)&&v.length===descriptor.namespaces.length,'local_resource_namespace_count');
  for(let i=0;i<v.length;i++){fields(v[i],['namespace','pin']);assert.equal(v[i].namespace,descriptor.namespaces[i]);pin(v[i].pin);
    assert.equal(v[i].pin.path,join(app,journalSourcePaths(v[i].namespace)[kind]));}
}
function sourcePins(v,descriptor){
  for(const k of pinFields(descriptor))pin(v[k]);const suffix=join('private-trial','trial-journal','owned-local-fixture-core.mjs');
  assert.ok(v.coreSourcePin.path.endsWith(suffix),'local_resource_core_path_invalid');const app=resolve(dirname(v.coreSourcePin.path),'../..');
  assert.equal(v.coreSourcePin.path,join(app,suffix));assert.equal(v.selectorPin.path,join(app,descriptor.selector));
  assert.equal(v.sourceOwnerPin.path,join(app,descriptor.ownerSource));assert.equal(v.descriptorSourcePin.path,join(app,'private-trial/trial-journal/local-resource-families.mjs'));
  assert.equal(v.validatorSourcePin.path,join(app,descriptor.extended?'private-trial/trial-journal/local-resource-closure-v3.mjs':'private-trial/trial-journal/local-resource-closure-v2.mjs'));
  if(descriptor.extended){assert.equal(v.sharedValidatorSourcePin.path,join(app,'private-trial/trial-journal/local-resource-closure-v2.mjs'));assert.equal(v.childRootsSourcePin.path,join(app,'private-trial/trial-journal/owned-journal-child-roots.mjs'));}
  namespaced(v.observerSourcePins,descriptor,'observer',app);namespaced(v.journalSourcePins,descriptor,'journal',app);
}
function origin(v,descriptor){
  fields(v,['schema','family','fixtureId','selector',...pinFields(descriptor),...NAMESPACED,'nodeVersion','writer','initial']);
  assert.equal(v.schema,descriptor.extended?'resident-owned-local-fixture-root-v3':'resident-owned-local-fixture-root-v2');assert.equal(v.family,descriptor.family);assert.equal(v.selector,descriptor.selector);
  text(v.fixtureId);assert.match(v.fixtureId,/^[a-f0-9-]{36}$/);sourcePins(v,descriptor);
  assert.match(v.nodeVersion,/^v[0-9]+\.[0-9]+\.[0-9]+$/);writer(v.writer);identity(v.initial);
}

export function validateReturnedLocalResourceClosure(input,{selector,nodeVersion,retainedWriter}){
  const terminal=bounded(input),retained=bounded(retainedWriter),descriptor=localResourceSelector(selector);fields(terminal,[...TOP,...extraPins(descriptor),...(descriptor.extended?['childRoots']:[])]);
  assert.equal(terminal.schema,descriptor.extended?CHILD_RESOURCE_SCHEMA:SHARED_RESOURCE_SCHEMA);assert.equal(terminal.family,descriptor.family);
  assert.equal(terminal.selector,selector);assert.equal(terminal.nodeVersion,nodeVersion);
  assert.match(nodeVersion,/^v[0-9]+\.[0-9]+\.[0-9]+$/);text(terminal.fixtureId);assert.match(terminal.fixtureId,/^[a-f0-9-]{36}$/);
  fields(retained,['processId','parentProcessId','birthIdentity',...pinFields(descriptor),...NAMESPACED,'ownershipPin','ownershipRecord','acquisitionRecords',...(descriptor.extended?['childRootRecords']:[])]);
  number(retained.processId,1);number(retained.parentProcessId,1);decimal(retained.birthIdentity);assert.notEqual(retained.birthIdentity,'0');
  writer(terminal.writer);same(terminal.writer,{processId:retained.processId,parentProcessId:retained.parentProcessId});
  sourcePins(terminal,descriptor);sourcePins(retained,descriptor);for(const k of [...pinFields(descriptor),...NAMESPACED])same(terminal[k],retained[k]);
  fields(terminal.root,['initial','ownershipPin','beforeRemoval','removed','afterRemoval']);identity(terminal.root.initial);identity(terminal.root.beforeRemoval);
  same(terminal.root.initial,terminal.root.beforeRemoval);pin(terminal.root.ownershipPin);pin(retained.ownershipPin);same(terminal.root.ownershipPin,retained.ownershipPin);
  origin(retained.ownershipRecord,descriptor);
  recordPin(retained.ownershipRecord,retained.ownershipPin);
  for(const k of ['family','fixtureId','selector',...pinFields(descriptor),...NAMESPACED,'nodeVersion','writer'])same(terminal[k],retained.ownershipRecord[k]);
  same(terminal.root.initial,retained.ownershipRecord.initial);
  assert.equal(terminal.status,'closed');assert.equal(terminal.traceComplete,true);assert.equal(terminal.root.removed,true);assert.equal(terminal.root.afterRemoval,'absent');
  for(const k of ['constructorUnknowns','teardownUnknowns','loggerCategories']){assert.ok(Array.isArray(terminal[k]));assert.equal(terminal[k].length,0,'local_resource_unknown_retained');}
  assert.ok(Array.isArray(terminal.acquired)&&terminal.acquired.length>=2&&Array.isArray(terminal.released));
  const childById=new Map();
  if(descriptor.extended){
    assert.ok(Array.isArray(terminal.childRoots)&&terminal.childRoots.length<=32&&Array.isArray(retained.childRootRecords)&&retained.childRootRecords.length===terminal.childRoots.length);
    for(let i=0;i<terminal.childRoots.length;i++){
      const child=terminal.childRoots[i],raw=retained.childRootRecords[i];
      fields(child,['id','path','mkdirAttempted','mkdirReturned','initial','attemptPin','ownershipPin','copyAttempted','copyReturned','closeAttempts','beforeRemoval','removed','afterRemoval','status']);
      assert.equal(child.id,`copy:${i+1}`);assert.equal(child.path,join(terminal.root.initial.path,`copy-${i+1}`));identity(child.initial);identity(child.beforeRemoval);
      same(child.initial,child.beforeRemoval);assert.equal(child.initial.path,child.path);assert.equal(child.mkdirAttempted,true);assert.equal(child.mkdirReturned,true);
      assert.equal(child.copyAttempted,true);assert.equal(child.copyReturned,true);assert.equal(child.closeAttempts,1);assert.equal(child.removed,true);assert.equal(child.afterRemoval,'absent');assert.equal(child.status,'closed');
      pin(child.attemptPin);pin(child.ownershipPin);fields(raw,['attemptPin','attemptRecord','ownershipPin','ownershipRecord']);same(raw.attemptPin,child.attemptPin);same(raw.ownershipPin,child.ownershipPin);
      fields(raw.attemptRecord,['schema','fixtureId','family','selector','writer','parentInitial','id','path',...pinFields(descriptor),...NAMESPACED]);
      assert.equal(raw.attemptRecord.schema,'resident-owned-journal-copy-attempt-v1');recordPin(raw.attemptRecord,child.attemptPin);
      fields(raw.ownershipRecord,['schema','fixtureId','family','selector','writer','parentInitial','id','initial','attemptPin',...pinFields(descriptor),...NAMESPACED]);
      assert.equal(raw.ownershipRecord.schema,'resident-owned-journal-copy-root-v1');recordPin(raw.ownershipRecord,child.ownershipPin);
      for(const value of [raw.attemptRecord,raw.ownershipRecord]){for(const k of ['fixtureId','family','selector','writer',...pinFields(descriptor),...NAMESPACED])same(value[k],terminal[k]);same(value.parentInitial,terminal.root.initial);assert.equal(value.id,child.id);}
      assert.equal(raw.attemptRecord.path,child.path);same(raw.ownershipRecord.initial,child.initial);same(raw.ownershipRecord.attemptPin,child.attemptPin);
      const external=dirname(terminal.root.ownershipPin.path);assert.equal(child.attemptPin.path,join(external,`local-ledger-${terminal.fixtureId}-copy-${i+1}-directory-acquire.json`));
      assert.equal(child.ownershipPin.path,join(external,`local-ledger-${terminal.fixtureId}-copy-${i+1}-directory-origin.json`));childById.set(child.id,child);
    }
  }
  const ids=new Set(),journalNamespaces=new Set();let servers=0,histories=0,journals=0,seeds=0;
  for(const row of terminal.acquired){
    fields(row,ROW);text(row.id);assert.equal(ids.has(row.id),false,'local_resource_duplicate_identity');ids.add(row.id);
    assert.equal(row.constructorAttempted,true);assert.equal(row.constructorReturned,true);
    assert.equal(row.closeAttempts,1);assert.equal(row.closeCallReturned,true);assert.equal(row.openAfterClose,false);
    if(row.kind==='http'){
      servers++;assert.equal(row.id,'server:1');assert.equal(row.path,null);assert.equal(row.openAfterConstructor,false);
      assert.equal(row.startAttempted,true);assert.equal(row.startReturned,true);assert.equal(row.closeEventObserved,true);
    }else{
      assert.equal(row.openAfterConstructor,true);
      assert.equal(row.startAttempted,false);assert.equal(row.startReturned,false);assert.equal(row.closeEventObserved,null);
      if(row.kind==='sqlite-history'){histories++;assert.match(row.id,/^history:[1-9][0-9]*$/);assert.equal(row.path,join(terminal.root.initial.path,'history.db'));}
      else{assert.ok(row.kind==='sqlite-journal'||row.kind==='file-journal-seed');const match=/^(journal|seed):(experiment|private):(?:(copy:[1-9][0-9]*):)?[1-9][0-9]*$/.exec(row.id);assert.ok(match&&descriptor.namespaces.includes(match[2]));
        assert.ok(descriptor.extended||!match[3]);if(match[3])assert.ok(childById.has(match[3]),'local_resource_unknown_child_root');
        assert.equal(match[1],row.kind==='sqlite-journal'?'journal':'seed');if(row.kind==='sqlite-journal'){journals++;journalNamespaces.add(match[2]);}else seeds++;
        assert.equal(row.path,join(match[3]?childById.get(match[3]).path:join(terminal.root.initial.path,'owner'),'trial-journal.sqlite'));}
    }
  }
  if(descriptor.http==='double'||descriptor.http==='raw')assert.equal(servers,1);else assert.ok(servers<=1);
  if(descriptor.histories)assert.ok(histories>=1);else assert.equal(histories,0);
  assert.ok(journals>=1&&seeds>=1&&journalNamespaces.size>=1,'local_resource_missing_actual_acquisitions');
  assert.ok(new Set(terminal.released).size===terminal.released.length);same([...terminal.released].sort(),[...ids].sort());
  assert.ok(Array.isArray(terminal.acquisitionPins)&&terminal.acquisitionPins.length===ids.size&&Array.isArray(retained.acquisitionRecords)&&retained.acquisitionRecords.length===ids.size);
  const acquiredIds=new Set();
  for(let i=0;i<terminal.acquisitionPins.length;i++){
    const tuple=retained.acquisitionRecords[i];fields(tuple,['pin','record']);pin(tuple.pin);pin(terminal.acquisitionPins[i]);same(tuple.pin,terminal.acquisitionPins[i]);
    fields(tuple.record,['schema','fixtureId','selector','writer','initial','id','kind','path','namespace','observerSourcePin','journalSourcePin',...(descriptor.extended?['rootId','rootOriginPin']:[])]);assert.equal(tuple.record.schema,descriptor.extended?'resident-owned-local-resource-acquisition-v3':'resident-owned-local-resource-acquisition-v2');
    recordPin(tuple.record,tuple.pin);
    for(const k of ['fixtureId','selector','writer'])same(tuple.record[k],terminal[k]);same(tuple.record.initial,terminal.root.initial);
    const resource=terminal.acquired.find(r=>r.id===tuple.record.id);assert.ok(resource&&!acquiredIds.has(resource.id),'local_resource_acquisition_join_invalid');acquiredIds.add(resource.id);
    for(const k of ['id','kind','path'])same(tuple.record[k],resource[k]);
    if(resource.kind==='sqlite-journal'||resource.kind==='file-journal-seed'){const namespace=resource.id.split(':')[1];assert.equal(tuple.record.namespace,namespace);
      same(tuple.record.observerSourcePin,terminal.observerSourcePins.find(p=>p.namespace===namespace).pin);same(tuple.record.journalSourcePin,terminal.journalSourcePins.find(p=>p.namespace===namespace).pin);}
    else{assert.equal(tuple.record.namespace,null);assert.equal(tuple.record.observerSourcePin,null);assert.equal(tuple.record.journalSourcePin,null);}
    if(descriptor.extended){
      if(resource.kind==='sqlite-journal'||resource.kind==='file-journal-seed'){const match=/^(journal|seed):(experiment|private):(?:(copy:[1-9][0-9]*):)?[1-9][0-9]*$/.exec(resource.id);
        assert.equal(tuple.record.rootId,match[3]??'owner');if(match[3])same(tuple.record.rootOriginPin,childById.get(match[3]).ownershipPin);else assert.equal(tuple.record.rootOriginPin,null);}
      else{assert.equal(tuple.record.rootId,null);assert.equal(tuple.record.rootOriginPin,null);}
    }
    assert.equal(tuple.pin.path,join(dirname(terminal.root.ownershipPin.path),`local-ledger-${terminal.fixtureId}-${resource.id.replaceAll(':','-')}-acquire.json`));
  }
  const external=dirname(terminal.root.ownershipPin.path),rel=relative(terminal.root.initial.path,external);
  assert.ok(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+(process.platform==='win32'?'\\':'/')),'local_resource_external_ownership_required');
  assert.equal(terminal.root.ownershipPin.path,join(external,`local-ledger-ownership-${terminal.fixtureId}.json`));
  return frozen(terminal);
}
