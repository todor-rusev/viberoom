// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {readFileSync} from 'node:fs';
import {policyAssert,PolicyRefusal,fileChanged} from '../../dist/memory/policy-refusal.js';
import {SqlReadOnlyViolation} from '../../dist/memory/sql-read-only-fence.js';

export default policyAssert;
export {PolicyRefusal,fileChanged};

export class Held extends Error{constructor(reason){super(reason);this.name='Held';}}

export const isRefusal=error=>error instanceof PolicyRefusal||error instanceof Held||error instanceof SqlReadOnlyViolation;

export function refusalAsNo(check){
  try{return check();}
  catch(error){if(isRefusal(error))return false;throw error;}
}

export function readPinned(file){
  try{return readFileSync(file);}
  catch(error){if(fileChanged(error))return null;throw error;}
}

export function fileInput(operation,reason){
  try{return operation();}
  catch(error){if(fileChanged(error))policyAssert.fail(reason);throw error;}
}

export function parseInput(text,reason){
  try{return JSON.parse(text);}
  catch(error){if(error instanceof SyntaxError)policyAssert.fail(reason);throw error;}
}
