import { assertConfig, getProp, setProp, targetSpreadsheetId } from '../gas/config.js';
import { labelIdsByName, listCandidates, getMessage, markProcessed, markReview } from '../gas/gmail.js';
import { appendObjects, assertTabsReady, readIndexRows, updateCells } from '../gas/sheets.js';
import { allocateCoverageIds } from '../gas/coverageIds.js';
import { loadMonitoredEntities } from '../gas/entities.js';
import { appendRunLog, log } from '../gas/runLog.js';
import { processBatch } from '../core/ingestRun.js';
import { createIndex } from '../core/dedupe.js';

/**
 * Reads labelled Gmail messages, parses them, writes provisional Coverage rows, and relabels each message.
 * Safe to run again at any time: nothing is written twice.
 * @returns {object} run summary
 */
export function runIngest() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    log('runIngest SKIPPED (locked)');
    return { status: 'SKIPPED' };
  }
  const startedAt = new Date();
  const t0 = Date.now();
  let ss = null;
  try {
    assertConfig();
    const budgetMs = Number(getProp('RUN_TIME_BUDGET_MS'));
    ss = SpreadsheetApp.openById(targetSpreadsheetId());
    assertTabsReady(ss);
    const labelIds = labelIdsByName();
    const candidates = listCandidates(labelIds, Number(getProp('BATCH_MAX_MESSAGES')));
    let summary = { messagesSeen: 0, details: [], status: 'OK', errors: 0 };
    if (candidates.length) {
      const coverage = ss.getSheetByName('Coverage');
      const reviewQueue = ss.getSheetByName('Review Queue');
      summary = processBatch({
        candidates,
        getMessage,
        entities: loadMonitoredEntities(),
        index: createIndex(readIndexRows(ss)),
        allocateIds: allocateCoverageIds,
        appendCoverageRow: (row) => appendObjects(coverage, [row]),
        appendReviewRow: (row) => appendObjects(reviewQueue, [row]),
        updateExisting: (entry, values) => updateCells(ss.getSheetByName(entry.sheet), entry.rowNumber, values),
        markProcessed: (id, label) => markProcessed(id, labelIds, label),
        markReview: (id, label) => markReview(id, labelIds, label),
        shouldStop: () => Date.now() - t0 > budgetMs,
        now: () => new Date(),
        allowlist: getProp('TEAM_SENDER_ALLOWLIST'),
      });
    }
    appendRunLog(ss, { runId: Utilities.getUuid(), fn: 'runIngest', startedAt, durationMs: Date.now() - t0, summary, status: summary.status });
    if (summary.status === 'OK') setProp('LAST_SUCCESS_AT', new Date().toISOString());
    log('runIngest done', { status: summary.status, seen: summary.messagesSeen, newRows: summary.newRows, toReview: summary.toReview, errors: summary.errors });
    return summary;
  } catch (e) {
    log('runIngest FAILED', { error: String(e && e.message || e) });
    try {
      if (ss) {
        appendRunLog(ss, { runId: Utilities.getUuid(), fn: 'runIngest', startedAt, durationMs: Date.now() - t0, summary: { errors: 1, note: String(e && e.message || e) }, status: 'FAILED' });
      }
    } catch (ignored) { /* the original error matters more */ }
    throw e;
  } finally {
    lock.releaseLock();
  }
}
