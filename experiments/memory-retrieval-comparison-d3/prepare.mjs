// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import { EPISODE_PROJECTION_PROFILE } from './episode-projection.mjs';
import { ENTITY_PROJECTION_PROFILE } from './entity-projection.mjs';
import { ENVELOPE_PROJECTION_PROFILE } from './envelope-projection.mjs';
import { WIRE_PROJECTION_PROFILE } from './wire-projection.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { json, fields, text, digest, MODES, PROMPT, PROMPT_SHA256, sha256, encode, RunBudget } from './contracts.mjs';
import { captureAnswerControls, buildAnswerRequest } from './answer-profile.mjs';
import { inputContract } from './input-contract.mjs';

export const DEFAULT_LIMITS = Object.freeze({ maxReads: 2000, maxModelCalls: 300, maxPagesPerCollection: 2,
  pageSize: 50, maxResponseBytes: 2097152, maxAggregateBytes: 67108864, requestMs: 20000,
  runMs: 2700000, maxNodes: 12, edgeLimit: 12, autoMaxCharacters: 12000 });

export function prepareConnected({ questions, payloads, preparation, answerControls, limits = DEFAULT_LIMITS, codePins }) {
  questions = json(questions); payloads = json(payloads); preparation = json(preparation);
  answerControls = json(answerControls); codePins = json(codePins); limits = json(limits);
  assert.ok(Array.isArray(codePins) && codePins.length > 0);
  for (const p of codePins) { fields(p, ['path', 'sha256']); text(p.path); digest(p.sha256); }
  fields(questions, ['schema', 'corpusSha256', 'snapshotAt', 'queries']);
  assert.equal(questions.schema, 'viberoom-retrieval-question-projection-v1'); digest(questions.corpusSha256);
  assert.equal(payloads.schema, 'viberoom-retrieval-offline-payload-plan-v1');
  assert.equal(preparation.schema, 'viberoom-retrieval-offline-preparation-v1');
  assert.equal(payloads.corpusSha256, questions.corpusSha256); assert.equal(preparation.corpusSha256, questions.corpusSha256);
  assert.equal(preparation.paidExecutionAllowed, false); assert.equal(preparation.actualD, 'NOT_RUN');
  assert.equal(payloads.runId, preparation.runId); text(preparation.runId);
  for (const [name, value] of [['questions.json', questions], ['payloads.json', payloads]]) {
    const expected = preparation.files.filter(f => f.name === name); assert.equal(expected.length, 1);
    assert.equal(sha256(encode(value)), expected[0].sha256, 'D2 prepared input hash differs');
  }
  const input = inputContract(payloads), inputs = input.variants;
  answerControls = captureAnswerControls(answerControls);
  new RunBudget(limits);
  const ids = new Set();
  for (const q of questions.queries) { fields(q, ['id', 'room', 'query']); text(q.id); text(q.room); text(q.query); assert.ok([...q.query].length <= 400 && !ids.has(q.id)); ids.add(q.id); }
  const maxQuestionBytes = Math.max(...questions.queries.map(q => Buffer.byteLength(q.query)));
  const textEnvelopeBytes = Buffer.byteLength(PROMPT) + maxQuestionBytes + Buffer.byteLength('Question:\n\n\nContext:\n') + 4096;
  assert.ok(textEnvelopeBytes <= answerControls.requestProfile.maxInputTextUtf8Bytes, 'Shared context may exceed text input bound');
  const emptyRequestBytes = buildAnswerRequest(answerControls, { prompt: PROMPT, question: 'x', context: '' }).requestUtf8Bytes;
  const conservativeRequestBytes = emptyRequestBytes + 6 * maxQuestionBytes + 6 * 4096;
  const jobs = [];
  for (const [n, q] of questions.queries.entries()) {
    const variants = input.rotate(n);
    const modes = [...MODES.slice(n % 3), ...MODES.slice(0, n % 3)];
    for (const variant of variants) {
      const matches = payloads.physicalAddresses.filter(p => p.variant === variant && p.logicalRoom === q.room);
      assert.equal(matches.length, 1); const p = matches[0]; text(p.plannedGraphId);
      for (const mode of modes) jobs.push({ order: jobs.length + 1, questionId: q.id, room: q.room,
        query: q.query, variant, mode, graphId: p.plannedGraphId });
    }
  }
  const groups = payloads.physicalAddresses.map(p => {
    const rows = payloads.rows.filter(r => r.variant === p.variant && r.logicalRoom === p.logicalRoom);
    assert.ok(rows.length); const members = rows.flatMap(r => r.members);
    for (const row of rows) { text(row.sourceId); text(row.sourceVersion); digest(row.sourceBodySha256); assert.ok(row.members.length); }
    for (const m of members) { assert.equal(m.payload.request.type, 'message'); text(m.payload.request.data); assert.equal(m.payload.request.metadata.source_id, m.identity.sourceId); }
    return { logicalRoom: p.logicalRoom, variant: p.variant, graphId: p.plannedGraphId,
      roomUuid: p.room.uuid, episodeMembers: members.length, sourceCount: rows.length };
  });
  const plannedSearchCalls = questions.queries.length * inputs.length * 2;
  const maxObservationCalls = groups.reduce((n, g) => n + 2 * (1 + 3 * limits.maxPagesPerCollection + g.episodeMembers), 0);
  assert.ok(plannedSearchCalls + maxObservationCalls <= limits.maxReads && jobs.length <= limits.maxModelCalls, 'Shared budget cannot cover planned envelope');
  const manifest = {
    schema: 'viberoom-retrieval-connected-preparation-v2', runId: preparation.runId,
    inheritedD2Tree: '3b0fcd10ba9c4c6dd99d33fa3a2be8a0fb042318', corpusSha256: questions.corpusSha256,
    snapshotAt: questions.snapshotAt, sdk: { version: '3.28.0', normalizedFiles: 1007, normalizedSha256: 'eb636bab1f67f640fb76970942ed9aab792be0b440fbcd6584aa670c07f4a803' },
    inputs: { questionsSha256: sha256(encode(questions)), payloadsSha256: sha256(encode(payloads)), preparationSha256: sha256(encode(preparation)) },
    codePins, promptSha256: PROMPT_SHA256, answerControls, contextMaxUtf8BytesIncludingProvenance: 4096,
    answerRequestBudget: { inputTextUtf8BytesPerAttemptAtMost: answerControls.requestProfile.maxInputTextUtf8Bytes,
      serializedRequestUtf8BytesPerAttemptAtMost: answerControls.requestProfile.maxRequestUtf8Bytes,
      plannedTextEnvelopeBytes: textEnvelopeBytes, conservativeArbitraryEscapedJsonEnvelopeBytes: conservativeRequestBytes,
      arbitraryEscapedContextMayHold: conservativeRequestBytes > answerControls.requestProfile.maxRequestUtf8Bytes,
      generatedVisibleAndReasoningTokensPerAttemptAtMost: answerControls.requestProfile.maxCompletionTokens,
      aggregateInputTextUtf8BytesAtMost: jobs.length * answerControls.requestProfile.maxInputTextUtf8Bytes,
      aggregateSerializedRequestUtf8BytesAtMost: jobs.length * answerControls.requestProfile.maxRequestUtf8Bytes,
      aggregateCompletionTokensAtMost: jobs.length * answerControls.requestProfile.maxCompletionTokens,
      exactVendorInputTokenUpperBound: null, invoiceCostUpperBound: null,
      qualification: 'Byte caps are not exact vendor token ceilings; model formatting/tokenization and cache-write billing require explicit later budget qualification' },
    nativeEpisodeProjection: EPISODE_PROJECTION_PROFILE,
    nativeEntityProjection: ENTITY_PROJECTION_PROFILE,
    nativeEnvelopeProjection: ENVELOPE_PROJECTION_PROFILE,
    nativeWireProjection: WIRE_PROJECTION_PROFILE,
    topology: groups, jobs, limits, plannedBounds: { observations: 2, observationCallsAtMost: maxObservationCalls,
      retrievalSearchCallsAtMost: plannedSearchCalls, modelAttemptsAtMost: jobs.length,
      SDKReadAttemptsAtMost: maxObservationCalls + plannedSearchCalls, hiddenRetries: 0,
      allowedMethods: ['GET graph', 'POST edge/node/episode graph list (read)', 'GET episode original', 'POST graph/search (read)', 'POST explicit answer endpoint'] },
    ingestion: { executed: false, plannedEpisodePosts: preparation.plannedEpisodePostCount,
      localEstimatedCredits: preparation.budget.estimatedIngestionCredits, currentAuthorizationCredits: preparation.budget.authorizedCredits,
      fullInvoiceUpperBound: null, actualServiceEmissionBinding: 'REQUIRED_FINAL_ACCEPTED_C_E',
      authorizedIngestionAndActualACKs: 'REQUIRED_EXTERNAL_OWNER', noWritesInThisRunner: true },
    paidExecutionAllowed: false, actualD: 'NOT_RUN', semanticQuality: 'NOT_MEASURED', releaseAcceptance: false,
    oneRun: { owner: 'EXTERNAL_EXISTING_APPROVED_JOB_OWNER', durableClaim: 'NOT_CREATED',
      exactManifestHashRequired: true, uncertainAttemptStopsRun: true, resendOrNewIDAllowed: false },
    finish: { stopAllTrialWriters: true, automaticDelete: false, retainDiagnosticGraphs: true,
      cleanupLifecycle: 'EXTERNAL_OWNER_REVIEW_REQUIRED', replayPriorBRun: false },
    remaining: ['Final accepted C/E service-emission and current source authority binding',
      `Explicit human budget decision for the whole trial; the authorized ${preparation.budget.authorizedCredits} credits do not cover the local estimate of ${preparation.budget.estimatedIngestionCredits}`,
      'Authorized graph ingestion/ontology and exact ACKs outside this reader',
      'Actual connected D answers and independent semantic adjudication', 'Final current/inventory observations and explicit retained-graph lifecycle'],
  };
  return { manifest, files: { 'MANIFEST.json': encode(manifest), 'questions.json': encode(questions),
    'payloads.json': encode(payloads), 'ANSWER-PROMPT.txt': Buffer.from(PROMPT + '\n') } };
}

async function main() {
  const { values } = parseArgs({ options: Object.fromEntries(['questions', 'payloads', 'preparation', 'answer-controls', 'code-pins', 'output'].map(k => [k, { type: 'string' }])), strict: true });
  for (const k of ['questions', 'payloads', 'preparation', 'answer-controls', 'code-pins', 'output']) assert.ok(values[k], `Missing --${k}`);
  const load = async k => JSON.parse(await readFile(resolve(values[k]), 'utf8'));
  const prepared = prepareConnected({ questions: await load('questions'), payloads: await load('payloads'), preparation: await load('preparation'),
    answerControls: await load('answer-controls'), codePins: await load('code-pins') });
  const out = resolve(values.output); await mkdir(out, { recursive: false });
  for (const [name, bytes] of Object.entries(prepared.files)) await writeFile(join(out, name), bytes, { flag: 'wx' });
  console.log(JSON.stringify({ output: out, manifestSha256: sha256(prepared.files['MANIFEST.json']), actualD: 'NOT_RUN', paidExecutionAllowed: false }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
