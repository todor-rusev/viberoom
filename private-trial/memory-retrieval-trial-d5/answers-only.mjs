// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {createHash} from 'node:crypto';
import assert from '../trial-journal/policy-assert.mjs';
import invariant from 'node:assert/strict';
import {RunJournal} from '../trial-journal/journal.mjs';
import {RunBudget,PROMPT,json,canonical,Held} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {createHttpAnswerPort} from '../memory-retrieval-comparison-d3/ports.mjs';
import {captureAnswerControls,buildAnswerRequest} from '../memory-retrieval-comparison-d3/answer-profile.mjs';
import {privateHttpRequest} from './private-launch.mjs';

export const ANSWERS_ONLY_SCHEMA='viberoom-answers-only-profile-v1';
export const ANSWERS_ONLY_RESULT='viberoom-answers-only-result-v1';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const bodySha=body=>sha256(JSON.stringify(body));
const finishReasonOf=(budget,number)=>{
  const raw=budget.attempts.find(a=>a.number===number)?.response;
  try{const reason=JSON.parse(raw).choices?.[0]?.finish_reason;return typeof reason==='string'?reason:null;}catch{return null;}
};
const safeText=(value,max)=>String(value??'').replace(/(authorization|bearer|api[-_ ]?key)[^,;]*/gi,'[removed]').slice(0,max);
const fields=(value,names)=>assert.ok(value&&typeof value==='object'&&!Array.isArray(value)&&canonical(Object.keys(value).sort())===canonical([...names].sort()),'answers_only_fields');

export function answersOnlyProfile({inputs,answerControls,answerEndpoint,limits}){
  const controls=captureAnswerControls(answerControls),endpoint=new URL(answerEndpoint);
  assert.ok(!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'answers_only_endpoint');
  fields(limits,['maxRequestBytes','maxResponseBytes','maxAggregateBytes','requestMs','runMs']);
  for(const v of Object.values(limits))assert.ok(Number.isSafeInteger(v)&&v>=1,'answers_only_limits');
  assert.ok(Array.isArray(inputs)&&inputs.length>=1,'answers_only_inputs');
  const files=[],jobs=[],names=new Set();
  for(const input of inputs){
    fields(input,['name','bytes']);assert.ok(/^[A-Z]$/.test(input.name)&&!names.has(input.name),'answers_only_input_name');names.add(input.name);
    const rows=JSON.parse(Buffer.from(input.bytes).toString('utf8'));assert.ok(Array.isArray(rows)&&rows.length>=1,'answers_only_rows');
    for(const row of rows){
      fields(row,['order','questionId','profile','query','context','contextChars','request','requestSha256']);
      const built=buildAnswerRequest(controls,{prompt:PROMPT,question:row.query,context:row.context}).body;
      assert.equal(canonical(built),canonical(row.request),'answers_only_request_not_rebuilt');
      assert.equal(bodySha(built),row.requestSha256,'answers_only_frozen_hash');
      jobs.push(Object.freeze({job:jobs.length+1,file:input.name,order:row.order,questionId:row.questionId,profile:row.profile,requestSha256:row.requestSha256}));
    }
    files.push(Object.freeze({name:input.name,sha256:sha256(input.bytes),records:rows.length}));
  }
  return Object.freeze({schema:ANSWERS_ONLY_SCHEMA,inputs:Object.freeze(files),answerControls:controls,
    origins:Object.freeze({answerEndpoint:endpoint.href}),limits:Object.freeze(json(limits)),jobs:Object.freeze(jobs)});
}

export function answersOnlyPolicy(profile){
  return json({schema:'viberoom-trial-journal-policy-v1',identity:{schema:ANSWERS_ONLY_SCHEMA,profileSha256:sha256(canonical(profile))},
    kinds:{model:profile.jobs.length},limits:{localEstimatedCredits:0,maxRequestBytes:profile.limits.maxRequestBytes,
      maxResponseBytes:profile.limits.maxResponseBytes,maxAggregateBytes:profile.limits.maxAggregateBytes,runMs:profile.limits.runMs}});
}

