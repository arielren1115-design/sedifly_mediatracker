// Decides what heartbeatCheck should do (BUILD_SPEC 13). Pure, so every branch is tested.

export const STALE_AFTER_MS = 45 * 60 * 1000;
export const REPEAT_ALERT_MS = 6 * 3600 * 1000;
export const ERROR_EMAIL_GAP_MS = 3600 * 1000;

/**
 * @param {{nowMs: number, lastSuccessMs: number|null, state: {alerting?: boolean, alertedAtMs?: number, watchSinceMs?: number}}} a
 *   lastSuccessMs is null before the first successful run; the clock then starts at watchSinceMs (when the first check ran).
 * @returns {{action: 'none'|'alert'|'recover', staleForMs: number, state: object}}
 */
export function decideHeartbeat({ nowMs, lastSuccessMs, state }) {
  const next = { ...state, watchSinceMs: state.watchSinceMs ?? nowMs };
  const reference = lastSuccessMs ?? next.watchSinceMs;
  const staleForMs = Math.max(0, nowMs - reference);
  if (staleForMs <= STALE_AFTER_MS) {
    if (state.alerting) return { action: 'recover', staleForMs, state: { ...next, alerting: false, alertedAtMs: undefined } };
    return { action: 'none', staleForMs, state: next };
  }
  if (!state.alerting || nowMs - (state.alertedAtMs || 0) >= REPEAT_ALERT_MS) {
    return { action: 'alert', staleForMs, state: { ...next, alerting: true, alertedAtMs: nowMs } };
  }
  return { action: 'none', staleForMs, state: next };
}

/** One error email per function per hour. @returns {boolean} */
export function shouldEmailError(lastSentMs, nowMs) {
  return !lastSentMs || nowMs - lastSentMs >= ERROR_EMAIL_GAP_MS;
}

const minutes = (ms) => Math.round(ms / 60000);

/** Plain English email bodies. No dashes, ranges as "X to Y". */
export function heartbeatEmail(kind, { staleForMs, lastSuccessIso }) {
  if (kind === 'recover') {
    return { subject: 'Sedifly media monitoring has recovered', body: 'The media monitoring job is running again and the last run succeeded.\n\nNo action is needed.' };
  }
  return {
    subject: 'Sedifly media monitoring has stopped',
    body: [
      `The media monitoring job has not completed a successful run for ${minutes(staleForMs)} minutes (it normally runs every 5 minutes).`,
      `Last successful run: ${lastSuccessIso || 'never'}.`,
      '',
      'What to check, in order:',
      '1. Open the Apps Script project, then Executions, and look for failed runs and their error.',
      '2. Open Triggers and confirm the runIngest trigger is still there. If it is missing, run setup() once.',
      '3. If the error mentions the Anthropic API, the model service may be down or the key may be wrong. Mail will be picked up again on its own once it is back.',
      '',
      'You will get this email again every 6 hours until it is fixed, then one email when it recovers.',
    ].join('\n'),
  };
}

export function errorEmail(fn, error) {
  const message = String((error && error.message) || error);
  const stack = String((error && error.stack) || '');
  return {
    subject: `Sedifly media monitoring error in ${fn}`,
    body: [
      `The function ${fn} stopped with an error.`,
      '',
      `Error: ${message}`,
      '',
      'Stack:',
      stack || '(no stack)',
      '',
      'The error is also in the Run Log tab with Status FAILED. You get at most one email per function per hour.',
    ].join('\n'),
  };
}
