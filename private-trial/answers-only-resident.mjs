// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readPrivateTrialDeployment,validateResidentDeployment} from '../dist/memory/private-trial-deployment.js';
import {answersOnlyProfile,answersOnlyPolicy,runAnswersOnly} from './memory-retrieval-trial-d5/answers-only.mjs';
import {configuredCredentialClosure} from './memory-retrieval-trial-d5/configured-caller.mjs';
import {RunJournal} from './trial-journal/journal.mjs';
import {canonical,json,encode} from './memory-retrieval-comparison-d3/contracts.mjs';
import {createPreparationLifetime,createResidentFences} from './resident-lifecycle.mjs';
import {refusalAsNo,readPinned} from './trial-journal/policy-assert.mjs';

export const ANSWERS_ONLY_INPUTS_FOLDER='private-trial-answers-only-inputs';
export const ANSWERS_ONLY_ROOT='private-trial-answers-only';
export const ANSWERS_ONLY_INPUTS_SCHEMA='viberoom-answers-only-inputs-v1';
export const ANSWERS_ONLY_DISCLOSURE='answers-only-budget-disclosure-v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=value=>hash(encode(value));
const fixedError=code=>Object.assign(new Error(code),{code});
const requireTrue=(value,code)=>{if(!value)throw fixedError(code);};
function exactKeys(value,names,code){requireTrue(value&&typeof value==='object'&&!Array.isArray(value)&&canonical(Object.keys(value).sort())===canonical([...names].sort()),code);return value;}
function selection(input){
  const chosen=exactKeys(json(input),['answerKeyOwner','answerEndpoint','answerModel'],'selection_fields');
  requireTrue(chosen.answerKeyOwner==='memory.filter.apiKey','answer_owner_required');
  const endpoint=new URL(chosen.answerEndpoint);
  requireTrue(!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash&&['http:','https:'].includes(endpoint.protocol),'answer_endpoint_refused');
  return json({...chosen,answerEndpoint:endpoint.href});
}
function artifact(root,name,value){
  const file=path.join(root,name),bytes=encode(value),fd=fs.openSync(file,'wx');
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {name,path:file,sha256:hash(bytes),bytes:bytes.length};
}
function readInputs(dataDir){
  const folder=path.join(dataDir,ANSWERS_ONLY_INPUTS_FOLDER);
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'ANSWERS-ONLY-INPUTS.json'),'utf8'));
  exactKeys(manifest,['schema','answerControls','limits','files'],'answers_only_inputs_manifest');requireTrue(manifest.schema===ANSWERS_ONLY_INPUTS_SCHEMA,'answers_only_inputs_manifest');
  requireTrue(Array.isArray(manifest.files)&&manifest.files.length>=1,'answers_only_inputs_manifest');
  const names=new Set(['ANSWERS-ONLY-INPUTS.json']);
  const inputs=manifest.files.map(f=>{
    exactKeys(f,['name','file','sha256'],'answers_only_inputs_manifest');requireTrue(/^[A-Z]$/.test(f.name)&&f.file===`${f.name}.requests.json`,'answers_only_inputs_manifest');
    const bytes=fs.readFileSync(path.join(folder,f.file));requireTrue(hash(bytes)===f.sha256,'answers_only_input_changed');names.add(f.file);
    return {name:f.name,bytes};
  });
  requireTrue(canonical(fs.readdirSync(folder).sort())===canonical([...names].sort()),'answers_only_inputs_exact_file_set');
  return {manifest,inputs};
}
function disclosure({review,profile,policy,inputs}){
  const bytes=inputs.flatMap(i=>JSON.parse(i.bytes.toString('utf8'))).reduce((n,r)=>n+r.request.messages.reduce((m,x)=>m+Buffer.byteLength(x.content),0),0);
  const perRequest=profile.answerControls.requestProfile.maxCompletionTokens;
  return json({schema:ANSWERS_ONLY_DISCLOSURE,purpose:review.purpose,reviewer:json(review.reviewer),
    answer:{model:profile.answerControls.model,endpoint:profile.origins.answerEndpoint,requestProfile:json(profile.answerControls.requestProfile)},
    requests:{model:profile.jobs.length},maxOutputTokensPerRequest:perRequest,maxOutputTokens:perRequest*profile.jobs.length,
    inputTextUtf8Bytes:bytes,inputTokensReference:'D4b: 132 295 input tokens for its 88 auto-raw requests over the same questions',
    zep:{requests:0,credits:policy.limits.localEstimatedCredits},runMs:policy.limits.runMs,
    inputs:profile.inputs.map(i=>({name:i.name,sha256:i.sha256,records:i.records})),variantKey:'kept apart; not in this run'});
}

