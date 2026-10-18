// Test helper: turns a .eml file into the message shape the parsers receive.
// {id, from, subject, date, htmlBody, plainBody, attachments: [{name, mimeType, blobRef}]}
import { readFileSync } from 'node:fs';
import { simpleParser } from 'mailparser';

/** @param {string} path @param {string} id */
export async function emlToMessage(path, id) {
  const p = await simpleParser(readFileSync(path), { skipHtmlToText: true });
  return {
    id,
    from: p.from?.text ?? '',
    subject: p.subject ?? '',
    date: p.date ? p.date.toISOString() : '',
    htmlBody: typeof p.html === 'string' ? p.html : '',
    plainBody: p.text ?? '',
    attachments: p.attachments.map((a, i) => ({ name: a.filename ?? `attachment-${i}`, mimeType: a.contentType, blobRef: `att-${i}` })),
  };
}
