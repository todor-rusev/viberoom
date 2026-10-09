// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import { json, fields, text, instant, unique, canonical, sha256, Held } from './contracts.mjs';
import { validateEpisodeProjection, verifyEpisodePair, EPISODE_KEYS } from './episode-projection.mjs';
import { verifyUnknownNativeFields } from './native-projection.mjs';
import { validateEntity, verifyEntityScope, sameEntity, requireSummaryAssociations } from './entity-projection.mjs';
import { verifyGraphLayout, verifySearchEnvelope } from './envelope-projection.mjs';

const observationKeys = ['attributes', 'createdAt', 'endAt', 'episodeIds', 'labels', 'latestEvidenceAt', 'name', 'relevance', 'score', 'selectionRank', 'startAt', 'summary', 'uuid'];
const rankKeys = new Set(['score', 'relevance', 'selectionRank']);
const native = row => Object.fromEntries(Object.entries(row).filter(([k]) => !rankKeys.has(k)));
const same = (a, b) => canonical(a) === canonical(b);
function required(row, keys, all) {
  fields(row, keys, all.filter(k => !keys.includes(k)));
  for (const k of keys) if (!['processed', 'episodes', 'metadata', 'episodeIds', 'summary'].includes(k)) text(row[k]);
  if (keys.includes('summary')) assert.equal(typeof row.summary, 'string');
  for (const k of ['score', 'relevance']) if (Object.hasOwn(row, k)) assert.ok(typeof row[k] === 'number' && Number.isFinite(row[k]));
  if (Object.hasOwn(row, 'selectionRank')) assert.ok(Number.isSafeInteger(row.selectionRank) && row.selectionRank >= 0);
  for (const k of ['labels', 'sourceNodeLabels', 'targetNodeLabels']) if (Object.hasOwn(row, k)) {
    assert.ok(Array.isArray(row[k])); for (const v of row[k]) assert.equal(typeof v, 'string');
  }
  for (const k of ['sourceNodeName', 'targetNodeName', 'scope', 'source', 'role', 'roleType', 'sourceDescription', 'taskId', 'threadId'])
    if (Object.hasOwn(row, k)) assert.equal(typeof row[k], 'string');
  if (Object.hasOwn(row, 'attributes')) assert.ok(row.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes));
  instant(row.createdAt);
}
export function validateEdge(row) {
  return validateEntity(row, 'edge');
}
function validateNode(row) { return validateEntity(row, 'node'); }
function strings(row, key) { assert.ok(Array.isArray(row[key]) && row[key].length); for (const id of row[key]) text(id); }

