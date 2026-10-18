import { getProp, setProp } from './config.js';
import { formatCoverageId } from '../core/coverageRow.js';

/** Reserves the next n Coverage IDs. Call only while holding the script lock. @returns {string[]} */
export function allocateCoverageIds(n) {
  const start = Number(getProp('NEXT_COVERAGE_ID'));
  if (!Number.isInteger(start) || start < 1) throw new Error('NEXT_COVERAGE_ID is not set. Run setup().');
  setProp('NEXT_COVERAGE_ID', String(start + n));
  return Array.from({ length: n }, (_, i) => formatCoverageId(start + i));
}
