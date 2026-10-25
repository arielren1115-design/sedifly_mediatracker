import test from 'node:test';
import assert from 'node:assert/strict';
import { channelFromUrl } from '../src/core/channel.js';

test('channel from domain (spec 8.3)', () => {
  assert.equal(channelFromUrl('https://www.linkedin.com/posts/x'), 'Social');
  assert.equal(channelFromUrl('https://m.facebook.com/story'), 'Social');
  assert.equal(channelFromUrl('https://x.com/user/status/1'), 'Social');
  assert.equal(channelFromUrl('https://twitter.com/user'), 'Social');
  assert.equal(channelFromUrl('https://www.youtube.com/watch?v=1'), 'Social');
  assert.equal(channelFromUrl('https://threads.net/@a'), 'Social');
  assert.equal(channelFromUrl('https://old.reddit.com/r/a/comments/1'), 'Reddit');
  assert.equal(channelFromUrl('https://news.ycombinator.com/item?id=1'), 'Hacker News');
  assert.equal(channelFromUrl('https://www.forbes.com/a'), null, 'the classifier proposes News, Blog, Listing, Forum or Other');
  assert.equal(channelFromUrl('https://notlinkedin.com/a'), null, 'a look-alike domain is not matched');
  assert.equal(channelFromUrl(null), null);
  assert.equal(channelFromUrl('junk'), null);
});
