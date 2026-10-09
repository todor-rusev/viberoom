// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert,{refusalAsNo} from '../trial-journal/policy-assert.mjs';
import invariant from 'node:assert/strict';
import {ZepClient} from '@getzep/zep-cloud';
import {ZepSourceBodyReader} from '../../dist/memory/zep-source-body-proof.js';
import {ConnectionClosedBeforeResponse,connectionClosedBeforeResponse} from '../../dist/memory/zep-sdk-fetch.js';
import {ChangeTokenCache} from '../../dist/memory/change-token-cache.js';
import {sourceVersion} from '../../dist/memory/provenance.js';
import {visibleToAgents} from '../../dist/quotes.js';
import {originalProductFingerprint} from '../../dist/memory/original-product-input.js';
import {createProductStep} from './product-step.mjs';
import {DTrial} from './profile.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';
import {runWholeTrial} from './whole-executor.mjs';
import {createSdkReadPort,createHttpAnswerPort} from '../memory-retrieval-comparison-d3/ports.mjs';
import {canonical,json,encode,sha256,Held} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {nativeProfile,validateNativeAccount,NATIVE_PENDING} from './native-project.mjs';

const digest=value=>sha256(encode(value));
const launchRoomView=r=>({id:r.id,uuid:r.uuid,name:r.name,remembers:r.remembers,input:r.input,originalInput:r.originalInput});
const launchMemberView=(row,source)=>({opId:row.opId,roomId:row.identity.roomId,sourceId:row.identity.sourceId,
  identitySha256:digest(row.identity),payloadSha256:digest(row.payload),sourceSha256:digest(source),graphId:row.payload.request.graphId});
const fields=(object,names)=>assert.deepEqual(Object.keys(object).sort(),[...names].sort());
const endpoint=value=>{const url=new URL(value);assert.ok(!url.username&&!url.password&&!url.search&&!url.hash);return url.href.replace(/\/$/,'');};
const profileIdentity=p=>({manifest:p.manifest,questions:p.questions,payloads:p.payloads,writePermits:p.writePermits,origins:p.origins,...(nativeProfile(p)?{schema:p.schema,nativeProject:p.nativeProject}:{})});
const scopeIdentity=s=>{s=json(s);delete s.evidence.privateLaunchBinding;return s;};
function credentialToken(value){
  if(typeof value!=='string'||!value.length||!/^[\x21-\x7e]+$/.test(value))throw new Held('private_credentials_invalid');
  return value;
}

