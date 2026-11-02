import { assertConfig, getProp, targetSpreadsheetId } from '../gas/config.js';
import { appendObjects, assertTabsReady, readIndexRows, updateCells } from '../gas/sheets.js';
import { allocateCoverageIds } from '../gas/coverageIds.js';
import { appendRunLog, log } from '../gas/runLog.js';
import { createIndex } from '../core/dedupe.js';
import { planReviewSync, approvedCoverageRow } from '../core/reviewSync.js';
import { decideAlert, classificationFromRow } from '../core/routing.js';
import { alertForRow } from '../gas/alerts.js';
import { loadActiveRules } from '../gas/rules.js';

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
      let rules = null;
      plan.approve.forEach((a, i) => {
        const newRow = approvedCoverageRow(a.values, { coverageId: ids[i], now, norm: a.norm });
        const coverageRow = appendObjects(coverage, [newRow]);
        stamp(a.rowNumber);
        const detail = { row: a.rowNumber, outcome: 'approved', coverageId: ids[i] };
        // Routing runs on approval (spec 6.2). A row already alerted as UNCONFIRMED carries its send time across, so it is not alerted again.
        if (newRow['Instant alert sent'] === undefined) {
          try {
            rules = rules || loadActiveRules();
            const due = decideAlert({ rules, classification: classificationFromRow(newRow), unconfirmed: false });
            if (due.send && alertForRow(ss, { sheet: 'Coverage', rowNumber: coverageRow, coverageId: ids[i], reasons: due.reasons })) detail.alert = 'sent';
          } catch (e) {
            detail.alert = `not checked: ${String(e && e.message || e)}`;
          }
        }
        details.push(detail);
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
