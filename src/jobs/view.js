import { targetSpreadsheetId } from '../gas/config.js';
import { setSimpleView } from '../gas/sheets.js';

/** Run by hand: hides the technical columns of Coverage and Review Queue for everyday use. Reversible with fullView(). */
export function simpleView() {
  return setSimpleView(SpreadsheetApp.openById(targetSpreadsheetId()), true);
}

/** Run by hand: shows every column again. */
export function fullView() {
  return setSimpleView(SpreadsheetApp.openById(targetSpreadsheetId()), false);
}
