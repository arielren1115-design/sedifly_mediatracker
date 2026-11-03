import { assertConfig, getProp, targetSpreadsheetId } from '../gas/config.js';
import { appendObjects, assertTabsReady } from '../gas/sheets.js';
import { allocateCoverageIds } from '../gas/coverageIds.js';
import { appendRunLog, log } from '../gas/runLog.js';
import { loadOldPlan, writeReportTab, readImportedState } from '../gas/oldImport.js';
import { buildReport, toImportedCoverageRow, toPlacementRow } from '../core/oldImport.js';

const BATCH_STORIES = 250;

function withLock(name, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) { log(`${name} SKIPPED (locked)`); return { status: 'SKIPPED' }; }
  try { return fn(); } finally { lock.releaseLock(); }
}

/**
 * Reads the Old tracker and writes only the Import Report tab: what would be imported, how rows are grouped, and what to check.
 * Nothing is added to Coverage. Run it, review it with Ben, then run importOld.
 */
export function importOldDryRun() {
  return withLock('importOldDryRun', () => {
    assertConfig();
    const startedAt = new Date();
    const ss = SpreadsheetApp.openById(targetSpreadsheetId());
    assertTabsReady(ss);
    const { tabs, plan, missing, extra } = loadOldPlan();
    const { lines, balanced } = buildReport({ tabs, missing, extra, plan });
    writeReportTab(ss, lines);
    const note = `Dry run: ${plan.outcomes.story} stories, ${plan.outcomes.placement} placements, ${plan.outcomes.duplicate} duplicate links. ${balanced ? 'Every row accounted for.' : 'ROWS DO NOT ADD UP.'}`;
    appendRunLog(ss, { runId: Utilities.getUuid(), fn: 'importOldDryRun', startedAt, durationMs: Date.now() - startedAt.getTime(), summary: { note }, status: balanced ? 'OK' : 'FAILED' });
    log(note);
    return { status: balanced ? 'OK' : 'FAILED', ...plan.outcomes, note };
  });
}

/**
 * Imports the Old tracker into Coverage and Syndicated Placements. Needs the Script Property IMPORT_CONFIRMED set to YES, as a deliberate
 * step after the dry run was reviewed. Resumable: run it again until it says complete. Writes nothing twice. Never sends an alert.
 */
export function importOld() {
  return withLock('importOld', () => {
    assertConfig();
    if (getProp('IMPORT_CONFIRMED') !== 'YES') throw new Error('Set the Script Property IMPORT_CONFIRMED to YES after the dry run has been reviewed, then run importOld again.');
    const startedAt = new Date();
    const t0 = Date.now();
    const budget = Number(getProp('RUN_TIME_BUDGET_MS'));
    const ss = SpreadsheetApp.openById(targetSpreadsheetId());
    assertTabsReady(ss);
    const { plan } = loadOldPlan();
    const coverage = ss.getSheetByName('Coverage');
    const placements = ss.getSheetByName('Syndicated Placements');
    const { rowToId, placed } = readImportedState(ss);
    const now = new Date();
    let storiesWritten = 0;
    let placementsWritten = 0;
    let remaining = 0;

    const pending = plan.stories.filter((s) => !rowToId.has(s.main.key) || s.placements.some((p) => !placed.has(p.key)));
    for (let i = 0; i < pending.length; i += BATCH_STORIES) {
      if (Date.now() - t0 > budget) { remaining = pending.length - i; break; }
      const batch = pending.slice(i, i + BATCH_STORIES);
      const fresh = batch.filter((s) => !rowToId.has(s.main.key));
      const ids = fresh.length ? allocateCoverageIds(fresh.length) : [];
      fresh.forEach((s, n) => { s.coverageId = ids[n]; });
      if (fresh.length) {
        appendObjects(coverage, fresh.map((s) => toImportedCoverageRow(s, { coverageId: s.coverageId, now })));
        fresh.forEach((s) => rowToId.set(s.main.key, s.coverageId));
        storiesWritten += fresh.length;
      }
      const lines = [];
      for (const s of batch) {
        const coverageId = rowToId.get(s.main.key);
        for (const p of s.placements) if (!placed.has(p.key)) { lines.push(toPlacementRow(s, p, { coverageId })); placed.add(p.key); }
      }
      if (lines.length) { appendObjects(placements, lines); placementsWritten += lines.length; }
    }
    const complete = remaining === 0;
    const note = `Import ${complete ? 'complete' : `paused, ${remaining} stories left, run importOld again`}: ${storiesWritten} stories and ${placementsWritten} placements written this run (${plan.outcomes.story} stories and ${plan.outcomes.placement} placements in total).`;
    appendRunLog(ss, { runId: Utilities.getUuid(), fn: 'importOld', startedAt, durationMs: Date.now() - t0, summary: { newRows: storiesWritten, duplicates: placementsWritten, note }, status: 'OK' });
    log(note);
    return { status: complete ? 'COMPLETE' : 'PAUSED', storiesWritten, placementsWritten, remaining, note };
  });
}
