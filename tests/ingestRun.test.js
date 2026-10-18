import test from 'node:test';
import assert from 'node:assert/strict';
import { emlToMessage } from './helpers/emlToMessage.js';
import { processBatch } from '../src/core/ingestRun.js';

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
  const w = { messages, labels, processed: [], reviewed: [], rows: [], keys: new Set(), next: 1, failMarkOnce: null };
  w.deps = (over = {}) => ({
    candidates: Object.keys(messages).filter((id) => !w.processed.includes(id) && !w.reviewed.some((r) => r[0] === id)).map((id) => ({ id, sourceLabel: labels[id] })),
    getMessage: (id) => messages[id],
    existingKeys: w.keys,
    allocateIds: (n) => Array.from({ length: n }, () => `COV-${String(w.next++).padStart(6, '0')}`),
    appendRows: (rows) => { w.rows.push(...rows); },
    markProcessed: (id) => { if (w.failMarkOnce === id) { w.failMarkOnce = null; throw new Error('gmail down'); } w.processed.push(id); },
    markReview: (id, label, reason) => { w.reviewed.push([id, reason]); },
    shouldStop: () => false,
    now: () => new Date('2026-10-18T10:00:00.000Z'),
    allowlist: '@sedifly.com',
    ...over,
  });
  return w;
}

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
  assert.equal(w.rows.length, 7);
  assert.equal(new Set(w.rows.map((r) => r['Coverage ID'])).size, 7);
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
  assert.equal(w.rows.length, 7);
});

test('crash after writing rows but before labelling: retry makes no duplicates', async () => {
  const w = await world();
  w.failMarkOnce = 'tw';
  const first = processBatch(w.deps());
  assert.equal(first.errors, 1);
  assert.equal(first.status, 'PARTIAL');
  const rowsAfterFirst = w.rows.length;
  const second = processBatch(w.deps());
  assert.equal(second.messagesSeen, 1);
  assert.equal(second.newRows, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(w.rows.length, rowsAfterFirst);
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
