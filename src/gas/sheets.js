import { missingHeaders, TABS, REVIEW_DECISIONS, DATETIME_FORMATS, SOURCE_TYPE_VALUES } from '../core/schema.js';

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
  if (ss.getSpreadsheetTimeZone() !== 'Asia/Singapore') ss.setSpreadsheetTimeZone('Asia/Singapore');
  for (const [name, headers] of Object.entries(TABS)) summary[name] = ensureTab(ss, name, headers);

  for (const [name, headers] of Object.entries(TABS)) {
    const sheet = ss.getSheetByName(name);
    const rowsBelowHeader = sheet.getMaxRows() - 1;
    if (rowsBelowHeader < 1) continue;
    for (const [header, format] of Object.entries(DATETIME_FORMATS)) {
      if (headers.includes(header)) sheet.getRange(2, columnByHeader(sheet, header), rowsBelowHeader, 1).setNumberFormat(format);
    }
  }

  const review = ss.getSheetByName('Review Queue');
  const col = columnByHeader(review, 'Decision');
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(REVIEW_DECISIONS, true).setAllowInvalid(false).build();
  review.getRange(2, col, review.getMaxRows() - 1, 1).setDataValidation(rule);

  const sourceRule = SpreadsheetApp.newDataValidation().requireValueInList(SOURCE_TYPE_VALUES, true).setAllowInvalid(false).build();
  for (const name of ['Coverage', 'Review Queue']) {
    const sheet = ss.getSheetByName(name);
    sheet.getRange(2, columnByHeader(sheet, 'Source type'), sheet.getMaxRows() - 1, 1).setDataValidation(sourceRule);
  }

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

/** Values of one column (by header name), without the header row. */
export function readColumn(sheet, header) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const col = columnByHeader(sheet, header);
  return sheet.getRange(2, col, last - 1, 1).getValues().map((r) => r[0]);
}

/** Appends rows given as {header: value}. Unknown headers throw, missing ones stay blank. @returns {number} the first new row number */
export function appendObjects(sheet, objects) {
  if (!objects.length) return sheet.getLastRow() + 1;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  for (const o of objects) {
    for (const k of Object.keys(o)) if (!headers.includes(k)) throw new Error(`Header not found: ${k} in ${sheet.getName()}`);
  }
  const rows = objects.map((o) => headers.map((h) => (h in o ? o[h] : '')));
  const first = sheet.getLastRow() + 1;
  sheet.getRange(first, 1, rows.length, headers.length).setValues(rows);
  return first;
}

/** Header names the script may rewrite on an existing row. Everything else is human owned or permanent (spec 6.1). */
const UPDATABLE = ['Source route', 'Found in', 'Syndicated copies', 'Last updated'];

/** Writes values into named cells of one existing row. Refuses any header that is not on the allowed list. */
export function updateCells(sheet, rowNumber, values) {
  for (const [header, value] of Object.entries(values)) {
    if (!UPDATABLE.includes(header)) throw new Error(`The script may not change ${header}`);
    sheet.getRange(rowNumber, columnByHeader(sheet, header), 1, 1).setValues([[value]]);
  }
}

/**
 * Rows already in Coverage and Review Queue, as dedupe index rows. Coverage comes first, so it wins over Review Queue.
 * Columns are found by header name.
 */
export function readIndexRows(ss) {
  const out = [];
  for (const name of ['Coverage', 'Review Queue']) {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) continue;
    const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    const headers = values[0].map((h) => String(h).trim());
    const col = (row, header) => { const i = headers.indexOf(header); return i < 0 ? '' : row[i]; };
    values.slice(1).forEach((row, i) => out.push({
      sheet: name,
      rowNumber: i + 2,
      coverageId: col(row, 'Coverage ID'),
      url: col(row, 'URL'),
      normalisedUrl: col(row, 'Normalised URL'),
      title: col(row, 'Title'),
      detectedAt: col(row, 'Detected at'),
      sourceRoute: String(col(row, 'Source route')),
      foundIn: String(col(row, 'Found in')),
      syndicatedCopies: col(row, 'Syndicated copies'),
      gmailMessageId: col(row, 'Gmail message ID'),
    }));
  }
  return out;
}

/**
 * Fails with a plain message if a tab or any of its columns is missing, before any work is done.
 * @param {object} ss spreadsheet
 */
export function assertTabsReady(ss) {
  const problems = [];
  for (const [name, headers] of Object.entries(TABS)) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) { problems.push(`the ${name} tab is missing`); continue; }
    const last = sheet.getLastColumn();
    const existing = last > 0 ? sheet.getRange(1, 1, 1, last).getValues()[0] : [];
    const missing = missingHeaders(existing, headers);
    if (missing.length) problems.push(`the ${name} tab is missing the column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}`);
  }
  if (problems.length) throw new Error(`The sheet is not set up: ${problems.join('; ')}. Run setup() to restore it.`);
}
