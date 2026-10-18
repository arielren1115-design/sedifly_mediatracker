// Builds the bundle and runs the real setup() against in-memory fakes of the Google services.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeEnv, goodProps, load } from './helpers/fakeGas.js';

test('bundle exposes every entry point as a top level function', async () => {
  const sb = await load(makeEnv(goodProps()));
  for (const fn of ['setup', 'runIngest', 'runReviewSync', 'heartbeatCheck', 'dailyDigest', 'runBackfill', 'compareBlindRun', 'mergeBlindRun']) {
    assert.equal(typeof vm.runInContext(fn, sb), 'function', fn);
  }
});

test('setup fails loudly listing every missing property', async () => {
  const props = goodProps(); delete props.ANTHROPIC_API_KEY; delete props.OPS_RECIPIENTS;
  const sb = await load(makeEnv(props));
  assert.throws(() => vm.runInContext('setup()', sb), /Missing Script Properties: ANTHROPIC_API_KEY, OPS_RECIPIENTS/);
});

test('setup creates everything, and a second run changes nothing', async () => {
  const env = makeEnv(goodProps());
  const sb = await load(env);
  const first = vm.runInContext('setup()', sb);
  assert.equal(first.labelsCreated.length, 4);
  assert.equal(env.triggers.length, 4);
  assert.equal(env.store.NEXT_COVERAGE_ID, '1');
  for (const id of ['x']) {
    const tabs = Object.keys(env.sheets[id]);
    assert.deepEqual(tabs.sort(), ['Coverage', 'Review Queue', 'Run Log']); // blank Sheet1 removed
    assert.equal(env.sheets[id].Coverage.rows[0][0], 'Coverage ID');
  }
  const cov = env.sheets.x.Coverage;
  const col = cov.rows[0].indexOf('Detected at') + 1;
  assert.equal(cov.formats[col], 'yyyy-mm-dd hh:mm:ss');
  assert.equal(cov.formats[cov.rows[0].indexOf('Published at') + 1], 'yyyy-mm-dd');
  assert.equal(env.state.tz.x, 'Asia/Singapore');
  const snapshot = JSON.stringify([env.sheets, env.labels, env.triggers.map((t) => t.getHandlerFunction()), env.store]);
  const second = vm.runInContext('setup()', sb);
  assert.equal(second.labelsCreated.length, 0);
  assert.equal(env.triggers.length, 4);
  for (const t of Object.values(second.spreadsheets.BOT_SPREADSHEET_ID)) {
    assert.equal(t.created, false); assert.equal(t.addedHeaders.length, 0);
  }
  assert.equal(JSON.stringify([env.sheets, env.labels, env.triggers.map((t) => t.getHandlerFunction()), env.store]), snapshot);
});
