// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import {fields,integer} from '../memory-retrieval-comparison-d3/contracts.mjs';

const ADDITIONAL_SERVER_EVENTS=['additional-server-constructor-attempt','additional-server-returned','additional-server-start-attempt','additional-server-start-returned',
  'additional-server-close-attempt','additional-server-close-returned','additional-server-close-event','additional-server-close-checked'];
const empty=(v,reason)=>assert.ok(Array.isArray(v)&&v.length===0,reason);

export function verifyAdditionalServers(closure,{fixtureId,processId}={}){
  assert.ok(Array.isArray(closure.additionalServers)&&Array.isArray(closure.records),'fixture_closure_additional_server_missing');
  integer(closure.maximumRecords,1,4096);
  assert.ok(closure.recordCount===closure.records.length&&closure.records.length<=closure.maximumRecords&&closure.dropped===0&&closure.truncated===false,'fixture_closure_trace_incomplete');
  for(const [index,r]of closure.records.entries())assert.ok(r.sequence===index+1&&typeof r.event==='string','fixture_closure_trace_incomplete');
  const rows=closure.additionalServers,trace=closure.records.filter(r=>typeof r.event==='string'&&r.event.startsWith('additional-server-'));
  if(rows.length){assert.ok(typeof fixtureId==='string'&&fixtureId.length>0,'fixture_closure_origin_missing');integer(processId,1,0xffffffff);}
  const observed=new Map();
  for(const r of trace){
    fields(r,['sequence','event','additionalServer']);integer(r.sequence,1,Number.MAX_SAFE_INTEGER);integer(r.additionalServer,1,rows.length);
    assert.ok(ADDITIONAL_SERVER_EVENTS.includes(r.event),'fixture_closure_additional_server_event_unknown');
    const key=r.additionalServer+':'+r.event;assert.ok(!observed.has(key),'fixture_closure_additional_server_duplicate_event');observed.set(key,r.sequence);
  }
  const sequence=(ordinal,event)=>{const value=observed.get(ordinal+':'+event);assert.ok(value!==undefined,'fixture_closure_additional_server_event_missing');return value;};
  for(const [index,r]of rows.entries()){
    fields(r,['schema','fixtureId','ordinal','processId','role','constructorAttempted','constructorReturned','startAttempted','startReturned',
      'closeAttempts','closeCallReturned','closeEventObserved','listeningAfterClose','closed','loggerCategories','categories']);
    assert.ok(r.schema==='owned-additional-human-server-v1'&&r.role==='human-server'&&r.ordinal===index+1&&r.fixtureId===fixtureId&&r.processId===processId,'fixture_closure_additional_server_origin_changed');
    assert.ok(r.constructorAttempted===true&&r.constructorReturned===true&&r.startAttempted===true&&r.startReturned===true&&r.closeAttempts===1&&
      r.closeCallReturned===true&&r.closeEventObserved===true&&r.listeningAfterClose===false&&r.closed===true,'fixture_closure_additional_server_close_unknown');
    empty(r.loggerCategories,'fixture_closure_additional_server_logger');empty(r.categories,'fixture_closure_additional_server_lifecycle');
    const at=event=>sequence(r.ordinal,event),[constructed,returned,start,started,closing,closeReturned,closed,checked]=ADDITIONAL_SERVER_EVENTS.map(at);
    assert.ok(constructed<returned&&returned<start&&start<started&&started<closing&&closing<closeReturned&&closing<closed&&closeReturned<checked&&closed<checked,'fixture_closure_additional_server_order');
  }
  assert.ok(observed.size===rows.length*ADDITIONAL_SERVER_EVENTS.length,'fixture_closure_trace_incomplete');
}

