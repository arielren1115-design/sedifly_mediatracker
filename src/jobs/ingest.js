import { assertConfig, getProp, setProp, targetSpreadsheetId } from '../gas/config.js';
import { labelIdsByName, listCandidates, getMessage, markProcessed, markReview } from '../gas/gmail.js';
import { appendObjects, assertTabsReady, readIndexRows, updateCells } from '../gas/sheets.js';
import { allocateCoverageIds } from '../gas/coverageIds.js';
import { loadMonitoredEntities } from '../gas/entities.js';
import { classifierConfigured, buildClassifier } from '../gas/classifier.js';
import { appendRunLog, log } from '../gas/runLog.js';
import { pingHeartbeat } from '../gas/ping.js';
import { processBatch } from '../core/ingestRun.js';
import { createIndex } from '../core/dedupe.js';

/**
 * Failures are logged, emailed and pinged by guarded() in jobs/guard.js.
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
  try {
    assertConfig();
    const budgetMs = Number(getProp('RUN_TIME_BUDGET_MS'));
    const ss = SpreadsheetApp.openById(targetSpreadsheetId());
    assertTabsReady(ss);
    const labelIds = labelIdsByName();
    const candidates = listCandidates(labelIds, Number(getProp('BATCH_MAX_MESSAGES')));
    let summary = { messagesSeen: 0, details: [], status: 'OK', errors: 0 };
    if (candidates.length) {
      const coverage = ss.getSheetByName('Coverage');
      const reviewQueue = ss.getSheetByName('Review Queue');
      const entities = loadMonitoredEntities();
      const classify = classifierConfigured();
      if (!classify) log('runIngest: no Anthropic API key set, rows are written without classification');
      summary = processBatch({
        candidates,
        getMessage,
        entities,
        classifier: classify ? buildClassifier(entities) : null,
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
    if (summary.status === 'OK') {
      setProp('LAST_SUCCESS_AT', new Date().toISOString());
      pingHeartbeat('ok');
    }
    log('runIngest done', { status: summary.status, seen: summary.messagesSeen, newRows: summary.newRows, toReview: summary.toReview, errors: summary.errors });
    return summary;
  } finally {
    lock.releaseLock();
  }
}
