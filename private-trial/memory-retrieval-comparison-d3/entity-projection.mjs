// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import { sameEventInstant } from '../memory-deletion-refresh-b18d/core.mjs';
import { json, fields, text, unique, canonical, sha256, Held } from './contracts.mjs';
import { captureDeclaredObject, verifyUnknownNativeFields } from './native-projection.mjs';

export const ENTITY_PROJECTION_PROFILE = Object.freeze({ schema: 'zep-3.28.0-scoped-native-entity-projection-v1',
  optionalUndefined: 'primary-SDK-declared-optionals-only-with-layout-record',
  graphId: 'nonempty-exact-or-measured-empty-placeholder-with-captured-request-scope',
  nodeEpisodes: 'all-supplied-IDs-current-bound-associations-not-summary-claim-lineage',
  truncatedSummary: 'hold-selected-summary-preserve-standalone-edges',
  searchMatch: 'exact-stable-typed-inventory-plus-validated-supplied-native-associations' });
const required = {
  edge: ['uuid', 'createdAt', 'fact', 'name', 'sourceNodeUuid', 'targetNodeUuid', 'episodes'],
  node: ['uuid', 'createdAt', 'name', 'summary'],
};
const optional = {
  edge: ['attributes', 'expiredAt', 'invalidAt', 'relevance', 'scope', 'score', 'selectionRank', 'sourceNodeLabels', 'sourceNodeName', 'targetNodeLabels', 'targetNodeName', 'validAt'],
  node: ['attributes', 'labels', 'relevance', 'score', 'selectionRank'],
};
const sdkOptional = { edge: [...optional.edge, 'episodes'], node: optional.node };
const passthrough = { edge: ['graph_id'], node: ['graph_id', 'episodes', 'episodes_truncated'] };
const declaredKeys = kind => [...required[kind], ...optional[kind], ...passthrough[kind]];
const rankKeys = ['score', 'relevance', 'selectionRank'];
const layoutHash = (row, undefinedOptionalFields, unknownNativeFields) =>
  sha256(canonical({ row, undefinedOptionalFields, ...(unknownNativeFields ? { unknownNativeFields } : {}) }));
const precise = value => assert.ok(sameEventInstant(value, value), 'Invalid precise native entity time');

export function captureSdkEntity(input, kind, { graphId, endpoint }) {
  assert.ok(Object.hasOwn(required, kind)); text(graphId); assert.ok(['list', 'search'].includes(endpoint));
  const { row: normalized, undefinedOptionalFields, unknownNativeFields } = captureDeclaredObject(input,
    { keys: declaredKeys(kind), optionalUndefined: sdkOptional[kind], setAsideUnknown: true });
  validateEntity(normalized, kind);
  if (Object.hasOwn(normalized, 'graph_id')) assert.ok(normalized.graph_id === '' || normalized.graph_id === graphId, 'Foreign entity graph');
  const layout = { uuid: normalized.uuid, endpoint, requestGraphId: graphId, undefinedOptionalFields: undefinedOptionalFields.sort(),
    rawGraphId: Object.hasOwn(normalized, 'graph_id') ? normalized.graph_id : null,
    graphIdQualification: normalized.graph_id === '' ? 'empty-native-placeholder-request-scope-only' : 'scoped-native-observation',
    ...(unknownNativeFields ? { unknownNativeFields } : {}), sha256: layoutHash(normalized, undefinedOptionalFields.sort(), unknownNativeFields) };
  return { row: normalized, layout };
}

