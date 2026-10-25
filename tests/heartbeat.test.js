import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { decideHeartbeat, shouldEmailError, heartbeatEmail, errorEmail } from '../src/core/heartbeat.js';
import { makeEnv, goodProps, load } from './helpers/fakeGas.js';

const MIN = 60000;
const T = 1_800_000_000_000;

test('fresh success: nothing to do; stale: one alert, then silence for 6 hours, then a reminder', () => {
  let d = decideHeartbeat({ nowMs: T, lastSuccessMs: T - 10 * MIN, state: {} });
  assert.equal(d.action, 'none');
  d = decideHeartbeat({ nowMs: T, lastSuccessMs: T - 46 * MIN, state: d.state });
  assert.equal(d.action, 'alert');
  d = decideHeartbeat({ nowMs: T + 60 * MIN, lastSuccessMs: T - 46 * MIN, state: d.state });
  assert.equal(d.action, 'none');
  d = decideHeartbeat({ nowMs: T + 6 * 60 * MIN, lastSuccessMs: T - 46 * MIN, state: d.state });
  assert.equal(d.action, 'alert');
});

test('recovery sends exactly one recovery email', () => {
  let d = decideHeartbeat({ nowMs: T, lastSuccessMs: T - 2 * 60 * MIN, state: {} });
  assert.equal(d.action, 'alert');
  d = decideHeartbeat({ nowMs: T + 60 * MIN, lastSuccessMs: T + 55 * MIN, state: d.state });
  assert.equal(d.action, 'recover');
  d = decideHeartbeat({ nowMs: T + 120 * MIN, lastSuccessMs: T + 115 * MIN, state: d.state });
  assert.equal(d.action, 'none');
});

test('before the first ever success, the clock starts at the first check', () => {
  let d = decideHeartbeat({ nowMs: T, lastSuccessMs: null, state: {} });
  assert.equal(d.action, 'none');
  d = decideHeartbeat({ nowMs: T + 50 * MIN, lastSuccessMs: null, state: d.state });
  assert.equal(d.action, 'alert');
});

test('error emails are limited to one an hour; texts use no dashes', () => {
  assert.equal(shouldEmailError(undefined, T), true);
  assert.equal(shouldEmailError(T - 59 * MIN, T), false);
  assert.equal(shouldEmailError(T - 60 * MIN, T), true);
  for (const m of [heartbeatEmail('alert', { staleForMs: 50 * MIN, lastSuccessIso: 'x' }), heartbeatEmail('recover', {}), errorEmail('runIngest', new Error('boom'))]) {
    assert.doesNotMatch(m.subject + m.body, /[–—]/);
  }
  assert.match(errorEmail('runIngest', new Error('boom')).body, /Error: boom/);
});

const OPS = 'ops@example.com';
async function ready(extra = {}) {
  const env = makeEnv({ ...goodProps(), OPS_RECIPIENTS: OPS, HEARTBEAT_PING_URL: 'https://hc-ping.com/test-uuid', ...extra });
  const sb = await load(env);
  vm.runInContext('setup()', sb);
  return { env, sb, run: (c) => vm.runInContext(c, sb) };
}
const status = (env) => { const r = env.sheets.x['Run Log'].rows; return r.slice(1).map((x) => [x[1], x[12]]); };

test('a successful runIngest pings the external service once, with a plain GET and no data', async () => {
  const { env, run } = await ready();
  env.state.fetchQueue.push({ status: 200, body: 'OK' });
  assert.equal(run('runIngest()').status, 'OK');
  assert.equal(env.state.fetches.length, 1);
  assert.equal(env.state.fetches[0].url, 'https://hc-ping.com/test-uuid');
  assert.equal(env.state.fetches[0].options.payload, undefined);
  assert.ok(env.store.LAST_SUCCESS_AT);
});

test('a ping that fails does not fail the run', async () => {
  const { env, run } = await ready();
  env.state.fetchQueue.push(new Error('network down'));
  assert.equal(run('runIngest()').status, 'OK');
  assert.deepEqual(env.mail, []);
});

test('with no ping URL set nothing is fetched', async () => {
  const { env, run } = await ready({ HEARTBEAT_PING_URL: 'PLACEHOLDER' });
  run('runIngest()');
  assert.equal(env.state.fetches.length, 0);
});

test('a forced exception is logged FAILED each time but emailed to OPS_RECIPIENTS once an hour, and pings /fail', async () => {
  const { env, run } = await ready();
  env.sheets.x.Coverage.rows[0][0] = 'Broken'; // header gone, so the pre-flight check throws
  env.state.fetchQueue.push({ status: 200, body: 'OK' }, { status: 200, body: 'OK' });
  assert.throws(() => run('runIngest()'), /not set up/);
  assert.throws(() => run('runIngest()'), /not set up/);
  assert.deepEqual(status(env), [['runIngest', 'FAILED'], ['runIngest', 'FAILED']]);
  assert.equal(env.mail.length, 1);
  assert.equal(env.mail[0].to, OPS);
  assert.match(env.mail[0].subject, /error in runIngest/);
  assert.match(env.mail[0].body, /Stack:/);
  assert.deepEqual(env.state.fetches.map((f) => f.url), ['https://hc-ping.com/test-uuid/fail', 'https://hc-ping.com/test-uuid/fail']);
  assert.equal(env.store.LAST_SUCCESS_AT, undefined);
});

test('a different function failing still gets its own email within the same hour', async () => {
  const { env, run } = await ready();
  env.sheets.x.Coverage.rows[0][0] = 'Broken';
  env.state.fetchQueue.push({ status: 200, body: 'OK' });
  assert.throws(() => run('runIngest()'));
  assert.throws(() => run('runReviewSync()'));
  assert.equal(env.mail.length, 2);
});

test('heartbeatCheck: stale success emails once, repeats nothing within 6 hours, then a single recovery email', async () => {
  const { env, run } = await ready();
  env.store.LAST_SUCCESS_AT = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  assert.equal(run('heartbeatCheck()').action, 'alert');
  assert.equal(env.mail.length, 1);
  assert.equal(env.mail[0].to, OPS);
  assert.match(env.mail[0].subject, /has stopped/);
  assert.equal(run('heartbeatCheck()').action, 'none');
  assert.equal(env.mail.length, 1);
  env.store.LAST_SUCCESS_AT = new Date().toISOString();
  assert.equal(run('heartbeatCheck()').action, 'recover');
  assert.match(env.mail[1].subject, /recovered/);
  assert.equal(run('heartbeatCheck()').action, 'none');
  assert.equal(env.mail.length, 2);
  assert.deepEqual(status(env), [['heartbeatCheck', 'FAILED'], ['heartbeatCheck', 'OK']]);
});

test('heartbeatCheck with OPS_RECIPIENTS still a placeholder sends nothing and retries next hour', async () => {
  const { env, run } = await ready({ OPS_RECIPIENTS: 'PLACEHOLDER' });
  env.store.LAST_SUCCESS_AT = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  run('heartbeatCheck()');
  assert.deepEqual(env.mail, []);
  assert.equal(env.store.HEARTBEAT_STATE, undefined);
});
