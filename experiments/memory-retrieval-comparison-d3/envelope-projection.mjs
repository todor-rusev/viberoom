// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import { sameEventInstant } from '../memory-deletion-refresh-b18d/core.mjs';
import { fields, text, canonical, sha256, json } from './contracts.mjs';
import { captureDeclaredObject, captureDeclaredArray, verifyUnknownNativeFields } from './native-projection.mjs';
import { captureSdkEntity } from './entity-projection.mjs';
import { captureSdkEpisode, validateEpisodeProjection, EPISODE_KEYS } from './episode-projection.mjs';

export const ENVELOPE_PROJECTION_PROFILE = Object.freeze({ schema: 'zep-3.28.0-graph-search-envelope-passthrough-evidence-v2',
  undefined: 'explicit-declared-optionals-with-layout-record', graphAuthority: 'required-exact-graphId-projectUuid',
  passthrough: 'json-safe-extra-fields-evidence-only-exact-names-values-hash',
  declaredWireAliases: 'exact-primary-serializer-alias-collision-or-malformed-fallback-refuses',
  searchCollections: 'optional-capture-not-certified-absence', modelContext: 'supplied-raw-collection-required-no-absence-certificate',
  nestedCollections: 'closed-declared-episode-derived-thread-optionals-with-layout-no-new-authority',
  responseMetadata: 'optional-finite-nonnegative-latency-not-cost', reservedLocalFields: 'native-collision-refuses' });
const graphKeys = ['createdAt','description','graphId','id','name','projectUuid','timeZone','updatedAt','uuid'];
const graphOptional = graphKeys.filter(k => !['graphId','projectUuid'].includes(k));
const searchKeys = ['context','edges','episodes','nodes','observations','response','threadSummaries'];
const graphAliases = ['created_at','graph_id','project_uuid','time_zone','updated_at'];
const searchAliases = ['thread_summaries'];
const metadataAliases = ['server_latency_ms'];
const reserved = ['sdkEntityLayouts','sdkEnvelopeLayout','sdkGraphLayout'];
const qualification = 'Optional/passthrough evidence only, not certified absence/currentness/paid fallback';
const precise = value => assert.ok(sameEventInstant(value,value), 'Invalid precise native time');
const hashProjection = captured => sha256(canonical(captured));
const declaredRow = (row,keys) => Object.fromEntries(Object.entries(row).filter(([k]) => keys.includes(k)));
const extraNames = (row,keys) => Object.keys(row).filter(k => !keys.includes(k)).sort();
const evidenceCapture = (input,keys,optionalUndefined,convert,aliases=[]) => captureDeclaredObject(input,
  {keys,optionalUndefined,convert,passthroughEvidence:true,reserved:[...reserved,...aliases]});
