// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from 'node:assert/strict';
import {zepEpisodeRequest} from '../../dist/memory/zep-payload.js';
import {sourceVersion} from '../../dist/memory/provenance.js';
import {json,fields,canonical,sha256} from '../memory-retrieval-comparison-d3/contracts.mjs';

const localName=ordinal=>`D configured local room ${String(ordinal).padStart(2,'0')}`;
const requestFields=['graphId','type','data','createdAt','sourceDescription','metadata'];
const nameFields=['ordinal','logicalRoom','variant','roomId','roomUuid','originalName','localName'];

export function createRegisteredFixtureRooms(hub,payloads,expected){
  const addresses=json(payloads.physicalAddresses),variants=new Map(json(payloads.variants).map(v=>[v.name,v]));
  assert.equal(addresses.length,expected.graphs,'fixture_graph_count_differs_from_manifest');
  const names=[],rooms=[],ids=new Set(),uuids=new Set();
  for(const [index,address] of addresses.entries()){
    fields(address,['logicalRoom','variant','room','plannedGraphId']);fields(address.room,['uuid','name']);
    assert.ok(typeof address.logicalRoom==='string'&&address.logicalRoom.length&&variants.has(address.variant));
    assert.ok(typeof address.room.name==='string'&&address.room.name.length);
    const id=`d2-${address.variant}-${address.logicalRoom}`,ordinal=index+1,name=localName(ordinal);
    assert.ok(!ids.has(id)&&!uuids.has(address.room.uuid));ids.add(id);uuids.add(address.room.uuid);
    const {room}=hub.createRoom({name:id,uuid:address.room.uuid,settings:{remembers:true,
      memoryInput:variants.get(address.variant).memoryInput,readsOtherRooms:'off'}});
    assert.equal(room.id,id);room.rename(name);assert.equal(room.name,name);
    names.push({ordinal,logicalRoom:address.logicalRoom,variant:address.variant,roomId:id,
      roomUuid:room.uuid,originalName:address.room.name,localName:name});rooms.push(room);
  }
  return {rooms,projection:json({schema:'configured-registered-room-local-template-v1',authority:'LOCAL_FIXTURE_ONLY',names})};
}

export function projectRegisteredFixtureTemplate({prior,projection,rooms,history,rows}){
  const projected=json(prior),map=json(projection),actualRows=json(rows);
  fields(map,['schema','authority','names']);assert.equal(map.schema,'configured-registered-room-local-template-v1');
  const graphs=projected.manifest.topology.length,episodes=projected.manifest.ingestion.plannedEpisodePosts;
  assert.equal(map.authority,'LOCAL_FIXTURE_ONLY');assert.equal(map.names.length,graphs);
  assert.equal(projected.payloads.physicalAddresses.length,graphs);assert.equal(rooms.length,graphs);assert.equal(actualRows.length,episodes);
  const seen=new Set();
  for(const [index,address] of projected.payloads.physicalAddresses.entries()){
    const name=map.names[index];fields(name,nameFields);assert.equal(name.ordinal,index+1);
    assert.equal(name.localName,localName(name.ordinal));assert.ok(!seen.has(name.roomId));seen.add(name.roomId);
    assert.equal(name.logicalRoom,address.logicalRoom);assert.equal(name.variant,address.variant);
    assert.equal(name.roomId,`d2-${address.variant}-${address.logicalRoom}`);
    assert.equal(name.roomUuid,address.room.uuid);assert.equal(name.originalName,address.room.name);
    const room=rooms.find(r=>r.id===name.roomId);assert.ok(room);assert.equal(room.uuid,name.roomUuid);assert.equal(room.name,name.localName);
    assert.equal(address.plannedGraphId,`viberoom-${room.uuid}`);address.room.name=name.localName;
  }
  let index=0;
  for(const planned of projected.payloads.rows){
    const name=map.names.find(n=>n.logicalRoom===planned.logicalRoom&&n.variant===planned.variant);assert.ok(name);
    assert.deepEqual(planned.room,{uuid:name.roomUuid,name:name.originalName});
    const room=rooms.find(r=>r.id===name.roomId);assert.ok(room);
    for(const member of planned.members){
      assert.equal(planned.sourceId,member.identity.sourceId,'fixture_planned_source_id_changed');
      const actual=actualRows[index++];assert.ok(actual);assert.equal(actual.state,'prepared');assert.equal(actual.attempts,0);assert.deepEqual(actual.externalIds,[]);
      const identity=json(member.identity);identity.copyId=actual.identity.copyId;
      assert.equal(canonical(identity),canonical(actual.identity),'fixture_identity_changed');
      const source=history.getById(room.id,member.identity.sourceId);assert.ok(source);
      assert.equal(sha256(source.text),planned.sourceBodySha256,'fixture_source_body_changed');
      assert.equal(planned.sourceVersion,member.identity.version,'fixture_planned_version_changed');
      assert.equal(source.seq,actual.payload.binding.seq,'fixture_persisted_seq_changed');if(member.payload.binding)assert.equal(member.payload.binding.seq,source.seq,'fixture_planned_seq_changed');
      assert.equal(sourceVersion(source),member.identity.version,'fixture_source_version_changed');
      const request=member.payload.request;fields(request,requestFields);
      const prefix=`${source.fromName} [${source.from}]: `;assert.ok(request.data.startsWith(prefix),'fixture_author_changed');
      const episode={authorName:source.fromName,authorId:source.from,text:request.data.slice(prefix.length),ts:source.ts,seq:source.seq};
      const inherited={...zepEpisodeRequest({uuid:name.roomUuid,name:name.originalName},episode),metadata:json(request.metadata)};
      assert.equal(canonical(inherited),canonical(request),'fixture_inherited_request_changed');
      const local=zepEpisodeRequest({uuid:room.uuid,name:room.name},episode);
      const expected=json(member.payload);expected.binding??=json(actual.payload.binding);expected.request={...local,metadata:json(request.metadata)};
      expected.request.metadata.op_id=actual.opId;expected.request.metadata.copy_id=actual.identity.copyId;
      assert.equal(canonical(expected),canonical(actual.payload),'fixture_projected_payload_changed');
      request.sourceDescription=local.sourceDescription;
    }
    planned.room.name=name.localName;
  }
  assert.equal(index,episodes);projected.purpose='local-fixture';return projected;
}

