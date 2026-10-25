import { getProp, setProp } from './config.js';
import { callClaude } from './claude.js';
import { fetchPageText } from './pageText.js';
import { loadActiveRules } from './rules.js';
import { createFailureCounter } from '../core/failures.js';
import { PLACEHOLDER } from '../core/properties.js';

/** True when a real API key is set. In DEV the key is a placeholder, so ingest runs without classification. */
export function classifierConfigured() {
  const key = getProp('ANTHROPIC_API_KEY');
  return !!key && !key.startsWith(PLACEHOLDER);
}

/**
 * Context for classifyItem. Loads the active rules once per run.
 * @param {object[]} entities monitored entities
 * @returns {object}
 */
export function buildClassifier(entities) {
  return {
    model: getProp('CLAUDE_MODEL'),
    threshold: Number(getProp('CONFIDENCE_THRESHOLD')),
    today: Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM-dd'),
    entities,
    rules: loadActiveRules(),
    call: callClaude,
    fetchPageText,
    failures: createFailureCounter({ read: () => getProp('CLASSIFIER_FAILS'), write: (t) => setProp('CLASSIFIER_FAILS', t), now: () => Date.now() }),
  };
}
