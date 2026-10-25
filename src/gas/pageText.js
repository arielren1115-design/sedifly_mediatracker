// Fetches one public page for the second look at a low confidence item (D12). Never called for social links.
import { htmlToPageText } from '../core/pageText.js';

/** @param {string} url @returns {string|null} page text, or null when the page cannot be read */
export function fetchPageText(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SedyflyMonitor/1.0)' } });
    if (res.getResponseCode() !== 200) return null;
    const text = htmlToPageText(res.getContentText());
    return text.length >= 200 ? text : null;
  } catch (e) {
    return null;
  }
}
