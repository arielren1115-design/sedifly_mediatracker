// Instant alerts through the built bundle with fake Gmail, Sheets, Mail and Anthropic.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { makeEnv, goodProps, load, fakeSheet } from './helpers/fakeGas.js';
import { emlToGmailApi } from './helpers/emlToGmailApi.js';
import { parseCsv } from '../src/core/csv.js';
import { REVIEW_QUEUE_HEADERS } from '../src/core/schema.js';

const dir = new URL('../fixtures/emails/', import.meta.url).pathname;
const run = (sb, code) => vm.runInContext(code, sb);
const reply = (input) => ({ status: 200, body: JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'record_classification', input }] }) });
const verdict = (over = {}) => ({
  is_relevant: true, entity: 'Sedifly', channel: 'News', source_type: 'Media', outlet: 'Forbes', title: 'Why Venture Capital Money Is Not Right',
  published_date: '2026-10-13', category: 'Brand', priority: 'Critical', sentiment: 'Negative', matched_rule_ids: ['MR-001'],
  critical_signal: true, summary: 'Serious allegation.', confidence: 0.92, reasoning: 'Because.', ...over,
});
const csv = (name, file, sheets, key) => { const t = fakeSheet(name); parseCsv(readFileSync(new URL(`../fixtures/config/${file}`, import.meta.url), 'utf8')).forEach((r) => t.rows.push(r)); sheets[key][name] = t; };

async function ready(extra = {}) {
  const env = makeEnv({ ...goodProps(), ANTHROPIC_API_KEY: 'sk-test', CLAUDE_MODEL: 'claude-haiku-5-5', ALERT_RECIPIENTS: 'alerts@example.com', OPS_RECIPIENTS: 'ops@example.com', ...extra });
  const sb = await load(env);
  run(sb, 'setup()');
  csv('Monitored Entities', 'entities.csv', env.sheets, 'x');
  csv('Monitoring Rules', 'rules.csv', env.sheets, 'x');
  const add = async (id, file, label) => env.mailbox.push({ id, labelIds: new Set([`L_${label}`]), raw: await emlToGmailApi(`${dir}${file}.eml`, id) });
  return { env, sb, add };
}
const col = (sheet, h) => sheet.rows[0].indexOf(h);

test('a Critical item sends one alert to ALERT_RECIPIENTS, stamps the row, and a rerun sends nothing', async () => {
  const { env, sb, add } = await ready();
  await add('a2', 'talkwalker_native', 'Monitoring/Automated');
  for (let i = 0; i < 6; i++) env.state.fetchQueue.push(reply(verdict()));
  run(sb, 'runIngest()');
  const alerts = env.mail.filter((m) => /Sedifly Media/.test(m.subject));
  assert.ok(alerts.length >= 1);
  assert.equal(alerts[0].to, 'alerts@example.com');
  assert.match(alerts[0].subject, /^\[Sedifly Media\] Critical: Sedifly in /);
  assert.match(alerts[0].body, /Negative mention: reply is a human decision\./);
  assert.match(alerts[0].body, /Sheet row: https:\/\/docs\.google\.com\/spreadsheets\/d\/x\/edit#gid=\d+&range=A\d+/);
  const cov = env.sheets.x.Coverage;
  const stamped = cov.rows.slice(1).filter((r) => r[col(cov, 'Instant alert sent')] !== '');
  assert.equal(stamped.length, alerts.length, 'every alert is stamped on its row');
  const before = env.mail.length;
  run(sb, 'runIngest()');
  assert.equal(env.mail.length, before, 'a rerun sends nothing');
});

test('a Critical item that goes to review is alerted as UNCONFIRMED and stamped on the Review Queue row', async () => {
  const { env, sb, add } = await ready();
  await add('a2', 'talkwalker_native', 'Monitoring/Automated');
  for (let i = 0; i < 6; i++) env.state.fetchQueue.push(reply(verdict({ confidence: 0.3 })));
  run(sb, 'runIngest()');
  const alert = env.mail.find((m) => /Sedifly Media/.test(m.subject));
  assert.match(alert.subject, /^UNCONFIRMED \[Sedifly Media\]/);
  const rq = env.sheets.x['Review Queue'];
  assert.ok(rq.rows.slice(1).some((r) => r[col(rq, 'Instant alert sent')] !== ''));
});

test('with no recipients set the alert is queued, the run is PARTIAL, and the next run sends it once', async () => {
  const { env, sb, add } = await ready({ ALERT_RECIPIENTS: 'PLACEHOLDER' });
  await add('a2', 'talkwalker_native', 'Monitoring/Automated');
  for (let i = 0; i < 6; i++) env.state.fetchQueue.push(reply(verdict()));
  const first = run(sb, 'runIngest()');
  assert.equal(first.status, 'PARTIAL');
  assert.equal(env.mail.filter((m) => /Sedifly Media/.test(m.subject)).length, 0);
  assert.ok(JSON.parse(env.store.PENDING_ALERTS).length >= 1);
  env.store.ALERT_RECIPIENTS = 'alerts@example.com';
  run(sb, 'runIngest()');
  const sent = env.mail.filter((m) => /Sedifly Media/.test(m.subject));
  assert.ok(sent.length >= 1);
  assert.equal(JSON.parse(env.store.PENDING_ALERTS).length, 0);
  run(sb, 'runIngest()');
  assert.equal(env.mail.filter((m) => /Sedifly Media/.test(m.subject)).length, sent.length, 'sent once');
});

test('BLIND mode alerts go to ALERT_RECIPIENTS_BLIND only', async () => {
  const { env, sb, add } = await ready({ MODE: 'BLIND', ALERT_RECIPIENTS_BLIND: 'ariel@example.com', SCRATCH_SPREADSHEET_ID: 'x' });
  await add('a2', 'talkwalker_native', 'Monitoring/Automated');
  for (let i = 0; i < 6; i++) env.state.fetchQueue.push(reply(verdict()));
  run(sb, 'runIngest()');
  const alert = env.mail.find((m) => /Sedifly Media/.test(m.subject));
  assert.equal(alert.to, 'ariel@example.com');
});

test('approving a Critical review row sends a normal alert once; an already alerted row is not alerted again', async () => {
  const { env, sb } = await ready();
  env.store.NEXT_COVERAGE_ID = '10';
  const rq = env.sheets.x['Review Queue'];
  const addRow = (over) => rq.rows.push(REVIEW_QUEUE_HEADERS.map((h) => (h in over ? over[h] : '')));
  addRow({ Title: 'A', URL: 'https://example.com/a', Entity: 'Sedifly', Category: 'Brand', Priority: 'Critical', 'Rules matched': 'MR-001', Decision: 'Approve', Outlet: 'Forbes', 'Gmail message ID': 'm1' });
  addRow({ Title: 'B', URL: 'https://example.com/b', Entity: 'Sedifly', Category: 'Brand', Priority: 'Critical', 'Rules matched': 'MR-001', Decision: 'Approve', 'Instant alert sent': new Date(), 'Gmail message ID': 'm2' });
  run(sb, 'runReviewSync()');
  const alerts = env.mail.filter((m) => /Sedifly Media/.test(m.subject));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /^\[Sedifly Media\] Critical: Sedifly in Forbes$/);
  assert.match(alerts[0].body, /COV-000010/);
  run(sb, 'runReviewSync()');
  assert.equal(env.mail.filter((m) => /Sedifly Media/.test(m.subject)).length, 1);
});
