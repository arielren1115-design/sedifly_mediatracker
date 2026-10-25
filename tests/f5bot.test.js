import test from 'node:test';
import assert from 'node:assert/strict';
import { emlToMessage } from './helpers/emlToMessage.js';
import { parse, parseHitMeta } from '../src/core/parsers/f5bot.js';
import { unwrapRedirect } from '../src/core/unwrapRedirect.js';
import { normalizeUrl } from '../src/core/normalizeUrl.js';
import { selectParser } from '../src/core/ingestRouting.js';

const dir = new URL('../fixtures/emails/', import.meta.url).pathname;
const load = () => emlToMessage(`${dir}f5bot_alert_green_tea.eml`, 'fx-f5');

// Written by hand from the real email: url, title, outlet, kind.
const EXPECTED = [
  ['https://www.reddit.com/r/PeterExplainsTheJoke/comments/1xeomzw/c/19rmk2pelqzk0?context=3', 'What is so special about this drink, Petah?', 'r/PeterExplainsTheJoke', 'comment'],
  ['https://www.reddit.com/r/tea/comments/1xevwel/c/19rmj6vcs3pk5?context=3', 'Lifelong water drinker, want to try tea. Recommendations?', 'r/tea', 'comment'],
  ['https://www.reddit.com/r/tea/comments/1xevwel/c/19rmj5afe5qn9?context=3', 'Lifelong water drinker, want to try tea. Recommendations?', 'r/tea', 'comment'],
  ['https://www.reddit.com/r/desifemfrag/comments/1xaovav/c/19rmk3dbpqnq9?context=3', '28F College professor non ac classroom and department, daily commute 17km to and f...', 'r/desifemfrag', 'comment'],
  ['https://www.reddit.com/r/loseit/comments/1xexhfc/c/19rmjf0rgzgqs?context=3', '★OFFICIAL DAILY★ Sunday Reset, Daily Q&A, Daily SV/NSV October 25, 2026', 'r/loseit', 'comment'],
  ['https://www.reddit.com/r/Millennials/comments/1xer21y/c/19rmjkgerolus?context=3', 'Strawberry daiquiri was my fav', 'r/Millennials', 'comment'],
  ['https://www.reddit.com/r/curlyhair/comments/1xeyc97/advices_for_puffyfrizzy_hair/', 'Advices for puffy/frizzy hair ?', 'r/curlyhair', 'post'],
  ['https://www.reddit.com/r/tea/comments/1xegdmi/c/19rml7n9pwy84?context=3', 'Too Old to Drink?', 'r/tea', 'comment'],
  ['https://www.reddit.com/r/AlignmentChartFills/comments/1xegu35/c/19rmlhmt9ills?context=3', 'What drink tastes terrible and is mainstream?', 'r/AlignmentChartFills', 'comment'],
  ['https://www.reddit.com/r/wowforever/comments/1xewg7m/c/19rmltf7gq1sx?context=3', 'A lot of people struggle to choose the right class', 'r/wowforever', 'comment'],
  ['https://www.reddit.com/r/Nutrition_Healthy/comments/1xdam2n/c/19rm2z0b4fpdx?context=3', 'Drink Green Tea Daily', 'r/Nutrition_Healthy', 'comment'],
];

test('the real F5Bot alert gives one item per mention, with the real Reddit link', async () => {
  const items = parse(await load());
  assert.equal(items.length, 11, 'the advert, footer and notice are not items');
  assert.deepEqual(items.map((i) => [i.url, i.title, i.outlet, i.itemKind]), EXPECTED);
});

test('common fields on every F5Bot item', async () => {
  for (const i of parse(await load())) {
    assert.equal(i.route, 'F5Bot');
    assert.equal(i.gmailMessageId, 'fx-f5');
    assert.equal(i.alertName, 'green tea');
    assert.equal(i.publishedAt, null);
    assert.equal(i.receivedAt, '2026-10-25T11:37:10.000Z');
    assert.equal(i.forwarderEmail, null);
    assert.equal(i.forwarderNote, null);
    assert.equal(i.channelHint, null);
    assert.deepEqual(i.attachments, []);
    assert.ok(i.snippet && !/[<>]/.test(i.snippet), 'the excerpt is plain text');
  }
});

test('excerpts keep the words, drop the highlighting, and keep symbols and emoji', async () => {
  const items = parse(await load());
  assert.equal(items[0].snippet, 'Man.....i miss these so much. The green tea was my go to. But damn the strawberry daiquiri SHEEEEEEEEEESH, PEAAAAK.');
  assert.equal(items[5].snippet, 'The Fallout-themed red apple green tea Arizona is pretty good. It is carbonated, however, which is a little weird.');
  assert.equal(items[8].snippet, 'Mainstream × Terrible Green tea 🤢');
  assert.match(items[6].snippet, /^just press the towel against my hair for a few moments—and then let it air-dry\./);
});

