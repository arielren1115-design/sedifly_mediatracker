import test from 'node:test';
import assert from 'node:assert/strict';
import { selectParser } from '../src/core/ingestRouting.js';

const msg = (from) => ({ id: 'x', from, subject: '', date: '2026-10-18T00:00:00.000Z', plainBody: '', htmlBody: '', attachments: [] });
const allow = '@sedifly.com';

test('team forward label with an allowed sender uses the team forward parser', () => {
  const r = selectParser(msg('Team <team.member@sedifly.com>'), 'Monitoring/Team Forward', allow);
  assert.equal(typeof r.parse, 'function');
  assert.equal(r.reviewReason, undefined);
});

test('team forward label with an outside sender goes to review', () => {
  const r = selectParser(msg('Outside <outsider@example.com>'), 'Monitoring/Team Forward', allow);
  assert.equal(r.parse, undefined);
  assert.match(r.reviewReason, /allowlist/i);
});

test('automated label picks the parser by sender', () => {
  assert.equal(typeof selectParser(msg('Google Alerts <googlealerts-noreply@google.com>'), 'Monitoring/Automated', allow).parse, 'function');
  assert.equal(typeof selectParser(msg('"alerts@talkwalker.com" <alerts@talkwalker.com>'), 'Monitoring/Automated', allow).parse, 'function');
});

test('automated label with an unknown sender goes to review', () => {
  assert.match(selectParser(msg('news@unknown.org'), 'Monitoring/Automated', allow).reviewReason, /unknown alert sender/i);
});

test('an unexpected source label goes to review, never silently dropped', () => {
  assert.match(selectParser(msg('a@b.c'), 'Monitoring/Other', allow).reviewReason, /label/i);
});
