// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import invariant from 'node:assert/strict';
import { RunBudget, Held, awaited, json, text, fields, loopbackHost } from './contracts.mjs';
import { captureAnswerControls, buildAnswerRequest, usageMetrics } from './answer-profile.mjs';
import { captureSdkEpisode } from './episode-projection.mjs';
import { captureSdkEntity } from './entity-projection.mjs';
import { captureSdkGraph, captureSdkSearch } from './envelope-projection.mjs';
import { verifySdkWireBody } from './wire-projection.mjs';

function endpoint(url, purpose, approvedOrigin) {
  const u = new URL(text(url));
  assert.ok(!u.username && !u.password && !u.search && !u.hash);
  assert.ok(u.protocol === 'https:' || u.protocol === 'http:' && loopbackHost(u.hostname));
  assert.ok(purpose === 'local-fixture' ? loopbackHost(u.hostname) : purpose === 'approved-job' && u.origin === approvedOrigin);
  return u;
}
function sdkReadPath(url, method) {
  return method === 'POST' && (url.pathname === '/graph/search' || /^\/graph\/(?:episodes|edge|node)\/graph\/[^/]+$/.test(url.pathname)) ||
    method === 'GET' && (/^\/graph\/[^/]+$/.test(url.pathname) || /^\/graph\/episodes\/[^/]+$/.test(url.pathname));
}

