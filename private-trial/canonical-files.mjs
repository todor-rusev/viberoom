// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert,{fileInput,parseInput} from './trial-journal/policy-assert.mjs';
import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {json,fields,canonical,integer} from './memory-retrieval-comparison-d3/contracts.mjs';

export const canonicalBytes=value=>Buffer.from(canonical(value)+'\n');
export const exact=(a,b,reason='canonical_value_mismatch')=>assert.equal(canonical(a),canonical(b),reason);
export function canonicalDocument(bytes){
  assert.ok(Buffer.isBuffer(bytes),'canonical_bytes_required');
  const value=json(parseInput(bytes.toString('utf8'),'canonical_invalid_json'));
  assert.ok(bytes.equals(canonicalBytes(value)),'canonical_noncanonical_bytes');return value;
}
export function ordinaryFile(filename){
  assert.ok(path.isAbsolute(filename)&&path.normalize(filename)===filename,'ordinary_file_absolute_normalized_path');
  const parts=[];let p=filename;while(path.dirname(p)!==p){parts.push(p);p=path.dirname(p);}parts.push(p);
  for(const name of parts.reverse())assert.equal(fileInput(()=>lstatSync(name),'ordinary_file_required').isSymbolicLink(),false,'ordinary_file_link_in_path');
  assert.equal(fileInput(()=>lstatSync(filename),'ordinary_file_required').isFile(),true,'ordinary_file_required');
  return fileInput(()=>readFileSync(filename),'ordinary_file_required');
}
export function pin(value){fields(value,['path','bytes','sha256']);assert.ok(typeof value.path==='string');integer(value.bytes,0,Number.MAX_SAFE_INTEGER);assert.match(value.sha256,/^[a-f0-9]{64}$/);return value;}
