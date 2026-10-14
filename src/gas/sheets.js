import { missingHeaders, TABS, REVIEW_DECISIONS } from '../core/schema.js';

/**
 * Create a tab if needed and append any missing headers. Never deletes or reorders columns.
 * @returns {{created: boolean, addedHeaders: string[]}}
 */
export function ensureTab(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  const created = !sheet;
  if (!sheet) sheet = ss.insertSheet(name);
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const add = missingHeaders(existing, headers);
  if (add.length) {
    let start = existing.length;
    while (start > 0 && String(existing[start - 1]).trim() === '') start--;
    sheet.getRange(1, start + 1, 1, add.length).setValues([add]).setFontWeight('bold');
  }
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  return { created, addedHeaders: add };
}

/** Column number (1 based) of a header, found by name. */
export function columnByHeader(sheet, header) {
  const row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const i = row.map((h) => String(h).trim()).indexOf(header);
  if (i < 0) throw new Error(`Header not found: ${header} in ${sheet.getName()}`);
  return i + 1;
}

/** Create all tabs for one spreadsheet. @returns {object} summary of changes */
export function ensureAllTabs(ss) {
  const summary = {};
  for (const [name, headers] of Object.entries(TABS)) summary[name] = ensureTab(ss, name, headers);

  const review = ss.getSheetByName('Review Queue');
  const col = columnByHeader(review, 'Decision');
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(REVIEW_DECISIONS, true).setAllowInvalid(false).build();
  review.getRange(2, col, review.getMaxRows() - 1, 1).setDataValidation(rule);

  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0 && blank.getLastColumn() === 0) ss.deleteSheet(blank);
  return summary;
}

/** Highest existing COV number plus one, or 1 if none. */
export function nextCoverageIdFromSheet(ss) {
  const sheet = ss.getSheetByName('Coverage');
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  const col = columnByHeader(sheet, 'Coverage ID');
  const ids = sheet.getRange(2, col, last - 1, 1).getValues().flat();
  const nums = ids.map((v) => /^COV-(\d+)$/.exec(String(v))).filter(Boolean).map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) + 1 : 1;
}
