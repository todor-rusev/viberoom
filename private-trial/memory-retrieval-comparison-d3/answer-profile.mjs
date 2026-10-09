// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import assert from '../trial-journal/policy-assert.mjs';
import { json, fields, text, integer, Held } from './contracts.mjs';

export const PROFILE_SCHEMA = 'viberoom-chat-completions-request-profile-v1';
const efforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

export function captureAnswerControls(input) {
  const value = json(input);
  fields(value, ['model', 'cacheState', 'requestProfile']); text(value.model);
  assert.ok(['cold', 'warm', 'unknown'].includes(value.cacheState));
  const p = value.requestProfile;
  fields(p, ['schema', 'reasoningEffort', 'temperature', 'maxCompletionTokens', 'choices', 'serviceTier', 'store', 'maxInputTextUtf8Bytes', 'maxRequestUtf8Bytes']);
  assert.equal(p.schema, PROFILE_SCHEMA); assert.ok(efforts.includes(p.reasoningEffort));
  assert.ok(p.temperature === null || typeof p.temperature === 'number' && Number.isFinite(p.temperature) && p.temperature >= 0 && p.temperature <= 2);
  integer(p.maxCompletionTokens, 1, 128000); assert.equal(p.choices, 1);
  assert.equal(p.serviceTier, 'default'); assert.equal(p.store, false);
  integer(p.maxInputTextUtf8Bytes, 1, 1048576); integer(p.maxRequestUtf8Bytes, 1, 2097152);
  assert.ok(p.maxRequestUtf8Bytes >= p.maxInputTextUtf8Bytes);
  Object.freeze(p); return Object.freeze(value);
}

export function buildAnswerRequest(controls, { prompt, question, context }) {
  controls = captureAnswerControls(controls);
  text(prompt); text(question); assert.equal(typeof context, 'string');
  assert.equal(Buffer.from(context).toString('utf8'), context);
  const p = controls.requestProfile;
  const messages = [{ role: 'system', content: prompt }, { role: 'user', content: `Question:\n${question}\n\nContext:\n${context}` }];
  const inputTextUtf8Bytes = messages.reduce((n, m) => n + Buffer.byteLength(m.content), 0);
  const body = { model: controls.model, max_completion_tokens: p.maxCompletionTokens, reasoning_effort: p.reasoningEffort,
    n: p.choices, service_tier: p.serviceTier, store: p.store,
    ...(p.temperature === null ? {} : { temperature: p.temperature }), messages };
  const requestUtf8Bytes = Buffer.byteLength(JSON.stringify(body));
  if (inputTextUtf8Bytes > p.maxInputTextUtf8Bytes || requestUtf8Bytes > p.maxRequestUtf8Bytes) throw new Held('answer_input_or_request_byte_bound');
  return { body, inputTextUtf8Bytes, requestUtf8Bytes };
}

export function usageMetrics(usage, profile) {
  if (usage === null) return { cachedInputTokens: null, cacheWriteInputTokens: null, reasoningOutputTokens: null };
  fields(usage, ['prompt_tokens', 'completion_tokens'], ['total_tokens', 'prompt_tokens_details', 'completion_tokens_details']);
  for (const k of ['prompt_tokens', 'completion_tokens']) integer(usage[k], 0, Number.MAX_SAFE_INTEGER);
  if (Object.hasOwn(usage, 'total_tokens')) integer(usage.total_tokens, 0, Number.MAX_SAFE_INTEGER);
  assert.ok(usage.completion_tokens <= profile.maxCompletionTokens, 'Completion usage exceeds approved cap');
  if (Object.hasOwn(usage, 'total_tokens')) assert.equal(usage.total_tokens, usage.prompt_tokens + usage.completion_tokens);
  const count = (details, key, max) => {
    if (details == null || !Object.hasOwn(details, key)) return null;
    integer(details[key], 0, max); return details[key];
  };
  if (usage.prompt_tokens_details != null) fields(usage.prompt_tokens_details, [], ['audio_tokens', 'cache_write_tokens', 'cached_tokens', 'image_tokens', 'text_tokens']);
  if (usage.completion_tokens_details != null) fields(usage.completion_tokens_details, [], ['accepted_prediction_tokens', 'audio_tokens', 'reasoning_tokens', 'rejected_prediction_tokens', 'text_tokens']);
  for (const details of [usage.prompt_tokens_details, usage.completion_tokens_details]) if (details != null)
    for (const value of Object.values(details)) integer(value, 0, Number.MAX_SAFE_INTEGER);
  return { cachedInputTokens: count(usage.prompt_tokens_details, 'cached_tokens', usage.prompt_tokens),
    cacheWriteInputTokens: count(usage.prompt_tokens_details, 'cache_write_tokens', usage.prompt_tokens),
    reasoningOutputTokens: count(usage.completion_tokens_details, 'reasoning_tokens', usage.completion_tokens) };
}
