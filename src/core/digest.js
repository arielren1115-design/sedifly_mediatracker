// The daily digest (BUILD_SPEC 12). Pure: rows in, subject and body out. The job sends it only when `stats.hasChanges` (owner decision 2026-11-02).

const DAY_MS = 24 * 3600 * 1000;
const PRIORITY_ORDER = ['Critical', 'High', 'Standard', 'Low'];
const LIST_LIMIT = 25;

const ms = (v) => (v && typeof v.getTime === 'function' ? v.getTime() : v ? Date.parse(v) : NaN);
const blank = (v) => v === '' || v === null || v === undefined;
const sgt = (t) => `${new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} SGT`;

/**
 * @param {object} a
 * @param {number} a.nowMs
 * @param {Object<string, any>[]} a.coverage Coverage rows by header name
 * @param {Object<string, any>[]} a.review Review Queue rows by header name
 * @param {Object<string, any>[]} a.runLog Run Log rows by header name
 * @param {string|null} a.lastSuccessIso
 * @param {string} a.sheetUrl
 * @returns {{subject: string, body: string, stats: object}}
 */
export function buildDigest({ nowMs, coverage, review, runLog, lastSuccessIso, sheetUrl }) {
  const since = nowMs - DAY_MS;
  const fresh = coverage.filter((r) => ms(r['Detected at']) >= since);
  const byChannel = {};
  for (const r of fresh) { const c = r.Channel || 'Not set'; byChannel[c] = (byChannel[c] || 0) + 1; }
  const openReview = review.filter((r) => blank(r.Decision) && blank(r['Synced at'])).length;
  const approvedWaiting = review.filter((r) => r.Decision === 'Approve' && blank(r['Synced at'])).length;
  const alerts = [...coverage, ...review].filter((r) => ms(r['Instant alert sent']) >= since).length;
  const count = (status) => coverage.filter((r) => r['Archive status'] === status).length;
  const runs = runLog.filter((r) => ms(r['Started at']) >= since);
  const sum = (h) => runs.reduce((t, r) => t + (Number(r[h]) || 0), 0);
  const status = (s) => runs.filter((r) => r['Status (OK / PARTIAL / FAILED)'] === s).length;
  const newReview = review.filter((r) => ms(r['Detected at']) >= since).length;
  const decided = review.filter((r) => ms(r['Synced at']) >= since).length;
  const stats = { newReview, decided, newRows: fresh.length, byChannel, openReview, alerts, skipped: sum('Skipped (no entity)'), failed: status('FAILED'), partial: status('PARTIAL') };
  // Something new or changed: new rows, new review items, alerts, review decisions processed, or a problem run. Waiting items and skipped alert results alone do not count.
  stats.hasChanges = stats.newRows + newReview + decided + alerts + stats.failed + stats.partial > 0;

  const lines = [`Media coverage digest for the 24 hours to ${sgt(nowMs)}.`, ''];
  lines.push(`New coverage rows: ${fresh.length}`);
  if (fresh.length) for (const [c, n] of Object.entries(byChannel).sort((a, b) => b[1] - a[1])) lines.push(`  ${c}: ${n}`);
  else lines.push('  No new coverage in the last 24 hours.');
  lines.push(
    `Instant alerts sent: ${alerts}`,
    `Review Queue items waiting for a decision: ${openReview}${approvedWaiting ? ` (plus ${approvedWaiting} approved but not yet copied across, check they have Entity, Category and Priority)` : ''}`,
    `Archive status Screenshot needed: ${count('Screenshot needed')}`,
    `Archive status Save by hand: ${count('Save by hand')}`,
    `Alert results skipped because no monitored entity matched: ${stats.skipped}`,
    `Failed runs: ${stats.failed}. Partial runs: ${stats.partial}.`,
    `Last successful run: ${lastSuccessIso ? sgt(Date.parse(lastSuccessIso)) : 'never'}`,
  );
  if (fresh.length) {
    const order = (r) => { const i = PRIORITY_ORDER.indexOf(r.Priority); return i < 0 ? PRIORITY_ORDER.length : i; };
    const top = [...fresh].sort((a, b) => order(a) - order(b) || ms(b['Detected at']) - ms(a['Detected at'])).slice(0, LIST_LIMIT);
    lines.push('', 'New items, highest priority first:');
    for (const r of top) lines.push(`- [${r.Priority || 'No priority'}] ${r.Entity || 'No entity'}: ${r.Title || r.URL || '(no title)'} (${r.Outlet || 'unknown outlet'}, ${r.Category || 'no category'}) ${r.URL || ''}`.trim());
    if (fresh.length > LIST_LIMIT) lines.push(`...and ${fresh.length - LIST_LIMIT} more. Open the sheet for the full list.`);
  }
  lines.push('', `Sheet: ${sheetUrl}`);
  return { subject: `Sedifly Media digest: ${fresh.length} new item${fresh.length === 1 ? '' : 's'}${alerts ? `, ${alerts} alert${alerts === 1 ? '' : 's'}` : ''}`, body: lines.join('\n'), stats };
}
