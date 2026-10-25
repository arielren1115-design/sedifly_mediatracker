import { assertConfig, getProp, targetSpreadsheetId } from '../gas/config.js';
import { appendObjects, assertTabsReady, readIndexRows, updateCells } from '../gas/sheets.js';
import { allocateCoverageIds } from '../gas/coverageIds.js';
import { appendRunLog, log } from '../gas/runLog.js';
import { createIndex } from '../core/dedupe.js';
import { planReviewSync, approvedCoverageRow } from '../core/reviewSync.js';

/**
 * Copies Approved rows of the Review Queue into Coverage and stamps Synced at. Rejected rows are only stamped (kept for accuracy metrics).
 * Safe to run again: an approved row whose link is already in Coverage is stamped, not copied twice.
 * @returns {object} run summary
 */
export function runReviewSync() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    log('runReviewSync SKIPPED (locked)');
    return { status: 'SKIPPED' };
  }
  const startedAt = new Date();
  const t0 = Date.now();
  try {
    assertConfig();
    const ss = SpreadsheetApp.openById(targetSpreadsheetId());
    assertTabsReady(ss);
    const review = ss.getSheetByName('Review Queue');
    const coverage = ss.getSheetByName('Coverage');
    if (review.getLastRow() < 2) return { status: 'OK', synced: 0 };
    const values = review.getRange(1, 1, review.getLastRow(), review.getLastColumn()).getValues();
    const headers = values[0].map((h) => String(h).trim());
    const rows = values.slice(1).map((r, i) => ({ rowNumber: i + 2, values: Object.fromEntries(headers.map((h, j) => [h, r[j]])) }));
    const index = createIndex(readIndexRows(ss).filter((r) => r.sheet === 'Coverage'));
    const plan = planReviewSync(rows, { hasUrl: (n) => !!index.findByUrl(n), hasKey: (k) => index.hasKey(k) });

    const now = new Date();
    const stamp = (rowNumber) => updateCells(review, rowNumber, { 'Synced at': now }, ['Synced at']);
    const details = [];
    if (plan.approve.length) {
      const ids = allocateCoverageIds(plan.approve.length);
      plan.approve.forEach((a, i) => {
        appendObjects(coverage, [approvedCoverageRow(a.values, { coverageId: ids[i], now, norm: a.norm })]);
        stamp(a.rowNumber);
        details.push({ row: a.rowNumber, outcome: 'approved', coverageId: ids[i] });
      });
    }
    for (const n of plan.alreadyThere) { stamp(n); details.push({ row: n, outcome: 'already in Coverage' }); }
    for (const n of plan.reject) { stamp(n); details.push({ row: n, outcome: 'rejected' }); }
    for (const b of plan.blocked) details.push({ row: b.rowNumber, outcome: 'waiting', reason: `Approved but missing ${b.missing.join(', ')}` });

    const synced = plan.approve.length + plan.alreadyThere.length + plan.reject.length;
    const summary = { synced, approved: plan.approve.length, rejected: plan.reject.length, blocked: plan.blocked.length, details };
    // A Run Log row only when something changed, so the log is not flooded every 5 minutes.
    if (synced > 0) {
      appendRunLog(ss, { runId: Utilities.getUuid(), fn: 'runReviewSync', startedAt, durationMs: Date.now() - t0, summary: { newRows: plan.approve.length, details }, status: 'OK' });
    }
    log('runReviewSync done', { synced, blocked: plan.blocked.length });
    return { status: 'OK', ...summary };
  } finally {
    lock.releaseLock();
  }
}
