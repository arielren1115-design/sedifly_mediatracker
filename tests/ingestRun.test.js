import test from 'node:test';
import assert from 'node:assert/strict';
import { emlToMessage } from './helpers/emlToMessage.js';
import { processBatch } from '../src/core/ingestRun.js';
import { createIndex } from '../src/core/dedupe.js';
import { parseCsv } from '../src/core/csv.js';
import { loadEntities } from '../src/core/entities.js';
import { readFileSync } from 'node:fs';

const entities = loadEntities(parseCsv(readFileSync(new URL('../fixtures/config/entities.csv', import.meta.url), 'utf8')));

const dir = new URL('../fixtures/emails/', import.meta.url).pathname;
const FIX = {
  fwd: ['team_forward_multiple_links', 'Monitoring/Team Forward'],
  shot: ['team_forward_screenshot_only', 'Monitoring/Team Forward'],
  outsider: ['team_forward_non_team_sender', 'Monitoring/Team Forward'],
  empty: ['team_forward_no_url_no_image', 'Monitoring/Team Forward'],
  ga: ['google_alert_joash_lee', 'Monitoring/Automated'],
  tw: ['talkwalker_native', 'Monitoring/Automated'],
};

async function world() {
  const messages = {}; const labels = {};
  for (const [id, [file, label]] of Object.entries(FIX)) { messages[id] = await emlToMessage(`${dir}${file}.eml`, id); labels[id] = label; }
  messages.unknown = { ...messages.ga, id: 'unknown', from: 'news@unknown.org' }; labels.unknown = 'Monitoring/Automated';
  const w = { messages, labels, processed: [], reviewed: [], coverage: [], reviewRows: [], updates: [], index: createIndex([]), next: 1, failMarkOnce: null };
  w.add = (id, label, over = {}) => { messages[id] = { ...messages.fwd, id, ...over }; labels[id] = label; };
  w.deps = (over = {}) => ({
    candidates: Object.keys(messages).filter((id) => !w.processed.includes(id) && !w.reviewed.some((r) => r[0] === id)).map((id) => ({ id, sourceLabel: labels[id] })),
    getMessage: (id) => messages[id],
    index: w.index,
    entities,
    allocateIds: (n) => Array.from({ length: n }, () => `COV-${String(w.next++).padStart(6, '0')}`),
    appendCoverageRow: (row) => { w.coverage.push(row); return w.coverage.length + 1; },
    appendReviewRow: (row) => { w.reviewRows.push(row); return w.reviewRows.length + 1; },
    updateExisting: (entry, values) => { w.updates.push({ id: entry.coverageId, sheet: entry.sheet, values }); },
    markProcessed: (id) => { if (w.failMarkOnce === id) { w.failMarkOnce = null; throw new Error('gmail down'); } w.processed.push(id); },
    markReview: (id, label, reason) => { w.reviewed.push([id, reason]); },
    shouldStop: () => false,
    now: () => new Date('2026-10-18T10:00:00.000Z'),
    allowlist: '@sedifly.com',
    ...over,
  });
  return w;
}

const only = (w, ...ids) => ({ candidates: ids.map((id) => ({ id, sourceLabel: w.labels[id] })) });
const FORBES = 'https://www.forbes.com/councils/forbesbusinesscouncil/2026/10/13/why-venture-capital-money-isnt-right-for-every-founder/';

test('every message ends as rows, a review label, never dropped', async () => {
  const w = await world();
  const s = processBatch(w.deps());
  assert.equal(s.messagesSeen, 7);
  assert.equal(s.itemsParsed, 3 + 1 + 1 + 2);
  assert.equal(s.newRows, 6, 'the Unisba video credit is ambiguous, so it is not logged');
  assert.equal(s.toReview, 4, '3 messages labelled Review plus 1 Review Queue row');
  assert.equal(s.errors, 0);
  assert.equal(s.status, 'OK');
  assert.deepEqual(w.processed.sort(), ['fwd', 'ga', 'shot', 'tw']);
  assert.deepEqual(w.reviewed.map((r) => r[0]).sort(), ['empty', 'outsider', 'unknown']);
  assert.equal(w.coverage.length, 6);
  assert.equal(w.reviewRows.length, 1);
  assert.equal(new Set(w.coverage.map((r) => r['Coverage ID'])).size, 6);
  assert.equal(s.details.length, 7);
  const outsider = s.details.find((d) => d.id === 'outsider');
  assert.match(outsider.from, /outsider@example\.com/);
  assert.equal(outsider.subject, 'test');
});

