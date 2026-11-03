import { assertConfig, getProp, targetSpreadsheetId } from '../gas/config.js';
import { appendObjects, assertTabsReady, readIndexRows } from '../gas/sheets.js';
import { allocateCoverageIds } from '../gas/coverageIds.js';
import { loadMonitoredEntities } from '../gas/entities.js';
import { appendRunLog, log } from '../gas/runLog.js';
import { writeReportTab, readImportedState } from '../gas/oldImport.js';
import { PLACEHOLDER } from '../core/properties.js';
import { parseAudit, planAudit, toAuditCoverageRow, buildAuditReport } from '../core/auditImport.js';

/** Reads the audit CSV from Drive (read only) and works out what each row would do. */
function loadAuditPlan(ss) {
  const id = getProp('AUDIT_FILE_ID');
  if (!id || id.startsWith(PLACEHOLDER)) throw new Error('AUDIT_FILE_ID is not set. Set it to the Drive file ID of the audit CSV.');
  const file = DriveApp.getFileById(id);
  const parsed = parseAudit(file.getBlob().getDataAsString('UTF-8'), { fileName: file.getName(), entityNames: loadMonitoredEntities().map((e) => e.name) });
  if (parsed.error) throw new Error(parsed.error);
  const existing = new Map();
  for (const r of readIndexRows(ss)) if (r.sheet === 'Coverage' && r.normalisedUrl && r.coverageId) existing.set(r.normalisedUrl, r.coverageId);
  const { rowToId } = readImportedState(ss);
  return { fileName: file.getName(), planned: planAudit(parsed.records, existing, new Set(rowToId.keys())) };
}

function withLock(name, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) { log(`${name} SKIPPED (locked)`); return { status: 'SKIPPED' }; }
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Writes only an Audit Report tab: what each audit row would do. Nothing is added to Coverage. */
export function importAuditDryRun() {
  return withLock('importAuditDryRun', () => {
    assertConfig();
    const startedAt = new Date();
    const ss = SpreadsheetApp.openById(targetSpreadsheetId());
    assertTabsReady(ss);
    const { fileName, planned } = loadAuditPlan(ss);
    writeReportTab(ss, buildAuditReport(planned, fileName), 'Audit Report');
    const n = planned.filter((r) => r.outcome === 'new').length;
    appendRunLog(ss, { runId: Utilities.getUuid(), fn: 'importAuditDryRun', startedAt, durationMs: Date.now() - startedAt.getTime(), summary: { note: `Audit dry run: ${n} of ${planned.length} rows would be added` }, status: 'OK' });
    return { status: 'OK', rows: planned.length, wouldAdd: n };
  });
}

/**
 * Adds the audit finds to Coverage as Needs verification, Found in Audit, Source route Backfill: audit. Separate from the Old tracker
 * import. Needs IMPORT_CONFIRMED = YES. Links already in the tracker are skipped and listed. Never sends an alert.
 */
export function importAudit() {
  return withLock('importAudit', () => {
    assertConfig();
    if (getProp('IMPORT_CONFIRMED') !== 'YES') throw new Error('Set the Script Property IMPORT_CONFIRMED to YES after the audit dry run has been reviewed, then run importAudit again.');
    const startedAt = new Date();
    const ss = SpreadsheetApp.openById(targetSpreadsheetId());
    assertTabsReady(ss);
    const { planned } = loadAuditPlan(ss);
    const fresh = planned.filter((r) => r.outcome === 'new');
    if (fresh.length) {
      const ids = allocateCoverageIds(fresh.length);
      const now = new Date();
      appendObjects(ss.getSheetByName('Coverage'), fresh.map((r, i) => toAuditCoverageRow(r, { coverageId: ids[i], now })));
    }
    const skipped = planned.length - fresh.length;
    const note = `Audit import: ${fresh.length} rows added, ${skipped} skipped (already in the tracker, repeated or already imported).`;
    appendRunLog(ss, { runId: Utilities.getUuid(), fn: 'importAudit', startedAt, durationMs: Date.now() - startedAt.getTime(), summary: { newRows: fresh.length, duplicates: skipped, note }, status: 'OK' });
    log(note);
    return { status: 'COMPLETE', added: fresh.length, skipped, note };
  });
}
