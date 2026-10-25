import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/core/csv.js';
import { loadEntities, parseQuery, matchesQuery, matchEntities, isMonitored } from '../src/core/entities.js';

const csv = readFileSync(new URL('../fixtures/config/entities.csv', import.meta.url), 'utf8');
const entities = loadEntities(parseCsv(csv));
const names = (text, opts) => matchEntities(entities, text, opts).map((e) => e.id);

test('csv parser handles quotes, doubled quotes, commas, newlines and a byte order mark', () => {
  assert.deepEqual(parseCsv('﻿a,"b,c","say ""hi""",d\r\n1,2,3,4\n'), [['a', 'b,c', 'say "hi"', 'd'], ['1', '2', '3', '4']]);
  assert.deepEqual(parseCsv('a,"line1\nline2"\nz'), [['a', 'line1\nline2'], ['z']]);
  assert.deepEqual(parseCsv(''), []);
});

test('the real entities file loads, skipping the title row', () => {
  assert.equal(entities.length, 26);
  const joash = entities.find((e) => e.id === 'FO-001');
  assert.equal(joash.name, 'Joash Lee');
  assert.equal(joash.type, 'Founder');
  assert.equal(joash.primaryTerm, '"Joash Lee"');
  assert.deepEqual(joash.aliases, ['Joash Lee Sedifly', 'Joash Lee founder', 'Joash Lee CEO']);
  assert.equal(joash.status, 'Active');
  assert.equal(entities.find((e) => e.id === 'EVT-001').endDate, '30 Sep 2026');
});

test('a file without the expected headers is rejected loudly', () => {
  assert.throws(() => loadEntities([['a', 'b'], ['1', '2']]), /Entity ID/);
});

test('search query parsing: quoted phrases and loose words', () => {
  assert.deepEqual(parseQuery('"George Baxter" Sedifly'), { phrases: ['george baxter'], words: ['sedifly'] });
  assert.deepEqual(parseQuery('"Joash Lee"'), { phrases: ['joash lee'], words: [] });
  assert.deepEqual(parseQuery('WhereWeBegin Sedifly'), { phrases: [], words: ['wherewebegin', 'sedifly'] });
  assert.deepEqual(parseQuery('"Capital & Scale Summit 2026" Sedifly'), { phrases: ['capital & scale summit 2026'], words: ['sedifly'] });
});

test('every part of a query must be present, as whole words, ignoring case', () => {
  const q = parseQuery('"George Baxter" Sedifly');
  assert.equal(matchesQuery('George Baxter joins SEDIFLY as head of US consulting', q), true);
  assert.equal(matchesQuery('George Baxter spoke at Harvard', q), false);
  assert.equal(matchesQuery('Sedifly hired a new head', q), false);
  assert.equal(matchesQuery('George  Baxter,\nSedifly', q), true, 'extra spaces and punctuation are fine');
  assert.equal(matchesQuery('Georgia Baxters of Sedifly', q), false, 'whole words only');
  assert.equal(matchesQuery('', q), false);
  assert.equal(matchesQuery('anything', { phrases: [], words: [] }), false, 'an empty query matches nothing');
});

test('brand: any mention of Sedifly matches, and so does a listed alias', () => {
  assert.deepEqual(names('Sedifly opens a new office'), ['BR-001']);
  assert.deepEqual(names('Visit sedifly.com today'), ['BR-001'], 'alias Sedifly.com');
  assert.deepEqual(names('Sedifly-style essays'), ['BR-001'], 'a hyphen is a word boundary');
  assert.deepEqual(names('Unrelated education news'), []);
});

test('founder and strategists', () => {
  assert.deepEqual(names('Joash Lee, founder of Sedifly, spoke').sort(), ['BR-001', 'FO-001']);
  assert.deepEqual(names('Baifern Boonduongprasert won an award'), ['STR-003'], 'a name only term is enough');
  assert.deepEqual(names('Shaun Chew, a strategist at Sedifly').sort(), ['BR-001', 'STR-016']);
  assert.deepEqual(names('Shaun Chew played football on Saturday'), [], 'a strategist name without Sedifly or an alias does not match');
  assert.deepEqual(names('Shaun Chew LSE graduate profile'), ['STR-016'], 'the alias with the university matches');
});

test('partners and events', () => {
  assert.deepEqual(names('WWB Sedifly workshop recap').sort(), ['BR-001', 'PAR-001']);
  assert.deepEqual(names('The Internship Guy webinar with TIG Sedifly').sort(), ['BR-001', 'PAR-002']);
});

test('monitoring status: Active always, Recent watch until the end date when asked to', () => {
  const evt = entities.find((e) => e.id === 'EVT-001');
  const active = entities.find((e) => e.id === 'BR-001');
  assert.equal(isMonitored(active, new Date('2026-10-25')), true);
  assert.equal(isMonitored(evt, new Date('2026-10-25')), true, 'default: keep watching');
  assert.equal(isMonitored(evt, new Date('2026-10-25'), { honourEndDates: true }), false);
  assert.equal(isMonitored(evt, new Date('2026-09-20'), { honourEndDates: true }), true);
  assert.equal(isMonitored({ ...active, status: 'Paused' }, new Date('2026-10-25')), false);
  assert.equal(isMonitored({ ...evt, endDate: 'Ongoing' }, new Date('2026-10-25'), { honourEndDates: true }), true);
});

test('inactive entities are not matched', () => {
  const list = entities.map((e) => (e.id === 'BR-001' ? { ...e, status: 'Paused' } : e));
  assert.deepEqual(matchEntities(list, 'Sedifly opens a new office'), []);
});
