// Sheet tabs and headers from BUILD_SPEC section 6. Columns are always addressed by header name.

/** @type {string[]} */
export const COVERAGE_HEADERS = [
  'Coverage ID', 'Detected at', 'Published at', 'Entity', 'Channel', 'Source type', 'Outlet', 'Outlet tier',
  'Title', 'URL', 'Normalised URL', 'Excerpt', 'Category', 'Priority', 'Sentiment',
  'Rules matched', 'Instant alert sent', 'Archive status', 'Archive link', 'Found in',
  'Verification', 'Source route', 'Syndicated copies', 'Gmail message ID', 'Classifier confidence', 'Logged by',
  'Submitted by', 'Notes', 'Last updated',
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

/** One line per extra placement of a story (same headline on another site), so a grouped story keeps every placement (owner decision 2026-11-03). */
export const PLACEMENT_HEADERS = [
  'Story ID', 'Story URL', 'Placement URL', 'Placement normalised URL', 'Outlet', 'Title', 'Detected at', 'Source route', 'Origin', 'Submitted by', 'Gmail message ID',
];

export const TABS = {
  Coverage: COVERAGE_HEADERS,
  'Review Queue': REVIEW_QUEUE_HEADERS,
  'Run Log': RUN_LOG_HEADERS,
  'Syndicated Placements': PLACEMENT_HEADERS,
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

/** Source type values (owners, 2026-10-25). Kept here for the dropdown; definitions live in taxonomy.js. */
export const SOURCE_TYPE_VALUES = ['Media', 'Social Media', 'Non-Media Listings'];

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

/** What each column records, shown as a note on its header cell (hover over the header). Plain English for the marketing team. */
export const COLUMN_HELP = {
  'Coverage ID': 'Permanent ID for this item, like COV-000017. Never reused.',
  'Detected at': 'When the tool (or a person) first logged the item. Singapore time.',
  'Published at': 'Date the article or post was published, if known. Often blank for alerts.',
  Entity: 'Who or what the item is about: Sedifly, Joash Lee, a strategist, a partner or an event.',
  Channel: 'Where it appeared: News, Blog, Listing, Reddit, Hacker News, Forum, Social, Podcast or Other.',
  'Source type': 'Media, Social Media or Non-Media Listings.',
  Outlet: 'Publication, subreddit or website name.',
  'Outlet tier': 'Tier of the outlet. Stays blank until a tier list exists.',
  Title: 'Headline or post title. Blank for forwarded links until the page is read.',
  URL: 'The link as received, with redirect wrappers removed.',
  'Normalised URL': 'Cleaned copy of the link, used only to spot duplicates. Do not edit.',
  Excerpt: 'Up to 500 characters around the mention.',
  Category: 'General, Event, Brand or Strategist.',
  Priority: 'Critical, High, Standard or Low.',
  Sentiment: 'Positive, Neutral, Negative or Unclear.',
  'Rules matched': 'Monitoring Rule IDs that applied, for example MR-006.',
  'Instant alert sent': 'When an instant alert email went out for this item. Blank means none was sent.',
  'Archive status': 'Pending, Filed, Filed (PNG), Save by hand, Screenshot needed or Not required. Archiving is paused for now, so rows stay Pending.',
  'Archive link': 'Drive link to the saved copy. Blank while archiving is paused.',
  'Found in': 'Which system found it: Old, Tool, Archive or Manual.',
  Verification: 'Verified once a person has checked the source (for example approved in the Review Queue). Needs verification until then. Never set from the AI confidence.',
  'Source route': 'How it reached us: Google Alerts, Talkwalker, F5Bot or Team forward. Several if more than one.',
  'Syndicated copies': 'How many other websites ran the same headline. Counted here instead of adding rows.',
  'Gmail message ID': 'Technical ID of the email. Stops the same email being processed twice. Do not edit.',
  'Classifier confidence': 'How sure the AI was about its labels, from 0 to 1. Below 0.70 goes to the Review Queue. This is separate from Verification and does not mean the source is verified.',
  'Logged by': 'script for the tool, or a person.',
  'Submitted by': 'Email address of the team member who forwarded the link. Blank for automatic alerts. Several if more than one person sent it.',
  Notes: 'Free text for people. The tool never changes this.',
  'Last updated': 'Last time the tool changed the row.',
  'Review reason': 'Why the item is in the Review Queue.',
  Decision: 'Choose Approve to copy the row into Coverage (fix any wrong cells first), or Reject to keep it here only.',
  'Reviewed by': 'Email of the person who made the decision.',
  'Synced at': 'When the decision was processed. Filled by the tool.',
  'Story ID': 'Coverage ID of the story this placement belongs to. Blank until that story is approved out of the Review Queue.',
  'Story URL': 'Cleaned link of the main row of the story. Used to match the placement to its story.',
  'Placement URL': 'The link of this extra placement of the same story on another site.',
  'Placement normalised URL': 'Cleaned copy of the placement link. Do not edit.',
  Origin: 'Live for items found by the tool, or the Old tracker tab and row for imported history.',
  'Run ID': 'Unique ID of one run.', Function: 'Which job ran.', 'Started at': 'When the run began.', 'Duration ms': 'How long the run took in milliseconds.',
  'Messages seen': 'Emails looked at.', 'Items parsed': 'Links or mentions found in them.', 'New rows': 'Rows added to Coverage.',
  Duplicates: 'Items already in the sheet, or copies counted on an existing row.', 'To review': 'Items or emails sent to review.',
  'Skipped (no entity)': 'Alert results ignored because no monitored name matched.', 'Capture failures': 'Archive captures that failed. Zero while archiving is paused.',
  Errors: 'Messages that failed.', 'Status (OK / PARTIAL / FAILED)': 'OK, PARTIAL (some problem) or FAILED.', Detail: 'Technical detail of what happened.',
};

/** Columns the simple view hides, because marketing does not need them day to day. Nothing is deleted or moved. */
export const SIMPLE_VIEW_HIDDEN = {
  Coverage: ['Outlet tier', 'Normalised URL', 'Archive status', 'Archive link', 'Found in', 'Gmail message ID', 'Classifier confidence', 'Logged by', 'Last updated'],
  'Review Queue': ['Outlet tier', 'Normalised URL', 'Archive status', 'Archive link', 'Found in', 'Gmail message ID', 'Logged by', 'Last updated', 'Synced at'],
};
