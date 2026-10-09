// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert,{refusalAsNo} from '../trial-journal/policy-assert.mjs';
import {randomUUID} from 'node:crypto';
import {createProductStep} from './product-step.mjs';
import {canonical,json} from '../memory-retrieval-comparison-d3/contracts.mjs';

export function createIsolatedSource({hub,accountContext,payloads,sieve=null,namespaceId=randomUUID(),roomUuids=null}){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const physicalAddresses=payloads.physicalAddresses,graphs=physicalAddresses.length,variants=new Map(payloads.variants.map(v=>[v.name,v]));
  assert.match(namespaceId,uuid);assert.ok(graphs>=1);
  if(roomUuids!==null)assert.equal(roomUuids.length,graphs);
  const initial=accountContext.snapshot();assert.ok(initial,'isolated_loaded_account_required');
  const rooms=physicalAddresses.map((g,i)=>{const id=roomUuids?.[i]??randomUUID();assert.match(id,uuid);return {
    id:`trial:${namespaceId}:${id}`,uuid:id,name:g.room.name,logicalRoom:g.logicalRoom,variant:g.variant,
    remembers:true,input:variants.get(g.variant).memoryInput,originalInput:variants.get(g.variant).memoryInput==='whole',account:initial.accountId,
  };});
  const ids=rooms.map(r=>r.id),uuids=rooms.map(r=>r.uuid);assert.equal(new Set(uuids).size,graphs);
  assert.equal(hub.privateTrialNamespaceUnregistered(ids,uuids),true,'isolated_namespace_registered_or_arriving');
  assert.equal(hub.history.privateTrialNamespaceUnused([...ids,...uuids]),true,'isolated_namespace_occupied');
  const identities=rooms.map(r=>({id:r.id,uuid:r.uuid,name:r.name,logicalRoom:r.logicalRoom,variant:r.variant,remembers:r.remembers,input:r.input,originalInput:r.originalInput}));
  const current=()=>refusalAsNo(()=>{
    return canonical(accountContext.snapshot())===canonical(initial)&&hub.privateTrialNamespaceUnregistered(ids,uuids)&&
      canonical(rooms.map(r=>({id:r.id,uuid:r.uuid,name:r.name,logicalRoom:r.logicalRoom,variant:r.variant,remembers:r.remembers,input:r.input,originalInput:r.originalInput})))===canonical(identities);
  });
  const preparationProvider=accountContext.preparation();assert.ok(preparationProvider&&preparationProvider.generations.account===initial.accountId);
  const product=createProductStep({history:hub.history,preparationProvider,rooms,current,cap:()=>accountContext.snapshot()?.cap,sieve});
  let materialized=false;
  return Object.freeze({schema:'same-hub-private-trial-source-v1',history:hub.history,rooms,namespaceId,current,
    rows:()=>product.rows(),
    ports:()=>({history:hub.history,rooms,current,cap:()=>accountContext.snapshot()?.cap}),
    materialize({plannedRows,sources}){
      assert.equal(materialized,false,'isolated_source_already_materialized');assert.equal(current(),true,'isolated_source_not_current');
      assert.equal(hub.history.privateTrialNamespaceUnused([...ids,...uuids]),true,'isolated_namespace_occupied');
      materialized=true;const selected=new Set();
      for(const planned of plannedRows){
        const room=rooms.find(r=>r.logicalRoom===planned.logicalRoom&&r.variant===planned.variant),source=sources.find(s=>s.id===planned.sourceId);assert.ok(room&&source);
        assert.equal(current(),true,'isolated_source_not_current');selected.add(source.id);
        assert.equal(hub.history.getById(room.id,source.id,true),null,'isolated_source_collision');
        hub.history.upsert(room.id,{id:source.id,seq:hub.history.maxSeq(room.id)+1,room:source.room,from:source.author,fromName:source.author,
          ts:Date.parse(source.at),kind:'chat',text:source.text});
        product.prepare({source:hub.history.getById(room.id,source.id),roomId:room.id});
        assert.equal(current(),true,'isolated_source_changed_during_prepare');
      }
      assert.equal(selected.size,new Set(plannedRows.map(r=>r.sourceId)).size);const rows=product.rows();assert.equal(rows.length,plannedRows.flatMap(r=>r.members).length);
      assert.equal(new Set(rows.map(r=>r.identity.roomId)).size,new Set(plannedRows.map(r=>`${r.variant}|${r.logicalRoom}`)).size);
      assert.ok(rows.every(r=>r.state==='prepared'&&r.attempts===0&&r.externalIds.length===0));
      return {schema:'same-hub-private-trial-materialization-v1',namespaceId,rooms:json(rooms),rows:json(rows),sourceIds:[...selected].sort(),
        qualification:'Local synthetic content with actual same-Hub source/copy/ledger ownership. No Cloud ACK/native project/paid authority.'};
    },
  });
}
