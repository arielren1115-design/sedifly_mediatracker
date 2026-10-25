import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, mergeList, createIndex } from '../src/core/dedupe.js';

const DAY = 24 * 3600 * 1000;
const now = Date.parse('2026-10-18T10:00:00.000Z');
const row = (over) => ({ sheet: 'Coverage', rowNumber: 2, coverageId: 'COV-000001', url: 'https://www.forbes.com/a/b/', normalisedUrl: '', title: 'Why Venture Capital Is Hard', detectedAt: new Date(now - DAY), sourceRoute: 'Talkwalker', foundIn: 'Tool', gmailMessageId: 'm1', ...over });

test('titles compare ignoring case, punctuation and spacing', () => {
  assert.equal(normalizeTitle("Why Venture Capital Money Isn't Right!"), normalizeTitle('  why venture capital money isn’t right '));
  assert.equal(normalizeTitle('A | B: C'), 'a b c');
  assert.equal(normalizeTitle(null), '');
});

test('mergeList appends only what is missing and keeps the original text when nothing changes', () => {
  assert.equal(mergeList('Talkwalker', 'Google Alerts'), 'Talkwalker, Google Alerts');
  assert.equal(mergeList('Talkwalker, Google Alerts', 'Talkwalker'), 'Talkwalker, Google Alerts');
  assert.equal(mergeList('', 'Tool'), 'Tool');
  assert.equal(mergeList('Old', 'Tool'), 'Old, Tool');
  assert.equal(mergeList('Old,Tool', 'Tool'), 'Old,Tool');
});

test('the index finds an item by normalised url, computing it from the url when the column is blank', () => {
  const idx = createIndex([row()]);
  assert.equal(idx.findByUrl('https://forbes.com/a/b').coverageId, 'COV-000001');
  assert.equal(idx.findByUrl('https://forbes.com/other'), null);
});

test('the index remembers message plus url keys', () => {
  const idx = createIndex([row()]);
  assert.equal(idx.hasKey('m1||https://www.forbes.com/a/b/'), true);
  assert.equal(idx.hasKey('m2||https://www.forbes.com/a/b/'), false);
});

test('the first entry for a url wins, so Coverage rows read first beat Review Queue rows', () => {
  const idx = createIndex([row(), row({ sheet: 'Review Queue', coverageId: '', rowNumber: 9 })]);
  assert.equal(idx.findByUrl('https://forbes.com/a/b').sheet, 'Coverage');
});

test('similar title: same title, different url, within 7 days', () => {
  const idx = createIndex([row()]);
  assert.equal(idx.similarTitle('why venture capital is hard!', 'https://other.com/x', now).coverageId, 'COV-000001');
  assert.equal(idx.similarTitle('Why Venture Capital Is Hard', 'https://forbes.com/a/b', now), null, 'same url is not a title match');
  assert.equal(idx.similarTitle('A different title', 'https://other.com/x', now), null);
});

test('similar title ignores rows older than 7 days or with no usable date', () => {
  const old = createIndex([row({ detectedAt: new Date(now - 8 * DAY) })]);
  assert.equal(old.similarTitle('Why Venture Capital Is Hard', 'https://other.com/x', now), null);
  const edge = createIndex([row({ detectedAt: new Date(now - 7 * DAY) })]);
  assert.ok(edge.similarTitle('Why Venture Capital Is Hard', 'https://other.com/x', now));
  const blank = createIndex([row({ detectedAt: '' })]);
  assert.equal(blank.similarTitle('Why Venture Capital Is Hard', 'https://other.com/x', now), null);
});

test('short headlines are never similar, so generic titles cannot be lumped together', () => {
  const idx = createIndex([row({ title: 'Joash Lee interview' })]);
  assert.equal(idx.similarTitle('Joash Lee interview', 'https://other.com/x', now), null);
  const five = createIndex([row({ title: 'one two three four five' })]);
  assert.ok(five.similarTitle('One two three four five', 'https://other.com/x', now));
});

test('copy counts start at the stored value and can be raised', () => {
  const idx = createIndex([row({ syndicatedCopies: 3 })]);
  const e = idx.findByUrl('https://forbes.com/a/b');
  assert.equal(e.syndicatedCopies, 3);
  idx.setCopies(e, 4);
  assert.equal(idx.findByUrl('https://forbes.com/a/b').syndicatedCopies, 4);
  assert.equal(createIndex([row()]).findByUrl('https://forbes.com/a/b').syndicatedCopies, 0, 'a blank cell counts as zero');
});

test('rows without a title or url never match', () => {
  const idx = createIndex([row({ title: '', url: '' })]);
  assert.equal(idx.similarTitle('', 'https://x.com/a', now), null);
  assert.equal(idx.findByUrl('https://forbes.com/a/b'), null);
});

test('adding and updating entries is visible to later lookups', () => {
  const idx = createIndex([]);
  const e = idx.add(row());
  idx.setRoutes(e, 'Talkwalker, Team forward', 'Tool');
  assert.equal(idx.findByUrl('https://forbes.com/a/b').sourceRoute, 'Talkwalker, Team forward');
  idx.addKey('m9||u');
  assert.equal(idx.hasKey('m9||u'), true);
});
