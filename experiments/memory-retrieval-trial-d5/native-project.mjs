// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import {Graph} from '@getzep/zep-cloud/serialization';
import {canonical,json,encode,sha256,text,fields} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {captureSdkGraph} from '../memory-retrieval-comparison-d3/envelope-projection.mjs';
import {verifySdkWireBody} from '../memory-retrieval-comparison-d3/wire-projection.mjs';
import {zepGraphId} from '../../dist/memory/zep-payload.js';
import {parseGenerationPointer} from '../../dist/memory/graph-generations.js';

export const NATIVE_PROFILE='viberoom-retrieval-long-trial-native-project-profile-v2';
export const NATIVE_ENTRY='viberoom-retrieval-account-provisional-permit-v2';
export const NATIVE_FINAL='viberoom-retrieval-native-project-final-permit-v2';
export const NATIVE_PENDING=Object.freeze({mode:'native-project-after-claim',projectId:null});
export const NATIVE_DECLARATION='viberoom-native-project-declaration-v3';
export const PROVISIONAL_LOCAL_ROUTE='viberoom-provisional-local-route-v1';
export const OBSERVED_LOCAL_ROUTE='viberoom-product-observed-local-route-v1';
export const NATIVE_OBSERVATION='viberoom-native-project-observation-v3';
export const NATIVE_BINDING_SET='viberoom-complete-native-project-binding-set-v3';
const absentHead=Object.freeze({revision:'',route:null,checkedAt:null,reason:null,followPending:false});

