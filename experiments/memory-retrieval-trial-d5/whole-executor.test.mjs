// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createOwnedWholeFixture} from '../trial-journal/owned-whole-local-fixture.mjs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ZepClient} from '@getzep/zep-cloud';
import {DTrial,prepareWritePermits,validateDRequest,trialPolicy} from './profile.mjs';
import {RunJournal} from '../trial-journal/journal.mjs';
import {WORK_ONTOLOGY} from '../../dist/memory/zep.js';
import {runWholeTrial,READ_AFTER_INGESTION_MS} from './whole-executor.mjs';
import {privateHttpRequest} from './private-launch.mjs';
import {createSdkReadPort,createHttpAnswerPort} from '../memory-retrieval-comparison-d3/ports.mjs';
import {encode,sha256,canonical} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {ConnectionClosedBeforeResponse,connectionClosedBeforeResponse} from '../../dist/memory/zep-sdk-fetch.js';
import {WHOLE_CODE_PATHS,writeWholeInput} from './whole-input.mjs';
import {UNKNOWN_REPLAY_WAIT_MS} from '../../dist/memory/delivery.js';
import {evidenceFolder} from './test-folders.mjs';

let inputRoot=process.env.D_WHOLE_INPUT;const builtCleanups=[];
before(async()=>{
  if(inputRoot)return;
  const dir=mkdtempSync(join(tmpdir(),'viberoom-whole-input-'));builtCleanups.push(()=>rmSync(dir,{recursive:true,force:true}));
  await writeWholeInput(join(dir,'input'),{name:'whole-executor.test',after(fn){builtCleanups.push(fn);}});inputRoot=join(dir,'input');
});
after(async()=>{for(const fn of builtCleanups.reverse()){try{await fn();}catch{}}});
const read=name=>JSON.parse(readFileSync(join(inputRoot,name),'utf8'));
let caseNumber=0;
const wholeEvidence=evidenceFolder('D_WHOLE_EVIDENCE');
const appRootUrl=new URL('../../',import.meta.url);
const wholeCodePaths=WHOLE_CODE_PATHS;
function currentWholeCodePins(profile){
  assert.ok(Array.isArray(profile.codePins)&&profile.codePins.length===wholeCodePaths.length,'whole_fixture_code_pin_roster');
  assert.equal(canonical(profile.codePins),canonical(profile.manifest.codePins),'whole_fixture_manifest_code_pins');
  const seen=new Set();
  return profile.codePins.map(pin=>{
    assert.ok(pin&&Object.keys(pin).sort().join(',')==='path,sha256'&&typeof pin.path==='string'&&typeof pin.sha256==='string'&&/^[a-f0-9]{64}$/.test(pin.sha256),'whole_fixture_code_pin');
    const relative=pin.path.replaceAll('\\','/');
    assert.ok(wholeCodePaths.includes(relative)&&!seen.has(relative),'whole_fixture_code_pin_path');seen.add(relative);
    const path=fileURLToPath(new URL(relative,appRootUrl));
    return {path,sha256:sha256(readFileSync(path))};
  });
}
test('whole fixture pins accept only the exact app-relative roster',()=>{
  const pins=wholeCodePaths.map(path=>({path,sha256:'0'.repeat(64)}));
  const profile=codePins=>({codePins,manifest:{codePins}});
  assert.equal(currentWholeCodePins(profile(pins)).length,pins.length);
  for(const path of ['../outside-fixture.mjs','experiments/unlisted-fixture.mjs',fileURLToPath(new URL(wholeCodePaths[0],appRootUrl))]){
    assert.throws(()=>currentWholeCodePins(profile([{...pins[0],path},...pins.slice(1)])),/whole_fixture_code_pin_path/);
  }
  assert.throws(()=>currentWholeCodePins(profile([pins[0],pins[0],...pins.slice(2)])),/whole_fixture_code_pin_path/);
});
function sdkClient(p,transport){
  return new ZepClient({baseUrl:p.origins.readBase,apiKey:'synthetic-serialization-only',fetcher:async args=>{
    const request={method:args.method,url:args.url,body:args.body==null?null:JSON.parse(JSON.stringify(args.body)),maxRetries:args.maxRetries};
    const read=args.method==='GET' || /\/graph\/episodes\/graph\//.test(new URL(args.url).pathname);
    const r=await (read?transport.read(request):transport.write(request));return r.status>=200 && r.status<300?{ok:true,body:r.body,rawResponse:r.rawResponse}:{ok:false,error:{reason:'status-code',statusCode:r.status,body:r.body},rawResponse:r.rawResponse};
  }});
}
async function sdkStep({phase,permits,transport,p}){
  const client=sdkClient(p,transport);
  if(phase==='setup'){
    for(const permit of permits){
      if(permit.kind==='graph')await client.graph.create({graphId:permit.request.body.graph_id,name:permit.request.body.name,description:permit.request.body.description},{maxRetries:0});
      else{await client.graph.get(permit.request.body.graph_ids[0],{maxRetries:0});await client.graph.setOntology(WORK_ONTOLOGY,{},{graphIds:permit.request.body.graph_ids},{maxRetries:0});}
    }
    return;
  }
  const permit=permits[0],member=p.payloads.rows.flatMap(r=>r.members).find(m=>m.opId===permit.request.body.metadata.op_id);
  if(phase==='settle'){
    const listed=await client.graph.episode.listByGraphId(permit.request.body.graph_id,{orderBy:'uuid',direction:'asc'},{maxRetries:0});
    const mine=listed.find(e=>e.metadata?.op_id===permit.request.body.metadata.op_id);
    if(mine)return {state:'accepted',externalIds:[mine.uuid]};
  }
  try{
    const response=await client.graph.add(member.payload.request,{maxRetries:0});
    await client.graph.episode.get(response.uuid,{maxRetries:0});
    return {state:'accepted',externalIds:[response.uuid]};
  }catch(error){if(connectionClosedBeforeResponse(error))return {state:'unknown'};throw error;}
}
async function world(t,options={}){
  const w={calls:[],models:0,stops:0,events:[],live:true,tick:0,wall:Date.now(),graphs:new Set(),episodes:[]};
  const resources=createOwnedWholeFixture(t,{evidenceRoot:wholeEvidence}),root=resources.ownerRoot;w.root=root;w.resources=resources;
  const server=resources.constructHttpServer();server.on('request',async(req,res)=>{
    let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw):null,path=req.url.replace(/^\/v2/,'');w.calls.push({method:req.method,path,body,at:performance.now()});
    const drop=options.drop?.({method:req.method,path,body,n:w.calls.length})??null;
    if(drop==='before'){req.socket.destroy();return;}
    assert.equal(RunJournal.peek(root).open,1);
    let value={message:'ok'};
    if(path==='/graph/create'){w.graphs.add(body.graph_id);value={graph_id:body.graph_id};}
    else if(path==='/entity-types')value={message:'ok'};
    else if(path==='/graph'){const e={uuid:'local-ack-'+(w.episodes.length+1),graph_id:body.graph_id,content:body.data,metadata:body.metadata,created_at:body.created_at,processed:true,source:'message'};w.episodes.push(e);value={uuid:e.uuid};}
    else if(path==='/v1/chat/completions'){w.models++;value={choices:[{message:{content:'Synthetic local answer.'}}],usage:{prompt_tokens:23,completion_tokens:7,total_tokens:30}};}
    else if(path==='/graph/search'){const g=body.graph_id;value=body.scope==='auto'?{edges:edges(g),nodes:[],episodes:[]}:{edges:edges(g)};}
    else if(/^\/graph\/episodes\/graph\//.test(path))value=w.episodes.filter(e=>e.graph_id===decodeURIComponent(path.split('/').at(-1))).map(e=>({...episodeWire(e),created_at:'2026-10-03T22:00:00.000Z'}));
    else if(/^\/graph\/node\/graph\//.test(path))value=nodes(decodeURIComponent(path.split('/').at(-1)));
    else if(/^\/graph\/edge\/graph\//.test(path))value=edges(decodeURIComponent(path.split('/').at(-1)));
    else if(/^\/graph\/episodes\//.test(path))value=episodeWire(w.episodes.find(e=>e.uuid===decodeURIComponent(path.split('/').at(-1))));
    else if(/^\/graph\//.test(path))value={graph_id:decodeURIComponent(path.split('/').at(-1)),project_uuid:'LOCAL_UNVERIFIED_PROJECT'};
    const missing=options.missingGraph && req.method==='GET' && /^\/graph\/[^/]+$/.test(path) && !w.graphs.has(decodeURIComponent(path.split('/').at(-1)));
    if(drop==='after'){req.socket.destroy();return;}
    res.statusCode=missing?404:options.httpStatus??200;res.setHeader('content-type','application/json');res.end(JSON.stringify(missing?{message:'synthetic missing graph'}:value));
  });
  const episodeWire=({graph_id,...episode})=>options.extraEpisodeField?{...episode,graph_id}:episode;
  const nodes=g=>[{uuid:g+'-a',name:'Synthetic subject',summary:'Synthetic summary.',created_at:'2026-10-03T00:00:00Z'},{uuid:g+'-b',name:'Synthetic object',summary:'Synthetic second summary.',created_at:'2026-10-03T00:00:00Z'}];
  const edges=g=>[{uuid:g+'-edge',fact:'Synthetic subject uses synthetic object.',name:'USES',created_at:'2026-10-03T00:00:00Z',valid_at:'2026-09-01T00:00:00Z',source_node_uuid:g+'-a',target_node_uuid:g+'-b',episodes:w.episodes.filter(e=>e.graph_id===g).map(e=>e.uuid)}];
  await resources.startHttpServer();const origin=`http://127.0.0.1:${server.address().port}`;
  const p=read('PREPARED-PROFILE.json'),scope=read('FRESH-SCOPE.json'),preparation=read('BOUND-PREPARATION.json');
  p.purpose='local-fixture';p.origins={readBase:origin+'/v2',answerEndpoint:origin+'/v1/chat/completions'};p.writePermits=prepareWritePermits(p.payloads,p.origins.readBase);
  p.codePins=currentWholeCodePins(p);p.manifest.codePins=p.codePins;
  options.profile?.(p,scope);p.review.serviceEmissionProofSha256=sha256(encode(scope));w.profile=p;w.scope=scope;
  const card=DTrial.prepare(root,p),approval={id:'synthetic-local-whole',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+600000).toISOString()};
  w.owner=resources.retainTrialOwner(DTrial.claim(root,{approval,verifyApproval:()=>true,current:()=>w.live,clock:()=>w.tick,wallClock:()=>w.wall}));
  const stop=w.owner.stop.bind(w.owner);w.owner.stop=reason=>{w.stops++;return stop(reason);};
  w.run=async(overrides={})=>{
    let result,error;
    try{result=await runWholeTrial({owner:w.owner,profile:p,scope,preparation,clock:()=>w.tick,current:()=>w.live,
      fetchImpl:async(...args)=>{options.beforeFetch?.(w,args);return fetch(...args);},verifyReceipt:()=>options.verifyReceipt!==false,
      record:(kind,value)=>w.events.push({kind,value}),
      productStep:async({phase,permits,transport})=>{
        if(options.step)return options.step({phase,permit:permits[0],permits,transport,w,client:()=>sdkClient(p,transport),defaultStep:()=>sdkStep({phase,permits,transport,p})});
        return sdkStep({phase,permits,transport,p});
      },
      comparisonPorts:({budget})=>{w.comparisonBudget=budget;assert.equal(w.owner.summary().state.bindings.find(b=>b.name==='ingestion-acks')!==undefined,true);
        return {readPort:createSdkReadPort({ZepClient,baseUrl:p.origins.readBase,apiKey:'synthetic-only',purpose:'local-fixture',budget,current:()=>w.live}),
          answerPort:createHttpAnswerPort({endpointUrl:p.origins.answerEndpoint,answerControls:p.manifest.answerControls,purpose:'local-fixture',budget,current:()=>w.live})};},...overrides});}
    catch(e){error=e;}
    if(wholeEvidence)writeFileSync(join(wholeEvidence,`case-${++caseNumber}.json`),JSON.stringify({localFixtureOnly:true,stops:w.stops,calls:w.calls,models:w.models,result,error:error?{name:error.name,message:error.message}:null,durable:w.owner.summary()},null,2)+'\n',{flag:'wx'});
    if(error)throw error;return result;
  };
  return w;
}

test('whole loopback: exact 40 setup/34 C-bound episode writes, scoped preflight, all ACKs, then 264 jobs share one owner/budget',async t=>{
  const w=await world(t),result=await w.run();assert.equal(result.status,'captured-unjudged');assert.equal(w.models,264);assert.equal(w.stops,1);
  assert.equal(w.calls.filter(c=>c.path==='/graph/create').length,20);assert.equal(w.calls.filter(c=>c.path==='/entity-types').length,20);assert.equal(w.calls.filter(c=>c.path==='/graph').length,34);
  assert.equal(result.records.length,264);assert.equal(result.summary.reads,54+404);assert.equal(result.attempts.filter(a=>['graph','ontology','episode'].includes(a.kind)).length,74);
  assert.equal(result.durableTrial.state.run.response_bytes,result.summary.responseBytes);assert.equal(result.durableTrial.state.attempts.length,74+458+264);
  assert.ok(result.durableTrial.state.attempts.every(a=>a.outcome==='received'));assert.equal(w.events.filter(e=>e.kind==='finish').length,1);
  assert.throws(()=>DTrial.claim(w.root,{approval:{},verifyApproval:()=>true,current:()=>true}));
});
test('an undeclared Episode field is kept as evidence in the episode layouts and the trial completes',async t=>{
  const w=await world(t,{extraEpisodeField:true}),result=await w.run();
  assert.equal(result.status,'captured-unjudged');assert.equal(w.models,264);assert.equal(w.stops,1);
  const kept=JSON.stringify(w.events).match(/"unknownNativeFields":\{"graph_id":"[^"]+"\}/g)??[];
  assert.ok(kept.length>0,'the set-aside graph_id is not in the journal');
});
test('before ACK comparison API/search/model/foreign UUID remain closed; exact setup graph GET is journaled',async t=>{
  const w=await world(t);w.owner.beginComparison();w.owner.beginSetup();
  const req={method:'GET',url:w.profile.origins.readBase+'/graph/'+w.profile.manifest.topology[0].graphId,body:null,maxRetries:0};
  const a={number:1,kind:'read',status:'attempted',response:null,request:req};assert.throws(()=>w.owner.recordAttempt(a),/ingestion_not_bound/);
  assert.throws(()=>w.owner.recordPreflightAttempt({...a,request:{...req,url:w.profile.origins.readBase+'/graph/episodes/foreign'}}));
  assert.throws(()=>w.owner.recordPreflightAttempt({...a,kind:'model'}));assert.throws(()=>w.owner.recordPreflightAttempt({...a,request:{method:'POST',url:w.profile.origins.readBase+'/graph/search',body:{},maxRetries:0}}),/preflight_endpoint/);
  assert.equal(w.owner.recordPreflightAttempt(a),true);assert.equal(w.owner.summary().state.attempts.length,1);assert.equal(w.calls.length,0);w.owner.stop('direct-control-end');
});
test('changed source binding is refused before setup I/O and finishes once',async t=>{
  const w=await world(t,{profile(_p,s){s.members[0].version='sha256:'+'0'.repeat(64);}});await assert.rejects(w.run());assert.equal(w.calls.length,0);assert.equal(w.stops,1);
});
test('missing product dispatch refuses comparison instead of paid fallback',async t=>{
  const w=await world(t,{step:async()=>{}});await assert.rejects(w.run(),/product_dispatch_not_received/);assert.equal(w.calls.length,0);assert.equal(w.models,0);assert.equal(w.stops,1);
});
test('wrong or repeated exact product write is refused before another HTTP',async t=>{
  const w=await world(t,{step:async({permit,transport})=>{await transport.write(permit.request);await transport.write(permit.request);}});
  await assert.rejects(w.run(),/product_write_repeated/);assert.equal(w.calls.length,1);assert.equal(w.stops,1);assert.equal(w.models,0);
});
test('unknown setup HTTP stops the whole run; no second wrapper or restart',async t=>{
  const w=await world(t,{httpStatus:503});await assert.rejects(w.run());assert.equal(w.calls.length,1);assert.equal(w.stops,1);assert.equal(w.owner.summary().state.attempts[0].outcome,'unknown');
  await assert.rejects(w.run(),/comparison_already_started/);assert.equal(w.calls.length,1);assert.equal(w.stops,1);assert.throws(()=>DTrial.claim(w.root,{approval:{},verifyApproval:()=>true,current:()=>true}));
});
test('setup/preflight authority loss after awaited response allows no next write',async t=>{
  const w=await world(t,{beforeFetch(w){if(w.calls.length===1)w.live=false;}});await assert.rejects(w.run());assert.ok(w.calls.length<=2);assert.equal(w.models,0);assert.equal(w.stops,1);
});
test('response cap is shared by setup and ingestion, not reset at comparison',async t=>{
  const w=await world(t,{profile(p){p.manifest.limits.maxAggregateBytes=80;}});await assert.rejects(w.run());assert.equal(w.models,0);assert.equal(w.stops,1);assert.ok(w.owner.summary().state.run.response_bytes>=80);
});
test('receipt verification refusal keeps all 34 received writes, no binding/model or replay',async t=>{
  const w=await world(t,{verifyReceipt:false});await assert.rejects(w.run(),/binding_not_verified/);assert.equal(w.episodes.length,34);assert.equal(w.models,0);assert.equal(w.stops,1);assert.equal(w.owner.summary().state.bindings.length,0);
});
test('copied physical card/root cannot authorize a whole trial',async t=>{
  const w=await world(t),copy=w.resources.copyJournalRoot();assert.throws(()=>RunJournal.inspect(copy));assert.equal(w.calls.length,0);
});
test('prepared paid card has no claim and pending current CE/bridge/native gates cannot activate it',t=>{
  const resources=createOwnedWholeFixture(t,{evidenceRoot:wholeEvidence}),root=resources.ownerRoot;const p=read('PREPARED-PROFILE.json'),card=DTrial.prepare(root,p);
  assert.equal(RunJournal.inspect(root).state.run.claim,null);assert.throws(()=>DTrial.claim(root,{approval:{id:'not-approved',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+10000).toISOString()},verifyApproval:()=>true,current:()=>true}),/d3_review_pending/);
  assert.equal(RunJournal.inspect(root).state.run.claim,null);
});
test('exact owned anchor 404 is received preflight evidence; create authority remains the separate planned permit',async t=>{
  const w=await world(t,{missingGraph:true,step:async({permit,transport})=>{
    if(permit.kind!=='graph')return;
    const r=await transport.read({method:'GET',url:w.profile.origins.readBase+'/graph/'+permit.request.body.graph_id,body:null,maxRetries:0});assert.equal(r.status,404);
    await transport.write(permit.request);
  }});await assert.rejects(w.run(),/product_dispatch_not_received/);
  assert.equal(w.calls.length,2);const s=w.owner.summary().state;assert.equal(s.attempts[0].status,404);assert.equal(s.attempts[0].outcome,'received');assert.equal(s.attempts[1].outcome,'received');assert.equal(w.stops,1);
});
test('late unresolved setup response is diagnostic only and cannot rewrite terminal state',async t=>{
  let resolve;const pending=new Promise(r=>{resolve=r;});
  const w=await world(t,{step:async({permit,transport,w})=>{w.pending=transport.write(permit.request);w.pending.catch(()=>{});}});
  await assert.rejects(w.run({fetchImpl:()=>pending}),/product_dispatch_not_received/);
  const before=canonical(w.owner.summary().state);assert.equal(w.owner.summary().state.attempts[0].outcome,'unknown');
  resolve(new Response(JSON.stringify({graph_id:w.profile.manifest.topology[0].graphId}),{status:200}));await assert.rejects(w.pending);assert.equal(canonical(w.owner.summary().state),before);assert.equal(w.stops,1);assert.equal(w.calls.length,0);
});
test('preflight cursor chain cannot exceed the common two-page cap',async t=>{
  const w=await world(t,{step:async({permit,transport,w})=>{
    await transport.write(permit.request);const request={method:'POST',url:w.profile.origins.readBase+'/graph/episodes/graph/'+w.profile.manifest.topology[0].graphId,body:{limit:50,direction:'asc',order_by:'uuid'},maxRetries:0};
    await transport.read(request);await transport.read({...request,body:{...request.body,cursor:'a'}});await transport.read({...request,body:{...request.body,cursor:'b'}});
  }});await assert.rejects(w.run(),/preflight_page_cap/);assert.equal(w.calls.length,3);assert.equal(w.models,0);assert.equal(w.stops,1);
});
test('null profile enters common lifetime before dereference and terminates exactly once',async t=>{
 const w=await world(t);await assert.rejects(w.run({profile:null}),TypeError);assert.equal(w.stops,1);assert.equal(w.calls.length,0);
 assert.notEqual(w.owner.summary().state.run.stopped,null);assert.throws(()=>w.owner.admitWrite(w.profile.writePermits[0].id,w.profile.writePermits[0].request));
 await assert.rejects(w.run(),/comparison_already_started/);assert.equal(w.stops,1);
});
test('throwing first profile getter is inside common termination duty',async t=>{
 const w=await world(t);const p={get manifest(){throw Error('synthetic first getter')}};await assert.rejects(w.run({profile:p}),/synthetic first getter/);
 assert.equal(w.stops,1);assert.equal(w.calls.length,0);assert.notEqual(w.owner.summary().state.run.stopped,null);
});
test('malformed preparation has no I/O and cannot leave the owner reusable',async t=>{
 const w=await world(t);await assert.rejects(w.run({preparation:undefined}));assert.equal(w.stops,1);assert.equal(w.calls.length,0);assert.throws(()=>w.owner.beginComparison());
});
test('concurrent whole wrapper cannot terminate the leader or start another request',async t=>{
 let enter,release;const entered=new Promise(r=>enter=r),pending=new Promise(r=>release=r);
 const w=await world(t,{step:async()=>{enter();await pending;}}),leader=w.run();await entered;
 await assert.rejects(w.run({profile:null}),/comparison_already_started/);assert.equal(w.stops,0);assert.equal(w.calls.length,0);
 release();await assert.rejects(leader,/product_dispatch_not_received/);assert.equal(w.stops,1);
});
test('native C preflight LIST is setup-only and cannot authorize foreign graphs or arbitrary projections',async t=>{
 const w=await world(t);w.owner.beginComparison();w.owner.beginSetup();const request={method:'POST',url:w.profile.origins.readBase+'/graph/episodes/graph/'+w.profile.manifest.topology[0].graphId,body:{order_by:'uuid',direction:'asc'},maxRetries:0};
 const a={number:1,kind:'read',status:'attempted',response:null,request};assert.equal(w.owner.recordPreflightAttempt(a),true);
 assert.equal(w.owner.recordBudgetOutcome(1,{status:'received',httpStatus:200,response:'[]',latencyMs:0}),true);
 assert.throws(()=>validateDRequest({id:'read:1',kind:'read',request,estimate:0},trialPolicy(w.profile)));
 for(const r of [{...request,url:request.url.replace(w.profile.manifest.topology[0].graphId,'foreign')},{...request,body:{...request.body,filter:'unbounded'}},{...request,body:{direction:'desc',order_by:'uuid'}}])
  assert.throws(()=>w.owner.recordPreflightAttempt({...a,number:2,request:r}));
 assert.equal(w.calls.length,0);assert.equal(w.owner.summary().state.attempts.length,1);w.owner.stop('native-list-control-end');
});
test('outer profile getter cannot throw before owner lifetime acquisition',async t=>{
 const w=await world(t);const input={owner:w.owner,get profile(){throw Error('outer profile failure')}};
 await assert.rejects(runWholeTrial(input),/outer profile failure/);assert.equal(w.stops,1);assert.equal(w.calls.length,0);
 assert.notEqual(w.owner.summary().state.run.stopped,null);assert.throws(()=>w.owner.admitWrite(w.profile.writePermits[0].id,w.profile.writePermits[0].request));
});
test('outer current/record input access is in the same acquired termination duty',async t=>{
 const w=await world(t);await assert.rejects(runWholeTrial({owner:w.owner,profile:w.profile,get current(){throw Error('outer current failure')}}),/outer current failure/);
 assert.equal(w.stops,1);assert.equal(w.calls.length,0);await assert.rejects(w.run(),/comparison_already_started/);assert.equal(w.stops,1);
});

for(const sanitized of [false,true])test(`whole transfer preserves ${sanitized?'private safe category':'first request identity'} and settlement refusal; unknown cannot replay`,async t=>{
  const w=await world(t,{step:async({permit,transport})=>transport.write(permit.request)});
  const nativeError=new Error('synthetic native first failure');let primary=null,dispatches=0;
  const fetchImpl=async(request,init)=>{
    dispatches++;
    try{
      if(sanitized)return await privateHttpRequest({profile:w.profile,
        credentials:{zepSettings:{apiKey:'synthetic-only'},answerKey:'synthetic-only'},permit:w.profile.writePermits[0],request,init,
        fetchImpl:async()=>{throw nativeError;}});
      throw nativeError;
    }catch(error){primary=error;throw error;}
  };
  await assert.rejects(w.run({fetchImpl}),error=>{
    assert.ok(error instanceof AggregateError);assert.equal(error.message,'whole_trial_request_and_settlement_failed');
    assert.equal(error.errors.length,2);assert.equal(error.errors[0],primary);assert.notEqual(error.errors[1],primary);
    assert.equal(error.errors[1].name,'Held');assert.equal(error.errors[1].message,'budget_outcome_unknown');
    if(sanitized){assert.notEqual(primary,nativeError);assert.equal(primary.name,'Held');assert.equal(primary.message,'private_http_request_failed');assert.equal(primary.cause,undefined);}
    else assert.equal(primary,nativeError);
    return true;
  });
  const state=w.owner.summary().state,attempt=state.attempts[0];
  assert.ok(state.run.claim);assert.equal(state.run.stopped,'unknown_or_authority_lost');assert.equal(state.attempts.length,1);
  assert.equal(attempt.outcome,'unknown');assert.equal(attempt.status,null);assert.equal(attempt.response_bytes,0);
  assert.equal(state.permits.find(p=>p.id===attempt.permit).consumed,1);
  const capture=JSON.parse(attempt.capture);assert.equal(capture.known,false);assert.equal(capture.truncated,false);
  assert.equal(w.calls.length,0);assert.equal(w.models,0);assert.equal(dispatches,1);assert.equal(w.stops,1);assert.equal(w.events.filter(e=>e.kind==='finish').length,0);
  const before=canonical(state);await assert.rejects(w.run(),/comparison_already_started/);
  assert.equal(canonical(w.owner.summary().state),before);assert.equal(dispatches,1);assert.equal(w.stops,1);
});

const dropFirst=(match,how)=>{let dropped=null;return ({method,path,n})=>dropped===null && match(method,path)?(dropped=n,how):null;};
test('a read whose connection the other side closed before any answer is asked once more as an attempt of its own; the trial completes',async t=>{
  const w=await world(t,{drop:dropFirst((method,path)=>method==='GET' && /^\/graph\/episodes\//.test(path),'before')});
  const result=await w.run({settleIntervalMs:1});assert.equal(result.status,'captured-unjudged');
  assert.equal(result.summary.reads,54+404+1,'one more read for the one closed connection');assert.equal(w.episodes.length,34);assert.equal(w.models,264);
  const unknown=result.durableTrial.state.attempts.filter(a=>a.outcome==='unknown');assert.equal(unknown.length,1);
  assert.equal(JSON.parse(unknown[0].capture).uncertainty,'connection_closed_before_response');
  assert.equal(result.durableTrial.state.attempts.length,74+458+1+264);
});
test('an episode write whose connection closed before the receipt is settled later: absent in its graph, written once more, one ACK',async t=>{
  const w=await world(t,{drop:dropFirst((method,path)=>method==='POST' && path==='/graph','before'),
    step:({phase,defaultStep,w})=>{if(phase==='settle')w.wall+=UNKNOWN_REPLAY_WAIT_MS;return defaultStep();}});
  const result=await w.run({settleIntervalMs:1});assert.equal(result.status,'captured-unjudged');
  assert.equal(w.calls.filter(c=>c.path==='/graph').length,35,'the lost write and its one replay');assert.equal(w.episodes.length,34);assert.equal(w.models,264);
  const state=result.durableTrial.state,unknown=state.attempts.filter(a=>a.outcome==='unknown');assert.equal(unknown.length,1);
  assert.deepEqual(state.attempts.filter(a=>a.permit===unknown[0].permit).map(a=>a.outcome),['unknown','received']);
  assert.equal(state.permits.find(p=>p.id===unknown[0].permit).consumed,2);
  const dropped=w.calls.findIndex(c=>c.path==='/graph'),graph=w.calls[dropped].body.graph_id;
  assert.ok(w.calls.slice(dropped+1).some(c=>c.method==='POST'&&c.path==='/graph/episodes/graph/'+encodeURIComponent(graph)),'a listing of the graph after the lost write');
  assert.ok(w.calls.findLastIndex(c=>c.path==='/graph'&&c.body.graph_id===graph)>dropped,'the replay came after it');
});
test('an episode that landed while the connection closed is read back; the listing is its receipt and nothing is written twice',async t=>{
  const w=await world(t,{drop:dropFirst((method,path)=>method==='POST' && path==='/graph','after')});
  const result=await w.run({settleIntervalMs:1});assert.equal(result.status,'captured-unjudged');
  assert.equal(w.calls.filter(c=>c.path==='/graph').length,34,'no second write');assert.equal(w.episodes.length,34);assert.equal(w.models,264);
  const state=result.durableTrial.state,unknown=state.attempts.filter(a=>a.outcome==='unknown');assert.equal(unknown.length,1);
  assert.equal(state.attempts.filter(a=>a.permit===unknown[0].permit).length,1);
  const ack=JSON.parse(state.bindings.find(b=>b.name==='ingestion-acks').value),bound=ack.episodes.find(e=>e.permitId===unknown[0].permit);
  assert.ok(bound && w.episodes.some(ep=>ep.uuid===bound.uuid),'the ACK names the episode the server kept');
});
test('a second write of an episode without a listing that shows it absent is refused before any HTTP',async t=>{
  const w=await world(t,{drop:dropFirst((method,path)=>method==='POST' && path==='/graph','before'),
    step:async({phase,permits,defaultStep,client})=>{
      if(phase!=='settle')return defaultStep();
      const permit=permits[0],member=w.profile.payloads.rows.flatMap(r=>r.members).find(m=>m.opId===permit.request.body.metadata.op_id);
      const response=await client().graph.add(member.payload.request,{maxRetries:0});return {state:'accepted',externalIds:[response.uuid]};
    }});
  await assert.rejects(w.run({settleIntervalMs:1}),/replay_forbidden/);
  assert.equal(w.calls.filter(c=>c.path==='/graph').length,34,'the lost write counted; the second never left');assert.equal(w.stops,1);assert.equal(w.models,0);
});

test('a listing within the product\'s wait after the lost write cannot license a replay; the second write never leaves',async t=>{
  const w=await world(t,{drop:dropFirst((method,path)=>method==='POST' && path==='/graph','before')});
  await assert.rejects(w.run({settleIntervalMs:1}),/replay_forbidden/);
  assert.equal(w.calls.filter(c=>c.path==='/graph').length,34,'the lost write counted; the early replay never left');assert.equal(w.stops,1);assert.equal(w.models,0);
});

test('the private HTTP wrapper passes a closed connection on as its own class, with no transport text, and hides everything else',async t=>{
  const w=await world(t);const permit=w.profile.writePermits.find(p=>p.kind==='episode');
  const call=error=>privateHttpRequest({profile:w.profile,credentials:{zepSettings:{apiKey:'synthetic-only'},answerKey:'synthetic-only'},permit,
    request:permit.request.url,init:{method:'POST',body:JSON.stringify(permit.request.body)},fetchImpl:async()=>{throw error;}});
  const closed=new TypeError('fetch failed',{cause:Object.assign(new Error('other side closed SECRET-HOST'),{code:'UND_ERR_SOCKET'})});
  await assert.rejects(call(closed),error=>{
    assert.ok(error instanceof ConnectionClosedBeforeResponse);assert.equal(connectionClosedBeforeResponse(error),true);
    assert.ok(!String(error.message).includes('SECRET')&&error.cause===undefined,'no transport text crosses');return true;});
  await assert.rejects(call(Object.assign(new Error('connect ECONNREFUSED SECRET-HOST'),{code:'ECONNREFUSED',syscall:'connect'})),
    error=>error.name==='Held'&&error.message==='private_http_request_failed'&&!(error instanceof ConnectionClosedBeforeResponse));
});

test('the first read after the ingestion waits the named quiet time after the last write',async t=>{
  const w=await world(t),wait=400,result=await w.run({readAfterIngestionMs:wait});assert.equal(result.status,'captured-unjudged');
  const lastWrite=w.calls.findLastIndex(c=>c.method==='POST'&&c.path==='/graph'),firstSearch=w.calls.findIndex(c=>c.path==='/graph/search');
  assert.ok(lastWrite>=0 && firstSearch>lastWrite,'every episode is written before the first search');
  const gaps=w.calls.slice(lastWrite+1,firstSearch+1).map((c,i)=>c.at-w.calls[lastWrite+i].at);
  assert.ok(Math.max(...gaps)>=wait,'no quiet time between the last write and the first search');
  assert.equal(READ_AFTER_INGESTION_MS,60_000);
});
