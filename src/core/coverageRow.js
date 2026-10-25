// Builds a Coverage tab row (by header name) from a RawItem. Entity, category and priority come in later milestones.
import { channelFromUrl } from './channel.js';

/** Social media, Reddit and Hacker News links are Source type Social Media (owners, 2026-10-25). */
const SOCIAL_CHANNELS = ['Social', 'Reddit', 'Hacker News'];

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
 * @param {{coverageId?: string|null, now: Date, normalisedUrl?: string|null, classification?: object|null, threshold?: number}} ctx
 *   coverageId is omitted for Review Queue rows. With a classification, its fields fill the row; Verification is Verified only at or above the threshold.
 * @returns {Object<string, any>} header name to value
 */
export function toCoverageRow(item, { coverageId, now, normalisedUrl, classification, threshold }) {
  const channel = item.channelHint || channelFromUrl(item.url) || '';
  const row = {
    ...(coverageId ? { 'Coverage ID': coverageId } : {}),
    'Detected at': now,
    'Published at': item.publishedAt || '',
    Channel: channel,
    ...(SOCIAL_CHANNELS.includes(channel) ? { 'Source type': 'Social Media' } : {}),
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
  return classification ? applyClassification(row, item, classification, threshold) : row;
}

/** Link derived channel and source type win over the model for social links, which the script can tell for certain. */
function applyClassification(row, item, c, threshold) {
  const fromLink = row.Channel;
  const social = SOCIAL_CHANNELS.includes(fromLink);
  return {
    ...row,
    Entity: c.entity || '',
    Channel: fromLink || c.channel,
    'Source type': social ? 'Social Media' : c.source_type,
    Outlet: row.Outlet || c.outlet,
    Title: row.Title || c.title,
    'Published at': row['Published at'] || c.published_date || '',
    Excerpt: row.Excerpt || String(c.summary || '').slice(0, 500),
    Category: c.category,
    Priority: c.priority,
    Sentiment: c.sentiment,
    'Rules matched': c.matched_rule_ids.join(', '),
    'Classifier confidence': c.confidence,
    Verification: typeof threshold === 'number' && c.confidence >= threshold ? 'Verified' : 'Needs verification',
  };
}
