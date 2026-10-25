// Validates the classifier's tool output against the allowed lists (BUILD_SPEC 9.3).
import { CATEGORIES, PRIORITIES, SENTIMENTS, CHANNELS } from './taxonomy.js';

const trimWords = (text, max) => {
  const words = text.trim().split(/\s+/);
  return words.length > max ? words.slice(0, max).join(' ') : text.trim();
};

const validDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

/**
 * @param {*} output the tool input returned by the model
 * @param {{entityNames: string[], ruleIds: string[]}} lists allowed entity names and active rule ids
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
export function validateClassification(output, { entityNames, ruleIds }) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return { ok: false, errors: ['The output is not an object'] };
  const errors = [];
  const o = output;
  const isString = (k) => { if (typeof o[k] !== 'string') { errors.push(`${k} must be text`); return false; } return true; };
  const oneOf = (k, list) => { if (!list.includes(o[k])) errors.push(`${k} "${o[k]}" is not an allowed value`); };

  if (typeof o.is_relevant !== 'boolean') errors.push('is_relevant must be true or false');
  if (typeof o.critical_signal !== 'boolean') errors.push('critical_signal must be true or false');
  if (typeof o.confidence !== 'number' || !(o.confidence >= 0 && o.confidence <= 1)) errors.push('confidence must be a number from 0 to 1');
  for (const k of ['outlet', 'title', 'summary', 'reasoning']) isString(k);
  oneOf('channel', CHANNELS);
  oneOf('category', CATEGORIES.map((c) => c.value));
  oneOf('priority', PRIORITIES.map((p) => p.value));
  oneOf('sentiment', SENTIMENTS);

  if (o.entity === null) {
    if (o.is_relevant === true) errors.push('a relevant item must name an entity');
  } else if (!entityNames.includes(o.entity)) {
    errors.push(`entity "${o.entity}" is not a monitored entity`);
  }
  if (o.published_date !== null && !(typeof o.published_date === 'string' && validDate(o.published_date))) errors.push('published_date must be YYYY-MM-DD or null');
  if (!Array.isArray(o.matched_rule_ids)) errors.push('matched_rule_ids must be a list');
  else for (const id of o.matched_rule_ids) if (!ruleIds.includes(id)) errors.push(`rule ${id} is not an active rule`);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { ...o, matched_rule_ids: [...new Set(o.matched_rule_ids)], summary: trimWords(o.summary, 30), reasoning: trimWords(o.reasoning, 50) },
  };
}
