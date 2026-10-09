// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { json, Held } from './contracts.mjs';

const field = (wire, parsed, type, optional = true) => Object.freeze({ wire, parsed, type, optional });
const same = (name, type, optional = true) => field(name, name, type, optional);
const dto = fields => Object.freeze(fields);
export const SDK_WIRE_FIELDS = Object.freeze({
  Graph: dto([field('created_at','createdAt','string'),same('description','string'),field('graph_id','graphId','string'),
    same('id','number'),same('name','string'),field('project_uuid','projectUuid','string'),field('time_zone','timeZone','string'),
    field('updated_at','updatedAt','string'),same('uuid','string')]),
  GraphSearchResults: dto([same('context','string'),same('edges','EntityEdge[]'),same('episodes','Episode[]'),same('nodes','EntityNode[]'),
    same('observations','DerivedNode[]'),same('response','GraphSearchResponseMetadata'),field('thread_summaries','threadSummaries','GraphitiSagaNode[]')]),
  GraphSearchResponseMetadata: dto([field('server_latency_ms','serverLatencyMs','number')]),
  Episode: dto([same('content','string',false),field('created_at','createdAt','string',false),same('metadata','record'),same('processed','boolean'),
    same('relevance','number'),same('role','string'),field('role_type','roleType','string'),same('score','number'),field('selection_rank','selectionRank','number'),
    same('source','string'),field('source_description','sourceDescription','string'),field('task_id','taskId','string'),field('thread_id','threadId','string'),same('uuid','string',false)]),
  EntityEdge: dto([same('attributes','record'),field('created_at','createdAt','string',false),same('episodes','string[]'),field('expired_at','expiredAt','string'),
    same('fact','string',false),field('invalid_at','invalidAt','string'),same('name','string',false),same('relevance','number'),same('scope','string'),same('score','number'),
    field('selection_rank','selectionRank','number'),field('source_node_labels','sourceNodeLabels','string[]'),field('source_node_name','sourceNodeName','string'),
    field('source_node_uuid','sourceNodeUuid','string',false),field('target_node_labels','targetNodeLabels','string[]'),field('target_node_name','targetNodeName','string'),
    field('target_node_uuid','targetNodeUuid','string',false),same('uuid','string',false),field('valid_at','validAt','string')]),
  EntityNode: dto([same('attributes','record'),field('created_at','createdAt','string',false),same('labels','string[]'),same('name','string',false),same('relevance','number'),
    same('score','number'),field('selection_rank','selectionRank','number'),same('summary','string',false),same('uuid','string',false)]),
  DerivedNode: dto([same('attributes','record'),field('created_at','createdAt','string',false),field('end_at','endAt','string'),field('episode_ids','episodeIds','string[]'),
    same('labels','string[]'),field('latest_evidence_at','latestEvidenceAt','string'),same('name','string',false),same('relevance','number'),same('score','number'),
    field('selection_rank','selectionRank','number'),field('start_at','startAt','string'),same('summary','string'),same('uuid','string',false)]),
  GraphitiSagaNode: dto([field('created_at','createdAt','string',false),same('labels','string[]'),field('last_summarized_at','lastSummarizedAt','string'),
    field('last_summarized_episode_valid_at','lastSummarizedEpisodeValidAt','string'),same('name','string',false),same('relevance','number'),same('score','number'),
    field('selection_rank','selectionRank','number'),same('summary','string'),same('uuid','string',false)]),
});
export const WIRE_PROJECTION_PROFILE = Object.freeze({ schema: 'zep-3.28.0-pre-sdk-native-wire-profile-v1',
  boundary: 'bounded-successful-JSON-BODY-before-SDK-object-key-transform', fields: SDK_WIRE_FIELDS,
  aliases: 'parsed-key-for-declared-different-wire-key-refuses-even-without-wire-key-or-in-either-order',
  knownValues: 'primary-required-and-structural-types-optional-null-retained-unmodified',
  extras: 'ordinary-JSON-evidence-no-authority-or-rewrite-closed-Episode-Entity-policy-unchanged',
  permissions: 'no-absence-current-source-budget-or-paid-permit' });
const reserved = ['sdkGraphLayout','sdkEntityLayouts','sdkEnvelopeLayout'];
const fail = reason => { throw new Held('native_wire_' + reason); };
function validateValue(value, type, at) {
  if (type.endsWith('[]')) {
    if (!Array.isArray(value)) fail(at + '_array');
    for (let i = 0; i < value.length; i++) validateValue(value[i], type.slice(0,-2), at + '_' + i);
  } else if (Object.hasOwn(SDK_WIRE_FIELDS,type)) validateDto(value,type);
  else if (type === 'record') { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at + '_record'); }
  else if (typeof value !== type || type === 'number' && !Number.isFinite(value)) fail(at + '_' + type);
}
function validateDto(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name + '_object');
  for (const key of reserved) if (Object.hasOwn(value,key)) fail(name + '_reserved_' + key);
  const fields = SDK_WIRE_FIELDS[name];
  for (const f of fields) if (f.wire !== f.parsed && Object.hasOwn(value,f.parsed)) fail(name + '_parsed_alias_' + f.parsed);
  for (const f of fields) {
    if (!Object.hasOwn(value,f.wire)) { if (!f.optional) fail(name + '_missing_' + f.wire); continue; }
    const v = value[f.wire]; if (v === null && f.optional) continue;
    validateValue(v,f.type,name + '_' + f.wire);
  }
}
function responseType(method, pathname) {
  if (method === 'POST' && pathname === '/graph/search') return 'GraphSearchResults';
  if (method === 'POST' && /^\/graph\/episodes\/graph\/[^/]+$/.test(pathname)) return 'Episode[]';
  if (method === 'POST' && /^\/graph\/edge\/graph\/[^/]+$/.test(pathname)) return 'EntityEdge[]';
  if (method === 'POST' && /^\/graph\/node\/graph\/[^/]+$/.test(pathname)) return 'EntityNode[]';
  if (method === 'GET' && /^\/graph\/episodes\/[^/]+$/.test(pathname)) return 'Episode';
  if (method === 'GET' && /^\/graph\/[^/]+$/.test(pathname)) return 'Graph';
  fail('endpoint_scope');
}
export function verifySdkWireBody(body, { method, pathname }) {
  const captured = json(body), type = responseType(method,pathname);
  validateValue(captured,type,type);
  return { schema: WIRE_PROJECTION_PROFILE.schema, responseType: type };
}
