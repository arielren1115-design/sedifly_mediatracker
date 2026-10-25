// Wraps a trigger function so an uncaught exception is logged, emailed (once per function per hour) and still rethrown (spec 13).
import { getProp, setProp, targetSpreadsheetId } from '../gas/config.js';
import { sendOpsEmail } from '../gas/mail.js';
import { pingHeartbeat } from '../gas/ping.js';
import { appendRunLog, log } from '../gas/runLog.js';
import { errorEmail, shouldEmailError } from '../core/heartbeat.js';

function reportFailure(name, error, startedAt) {
  const message = String((error && error.message) || error);
  log(`${name} FAILED`, { error: message });
  try {
    const ss = SpreadsheetApp.openById(targetSpreadsheetId());
    appendRunLog(ss, { runId: Utilities.getUuid(), fn: name, startedAt, durationMs: Date.now() - startedAt.getTime(), summary: { errors: 1, note: message }, status: 'FAILED' });
  } catch (e) { /* the original error matters more */ }
  try {
    let sent = {};
    try { sent = JSON.parse(getProp('ERROR_EMAIL_AT') || '{}'); } catch (e) { sent = {}; }
    if (shouldEmailError(sent[name], Date.now())) {
      const mail = errorEmail(name, error);
      if (sendOpsEmail(mail.subject, mail.body)) setProp('ERROR_EMAIL_AT', JSON.stringify({ ...sent, [name]: Date.now() }));
    }
  } catch (e) { log(`${name}: could not send the error email`, { error: String(e && e.message || e) }); }
  if (name === 'runIngest') pingHeartbeat('fail');
}

/**
 * @template {(...args: any[]) => any} F
 * @param {string} name function name as it appears in the Run Log
 * @param {F} fn
 * @returns {F}
 */
export function guarded(name, fn) {
  return function guardedRun(...args) {
    const startedAt = new Date();
    try {
      return fn(...args);
    } catch (e) {
      reportFailure(name, e, startedAt);
      throw e;
    }
  };
}
