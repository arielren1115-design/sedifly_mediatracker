import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/core/csv.js';
import { loadRules, activeRules } from '../src/core/rules.js';
import { decideAlert, classificationFromRow } from '../src/core/routing.js';
import { buildAlertEmail } from '../src/core/alertEmail.js';

const rules = activeRules(loadRules(parseCsv(readFileSync(new URL('../fixtures/config/rules.csv', import.meta.url), 'utf8'))));
const c = (over = {}) => ({ is_relevant: true, priority: 'Standard', critical_signal: false, matched_rule_ids: [], ...over });

test('an instant alert rule, a Critical priority or a critical signal each send an alert', () => {
  assert.equal(decideAlert({ rules, classification: c({ matched_rule_ids: ['MR-003'] }), unconfirmed: false }).send, true);
  assert.equal(decideAlert({ rules, classification: c({ priority: 'Critical' }), unconfirmed: false }).send, true);
  assert.equal(decideAlert({ rules, classification: c({ critical_signal: true }), unconfirmed: false }).send, true);
});

test('digest and archive only rules do not alert', () => {
  for (const id of ['MR-006', 'MR-007', 'MR-010', 'MR-014']) assert.equal(decideAlert({ rules, classification: c({ matched_rule_ids: [id] }), unconfirmed: false }).send, false, id);
});

test('the inactive rule MR-004 is not in the active list, so it cannot alert', () => {
  assert.equal(decideAlert({ rules, classification: c({ matched_rule_ids: ['MR-004'] }), unconfirmed: false }).send, false);
});

test('an item the classifier says is not about a monitored entity never alerts', () => {
  assert.equal(decideAlert({ rules, classification: c({ is_relevant: false, priority: 'Critical' }), unconfirmed: true }).send, false);
  assert.equal(decideAlert({ rules, classification: null, unconfirmed: true }).send, false);
});

test('reasons say why, and unconfirmed is passed through', () => {
  const d = decideAlert({ rules, classification: c({ matched_rule_ids: ['MR-001'], priority: 'Critical' }), unconfirmed: true });
  assert.equal(d.unconfirmed, true);
  assert.deepEqual(d.reasons, ['Matched MR-001 (instant alert rule)', 'Priority is Critical']);
});

test('a classification can be rebuilt from an approved row', () => {
  const k = classificationFromRow({ Priority: 'Critical', 'Rules matched': 'MR-001, MR-003' });
  assert.deepEqual(k.matched_rule_ids, ['MR-001', 'MR-003']);
  assert.equal(decideAlert({ rules, classification: k, unconfirmed: false }).send, true);
});

const info = { priority: 'Critical', entity: 'Sedifly', outlet: 'Forbes', unconfirmed: false, title: 'T', url: 'https://x.com/a', publishedAt: '2026-10-13', sentiment: 'Neutral', summary: 'S', ruleIds: 'MR-001', excerpt: 'E', rowLink: 'https://sheet/#gid=1&range=A5', coverageId: 'COV-000005', reasons: ['Priority is Critical'] };

test('alert email: subject format, UNCONFIRMED prefix, negative line, every spec field', () => {
  const m = buildAlertEmail(info);
  assert.equal(m.subject, '[Sedifly Media] Critical: Sedifly in Forbes');
  for (const part of ['Title: T', 'URL: https://x.com/a', 'Outlet: Forbes', 'Published: 2026-10-13', 'Sentiment: Neutral', 'Summary: S', 'Matched rules: MR-001', 'Excerpt: E', 'Coverage ID: COV-000005', 'Sheet row: https://sheet/#gid=1&range=A5', 'Why you are getting this: Priority is Critical.']) assert.ok(m.body.includes(part), part);
  assert.doesNotMatch(m.body, /Negative mention/);
  const u = buildAlertEmail({ ...info, unconfirmed: true, sentiment: 'Negative', coverageId: '' });
  assert.match(u.subject, /^UNCONFIRMED \[Sedifly Media\] Critical:/);
  assert.match(u.body, /Negative mention: reply is a human decision\./);
  assert.match(u.body, /waiting in the Review Queue/);
});
