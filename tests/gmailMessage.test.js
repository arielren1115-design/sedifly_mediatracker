import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { emlToMessage } from './helpers/emlToMessage.js';
import { emlToGmailApi } from './helpers/emlToGmailApi.js';
import { fromGmailApi } from '../src/core/gmailMessage.js';

const dir = new URL('../fixtures/emails/', import.meta.url).pathname;
const decode = (data, charset) => new TextDecoder(charset || 'utf-8').decode(Buffer.from(data, 'base64url'));

test('Gmail API conversion matches the .eml reader for every fixture', async () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.eml'))) {
    const viaEml = await emlToMessage(`${dir}${f}`, 'm1');
    const viaApi = fromGmailApi(await emlToGmailApi(`${dir}${f}`, 'm1'), decode);
    assert.deepEqual(viaApi, viaEml, f);
  }
});

test('nested multipart, charset, and attachment handling', () => {
  const raw = {
    id: 'n1', internalDate: '1792319253000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [{ name: 'FROM', value: 'A <a@b.c>' }, { name: 'subject', value: 'S' }],
      parts: [
        { mimeType: 'multipart/alternative', parts: [
          { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=ISO-8859-1' }], body: { data: Buffer.from('caf\xe9', 'latin1').toString('base64url') } },
          { mimeType: 'text/html', body: { data: Buffer.from('<b>hi</b>').toString('base64url') } },
        ] },
        { mimeType: 'image/png', filename: 'x.png', body: { attachmentId: 'ATT1' } },
        { mimeType: 'text/plain', filename: 'notes.txt', body: { attachmentId: 'ATT2' } },
        { mimeType: 'image/png', filename: 'inline.png', partId: '3', body: { data: 'AAAA' } },
      ],
    },
  };
  const m = fromGmailApi(raw, decode);
  assert.equal(m.plainBody, 'café');
  assert.equal(m.htmlBody, '<b>hi</b>');
  assert.equal(m.from, 'A <a@b.c>');
  assert.equal(m.date, '2026-10-18T10:27:33.000Z');
  assert.deepEqual(m.attachments.map((a) => [a.name, a.blobRef]), [['x.png', 'ATT1'], ['notes.txt', 'ATT2'], ['inline.png', 'part:3']]);
});