export function verifySnapshot(raw, authority, rows) {
  const snapshot = json(raw), a = json(authority);
  fields(a, ['accountId', 'projectId', 'graphId', 'room', 'roomUuid', 'copyId', 'generationId', 'routeRevision', 'scopeRevision', 'verificationId', 'sourceState', 'members']);
  for (const k of ['accountId', 'projectId', 'graphId', 'room', 'roomUuid', 'copyId', 'generationId', 'routeRevision', 'scopeRevision', 'verificationId']) text(a[k]);
  assert.equal(a.sourceState, 'verified-current-authorized');
  fields(snapshot, ['graph', 'episodes', 'originals', 'edges', 'nodes', 'startedAt', 'finishedAt'], ['sdkEndpointLayouts', 'sdkEntityLayouts', 'sdkGraphLayout']);
  instant(snapshot.startedAt); instant(snapshot.finishedAt); assert.ok(Date.parse(snapshot.startedAt) <= Date.parse(snapshot.finishedAt));
  verifyGraphLayout(snapshot.graph, a.graphId, snapshot.sdkGraphLayout); assert.equal(snapshot.graph.projectUuid, a.projectId);
  unique(snapshot.episodes); unique(snapshot.originals); unique(snapshot.edges); unique(snapshot.nodes);
  const expected = rows.flatMap(r => r.members.map(m => ({ row: r, member: m })));
  assert.equal(a.members.length, expected.length); unique(a.members, 'episodeId');
  assert.equal(snapshot.episodes.length, expected.length); assert.equal(snapshot.originals.length, expected.length);
  if (snapshot.sdkEndpointLayouts) {
    fields(snapshot.sdkEndpointLayouts, ['list', 'directGet']);
    for (const endpoint of ['list', 'directGet']) {
      const layouts = snapshot.sdkEndpointLayouts[endpoint]; assert.ok(Array.isArray(layouts));
      assert.equal(layouts.length, expected.length); unique(layouts, 'episodeId');
      for (const layout of layouts) {
        fields(layout, ['episodeId', 'undefinedOptionalFields'], ['unknownNativeFields']); text(layout.episodeId); verifyUnknownNativeFields(layout, EPISODE_KEYS);
        assert.ok(Array.isArray(layout.undefinedOptionalFields));
        assert.deepEqual(layout.undefinedOptionalFields, [...new Set(layout.undefinedOptionalFields)].sort());
        for (const key of layout.undefinedOptionalFields) {
          assert.ok(['role', 'roleType', 'source', 'sourceDescription', 'taskId', 'threadId', 'score', 'relevance', 'selectionRank'].includes(key));
          const row = (endpoint === 'list' ? snapshot.episodes : snapshot.originals).find(e => e.uuid === layout.episodeId);
          assert.ok(row && !Object.hasOwn(row, key), 'Normalized undefined must not conceal a supplied field');
        }
        assert.ok(a.members.some(m => m.episodeId === layout.episodeId));
      }
    }
  }
  const episodeMap = new Map(), sourceMap = new Map(); const selectedOps = new Set(), episodeProjections = [];
  for (const binding of a.members) {
    fields(binding, ['episodeId', 'opId', 'sourceId', 'version', 'part']);
    for (const v of Object.values(binding)) text(v);
    const selected = expected.filter(e => e.member.opId === binding.opId);
    assert.equal(selected.length, 1); assert.ok(!selectedOps.has(binding.opId)); selectedOps.add(binding.opId);
    const { row, member } = selected[0], request = member.payload.request, meta = request.metadata;
    assert.equal(row.logicalRoom, a.room); assert.equal(row.room.uuid, a.roomUuid);
    assert.equal(binding.sourceId, row.sourceId); assert.equal(binding.version, row.sourceVersion);
    assert.equal(binding.part, member.identity.part); assert.equal(meta.copy_id, a.copyId);
    fields(meta, ['schema', 'op_id', 'source_id', 'version', 'room_id', 'copy_id', 'part', 'source_at', 'origin', 'carry_hash']);
    assert.equal(meta.schema, 4); assert.ok(Array.isArray(meta.origin) && meta.origin.length === 2 && meta.origin[1] === 'message');
    assert.match(meta.carry_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(meta.source_id, binding.sourceId); assert.equal(meta.version, binding.version);
    assert.equal(meta.room_id, a.roomUuid); assert.equal(meta.op_id, binding.opId); assert.equal(meta.part, binding.part);
    instant(meta.source_at);
    const listing = snapshot.episodes.find(e => e.uuid === binding.episodeId), original = snapshot.originals.find(e => e.uuid === binding.episodeId);
    assert.ok(listing && original);
    const projection = verifyEpisodePair(listing, original, request, binding.episodeId);
    for (const endpoint of ['list', 'directGet']) {
      const undefinedOptionalFields = snapshot.sdkEndpointLayouts?.[endpoint].find(l => l.episodeId === binding.episodeId).undefinedOptionalFields ?? [];
      const row = endpoint === 'list' ? listing : original;
      projection[endpoint].undefinedOptionalFields = undefinedOptionalFields;
      projection[endpoint].sha256 = sha256(canonical({ row, undefinedOptionalFields }));
    }
    episodeProjections.push(projection);
    episodeMap.set(binding.episodeId, { sourceId: row.sourceId, version: row.sourceVersion, sourceAt: meta.source_at });
    sourceMap.set(row.sourceId, { sourceId: row.sourceId, room: row.logicalRoom, at: meta.source_at,
      status: 'available', bodySha256: row.sourceBodySha256, version: row.sourceVersion,
      versionState: 'verified', verificationId: a.verificationId });
  }
  for (const row of rows) {
    const parts = row.members.map(m => m.identity.part), n = parts.length;
    assert.deepEqual(parts, Array.from({ length: n }, (_, i) => `${i + 1}/${n}`), 'Incomplete/mixed canonical parts');
  }
  const edgeMap = new Map(), nodeMap = new Map(), entityEndpointObservations = [];
  if (snapshot.sdkEntityLayouts) {
    fields(snapshot.sdkEntityLayouts, ['edges', 'nodes']);
    for (const key of ['edges', 'nodes']) {
      assert.ok(Array.isArray(snapshot.sdkEntityLayouts[key])); unique(snapshot.sdkEntityLayouts[key]);
      assert.equal(snapshot.sdkEntityLayouts[key].length, snapshot[key].length);
      assert.ok(snapshot.sdkEntityLayouts[key].every(layout => snapshot[key].some(row => row.uuid === layout.uuid)));
    }
  }
  const scopeEntity = (row, kind, key) => {
    const layout = snapshot.sdkEntityLayouts?.[key].find(l => l.uuid === row.uuid);
    verifyEntityScope(row, kind, a.graphId, episodeMap, layout, 'list');
    entityEndpointObservations.push({ kind, uuid: row.uuid, layout: layout ?? null,
      normalizedRowSha256: sha256(canonical(row)), associationQualification: kind === 'node'
        ? 'Supplied current native episode associations; completeness flag is not per-summary-claim lineage or cohort proof' : 'All referenced episodes joined to exact current member bindings' });
  };
  for (const edge of snapshot.edges) {
    scopeEntity(edge, 'edge', 'edges');
    edgeMap.set(edge.uuid, edge);
  }
  for (const node of snapshot.nodes) { scopeEntity(node, 'node', 'nodes'); nodeMap.set(node.uuid, node); }
  for (const edge of snapshot.edges) assert.ok(nodeMap.has(edge.sourceNodeUuid) && nodeMap.has(edge.targetNodeUuid), 'Unobserved endpoint');
  const fingerprint = sha256(canonical({ graph: snapshot.graph, episodes: episodeProjections.map(p => p.identity).sort((a, b) => a.uuid.localeCompare(b.uuid)),
    edges: [...snapshot.edges].map(native).sort((a, b) => a.uuid.localeCompare(b.uuid)), nodes: [...snapshot.nodes].map(native).sort((a, b) => a.uuid.localeCompare(b.uuid)), authority: a }));
  return { snapshot, authority: a, episodeMap, sourceMap, edgeMap, nodeMap, fingerprint,
    episodeEndpointObservations: episodeProjections.map(({ identity, ...observation }) => observation), entityEndpointObservations };
}

export function formatContext(raw, verified, mode, { maxNodes, snapshotAt }, cap = 4096) {
  const response = json(raw);
  verifySearchEnvelope(response, verified.authority.graphId);
  if (Object.hasOwn(response, 'context')) assert.equal(typeof response.context, 'string');
  for (const k of ['edges', 'episodes', 'nodes', 'observations', 'threadSummaries']) if (Object.hasOwn(response, k)) assert.ok(Array.isArray(response[k]), 'Malformed result collection');
  if (response.threadSummaries?.length) throw new Held('thread_summary_missing_native_episode_lineage');
  if (mode !== 'auto-raw' && !Object.hasOwn(response, 'edges')) throw new Held('edge_results_not_supplied');
  if (mode === 'auto-raw' && !['edges', 'nodes', 'episodes'].some(key => Object.hasOwn(response, key))) {
    if (response.context) throw new Held('opaque_auto_context_without_verified_raw');
    throw new Held('auto_raw_collections_not_supplied');
  }
  if (response.sdkEntityLayouts) {
    fields(response.sdkEntityLayouts, ['edges', 'nodes']);
    for (const key of ['edges', 'nodes']) {
      const rows = response[key] ?? [], layouts = response.sdkEntityLayouts[key]; assert.ok(Array.isArray(layouts)); unique(layouts);
      assert.equal(rows.length, layouts.length); assert.ok(layouts.every(layout => rows.some(row => row.uuid === layout.uuid)));
    }
  }
  const scopeEntity = (row, kind, key) => verifyEntityScope(row, kind, verified.authority.graphId, verified.episodeMap,
    response.sdkEntityLayouts?.[key].find(layout => layout.uuid === row.uuid), 'search');
  const items = [], omissions = [], used = new Set();
  const sourcesFor = ids => {
    strings({ ids }, 'ids');
    return [...new Set(ids.map(id => { const s = verified.episodeMap.get(id); if (!s) throw new Held('missing_or_unauthorized_episode_lineage'); return s.sourceId; }))].sort();
  };
  const active = e => (!e.invalidAt || Date.parse(e.invalidAt) > Date.parse(snapshotAt)) &&
    (!e.expiredAt || Date.parse(e.expiredAt) > Date.parse(snapshotAt)) && (!e.validAt || Date.parse(e.validAt) <= Date.parse(snapshotAt));
  const edges = unique(response.edges ?? []);
  for (const edge of edges) {
    scopeEntity(edge, 'edge', 'edges'); const saved = verified.edgeMap.get(edge.uuid);
    if (!saved || !sameEntity(edge, saved, 'edge')) throw new Held('edge_changed_or_unobserved');
    if (!active(edge)) { omissions.push({ kind: 'edge', id: edge.uuid, reason: 'not_current_at_snapshot' }); continue; }
    items.push({ kind: 'edge-fact', nativeId: edge.uuid, sources: sourcesFor(edge.episodes), text: edge.fact, derivative: false,
      details: { relation: edge.name, sourceNodeUuid: edge.sourceNodeUuid, targetNodeUuid: edge.targetNodeUuid,
        validAt: edge.validAt ?? null, invalidAt: edge.invalidAt ?? null, expiredAt: edge.expiredAt ?? null, createdAt: edge.createdAt } });
  }
  const addNode = (node, fromInventory = false) => {
    if (fromInventory) verifyEntityScope(node, 'node', verified.authority.graphId, verified.episodeMap,
      verified.snapshot.sdkEntityLayouts?.nodes.find(layout => layout.uuid === node.uuid), 'list');
    else scopeEntity(node, 'node', 'nodes');
    const saved = verified.nodeMap.get(node.uuid);
    if (!saved || !sameEntity(node, saved, 'node')) throw new Held('node_changed_or_unobserved');
    requireSummaryAssociations(saved); requireSummaryAssociations(node);
    const incident = [...verified.edgeMap.values()].filter(e => active(e) && (e.sourceNodeUuid === node.uuid || e.targetNodeUuid === node.uuid));
    if (!incident.length) throw new Held('node_summary_missing_incident_lineage');
    const ids = sourcesFor([...incident.flatMap(e => e.episodes), ...(saved.episodes ?? [])]);
    const details = { name: node.name, incidentEdgeIds: incident.map(e => e.uuid).sort(), createdAt: node.createdAt,
      nativeNodeEpisodeIds: saved.episodes ?? null, nativeNodeEpisodesTruncated: saved.episodes_truncated ?? null };
    if (!node.summary.trim()) items.push({ kind: 'node-without-summary', nativeId: node.uuid, sources: ids, text: node.name, derivative: false,
      details: { ...details, ...(node.labels?.length ? { labels: node.labels } : {}),
        ...(node.attributes && Object.keys(node.attributes).length ? { attributes: node.attributes } : {}),
        evidenceQualification: 'Native node name, labels and attributes only; the service returned no summary for this node' } });
    else items.push({ kind: 'node-summary-derivative-association', nativeId: node.uuid, sources: ids, text: node.summary, derivative: true,
      details: { ...details, evidenceQualification: 'Observed endpoint/incident-source association; not native lineage for every summary assertion' } });
  };
  if (mode === 'edges-plus-selected-node-summaries') {
    const nodes = [];
    for (const edge of edges) if (active(edge)) for (const id of [edge.sourceNodeUuid, edge.targetNodeUuid]) if (!nodes.includes(id)) nodes.push(id);
    for (const id of nodes.slice(0, maxNodes)) { const node = verified.nodeMap.get(id); if (!node) throw new Held('missing_selected_endpoint'); addNode(node, true); }
    for (const id of nodes.slice(maxNodes)) omissions.push({ kind: 'node', id, reason: 'predeclared_node_cap' });
  } else if (mode === 'auto-raw') {
    for (const node of unique(response.nodes ?? [])) addNode(node);
    for (const ep of unique(response.episodes ?? [])) {
      validateEpisodeProjection(ep, 'auto'); const saved = verified.snapshot.originals.find(e => e.uuid === ep.uuid);
      if (!saved || !same(native(ep), native(saved))) throw new Held('episode_changed_or_unobserved');
      items.push({ kind: 'original-episode', nativeId: ep.uuid, sources: sourcesFor([ep.uuid]), text: ep.content, derivative: false,
        details: { createdAt: ep.createdAt, sourceAt: ep.metadata.source_at } });
    }
    for (const obs of unique(response.observations ?? [])) {
      required(obs, ['uuid', 'createdAt', 'name', 'summary', 'episodeIds'], observationKeys);
      throw new Held('observation_missing_bounded_identity_inventory');
    }
    if (!items.length && response.context) throw new Held('opaque_auto_context_without_verified_raw');
    items.sort((a, b) => {
      const rank = item => [...edges, ...(response.nodes ?? []), ...(response.episodes ?? [])].find(r => r.uuid === item.nativeId)?.selectionRank ?? Infinity;
      return rank(a) - rank(b) || a.nativeId.localeCompare(b.nativeId);
    });
  } else if (mode !== 'edges-cross-encoder') throw new Held('unknown_mode');
  if (mode !== 'auto-raw' && ((response.nodes?.length ?? 0) || (response.episodes?.length ?? 0) || (response.observations?.length ?? 0))) throw new Held('unexpected_non_edge_scope_result');
  let context = '';
  for (const item of items) {
    const provenance = item.sources.map(id => { const s = verified.sourceMap.get(id); return { id, room: s.room, version: s.version, sourceAt: s.at }; });
    const block = JSON.stringify({ kind: item.kind, nativeId: item.nativeId, derivative: item.derivative, provenance, details: item.details }) + '\n' + item.text + '\n';
    if (Buffer.byteLength(context + block) > cap) { omissions.push({ kind: item.kind, id: item.nativeId, reason: 'common_utf8_context_cap', bytes: Buffer.byteLength(block) }); continue; }
    context += block; for (const id of item.sources) used.add(id);
  }
  if (items.length && !context) throw new Held('no_verified_item_fits_shared_context');
  return { context, utf8Bytes: Buffer.byteLength(context), sourceIds: [...used].sort(),
    sources: [...used].sort().map(id => verified.sourceMap.get(id)), omissions, opaqueProviderContextUsed: false,
    derivativeQualification: 'Incident episode association is not proof of every node-summary sentence' };
}