export function createAnswersOnlyPreparation(hub,deployment){
  requireTrue(hub&&hub.memoryStore&&typeof hub.memoryAnswerContext==='function','resident_hub_required');
  const trusted=validateResidentDeployment(deployment),ownerRoot=path.join(hub.dataDir,ANSWERS_ONLY_ROOT);
  const lifetime=createPreparationLifetime(ownerRoot);let retained=null,lastReason=null;
  function inspect(input){
    const d=readPrivateTrialDeployment(hub,trusted);requireTrue(d.review.purpose==='approved-paid-answers-only','resident_purpose_not_answers_only');
    const chosen=selection(input),context=hub.memoryAnswerContext(chosen),snapshot=context.snapshot();
    requireTrue(snapshot,'answer_model_not_selected');
    const {manifest,inputs}=readInputs(hub.dataDir);
    requireTrue(manifest.answerControls.model===chosen.answerModel,'answers_only_model_not_selected');
    return {d,chosen,context,snapshot,manifest,inputs};
  }
  function status(input){
    try{
      if(lifetime.phase==='REFUSED')return {state:'NOT_READY',reason:lastReason??'preparation_acquisition_refused',launchEnabled:false};
      if(retained&&!retained.fences.beforeOffer())return {state:'NOT_READY',reason:'prepared_owner_changed',launchEnabled:false};
      const w=inspect(input);
      if(!retained&&fs.existsSync(ownerRoot))return {state:'NOT_READY',reason:'preparation_root_exists',launchEnabled:false};
      return {state:retained?'PREPARED':'PAID_PREPARATION_READY',purpose:w.d.review.purpose,launchEnabled:false,phase:lifetime.phase,
        answer:json(w.snapshot.answer),inputs:w.manifest.files.map(f=>({name:f.name,sha256:f.sha256})),
        prepared:retained?{requests:retained.profile.jobs.length,cardSha256:retained.cardOwner.cardSha256}:null};
    }catch{return {state:'NOT_READY',reason:'answers_only_inputs_or_answer_model_not_ready',launchEnabled:false};}
  }
  function prepare(input){
    requireTrue(lifetime.phase==='EMPTY'&&!fs.existsSync(ownerRoot),'preparation_not_repeatable');
    const w=inspect(input);
    try{
      lifetime.begin();
      let active=true;
      const profile=answersOnlyProfile({inputs:w.inputs,answerControls:w.manifest.answerControls,answerEndpoint:w.chosen.answerEndpoint,limits:w.manifest.limits});
      const policy=answersOnlyPolicy(profile);
      const profilePin=artifact(ownerRoot,'PROFILE.json',profile);
      const cardOwner=RunJournal.prepare(ownerRoot,policy),cardPin=artifact(ownerRoot,'CARD.json',cardOwner);
      const artifacts=[profilePin,cardPin];
      const artifactCurrent=()=>artifacts.every(p=>{const bytes=readPinned(p.path);return bytes!==null&&bytes.length===p.bytes&&hash(bytes)===p.sha256;});
      const liveCurrent=()=>refusalAsNo(()=>{
        if(!active)return false;const now=inspect(input);
        return canonical(now.snapshot)===canonical(w.snapshot)&&canonical(now.d.review)===canonical(w.d.review)&&canonical(now.manifest)===canonical(w.manifest);
      });
      const beforeClaim=()=>refusalAsNo(()=>{const stored=RunJournal.inspect(ownerRoot);
        return stored.cardSha256===cardOwner.cardSha256&&stored.state.run.claim===null&&stored.state.run.stopped===null&&stored.state.attempts.length===0;});
      const fences=createResidentFences({liveCurrent,artifactCurrent,beforeClaim});
      requireTrue(fences.beforeOffer(),'configured_owner_changed');
      const shown=disclosure({review:w.d.review,profile,policy,inputs:w.inputs});
      retained={profile,policy,cardOwner,artifacts,fences,disclosure:shown,w,revoke:()=>{active=false;},
        card:json({schema:cardOwner.schema,cardSha256:cardOwner.cardSha256,policySha256:sha(policy),profileSha256:profilePin.sha256,disclosure:shown,
          limits:json(policy.limits),offerCreated:false,launchEnabled:false,approvalReceiptVerifier:'HUMAN_CARD_REQUIRED'})};
      lifetime.complete();return {state:'PREPARED',launchEnabled:false,card:json(retained.card),artifacts:json(artifacts)};
    }catch(error){lifetime.refuse();lastReason='preparation_failed_retained_no_retry';throw Object.assign(fixedError(lastReason),{cause:error});}
  }
  function card(){
    requireTrue(lifetime.phase==='PREPARED'&&retained&&retained.fences.beforeOffer(),'prepared_card_not_current');
    return {state:'PREPARED',launchEnabled:false,card:json(retained.card),artifacts:json(retained.artifacts)};
  }
  function budgetSubject(){
    requireTrue(lifetime.phase==='PREPARED'&&retained&&retained.fences.beforeOffer(),'paid_budget_not_ready');
    const r=retained;
    const snapshot=()=>json({cardSha256:r.cardOwner.cardSha256,root:r.cardOwner.root,policy:r.cardOwner.policy,disclosure:r.disclosure});
    return Object.freeze({snapshot,current:r.fences.beforeOffer,ready:r.fences.current,revoke:r.revoke,
      start:(approval,verifyApproval)=>{
        requireTrue(r.fences.current()&&r.fences.beforeOffer(),'paid_budget_not_current');
        let sequence=0;
        const record=(kind,value)=>{requireTrue(++sequence<=10000,'trial_evidence_event_cap');artifact(ownerRoot,'EVENT-'+String(sequence).padStart(5,'0')+'.json',{kind,value:json(value)});};
        const loadCredentials=configuredCredentialClosure({hub,selected:r.w.chosen,ownerRoot,profile:r.policy.identity,answerOnly:true,
          readSnapshot:()=>({account:r.w.context.snapshot()?.configurationRevision??null})});
        const completion=runAnswersOnly({root:ownerRoot,profile:r.profile,inputs:r.w.inputs,approval,verifyApproval,current:r.fences.current,
          loadCredentials,record}).then(result=>{artifact(ownerRoot,'RESULT.json',result);return result;});
        const stored=RunJournal.inspect(ownerRoot),claimId=stored.state.run.claim;
        if(typeof claimId!=='string'||canonical(JSON.parse(stored.state.run.approval??'null'))!==canonical(approval)){
          void completion.catch(()=>{});r.revoke();throw fixedError('synchronous_claim_missing');
        }
        return {claimId,completion};
      }});
  }
  return Object.freeze({status,prepare,card,budgetSubject});
}
