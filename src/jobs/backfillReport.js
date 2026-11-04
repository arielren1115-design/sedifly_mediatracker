import { assertConfig, targetSpreadsheetId } from '../gas/config.js';
import { assertTabsReady } from '../gas/sheets.js';
import { appendRunLog, log } from '../gas/runLog.js';
import { writeReportTab } from '../gas/oldImport.js';
import { buildBackfillReport } from '../core/backfillReport.js';

/** Run by hand: writes the Backfill Report tab (recovery rate, new finds, audit finds). Reads Coverage only. */
export function backfillReport() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) { log('backfillReport SKIPPED (locked)'); return { status: 'SKIPPED' }; }
  try {
    assertConfig();
    const startedAt = new Date();
    const ss = SpreadsheetApp.openById(targetSpreadsheetId());
    assertTabsReady(ss);
    const sheet = ss.getSheetByName('Coverage');
    const coverage = [];
    if (sheet.getLastRow() > 1) {
      const v = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
      const h = v[0].map((x) => String(x).trim());
      for (const r of v.slice(1)) coverage.push(Object.fromEntries(h.map((k, i) => [k, r[i]])));
    }
    const { lines, stats } = buildBackfillReport(coverage, startedAt);
    writeReportTab(ss, lines, 'Backfill Report');
    appendRunLog(ss, { runId: Utilities.getUuid(), fn: 'backfillReport', startedAt, durationMs: Date.now() - startedAt.getTime(), summary: { note: `Backfill report: recovered ${stats.v1Found} of ${stats.v1} Old stories in the automatic channels` }, status: 'OK' });
    return { status: 'OK', ...stats };
  } finally {
    lock.releaseLock();
  }
}
