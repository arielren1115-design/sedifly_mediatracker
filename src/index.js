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
import { guarded } from './jobs/guard.js';

const guardedIngest = guarded('runIngest', runIngest);
const guardedReviewSync = guarded('runReviewSync', runReviewSync);
const guardedHeartbeat = guarded('heartbeatCheck', heartbeatCheck);
const guardedDigest = guarded('dailyDigest', dailyDigest);
const guardedDigestNow = guarded('digestNow', digestNow);
const guardedBackfill = guarded('runBackfill', runBackfill);

export {
  setup, simpleView, fullView, compareBlindRun, mergeBlindRun, callClaude,
  guardedIngest as runIngest,
  guardedReviewSync as runReviewSync,
  guardedHeartbeat as heartbeatCheck,
  guardedDigest as dailyDigest,
  guardedDigestNow as digestNow,
  guardedBackfill as runBackfill,
};
