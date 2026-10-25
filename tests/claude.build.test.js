// Runs the real built callClaude() against a fake UrlFetchApp.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeEnv, goodProps, load } from './helpers/fakeGas.js';

const okBody = JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_classification', input: { confidence: 0.8 } }] });

async function ready(props = {}) {
  const env = makeEnv({ ...goodProps(), ANTHROPIC_API_KEY: 'sk-test', ...props });
  const sb = await load(env);
  const call = (req = { model: 'm' }) => vm.runInContext(`App.callClaude(${JSON.stringify(req)})`, sb);
  return { env, call };
}

test('sends the key and version headers and a JSON body', async () => {
  const { env, call } = await ready();
  env.state.fetchQueue.push({ status: 200, body: okBody });
  const r = call({ model: 'claude-haiku-4-5', max_tokens: 800 });
  assert.equal(r.kind, 'tool');
  assert.equal(r.input.confidence, 0.8);
  const f = env.state.fetches[0];
  assert.equal(f.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(f.options.headers['x-api-key'], 'sk-test');
  assert.equal(f.options.headers['anthropic-version'], '2023-06-01');
  assert.equal(f.options.contentType, 'application/json');
  assert.equal(f.options.muteHttpExceptions, true);
  assert.equal(JSON.parse(f.options.payload).model, 'claude-haiku-4-5');
  assert.equal(env.state.sleeps.length, 0);
});

test('retries overload twice with 2 s then 8 s waits, then succeeds', async () => {
  const { env, call } = await ready();
  env.state.fetchQueue.push({ status: 529, body: '{}' }, { status: 429, body: '{}' }, { status: 200, body: okBody });
  assert.equal(call().kind, 'tool');
  assert.deepEqual(env.state.sleeps, [2000, 8000]);
  assert.equal(env.state.fetches.length, 3);
});

test('three failures in a row come back as retry, so the message waits for the next run', async () => {
  const { env, call } = await ready();
  env.state.fetchQueue.push({ status: 503, body: '{}' }, { status: 503, body: '{}' }, { status: 503, body: '{}' });
  assert.equal(call().kind, 'retry');
  assert.equal(env.state.fetches.length, 3);
});

test('a network timeout counts as a retryable failure', async () => {
  const { env, call } = await ready();
  env.state.fetchQueue.push(new Error('Timeout'), { status: 200, body: okBody });
  assert.equal(call().kind, 'tool');
  assert.deepEqual(env.state.sleeps, [2000]);
});

test('a client error is not retried', async () => {
  const { env, call } = await ready();
  env.state.fetchQueue.push({ status: 400, body: JSON.stringify({ error: { message: 'bad field' } }) });
  const r = call();
  assert.equal(r.kind, 'fatal');
  assert.equal(r.message, 'bad field');
  assert.equal(env.state.fetches.length, 1);
  assert.equal(env.state.sleeps.length, 0);
});

test('a placeholder key fails loudly before any request is made', async () => {
  const { env, call } = await ready({ ANTHROPIC_API_KEY: 'PLACEHOLDER' });
  assert.throws(() => call(), /ANTHROPIC_API_KEY/);
  assert.equal(env.state.fetches.length, 0);
});
