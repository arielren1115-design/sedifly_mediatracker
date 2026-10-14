// All configuration comes from Script Properties. No IDs, keys or addresses in code.
import { validateProperties } from '../core/properties.js';

/** @returns {Object<string,string>} */
export function getProps() {
  return PropertiesService.getScriptProperties().getProperties();
}

/** @param {string} key @returns {string|null} */
export function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/** @param {string} key @param {string} value */
export function setProp(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

/** Throws with the full list of missing or invalid keys. Returns the placeholder keys as warnings. */
export function assertConfig() {
  const r = validateProperties(getProps());
  if (r.missing.length || r.invalid.length) {
    const parts = [];
    if (r.missing.length) parts.push(`Missing Script Properties: ${r.missing.join(', ')}`);
    if (r.invalid.length) parts.push(`Invalid: ${r.invalid.join('; ')}`);
    throw new Error(parts.join('. '));
  }
  return r.placeholders;
}

/** Spreadsheet the script writes to: scratch in BLIND mode, Book of Truth otherwise. */
export function targetSpreadsheetId() {
  return getProp('MODE') === 'BLIND' ? getProp('SCRATCH_SPREADSHEET_ID') : getProp('BOT_SPREADSHEET_ID');
}
