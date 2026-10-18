// Small HTML helpers. Apps Script has no DOM, so parsers work on text with simple patterns.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** @param {string} s @returns {string} */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Strips tags and comments, decodes entities, removes zero width characters, collapses whitespace. */
export function htmlToText(html) {
  const noTags = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|tr|li)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(noTags).replace(/[​‌‍﻿]/g, '').replace(/\s+/g, ' ').trim();
}

/** First href value of an attribute string, or null. */
export function hrefOf(attrs) {
  const m = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null;
}
