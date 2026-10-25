// Reads a Messages API reply (BUILD_SPEC 9.2 and 9.3). Pure, so the retry and fallback rules can be tested.
import { TOOL_NAME } from './classifyPrompt.js';

export const RETRY_DELAYS_MS = [2000, 8000];
const RETRYABLE = [408, 409, 429, 500, 502, 503, 504, 529];

/**
 * @param {number} status HTTP status
 * @param {string} body response text
 * @returns {{kind:'tool', input:object} | {kind:'no_tool'} | {kind:'refusal'} | {kind:'retry', status:number} | {kind:'fatal', status:number, message:string}}
 */
export function parseClaudeResponse(status, body) {
  let json = null;
  try { json = JSON.parse(body); } catch (e) { json = null; }
  if (status === 200) {
    if (!json || !Array.isArray(json.content)) return { kind: 'retry', status };
    if (json.stop_reason === 'refusal') return { kind: 'refusal' };
    const block = json.content.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
    return block ? { kind: 'tool', input: block.input } : { kind: 'no_tool' };
  }
  if (RETRYABLE.includes(status)) return { kind: 'retry', status };
  return { kind: 'fatal', status, message: (json && json.error && json.error.message) || String(body).slice(0, 300) };
}
