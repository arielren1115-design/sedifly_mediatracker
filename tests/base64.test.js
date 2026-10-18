import test from 'node:test';
import assert from 'node:assert/strict';
import { toStandardBase64 } from '../src/core/base64.js';

test('web-safe unpadded input becomes standard padded base64', () => {
  for (const text of ['a', 'ab', 'abc', 'abcd', 'café ??>>~~ — 😀', '']) {
    const webSafe = Buffer.from(text, 'utf8').toString('base64url');
    const std = toStandardBase64(webSafe);
    assert.match(std, /^[A-Za-z0-9+/]*={0,2}$/);
    assert.equal(std.length % 4, 0);
    assert.equal(Buffer.from(std, 'base64').toString('utf8'), text);
  }
});

test('already padded, line wrapped, and standard input are accepted', () => {
  assert.equal(toStandardBase64('YWI='), 'YWI=');
  assert.equal(toStandardBase64('YW\nI='), 'YWI=');
  assert.equal(toStandardBase64('Pz8-Pj4_'), 'Pz8+Pj4/');
});
