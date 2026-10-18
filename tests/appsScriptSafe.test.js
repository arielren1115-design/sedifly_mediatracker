// Apps Script (V8) has no URL, URLSearchParams, TextDecoder, Buffer or Node modules. Keep them out of src/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const files = (d) => readdirSync(d).flatMap((n) => (statSync(path.join(d, n)).isDirectory() ? files(path.join(d, n)) : [path.join(d, n)])).filter((f) => f.endsWith('.js'));
const FORBIDDEN = [/\bnew URL\(/, /\bURLSearchParams\b/, /\bTextDecoder\b/, /\bTextEncoder\b/, /\bBuffer\b/, /\bprocess\./, /\brequire\(/, /from 'node:/, /\bsetTimeout\(/, /\bfetch\(/];

test('src uses nothing that Apps Script lacks', () => {
  for (const f of files(root)) {
    const text = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const re of FORBIDDEN) assert.ok(!re.test(text), `${path.relative(root, f)} uses ${re}`);
  }
});

test('core modules use no Apps Script services', () => {
  for (const f of files(path.join(root, 'core'))) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!/\b(GmailApp|SpreadsheetApp|DriveApp|UrlFetchApp|PropertiesService|LockService|ScriptApp|Utilities|Gmail\.|Drive\.)\b/.test(text), `${path.relative(root, f)} uses an Apps Script global`);
  }
});
