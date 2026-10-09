// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {sourceVersion} from '../dist/memory/provenance.js';
import {encode,sha256} from './memory-retrieval-comparison-d3/contracts.mjs';
import {canonicalBytes} from './canonical-files.mjs';
import {inventoryDigest} from './memory-retrieval-trial-d5/tree-inventory.mjs';
import {prepareOwnedTrialInputBytes,createOwnedTrialInputs,readOwnedTrialInputs,OWNED_INPUTS_SCHEMA} from './owned-trial-inputs.mjs';

const NAMES=['BOUND-PREPARATION.json','INPUTS.json','PREPARED-PROFILE.json','SIEVE-VERDICTS.json','TREE-INVENTORY.json','ingestion.json'];
function tree(seed){const files=[{path:'src/synthetic.ts',size:seed.length,sha256:sha256(seed)}],definitionSha256='d'.repeat(64);return {definitionSha256,files,sha256:inventoryDigest({definitionSha256,files})};}
function world(t,{count=17}={}){
  const dataDir=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'viberoom owned inputs ')));t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  const hub={dataDir,history:{},memoryStore:{},memoryTrialAccountContext(){throw Error('DATA_CONTROL_MUST_NOT_ACCESS_ACCOUNT');}};
  const sources=Array.from({length:count},(_,i)=>({id:'synthetic-'+String(i).padStart(2,'0'),room:'synthetic-room',author:'synthetic-author',at:'2026-09-01T00:00:00Z',status:'available',text:'explicit synthetic source '+i+'\nwith original Unicode Ж'}));
  const corpusSha256='a'.repeat(64),inventory=tree('synthetic tree');
  const sieveBytes=encode({schema:'viberoom-retrieval-sieve-verdicts-v1',corpusSha256,verdicts:sources.map(s=>({sourceId:s.id,keep:true}))});
  const preparation={schema:'explicit-synthetic-data-only',corpusSha256,sieve:{verdictsSha256:sha256(sieveBytes)}};
  const template={schema:'explicit-synthetic-data-only',review:{acceptedCETree:inventory.sha256},manifest:{corpusSha256,inputs:{preparationSha256:sha256(encode(preparation))}},
    payloads:{rows:sources.flatMap(s=>['baseline','original'].map(variant=>({sourceId:s.id,logicalRoom:s.room,variant,
      members:[{opId:`${s.id}:${variant}`,identity:{version:sourceVersion({id:s.id,from:s.author,fromName:s.author,ts:Date.parse(s.at),kind:'chat',text:s.text})}}]})))}};
  const args={templateBytes:encode(template),preparationBytes:encode(preparation),ingestionBytes:encode({synthetic:true,sources,questions:[{evaluatorOnly:'excluded'}]}),
    sieveBytes,treeBytes:encode(inventory),checkout:{sha:'0'.repeat(40),origin:'synthetic'}};
  const prepared=()=>prepareOwnedTrialInputBytes(args),install=()=>createOwnedTrialInputs(dataDir,prepared()),read=()=>readOwnedTrialInputs({hub});
  const folder=path.join(dataDir,'private-trial-inputs'),manifestFile=path.join(folder,'INPUTS.json');
  const rewriteManifest=(change=()=>{})=>{const m=JSON.parse(fs.readFileSync(manifestFile));for(const p of m.files){const b=fs.readFileSync(path.join(folder,p.name));p.bytes=b.length;p.sha256=sha256(b);}change(m);fs.writeFileSync(manifestFile,canonicalBytes(m));};
  return {hub,dataDir,folder,manifestFile,sources,template,preparation,inventory,args,prepared,install,read,rewriteManifest};
}
test('OI01 the Hub files hold the selected original sources, the template, the sieve verdicts and the tree inventory, with their digests',t=>{
  const w=world(t),pins=w.install(),r=w.read();assert.equal(pins.length,6);assert.equal(r.current(),true);assert.equal(r.sources.length,17);assert.equal(r.pins.length,6);
  assert.deepEqual(fs.readdirSync(w.folder).sort(),NAMES);
  assert.ok(fs.readFileSync(path.join(w.folder,'PREPARED-PROFILE.json')).equals(w.args.templateBytes));
  assert.equal(r.templateSha256,sha256(w.args.templateBytes));assert.deepEqual(r.tree,{file:path.join(w.folder,'TREE-INVENTORY.json'),sha256:w.inventory.sha256});
  assert.deepEqual(r.checkout,w.args.checkout);assert.equal(r.sieve.verdicts.length,17);
  const manifest=JSON.parse(fs.readFileSync(w.manifestFile));assert.equal(manifest.schema,OWNED_INPUTS_SCHEMA);
  assert.equal(manifest.templateProfileSha256,r.templateSha256);assert.equal(manifest.treeInventorySha256,w.inventory.sha256);
  for(const s of r.sources)assert.deepEqual(Object.keys(s).sort(),['at','author','id','room','text']);
  assert.equal(fs.readFileSync(path.join(w.folder,'ingestion.json'),'utf8').includes('evaluatorOnly'),false);
});
test('OI02 a plan with another count of sources is accepted: the folder checks the shape, not fixed numbers',t=>{
  const w=world(t,{count:5});w.install();const r=w.read();assert.equal(r.sources.length,5);assert.equal(r.template.payloads.rows.length,10);
});
test('OI03 missing and extra owned files refuse instead of reading app inputs or adopting another set',t=>{
  const w=world(t);assert.throws(w.read);w.install();const r=w.read(),file=path.join(w.folder,'ingestion.json'),old=fs.readFileSync(file);
  fs.unlinkSync(file);assert.equal(r.current(),false);assert.throws(w.read);fs.writeFileSync(file,old);
  fs.writeFileSync(path.join(w.folder,'settings.json'),'{}');assert.equal(r.current(),false);assert.throws(w.read,/exact_file_set/);
});
test('OI04 rehashed original-message drift cannot replace genuine product source versions',t=>{
  const w=world(t);w.install();const r=w.read(),file=path.join(w.folder,'ingestion.json'),doc=JSON.parse(fs.readFileSync(file));doc.sources[0].text+=' changed';fs.writeFileSync(file,canonicalBytes(doc));w.rewriteManifest();
  assert.equal(r.current(),false);assert.throws(w.read,/source_version/);
});
test('OI05 rehashed template, preparation, sieve verdicts or inventory changes refuse',t=>{
  const w=world(t);w.install();const r=w.read();
  const swap=(name,bytes,pattern,change)=>{const file=path.join(w.folder,name),old=fs.readFileSync(file),manifest=fs.readFileSync(w.manifestFile);fs.writeFileSync(file,bytes);w.rewriteManifest(change);
    assert.equal(r.current(),false);assert.throws(w.read,pattern);fs.writeFileSync(file,old);fs.writeFileSync(w.manifestFile,manifest);assert.equal(w.read().current(),true);};
  swap('BOUND-PREPARATION.json',encode({...w.preparation,value:2}),/bound_preparation/);
  swap('PREPARED-PROFILE.json',Buffer.concat([w.args.templateBytes,Buffer.from(' ')]),/template_bytes/);
  swap('SIEVE-VERDICTS.json',encode({...JSON.parse(w.args.sieveBytes),verdicts:[]}),/sieve_verdicts/);
  const other=tree('another tree');swap('TREE-INVENTORY.json',encode(other),/tree_not_the_templates/,m=>{m.treeInventorySha256=other.sha256;});
});
test('OI06 escaped/absolute/duplicate/extra manifest fields cannot nominate other input files',t=>{
  const w=world(t);w.install();const original=fs.readFileSync(w.manifestFile);
  for(const change of [m=>m.files[0].name='../outside.json',m=>m.files[0].name=path.join(w.dataDir,'outside.json'),m=>m.files.push(m.files[0]),m=>m.extra=true,
    m=>m.hubDataDir=path.dirname(w.dataDir),m=>m.checkout={sha:'not a commit',origin:'synthetic'},m=>m.checkout={...m.checkout,origin:'guessed'}]){
    const m=JSON.parse(original);change(m);fs.writeFileSync(w.manifestFile,canonicalBytes(m));assert.throws(w.read);
  }
  fs.writeFileSync(w.manifestFile,original);assert.equal(w.read().current(),true);
});
test('OI07 CreateNew refuses existing or partial owned roots without deleting or adopting bytes',t=>{
  const w=world(t);fs.mkdirSync(w.folder);const partial=path.join(w.folder,'UNKNOWN.txt');fs.writeFileSync(partial,'retained unknown');
  assert.throws(w.install,/nonadoption/);assert.equal(fs.readFileSync(partial,'utf8'),'retained unknown');assert.deepEqual(fs.readdirSync(w.folder),['UNKNOWN.txt']);
});
test('OI08 invalid sources, verdicts, inventory or checkout refuse before owned acquisition',t=>{
  const w=world(t),refused=args=>{assert.throws(()=>prepareOwnedTrialInputBytes({...w.args,...args}));assert.equal(fs.existsSync(w.folder),false);};
  for(const mutate of [d=>d.sources.pop(),d=>d.sources.push(d.sources[0]),d=>d.sources[0].room='foreign',d=>d.sources[0].author='other',d=>d.sources[0].at='invalid',d=>d.sources[0].status='deleted']){
    const doc=JSON.parse(w.args.ingestionBytes);mutate(doc);refused({ingestionBytes:encode(doc)});
  }
  refused({sieveBytes:Buffer.concat([w.args.sieveBytes,Buffer.from(' ')])});
  refused({treeBytes:encode(tree('another tree'))});refused({treeBytes:encode({...w.inventory,sha256:'e'.repeat(64)})});
  refused({checkout:{sha:'0'.repeat(40)}});refused({checkout:{sha:'0'.repeat(39),origin:'git-commit'}});
});
test('OI09 additional hard links and linked owned directories remain unowned',t=>{
  const w=world(t);w.install();const file=path.join(w.folder,'ingestion.json'),outside=path.join(w.dataDir,'inert-extra-link.json');fs.linkSync(file,outside);assert.throws(w.read,/single_link/);fs.unlinkSync(outside);
  const renamed=path.join(w.dataDir,'retained-owned-inputs');fs.renameSync(w.folder,renamed);fs.symlinkSync(renamed,w.folder,'junction');assert.throws(w.read,/directory_or_link/);
  fs.unlinkSync(w.folder);assert.equal(fs.existsSync(path.join(renamed,'ingestion.json')),true);
});
test('OI10 an inputs folder of the first schema is refused as outdated, saying to recreate the deployment',t=>{
  const w=world(t);w.install();w.rewriteManifest(m=>{m.schema='viberoom-resident-owned-inputs-v1';});
  assert.throws(w.read,/private_trial_deployment_outdated: recreate the deployment \(node scripts\/private-trial-deploy\.mjs\)/);
});
