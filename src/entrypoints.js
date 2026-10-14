// Apps Script triggers and the Run menu need top level function names. Each one just calls into App.
function setup() { return App.setup(); }
function runIngest() { return App.runIngest(); }
function runReviewSync() { return App.runReviewSync(); }
function heartbeatCheck() { return App.heartbeatCheck(); }
function dailyDigest() { return App.dailyDigest(); }
function runBackfill(step) { return App.runBackfill(step); }
function compareBlindRun() { return App.compareBlindRun(); }
function mergeBlindRun(opts) { return App.mergeBlindRun(opts); }
