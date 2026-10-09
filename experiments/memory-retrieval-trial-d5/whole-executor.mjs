// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import invariant from 'node:assert/strict';
import {DTrial} from './profile.mjs';
import {runOwnedComparison} from './comparison-bridge.mjs';
import {boundedHttp} from '../memory-retrieval-comparison-d3/ports.mjs';
import {verifySdkWireBody} from '../memory-retrieval-comparison-d3/wire-projection.mjs';
import {json,canonical,encode,sha256,awaited,Held} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {nativeProfile,nativeAuthorities,NATIVE_ENTRY} from './native-project.mjs';
import {checkTree} from './tree-inventory.mjs';
import {connectionClosedBeforeResponse} from '../../dist/memory/zep-sdk-fetch.js';

const CLOSED='connection_closed_before_response';

export const READ_AFTER_INGESTION_MS=60_000;
export async function runWholeTrial(input){
  const owner=input.owner;
  assert.ok(owner instanceof DTrial);
  let profile,preparation,scope,productStep,fetchImpl,verifyReceipt,comparisonPorts,current,record,clock,readLocalRoutes,tree;
  const treeCheck=async phase=>{
    if(!tree)return;
    const checked=await checkTree(tree,profile.review.acceptedCETree);
    record('tree-check',{phase,ms:checked.ms,maxLoopDelayMs:checked.maxLoopDelayMs,changes:checked.changes.length});
    if(checked.changes.length)owner.treeChanged(phase,checked.changes);
  };
  return runOwnedComparison({owner,manifest:null,questions:null,payloads:null,
    loadInputs:()=>{
      ({profile,preparation,scope,productStep,fetchImpl,verifyReceipt,comparisonPorts,current,record,clock,readLocalRoutes,tree=null}=input);
      return {manifest:profile.manifest,questions:profile.questions,payloads:profile.payloads,
        preparation,ports:comparisonPorts,current,record,clock,readLocalRoutes};
    },
    permit:null,authorities:null,
    async beforeComparison({budget,recorder}){
      profile=json(profile);scope=json(scope);
      await treeCheck('claim');
      invariant.equal(typeof productStep,'function');invariant.equal(typeof fetchImpl,'function');invariant.equal(typeof verifyReceipt,'function');
      assert.equal(sha256(encode(scope)),profile.review.serviceEmissionProofSha256,'scope_binding_changed');
      assert.equal(scope.runId,profile.manifest.runId);assert.equal(scope.corpusSha256,profile.manifest.corpusSha256);
      assert.equal(scope.acceptedCETree,profile.review.acceptedCETree);
      const graphCount=profile.manifest.topology.length,episodeCount=profile.writePermits.filter(p=>p.kind==='episode').length;
      assert.equal(scope.members.length,episodeCount);assert.equal(scope.graphs.length,graphCount);
      const graphs=new Set(),members=new Set();
      for(const g of scope.graphs){
        assert.ok(!graphs.has(g.graphId));graphs.add(g.graphId);
        const t=profile.manifest.topology.find(t=>t.graphId===g.graphId);assert.ok(t);
        assert.equal(g.authority.graphId,t.graphId);assert.equal(g.authority.room,t.logicalRoom);assert.equal(g.authority.roomUuid,t.roomUuid);
      }
      for(const m of scope.members){
        assert.ok(!members.has(m.permitId));members.add(m.permitId);
        const p=profile.writePermits.find(p=>p.id===m.permitId && p.kind==='episode');assert.ok(p);
        const meta=p.request.body.metadata;assert.equal(m.graphId,p.request.body.graph_id);
        for(const [key,native] of [['opId','op_id'],['sourceId','source_id'],['version','version'],['part','part']])assert.equal(m[key],meta[native]);
        assert.equal(scope.graphs.find(g=>g.graphId===m.graphId).authority.copyId,meta.copy_id);
      }
      if(profile.purpose!=='local-fixture'){
        assert.equal(scope.gates.executorAccepted,true,'executor_review_pending');
        assert.equal(scope.gates.currentCENativeAccepted,true,'current_ce_native_pending');
        assert.equal(scope.gates.liveAccountCopyConsentBound,true,'live_scope_pending');
      }
      const guard=()=>{budget.check();if(current()!==true)throw new Held('whole_trial_authority_changed');};
      guard();owner.beginSetup();
      const writePermits=profile.writePermits,episodes=[],steps=[],pending=[];
      const received=(p,attempt)=>{
        const response=JSON.parse(attempt.response);
        steps.push({permitId:p.id,kind:p.kind,responseSha256:sha256(attempt.response)});
        if(p.kind==='episode'){
          assert.equal(typeof response.uuid,'string');assert.ok(response.uuid,'episode_ack_missing_uuid');
          assert.ok(!episodes.some(e=>e.uuid===response.uuid),'episode_ack_duplicate');
          episodes.push({permitId:p.id,graphId:p.request.body.graph_id,uuid:response.uuid});
        }
        record(p.kind==='episode'?'ingestion':'setup',json(steps.at(-1)));
      };
      const settleUnit=({unit,planned,writes,result})=>{
        for(const p of planned){
          const own=writes.filter(a=>canonical(a.request)===canonical(p.request)),last=own.at(-1);
          if(last?.status==='received'){if(!steps.some(s=>s.permitId===p.id))received(p,last);continue;}
          assert.ok(unit.phase==='ingestion' && own.length>=1 && own.every(a=>a.status==='unknown' && a.error===CLOSED),'product_dispatch_not_received');
          if(result?.state==='unknown')return 'pending';
          assert.ok(['accepted','processed'].includes(result?.state) && Array.isArray(result.externalIds) && result.externalIds.length===1 &&
            typeof result.externalIds[0]==='string' && result.externalIds[0],'product_dispatch_not_received');
          assert.ok(!episodes.some(e=>e.uuid===result.externalIds[0]),'episode_ack_duplicate');
          steps.push({permitId:p.id,kind:p.kind,responseSha256:null,receipt:'listing'});
          episodes.push({permitId:p.id,graphId:p.request.body.graph_id,uuid:result.externalIds[0]});
          record('ingestion',json(steps.at(-1)));
        }
        return 'received';
      };
      const setup=writePermits.filter(p=>p.kind!=='episode'),ingestion=writePermits.filter(p=>p.kind==='episode');
      assert.equal(setup.length,2*graphCount);assert.equal(ingestion.length,episodeCount);
      const units=[...scope.graphs.map(g=>({phase:'setup',permits:setup.filter(p=>p.kind==='graph'?p.request.body.graph_id===g.graphId:p.request.body.graph_ids[0]===g.graphId)})),
        ...ingestion.map(p=>({phase:'ingestion',permits:[p]}))];
      for(const unit of units){
        const planned=unit.permits;assert.equal(planned.length,unit.phase==='setup'?2:1);
        guard();const writes=[];const pages=new Map();
        const transfer=async(request,write)=>{
          request=json(request);guard();
          const u=new URL(request.url),path=u.pathname.slice(new URL(profile.origins.readBase).pathname.replace(/\/$/,'').length);
          let p=null;
          if(write){
            p=planned.find(p=>canonical(p.request)===canonical(request));assert.ok(p,'product_write_changed');
            const earlier=writes.filter(a=>canonical(a.request)===canonical(request));
            assert.ok(earlier.length===0 || earlier.length===1 && earlier[0].status==='unknown' && earlier[0].error===CLOSED,'product_write_repeated');
          }else if(request.method==='POST' && /\/graph$/.test(path)===false && /\/(?:episodes|edge|node)\/graph\//.test(path)){
            const n=request.body?.cursor?(pages.get(path)??0)+1:1;assert.ok(n<=budget.limits.maxPagesPerCollection,'preflight_page_cap');pages.set(path,n);
          }
          for(let asked=1;;asked++){
            let attempt;
            if(write){
              attempt={number:budget.attempts.length+1,kind:p.kind,request,status:'attempted',response:null,error:null,responseBytes:null,latencyMs:null,vendorCost:null};
              budget.attempts.push(attempt);writes.push(attempt);
              try{assert.equal(recorder.recordWriteAttempt(attempt,p.id),true);}catch(error){attempt.status='unknown';budget.stop('write_admission_refused');throw error;}
            }else attempt=budget.take('read',request);
            let primaryError,hasPrimaryError=false;
            try{
              const response=await boundedHttp({url:request.url,method:request.method,body:request.body,headers:{},budget,attempt,fetchImpl,guard});
              let body;try{body=JSON.parse(response.raw);}catch{throw new Held('whole_trial_non_json');}
              const observedMissingGraph=!write && request.method==='GET' && /^\/graph\/[^/]+$/.test(path) && response.status===404;
              if(!observedMissingGraph && (response.status<200 || response.status>=300))throw new Held('whole_trial_http_refused');
              if(!write && !observedMissingGraph)verifySdkWireBody(body,{method:request.method,pathname:path});
              guard();return {body:json(body),status:response.status,rawResponse:new Response(response.raw,{status:response.status,headers:response.rawResponse.headers})};
            }catch(error){
              primaryError=error;hasPrimaryError=true;attempt.status='unknown';
              if(!(error instanceof Held) && connectionClosedBeforeResponse(error)){
                attempt.error=CLOSED;
                if(!write && asked===1)continue;
                throw error;
              }
              attempt.error=error.message;budget.stop('whole_trial_unknown');throw error;
            }finally{
              try{budget.settle(attempt);}
              catch(settlementError){
                if(hasPrimaryError)throw new AggregateError([primaryError,settlementError],'whole_trial_request_and_settlement_failed');
                throw settlementError;
              }
            }
          }
        };
        const transport=Object.freeze({read:r=>transfer(r,false),write:r=>transfer(r,true)});
        const result=await awaited(budget,signal=>productStep({phase:unit.phase,permits:json(planned),signal,transport}));
        guard();const verdict=settleUnit({unit,planned,writes,result});recorder.flush();
        if(verdict==='pending')pending.push({unit,planned,writes,transport});
      }
      const settleIntervalMs=input.settleIntervalMs??30_000;
      while(pending.length){
        for(const item of [...pending]){
          guard();
          const result=await awaited(budget,signal=>productStep({phase:'settle',permits:json(item.planned),signal,transport:item.transport}));
          guard();const verdict=settleUnit({...item,result});recorder.flush();
          if(verdict!=='pending')pending.splice(pending.indexOf(item),1);
        }
        if(!pending.length)break;
        if(budget.remaining()<=2*settleIntervalMs)throw new Held('whole_trial_settlement_exhausted');
        await new Promise(resolve=>{const timer=setTimeout(resolve,settleIntervalMs);timer.unref?.();});
      }
      guard();
      const ack={manifestSha256:sha256(encode(profile.manifest)),episodes};
      owner.bindIngestion(ack,verifyReceipt);guard();
      const readAfterIngestionMs=input.readAfterIngestionMs??(profile.purpose==='local-fixture'?0:READ_AFTER_INGESTION_MS);
      if(readAfterIngestionMs>0){
        if(budget.remaining()<=2*readAfterIngestionMs)throw new Held('whole_trial_read_delay_exhausted');
        await new Promise(resolve=>{const timer=setTimeout(resolve,readAfterIngestionMs);timer.unref?.();});guard();
      }
      await treeCheck('after-ingestion');guard();
      const authorities=nativeProfile(profile)?nativeAuthorities(profile,ack):scope.graphs.map(g=>({...json(g.authority),members:scope.members.filter(m=>m.graphId===g.graphId).map(m=>{
        const e=episodes.find(e=>e.permitId===m.permitId && e.graphId===g.graphId);assert.ok(e,'scope_member_ack_missing');
        return {episodeId:e.uuid,opId:m.opId,sourceId:m.sourceId,version:m.version,part:m.part};
      })}));
      const run=owner.summary().state.run,approval=JSON.parse(run.approval),local=profile.purpose==='local-fixture';
      return {authorities,permit:{schema:nativeProfile(profile)?NATIVE_ENTRY:'viberoom-retrieval-external-job-permit-v1',purpose:profile.purpose,
        manifestSha256:sha256(encode(profile.manifest)),runId:profile.manifest.runId,ownerClaimId:run.claim,
        approved:true,expiresAt:approval.expiresAt,...(nativeProfile(profile)?{accountScopeSha256:profile.nativeProject.accountScopeSha256,provisionalAuthoritySha256:sha256(encode(authorities)),nativeBindingSetSha256:null}:{currentAuthoritySha256:sha256(encode(authorities))}),
        serviceEmissionBinding:local?null:{acceptedCETree:scope.acceptedCETree,actualServiceEmissionsSha256:sha256(encode(scope)),authorizedIngestionReceiptSha256:owner.ingestionReceiptSha256()},
        wholeTrialBudgetApproved:!local,readOrigin:new URL(profile.origins.readBase).origin,answerOrigin:new URL(profile.origins.answerEndpoint).origin}};
    },
    async afterComparison(){await treeCheck('end');}
  });
}
