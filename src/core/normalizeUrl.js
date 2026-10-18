// URL normalisation (BUILD_SPEC 8.1). The result is the dedupe key. Pure, and Apps Script safe (no URL class).
import { parseUrl } from './urlParts.js';
import { unwrapRedirect } from './unwrapRedirect.js';

const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'igshid', 'si', 's', 'share_id']);

const isTracking = (key) => {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || TRACKING_PARAMS.has(k);
};

/** Drops a leading label such as "www." but never leaves a host without a dot (so "m.com" survives). */
function stripLeadingLabel(host, label) {
  return host.startsWith(label) && host.slice(label.length).includes('.') ? host.slice(label.length) : host;
}

/** Reddit posts and comments become reddit.com/r/<sub>/comments/<id>[/<commentId>]. Returns null for other pages. */
function redditCanonical(host, pathname) {
  if (host !== 'reddit.com' && !host.endsWith('.reddit.com')) return null;
  const seg = pathname.split('/').filter(Boolean);
  if (seg.length < 4 || seg[0].toLowerCase() !== 'r' || seg[2].toLowerCase() !== 'comments') return null;
  const comment = seg[5] ? `/${seg[5].toLowerCase()}` : '';
  return `https://reddit.com/r/${seg[1].toLowerCase()}/comments/${seg[3].toLowerCase()}${comment}`;
}

/**
 * @param {string} input a URL, possibly wrapped in a Google redirect
 * @returns {string|null} the normalised URL, or null if the input is not an http(s) URL
 */
export function normalizeUrl(input) {
  if (typeof input !== 'string') return null;
  const parsed = parseUrl(unwrapRedirect(input.trim()));
  if (!parsed) return null;

  const reddit = redditCanonical(parsed.host, parsed.pathname);
  if (reddit) return reddit;

  let host = stripLeadingLabel(stripLeadingLabel(stripLeadingLabel(parsed.host, 'www.'), 'm.'), 'amp.');
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') host += `:${parsed.port}`;

  const path = parsed.pathname.replace(/\/amp\/?$/i, '').replace(/\/+$/, '') || '/';
  const params = parsed.search.replace(/^\?/, '').split('&')
    .filter((pair) => pair && !isTracking(pair.split('=')[0]))
    .sort();
  return `https://${host}${path}${params.length ? `?${params.join('&')}` : ''}`;
}
