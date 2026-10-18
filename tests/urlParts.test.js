import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUrl, queryParam, bareHost } from '../src/core/urlParts.js';

test('parseUrl splits the parts and lower cases scheme and host', () => {
  assert.deepEqual(parseUrl('HTTPS://WWW.Example.com:8080/a/b?x=1&y=2#frag'), { protocol: 'https', host: 'www.example.com', port: '8080', pathname: '/a/b', search: '?x=1&y=2', hash: '#frag' });
  assert.deepEqual(parseUrl('http://a.com'), { protocol: 'http', host: 'a.com', port: '', pathname: '/', search: '', hash: '' });
  assert.equal(parseUrl('mailto:a@b.c'), null);
  assert.equal(parseUrl('not a url'), null);
  assert.equal(parseUrl('https://'), null);
});

test('queryParam decodes values and handles missing keys', () => {
  assert.equal(queryParam('?a=1&url=https%3A%2F%2Fx.com%2Fp%3Fq%3D1&b=2', 'url'), 'https://x.com/p?q=1');
  assert.equal(queryParam('a=1', 'b'), null);
  assert.equal(queryParam('?flag&a=1', 'flag'), '');
  assert.equal(queryParam('?q=a+b', 'q'), 'a+b');
  assert.equal(queryParam('?q=%E0%A4%A', 'q'), '%E0%A4%A');
});

test('bareHost drops www only', () => {
  assert.equal(bareHost('https://www.forbes.com/x'), 'forbes.com');
  assert.equal(bareHost('https://alerts.talkwalker.com/x'), 'alerts.talkwalker.com');
  assert.equal(bareHost('junk'), '');
});
