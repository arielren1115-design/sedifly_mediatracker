// One classification, from request to decision (BUILD_SPEC 9.2 and 9.3). The model call is passed in, so the live job
// and the accuracy check use exactly the same logic.
import { buildRequest } from './classifyPrompt.js';
import { validateClassification } from './validateClassification.js';
import { decideOutcome } from './classifyOutcome.js';
import { channelFromUrl } from './channel.js';

export const MAX_FAILED_RUNS = 3;

/** Thrown to leave a message unprocessed so the next run tries it again. */
export class DeferError extends Error {
  constructor(message) {
    super(message);
    this.deferred = true;
  }
}

/**
 * @param {object} c classifier context
 * @param {string} c.model
 * @param {number} c.threshold
 * @param {string} c.today YYYY-MM-DD
 * @param {object[]} c.entities monitored entities
 * @param {object[]} c.rules active rules
 * @param {(request: object) => object} c.call sends one request, see claudeResponse.js for the reply kinds
 * @param {(url: string) => string|null} c.fetchPageText
 * @param {{count: (id: string) => number, add: (id: string) => number, clear: (id: string) => void}} c.failures
 * @param {object} item RawItem
 * @param {{candidates: object[], route: string, messageId: string}} ctx
 * @returns {{action: 'coverage'|'review'|'skip', reason?: string, classification: object|null, refetched: boolean}}
 */
export function classifyItem(c, item, { candidates, route, messageId }) {
  const lists = { entityNames: c.entities.map((e) => e.name), ruleIds: c.rules.map((r) => r.id) };

  const attempt = (pageText) => {
    const request = buildRequest({ model: c.model, item: pageText ? { ...item, pageText } : item, candidates, entities: c.entities, rules: c.rules, today: c.today });
    const reply = c.call(request);
    if (reply.kind === 'tool') return { validation: validateClassification(reply.input, lists) };
    if (reply.kind === 'no_tool' || reply.kind === 'refusal') return { validation: { ok: false, errors: [reply.kind] } };
    return { failure: reply };
  };

  const first = attempt(null);
  if (first.failure) {
    const n = c.failures.add(messageId);
    if (n >= MAX_FAILED_RUNS) return { action: 'review', reason: 'Classifier unavailable', classification: null, refetched: false };
    throw new DeferError(`Classifier unavailable (attempt ${n} of ${MAX_FAILED_RUNS})`);
  }
  c.failures.clear(messageId);

  const canRefetch = !!item.url && !channelFromUrl(item.url) && typeof c.fetchPageText === 'function';
  let validation = first.validation;
  let refetched = false;
  let decision = decideOutcome(validation, { route, threshold: c.threshold, canRefetch, alreadyRefetched: false });

  if (decision.action === 'refetch') {
    const text = c.fetchPageText(item.url);
    if (!text) {
      decision = decideOutcome(validation, { route, threshold: c.threshold, canRefetch: false, alreadyRefetched: true });
    } else {
      const second = attempt(text);
      refetched = true;
      if (!second.failure) validation = second.validation;
      decision = decideOutcome(validation, { route, threshold: c.threshold, canRefetch: true, alreadyRefetched: true });
    }
  }
  return { action: decision.action, ...(decision.reason ? { reason: decision.reason } : {}), classification: validation.ok ? validation.value : null, refetched };
}
