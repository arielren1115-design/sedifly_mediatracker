// Google Alerts parser (BUILD_SPEC 7.2). Reads the HTML part, which marks each result with schema.org microdata.
import { htmlToText, hrefOf } from '../html.js';
import { unwrapRedirect } from '../unwrapRedirect.js';

const ITEM_SPLIT_RE = /itemscope[^>]*itemtype\s*=\s*["']https?:\/\/schema\.org\/(?!Organization)\w+["']/i;
const NAME_RE = /<span[^>]*itemprop\s*=\s*["']name["'][^>]*>([\s\S]*?)<\/span>/i;

/**
 * @param {{id:string, date:string, htmlBody?:string}} message
 * @returns {object[]} RawItem[]
 */
export function parse(message) {
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
      channelHint: null,
      attachments: [],
    });
  }
  return items;
}

