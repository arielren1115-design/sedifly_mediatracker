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

const strengths = (text, opts) => Object.fromEntries(matchEntities(entities, text, opts).map((m) => [m.entity.id, m.strength]));

test('brand: any mention of Sedifly or a listed alias is a strong match', () => {
  assert.deepEqual(strengths('Sedifly opens a new office'), { 'BR-001': 'strong' });
  assert.deepEqual(strengths('Visit sedifly.com today'), { 'BR-001': 'strong' });
  assert.deepEqual(strengths('Sedifly-style essays'), { 'BR-001': 'strong' }, 'a hyphen is a word boundary');
  assert.deepEqual(strengths('Unrelated education news'), {});
});

test('founder: the bare name is ambiguous, corroboration makes it strong', () => {
  assert.deepEqual(strengths('Video Crew: Joash Lee, Felicia Low and others'), { 'FO-001': 'ambiguous' });
  assert.deepEqual(strengths('Joash Lee, founder of Sedifly, spoke'), { 'BR-001': 'strong', 'FO-001': 'strong' }, 'Sedifly nearby corroborates');
  assert.deepEqual(strengths('Joash Lee CEO addressed the crowd'), { 'FO-001': 'strong' }, 'a listed alias corroborates');
});

test('strategists are found without Sedifly, but a bare name is ambiguous', () => {
  assert.deepEqual(strengths('Shaun Chew, a strategist at Sedifly'), { 'BR-001': 'strong', 'STR-016': 'strong' });
  assert.deepEqual(strengths('Shaun Chew played football on Saturday'), { 'STR-016': 'ambiguous' });
  assert.deepEqual(strengths('Shaun Chew LSE graduate profile'), { 'STR-016': 'strong' }, 'the alias with the university');
  assert.deepEqual(strengths('Baifern Boonduongprasert won an award'), { 'STR-003': 'ambiguous' }, 'even a unique name is verified first');
  assert.deepEqual(strengths('Baifern Boonduongprasert of Sedifly'), { 'BR-001': 'strong', 'STR-003': 'strong' });
});

test('only part of a name is not enough', () => {
  assert.deepEqual(strengths('Shaun is here and Chew gum'), {});
  assert.deepEqual(strengths('George went to see Baxter'), {});
});

test('partners and events are strong matches', () => {
  assert.deepEqual(strengths('WWB Sedifly workshop recap'), { 'BR-001': 'strong', 'PAR-001': 'strong' });
  assert.deepEqual(strengths('The Internship Guy webinar with TIG Sedifly'), { 'BR-001': 'strong', 'PAR-002': 'strong' });
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

test('inactive entities are not matched, and a paused brand cannot corroborate a person', () => {
  const list = entities.map((e) => (e.id === 'BR-001' ? { ...e, status: 'Ended' } : e));
  assert.deepEqual(matchEntities(list, 'Sedifly opens a new office'), []);
  assert.deepEqual(Object.fromEntries(matchEntities(list, 'Joash Lee of Sedifly').map((m) => [m.entity.id, m.strength])), { 'FO-001': 'ambiguous' });
});
