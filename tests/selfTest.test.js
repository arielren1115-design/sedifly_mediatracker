import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { makeEnv, goodProps, load, fakeSheet } from './helpers/fakeGas.js';
import { parseCsv } from '../src/core/csv.js';

const good = { is_relevant: true, entity: 'Joash Lee', channel: 'News', source_type: 'Media', outlet: 'Forbes', title: 'Why Venture Capital Money', published_date: '2026-10-13', category: 'Brand', priority: 'Standard', sentiment: 'Neutral', matched_rule_ids: ['MR-006'], critical_signal: false, summary: 'Founder profile.', confidence: 0.9, reasoning: 'Because.' };
const ok = (input) => ({ status: 200, body: JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_classification', input }] }) });

async function ready(extra = {}) {
  const env = makeEnv({ ...goodProps(), ANTHROPIC_API_KEY: 'sk-test', CLAUDE_MODEL: 'claude-haiku-5-5', ...extra });
  for (const [name, file] of [['Monitored Entities', 'entities.csv'], ['Monitoring Rules', 'rules.csv']]) {
    const t = fakeSheet(name);
    parseCsv(readFileSync(new URL(`../fixtures/config/${file}`, import.meta.url), 'utf8')).forEach((r) => t.rows.push(r));
    env.sheets.x = env.sheets.x || {};
    env.sheets.x[name] = t;
  }
  const sb = await load(env);
  return { env, run: () => vm.runInContext('claudeSelfTest()', sb) };
}

test('a working key and model reports success and writes nothing', async () => {
  const { env, run } = await ready();
  env.state.fetchQueue.push(ok(good));
  const r = run();
  assert.equal(r.ok, true);
  assert.match(r.detail, /^Works\. Model claude-haiku-5-5 answered: entity Joash Lee, category Brand/);
  assert.equal(env.state.fetches.length, 1);
  assert.deepEqual(env.mail, []);
});

test('each way it can fail says what to fix', async () => {
  for (const [status, expect] of [[401, /key is not accepted/], [404, /model name "claude-haiku-5-5" was not found/], [400, /request was rejected/], [403, /credit or access/]]) {
    const { env, run } = await ready();
    env.state.fetchQueue.push({ status, body: JSON.stringify({ error: { message: 'boom' } }) });
    const r = run();
    assert.equal(r.ok, false);
    assert.match(r.detail, expect);
    assert.match(r.detail, /boom/);
  }
});

test('an answer that fails the checks, or a busy API, or a placeholder key, is reported plainly', async () => {
  let { env, run } = await ready();
  env.state.fetchQueue.push(ok({ ...good, category: 'Press mention' }));
  assert.match(run().detail, /failed our checks/);
  ({ env, run } = await ready());
  env.state.fetchQueue.push({ status: 529, body: '{}' }, { status: 529, body: '{}' }, { status: 529, body: '{}' });
  assert.match(run().detail, /did not answer/);
  ({ env, run } = await ready({ ANTHROPIC_API_KEY: 'PLACEHOLDER' }));
  const r = run();
  assert.equal(r.step, 'key');
  assert.equal(env.state.fetches.length, 0);
});
