import { assertConfig, getProp, setProp } from '../gas/config.js';
import { ensureAllTabs, nextCoverageIdFromSheet } from '../gas/sheets.js';
import { ensureLabels } from '../gas/gmail.js';
import { ensureTriggers } from '../gas/triggers.js';
import { log } from '../gas/runLog.js';

/**
 * Idempotent environment setup: validates properties, creates tabs, headers, labels and triggers.
 * Running it twice changes nothing.
 * @returns {object} summary of what changed
 */
export function setup() {
  const placeholders = assertConfig(); // throws listing every missing key
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const summary = { placeholders, spreadsheets: {} };
    for (const key of ['BOT_SPREADSHEET_ID', 'SCRATCH_SPREADSHEET_ID']) {
      const ss = SpreadsheetApp.openById(getProp(key));
      summary.spreadsheets[key] = ensureAllTabs(ss);
    }
    if (!getProp('NEXT_COVERAGE_ID')) {
      const ss = SpreadsheetApp.openById(getProp('BOT_SPREADSHEET_ID'));
      setProp('NEXT_COVERAGE_ID', String(nextCoverageIdFromSheet(ss)));
      summary.nextCoverageIdInitialised = true;
    }
    summary.labelsCreated = ensureLabels();
    summary.triggers = ensureTriggers();
    log('setup complete', summary);
    return summary;
  } finally {
    lock.releaseLock();
  }
}
