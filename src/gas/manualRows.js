import { readColumn, updateCells } from './sheets.js';
import { allocateCoverageIds } from './coverageIds.js';
import { needsId, manualRowDefaults, MANUAL_FILLABLE } from '../core/manualRows.js';

/**
 * Gives a Coverage ID and the default cells to rows typed into Coverage by hand. Cheap when there are none: it reads four columns only.
 * @returns {number} rows completed
 */
export function completeManualRows(ss) {
  const sheet = ss.getSheetByName('Coverage');
  if (sheet.getLastRow() < 2) return 0;
  const cols = ['Coverage ID', 'URL', 'Title', 'Outlet'].map((h) => readColumn(sheet, h));
  const todo = [];
  cols[0].forEach((id, i) => {
    if (needsId({ 'Coverage ID': id, URL: cols[1][i], Title: cols[2][i], Outlet: cols[3][i] })) todo.push(i + 2);
  });
  if (!todo.length) return 0;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  const ids = allocateCoverageIds(todo.length);
  const now = new Date();
  todo.forEach((rowNumber, n) => {
    const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    const values = Object.fromEntries(headers.map((h, j) => [h, row[j]]));
    updateCells(sheet, rowNumber, manualRowDefaults(values, { coverageId: ids[n], now }), MANUAL_FILLABLE);
  });
  return todo.length;
}
