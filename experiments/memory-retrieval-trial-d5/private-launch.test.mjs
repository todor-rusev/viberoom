// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createOwnedPrivateLaunchFixture} from '../../private-trial/trial-journal/owned-private-launch-fixture.mjs';
import {createProductStep} from './product-step.mjs';import {prepareProductProfile} from './product-profile.mjs';import {DTrial} from './profile.mjs';import {RunJournal} from '../trial-journal/journal.mjs';
import {captureLaunchBinding,launchBindingCurrent,bindLaunchProfile,launchPrivateTrial,privateRequestHeaders,privateHttpRequest} from './private-launch.mjs';
import {canonical,encode,sha256,RunBudget} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {boundedHttp} from '../memory-retrieval-comparison-d3/ports.mjs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {DTrial as PrivateDTrial} from '../../private-trial/memory-retrieval-trial-d5/profile.mjs';
import {launchPrivateTrial as launchPrivateRuntime} from '../../private-trial/memory-retrieval-trial-d5/private-launch.mjs';
import {dInputs,evidenceFolder} from './test-folders.mjs';
const {root:input,sources:sourcesFile}=await dInputs('D_PRIVATE_INPUT','D_PRIVATE_SOURCES');let caseId=0;
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const privateEvidence=evidenceFolder('D_PRIVATE_EVIDENCE');
const authFixture=()=>({profile:{origins:{readBase:'http://127.0.0.1:49999',answerEndpoint:'http://127.0.0.1:49999/v1/chat/completions'}},credentials:{zepSettings:{apiKey:'synthetic-zep'},answerKey:'synthetic-model'}});
const errorView=error=>error?{name:error.name,message:error.message,stack:error.stack,cause:error.cause?errorView(error.cause):null,errors:Array.isArray(error.errors)?error.errors.map(errorView):null}:null;
function noSecrets(value,markers){
 const observed=typeof value==='string'?value:JSON.stringify(value);
 for(const marker of markers)for(const form of [marker,JSON.stringify(marker).slice(1,-1)])assert.equal(observed.includes(form),false,'synthetic credential marker must not escape');
}
function noPrivateRecords(w,error,markers){
 const journal=RunJournal.inspect(w.ownerRoot);noSecrets({journal,events:w.events,error:errorView(error)},markers);
 for(const name of fs.readdirSync(w.ownerRoot)){const file=path.join(w.ownerRoot,name);if(fs.statSync(file).isFile())noSecrets(fs.readFileSync(file).toString('utf8'),markers);}
 return journal;
}
function currentFixtureCodePaths(pins){
 const app=fileURLToPath(new URL('../../',import.meta.url)),prefix=app.replaceAll('\\','/');
 return pins.map(p=>{
  const normalized=p.path.replaceAll('\\','/'),relative=normalized.startsWith(prefix)?normalized.slice(prefix.length):normalized;
  assert.ok(relative&&!path.isAbsolute(relative)&&!/^[A-Za-z]:/.test(relative)&&!relative.split('/').some(part=>!part||part==='.'||part==='..'),'fixture code pin must belong to the app');
  return path.join(app,relative);
 });
}
test('local fixture pins resolve within the app and refuse foreign files',()=>{
 const app=fileURLToPath(new URL('../../',import.meta.url)),relative='experiments/memory-retrieval-trial-d5/private-launch.mjs',absolute=path.join(app,relative);
 assert.deepEqual(currentFixtureCodePaths([{path:relative},{path:absolute}]),[absolute,absolute]);
 for(const outside of ['../outside-fixture.mjs','src/../'+relative,path.resolve(app,'..','outside-fixture.mjs'),path.join(app,'src')+'/../'+relative,app]){
  assert.throws(()=>currentFixtureCodePaths([{path:outside}]),/fixture code pin must belong to the app/);
 }
});
test('same-origin model auth follows exact model permit, not the Zep URL prefix',()=>{
 const {profile,credentials}=authFixture(),request=profile.origins.answerEndpoint,init={method:'POST',body:'{"model":"fixture"}'},permit={kind:'model',request:{method:'POST',url:request,body:{model:'fixture'},maxRetries:0}};
 assert.equal(privateRequestHeaders({profile,credentials,permit,request,init}).get('authorization'),'Bearer synthetic-model');
});
test('Zep auth remains Api-Key under an exact read/write permit at the same origin',()=>{
 const {profile,credentials}=authFixture(),request=profile.origins.readBase+'/graph/create',init={method:'POST',body:'{"graph_id":"owned"}'},permit={kind:'graph',request:{method:'POST',url:request,body:{graph_id:'owned'},maxRetries:0}};
 assert.equal(privateRequestHeaders({profile,credentials,permit,request,init}).get('authorization'),'Api-Key synthetic-zep');
});
test('wire mutation and foreign endpoint refuse before an auth header is produced',()=>{
 const {profile,credentials}=authFixture(),request=profile.origins.readBase+'/graph/create',init={method:'POST',body:'{"graph_id":"owned"}'},permit={kind:'graph',request:{method:'POST',url:request,body:{graph_id:'owned'},maxRetries:0}};
 assert.throws(()=>privateRequestHeaders({profile,credentials,permit,request,init:{...init,body:'{"graph_id":"foreign"}'}}),/private_wire_request_changed/);
 const foreign='http://127.0.0.1:49998/graph/create';assert.throws(()=>privateRequestHeaders({profile,credentials,permit:{...permit,request:{...permit.request,url:foreign}},request:foreign,init}),/private_zep_endpoint_changed/);
});
test('an existing wrong authorization header is rejected for the exact permit kind',()=>{
 const {profile,credentials}=authFixture(),request=profile.origins.answerEndpoint,init={method:'POST',body:'{}',headers:{authorization:'Api-Key synthetic-zep'}},permit={kind:'model',request:{method:'POST',url:request,body:{},maxRetries:0}};
 assert.throws(()=>privateRequestHeaders({profile,credentials,permit,request,init}),/private_authorization_changed/);
});
test('invalid credential values produce fixed errors without native secret-bearing messages',()=>{
 for(const kind of ['read','model'])for(const suffix of ['\r\n','\u0000','\u0100',' ']){
  const {profile,credentials}=authFixture(),marker='SYNTHETIC_INVALID_HEADER_KEY_9200',value=marker+suffix;
  if(kind==='model')credentials.answerKey=value;else credentials.zepSettings.apiKey=value;
  const request=kind==='model'?profile.origins.answerEndpoint:profile.origins.readBase+'/graph/owned',method=kind==='model'?'POST':'GET',body=kind==='model'?{}:null;
  const permit={kind,request:{method,url:request,body,maxRetries:0}},init={method,...(body===null?{}:{body:JSON.stringify(body)})};
  assert.throws(()=>privateRequestHeaders({profile,credentials,permit,request,init}),error=>{assert.equal(error.message,'private_credentials_invalid');noSecrets(errorView(error),[marker,value]);return true;});
 }
});
test('embedded CRLF and NUL incoming authorization produce the exact invalid-header error',()=>{
 for(const suffix of ['\r\ncontinued','\u0000']){
  const {profile,credentials}=authFixture(),request=profile.origins.answerEndpoint,marker='SYNTHETIC_INCOMING_AUTH_HEADER_9200',value=marker+suffix;
  const permit={kind:'model',request:{method:'POST',url:request,body:{},maxRetries:0}},init={method:'POST',body:'{}',headers:{authorization:value}};
  assert.throws(()=>privateRequestHeaders({profile,credentials,permit,request,init}),error=>{assert.equal(error.message,'private_authorization_invalid');noSecrets(errorView(error),[marker,value]);return true;});
 }
});
test('a terminal CRLF incoming wrong authorization is trimmed and produces the exact changed-header error',()=>{
 const {profile,credentials}=authFixture(),request=profile.origins.answerEndpoint,marker='SYNTHETIC_INCOMING_AUTH_HEADER_9200',value=marker+'\r\n';
 const permit={kind:'model',request:{method:'POST',url:request,body:{},maxRetries:0}},init={method:'POST',body:'{}',headers:{authorization:value}};
 assert.throws(()=>privateRequestHeaders({profile,credentials,permit,request,init}),error=>{assert.equal(error.message,'private_authorization_changed');noSecrets(errorView(error),[marker,value]);return true;});
});
test('key-bearing fetch failure is sanitized before the bounded temporary attempt and outcome callback',async()=>{
 for(const kind of ['read','model']){
  const {profile,credentials}=authFixture(),markers=['SYNTHETIC_ZEP_FETCH_KEY_9200','SYNTHETIC_MODEL_FETCH_KEY_9200'];credentials.zepSettings.apiKey=markers[0];credentials.answerKey=markers[1];
  const request=kind==='model'?profile.origins.answerEndpoint:profile.origins.readBase+'/graph/owned',method=kind==='model'?'POST':'GET',body=kind==='model'?{}:null,wire={method,url:request,body,maxRetries:0},permit={kind,request:wire};
  const events=[],budget=new RunBudget(read(path.join(input,'PREPARED-PROFILE.json')).manifest.limits,()=>0,a=>{events.push({kind:'attempt',value:a});return true;},a=>{events.push({kind:'outcome',value:a});return true;});
  const attempt=budget.take(kind,wire);let captured,calls=0;
  try{await boundedHttp({url:request,method,body,headers:{},budget,attempt,guard:()=>{},fetchImpl:(request,init)=>privateHttpRequest({profile,credentials,permit,request,init,fetchImpl:async(_request,init)=>{
   calls++;assert.equal(new Headers(init.headers).get('authorization'),kind==='model'?`Bearer ${markers[1]}`:`Api-Key ${markers[0]}`);
   throw new TypeError(markers.join(' native fetch failure '),{cause:new Error(markers[0])});
  }})});assert.fail('fetch failure must refuse');}
  catch(error){captured=error;attempt.status='unknown';attempt.error=error.message;budget.stop('synthetic_transport_unknown');}
  finally{budget.settle(attempt);}
  assert.equal(calls,1);assert.equal(captured.message,'private_http_request_failed');assert.equal(captured.cause,undefined);assert.equal(attempt.error,'private_http_request_failed');assert.equal(events.length,2);
  noSecrets({temporaryAttempt:attempt,events,error:errorView(captured)},markers);
 }
});
test('the existing current fence runs after header serialization and before any fetch',async()=>{
 const {profile,credentials}=authFixture(),request=profile.origins.readBase+'/graph/owned',permit={kind:'read',request:{method:'GET',url:request,body:null,maxRetries:0}};
 let live=true,calls=0;const init={method:'GET',get headers(){live=false;return {};}};
 await assert.rejects(privateHttpRequest({profile,credentials,permit,request,init,
  beforeFetch:()=>assert.ok(live,'launch_authority_changed_before_fetch'),fetchImpl:async()=>{calls++;return new Response('{}')}}),/launch_authority_changed_before_fetch/);
 assert.equal(calls,0);
});
async function world(t,options={}){
 const owned=createOwnedPrivateLaunchFixture(t,{evidenceRoot:privateEvidence});
 const {root,ownerRoot,server}=owned;await owned.startDouble();
 const w={root,ownerRoot,server,owned,live:true,capValue:0,loaderCalls:0,HTTP:[],events:[]};
 w.history=owned.constructHistory();
 const old=read(path.join(input,'PREPARED-PROFILE.json')),preparation=read(path.join(input,'BOUND-PREPARATION.json')),sources=read(sourcesFile).sources;
 const variants=new Map(old.payloads.variants.map(v=>[v.name,v])),sievePath=path.join(input,'SIEVE-VERDICTS.json'),sieve=fs.existsSync(sievePath)?read(sievePath):null;
 w.rooms=old.payloads.physicalAddresses.map(g=>({id:'d2-'+g.variant+'-'+g.logicalRoom,uuid:g.room.uuid,name:g.room.name,remembers:true,input:variants.get(g.variant).memoryInput,originalInput:variants.get(g.variant).memoryInput==='whole'}));
 w.credentials={zepSettings:{apiKey:'synthetic-private-launch-fixture',baseUrl:server.url},answerKey:'synthetic-answer-fixture'};
 const existing=createProductStep({history:w.history,settings:w.credentials.zepSettings,rooms:w.rooms,current:()=>w.live,cap:()=>w.capValue,sieve});
 for(const p of old.payloads.rows){const s=sources.find(s=>s.id===p.sourceId),r=w.rooms.find(r=>r.id===p.members[0].identity.roomId);assert.ok(s&&r);
  w.history.upsert(r.id,{id:s.id,seq:w.history.maxSeq(r.id)+1,room:s.room,from:s.author,fromName:s.author,ts:Date.parse(s.at),kind:'chat',text:s.text});
  existing.prepare({source:w.history.getById(r.id,s.id),roomId:r.id,variant:p.variant});
 }
 const preparedPath=path.join(root,'LOCAL-PREPARED.json');fs.writeFileSync(preparedPath,encode(existing.rows()));
 const codePaths=currentFixtureCodePaths(old.codePins);
  codePaths.push(path.resolve('experiments/memory-retrieval-trial-d5/private-launch.mjs'));
  if(options.implementation)codePaths.push(...options.implementation.files);
  if(options.sdk){
   const sdkRoot=path.dirname(createRequire(import.meta.url).resolve('@getzep/zep-cloud/package.json'));
   const sdkPackage=read(path.join(sdkRoot,'package.json'));assert.equal(sdkPackage.version,'3.28.0');
   assert.equal(typeof sdkPackage.types,'string');
   const original=path.resolve(sdkRoot,sdkPackage.types);
   assert.ok(original.startsWith(path.resolve(sdkRoot)+path.sep)&&original.endsWith('.d.ts'));
   const bytes=fs.readFileSync(original),originalHash=sha256(bytes);
   w.sdkTarget=path.join(root,'owned-sdk',path.relative(sdkRoot,original));
   fs.mkdirSync(path.dirname(w.sdkTarget),{recursive:true});fs.writeFileSync(w.sdkTarget,bytes,{flag:'wx'});
   assert.equal(sha256(fs.readFileSync(w.sdkTarget)),originalHash);
   t.after(()=>assert.equal(sha256(fs.readFileSync(original)),originalHash,'installed SDK must remain byte-exact'));
   codePaths.push(w.sdkTarget);
  }
 const codePins=[...new Set(codePaths)].map(p=>({path:p,sha256:sha256(fs.readFileSync(p))}));old.purpose='local-fixture';
 const prepared=prepareProductProfile({prior:old,preparation,rows:existing.rows(),account:existing.provider.generations.account,origins:{readBase:server.url,answerEndpoint:server.url+'/v1/chat/completions'},codePins,preparationPin:{path:preparedPath,sha256:sha256(fs.readFileSync(preparedPath))}});
 w.account={accountId:existing.provider.generations.account,projectId:'LOCAL_UNVERIFIED_PROJECT',readBase:server.url,revision:'fixture-configured-identity-v1'};
 w.scopePorts={history:w.history,rooms:w.rooms,current:()=>w.live,cap:()=>w.capValue,accountSnapshot:()=>w.account};
 w.binding=captureLaunchBinding({...w.scopePorts,...prepared});assert.equal(w.loaderCalls,0);assert.equal(server.requests.length,0);
 const bindingPath=path.join(root,'PRIVATE-LAUNCH-BINDING.json');fs.writeFileSync(bindingPath,encode(w.binding));
 const bound=bindLaunchProfile({...prepared,binding:w.binding,bindingPin:{path:bindingPath,sha256:sha256(fs.readFileSync(bindingPath))},codePins});
 w.profile=bound.profile;w.scope=bound.scope;w.preparation=bound.preparation;
  const card=(options.implementation?.Owner??DTrial).prepare(ownerRoot,w.profile);w.approval={id:'synthetic-private-launch',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+600000).toISOString()};
 w.args={ownerRoot,profile:w.profile,scope:w.scope,preparation:w.preparation,binding:w.binding,scopePorts:w.scopePorts,approval:w.approval,verifyApproval:()=>true,
  loadCredentials:async({claimId,signal})=>{w.loaderCalls++;const state=RunJournal.inspect(ownerRoot);assert.equal(state.state.run.claim,claimId);assert.ok(claimId);assert.equal(state.state.run.stopped,null);assert.equal(state.state.attempts.length,0);assert.equal(signal.aborted,false);return w.credentials;},
  fetchImpl:async(url,init)=>{assert.equal(w.loaderCalls,1);const state=RunJournal.inspect(ownerRoot);assert.equal(state.state.attempts.at(-1).outcome,'dispatch_uncertain');
   assert.equal(new URL(String(url)).origin,new URL(server.url).origin);const isModel=new URL(String(url)).pathname==='/v1/chat/completions';
   assert.equal(new Headers(init.headers).get('authorization'),isModel?'Bearer synthetic-answer-fixture':'Api-Key synthetic-private-launch-fixture');
   w.HTTP.push({method:init.method,url:String(url),kind:isModel?'model':'zep',durableAdmission:true,expectedAuth:true});
   return fetch(url,init);},record:(kind,value)=>w.events.push({kind,value})};
 w.run=async overrides=>{
   let result,error;try{result=await (options.implementation?.launch??launchPrivateTrial)({...w.args,...overrides})}catch(e){error=e}
  const state=RunJournal.inspect(ownerRoot);if(privateEvidence)fs.writeFileSync(path.join(privateEvidence,`case-${++caseId}.json`),encode({node:process.version,localOnly:true,actualD:'NOT_RUN',loaderCalls:w.loaderCalls,HTTP:w.HTTP,claim:state.state.run.claim,stopped:state.state.run.stopped,attempts:state.state.attempts,bindings:state.state.bindings,events:w.events,finishEvents:w.events.filter(e=>e.kind==='finish').length,result,error:errorView(error)}),{flag:'wx'});
  if(error)throw error;return result;
 };
 return w;
}
test('binding capture is nonsecret and has no loader/client I/O or claim',async t=>{
 const w=await world(t);assert.equal(w.binding.members.length,34);assert.equal(w.binding.rooms.length,20);assert.equal(w.loaderCalls,0);assert.equal(w.HTTP.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
 assert.ok(!JSON.stringify(w.binding).includes(w.credentials.zepSettings.apiKey));assert.ok(!JSON.stringify(w.binding).includes(w.credentials.answerKey));assert.equal(launchBindingCurrent(w.scopePorts,w.binding,{beforeClaim:true}),true);
});
for(const [name,change] of [
 ['consent revoked',w=>{w.live=false}],['room consent revoked',w=>{w.rooms[0].remembers=false}],['opt-in changed',w=>{w.rooms.find(r=>r.originalInput).originalInput=false}],
 ['account changed',w=>{w.account={...w.account,accountId:'foreign'}}],['config revision changed',w=>{w.account={...w.account,revision:'different'}}],['cap changed',w=>{w.capValue=1}],
 ['copy rotated',w=>{const m=w.binding.members[0],r=w.rooms.find(r=>r.id===m.roomId);w.history.memoryOutbox.deliveries.rotateCopy('zep',r.id,r.uuid)}],
 ['source changed',w=>{const m=w.binding.members[0],s=w.history.getById(m.roomId,m.sourceId);w.history.upsert(m.roomId,{...s,text:s.text+' changed'})}],
 ['import authority changed',w=>{const m=w.binding.members[0],row=w.history.memoryOutbox.deliveries.get(m.opId);w.history.memoryOutbox.importSource(m.roomId,m.sourceId,row.identity.version)}],
 ])test(`preclaim refuses ${name} before credentials or I/O`,async t=>{const w=await world(t);change(w);await assert.rejects(w.run(),/launch_binding_changed_before_claim/);assert.equal(w.loaderCalls,0);assert.equal(w.HTTP.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);});
test('modified scope refuses before claim and credential getter',async t=>{const w=await world(t),scope=structuredClone(w.scope);scope.graphs[0].authority.copyId='foreign';await assert.rejects(w.run({scope}));assert.equal(w.loaderCalls,0);assert.equal(w.HTTP.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);});
test('wrong approval card refuses without loading credentials',async t=>{const w=await world(t);await assert.rejects(w.run({approval:{...w.approval,cardSha256:'0'.repeat(64)}}));assert.equal(w.loaderCalls,0);assert.equal(w.HTTP.length,0);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);});
test('postclaim loader failure terminates once and repeated launch cannot load again',async t=>{const w=await world(t);const fail=async()=>{w.loaderCalls++;throw Error('synthetic-loader-failure')};await assert.rejects(w.run({loadCredentials:fail}),/private_credentials_load_failed/);assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);const previous=canonical(RunJournal.inspect(w.ownerRoot));await assert.rejects(w.run({loadCredentials:fail}));assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),previous);assert.equal(w.loaderCalls,1);assert.equal(w.HTTP.length,0);assert.equal(w.events.length,0);});
test('rotated credentials refuse before SDK/product dispatch',async t=>{const w=await world(t);w.credentials.zepSettings.apiKey='synthetic-wrong-key';await assert.rejects(w.run(),/launch_credentials_account_changed/);assert.equal(w.loaderCalls,1);assert.equal(w.HTTP.length,0);assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);});
test('postclaim invalid keys terminate once without transport, records or secret-bearing terminal errors',async t=>{
 for(const kind of ['zep','model']){
  const w=await world(t),marker=`SYNTHETIC_POSTCLAIM_INVALID_${kind}_9200`,value=marker+'\r\n';
  if(kind==='zep')w.credentials.zepSettings.apiKey=value;else w.credentials.answerKey=value;
  let captured;await assert.rejects(w.run(),error=>{captured=error;assert.equal(error.message,'private_credentials_invalid');return true;});
  const state=noPrivateRecords(w,captured,[marker,value]);assert.ok(state.state.run.claim);assert.ok(state.state.run.stopped);assert.equal(state.state.attempts.length,0);assert.equal(w.loaderCalls,1);assert.equal(w.HTTP.length,0);assert.equal(w.events.length,0);
  const previous=canonical(state);await assert.rejects(w.run());assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),previous);assert.equal(w.loaderCalls,1);
 }
});
test('postclaim secret-bearing credential accessor errors are replaced before common finish',async t=>{
 const w=await world(t),marker='SYNTHETIC_CREDENTIAL_ACCESSOR_KEY_9200';Object.defineProperty(w.credentials,'answerKey',{get(){throw Error(marker)},enumerable:true});let captured;
 await assert.rejects(w.run(),error=>{captured=error;assert.equal(error.message,'private_credentials_invalid');return true;});
 const state=noPrivateRecords(w,captured,[marker]);assert.ok(state.state.run.stopped);assert.equal(state.state.attempts.length,0);assert.equal(w.loaderCalls,1);assert.equal(w.HTTP.length,0);assert.equal(w.events.length,0);
});
test('actual postclaim fetch failure keeps one unknown attempt and no secret in journal/record/terminal/restart',async t=>{
 const w=await world(t),markers=[w.credentials.zepSettings.apiKey,w.credentials.answerKey];let calls=0,captured;
 const failingFetch=async(request,init)=>{
  calls++;const state=RunJournal.inspect(w.ownerRoot);assert.equal(state.state.attempts.length,1);assert.equal(state.state.attempts[0].outcome,'dispatch_uncertain');
  assert.equal(new Headers(init.headers).get('authorization'),`Api-Key ${markers[0]}`);
  throw new TypeError('synthetic native fetch: '+markers.join(' + '),{cause:new Error(markers[1])});
 };
 await assert.rejects(w.run({fetchImpl:failingFetch}),error=>{captured=error;noSecrets(errorView(error),markers);return true;});
 const state=noPrivateRecords(w,captured,markers);assert.equal(calls,1);assert.equal(w.server.requests.length,0);assert.equal(w.HTTP.length,0);assert.equal(state.state.attempts.length,1);assert.equal(state.state.attempts[0].outcome,'unknown');assert.equal(state.state.permits.filter(p=>p.consumed===1).length,1);assert.ok(state.state.run.stopped);assert.equal(w.events.filter(e=>e.kind==='finish').length,0);
 const previous=canonical(state);await assert.rejects(w.run({fetchImpl:failingFetch}));assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),previous);assert.equal(calls,1);assert.equal(w.loaderCalls,1);noPrivateRecords(w,captured,markers);
});
test('revocation during async credential load terminates before clients/I/O',async t=>{const w=await world(t);await assert.rejects(w.run({loadCredentials:async()=>{w.loaderCalls++;await Promise.resolve();w.live=false;return w.credentials;}}),/launch_authority_changed_after_credentials/);assert.equal(w.HTTP.length,0);assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);});
test('throwing postclaim lazy recorder uses common finish without loading credentials',async t=>{const w=await world(t);const args={...w.args};Object.defineProperty(args,'record',{get(){throw Error('synthetic-record-accessor')}});await assert.rejects(launchPrivateTrial(args),/synthetic-record-accessor/);assert.equal(w.loaderCalls,0);assert.equal(w.HTTP.length,0);assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);});
test('concurrent launch refuses without terminating the first loader lifetime',async t=>{const w=await world(t);let entered,release;const ready=new Promise(r=>entered=r),blocked=new Promise(r=>release=r);
 const leader=w.run({loadCredentials:async()=>{w.loaderCalls++;entered();await blocked;throw Error('synthetic-leader-failure')}});await ready;
 await assert.rejects(w.run(),/trial_already_claimed/);assert.equal(RunJournal.inspect(w.ownerRoot).state.run.stopped,null);assert.equal(w.loaderCalls,1);release();await assert.rejects(leader,/private_credentials_load_failed/);assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);assert.equal(w.HTTP.length,0);
});
test('malformed credentials and throwing loader accessor terminate the acquired owner without I/O',async t=>{
 for(const kind of ['null','accessor']){
  const w=await world(t),args={...w.args};if(kind==='null')args.loadCredentials=async()=>{w.loaderCalls++;return null};
  else Object.defineProperty(args,'loadCredentials',{get(){throw Error('secret-like loader error')}});
  await assert.rejects(launchPrivateTrial(args));assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);assert.equal(w.HTTP.length,0);
 }
});
test('restart with a consumed claim and no terminal record cannot load credentials again',async t=>{const w=await world(t),owner=DTrial.claim(w.ownerRoot,{approval:w.approval,verifyApproval:()=>true,current:()=>true});owner.close();const previous=canonical(RunJournal.inspect(w.ownerRoot));await assert.rejects(w.run(),/trial_already_claimed/);assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),previous);assert.equal(w.loaderCalls,0);assert.equal(w.HTTP.length,0);});
test('postclaim prepared-row restore uses actual C, authorized headers, 34 ACKs and real D3 read handoff',async t=>{const w=await world(t),result=await w.run();assert.equal(result.status,'held');assert.equal(w.loaderCalls,1);
 assert.equal(w.server.requests.filter(r=>r.method==='POST'&&r.path==='/graph/create').length,20);assert.equal(w.server.requests.filter(r=>r.method==='PUT'&&r.path==='/entity-types').length,20);assert.equal(w.server.requests.filter(r=>r.method==='POST'&&r.path==='/graph').length,34);
 assert.equal(RunJournal.inspect(w.ownerRoot).state.bindings.length,1);assert.ok(RunJournal.inspect(w.ownerRoot).state.run.stopped);assert.equal(w.HTTP.filter(r=>r.kind==='model').length,0);assert.ok(w.HTTP.length>179,'comparison performs a real SDK read after ingestion');assert.equal(w.events.filter(e=>e.kind==='finish').length,1);
 const previous=canonical(RunJournal.inspect(w.ownerRoot)),requests=w.HTTP.length;await assert.rejects(w.run());assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),previous);assert.equal(w.HTTP.length,requests);assert.equal(w.loaderCalls,1);
});

