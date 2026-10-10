// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readPrivateTrialDeployment,validateResidentDeployment} from '../dist/memory/private-trial-deployment.js';
import {createIsolatedSource} from './memory-retrieval-trial-d5/isolated-source.mjs';
import {prepareIsolatedProductProfile} from './memory-retrieval-trial-d5/product-profile.mjs';
import {createConfiguredNativeCaller} from './memory-retrieval-trial-d5/configured-native-caller.mjs';
import {launchBindingCurrent} from './memory-retrieval-trial-d5/private-launch.mjs';
import {DTrial} from './memory-retrieval-trial-d5/profile.mjs';
import {RunJournal} from './trial-journal/journal.mjs';
import {canonical,json,encode} from './memory-retrieval-comparison-d3/contracts.mjs';
import {readOwnedTrialInputs} from './owned-trial-inputs.mjs';
import {createPreparationLifetime,createResidentFences} from './resident-lifecycle.mjs';
import {refusalAsNo,readPinned} from './trial-journal/policy-assert.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=value=>hash(encode(value));
const fixedError=code=>Object.assign(new Error(code),{code});
const requireTrue=(value,code)=>{if(!value)throw fixedError(code);};
function fields(value,names,code){
  const v=json(value);requireTrue(v&&typeof v==='object'&&!Array.isArray(v)&&canonical(Object.keys(v).sort())===canonical([...names].sort()),code);return v;
}
function selection(input){
  const chosen=fields(input,['answerKeyOwner','answerEndpoint','answerModel'],'selection_fields');
  requireTrue(chosen.answerKeyOwner==='memory.filter.apiKey','answer_owner_required');
  requireTrue(typeof chosen.answerEndpoint==='string','answer_endpoint_required');
  requireTrue(typeof chosen.answerModel==='string'&&chosen.answerModel.length>0&&chosen.answerModel.length<=256,'answer_model_required');
  const endpoint=new URL(chosen.answerEndpoint);
  requireTrue(!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash&&['http:','https:'].includes(endpoint.protocol),'answer_endpoint_refused');
  return json({...chosen,answerEndpoint:endpoint.href});
}
function artifact(root,name,value){
  const file=path.join(root,name),bytes=encode(value),fd=fs.openSync(file,'wx');
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {name,path:file,sha256:hash(bytes),bytes:bytes.length};
}
function disclosure({w,profile,scope,policy}){
  const kinds=json(policy.kinds);
  return json({schema:'whole-private-trial-budget-disclosure-v2',purpose:w.d.review.purpose,reviewer:json(w.d.review.reviewer),
    dataEstimateCredits:policy.limits.localEstimatedCredits,costQualification:'DATA_ESTIMATE_NOT_FULL_INVOICE_CEILING',invoiceUpperBound:null,
    graphs:scope.graphs.length,episodes:scope.members.length,questions:profile.questions.queries.length,modelJobs:profile.manifest.jobs.length,
    requests:kinds,requestLimit:Object.values(kinds).reduce((n,v)=>n+v,0),runMs:policy.limits.runMs,
    answer:{model:profile.manifest.answerControls.model,endpoint:profile.origins.answerEndpoint,requestProfile:json(profile.manifest.answerControls.requestProfile)},
    account:{provider:w.snapshot.provider,accountId:w.snapshot.accountId,readBase:w.snapshot.readBase,monthlyCap:w.snapshot.cap},
    inputs:{templateProfileSha256:w.inputs.templateSha256,treeInventorySha256:w.inputs.tree.sha256,checkout:json(w.inputs.checkout)}});
}

