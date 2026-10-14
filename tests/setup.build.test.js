// Builds the bundle and runs the real setup() against in-memory fakes of the Google services.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild } from '../scripts/build.js';
import { REQUIRED_PROPERTIES } from '../src/core/properties.js';

function fakeSheet(name) {
  const rows = [];
  const s = {
    name, frozen: 0, validations: 0,
    getName: () => name,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    getFrozenRows: () => s.frozen,
    setFrozenRows: (n) => { s.frozen = n; },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValues: (vals) => { vals.forEach((v, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; v.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }); return { setFontWeight() {} }; },
      setDataValidation: () => {},
    }),
    rows,
  };
  return s;
}

function makeEnv(props) {
  const sheets = {}; // spreadsheet id -> {name -> sheet}
  const labels = []; const triggers = [];
  const calls = { deletedTriggers: 0 };
  const store = { ...props };
  const ssFor = (id) => {
    sheets[id] = sheets[id] || { Sheet1: fakeSheet('Sheet1') };
    const map = sheets[id];
    return {
      getSheetByName: (n) => map[n] || null,
      insertSheet: (n) => (map[n] = fakeSheet(n)),
      getSheets: () => Object.values(map),
      deleteSheet: (sh) => { delete map[sh.name]; },
    };
  };
  const sandbox = {
    console: { log() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => ({ ...store }),
      getProperty: (k) => store[k] ?? null,
      setProperty: (k, v) => { store[k] = v; },
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: ssFor, newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } }) },
    Gmail: { Users: { Labels: {
      list: () => ({ labels: labels.map((name) => ({ name })) }),
      create: (l) => { labels.push(l.name); },
    } } },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); calls.deletedTriggers++; },
      newTrigger: (h) => { const t = { getHandlerFunction: () => h }; return { timeBased: () => ({ everyMinutes() { return this; }, everyHours() { return this; }, everyDays() { return this; }, atHour() { return this; }, create: () => { triggers.push(t); } }) }; },
    },
  };
  return { sandbox, sheets, labels, triggers, store };
}

const goodProps = () => ({
  ...Object.fromEntries(REQUIRED_PROPERTIES.map((k) => [k, 'x'])),
  MODE: 'PROD', CONFIDENCE_THRESHOLD: '0.70', BATCH_MAX_MESSAGES: '10', RUN_TIME_BUDGET_MS: '270000', BACKFILL_CAPTURE_LIMIT: '1500',
});

async function load(env) {
  const dist = await runBuild();
  vm.createContext(env.sandbox);
  vm.runInContext(readFileSync(path.join(dist, 'Code.js'), 'utf8') + '\n' + readFileSync(path.join(dist, 'Entrypoints.js'), 'utf8'), env.sandbox);
  return env.sandbox;
}

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
  const snapshot = JSON.stringify([env.sheets, env.labels, env.triggers.map((t) => t.getHandlerFunction()), env.store]);
  const second = vm.runInContext('setup()', sb);
  assert.equal(second.labelsCreated.length, 0);
  assert.equal(env.triggers.length, 4);
  for (const t of Object.values(second.spreadsheets.BOT_SPREADSHEET_ID)) {
    assert.equal(t.created, false); assert.equal(t.addedHeaders.length, 0);
  }
  assert.equal(JSON.stringify([env.sheets, env.labels, env.triggers.map((t) => t.getHandlerFunction()), env.store]), snapshot);
});
