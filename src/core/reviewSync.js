// Moves human decisions from the Review Queue into Coverage (BUILD_SPEC 6.2 and 11).
import { normalizeUrl } from './normalizeUrl.js';
import { COVERAGE_HEADERS } from './schema.js';

/** An approved row must carry at least these, or Coverage would hold a half empty row. */
export const REQUIRED_FOR_APPROVAL = ['Entity', 'Category', 'Priority'];

const blank = (v) => v === '' || v === null || v === undefined;

/**
 * @param {{rowNumber: number, values: Object<string, any>}[]} rows Review Queue rows, values by header name
 * @param {{hasUrl: (norm: string) => boolean, hasKey: (key: string) => boolean}} coverage what Coverage already holds
 * @returns {{approve: object[], alreadyThere: number[], reject: number[], blocked: {rowNumber: number, missing: string[]}[]}}
 */
export function planReviewSync(rows, coverage) {
  const plan = { approve: [], alreadyThere: [], reject: [], blocked: [] };
  const seenNorm = new Set();
  for (const row of rows) {
    const v = row.values;
    if (!blank(v['Synced at'])) continue;
    const decision = String(v.Decision || '').trim();
    if (decision === 'Reject') { plan.reject.push(row.rowNumber); continue; }
    if (decision !== 'Approve') continue;
    const missing = REQUIRED_FOR_APPROVAL.filter((h) => blank(v[h]));
    if (missing.length) { plan.blocked.push({ rowNumber: row.rowNumber, missing }); continue; }
    const norm = normalizeUrl(v.URL) || '';
    const key = `${v['Gmail message ID']}||${v.URL || ''}`;
    if ((norm && (coverage.hasUrl(norm) || seenNorm.has(norm))) || (!norm && coverage.hasKey(key))) { plan.alreadyThere.push(row.rowNumber); continue; }
    if (norm) seenNorm.add(norm);
    plan.approve.push({ rowNumber: row.rowNumber, values: v, norm });
  }
  return plan;
}

/**
 * The Coverage row for an approved item: the human edited values, a new ID, Verified.
 * @param {Object<string, any>} values Review Queue row values
 * @returns {Object<string, any>}
 */
export function approvedCoverageRow(values, { coverageId, now, norm }) {
  const row = {};
  for (const h of COVERAGE_HEADERS) if (!blank(values[h])) row[h] = values[h];
  return { ...row, 'Coverage ID': coverageId, 'Normalised URL': norm || row['Normalised URL'] || '', Verification: 'Verified', 'Found in': 'Tool', 'Last updated': now };
}
