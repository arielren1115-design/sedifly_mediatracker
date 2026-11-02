// Instant alert emails (BUILD_SPEC 12). Mail only ever goes to the alert recipient properties, nowhere else (CLAUDE.md rule 4).
import { getProp, setProp } from './config.js';
import { updateCells } from './sheets.js';
import { log } from './runLog.js';
import { buildAlertEmail } from '../core/alertEmail.js';
import { PLACEHOLDER } from '../core/properties.js';

const PENDING_KEY = 'PENDING_ALERTS';
const PENDING_MAX = 15; // Script Property values are limited to 9 KB, so the queue holds only what is needed to rebuild the mail from the sheet

/** PROD sends to ALERT_RECIPIENTS, BLIND mode to ALERT_RECIPIENTS_BLIND (Ariel only). */
function recipients() {
  const to = getProp(getProp('MODE') === 'BLIND' ? 'ALERT_RECIPIENTS_BLIND' : 'ALERT_RECIPIENTS');
  if (!to || to.startsWith(PLACEHOLDER)) throw new Error('No alert recipients are set');
  return to;
}

function rowObject(sheet, rowNumber) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  const values = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
}

/**
 * Sends the mail and stamps `Instant alert sent`. Throws if the mail cannot be sent. Never sends twice for a row already stamped.
 * @returns {boolean} false when the row was already alerted
 */
function deliver(ss, info) {
  const sheet = ss.getSheetByName(info.sheet);
  const row = info.row || rowObject(sheet, info.rowNumber);
  if (row['Instant alert sent'] !== '' && row['Instant alert sent'] !== undefined && info.row === undefined) return false;
  const mail = buildAlertEmail({
    priority: row.Priority, entity: row.Entity, outlet: row.Outlet, unconfirmed: info.unconfirmed,
    title: row.Title, url: row.URL, publishedAt: row['Published at'], sentiment: row.Sentiment,
    summary: info.summary || row.Excerpt, ruleIds: row['Rules matched'], excerpt: row.Excerpt,
    rowLink: `${ss.getUrl()}#gid=${sheet.getSheetId()}&range=A${info.rowNumber}`, coverageId: row['Coverage ID'] || info.coverageId, reasons: info.reasons,
  });
  MailApp.sendEmail({ to: recipients(), subject: mail.subject, body: mail.body });
  try {
    updateCells(sheet, info.rowNumber, { 'Instant alert sent': new Date() }, ['Instant alert sent']);
  } catch (e) {
    log('alert sent but the sheet stamp failed', { sheet: info.sheet, row: info.rowNumber, error: String(e && e.message || e) });
  }
  return true;
}

const readQueue = () => { try { const q = JSON.parse(getProp(PENDING_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch (e) { return []; } };
const writeQueue = (q) => setProp(PENDING_KEY, JSON.stringify(q.slice(-PENDING_MAX)));

/**
 * @param {object} ss spreadsheet
 * @returns {(info: object) => boolean} for processBatch. A mail problem queues a retry and returns false instead of throwing.
 */
export function createAlertSender(ss) {
  return (info) => {
    try {
      deliver(ss, info);
      return true;
    } catch (e) {
      log('instant alert could not be sent, queued for retry', { sheet: info.sheet, row: info.rowNumber, error: String(e && e.message || e) });
      writeQueue([...readQueue(), { sheet: info.sheet, rowNumber: info.rowNumber, gmailMessageId: info.row['Gmail message ID'], url: info.row.URL, unconfirmed: info.unconfirmed, reasons: info.reasons, summary: info.summary }]);
      return false;
    }
  };
}

/** Retries alerts that failed earlier. Run at the start of every ingest. @returns {{sent: number, waiting: number}} */
export function retryPendingAlerts(ss) {
  const queue = readQueue();
  if (!queue.length) return { sent: 0, waiting: 0 };
  const keep = [];
  let sent = 0;
  for (const p of queue) {
    try {
      const sheet = ss.getSheetByName(p.sheet);
      const row = rowObject(sheet, p.rowNumber);
      if (row['Gmail message ID'] !== p.gmailMessageId || row.URL !== p.url) { log('pending alert dropped, the row moved', p); continue; }
      if (deliver(ss, { ...p, row: undefined })) sent++;
    } catch (e) {
      keep.push(p);
    }
  }
  writeQueue(keep);
  return { sent, waiting: keep.length };
}

/**
 * Alert for a row a human approved, when its rules or priority call for one and it was not alerted before.
 * @returns {boolean} true when sent
 */
export function alertForRow(ss, { sheet, rowNumber, coverageId, reasons }) {
  try {
    return deliver(ss, { sheet, rowNumber, coverageId, unconfirmed: false, reasons, row: undefined });
  } catch (e) {
    const row = rowObject(ss.getSheetByName(sheet), rowNumber);
    writeQueue([...readQueue(), { sheet, rowNumber, gmailMessageId: row['Gmail message ID'], url: row.URL, unconfirmed: false, reasons, summary: '' }]);
    log('approved row alert could not be sent, queued for retry', { row: rowNumber, error: String(e && e.message || e) });
    return false;
  }
}