function verifyUndefinedLayout(row,names,allowed) {
  assert.ok(Array.isArray(names)); assert.deepEqual(names,[...new Set(names)].sort());
  for(const key of names)assert.ok(allowed.includes(key) && !Object.hasOwn(row,key),'Conflicting/undeclared undefined layout');
}
function verifyProjection(row,layout,keys,optionalUndefined,aliases=[]) {
  verifyUndefinedLayout(row,layout.undefinedOptionalFields,optionalUndefined);
  assert.deepEqual(layout.passthroughFields,extraNames(row,keys));
  assert.ok(layout.passthroughFields.every(k=>![...reserved,...aliases].includes(k)));
  assert.equal(layout.sha256,hashProjection({row,undefinedOptionalFields:layout.undefinedOptionalFields,passthroughFields:layout.passthroughFields}));
}
export function validateGraph(row) {
  fields(row,['graphId','projectUuid'],graphOptional); text(row.graphId);text(row.projectUuid);
  for(const key of graphKeys.filter(k=>k!=='id'))if(Object.hasOwn(row,key))assert.equal(typeof row[key],'string');
  for(const key of ['createdAt','updatedAt'])if(Object.hasOwn(row,key))precise(row[key]);
  if(Object.hasOwn(row,'id'))assert.ok(typeof row.id==='number' && Number.isFinite(row.id));
  return row;
}
export function captureSdkGraph(input,graphId) {
  text(graphId);const captured=evidenceCapture(input,graphKeys,graphOptional,undefined,graphAliases);
  validateGraph(declaredRow(captured.row,graphKeys));assert.equal(captured.row.graphId,graphId,'Graph request scope differs');
  return {row:captured.row,layout:{endpoint:'graph-get',requestGraphId:graphId,
    undefinedOptionalFields:captured.undefinedOptionalFields,passthroughFields:captured.passthroughFields,sha256:hashProjection(captured)}};
}
export function verifyGraphLayout(row,graphId,layout) {
  row=json(row);validateGraph(layout?declaredRow(row,graphKeys):row);assert.equal(row.graphId,graphId);
  if(!layout)return;
  fields(layout,['endpoint','requestGraphId','undefinedOptionalFields','passthroughFields','sha256']);
  assert.equal(layout.endpoint,'graph-get');assert.equal(layout.requestGraphId,graphId);
  verifyProjection(row,layout,graphKeys,graphOptional,graphAliases);
}
function validateResponseMetadata(row) {
  fields(row,[],['serverLatencyMs']);
  if(Object.hasOwn(row,'serverLatencyMs'))assert.ok(typeof row.serverLatencyMs==='number' && Number.isFinite(row.serverLatencyMs) && row.serverLatencyMs>=0);
}
const dtoRequired=['uuid','name','createdAt'];
const dtoKeys={
  observations:['attributes','createdAt','endAt','episodeIds','labels','latestEvidenceAt','name','relevance','score','selectionRank','startAt','summary','uuid'],
  threadSummaries:['createdAt','labels','lastSummarizedAt','lastSummarizedEpisodeValidAt','name','relevance','score','selectionRank','summary','uuid']};
