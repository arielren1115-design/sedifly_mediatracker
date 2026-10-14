// Script Properties contract from BUILD_SPEC section 5.1.

export const REQUIRED_PROPERTIES = [
  'MODE', 'BOT_SPREADSHEET_ID', 'SCRATCH_SPREADSHEET_ID', 'PR_TRACKER_SPREADSHEET_ID',
  'OLD_TRACKER_FILE_ID', 'DRIVE_ROOT_FOLDER_ID', 'DRIVE_SCRATCH_FOLDER_ID',
  'ANTHROPIC_API_KEY', 'CLAUDE_MODEL', 'SCREENSHOTONE_ACCESS_KEY',
  'ALERT_RECIPIENTS', 'ALERT_RECIPIENTS_BLIND', 'OPS_RECIPIENTS', 'TEAM_SENDER_ALLOWLIST',
  'CONFIDENCE_THRESHOLD', 'BATCH_MAX_MESSAGES', 'RUN_TIME_BUDGET_MS', 'BACKFILL_CAPTURE_LIMIT',
];

export const OPTIONAL_PROPERTIES = ['HEARTBEAT_PING_URL'];

/** Managed by the script itself, never required up front. */
export const MANAGED_PROPERTIES = ['NEXT_COVERAGE_ID', 'LAST_SUCCESS_AT'];

export const MODES = ['PROD', 'BLIND'];

/** Value used for secrets that are not needed until a later milestone. */
export const PLACEHOLDER = 'PLACEHOLDER';

/**
 * @param {Object<string,string>} props
 * @returns {{missing: string[], invalid: string[], placeholders: string[]}}
 */
export function validateProperties(props) {
  const missing = REQUIRED_PROPERTIES.filter((k) => props[k] === undefined || String(props[k]).trim() === '');
  const invalid = [];
  if (props.MODE && !MODES.includes(props.MODE)) invalid.push(`MODE must be one of ${MODES.join(', ')}`);
  const num = (k, ok) => {
    if (props[k] !== undefined && props[k] !== '' && !ok(Number(props[k]))) invalid.push(`${k} is not a valid number`);
  };
  num('CONFIDENCE_THRESHOLD', (n) => n > 0 && n <= 1);
  num('BATCH_MAX_MESSAGES', (n) => Number.isInteger(n) && n > 0);
  num('RUN_TIME_BUDGET_MS', (n) => Number.isInteger(n) && n > 0);
  num('BACKFILL_CAPTURE_LIMIT', (n) => Number.isInteger(n) && n >= 0);
  const placeholders = REQUIRED_PROPERTIES.filter((k) => String(props[k] || '').startsWith(PLACEHOLDER));
  return { missing, invalid, placeholders };
}
