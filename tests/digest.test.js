import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildDigest } from '../src/core/digest.js';
import { makeEnv, goodProps, load } from './helpers/fakeGas.js';
import { COVERAGE_HEADERS } from '../src/core/schema.js';

const NOW = Date.parse('2026-11-03T01:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000);
const base = { nowMs: NOW, coverage: [], review: [], runLog: [], lastSuccessIso: '2026-11-03T00:55:00Z', sheetUrl: 'https://sheet' };

test('a zero day builds a digest that says so, but is not due to be sent', () => {
  const d = buildDigest(base);
  assert.equal(d.stats.hasChanges, false);
  assert.equal(d.subject, 'Sedifly Media digest: 0 new items');
  assert.match(d.body, /No new coverage in the last 24 hours\./);
  assert.match(d.body, /Last successful run: 2026-11-03 08:55 SGT/);
  assert.match(d.body, /Sheet: https:\/\/sheet/);
});

test('counts only the last 24 hours, groups by channel, and lists highest priority first', () => {
  const coverage = [
    { 'Detected at': hoursAgo(2), Channel: 'News', Priority: 'Standard', Title: 'Routine', Entity: 'Sedifly', Outlet: 'Forbes', Category: 'Brand', URL: 'https://a' },
    { 'Detected at': hoursAgo(3), Channel: 'News', Priority: 'Critical', Title: 'Big', Entity: 'Joash Lee', Outlet: 'ST', Category: 'Brand', URL: 'https://b', 'Instant alert sent': hoursAgo(3) },
    { 'Detected at': hoursAgo(5), Channel: 'Reddit', Priority: 'Low', Title: 'Post', URL: 'https://c' },
    { 'Detected at': hoursAgo(30), Channel: 'News', Priority: 'High', Title: 'Old', URL: 'https://d' },
    { 'Detected at': hoursAgo(60), 'Archive status': 'Save by hand' },
  ];
  const d = buildDigest({ ...base, coverage });
  assert.equal(d.stats.newRows, 3);
  assert.deepEqual(d.stats.byChannel, { News: 2, Reddit: 1 });
  assert.equal(d.stats.alerts, 1);
  assert.match(d.subject, /3 new items, 1 alert$/);
  const list = d.body.split('\n').filter((l) => l.startsWith('- '));
  assert.match(list[0], /\[Critical\] Joash Lee: Big/);
  assert.match(list[2], /\[Low\]/);
  assert.match(d.body, /Archive status Save by hand: 1/);
  assert.doesNotMatch(d.body, /Old/);
});

test('review queue, run log failures and skipped counts', () => {
  const review = [{ Decision: '' , 'Synced at': '' }, { Decision: 'Approve', 'Synced at': '' }, { Decision: 'Reject', 'Synced at': hoursAgo(1) }, { Decision: '', 'Synced at': '' }];
  const runLog = [
    { 'Started at': hoursAgo(1), 'Skipped (no entity)': 3, 'Status (OK / PARTIAL / FAILED)': 'OK' },
    { 'Started at': hoursAgo(2), 'Skipped (no entity)': 2, 'Status (OK / PARTIAL / FAILED)': 'FAILED' },
    { 'Started at': hoursAgo(3), 'Status (OK / PARTIAL / FAILED)': 'PARTIAL' },
    { 'Started at': hoursAgo(40), 'Skipped (no entity)': 9, 'Status (OK / PARTIAL / FAILED)': 'FAILED' },
  ];
  const d = buildDigest({ ...base, review, runLog });
  assert.match(d.body, /waiting for a decision: 2 \(plus 1 approved/);
  assert.match(d.body, /skipped because no monitored entity matched: 5/);
  assert.match(d.body, /Failed runs: 1\. Partial runs: 1\./);
});

test('a long list is cut at 25 with a pointer to the sheet; no dashes are added by us', () => {
  const coverage = Array.from({ length: 30 }, (_, i) => ({ 'Detected at': hoursAgo(1), Channel: 'News', Priority: 'Standard', Title: `T${i}`, URL: `https://x/${i}` }));
  const d = buildDigest({ ...base, coverage });
  assert.equal(d.body.split('\n').filter((l) => l.startsWith('- ')).length, 25);
  assert.match(d.body, /and 5 more/);
  assert.doesNotMatch(d.subject + d.body.replace(/https?:\/\/\S+/g, ''), /[–—]/);
});

async function ready(extra = {}) {
  const env = makeEnv({ ...goodProps(), OPS_RECIPIENTS: 'ops@example.com', ALERT_RECIPIENTS: 'Marketing@example.com, ops@example.com', ...extra });
  const sb = await load(env);
  vm.runInContext('setup()', sb);
  return { env, sb, run: (c) => vm.runInContext(c, sb) };
}

test('dailyDigest sends nothing when nothing is new or changed, and digestNow still sends', async () => {
  const { env, run } = await ready();
  const quiet = run('dailyDigest()');
  assert.equal(quiet.status, 'SKIPPED');
  assert.equal(quiet.reason, 'nothing new');
  assert.equal(env.mail.length, 0);
  assert.equal(env.store.LAST_DIGEST_AT, undefined);
  assert.equal(run('digestNow()').status, 'OK');
  assert.match(env.mail[0].body, /No new coverage in the last 24 hours\./);
});

test('what counts as a change: new row, new review item, alert, decision, or a bad run; waiting items and skips alone do not', () => {
  const none = buildDigest({ ...base, review: [{ Decision: '', 'Synced at': '', 'Detected at': hoursAgo(50) }], runLog: [{ 'Started at': hoursAgo(1), 'Skipped (no entity)': 4, 'Status (OK / PARTIAL / FAILED)': 'OK' }] });
  assert.equal(none.stats.hasChanges, false);
  assert.equal(buildDigest({ ...base, review: [{ 'Detected at': hoursAgo(2) }] }).stats.hasChanges, true);
  assert.equal(buildDigest({ ...base, review: [{ 'Detected at': hoursAgo(50), 'Synced at': hoursAgo(2) }] }).stats.hasChanges, true);
  assert.equal(buildDigest({ ...base, runLog: [{ 'Started at': hoursAgo(1), 'Status (OK / PARTIAL / FAILED)': 'FAILED' }] }).stats.hasChanges, true);
  assert.equal(buildDigest({ ...base, coverage: [{ 'Detected at': hoursAgo(50), 'Instant alert sent': hoursAgo(1) }] }).stats.hasChanges, true);
});

test('dailyDigest through the bundle: one mail when there is news, to ops and alert recipients each once; a second trigger run is skipped; digestNow forces', async () => {
  const { env, run } = await ready();
  env.sheets.x.Coverage.rows.push(COVERAGE_HEADERS.map((h) => ({ 'Detected at': new Date(), Channel: 'News', Priority: 'High', Title: 'Story', URL: 'https://q' }[h] ?? '')));
  const first = run('dailyDigest()');
  assert.equal(first.status, 'OK');
  assert.equal(env.mail.length, 1);
  assert.deepEqual(env.mail[0].to.split(',').sort(), ['marketing@example.com', 'ops@example.com']);
  assert.match(env.mail[0].subject, /^Sedifly Media digest: 1 new item/);
  assert.equal(run('dailyDigest()').status, 'SKIPPED');
  assert.equal(env.mail.length, 1);
  assert.equal(run('digestNow()').status, 'OK');
  assert.equal(env.mail.length, 2);
});

test('the digest counts a new row written in the last day', async () => {
  const { env, run } = await ready();
  const cov = env.sheets.x.Coverage;
  cov.rows.push(COVERAGE_HEADERS.map((h) => ({ 'Detected at': new Date(), Channel: 'News', Priority: 'High', Title: 'Fresh story', URL: 'https://z' }[h] ?? '')));
  const r = run('dailyDigest()');
  assert.equal(r.newRows, 1);
  assert.match(env.mail[0].body, /\[High\] No entity: Fresh story/);
});

test('with every recipient a placeholder the digest fails loudly and is logged FAILED', async () => {
  const { env, run } = await ready({ OPS_RECIPIENTS: 'PLACEHOLDER', ALERT_RECIPIENTS: 'PLACEHOLDER' });
  env.sheets.x.Coverage.rows.push(COVERAGE_HEADERS.map((h) => ({ 'Detected at': new Date() }[h] ?? '')));
  assert.throws(() => run('dailyDigest()'), /No digest recipients/);
  assert.equal(env.mail.length, 0);
  assert.equal(env.sheets.x['Run Log'].rows.at(-1)[12], 'FAILED');
});

test('emails waiting in Monitoring/Review are listed with sender and subject, and a new one makes the digest due', () => {
  const none = buildDigest(base);
  assert.equal(none.stats.hasChanges, false);
  assert.match(none.body, /Monitoring\/Review label of the tracker mailbox: 0/);
  const old = buildDigest({ ...base, reviewEmails: { count: 1, items: [{ from: 'Old <old@x.com>', subject: 'Old one', dateMs: NOW - 3 * 86400000 }] } });
  assert.equal(old.stats.hasChanges, false, 'an email that has been waiting for days does not trigger a digest by itself');
  assert.match(old.body, /Old <old@x\.com> \| Old one/);
  const fresh = buildDigest({ ...base, reviewEmails: { count: 12, items: [{ from: 'Stranger <s@x.com>', subject: '', dateMs: NOW - 3600000 }] } });
  assert.equal(fresh.stats.hasChanges, true);
  assert.match(fresh.body, /Stranger <s@x\.com> \| \(no subject\)/);
  assert.match(fresh.body, /and 11 more/);
  assert.match(fresh.body, /add the address to TEAM_SENDER_ALLOWLIST/);
});

test('dailyDigest through the bundle includes the Monitoring/Review emails', async () => {
  const { env, run } = await ready();
  const raw = { id: 'rv1', internalDate: String(Date.now()), payload: { headers: [{ name: 'From', value: 'Stranger <s@example.org>' }, { name: 'Subject', value: 'Please add this' }] } };
  env.mailbox.push({ id: 'rv1', labelIds: new Set(['L_Monitoring/Review']), raw });
  const r = run('dailyDigest()');
  assert.equal(r.status, 'OK');
  assert.match(env.mail[0].body, /Monitoring\/Review label of the tracker mailbox: 1/);
  assert.match(env.mail[0].body, /Stranger <s@example\.org> \| Please add this/);
});
