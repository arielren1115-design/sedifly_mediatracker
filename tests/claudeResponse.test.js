import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeResponse, RETRY_DELAYS_MS } from '../src/core/claudeResponse.js';

const ok = (content, extra = {}) => JSON.stringify({ stop_reason: 'tool_use', content, ...extra });
const toolBlock = (input, name = 'record_classification') => ({ type: 'tool_use', id: 't1', name, input });

test('a tool call is returned as the classification input', () => {
  const r = parseClaudeResponse(200, ok([{ type: 'text', text: 'ok' }, toolBlock({ confidence: 0.9 })]));
  assert.deepEqual(r, { kind: 'tool', input: { confidence: 0.9 } });
});

test('a reply without the tool call, or with the wrong tool, is kept apart from errors', () => {
  assert.equal(parseClaudeResponse(200, ok([{ type: 'text', text: 'Sure!' }], { stop_reason: 'end_turn' })).kind, 'no_tool');
  assert.equal(parseClaudeResponse(200, ok([toolBlock({}, 'something_else')])).kind, 'no_tool');
});

test('a refusal and a cut off reply are reported as such', () => {
  assert.equal(parseClaudeResponse(200, ok([], { stop_reason: 'refusal', stop_details: { category: 'cyber' } })).kind, 'refusal');
  assert.equal(parseClaudeResponse(200, ok([{ type: 'text', text: 'x' }], { stop_reason: 'max_tokens' })).kind, 'no_tool');
});

test('rate limits, server errors and overload are retryable', () => {
  for (const status of [408, 429, 500, 502, 503, 529]) assert.equal(parseClaudeResponse(status, '{"error":{"message":"busy"}}').kind, 'retry', String(status));
});

test('client errors are not retried, and the message is kept', () => {
  const r = parseClaudeResponse(400, JSON.stringify({ error: { type: 'invalid_request_error', message: 'bad field' } }));
  assert.deepEqual(r, { kind: 'fatal', status: 400, message: 'bad field' });
  assert.equal(parseClaudeResponse(401, '{"error":{"message":"invalid x-api-key"}}').kind, 'fatal');
  assert.equal(parseClaudeResponse(404, 'not json at all').message, 'not json at all');
});

test('a 200 with a body that is not JSON is a retryable fault, not a crash', () => {
  assert.equal(parseClaudeResponse(200, '<html>gateway</html>').kind, 'retry');
});

test('backoff is 2 s then 8 s, as in the spec', () => {
  assert.deepEqual(RETRY_DELAYS_MS, [2000, 8000]);
});
