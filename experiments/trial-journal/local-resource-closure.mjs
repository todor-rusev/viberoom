// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import {isAbsolute,dirname,join} from 'node:path';
import {types} from 'node:util';
import {canonical,hash,frozen} from './data.mjs';

export const LOCAL_RESOURCE_SCHEMA='resident-owned-local-resource-closure-v1';
export const PRODUCT_SELECTOR='experiments/memory-retrieval-trial-d5/product-step.test.mjs';
export const PRIVATE_SELECTOR='experiments/memory-retrieval-trial-d5/private-launch.test.mjs';
const TOP=['schema','family','fixtureId','selector','selectorPin','sourceOwnerPin','observerSourcePin','validatorSourcePin',
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
function pin(v){fields(v,['path','bytes','sha256']);text(v.path);assert.ok(isAbsolute(v.path)&&!v.path.includes('\0'));number(v.bytes,1);assert.match(v.sha256,/^[a-f0-9]{64}$/);}
function identity(v){fields(v,['path','device','inode','birthtimeNs','platform']);text(v.path);assert.ok(isAbsolute(v.path)&&!v.path.includes('\0'));
  for(const k of ['device','inode','birthtimeNs'])decimal(v[k]);assert.ok(['win32','linux','darwin'].includes(v.platform));}
function writer(v){fields(v,['processId','parentProcessId']);number(v.processId,1);number(v.parentProcessId,1);}
function recordPin(record,tuple){const bytes=Buffer.from(canonical(record)+'\n');assert.equal(tuple.bytes,bytes.length,'local_resource_raw_length_changed');assert.equal(tuple.sha256,hash(bytes),'local_resource_raw_digest_changed');}
function origin(v){
  fields(v,['schema','family','fixtureId','selector','selectorPin','sourceOwnerPin','observerSourcePin','validatorSourcePin','nodeVersion','writer','initial']);
  assert.equal(v.schema,'resident-owned-local-fixture-root-v1');assert.equal(v.family,'product-step');
  text(v.fixtureId);assert.match(v.fixtureId,/^[a-f0-9-]{36}$/);assert.equal(v.selector,PRODUCT_SELECTOR);
  for(const k of ['selectorPin','sourceOwnerPin','observerSourcePin','validatorSourcePin'])pin(v[k]);
  assert.match(v.nodeVersion,/^v[0-9]+\.[0-9]+\.[0-9]+$/);writer(v.writer);identity(v.initial);
}

export function validateReturnedLocalResourceClosure(input,{selector,nodeVersion,retainedWriter}){
  const terminal=bounded(input),retained=bounded(retainedWriter);fields(terminal,TOP);
  assert.equal(terminal.schema,LOCAL_RESOURCE_SCHEMA);assert.equal(terminal.family,'product-step');
  assert.equal(selector,PRODUCT_SELECTOR);assert.equal(terminal.selector,selector);assert.equal(terminal.nodeVersion,nodeVersion);
  assert.match(nodeVersion,/^v[0-9]+\.[0-9]+\.[0-9]+$/);text(terminal.fixtureId);assert.match(terminal.fixtureId,/^[a-f0-9-]{36}$/);
  fields(retained,['processId','parentProcessId','birthIdentity','selectorPin','sourceOwnerPin','observerSourcePin','validatorSourcePin','ownershipPin','ownershipRecord','acquisitionRecords']);
  number(retained.processId,1);number(retained.parentProcessId,1);decimal(retained.birthIdentity);assert.notEqual(retained.birthIdentity,'0');
  writer(terminal.writer);same(terminal.writer,{processId:retained.processId,parentProcessId:retained.parentProcessId});
  for(const k of ['selectorPin','sourceOwnerPin','observerSourcePin','validatorSourcePin']){pin(terminal[k]);pin(retained[k]);same(terminal[k],retained[k]);}
  fields(terminal.root,['initial','ownershipPin','beforeRemoval','removed','afterRemoval']);identity(terminal.root.initial);identity(terminal.root.beforeRemoval);
  same(terminal.root.initial,terminal.root.beforeRemoval);pin(terminal.root.ownershipPin);pin(retained.ownershipPin);same(terminal.root.ownershipPin,retained.ownershipPin);
  origin(retained.ownershipRecord);
  recordPin(retained.ownershipRecord,retained.ownershipPin);
  for(const k of ['family','fixtureId','selector','selectorPin','sourceOwnerPin','observerSourcePin','validatorSourcePin','nodeVersion','writer'])same(terminal[k],retained.ownershipRecord[k]);
  same(terminal.root.initial,retained.ownershipRecord.initial);
  assert.equal(terminal.status,'closed');assert.equal(terminal.traceComplete,true);assert.equal(terminal.root.removed,true);assert.equal(terminal.root.afterRemoval,'absent');
  for(const k of ['constructorUnknowns','teardownUnknowns','loggerCategories']){assert.ok(Array.isArray(terminal[k]));assert.equal(terminal[k].length,0,'local_resource_unknown_retained');}
  assert.ok(Array.isArray(terminal.acquired)&&terminal.acquired.length>=3&&Array.isArray(terminal.released));
  const ids=new Set();let servers=0,histories=0,journals=0;
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
      else{assert.equal(row.kind,'sqlite-journal');journals++;assert.match(row.id,/^journal:[1-9][0-9]*$/);assert.equal(row.path,join(terminal.root.initial.path,'owner','trial-journal.sqlite'));}
    }
  }
  assert.equal(servers,1);assert.ok(histories>=1&&journals>=1,'local_resource_missing_actual_acquisitions');
  assert.ok(new Set(terminal.released).size===terminal.released.length);same([...terminal.released].sort(),[...ids].sort());
  assert.ok(Array.isArray(terminal.acquisitionPins)&&terminal.acquisitionPins.length===ids.size&&Array.isArray(retained.acquisitionRecords)&&retained.acquisitionRecords.length===ids.size);
  const acquiredIds=new Set();
  for(let i=0;i<terminal.acquisitionPins.length;i++){
    const tuple=retained.acquisitionRecords[i];fields(tuple,['pin','record']);pin(tuple.pin);pin(terminal.acquisitionPins[i]);same(tuple.pin,terminal.acquisitionPins[i]);
    fields(tuple.record,['schema','fixtureId','selector','writer','initial','id','kind','path']);assert.equal(tuple.record.schema,'resident-owned-local-resource-acquisition-v1');
    recordPin(tuple.record,tuple.pin);
    for(const k of ['fixtureId','selector','writer'])same(tuple.record[k],terminal[k]);same(tuple.record.initial,terminal.root.initial);
    const resource=terminal.acquired.find(r=>r.id===tuple.record.id);assert.ok(resource&&!acquiredIds.has(resource.id),'local_resource_acquisition_join_invalid');acquiredIds.add(resource.id);
    for(const k of ['id','kind','path'])same(tuple.record[k],resource[k]);
  }
  assert.notEqual(dirname(terminal.root.ownershipPin.path),terminal.root.initial.path,'local_resource_external_ownership_required');
  return frozen(terminal);
}