export function createResidentPreparation(hub,deployment){
  requireTrue(hub&&hub.history&&hub.memoryStore&&typeof hub.memoryTrialAccountContext==='function','resident_hub_required');
  const trusted=validateResidentDeployment(deployment),ownerRoot=path.join(hub.dataDir,'private-trial-preparation');
  const lifetime=createPreparationLifetime(ownerRoot);let retained=null,lastReason=null;
  function inspect(input){
    const d=readPrivateTrialDeployment(hub,trusted),chosen=selection(input);
    const context=hub.memoryTrialAccountContext(chosen),snapshot=context.snapshot();
    requireTrue(snapshot&&context.preparation(),'loaded_account_not_ready');
    requireTrue(canonical(snapshot)===canonical(context.snapshot()),'configured_owner_changed');
    const inputs=readOwnedTrialInputs({hub});
    requireTrue(inputs.current()===true,'resident_owned_inputs_changed');
    requireTrue(d.review.purpose==='approved-paid-trial'||d.review.purpose==='local-fixture','resident_purpose_not_whole_trial');
    return {d,chosen,context,snapshot,inputs,paid:d.review.purpose==='approved-paid-trial'};
  }
  function status(input){
    try{
      if(lifetime.phase==='REFUSED')return {state:'NOT_READY',reason:lastReason??'preparation_acquisition_refused',launchEnabled:false};
      if(retained&&!retained.fences.beforeOffer())return {state:'NOT_READY',reason:'prepared_owner_changed',launchEnabled:false};
      const w=inspect(input);
      if(retained&&canonical(w.chosen)!==canonical(retained.chosen))return {state:'NOT_READY',reason:'prepared_selection_changed',launchEnabled:false};
      if(!retained&&fs.existsSync(ownerRoot))return {state:'NOT_READY',reason:'preparation_root_exists',launchEnabled:false};
      return {state:retained?'PREPARED':w.paid?'PAID_PREPARATION_READY':'LOCAL_PREPARATION_READY',purpose:w.d.review.purpose,launchEnabled:false,phase:lifetime.phase,
        answer:json(w.snapshot.answer),cap:w.snapshot.cap,configurationRevision:w.snapshot.configurationRevision,loadedRevision:w.snapshot.loadedRevision,
        inputs:{templateProfileSha256:w.inputs.templateSha256,treeInventorySha256:w.inputs.tree.sha256},
        prepared:retained?{graphs:retained.bound.scope.graphs.length,members:retained.bound.scope.members.length,attempts:0,cardSha256:retained.card.cardSha256}:null};
    }catch{return {state:'NOT_READY',reason:'deployment_inputs_or_loaded_owner_not_ready',launchEnabled:false};}
  }
  function prepare(input){
    requireTrue(lifetime.phase==='EMPTY'&&!fs.existsSync(ownerRoot),'preparation_not_repeatable');
    const w=inspect(input);
    const prior=json(w.inputs.template),preparation=json(w.inputs.boundPreparation);
    requireTrue(canonical(w.snapshot)===canonical(w.context.snapshot()),'configured_owner_changed');
    try{
      lifetime.begin();
      let active=true;
      const accountContext=Object.freeze({snapshot:()=>active?w.context.snapshot():null,preparation:()=>active?w.context.preparation():null});
      const source=createIsolatedSource({hub,accountContext,payloads:prior.payloads,sieve:w.inputs.sieve});
      const materialization=source.materialize({plannedRows:prior.payloads.rows,sources:w.inputs.sources});
      const materializationPin=artifact(ownerRoot,'MATERIALIZATION.json',materialization);
      prior.purpose=w.d.review.purpose;prior.manifest.answerControls.model=w.chosen.answerModel;
      const codePins=[...w.inputs.pins.map(p=>({path:p.path,sha256:p.sha256})),{path:w.d.reviewFile,sha256:trusted.reviewSha256}];
      const prepared=prepareIsolatedProductProfile({prior,preparation,materialization,account:w.snapshot.accountId,
        origins:{readBase:w.snapshot.readBase,answerEndpoint:w.chosen.answerEndpoint},codePins,
        preparationPin:{path:materializationPin.path,sha256:materializationPin.sha256},history:hub.history,
        routeObservations:source.rooms.map(room=>({uuid:room.uuid,
          head:hub.history.memoryOutbox.generations.head({provider:'zep',account:w.snapshot.accountId,uuid:room.uuid}),
          attachment:hub.history.memoryOutbox.generationAttachment('zep',room.id)}))});
      requireTrue(Object.values(prepared.scope.gates).every(g=>g===false)&&prepared.profile.review.d3Accepted===false,'prepared_profile_already_accepted');
      requireTrue(prepared.profile.review.acceptedCETree===w.inputs.tree.sha256,'prepared_tree_not_the_inventory');
      if(w.paid){
        prepared.scope.gates={executorAccepted:true,currentCENativeAccepted:true,liveAccountCopyConsentBound:true};
        prepared.profile.review={d3Accepted:true,d3ProofSha256:sha(prepared.profile.manifest),acceptedCETree:w.inputs.tree.sha256,serviceEmissionProofSha256:sha(prepared.scope)};
      }
      const caller=createConfiguredNativeCaller({hub,selection:w.chosen,source});
      const native=caller.prepare(prepared),binding=caller.capture(native.profile,native.scope);
      const bindingPin=artifact(ownerRoot,'BINDING.json',binding);
      const bound=caller.bindProfile({...native,bindingPin:{path:bindingPin.path,sha256:bindingPin.sha256},codePins:native.profile.codePins});
      const ports=caller.scopePorts(bound.profile,bound.scope);
      const liveCurrent=()=>refusalAsNo(()=>active&&w.inputs.current()===true&&source.current()===true&&canonical(w.snapshot)===canonical(w.context.snapshot())&&
        canonical(readPrivateTrialDeployment(hub,trusted).review)===canonical(w.d.review));
      requireTrue(liveCurrent(),'configured_owner_changed');
      const profilePin=artifact(ownerRoot,'PROFILE.json',bound.profile),scopePin=artifact(ownerRoot,'SCOPE.json',bound.scope);
      const preparationPin=artifact(ownerRoot,'PREPARATION.json',bound.preparation);
      const cardOwner=DTrial.prepare(ownerRoot,bound.profile),cardPin=artifact(ownerRoot,'CARD.json',cardOwner);
      const artifacts=[materializationPin,bindingPin,profilePin,scopePin,preparationPin,cardPin];
      const artifactCurrent=()=>artifacts.every(p=>{const bytes=readPinned(p.path);return bytes!==null&&bytes.length===p.bytes&&hash(bytes)===p.sha256;});
      const beforeClaim=()=>refusalAsNo(()=>{
          if(launchBindingCurrent(ports,bound.binding,{beforeClaim:true})!==true)return false;
          const stored=RunJournal.inspect(ownerRoot);
          return stored.cardSha256===cardOwner.cardSha256&&stored.state.run.claim===null&&stored.state.run.stopped===null&&stored.state.attempts.length===0;
      });
      const fences=createResidentFences({liveCurrent,artifactCurrent,beforeClaim});
      requireTrue(fences.beforeOffer(),'configured_owner_changed');
      const shown=disclosure({w,profile:bound.profile,scope:bound.scope,policy:cardOwner.policy});
      const projection=json({schema:cardOwner.schema,cardSha256:cardOwner.cardSha256,policySha256:sha(cardOwner.policy),
        profileSha256:profilePin.sha256,scopeSha256:scopePin.sha256,disclosure:shown,
        current:{configurationRevision:w.snapshot.configurationRevision,loadedRevision:w.snapshot.loadedRevision,cap:w.snapshot.cap},
        limits:json(cardOwner.policy.limits),offerCreated:false,launchEnabled:false,approvalReceiptVerifier:'HUMAN_CARD_REQUIRED',
        nativeProjectStatus:'NATIVE_PENDING',actualD:'NOT_RUN'});
      retained={card:projection,chosen:w.chosen,artifacts,paid:w.paid,disclosure:shown,cardOwner,bound,caller,binding:bound.binding,fences,
        tree:{file:w.inputs.tree.file},revoke:()=>{active=false;}};
      lifetime.complete();return {state:'PREPARED',launchEnabled:false,card:json(projection),artifacts:json(artifacts)};
    }catch(error){
      lifetime.refuse();lastReason='preparation_failed_retained_no_retry';throw Object.assign(fixedError(lastReason),{cause:error});
    }
  }
  function card(){
    requireTrue(lifetime.phase==='PREPARED'&&retained&&retained.fences.beforeOffer(),'prepared_card_not_current');
    return {state:'PREPARED',launchEnabled:false,card:json(retained.card),artifacts:json(retained.artifacts)};
  }
  function budgetSubject(){
    requireTrue(lifetime.phase==='PREPARED'&&retained&&retained.paid&&retained.fences.beforeOffer(),'paid_budget_not_ready');
    const r=retained;
    const snapshot=()=>json({cardSha256:r.cardOwner.cardSha256,root:r.cardOwner.root,policy:r.cardOwner.policy,
      scopeSha256:sha(r.bound.scope),bindingSha256:sha(r.binding),disclosure:r.disclosure});
    return Object.freeze({snapshot,current:r.fences.beforeOffer,ready:r.fences.current,revoke:r.revoke,
      start:(approval,verifyApproval)=>{
        requireTrue(r.fences.current()&&r.fences.beforeOffer(),'paid_budget_not_current');
        let sequence=0;
        const record=(kind,value)=>{requireTrue(++sequence<=10000,'trial_evidence_event_cap');artifact(ownerRoot,'EVENT-'+String(sequence).padStart(5,'0')+'.json',{kind,value:json(value)});};
        const completion=r.caller.launch({ownerRoot,profile:r.bound.profile,scope:r.bound.scope,preparation:r.bound.preparation,
          binding:r.binding,approval,verifyApproval,fetchImpl:globalThis.fetch,record,tree:r.tree}).then(result=>{artifact(ownerRoot,'RESULT.json',result);return result;});
        const stored=RunJournal.inspect(ownerRoot),claimId=stored.state.run.claim;
        if(typeof claimId!=='string'||canonical(JSON.parse(stored.state.run.approval??'null'))!==canonical(approval)){
          void completion.catch(()=>{});r.revoke();throw fixedError('synchronous_claim_missing');
        }
        return {claimId,completion};
      }});
  }
  return Object.freeze({status,prepare,card,budgetSubject});
}
