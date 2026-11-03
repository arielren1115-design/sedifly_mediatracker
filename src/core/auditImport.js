// Historical audit findings (Ben's Claude audit, 2026-11-03). Kept separate from the Old tracker import: own Source route, own
// Import source, never Verified, never alerted. Pure: text in, plan out.
import { parseCsv } from './csv.js';
import { normalizeUrl } from './normalizeUrl.js';
import { channelFromUrl } from './channel.js';
import { CATEGORIES, SOURCE_TYPES } from './taxonomy.js';

export const AUDIT_ROUTE = 'Backfill: audit';
const CATS = CATEGORIES.map((c) => c.value);
const TYPES = SOURCE_TYPES.map((t) => t.value);
/** A sheet may hand back a real date for 2025-10-27; turn it back into the text form. */
const clean = (v) => {
  if (v && typeof v.getTime === 'function') return Number.isNaN(v.getTime()) ? '' : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
};

/** A short tag for the file, so two audits never share Import source keys. */
export const auditTag = (fileName) => (/(\d{4}-\d{2}-\d{2})/.exec(String(fileName || '')) || [])[1] || '';

/**
 * @param {string|any[][]} input CSV text, or the rows of a Google Sheet, with the header row: date, URL, outlet, title/topic, source type, category, entity, review status
 * @param {{fileName: string, entityNames: string[]}} ctx
 */
export function parseAudit(input, { fileName, entityNames }) {
  const rows = Array.isArray(input) ? input : parseCsv(input);
  const header = (rows[0] || []).map((h) => clean(h).toLowerCase());
  const at = (n) => header.indexOf(n);
  const col = { date: at('date'), url: at('url'), outlet: at('outlet'), title: at('title/topic'), type: at('source type'), category: at('category'), entity: at('entity') };
  const missing = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) return { error: `The audit file is missing the columns: ${missing.join(', ')}`, records: [] };
  const tag = auditTag(fileName);
  const records = rows.slice(1).map((r, i) => {
    const get = (k) => clean(r[col[k]]);
    const n = i + 2;
    const rec = { n, key: tag ? `Audit ${tag} row ${n}` : `Audit row ${n}`, dateIso: null, ms: null, url: get('url'), outlet: get('outlet'), title: get('title'), sourceType: get('type'), category: get('category'), entity: get('entity'), problems: [] };
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(get('date'));
    const real = d && new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])));
    if (d && real.getUTCMonth() === Number(d[2]) - 1 && real.getUTCDate() === Number(d[3])) { rec.dateIso = get('date'); rec.ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), 4, 0, 0); } else if (get('date')) rec.problems.push(`date "${get('date')}" is not a real YYYY-MM-DD date`);
    if (!/^https?:\/\//i.test(rec.url)) rec.problems.push('no usable link');
    if (rec.sourceType && !TYPES.includes(rec.sourceType)) { rec.problems.push(`source type "${rec.sourceType}" is not one of the three`); rec.sourceType = ''; }
    if (rec.category && !CATS.includes(rec.category)) { rec.problems.push(`category "${rec.category}" is not one of the four`); rec.category = ''; }
    if (rec.entity && !entityNames.includes(rec.entity)) { rec.problems.push(`entity "${rec.entity}" is not a monitored entity`); rec.entity = ''; }
    rec.norm = rec.url ? normalizeUrl(rec.url) || '' : '';
    return rec;
  }).filter((r) => r.url || r.title || r.outlet);
  return { records, error: null };
}

/**
 * Decides each row's outcome.
 * @param {object[]} records
 * @param {Map<string,string>} existing normalised link to the Coverage ID already holding it
 * @param {Set<string>} alreadyImported Import source keys already written
 * @returns {object[]} the records with `outcome`: new, in tracker, repeat in file, already imported, or unusable
 */
export function planAudit(records, existing, alreadyImported) {
  const seen = new Set();
  return records.map((r) => {
    if (alreadyImported.has(r.key)) return { ...r, outcome: 'already imported' };
    if (!r.norm) return { ...r, outcome: 'unusable' };
    if (existing.has(r.norm)) return { ...r, outcome: 'in tracker', coverageId: existing.get(r.norm) };
    if (seen.has(r.norm)) return { ...r, outcome: 'repeat in file' };
    seen.add(r.norm);
    return { ...r, outcome: 'new' };
  });
}

/** Coverage row for an audit find. Never Verified, never alerted. */
export function toAuditCoverageRow(r, { coverageId, now }) {
  const notes = ['Found by the historical audit', ...r.problems];
  return {
    'Coverage ID': coverageId,
    'Detected at': r.ms === null ? '' : new Date(r.ms),
    'Published at': r.dateIso || '',
    Entity: r.entity,
    Channel: channelFromUrl(r.url) || (r.sourceType === 'Non-Media Listings' ? 'Listing' : ''),
    'Source type': r.sourceType,
    Outlet: r.outlet,
    Title: r.title,
    URL: r.url,
    'Normalised URL': r.norm,
    Category: r.category,
    'Archive status': 'Pending',
    'Found in': 'Audit',
    Verification: 'Needs verification',
    'Source route': AUDIT_ROUTE,
    'Logged by': 'import',
    'Import source': r.key,
    Notes: notes.join('. '),
    'Last updated': now,
  };
}

/** Lines for the Audit Report tab. */
export function buildAuditReport(planned, fileName) {
  const count = (o) => planned.filter((r) => r.outcome === o).length;
  const lines = [['Historical audit import report', ''], ['File', fileName], ['Rows read', planned.length]];
  for (const o of ['new', 'in tracker', 'repeat in file', 'already imported', 'unusable']) lines.push([`Outcome: ${o}`, count(o)]);
  lines.push(['Adds up', planned.length === ['new', 'in tracker', 'repeat in file', 'already imported', 'unusable'].reduce((n, o) => n + count(o), 0) ? 'yes' : 'NO'], ['', '']);
  lines.push(['File row', 'Outcome', 'Detail', 'Outlet', 'Link', 'Entity', 'Category']);
  for (const r of planned) lines.push([r.n, r.outcome, r.outcome === 'in tracker' ? `already ${r.coverageId}` : r.problems.join('; '), r.outlet, r.url, r.entity, r.category]);
  return lines;
}
