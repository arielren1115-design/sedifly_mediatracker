import { assertConfig, getProp } from '../gas/config.js';
import { callClaude } from '../gas/claude.js';
import { loadMonitoredEntities } from '../gas/entities.js';
import { loadActiveRules } from '../gas/rules.js';
import { classifierConfigured } from '../gas/classifier.js';
import { buildRequest } from '../core/classifyPrompt.js';
import { validateClassification } from '../core/validateClassification.js';
import { entityGate } from '../core/entityGate.js';
import { log } from '../gas/runLog.js';

const SAMPLE = {
  gmailMessageId: 'self-test', route: 'Talkwalker', url: 'https://www.forbes.com/councils/forbesbusinesscouncil/2026/10/13/why-venture-capital-money-isnt-right-for-every-founder/',
  title: "Why Venture Capital Money Isn't Right For Every Founder", outlet: 'forbes.com', alertName: 'Sedifly', publishedAt: null,
  snippet: 'Joash Lee is the Founder and CEO of Sedifly, a global EdTech firm democratizing access to education. With AI companies on a run, raising a venture round feels like the holy grail for many founders...',
};

/**
 * Run by hand: sends one made-up article through exactly the request the live job uses and reports whether the key, the model name and the
 * answer format all work. Writes nothing to any sheet and sends no email. The result is also in the Execution log.
 * @returns {{ok: boolean, step: string, detail: string}}
 */
export function claudeSelfTest() {
  assertConfig();
  if (!classifierConfigured()) return { ok: false, step: 'key', detail: 'ANTHROPIC_API_KEY is still empty or a placeholder.' };
  const entities = loadMonitoredEntities();
  const rules = loadActiveRules();
  const gate = entityGate({ entities }, SAMPLE);
  const request = buildRequest({ model: getProp('CLAUDE_MODEL'), item: SAMPLE, candidates: gate.candidates, entities, rules, today: Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM-dd') });
  const reply = callClaude(request);
  let result;
  if (reply.kind === 'fatal') {
    const hint = reply.status === 401 ? 'The key is not accepted. Check it was pasted whole, with no spaces.'
      : reply.status === 404 ? `The model name "${getProp('CLAUDE_MODEL')}" was not found. Check CLAUDE_MODEL against the model list in the Anthropic Console.`
        : reply.status === 400 ? 'The request was rejected. The message below says why.'
          : reply.status === 403 || reply.status === 402 ? 'The account may need credit or access to this model.' : 'See the message.';
    result = { ok: false, step: `api ${reply.status}`, detail: `${hint} Anthropic says: ${reply.message}` };
  } else if (reply.kind === 'retry') {
    result = { ok: false, step: 'api busy', detail: `Anthropic did not answer (status ${reply.status === null ? 'timeout' : reply.status}) after three tries. Try again in a few minutes.` };
  } else if (reply.kind !== 'tool') {
    result = { ok: false, step: 'format', detail: `The model replied without the expected answer (${reply.kind}).` };
  } else {
    const v = validateClassification(reply.input, { entityNames: entities.map((e) => e.name), ruleIds: rules.map((r) => r.id) });
    result = v.ok
      ? { ok: true, step: 'done', detail: `Works. Model ${getProp('CLAUDE_MODEL')} answered: entity ${v.value.entity}, category ${v.value.category}, priority ${v.value.priority}, sentiment ${v.value.sentiment}, confidence ${v.value.confidence}, rules ${v.value.matched_rule_ids.join(', ') || 'none'}.` }
      : { ok: false, step: 'validation', detail: `The model answered but the answer failed our checks: ${v.errors.join('; ')}` };
  }
  log('claudeSelfTest', result);
  return result;
}
