import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/core/csv.js';
import { loadEntities } from '../src/core/entities.js';
import { loadRules, activeRules } from '../src/core/rules.js';
import { parseGolden } from '../src/core/golden.js';
import { compareFields, summarise } from '../src/core/metrics.js';
import { runEval, renderReport } from '../src/core/evalRun.js';

const cfg = (f) => parseCsv(readFileSync(new URL(`../fixtures/config/${f}`, import.meta.url), 'utf8'));
const entities = loadEntities(cfg('entities.csv'));
const rules = activeRules(loadRules(cfg('rules.csv')));

const HEAD = 'id,date_seen,route,alert_name,url,title,snippet,outlet,expected_entity,expected_category,expected_source_type,expected_channel,expected_priority,expected_sentiment,expected_rule_ids,expected_outcome,notes';
const golden = (...lines) => parseCsv([HEAD, ...lines].join('\n'));

test('golden rows become cases; team forwards carry the comment as the forwarder note; unlabelled rows wait', () => {
  const { cases, unlabelled } = parseGolden(golden(
    'a1,2026-10-01,Talkwalker,Sedifly,https://forbes.com/x,Headline,Snippet about Sedifly,Forbes,Sedifly,Brand,Media,News,Standard,Positive,MR-006,coverage,',
    's1,2026-10-02,Team forward,,https://www.linkedin.com/posts/x,,Great post,,,Brand,Social Media,Social,,,,coverage,',
    'u1,2026-10-03,Google Alerts,,https://x.com/a,Title,,,,,,,,,,,',
  ));
  assert.deepEqual(unlabelled, ['u1']);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].expected.entity, 'Sedifly');
  assert.deepEqual(cases[0].expected.ruleIds, ['MR-006']);
  assert.equal(cases[1].item.title, '');
  assert.equal(cases[1].item.forwarderNote, 'Great post');
});

test('only labelled fields are checked, and rule ids compare as sets', () => {
  const exp = { entity: 'Sedifly', category: 'Brand', source_type: '', channel: '', priority: '', sentiment: '', ruleIds: ['MR-002', 'MR-001'] };
  const got = { entity: 'Sedifly', category: 'Event', matched_rule_ids: ['MR-001', 'MR-002'] };
  assert.deepEqual(compareFields(exp, got), { entity: true, category: false, rules: true });
});

test('summary: review rate, all fields correct and the target check', () => {
  const ok = { entity: 'Sedifly', category: 'Brand', matched_rule_ids: [] };
  const exp = { outcome: 'coverage', entity: 'Sedifly', category: 'Brand', ruleIds: [] };
  const results = [
    { id: '1', expected: exp, actual: { outcome: 'coverage', classification: ok } },
    { id: '2', expected: exp, actual: { outcome: 'coverage', classification: { ...ok, category: 'Event' } } },
    { id: '3', expected: { ...exp, outcome: 'review' }, actual: { outcome: 'review', classification: null } },
    { id: '4', expected: { ...exp, outcome: 'skip' }, actual: { outcome: 'skip', classification: null } },
  ];
  const s = summarise(results);
  assert.equal(s.reviewRate, 0.25);
  assert.equal(s.allFieldsCorrect, 0.5);
  assert.equal(s.perField.category.rate, 0.5);
  assert.equal(s.outcomeAccuracy, 1);
  assert.equal(s.meetsTargets, false);
});

test('an oracle that answers with the labels scores 100% through the real gate and classification step', () => {
  const { cases } = parseGolden(golden(
    'a1,2026-10-01,Talkwalker,Sedifly,https://forbes.com/x,Why Sedifly is growing fast,Joash Lee is the founder of Sedifly,Forbes,Sedifly,Brand,Media,News,Standard,Positive,MR-006,coverage,',
    'a2,2026-10-02,Google Alerts,Joash Lee,https://example.org/y,Awaken Generation Music,Video crew: Joash Lee,Unisba,,,,,,,,review,',
    'a3,2026-10-03,Google Alerts,,https://example.org/z,Generic education news,Nothing monitored here,Blog,,,,,,,,skip,',
  ));
  const oracle = (_req, tc) => ({ kind: 'tool', input: {
    is_relevant: true, entity: tc.expected.entity, channel: tc.expected.channel, source_type: tc.expected.source_type, outlet: 'x', title: 'x', published_date: null,
    category: tc.expected.category, priority: tc.expected.priority, sentiment: tc.expected.sentiment, matched_rule_ids: tc.expected.ruleIds, critical_signal: false,
    summary: 's', confidence: 0.95, reasoning: 'r' } });
  const { results, summary } = runEval({ cases, entities, rules, model: 'claude-haiku-4-5', threshold: 0.7, today: '2026-10-25', call: oracle });
  assert.deepEqual(results.map((r) => r.actual.outcome), ['coverage', 'review', 'skip']);
  assert.equal(summary.outcomeAccuracy, 1);
  assert.equal(summary.allFieldsCorrect, 1);
  const report = renderReport({ results, summary, model: 'm', promptVersion: '2', date: '2026-10-25', unlabelled: [] });
  assert.match(report, /Targets met: no/, 'a 33% review rate misses the 20% target');
  assert.doesNotMatch(report, /[–—]/);
});
