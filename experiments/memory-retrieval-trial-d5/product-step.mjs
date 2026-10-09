// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import invariant from 'node:assert/strict';
import {ZepProvider} from '../../dist/memory/zep.js';
import {zepGraphId} from '../../dist/memory/zep-payload.js';
import {MemoryDeliveryPipeline} from '../../dist/memory/delivery-pipeline.js';
import {MemorySourceVersions} from '../../dist/memory/source-versions.js';
import {MemoryGenerationRouting} from '../../dist/memory/generation-routing.js';
import {sourceVersion} from '../../dist/memory/provenance.js';
import {memoryText} from '../../dist/memory/text.js';
import {verdictFor} from '../../dist/memory/filter.js';
import {sieveItem} from '../../dist/memory/service.js';
import {originalProductText,originalProductFingerprint,ORIGINAL_PRODUCT_PROFILE} from '../../dist/memory/original-product-input.js';
import {visibleToAgents} from '../../dist/quotes.js';
import {canonical,json} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {ChangeTokenCache} from '../../dist/memory/change-token-cache.js';

export function createProductStep({history,settings,rooms,current,cap,now=Date.now,preparedRows=[],preparationProvider=null,sieve=null}){
  invariant.equal(typeof current,'function');invariant.equal(typeof cap,'function');const outbox=history.memoryOutbox;
  const verdicts=new Map((sieve?.verdicts??[]).map(v=>[v.sourceId,v]));
  const room=id=>rooms.find(r=>r.id===id)??null,message=(r,id)=>history.getById(r,id);
  let active=null;const sourcePins=new Map(),roomPins=new Map(rooms.map(r=>[r.id,{uuid:r.uuid,name:r.name,input:r.input}]));
  const allowed=()=>current()===true;
  const ioCurrent=()=>{assert.ok(active && allowed() && active.current() && !active.signal.aborted,'product_io_outside_current_step');};
  const request=(method,url,body)=>({method,url,body:body==null?null:JSON.parse(JSON.stringify(body)),maxRetries:0});
  const transfer=async r=>{
    ioCurrent();const step=active;
    const read=r.method==='GET' || r.method==='POST' && /\/graph\/episodes\/graph\//.test(new URL(r.url).pathname);
    const response=await step.transport[read?'read':'write'](r);
    assert.equal(active,step,'product_step_lifetime_changed');ioCurrent();return response;
  };
  const preparationOnly=preparationProvider!==null;
  if(preparationOnly){
    assert.equal(settings,undefined,'cached_preparation_must_not_receive_settings');assert.equal(preparedRows.length,0,'cached_preparation_must_not_restore_dispatch');
    assert.equal(preparationProvider.id,'zep');assert.equal(typeof preparationProvider.generations?.account,'string');
    assert.deepEqual(Object.keys(preparationProvider).sort(),['id','loadedRevision','generations','writes'].sort());
    assert.deepEqual(Object.keys(preparationProvider.generations),['account']);
    assert.deepEqual(Object.keys(preparationProvider.writes).sort(),['episodeTextLimit','episode','originalMessage'].sort());
    invariant.equal(typeof preparationProvider.writes.episode,'function');assert.ok(preparationProvider.writes.originalMessage);
  }
  const provider=preparationOnly?preparationProvider:new ZepProvider(settings,{
    fetcher:async args=>{
      const r=await transfer(request(args.method,args.url,args.body));
      return r.status>=200&&r.status<300?{ok:true,body:r.body,rawResponse:r.rawResponse}
        :{ok:false,error:{reason:'status-code',statusCode:r.status,body:r.body},rawResponse:r.rawResponse};
    },
    fetch:async(input,init)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
      const r=await transfer(request(init?.method??'GET',url,init?.body?JSON.parse(String(init.body)):null));return r.rawResponse;
    },
  });
  const account=provider.generations.account;
  const rowFacts=(row)=>{
    const s=message(row.identity.roomId,row.identity.sourceId);
    return {row,source:s,sourceText:s?canonical(s):null,copy:outbox.deliveries.currentCopy(row.identity),accountMatches:outbox.deliveries.accountMatches(row.identity,account),
      imported:!!s&&outbox.importedSource(row.identity.roomId,s.id),ownVersion:!!s&&outbox.ownVersion(row.identity.roomId,s.id,row.identity.version),
      groupFingerprint:row.groupId?outbox.deliveries.getPartGroup(row.groupId).descriptor.representationFingerprint:null};
  };
  const factsCurrent=({row,source:s,sourceText,copy,accountMatches,imported,ownVersion,groupFingerprint})=>{
    const r=room(row.identity.roomId);
    return !!r&&!!s&&r.remembers&&r.uuid===row.identity.roomUuid&&r.name===roomPins.get(r.id)?.name&&r.input===roomPins.get(r.id)?.input&&
      provider.generations.account===account&&r.account===account&&r.graphId===row.identity.graphId&&copy&&accountMatches&&!imported&&ownVersion&&
      sourceVersion(s)===row.identity.version&&s.seq===row.payload.binding.seq&&
      visibleToAgents(s)&&!s.streaming&&sourceText===sourcePins.get(row.opId)&&(!row.groupId||groupFingerprint===originalProductFingerprint(s));
  };
  const rowCurrent=row=>factsCurrent(rowFacts(row));
  const sourceCurrent=row=>allowed()&&rowCurrent(row);
  const versions=new MemorySourceVersions({outbox,room,message,allowed,
    revision:(r,id)=>history.carriedRevision(r,id),relation:(r,id,h)=>history.carriedRelation(r,id,h),
    groupSourceCurrent:(g,s)=>g.descriptor.representationFingerprint===originalProductFingerprint(s,g.descriptor.representation),now,wakeAfter:()=>{}});
  const deliveries=new MemoryDeliveryPipeline({outbox,room,message,allowed,now,cap,wakeAfter:()=>{},
    beforeSend:(...args)=>versions.beforeSend(...args),groupPreflight:(...args)=>versions.groupPreflight(...args)});
  const routing=new MemoryGenerationRouting({outbox,room,allowed,now,beforeFollow:()=>{}});
  const rows=[];
  assert.ok(Array.isArray(preparedRows));
  for(const expected of preparedRows){
    const row=outbox.deliveries.get(expected.opId),r=row&&room(row.identity.roomId),s=r&&message(r.id,row.identity.sourceId);
    assert.ok(row&&r&&s&&!rows.some(p=>p.opId===row.opId),'product_prepared_restore_missing');
    assert.equal(canonical(row),canonical(expected),'product_prepared_restore_changed');
    assert.equal(row.state,'prepared');assert.equal(row.attempts,0);assert.deepEqual(row.externalIds,[]);
    sourcePins.set(row.opId,canonical(s));assert.ok(sourceCurrent(row),'product_prepared_restore_not_current');rows.push(row);
  }
  function prepare({source,roomId}){
    assert.equal(active,null,'preparation_during_io');const r=room(roomId);assert.ok(r&&r.remembers&&allowed());
    const live=message(roomId,source.id);assert.equal(canonical(live),canonical(source));assert.ok(visibleToAgents(live)&&!live.streaming);
    const version=sourceVersion(live);assert.ok(outbox.ownVersion(roomId,live.id,version)&&!outbox.importedSource(roomId,live.id));
    const copyId=outbox.deliveries.copy('zep',r.id,r.uuid);outbox.deliveries.bindAccount({provider:'zep',roomId:r.id,roomUuid:r.uuid,copyId},account);r.account=account;
    const saved=deliveries.savedSource('zep',r,live);assert.equal(saved,null,'product_saved_source_requires_its_own_path');
    let prepared;
    const whole=()=>{
      const scope={provider:'zep',roomId:r.id,roomUuid:r.uuid,copyId,sourceId:live.id,version,kind:'episode',account};
      const request={scope,room:{uuid:r.uuid,name:r.name},source:live,
        input:{representation:'memory-text-v1',text:originalProductText(live)},profile:ORIGINAL_PRODUCT_PROFILE};
      const result=preparationOnly?deliveries.prepareLoadedOriginalMessageGroup(preparationProvider,request,()=>allowed())
        :deliveries.prepareOriginalMessageGroup(provider,request,()=>allowed());
      assert.equal(result.kind,'prepared',result.reason);return result.group.members.map(m=>outbox.deliveries.get(m.opId));
    };
    if(r.input==='whole')prepared=whole();
    else{
      assert.equal(r.input,'excerpts','product_room_input_unknown');const recorded=verdicts.get(live.id);assert.ok(recorded,'product_sieve_verdict_missing');
      const judged=verdictFor(sieveItem(live),{keep:recorded.keep,excerpts:recorded.excerpts});assert.ok(judged.keep,'product_dropped_source_prepared');
      if(judged.excerpts?.kind==='whole')prepared=whole();
      else prepared=[deliveries.prepareMessage(provider,r,live,{sourceId:live.id,seq:live.seq,authorId:live.from,authorName:live.fromName,text:judged.episode??memoryText(live),ts:live.ts})];
    }
    for(const p of prepared){sourcePins.set(p.opId,canonical(live));assert.equal(p.state,'prepared');assert.ok(sourceCurrent(p));rows.push(p);}return prepared;
  }
  async function productStep({phase,permits,signal,transport}){
    assert.equal(preparationOnly,false,'cached_preparation_cannot_dispatch');
    assert.equal(active,null,'product_step_parallel');assert.ok(allowed()&&!signal.aborted);assert.ok(Array.isArray(permits)&&permits.length);
    const step={signal,transport,current:allowed};active=step;
    try{
      if(phase==='setup'){
        assert.equal(permits.length,2);assert.equal(permits[0].kind,'graph');assert.equal(permits[1].kind,'ontology');
        const graph=permits[0].request.body.graph_id,r=rooms.find(r=>zepGraphId(r.uuid)===graph);assert.ok(r&&r.remembers&&r.account===account);
        step.current=()=>r.uuid===roomPins.get(r.id)?.uuid&&r.name===roomPins.get(r.id)?.name&&r.remembers&&r.account===account&&
          rows.filter(row=>row.identity.roomId===r.id).every(row=>rowCurrent(outbox.deliveries.get(row.opId)));
        await provider.ensureRoom({uuid:r.uuid,name:r.name},ioCurrent);ioCurrent();
      }else{
        assert.ok(['ingestion','settle'].includes(phase),'product_step_phase');assert.equal(permits.length,1);const p=permits[0];assert.equal(p.kind,'episode');
        const row=outbox.deliveries.get(p.request.body.metadata.op_id);assert.ok(row&&sourceCurrent(row),'product_source_not_current');
        let lease;step.current=()=>rowCurrent(outbox.deliveries.get(row.opId))&&(!lease||lease.current());
        assert.equal(canonical(p.request.body.metadata),canonical(row.payload.request.metadata));
        const r=room(row.identity.roomId);lease=await routing.resolve(provider,r,signal,false,()=>sourceCurrent(row));
        assert.ok(lease&&lease.current()&&!lease.room.generationCheck,'product_route_not_current');Object.assign(r,lease.room);
        assert.ok(sourceCurrent(row));
        if(phase==='ingestion'){if(row.groupId)outbox.handoffPartGroup(row.groupId);else outbox.handoff(row.opId);}
        else assert.equal(row.state,'unknown','product_settle_not_unknown');
        const result=await deliveries.dispatch(provider,outbox.deliveries.get(row.opId),signal);
        ioCurrent();assert.ok(sourceCurrent(result)&&lease.current(),'product_source_changed_after_dispatch');
        if(result.state==='unknown')return {state:'unknown'};
        assert.ok(['accepted','processed'].includes(result.state)&&result.externalIds.length===1,`product_dispatch_not_accepted: ${JSON.stringify({...result,payload:undefined})}`);
        return {state:result.state,externalIds:[...result.externalIds]};
      }
    }finally{assert.equal(active,step);active=null;}
  }
  function readLocalRoutes(graphIds){
    assert.ok(allowed());const routes=projectLocalRoutes(graphIds);assert.ok(allowed(),'product_route_projection_not_current');return routes;
  }
  function projectLocalRoutes(graphIds){
    assert.equal(preparationOnly,false,'cached_preparation_has_no_observed_route');
    assert.ok(Array.isArray(graphIds)&&graphIds.length>0&&graphIds.every(g=>typeof g==='string'),'product_route_graphs_invalid');
    const projected=routeFacts(graphIds).map(projectLocalRoute);
    assert.ok(routeFacts(graphIds).every(g=>g.members.every(factsCurrent)),'product_route_projection_not_current');
    return projected.map(p=>json(p.result));
  }
  const routeRows=new ChangeTokenCache();
  function routeFacts(graphIds){
    return routeRows.read(outbox.changeToken(),JSON.stringify(graphIds),()=>graphIds.map(graphId=>{
      const members=rows.filter(row=>row.payload.request.graphId===graphId).map(expected=>{const row=outbox.deliveries.get(expected.opId);
        return row?{...rowFacts(row),identityText:canonical(row.identity),payloadText:canonical(row.payload)}:{row:null};});
      const first=members.find(m=>m.row)?.row;
      return {graphId,members,head:first?outbox.generations.head({provider:'zep',account,uuid:first.identity.roomUuid}):null,
        attachment:first?outbox.generationAttachment('zep',first.identity.roomId):null};
    }));
  }
  const readLocalRoute=graphId=>readLocalRoutes([graphId])[0];
  const expectedText=new WeakMap();
  const preparedText=row=>{let t=expectedText.get(row);if(!t)expectedText.set(row,t={identity:canonical(row.identity),payload:canonical(row.payload)});return t;};
  function projectLocalRoute({graphId,members,head,attachment}){
    const declared=rows.filter(row=>row.payload.request.graphId===graphId);assert.ok(declared.length&&declared.length===members.length,'product_route_members_missing');
    const live=declared.map((expected,i)=>{const f=members[i],row=f.row,t=preparedText(expected);
      assert.ok(row&&row.opId===expected.opId&&f.identityText===t.identity&&f.payloadText===t.payload&&factsCurrent(f),'product_route_member_changed');
      assert.ok(['accepted','processed'].includes(row.state)&&row.externalIds.length===1,'product_route_receipt_missing');return row;});
    const identity=live[0].identity,r=room(identity.roomId);assert.ok(r);
    for(const row of live)assert.ok(row.identity.roomId===r.id&&row.identity.roomUuid===r.uuid&&row.identity.copyId===identity.copyId&&row.payload.request.graphId===graphId,'product_route_members_mixed');
    const result={schema:'viberoom-product-observed-local-route-v1',accountId:account,graphId,roomId:r.id,roomUuid:r.uuid,copyId:identity.copyId,
      room:{id:r.id,uuid:r.uuid,name:r.name,remembers:r.remembers,input:r.input,originalInput:r.originalInput,account:r.account,
        graphId:r.graphId??null,generationRevision:r.generationRevision??null,generationCheck:r.generationCheck??null},
      head:json(head),attachment:json(attachment),members:live.map(row=>{const m=row.payload.request.metadata;
        return {episodeId:row.externalIds[0],opId:row.opId,sourceId:m.source_id,version:m.version,part:m.part};})};
    return {result,live};
  }
  return Object.freeze({provider,prepare,productStep,rows:()=>rows.map(r=>outbox.deliveries.get(r.opId)),
    verifyReceipt:ack=>ack.episodes.length===rows.length&&ack.episodes.every(e=>{const row=rows.map(r=>outbox.deliveries.get(r.opId)).find(r=>r.externalIds.includes(e.uuid));
      return !!row&&sourceCurrent(row)&&['accepted','processed'].includes(row.state)&&row.externalIds.length===1&&row.payload.request.graphId===e.graphId;}),
    sourceCurrent,...(preparationOnly?{}:{readLocalRoute,readLocalRoutes,projectLocalRoutes,routeComputations:()=>routeRows.computations()})});
}
