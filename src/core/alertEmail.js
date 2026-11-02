// The instant alert email (BUILD_SPEC 12). Plain English, no dashes added by us.

const sgt = (value) => {
  const t = value && typeof value.getTime === 'function' ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(t)) return String(value || '');
  return `${new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} SGT`;
};

/**
 * @param {object} i
 * @param {string} i.priority @param {string} i.entity @param {string} i.outlet @param {boolean} i.unconfirmed
 * @param {string} i.title @param {string} i.url @param {*} i.publishedAt @param {string} i.sentiment @param {string} i.summary
 * @param {string} i.ruleIds @param {string} i.excerpt @param {string} i.rowLink @param {string} i.coverageId @param {string[]} i.reasons
 * @returns {{subject: string, body: string}}
 */
export function buildAlertEmail(i) {
  const subject = `${i.unconfirmed ? 'UNCONFIRMED ' : ''}[Sedifly Media] ${i.priority || 'Critical'}: ${i.entity || 'Unknown entity'} in ${i.outlet || 'unknown outlet'}`;
  const lines = [];
  if (i.unconfirmed) lines.push('This item has not been checked by a person yet. It is waiting in the Review Queue.', '');
  lines.push(
    `Title: ${i.title || '(no title)'}`,
    `URL: ${i.url || '(no link)'}`,
    `Outlet: ${i.outlet || 'unknown'}`,
    `Published: ${i.publishedAt ? sgt(i.publishedAt).slice(0, 10) : 'unknown'}`,
    `Sentiment: ${i.sentiment || 'not set'}`,
    `Summary: ${i.summary || '(none)'}`,
    `Matched rules: ${i.ruleIds || 'none'}`,
    `Excerpt: ${i.excerpt || '(none)'}`,
    `Coverage ID: ${i.coverageId || '(not assigned yet, review item)'}`,
    `Sheet row: ${i.rowLink}`,
    '',
    `Why you are getting this: ${i.reasons.join('; ')}.`,
  );
  if (i.sentiment === 'Negative') lines.push('', 'Negative mention: reply is a human decision.');
  return { subject, body: lines.join('\n') };
}
