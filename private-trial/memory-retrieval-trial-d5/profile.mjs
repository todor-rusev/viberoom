// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert,{readPinned,Held} from '../trial-journal/policy-assert.mjs';
import invariant from 'node:assert/strict';
import {NATIVE_PROFILE,NATIVE_ENTRY,NATIVE_FINAL,NATIVE_OBSERVATION,NATIVE_BINDING_SET,nativeProfile,validateNativeDeclaration,nativeAuthorities,resolvedObservedAuthority,validateObservedLocalRoute,localRouteIdentity,joinNativeGraphCapture,digest as nativeDigest} from './native-project.mjs';
import {verifySnapshot} from '../memory-retrieval-comparison-d3/lineage.mjs';
import {loopbackHost} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {readFileSync,statSync} from 'node:fs';
import {ZepClient} from '@getzep/zep-cloud';
import {AddDataRequest} from '../../node_modules/@getzep/zep-cloud/dist/esm/serialization/resources/graph/client/requests/AddDataRequest.mjs';
import {WORK_ONTOLOGY} from '../../dist/memory/zep.js';
import {RunJournal,episodeListingEvidence} from '../trial-journal/journal.mjs';
import {data,fields,text,int,digest,canonical,hash,frozen} from '../trial-journal/data.mjs';

export const LONG_CORPUS='8c9a6fcf6b6130addbea20cde5708201322577ad0a473d81de01e03d641e60b2';
const modes=['edges-cross-encoder','edges-plus-selected-node-summaries','auto-raw'];
function endpoint(value,purpose){const u=new URL(text(value));assert.ok(!u.username && !u.password && !u.search && !u.hash);
  assert.ok(u.protocol==='http:'&&loopbackHost(u.hostname)||u.protocol==='https:'&&purpose!=='local-fixture');return u.href;}
