// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert,{fileInput,parseInput,refusalAsNo} from './trial-journal/policy-assert.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {sourceVersion} from '../dist/memory/provenance.js';
import {PRIVATE_TRIAL_DEPLOYMENT_OUTDATED} from '../dist/memory/private-trial-deployment.js';
import {json,fields,encode,sha256} from './memory-retrieval-comparison-d3/contracts.mjs';
import {inventoryDigest} from './memory-retrieval-trial-d5/tree-inventory.mjs';
import {canonicalBytes,canonicalDocument,ordinaryFile,exact,pin} from './canonical-files.mjs';

export const OWNED_INPUTS_FOLDER='private-trial-inputs';
export const OWNED_INPUTS_SCHEMA='viberoom-resident-owned-inputs-v2';
const names=Object.freeze(['BOUND-PREPARATION.json','PREPARED-PROFILE.json','SIEVE-VERDICTS.json','TREE-INVENTORY.json','ingestion.json']);
const SIEVE_VERDICTS_SCHEMA='viberoom-retrieval-sieve-verdicts-v1';
const allNames=Object.freeze(['INPUTS.json',...names].sort());
const bound=64*1024*1024;
const digest=value=>sha256(encode(value));
const clone=value=>json(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function directory(filename){
  assert.ok(typeof filename==='string'&&path.isAbsolute(filename)&&path.normalize(filename)===filename,'owned_inputs_hub_directory');
  const parts=[];let at=filename;while(path.dirname(at)!==at){parts.push(at);at=path.dirname(at);}parts.push(at);
  for(const part of parts.reverse()){const s=fileInput(()=>fs.lstatSync(part),'owned_inputs_directory_or_link');assert.ok(s.isDirectory()&&!s.isSymbolicLink(),'owned_inputs_directory_or_link');}
}
function root(dataDir){
  assert.ok(typeof dataDir==='string','owned_inputs_hub_directory');
  const data=path.normalize(dataDir);directory(data);return path.join(data,OWNED_INPUTS_FOLDER);
}
function bytes(file){const s=fileInput(()=>fs.lstatSync(file),'owned_inputs_regular_single_link_file');assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1,'owned_inputs_regular_single_link_file');assert.ok(s.size<=bound,'owned_inputs_byte_bound');return ordinaryFile(file);}
function checkedTemplate(value,expectedSha,raw){
  assert.match(expectedSha,/^[a-f0-9]{64}$/);assert.equal(sha256(raw),expectedSha,'owned_inputs_template_bytes');
  exact(parseInput(raw.toString('utf8'),'owned_inputs_invalid_json'),value,'owned_inputs_template_value');
  assert.ok(Array.isArray(value.payloads?.rows)&&value.payloads.rows.length>0&&value.payloads.rows.every(r=>Array.isArray(r.members)&&r.members.length>0),'owned_inputs_template_rows');
  assert.equal(new Set(value.payloads.rows.flatMap(r=>r.members.map(m=>m.opId))).size,value.payloads.rows.flatMap(r=>r.members).length,'owned_inputs_template_members');
}
function checkedTree(template,raw){
  const tree=parseInput(raw.toString('utf8'),'owned_inputs_invalid_json');
  assert.ok(tree&&Array.isArray(tree.files)&&typeof tree.definitionSha256==='string','owned_inputs_tree_inventory');
  assert.equal(inventoryDigest(tree),tree.sha256,'owned_inputs_tree_inventory');assert.equal(tree.sha256,template.review.acceptedCETree,'owned_inputs_tree_not_the_templates');
  return tree.sha256;
}
function checkedSieve(preparation,raw){
  assert.equal(sha256(raw),preparation.sieve?.verdictsSha256,'owned_inputs_sieve_verdicts');
  const sieve=parseInput(raw.toString('utf8'),'owned_inputs_invalid_json');
  assert.ok(sieve?.schema===SIEVE_VERDICTS_SCHEMA&&sieve.corpusSha256===preparation.corpusSha256&&Array.isArray(sieve.verdicts),'owned_inputs_sieve_verdicts');
  return sieve;
}
function checkedCheckout(value){
  fields(value,['sha','origin']);assert.ok(/^[0-9a-f]{40}$/.test(value.sha)&&['git-commit','git-commit-modified','synthetic'].includes(value.origin),'owned_inputs_checkout');
  return {sha:value.sha,origin:value.origin};
}
function ingestion(template,input,{legacy=false}={}){
  const d=clone(input);if(!legacy){fields(d,['schema','corpusSha256','sources']);assert.equal(d.schema,'viberoom-resident-ingestion-inputs-v1');assert.equal(d.corpusSha256,template.manifest.corpusSha256);}
  assert.ok(Array.isArray(d.sources),'owned_inputs_sources');
  const wanted=[...new Set(template.payloads.rows.map(r=>r.sourceId))].sort(),selected=[];
  for(const id of wanted){
    const matches=d.sources.filter(s=>s&&s.id===id);assert.equal(matches.length,1,'owned_inputs_source_missing_or_duplicate');const s=matches[0];
    if(!legacy)fields(s,['id','room','author','at','text']);
    for(const k of ['id','room','author','at','text'])assert.ok(typeof s[k]==='string'&&s[k].length,'owned_inputs_source_field');
    assert.ok(Number.isFinite(Date.parse(s.at)),'owned_inputs_source_time');
    if(Object.hasOwn(s,'status'))assert.equal(s.status,'available','owned_inputs_original_unavailable');
    const version=sourceVersion({id:s.id,from:s.author,fromName:s.author,ts:Date.parse(s.at),kind:'chat',text:s.text});
    for(const row of template.payloads.rows.filter(r=>r.sourceId===id)){
      assert.equal(s.room,row.logicalRoom,'owned_inputs_logical_room');assert.ok(row.members.length);
      for(const member of row.members)assert.equal(version,member.identity.version,'owned_inputs_source_version');
    }
    selected.push(Object.fromEntries(['id','room','author','at','text'].map(k=>[k,s[k]])));
  }
  if(!legacy)exact(d.sources,selected,'owned_inputs_exact_selected_sources');
  return {schema:'viberoom-resident-ingestion-inputs-v1',corpusSha256:template.manifest.corpusSha256,sources:selected};
}
export function prepareOwnedTrialInputBytes({templateBytes,preparationBytes,ingestionBytes,sieveBytes,treeBytes,checkout}){
  for(const b of [templateBytes,preparationBytes,ingestionBytes,sieveBytes,treeBytes])assert.ok(Buffer.isBuffer(b)&&b.length<=bound);
  const templateSha256=sha256(templateBytes),template=clone(parseInput(templateBytes.toString('utf8'),'owned_inputs_invalid_json'));checkedTemplate(template,templateSha256,templateBytes);
  const preparation=clone(parseInput(preparationBytes.toString('utf8'),'owned_inputs_invalid_json'));assert.equal(digest(preparation),template.manifest.inputs.preparationSha256,'owned_inputs_bound_preparation');
  const normalized=ingestion(template,parseInput(ingestionBytes.toString('utf8'),'owned_inputs_invalid_json'),{legacy:true});
  checkedSieve(preparation,sieveBytes);const treeInventorySha256=checkedTree(template,treeBytes);
  return Object.freeze({templateSha256,treeInventorySha256,checkout:Object.freeze(checkedCheckout(checkout)),files:Object.freeze([
    Object.freeze({name:'BOUND-PREPARATION.json',bytes:Buffer.from(preparationBytes)}),
    Object.freeze({name:'PREPARED-PROFILE.json',bytes:Buffer.from(templateBytes)}),
    Object.freeze({name:'SIEVE-VERDICTS.json',bytes:Buffer.from(sieveBytes)}),
    Object.freeze({name:'TREE-INVENTORY.json',bytes:Buffer.from(treeBytes)}),
    Object.freeze({name:'ingestion.json',bytes:canonicalBytes(normalized)})])});
}
export function assertOwnedTrialInputsAbsent(dataDir){assert.equal(fs.existsSync(root(dataDir)),false,'owned_inputs_nonadoption');}
export function createOwnedTrialInputs(dataDir,prepared){
  const folder=root(dataDir);assertOwnedTrialInputsAbsent(dataDir);
  assert.match(prepared.templateSha256,/^[a-f0-9]{64}$/);assert.match(prepared.treeInventorySha256,/^[a-f0-9]{64}$/);exact(prepared.files.map(f=>f.name),names);
  const checkout=checkedCheckout(prepared.checkout);
  fs.mkdirSync(folder);directory(folder);const pins=[];
  const create=(name,b)=>{assert.ok(Buffer.isBuffer(b)&&b.length<=bound);const file=path.join(folder,name),fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const p={path:file,bytes:b.length,sha256:sha256(b)};pins.push(p);return p;};
  const files=prepared.files.map(f=>{const p=create(f.name,f.bytes);return {name:f.name,bytes:p.bytes,sha256:p.sha256};});
  create('INPUTS.json',canonicalBytes({schema:OWNED_INPUTS_SCHEMA,hubDataDir:path.normalize(dataDir),templateProfileSha256:prepared.templateSha256,
    treeInventorySha256:prepared.treeInventorySha256,checkout,files}));
  return freeze(clone(pins));
}
export function readOwnedTrialInputs({hub}){
  assert.ok(hub&&hub.history&&hub.memoryStore&&typeof hub.memoryTrialAccountContext==='function','owned_inputs_actual_hub_required');
  const folder=root(hub.dataDir);directory(folder);
  const observe=()=>{
    directory(folder);exact(fileInput(()=>fs.readdirSync(folder),'owned_inputs_exact_file_set').sort(),allNames,'owned_inputs_exact_file_set');
    const manifestBytes=bytes(path.join(folder,'INPUTS.json')),manifest=canonicalDocument(manifestBytes);
    assert.ok(manifest?.schema!=='viberoom-resident-owned-inputs-v1',PRIVATE_TRIAL_DEPLOYMENT_OUTDATED);
    fields(manifest,['schema','hubDataDir','templateProfileSha256','treeInventorySha256','checkout','files']);assert.equal(manifest.schema,OWNED_INPUTS_SCHEMA);checkedCheckout(manifest.checkout);
    assert.equal(manifest.hubDataDir,path.normalize(hub.dataDir));
    assert.ok(Array.isArray(manifest.files));exact(manifest.files.map(p=>p.name),names);
    const files=manifest.files.map(p=>{fields(p,['name','bytes','sha256']);const b=bytes(path.join(folder,p.name));pin({path:path.join(folder,p.name),bytes:p.bytes,sha256:p.sha256});
      assert.equal(b.length,p.bytes);assert.equal(sha256(b),p.sha256);return {name:p.name,bytes:b};});
    return {manifest,manifestBytes,files};
  };
  const original=observe(),get=name=>original.files.find(f=>f.name===name).bytes;
  const template=clone(parseInput(get('PREPARED-PROFILE.json').toString('utf8'),'owned_inputs_invalid_json'));
  checkedTemplate(template,original.manifest.templateProfileSha256,get('PREPARED-PROFILE.json'));
  const treeInventorySha256=checkedTree(template,get('TREE-INVENTORY.json'));assert.equal(treeInventorySha256,original.manifest.treeInventorySha256,'owned_inputs_tree_inventory');
  const preparation=clone(parseInput(get('BOUND-PREPARATION.json').toString('utf8'),'owned_inputs_invalid_json'));assert.equal(digest(preparation),template.manifest.inputs.preparationSha256,'owned_inputs_bound_preparation');
  const sieve=checkedSieve(preparation,get('SIEVE-VERDICTS.json'));
  const normalized=ingestion(template,canonicalDocument(get('ingestion.json')));
  const pins=[{path:path.join(folder,'INPUTS.json'),bytes:original.manifestBytes.length,sha256:sha256(original.manifestBytes)},...original.files.map(f=>({path:path.join(folder,f.name),bytes:f.bytes.length,sha256:sha256(f.bytes)}))];
  const current=()=>refusalAsNo(()=>{const now=observe();assert.ok(now.manifestBytes.equals(original.manifestBytes));for(const f of now.files)assert.ok(f.bytes.equals(get(f.name)));return true;});
  assert.equal(current(),true);
  return Object.freeze({template:freeze(clone(template)),templateSha256:original.manifest.templateProfileSha256,boundPreparation:freeze(preparation),
    sources:freeze(normalized.sources),sieve:freeze(clone(sieve)),tree:Object.freeze({file:path.join(folder,'TREE-INVENTORY.json'),sha256:treeInventorySha256}),
    checkout:freeze(checkedCheckout(original.manifest.checkout)),pins:freeze(pins),current});
}
