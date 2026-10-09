// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import {readFileSync} from 'node:fs';
import {prepareWritePermits,trialPolicy} from './profile.mjs';
import {prepareConnected} from '../memory-retrieval-comparison-d3/prepare.mjs';
import {json,canonical,encode,sha256} from '../memory-retrieval-comparison-d3/contracts.mjs';
import {zepGraphId,zepEpisodeRequest} from '../../dist/memory/zep-payload.js';
import {sourceVersion,messageSource} from '../../dist/memory/provenance.js';

export function comparePreparedTemplateMember({planned,actual,room,source}){
  const expected=json(planned),description=zepEpisodeRequest({uuid:room.uuid,name:room.name},{seq:source.seq,authorId:source.from,authorName:source.fromName,text:source.text,ts:source.ts}).sourceDescription;
  assert.equal(source.id,planned.identity.sourceId);assert.equal(sourceVersion(source),planned.identity.version);
  const binding={source:{...messageSource(source),...(planned.identity.graphId===undefined?{}:{graphId:planned.identity.graphId})},seq:source.seq};
  if(planned.payload.binding!==undefined)assert.equal(canonical(planned.payload.binding),canonical(binding),'template_binding_changed');
  expected.opId=actual.opId;expected.identity.roomId=room.id;expected.identity.roomUuid=room.uuid;expected.identity.copyId=actual.identity.copyId;
  expected.payload.request.graphId=zepGraphId(room.uuid);expected.payload.request.sourceDescription=description;
  expected.payload.request.metadata.room_id=room.uuid;expected.payload.request.metadata.op_id=actual.opId;expected.payload.request.metadata.copy_id=actual.identity.copyId;
  expected.payload.binding=binding;
  assert.equal(canonical(expected.identity),canonical(actual.identity),'prepared_identity_changed');assert.equal(canonical(expected.payload),canonical(actual.payload),'prepared_payload_or_provenance_changed');return expected;
}

export function prepareProductProfile({prior,preparation,rows,account,origins,codePins,preparationPin}){
  prior=json(prior);preparation=json(preparation);rows=json(rows);const payloads=prior.payloads;
  const episodes=payloads.rows.flatMap(row=>row.members).length;assert.equal(rows.length,episodes);assert.equal(new Set(rows.map(r=>r.opId)).size,episodes);let i=0;
  for(const planned of payloads.rows)for(const m of planned.members){
    const r=rows[i++];assert.equal(r.state,'prepared');assert.equal(r.attempts,0);assert.deepEqual(r.externalIds,[]);
    assert.equal(r.identity.sourceId,m.identity.sourceId);assert.equal(r.identity.roomId,m.identity.roomId);assert.equal(r.identity.version,m.identity.version);assert.equal(r.identity.part,m.identity.part);
    const expected=json(m.payload.request);expected.metadata.op_id=r.opId;expected.metadata.copy_id=r.identity.copyId;
    assert.equal(canonical(expected),canonical(r.payload.request),'prepared_product_bytes_changed');
    m.opId=r.opId;m.identity=json(r.identity);m.payload=json(r.payload);
  }
  const pin=preparation.files.find(f=>f.name==='payloads.json');pin.sha256=sha256(encode(payloads));pin.bytes=encode(payloads).length;
  delete preparation.freshLocalServiceBinding;
  preparation.freshLocalProductPreparation={pin:json(preparationPin),qualification:'Prepared local rows, zero attempts and no receipts. Live scope and current C/E/native acceptance pending.'};
  for(const p of codePins)assert.equal(sha256(readFileSync(p.path)),p.sha256);
  const connected=prepareConnected({questions:prior.questions,payloads,preparation,answerControls:prior.manifest.answerControls,limits:prior.manifest.limits,codePins});
  const manifest=connected.manifest,writePermits=prepareWritePermits(payloads,origins.readBase);
  const scope={schema:'viberoom-whole-long-prepared-product-scope-v1',runId:manifest.runId,corpusSha256:manifest.corpusSha256,acceptedCETree:prior.review.acceptedCETree,
    evidence:{localPreparedSources:json(preparationPin)},graphs:manifest.topology.map(t=>({graphId:t.graphId,authority:{accountId:account,projectId:'LOCAL_UNVERIFIED_PROJECT',graphId:t.graphId,room:t.logicalRoom,roomUuid:t.roomUuid,
      copyId:payloads.rows.find(r=>r.logicalRoom===t.logicalRoom&&r.variant===t.variant).members[0].identity.copyId,generationId:'LOCAL_BASE_GENERATION',routeRevision:'LOCAL_PREPARATION_ONLY',scopeRevision:'1',verificationId:preparationPin.sha256,sourceState:'verified-current-authorized'}})),
    members:writePermits.filter(p=>p.kind==='episode').map(p=>({permitId:p.id,graphId:p.request.body.graph_id,opId:p.request.body.metadata.op_id,sourceId:p.request.body.metadata.source_id,version:p.request.body.metadata.version,part:p.request.body.metadata.part})),
    liveReceiptIds:[],gates:{executorAccepted:false,currentCENativeAccepted:false,liveAccountCopyConsentBound:false},actualD:'NOT_RUN',liveAuthority:false,
    qualification:'Fresh LOCAL prepared owner rows, not service emissions or Cloud authority. The ACK bindings of every planned episode remain after authorized ingestion.'};
  const profile={...prior,manifest,payloads,writePermits,origins,codePins,review:{...prior.review,d3Accepted:false,d3ProofSha256:null,serviceEmissionProofSha256:sha256(encode(scope))}};
  trialPolicy(profile);return {profile,scope,preparation};
}

