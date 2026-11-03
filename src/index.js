// Bundle entry. esbuild exposes these as the global `App`.
// Trigger functions are wrapped so an uncaught error is logged and emailed (spec 13).
import { setup } from './jobs/setup.js';
import { runIngest } from './jobs/ingest.js';
import { runReviewSync } from './jobs/reviewSync.js';
import { dailyDigest, digestNow } from './jobs/digest.js';
import { runBackfill } from './jobs/backfill.js';
import { compareBlindRun, mergeBlindRun } from './jobs/blind.js';
import { heartbeatCheck } from './gas/heartbeat.js';
import { callClaude } from './gas/claude.js';
import { simpleView, fullView } from './jobs/view.js';
import { importOldDryRun, importOld } from './jobs/oldImport.js';
import { importAuditDryRun, importAudit } from './jobs/auditImport.js';
import { guarded } from './jobs/guard.js';

const guardedIngest = guarded('runIngest', runIngest);
const guardedReviewSync = guarded('runReviewSync', runReviewSync);
const guardedHeartbeat = guarded('heartbeatCheck', heartbeatCheck);
const guardedDigest = guarded('dailyDigest', dailyDigest);
const guardedDigestNow = guarded('digestNow', digestNow);
const guardedBackfill = guarded('runBackfill', runBackfill);
const guardedImportDry = guarded('importOldDryRun', importOldDryRun);
const guardedImport = guarded('importOld', importOld);
const guardedAuditDry = guarded('importAuditDryRun', importAuditDryRun);
const guardedAudit = guarded('importAudit', importAudit);

export {
  setup, simpleView, fullView, compareBlindRun, mergeBlindRun, callClaude,
  guardedIngest as runIngest,
  guardedReviewSync as runReviewSync,
  guardedHeartbeat as heartbeatCheck,
  guardedDigest as dailyDigest,
  guardedDigestNow as digestNow,
  guardedBackfill as runBackfill,
  guardedImportDry as importOldDryRun,
  guardedImport as importOld,
  guardedAuditDry as importAuditDryRun,
  guardedAudit as importAudit,
};