export function privateRequestHeaders({profile,credentials,permit,request,init}){
  const url=new URL(typeof request==='string'?request:request instanceof URL?request.href:request.url),method=init?.method??'GET';
  assert.ok(!url.username&&!url.password&&!url.hash,'private_url_invalid');
  const planned=typeof permit.request==='string'?JSON.parse(permit.request):json(permit.request);
  const actual={method,url:url.href,body:init?.body===undefined?null:JSON.parse(String(init.body)),maxRetries:0};
  assert.ok(canonical(planned)===canonical(actual),'private_wire_request_changed');
  let key;
  if(permit.kind==='model'){
    assert.equal(url.href,profile.origins.answerEndpoint);assert.equal(method,'POST');key=`Bearer ${credentialToken(credentials.answerKey)}`;
  }else{
    assert.ok(['read','graph','ontology','episode'].includes(permit.kind),'private_request_kind_invalid');
    const base=new URL(profile.origins.readBase);assert.ok(url.origin===base.origin&&url.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/')&&!url.search,'private_zep_endpoint_changed');
    assert.ok(['GET','POST','PUT'].includes(method));key=`Api-Key ${credentialToken(credentials.zepSettings.apiKey)}`;
  }
  let headers;
  try{headers=new Headers(init?.headers);}catch{throw new Held('private_authorization_invalid');}
  if(headers.has('authorization')&&headers.get('authorization')!==key)throw new Held('private_authorization_changed');
  try{headers.set('authorization',key);}catch{throw new Held('private_authorization_invalid');}
  return headers;
}

export async function privateHttpRequest({profile,credentials,permit,request,init,fetchImpl,beforeFetch=()=>{}}){
  const headers=privateRequestHeaders({profile,credentials,permit,request,init});
  beforeFetch();
  try{return await fetchImpl(request,{...init,headers});}
  catch(error){
    if(connectionClosedBeforeResponse(error))throw new ConnectionClosedBeforeResponse();
    throw new Held('private_http_request_failed');
  }
}

export function captureLaunchBinding({history,rooms,profile,scope,accountSnapshot,current,cap}){
  invariant.equal(typeof current,'function');invariant.equal(typeof cap,'function');invariant.equal(typeof accountSnapshot,'function');
  assert.equal(current(),true,'launch_consent_changed');
  const account=json(accountSnapshot());
  if(nativeProfile(profile)){validateNativeAccount(account);assert.equal(canonical(account),canonical(profile.nativeProject.account));assert.equal(digest(scopeIdentity(scope)),profile.nativeProject.scopeIdentitySha256);}
  else {fields(account,['accountId','projectId','readBase','revision']);for(const value of Object.values(account))assert.ok(typeof value==='string'&&value.length>0);}
  assert.equal(account.readBase,profile.origins.readBase,'launch_endpoint_changed');endpoint(account.readBase);
  assert.equal(digest(scope),profile.review.serviceEmissionProofSha256,'launch_scope_changed');
  const monthlyCap=cap();assert.ok(Number.isSafeInteger(monthlyCap)&&monthlyCap>=0,'launch_cap_invalid');
  const members=profile.writePermits.filter(p=>p.kind==='episode').map(p=>{
    const opId=p.request.body.metadata.op_id,row=history.memoryOutbox.deliveries.get(opId);
    assert.ok(row,'launch_prepared_row_missing');assert.equal(row.state,'prepared');assert.equal(row.attempts,0);assert.deepEqual(row.externalIds,[]);
    const room=rooms.find(r=>r.id===row.identity.roomId),source=room&&history.getById(room.id,row.identity.sourceId),graph=scope.graphs.find(g=>g.graphId===p.request.body.graph_id);
    assert.ok(room&&source&&graph);assert.equal(graph.authority.accountId,account.accountId);
    if(nativeProfile(profile))assert.equal(canonical(graph.authority.projectBinding),canonical(NATIVE_PENDING));else assert.equal(graph.authority.projectId,account.projectId);
    assert.equal(room.account,account.accountId);assert.equal(room.uuid,row.identity.roomUuid);assert.equal(room.remembers,true);
    assert.equal(canonical(row.payload.request.metadata),canonical(p.request.body.metadata));
    assert.equal(row.payload.request.data,p.request.body.data);assert.equal(row.payload.request.graphId,p.request.body.graph_id);
    assert.equal(graph.authority.copyId,row.identity.copyId);assert.equal(graph.authority.roomUuid,room.uuid);
    assert.ok(visibleToAgents(source)&&!source.streaming&&history.memoryOutbox.ownVersion(room.id,source.id,row.identity.version)&&!history.memoryOutbox.importedSource(room.id,source.id));
    assert.equal(sourceVersion(source),row.identity.version);assert.equal(source.seq,row.payload.binding.seq);
    assert.ok(history.memoryOutbox.deliveries.currentCopy(row.identity)&&history.memoryOutbox.deliveries.accountMatches(row.identity,account.accountId));
    if(row.groupId)assert.equal(history.memoryOutbox.deliveries.getPartGroup(row.groupId).descriptor.representationFingerprint,originalProductFingerprint(source));
    return launchMemberView(row,source);
  });
  const episodes=profile.writePermits.filter(p=>p.kind==='episode').length;assert.equal(members.length,episodes);assert.equal(new Set(members.map(m=>m.opId)).size,episodes);
  const boundRooms=rooms.filter(r=>members.some(m=>m.roomId===r.id)).map(launchRoomView);
  assert.equal(boundRooms.length,profile.manifest.topology.length);
  const binding={schema:nativeProfile(profile)?'private-long-native-account-launch-binding-v2':'private-long-launch-binding-v1',profileIdentitySha256:digest(profileIdentity(profile)),scopeIdentitySha256:digest(scopeIdentity(scope)),account,monthlyCap,rooms:boundRooms,members,qualification:'Local current prepared rows and configured account identity only. Not Cloud ACK, server absence, new consent or a paid permit.'};
  assert.equal(launchBindingCurrent({history,rooms,current,cap,accountSnapshot},binding),true,'launch_binding_not_current');return json(binding);
}

export function launchBindingCurrent(ports,binding,{beforeClaim=false}={}){
  return refusalAsNo(()=>{
    const matches=view=>view.current===true&&canonical(view.account)===canonical(binding.account)&&view.cap===binding.monthlyCap;
    const start=launchView(ports);if(!matches(start))return false;
    for(const expected of binding.rooms){const r=start.rooms.find(r=>r.id===expected.id);if(!r||canonical(launchRoomView(r))!==canonical(expected)||r.account!==binding.account.accountId)return false;}
    if(!membersCurrent(ports.history,binding,beforeClaim))return false;
    return matches(launchView(ports));
  });
}

function launchView(ports){
  if(typeof ports.snapshot==='function')return ports.snapshot();
  if(ports.current()!==true)return {current:false,account:null,cap:null,rooms:[]};
  return {current:true,account:ports.accountSnapshot(),cap:ports.cap(),get rooms(){return ports.rooms;}};
}

const memberWalks=new WeakMap();
export function launchBindingWalks(binding){return memberWalks.get(binding)?.computations()??0;}
function membersCurrent(history,binding,beforeClaim){
  let walks=memberWalks.get(binding);if(!walks)memberWalks.set(binding,walks=new ChangeTokenCache());
  return walks.read(history.memoryOutbox.changeToken(),canonical([beforeClaim,binding.account.accountId,binding.rooms,binding.members]),
    ()=>walkMembers(history,binding,beforeClaim));
}
function walkMembers(history,binding,beforeClaim){
  for(const m of binding.members){
    const row=history.memoryOutbox.deliveries.get(m.opId),r=binding.rooms.find(r=>r.id===m.roomId),source=r&&history.getById(r.id,m.sourceId);
    if(!row||!source||digest(row.identity)!==m.identitySha256||digest(row.payload)!==m.payloadSha256||digest(source)!==m.sourceSha256||
      !visibleToAgents(source)||source.streaming||!history.memoryOutbox.ownVersion(r.id,source.id,row.identity.version)||history.memoryOutbox.importedSource(r.id,source.id)||
      !history.memoryOutbox.deliveries.currentCopy(row.identity)||!history.memoryOutbox.deliveries.accountMatches(row.identity,binding.account.accountId))return false;
    if(beforeClaim&&(row.state!=='prepared'||row.attempts!==0||row.externalIds.length!==0))return false;
    const namespace={provider:'zep',account:binding.account.accountId,uuid:r.uuid},head=history.memoryOutbox.generations.head(namespace),attachment=history.memoryOutbox.generationAttachment('zep',r.id);
    if(head.reason||head.followPending||head.route&&head.route.graphId!==m.graphId)return false;
    if(attachment&&(attachment.account!==binding.account.accountId||attachment.copy!==row.identity.copyId||attachment.uuid!==r.uuid||attachment.check))return false;
    if(row.groupId&&history.memoryOutbox.deliveries.getPartGroup(row.groupId).descriptor.representationFingerprint!==originalProductFingerprint(source))return false;
  }
  return true;
}

export function bindLaunchProfile({profile,scope,preparation,binding,bindingPin,codePins}){
  assert.equal(binding.profileIdentitySha256,digest(profileIdentity(profile)));assert.equal(binding.scopeIdentitySha256,digest(scopeIdentity(scope)));
  assert.equal(bindingPin.sha256,digest(binding));
  scope=json(scope);scope.evidence.privateLaunchBinding={bindingSha256:digest(binding),pin:json(bindingPin)};
  profile=json(profile);profile.codePins=json([...codePins,bindingPin].map(p=>({path:p.path,sha256:p.sha256})));
  profile.review.serviceEmissionProofSha256=digest(scope);
  return {profile,scope,preparation:json(preparation)};
}

export async function launchPrivateTrial(input){
  const {ownerRoot,profile,scope,preparation,binding,scopePorts,approval,verifyApproval,claimClock,clock,tree=null}=input;
  assert.ok(profile.purpose!=='approved-paid-trial'||tree!==null,'tree_inventory_required');
  assert.equal(binding.profileIdentitySha256,digest(profileIdentity(profile)));assert.equal(binding.scopeIdentitySha256,digest(scopeIdentity(scope)));
  assert.equal(scope.evidence.privateLaunchBinding.bindingSha256,digest(binding));
  assert.equal(digest(scope),profile.review.serviceEmissionProofSha256);
  assert.equal(launchBindingCurrent(scopePorts,binding,{beforeClaim:true}),true,'launch_binding_changed_before_claim');
  assert.equal(canonical(RunJournal.inspect(ownerRoot).policy.identity),canonical(profile),'launch_card_profile_changed');
  const owner=DTrial.claim(ownerRoot,{approval,verifyApproval,clock:claimClock,current:()=>launchBindingCurrent(scopePorts,binding)});
  let credentials=null,product=null,initializing=null,ownedNativeCapability=null;
  const runtimeCurrent=()=>refusalAsNo(()=>owner.check()===true);
  const observedCurrent=()=>runtimeCurrent()&&(!ownedNativeCapability||ownedNativeCapability.routesCurrent()===true);
  const initialize=signal=>initializing??=(async()=>{
    assert.ok(runtimeCurrent()&&!signal.aborted,'launch_authority_changed');
    let loaded;
    try{loaded=await input.loadCredentials({claimId:owner.summary().state.run.claim,account:json(binding.account),signal});}
    catch{throw new Held('private_credentials_load_failed');}
    assert.ok(runtimeCurrent()&&!signal.aborted,'launch_authority_changed_after_credentials');
    let settings,answerKey,accountReader,configuredEndpoint;
    try{
      fields(loaded,['zepSettings','answerKey']);settings=json(loaded.zepSettings);answerKey=credentialToken(loaded.answerKey);
      fields(settings,['apiKey',...(Object.hasOwn(settings,'baseUrl')?['baseUrl']:[])]);credentialToken(settings.apiKey);
      if(Object.hasOwn(settings,'baseUrl')&&typeof settings.baseUrl!=='string')throw new Held('private_credentials_invalid');
      configuredEndpoint=endpoint(settings.baseUrl??'https://api.getzep.com/api/v2');
      accountReader=new ZepSourceBodyReader(settings,async()=>{throw Error('account_identity_has_no_IO')});
    }catch{throw new Held('private_credentials_invalid');}
    assert.equal(accountReader.account,binding.account.accountId,'launch_credentials_account_changed');
    assert.equal(configuredEndpoint,endpoint(profile.origins.readBase),'launch_credentials_endpoint_changed');
    assert.ok(runtimeCurrent()&&!signal.aborted,'launch_authority_changed_before_clients');
    credentials=Object.freeze({zepSettings:Object.freeze(settings),answerKey});
    product=createProductStep({...scopePorts,settings:credentials.zepSettings,current:runtimeCurrent,preparedRows:binding.members.map(m=>scopePorts.history.memoryOutbox.deliveries.get(m.opId))});
    assert.equal(product.provider.generations.account,binding.account.accountId);return product;
  })();
  const authenticatedFetch=async(request,init)=>{
    assert.ok(credentials,'launch_fetch_outside_lifetime');
    const admission=owner.lastAdmission(),attempt=admission?.attempt;
    assert.equal(attempt?.outcome,'dispatch_uncertain','launch_fetch_without_durable_admission');
    const permit=admission.permit;assert.ok(permit&&permit.consumed>=1,'launch_fetch_without_consumed_permit');
    return privateHttpRequest({profile,credentials,permit,request,init,fetchImpl:(...args)=>input.fetchImpl(...args)});
  };
  const execution=runWholeTrial({owner,profile,scope,preparation,clock,tree,
    productStep:async step=>(await initialize(step.signal)).productStep(step),
    readLocalRoutes:graphIds=>{assert.ok(product,'launch_product_route_unavailable');return product.projectLocalRoutes(graphIds);},
    fetchImpl:authenticatedFetch,verifyReceipt:ack=>product!==null&&runtimeCurrent()&&product.verifyReceipt(ack),
    current:runtimeCurrent,get record(){return input.record;},
    comparisonPorts:({budget,nativeCapability})=>{
      assert.ok(credentials&&product&&runtimeCurrent(),'launch_comparison_before_ingestion');
      ownedNativeCapability=nativeCapability;
      const purpose=profile.purpose==='local-fixture'?'local-fixture':'approved-job';
      return {readPort:createSdkReadPort({ZepClient,baseUrl:profile.origins.readBase,apiKey:credentials.zepSettings.apiKey,purpose,approvedOrigin:new URL(profile.origins.readBase).origin,budget,current:observedCurrent,fetchImpl:authenticatedFetch,nativeProject:nativeCapability??null}),
        answerPort:createHttpAnswerPort({endpointUrl:profile.origins.answerEndpoint,apiKey:credentials.answerKey,answerControls:profile.manifest.answerControls,purpose,approvedOrigin:new URL(profile.origins.answerEndpoint).origin,budget,current:observedCurrent,fetchImpl:authenticatedFetch})};
    }});
  return execution.then(result=>{owner.close();return result;},error=>{
    try{owner.close();}catch(closeError){throw new AggregateError([error,closeError],'private_launch_and_close_failed');}throw error;
  });
}
