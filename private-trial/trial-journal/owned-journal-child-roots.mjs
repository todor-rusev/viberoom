// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {canonical,hash,frozen} from './data.mjs';
import {localResourceFamily} from './local-resource-families.mjs';
import {observeOwnedJournalRoot} from '../../experiments/trial-journal/sql-resource-observation.mjs';
const MAXIMUM=32;
const same=(a,b)=>assert.equal(canonical(a),canonical(b),'journal_child_join_changed');
function identity(root){const path=fs.realpathSync(root),s=fs.statSync(path,{bigint:true});assert.ok(s.isDirectory()&&!fs.lstatSync(root).isSymbolicLink());
  assert.equal(path,resolve(root));return {path,device:String(s.dev),inode:String(s.ino),birthtimeNs:String(s.birthtimeNs),platform:process.platform};}
function createNew(path,record){const b=Buffer.from(canonical(record)+'\n');fs.writeFileSync(path,b,{flag:'wx'});return {path,bytes:b.length,sha256:hash(b)};}
export function createOwnedJournalCopies({family,fixtureId,parentRoot,parentInitial,ownerRoot,evidenceRoot,sourcePins}){
  const descriptor=localResourceFamily(family);assert.equal(descriptor.extended,true);same(identity(parentRoot),parentInitial);assert.equal(ownerRoot,join(parentRoot,'owner'));
  const writer={processId:process.pid,parentProcessId:process.ppid},entries=[],unknowns=[];
  const evidenceInitial=evidenceRoot===null?null:identity(evidenceRoot);let cleaned=false;
  const issue=(id,category)=>{if(unknowns.length<4096)unknowns.push({id,category});};
  function external(name,record){if(evidenceRoot===null)return null;same(identity(evidenceRoot),evidenceInitial);return createNew(join(evidenceRoot,name),record);}
  function copyJournalRoot(){
    assert.equal(cleaned,false,'journal_child_acquisition_after_cleanup');assert.ok(entries.length<MAXIMUM,'journal_child_root_bound');same(identity(parentRoot),parentInitial);
    const id=`copy:${entries.length+1}`,path=join(parentRoot,id.replace(':','-'));
    const entry={watch:null,origin:null,insidePin:null,row:{id,path,mkdirAttempted:false,mkdirReturned:false,initial:null,attemptPin:null,ownershipPin:null,
      copyAttempted:false,copyReturned:false,closeAttempts:0,beforeRemoval:null,removed:false,afterRemoval:'unknown',status:'unknown'}};entries.push(entry);
    try{
      const attempt={schema:'resident-owned-journal-copy-attempt-v1',fixtureId,family,selector:descriptor.selector,writer,parentInitial,id,path,...sourcePins};
      entry.row.attemptPin=external(`local-ledger-${fixtureId}-${id.replace(':','-')}-directory-acquire.json`,attempt);
      entry.row.mkdirAttempted=true;fs.mkdirSync(path);entry.row.mkdirReturned=true;entry.row.initial=identity(path);
      entry.origin={schema:'resident-owned-journal-copy-root-v1',fixtureId,family,selector:descriptor.selector,writer,parentInitial,id,initial:entry.row.initial,attemptPin:entry.row.attemptPin,...sourcePins};
      entry.insidePin=createNew(join(path,'OWNED-JOURNAL-COPY.json'),entry.origin);
      entry.row.ownershipPin=external(`local-ledger-${fixtureId}-${id.replace(':','-')}-directory-origin.json`,entry.origin);
      entry.watch=observeOwnedJournalRoot(path,{fixtureId,evidenceRoot,selector:descriptor.selector,family,rootId:id,rootOriginPin:entry.row.ownershipPin??entry.insidePin});
      entry.row.copyAttempted=true;fs.cpSync(ownerRoot,path,{recursive:true});entry.row.copyReturned=true;
      same(identity(path),entry.row.initial);assert.ok(fs.readFileSync(entry.insidePin.path).equals(Buffer.from(canonical(entry.origin)+'\n')),'journal_child_origin_changed');return path;
    }catch(error){issue(id,'journal-child-acquisition-unknown');throw error;}
  }
  function cleanup(){
    if(cleaned)return;cleaned=true;
    for(const entry of entries){
      if(entry.watch){try{entry.watch.closeOutstanding();}catch{issue(entry.row.id,'journal-child-native-close-refused');}}
      const sql=entry.watch?.snapshot()??{rows:[],unknowns:[]};
      for(const category of sql.unknowns)issue(entry.row.id,category);
      const nativeClosed=sql.rows.every(r=>r.constructorReturned&&r.closeAttempts===1&&r.closeCallReturned&&r.openAfterClose===false);
      if(!nativeClosed)issue(entry.row.id,'journal-child-native-state-unknown');
      try{
        if(!entry.row.mkdirReturned){issue(entry.row.id,'journal-child-constructor-unknown');continue;}
        entry.row.beforeRemoval=identity(entry.row.path);same(entry.row.beforeRemoval,entry.row.initial);same(identity(parentRoot),parentInitial);
        assert.ok(entry.origin&&entry.insidePin&&fs.readFileSync(entry.insidePin.path).equals(Buffer.from(canonical(entry.origin)+'\n')),'journal_child_origin_changed');
        if(unknowns.some(r=>r.id===entry.row.id)||!nativeClosed||!entry.row.copyReturned)continue;
        entry.row.closeAttempts++;fs.rmSync(entry.row.path,{recursive:true,force:false});entry.row.removed=true;
        try{fs.lstatSync(entry.row.path);entry.row.afterRemoval='present';}catch(error){if(error.code==='ENOENT')entry.row.afterRemoval='absent';else throw error;}
        assert.equal(entry.row.afterRemoval,'absent');entry.row.status='closed';
      }catch{issue(entry.row.id,'journal-child-removal-unconfirmed');}
    }
  }
  function snapshot(){const sql={rows:[],acquisitionPins:[],unknowns:[]};for(const entry of entries){if(entry.watch){const s=entry.watch.snapshot();sql.rows.push(...s.rows);sql.acquisitionPins.push(...s.acquisitionPins);sql.unknowns.push(...s.unknowns);}}
    return frozen({childRoots:entries.map(e=>e.row),rows:sql.rows,acquisitionPins:sql.acquisitionPins,unknowns:[...unknowns,...sql.unknowns.map(category=>({id:'copies',category}))]});}
  function detach(){for(const entry of entries)if(entry.watch)entry.watch.detach();}
  return Object.freeze({copyJournalRoot,cleanup,snapshot,detach});
}
