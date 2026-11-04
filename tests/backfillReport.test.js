import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildBackfillReport, V1_CHANNELS } from '../src/core/backfillReport.js';
import { COVERAGE_HEADERS } from '../src/core/schema.js';
import { makeEnv, goodProps, load } from './helpers/fakeGas.js';

const row = (o) => ({ 'Coverage ID': 'COV-1', 'Found in': 'Old', Channel: 'News', 'Source type': 'Media', Verification: 'Needs verification', URL: 'https://x.com/a', ...o });
const NOW = new Date('2026-11-05T00:00:00Z');

test('recovery rate counts Old stories in the automatic channels that the tool also found; social is reported apart', () => {
  const rows = [
    row({ 'Found in': 'Old, Tool' }), row({}), row({ Channel: 'Blog', 'Found in': 'Old, Tool' }), row({ Channel: 'Listing' }),
    row({ Channel: 'Social', 'Source type': 'Social Media', 'Found in': 'Old, Tool' }), row({ Channel: 'Social', 'Source type': 'Social Media' }),
    row({ Channel: 'Podcast', 'Source type': 'Social Media' }), row({ Channel: 'Other' }),
  ];
  const { stats, lines } = buildBackfillReport(rows, NOW);
  assert.deepEqual([stats.v1, stats.v1Found, stats.social, stats.socialFound], [4, 2, 3, 1]);
  assert.ok(lines.some((l) => /^Recovery rate/.test(l[0]) && l[1] === '2 of 4' && l[2] === '50.0%'));
  assert.ok(lines.some((l) => /^Social posts, reported only/.test(l[0]) && l[1] === '1 of 3'));
  assert.deepEqual(V1_CHANNELS, ['News', 'Blog', 'Listing', 'Reddit', 'Hacker News', 'Forum']);
});

test('new finds are rows found by the tool alone; verified ones are counted apart; audit finds the tool also found are listed', () => {
  const rows = [
    row({ 'Found in': 'Tool', Verification: 'Verified', 'Coverage ID': 'COV-2' }), row({ 'Found in': 'Tool', 'Coverage ID': 'COV-3' }),
    row({ 'Found in': 'Old, Tool' }), row({ 'Found in': 'Audit', 'Coverage ID': 'COV-4' }), row({ 'Found in': 'Audit, Tool', 'Coverage ID': 'COV-5' }),
    row({ 'Found in': 'Manual', 'Coverage ID': 'COV-6' }),
  ];
  const { stats, lines } = buildBackfillReport(rows, NOW);
  assert.deepEqual([stats.toolOnly, stats.verifiedNew, stats.audit, stats.auditFound, stats.manual], [2, 1, 2, 1, 1]);
  assert.ok(lines.some((l) => /^Audit finds, and how many/.test(l[0]) && l[1] === '1 of 2'));
  assert.ok(lines.some((l) => l[1] === 'COV-5'), 'the audit find the tool also found is listed');
  assert.ok(lines.some((l) => /^Archive gaps/.test(l[0]) && /not built/.test(l[2])));
});

test('with no rows there is no division by zero', () => {
  const { lines } = buildBackfillReport([], NOW);
  assert.ok(lines.some((l) => /^Recovery rate/.test(l[0]) && l[1] === '0 of 0' && l[2] === 'n/a'));
});

test('backfillReport through the bundle writes the Backfill Report tab and changes nothing else', async () => {
  const env = makeEnv(goodProps());
  const sb = await load(env);
  vm.runInContext('setup()', sb);
  const cov = env.sheets.x.Coverage;
  cov.rows.push(COVERAGE_HEADERS.map((h) => ({ 'Coverage ID': 'COV-9', 'Found in': 'Old, Tool', Channel: 'News', URL: 'https://x.com/a' }[h] ?? '')));
  const before = JSON.stringify(cov.rows);
  const r = vm.runInContext('backfillReport()', sb);
  assert.equal(r.status, 'OK');
  assert.equal(r.v1Found, 1);
  assert.equal(JSON.stringify(cov.rows), before);
  assert.equal(env.sheets.x['Backfill Report'].rows[0][0], 'Backfill report');
});
