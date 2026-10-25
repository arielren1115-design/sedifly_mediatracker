import test from 'node:test';
import assert from 'node:assert/strict';
import { toCoverageRow, formatCoverageId, itemKey } from '../src/core/coverageRow.js';
import { COVERAGE_HEADERS } from '../src/core/schema.js';

const now = new Date('2026-10-18T10:00:00.000Z');
const item = { gmailMessageId: 'm1', route: 'Google Alerts', url: 'https://a.com/x', title: 'T', snippet: 'S'.repeat(600), outlet: 'O', publishedAt: '2026-10-13', channelHint: null, forwarderNote: null };

test('coverage ids are zero padded and permanent in format', () => {
  assert.equal(formatCoverageId(1), 'COV-000001');
  assert.equal(formatCoverageId(1234567), 'COV-1234567');
});

test('row uses only real headers, fills provisional fields, and trims the excerpt', () => {
  const row = toCoverageRow(item, { coverageId: 'COV-000007', now, normalisedUrl: 'https://a.com/x' });
  for (const k of Object.keys(row)) assert.ok(COVERAGE_HEADERS.includes(k), `unknown header ${k}`);
  assert.equal(row['Coverage ID'], 'COV-000007');
  assert.equal(row.URL, 'https://a.com/x');
  assert.equal(row['Normalised URL'], 'https://a.com/x');
  assert.equal(row.Excerpt.length, 500);
  assert.equal(row['Source route'], 'Google Alerts');
  assert.equal(row['Found in'], 'Tool');
  assert.equal(row.Verification, 'Needs verification');
  assert.equal(row['Archive status'], 'Pending');
  assert.equal(row['Logged by'], 'script');
  assert.equal(row['Gmail message ID'], 'm1');
  assert.equal(row['Published at'], '2026-10-13');
  assert.equal(row.Entity, undefined, 'entity, category and priority are left for later milestones');
});

test('screenshot-only forward keeps the Social hint and uses the note as excerpt', () => {
  const row = toCoverageRow({ ...item, url: null, snippet: null, forwarderNote: 'see this', channelHint: 'Social' }, { coverageId: 'COV-000008', now });
  assert.equal(row.Channel, 'Social');
  assert.equal(row['Source type'], 'Social Media');
  assert.equal(row.Excerpt, 'see this');
  assert.equal(row.URL, '');
});

test('item key is message plus url, with a stable key for items without a url', () => {
  assert.equal(itemKey(item), 'm1||https://a.com/x');
  assert.equal(itemKey({ gmailMessageId: 'm2', url: null }), 'm2||');
});

test('the link decides channel and source type for social links, and leaves other links to the classifier', () => {
  const at = (url) => toCoverageRow({ ...item, url, channelHint: null }, { coverageId: 'COV-000009', now });
  assert.equal(at('https://www.reddit.com/r/tea/comments/1/c/2').Channel, 'Reddit');
  assert.equal(at('https://news.ycombinator.com/item?id=1').Channel, 'Hacker News');
  assert.equal(at('https://www.linkedin.com/posts/x')['Source type'], 'Social Media');
  assert.equal(at('https://www.forbes.com/a').Channel, '');
  assert.equal(at('https://www.forbes.com/a')['Source type'], undefined);
});
