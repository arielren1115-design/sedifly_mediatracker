// Test helper: builds a Gmail API (format=full) style message from an .eml, flattened to the text parts and attachments.
import { readFileSync } from 'node:fs';
import { simpleParser } from 'mailparser';

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');

/** @param {string} path @param {string} id */
export async function emlToGmailApi(path, id) {
  const p = await simpleParser(readFileSync(path), { skipHtmlToText: true });
  const parts = [];
  if (typeof p.text === 'string' && p.text) parts.push({ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: b64url(p.text) } });
  if (typeof p.html === 'string') parts.push({ mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset="UTF-8"' }], body: { data: b64url(p.html) } });
  p.attachments.forEach((a, i) => parts.push({ mimeType: a.contentType, filename: a.filename, body: { attachmentId: `att-${i}`, size: a.size } }));
  return {
    id,
    internalDate: String(p.date.getTime()),
    payload: {
      mimeType: 'multipart/mixed',
      headers: [{ name: 'From', value: p.from.text }, { name: 'Subject', value: p.subject ?? '' }, { name: 'Date', value: p.date.toUTCString() }],
      parts,
    },
  };
}
