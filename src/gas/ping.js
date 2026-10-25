// External dead man's switch (BUILD_SPEC D4). Only a ping is sent, never data. A failed ping never fails a run.
import { getProp } from './config.js';
import { log } from './runLog.js';

/** @param {'ok'|'fail'} kind @returns {boolean} */
export function pingHeartbeat(kind = 'ok') {
  const url = getProp('HEARTBEAT_PING_URL');
  if (!url || url.startsWith('PLACEHOLDER')) return false;
  try {
    UrlFetchApp.fetch(kind === 'fail' ? `${url.replace(/\/+$/, '')}/fail` : url, { method: 'get', muteHttpExceptions: true });
    return true;
  } catch (e) {
    log('heartbeat ping failed', { error: String(e && e.message || e) });
    return false;
  }
}