export function validateProvisionalLocalRoute(input,authority,profile){
  const r=json(input);
  fields(r,['schema','mode','namespaceId','accountId','graphId','roomId','roomUuid','generationId','materializationSha256','head','attachment']);
  assert.equal(r.schema,PROVISIONAL_LOCAL_ROUTE);assert.equal(r.mode,'unobserved-implicit-base');
  assert.match(r.namespaceId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.match(r.roomUuid,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.match(r.accountId,/^sha256:[a-f0-9]{64}$/);
  for(const k of ['accountId','graphId','roomId','roomUuid','generationId'])text(r[k]);
  assert.equal(r.accountId,authority.accountId);assert.equal(r.graphId,authority.graphId);assert.equal(r.roomUuid,authority.roomUuid);
  assert.equal(r.graphId,zepGraphId(r.roomUuid));assert.equal(r.generationId,'implicit-base:'+r.graphId);assert.equal(authority.generationId,r.generationId);
  assert.equal(r.roomId,`trial:${r.namespaceId}:${r.roomUuid}`);
  assert.match(r.materializationSha256,/^[a-f0-9]{64}$/);
  assert.equal(authority.scopeRevision,r.materializationSha256);assert.equal(authority.verificationId,r.materializationSha256);
  equal(r.head,absentHead);assert.equal(r.attachment,null);assert.equal(authority.routeRevision,r.head.revision);
  const topology=profile.manifest.topology.find(g=>g.graphId===r.graphId);assert.ok(topology);
  const rows=profile.payloads.rows.filter(row=>row.logicalRoom===authority.room&&row.variant===topology.variant);assert.ok(rows.length);
  for(const row of rows)for(const member of row.members){
    assert.equal(member.identity.roomId,r.roomId);assert.equal(member.identity.roomUuid,r.roomUuid);assert.equal(member.identity.copyId,authority.copyId);
  }
  return r;
}
function projectProvisionalLocalRoutes(profile,scope,authorities,context){
  const fresh=authorities.filter(a=>a.routeRevision==='');if(!fresh.length)return [];
  assert.ok(context,'native_provisional_local_route_context_required');context=json(context);fields(context,['namespaceId','rooms','routes']);
  const namespace=scope.evidence.privateNamespace;assert.ok(namespace);assert.equal(namespace.schema,'same-hub-private-trial-source-v1');assert.equal(namespace.namespaceId,context.namespaceId);
  const graphs=profile.manifest.topology.length;
  assert.equal(context.rooms.length,graphs);assert.equal(context.routes.length,graphs);
  assert.equal(new Set(context.rooms.map(r=>r.id)).size,graphs);assert.equal(new Set(context.rooms.map(r=>r.uuid)).size,graphs);assert.equal(new Set(context.routes.map(r=>r.roomId)).size,graphs);
  return fresh.map(a=>{
    const rooms=context.rooms.filter(r=>r.uuid===a.roomUuid);assert.equal(rooms.length,1);const room=rooms[0];
    assert.equal(room.account,a.accountId);const routes=context.routes.filter(r=>r.roomId===room.id);assert.equal(routes.length,1);const route=routes[0];
    const record={schema:PROVISIONAL_LOCAL_ROUTE,mode:'unobserved-implicit-base',namespaceId:context.namespaceId,accountId:a.accountId,
      graphId:a.graphId,roomId:room.id,roomUuid:room.uuid,generationId:a.generationId,materializationSha256:namespace.materialization.sha256,
      head:json(route.head),attachment:json(route.attachment)};
    return validateProvisionalLocalRoute(record,a,profile);
  });
}
export const digest=value=>sha256(encode(value));
export const nativeProfile=profile=>profile.schema===NATIVE_PROFILE;
const equal=(a,b)=>assert.equal(canonical(a),canonical(b));
export function validateNativeAccount(input){
  const account=json(input);fields(account,['accountId','readBase','revision','projectBinding']);
  for(const k of ['accountId','readBase','revision'])text(account[k]);equal(account.projectBinding,NATIVE_PENDING);return account;
}
const scopeIdentity=scope=>{scope=json(scope);delete scope.evidence.privateLaunchBinding;return scope;};
export function prepareNativeProductProfile(prepared,inputAccount,localRouteContext=null){
  const account=validateNativeAccount(inputAccount),profile=json(prepared.profile),scope=json(prepared.scope);
  assert.equal(profile.schema,'viberoom-retrieval-long-trial-profile-v1');
  scope.schema='viberoom-whole-long-native-account-scope-v2';
  for(const graph of scope.graphs){delete graph.authority.projectId;graph.authority.projectBinding=json(NATIVE_PENDING);}
  const provisionalAuthorities=scope.graphs.map(g=>json(g.authority)),scopeIdentitySha256=digest(scopeIdentity(scope));
  const provisionalLocalRoutes=projectProvisionalLocalRoutes(profile,scope,provisionalAuthorities,localRouteContext);
  const accountScopeSha256=digest({account,scopeIdentitySha256,provisionalAuthorities,provisionalLocalRoutes});
  profile.schema=NATIVE_PROFILE;profile.nativeProject={schema:NATIVE_DECLARATION,account,
    accountScopeSha256,scopeIdentitySha256,provisionalAuthorities,provisionalLocalRoutes,derivation:'same-durable-t0-graph-get-v1'};
  profile.review.serviceEmissionProofSha256=digest(scope);
  validateNativeDeclaration(profile);return {profile,scope,preparation:json(prepared.preparation)};
}
export function validateNativeDeclaration(profile){
  assert.equal(profile.schema,NATIVE_PROFILE);const n=profile.nativeProject;
  fields(n,['schema','account','accountScopeSha256','scopeIdentitySha256','provisionalAuthorities','provisionalLocalRoutes','derivation']);
  assert.equal(n.schema,NATIVE_DECLARATION);assert.equal(n.derivation,'same-durable-t0-graph-get-v1');
  const account=validateNativeAccount(n.account);assert.equal(account.readBase,profile.origins.readBase);
  const graphs=profile.manifest.topology.length;
  assert.match(n.scopeIdentitySha256,/^[a-f0-9]{64}$/);assert.equal(n.provisionalAuthorities.length,graphs);
  assert.ok(Array.isArray(n.provisionalLocalRoutes)&&n.provisionalLocalRoutes.length<=graphs);
  assert.equal(new Set(n.provisionalLocalRoutes.map(r=>r.graphId)).size,n.provisionalLocalRoutes.length);
  const seen=new Set(),localSeen=new Set();for(const a of n.provisionalAuthorities){
    fields(a,['accountId','projectBinding','graphId','room','roomUuid','copyId','generationId','routeRevision','scopeRevision','verificationId','sourceState']);
    for(const k of ['accountId','graphId','room','roomUuid','copyId','generationId','scopeRevision','verificationId'])text(a[k]);
    const local=n.provisionalLocalRoutes.find(r=>r.graphId===a.graphId);
    if(a.routeRevision===''){assert.ok(local,'native_empty_route_requires_local_declaration');validateProvisionalLocalRoute(local,a,profile);localSeen.add(a.graphId);}
    else {text(a.routeRevision);assert.equal(local,undefined,'native_initialized_route_is_not_unobserved');}
    equal(a.projectBinding,NATIVE_PENDING);assert.equal(a.accountId,account.accountId);assert.equal(a.sourceState,'verified-current-authorized');
    assert.ok(!seen.has(a.graphId));seen.add(a.graphId);const topology=profile.manifest.topology.find(g=>g.graphId===a.graphId);assert.ok(topology);
    assert.equal(a.room,topology.logicalRoom);assert.equal(a.roomUuid,topology.roomUuid);
    for(const row of profile.payloads.rows.filter(r=>r.logicalRoom===a.room&&r.variant===topology.variant))for(const member of row.members)assert.equal(member.identity.copyId,a.copyId);
  }
  assert.equal(localSeen.size,n.provisionalLocalRoutes.length,'native_unjoined_local_route');
  assert.equal(n.accountScopeSha256,digest({account,scopeIdentitySha256:n.scopeIdentitySha256,provisionalAuthorities:n.provisionalAuthorities,provisionalLocalRoutes:n.provisionalLocalRoutes}));return n;
}
export function nativeAuthorities(profile,ack){
  validateNativeDeclaration(profile);
  return profile.nativeProject.provisionalAuthorities.map(a=>({...json(a),members:profile.writePermits.filter(p=>p.kind==='episode'&&p.request.body.graph_id===a.graphId).map(p=>{
    const receipt=ack.episodes.find(e=>e.permitId===p.id&&e.graphId===a.graphId);assert.ok(receipt);const m=p.request.body.metadata;
    return {episodeId:receipt.uuid,opId:m.op_id,sourceId:m.source_id,version:m.version,part:m.part};
  })}));
}
export function resolvedAuthority(provisional,projectUuid){text(projectUuid);const a=json(provisional);equal(a.projectBinding,NATIVE_PENDING);delete a.projectBinding;return {...a,projectId:projectUuid};}

export function localRouteIdentity(input){const r=JSON.parse(canonical(input));delete r.head.checkedAt;return r;}
export function validateObservedLocalRoute(input,authority,profile){
  const r=json(input);fields(r,['schema','accountId','graphId','roomId','roomUuid','copyId','room','head','attachment','members']);
  assert.equal(r.schema,OBSERVED_LOCAL_ROUTE);
  for(const k of ['accountId','graphId','roomId','roomUuid','copyId'])text(r[k]);
  for(const k of ['accountId','graphId','roomUuid','copyId'])assert.equal(r[k],authority[k]);
  const topology=profile.manifest.topology.find(g=>g.graphId===r.graphId);assert.ok(topology);
  const members=profile.payloads.rows.filter(row=>row.logicalRoom===authority.room&&row.variant===topology.variant).flatMap(row=>row.members);
  assert.ok(members.length);for(const member of members){assert.equal(member.identity.roomId,r.roomId);assert.equal(member.identity.roomUuid,r.roomUuid);assert.equal(member.identity.copyId,r.copyId);}
  const room=r.room;fields(room,['id','uuid','name','remembers','originalInput','account','graphId','generationRevision','generationCheck'],['input']);
  assert.equal(room.id,r.roomId);assert.equal(room.uuid,r.roomUuid);text(room.name);assert.equal(room.remembers,true);assert.equal(typeof room.originalInput,'boolean');assert.equal(room.account,r.accountId);
  fields(r.head,['revision','route','checkedAt','reason','followPending']);text(r.head.revision);
  assert.ok(Number.isSafeInteger(r.head.checkedAt)&&r.head.checkedAt>=0);assert.equal(r.head.reason,null);assert.equal(r.head.followPending,false);
  const route=r.head.route;assert.ok(route);fields(route,['graphId','epoch','copy']);assert.equal(route.graphId,r.graphId);
  assert.equal(r.graphId,zepGraphId(r.roomUuid));assert.equal(route.epoch,0);assert.equal(route.copy,null);
  assert.equal(authority.generationId,'implicit-base:'+r.graphId);
  assert.equal(room.graphId,null);assert.equal(room.generationRevision,r.head.revision);assert.equal(room.generationCheck,false);
  const a=r.attachment;assert.ok(a);fields(a,['account','uuid','copy','revision','graphId','check']);
  assert.equal(a.account,r.accountId);assert.equal(a.uuid,r.roomUuid);assert.equal(a.copy,r.copyId);assert.equal(a.revision,r.head.revision);assert.equal(a.graphId,r.graphId);assert.equal(a.check,false);
  const provisional=profile.nativeProject.provisionalAuthorities.find(a=>a.graphId===r.graphId);assert.ok(provisional);
  const tuple=json(authority);delete tuple.members;equal(tuple,provisional);
  if(provisional.routeRevision===''){
    const local=profile.nativeProject.provisionalLocalRoutes.find(a=>a.graphId===r.graphId);assert.ok(local);validateProvisionalLocalRoute(local,provisional,profile);assert.equal(r.roomId,local.roomId);
  }else assert.equal(r.head.revision,provisional.routeRevision,'native_initialized_route_revision_changed');
  assert.ok(Array.isArray(r.members)&&r.members.length===members.length);
  for(const m of r.members){fields(m,['episodeId','opId','sourceId','version','part']);for(const value of Object.values(m))text(value);}
  equal(r.members,authority.members);assert.equal(new Set(r.members.map(m=>m.opId)).size,r.members.length);assert.equal(new Set(r.members.map(m=>m.episodeId)).size,r.members.length);
  return r;
}
export function resolvedObservedAuthority(provisional,observation){
  assert.equal(observation.schema,NATIVE_OBSERVATION);assert.equal(observation.graphId,provisional.graphId);
  const a=resolvedAuthority(provisional,observation.projectUuid);text(observation.localRoute.head.revision);a.routeRevision=observation.localRoute.head.revision;return a;
}

export function joinNativeGraphCapture({summary,handle,attemptNumber,graphId,raw,capture,accountScopeSha256,endpoint,localRoute,authority,profile}){
  assert.ok(summary.state.run.claim&&summary.state.run.stopped===null);assert.ok(handle&&handle.kind==='read');
  const a=summary.state.attempts.find(a=>a.id===handle.id&&a.permit===handle.permit);assert.ok(a&&a.outcome==='received'&&a.status>=200&&a.status<300);
  const p=summary.state.permits.find(p=>p.id===handle.permit);assert.ok(p&&p.kind==='read'&&p.consumed===1);
  const request=JSON.parse(p.request),expected={method:'GET',url:endpoint.replace(/\/$/,'')+'/graph/'+encodeURIComponent(graphId),body:null,maxRetries:0};equal(request,expected);
  const received=JSON.parse(a.capture);assert.equal(received.known,true);assert.equal(received.truncated,false);assert.equal(received.raw,raw);assert.equal(received.observedBytes,Buffer.byteLength(raw));assert.equal(a.response_bytes,Buffer.byteLength(raw));
  const body=JSON.parse(raw);verifySdkWireBody(body,{method:'GET',pathname:'/graph/'+encodeURIComponent(graphId)});
  const typed=Graph.parseOrThrow(body,{unrecognizedObjectKeys:'passthrough',allowUnrecognizedUnionMembers:true,allowUnrecognizedEnumValues:true,skipValidation:true,breadcrumbsPrefix:['response']});
  const projected=captureSdkGraph(typed,graphId);equal(projected,capture);
  const observed=validateObservedLocalRoute(localRoute,authority,profile);assert.equal(observed.graphId,graphId);
  const remoteRoute=parseGenerationPointer(observed.roomUuid,projected.row.description??null);equal(remoteRoute,observed.head.route);
  return {schema:NATIVE_OBSERVATION,claimId:summary.state.run.claim,accountScopeSha256,endpoint,graphId,
    budgetAttemptNumber:attemptNumber,durableAttemptId:a.id,permitId:p.id,requestSha256:digest(request),rawResponseSha256:sha256(raw),
    sdkCaptureSha256:digest(projected),sdkLayoutSha256:digest(projected.layout),projectUuid:projected.row.projectUuid,
    remoteRoute:json(remoteRoute),localRoute:observed,localRouteIdentitySha256:digest(localRouteIdentity(observed))};
}