test('a heading that F5Bot escaped twice is shown once (Q&A, not Q&amp;A)', async () => {
  assert.equal(parse(await load())[4].title, '★OFFICIAL DAILY★ Sunday Reset, Daily Q&A, Daily SV/NSV October 25, 2026');
});

test('each keyword section names its own items', async () => {
  const msg = await load();
  const at = msg.htmlBody.indexOf('<p class="f5-hit"', msg.htmlBody.indexOf('<p class="f5-hit"') + 10);
  const heading = '<h2 class="f5-hit-heading" style="x">Keyword: &quot;Sedifly&quot;</h2>';
  const items = parse({ ...msg, htmlBody: msg.htmlBody.slice(0, at) + heading + msg.htmlBody.slice(at) });
  assert.equal(items[0].alertName, 'green tea');
  assert.equal(items[1].alertName, 'Sedifly');
  assert.equal(items[10].alertName, 'Sedifly');
});

test('the F5Bot tips email is not an alert and gives nothing', async () => {
  const tips = await emlToMessage(`${dir}f5bot_tips_not_an_alert.eml`, 'fx-tips');
  assert.deepEqual(parse(tips), []);
});

test('an email with no hits gives nothing', () => {
  assert.deepEqual(parse({ id: 'x', date: '2026-10-25T00:00:00.000Z', subject: 'F5Bot found something: x', htmlBody: '<p>hello</p>' }), []);
  assert.deepEqual(parse({ id: 'x', date: '2026-10-25T00:00:00.000Z', htmlBody: null }), []);
});

test('hit labels: source, kind and outlet', () => {
  assert.deepEqual(parseHitMeta('Reddit Comments (/r/tea/):'), { kind: 'comment', outlet: 'r/tea' });
  assert.deepEqual(parseHitMeta('Reddit Posts (/r/curlyhair/):'), { kind: 'post', outlet: 'r/curlyhair' });
  assert.deepEqual(parseHitMeta('Hacker News Stories:'), { kind: 'post', outlet: 'Hacker News' });
  assert.deepEqual(parseHitMeta('Hacker News Comments:'), { kind: 'comment', outlet: 'Hacker News' });
  assert.deepEqual(parseHitMeta('Something new (x):'), { kind: null, outlet: 'x' });
  assert.deepEqual(parseHitMeta(''), { kind: null, outlet: null });
});

test('the F5Bot redirect is unwrapped, and its advert link is left alone', () => {
  const wrapped = 'https://f5bot.com/url?u=https%3A%2F%2Fwww.reddit.com%2Fr%2Ftea%2Fcomments%2F1xevwel%2Fc%2F19rmj6vcs3pk5%3Fcontext%3D3&i=94484464&h=8f083a70';
  assert.equal(unwrapRedirect(wrapped), 'https://www.reddit.com/r/tea/comments/1xevwel/c/19rmj6vcs3pk5?context=3');
  const ad = 'https://f5bot.com/url?a=1&i=68&h=aaf65b36';
  assert.equal(unwrapRedirect(ad), ad);
});

test('a Reddit comment link from F5Bot normalises to the comment, so the same comment is never logged twice', () => {
  assert.equal(normalizeUrl('https://www.reddit.com/r/tea/comments/1xevwel/c/19rmj6vcs3pk5?context=3'), 'https://reddit.com/r/tea/comments/1xevwel/19rmj6vcs3pk5');
  assert.equal(normalizeUrl('https://f5bot.com/url?u=https%3A%2F%2Fwww.reddit.com%2Fr%2Ftea%2Fcomments%2F1xevwel%2Fc%2F19rmj6vcs3pk5%3Fcontext%3D3&i=1&h=2'), 'https://reddit.com/r/tea/comments/1xevwel/19rmj6vcs3pk5');
});

test('alerts@f5bot.com selects the F5Bot parser, and the tips sender does not', () => {
  const m = (from) => ({ from, id: 'x' });
  assert.equal(typeof selectParser(m('F5Bot Alerts <alerts@f5bot.com>'), 'Monitoring/Automated', '@sedifly.com').parse, 'function');
  assert.match(selectParser(m('F5Bot <hello@a.f5bot.com>'), 'Monitoring/Automated', '@sedifly.com').reviewReason, /unknown alert sender/i);
});
