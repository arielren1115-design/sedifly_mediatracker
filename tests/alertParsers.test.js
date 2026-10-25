import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emlToMessage } from './helpers/emlToMessage.js';
import { parse as parseGoogle } from '../src/core/parsers/googleAlerts.js';
import { parse as parseTalkwalker } from '../src/core/parsers/talkwalker.js';
import { unwrapRedirect } from '../src/core/unwrapRedirect.js';
import { decodeEntities, htmlToText } from '../src/core/html.js';

const dir = new URL('../fixtures/emails/', import.meta.url).pathname;
const expected = (name) => JSON.parse(readFileSync(`${dir}${name}.expected.json`, 'utf8'));

test('Google Alerts parses the real alert and unwraps the redirect link', async () => {
  const msg = await emlToMessage(`${dir}google_alert_joash_lee.eml`, 'fx-ga');
  assert.deepEqual(parseGoogle(msg), expected('google_alert_joash_lee'));
});

test('Talkwalker parses every item with outlet and publication date', async () => {
  const msg = await emlToMessage(`${dir}talkwalker_native.eml`, 'fx-tw');
  assert.deepEqual(parseTalkwalker(msg), expected('talkwalker_native'));
});

test('alert parsers return nothing for an email with no items', () => {
  const empty = { id: 'x', from: 'a@b.c', subject: '', date: '2026-10-18T00:00:00.000Z', plainBody: '', htmlBody: '<p>hello</p>', attachments: [] };
  assert.deepEqual(parseGoogle(empty), []);
  assert.deepEqual(parseTalkwalker(empty), []);
});

test('Google Alerts keeps several items in order', async () => {
  const msg = await emlToMessage(`${dir}google_alert_joash_lee.eml`, 'fx-ga');
  const html = msg.htmlBody;
  const start = html.indexOf('itemscope');
  const end = html.indexOf('See more results', start);
  assert.ok(start > 0 && end > start, 'fixture markers found');
  const copy = html.slice(start, end).replace('media.unisba.ac.id', 'example.org').replace('Unisba Media', 'Other Outlet');
  const items = parseGoogle({ ...msg, htmlBody: `${html.slice(0, end)}<tr ${copy}${html.slice(end)}` });
  assert.deepEqual(items.map((i) => i.outlet), ['Unisba Media', 'Other Outlet']);
  assert.ok(items[1].url.startsWith('https://example.org/'));
});

test('unwrapRedirect', () => {
  assert.equal(unwrapRedirect('https://www.google.com/url?rct=j&sa=t&url=https://a.com/x%3Fy%3D1&ct=ga'), 'https://a.com/x?y=1');
  assert.equal(unwrapRedirect('https://www.google.com/url?q=https://b.com/p&sa=U'), 'https://b.com/p');
  assert.equal(unwrapRedirect('https://www.forbes.com/a/'), 'https://www.forbes.com/a/');
  assert.equal(unwrapRedirect('not a url'), 'not a url');
});

test('html helpers', () => {
  assert.equal(decodeEntities('Isn&#39;t &amp; &#x41; &unknown;'), "Isn't & A &unknown;");
  assert.equal(htmlToText('<td>Hello <b>Sedifly</b>,\n\n a&nbsp;firm</td><!-- x -->​'), 'Hello Sedifly, a firm');
});

import { alertNameOf as googleAlertName } from '../src/core/parsers/googleAlerts.js';
import { alertNameOf as talkwalkerAlertName } from '../src/core/parsers/talkwalker.js';

test('the alert name is read from the subject line', () => {
  assert.equal(googleAlertName('Google Alert - Joash Lee'), 'Joash Lee');
  assert.equal(googleAlertName('Fwd: Google Alert - "George Baxter" Sedifly'), '"George Baxter" Sedifly');
  assert.equal(googleAlertName('Something else'), null);
  assert.equal(talkwalkerAlertName('[Talkwalker Alerts] Alert for Sedifly'), 'Sedifly');
  assert.equal(talkwalkerAlertName(''), null);
});
