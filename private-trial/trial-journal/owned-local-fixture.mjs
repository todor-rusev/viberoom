// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {Server} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {HistoryStore} from '../../dist/history-store.js';
import {TimedDatabase} from '../../dist/timed-db.js';
import {Logger} from '../../dist/log.js';
import {ZepDouble} from '../../dist/memory/zep-double.js';
import {DTrial} from '../memory-retrieval-trial-d5/profile.mjs';
import {canonical,hash,frozen} from './data.mjs';
import {observeOwnedJournalRoot} from './sql-resource-observation.mjs';
import {LOCAL_RESOURCE_SCHEMA,PRODUCT_SELECTOR} from './local-resource-closure.mjs';

const CLOSE_MS=5000,MAXIMUM=4096;
const same=(a,b)=>canonical(a)===canonical(b);
function identity(root){const real=fs.realpathSync(root),s=fs.statSync(real,{bigint:true});assert.ok(s.isDirectory());
  assert.equal(fs.lstatSync(real).isSymbolicLink(),false);
  return {path:real,device:String(s.dev),inode:String(s.ino),birthtimeNs:String(s.birthtimeNs),platform:process.platform};}
function physical(root){assert.ok(typeof root==='string'&&isAbsolute(root)&&!root.includes('\0'));let p=resolve(root);
  for(;;){assert.equal(fs.lstatSync(p).isSymbolicLink(),false,'local_fixture_reparse_root');const parent=dirname(p);if(parent===p)break;p=parent;}
  assert.equal(fs.realpathSync(root),resolve(root),'local_fixture_physical_root_required');return identity(root);}
function pin(path){const bytes=fs.readFileSync(path);return {path,bytes:bytes.length,sha256:hash(bytes)};}
function createNew(path,value){const bytes=Buffer.from(canonical(value)+'\n');fs.writeFileSync(path,bytes,{flag:'wx'});return {path,bytes:bytes.length,sha256:hash(bytes)};}
const row=(id,kind,path)=>({id,kind,path,constructorAttempted:false,constructorReturned:false,openAfterConstructor:null,
  startAttempted:false,startReturned:false,closeAttempts:0,closeCallReturned:false,closeEventObserved:kind==='http'?false:null,openAfterClose:null});

