import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/core/csv.js';
import { loadEntities } from '../src/core/entities.js';
import { loadRules, activeRules } from '../src/core/rules.js';
import { classifyItem } from '../src/core/classifyStep.js';
import { htmlToPageText } from '../src/core/pageText.js';

const cfg = (f) => parseCsv(readFileSync(new URL(`../fixtures/config/${f}`, import.meta.url), 'utf8'));
const entities = loadEntities(cfg('entities.csv'));
const rules = activeRules(loadRules(cfg('rules.csv')));

const good = (over = {}) => ({
  is_relevant: true, entity: 'Sedifly', channel: 'News', source_type: 'Media', outlet: 'Forbes', title: 'T of five or more words here',
  published_date: '2026-10-13', category: 'Brand', priority: 'Standard', sentiment: 'Positive', matched_rule_ids: ['MR-006'],
  critical_signal: false, summary: 'A summary.', confidence: 0.9, reasoning: 'Because.', ...over,
});
const item = { gmailMessageId: 'm1', route: 'Talkwalker', url: 'https://www.forbes.com/a', title: 'T', snippet: 'S about Sedifly' };

function ctx(replies, over = {}) {
  const calls = []; const fails = new Map(); const fetched = [];
  const c = {
    model: 'claude-haiku-4-5', threshold: 0.7, today: '2026-10-25', entities, rules,
    call: (req) => { calls.push(req); const r = replies.shift(); if (!r) throw new Error('no reply queued'); return r; },
    fetchPageText: (url) => { fetched.push(url); return over.pageText === undefined ? 'Article text about Sedifly.' : over.pageText; },
    failures: { count: (id) => fails.get(id) || 0, add: (id) => { fails.set(id, (fails.get(id) || 0) + 1); return fails.get(id); }, clear: (id) => { fails.delete(id); } },
    ...over,
  };
  return { c, calls, fails, fetched };
}
const tool = (input) => ({ kind: 'tool', input });
const run = (c, extra = {}) => classifyItem(c, { ...item, ...extra.item }, { candidates: [], route: item.route, messageId: 'm1', ...extra });

test('a confident valid answer is logged', () => {
  const { c, calls } = ctx([tool(good())]);
  const r = run(c);
  assert.equal(r.action, 'coverage');
  assert.equal(r.classification.category, 'Brand');
  assert.equal(calls.length, 1);
});

test('an invalid answer goes to review and is not retried', () => {
  const { c, calls } = ctx([tool(good({ category: 'Press mention' }))]);
  const r = run(c);
  assert.deepEqual([r.action, r.reason, r.classification], ['review', 'Invalid classifier output', null]);
  assert.equal(calls.length, 1);
});

test('a reply with no tool call, or a refusal, is invalid output', () => {
  assert.equal(run(ctx([{ kind: 'no_tool' }]).c).reason, 'Invalid classifier output');
  assert.equal(run(ctx([{ kind: 'refusal' }]).c).reason, 'Invalid classifier output');
});

test('low confidence on a public page fetches the page once and asks again', () => {
  const { c, calls, fetched } = ctx([tool(good({ confidence: 0.4 })), tool(good({ confidence: 0.9 }))]);
  const r = run(c);
  assert.equal(r.action, 'coverage');
  assert.deepEqual(fetched, ['https://www.forbes.com/a']);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].messages[0].content).item.page_text, 'Article text about Sedifly.');
  assert.equal(JSON.parse(calls[0].messages[0].content).item.page_text, null);
});

test('still low after the second look goes to review, and a third call is never made', () => {
  const { c, calls } = ctx([tool(good({ confidence: 0.4 })), tool(good({ confidence: 0.5 }))]);
  const r = run(c);
  assert.deepEqual([r.action, r.reason], ['review', 'Low confidence']);
  assert.equal(r.classification.confidence, 0.5);
  assert.equal(calls.length, 2);
});

test('no page text is fetched for social links, and a page that cannot be read goes to review', () => {
  const social = ctx([tool(good({ confidence: 0.4 }))]);
  const r1 = run(social.c, { item: { url: 'https://www.linkedin.com/posts/x' } });
  assert.deepEqual([r1.action, r1.reason], ['review', 'Low confidence']);
  assert.equal(social.fetched.length, 0, 'no scraping of social platforms');
  const noPage = ctx([tool(good({ confidence: 0.4 }))], { pageText: null });
  assert.equal(run(noPage.c).reason, 'Low confidence');
  assert.equal(noPage.calls.length, 1);
});

test('a second answer that fails does not lose the first: the item goes to review as low confidence', () => {
  const { c } = ctx([tool(good({ confidence: 0.4 })), { kind: 'retry', status: 529 }]);
  assert.equal(run(c).reason, 'Low confidence');
});

test('not relevant: an alert is skipped, a team forward goes to review', () => {
  const nr = good({ is_relevant: false, entity: null });
  assert.equal(run(ctx([tool(nr)]).c).action, 'skip');
  assert.deepEqual(classifyItem(ctx([tool(nr)]).c, item, { candidates: [], route: 'Team forward', messageId: 'm1' }), { action: 'review', reason: 'Low confidence', classification: nr, refetched: false });
});

test('API trouble leaves the message for the next run, and the third failed run sends it to review', async () => {
  const { c, fails } = ctx([{ kind: 'retry', status: 529 }, { kind: 'retry', status: 529 }, { kind: 'fatal', status: 400, message: 'x' }]);
  assert.throws(() => run(c), (e) => e.deferred === true && /attempt 1 of 3/.test(e.message));
  assert.throws(() => run(c), (e) => e.deferred === true && /attempt 2 of 3/.test(e.message));
  const third = run(c);
  assert.deepEqual([third.action, third.reason, third.classification], ['review', 'Classifier unavailable', null]);
  assert.equal(fails.get('m1'), 3);
});

test('a success clears the failure count', () => {
  const { c, fails } = ctx([{ kind: 'retry', status: 500 }, tool(good())]);
  assert.throws(() => run(c));
  assert.equal(fails.get('m1'), 1);
  assert.equal(run(c).action, 'coverage');
  assert.equal(fails.has('m1'), false);
});

test('the request carries the candidates and only the monitored entities', () => {
  const { c, calls } = ctx([tool(good())]);
  run(c, { candidates: [{ name: 'Sedifly', type: 'Brand', strength: 'strong' }] });
  const p = JSON.parse(calls[0].messages[0].content);
  assert.equal(p.candidate_entities[0].name, 'Sedifly');
  assert.equal(p.today, '2026-10-25');
});

test('page text: scripts and styles are dropped, tags removed, and the text is cut at 8000 characters', () => {
  const html = '<html><head><style>p{color:red}</style><script>var x=1;</script></head><body><nav>Menu</nav><h1>Big &amp; news</h1><p>Sedifly did a thing.</p><noscript>enable js</noscript></body></html>';
  const t = htmlToPageText(html);
  assert.match(t, /Big & news Sedifly did a thing\./);
  assert.doesNotMatch(t, /color:red|var x|enable js/);
  assert.equal(htmlToPageText(`<p>${'word '.repeat(5000)}</p>`).length, 8000);
  assert.equal(htmlToPageText(null), '');
});