export function prepareIsolatedProductProfile({prior,preparation,materialization,account,origins,codePins,preparationPin,routeObservations,history}){
  prior=json(prior);preparation=json(preparation);materialization=json(materialization);
  assert.equal(materialization.schema,'same-hub-private-trial-materialization-v1');
  assert.equal(materialization.rows.length,prior.payloads.rows.flatMap(row=>row.members).length);assert.equal(materialization.rooms.length,prior.payloads.physicalAddresses.length);
  const runId='isolated-native-'+materialization.namespaceId;prior.payloads.runId=runId;preparation.runId=runId;
  for(const p of prior.payloads.physicalAddresses){const room=materialization.rooms.find(r=>r.logicalRoom===p.logicalRoom&&r.variant===p.variant);assert.ok(room);
    p.room={uuid:room.uuid,name:room.name};p.plannedGraphId=zepGraphId(room.uuid);
  }
  let i=0;for(const row of prior.payloads.rows){const room=materialization.rooms.find(r=>r.logicalRoom===row.logicalRoom&&r.variant===row.variant);assert.ok(room);row.room={uuid:room.uuid,name:room.name};
    for(const m of row.members){const actual=materialization.rows[i++];assert.equal(actual.identity.sourceId,m.identity.sourceId);assert.equal(actual.identity.version,m.identity.version);assert.equal(actual.identity.part,m.identity.part);
      assert.equal(actual.identity.roomId,room.id);assert.equal(actual.identity.roomUuid,room.uuid);
      const source=history.getById(room.id,m.identity.sourceId);assert.ok(source&&source.seq===actual.payload.binding.seq);
      assert.equal(sha256(source.text),row.sourceBodySha256,'template_source_body_changed');
      const expected=comparePreparedTemplateMember({planned:m,actual,room,source});
      if(row.representationFingerprint!==undefined){
        const group=history.memoryOutbox.deliveries.getPartGroup(actual.groupId);assert.ok(group);const part=group.descriptor.parts.find(p=>p.opId===actual.opId);assert.ok(part);
        assert.equal(group.descriptor.representationFingerprint,row.representationFingerprint);assert.equal(canonical(group.descriptor.policy),canonical(row.profile.input));
        assert.equal(canonical({start:part.start,end:part.end}),canonical(m.sourceOffsets));assert.equal(part.utf8Bytes,m.dataUtf8Bytes);assert.equal(part.fingerprint,'sha256:'+sha256(actual.payload.request.data));
      }else{assert.equal(row.input,'excerpts','template_whole_row_without_representation');assert.equal(row.members.length,1);assert.equal(m.identity.part,'1/1');}
      m.identity.roomId=room.id;m.identity.roomUuid=room.uuid;
      m.payload.request.graphId=zepGraphId(room.uuid);m.payload.request.metadata.room_id=room.uuid;
      m.payload.request.sourceDescription=expected.payload.request.sourceDescription;
    }
  }
  const prepared=prepareProductProfile({prior,preparation,rows:materialization.rows,account,origins,codePins,preparationPin});
  for(const graph of prepared.scope.graphs){
    const observed=routeObservations.find(r=>r.uuid===graph.authority.roomUuid);assert.ok(observed&&!observed.head.reason&&!observed.head.followPending&&!observed.attachment);
    graph.authority.generationId='implicit-base:'+graph.graphId;
    graph.authority.routeRevision=observed.head.revision;graph.authority.scopeRevision=preparationPin.sha256;graph.authority.verificationId=preparationPin.sha256;
  }
  prepared.scope.evidence.privateNamespace={schema:'same-hub-private-trial-source-v1',namespaceId:materialization.namespaceId,materialization:json(preparationPin)};
  prepared.profile.review.serviceEmissionProofSha256=sha256(encode(prepared.scope));return prepared;
}
