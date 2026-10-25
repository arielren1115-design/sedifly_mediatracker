// Runs the golden set through the same gate and classification step as live ingest.
import { entityGate } from './entityGate.js';
import { classifyItem } from './classifyStep.js';
import { summarise, compareFields } from './metrics.js';

/**
 * @param {object} a
 * @param {object[]} a.cases from parseGolden
 * @param {object[]} a.entities
 * @param {object[]} a.rules active rules
 * @param {string} a.model
 * @param {number} a.threshold
 * @param {string} a.today
 * @param {(request: object, testCase: object) => object} a.call
 * @param {(url: string) => string|null} [a.fetchPageText]
 * @returns {{results: object[], summary: object}}
 */
export function runEval({ cases, entities, rules, model, threshold, today, call, fetchPageText }) {
  const results = [];
  for (const tc of cases) {
    const gate = entityGate({ entities }, tc.item);
    let actual;
    if (gate.outcome === 'ambiguous') actual = { outcome: 'review', reason: 'Ambiguous entity match', classification: null };
    else if (gate.outcome === 'none' && tc.item.route !== 'Team forward') actual = { outcome: 'skip', reason: 'No monitored entity matched', classification: null };
    else {
      const c = {
        model, threshold, today, entities, rules,
        call: (req) => call(req, tc),
        fetchPageText,
        failures: { count: () => 0, add: () => 99, clear: () => {} },
      };
      const r = classifyItem(c, tc.item, { candidates: gate.candidates, route: tc.item.route, messageId: tc.item.gmailMessageId });
      actual = { outcome: r.action === 'coverage' ? 'coverage' : r.action, reason: r.reason || '', classification: r.classification, refetched: r.refetched };
    }
    results.push({ id: tc.id, expected: tc.expected, actual, fieldChecks: actual.classification ? compareFields(tc.expected, actual.classification) : null });
  }
  return { results, summary: summarise(results) };
}

/** Markdown report for the repo. No dashes in user facing text, ranges written "X to Y". */
export function renderReport({ results, summary, model, promptVersion, date, unlabelled }) {
  const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  const lines = [
    '# Classifier evaluation',
    '',
    `Date: ${date}. Model: ${model}. Prompt version: ${promptVersion}. Cases: ${summary.total}. Not yet labelled and skipped: ${unlabelled.length}.`,
    '',
    `- Outcome accuracy (coverage, review or skip): ${pct(summary.outcomeAccuracy)}`,
    `- Routed to review: ${pct(summary.reviewRate)} (target 20% or less)`,
    `- All fields correct on logged items: ${pct(summary.allFieldsCorrect)} of ${summary.scored} (target 95% or more)`,
    `- Targets met: ${summary.meetsTargets ? 'yes' : 'no'}`,
    '',
    '## Per field accuracy',
    '',
    '| Field | Correct | Of | Rate |',
    '|---|---|---|---|',
    ...Object.entries(summary.perField).map(([f, v]) => (v ? `| ${f} | ${v.correct} | ${v.of} | ${pct(v.rate)} |` : `| ${f} | | | n/a |`)),
    '',
    '## Misses',
    '',
  ];
  const misses = results.filter((r) => r.expected.outcome !== r.actual.outcome || (r.fieldChecks && Object.values(r.fieldChecks).includes(false)));
  if (!misses.length) lines.push('None.');
  for (const m of misses) {
    const wrong = m.fieldChecks ? Object.entries(m.fieldChecks).filter(([, ok]) => !ok).map(([f]) => f) : [];
    lines.push(`- ${m.id}: expected ${m.expected.outcome}, got ${m.actual.outcome}${m.actual.reason ? ` (${m.actual.reason})` : ''}${wrong.length ? `; wrong fields: ${wrong.join(', ')}` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}
