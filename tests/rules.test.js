import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/core/csv.js';
import { loadRules, activeRules } from '../src/core/rules.js';

const rows = parseCsv(readFileSync(new URL('../fixtures/config/rules.csv', import.meta.url), 'utf8'));
const rules = loadRules(rows);

test('the real rules file loads: 14 rules, ids in order, MR-004 the only inactive one', () => {
  assert.deepEqual(rules.map((r) => r.id), Array.from({ length: 14 }, (_, i) => `MR-${String(i + 1).padStart(3, '0')}`));
  assert.deepEqual(rules.filter((r) => !r.active).map((r) => r.id), ['MR-004']);
  assert.equal(activeRules(rules).length, 13);
});

test('rule fields are read by header name', () => {
  const r = Object.fromEntries(rules.map((x) => [x.id, x]));
  assert.equal(r['MR-001'].priority, 'Critical');
  assert.equal(r['MR-001'].route, 'Instant alert');
  assert.equal(r['MR-001'].appliesTo, 'Any');
  assert.equal(r['MR-007'].appliesTo, 'Strategist');
  assert.equal(r['MR-014'].appliesTo, 'General');
  assert.equal(r['MR-014'].route, 'Archive only');
  assert.match(r['MR-005'].trigger, /low classification confidence/);
  assert.match(r['MR-003'].timing, /1 hour/);
});

test('a rule id that is not MR-nnn is rejected, because ids are never invented or renumbered', () => {
  const bad = rows.map((x) => [...x]);
  bad[2][0] = 'Rule 1';
  assert.throws(() => loadRules(bad), /MR-/);
});

test('duplicate ids are rejected', () => {
  const dup = rows.map((x) => [...x]);
  dup[3][0] = 'MR-001';
  assert.throws(() => loadRules(dup), /duplicate/i);
});

test('a missing header row is rejected loudly', () => {
  assert.throws(() => loadRules([['a', 'b']]), /Index/);
});

test('Active other than Yes or No is rejected', () => {
  const bad = rows.map((x) => [...x]);
  bad[2][1] = 'Maybe';
  assert.throws(() => loadRules(bad), /Active/);
});
