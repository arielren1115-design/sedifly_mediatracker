// Converts a Gmail API (users.messages.get, format=full) message into the shape the parsers receive.

/** @param {{headers?: {name:string, value:string}[]}} part @returns {string|undefined} */
function charsetOf(part) {
  const h = (part.headers || []).find((x) => x.name.toLowerCase() === 'content-type');
  const m = h && /charset\s*=\s*"?([^";\s]+)/i.exec(h.value);
  return m ? m[1] : undefined;
}

/**
 * @param {object} raw Gmail API message
 * @param {(base64url: string, charset?: string) => string} decodeBody decodes a body into text (Utilities in Apps Script)
 * @returns {{id:string, from:string, subject:string, date:string, htmlBody:string, plainBody:string,
 *            attachments:{name:string, mimeType:string, blobRef:string}[]}}
 */
export function fromGmailApi(raw, decodeBody) {
  const headers = {};
  for (const h of raw.payload?.headers || []) headers[h.name.toLowerCase()] = h.value;
  let plainBody = '';
  let htmlBody = '';
  const attachments = [];
  const walk = (part) => {
    for (const child of part.parts || []) walk(child);
    if (part.parts) return;
    const mime = String(part.mimeType || '').toLowerCase();
    if (part.filename) {
      attachments.push({ name: part.filename, mimeType: part.mimeType, blobRef: part.body?.attachmentId || `part:${part.partId}` });
    } else if (mime === 'text/plain' && !plainBody && part.body?.data) {
      plainBody = decodeBody(part.body.data, charsetOf(part));
    } else if (mime === 'text/html' && !htmlBody && part.body?.data) {
      htmlBody = decodeBody(part.body.data, charsetOf(part));
    }
  };
  walk(raw.payload || {});
  return {
    id: raw.id,
    from: headers.from || '',
    subject: headers.subject || '',
    date: new Date(Number(raw.internalDate)).toISOString(),
    htmlBody,
    plainBody,
    attachments,
  };
}