export function answersOnlyRequestValidator(profile){
  return permit=>{
    if(permit.kind!=='model'||permit.estimate!==0)return false;
    const match=/^model:(\d+):([a-f0-9]{64})$/.exec(permit.id),job=match?profile.jobs[Number(match[1])-1]:undefined;if(!job||match[2]!==job.requestSha256)return false;
    const r=permit.request;
    return r?.method==='POST'&&r.url===profile.origins.answerEndpoint&&r.maxRetries===0&&canonical(Object.keys(r).sort())===canonical(['body','maxRetries','method','url'])&&bodySha(r.body)===job.requestSha256;
  };
}

export async function runAnswersOnly({root,profile,inputs,approval,verifyApproval,current,loadCredentials,fetchImpl=globalThis.fetch,purpose='approved-job',record=()=>{},clock=()=>performance.now()}){
  invariant.equal(typeof loadCredentials,'function');invariant.equal(typeof current,'function');invariant.equal(typeof record,'function');
  const rebuilt=answersOnlyProfile({inputs,answerControls:profile.answerControls,answerEndpoint:profile.origins.answerEndpoint,limits:profile.limits});
  assert.equal(canonical(rebuilt),canonical(profile),'answers_only_inputs_changed');
  const rows=inputs.flatMap(input=>JSON.parse(Buffer.from(input.bytes).toString('utf8')));
  const live=()=>current()===true;
  const journal=RunJournal.claim(root,{approval,verifyApproval,current:live,validateRequest:answersOnlyRequestValidator(profile),clock});
  const records=[];let job=0,admitted=null,stopped=null,failure=null,budget=null;const handles=new Map();
  try{
    const credentials=await loadCredentials({claimId:journal.claim(),signal:new AbortController().signal});
    budget=new RunBudget({maxReads:1,maxModelCalls:profile.jobs.length,maxPagesPerCollection:1,pageSize:1,maxResponseBytes:profile.limits.maxResponseBytes,
      maxAggregateBytes:profile.limits.maxAggregateBytes,requestMs:profile.limits.requestMs,runMs:profile.limits.runMs,maxNodes:1,edgeLimit:1,autoMaxCharacters:1},clock,
      attempt=>{
        assert.equal(attempt.kind,'model','answers_only_kind');
        const request=json(attempt.request);delete request.inputTextUtf8Bytes;delete request.requestUtf8Bytes;
        const id=`model:${job}:${profile.jobs[job-1].requestSha256}`;journal.permit({id,kind:'model',request,estimate:0});
        handles.set(attempt.number,journal.admit(id,request));admitted={kind:'model',request};return true;
      },
      attempt=>{
        const known=attempt.status==='received'&&typeof attempt.response==='string';
        journal.outcome(handles.get(attempt.number),{status:attempt.httpStatus??null,raw:typeof attempt.response==='string'?attempt.response:'',latencyMs:attempt.latencyMs??null,known});
        return true;
      });
    const port=createHttpAnswerPort({endpointUrl:profile.origins.answerEndpoint,answerControls:profile.answerControls,purpose,
      approvedOrigin:new URL(profile.origins.answerEndpoint).origin,budget,current:live,apiKey:null,
      fetchImpl:(url,init)=>privateHttpRequest({profile,credentials,permit:admitted,request:url,init,fetchImpl})});
    for(const j of profile.jobs){
      job=j.job;const row=rows[j.job-1];
      const answer=await port.answer({prompt:PROMPT,question:row.query,context:row.context,approval:'approved-job'});
      const kept={job:j.job,file:j.file,order:j.order,questionId:j.questionId,profile:j.profile,requestSha256:j.requestSha256,attempt:answer.attempt,
        answer:answer.answer,finishReason:finishReasonOf(budget,answer.attempt),usage:answer.usage,latencyMs:answer.latencyMs,serviceTier:answer.serviceTier};
      records.push(kept);record('answer',{job:j.job,file:j.file,requestSha256:j.requestSha256,attempt:answer.attempt});
    }
  }catch(error){
    const last=budget?.attempts.at(-1)??null;
    stopped=error?.name==='Held'?error.message:'answers_only_failed';
    failure={name:safeText(error?.name??'Error',80),message:safeText(error?.message,200),httpStatus:last?.httpStatus??null,attempt:last?.number??null,job};
  }
  finally{
    try{journal.stop(stopped??'answers_only_finished');}catch{}
    journal.close();
  }
  return json({schema:ANSWERS_ONLY_RESULT,profileSha256:sha256(canonical(profile)),complete:stopped===null&&records.length===profile.jobs.length,stopped,failure,records});
}
export {Held};