export function validateEntity(row, kind) {
  assert.ok(Object.hasOwn(required, kind)); fields(row, required[kind], [...optional[kind], ...passthrough[kind]]);
  for (const key of required[kind].filter(k => !['episodes', 'summary'].includes(k))) text(row[key]);
  if (kind === 'node') assert.equal(typeof row.summary, 'string');
  precise(row.createdAt);
  for (const key of ['expiredAt', 'invalidAt', 'validAt']) if (Object.hasOwn(row, key)) precise(row[key]);
  for (const key of ['score', 'relevance']) if (Object.hasOwn(row, key)) assert.ok(typeof row[key] === 'number' && Number.isFinite(row[key]));
  if (Object.hasOwn(row, 'selectionRank')) assert.ok(Number.isSafeInteger(row.selectionRank) && row.selectionRank >= 0);
  for (const key of ['labels', 'sourceNodeLabels', 'targetNodeLabels', 'episodes']) if (Object.hasOwn(row, key)) {
    assert.ok(Array.isArray(row[key])); for (const item of row[key]) {
      if (key === 'episodes') text(item); else assert.equal(typeof item, 'string');
    }
    if (key === 'episodes') { unique(row[key].map(uuid => ({ uuid }))); if (kind === 'edge') assert.ok(row[key].length); }
  }
  for (const key of ['sourceNodeName', 'targetNodeName', 'scope', 'graph_id']) if (Object.hasOwn(row, key)) assert.equal(typeof row[key], 'string');
  if (Object.hasOwn(row, 'attributes')) assert.ok(row.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes));
  if (kind === 'node' && (Object.hasOwn(row, 'episodes') || Object.hasOwn(row, 'episodes_truncated'))) {
    assert.ok(Object.hasOwn(row, 'episodes') && Object.hasOwn(row, 'episodes_truncated'), 'Incomplete node association layout');
    assert.equal(typeof row.episodes_truncated, 'boolean');
  }
  return row;
}

export function verifyEntityScope(row, kind, graphId, episodeMap, layout, endpoint) {
  validateEntity(row, kind);
  if (layout) {
    fields(layout, ['uuid', 'endpoint', 'requestGraphId', 'undefinedOptionalFields', 'rawGraphId', 'graphIdQualification', 'sha256'], ['unknownNativeFields']);
    verifyUnknownNativeFields(layout, declaredKeys(kind));
    assert.equal(layout.uuid, row.uuid); assert.equal(layout.endpoint, endpoint); assert.equal(layout.requestGraphId, graphId);
    assert.equal(layout.rawGraphId, Object.hasOwn(row, 'graph_id') ? row.graph_id : null);
    assert.equal(layout.graphIdQualification, row.graph_id === '' ? 'empty-native-placeholder-request-scope-only' : 'scoped-native-observation');
    assert.ok(Array.isArray(layout.undefinedOptionalFields));
    assert.deepEqual(layout.undefinedOptionalFields, [...new Set(layout.undefinedOptionalFields)].sort());
    for (const key of layout.undefinedOptionalFields) assert.ok(sdkOptional[kind].includes(key) && !Object.hasOwn(row, key));
    assert.equal(layout.sha256, layoutHash(row, layout.undefinedOptionalFields, layout.unknownNativeFields), 'Entity layout hash differs');
  }
  if (Object.hasOwn(row, 'graph_id')) {
    if (row.graph_id === '') assert.ok(layout && layout.requestGraphId === graphId, 'Empty graph_id requires captured request scope');
    else assert.equal(row.graph_id, graphId, 'Foreign entity graph');
  }
  for (const id of row.episodes ?? []) assert.ok(episodeMap.has(id), 'Foreign/unverified native entity episode');
  return row;
}

const coreIdentity = (row, kind) => Object.fromEntries(Object.entries(row).filter(([key]) => ![...rankKeys, 'graph_id', ...(kind === 'node' ? ['episodes', 'episodes_truncated'] : [])].includes(key)));
export function sameEntity(candidate, saved, kind) {
  if (canonical(coreIdentity(candidate, kind)) !== canonical(coreIdentity(saved, kind))) return false;
  if (kind === 'node' && Object.hasOwn(candidate, 'episodes')) {
    if (!Object.hasOwn(saved, 'episodes') || canonical(candidate.episodes) !== canonical(saved.episodes) || candidate.episodes_truncated !== saved.episodes_truncated) return false;
  }
  return true;
}
export function requireSummaryAssociations(node) {
  if (node.episodes_truncated === true) throw new Held('node_episode_associations_truncated');
}
