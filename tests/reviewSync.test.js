import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { planReviewSync, approvedCoverageRow } from '../src/core/reviewSync.js';
import { makeEnv, goodProps, load } from './helpers/fakeGas.js';
import { REVIEW_QUEUE_HEADERS } from '../src/core/schema.js';

const none = { hasUrl: () => false, hasKey: () => false };
const row = (rowNumber, over) => ({ rowNumber, values: { URL: 'https://example.com/a?utm_source=x', Entity: 'Sedifly', Category: 'Brand', Priority: 'Standard', 'Gmail message ID': 'm1', ...over } });

test('approve copies, reject only stamps, blank decisions and synced rows are left alone', () => {
  const p = planReviewSync([
    row(2, { Decision: 'Approve' }), row(3, { Decision: 'Reject', URL: 'https://example.com/b' }), row(4, { Decision: '' }),
    row(5, { Decision: 'Approve', 'Synced at': new Date(), URL: 'https://example.com/c' }),
  ], none);
  assert.deepEqual(p.approve.map((a) => a.rowNumber), [2]);
  assert.deepEqual(p.reject, [3]);
  assert.equal(p.approve[0].norm, 'https://example.com/a');
});

test('an approved row missing entity, category or priority waits and says what is missing', () => {
  const p = planReviewSync([row(2, { Decision: 'Approve', Entity: '', Priority: '' })], none);
  assert.deepEqual(p.blocked, [{ rowNumber: 2, missing: ['Entity', 'Priority'] }]);
  assert.equal(p.approve.length, 0);
});

test('an approved link already in Coverage, or approved twice, is not copied twice', () => {
  const p = planReviewSync([row(2, { Decision: 'Approve' }), row(3, { Decision: 'Approve', URL: 'https://example.com/a' })], { hasUrl: (n) => n === 'https://example.com/a', hasKey: () => false });
  assert.deepEqual(p.alreadyThere, [2, 3]);
  const q = planReviewSync([row(2, { Decision: 'Approve' }), row(3, { Decision: 'Approve', URL: 'https://example.com/a' })], none);
  assert.deepEqual([q.approve.length, q.alreadyThere], [1, [3]]);
});

test('the approved Coverage row keeps human edits, gets a new id and is Verified', () => {
  const r = approvedCoverageRow({ Category: 'Event', Entity: 'Sedifly', 'Review reason': 'Low confidence', Decision: 'Approve', Verification: 'Needs verification', 'Coverage ID': '' }, { coverageId: 'COV-000009', now: new Date(0), norm: 'https://x.com/a' });
  assert.equal(r.Category, 'Event');
  assert.equal(r['Coverage ID'], 'COV-000009');
  assert.equal(r.Verification, 'Verified');
  assert.equal('Review reason' in r, false);
  assert.equal('Decision' in r, false);
});

async function ready() {
  const env = makeEnv(goodProps());
  const sb = await load(env);
  vm.runInContext('setup()', sb);
  env.store.NEXT_COVERAGE_ID = '5';
  const rq = env.sheets.x['Review Queue'];
  const add = (over) => rq.rows.push(REVIEW_QUEUE_HEADERS.map((h) => (h in over ? over[h] : '')));
  return { env, sb, rq, add };
}
const cell = (sheet, r, h) => sheet.rows[r][sheet.rows[0].indexOf(h)];

test('runReviewSync through the built bundle: approve, reject, run again', async () => {
  const { env, sb, add } = await ready();
  add({ Title: 'A', URL: 'https://example.com/a', Entity: 'Sedifly', Category: 'Brand', Priority: 'High', Decision: 'Approve', 'Review reason': 'Low confidence', 'Gmail message ID': 'm1' });
  add({ Title: 'B', URL: 'https://example.com/b', Decision: 'Reject', 'Gmail message ID': 'm2' });
  add({ Title: 'C', URL: 'https://example.com/c', 'Gmail message ID': 'm3' });
  const s = vm.runInContext('runReviewSync()', sb);
  assert.equal(s.status, 'OK');
  const cov = env.sheets.x.Coverage; const rq = env.sheets.x['Review Queue'];
  assert.equal(cov.rows.length, 2);
  assert.equal(cell(cov, 1, 'Coverage ID'), 'COV-000005');
  assert.equal(cell(cov, 1, 'Verification'), 'Verified');
  assert.equal(typeof cell(rq, 1, 'Synced at').getTime, 'function');
  assert.equal(typeof cell(rq, 2, 'Synced at').getTime, 'function');
  assert.equal(cell(rq, 3, 'Synced at'), '');
  assert.equal(env.sheets.x['Run Log'].rows.length, 2);
  vm.runInContext('runReviewSync()', sb);
  assert.equal(cov.rows.length, 2, 'nothing is copied twice');
  assert.equal(env.sheets.x['Run Log'].rows.length, 2, 'a run that changed nothing writes no log row');
  assert.equal(env.store.NEXT_COVERAGE_ID, '6');
});
