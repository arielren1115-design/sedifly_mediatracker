import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_PROPERTIES, validateProperties } from '../src/core/properties.js';

const good = () => Object.fromEntries(REQUIRED_PROPERTIES.map((k) => [k, 'x']).map(([k]) => [k, {
  MODE: 'PROD', CONFIDENCE_THRESHOLD: '0.70', BATCH_MAX_MESSAGES: '10', RUN_TIME_BUDGET_MS: '270000', BACKFILL_CAPTURE_LIMIT: '1500',
}[k] ?? 'x']));

test('all present is valid', () => {
  assert.deepEqual(validateProperties(good()), { missing: [], invalid: [], placeholders: [] });
});

test('lists every missing key', () => {
  const p = good(); delete p.ANTHROPIC_API_KEY; p.OPS_RECIPIENTS = '  ';
  assert.deepEqual(validateProperties(p).missing, ['ANTHROPIC_API_KEY', 'OPS_RECIPIENTS']);
});

test('bad values are reported', () => {
  const p = good(); p.MODE = 'LIVE'; p.CONFIDENCE_THRESHOLD = '2'; p.BATCH_MAX_MESSAGES = 'ten';
  assert.equal(validateProperties(p).invalid.length, 3);
});

test('placeholders are flagged but not missing', () => {
  const p = good(); p.ANTHROPIC_API_KEY = 'PLACEHOLDER';
  const r = validateProperties(p);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.placeholders, ['ANTHROPIC_API_KEY']);
});
