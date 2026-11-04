import { assertConfig, getProp, setProp, targetSpreadsheetId } from '../gas/config.js';
import { assertTabsReady } from '../gas/sheets.js';
import { appendRunLog, log } from '../gas/runLog.js';
import { buildDigest } from '../core/digest.js';
import { PLACEHOLDER } from '../core/properties.js';
import { labelIdsByName, listReviewEmails } from '../gas/gmail.js';

const rowsOf = (sheet) => {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const headers = values[0].map((h) => String(h).trim());
  return values.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
};

/** OPS_RECIPIENTS plus the alert recipients for the current mode, each address once. */
function digestRecipients() {
  const alertKey = getProp('MODE') === 'BLIND' ? 'ALERT_RECIPIENTS_BLIND' : 'ALERT_RECIPIENTS';
  const all = [getProp('OPS_RECIPIENTS'), getProp(alertKey)]
    .filter((v) => v && !v.startsWith(PLACEHOLDER))
    .flatMap((v) => v.split(',').map((a) => a.trim()).filter(Boolean));
  return [...new Set(all.map((a) => a.toLowerCase()))];
}

function send({ force }) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) { log('dailyDigest SKIPPED (locked)'); return { status: 'SKIPPED' }; }
  const startedAt = new Date();
  try {
    assertConfig();
    const last = Number(getProp('LAST_DIGEST_AT')) || 0;
    if (!force && Date.now() - last < 12 * 3600 * 1000) { log('dailyDigest SKIPPED (already sent in the last 12 hours)'); return { status: 'SKIPPED' }; }
    const ss = SpreadsheetApp.openById(targetSpreadsheetId());
    assertTabsReady(ss);
    const digest = buildDigest({
      nowMs: Date.now(),
      coverage: rowsOf(ss.getSheetByName('Coverage')),
      review: rowsOf(ss.getSheetByName('Review Queue')),
      runLog: rowsOf(ss.getSheetByName('Run Log')),
      lastSuccessIso: getProp('LAST_SUCCESS_AT'),
      sheetUrl: ss.getUrl(),
      reviewEmails: listReviewEmails(labelIdsByName()),
    });
    if (!force && !digest.stats.hasChanges) { log('dailyDigest SKIPPED (nothing new or changed in the last 24 hours)'); return { status: 'SKIPPED', reason: 'nothing new' }; }
    const to = digestRecipients();
    if (!to.length) throw new Error('No digest recipients are set (OPS_RECIPIENTS and the alert recipients are missing or placeholders)');
    MailApp.sendEmail({ to: to.join(','), subject: digest.subject, body: digest.body });
    setProp('LAST_DIGEST_AT', String(Date.now()));
    appendRunLog(ss, { runId: Utilities.getUuid(), fn: 'dailyDigest', startedAt, durationMs: Date.now() - startedAt.getTime(), summary: { note: `Sent to ${to.length} recipient${to.length === 1 ? '' : 's'}: ${digest.stats.newRows} new, ${digest.stats.openReview} in review` }, status: 'OK' });
    log('dailyDigest sent', digest.stats);
    return { status: 'OK', recipients: to.length, ...digest.stats };
  } finally {
    lock.releaseLock();
  }
}

/** Daily 09:00 SGT, but only when something is new or changed (new rows, new review items, alerts, decisions, failed runs). A second run within 12 hours is skipped. */
export function dailyDigest() {
  return send({ force: false });
}

/** Run by hand from the editor to send the digest now, whatever was sent earlier and even if nothing changed. */
export function digestNow() {
  return send({ force: true });
}
