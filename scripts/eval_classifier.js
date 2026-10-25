// Runs the golden set against the Claude API from your own machine (BUILD_SPEC 9.4).
//   ANTHROPIC_API_KEY=... node scripts/eval_classifier.js [--golden path] [--model id] [--dry-run]
// --dry-run answers every case with its own labels, to prove the harness without calling the API.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCsv } from '../src/core/csv.js';
import { loadEntities } from '../src/core/entities.js';
import { loadRules, activeRules } from '../src/core/rules.js';
import { parseGolden } from '../src/core/golden.js';
import { runEval, renderReport } from '../src/core/evalRun.js';
import { parseClaudeResponse, RETRY_DELAYS_MS } from '../src/core/claudeResponse.js';
import { PROMPT_VERSION } from '../src/core/classifyPrompt.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const dryRun = args.includes('--dry-run');
const goldenPath = flag('--golden') || path.join(root, 'fixtures/golden/golden.csv');
const model = flag('--model') || process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const key = process.env.ANTHROPIC_API_KEY;

if (!existsSync(goldenPath)) { console.error(`No golden set at ${goldenPath}. Copy golden_template.csv to golden.csv and fill it in.`); process.exit(1); }
if (!dryRun && !key) { console.error('Set ANTHROPIC_API_KEY in your environment (never in a file).'); process.exit(1); }

const readCsv = (p) => parseCsv(readFileSync(p, 'utf8'));
const entities = loadEntities(readCsv(path.join(root, 'fixtures/config/entities.csv')));
const rules = activeRules(loadRules(readCsv(path.join(root, 'fixtures/config/rules.csv'))));
const { cases, unlabelled } = parseGolden(readCsv(goldenPath));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function apiCall(request) {
  let last = { kind: 'retry', status: null };
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt) sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const out = execFileSync('curl', ['-sS', '-m', '120', '-w', '\n%{http_code}', 'https://api.anthropic.com/v1/messages',
        '-H', `x-api-key: ${key}`, '-H', 'anthropic-version: 2023-06-01', '-H', 'content-type: application/json', '-d', '@-'],
      { input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
      const cut = out.lastIndexOf('\n');
      last = parseClaudeResponse(Number(out.slice(cut + 1)), out.slice(0, cut));
    } catch (e) {
      last = { kind: 'retry', status: null };
    }
    if (last.kind !== 'retry') return last;
  }
  return last;
}

const oracle = (_request, tc) => {
  const e = tc.expected;
  const relevant = e.outcome !== 'skip';
  return {
    kind: 'tool',
    input: {
      is_relevant: relevant, entity: relevant ? e.entity || entities[0].name : null, channel: e.channel || 'News', source_type: e.source_type || 'Media',
      outlet: tc.item.outlet || '', title: tc.item.title || '', published_date: null, category: e.category || 'General', priority: e.priority || 'Standard',
      sentiment: e.sentiment || 'Neutral', matched_rule_ids: e.ruleIds, critical_signal: false, summary: 'Oracle.', confidence: e.outcome === 'review' ? 0.3 : 0.95, reasoning: 'Oracle.',
    },
  };
};

const today = new Date().toISOString().slice(0, 10);
const { results, summary } = runEval({ cases, entities, rules, model, threshold: 0.7, today, call: dryRun ? oracle : apiCall });
const report = renderReport({ results, summary, model: dryRun ? 'dry run (labels as answers)' : model, promptVersion: PROMPT_VERSION, date: today, unlabelled });
console.log(report);
if (!dryRun) {
  mkdirSync(path.join(root, 'reports'), { recursive: true });
  writeFileSync(path.join(root, 'reports', `eval_${today}.md`), report);
  writeFileSync(path.join(root, 'reports', `eval_${today}.json`), JSON.stringify({ model, promptVersion: PROMPT_VERSION, summary, results }, null, 2));
}
