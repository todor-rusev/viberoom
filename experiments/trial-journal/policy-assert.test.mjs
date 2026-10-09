// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import strict from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert,{PolicyRefusal,Held,isRefusal,refusalAsNo,readPinned,fileInput,parseInput,fileChanged} from './policy-assert.mjs';
import {SqlReadOnlyViolation} from '../../dist/memory/sql-read-only-fence.js';

const caught=f=>{try{f();}catch(error){return error;}strict.fail('nothing thrown');};

test('a failed check of input is a PolicyRefusal with the exact message, values and code of the check', ()=>{
  for(const [check,original] of [[()=>assert.equal(1,2,'permit_refused'),()=>strict.equal(1,2,'permit_refused')],
    [()=>assert.ok(false,'native_handoff_not_acquired'),()=>strict.ok(false,'native_handoff_not_acquired')],
    [()=>assert.deepEqual({a:1},{a:2}),()=>strict.deepEqual({a:1},{a:2})],[()=>assert(0,'callable'),()=>strict(0,'callable')]]){
    const refusal=caught(check),plain=caught(original);
    strict.ok(refusal instanceof PolicyRefusal&&refusal instanceof strict.AssertionError);
    strict.equal(refusal.message,plain.message);strict.equal(refusal.code,'ERR_ASSERTION');strict.equal(refusal.operator,plain.operator);
    strict.deepEqual([refusal.actual,refusal.expected],[plain.actual,plain.expected]);strict.ok(refusal.cause instanceof strict.AssertionError);
  }
});

test('passing checks return as node:assert/strict does, async ones included', async ()=>{
  strict.equal(assert.ok(true),undefined);strict.equal(assert.equal(1,1),undefined);
  await assert.rejects(Promise.reject(new Error('expected')));
  strict.ok(await assert.rejects(Promise.resolve(1)).then(()=>false,error=>error instanceof PolicyRefusal));
});

test('refusalAsNo: a refusal is no, any other error leaves as the same object', ()=>{
  strict.equal(refusalAsNo(()=>true),true);strict.equal(refusalAsNo(()=>false),false);
  for(const refusal of [()=>assert.fail('refused'),()=>{throw new Held('held');},()=>{throw new SqlReadOnlyViolation('changed');}])strict.equal(refusalAsNo(refusal),false);
  const bug=new TypeError('a bug'),plainAssertion=caught(()=>strict.ok(false,'invariant'));
  strict.equal(caught(()=>refusalAsNo(()=>{throw bug;})),bug);
  strict.equal(caught(()=>refusalAsNo(()=>{throw plainAssertion;})),plainAssertion,'an invariant (node:assert/strict) is not a refusal');
  strict.ok(isRefusal(new Held('x'))&&!isRefusal(new Error('x'))&&!isRefusal(plainAssertion));
});

test('files and JSON of input: changed or unparsable refuses with its reason; other errors leave', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'viberoom-policy-assert-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'pin.json');fs.writeFileSync(file,'{"a":1}');
  strict.deepEqual(readPinned(file),Buffer.from('{"a":1}'));strict.equal(readPinned(path.join(dir,'gone.json')),null);strict.equal(readPinned(dir),null);
  strict.equal(fileChanged(caught(()=>fs.readFileSync(path.join(dir,'gone.json')))),true);
  const missing=caught(()=>fileInput(()=>fs.readFileSync(path.join(dir,'gone.json')),'input_file_changed'));
  strict.ok(missing instanceof PolicyRefusal);strict.equal(missing.message,'input_file_changed');
  const other=new RangeError('not a file change');strict.equal(caught(()=>fileInput(()=>{throw other;},'input_file_changed')),other);
  strict.deepEqual(parseInput('{"a":1}','input_invalid_json'),{a:1});
  const invalid=caught(()=>parseInput('{"a":','input_invalid_json'));strict.ok(invalid instanceof PolicyRefusal);strict.equal(invalid.message,'input_invalid_json');
});
