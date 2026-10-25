import { getProp, setProp, targetSpreadsheetId } from './config.js';
import { sendOpsEmail } from './mail.js';
import { appendRunLog, log } from './runLog.js';
import { decideHeartbeat, heartbeatEmail } from '../core/heartbeat.js';

/**
 * Hourly. Emails OPS_RECIPIENTS when no run has succeeded for 45 minutes (then every 6 hours), and once when it recovers.
 * @returns {{status: string, action: string}}
 */
export function heartbeatCheck() {
  const nowMs = Date.now();
  const lastIso = getProp('LAST_SUCCESS_AT');
  const lastSuccessMs = lastIso ? Date.parse(lastIso) : null;
  let state = {};
  try { state = JSON.parse(getProp('HEARTBEAT_STATE') || '{}'); } catch (e) { state = {}; }
  const d = decideHeartbeat({ nowMs, lastSuccessMs: Number.isFinite(lastSuccessMs) ? lastSuccessMs : null, state });
  if (d.action !== 'none') {
    const mail = heartbeatEmail(d.action, { staleForMs: d.staleForMs, lastSuccessIso: lastIso });
    // Only mark the alert as sent once the mail went out, so a mail failure is retried next hour.
    if (sendOpsEmail(mail.subject, mail.body)) setProp('HEARTBEAT_STATE', JSON.stringify(d.state));
    else log('heartbeatCheck could not send mail (OPS_RECIPIENTS missing or a placeholder)');
    try {
      const ss = SpreadsheetApp.openById(targetSpreadsheetId());
      appendRunLog(ss, { runId: Utilities.getUuid(), fn: 'heartbeatCheck', startedAt: new Date(nowMs), durationMs: Date.now() - nowMs, summary: { note: d.action === 'alert' ? `No successful run for ${Math.round(d.staleForMs / 60000)} minutes` : 'Recovered' }, status: d.action === 'alert' ? 'FAILED' : 'OK' });
    } catch (e) { log('heartbeatCheck could not write the Run Log', { error: String(e && e.message || e) }); }
  } else {
    setProp('HEARTBEAT_STATE', JSON.stringify(d.state));
  }
  log('heartbeatCheck', { action: d.action, staleMinutes: Math.round(d.staleForMs / 60000) });
  return { status: 'OK', action: d.action };
}
