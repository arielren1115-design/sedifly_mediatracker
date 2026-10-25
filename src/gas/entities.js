import { getProp } from './config.js';
import { loadEntities } from '../core/entities.js';

/**
 * Reads the Monitored Entities tab of the PR Activity Tracker. Read only: this spreadsheet is never written to.
 * Fails loudly if the tab or its headers are missing, because an empty list would make every alert look unrelated.
 * @returns {object[]}
 */
export function loadMonitoredEntities() {
  const ss = SpreadsheetApp.openById(getProp('PR_TRACKER_SPREADSHEET_ID'));
  const sheet = ss.getSheetByName('Monitored Entities');
  if (!sheet) throw new Error('The PR Activity Tracker has no tab named "Monitored Entities"');
  const rows = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues().map((r) => r.map(String));
  const entities = loadEntities(rows);
  if (!entities.length) throw new Error('The Monitored Entities tab has no entities');
  return entities;
}
