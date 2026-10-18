import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeUrl } from '../src/core/normalizeUrl.js';

const table = JSON.parse(readFileSync(new URL('../fixtures/urls/cases.json', import.meta.url), 'utf8'));

test('the table has at least 25 cases', () => {
  assert.ok(table.cases.length >= 25);
});

for (const c of table.cases) {
  test(`normalise: ${c.name}`, () => {
    assert.equal(normalizeUrl(c.input), c.expected);
  });
}

for (const c of table.invalid) {
  test(`normalise gives null for: ${c.name}`, () => {
    assert.equal(normalizeUrl(c.input), null);
  });
}

// The spec's Reddit comment form (/comments/<id>/<commentId>) looks like a post with a slug, so a Reddit comment cannot be
// normalised twice. Always normalise the ORIGINAL url, never a stored normalised one.
const REDDIT_COMMENT = /reddit\.com\/r\/[^/]+\/comments\/[^/]+\/[^/]+$/;

test('normalising twice changes nothing, except for Reddit comments', () => {
  for (const c of table.cases.filter((x) => !REDDIT_COMMENT.test(x.expected))) {
    assert.equal(normalizeUrl(normalizeUrl(c.input)), c.expected, c.name);
  }
});

test('a normalised Reddit comment loses its comment id if normalised again, so callers must use the original url', () => {
  const once = normalizeUrl('https://www.reddit.com/r/Singapore/comments/1ABC2D/some_title/K9X8Y7Z/');
  assert.equal(once, 'https://reddit.com/r/singapore/comments/1abc2d/k9x8y7z');
  assert.notEqual(normalizeUrl(once), once);
});

test('non string input gives null', () => {
  assert.equal(normalizeUrl(null), null);
  assert.equal(normalizeUrl(undefined), null);
  assert.equal(normalizeUrl(42), null);
});

test('the same article from two sources gets the same key', () => {
  const google = 'https://www.google.com/url?rct=j&sa=t&url=https://www.forbes.com/councils/x/why-venture/%3Futm_source%3Dga&ct=ga';
  const talkwalker = 'https://www.forbes.com/councils/x/why-venture/';
  assert.equal(normalizeUrl(google), normalizeUrl(talkwalker));
});
