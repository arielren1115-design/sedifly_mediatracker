// F5Bot alert parser (BUILD_SPEC 7.2). One email can hold many mentions, grouped under "Keyword:" headings.
import { htmlToText, decodeEntities, hrefOf } from '../html.js';
import { unwrapRedirect } from '../unwrapRedirect.js';

const HEADING_RE = /<h2[^>]*f5-hit-heading[^>]*>([\s\S]*?)<\/h2>/gi;
const HIT_RE = /<p[^>]*class\s*=\s*"f5-hit"[^>]*>([\s\S]*?)<\/p>/gi;

/** F5Bot escapes some text twice, so a heading can arrive as "Q&amp;A". Decode once more after the HTML is read. */
const text = (html) => decodeEntities(htmlToText(html));

/**
 * @param {string} label e.g. "Reddit Comments (/r/tea/):" or "Hacker News Stories:"
 * @returns {{kind: 'post'|'comment'|null, outlet: string|null}}
 */
export function parseHitMeta(label) {
  const cleaned = String(label || '').replace(/:\s*$/, '').trim();
  const m = /^(.*?)\s*\(([^)]*)\)$/.exec(cleaned);
  const source = (m ? m[1] : cleaned).trim();
  const context = m ? m[2].trim() : '';
  const kind = /comment/i.test(source) ? 'comment' : /\b(posts?|stor(?:y|ies))\b/i.test(source) ? 'post' : null;
  const sub = /^\/?r\/([^/]+)\/?$/i.exec(context);
  let outlet;
  if (sub) outlet = `r/${sub[1]}`;
  else if (context) outlet = context.replace(/^\/+|\/+$/g, '');
  else outlet = source.replace(/\s+(comments?|posts?|stories|story)$/i, '').trim();
  return { kind, outlet: outlet || null };
}

/**
 * @param {{id:string, date:string, htmlBody?:string}} message
 * @returns {object[]} RawItem[], empty for emails that are not alerts (tips, welcome and so on)
 */
export function parse(message) {
  const html = String(message.htmlBody || '');
  const headings = [...html.matchAll(HEADING_RE)].map((m) => {
    const t = text(m[1]);
    const k = /^Keyword:\s*"?(.*?)"?\s*$/i.exec(t);
    return { at: m.index, keyword: k ? k[1] : t };
  });
  const items = [];
  for (const hit of html.matchAll(HIT_RE)) {
    const body = hit[1];
    const label = /<span[^>]*class\s*=\s*"f5-meta"[^>]*>([\s\S]*?)<\/span>/i.exec(body);
    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(body);
    const href = anchor ? hrefOf(anchor[1]) : null;
    if (!href) continue;
    const excerpt = /<span[^>]*class\s*=\s*"f5-excerpt"[^>]*>([\s\S]*?)<\/span>/i.exec(body);
    const meta = parseHitMeta(label ? text(label[1]) : '');
    const heading = headings.filter((h) => h.at < hit.index).pop();
    items.push({
      gmailMessageId: message.id,
      route: 'F5Bot',
      url: unwrapRedirect(href),
      title: text(anchor[2]) || null,
      snippet: excerpt ? text(excerpt[1]) || null : null,
      outlet: meta.outlet,
      publishedAt: null,
      receivedAt: message.date,
      forwarderEmail: null,
      forwarderNote: null,
      alertName: heading ? heading.keyword : null,
      channelHint: null,
      itemKind: meta.kind,
      attachments: [],
    });
  }
  return items;
}
