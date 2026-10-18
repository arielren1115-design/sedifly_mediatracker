// URL helpers that work in Apps Script, which has no URL or URLSearchParams.

const URL_RE = /^(https?):\/\/([^/?#:@]+)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/i;

/**
 * @param {string} url
 * @returns {{protocol:string, host:string, port:string, pathname:string, search:string, hash:string} | null} null if not an http(s) URL
 */
export function parseUrl(url) {
  const m = URL_RE.exec(String(url).trim());
  if (!m) return null;
  return { protocol: m[1].toLowerCase(), host: m[2].toLowerCase(), port: m[3] || '', pathname: m[4] || '/', search: m[5] || '', hash: m[6] || '' };
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * First value of a query parameter, percent decoded. A plus sign is kept as is.
 * @param {string} search query string, with or without the leading "?"
 * @param {string} name
 * @returns {string|null}
 */
export function queryParam(search, name) {
  for (const pair of String(search).replace(/^\?/, '').split('&')) {
    const i = pair.indexOf('=');
    const key = safeDecode(i < 0 ? pair : pair.slice(0, i));
    if (key === name) return i < 0 ? '' : safeDecode(pair.slice(i + 1));
  }
  return null;
}

/** Host without a leading www. @param {string} url @returns {string} empty if not a URL */
export function bareHost(url) {
  const p = parseUrl(url);
  return p ? p.host.replace(/^www\./, '') : '';
}