function request(input){const r=data(input);fields(r,['method','url','body','maxRetries']);assert.equal(r.maxRetries,0);assert.ok(['GET','POST','PUT'].includes(r.method));const u=new URL(r.url);assert.ok(!u.username && !u.password && !u.hash);return r;}
const encoded=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const episodeWire=r=>data(AddDataRequest.jsonOrThrow(r,{unrecognizedObjectKeys:'strip',omitUndefined:true}));
let ontologyTemplate;
const serializer=new ZepClient({apiKey:'serialization-only',fetcher:async args=>{ontologyTemplate=data(JSON.parse(JSON.stringify(args.body)));return {ok:true,body:{message:'ok'}};}});
await serializer.graph.setOntology(WORK_ONTOLOGY,{}, {graphIds:['serialization-only']},{maxRetries:0});
const ontologyWire=graphId=>({...ontologyTemplate,graph_ids:[graphId]});
export function prepareWritePermits(payloads,readBase){
  const url=path=>readBase.replace(/\/$/,'')+path,permits=[];
  for(const [i,g] of payloads.physicalAddresses.entries()){
    permits.push({id:`graph:${i+1}`,kind:'graph',request:{method:'POST',url:url('/graph/create'),body:{graph_id:g.plannedGraphId,name:g.room.name,description:`viberoom room "${g.room.name}"`},maxRetries:0},estimate:0});
    permits.push({id:`ontology:${i+1}`,kind:'ontology',request:{method:'PUT',url:url('/entity-types'),body:ontologyWire(g.plannedGraphId),maxRetries:0},estimate:0});
  }
  for(const [i,m] of payloads.rows.flatMap(row=>row.members).entries()){const body=episodeWire(m.payload.request);permits.push({id:`episode:${i+1}`,kind:'episode',request:{method:'POST',url:url('/graph'),body,maxRetries:0},estimate:Math.max(1,Math.ceil(Buffer.byteLength(body.data)/350))});}
  return permits;
}
function validateProfile(input){
  const p=data(input);fields(p,['schema','purpose','manifest','questions','payloads','writePermits','origins','review','codePins',...(nativeProfile(p)?['nativeProject']:[])]);
  assert.ok(['viberoom-retrieval-long-trial-profile-v1',NATIVE_PROFILE].includes(p.schema));assert.ok(['local-fixture','approved-paid-trial'].includes(p.purpose));
  const m=p.manifest;assert.equal(m.schema,'viberoom-retrieval-connected-preparation-v2');assert.equal(m.paidExecutionAllowed,false);assert.equal(m.actualD,'NOT_RUN');text(m.runId);
  assert.equal(m.corpusSha256,LONG_CORPUS);assert.equal(m.contextMaxUtf8BytesIncludingProvenance,4096);
  assert.equal(p.questions.corpusSha256,LONG_CORPUS);assert.equal(p.payloads.corpusSha256,LONG_CORPUS);
  assert.equal(m.inputs.questionsSha256,hash(encoded(p.questions)));assert.equal(m.inputs.payloadsSha256,hash(encoded(p.payloads)));
  const variants=p.payloads.variants.map(v=>text(v.name));assert.ok(variants.length>=1&&new Set(variants).size===variants.length);
  const graphs=p.payloads.physicalAddresses.length,plannedEpisodes=p.payloads.rows.flatMap(row=>row.members).map(member=>episodeWire(member.payload.request)),episodes=plannedEpisodes.length;
  assert.ok(p.questions.queries.length>=1&&graphs>=1&&episodes>=1);assert.equal(m.jobs.length,p.questions.queries.length*variants.length*modes.length);assert.equal(m.topology.length,graphs);
  assert.equal(m.ingestion.plannedEpisodePosts,episodes);int(m.ingestion.localEstimatedCredits,1);assert.equal(m.ingestion.fullInvoiceUpperBound,null);
  const questionIds=new Set();for(const q of p.questions.queries){text(q.id);text(q.query);assert.ok(!questionIds.has(q.id));questionIds.add(q.id);}
  const graphIds=new Set();for(const g of m.topology){text(g.graphId);assert.ok(!graphIds.has(g.graphId));graphIds.add(g.graphId);assert.ok(variants.includes(g.variant));}
  const jobKeys=new Set();for(const [i,j] of m.jobs.entries()){
    assert.equal(j.order,i+1);const q=p.questions.queries.find(q=>q.id===j.questionId);assert.ok(q && q.room===j.room && q.query===j.query);
    assert.ok(variants.includes(j.variant) && modes.includes(j.mode));assert.ok(m.topology.some(g=>g.graphId===j.graphId && g.logicalRoom===j.room && g.variant===j.variant));
    const key=[j.questionId,j.variant,j.mode].join('|');assert.ok(!jobKeys.has(key));jobKeys.add(key);
  }
  fields(p.origins,['readBase','answerEndpoint']);p.origins.readBase=endpoint(p.origins.readBase,p.purpose);p.origins.answerEndpoint=endpoint(p.origins.answerEndpoint,p.purpose);
  fields(p.review,['d3Accepted','d3ProofSha256','serviceEmissionProofSha256','acceptedCETree']);assert.equal(typeof p.review.d3Accepted,'boolean');
  assert.ok(p.review.d3ProofSha256===null || /^[a-f0-9]{64}$/.test(p.review.d3ProofSha256));digest(p.review.serviceEmissionProofSha256);assert.match(p.review.acceptedCETree,/^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(p.codePins) && p.codePins.length);for(const pin of p.codePins){fields(pin,['path','sha256']);text(pin.path);digest(pin.sha256);}
  const l=m.limits;fields(l,['maxReads','maxModelCalls','maxPagesPerCollection','pageSize','maxResponseBytes','maxAggregateBytes','requestMs','runMs','maxNodes','edgeLimit','autoMaxCharacters']);for(const v of Object.values(l))int(v,1);
  assert.equal(l.maxModelCalls,m.jobs.length);assert.ok(l.pageSize<=50 && l.edgeLimit<=50 && l.maxNodes<=50);
  const controls=m.answerControls;fields(controls,['model','cacheState','requestProfile']);text(controls.model);assert.ok(['cold','warm','unknown'].includes(controls.cacheState));
  const a=controls.requestProfile;fields(a,['schema','reasoningEffort','temperature','maxCompletionTokens','choices','serviceTier','store','maxInputTextUtf8Bytes','maxRequestUtf8Bytes']);
  assert.equal(a.schema,'viberoom-chat-completions-request-profile-v1');assert.ok(['none','low','medium','high','xhigh','max'].includes(a.reasoningEffort));assert.ok(a.temperature===null || typeof a.temperature==='number' && a.temperature>=0 && a.temperature<=2);
  int(a.maxCompletionTokens,1,128000);int(a.maxInputTextUtf8Bytes,1,1048576);int(a.maxRequestUtf8Bytes,a.maxInputTextUtf8Bytes,2097152);
  assert.equal(a.choices,1);assert.equal(a.serviceTier,'default');assert.equal(a.store,false);
  assert.ok(Array.isArray(p.writePermits));const ids=new Set(),counts={graph:0,ontology:0,episode:0};let credits=0;
  const seenEpisodes=new Set(),seenGraphs=new Set(),seenOntologies=new Set();
  for(const w of p.writePermits){fields(w,['id','kind','request','estimate']);assert.match(w.id,/^[A-Za-z0-9:_-]{1,256}$/);assert.ok(!ids.has(w.id));ids.add(w.id);assert.ok(Object.hasOwn(counts,w.kind));counts[w.kind]++;
    const r=request(w.request),u=new URL(r.url),base=new URL(p.origins.readBase);assert.equal(u.origin,base.origin);assert.ok(!u.search);const path=u.pathname.slice(base.pathname.replace(/\/$/,'').length);
    if(w.kind==='episode'){
      assert.equal(r.method,'POST');assert.equal(path,'/graph');const matches=plannedEpisodes.map((e,i)=>canonical(e)===canonical(r.body)?i:-1).filter(i=>i>=0);assert.equal(matches.length,1);assert.ok(!seenEpisodes.has(matches[0]));seenEpisodes.add(matches[0]);
      assert.equal(w.estimate,Math.max(1,Math.ceil(Buffer.byteLength(r.body.data)/350)));credits+=w.estimate;
    }else if(w.kind==='graph'){
      assert.equal(r.method,'POST');assert.equal(path,'/graph/create');assert.ok(graphIds.has(r.body.graph_id) && !seenGraphs.has(r.body.graph_id));const g=p.payloads.physicalAddresses.find(g=>g.plannedGraphId===r.body.graph_id);assert.ok(g);assert.equal(canonical(r.body),canonical({graph_id:g.plannedGraphId,name:g.room.name,description:`viberoom room "${g.room.name}"`}));seenGraphs.add(r.body.graph_id);assert.equal(w.estimate,0);
    }else{
      assert.equal(r.method,'PUT');assert.equal(path,'/entity-types');assert.ok(Array.isArray(r.body.graph_ids) && r.body.graph_ids.length===1 && graphIds.has(r.body.graph_ids[0]) && !seenOntologies.has(r.body.graph_ids[0]));assert.equal(canonical(r.body),canonical(ontologyWire(r.body.graph_ids[0])));seenOntologies.add(r.body.graph_ids[0]);assert.equal(w.estimate,0);
    }
  }
  assert.deepEqual(counts,{graph:graphs,ontology:graphs,episode:episodes});assert.equal(credits,m.ingestion.localEstimatedCredits);if(nativeProfile(p))validateNativeDeclaration(p);return p;
}
export function trialPolicy(input){
  const p=validateProfile(input),l=p.manifest.limits,a=p.manifest.answerControls.requestProfile;
  const graphs=p.payloads.physicalAddresses.length,episodes=p.writePermits.filter(w=>w.kind==='episode').length;
  return {schema:'viberoom-trial-journal-policy-v1',identity:p,kinds:{graph:graphs,ontology:graphs,episode:episodes,read:l.maxReads,model:p.manifest.jobs.length},
    limits:{localEstimatedCredits:p.manifest.ingestion.localEstimatedCredits,maxRequestBytes:Math.max(a.maxRequestUtf8Bytes+1024,131072),maxResponseBytes:l.maxResponseBytes,maxAggregateBytes:l.maxAggregateBytes,runMs:l.runMs},
    replay:{kinds:['read','episode'],reserve:{attempts:1,credits:Math.max(0,...p.writePermits.filter(w=>w.kind==='episode').map(w=>w.estimate))}}};
}
function modelRequest(r,p,job){
  const a=p.manifest.answerControls.requestProfile,b=r.body;assert.equal(r.method,'POST');assert.equal(r.url,p.origins.answerEndpoint);
  const keys=['model','max_completion_tokens','reasoning_effort','n','service_tier','store','messages',...(a.temperature===null?[]:['temperature'])];fields(b,keys);
  assert.equal(b.model,p.manifest.answerControls.model);assert.equal(b.max_completion_tokens,a.maxCompletionTokens);assert.equal(b.reasoning_effort,a.reasoningEffort);assert.equal(b.n,1);assert.equal(b.service_tier,'default');assert.equal(b.store,false);if(a.temperature!==null)assert.equal(b.temperature,a.temperature);
  assert.ok(Array.isArray(b.messages) && b.messages.length===2);for(const m of b.messages)fields(m,['role','content']);
  assert.equal(b.messages[0].role,'system');assert.equal(hash(b.messages[0].content),p.manifest.promptSha256);assert.equal(b.messages[1].role,'user');
  const prefix=`Question:\n${job.query}\n\nContext:\n`;assert.ok(b.messages[1].content.startsWith(prefix));
  const context=b.messages[1].content.slice(prefix.length);assert.ok(Buffer.byteLength(context)<=4096);
  assert.ok(b.messages.reduce((n,m)=>n+Buffer.byteLength(m.content),0)<=a.maxInputTextUtf8Bytes);assert.ok(Buffer.byteLength(JSON.stringify(b))<=a.maxRequestUtf8Bytes);
  return true;
}
export function validateDRequest(permit,policy){
  const p=policy.identity,r=request(permit.request);
  if(['graph','ontology','episode'].includes(permit.kind)){const w=p.writePermits.find(w=>w.id===permit.id);return !!w && canonical(w)===canonical(permit);}
  assert.equal(permit.estimate,0);
  if(permit.kind==='model'){const j=p.manifest.jobs.find(j=>`model:${j.order}`===permit.id);assert.ok(j);return modelRequest(r,p,j);}
  assert.equal(permit.kind,'read');assert.match(permit.id,/^read:[1-9][0-9]*$/);if(r.method==='GET')assert.equal(r.body,null);
  const u=new URL(r.url),base=new URL(p.origins.readBase);assert.equal(u.origin,base.origin);assert.ok(u.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'));
  const path=u.pathname.slice(base.pathname.replace(/\/$/,'').length),graphs=new Set(p.manifest.topology.map(g=>g.graphId));
  if(r.method==='GET' && path.startsWith('/graph/episodes/'))return false;
  if(r.method==='GET' && path.startsWith('/graph/')){assert.ok(graphs.has(decodeURIComponent(path.slice(7))) && !u.search);return true;}
  if(r.method==='POST' && path==='/graph/search'){
    fields(r.body,r.body.scope==='auto'?['graph_id','query','scope','return_raw_results','max_characters']:['graph_id','query','scope','limit','reranker']);
    assert.ok(graphs.has(r.body.graph_id));assert.ok(p.questions.queries.some(q=>q.query===r.body.query && p.manifest.topology.some(g=>g.graphId===r.body.graph_id && g.logicalRoom===q.room)));
    if(r.body.scope==='auto'){assert.equal(r.body.return_raw_results,true);assert.equal(r.body.max_characters,p.manifest.limits.autoMaxCharacters);}else{assert.equal(r.body.scope,'edges');assert.equal(r.body.limit,p.manifest.limits.edgeLimit);assert.equal(r.body.reranker,'cross_encoder');}return true;
  }
  const match=/^\/graph\/(?:episodes|edge|node)\/graph\/([^/]+)$/.exec(path);assert.ok(r.method==='POST' && match && graphs.has(decodeURIComponent(match[1])));
  fields(r.body,['limit','direction','order_by',...(Object.hasOwn(r.body,'cursor')?['cursor']:[])]);assert.equal(r.body.limit,p.manifest.limits.pageSize);assert.equal(r.body.direction,'asc');assert.equal(r.body.order_by,'uuid');if(r.body.cursor!==undefined)text(r.body.cursor);assert.ok(!u.search);return true;
}
export function fileStatKey(file){const s=statSync(file,{bigint:true,throwIfNoEntry:false});return s?`${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.ino}`:null;}
export function pinWatch({keepBytes=false}={}){
  const seen=new Map();
  function entry(pin,full){
    const key=fileStatKey(pin.path),memo=seen.get(pin.path);
    if(!full&&key!==null&&memo&&memo.key===key&&memo.sha256===pin.sha256)return memo;
    seen.delete(pin.path);if(key===null)return null;
    const bytes=readPinned(pin.path);if(bytes===null)return null;
    if(hash(bytes)!==pin.sha256)return null;
    const verified={key,sha256:pin.sha256,bytes:keepBytes?bytes:null};
    if(fileStatKey(pin.path)===key)seen.set(pin.path,verified);
    return verified;
  }
  return Object.freeze({
    current:(pin,{full=false}={})=>entry(pin,full)!==null,
    all:(pins,{full=false}={})=>pins.every(pin=>entry(pin,full)!==null),
    bytes:(pin,{full=false}={})=>{assert.ok(keepBytes);return entry(pin,full)?.bytes??null;},
    forget:()=>seen.clear(),
  });
}
export function resultRefusal(root){
  const state=RunJournal.inspect(root).state;
  return state.run.stopped==='tree_changed'||state.bindings.some(b=>b.name==='tree-changed')?'tree_changed':null;
}

export class DTrial {
  #journal;#profile;#attempts=new Map();#comparisonStarted=false;#preflightOpen=false;#setupStarted=false;
  #nativePhase='NONE';#nativeAuthorities=null;#nativeFinal=null;#nativeEntry=null;
  #readLocalRoutes=null;#nativeObservationPins=new Map();#codePins=null;#section=null;
  static prepare(root,profile){return RunJournal.prepare(root,trialPolicy(profile));}
  static claim(root,{approval,verifyApproval,current,clock,wallClock}){
    const stored=RunJournal.inspect(root),p=validateProfile(stored.policy.identity);
    if(p.purpose==='approved-paid-trial')assert.ok(p.review.d3Accepted && p.review.d3ProofSha256,'d3_review_pending');
    const obj=new DTrial();obj.#profile=p;
    const pins=obj.#codePins=pinWatch();
    const identity=frozen(p);
    obj.#journal=RunJournal.claim(root,{approval,clock,...(wallClock?{wallClock}:{}),verifyApproval:(r,policy)=>pins.all(p.codePins,{full:true}) && verifyApproval(r,policy)===true,
      current:()=>pins.all(p.codePins) && current(identity)===true,
      acceptObservedResponse:(permit,result)=>{
        if(!obj.#preflightOpen || permit.kind!=='read' || result.status!==404 || permit.request.method!=='GET')return false;
        const u=new URL(permit.request.url),base=new URL(p.origins.readBase),path=u.pathname.slice(base.pathname.replace(/\/$/,'').length);
        return u.origin===base.origin && !u.search && /^\/graph\/[^/]+$/.test(path) && p.manifest.topology.some(g=>g.graphId===decodeURIComponent(path.slice(7)));
      },
      validateRequest:(permit,policy)=>{
        if(nativeProfile(p)&&!obj.#preflightOpen){
          assert.ok(obj.#nativePhase==='T0'||obj.#nativePhase==='FINAL','native_handoff_not_acquired');
          try{if(obj.#nativePhase==='T0'){obj.#nativeCurrent();assert.ok(permit.kind==='read'&&new URL(permit.request.url).pathname!==new URL(p.origins.readBase).pathname.replace(/\/$/,'')+'/graph/search','native_final_set_required');}
            else obj.#nativeFinalValid();}catch(error){obj.#nativePhase='ENDED';throw error;}
        }
        const r=request(permit.request),u=new URL(r.url),base=new URL(p.origins.readBase),path=u.pathname.slice(base.pathname.replace(/\/$/,'').length);
        if(permit.kind==='read' && r.method==='GET' && path.startsWith('/graph/episodes/')){
          const ack=obj.#journal?.get('ingestion-acks');assert.ok(ack || obj.#preflightOpen);assert.equal(u.origin,base.origin);assert.ok(u.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'));assert.equal(r.body,null);assert.ok(!u.search);
          const uuid=decodeURIComponent(path.slice('/graph/episodes/'.length));
          if(ack)return ack.episodes.some(e=>e.uuid===uuid);
          return obj.#journal.summary().state.attempts.some(a=>a.outcome==='received' && p.writePermits.some(w=>w.kind==='episode' && w.id===a.permit) && JSON.parse(JSON.parse(a.capture).raw).uuid===uuid);
        }
        if(obj.#preflightOpen && permit.kind==='read' && r.method==='POST' && /^\/graph\/episodes\/graph\/[^/]+$/.test(path) && !Object.hasOwn(r.body,'limit')){
          assert.equal(permit.estimate,0);assert.match(permit.id,/^read:[1-9][0-9]*$/);assert.equal(u.origin,base.origin);
          assert.ok(u.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/') && !u.search);
          assert.ok(p.manifest.topology.some(g=>g.graphId===decodeURIComponent(path.slice('/graph/episodes/graph/'.length))));
          fields(r.body,['direction','order_by',...(Object.hasOwn(r.body,'cursor')?['cursor']:[])]);
          assert.ok(['asc','desc'].includes(r.body.direction));assert.ok(['uuid','created_at'].includes(r.body.order_by));
          if(r.body.order_by==='uuid')assert.equal(r.body.direction,'asc');if(r.body.cursor!==undefined)text(r.body.cursor);return true;
        }
        return validateDRequest(permit,policy);
      }});
    return obj;
  }
  admitWrite(id,input){if(nativeProfile(this.#profile))assert.ok(this.#preflightOpen&&this.#comparisonStarted,'native_setup_phase_required');const p=this.#profile.writePermits.find(p=>p.id===id);assert.ok(p);assert.equal(canonical(p.request),canonical(input));this.#journal.permit(p);return this.#journal.admit(id,input);}
  beginComparison(){assert.equal(this.#comparisonStarted,false,'comparison_already_started');this.#comparisonStarted=true;}
  beginSetup(){assert.ok(this.#comparisonStarted && !this.#setupStarted && !this.#journal.get('ingestion-acks'),'setup_phase_invalid');this.#setupStarted=true;this.#preflightOpen=true;}
  recordPreflightAttempt(input){
    assert.ok(this.#preflightOpen,'preflight_closed');const a=data(input);assert.equal(a.kind,'read');
    const r=request(a.request),u=new URL(r.url),base=new URL(this.#profile.origins.readBase),path=u.pathname.slice(base.pathname.replace(/\/$/,'').length);
    assert.equal(u.origin,base.origin);assert.ok(u.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'));
    assert.ok(r.method==='GET' && /^\/graph\/[^/]+$/.test(path) || r.method==='GET' && /^\/graph\/episodes\/[^/]+$/.test(path) || r.method==='POST' && /^\/graph\/(?:episodes|edge|node)\/graph\/[^/]+$/.test(path),'preflight_endpoint');
    return this.#recordAttempt(a,null);
  }
  recordWriteAttempt(input,permitId){
    assert.ok(this.#preflightOpen,'setup_phase_invalid');const a=data(input);int(a.number,1);assert.equal(a.status,'attempted');assert.equal(a.response,null);assert.ok(!this.#attempts.has(a.number),'budget_attempt_replay');
    const p=this.#profile.writePermits.find(p=>p.id===permitId);assert.ok(p && a.kind===p.kind);
    const handle=this.admitWrite(p.id,a.request);this.#attempts.set(a.number,handle);return true;
  }
  recordAttempt(input,logicalJobId=null){
    assert.ok(this.#journal.get('ingestion-acks'),'comparison_ingestion_not_bound');
    return this.#recordAttempt(input,logicalJobId);
  }
  #recordAttempt(input,logicalJobId){
    const a=data(input);assert.ok(['read','model'].includes(a.kind));int(a.number,1);assert.equal(a.status,'attempted');assert.equal(a.response,null);assert.ok(!this.#attempts.has(a.number),'budget_attempt_replay');
    const r=data(a.request);for(const k of ['inputTextUtf8Bytes','requestUtf8Bytes'])delete r[k];
    if(a.kind==='model'){int(logicalJobId,1,this.#profile.manifest.jobs.length);assert.equal(a.request.requestUtf8Bytes,Buffer.byteLength(JSON.stringify(r.body)));assert.equal(a.request.inputTextUtf8Bytes,r.body.messages.reduce((n,m)=>n+Buffer.byteLength(m.content),0));}
    const id=a.kind==='model'?`model:${logicalJobId}`:`read:${a.number}`;
    const permit={id,kind:a.kind,request:r,estimate:0};this.#journal.permit(permit);const handle=this.#journal.admit(id,r);this.#attempts.set(a.number,handle);return true;
  }
  outcome(handle,result){return this.#journal.outcome(handle,result);}
  recordBudgetOutcome(number,{httpStatus=null,response=null,latencyMs=null,status,error=null}){
    const handle=this.#attempts.get(number);assert.ok(handle);const known=status==='received' && typeof response==='string';
    const uncertainty=!known && error==='connection_closed_before_response'?{uncertainty:error}:{};
    return this.#journal.outcome(handle,{status:httpStatus,raw:typeof response==='string'?response:'',latencyMs,known,...uncertainty});
  }
  bindIngestion(input,verifyReceipt){
    const ack=data(input);fields(ack,['manifestSha256','episodes']);assert.equal(ack.manifestSha256,hash(encoded(this.#profile.manifest)));assert.equal(ack.episodes.length,this.#profile.writePermits.filter(p=>p.kind==='episode').length);
    const summary=this.#journal.summary(),seen=new Set(),ids=new Set();
    for(const e of ack.episodes){fields(e,['permitId','graphId','uuid']);text(e.uuid);assert.ok(!ids.has(e.uuid) && !seen.has(e.permitId));ids.add(e.uuid);seen.add(e.permitId);
      const p=this.#profile.writePermits.find(p=>p.id===e.permitId && p.kind==='episode');assert.ok(p && p.request.body.graph_id===e.graphId);
      const own=summary.state.attempts.filter(a=>a.permit===e.permitId);assert.ok(own.length===1 || own.length===2,'ack_attempts');
      const got=own.filter(a=>a.outcome==='received');assert.ok(own.every(a=>['received','unknown'].includes(a.outcome)),'ack_attempt_outcome');
      if(got.length===1)assert.equal(JSON.parse(JSON.parse(got[0].capture).raw).uuid,e.uuid);
      else{
        assert.equal(got.length,0,'ack_attempts');
        const evidence=episodeListingEvidence(summary.state,{graphId:e.graphId,opId:p.request.body.metadata.op_id,afterAttemptId:own[0].id});
        assert.ok(evidence!==null && evidence.present && evidence.uuid===e.uuid,'ack_receipt_unproven');
      }
    }
    invariant.equal(typeof verifyReceipt,'function');const saved=this.#journal.save('ingestion-acks',ack,verifyReceipt);this.#preflightOpen=false;return saved;
  }
  ingestionReceiptSha256(){const ack=this.#journal.get('ingestion-acks');assert.ok(ack,'ingestion_not_bound');return nativeDigest(ack);}
  #nativeRefuse(error){this.#nativePhase='ENDED';try{this.#journal.stop('native_project_binding_refused');}catch(stopError){throw new AggregateError([error,stopError],'native_binding_and_stop_failed');}throw error;}
  #nativeRoutesCurrent(){
    invariant.ok(this.#section!==null,'native_routes_without_owner_check');
    try{return this.#nativePhase==='FINAL'?!!this.#nativeFinalValid():this.#nativeCurrent();}catch(error){return this.#nativeRefuse(error);}
  }
  #saveRecord(name,value,verify){
    this.#journal.save(name,value,verify);const saved=this.#journal.get(name);
    assert.equal(canonical(saved),canonical(value),'native_saved_record_changed');return saved;
  }
  #nativeTry(operation){try{this.#journal.check();if(['T0','FINAL'].includes(this.#nativePhase))this.#nativeCurrent();const value=operation();if(['T0','FINAL'].includes(this.#nativePhase))this.#nativeCurrent();this.#journal.check();return value;}catch(error){return this.#nativeRefuse(error);}}
  #nativeLocals(graphIds){
    invariant.equal(typeof this.#readLocalRoutes,'function','native_product_route_capability_required');
    const routes=this.#readLocalRoutes([...graphIds]);assert.ok(Array.isArray(routes)&&routes.length===graphIds.length,'native_product_routes_incomplete');
    return graphIds.map((graphId,i)=>{const authority=this.#nativeAuthorities.find(a=>a.graphId===graphId);assert.ok(authority);
      return validateObservedLocalRoute(routes[i],authority,this.#profile);});
  }
  #nativeLocal(graphId){return this.#nativeLocals([graphId])[0];}
  #nativeSaved(graphId,localRoute=null){
    const observation=this.#journal.get('project-observation:'+graphId),pin=this.#nativeObservationPins.get(graphId);
    assert.ok(observation&&pin&&nativeDigest(observation)===pin,'native_saved_observation_changed');
    fields(observation,['schema','claimId','accountScopeSha256','endpoint','graphId','budgetAttemptNumber','durableAttemptId','permitId','requestSha256','rawResponseSha256','sdkCaptureSha256','sdkLayoutSha256','projectUuid','remoteRoute','localRoute','localRouteIdentitySha256']);
    assert.equal(observation.schema,NATIVE_OBSERVATION);assert.equal(observation.graphId,graphId);assert.equal(observation.claimId,this.#nativeEntry.ownerClaimId);
    assert.equal(observation.accountScopeSha256,this.#profile.nativeProject.accountScopeSha256);
    assert.equal(observation.localRouteIdentitySha256,nativeDigest(localRouteIdentity(observation.localRoute)));
    assert.equal(nativeDigest(localRouteIdentity(localRoute??this.#nativeLocal(graphId))),observation.localRouteIdentitySha256,'native_observed_route_changed');return observation;
  }
  #nativeCurrent(){
    assert.ok(this.#nativePhase==='T0'||this.#nativePhase==='FINAL','native_handoff_not_current');
    const graphIds=this.#nativeAuthorities.map(a=>a.graphId),routes=this.#nativeLocals(graphIds);
    graphIds.forEach((graphId,i)=>{if(this.#nativeObservationPins.has(graphId))this.#nativeSaved(graphId,routes[i]);});return true;
  }
  #nativeJoin(input){
    fields(input,['graphId','attemptNumber','raw','capture']);int(input.attemptNumber,1);assert.ok(this.#nativeAuthorities.some(a=>a.graphId===input.graphId));
    const handle=this.#attempts.get(input.attemptNumber);assert.ok(handle,'native_graph_attempt_not_owned');
    return joinNativeGraphCapture({summary:this.#journal.summary(),handle,...input,accountScopeSha256:this.#profile.nativeProject.accountScopeSha256,endpoint:this.#profile.origins.readBase,
      localRoute:this.#nativeLocal(input.graphId),authority:this.#nativeAuthorities.find(a=>a.graphId===input.graphId),profile:this.#profile});
  }
  #nativeFinalValid(){
    assert.equal(this.#nativePhase,'FINAL','native_final_set_required');assert.ok(this.#nativeFinal);
    const saved=this.#journal.get('native-project-binding-set');assert.ok(saved&&nativeDigest(saved)===this.#nativeFinal.permit.nativeBindingSetSha256,'native_final_set_changed');
    fields(saved,['schema','claimId','accountScopeSha256','ingestionAcksSha256','projectUuid','observations','authoritiesSha256']);assert.equal(saved.schema,NATIVE_BINDING_SET);
    const graphs=this.#profile.manifest.topology.length;assert.equal(saved.observations.length,graphs);assert.equal(this.#nativeObservationPins.size,graphs);
    assert.equal(canonical(saved.observations.map(o=>o.graphId)),canonical(this.#nativeAuthorities.map(a=>a.graphId)));
    const routes=this.#nativeLocals(saved.observations.map(o=>o.graphId));
    saved.observations.forEach((o,i)=>{fields(o,['graphId','observationSha256','inventoryFingerprint','authoritySha256']);assert.equal(nativeDigest(this.#nativeSaved(o.graphId,routes[i])),o.observationSha256);});
    assert.equal(saved.ingestionAcksSha256,nativeDigest(this.#journal.get('ingestion-acks')));
    assert.equal(saved.claimId,this.#journal.claim());assert.equal(saved.accountScopeSha256,this.#profile.nativeProject.accountScopeSha256);
    assert.equal(saved.authoritiesSha256,this.#nativeFinal.permit.currentAuthoritySha256);return saved;
  }
  nativeComparison(permit,authorities,readLocalRoutes){return this.#nativeTry(()=>{
    assert.ok(nativeProfile(this.#profile)&&this.#comparisonStarted&&!this.#preflightOpen&&this.#nativePhase==='NONE','native_phase_invalid');
    const ack=this.#journal.get('ingestion-acks');assert.ok(ack);const expected=nativeAuthorities(this.#profile,ack);
    assert.equal(canonical(authorities),canonical(expected),'native_provisional_authority_changed');
    fields(permit,['schema','purpose','manifestSha256','runId','ownerClaimId','approved','expiresAt','accountScopeSha256','provisionalAuthoritySha256','nativeBindingSetSha256','serviceEmissionBinding','wholeTrialBudgetApproved','readOrigin','answerOrigin']);
    assert.equal(permit.schema,NATIVE_ENTRY);assert.equal(permit.nativeBindingSetSha256,null);assert.equal(permit.accountScopeSha256,this.#profile.nativeProject.accountScopeSha256);
    assert.equal(permit.provisionalAuthoritySha256,nativeDigest(expected));assert.equal(permit.ownerClaimId,this.#journal.summary().state.run.claim);
    const run=this.#journal.summary().state.run,local=this.#profile.purpose==='local-fixture';
    assert.equal(permit.purpose,this.#profile.purpose);assert.equal(permit.approved,true);assert.equal(permit.expiresAt,JSON.parse(run.approval).expiresAt);
    assert.equal(permit.runId,this.#profile.manifest.runId);assert.equal(permit.manifestSha256,nativeDigest(this.#profile.manifest));
    assert.equal(permit.readOrigin,new URL(this.#profile.origins.readBase).origin);assert.equal(permit.answerOrigin,new URL(this.#profile.origins.answerEndpoint).origin);
    assert.equal(permit.wholeTrialBudgetApproved,!local);
    assert.equal(canonical(permit.serviceEmissionBinding),canonical(local?null:{acceptedCETree:this.#profile.review.acceptedCETree,actualServiceEmissionsSha256:this.#profile.review.serviceEmissionProofSha256,authorizedIngestionReceiptSha256:nativeDigest(ack)}));
    invariant.equal(typeof readLocalRoutes,'function','native_product_route_capability_required');
    this.#nativeAuthorities=data(expected);this.#nativeEntry=data(permit);this.#readLocalRoutes=readLocalRoutes;this.#nativePhase='T0';this.#nativeCurrent();
    const T0=Object.freeze({captureGraph:input=>this.#nativeTry(()=>{
      assert.equal(this.#nativePhase,'T0','native_T0_closed');const observation=this.#nativeJoin(data(input)),name='project-observation:'+input.graphId;
      assert.equal(this.#journal.get(name),null,'native_T0_graph_repeated');
      const saved=this.#saveRecord(name,observation,()=>{const fresh=this.#nativeJoin(data(input));fresh.localRoute.head.checkedAt=observation.localRoute.head.checkedAt;return canonical(fresh)===canonical(observation);});
      this.#nativeObservationPins.set(input.graphId,nativeDigest(saved));return data(observation);
    })});
    const T1=Object.freeze({captureGraph:input=>this.#nativeTry(()=>{
      const set=this.#nativeFinalValid(),observation=this.#nativeJoin(data(input));assert.equal(observation.projectUuid,set.projectUuid,'native_T1_project_changed');
      const prior=set.observations.find(o=>o.graphId===input.graphId);assert.ok(prior);assert.equal(nativeDigest(this.#journal.get('project-observation:'+input.graphId)),prior.observationSha256);
      return data(observation);
    })});
    return Object.freeze({T0,T1,routesCurrent:()=>this.#nativeRoutesCurrent(),refuse:error=>this.#nativeRefuse(error),
      resolveT0:graphId=>this.#nativeTry(()=>{assert.equal(this.#nativePhase,'T0');const observation=this.#nativeSaved(graphId);return resolvedObservedAuthority(this.#nativeAuthorities.find(a=>a.graphId===graphId),observation);}),
      completeT0:inventories=>this.#nativeTry(()=>{
        assert.equal(this.#nativePhase,'T0');assert.equal(inventories.length,this.#profile.manifest.topology.length);const observations=[],finalAuthorities=[],seen=new Set();let projectUuid=null;
        assert.equal(canonical(inventories.map(i=>i.graphId)),canonical(this.#profile.manifest.topology.map(g=>g.graphId)),'native_inventory_order_changed');
        for(const inventory of data(inventories)){
          fields(inventory,['graphId','snapshot']);assert.ok(!seen.has(inventory.graphId));seen.add(inventory.graphId);
          const provisional=this.#nativeAuthorities.find(a=>a.graphId===inventory.graphId);assert.ok(provisional);
          const observation=this.#nativeSaved(inventory.graphId);
          assert.equal(observation.claimId,this.#nativeEntry.ownerClaimId);assert.equal(observation.accountScopeSha256,this.#profile.nativeProject.accountScopeSha256);
          if(projectUuid===null)projectUuid=observation.projectUuid;else assert.equal(observation.projectUuid,projectUuid,'native_projects_mixed');
          const captured={row:inventory.snapshot.graph,layout:inventory.snapshot.sdkGraphLayout};assert.equal(nativeDigest(captured),observation.sdkCaptureSha256,'native_inventory_graph_join_changed');
          const authority=resolvedObservedAuthority(provisional,observation),topology=this.#profile.manifest.topology.find(g=>g.graphId===inventory.graphId);
          const rows=this.#profile.payloads.rows.filter(r=>r.variant===topology.variant&&r.logicalRoom===topology.logicalRoom),verified=verifySnapshot(inventory.snapshot,authority,rows);
          finalAuthorities.push(authority);observations.push({graphId:inventory.graphId,observationSha256:nativeDigest(observation),inventoryFingerprint:verified.fingerprint,authoritySha256:nativeDigest(authority)});
        }
        assert.equal(seen.size,this.#nativeAuthorities.length);const ack=this.#journal.get('ingestion-acks');
        const set={schema:NATIVE_BINDING_SET,claimId:this.#nativeEntry.ownerClaimId,accountScopeSha256:this.#profile.nativeProject.accountScopeSha256,
          ingestionAcksSha256:nativeDigest(ack),projectUuid,observations,authoritiesSha256:nativeDigest(finalAuthorities)};
        const savedSet=this.#saveRecord('native-project-binding-set',set,value=>value.observations.every(o=>nativeDigest(this.#nativeSaved(o.graphId))===o.observationSha256)&&nativeDigest(this.#journal.get('ingestion-acks'))===value.ingestionAcksSha256);
        const {provisionalAuthoritySha256,nativeBindingSetSha256,...entry}=this.#nativeEntry;
        const final={authorities:finalAuthorities,permit:{...entry,schema:NATIVE_FINAL,currentAuthoritySha256:set.authoritiesSha256,nativeBindingSetSha256:nativeDigest(savedSet)}};
        this.#nativeFinal=data(final);this.#nativePhase='FINAL';this.#nativeFinalValid();return data(final);
      }),
      verifyFinal:(finalPermit,finalAuthorities)=>this.#nativeTry(()=>{this.#nativeFinalValid();assert.equal(canonical(finalPermit),canonical(this.#nativeFinal.permit));assert.equal(canonical(finalAuthorities),canonical(this.#nativeFinal.authorities));return true;})});
  });}
  stop(reason){
    this.#comparisonStarted=true;
    if(this.#codePins.all(this.#profile.codePins,{full:true}))return this.#journal.stop(reason);
    this.#journal.stop('code_pins_changed_during_trial');throw new Error('code_pins_changed_during_trial');
  }
  check(){const value=this.#journal.check();const section={};this.#section=section;queueMicrotask(()=>{if(this.#section===section)this.#section=null;});return value;}
  lastAdmission(){return this.#journal.lastAdmission();}
  treeChanged(phase,changes){
    invariant.ok(['claim','after-ingestion','end'].includes(phase)&&Array.isArray(changes)&&changes.length>0);
    this.#journal.save('tree-changed',{phase,changes:changes.slice(0,100),count:changes.length});
    this.#journal.stop('tree_changed');
    throw new Held('tree_changed');
  }
  summary(){return this.#journal.summary();}
  close(){this.#journal.close();}
}