export function createSdkReadPort({ ZepClient, baseUrl, apiKey, purpose, approvedOrigin = null, budget, current, fetchImpl = globalThis.fetch, nativeProject = null }) {
  assert.ok(budget instanceof RunBudget && typeof ZepClient === 'function' && typeof fetchImpl === 'function');
  invariant.equal(typeof current, 'function');
  const base = endpoint(baseUrl, purpose, approvedOrigin);
  const prefix = base.pathname.replace(/\/$/, ''); text(apiKey);
  let graphOperation=null;
  const fetcher = async args => {
    const url = new URL(args.url);
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix + '/') ||
      !sdkReadPath({ pathname: url.pathname.slice(prefix.length) }, args.method) || args.maxRetries !== 0) throw new Held('sdk_method_scope_or_retry');
    for (const [k, v] of Object.entries(args.queryParameters ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const request = { method: args.method, url: url.href, body: args.body == null ? null : json(args.body), maxRetries: 0 };
    const guard = () => { if (current(request) !== true) throw new Held('current_authority'); };
    guard();
    const attempt = budget.take('read', request);
    if(graphOperation!==null){
      assert.equal(request.method,'GET');assert.equal(url.href,base.href.replace(/\/$/,'')+'/graph/'+encodeURIComponent(graphOperation.graphId));
      assert.equal(graphOperation.attempt,null,'native_graph_call_repeated');graphOperation.attempt=attempt;
    }
    try {
      const r = await boundedHttp({ url: url.href, method: args.method, body: request.body,
        headers: { authorization: `Api-Key ${apiKey}` }, budget, attempt, signal: args.abortSignal, fetchImpl, guard });
      let body;
      try { body = JSON.parse(r.raw); } catch { budget.stop('unknown_non_json'); return { ok: false, error: { reason: 'non-json', statusCode: r.status, rawBody: r.raw }, rawResponse: r.rawResponse }; }
      if (r.status < 200 || r.status >= 300) { budget.stop('http_error_no_retry'); return { ok: false, error: { reason: 'status-code', statusCode: r.status, body }, rawResponse: r.rawResponse }; }
      attempt.nativeWireProjection = verifySdkWireBody(body, { method: args.method, pathname: url.pathname.slice(prefix.length) });
      budget.check();
      return { ok: true, body, rawResponse: r.rawResponse };
    } catch (error) { attempt.status = 'unknown'; attempt.error = error.name === 'Held' ? error.message : 'transport_error'; budget.stop(attempt.error); throw error; }
    finally { budget.settle(attempt); }
  };
  const client = new ZepClient({ baseUrl: base.href.replace(/\/$/, ''), apiKey, fetcher });
  const graph = client.graph;
  const search = graph.search.bind(graph), getGraph = graph.get.bind(graph);
  const ep = graph.episode, edge = graph.edge, node = graph.node;
  const listEps = ep.listByGraphId.bind(ep), getEp = ep.get.bind(ep);
  const listEdges = edge.getByGraphId.bind(edge), listNodes = node.getByGraphId.bind(node);
  const call = fn => awaited(budget, signal => fn({ maxRetries: 0, abortSignal: signal, timeoutInSeconds: Math.min(budget.limits.requestMs, budget.remaining()) / 1000 }));
  async function pages(fn, graphId, capture = json) {
    const rows = [], cursors = new Set(); let cursor;
    for (let page = 0; page < budget.limits.maxPagesPerCollection; page++) {
      const r = await call(o => fn(graphId, { limit: budget.limits.pageSize, direction: 'asc', orderBy: 'uuid', ...(cursor ? { cursor } : {}) }, o).withRawResponse());
      if (r.rawResponse.headers.get('Zep-Truncated') === 'true') throw new Held('native_truncated');
      const data = capture(r.data);
      if (!Array.isArray(data) || data.length > budget.limits.pageSize) throw new Held('native_page_shape');
      rows.push(...data);
      const next = r.rawResponse.headers.get('Zep-Next-Cursor');
      if (!next) {
        if (data.length === budget.limits.pageSize) throw new Held('native_full_page_without_continuation');
        return rows;
      }
      if (cursors.has(next) || !data.length) throw new Held('native_cursor_cycle');
      cursors.add(next); cursor = next;
    }
    throw new Held('native_page_cap');
  }
  return Object.freeze({
    kind: 'zep-sdk-3.28.0-read-only', origin: base.origin, purpose,
    async search(graphId, query, mode) {
      const request = mode === 'auto-raw'
        ? { graphId, query, scope: 'auto', returnRawResults: true, maxCharacters: budget.limits.autoMaxCharacters }
        : { graphId, query, scope: 'edges', limit: budget.limits.edgeLimit, reranker: 'cross_encoder' };
      return captureSdkSearch(await call(o => search(request, o)), graphId);
    },
    async observe(graphId,phase=null) {
      const startedAt = new Date().toISOString();
      let graphCapture;
      if(nativeProject===null){assert.equal(phase,null);graphCapture=captureSdkGraph(await call(o=>getGraph(graphId,o)),graphId);}
      else {
        try {
        assert.ok(phase===nativeProject.T0||phase===nativeProject.T1,'native_closed_phase_required');
        assert.equal(graphOperation,null,'native_parallel_graph_observation');const operation={graphId,attempt:null};graphOperation=operation;
        let native;
        try{native=await call(o=>getGraph(graphId,o));}finally{assert.equal(graphOperation,operation);graphOperation=null;}
        graphCapture=captureSdkGraph(native,graphId);const attempt=operation.attempt;
        assert.ok(attempt&&attempt.status==='received'&&typeof attempt.response==='string','native_graph_receive_not_settled');
        phase.captureGraph({graphId,attemptNumber:attempt.number,raw:attempt.response,capture:graphCapture});
        if(current()!==true)throw new Held('current_authority');budget.check();
        }catch(error){nativeProject.refuse(error);throw error;}
      }
      const sdkEndpointLayouts = { list: [], directGet: [] }, sdkEntityLayouts = { edges: [], nodes: [] };
      const captureEpisode = (input, endpoint) => {
        const captured = captureSdkEpisode(input);
        sdkEndpointLayouts[endpoint].push({ episodeId: captured.row.uuid, undefinedOptionalFields: captured.undefinedOptionalFields,
          ...(captured.unknownNativeFields ? { unknownNativeFields: captured.unknownNativeFields } : {}) });
        return captured.row;
      };
      const episodes = await pages(listEps, graphId, data => {
        assert.ok(Array.isArray(data)); return data.map(ep => captureEpisode(ep, 'list'));
      });
      const captureEntities = (data, kind, key) => {
        assert.ok(Array.isArray(data)); return data.map(input => {
          const captured = captureSdkEntity(input, kind, { graphId, endpoint: 'list' });
          sdkEntityLayouts[key].push(captured.layout); return captured.row;
        });
      };
      const edges = await pages(listEdges, graphId, data => captureEntities(data, 'edge', 'edges')),
        nodes = await pages(listNodes, graphId, data => captureEntities(data, 'node', 'nodes'));
      const originals = [];
      for (const row of episodes) originals.push(captureEpisode(await call(o => getEp(row.uuid, o)), 'directGet'));
      return { graph: graphCapture.row, sdkGraphLayout: graphCapture.layout, episodes, originals, edges, nodes,
        sdkEndpointLayouts, sdkEntityLayouts, startedAt, finishedAt: new Date().toISOString() };
    },
  });
}

