import { parseUrl, queryParam, bareHost } from './urlParts.js';

/**
 * Unwraps Google redirect links (google.com/url?url=<target> or ?q=<target>). Other URLs are returned unchanged.
 * @param {string} url
 * @returns {string}
 */
export function unwrapRedirect(url) {
  const p = parseUrl(url);
  if (!p) return url;
  const host = bareHost(url);
  if ((host === 'google.com' || host.endsWith('.google.com')) && p.pathname === '/url') {
    const target = queryParam(p.search, 'url') || queryParam(p.search, 'q');
    if (target && /^https?:\/\//i.test(target)) return target;
  }
  return url;
}