const setupStages=new Set(['ownership-registered','root-returned','trial-directory-returned','server-returned','server-started',
  'hub-returned','registered-rooms','warmup-requested','warmup-complete','sources-prepared','profile-prepared','binding-captured','ready']);

export function configuredFixtureSetupEvidence({test,setup,world,closure,state,journalObservation}){
  const phase=json(setup);fields(phase,['stage','warmupCompleted','worldReturned']);
  assert.ok(setupStages.has(phase.stage));assert.equal(typeof phase.warmupCompleted,'boolean');assert.equal(typeof phase.worldReturned,'boolean');
  assert.ok(typeof test==='string'&&test.length);assert.ok(world===null||world&&typeof world==='object');
  if(phase.warmupCompleted)assert.ok(world&&Array.isArray(world.warmupRequests));
  if(phase.worldReturned)assert.equal(phase.stage,'ready');
  if(phase.stage==='ready')assert.ok(phase.worldReturned&&phase.warmupCompleted&&world);
  assert.ok(['not-observed','absent','inspected'].includes(journalObservation));
  if(journalObservation==='inspected')assert.ok(state!==null);
  else assert.equal(state,null);
  const report=json(closure);
  const evidence={schema:'configured-hub-fixture-setup-evidence-v2',node:process.version,test,localOnly:true,actualD:'NOT_RUN',
    setup:phase,available:{world:world!==null,root:report.rootReturned,trialDirectory:report.trialReturned,
      server:report.server.constructorReturned,serverStarted:report.server.startReturned,
      hubOrdinals:report.hubs.filter(h=>h.constructorReturned).map(h=>h.ordinal)},
    warmupRequests:phase.warmupCompleted?json(world.warmupRequests):null,
    HTTP:world===null?null:json(world.HTTP),answerCopies:world===null?null:json(world.answerCopies),
    journalObservation,state:json(state),events:world===null?null:json(world.events),lastOutcome:world===null?null:json(world.lastOutcome??null),closure:report};
  const bytes=canonical(evidence);
  for(const marker of ['SYNTHETIC_CONFIGURED_ZEP_KEY','SYNTHETIC_CONFIGURED_ANSWER_KEY'])assert.equal(bytes.includes(marker),false,'fixture_evidence_secret');
  return evidence;
}
