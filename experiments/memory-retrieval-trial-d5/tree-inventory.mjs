// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import assert from '../trial-journal/policy-assert.mjs';

export const APP=fileURLToPath(new URL('../../',import.meta.url));

export const TREE_DEFINITION=Object.freeze({
  schema:'viberoom-trial-tree-inventory-v1',
  files:Object.freeze(['package.json','package-lock.json','tsconfig.json']),
  folders:Object.freeze(['src','dist','private-trial','experiments/memory-retrieval-comparison-d2','experiments/memory-retrieval-comparison-d3',
    'experiments/memory-retrieval-trial-d5','experiments/trial-journal','node_modules/@getzep/zep-cloud']),
  skipped:Object.freeze(['node_modules','.git','__pycache__']),
  order:'relative path, forward slashes, UTF-16 code unit order',
});

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const definitionSha256=definition=>sha256(JSON.stringify(definition));
const fileChanged=error=>['ENOENT','ENOTDIR'].includes(error?.code);

async function list(app,definition){
  const out=[...definition.files];
  const walk=async dir=>{
    let entries;
    try{entries=await fs.readdir(path.join(app,dir),{withFileTypes:true});}
    catch(error){if(fileChanged(error))return;throw error;}
    for(const entry of entries){
      const relative=`${dir}/${entry.name}`;
      if(entry.isDirectory()){if(!definition.skipped.includes(entry.name))await walk(relative);}
      else out.push(relative);
    }
  };
  for(const folder of definition.folders)await walk(folder);
  return [...new Set(out)].sort();
}

export async function treeInventory(app,{definition=TREE_DEFINITION,concurrency=8}={}){
  const started=performance.now(),delay=monitorEventLoopDelay({resolution:10});delay.enable();
  try{
    const files=await list(app,definition),entries=new Array(files.length);let next=0;
    const worker=async()=>{
      for(;;){
        const i=next++;if(i>=files.length)return;
        let bytes=null;
        try{bytes=await fs.readFile(path.join(app,files[i]));}catch(error){if(!fileChanged(error))throw error;}
        entries[i]={path:files[i],bytes:bytes===null?null:bytes.length,sha256:bytes===null?null:sha256(bytes)};
      }
    };
    await Promise.all(Array.from({length:concurrency},worker));
    const inventory={definitionSha256:definitionSha256(definition),files:entries};
    return {...inventory,sha256:inventoryDigest(inventory),ms:Math.round(performance.now()-started),maxLoopDelayMs:Math.round(delay.max/1e6)};
  }finally{delay.disable();}
}

export const inventoryDigest=({definitionSha256,files})=>sha256(JSON.stringify({definitionSha256,files}));

export function writeTreeInventory(file,inventory){
  writeFileSync(file,JSON.stringify({definitionSha256:inventory.definitionSha256,files:inventory.files,sha256:inventory.sha256},null,2)+'\n',{flag:'wx'});
  return file;
}

export async function checkTree({file,app=APP},acceptedCETree){
  const saved=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(inventoryDigest(saved),saved.sha256,'tree_inventory_file_changed');assert.equal(saved.sha256,acceptedCETree,'tree_inventory_not_the_profiles');
  const actual=await treeInventory(app);
  return {changes:treeChanges(saved,actual),ms:actual.ms,maxLoopDelayMs:actual.maxLoopDelayMs};
}

export function treeChanges(expected,actual){
  const changes=[];
  if(expected.definitionSha256!==actual.definitionSha256)changes.push({path:null,change:'definition'});
  const before=new Map(expected.files.map(f=>[f.path,f])),after=new Map(actual.files.map(f=>[f.path,f]));
  for(const [file,was] of before){
    const now=after.get(file);
    if(!now||now.sha256===null&&was.sha256!==null)changes.push({path:file,change:'removed'});
    else if(was.sha256===null&&now.sha256!==null)changes.push({path:file,change:'added'});
    else if(now.sha256!==was.sha256||now.bytes!==was.bytes)changes.push({path:file,change:'changed'});
  }
  for(const file of after.keys())if(!before.has(file))changes.push({path:file,change:'added'});
  return changes;
}
