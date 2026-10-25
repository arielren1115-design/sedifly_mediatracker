import test from 'node:test';
import assert from 'node:assert/strict';
import { COVERAGE_HEADERS, REVIEW_QUEUE_HEADERS, RUN_LOG_HEADERS, TABS, TRIGGERS, LABELS, missingHeaders } from '../src/core/schema.js';

test('headers are unique and match the spec counts', () => {
  for (const [name, headers] of Object.entries(TABS)) {
    assert.equal(new Set(headers).size, headers.length, `${name} has duplicate headers`);
  }
  assert.equal(COVERAGE_HEADERS.length, 27);
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
