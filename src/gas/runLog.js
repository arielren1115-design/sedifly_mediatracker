// All logging goes through here.
import { appendObjects } from './sheets.js';
import { buildRunLogRow } from '../core/runLogRow.js';

/** @param {string} message @param {object} [detail] */
export function log(message, detail) {
  const line = detail === undefined ? message : `${message} ${JSON.stringify(detail)}`;
  console.log(`${new Date().toISOString()} ${line}`);
}

/** Appends one row to the Run Log tab of the given spreadsheet. */
export function appendRunLog(ss, run) {
  appendObjects(ss.getSheetByName('Run Log'), [buildRunLogRow(run)]);
}
