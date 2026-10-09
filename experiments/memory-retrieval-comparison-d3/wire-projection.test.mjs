// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SDK_WIRE_FIELDS,verifySdkWireBody,WIRE_PROJECTION_PROFILE} from './wire-projection.mjs';
import {createSdkReadPort,boundedHttp} from './ports.mjs';
import {RunBudget} from './contracts.mjs';
import {DEFAULT_LIMITS} from './prepare.mjs';
import {verifySearchEnvelope} from './envelope-projection.mjs';
import {formatContext} from './lineage.mjs';
import {evidenceFolder} from '../memory-retrieval-trial-d5/test-folders.mjs';
const d3Evidence=evidenceFolder('D3_EVIDENCE_DIR');
const require=createRequire(import.meta.url),{ZepClient}=require('@getzep/zep-cloud');
const sdkRoot=require.resolve('@getzep/zep-cloud').replace(/dist[\\/]cjs[\\/]index\.js$/,'');
const serializers=Object.fromEntries(Object.keys(SDK_WIRE_FIELDS).map(name=>[name,require(join(sdkRoot,'dist/cjs/serialization/types',name+'.js'))[name]]));
const at='2026-10-03T00:00:00Z',graph={graph_id:'g',project_uuid:'p'};
const episode={uuid:'ep',content:'Synthetic original',created_at:at,metadata:{},processed:true,source:'message'};
const edge={uuid:'e',created_at:at,fact:'Synthetic fact.',name:'USES',source_node_uuid:'a',target_node_uuid:'b',episodes:['ep']};
const node={uuid:'a',created_at:at,name:'Synthetic node',summary:'Unverified summary'};
const derived={uuid:'d',created_at:at,name:'Synthetic observation',summary:'Unverified observation'};
const thread={uuid:'t',created_at:at,name:'Synthetic thread',summary:'Unverified thread'};
const wireRows={Graph:graph,GraphSearchResults:{},GraphSearchResponseMetadata:{},Episode:episode,EntityEdge:edge,EntityNode:node,DerivedNode:derived,GraphitiSagaNode:thread};
const route={Graph:['GET','/graph/g'],GraphSearchResults:['POST','/graph/search'],GraphSearchResponseMetadata:['POST','/graph/search'],Episode:['GET','/graph/episodes/ep'],EntityEdge:['POST','/graph/edge/graph/g'],EntityNode:['POST','/graph/node/graph/g'],DerivedNode:['POST','/graph/search'],GraphitiSagaNode:['POST','/graph/search']};
const wrap=(name,row)=>name==='GraphSearchResponseMetadata'?{response:row}:name==='DerivedNode'?{observations:[row]}:name==='GraphitiSagaNode'?{thread_summaries:[row]}:name==='EntityEdge'||name==='EntityNode'?[row]:row;
let sequence=0;
async function probe(overrides={},mode='observe'){
  const calls=[],server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    const call={method:req.method,path:pathname,body:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null};calls.push(call);
    const normal={'/graph/g':graph,'/graph/episodes/graph/g':[],'/graph/edge/graph/g':[],'/graph/node/graph/g':[],'/graph/episodes/ep':episode,'/graph/search':{edges:[edge]}};
    const body=Object.hasOwn(overrides,pathname)?overrides[pathname]:normal[pathname];res.setHeader('content-type','application/json');
    if(body===undefined){res.statusCode=404;res.end('{"error":"owned route refused"}');}else res.end(JSON.stringify(body));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const budget=new RunBudget(DEFAULT_LIMITS);let returned=null,error=null,currentCalls=0;
  try{const port=createSdkReadPort({ZepClient,baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic-only',purpose:'local-fixture',budget,current:()=>{currentCalls++;return true;}});
    try{returned=mode==='search'?await port.search('g','Synthetic question','auto-raw'):await port.observe('g');}catch(e){error={name:e.name,message:e.message};}
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  assert.equal(budget.models,0);const evidence={syntheticPrimarySDKDerived:true,noNativeLayoutClaim:true,calls,overrides,returned,error,currentCalls,attempts:budget.attempts,summary:budget.summary()};
  if(d3Evidence)await writeFile(join(d3Evidence,`wire-fixture-${++sequence}.json`),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  return evidence;
}
const aliases=(raw,parsed,base)=>[
  {...base,[raw]:at,[parsed]:'foreign'},
  Object.assign({[parsed]:'foreign'},base,{[raw]:at}),
  Object.fromEntries([...Object.entries(base).filter(([key])=>key!==raw),[parsed,'foreign']])];
function refused(e,pattern,count){assert.ok(e.error);assert.match(e.error.message,pattern);assert.equal(e.returned,null);assert.equal(e.calls.length,count);assert.equal(e.summary.stopped,true);assert.equal(e.summary.modelCalls,0);assert.ok(e.attempts.at(-1).response);}

test('central wire/parsed inventory exactly matches eight installed primary SDK serializers',()=>{
  for(const [name,fields] of Object.entries(SDK_WIRE_FIELDS)){
    assert.deepEqual(fields.map(f=>f.wire),serializers[name]._getRawProperties());
    assert.deepEqual(fields.map(f=>f.parsed),serializers[name]._getParsedProperties());
    assert.ok(Object.isFrozen(fields)&&fields.every(Object.isFrozen));
  }
  assert.equal(WIRE_PROJECTION_PROFILE.fields,SDK_WIRE_FIELDS);
});
test('raw descriptor boundary rejects getters proxies hidden sparse symbol and undefined before access',()=>{
  let getterCalls=0;const getter={...graph};Object.defineProperty(getter,'graph_id',{enumerable:true,get(){getterCalls++;return 'g';}});
  const opts={method:'GET',pathname:'/graph/g'};
  assert.throws(()=>verifySdkWireBody(getter,opts),/Accessor/);assert.equal(getterCalls,0);
  assert.throws(()=>verifySdkWireBody(new Proxy(graph,{}),opts),/proxy/);
  const hidden={...graph};Object.defineProperty(hidden,'extra',{value:1});assert.throws(()=>verifySdkWireBody(hidden,opts),/Accessor/);
  assert.throws(()=>verifySdkWireBody({...graph,[Symbol('x')]:1},opts));assert.throws(()=>verifySdkWireBody({...graph,extra:undefined},opts));
  const sparse=Array(1);assert.throws(()=>verifySdkWireBody({edges:sparse},{method:'POST',pathname:'/graph/search'}));
  const array=[];Object.defineProperty(array,'0',{enumerable:true,get(){getterCalls++;return edge;}});
  assert.throws(()=>verifySdkWireBody({edges:array},{method:'POST',pathname:'/graph/search'}),/Accessor/);assert.equal(getterCalls,0);
});
test('all exact declared aliases refuse missing counterparts and both JSON insertion orders',()=>{
  for(const [name,fields] of Object.entries(SDK_WIRE_FIELDS))for(const f of fields.filter(f=>f.wire!==f.parsed)){
    const base=wireRows[name],value=f.type==='number'?1:f.type.endsWith('[]')?[]:'synthetic';
    for(const row of [{...base,[f.wire]:value,[f.parsed]:value},Object.assign({[f.parsed]:value},base,{[f.wire]:value}),Object.fromEntries([...Object.entries(base).filter(([key])=>key!==f.wire),[f.parsed,value]])]){
      const [method,pathname]=route[name];assert.throws(()=>verifySdkWireBody(wrap(name,row),{method,pathname}),/parsed_alias/);
    }
  }
});
test('actualSDK Graph identity collision reversals and missing raw key refuse before inventory',async()=>{
  const rows=[{graph_id:'foreign-native-graph',graphId:'g',project_uuid:'p'},{graphId:'g',graph_id:'foreign-native-graph',project_uuid:'p'},{graphId:'g',project_uuid:'p'}];
  for(const row of rows){const e=await probe({'/graph/g':row});refused(e,/native_wire_Graph_parsed_alias_graphId/,1);assert.deepEqual(JSON.parse(e.attempts[0].response),row);}
});
test('actualSDK legitimate Graph optional null and unknown canonical evidence survives without rewrite',async()=>{
  const row={...graph,canonical_graph_uuid:'different-native-uuid',created_at:null,description:null,id:null,name:null,time_zone:null,updated_at:null,opaque:{values:[null,'Ω',false]}};
  const e=await probe({'/graph/g':row});assert.equal(e.error,null);assert.equal(e.calls.length,4);
  assert.equal(e.returned.graph.canonical_graph_uuid,row.canonical_graph_uuid);assert.deepEqual(e.returned.graph.opaque,row.opaque);
  assert.deepEqual(e.returned.sdkGraphLayout.passthroughFields,['canonical_graph_uuid','opaque']);assert.deepEqual(JSON.parse(e.attempts[0].response),row);
  assert.equal(e.attempts[0].nativeWireProjection.schema,WIRE_PROJECTION_PROFILE.schema);
});
test('actualSDK response metadata aliases refuse both orders and lone parsed optional alias',async()=>{
  for(const row of [{server_latency_ms:42,serverLatencyMs:1},{serverLatencyMs:1,server_latency_ms:42},{serverLatencyMs:1}]){
    const e=await probe({'/graph/search':{edges:[edge],response:row}},'search');refused(e,/GraphSearchResponseMetadata_parsed_alias_serverLatencyMs/,1);
  }
});
test('actualSDK search collection alias refuses both orders and lone parsed key',async()=>{
  for(const row of [{thread_summaries:[],threadSummaries:[]},{threadSummaries:[],thread_summaries:[]},{threadSummaries:[]}]){
    const e=await probe({'/graph/search':{edges:[edge],...row}},'search');refused(e,/GraphSearchResults_parsed_alias_threadSummaries/,1);
  }
});
test('actualSDK nested Episode Entity Derived and Thread aliases refuse in both orders or missing wire',async()=>{
  for(const [key,base,name] of [['episodes',episode,'Episode'],['edges',edge,'EntityEdge'],['nodes',node,'EntityNode'],['observations',derived,'DerivedNode'],['thread_summaries',thread,'GraphitiSagaNode']]){
    for(const row of aliases('created_at','createdAt',base)){
      const e=await probe({'/graph/search':{[key]:[row]}},'search');refused(e,new RegExp(name+'_parsed_alias_createdAt'),1);
    }
  }
});
test('actualSDK all three native LIST routes share the pre-SDK array row alias guard',async()=>{
  for(const [pathname,row,name,count] of [['/graph/episodes/graph/g',episode,'Episode',2],['/graph/edge/graph/g',edge,'EntityEdge',3],['/graph/node/graph/g',node,'EntityNode',4]]){
    const e=await probe({[pathname]:[{...row,createdAt:'foreign'}]});refused(e,new RegExp(name+'_parsed_alias_createdAt'),count);
  }
});
test('actualSDK direct Episode GET is guarded after legitimate LIST before local capture',async()=>{
  const e=await probe({'/graph/episodes/graph/g':[episode],'/graph/episodes/ep':{...episode,source_description:'wire',sourceDescription:'parsed'}});
  refused(e,/Episode_parsed_alias_sourceDescription/,5);assert.equal(e.calls.at(-1).path,'/graph/episodes/ep');
});
test('actualSDK malformed known wire fields refuse rather than become unknown fallback evidence',async()=>{
  for(const [overrides,mode,pattern] of [[{'/graph/g':{...graph,created_at:{bad:true}}},'observe',/Graph_created_at_string/],
    [{'/graph/search':{response:{server_latency_ms:'wrong'}}},'search',/GraphSearchResponseMetadata_server_latency_ms_number/],
    [{'/graph/search':{episodes:[{...episode,role_type:{bad:true}}]}},'search',/Episode_role_type_string/],
    [{'/graph/search':{thread_summaries:{bad:true}}},'search',/GraphSearchResults_thread_summaries_array/]]){
    const e=await probe(overrides,mode);refused(e,pattern,1);
  }
});
test('actualSDK legitimate nested optional null capture remains held diagnostic without lineage authority',async()=>{
  const wire={episodes:[{...episode,score:null,role:null,role_type:null,thread_id:null}],observations:[{...derived,labels:null,episode_ids:null,score:null,end_at:null}],
    thread_summaries:[{...thread,labels:null,score:null,last_summarized_at:null}],response:{server_latency_ms:null,opaque:null},opaque_evidence:{text:'UNVERIFIED_OPAQUE',sourceProof:true}};
  const e=await probe({'/graph/search':wire},'search');assert.equal(e.error,null);assert.equal(e.calls.length,1);verifySearchEnvelope(e.returned,'g');
  assert.deepEqual(e.returned.sdkEnvelopeLayout.collectionLayouts.episodes[0].undefinedOptionalFields,['role','roleType','score','threadId']);
  assert.deepEqual(e.returned.sdkEnvelopeLayout.collectionLayouts.observations[0].undefinedOptionalFields,['endAt','episodeIds','labels','score']);
  assert.deepEqual(e.returned.sdkEnvelopeLayout.collectionLayouts.threadSummaries[0].undefinedOptionalFields,['labels','lastSummarizedAt','score']);
  assert.deepEqual(e.returned.opaque_evidence,wire.opaque_evidence);assert.deepEqual(JSON.parse(e.attempts[0].response),wire);
  assert.throws(()=>formatContext(e.returned,{authority:{graphId:'g'}},'auto-raw',{maxNodes:2,snapshotAt:at}),/thread_summary_missing_native_episode_lineage/);
});
test('actualSDK reserved local-layout names refuse at raw DTO scope before SDK projection',async()=>{
  for(const key of ['sdkGraphLayout','sdkEntityLayouts','sdkEnvelopeLayout'])for(const mode of ['observe','search']){
    const pathname=mode==='observe'?'/graph/g':'/graph/search',row=mode==='observe'?graph:{edges:[edge]};const e=await probe({[pathname]:{...row,[key]:null}},mode);refused(e,/native_wire_.*_reserved_/,1);
  }
});
test('unknown native fields of Edge, Node and Episode are set aside as layout evidence through the installed SDK',async()=>{
  for(const [key,row,layouts] of [['edges',{...edge,episode_reference_time:at},r=>r.sdkEntityLayouts.edges],['nodes',node,r=>r.sdkEntityLayouts.nodes],
    ['episodes',episode,r=>r.sdkEnvelopeLayout.collectionLayouts.episodes]]){
    const extra=key==='edges'?{episode_reference_time:at,unknown_native:'evidence'}:{unknown_native:'evidence'};
    const e=await probe({'/graph/search':{[key]:[{...row,unknown_native:'evidence'}]}},'search');
    assert.equal(e.error,null);assert.equal(e.calls.length,1);assert.equal(e.attempts[0].status,'received');
    for(const name of Object.keys(extra))assert.ok(!Object.hasOwn(e.returned[key][0],name));
    assert.deepEqual(layouts(e.returned)[0].unknownNativeFields,extra);
    verifySearchEnvelope(e.returned,'g');
  }
});

test('boundedHttp checks the transport boundary exactly once before the fetch, once after it and once after each read',async()=>{
  for(const parts of [0,1,3]){
    const events=[],budget=new RunBudget(DEFAULT_LIMITS),request={method:'GET',url:'http://127.0.0.1:1/v2/graph/g',body:null,maxRetries:0};
    const attempt=budget.take('read',request),text=Array.from({length:parts},(_,i)=>String(i));
    let section=null;
    const guard=()=>{events.push('guard');const s={};section=s;queueMicrotask(()=>{if(section===s)section=null;});};
    const fetchImpl=async()=>{
      events.push(section?'fetch':'fetch after an await');
      return new Response(new ReadableStream({start(c){for(const t of text)c.enqueue(new TextEncoder().encode(t));c.close();}}),{status:200});
    };
    const r=await boundedHttp({url:request.url,method:'GET',body:null,headers:{},budget,attempt,fetchImpl,guard});
    assert.equal(r.raw,text.join(''));
    assert.deepEqual(events.slice(0,2),['guard','fetch'],'the guard is the last thing before the fetch');
    assert.equal(events.filter(e=>e==='guard').length,parts+3,`${parts} parts`);
  }
});