export function createOwnedProductFixture(t,{evidenceRoot=null}={}){
  assert.equal(typeof t.after,'function');
  const fixtureId=randomUUID(),entries=[],trials=[],unknowns=[],loggerCategories=[],acquisitionPins=[];
  let root=null,initial=null,beforeRemoval=null,ownershipPin=null,origin=null,watch=null,serverEntry=null;
  let removing=false,removed=false,afterRemoval='unknown',cleanupPromise=null,closing=false,evidenceIdentity=null,pins=null;
  const writer={processId:process.pid,parentProcessId:process.ppid};
  const issue=(id,category)=>{if(unknowns.length<MAXIMUM)unknowns.push({id,category});else traceComplete=false;};
  let traceComplete=true;
  const available=()=>assert.equal(cleanupPromise,null,'local_fixture_acquisition_after_cleanup');
  t.after(async()=>{const terminal=await finalize();assert.equal(terminal.status,'closed','local_fixture_owned_cleanup_refused');});
  function writeAttempt(entry){
    if(evidenceRoot!==null){
      assert.ok(same(identity(evidenceRoot),evidenceIdentity),'local_fixture_evidence_root_changed');
      const record={schema:'resident-owned-local-resource-acquisition-v1',fixtureId,selector:PRODUCT_SELECTOR,writer,initial,
        id:entry.row.id,kind:entry.row.kind,path:entry.row.path};
      acquisitionPins.push(createNew(join(evidenceRoot,`local-ledger-${fixtureId}-${entry.row.id.replace(':','-')}-acquire.json`),record));
    }else acquisitionPins.push(null);
    entry.row.constructorAttempted=true;
  }
  function historyOpen(entry,field){
    try{assert.ok(entry.actual instanceof HistoryStore&&entry.actual.db instanceof TimedDatabase&&entry.actual.db.raw instanceof DatabaseSync,'local_fixture_actual_history_db_required');
      const value=entry.actual.db.raw.isOpen;assert.equal(typeof value,'boolean');entry.row[field]=value;}
    catch{entry.row[field]=null;issue(entry.row.id,'history-open-state-unconfirmed');}
  }
  function quietLogger(id){
    const attach=actual=>{const child=actual.child;actual.info=()=>{};
      for(const level of ['warn','error'])actual[level]=()=>{
        const category=level==='warn'?(closing?'close-warning':'lifecycle-warning'):(closing?'close-error':'lifecycle-error');
        if(loggerCategories.length<MAXIMUM)loggerCategories.push({id,category});else traceComplete=false;
        issue(id,'history-logger-refused');
      };
      actual.child=function(scope){const made=Reflect.apply(child,this,[scope]);assert.ok(made instanceof Logger);return attach(made);};return actual;
    };return attach(new Logger('D-owned-product'));
  }
  function constructHistory(){
    available();assert.ok(initial&&root);assert.ok(entries.length<MAXIMUM,'local_fixture_resource_bound');
    const n=entries.filter(e=>e.row.kind==='sqlite-history').length+1;
    const entry={actual:null,row:row(`history:${n}`,'sqlite-history',join(root,'history.db'))};entries.push(entry);writeAttempt(entry);
    try{entry.actual=new HistoryStore(entry.row.path,quietLogger(entry.row.id));entry.row.constructorReturned=true;historyOpen(entry,'openAfterConstructor');return entry.actual;}
    catch(error){issue(entry.row.id,'history-constructor-unknown');throw error;}
  }
  function closeHistory(actual){
    const entry=entries.find(e=>e.actual===actual&&e.row.kind==='sqlite-history');assert.ok(entry,'local_fixture_history_not_owned');
    assert.equal(entry.row.closeAttempts,0,'local_fixture_history_close_not_replayed');entry.row.closeAttempts++;
    const wasClosing=closing;closing=true;
    try{const result=Reflect.apply(actual.close,actual,[]);entry.row.closeCallReturned=true;return result;}
    catch(error){issue(entry.row.id,'history-close-refused');throw error;}
    finally{historyOpen(entry,'openAfterClose');closing=wasClosing;}
  }
  function retainTrialOwner(actual){available();assert.ok(actual instanceof DTrial,'local_fixture_genuine_dtrial_required');
    assert.equal(trials.some(x=>x.actual===actual),false,'local_fixture_trial_already_owned');trials.push({actual,attempted:false});return actual;}
  async function startDouble(){
    available();assert.ok(serverEntry,'local_fixture_server_not_owned');assert.equal(serverEntry.row.startAttempted,false,'local_fixture_start_not_replayed');serverEntry.row.startAttempted=true;
    try{await serverEntry.actual.start();serverEntry.row.startReturned=true;assert.equal(serverEntry.server.listening,true);return serverEntry.actual;}
    catch(error){issue('server:1','server-start-unknown');throw error;}
  }
  async function closeDouble(){
    const entry=serverEntry;if(!entry||!entry.actual)return;
    if(entry.row.closeAttempts!==0)return;
    entry.row.closeAttempts++;
    let timer;
    try{
      await entry.actual.stop();entry.row.closeCallReturned=true;
      await Promise.race([entry.closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('local_fixture_server_close_unconfirmed')),CLOSE_MS);})]);
      assert.equal(entry.row.closeEventObserved,true);assert.equal(entry.server.listening,false);entry.row.openAfterClose=false;
    }catch(error){issue('server:1','server-close-unconfirmed');throw error;}
    finally{clearTimeout(timer);}
  }
  async function finalize(){
    if(cleanupPromise)return cleanupPromise;
    cleanupPromise=(async()=>{
      closing=true;
      for(const trial of trials){if(trial.attempted)continue;trial.attempted=true;
        try{Reflect.apply(trial.actual.close,trial.actual,[]);}catch{issue('trial','trial-owner-close-refused');}}
      if(watch){try{watch.closeOutstanding();}catch{issue('journal','journal-outstanding-close-unconfirmed');}}
      for(const entry of entries){if(entry.row.kind!=='sqlite-history'||!entry.actual)continue;
        if(entry.row.closeAttempts===0){try{closeHistory(entry.actual);}catch{}}
        else historyOpen(entry,'openAfterClose');}
      try{await closeDouble();}catch{}
      const sql=watch?.snapshot()??{rows:[],acquisitionPins:[],unknowns:[]};
      for(const category of sql.unknowns)issue('journal',category);
      const acquired=[...entries.map(e=>({...e.row})),...sql.rows],released=acquired.filter(r=>r.constructorReturned&&r.closeAttempts===1&&r.closeCallReturned&&r.openAfterClose===false&&
        (r.kind!=='http'||r.closeEventObserved===true)).map(r=>r.id);
      const constructorUnknowns=acquired.filter(r=>r.constructorAttempted&&!r.constructorReturned).map(r=>r.id);
      for(const r of acquired){if(!released.includes(r.id))issue(r.id,'resource-close-unconfirmed');}
      if(!initial)issue('root','root-construction-unknown');
      if(initial){
        try{
          beforeRemoval=identity(root);assert.ok(same(initial,beforeRemoval),'local_fixture_root_changed');
          assert.ok(origin&&fs.readFileSync(join(root,'OWNED-RESOURCE-ROOT.json')).equals(Buffer.from(canonical(origin)+'\n')),'local_fixture_ownership_changed');
          if(unknowns.length===0&&constructorUnknowns.length===0&&traceComplete&&loggerCategories.length===0){
            removing=true;fs.rmSync(root,{recursive:true,force:false});removed=true;
          }
          try{fs.lstatSync(root);afterRemoval='present';}catch(error){if(error.code==='ENOENT')afterRemoval='absent';else throw error;}
          if(removed&&afterRemoval!=='absent')issue('root','directory-removal-unconfirmed');
        }catch{issue('root',removing?'directory-removal-unconfirmed':'directory-identity-unconfirmed');}
      }
      const terminal={schema:LOCAL_RESOURCE_SCHEMA,family:'product-step',fixtureId,selector:PRODUCT_SELECTOR,...pins,
        nodeVersion:process.version,writer,root:{initial,ownershipPin,beforeRemoval,removed,afterRemoval},
        acquired,acquisitionPins:[...acquisitionPins,...sql.acquisitionPins],released,constructorUnknowns,teardownUnknowns:unknowns,
        loggerCategories,traceComplete,status:unknowns.length===0&&traceComplete&&removed&&afterRemoval==='absent'?'closed':'unknown'};
      if(evidenceRoot!==null){try{
        assert.ok(same(identity(evidenceRoot),evidenceIdentity),'local_fixture_evidence_root_changed');
        createNew(join(evidenceRoot,`local-ledger-terminal-${fixtureId}.json`),terminal);
      }catch(error){if(watch)watch.detach();throw error;}}
      if(watch)watch.detach();return frozen(terminal);
    })();return cleanupPromise;
  }
  try{
    const app=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
    pins={selectorPin:pin(join(app,PRODUCT_SELECTOR)),sourceOwnerPin:pin(fileURLToPath(import.meta.url)),
      observerSourcePin:pin(fileURLToPath(new URL('./sql-resource-observation.mjs',import.meta.url))),validatorSourcePin:pin(fileURLToPath(new URL('./local-resource-closure.mjs',import.meta.url)))};
    if(evidenceRoot!==null){evidenceRoot=resolve(evidenceRoot);evidenceIdentity=physical(evidenceRoot);}
    const created=fs.mkdtempSync(join(tmpdir(),'D-actualC-'));root=fs.realpathSync(created);initial=physical(root);
    origin={schema:'resident-owned-local-fixture-root-v1',family:'product-step',fixtureId,selector:PRODUCT_SELECTOR,...pins,nodeVersion:process.version,writer,initial};
    ownershipPin=createNew(join(root,'OWNED-RESOURCE-ROOT.json'),origin);
    if(evidenceRoot!==null){assert.notEqual(evidenceIdentity.path,root);ownershipPin=createNew(join(evidenceRoot,`local-ledger-ownership-${fixtureId}.json`),origin);}
    const ownerRoot=join(root,'owner');fs.mkdirSync(ownerRoot);
    watch=observeOwnedJournalRoot(fs.realpathSync(ownerRoot),{fixtureId,evidenceRoot});
    serverEntry={actual:null,server:null,row:row('server:1','http',null),closed:null};entries.push(serverEntry);writeAttempt(serverEntry);
    try{
      serverEntry.actual=new ZepDouble();serverEntry.row.constructorReturned=true;
      const actual=serverEntry.actual.server;assert.ok(actual instanceof Server,'local_fixture_genuine_server_required');serverEntry.server=actual;
      serverEntry.row.openAfterConstructor=actual.listening;assert.equal(serverEntry.row.openAfterConstructor,false);
      serverEntry.closed=new Promise(resolveClose=>actual.once('close',()=>{serverEntry.row.closeEventObserved=true;resolveClose();}));
    }catch(error){issue('server:1','server-constructor-unknown');throw error;}
    return Object.freeze({root,ownerRoot,server:serverEntry.actual,startDouble,constructHistory,closeHistory,retainTrialOwner,finalize});
  }catch(error){issue('setup','fixture-setup-incomplete');throw error;}
}
