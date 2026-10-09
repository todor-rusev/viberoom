// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import { sameEventInstant } from '../memory-deletion-refresh-b18d/core.mjs';
import { json, fields, text, canonical, sha256 } from './contracts.mjs';
import { captureDeclaredObject } from './native-projection.mjs';

export const EPISODE_PROJECTION_SCHEMA = 'zep-3.28.0-list-direct-get-episode-projection-v1';
export const EPISODE_PROJECTION_PROFILE = Object.freeze({ schema: EPISODE_PROJECTION_SCHEMA,
  listTime: 'independent-precise-observation', directGetTime: 'precise-submitted-createdAt-and-source_at',
  optionalNull: 'session_id-null-only-or-absent', sdkOptionalUndefined: 'declared-optionals-only-with-layout-record',
  autoMatch: 'strict-observed-direct-get-projection' });
const requiredKeys = ['uuid', 'content', 'metadata', 'processed', 'createdAt'];
const stringKeys = ['role', 'roleType', 'source', 'sourceDescription', 'taskId', 'threadId'];
const rankKeys = ['score', 'relevance', 'selectionRank'];
const optionalKeys = [...stringKeys, ...rankKeys, 'session_id'];
export const EPISODE_KEYS = [...requiredKeys, ...optionalKeys];
const same = (a, b) => canonical(a) === canonical(b);
const precise = value => assert.ok(sameEventInstant(value, value), 'Episode time is not a supported precise RFC3339 instant');

export function captureSdkEpisode(input) {
  return captureDeclaredObject(input, { keys: EPISODE_KEYS, optionalUndefined: [...stringKeys, ...rankKeys], setAsideUnknown: true });
}

export function validateEpisodeProjection(input, endpoint) {
  assert.ok(['list', 'direct-get', 'auto'].includes(endpoint));
  const row = captureSdkEpisode(input).row;
  fields(row, requiredKeys, optionalKeys);
  text(row.uuid); assert.equal(typeof row.content, 'string');
  assert.ok(row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata));
  assert.equal(row.processed, true); precise(row.createdAt);
  for (const key of stringKeys) if (Object.hasOwn(row, key)) assert.equal(typeof row[key], 'string');
  if (Object.hasOwn(row, 'roleType')) assert.ok(['norole', 'system', 'assistant', 'user', 'function', 'tool'].includes(row.roleType));
  if (Object.hasOwn(row, 'source')) assert.ok(['text', 'json', 'message', 'fact_triple'].includes(row.source));
  for (const key of ['score', 'relevance']) if (Object.hasOwn(row, key)) assert.ok(typeof row[key] === 'number' && Number.isFinite(row[key]));
  if (Object.hasOwn(row, 'selectionRank')) assert.ok(Number.isSafeInteger(row.selectionRank) && row.selectionRank >= 0);
  if (Object.hasOwn(row, 'session_id')) assert.equal(row.session_id, null, 'Only the observed null session_id layout is supported');
  return row;
}

function identity(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !['createdAt', 'session_id', ...rankKeys].includes(key)));
}

export function verifyEpisodePair(listInput, getInput, requestInput, episodeId) {
  const list = validateEpisodeProjection(listInput, 'list'), get = validateEpisodeProjection(getInput, 'direct-get');
  const request = json(requestInput);
  text(episodeId); assert.equal(list.uuid, episodeId); assert.equal(get.uuid, episodeId);
  assert.ok(same(identity(list), identity(get)), 'LIST/direct GET identity or provenance differs');
  assert.equal(get.content, request.data, 'Original body differs');
  assert.ok(same(get.metadata, request.metadata), 'Original provenance differs');
  assert.ok(sameEventInstant(request.createdAt, request.metadata.source_at), 'Submitted event time/source_at differs');
  assert.ok(sameEventInstant(get.createdAt, request.createdAt) && sameEventInstant(get.createdAt, request.metadata.source_at), 'Original GET event time differs');
  if (Object.hasOwn(get, 'source')) assert.equal(get.source, request.type, 'Native source type differs');
  if (Object.hasOwn(get, 'sourceDescription')) assert.equal(get.sourceDescription, request.sourceDescription, 'Native source description differs');
  return {
    schema: EPISODE_PROJECTION_SCHEMA, episodeId,
    identity: { ...identity(get), eventTime: request.createdAt },
    list: { createdAt: list.createdAt, undefinedOptionalFields: captureSdkEpisode(listInput).undefinedOptionalFields, sha256: sha256(canonical(captureSdkEpisode(listInput))) },
    directGet: { createdAt: get.createdAt, undefinedOptionalFields: captureSdkEpisode(getInput).undefinedOptionalFields, sha256: sha256(canonical(captureSdkEpisode(getInput))) },
    qualification: 'Independent LIST observation time; direct GET proves precise submitted/source event time. Raw endpoint hashes include all optional/null/rank fields.',
  };
}
