// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from './policy-assert.mjs';
import {createHash} from 'node:crypto';
import {types} from 'node:util';

export function data(value, depth=0) {
  assert.ok(depth<64 && !types.isProxy(value),'invalid_trial_data');
  if(value===null || typeof value==='string' || typeof value==='boolean') return value;
  if(typeof value==='number') {assert.ok(Number.isFinite(value)); return value;}
  assert.ok(value && typeof value==='object');
  const array=Array.isArray(value),keys=Reflect.ownKeys(value);
  assert.ok(array || [Object.prototype,null].includes(Object.getPrototypeOf(value)));
  if(array)assert.deepEqual(keys,[...Array.from({length:value.length},(_,i)=>String(i)),'length']);
  const result=array?[]:{};
  for(const key of keys){
    if(array && key==='length')continue;
    assert.equal(typeof key,'string');
    const d=Object.getOwnPropertyDescriptor(value,key);
    assert.ok(d && d.enumerable && Object.hasOwn(d,'value'),'accessor_or_hidden_trial_data');
    Object.defineProperty(result,key,{value:data(d.value,depth+1),enumerable:true,writable:true,configurable:true});
  }
  return result;
}
export function fields(v,names){assert.ok(v && typeof v==='object' && !Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),[...names].sort());}
export function text(v){assert.ok(typeof v==='string' && v.length && Buffer.from(v).toString('utf8')===v);return v;}
export function int(v,min=0,max=1e9){assert.ok(Number.isSafeInteger(v) && v>=min && v<=max);return v;}
export function digest(v){assert.match(v,/^[a-f0-9]{64}$/);return v;}
export function canonical(v){const sorted=x=>Array.isArray(x)?x.map(sorted):x && typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;return JSON.stringify(sorted(data(v)));}
export const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:canonical(v)).digest('hex');
export function frozen(v){v=data(v);const freeze=x=>{if(x && typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};return freeze(v);}
