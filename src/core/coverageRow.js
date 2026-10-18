// Builds a Coverage tab row (by header name) from a RawItem. Entity, category and priority come in later milestones.

/** @param {number} n @returns {string} e.g. COV-000001 */
export function formatCoverageId(n) {
  return `COV-${String(n).padStart(6, '0')}`;
}

/** Idempotency key for one item of one message (spec 15). */
export function itemKey(item) {
  return `${item.gmailMessageId}||${item.url || ''}`;
}

/**
 * @param {object} item RawItem
 * @param {{coverageId?: string|null, now: Date, normalisedUrl?: string|null}} ctx coverageId is omitted for Review Queue rows
 * @returns {Object<string, any>} header name to value
 */
export function toCoverageRow(item, { coverageId, now, normalisedUrl }) {
  return {
    ...(coverageId ? { 'Coverage ID': coverageId } : {}),
    'Detected at': now,
    'Published at': item.publishedAt || '',
    Channel: item.channelHint || '',
    Outlet: item.outlet || '',
    Title: item.title || '',
    URL: item.url || '',
    'Normalised URL': normalisedUrl || '',
    Excerpt: String(item.snippet || item.forwarderNote || '').slice(0, 500),
    'Archive status': 'Pending',
    'Found in': 'Tool',
    Verification: 'Needs verification',
    'Source route': item.route,
    'Gmail message ID': item.gmailMessageId,
    'Logged by': 'script',
    'Last updated': now,
  };
}
