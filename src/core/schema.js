// Sheet tabs and headers from BUILD_SPEC section 6. Columns are always addressed by header name.

/** @type {string[]} */
export const COVERAGE_HEADERS = [
  'Coverage ID', 'Detected at', 'Published at', 'Entity', 'Channel', 'Outlet', 'Outlet tier',
  'Title', 'URL', 'Normalised URL', 'Excerpt', 'Category', 'Priority', 'Sentiment',
  'Rules matched', 'Instant alert sent', 'Archive status', 'Archive link', 'Found in',
  'Verification', 'Source route', 'Gmail message ID', 'Classifier confidence', 'Logged by',
  'Notes', 'Last updated',
];

/** Review Queue = every Coverage column plus the review columns (spec 6.2). */
export const REVIEW_QUEUE_HEADERS = [
  ...COVERAGE_HEADERS,
  'Review reason', 'Decision', 'Reviewed by', 'Synced at',
];

export const RUN_LOG_HEADERS = [
  'Run ID', 'Function', 'Started at', 'Duration ms', 'Messages seen', 'Items parsed', 'New rows',
  'Duplicates', 'To review', 'Skipped (no entity)', 'Capture failures', 'Errors',
  'Status (OK / PARTIAL / FAILED)', 'Detail',
];

export const TABS = {
  Coverage: COVERAGE_HEADERS,
  'Review Queue': REVIEW_QUEUE_HEADERS,
  'Run Log': RUN_LOG_HEADERS,
};

/** Number formats for date columns, so the time is visible. Published at is a date only. */
export const DATETIME_FORMATS = {
  'Detected at': 'yyyy-mm-dd hh:mm:ss',
  'Instant alert sent': 'yyyy-mm-dd hh:mm:ss',
  'Last updated': 'yyyy-mm-dd hh:mm:ss',
  'Synced at': 'yyyy-mm-dd hh:mm:ss',
  'Started at': 'yyyy-mm-dd hh:mm:ss',
  'Published at': 'yyyy-mm-dd',
};

export const REVIEW_DECISIONS = ['Approve', 'Reject'];

export const LABELS = [
  'Monitoring/Automated',
  'Monitoring/Team Forward',
  'Monitoring/Processed',
  'Monitoring/Review',
];

/**
 * Trigger plan from spec section 14. `every` is minutes or hours, `atHour` is project time (Asia/Singapore).
 * @type {{handler: string, everyMinutes?: number, everyHours?: number, atHour?: number}[]}
 */
export const TRIGGERS = [
  { handler: 'runIngest', everyMinutes: 5 },
  { handler: 'runReviewSync', everyMinutes: 5 },
  { handler: 'heartbeatCheck', everyHours: 1 },
  { handler: 'dailyDigest', atHour: 9 },
];

/**
 * Headers that are missing from a sheet's existing header row. Never removes or reorders anything.
 * @param {string[]} existing existing header row, trailing blanks allowed
 * @param {string[]} wanted
 * @returns {string[]} headers to append, in spec order
 */
export function missingHeaders(existing, wanted) {
  const have = new Set(existing.map((h) => String(h).trim()).filter(Boolean));
  return wanted.filter((h) => !have.has(h));
}