export async function boundedHttp({ url, method, body, headers, budget, attempt, signal, fetchImpl, guard }) {
  const start = budget.clock();
  return awaited(budget, async timeoutSignal => {
    guard();
    const r = await fetchImpl(url, { method, headers: { 'content-type': 'application/json', ...headers },
      ...(body == null ? {} : { body: JSON.stringify(body) }), redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
    budget.check();
    guard();
    if (r.redirected) throw new Held('redirect');
    const reader = r.body?.getReader(); const chunks = []; let n = 0;
    if (reader) {
      try { while (true) { const part = await reader.read(); guard(); if (part.done) break; n += part.value.byteLength;
        if (n > budget.limits.maxResponseBytes || budget.bytes + n > budget.limits.maxAggregateBytes) {
          const room = Math.max(0, Math.min(budget.limits.maxResponseBytes, budget.limits.maxAggregateBytes - budget.bytes) - (n - part.value.byteLength));
          chunks.push(Buffer.from(part.value).subarray(0, room)); attempt.response = Buffer.concat(chunks).toString('utf8');
          attempt.responseBytes = n; attempt.status = 'unknown'; budget.bytes += n; budget.stop('body_or_aggregate_cap');
          await reader.cancel(); throw new Held('body_or_aggregate_cap');
        }
        chunks.push(Buffer.from(part.value)); budget.check();
      } } finally { reader.releaseLock(); }
    }
    const bytes = Buffer.concat(chunks), raw = bytes.toString('utf8');
    budget.receive(attempt, raw, r.status, budget.clock() - start);
    if (!Buffer.from(raw).equals(bytes)) throw new Held('invalid_utf8_response');
    return { raw, status: r.status, rawResponse: { status: r.status, statusText: r.statusText, headers: r.headers, url: r.url, redirected: r.redirected, type: r.type } };
  });
}

export function createHttpAnswerPort({ endpointUrl, answerControls, purpose, approvedOrigin = null, budget, current, apiKey = null, fetchImpl = globalThis.fetch }) {
  const url = endpoint(endpointUrl, purpose, approvedOrigin);
  const controls = captureAnswerControls(answerControls);
  assert.ok(apiKey === null || typeof apiKey === 'string');
  invariant.equal(typeof current, 'function');
  return Object.freeze({ answerControls: controls, origin: url.origin, purpose,
    async answer({ prompt, question, context, approval }, signal) {
      if (approval !== 'approved-job') throw new Held('answer_job_not_approved');
      const request = buildAnswerRequest(controls, { prompt, question, context });
      const attempt = budget.take('model', { method: 'POST', url: url.href, body: request.body,
        inputTextUtf8Bytes: request.inputTextUtf8Bytes, requestUtf8Bytes: request.requestUtf8Bytes, maxRetries: 0 });
      const guard = () => { if (current() !== true) throw new Held('current_authority'); };
      try {
        const r = await boundedHttp({ url: url.href, method: 'POST', body: request.body,
          headers: apiKey === null ? {} : { authorization: `Bearer ${apiKey}` }, budget, attempt, signal, fetchImpl, guard });
        if (r.status < 200 || r.status >= 300) throw new Held('answer_http_error');
        const data = json(JSON.parse(r.raw));
        if (!Array.isArray(data.choices) || data.choices.length !== 1 || typeof data.choices[0]?.message?.content !== 'string') throw new Held('answer_response_shape');
        const usage = data.usage ?? null;
        const metrics = usageMetrics(usage, controls.requestProfile);
        const serviceTier = data.service_tier ?? null; assert.ok(serviceTier === null || typeof serviceTier === 'string');
        return { answer: data.choices[0].message.content, usage, ...metrics, serviceTier,
          latencyMs: attempt.latencyMs, cost: null, currency: null, attempt: attempt.number };
      } catch (error) { attempt.status = 'unknown'; attempt.error = error.name === 'Held' ? error.message : 'answer_response_error'; budget.stop(attempt.error); throw error; }
      finally { budget.settle(attempt); }
    },
  });
}
