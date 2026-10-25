// Plain text of a fetched public page, for the one low confidence second look (BUILD_SPEC 9.3, D12).
import { htmlToText } from './html.js';

export const PAGE_TEXT_LIMIT = 8000;

/** @param {string|null} html @returns {string} at most 8000 characters, tags and scripts removed */
export function htmlToPageText(html) {
  const body = String(html || '')
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<\/(h[1-6]|section|article|header|footer|blockquote|ul|ol|table)>/gi, ' ');
  return htmlToText(body).slice(0, PAGE_TEXT_LIMIT);
}