function validateDiagnosticDto(row,kind) {
  const keys=dtoKeys[kind];fields(row,dtoRequired,keys.filter(k=>!dtoRequired.includes(k)));
  for(const k of dtoRequired)text(row[k]);precise(row.createdAt);
  for(const k of ['endAt','latestEvidenceAt','startAt','lastSummarizedAt','lastSummarizedEpisodeValidAt'])if(Object.hasOwn(row,k))precise(row[k]);
  if(Object.hasOwn(row,'summary'))assert.equal(typeof row.summary,'string');
  for(const k of ['score','relevance'])if(Object.hasOwn(row,k))assert.ok(typeof row[k]==='number' && Number.isFinite(row[k]));
  if(Object.hasOwn(row,'selectionRank'))assert.ok(Number.isSafeInteger(row.selectionRank) && row.selectionRank>=0);
  for(const k of ['labels','episodeIds'])if(Object.hasOwn(row,k)){assert.ok(Array.isArray(row[k]));for(const v of row[k])text(v);}
  if(Object.hasOwn(row,'attributes'))assert.ok(row.attributes && typeof row.attributes==='object' && !Array.isArray(row.attributes));
}
function captureNested(input,kind) {
  const captured=kind==='episodes'?captureSdkEpisode(input):captureDeclaredObject(input,
    {keys:dtoKeys[kind],optionalUndefined:dtoKeys[kind].filter(k=>!dtoRequired.includes(k)),setAsideUnknown:true});
  if(kind==='episodes')validateEpisodeProjection(captured.row,'auto');else validateDiagnosticDto(captured.row,kind);
  return {row:captured.row,layout:{endpoint:'search',kind,uuid:captured.row.uuid,undefinedOptionalFields:captured.undefinedOptionalFields,
    ...(captured.unknownNativeFields?{unknownNativeFields:captured.unknownNativeFields}:{}),sha256:hashProjection(captured)}};
}
export function captureSdkSearch(input,graphId) {
  text(graphId);const entityLayouts={edges:[],nodes:[]},collectionLayouts={episodes:[],observations:[],threadSummaries:[]};let responseLayout=null;
  const captured=evidenceCapture(input,searchKeys,searchKeys,(key,value)=>{
    if(key==='edges'||key==='nodes')return captureDeclaredArray(value,input=>{
      const c=captureSdkEntity(input,key==='edges'?'edge':'node',{graphId,endpoint:'search'});entityLayouts[key].push(c.layout);return c.row;});
    if(Object.hasOwn(collectionLayouts,key))return captureDeclaredArray(value,input=>{
      const c=captureNested(input,key);collectionLayouts[key].push(c.layout);return c.row;});
    if(key==='context'){assert.equal(typeof value,'string');return value;}
    const c=evidenceCapture(value,['serverLatencyMs'],['serverLatencyMs'],undefined,metadataAliases);validateResponseMetadata(declaredRow(c.row,['serverLatencyMs']));
    responseLayout={undefinedOptionalFields:c.undefinedOptionalFields,passthroughFields:c.passthroughFields,sha256:hashProjection(c)};return c.row;
  },searchAliases);
  return {...captured.row,sdkEntityLayouts:entityLayouts,sdkEnvelopeLayout:{endpoint:'search',requestGraphId:graphId,
    undefinedOptionalFields:captured.undefinedOptionalFields,passthroughFields:captured.passthroughFields,sha256:hashProjection(captured),responseLayout,collectionLayouts,qualification}};
}
export function verifySearchEnvelope(response,graphId) {
  response=json(response);const layout=response.sdkEnvelopeLayout;
  if(!layout)fields(response,[],[...searchKeys,'sdkEntityLayouts']);
  if(Object.hasOwn(response,'context'))assert.equal(typeof response.context,'string');
  for(const key of ['edges','episodes','nodes','observations','threadSummaries'])if(Object.hasOwn(response,key))assert.ok(Array.isArray(response[key]));
  if(Object.hasOwn(response,'response'))validateResponseMetadata(layout?declaredRow(response.response,['serverLatencyMs']):response.response);
  if(!layout)return;
  fields(layout,['endpoint','requestGraphId','undefinedOptionalFields','passthroughFields','sha256','responseLayout','collectionLayouts','qualification']);
  assert.equal(layout.endpoint,'search');assert.equal(layout.requestGraphId,graphId);assert.equal(layout.qualification,qualification);
  const row=Object.fromEntries(Object.entries(response).filter(([key])=>!['sdkEntityLayouts','sdkEnvelopeLayout'].includes(key)));
  verifyProjection(row,layout,searchKeys,searchKeys,searchAliases);
  if(Object.hasOwn(row,'response')){assert.ok(layout.responseLayout);fields(layout.responseLayout,['undefinedOptionalFields','passthroughFields','sha256']);
    verifyProjection(row.response,layout.responseLayout,['serverLatencyMs'],['serverLatencyMs'],metadataAliases);}else assert.equal(layout.responseLayout,null);
  fields(layout.collectionLayouts,['episodes','observations','threadSummaries']);
  for(const kind of ['episodes','observations','threadSummaries']){
    const rows=row[kind]??[],layouts=layout.collectionLayouts[kind];assert.ok(Array.isArray(layouts));assert.equal(layouts.length,rows.length);
    for(let i=0;i<rows.length;i++){
      const l=layouts[i];fields(l,['endpoint','kind','uuid','undefinedOptionalFields','sha256'],['unknownNativeFields']);
      verifyUnknownNativeFields(l,kind==='episodes'?EPISODE_KEYS:dtoKeys[kind]);
      assert.equal(l.endpoint,'search');assert.equal(l.kind,kind);assert.equal(l.uuid,rows[i].uuid);captureNested(rows[i],kind);
      const allowed=kind==='episodes'?['role','roleType','source','sourceDescription','taskId','threadId','score','relevance','selectionRank']:dtoKeys[kind].filter(k=>!dtoRequired.includes(k));
      verifyUndefinedLayout(rows[i],l.undefinedOptionalFields,allowed);
      assert.equal(l.sha256,hashProjection({row:rows[i],undefinedOptionalFields:l.undefinedOptionalFields,...(l.unknownNativeFields?{unknownNativeFields:l.unknownNativeFields}:{})}));
    }
  }
}
