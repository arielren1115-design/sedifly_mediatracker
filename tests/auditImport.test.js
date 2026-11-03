import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseAudit, planAudit, toAuditCoverageRow, buildAuditReport, auditTag } from '../src/core/auditImport.js';
import { COVERAGE_HEADERS } from '../src/core/schema.js';
import { parseCsv } from '../src/core/csv.js';
import { makeEnv, goodProps, load, fakeSheet } from './helpers/fakeGas.js';

const FILE = 'Sedifly_Historical_Media_Audit_Findings_2026-11-03.csv';
const TEXT = readFileSync(new URL(`../fixtures/audit/${FILE}`, import.meta.url), 'utf8');
const NAMES = ['Sedifly', 'Joash Lee'];

test('the audit file is read as 10 rows with a file tag, and nothing invalid is hidden', () => {
  const p = parseAudit(TEXT, { fileName: FILE, entityNames: NAMES });
  assert.equal(p.records.length, 10);
  assert.equal(auditTag(FILE), '2026-11-03');
  assert.equal(p.records[0].key, 'Audit 2026-11-03 row 2');
  assert.equal(p.records[0].ms, Date.UTC(2025, 9, 27, 4));
  assert.equal(p.records[6].dateIso, null, 'the listings have no date');
  assert.deepEqual(p.records.map((r) => r.problems.length), Array(10).fill(0));
  const bad = parseAudit('date,URL,outlet,title/topic,source type,category,entity,review status\n2026-13-45,not a link,X,T,Podcast,Press,Nobody,Needs verification', { fileName: 'a.csv', entityNames: NAMES });
  assert.deepEqual(bad.records[0].problems.length, 5);
  assert.equal(parseAudit('a,b\n1,2', { fileName: 'a', entityNames: NAMES }).error.startsWith('The audit file is missing the columns'), true);
});

test('a link already in the tracker, a repeat and an already imported row are not added again', () => {
  const p = parseAudit(TEXT, { fileName: FILE, entityNames: NAMES });
  const existing = new Map([[p.records[1].norm, 'COV-000010']]);
  const planned = planAudit([...p.records, { ...p.records[3], n: 99, key: 'Audit 2026-11-03 row 99' }], existing, new Set(['Audit 2026-11-03 row 4']));
  assert.equal(planned[1].outcome, 'in tracker');
  assert.equal(planned[1].coverageId, 'COV-000010');
  assert.equal(planned[2].outcome, 'already imported');
  assert.equal(planned[10].outcome, 'repeat in file');
  assert.equal(planned.filter((r) => r.outcome === 'new').length, 8);
  const lines = buildAuditReport(planned, FILE);
  assert.ok(lines.some((l) => l[0] === 'Adds up' && l[1] === 'yes'));
});

test('an audit row is Needs verification, Found in Audit, its own Source route, no alert time, and keeps the file row', () => {
  const p = parseAudit(TEXT, { fileName: FILE, entityNames: NAMES });
  const row = toAuditCoverageRow(p.records[7], { coverageId: 'COV-000020', now: new Date(0) });
  for (const k of Object.keys(row)) assert.ok(COVERAGE_HEADERS.includes(k), k);
  assert.equal(row.Verification, 'Needs verification');
  assert.equal(row['Found in'], 'Audit');
  assert.equal(row['Source route'], 'Backfill: audit');
  assert.equal(row['Import source'], 'Audit 2026-11-03 row 9');
  assert.equal(row['Source type'], 'Non-Media Listings');
  assert.equal(row.Channel, 'Listing');
  assert.equal(row.Entity, 'Sedifly');
  assert.equal('Instant alert sent' in row, false);
  assert.match(row.Notes, /^Found by the historical audit/);
});

async function ready(extra = {}) {
  const env = makeEnv({ ...goodProps(), AUDIT_FILE_ID: 'file1', ...extra });
  env.state.files = { file1: { name: FILE, text: TEXT } };
  const ents = fakeSheet('Monitored Entities');
  parseCsv(readFileSync(new URL('../fixtures/config/entities.csv', import.meta.url), 'utf8')).forEach((r) => ents.rows.push(r));
  const sb = await load(env);
  vm.runInContext('setup()', sb);
  env.sheets.x['Monitored Entities'] = ents;
  return { env, run: (c) => vm.runInContext(c, sb) };
}
const col = (sheet, h) => sheet.rows[0].indexOf(h);

test('audit dry run writes only the Audit Report tab', async () => {
  const { env, run } = await ready();
  const r = run('importAuditDryRun()');
  assert.equal(r.wouldAdd, 10);
  assert.equal(env.sheets.x.Coverage.rows.length, 1);
  assert.equal(env.sheets.x['Audit Report'].rows[0][0], 'Historical audit import report');
});

test('importAudit needs confirmation, adds 10 rows once, sends no mail, and keeps them apart from the Old import', async () => {
  const { env, run } = await ready({ ALERT_RECIPIENTS: 'alerts@example.com' });
  assert.throws(() => run('importAudit()'), /IMPORT_CONFIRMED/);
  env.mail.length = 0; // the refusal above emailed the ops address, as any failed job does
  env.store.IMPORT_CONFIRMED = 'YES';
  assert.equal(run('importAudit()').added, 10);
  const cov = env.sheets.x.Coverage;
  assert.equal(cov.rows.length - 1, 10);
  assert.ok(cov.rows.slice(1).every((x) => x[col(cov, 'Source route')] === 'Backfill: audit' && x[col(cov, 'Verification')] === 'Needs verification' && x[col(cov, 'Found in')] === 'Audit' && x[col(cov, 'Instant alert sent')] === ''));
  assert.deepEqual(env.mail, []);
  assert.equal(run('importAudit()').added, 0, 'a second run adds nothing');
  assert.equal(cov.rows.length - 1, 10);
});

test('an audit link already in Coverage is skipped and reported', async () => {
  const { env, run } = await ready({ IMPORT_CONFIRMED: 'YES' });
  const cov = env.sheets.x.Coverage;
  cov.rows.push(COVERAGE_HEADERS.map((h) => ({ 'Coverage ID': 'COV-000003', 'Normalised URL': 'https://acumenstories.com/democratizing-access-to-education' }[h] ?? '')));
  run('importAuditDryRun()');
  const rep = env.sheets.x['Audit Report'].rows;
  assert.ok(rep.some((l) => l[1] === 'in tracker' && /COV-000003/.test(l[2])));
  assert.equal(run('importAudit()').added, 9);
});
