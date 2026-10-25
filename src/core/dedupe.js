// Dedupe (BUILD_SPEC 8.2). An in-memory index over rows already in Coverage and Review Queue.
import { normalizeUrl } from './normalizeUrl.js';

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
/** Shorter headlines ("Home", "News") are too generic to treat as the same story. */
const MIN_TITLE_WORDS = 5;

/** A normalised Reddit comment link (reddit.com/r/<sub>/comments/<post>/<comment>). Comments are distinct content, never copies. */
export const isRedditCommentUrl = (norm) => /^https:\/\/reddit\.com\/r\/[^/]+\/comments\/[^/]+\/[^/]+$/.test(norm || '');

/** Lower case, punctuation removed, spaces collapsed. @param {string|null} title @returns {string} */
export function normalizeTitle(title) {
  return String(title || '').toLowerCase()
    .replace(/['‘’‚‛′]/g, '')
    .replace(/[^a-z0-9À-῿⁰-￿]+/g, ' ')
    .trim();
}

/**
 * Appends items to a comma separated list when missing. Returns the original text when nothing needs adding.
 * @param {string} existing
 * @param {string} addition
 * @returns {string}
 */
export function mergeList(existing, addition) {
  const items = String(existing || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (items.includes(addition)) return existing;
  return [...items, addition].join(', ');
}

const timeOf = (v) => (v && typeof v.getTime === 'function' ? v.getTime() : v ? Date.parse(v) : NaN);

/**
 * @param {object[]} rows {sheet, rowNumber, coverageId, url, normalisedUrl, title, detectedAt, sourceRoute, foundIn, gmailMessageId}
 *   in priority order: earlier rows win when two rows share a url
 */
export function createIndex(rows) {
  const entries = [];
  const keys = new Set();
  const byUrl = new Map();

  const index = {
    /** @returns {object} the stored entry, with `norm` and `titleNorm` filled in */
    add(row) {
      const entry = { ...row, norm: row.normalisedUrl || normalizeUrl(row.url) || '', titleNorm: normalizeTitle(row.title), syndicatedCopies: Number(row.syndicatedCopies) || 0 };
      entries.push(entry);
      if (row.gmailMessageId && row.url) keys.add(`${row.gmailMessageId}||${row.url}`);
      if (entry.norm && !byUrl.has(entry.norm)) byUrl.set(entry.norm, entry);
      return entry;
    },
    hasKey: (key) => keys.has(key),
    addKey: (key) => { keys.add(key); },
    findByUrl: (norm) => byUrl.get(norm) || null,
    /** A row with the same headline (at least 5 words), a different url, and a Detected at within 7 days of now. */
    similarTitle(title, norm, nowMs) {
      const t = normalizeTitle(title);
      if (t.split(' ').length < MIN_TITLE_WORDS) return null;
      return entries.find((e) => e.titleNorm === t && e.norm !== norm && !isRedditCommentUrl(e.norm) && Math.abs(nowMs - timeOf(e.detectedAt)) <= SEVEN_DAYS_MS) || null;
    },
    setCopies(entry, count) {
      entry.syndicatedCopies = count;
    },
    setRoutes(entry, sourceRoute, foundIn) {
      entry.sourceRoute = sourceRoute;
      entry.foundIn = foundIn;
    },
  };
  rows.forEach((r) => index.add(r));
  return index;
}
