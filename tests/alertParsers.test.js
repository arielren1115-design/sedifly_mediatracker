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

// ---- the "as-it-happens" layout: no microdata, results found by their google.com/url links ----
test('Google Alerts as-it-happens layout: the result is found by its link, with outlet and snippet', async () => {
  const msg = await emlToMessage(`${dir}google_alert_joash_lee_as_it_happens.eml`, 'fx-ga2');
  assert.deepEqual(parseGoogle(msg), expected('google_alert_joash_lee_as_it_happens'));
});

test('as-it-happens layout: the share, feedback, unsubscribe and see more links are never results', async () => {
  const msg = await emlToMessage(`${dir}google_alert_joash_lee_as_it_happens.eml`, 'fx-ga2');
  const items = parseGoogle(msg);
  assert.equal(items.length, 1);
  assert.ok(items.every((i) => !/google\.com/.test(i.url)));
});

test('as-it-happens layout: several results in one email stay separate and in order, each with its own outlet and snippet', async () => {
  const msg = await emlToMessage(`${dir}google_alert_joash_lee_as_it_happens.eml`, 'fx-ga2');
  const html = msg.htmlBody;
  const start = html.indexOf('<div>  <span style="padding:0px 6px 0px 0px">');
  const end = html.indexOf('</td> <td style="padding-right:18px">', start);
  assert.ok(start > 0 && end > start, 'fixture markers found');
  const block = html.slice(start, end);
  const second = block.replace(/theelitex\.com/g, 'example.org').replace('<span>EliteX</span> </a>', '<span>Other Outlet</span> </a>').replace(/Founder and CEO/g, 'Speaker');
  const items = parseGoogle({ ...msg, htmlBody: html.slice(0, end) + second + html.slice(end) });
  assert.deepEqual(items.map((i) => i.outlet), ['EliteX', 'Other Outlet']);
  assert.ok(items[1].url.startsWith('https://example.org/'));
  assert.match(items[1].snippet, /Speaker/);
  assert.match(items[0].snippet, /Founder and CEO/);
});

test('as-it-happens layout: a result with no outlet does not borrow the next result outlet', async () => {
  const msg = await emlToMessage(`${dir}google_alert_joash_lee_as_it_happens.eml`, 'fx-ga2');
  const html = msg.htmlBody;
  const start = html.indexOf('<div>  <span style="padding:0px 6px 0px 0px">');
  const end = html.indexOf('</td> <td style="padding-right:18px">', start);
  const block = html.slice(start, end);
  const noOutlet = block.replace(/theelitex\.com/g, 'first.example.org').replace(/<a style="text-decoration:none;color:#737373"> <span>EliteX<\/span> <\/a>/, '');
  const items = parseGoogle({ ...msg, htmlBody: html.slice(0, start) + noOutlet + block + html.slice(end) });
  assert.deepEqual(items.map((i) => i.outlet), [null, 'EliteX']);
});

test('when the HTML cannot be read, the plain text part still yields the results', async () => {
  const msg = await emlToMessage(`${dir}google_alert_joash_lee_as_it_happens.eml`, 'fx-ga2');
  const items = parseGoogle({ ...msg, htmlBody: '<p>nothing readable</p>' });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://theelitex.com/joash-lee-building-a-more-accessible-future-in-education/');
  assert.equal(items[0].outlet, null);
});

test('Google Alerts digest layout (microdata) is unchanged', async () => {
  const msg = await emlToMessage(`${dir}google_alert_joash_lee.eml`, 'fx-ga');
  assert.equal(parseGoogle(msg).length, 1);
  assert.equal(parseGoogle(msg)[0].outlet, 'Unisba Media');
});
