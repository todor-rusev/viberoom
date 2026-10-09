// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import { Held } from '../trial-journal/policy-assert.mjs';
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const loopbackHost = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export const MODES = ['edges-cross-encoder', 'edges-plus-selected-node-summaries', 'auto-raw'];
export const PROMPT = 'Answer the question using only the supplied context. Distinguish decisions from proposals, preserve dates, direction and negation, and cite the stable source IDs for each factual assertion. If the context does not support an answer, say that the information is unavailable. Do not infer private or unverified information.';
export const PROMPT_SHA256 = sha256(PROMPT);

export function json(value, depth = 0) {
  assert.ok(depth < 64 && !types.isProxy(value), 'Non-JSON/proxy/deep data');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { assert.ok(Number.isFinite(value)); return value; }
  assert.ok(value && typeof value === 'object');
  const array = Array.isArray(value);
  assert.ok(array || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const keys = Reflect.ownKeys(value);
  if (array) assert.deepEqual(keys, [...Array.from({ length: value.length }, (_, i) => String(i)), 'length']);
  const out = array ? [] : {};
  for (const key of keys) {
    if (array && key === 'length') continue;
    assert.equal(typeof key, 'string');
    const d = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(d && d.enumerable && Object.hasOwn(d, 'value'), 'Accessor/hidden data');
    Object.defineProperty(out, key, { value: json(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}
export function fields(value, required, optional = []) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  for (const k of required) assert.ok(Object.hasOwn(value, k), `Missing ${k}`);
  assert.ok(Object.keys(value).every(k => [...required, ...optional].includes(k)), 'Unknown field');
}
export function text(value) { assert.ok(typeof value === 'string' && value.length && Buffer.from(value).toString('utf8') === value); return value; }
export function integer(value, min, max) { assert.ok(Number.isSafeInteger(value) && value >= min && value <= max); return value; }
export function digest(value) { assert.match(value, /^[a-f0-9]{64}$/); return value; }
export function instant(value) { text(value); assert.ok(Number.isFinite(Date.parse(value))); return value; }
export function unique(rows, key = 'uuid') {
  assert.ok(Array.isArray(rows)); const ids = new Set();
  for (const row of rows) { text(row[key]); assert.ok(!ids.has(row[key]), 'Duplicate identity'); ids.add(row[key]); }
  return rows;
}
export const canonical = value => JSON.stringify(sort(json(value)));
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])])) : value; }

export { Held } from '../trial-journal/policy-assert.mjs';
export class RunBudget {
  #settled = new Set();
  constructor(limits, clock = () => performance.now(), recordAttempt = null, recordOutcome = null) {
    this.limits = json(limits);
    fields(this.limits, ['maxReads', 'maxModelCalls', 'maxPagesPerCollection', 'pageSize', 'maxResponseBytes', 'maxAggregateBytes', 'requestMs', 'runMs', 'maxNodes', 'edgeLimit', 'autoMaxCharacters']);
    for (const [k, v] of Object.entries(this.limits)) integer(v, 1, 1000000000);
    integer(this.limits.pageSize, 1, 50); integer(this.limits.edgeLimit, 1, 50);
    integer(this.limits.autoMaxCharacters, 1, 50000); integer(this.limits.maxNodes, 1, 50);
    this.clock = clock; this.started = clock(); this.reads = 0; this.models = 0; this.bytes = 0;
    this.stopped = false; this.attempts = [];
    assert.ok(recordAttempt === null || typeof recordAttempt === 'function'); this.recordAttempt = recordAttempt;
    assert.ok(recordOutcome === null || typeof recordOutcome === 'function'); this.recordOutcome = recordOutcome;
  }
  remaining() { return Math.max(0, this.limits.runMs - (this.clock() - this.started)); }
  check() { if (this.stopped || this.remaining() <= 0) throw new Held('run_stopped_or_deadline'); }
  stop(reason) { this.stopped = true; this.stopReason = reason; }
  take(kind, request) {
    this.check(); const key = kind === 'model' ? 'models' : 'reads';
    const cap = kind === 'model' ? this.limits.maxModelCalls : this.limits.maxReads;
    if (this[key] >= cap) { this.stop('call_cap'); throw new Held('call_cap'); }
    this[key]++;
    const attempt = { number: this.attempts.length + 1, kind, request: json(request), status: 'attempted', response: null, error: null, responseBytes: null, latencyMs: null, vendorCost: null };
    this.attempts.push(attempt);
    if (this.recordAttempt !== null) {
      try { if (this.recordAttempt(json(attempt)) !== true) throw new Error('not recorded'); }
      catch { attempt.status = 'unknown'; this.stop('attempt_record_refused'); throw new Held('attempt_record_refused'); }
    }
    return attempt;
  }
  receive(attempt, raw, status, elapsed) {
    const n = Buffer.byteLength(raw); this.bytes += n;
    attempt.responseBytes = n; attempt.latencyMs = elapsed; attempt.httpStatus = status;
    attempt.response = raw;
    if (n > this.limits.maxResponseBytes || this.bytes > this.limits.maxAggregateBytes) {
      attempt.status = 'unknown'; this.stop('body_or_aggregate_cap'); throw new Held('body_or_aggregate_cap');
    }
    this.check(); attempt.status = 'received';
  }
  summary() { return { reads: this.reads, modelCalls: this.models, responseBytes: this.bytes, stopped: this.stopped, reason: this.stopReason ?? null, invoiceCost: null }; }
  settle(attempt) {
    assert.ok(this.attempts.includes(attempt));
    if (this.#settled.has(attempt.number) || this.recordOutcome === null) return;
    assert.ok(['received', 'unknown'].includes(attempt.status));
    try {
      assert.equal(this.recordOutcome(json(attempt)), true);
      this.#settled.add(attempt.number);
    } catch (error) {
      const reason = error.message === 'budget_outcome_unknown' ? 'budget_outcome_unknown' : 'outcome_record_refused';
      this.stop(reason); throw new Held(reason);
    }
  }
}

export async function awaited(budget, operation) {
  budget.check(); const controller = new AbortController();
  const ms = Math.min(budget.limits.requestMs, budget.remaining());
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); budget.stop('deadline_unknown'); reject(new Held('deadline_unknown')); }, ms); });
  try { const result = await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]); budget.check(); return result; }
  finally { clearTimeout(timer); }
}
