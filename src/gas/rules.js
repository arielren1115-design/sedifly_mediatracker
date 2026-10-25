import { getProp } from './config.js';
import { loadRules, activeRules } from '../core/rules.js';

/**
 * Reads the Monitoring Rules tab of the PR Activity Tracker and returns the active rules. Read only.
 * @returns {object[]}
 */
export function loadActiveRules() {
  const ss = SpreadsheetApp.openById(getProp('PR_TRACKER_SPREADSHEET_ID'));
  const sheet = ss.getSheetByName('Monitoring Rules');
  if (!sheet) throw new Error('The PR Activity Tracker has no tab named "Monitoring Rules"');
  const rows = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues().map((r) => r.map(String));
  const rules = activeRules(loadRules(rows));
  if (!rules.length) throw new Error('The Monitoring Rules tab has no active rules');
  return rules;
}