const launchImplementations=[
 {name:'experiment',Owner:DTrial,launch:launchPrivateTrial,files:[
  fileURLToPath(new URL('./profile.mjs',import.meta.url)),
  fileURLToPath(new URL('./private-launch.mjs',import.meta.url)),
  fileURLToPath(new URL('../trial-journal/journal.mjs',import.meta.url))]},
 {name:'private',Owner:PrivateDTrial,launch:launchPrivateRuntime,files:[
  fileURLToPath(new URL('../../private-trial/memory-retrieval-trial-d5/profile.mjs',import.meta.url)),
  fileURLToPath(new URL('../../private-trial/memory-retrieval-trial-d5/private-launch.mjs',import.meta.url)),
  fileURLToPath(new URL('../../private-trial/trial-journal/journal.mjs',import.meta.url))]},
];
function afterExactClaim(t,implementation,change){
 const original=implementation.Owner.claim;let calls=0;
 implementation.Owner.claim=function(...args){
  const owner=original.apply(this,args);calls++;
  assert.ok(owner.summary().state.run.claim,'change only after original durable claim');
  change(owner);return owner;
 };
 t.after(()=>{implementation.Owner.claim=original;});
 return ()=>calls;
}
function changeOwnedSdk(w,missing=false){
 assert.ok(path.resolve(w.sdkTarget).startsWith(path.resolve(w.root,'owned-sdk')+path.sep));
 if(missing)fs.unlinkSync(w.sdkTarget);else fs.appendFileSync(w.sdkTarget,'\n// owned postclaim declaration drift\n');
}
const messages=error=>error?[error.message,...(error.errors??[]).flatMap(messages)]:[];
function refusedWithChangedPins(primary){
 return error=>{
  assert.equal(error.message,'comparison_and_finish_failed');assert.match(error.errors[0].message,primary);
  assert.deepEqual(messages(error.errors[1]),['comparison_finish_failed','code_pins_changed_during_trial']);return true;
 };
}
async function refusesBeforeLoader(w,implementation,{drift=false}={}){
 let getterReads=0;
 const args={...w.args,claimClock:()=>w.tick,clock:()=>0};
 Object.defineProperty(args,'loadCredentials',{get(){getterReads++;return w.args.loadCredentials;}});
 await assert.rejects(implementation.launch(args),drift?refusedWithChangedPins(/whole_trial_authority_changed/):/whole_trial_authority_changed/);
 const state=RunJournal.inspect(w.ownerRoot).state;
 assert.ok(state.run.claim);assert.ok(state.run.stopped);if(drift)assert.equal(state.run.stopped,'code_pins_changed_during_trial');
 assert.equal(getterReads,0);assert.equal(w.loaderCalls,0);
 assert.equal(w.HTTP.length,0);assert.equal(w.server.requests.length,0);
  assert.equal(state.attempts.length,0);assert.equal(state.permits.length,0);
  assert.equal(w.events.filter(e=>e.kind==='finish').length,0);
  w.live=true;
  const before=canonical(RunJournal.inspect(w.ownerRoot));
 await assert.rejects(implementation.launch(args),/trial_already_claimed/);
 assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),before);assert.equal(getterReads,0);
}
function finalLoaderBoundary(t,w,implementation,{expireInside=false}={}){
 const probe={setupFinished:false,checksAfterSetup:0,inCheck:false,last:false,
  checkSucceeded:false,guardedCalls:0,unguardedCalls:0,loaderReads:0,clockAtLoader:null};
 w.tick=0;
 w.scopePorts.current=()=>{
  if(probe.last){
   if(probe.inCheck){
    probe.guardedCalls++;
    if(expireInside&&probe.guardedCalls===2)w.tick=w.profile.manifest.limits.runMs;
   }else{probe.unguardedCalls++;w.tick=w.profile.manifest.limits.runMs;}
  }
  return w.live;
 };
 afterExactClaim(t,implementation,owner=>{
  const beginSetup=owner.beginSetup,check=owner.check;
  owner.beginSetup=function(...args){
   const value=beginSetup.apply(this,args);probe.setupFinished=true;return value;
  };
  owner.check=function(...args){
   if(probe.setupFinished)probe.checksAfterSetup++;
   probe.last=probe.setupFinished&&probe.checksAfterSetup===2;
   probe.inCheck=true;
   try{const value=check.apply(this,args);if(probe.last)probe.checkSucceeded=true;return value;}
   finally{probe.inCheck=false;}
  };
 });
 const args={...w.args,claimClock:()=>w.tick,clock:()=>0};
 Object.defineProperty(args,'loadCredentials',{get(){
  probe.loaderReads++;probe.clockAtLoader=w.tick;
  throw Error('synthetic_stop_at_final_loader_boundary');
 }});
 return {probe,args};
}
for(const implementation of launchImplementations){
 const control=(name,body)=>test(`${implementation.name} owner-current: ${name}`,{concurrency:false},body);

 control('zero-write check accepts own permit/outcome progress and refuses the stopped lifetime',async t=>{
  const w=await world(t,{implementation});w.tick=0;
  const owner=implementation.Owner.claim(w.ownerRoot,{approval:w.approval,verifyApproval:()=>true,
   current:()=>launchBindingCurrent(w.scopePorts,w.binding),clock:()=>w.tick});
  try{
   const before=canonical(owner.summary());assert.equal(owner.check(),true);assert.equal(canonical(owner.summary()),before);
   const permit=w.profile.writePermits.find(p=>p.kind==='graph');
   const handle=owner.admitWrite(permit.id,permit.request);
   assert.equal(owner.outcome(handle,{status:200,raw:'{}',latencyMs:0,known:true}),true);
   const progressed=owner.summary();assert.equal(progressed.state.attempts.length,1);
   assert.equal(progressed.state.attempts[0].outcome,'received');assert.notEqual(canonical(progressed),before);
   assert.equal(owner.check(),true);assert.equal(canonical(owner.summary()),canonical(progressed));
   owner.stop('synthetic_control_finished');const stopped=canonical(owner.summary());
   assert.throws(()=>owner.check(),/trial_stopped/);assert.equal(canonical(owner.summary()),stopped);
   assert.equal(w.loaderCalls,0);assert.equal(w.HTTP.length,0);
  }finally{owner.close();}
 });

 control('deadline reached after durable claim refuses before even reading the loader',async t=>{
  const w=await world(t,{implementation});w.tick=0;
  const claims=afterExactClaim(t,implementation,()=>{w.tick=w.profile.manifest.limits.runMs;});
  await refusesBeforeLoader(w,implementation);assert.equal(claims(),1);
 });

 control('deadline crossed inside a true raw current callback refuses before the loader',async t=>{
  const w=await world(t,{implementation});w.tick=0;let armed=false;
  w.scopePorts.current=()=>{if(armed)w.tick=w.profile.manifest.limits.runMs;return w.live;};
  const claims=afterExactClaim(t,implementation,()=>{armed=true;});
  await refusesBeforeLoader(w,implementation);assert.equal(claims(),1);
 });

 control('final guarded callback immediately before loader refuses when its true result crosses the deadline',async t=>{
  const w=await world(t,{implementation}),{probe,args}=finalLoaderBoundary(t,w,implementation,{expireInside:true});
  await assert.rejects(implementation.launch(args),/launch_authority_changed/);
  assert.equal(probe.setupFinished,true);assert.equal(probe.checksAfterSetup,2);
  assert.equal(probe.guardedCalls,2);assert.equal(probe.checkSucceeded,false);
  assert.equal(w.tick,w.profile.manifest.limits.runMs);assert.equal(probe.unguardedCalls,0);
  assert.equal(probe.loaderReads,0);assert.equal(probe.clockAtLoader,null);
  const state=RunJournal.inspect(w.ownerRoot).state;
  assert.ok(state.run.claim);assert.ok(state.run.stopped);
  assert.equal(w.loaderCalls,0);assert.equal(w.HTTP.length,0);assert.equal(w.server.requests.length,0);
  assert.equal(state.attempts.length,0);assert.equal(state.permits.length,0);
 });

 control('no unguarded raw callback may run after final owner check before the loader getter',async t=>{
  const w=await world(t,{implementation}),{probe,args}=finalLoaderBoundary(t,w,implementation);
  await assert.rejects(implementation.launch(args),/private_credentials_load_failed/);
  assert.equal(probe.setupFinished,true);assert.equal(probe.checksAfterSetup,2);
  assert.equal(probe.guardedCalls,2);assert.equal(probe.checkSucceeded,true);
  assert.equal(probe.unguardedCalls,0);assert.equal(probe.loaderReads,1);
  assert.equal(probe.clockAtLoader,0);assert.ok(probe.clockAtLoader<w.profile.manifest.limits.runMs);
  const state=RunJournal.inspect(w.ownerRoot).state;
  assert.ok(state.run.claim);assert.ok(state.run.stopped);
  assert.equal(w.loaderCalls,0);assert.equal(w.HTTP.length,0);assert.equal(w.server.requests.length,0);
  assert.equal(state.attempts.length,0);assert.equal(state.permits.length,0);
 });

 control('consent revoked after the actual claim refuses before the loader',async t=>{
  const w=await world(t,{implementation});w.tick=0;
  const claims=afterExactClaim(t,implementation,()=>{w.live=false;});
  await refusesBeforeLoader(w,implementation);assert.equal(claims(),1);
 });

 for(const missing of [false,true])control(`physical SDK ${missing?'missing':'byte drift'} after claim refuses before the loader`,async t=>{
  const w=await world(t,{implementation,sdk:true});w.tick=0;
  const claims=afterExactClaim(t,implementation,()=>changeOwnedSdk(w,missing));
  await refusesBeforeLoader(w,implementation,{drift:true});assert.equal(claims(),1);
 });

 control('SDK drift during awaited loader refuses before inspecting credentials or creating clients',async t=>{
  const w=await world(t,{implementation,sdk:true});let credentialReads=0;
  const loaded={answerKey:w.credentials.answerKey};
  Object.defineProperty(loaded,'zepSettings',{enumerable:true,get(){credentialReads++;return w.credentials.zepSettings;}});
  await assert.rejects(w.run({loadCredentials:async()=>{
   w.loaderCalls++;await Promise.resolve();changeOwnedSdk(w);return loaded;
  }}),refusedWithChangedPins(/launch_authority_changed_after_credentials/));
  const state=RunJournal.inspect(w.ownerRoot).state;
  assert.ok(state.run.claim);assert.equal(state.run.stopped,'code_pins_changed_during_trial');assert.equal(state.attempts.length,0);
  assert.equal(w.loaderCalls,1);assert.equal(credentialReads,0);assert.equal(w.HTTP.length,0);
  assert.equal(w.server.requests.length,0);
 });

 control('SDK drift after one actual HTTP result retains one unknown attempt and prevents further requests',async t=>{
  const w=await world(t,{implementation,sdk:true});let calls=0;
  await assert.rejects(w.run({fetchImpl:async(request,init)=>{
   calls++;const result=await w.args.fetchImpl(request,init);changeOwnedSdk(w);return result;
  }}),error=>{assert.ok(messages(error).includes('code_pins_changed_during_trial'));return true;});
  const state=RunJournal.inspect(w.ownerRoot).state;
  assert.equal(calls,1);assert.equal(w.HTTP.length,1);assert.equal(w.server.requests.length,1);
  assert.equal(state.attempts.length,1);assert.equal(state.attempts[0].outcome,'unknown');
  assert.equal(state.permits.filter(p=>p.consumed===1).length,1);assert.ok(state.run.stopped);
  const before=canonical(RunJournal.inspect(w.ownerRoot));await assert.rejects(w.run());
  assert.equal(canonical(RunJournal.inspect(w.ownerRoot)),before);assert.equal(calls,1);assert.equal(w.loaderCalls,1);
 });

 control('guarded launch permits its own row/journal progress through all 34 ACKs and the D3 handoff',async t=>{
  const w=await world(t,{implementation,sdk:true}),result=await w.run();
  assert.equal(result.status,'held');assert.equal(w.loaderCalls,1);
  assert.equal(w.server.requests.filter(r=>r.method==='POST'&&r.path==='/graph/create').length,20);
  assert.equal(w.server.requests.filter(r=>r.method==='PUT'&&r.path==='/entity-types').length,20);
  assert.equal(w.server.requests.filter(r=>r.method==='POST'&&r.path==='/graph').length,34);
  const state=RunJournal.inspect(w.ownerRoot).state;
  assert.ok(state.bindings.some(b=>b.name==='ingestion-acks'));assert.ok(state.run.stopped);
  assert.equal(w.HTTP.filter(r=>r.kind==='model').length,0);assert.ok(w.HTTP.length>179);
  assert.equal(w.events.filter(e=>e.kind==='finish').length,1);
 });
}
test('owned private fixture distinguishes both physical journal origins and waits for actual closure',async t=>{
  const w=await world(t,{implementation:launchImplementations[1]});
  assert.equal(RunJournal.inspect(w.ownerRoot).state.run.claim,null);
  const terminal=await w.owned.finalize();
  assert.equal(terminal.family,'private-launch');
  assert.equal(terminal.selector,'experiments/memory-retrieval-trial-d5/private-launch.test.mjs');
  assert.equal(terminal.status,'closed');assert.equal(terminal.traceComplete,true);
  assert.deepEqual(terminal.constructorUnknowns,[]);assert.deepEqual(terminal.teardownUnknowns,[]);assert.deepEqual(terminal.loggerCategories,[]);
  const journals=terminal.acquired.filter(r=>r.kind==='sqlite-journal');
  assert.ok(journals.length>=2);assert.equal(new Set(terminal.acquired.map(r=>r.id)).size,terminal.acquired.length);
  assert.deepEqual([...new Set(journals.map(r=>r.id.split(':')[1]))].sort(),['experiment','private']);
  for(const field of ['observerSourcePins','journalSourcePins']){
    assert.deepEqual(terminal[field].map(p=>p.namespace),['experiment','private']);
    assert.notEqual(terminal[field][0].pin.path,terminal[field][1].pin.path);
    for(const {pin} of terminal[field])assert.equal(sha256(fs.readFileSync(pin.path)),pin.sha256);
  }
  for(const field of ['coreSourcePin','descriptorSourcePin']){
    assert.ok(terminal[field].bytes>0);assert.equal(sha256(fs.readFileSync(terminal[field].path)),terminal[field].sha256);
  }
  if(privateEvidence){
    assert.equal(terminal.acquisitionPins.length,terminal.acquired.length);
    for(const [index,pin] of terminal.acquisitionPins.entries()){
      const bytes=fs.readFileSync(pin.path),record=JSON.parse(bytes),row=terminal.acquired[index];
      assert.equal(bytes.length,pin.bytes);assert.equal(sha256(bytes),pin.sha256);
      assert.equal(record.id,row.id);assert.equal(record.kind,row.kind);assert.equal(record.path,row.path);
      const namespace=['sqlite-journal','file-journal-seed'].includes(row.kind)?row.id.split(':')[1]:null;assert.equal(record.namespace,namespace);
      for(const [singular,plural] of [['observerSourcePin','observerSourcePins'],['journalSourcePin','journalSourcePins']]){
        assert.deepEqual(record[singular],namespace===null?null:terminal[plural].find(p=>p.namespace===namespace).pin);
      }
    }
  }
  for(const row of terminal.acquired){assert.equal(row.constructorReturned,true);assert.equal(row.closeAttempts,1);assert.equal(row.closeCallReturned,true);assert.equal(row.openAfterClose,false);}
  assert.equal(terminal.acquired.find(r=>r.kind==='http').closeEventObserved,true);
  assert.equal(w.history.db.raw.isOpen,false);assert.equal(w.server.server.listening,false);
  assert.deepEqual([...terminal.released].sort(),terminal.acquired.map(r=>r.id).sort());
  assert.equal(terminal.root.removed,true);assert.equal(terminal.root.afterRemoval,'absent');assert.equal(fs.existsSync(w.root),false);
  assert.equal(await w.owned.finalize(),terminal,'finalization must reuse the same first-close result');
});
