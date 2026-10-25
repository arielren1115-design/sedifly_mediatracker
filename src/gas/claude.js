// The only place that calls the Anthropic API. Plain object in, plain object out, so the vendor or host can be swapped later.
import { getProp } from './config.js';
import { parseClaudeResponse, RETRY_DELAYS_MS } from '../core/claudeResponse.js';
import { PLACEHOLDER } from '../core/properties.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/**
 * Sends one Messages API request. Retries rate limits, overload, server errors and timeouts twice (2 s, then 8 s).
 * @param {object} request body from buildRequest
 * @returns {{kind:'tool', input:object} | {kind:'no_tool'} | {kind:'refusal'} | {kind:'retry', status:number|null} | {kind:'fatal', status:number, message:string}}
 *   'retry' here means every attempt failed, so the caller should leave the message for the next run.
 */
export function callClaude(request) {
  const key = getProp('ANTHROPIC_API_KEY');
  if (!key || key.startsWith(PLACEHOLDER)) throw new Error('ANTHROPIC_API_KEY is not set (still a placeholder)');
  let last = { kind: 'retry', status: null };
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) Utilities.sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const res = UrlFetchApp.fetch(ENDPOINT, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        payload: JSON.stringify(request),
        muteHttpExceptions: true,
      });
      last = parseClaudeResponse(res.getResponseCode(), res.getContentText());
    } catch (e) {
      last = { kind: 'retry', status: null }; // timeout or network failure
    }
    if (last.kind !== 'retry') return last;
  }
  return last;
}
