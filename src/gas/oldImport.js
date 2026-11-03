// Reads the Old tracker (read only, never written) and imports it into the Book of Truth. Imports never send alerts.
import { getProp } from './config.js';
import { PLACEHOLDER } from '../core/properties.js';
import { matchTabs, parseTab, planStories, OLD_TABS } from '../core/oldImport.js';

/** @returns {{tabs: object[], plan: object, missing: string[], extra: string[]}} */
export function loadOldPlan() {
  const id = getProp('OLD_TRACKER_FILE_ID');
  if (!id || id.startsWith(PLACEHOLDER)) throw new Error('OLD_TRACKER_FILE_ID is not set. Set it to the Google Sheets copy of the Old tracker.');
  const old = SpreadsheetApp.openById(id);
  const sheets = old.getSheets();
  const { found, missing, extra } = matchTabs(sheets.map((s) => s.getName()));
  if (missing.length) throw new Error(`The Old tracker copy has no tab named ${missing.join(', ')}. Tabs found: ${sheets.map((s) => `"${s.getName()}"`).join(', ')}`);
  const tabs = OLD_TABS.map((t) => {
    const sheet = sheets.find((s) => s.getName() === found[t.key]);
    const parsed = parseTab(t, sheet.getDataRange().getValues());
    if (parsed.error) throw new Error(parsed.error);
    return parsed;
  });
  return { tabs, plan: planStories(tabs.flatMap((t) => t.records)), missing, extra };
}

/** Writes report lines to a report tab (Import Report by default), replacing what was there. */
export function writeReportTab(ss, lines, tabName = 'Import Report') {
  const sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  sheet.clear();
  const width = Math.max(...lines.map((l) => l.length));
  sheet.getRange(1, 1, lines.length, width).setValues(lines.map((l) => [...l, ...Array(width - l.length).fill('')]));
}

/** Maps every Old row key already in the Coverage tab to its Coverage ID, and lists the placements already written. */
export function readImportedState(ss) {
  const coverage = ss.getSheetByName('Coverage');
  const rowToId = new Map();
  if (coverage.getLastRow() > 1) {
    const v = coverage.getRange(1, 1, coverage.getLastRow(), coverage.getLastColumn()).getValues();
    const h = v[0].map((x) => String(x).trim());
    const src = h.indexOf('Import source');
    const id = h.indexOf('Coverage ID');
    for (const r of v.slice(1)) for (const k of String(r[src] || '').split(';').map((x) => x.trim()).filter(Boolean)) rowToId.set(k, r[id]);
  }
  const placed = new Set();
  const pl = ss.getSheetByName('Syndicated Placements');
  if (pl && pl.getLastRow() > 1) {
    const v = pl.getRange(1, 1, pl.getLastRow(), pl.getLastColumn()).getValues();
    const o = v[0].map((x) => String(x).trim()).indexOf('Origin');
    for (const r of v.slice(1)) { const m = /^Old tracker: ([^;]+)/.exec(String(r[o] || '')); if (m) placed.add(m[1].trim()); }
  }
  return { rowToId, placed };
}
