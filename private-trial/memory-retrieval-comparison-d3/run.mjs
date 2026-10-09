// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import invariant from 'node:assert/strict';
import { json, fields, canonical, sha256, encode, digest, text, RunBudget, Held, awaited, PROMPT, PROMPT_SHA256 } from './contracts.mjs';
import { verifySnapshot, formatContext } from './lineage.mjs';
import { EPISODE_PROJECTION_PROFILE } from './episode-projection.mjs';
import { ENTITY_PROJECTION_PROFILE } from './entity-projection.mjs';
import { ENVELOPE_PROJECTION_PROFILE } from './envelope-projection.mjs';
import { WIRE_PROJECTION_PROFILE } from './wire-projection.mjs';
import {NATIVE_ENTRY,NATIVE_FINAL} from '../memory-retrieval-trial-d5/native-project.mjs';

export async function runComparison({ manifest: inputManifest, questions, payloads, preparation, permit, authorities, readPort, answerPort, current, budget, record, onJob = () => {}, nativeCapability = null }) {
  const manifest = json(inputManifest), mhash = sha256(encode(manifest));
  questions = json(questions); payloads = json(payloads); preparation = json(preparation);
  permit = json(permit); authorities = json(authorities);
  assert.equal(manifest.schema, 'viberoom-retrieval-connected-preparation-v2');
  assert.equal(canonical(manifest.nativeEpisodeProjection), canonical(EPISODE_PROJECTION_PROFILE));
  assert.equal(canonical(manifest.nativeEntityProjection), canonical(ENTITY_PROJECTION_PROFILE));
  assert.equal(canonical(manifest.nativeEnvelopeProjection), canonical(ENVELOPE_PROJECTION_PROFILE));
  assert.equal(canonical(manifest.nativeWireProjection), canonical(WIRE_PROJECTION_PROFILE));
  assert.equal(manifest.paidExecutionAllowed, false);
  assert.equal(sha256(encode(questions)), manifest.inputs.questionsSha256);
  assert.equal(sha256(encode(payloads)), manifest.inputs.payloadsSha256);
  assert.equal(sha256(encode(preparation)), manifest.inputs.preparationSha256);
  assert.equal(manifest.promptSha256, PROMPT_SHA256);
  assert.equal(manifest.contextMaxUtf8BytesIncludingProvenance, 4096);
  assert.ok(budget instanceof RunBudget && canonical(budget.limits) === canonical(manifest.limits));
  invariant.equal(typeof budget.recordAttempt, 'function', 'Existing owner must record attempts before I/O');
  const nativeMode=permit.schema===NATIVE_ENTRY;
  fields(permit, ['schema', 'purpose', 'manifestSha256', 'runId', 'ownerClaimId', 'approved', 'expiresAt',
    ...(nativeMode?['accountScopeSha256','provisionalAuthoritySha256','nativeBindingSetSha256']:['currentAuthoritySha256']), 'serviceEmissionBinding', 'wholeTrialBudgetApproved', 'readOrigin', 'answerOrigin']);
  assert.equal(permit.schema,nativeMode?NATIVE_ENTRY:'viberoom-retrieval-external-job-permit-v1');
  assert.equal(permit.manifestSha256, mhash); assert.equal(permit.runId, manifest.runId);
  assert.equal(permit.approved, true); text(permit.ownerClaimId);
  assert.ok(['local-fixture', 'approved-paid-trial'].includes(permit.purpose));
  if(nativeMode){assert.ok(nativeCapability);assert.equal(permit.provisionalAuthoritySha256,sha256(encode(authorities)));assert.equal(permit.nativeBindingSetSha256,null);}
  else {assert.equal(nativeCapability,null);assert.equal(permit.currentAuthoritySha256,sha256(encode(authorities)));}
  if (permit.purpose === 'approved-paid-trial') {
    assert.equal(permit.wholeTrialBudgetApproved, true);
    assert.ok(permit.serviceEmissionBinding && typeof permit.serviceEmissionBinding === 'object');
    fields(permit.serviceEmissionBinding, ['acceptedCETree', 'actualServiceEmissionsSha256', 'authorizedIngestionReceiptSha256']);
    assert.match(permit.serviceEmissionBinding.acceptedCETree, /^[a-f0-9]{64}$/);
    digest(permit.serviceEmissionBinding.actualServiceEmissionsSha256); digest(permit.serviceEmissionBinding.authorizedIngestionReceiptSha256);
  } else {
    assert.equal(permit.wholeTrialBudgetApproved, false); assert.equal(permit.serviceEmissionBinding, null);
  }
  invariant.equal(typeof current, 'function'); invariant.equal(typeof record, 'function');
  invariant.equal(typeof onJob, 'function');
  assert.equal(readPort.kind, 'zep-sdk-3.28.0-read-only');
  assert.equal(readPort.origin, permit.readOrigin); assert.equal(answerPort.origin, permit.answerOrigin);
  const expectedPurpose = permit.purpose === 'local-fixture' ? 'local-fixture' : 'approved-job';
  assert.equal(readPort.purpose, expectedPurpose); assert.equal(answerPort.purpose, expectedPurpose);
  assert.equal(canonical(answerPort.answerControls), canonical(manifest.answerControls));
  const search = readPort.search.bind(readPort), observe = readPort.observe.bind(readPort), answer = answerPort.answer.bind(answerPort);
  const expiry = Date.parse(permit.expiresAt); assert.ok(Number.isFinite(expiry));
  const guard = () => {
    budget.check(); if (Date.now() >= expiry || current({ manifestSha256: mhash, permit, authorities }) !== true) {
      budget.stop('current_or_permit_expired'); throw new Held('current_or_permit_expired');
    }
  };
  const boundary = async op => { guard(); const value = await awaited(budget, op); guard(); return value; };
  const observations = [], results = [], verified = new Map(), rawSearch = new Map();
  const result = { schema: 'viberoom-retrieval-connected-run-v1', runId: manifest.runId, manifestSha256: mhash,
    purpose: permit.purpose, actualD: permit.purpose === 'local-fixture' ? 'LOCAL_FIXTURE_ONLY' : 'INCOMPLETE',
    status: 'incomplete', snapshotQualification: 'Two bounded observations; no remote quiescence, cohort or server CAS guarantee',
    observations, records: results, semanticQuality: 'NOT_ADJUDICATED', releaseAcceptance: false, summary: null, error: null };
  try {
    guard();
    assert.equal(authorities.length, manifest.topology.length);
    for (const graph of manifest.topology) {
      const found = authorities.filter(a => a.graphId === graph.graphId); assert.equal(found.length, 1);
      assert.equal(found[0].room, graph.logicalRoom); assert.equal(found[0].roomUuid, graph.roomUuid);
      const rows = payloads.rows.filter(r => r.variant === graph.variant && r.logicalRoom === graph.logicalRoom);
      const snapshot = await boundary(() => observe(graph.graphId,nativeMode?nativeCapability.T0:null));
      const authority=nativeMode?nativeCapability.resolveT0(graph.graphId):found[0];
      const v = verifySnapshot(snapshot, authority, rows); verified.set(graph.graphId, v);
      const observation = { phase: 'T0', graphId: graph.graphId, fingerprint: v.fingerprint, episodeEndpointObservations: v.episodeEndpointObservations, entityEndpointObservations: v.entityEndpointObservations, raw: v.snapshot };
      observations.push(observation); record('observation', json(observation)); guard();
    }
    if(nativeMode){
      guard();const final=nativeCapability.completeT0(observations.map(o=>({graphId:o.graphId,snapshot:o.raw})));
      assert.equal(final.permit.schema,NATIVE_FINAL);permit=json(final.permit);authorities=json(final.authorities);
      assert.equal(permit.currentAuthoritySha256,sha256(encode(authorities)));assert.equal(nativeCapability.verifyFinal(permit,authorities),true);guard();
      record('native-handoff',json({schema:NATIVE_FINAL,accountScopeSha256:permit.accountScopeSha256,nativeBindingSetSha256:permit.nativeBindingSetSha256,currentAuthoritySha256:permit.currentAuthoritySha256}));guard();
    }
    for (const job of manifest.jobs) {
      guard();
      if(nativeMode)assert.equal(nativeCapability.verifyFinal(permit,authorities),true);
      onJob(json(job));
      const query = questions.queries.find(q => q.id === job.questionId);
      assert.ok(query && query.room === job.room && query.query === job.query);
      const row = { job: json(job), status: 'held', answer: null, context: null, sourceIds: [], sources: [], citations: [],
        omissions: [], error: null, retrievalLatencyMs: null, answerLatencyMs: null, inputTokens: null, outputTokens: null,
        retrievalCost: null, answerCost: null, currency: null, attempts: { retrieval: 0, model: 0 }, cacheState: manifest.answerControls.cacheState };
      row.cachedInputTokens = null; row.cacheWriteInputTokens = null; row.reasoningOutputTokens = null; row.serviceTier = null;
      results.push(row);
      try {
        const family = job.mode === 'auto-raw' ? 'auto-raw' : 'edges-cross-encoder';
        const key = `${job.graphId}|${job.questionId}|${family}`;
        let retrieval = rawSearch.get(key);
        if (!retrieval) {
          const start = budget.clock(); row.attempts.retrieval = 1;
          const raw = await boundary(() => search(job.graphId, job.query, family));
          retrieval = { raw: json(raw), latencyMs: budget.clock() - start, key }; rawSearch.set(key, retrieval);
          record('retrieval', { job: json(job), key, raw: retrieval.raw }); guard();
        }
        row.retrievalSharing = { key, reused: row.attempts.retrieval === 0 }; row.retrievalLatencyMs = retrieval.latencyMs;
        const context = formatContext(retrieval.raw, verified.get(job.graphId), job.mode,
          { maxNodes: manifest.limits.maxNodes, snapshotAt: manifest.snapshotAt }, manifest.contextMaxUtf8BytesIncludingProvenance);
        row.context = context.context; row.sourceIds = context.sourceIds; row.sources = context.sources; row.omissions = context.omissions;
        row.contextUtf8Bytes = context.utf8Bytes; row.derivativeQualification = context.derivativeQualification;
        guard(); row.attempts.model = 1;
        const captured = json(await boundary(signal => answer({ prompt: PROMPT, question: job.query, context: context.context, approval: 'approved-job' }, signal)));
        fields(captured, ['answer', 'usage', 'latencyMs', 'cost', 'currency', 'attempt', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens', 'serviceTier']);
        assert.equal(typeof captured.answer, 'string'); assert.ok(captured.cost === null && captured.currency === null);
        row.answer = captured.answer; row.answerLatencyMs = captured.latencyMs;
        row.inputTokens = captured.usage?.prompt_tokens ?? null; row.outputTokens = captured.usage?.completion_tokens ?? null;
        for (const k of ['cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens', 'serviceTier']) row[k] = captured[k];
        row.status = captured.answer.length ? 'captured-unjudged' : 'empty';
        record('answer', json(row)); guard();
      } catch (error) {
        row.error = error.name === 'Held' ? error.message : `local_contract_refusal: ${String(error?.message ?? error).split(/\r?\n/)[0].slice(0, 200)}`;
        row.status = budget.stopped ? 'unknown' : 'held'; record('held', json(row));
        if (budget.stopped) throw error;
      } finally { onJob(null); }
    }
    for (const graph of manifest.topology) {
      if(nativeMode)assert.equal(nativeCapability.verifyFinal(permit,authorities),true);
      const v = verified.get(graph.graphId), snapshot = await boundary(() => observe(graph.graphId,nativeMode?nativeCapability.T1:null));
      const rows = payloads.rows.filter(r => r.variant === graph.variant && r.logicalRoom === graph.logicalRoom);
      const after = verifySnapshot(snapshot, v.authority, rows);
      assert.ok(Date.parse(after.snapshot.startedAt) >= Date.parse(v.snapshot.finishedAt));
      const observation = { phase: 'T1', graphId: graph.graphId, fingerprint: after.fingerprint, episodeEndpointObservations: after.episodeEndpointObservations, entityEndpointObservations: after.entityEndpointObservations, raw: after.snapshot };
      observations.push(observation); record('observation', json(observation)); guard();
      if (after.fingerprint !== v.fingerprint) throw new Held('observed_inventory_drift');
    }
    guard(); result.status = results.every(r => r.status === 'captured-unjudged' || r.status === 'empty') ? 'captured-unjudged' : 'incomplete';
    if (permit.purpose !== 'local-fixture') result.actualD = result.status === 'captured-unjudged' ? 'CAPTURED_NOT_ADJUDICATED' : 'INCOMPLETE';
  } catch (error) {
    result.error = error.name === 'Held' ? error.message : 'authority_or_local_contract_refusal';
    record('refusal', { name: error.name, message: error.message, where: typeof error.stack === 'string' ? error.stack.split('\n').slice(1, 6).map(line => line.trim()) : [] });
    budget.stop(result.error); result.status = 'held';
    for (const row of results) { row.usableForComparison = false; }
  }
  result.summary = budget.summary(); result.attempts = json(budget.attempts); record('finish', json(result)); return result;
}
