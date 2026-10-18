// One ingest batch, with every outside action passed in so it can be tested without Google services.
import { selectParser } from './ingestRouting.js';
import { toCoverageRow, itemKey } from './coverageRow.js';
import { normalizeUrl } from './normalizeUrl.js';
import { mergeList } from './dedupe.js';

/**
 * @param {object} deps
 * @param {{id:string, sourceLabel:string}[]} deps.candidates messages to process, already limited to the batch size
 * @param {(id:string) => object} deps.getMessage
 * @param {object} deps.index dedupe index over Coverage and Review Queue (see dedupe.js); updated as rows are written
 * @param {(n:number) => string[]} deps.allocateIds
 * @param {(row: object) => number} deps.appendCoverageRow returns the new row number
 * @param {(row: object) => number} deps.appendReviewRow returns the new row number
 * @param {(entry: object, values: object) => void} deps.updateExisting writes Source route, Found in and Last updated
 * @param {(id:string, sourceLabel:string) => void} deps.markProcessed
 * @param {(id:string, sourceLabel:string, reason:string) => void} deps.markReview
 * @param {() => boolean} deps.shouldStop true once the time budget is spent
 * @param {() => Date} deps.now
 * @param {string} deps.allowlist
 */
export function processBatch(deps) {
  const s = { messagesSeen: 0, itemsParsed: 0, newRows: 0, duplicates: 0, toReview: 0, errors: 0, skippedForBudget: 0, details: [] };
  for (const [index, { id, sourceLabel }] of deps.candidates.entries()) {
    if (deps.shouldStop()) { s.skippedForBudget = deps.candidates.length - index; break; }
    s.messagesSeen++;
    try {
      const message = deps.getMessage(id);
      const choice = selectParser(message, sourceLabel, deps.allowlist);
      let items = [];
      let reason = choice.reviewReason || null;
      if (!reason) {
        try {
          items = choice.parse(message);
          if (!items.length) reason = 'No items found in the message';
        } catch (e) {
          reason = `Parser error: ${e.message}`;
        }
      }
      if (reason) {
        deps.markReview(id, sourceLabel, reason);
        s.toReview++;
        s.details.push({ id, outcome: 'review', reason, from: message.from, subject: message.subject });
        continue;
      }
      s.itemsParsed += items.length;
      const counts = { newRows: 0, duplicates: 0, reviewRows: 0 };
      for (const item of items) handleItem(deps, item, counts);
      s.newRows += counts.newRows;
      s.duplicates += counts.duplicates;
      s.toReview += counts.reviewRows;
      deps.markProcessed(id, sourceLabel);
      s.details.push({ id, outcome: 'processed', items: items.length, newRows: counts.newRows, duplicates: counts.duplicates, reviewRows: counts.reviewRows });
    } catch (e) {
      s.errors++;
      s.details.push({ id, outcome: 'error', reason: String(e.message || e) });
    }
  }
  const done = s.details.filter((d) => d.outcome !== 'error').length;
  s.status = s.errors === 0 ? 'OK' : done > 0 ? 'PARTIAL' : 'FAILED';
  return s;
}

/** Spec 8.2: skip repeats, merge the same url, send same title from a different url to review, else add a row. */
function handleItem(deps, item, counts) {
  const index = deps.index;
  const key = itemKey(item);
  if (index.hasKey(key)) { counts.duplicates++; return; } // this message already wrote this item (retry after a crash)

  const now = deps.now();
  const norm = normalizeUrl(item.url); // null for items without a url, which are never merged
  const existing = norm ? index.findByUrl(norm) : null;
  if (existing) {
    const sourceRoute = mergeList(existing.sourceRoute, item.route);
    const foundIn = mergeList(existing.foundIn, 'Tool');
    if (sourceRoute !== existing.sourceRoute || foundIn !== existing.foundIn) {
      deps.updateExisting(existing, { 'Source route': sourceRoute, 'Found in': foundIn, 'Last updated': now });
      index.setRoutes(existing, sourceRoute, foundIn);
    }
    index.addKey(key);
    counts.duplicates++;
    return;
  }

  const similar = norm && item.title ? index.similarTitle(item.title, norm, now.getTime()) : null;
  const entry = { url: item.url || '', normalisedUrl: norm || '', title: item.title || '', detectedAt: now, sourceRoute: item.route, foundIn: 'Tool', gmailMessageId: item.gmailMessageId };
  if (similar) {
    const row = { ...toCoverageRow(item, { now, normalisedUrl: norm }), 'Review reason': 'Possible duplicate' };
    index.add({ ...entry, sheet: 'Review Queue', rowNumber: deps.appendReviewRow(row), coverageId: '' });
    counts.reviewRows++;
  } else {
    const coverageId = deps.allocateIds(1)[0];
    index.add({ ...entry, sheet: 'Coverage', rowNumber: deps.appendCoverageRow(toCoverageRow(item, { coverageId, now, normalisedUrl: norm })), coverageId });
    counts.newRows++;
  }
}
