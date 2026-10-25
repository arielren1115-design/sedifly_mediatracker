import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunLogRow } from '../src/core/runLogRow.js';
import { RUN_LOG_HEADERS } from '../src/core/schema.js';

const base = { runId: 'r1', fn: 'runIngest', startedAt: new Date('2026-10-25T00:00:00Z'), durationMs: 12, status: 'OK' };

test('run log row uses only real headers and carries the skipped count', () => {
  const row = buildRunLogRow({ ...base, summary: { messagesSeen: 2, itemsParsed: 5, newRows: 3, duplicates: 1, toReview: 1, skippedNoEntity: 4, errors: 0, details: [] } });
  for (const k of Object.keys(row)) assert.ok(RUN_LOG_HEADERS.includes(k), k);
  assert.equal(row['Skipped (no entity)'], 4);
  assert.equal(row['New rows'], 3);
});

test('the detail text is cut at 5000 characters', () => {
  const details = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, outcome: 'processed', note: 'x'.repeat(40) }));
  const row = buildRunLogRow({ ...base, summary: { details } });
  assert.ok(row.Detail.length <= 5000);
  assert.match(row.Detail, /\[truncated\]$/);
});
