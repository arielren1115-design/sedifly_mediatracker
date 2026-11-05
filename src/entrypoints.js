// Apps Script triggers and the Run menu need top level function names. Each one just calls into App.
function setup() { return App.setup(); }
function runIngest() { return App.runIngest(); }
function runReviewSync() { return App.runReviewSync(); }
function heartbeatCheck() { return App.heartbeatCheck(); }
function dailyDigest() { return App.dailyDigest(); }
function digestNow() { return App.digestNow(); } // run by hand to send the digest immediately
function runBackfill(step) { return App.runBackfill(step); }
function compareBlindRun() { return App.compareBlindRun(); }
function mergeBlindRun(opts) { return App.mergeBlindRun(opts); }
function simpleView() { return App.simpleView(); } // run by hand: hide the technical columns
function fullView() { return App.fullView(); } // run by hand: show every column
function importOldDryRun() { return App.importOldDryRun(); } // run by hand: writes only the Import Report tab
function importOld() { return App.importOld(); } // run by hand after the dry run is reviewed and IMPORT_CONFIRMED is YES
function importAuditDryRun() { return App.importAuditDryRun(); } // run by hand: writes only the Audit Report tab
function importAudit() { return App.importAudit(); } // run by hand after the audit dry run is reviewed and IMPORT_CONFIRMED is YES
function backfillReport() { return App.backfillReport(); } // run by hand: writes the Backfill Report tab
function claudeSelfTest() { return App.claudeSelfTest(); } // run by hand: checks the Anthropic key and model with one made up article
