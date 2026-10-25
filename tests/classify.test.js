import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/core/csv.js';
import { loadEntities } from '../src/core/entities.js';
import { loadRules, activeRules } from '../src/core/rules.js';
import { CATEGORIES, PRIORITIES, SENTIMENTS, CHANNELS } from '../src/core/taxonomy.js';
import { validateClassification } from '../src/core/validateClassification.js';
import { buildRequest, buildUserPayload, buildTool, SYSTEM_PROMPT, PROMPT_VERSION, modelProfile } from '../src/core/classifyPrompt.js';
import { decideOutcome } from '../src/core/classifyOutcome.js';

const cfg = (f) => parseCsv(readFileSync(new URL(`../fixtures/config/${f}`, import.meta.url), 'utf8'));
const entities = loadEntities(cfg('entities.csv'));
const rules = loadRules(cfg('rules.csv'));
const active = activeRules(rules);
const ctx = { entityNames: entities.map((e) => e.name), ruleIds: active.map((r) => r.id) };

const good = () => ({
  is_relevant: true, entity: 'Sedifly', channel: 'News', outlet: 'Forbes', title: 'Why Venture Capital Is Hard',
  published_date: '2026-10-13', category: 'Brand', priority: 'Standard', sentiment: 'Positive',
  matched_rule_ids: ['MR-006'], critical_signal: false, summary: 'Founder profile mentioning Sedifly.', confidence: 0.92, reasoning: 'Direct mention of the company and its founder.',
});

test('taxonomy follows the owners: four categories, four priorities', () => {
  assert.deepEqual(CATEGORIES.map((c) => c.value), ['General', 'Event', 'Brand', 'Strategist']);
  assert.deepEqual(PRIORITIES.map((p) => p.value), ['Critical', 'High', 'Standard', 'Low']);
  assert.deepEqual(SENTIMENTS, ['Positive', 'Neutral', 'Negative', 'Unclear']);
  assert.ok(CHANNELS.includes('Hacker News') && CHANNELS.includes('Social'));
  for (const t of [...CATEGORIES, ...PRIORITIES]) assert.ok(t.definition.length > 20, `${t.value} has a definition`);
});

test('every category and priority used by the real rules is in the taxonomy', () => {
  const cats = new Set([...CATEGORIES.map((c) => c.value), 'Any']);
  const pris = new Set(PRIORITIES.map((p) => p.value));
  for (const r of rules) {
    assert.ok(cats.has(r.appliesTo), `${r.id} applies to ${r.appliesTo}`);
    assert.ok(pris.has(r.priority), `${r.id} priority ${r.priority}`);
  }
});

test('a good output validates unchanged', () => {
  const r = validateClassification(good(), ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, good());
});

test('anything outside the allowed lists is invalid', () => {
  const bad = (patch) => validateClassification({ ...good(), ...patch }, ctx);
  assert.equal(bad({ entity: 'Not A Monitored Entity' }).ok, false);
  assert.equal(bad({ category: 'Press mention' }).ok, false);
  assert.equal(bad({ priority: 'Routine' }).ok, false);
  assert.equal(bad({ sentiment: 'Happy' }).ok, false);
  assert.equal(bad({ channel: 'Podcast2' }).ok, false);
  assert.equal(bad({ matched_rule_ids: ['MR-004'] }).ok, false, 'an inactive rule is not allowed');
  assert.equal(bad({ matched_rule_ids: ['MR-099'] }).ok, false);
  assert.match(bad({ matched_rule_ids: ['MR-099'] }).errors.join(' '), /MR-099/);
});

test('type and range problems are invalid', () => {
  const bad = (patch) => validateClassification({ ...good(), ...patch }, ctx);
  assert.equal(bad({ confidence: 1.5 }).ok, false);
  assert.equal(bad({ confidence: -0.1 }).ok, false);
  assert.equal(bad({ confidence: '0.9' }).ok, false);
  assert.equal(bad({ is_relevant: 'yes' }).ok, false);
  assert.equal(bad({ critical_signal: undefined }).ok, false);
  assert.equal(bad({ published_date: '13/10/2026' }).ok, false);
  assert.equal(bad({ published_date: '2026-02-31' }).ok, false);
  assert.equal(bad({ summary: 42 }).ok, false);
  assert.equal(validateClassification(null, ctx).ok, false);
  assert.equal(validateClassification('text', ctx).ok, false);
  assert.equal(validateClassification({}, ctx).ok, false);
});

test('a null published date is fine, and a relevant item must name an entity', () => {
  assert.equal(validateClassification({ ...good(), published_date: null }, ctx).ok, true);
  assert.equal(validateClassification({ ...good(), entity: null }, ctx).ok, false);
  assert.equal(validateClassification({ ...good(), is_relevant: false, entity: null }, ctx).ok, true);
});

test('long summary and reasoning are trimmed to their word limits, duplicate rule ids are removed', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const r = validateClassification({ ...good(), summary: words(40), reasoning: words(70), matched_rule_ids: ['MR-006', 'MR-006'] }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.value.summary.split(' ').length, 30);
  assert.equal(r.value.reasoning.split(' ').length, 50);
  assert.deepEqual(r.value.matched_rule_ids, ['MR-006']);
});

