// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import {readFileSync} from 'node:fs';
import {createOwnedProfileFixture} from '../trial-journal/owned-profile-local-fixture.mjs';
import {fileURLToPath} from 'node:url';
import {DTrial,prepareWritePermits,LONG_CORPUS} from './profile.mjs';
import {hash} from '../trial-journal/data.mjs';
import {evidenceFolder} from './test-folders.mjs';
export const PROMPT='Answer the question using only the supplied context. Distinguish decisions from proposals, preserve dates, direction and negation, and cite the stable source IDs for each factual assertion. If the context does not support an answer, say that the information is unavailable. Do not infer private or unverified information.';
const encode=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const profileEvidence=evidenceFolder('D_PROFILE_EVIDENCE');
export function fixtureProfile(){
  const questions=JSON.parse(readFileSync(new URL('./fixtures/questions.json',import.meta.url))),payloads=JSON.parse(readFileSync(new URL('./fixtures/payloads.json',import.meta.url)));
  const topology=payloads.physicalAddresses.map(g=>({logicalRoom:g.logicalRoom,variant:g.variant,graphId:g.plannedGraphId,roomUuid:g.room.uuid})),jobs=[];
  for(const q of questions.queries)for(const variant of payloads.variants.map(v=>v.name))for(const mode of ['edges-cross-encoder','edges-plus-selected-node-summaries','auto-raw'])jobs.push({order:jobs.length+1,questionId:q.id,query:q.query,room:q.room,variant,mode,graphId:topology.find(g=>g.logicalRoom===q.room && g.variant===variant).graphId});
  const origins={readBase:'http://127.0.0.1:48700/v2',answerEndpoint:'http://127.0.0.1:48701/v1/chat/completions'},writePermits=prepareWritePermits(payloads,origins.readBase);
  const manifest={schema:'viberoom-retrieval-connected-preparation-v2',runId:payloads.runId,corpusSha256:LONG_CORPUS,paidExecutionAllowed:false,actualD:'NOT_RUN',contextMaxUtf8BytesIncludingProvenance:4096,promptSha256:hash(PROMPT),
    inputs:{questionsSha256:hash(encode(questions)),payloadsSha256:hash(encode(payloads))},jobs,topology,
    ingestion:{plannedEpisodePosts:payloads.rows.flatMap(r=>r.members).length,localEstimatedCredits:writePermits.filter(w=>w.kind==='episode').reduce((n,w)=>n+w.estimate,0),fullInvoiceUpperBound:null},
    limits:{maxReads:2000,maxModelCalls:jobs.length,maxPagesPerCollection:2,pageSize:50,maxResponseBytes:2097152,maxAggregateBytes:67108864,requestMs:20000,runMs:2700000,maxNodes:12,edgeLimit:12,autoMaxCharacters:12000},
    answerControls:{model:'fixture-model',cacheState:'unknown',requestProfile:{schema:'viberoom-chat-completions-request-profile-v1',reasoningEffort:'none',temperature:null,maxCompletionTokens:1024,choices:1,serviceTier:'default',store:false,maxInputTextUtf8Bytes:8192,maxRequestUtf8Bytes:32768}}};
  const path=fileURLToPath(new URL('./profile.mjs',import.meta.url));
  return {schema:'viberoom-retrieval-long-trial-profile-v1',purpose:'local-fixture',manifest,questions,payloads,writePermits,origins,
    review:{d3Accepted:false,d3ProofSha256:null,serviceEmissionProofSha256:'65ea6ac068da005abdf0dfb4897075cfc75c7629496b9c42a202c64b7f107089',acceptedCETree:hash('synthetic fixture tree inventory')},codePins:[{path,sha256:hash(readFileSync(path))}]};
}
export function trialWorld(t){const resources=createOwnedProfileFixture(t,{evidenceRoot:profileEvidence}),root=resources.ownerRoot,profile=fixtureProfile();const card=DTrial.prepare(root,profile),approval={id:'explicit-local-fixture',cardSha256:card.cardSha256,expiresAt:new Date(Date.now()+60000).toISOString()};const owner=resources.retainTrialOwner(DTrial.claim(root,{approval,verifyApproval:()=>true,current:()=>true}));return {root,profile,owner,card,approval,resources};}
export function bindAllEpisodes(owner,profile){const episodes=[];for(const p of profile.writePermits.filter(p=>p.kind==='episode')){const handle=owner.admitWrite(p.id,p.request),uuid='fixture-'+p.id;owner.outcome(handle,{status:202,raw:JSON.stringify({uuid}),latencyMs:1,known:true});episodes.push({permitId:p.id,graphId:p.request.body.graph_id,uuid});}const ack={manifestSha256:hash(encode(profile.manifest)),episodes};owner.bindIngestion(ack,()=>true);return ack;}
export function modelAttempt(p,order=1,number=1,context='Verified fixture context.'){const job=p.manifest.jobs.find(j=>j.order===order),a=p.manifest.answerControls.requestProfile;
  const body={model:p.manifest.answerControls.model,max_completion_tokens:a.maxCompletionTokens,reasoning_effort:a.reasoningEffort,n:1,service_tier:'default',store:false,messages:[{role:'system',content:PROMPT},{role:'user',content:`Question:\n${job.query}\n\nContext:\n${context}`}]};
  return {number,kind:'model',status:'attempted',response:null,error:null,responseBytes:null,latencyMs:null,vendorCost:null,request:{method:'POST',url:p.origins.answerEndpoint,body,maxRetries:0,inputTextUtf8Bytes:body.messages.reduce((n,m)=>n+Buffer.byteLength(m.content),0),requestUtf8Bytes:Buffer.byteLength(JSON.stringify(body))}};
}
