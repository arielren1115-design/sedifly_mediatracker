import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emlToMessage } from './helpers/emlToMessage.js';
import { parse, isTeamSender } from '../src/core/parsers/teamForward.js';

const dir = new URL('../fixtures/emails/', import.meta.url).pathname;
const expected = (name) => JSON.parse(readFileSync(`${dir}${name}.expected.json`, 'utf8'));

// Fixture name, message id used inside the expected JSON.
const CASES = [
  ['team_forward_link_only', 'fx-link-only'],
  ['team_forward_link_plus_comment', 'fx-link-comment'],
  ['team_forward_multiple_links', 'fx-multi'],
  ['team_forward_screenshot_only', 'fx-screenshot'],
  ['team_forward_of_talkwalker_alert', 'fx-tw-fwd'],
];

for (const [name, id] of CASES) {
  test(`team forward parses ${name}`, async () => {
    const msg = await emlToMessage(`${dir}${name}.eml`, id);
    assert.deepEqual(parse(msg), expected(name));
  });
}

test('no link and no image gives no items (caller labels Monitoring/Review)', async () => {
  const msg = await emlToMessage(`${dir}team_forward_no_url_no_image.eml`, 'fx-none');
  assert.deepEqual(parse(msg), []);
});

test('sender allowlist accepts exact addresses and @domain entries, ignoring case and display names', () => {
  const allow = '@sedifly.com, boss@partner.org';
  assert.equal(isTeamSender('Team Member <Team.Member@Sedifly.com>', allow), true);
  assert.equal(isTeamSender('boss@partner.org', allow), true);
  assert.equal(isTeamSender('Outside Person <outsider@example.com>', allow), false);
  assert.equal(isTeamSender('someone@evil-sedifly.com', allow), false);
  assert.equal(isTeamSender('', allow), false);
  assert.equal(isTeamSender('team.member@sedifly.com', ''), false);
});

test('the non team fixture is rejected by the allowlist', async () => {
  const msg = await emlToMessage(`${dir}team_forward_non_team_sender.eml`, 'fx-outsider');
  assert.equal(isTeamSender(msg.from, '@sedifly.com'), false);
});

test('boilerplate links are skipped: unsubscribe, alert vendor pages, tweet buttons', () => {
  const msg = {
    id: 'x', from: 'team.member@sedifly.com', subject: '', date: '2026-10-18T00:00:00.000Z', htmlBody: '', attachments: [],
    plainBody: 'see https://news.example.com/story?utm_source=x. and <https://alerts.talkwalker.com/alerts/manage>\nhttps://example.com/unsubscribe?id=1 http://twitter.com/intent/tweet?url=abc',
  };
  assert.deepEqual(parse(msg).map((i) => i.url), ['https://news.example.com/story?utm_source=x']);
});
