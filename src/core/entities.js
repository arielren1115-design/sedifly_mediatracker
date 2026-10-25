// Monitored Entities (read only config) and the deterministic entity pre-match (BUILD_SPEC 9.1).
// Matching rules here are the proposed defaults, not yet confirmed by the owners. See PROGRESS.md, M2.

const HEADERS = {
  id: 'Entity ID', name: 'Entity name', type: 'Entity type', primaryTerm: 'Primary search term', aliases: 'Aliases / variants',
  defaultCategory: 'Default category', status: 'Monitoring status', sensitivity: 'Alert sensitivity',
  startDate: 'Start date', endDate: 'Review / end date', notes: 'Notes / source',
};

/**
 * @param {string[][]} rows the sheet or CSV rows, with any title rows above the header row
 * @returns {object[]} entities
 */
export function loadEntities(rows) {
  const headerAt = rows.findIndex((r) => r.map((c) => String(c).trim()).includes(HEADERS.id) && r.map((c) => String(c).trim()).includes(HEADERS.name));
  if (headerAt < 0) throw new Error(`Monitored Entities: could not find the header row with "${HEADERS.id}" and "${HEADERS.name}"`);
  const header = rows[headerAt].map((c) => String(c).trim());
  const cell = (row, key) => String(row[header.indexOf(HEADERS[key])] ?? '').trim();
  return rows.slice(headerAt + 1).filter((r) => cell(r, 'id')).map((r) => ({
    id: cell(r, 'id'),
    name: cell(r, 'name'),
    type: cell(r, 'type'),
    primaryTerm: cell(r, 'primaryTerm'),
    aliases: cell(r, 'aliases').split(';').map((a) => a.trim()).filter(Boolean),
    defaultCategory: cell(r, 'defaultCategory'),
    status: cell(r, 'status'),
    sensitivity: cell(r, 'sensitivity'),
    startDate: cell(r, 'startDate'),
    endDate: cell(r, 'endDate'),
    notes: cell(r, 'notes'),
  }));
}

const squash = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** "George Baxter" Sedifly -> {phrases: ['george baxter'], words: ['sedifly']}. Everything listed must be present. */
export function parseQuery(term) {
  const query = { phrases: [], words: [] };
  for (const m of String(term).matchAll(/"([^"]+)"|(\S+)/g)) {
    if (m[1] !== undefined) query.phrases.push(squash(m[1]));
    else query.words.push(squash(m[2]));
  }
  return query;
}

const isWordChar = (c) => c !== undefined && /[a-z0-9À-￿]/.test(c);

/** True if needle occurs in haystack with a non word character (or the edge) on both sides. Both are already squashed. */
function containsWhole(haystack, needle) {
  if (!needle) return false;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length])) return true;
  }
  return false;
}

/** @param {string} text @param {{phrases:string[], words:string[]}} query */
export function matchesQuery(text, query) {
  if (!query.phrases.length && !query.words.length) return false;
  const hay = squash(text);
  return query.phrases.every((p) => containsWhole(hay, p)) && query.words.every((w) => containsWhole(hay, w));
}

/** The primary search term, or any alias as an exact phrase. */
function entityMatches(entity, text) {
  if (matchesQuery(text, parseQuery(entity.primaryTerm))) return true;
  return entity.aliases.some((a) => matchesQuery(text, { phrases: [squash(a)], words: [] }));
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "30 Sep 2026" to the start of the day after (UTC), or null for "Ongoing" and anything else. */
function endOfDay(text) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(text || '');
  return m && MONTHS[m[2].toLowerCase()] !== undefined ? Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]) + 1) : null;
}

/**
 * Active entities are always monitored. "Recent watch" entities are monitored too, unless honourEndDates is on
 * and their review / end date has passed. Any other status is not monitored.
 */
export function isMonitored(entity, now, { honourEndDates = false } = {}) {
  if (entity.status === 'Active') return true;
  if (entity.status !== 'Recent watch') return false;
  const end = honourEndDates ? endOfDay(entity.endDate) : null;
  return end === null || now.getTime() < end;
}

/**
 * @param {object[]} entities
 * @param {string} text title, snippet and forwarder note joined together
 * @param {{now?: Date, honourEndDates?: boolean}} [options]
 * @returns {object[]} the monitored entities that match
 */
export function matchEntities(entities, text, options = {}) {
  const now = options.now || new Date();
  return entities.filter((e) => isMonitored(e, now, options) && entityMatches(e, text));
}
