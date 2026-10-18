// Talkwalker Alerts parser (BUILD_SPEC 7.2). HTML only emails; item links are direct article URLs.
import { htmlToText, hrefOf } from '../html.js';

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const SNIPPET_RE = /<td[^>]*colspan\s*=\s*["']2["'][^>]*style\s*=\s*["'][^"']*padding:\s*10px 0[^"']*["'][^>]*>([\s\S]*?)<\/td>/i;
const META_RE = /<td[^>]*style\s*=\s*["'][^"']*color:\s*#878aaa[^"']*["'][^>]*>([\s\S]*?)<\/td>/i;

/** "13/10/26 19:13" (day/month/year) to "2026-10-13", or null if it does not look right. */
export function parseTalkwalkerDate(text) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(text || '');
  if (!m) return null;
  const [day, month] = [Number(m[1]), Number(m[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * @param {{id:string, date:string, htmlBody?:string}} message
 * @returns {object[]} RawItem[]
 */
export function parse(message) {
  const html = String(message.htmlBody || '');
  const titles = [];
  for (const m of html.matchAll(ANCHOR_RE)) {
    const attrs = m[1];
    if (!/font-weight:\s*bold/i.test(attrs) || !/#007aaf/i.test(attrs)) continue;
    const href = hrefOf(attrs);
    if (href) titles.push({ href, title: htmlToText(m[2]), start: m.index, end: m.index + m[0].length });
  }
  return titles.map((t, i) => {
    const segment = html.slice(t.end, i + 1 < titles.length ? titles[i + 1].start : html.length);
    const snippet = SNIPPET_RE.exec(segment);
    const meta = META_RE.exec(segment);
    const parts = meta ? htmlToText(meta[1]).split('|').map((p) => p.trim()) : [];
    return {
      gmailMessageId: message.id,
      route: 'Talkwalker',
      url: t.href,
      title: t.title || null,
      snippet: snippet ? htmlToText(snippet[1]) : null,
      outlet: parts.length ? parts[parts.length - 1] || null : null,
      publishedAt: parseTalkwalkerDate(parts[0]),
      receivedAt: message.date,
      forwarderEmail: null,
      forwarderNote: null,
      channelHint: null,
      attachments: [],
    };
  });
}
