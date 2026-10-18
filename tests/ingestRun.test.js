import test from 'node:test';
import assert from 'node:assert/strict';
import { emlToMessage } from './helpers/emlToMessage.js';
import { processBatch } from '../src/core/ingestRun.js';
import { createIndex } from '../src/core/dedupe.js';

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
    allocateIds: (n) => Array.from({ length: n }, () => `COV-${String(w.next++).padStart(6, '0')}`),
    appendCoverageRow: (row) => { w.coverage.push(row); return w.coverage.length + 1; },
    appendReviewRow: (row) => { w.reviewRows.push(row); return w.reviewRows.length + 1; },
    updateExisting: (entry, values) => { w.updates.push({ id: entry.coverageId, values }); },
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
  assert.equal(s.newRows, 7);
  assert.equal(s.toReview, 3);
  assert.equal(s.errors, 0);
  assert.equal(s.status, 'OK');
  assert.deepEqual(w.processed.sort(), ['fwd', 'ga', 'shot', 'tw']);
  assert.deepEqual(w.reviewed.map((r) => r[0]).sort(), ['empty', 'outsider', 'unknown']);
  assert.equal(w.coverage.length, 7);
  assert.equal(new Set(w.coverage.map((r) => r['Coverage ID'])).size, 7);
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
  assert.equal(w.coverage.length, 7);
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
  assert.deepEqual(w.updates, [{ id: 'COV-000001', values: { 'Source route': 'Talkwalker, Team forward', 'Found in': 'Tool', 'Last updated': new Date('2026-10-18T10:00:00.000Z') } }]);
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

test('same title from a different url within 7 days goes to the Review Queue as a possible duplicate', async () => {
  const w = await world();
  processBatch(w.deps(only(w, 'tw')));
  w.messages.tw2 = { ...w.messages.tw, id: 'tw2', htmlBody: w.messages.tw.htmlBody.replace(FORBES, 'https://syndicated.example.com/copy') };
  w.labels.tw2 = 'Monitoring/Automated';
  const s = processBatch(w.deps(only(w, 'tw2')));
  assert.equal(w.reviewRows.length, 1);
  assert.equal(w.reviewRows[0]['Review reason'], 'Possible duplicate');
  assert.equal(w.reviewRows[0]['Coverage ID'], undefined, 'no Coverage ID until a human approves');
  assert.equal(w.reviewRows[0].URL, 'https://syndicated.example.com/copy');
  assert.equal(w.coverage.length, 2, 'no new Coverage row');
  assert.equal(s.toReview, 1);
  assert.equal(s.duplicates, 1, 'the campus.sg item is a plain duplicate');
  assert.ok(w.processed.includes('tw2'));
});

test('a later item with the same url as a review row merges into that review row', async () => {
  const w = await world();
  processBatch(w.deps(only(w, 'tw')));
  w.messages.tw2 = { ...w.messages.tw, id: 'tw2', htmlBody: w.messages.tw.htmlBody.replace(FORBES, 'https://syndicated.example.com/copy') };
  w.labels.tw2 = 'Monitoring/Automated';
  processBatch(w.deps(only(w, 'tw2')));
  w.add('fw2', 'Monitoring/Team Forward', { plainBody: 'https://syndicated.example.com/copy' });
  processBatch(w.deps(only(w, 'fw2')));
  assert.equal(w.reviewRows.length, 1);
  assert.equal(w.updates.length, 1);
});

test('items without a url are never merged', async () => {
  const w = await world();
  w.messages.shot2 = { ...w.messages.shot, id: 'shot2' }; w.labels.shot2 = 'Monitoring/Team Forward';
  processBatch(w.deps(only(w, 'shot', 'shot2')));
  assert.equal(w.coverage.length, 2);
  assert.equal(w.coverage[0]['Normalised URL'], '');
});
