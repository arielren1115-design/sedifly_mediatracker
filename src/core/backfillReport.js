// The Backfill Report (BUILD_SPEC 16, step `report`): how much of the Old tracker the live tool also finds, and what it finds that the
// Old tracker did not. Pure: Coverage rows in, report lines out.

/** Channels the automatic sources (Google Alerts, Talkwalker, F5Bot) can reach. Social posts only arrive by team forward, so they are reported apart. */
export const V1_CHANNELS = ['News', 'Blog', 'Listing', 'Reddit', 'Hacker News', 'Forum'];

const parts = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const has = (row, source) => parts(row['Found in']).includes(source);
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');
const shown = (v) => (v && typeof v.getTime === 'function' ? new Date(v.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10) : String(v || ''));
const LIST_LIMIT = 100;

/**
 * @param {Object<string, any>[]} coverage Coverage rows by header name
 * @param {Date} now
 * @returns {{lines: any[][], stats: object}}
 */
export function buildBackfillReport(coverage, now) {
  const old = coverage.filter((r) => has(r, 'Old'));
  const v1 = old.filter((r) => V1_CHANNELS.includes(r.Channel));
  const v1Found = v1.filter((r) => has(r, 'Tool'));
  const social = old.filter((r) => r['Source type'] === 'Social Media' || ['Social', 'Podcast'].includes(r.Channel));
  const socialFound = social.filter((r) => has(r, 'Tool'));
  const toolOnly = coverage.filter((r) => parts(r['Found in']).length === 1 && has(r, 'Tool'));
  const verifiedNew = toolOnly.filter((r) => r.Verification === 'Verified');
  const audit = coverage.filter((r) => has(r, 'Audit'));
  const auditFound = audit.filter((r) => has(r, 'Tool'));
  const manual = coverage.filter((r) => has(r, 'Manual'));
  const archive = coverage.filter((r) => has(r, 'Archive'));
  const stats = { old: old.length, v1: v1.length, v1Found: v1Found.length, social: social.length, socialFound: socialFound.length, toolOnly: toolOnly.length, verifiedNew: verifiedNew.length, audit: audit.length, auditFound: auditFound.length, manual: manual.length };

  const lines = [['Backfill report', ''], ['Written at', now], ['Coverage rows read', coverage.length], ['', '']];
  lines.push(['Recovery rate (Old stories in the automatic channels that the live tool also found)', `${v1Found.length} of ${v1.length}`, pct(v1Found.length, v1.length)]);
  lines.push(['Channels counted', V1_CHANNELS.join(', ')]);
  lines.push(['How to read it', 'Counted per story. A story is found when a live item arrived with the same link as the story or as one of its placements. It stays low until the tool has been running for a while.']);
  lines.push(['Social posts, reported only (no target)', `${socialFound.length} of ${social.length}`, pct(socialFound.length, social.length)]);
  lines.push(['', '']);
  lines.push(['Verified new finds (found by the tool only, and Verified by a person)', verifiedNew.length]);
  lines.push(['Found by the tool only (any verification)', toolOnly.length]);
  lines.push(['Audit finds, and how many the tool also found', `${auditFound.length} of ${audit.length}`]);
  lines.push(['Added by hand (Found in Manual)', manual.length]);
  lines.push(['Archive gaps (found only in the Drive archive, missing from the Old tracker)', archive.length, archive.length ? '' : 'The archive scan is not built yet']);
  lines.push(['', '']);
  const list = (title, rows) => {
    lines.push([title, 'Coverage ID', 'Published', 'Outlet', 'Link']);
    for (const r of rows.slice(0, LIST_LIMIT)) lines.push(['', r['Coverage ID'], shown(r['Published at']), r.Outlet, r.URL]);
    if (rows.length > LIST_LIMIT) lines.push([`...and ${rows.length - LIST_LIMIT} more`, '']);
    lines.push(['', '']);
  };
  list('Old stories the tool also found', v1Found);
  list('New finds by the tool only', toolOnly);
  list('Audit finds the tool also found', auditFound);
  return { lines, stats };
}