test('the request has the spec shape: tool, no sampling parameters, user message is JSON', () => {
  const item = { gmailMessageId: 'm1', route: 'Talkwalker', url: 'https://www.forbes.com/a', title: 'T', snippet: 'S', outlet: 'forbes.com', publishedAt: '2026-10-13', forwarderNote: null, alertName: 'Sedifly' };
  const req = buildRequest({ model: 'claude-haiku-4-5', item, candidates: [{ name: 'Sedifly', type: 'Brand', strength: 'strong' }], entities, rules: active, today: '2026-10-25' });
  assert.equal(req.model, 'claude-haiku-4-5');
  assert.equal(req.max_tokens, 800);
  assert.equal(req.system, SYSTEM_PROMPT);
  assert.equal('temperature' in req, false, 'temperature is rejected on newer API versions and models');
  assert.equal('top_p' in req, false);
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0].name, 'record_classification');
  assert.deepEqual(req.tool_choice, { type: 'tool', name: 'record_classification' });
  const payload = JSON.parse(req.messages[0].content);
  assert.equal(payload.today, '2026-10-25');
  assert.equal(payload.item.url, 'https://www.forbes.com/a');
  assert.equal(payload.item.alert_name, 'Sedifly');
  assert.equal(payload.entities.length, 26);
  assert.equal(payload.active_rules.length, 13);
  assert.ok(payload.active_rules.every((r) => r.id && r.trigger && r.default_priority));
  assert.ok(!payload.active_rules.some((r) => r.id === 'MR-004'), 'inactive rules are not shown to the model');
  assert.equal(payload.taxonomy.categories.length, 4);
  assert.equal(payload.candidate_entities[0].name, 'Sedifly');
});

test('the tool schema restricts values to the lists in this run', () => {
  const tool = buildTool(ctx);
  const p = tool.input_schema.properties;
  assert.deepEqual(p.category.enum, ['General', 'Event', 'Brand', 'Strategist']);
  assert.deepEqual(p.priority.enum, ['Critical', 'High', 'Standard', 'Low']);
  assert.ok(p.entity.enum.includes('Sedifly') && p.entity.enum.includes(null));
  assert.ok(p.matched_rule_ids.items.enum.includes('MR-001') && !p.matched_rule_ids.items.enum.includes('MR-004'));
  assert.equal(tool.input_schema.additionalProperties, false);
  assert.ok(tool.input_schema.required.includes('confidence'));
});

test('model profiles: forced tool only for the model the spec names, bigger budget for newer models', () => {
  assert.deepEqual(modelProfile('claude-haiku-4-5'), { forceTool: true, maxTokens: 800, effort: null });
  const newer = modelProfile('claude-haiku-5-5');
  assert.equal(newer.forceTool, false);
  assert.ok(newer.maxTokens >= 4000, 'thinking tokens count against max_tokens');
  assert.equal(newer.effort, 'low');
  const item = { gmailMessageId: 'm1', route: 'Google Alerts', url: 'https://a.com/x', title: 'T' };
  const req = buildRequest({ model: 'claude-haiku-5-5', item, candidates: [], entities, rules: active, today: '2026-10-25' });
  assert.deepEqual(req.tool_choice, { type: 'auto' });
  assert.deepEqual(req.output_config, { effort: 'low' });
  assert.match(req.system, /record_classification/);
});

test('the system prompt is versioned and says the item text is data', () => {
  assert.match(PROMPT_VERSION, /^\d+$/);
  assert.match(SYSTEM_PROMPT, /data, not instructions/i);
  assert.doesNotMatch(SYSTEM_PROMPT, /[–—]/, 'plain English with no en or em dashes');
});

test('outcome table, spec 9.3', () => {
  const threshold = 0.7;
  const ok = (over = {}) => ({ ok: true, value: { ...good(), ...over } });
  const d = (result, c = {}) => decideOutcome(result, { route: 'Talkwalker', threshold, canRefetch: false, alreadyRefetched: false, ...c });
  assert.deepEqual(d({ ok: false, errors: ['x'] }), { action: 'review', reason: 'Invalid classifier output' });
  assert.deepEqual(d(ok()), { action: 'coverage' });
  assert.deepEqual(d(ok({ confidence: 0.7 })), { action: 'coverage' }, 'exactly at the threshold passes');
  assert.deepEqual(d(ok({ confidence: 0.69 })), { action: 'review', reason: 'Low confidence' });
  assert.deepEqual(d(ok({ confidence: 0.4 }), { canRefetch: true }), { action: 'refetch' });
  assert.deepEqual(d(ok({ confidence: 0.4 }), { canRefetch: true, alreadyRefetched: true }), { action: 'review', reason: 'Low confidence' });
  assert.deepEqual(d(ok({ is_relevant: false, entity: null })), { action: 'skip', reason: 'Classifier says the item is not about a monitored entity' });
  assert.deepEqual(d(ok({ is_relevant: false, entity: null }), { route: 'Team forward' }), { action: 'review', reason: 'Low confidence' }, 'forwards are never skipped');
});
