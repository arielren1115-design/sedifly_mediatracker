// Accuracy numbers for the golden set (BUILD_SPEC 9.4).

export const FIELDS = ['entity', 'category', 'source_type', 'channel', 'priority', 'sentiment', 'rules'];

/**
 * Compares one classification with the labels. Fields left blank in the golden set are not checked.
 * @returns {Object<string, boolean>} field to correct, only for the labelled fields
 */
export function compareFields(expected, c) {
  const out = {};
  const check = (field, want, got) => { if (want) out[field] = want === got; };
  check('entity', expected.entity, c.entity);
  check('category', expected.category, c.category);
  check('source_type', expected.source_type, c.source_type);
  check('channel', expected.channel, c.channel);
  check('priority', expected.priority, c.priority);
  check('sentiment', expected.sentiment, c.sentiment);
  if (expected.ruleIds.length) {
    const got = [...c.matched_rule_ids].sort().join(',');
    out.rules = got === [...expected.ruleIds].sort().join(',');
  }
  return out;
}

/**
 * @param {{id: string, expected: object, actual: {outcome: string, classification: object|null}}[]} results
 * @returns {object} totals, per field accuracy, all fields correct share and review rate
 */
export function summarise(results) {
  const total = results.length;
  const outcomeRight = results.filter((r) => r.expected.outcome === r.actual.outcome).length;
  const reviewed = results.filter((r) => r.actual.outcome === 'review').length;
  const scored = results.filter((r) => r.expected.outcome === 'coverage' && r.actual.outcome === 'coverage' && r.actual.classification);
  const perField = {};
  for (const f of FIELDS) {
    const rows = scored.map((r) => compareFields(r.expected, r.actual.classification)).filter((c) => f in c);
    perField[f] = rows.length ? { correct: rows.filter((c) => c[f]).length, of: rows.length, rate: rows.filter((c) => c[f]).length / rows.length } : null;
  }
  const allRight = scored.filter((r) => Object.values(compareFields(r.expected, r.actual.classification)).every(Boolean)).length;
  return {
    total,
    outcomeAccuracy: total ? outcomeRight / total : null,
    reviewRate: total ? reviewed / total : null,
    scored: scored.length,
    allFieldsCorrect: scored.length ? allRight / scored.length : null,
    perField,
    meetsTargets: scored.length > 0 && allRight / scored.length >= 0.95 && reviewed / total <= 0.2,
  };
}
