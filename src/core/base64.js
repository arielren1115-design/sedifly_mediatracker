/**
 * Gmail returns bodies as web-safe base64 without padding. Converts that to standard base64 with padding,
 * which every decoder accepts.
 * @param {string} data
 * @returns {string}
 */
export function toStandardBase64(data) {
  const t = String(data).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  return t + '='.repeat((4 - (t.length % 4)) % 4);
}
