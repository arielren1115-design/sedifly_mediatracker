// Google Alerts parser (BUILD_SPEC 7.2). Reads the HTML part, which marks each result with schema.org microdata.
import { htmlToText, hrefOf } from '../html.js';
import { unwrapRedirect } from '../unwrapRedirect.js';

const ITEM_SPLIT_RE = /itemscope[^>]*itemtype\s*=\s*["']https?:\/\/schema\.org\/(?!Organization)\w+["']/i;
const NAME_RE = /<span[^>]*itemprop\s*=\s*["']name["'][^>]*>([\s\S]*?)<\/span>/i;

/** The alert's own name, from "Google Alert - Joash Lee". */
export function alertNameOf(subject) {
  const m = /^\s*(?:Fwd:\s*)?Google Alert\s*-\s*(.+?)\s*$/i.exec(subject || '');
  return m ? m[1] : null;
}

// Google sends two layouts. The digest layout marks each result with schema.org microdata. The "as-it-happens" layout does not, so a
// result is found by its link instead: every result title links through google.com/url?...&ct=ga (the share, feedback and unsubscribe
// links go to other google.com paths). The plain text part is a last resort when the HTML cannot be read.
const RESULT_ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const isResultHref = (href) => /^https?:\/\/www\.google\.com\/url\?/i.test(href || '') && /[?&]ct=ga(&|$)/i.test(href);
const SNIPPET_RE = /<div[^>]*color\s*:\s*#252525[^>]*>([\s\S]*?)<\/div>/i;
const OUTLET_RE = /<a(?![^>]*href)[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/a>/i;

function itemFor(message, fields) {
  return {
    gmailMessageId: message.id,
    route: 'Google Alerts',
    url: unwrapRedirect(fields.href),
    title: fields.title || null,
    snippet: fields.snippet || null,
    outlet: fields.outlet || null,
    publishedAt: null,
    receivedAt: message.date,
    forwarderEmail: null,
    forwarderNote: null,
    alertName: alertNameOf(message.subject),
    channelHint: null,
    itemKind: null,
    attachments: [],
  };
}

/** As-it-happens layout: one result per title link; the outlet and snippet follow it until the next result. */
function parseByLinks(message) {
  const html = String(message.htmlBody || '').replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const hits = [];
  for (const m of html.matchAll(RESULT_ANCHOR_RE)) {
    const href = hrefOf(m[1]);
    if (isResultHref(href)) hits.push({ href, title: htmlToText(m[2]), start: m.index, end: m.index + m[0].length });
  }
  return hits.map((h, i) => {
    const after = html.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : html.length);
    const outlet = OUTLET_RE.exec(after);
    const snippet = SNIPPET_RE.exec(after);
    return itemFor(message, { href: h.href, title: h.title, outlet: outlet ? htmlToText(outlet[1]) : null, snippet: snippet ? htmlToText(snippet[1]) : null });
  });
}

/** Last resort: each result in the plain text is a paragraph of title, snippet lines and a <google.com/url link>. */
function parseByText(message) {
  const out = [];
  for (const para of String(message.plainBody || '').split(/\n\s*\n/)) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1] || '';
    const m = /^<(https?:\/\/www\.google\.com\/url\?[^>]*)>$/.exec(last);
    if (!m || !isResultHref(m[1]) || lines.length < 2) continue;
    out.push(itemFor(message, { href: m[1], title: lines[0], snippet: lines.slice(1, -1).join(' ') }));
  }
  return out;
}

/**
 * @param {{id:string, date:string, htmlBody?:string}} message
 * @returns {object[]} RawItem[]
 */
export function parse(message) {
  const byMicrodata = parseMicrodata(message);
  if (byMicrodata.length) return byMicrodata;
  const byLinks = parseByLinks(message);
  return byLinks.length ? byLinks : parseByText(message);
}

function parseMicrodata(message) {
  const blocks = String(message.htmlBody || '').split(new RegExp(ITEM_SPLIT_RE.source, 'gi')).slice(1);
  const items = [];
  for (const block of blocks) {
    const anchor = /<a\b([^>]*)>/i.exec(block);
    const href = anchor ? hrefOf(anchor[1]) : null;
    if (!href) continue;
    const title = NAME_RE.exec(block);
    const publisherAt = block.search(/itemprop\s*=\s*["']publisher["']/i);
    const publisher = publisherAt >= 0 ? NAME_RE.exec(block.slice(publisherAt)) : null;
    const description = /itemprop\s*=\s*["']description["'][^>]*>([\s\S]*?)<\/div>/i.exec(block);
    items.push({
      gmailMessageId: message.id,
      route: 'Google Alerts',
      url: unwrapRedirect(href),
      title: title ? htmlToText(title[1]) : null,
      snippet: description ? htmlToText(description[1]) : null,
      outlet: publisher ? htmlToText(publisher[1]) : null,
      publishedAt: null,
      receivedAt: message.date,
      forwarderEmail: null,
      forwarderNote: null,
      alertName: alertNameOf(message.subject),
      channelHint: null,
      itemKind: null,
      attachments: [],
    });
  }
  return items;
}

