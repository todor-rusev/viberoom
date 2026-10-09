// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {json,canonical} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {fileChanged} from '../trial-journal/policy-assert.mjs';
import {closureDiagnosis} from './fixture-closure.mjs';
import {Server,createServer} from 'node:http';
import {Hub,SHUTDOWN_STAGES} from '../../dist/hub.js';
import {Logger} from '../../dist/log.js';
import {ZepDouble} from '../../dist/memory/zep-double.js';
import {isSlowIoWords} from '../../dist/slow-io.js';
import {startServer as startHumanServer} from '../../dist/server.js';

const SERVER_CLOSE_MS=5000;
const HUMAN_LOG_RECORDS=128;
const PREFIX='D-configured-Hub-';
const stages=new Set(SHUTDOWN_STAGES);
const stageName=value=>typeof value==='string'&&value.startsWith('room:')?'room':stages.has(value)?value:'other';
const equalPath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const fail=category=>{throw Error(category);};
const frozenData=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(frozenData);Object.freeze(value);}return value;};

export function writeOwnedConfiguredFixtureTerminal({root,prefix,ordinal,checkpoint}){
  assert.ok(typeof root==='string'&&path.isAbsolute(root)&&!root.includes('\0'),'fixture_terminal_root_required');
  assert.ok(prefix==='hub'||prefix==='rv','fixture_terminal_prefix_invalid');
  assert.ok(Number.isSafeInteger(ordinal)&&ordinal>0,'fixture_terminal_ordinal_invalid');
  const resolved=path.resolve(root),ancestors=[];let parent=resolved;
  while(path.dirname(parent)!==parent){ancestors.push(parent);parent=path.dirname(parent);}ancestors.push(parent);
  for(const entry of ancestors)assert.equal(fs.lstatSync(entry).isSymbolicLink(),false,'fixture_terminal_reparse_root');
  const before=fs.statSync(resolved,{bigint:true}),real=fs.realpathSync(resolved);
  assert.ok(before.isDirectory()&&equalPath(real,resolved),'fixture_terminal_physical_root_required');
  const bytes=Buffer.from(canonical(checkpoint)+'\n');
  fs.writeFileSync(path.join(resolved,`${prefix}-terminal-${ordinal}.json`),bytes,{flag:'wx'});
  const after=fs.statSync(resolved,{bigint:true});
  assert.ok(!fs.lstatSync(resolved).isSymbolicLink()&&equalPath(fs.realpathSync(resolved),real)&&after.isDirectory()&&
    after.dev===before.dev&&after.ino===before.ino&&after.birthtimeNs===before.birthtimeNs,'fixture_terminal_root_changed');
  return true;
}

export function fixtureClosureLogCategory(level,message,closing=false){
  if(level==='warn'&&typeof message==='string'&&message.startsWith('history.db did not close cleanly: '))return 'history-close-warning';
  if(level==='warn'&&isSlowIoWords(message))return 'slow-io-observation';
  if(level==='warn')return closing?'shutdown-warning':'lifecycle-warning';
  if(level==='error')return closing?'shutdown-error':'lifecycle-error';
  return 'other';
}

export function observeFixtureLogger(logger,observe,isClosing=()=>false){
  const seen=new WeakSet();
  function attach(actual){
    assert.ok(actual instanceof Logger,'fixture_actual_logger_required');
    if(seen.has(actual))return actual;seen.add(actual);
    const child=actual.child;
    actual.info=()=>{};
    actual.warn=message=>observe(fixtureClosureLogCategory('warn',message,isClosing()));
    actual.error=message=>observe(fixtureClosureLogCategory('error',message,isClosing()));
    actual.child=function(scope){return attach(Reflect.apply(child,this,[scope]));};
    return actual;
  }
  return attach(logger);
}