export function closureDiagnosis(v){
  try{
    const list=a=>Array.isArray(a)&&a.length?a.join(','):'-';
    const hubs=(Array.isArray(v?.hubs)?v.hubs:[]).map(h=>`hub${h.ordinal}{closed=${h.closed} resolved=${h.shutdownResolved} cat=${list(h.categories)} stages=${
      (Array.isArray(h.stages)?h.stages:[]).map(s=>`${s.stage}:${s.ms===null?'?':Math.round(s.ms)}${s.timedOut?'T':''}`).join(' ')||'-'}}`);
    const extra=(Array.isArray(v?.additionalServers)?v.additionalServers:[]).filter(a=>a.categories?.length).map(a=>`server${a.ordinal}{cat=${list(a.categories)}}`);
    return [`status=${v?.status} phase=${v?.cleanupPhase} removed=${v?.directoryRemoved} cat=${list(v?.categories)}`,...hubs,...extra].join(' ');
  }catch{return 'diagnosis unavailable';}
}

export function validateReturnedFixtureClosure(v,origin={}){
  fields(v,['schema','actualD','status','cleanupPhase','maximumRecords','recordCount','dropped','truncated','serverCloseObservationMs','productShutdownStageMs','rootAttempted','rootReturned','trialAttempted','trialReturned','directoryRemoved','server','hubs','additionalServers','categories','records']);
  assert.ok(v.schema==='owned-configured-hub-fixture-closure-v1'&&v.actualD==='NOT_RUN'&&v.status==='closed'&&v.cleanupPhase==='complete'&&v.directoryRemoved===true,`fixture_closure_not_closed: ${closureDiagnosis(v)}`);
  assert.ok(v.rootAttempted===true&&v.rootReturned===true&&typeof v.trialAttempted==='boolean'&&v.trialAttempted===v.trialReturned&&v.dropped===0&&v.truncated===false,'fixture_closure_unknown');
  if(Array.isArray(v.categories)&&v.categories.length)assert.fail(`fixture_closure_categories: ${closureDiagnosis(v)}`);
  empty(v.categories,'fixture_closure_categories');
  assert.ok(Array.isArray(v.records)&&v.recordCount===v.records.length&&v.recordCount<=v.maximumRecords,'fixture_closure_trace_incomplete');
  for(const [i,r]of v.records.entries())assert.ok(r.sequence===i+1&&typeof r.event==='string','fixture_closure_trace_sequence');
  verifyAdditionalServers(v,origin);
  fields(v.server,['constructorAttempted','constructorReturned','startAttempted','startReturned','stopAttempts','closed']);
  assert.ok(v.server.constructorAttempted===true&&v.server.constructorReturned===true&&v.server.startAttempted===true&&v.server.startReturned===true&&v.server.closed===true&&
    Number.isSafeInteger(v.server.stopAttempts)&&v.server.stopAttempts>=0&&v.server.stopAttempts<=1&&v.records.some(r=>r.event==='server-close'),'fixture_closure_server_close_unknown');
  assert.ok(Array.isArray(v.hubs)&&v.hubs.length>0,'fixture_closure_hub_missing');const ordinals=new Set();
  for(const h of v.hubs){
    fields(h,['ordinal','constructorAttempted','constructorReturned','shutdownAttempts','shutdownResolved','closed','stages','categories']);integer(h.ordinal,1,Number.MAX_SAFE_INTEGER);
    assert.ok(!ordinals.has(h.ordinal),'fixture_closure_duplicate_hub');ordinals.add(h.ordinal);empty(h.categories,'fixture_closure_hub_categories');
    assert.ok(h.constructorAttempted===true&&h.constructorReturned===true&&h.shutdownAttempts===1&&h.shutdownResolved===true&&h.closed===true,'fixture_closure_hub_shutdown_unknown');
    assert.ok(Array.isArray(h.stages)&&h.stages.length>0&&h.stages.at(-1).stage==='history'&&h.stages.filter(s=>s.stage==='history').length===1,'fixture_closure_history_close_unknown');
    for(const s of h.stages){fields(s,['stage','ms','timedOut']);assert.ok(typeof s.stage==='string'&&s.stage!=='other'&&typeof s.ms==='number'&&Number.isFinite(s.ms)&&s.ms>=0&&s.timedOut===false,'fixture_closure_shutdown_stage_unknown');}
  }
}
