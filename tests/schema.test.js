import test from 'node:test';
import assert from 'node:assert/strict';
import { COVERAGE_HEADERS, REVIEW_QUEUE_HEADERS, RUN_LOG_HEADERS, TABS, TRIGGERS, LABELS, missingHeaders } from '../src/core/schema.js';

test('headers are unique and match the spec counts', () => {
  for (const [name, headers] of Object.entries(TABS)) {
    assert.equal(new Set(headers).size, headers.length, `${name} has duplicate headers`);
  }
  assert.equal(COVERAGE_HEADERS.length, 29);
  assert.equal(COVERAGE_HEADERS[COVERAGE_HEADERS.indexOf('Source route') + 1], 'Syndicated copies');
  assert.equal(COVERAGE_HEADERS[COVERAGE_HEADERS.indexOf('Channel') + 1], 'Source type');
  assert.equal(RUN_LOG_HEADERS.length, 14);
  assert.deepEqual(REVIEW_QUEUE_HEADERS.slice(-4), ['Review reason', 'Decision', 'Reviewed by', 'Synced at']);
});

test('missingHeaders on an empty sheet returns everything', () => {
  assert.deepEqual(missingHeaders([], COVERAGE_HEADERS), COVERAGE_HEADERS);
  assert.deepEqual(missingHeaders(['', ''], ['A']), ['A']);
});

test('setup is idempotent: second pass proposes nothing', () => {
  const afterFirst = [...COVERAGE_HEADERS];
  assert.deepEqual(missingHeaders(afterFirst, COVERAGE_HEADERS), []);
});

test('human reordered or extra columns are never touched, only missing ones appended', () => {
  const existing = ['Notes', 'My extra column', 'Coverage ID'];
  const add = missingHeaders(existing, COVERAGE_HEADERS);
  assert.ok(!add.includes('Notes') && !add.includes('Coverage ID'));
  assert.equal(add.length, COVERAGE_HEADERS.length - 2);
});

test('trigger plan and labels match spec 14 and 7.1', () => {
  assert.deepEqual(TRIGGERS.map((t) => t.handler), ['runIngest', 'runReviewSync', 'heartbeatCheck', 'dailyDigest']);
  assert.equal(TRIGGERS[0].everyMinutes, 5);
  assert.equal(TRIGGERS[3].atHour, 9);
  assert.equal(LABELS.length, 4);
});

import { COLUMN_HELP, SIMPLE_VIEW_HIDDEN } from '../src/core/schema.js';

test('every column on every tab has help text, and the simple view only hides real columns', () => {
  for (const [name, headers] of Object.entries(TABS)) for (const h of headers) assert.ok(COLUMN_HELP[h], `${name}: no help for ${h}`);
  for (const [name, hidden] of Object.entries(SIMPLE_VIEW_HIDDEN)) for (const h of hidden) assert.ok(TABS[name].includes(h), `${name}: ${h}`);
});

test('the simple view never hides what marketing needs', () => {
  const all = Object.values(SIMPLE_VIEW_HIDDEN).flat();
  for (const keep of ['Title', 'URL', 'Entity', 'Category', 'Priority', 'Verification', 'Notes', 'Decision', 'Submitted by', 'Review reason']) assert.ok(!all.includes(keep), keep);
});