export function createOwnedConfiguredHubFixture(t,{maximumRecords=4096,writeEvidence=null,writeFinalCheckpoint=null,onCleanup=report=>assert.equal(report.status,'closed',`fixture_owned_cleanup_refused: ${closureDiagnosis(report)}`)}={}){
  assert.ok(Number.isInteger(maximumRecords)&&maximumRecords>=1&&maximumRecords<=4096,'fixture_trace_bound_invalid');
  const issues=new Set(),records=[],hubs=[],additionalServers=[];
  const fixtureId=randomUUID();let checkpointPromise=null;
  let sequence=0,dropped=0,root=null,rootIdentity=null,rootAttempted=false,rootReturned=false,trialAttempted=false,trialReturned=false;
  let double=null,ownedServer=null,serverAttempted=false,serverReturned=false,startAttempted=false,startReturned=false;
  let serverClosed=false,serverStopAttempts=0,serverClosePromise=null,cleanupPromise=null,cleanupStarted=false,cleanupPhase='not-started',directoryRemoved=false;
  let resolveServerClose;const actualServerClose=new Promise(resolve=>{resolveServerClose=resolve;});
  let removeServerObserver=()=>{};
  const issue=category=>issues.add(category);
  const record=(event,fields={})=>{
    if(records.length<maximumRecords)records.push({sequence:++sequence,event,...fields});
    else {dropped++;issue('trace-truncated');}
  };
  const beforeAcquire=()=>{if(cleanupPromise)fail('fixture_acquisition_after_cleanup');};
  function refuseExternalClaimFailure(category){
    if(cleanupStarted)fail('fixture_external_claim_refusal_after_cleanup');
    if(!['external-claim-acquisition-incomplete','external-claim-close-unconfirmed'].includes(category))fail('fixture_external_claim_category_invalid');
    issue(category);record('external-claim-refusal',{category});
  }
  function refuseAdditionalServerFailure(category){
    if(cleanupStarted)fail('fixture_additional_server_refusal_after_cleanup');
    if(!['additional-server-acquisition-incomplete','additional-server-close-unconfirmed'].includes(category))fail('fixture_additional_server_category_invalid');
    issue(category);record('additional-server-refusal',{category});
  }
  const additionalFor=server=>{const entry=additionalServers.find(e=>e.constructorReturned&&e.server===server);assert.ok(entry,'fixture_additional_server_not_owned');return entry;};
  function additionalIssue(entry,category){entry.closed=false;entry.issues.add(category);issue(category);}
  function constructAdditionalHumanServer(){
    beforeAcquire();assert.ok(rootReturned&&rootIdentity,'fixture_root_not_owned');
    assert.ok(additionalServers.length<maximumRecords,'fixture_additional_server_bound');
    const entry={ordinal:additionalServers.length+1,constructorAttempted:true,constructorReturned:false,server:null,logger:null,
      startAttempted:false,startReturned:false,closeAttempts:0,closeCallReturned:false,closeEventObserved:false,listeningAfterClose:null,
      closed:false,closing:false,closePromise:null,loggerCategories:[],issues:new Set(),closeEvent:null};
    additionalServers.push(entry);record('additional-server-constructor-attempt',{additionalServer:entry.ordinal});
    let resolveClose;entry.closeEvent=new Promise(resolve=>{resolveClose=resolve;});
    try{
      entry.logger=observeFixtureLogger(new Logger('fixture-human-server'),category=>{
        if(entry.loggerCategories.length>=HUMAN_LOG_RECORDS){additionalIssue(entry,'trace-truncated');assert.fail('fixture_human_server_trace_overflow');}
        entry.loggerCategories.push(category);
        record('additional-server-logger',{additionalServer:entry.ordinal,category});
        additionalIssue(entry,'additional-server-logger-refused');
      },()=>entry.closing);
      entry.server=createServer();assert.ok(entry.server instanceof Server,'fixture_actual_additional_server_required');entry.constructorReturned=true;
      entry.server.once('close',()=>{entry.closeEventObserved=true;
        if(!entry.closing||entry.closeAttempts!==1)additionalIssue(entry,'additional-server-close-order-unconfirmed');
        record('additional-server-close-event',{additionalServer:entry.ordinal});resolveClose();});
      record('additional-server-returned',{additionalServer:entry.ordinal});return entry.server;
    }catch(error){additionalIssue(entry,'additional-server-acquisition-incomplete');throw error;}
  }
  async function startAdditionalHumanServer(server,hub){
    beforeAcquire();const entry=additionalFor(server);entryFor(hub);assert.equal(entry.startAttempted,false,'fixture_additional_server_start_already_attempted');
    entry.startAttempted=true;record('additional-server-start-attempt',{additionalServer:entry.ordinal});
    try{
      const running=await startHumanServer(hub,0,entry.logger,{name:'fixture-human-server',version:'fixture-human-server',build:'fixture-human-server'},()=>{}, {server});
      assert.equal(running.server,server,'fixture_additional_server_start_owner_changed');entry.startReturned=true;
      record('additional-server-start-returned',{additionalServer:entry.ordinal});return running;
    }catch(error){additionalIssue(entry,'additional-server-start-incomplete');throw error;}
  }
  function observeAdditionalHumanServerClose(server,closeOperation){
    const entry=additionalFor(server);assert.equal(typeof closeOperation,'function','fixture_additional_server_close_operation_required');
    if(entry.closePromise)return entry.closePromise;
    assert.equal(cleanupStarted,false,'fixture_additional_server_close_after_cleanup');entry.closeAttempts++;entry.closing=true;
    record('additional-server-close-attempt',{additionalServer:entry.ordinal});
    entry.closePromise=(async()=>{
      let timer;
      try{
        await closeOperation();entry.closeCallReturned=true;record('additional-server-close-returned',{additionalServer:entry.ordinal});
        await Promise.race([entry.closeEvent,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture_human_server_close_unconfirmed')),SERVER_CLOSE_MS);})]);
        entry.listeningAfterClose=server.listening;
        if(entry.closeEventObserved!==true||entry.listeningAfterClose!==false)fail('fixture_additional_server_close_unconfirmed');
        record('additional-server-close-checked',{additionalServer:entry.ordinal});
        entry.closed=entry.issues.size===0&&!issues.has('trace-truncated');
        if(!entry.closed)fail('fixture_additional_server_closure_refused');
      }catch(error){additionalIssue(entry,'additional-server-close-unconfirmed');throw error;}
      finally{clearTimeout(timer);entry.closing=false;}
    })();return entry.closePromise;
  }
  function allocateRoot(){
    beforeAcquire();assert.equal(rootAttempted,false,'fixture_root_already_attempted');rootAttempted=true;
    try{
      root=fs.mkdtempSync(path.join(tmpdir(),PREFIX));rootReturned=true;
      const stat=fs.statSync(root,{bigint:true});rootIdentity={real:fs.realpathSync(root),device:stat.dev,inode:stat.ino,birthtimeNs:stat.birthtimeNs};
      record('root-returned');return root;
    }catch(error){issue('root-acquisition-incomplete');throw error;}
  }
  function constructServer(){
    beforeAcquire();assert.ok(rootReturned,'fixture_root_not_owned');assert.equal(serverAttempted,false,'fixture_server_already_attempted');serverAttempted=true;
    try{
      double=new ZepDouble();serverReturned=true;
      ownedServer=double.server;assert.ok(ownedServer instanceof Server,'fixture_actual_server_required');
      const closed=()=>{serverClosed=true;record('server-close');resolveServerClose();};
      ownedServer.once('close',closed);removeServerObserver=()=>ownedServer.removeListener('close',closed);
      record('server-returned');return double;
    }catch(error){issue('server-acquisition-incomplete');throw error;}
  }
  function createTrialDirectory(){
    beforeAcquire();assert.ok(rootReturned,'fixture_root_not_owned');assert.equal(trialAttempted,false,'fixture_trial_directory_already_attempted');trialAttempted=true;
    try{const directory=path.join(root,'trial');fs.mkdirSync(directory);trialReturned=true;record('trial-directory-returned');return directory;}
    catch(error){issue('trial-directory-acquisition-incomplete');throw error;}
  }
  async function startServer(){
    beforeAcquire();assert.ok(double&&serverReturned,'fixture_server_not_owned');assert.equal(startAttempted,false,'fixture_server_start_already_attempted');startAttempted=true;
    try{await double.start();startReturned=true;record('server-start-returned');}
    catch(error){issue('server-start-incomplete');throw error;}
  }
  function constructHub(){
    beforeAcquire();assert.ok(rootReturned&&rootIdentity,'fixture_root_not_owned');
    if(hubs.length&&(!hubs.every(e=>e.constructorReturned&&e.closed)||issues.size))fail('fixture_prior_hub_closure_required');
    const entry={ordinal:hubs.length+1,constructorAttempted:true,constructorReturned:false,hub:null,logger:null,
      closing:false,shutdownPromise:null,shutdownAttempts:0,shutdownResolved:false,closed:false,stages:[],issues:new Set()};
    hubs.push(entry);
    const localIssue=category=>{entry.closed=false;entry.issues.add(category);issue(category);};
    try{
      entry.logger=observeFixtureLogger(new Logger('configured-Hub-fixture'),category=>{
        record('logger',{hub:entry.ordinal,category});
        if(category==='history-close-warning'||category==='shutdown-warning'||category==='shutdown-error')localIssue(category);
      },()=>entry.closing);
      entry.hub=new Hub(path.join(root,'hub'),entry.logger,'Synthetic human',{backgroundAgentChecks:false});
      entry.constructorReturned=true;record('hub-returned',{hub:entry.ordinal});return entry.hub;
    }catch(error){localIssue('hub-acquisition-incomplete');throw error;}
  }
  const entryFor=hub=>{const entry=hubs.find(e=>e.constructorReturned&&e.hub===hub);assert.ok(entry,'fixture_hub_not_owned');return entry;};
  function closeHub(hub){
    const entry=entryFor(hub);
    if(entry.shutdownPromise)return entry.shutdownPromise;
    entry.shutdownAttempts++;entry.closing=true;
    entry.shutdownPromise=(async()=>{
      const localIssue=category=>{entry.closed=false;entry.issues.add(category);issue(category);};
      const observeStage=step=>{
        const row={stage:stageName(step?.stage),ms:typeof step?.ms==='number'&&Number.isFinite(step.ms)&&step.ms>=0?step.ms:null,timedOut:step?.timedOut===true};
        if(row.stage==='other'||row.ms===null||typeof step?.timedOut!=='boolean')localIssue('shutdown-stage-invalid');
        if(row.timedOut)localIssue('shutdown-stage-timeout');
        if(entry.stages.length<maximumRecords)entry.stages.push(row);else localIssue('trace-truncated');
        record('shutdown-stage',{hub:entry.ordinal,...row});
      };
      try{
        const returned=await hub.shutdown({onStage:observeStage});entry.shutdownResolved=true;
        const projected=Array.isArray(returned)&&returned.length<=maximumRecords?returned.map(step=>({stage:stageName(step?.stage),ms:step?.ms,timedOut:step?.timedOut})):null;
        if(!projected||JSON.stringify(projected)!==JSON.stringify(entry.stages))localIssue('shutdown-stage-trace-mismatch');
        if(entry.stages.at(-1)?.stage!=='history'||entry.stages.filter(s=>s.stage==='history').length!==1)localIssue('shutdown-final-history-unconfirmed');
        if(hub.history?.db?.isOpen!==false)localIssue('history-open-state-unconfirmed');
        entry.closed=entry.issues.size===0&&!issues.has('trace-truncated');
      }catch{localIssue('hub-shutdown-refused');entry.closed=false;}
      finally{entry.closing=false;}
      if(!entry.closed)localIssue('hub-closure-unconfirmed');
      return hubReport(entry);
    })();
    return entry.shutdownPromise;
  }
  async function reopenHub(hub){
    beforeAcquire();const prior=await closeHub(hub);
    if(prior.closed!==true||issues.size)fail('fixture_hub_reopen_refused');
    return constructHub();
  }
  function closeServer(){
    if(serverClosePromise)return serverClosePromise;
    serverClosePromise=(async()=>{
      if(!serverReturned||!ownedServer){if(serverAttempted)issue('server-closure-unconfirmed');return;}
      if(!serverClosed){serverStopAttempts++;try{double.stop();}catch{issue('server-stop-refused');}}
      let timer;
      try{await Promise.race([actualServerClose,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture_server_close_unconfirmed')),SERVER_CLOSE_MS);})]);}
      catch{issue('server-closure-unconfirmed');}
      finally{clearTimeout(timer);}
    })();return serverClosePromise;
  }
  function hubReport(entry){return {ordinal:entry.ordinal,constructorAttempted:entry.constructorAttempted,constructorReturned:entry.constructorReturned,
    shutdownAttempts:entry.shutdownAttempts,shutdownResolved:entry.shutdownResolved,closed:entry.closed,
    stages:entry.stages.map(s=>({...s})),categories:[...entry.issues]};}
  function additionalReport(entry){return {schema:'owned-additional-human-server-v1',fixtureId,ordinal:entry.ordinal,processId:process.pid,role:'human-server',
    constructorAttempted:entry.constructorAttempted,constructorReturned:entry.constructorReturned,startAttempted:entry.startAttempted,startReturned:entry.startReturned,
    closeAttempts:entry.closeAttempts,closeCallReturned:entry.closeCallReturned,closeEventObserved:entry.closeEventObserved,listeningAfterClose:entry.listeningAfterClose,
    closed:entry.closed,loggerCategories:[...entry.loggerCategories],categories:[...entry.issues]};}
  function snapshot(){return {schema:'owned-configured-hub-fixture-closure-v1',actualD:'NOT_RUN',status:cleanupStarted?(issues.size?'refused':cleanupPhase==='complete'?'closed':'pending'):'not-started',cleanupPhase,
    maximumRecords,recordCount:records.length,dropped,truncated:dropped>0,serverCloseObservationMs:SERVER_CLOSE_MS,
    productShutdownStageMs:'unchanged-default',rootAttempted,rootReturned,trialAttempted,trialReturned,directoryRemoved,
    server:{constructorAttempted:serverAttempted,constructorReturned:serverReturned,startAttempted,startReturned,stopAttempts:serverStopAttempts,closed:serverClosed},
    hubs:hubs.map(hubReport),additionalServers:additionalServers.map(additionalReport),categories:[...issues],records:records.map(r=>({...r}))};}
  function checkedRoot(){
    if(!rootReturned||!rootIdentity)return false;
    try{
      const resolved=path.resolve(root),real=fs.realpathSync(root),parent=fs.realpathSync(tmpdir()),stat=fs.statSync(root,{bigint:true});
      return equalPath(path.dirname(real),parent)&&equalPath(real,resolved)&&equalPath(real,rootIdentity.real)&&
        path.basename(resolved).startsWith(PREFIX)&&!fs.lstatSync(root).isSymbolicLink()&&stat.isDirectory()&&stat.dev===rootIdentity.device&&stat.ino===rootIdentity.inode;
    }catch(error){if(fileChanged(error))return false;throw error;}
  }
  function cleanup(){
    if(cleanupPromise)return cleanupPromise;
    cleanupStarted=true;
    cleanupPromise=(async()=>{
      cleanupPhase='resources';
      if(rootAttempted&&!rootReturned)issue('root-acquisition-incomplete');
      if(trialAttempted&&!trialReturned)issue('trial-directory-acquisition-incomplete');
      if(serverAttempted&&!serverReturned)issue('server-acquisition-incomplete');
      if(startAttempted&&!startReturned)issue('server-start-incomplete');
      for(const entry of hubs)if(!entry.constructorReturned)issue('hub-acquisition-incomplete');
      for(const entry of additionalServers){
        if(!entry.constructorReturned)additionalIssue(entry,'additional-server-acquisition-incomplete');
        if(entry.startAttempted&&!entry.startReturned)additionalIssue(entry,'additional-server-start-incomplete');
        if(!entry.closed||entry.closeAttempts!==1||!entry.closeCallReturned||!entry.closeEventObserved||entry.server?.listening!==false)additionalIssue(entry,'additional-server-close-unconfirmed');
      }
      const results=await Promise.allSettled([...hubs.filter(e=>e.constructorReturned).map(e=>closeHub(e.hub)),closeServer()]);
      if(results.some(r=>r.status==='rejected'))issue('resource-cleanup-refused');
      try{removeServerObserver();}catch{issue('server-observer-detach-refused');}
      if(rootReturned&&!checkedRoot())issue('root-path-unconfirmed');
      cleanupPhase='evidence';
      try{if(writeEvidence!==null)await writeEvidence(snapshot());}catch{issue('evidence-write-refused');}
      cleanupPhase='removal';
      if(rootReturned&&issues.size===0){
        if(!checkedRoot())issue('root-path-unconfirmed');
        else try{fs.rmSync(root,{recursive:true,force:false});directoryRemoved=true;}catch{issue('directory-removal-refused');}
      }
      cleanupPhase='complete';
      const closing=snapshot();
      if(closing.status!=='closed')try{process.stderr.write(`owned fixture closure refused (${t.name}): ${closureDiagnosis(closing)}
`);}catch{}
      return closing;
    })();return cleanupPromise;
  }
  function finalCheckpoint(){
    if(checkpointPromise)return checkpointPromise;
    checkpointPromise=(async()=>{
      const report=json(await cleanup());let removalObservation='NOT_REMOVED_OR_UNOBSERVED';
      if(report.directoryRemoved){
        try{fs.lstatSync(root);removalObservation='REMOVAL_UNCONFIRMED';}
        catch(error){removalObservation=error?.code==='ENOENT'?'ABSENT_AFTER_OWNED_REMOVAL':'REMOVAL_UNCONFIRMED';}
      }
      const provenance=rootIdentity===null?null:{root:rootIdentity.real,rootIdentity:{device:String(rootIdentity.device),inode:String(rootIdentity.inode),birthtimeNs:String(rootIdentity.birthtimeNs)},
        ownershipBasis:'actual-returned-mkdtemp-before-resource-construction',processId:process.pid};
      const checkpoint=frozenData(json({schema:'owned-configured-hub-fixture-terminal-v1',fixtureId,test:t.name,nodeVersion:process.version,
        closure:report,provenance,removalObservation,actualD:'NOT_RUN'}));
      let persistence='NOT_CONFIGURED';
      if(writeFinalCheckpoint!==null){
        persistence='UNCONFIRMED';
        try{if(await writeFinalCheckpoint(checkpoint)===true)persistence='CREATE_NEW_RETURNED';}catch{}
      }
      return Object.freeze({checkpoint,persistence});
    })();return checkpointPromise;
  }
  t.after(async()=>{const final=await finalCheckpoint();await onCleanup(final.checkpoint.closure);
    assert.notEqual(final.persistence,'UNCONFIRMED','fixture_terminal_checkpoint_persistence_refused');});
  return Object.freeze({allocateRoot,createTrialDirectory,constructServer,startServer,constructHub,closeHub,reopenHub,cleanup,finalCheckpoint,snapshot,refuseExternalClaimFailure,refuseAdditionalServerFailure,
    constructAdditionalHumanServer,startAdditionalHumanServer,observeAdditionalHumanServerClose,
    loggerFor:hub=>entryFor(hub).logger,additionalLoggerFor:server=>additionalFor(server).logger});
}
