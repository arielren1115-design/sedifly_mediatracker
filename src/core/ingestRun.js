// One ingest batch, with every outside action passed in so it can be tested without Google services.
import { selectParser } from './ingestRouting.js';
import { toCoverageRow, itemKey } from './coverageRow.js';
import { normalizeUrl } from './normalizeUrl.js';
import { mergeList, isRedditCommentUrl } from './dedupe.js';
import { entityGate } from './entityGate.js';
import { classifyItem, DeferError } from './classifyStep.js';

/**
 * @param {object} deps
 * @param {{id:string, sourceLabel:string}[]} deps.candidates messages to process, already limited to the batch size
 * @param {(id:string) => object} deps.getMessage
 * @param {object[]} deps.entities monitored entities (see entities.js). Required: an empty list would skip every alert
 * @param {object} [deps.entityOptions] options for matchEntities
 * @param {object} deps.index dedupe index over Coverage and Review Queue (see dedupe.js); updated as rows are written
 * @param {(n:number) => string[]} deps.allocateIds
 * @param {(row: object) => number} deps.appendCoverageRow returns the new row number
 * @param {(row: object) => number} deps.appendReviewRow returns the new row number
 * @param {(entry: object, values: object) => void} deps.updateExisting writes Source route, Found in and Last updated
 * @param {(id:string, sourceLabel:string) => void} deps.markProcessed
 * @param {(id:string, sourceLabel:string, reason:string) => void} deps.markReview
 * @param {object|null} [deps.classifier] classifier context (see classifyStep.js). Absent: rows are written unclassified
 * @param {() => boolean} deps.shouldStop true once the time budget is spent
 * @param {() => Date} deps.now
 * @param {string} deps.allowlist
 */
export function processBatch(deps) {
  if (!Array.isArray(deps.entities) || !deps.entities.length) throw new Error('No monitored entities were loaded, so nothing can be matched');
  const s = { messagesSeen: 0, itemsParsed: 0, newRows: 0, duplicates: 0, toReview: 0, skippedNoEntity: 0, errors: 0, deferred: 0, classified: 0, skippedForBudget: 0, details: [] };
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
      const counts = { newRows: 0, duplicates: 0, reviewRows: 0, classified: 0, skipped: [], syndicated: [], entities: new Set() };
      try {
        for (const item of items) handleItem(deps, item, counts);
      } finally {
        s.newRows += counts.newRows;
        s.duplicates += counts.duplicates;
        s.toReview += counts.reviewRows;
        s.classified += counts.classified;
        s.skippedNoEntity += counts.skipped.length;
      }
      deps.markProcessed(id, sourceLabel);
      const detail = { id, outcome: 'processed', items: items.length, newRows: counts.newRows, duplicates: counts.duplicates, reviewRows: counts.reviewRows, entities: [...counts.entities] };
      if (counts.skipped.length) detail.skipped = counts.skipped;
      if (counts.syndicated.length) detail.syndicated = counts.syndicated.slice(0, 5);
      if (counts.syndicated.length > 5) detail.syndicatedTotal = counts.syndicated.length;
      s.details.push(detail);
    } catch (e) {
      if (e && e.deferred) {
        // Left unlabelled on purpose, so the next run tries again (spec 9.3). Not an error until the third failed run.
        s.deferred++;
        s.details.push({ id, outcome: 'deferred', reason: e.message });
      } else {
        s.errors++;
        s.details.push({ id, outcome: 'error', reason: String(e.message || e) });
      }
    }
  }
  const done = s.details.filter((d) => d.outcome === 'processed' || d.outcome === 'review').length;
  const bad = s.errors + s.deferred;
  s.status = bad === 0 ? 'OK' : done > 0 ? 'PARTIAL' : 'FAILED';
  return s;
}

/** Spec 8.2: skip repeats, merge the same url, count a syndicated copy against the existing row, else add a row. */
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

  const entry = { url: item.url || '', normalisedUrl: norm || '', title: item.title || '', detectedAt: now, sourceRoute: item.route, foundIn: 'Tool', gmailMessageId: item.gmailMessageId };
  const addReview = (reason, entityName, classification) => {
    const row = { ...toCoverageRow(item, { now, normalisedUrl: norm, classification, threshold: deps.classifier && deps.classifier.threshold }), 'Review reason': reason, Verification: 'Needs verification' };
    if (entityName && !row.Entity) row.Entity = entityName;
    index.add({ ...entry, sheet: 'Review Queue', rowNumber: deps.appendReviewRow(row), coverageId: '' });
    counts.reviewRows++;
  };

  // Spec 8.2, owner decision A (2026-10-25): the same headline on another site is a syndicated copy. It adds no row, it is counted.
  const isComment = item.itemKind === 'comment' || isRedditCommentUrl(norm);
  const similar = norm && item.title && !isComment ? index.similarTitle(item.title, norm, now.getTime()) : null;
  if (similar) {
    const copies = similar.syndicatedCopies + 1;
    deps.updateExisting(similar, { 'Syndicated copies': copies, 'Last updated': now });
    index.setCopies(similar, copies);
    index.addKey(key);
    counts.duplicates++;
    counts.syndicated.push({ url: item.url, of: similar.coverageId });
    return;
  }

  const gate = entityGate(deps, item);
  gate.ids.forEach((e) => counts.entities.add(e));
  if (gate.outcome === 'none' && item.route !== 'Team forward') {
    counts.skipped.push({ url: item.url, route: item.route, reason: 'No monitored entity matched' });
    return;
  }
  if (gate.outcome === 'ambiguous') { addReview('Ambiguous entity match', gate.names.length === 1 ? gate.names[0] : ''); return; }

  let classification = null;
  if (deps.classifier) {
    if (deps.shouldStop()) throw new DeferError('Time budget spent before classification');
    const result = classifyItem(deps.classifier, item, { candidates: gate.candidates, route: item.route, messageId: item.gmailMessageId });
    counts.classified++;
    if (result.action === 'skip') {
      counts.skipped.push({ url: item.url, route: item.route, reason: result.reason });
      return;
    }
    if (result.action === 'review') { addReview(result.reason, '', result.classification); return; }
    classification = result.classification;
  }

  const coverageId = deps.allocateIds(1)[0];
  const row = toCoverageRow(item, { coverageId, now, normalisedUrl: norm, classification, threshold: deps.classifier && deps.classifier.threshold });
  index.add({ ...entry, sheet: 'Coverage', rowNumber: deps.appendCoverageRow(row), coverageId });
  counts.newRows++;
}
