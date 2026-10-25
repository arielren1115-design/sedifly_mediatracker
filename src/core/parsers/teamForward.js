// Team forward parser (BUILD_SPEC 7.2). Pure: no Apps Script globals.
import { parseUrl, bareHost } from '../urlParts.js';

const URL_RE = /https?:\/\/[^\s<>"]+/gi;
const FORWARD_MARKER_RE = /^\s*(-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:|-{2,}\s*Original Message\s*-{2,}|On .+ wrote:)\s*$/im;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;

/** Hosts whose links are alert vendor furniture (manage, delete, share), never coverage. */
const BOILERPLATE_HOSTS = ['talkwalker.com'];
/** host + path prefixes that are share buttons or vendor social pages. */
const BOILERPLATE_PATHS = [
  ['twitter.com', '/intent'], ['x.com', '/intent'], ['twitter.com', '/talkwalker'], ['facebook.com', '/talkwalker'],
  ['maps.google.com', '/'], ['google.com', '/alerts'],
];

/**
 * @param {string} from header value, e.g. "Name <a@b.com>"
 * @param {string} allowlist comma separated emails or @domain entries (TEAM_SENDER_ALLOWLIST)
 * @returns {boolean}
 */
export function isTeamSender(from, allowlist) {
  const email = extractEmail(from);
  if (!email) return false;
  return String(allowlist || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    .some((entry) => (entry.startsWith('@') ? email.endsWith(entry) : email === entry));
}

/** @param {string} from @returns {string} lower case address or '' */
export function extractEmail(from) {
  const m = /<([^>]+)>/.exec(from || '');
  const raw = (m ? m[1] : String(from || '')).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(raw) ? raw : '';
}

/** @param {string} url @returns {boolean} true for unsubscribe, alert vendor and share links */
export function isBoilerplateUrl(url) {
  if (/unsubscribe|opt-?out/i.test(url)) return true;
  const p = parseUrl(url);
  if (!p) return true;
  const host = bareHost(url);
  if (BOILERPLATE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  return BOILERPLATE_PATHS.some(([h, path]) => host === h && p.pathname.toLowerCase().startsWith(path));
}

/** Drops the signature (everything after the last "-- " line). */
function stripSignature(text) {
  const i = text.lastIndexOf('\n-- \n');
  return i >= 0 ? text.slice(0, i) : text;
}

function urlsFromHtml(html) {
  return [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]).filter((u) => /^https?:\/\//i.test(u));
}

function extractUrls(message) {
  let found;
  if (message.plainBody && message.plainBody.trim()) {
    found = stripSignature(`\n${message.plainBody.replace(/\r\n/g, '\n')}`).match(URL_RE) || [];
  } else {
    found = urlsFromHtml(message.htmlBody || '');
  }
  const seen = new Set();
  const out = [];
  for (const raw of found) {
    const url = raw.replace(TRAILING_PUNCT_RE, '');
    if (!url || isBoilerplateUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return dropOutletHomepages(out);
}

const isRootUrl = (url) => { const p = parseUrl(url); return !!p && p.pathname === '/' && !p.search; };

/**
 * Forwarded alerts end each item with a link to the outlet's homepage. Drop a bare homepage when a deeper
 * link on the same site is present. A lone homepage is kept, because a person may forward one on purpose.
 */
function dropOutletHomepages(urls) {
  const deepHosts = new Set(urls.filter((u) => !isRootUrl(u)).map(bareHost));
  return urls.filter((u) => !(isRootUrl(u) && deepHosts.has(bareHost(u))));
}

/** Text the forwarder wrote above the forwarded content, with links removed. */
function extractNote(plainBody) {
  const text = stripSignature(`\n${(plainBody || '').replace(/\r\n/g, '\n')}`);
  const m = FORWARD_MARKER_RE.exec(text);
  const above = m ? text.slice(0, m.index) : text;
  const note = above.replace(/\[image:[^\]]*\]/gi, ' ').replace(URL_RE, ' ').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return note || null;
}

/**
 * @param {{id:string, from:string, date:string, plainBody?:string, htmlBody?:string,
 *          attachments?:{name:string, mimeType:string, blobRef:string}[]}} message
 * @returns {object[]} RawItem[]; empty means the caller should label the message Monitoring/Review
 */
export function parse(message) {
  const images = (message.attachments || []).filter((a) => /^image\//i.test(a.mimeType));
  const urls = extractUrls(message);
  const base = {
    gmailMessageId: message.id,
    route: 'Team forward',
    title: null,
    snippet: null,
    outlet: null,
    publishedAt: null,
    receivedAt: message.date,
    forwarderEmail: extractEmail(message.from) || null,
    forwarderNote: extractNote(message.plainBody),
    alertName: null,
    itemKind: null,
  };
  if (urls.length) {
    return urls.map((url) => ({ ...base, url, channelHint: null, attachments: [] }));
  }
  if (images.length) {
    return [{ ...base, url: null, channelHint: 'Social', attachments: images }];
  }
  return [];
}