test('a second run over the same state does nothing', async () => {
  const w = await world();
  processBatch(w.deps());
  const again = processBatch(w.deps());
  assert.equal(again.messagesSeen, 0);
  assert.equal(w.coverage.length, 6);
});

test('crash after writing rows but before labelling: retry makes no duplicates', async () => {
  const w = await world();
  w.failMarkOnce = 'tw';
  const first = processBatch(w.deps());
  assert.equal(first.errors, 1);
  assert.equal(first.status, 'PARTIAL');
  const rowsAfterFirst = w.coverage.length;
  const second = processBatch(w.deps());
  assert.equal(second.messagesSeen, 1);
  assert.equal(second.newRows, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(w.coverage.length, rowsAfterFirst);
  assert.ok(w.processed.includes('tw'));
});

test('stops starting new messages once the time budget is spent', async () => {
  const w = await world();
  let calls = 0;
  const s = processBatch(w.deps({ shouldStop: () => ++calls > 2 }));
  assert.equal(s.messagesSeen, 2);
  assert.equal(s.skippedForBudget, 5);
});

test('a parser crash sends the message to review instead of retrying forever', async () => {
  const w = await world();
  w.messages.ga = { ...w.messages.ga, htmlBody: null };
  const s = processBatch(w.deps({ candidates: [{ id: 'ga', sourceLabel: 'Monitoring/Automated' }] }));
  assert.equal(s.errors, 0);
  assert.equal(s.toReview, 1);
});

test('failing to read a message is an error and the message stays for the next run', async () => {
  const w = await world();
  const s = processBatch(w.deps({ candidates: [{ id: 'ga', sourceLabel: 'Monitoring/Automated' }], getMessage: () => { throw new Error('quota'); } }));
  assert.equal(s.errors, 1);
  assert.equal(s.status, 'FAILED');
  assert.equal(w.reviewed.length, 0);
  assert.equal(w.processed.length, 0);
});

test('rows carry the normalised url', async () => {
  const w = await world();
  processBatch(w.deps(only(w, 'tw')));
  assert.equal(w.coverage[0]['Normalised URL'], 'https://forbes.com/councils/forbesbusinesscouncil/2026/10/13/why-venture-capital-money-isnt-right-for-every-founder');
});

test('the same article from another source adds the route to the existing row and creates no new row', async () => {
  const w = await world();
  processBatch(w.deps(only(w, 'tw')));
  w.add('fw2', 'Monitoring/Team Forward', { plainBody: `Great piece\n${FORBES}?utm_source=whatsapp` });
  const s = processBatch(w.deps(only(w, 'fw2')));
  assert.equal(w.coverage.length, 2, 'forbes and campus.sg only');
  assert.equal(s.newRows, 0);
  assert.equal(s.duplicates, 1);
  assert.deepEqual(w.updates, [{ id: 'COV-000001', sheet: 'Coverage', values: { 'Source route': 'Talkwalker, Team forward', 'Found in': 'Tool', 'Last updated': new Date('2026-10-18T10:00:00.000Z') } }]);
  assert.ok(w.processed.includes('fw2'));
});

test('a repeat from a route already recorded changes nothing', async () => {
  const w = await world();
  w.add('fw2', 'Monitoring/Team Forward', { plainBody: 'https://example.com/story' });
  w.add('fw3', 'Monitoring/Team Forward', { plainBody: 'https://www.example.com/story/?utm_medium=x' });
  const s = processBatch(w.deps(only(w, 'fw2', 'fw3')));
  assert.equal(w.coverage.length, 1);
  assert.equal(s.duplicates, 1);
  assert.equal(w.updates.length, 0);
});

test('a duplicate inside the same batch merges into the row created a moment earlier', async () => {
  const w = await world();
  w.add('fw2', 'Monitoring/Team Forward', { plainBody: FORBES });
  const s = processBatch(w.deps(only(w, 'tw', 'fw2')));
  assert.equal(w.coverage.length, 2);
  assert.equal(s.duplicates, 1);
  assert.equal(w.updates.length, 1);
  assert.equal(w.updates[0].values['Source route'], 'Talkwalker, Team forward');
});

const copyOf = (w, id, from, to, label = 'Monitoring/Automated', base = 'tw') => {
  w.messages[id] = { ...w.messages[base], id, htmlBody: w.messages[base].htmlBody.replaceAll(from, to) };
  w.labels[id] = label;
};

test('a syndicated copy (same headline, different url, within 7 days) adds no row and is counted on the existing row', async () => {
  const w = await world();
  processBatch(w.deps(only(w, 'tw')));
  copyOf(w, 'tw2', FORBES, 'https://syndicated.example.com/copy');
  const s = processBatch(w.deps(only(w, 'tw2')));
  assert.equal(w.coverage.length, 2, 'no new Coverage row');
  assert.equal(w.reviewRows.length, 0, 'and nothing is sent to the Review Queue');
  assert.equal(s.newRows, 0);
  assert.equal(s.toReview, 0);
  assert.equal(s.duplicates, 2, 'the syndicated copy and the repeated campus.sg link');
  const u = w.updates.find((x) => x.values['Syndicated copies'] !== undefined);
  assert.equal(u.id, 'COV-000001');
  assert.equal(u.values['Syndicated copies'], 1);
  assert.ok(u.values['Last updated'] instanceof Date);
  assert.deepEqual(s.details[0].syndicated, [{ url: 'https://syndicated.example.com/copy', of: 'COV-000001' }]);
  assert.ok(w.processed.includes('tw2'));
});

test('every further copy raises the count, so hundreds of copies stay one row', async () => {
  const w = await world();
  processBatch(w.deps(only(w, 'tw')));
  for (let i = 1; i <= 5; i++) {
    copyOf(w, `c${i}`, FORBES, `https://site${i}.example.com/copy`);
    processBatch(w.deps(only(w, `c${i}`)));
  }
  assert.equal(w.coverage.length, 2);
  assert.equal(w.reviewRows.length, 0);
  const counts = w.updates.filter((x) => x.values['Syndicated copies'] !== undefined).map((x) => x.values['Syndicated copies']);
  assert.deepEqual(counts, [1, 2, 3, 4, 5]);
});

test('a copy of an item waiting in the Review Queue is counted on that review row', async () => {
  const w = await world();
  processBatch(w.deps(only(w, 'ga')));
  assert.equal(w.reviewRows.length, 1);
  copyOf(w, 'ga2', 'media.unisba.ac.id', 'copy.example.org', 'Monitoring/Automated', 'ga');
  processBatch(w.deps(only(w, 'ga2')));
  assert.equal(w.reviewRows.length, 1, 'still one review row');
  const u = w.updates.find((x) => x.values['Syndicated copies'] !== undefined);
  assert.equal(u.sheet, 'Review Queue');
  assert.equal(u.values['Syndicated copies'], 1);
});

test('the same url arriving from another route merges into a review row too', async () => {
  const w = await world();
  processBatch(w.deps(only(w, 'ga')));
  w.add('fw2', 'Monitoring/Team Forward', { plainBody: 'https://media.unisba.ac.id/e7cc6231/04877eceNy8XOVQbNB1bNCs' });
  processBatch(w.deps(only(w, 'fw2')));
  assert.equal(w.reviewRows.length, 1);
  const u = w.updates.find((x) => x.values['Source route'] !== undefined);
  assert.equal(u.sheet, 'Review Queue');
  assert.equal(u.values['Source route'], 'Google Alerts, Team forward');
});

test('short headlines are never treated as copies of each other', async () => {
  const w = await world();
  const TITLE = 'Why Venture Capital Money Isn&#39;t Right For Every Founder';
  copyOf(w, 'a1', TITLE, 'Founder funding');
  processBatch(w.deps(only(w, 'a1')));
  copyOf(w, 'a2', TITLE, 'Founder funding');
  w.messages.a2.htmlBody = w.messages.a2.htmlBody.replaceAll(FORBES, 'https://other.example.com/copy');
  processBatch(w.deps(only(w, 'a2')));
  assert.equal(w.coverage.length, 3, 'forbes, campus.sg, and the second short-titled item as its own row');
  assert.equal(w.updates.filter((x) => x.values['Syndicated copies'] !== undefined).length, 0);
});

test('items without a url are never merged', async () => {
  const w = await world();
  w.messages.shot2 = { ...w.messages.shot, id: 'shot2' }; w.labels.shot2 = 'Monitoring/Team Forward';
  processBatch(w.deps(only(w, 'shot', 'shot2')));
  assert.equal(w.coverage.length, 2);
  assert.equal(w.coverage[0]['Normalised URL'], '');
});

const tweak = (w, id, subject, from, to) => {
  const base = w.messages.tw;
  w.messages[id] = { ...base, id, subject, htmlBody: base.htmlBody.replaceAll(from, to) };
  w.labels[id] = 'Monitoring/Automated';
};

test('an alert result that matches no monitored entity is skipped and recorded, never silently dropped', async () => {
  const w = await world();
  tweak(w, 'tw3', '[Talkwalker Alerts] Alert for Acme', 'Sedifly', 'Acme');
  w.messages.tw3.htmlBody = w.messages.tw3.htmlBody.replaceAll('Joash Lee', 'Someone Else');
  const s = processBatch(w.deps(only(w, 'tw3')));
  assert.equal(w.coverage.length, 0);
  assert.equal(w.reviewRows.length, 0);
  assert.equal(s.skippedNoEntity, 2);
  assert.equal(s.newRows, 0);
  assert.ok(w.processed.includes('tw3'), 'the message is done, with the reason in the Run Log');
  const d = s.details[0];
  assert.equal(d.skipped.length, 2);
  assert.match(d.skipped[0].url, /^https:\/\//);
  assert.match(d.skipped[0].reason, /no monitored entity/i);
});

test('a team forward with no entity match is logged anyway, because forwards are never skipped', async () => {
  const w = await world();
  w.add('fw2', 'Monitoring/Team Forward', { plainBody: 'https://example.com/unrelated-story' });
  const s = processBatch(w.deps(only(w, 'fw2')));
  assert.equal(w.coverage.length, 1);
  assert.equal(s.skippedNoEntity, 0);
});

test('an ambiguous name goes to the Review Queue with the candidate filled in', async () => {
  const w = await world();
  const s = processBatch(w.deps(only(w, 'ga')));
  assert.equal(w.coverage.length, 0);
  assert.equal(w.reviewRows.length, 1);
  const row = w.reviewRows[0];
  assert.equal(row['Review reason'], 'Ambiguous entity match');
  assert.equal(row.Entity, 'Joash Lee');
  assert.equal(row['Coverage ID'], undefined);
  assert.equal(row['Normalised URL'], 'https://media.unisba.ac.id/e7cc6231/04877eceNy8XOVQbNB1bNCs');
  assert.equal(s.toReview, 1);
  assert.ok(w.processed.includes('ga'));
});

test('an ambiguous name in a team forward also goes to review', async () => {
  const w = await world();
  w.add('fw2', 'Monitoring/Team Forward', { plainBody: 'Check this out\nhttps://example.com/x', subject: 's' });
  w.messages.fw2.plainBody = 'Shaun Chew is mentioned here https://example.com/x';
  processBatch(w.deps(only(w, 'fw2')));
  assert.equal(w.reviewRows.length, 1);
  assert.equal(w.reviewRows[0].Entity, 'Shaun Chew');
});

test('the alert name rescues a result whose snippet lacks the name: review, not skip', async () => {
  const w = await world();
  tweak(w, 'tw4', '[Talkwalker Alerts] Alert for Sedifly', 'Sedifly', 'Acme');
  w.messages.tw4.htmlBody = w.messages.tw4.htmlBody.replaceAll('Joash Lee', 'Someone Else');
  const s = processBatch(w.deps(only(w, 'tw4')));
  assert.equal(s.skippedNoEntity, 0);
  assert.equal(w.reviewRows.length, 2);
  assert.equal(w.reviewRows[0]['Review reason'], 'Ambiguous entity match');
  assert.equal(w.reviewRows[0].Entity, 'Sedifly');
});

test('several ambiguous candidates leave the Entity for the reviewer to choose', async () => {
  const w = await world();
  w.add('fw2', 'Monitoring/Team Forward', { plainBody: 'Shaun Chew and Wesley Tan https://example.com/two-people' });
  processBatch(w.deps(only(w, 'fw2')));
  assert.equal(w.reviewRows.length, 1);
  assert.equal(w.reviewRows[0].Entity, undefined);
});

test('processing is refused if no monitored entities were loaded', async () => {
  const w = await world();
  assert.throws(() => processBatch(w.deps({ entities: [] })), /monitored entities/i);
});

test('two comments on the same Reddit thread are two items, never merged as syndicated copies', async () => {
  const w = await world();
  const msg = await emlToMessage(`${dir}f5bot_alert_green_tea.eml`, 'f5');
  w.messages.f5 = { ...msg, htmlBody: msg.htmlBody.replaceAll('green tea', 'Sedifly').replaceAll('Green tea', 'Sedifly').replaceAll('Green Tea', 'Sedifly') };
  w.labels.f5 = 'Monitoring/Automated';
  const s = processBatch(w.deps(only(w, 'f5')));
  assert.equal(s.itemsParsed, 11);
  assert.equal(w.coverage.length, 11, 'all eleven mentions are kept, including both comments titled "Lifelong water drinker"');
  assert.equal(w.updates.filter((u) => u.values['Syndicated copies'] !== undefined).length, 0);
  assert.deepEqual(w.coverage.map((r) => r.Channel), Array(11).fill('Reddit'));
  assert.deepEqual(w.coverage.map((r) => r['Source type']), Array(11).fill('Social Media'));
});

// ---- classification (M3) ----
import { loadRules, activeRules } from '../src/core/rules.js';
const rules = activeRules(loadRules(parseCsv(readFileSync(new URL('../fixtures/config/rules.csv', import.meta.url), 'utf8'))));
const answer = (over = {}) => ({
  is_relevant: true, entity: 'Sedifly', channel: 'News', source_type: 'Media', outlet: 'Forbes', title: 'Some headline of many words',
  published_date: '2026-10-13', category: 'Brand', priority: 'Standard', sentiment: 'Positive', matched_rule_ids: ['MR-006'],
  critical_signal: false, summary: 'Summary.', confidence: 0.9, reasoning: 'Because.', ...over,
});
function classifier(replyFor) {
  const fails = new Map(); const calls = [];
  return {
    calls, fails,
    ctx: {
      model: 'claude-haiku-4-5', threshold: 0.7, today: '2026-10-25', entities, rules,
      call: (req) => { calls.push(req); return replyFor(calls.length); },
      fetchPageText: () => null,
      failures: { count: (id) => fails.get(id) || 0, add: (id) => { fails.set(id, (fails.get(id) || 0) + 1); return fails.get(id); }, clear: (id) => { fails.delete(id); } },
    },
  };
}

test('with a classifier, rows carry category, priority, rules and verification', async () => {
  const w = await world();
  const k = classifier(() => ({ kind: 'tool', input: answer() }));
  const s = processBatch(w.deps({ ...only(w, 'tw'), classifier: k.ctx }));
  assert.equal(s.status, 'OK');
  assert.ok(s.classified >= 1);
  const row = w.coverage[0];
  assert.equal(row.Category, 'Brand');
  assert.equal(row.Priority, 'Standard');
  assert.equal(row['Rules matched'], 'MR-006');
  assert.equal(row.Verification, 'Verified');
  assert.equal(row['Classifier confidence'], 0.9);
});

test('low confidence goes to the Review Queue with the model values filled in', async () => {
  const w = await world();
  const k = classifier(() => ({ kind: 'tool', input: answer({ confidence: 0.4 }) }));
  const s = processBatch(w.deps({ ...only(w, 'tw'), classifier: k.ctx }));
  assert.equal(w.coverage.length, 0);
  assert.equal(w.reviewRows.length, s.toReview);
  assert.equal(w.reviewRows[0]['Review reason'], 'Low confidence');
  assert.equal(w.reviewRows[0].Category, 'Brand');
  assert.equal(w.reviewRows[0].Verification, 'Needs verification');
  assert.deepEqual(w.processed, ['tw']);
});

test('an API failure leaves the message unlabelled until the third failed run, then reviews it', async () => {
  const w = await world();
  const k = classifier(() => ({ kind: 'retry', status: 529 }));
  let s = processBatch(w.deps({ ...only(w, 'tw'), classifier: k.ctx }));
  assert.equal(s.deferred, 1);
  assert.equal(s.status, 'FAILED');
  assert.deepEqual(w.processed, []);
  assert.equal(s.details[0].outcome, 'deferred');
  s = processBatch(w.deps({ ...only(w, 'tw'), classifier: k.ctx }));
  assert.equal(s.deferred, 1);
  s = processBatch(w.deps({ ...only(w, 'tw'), classifier: k.ctx }));
  assert.equal(s.deferred, 0);
  assert.equal(w.reviewRows.at(-1)['Review reason'], 'Classifier unavailable');
  assert.deepEqual(w.processed, ['tw']);
});

test('the time budget stops classification and defers the message', async () => {
  const w = await world();
  const k = classifier(() => ({ kind: 'tool', input: answer() }));
  let calls = 0;
  const s = processBatch(w.deps({ ...only(w, 'tw'), classifier: k.ctx, shouldStop: () => ++calls > 1 }));
  assert.equal(s.deferred, 1);
  assert.equal(k.calls.length, 0);
});

test('a classified alert that is not about a monitored entity is skipped and logged, not written', async () => {
  const w = await world();
  const k = classifier(() => ({ kind: 'tool', input: answer({ is_relevant: false, entity: null, category: 'General', priority: 'Low', matched_rule_ids: [], confidence: 0.95 }) }));
  const s = processBatch(w.deps({ ...only(w, 'tw'), classifier: k.ctx }));
  assert.equal(w.coverage.length, 0);
  assert.ok(s.skippedNoEntity >= 1);
  assert.match(JSON.stringify(s.details), /not about a monitored entity/);
});
