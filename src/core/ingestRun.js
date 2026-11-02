// One ingest batch, with every outside action passed in so it can be tested without Google services.
import { selectParser } from './ingestRouting.js';
import { toCoverageRow, itemKey } from './coverageRow.js';
import { normalizeUrl } from './normalizeUrl.js';
import { mergeList, isRedditCommentUrl } from './dedupe.js';
import { entityGate } from './entityGate.js';
import { classifyItem, DeferError } from './classifyStep.js';
import { decideAlert } from './routing.js';
import { extractEmail } from './parsers/teamForward.js';

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
 * @param {(info: object) => boolean} [deps.sendAlert] sends the instant alert for a written row (see gas/alerts.js). Never throws for a mail problem: it queues a retry
 * @param {object|null} [deps.classifier] classifier context (see classifyStep.js). Absent: rows are written unclassified
 * @param {() => boolean} deps.shouldStop true once the time budget is spent
 * @param {() => Date} deps.now
 * @param {string} deps.allowlist
 */
export function processBatch(deps) {
  if (!Array.isArray(deps.entities) || !deps.entities.length) throw new Error('No monitored entities were loaded, so nothing can be matched');
  const s = { messagesSeen: 0, itemsParsed: 0, newRows: 0, duplicates: 0, toReview: 0, skippedNoEntity: 0, errors: 0, deferred: 0, classified: 0, alerts: 0, alertFailures: 0, skippedForBudget: 0, details: [] };
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
      // Who sent a team forward is kept on the row. Automatic alerts have no submitter.
      const submittedBy = extractEmail(message.from);
      items = items.map((it) => (it.route === 'Team forward' && submittedBy ? { ...it, submittedBy } : it));
      s.itemsParsed += items.length;
      const counts = { newRows: 0, duplicates: 0, reviewRows: 0, classified: 0, alerts: 0, alertFailures: 0, skipped: [], syndicated: [], entities: new Set() };
      try {
        for (const item of items) handleItem(deps, item, counts);
      } finally {
        s.newRows += counts.newRows;
        s.duplicates += counts.duplicates;
        s.toReview += counts.reviewRows;
        s.classified += counts.classified;
        s.alerts += counts.alerts;
        s.alertFailures += counts.alertFailures;
        s.skippedNoEntity += counts.skipped.length;
      }
      deps.markProcessed(id, sourceLabel);
      const detail = { id, outcome: 'processed', items: items.length, newRows: counts.newRows, duplicates: counts.duplicates, reviewRows: counts.reviewRows, entities: [...counts.entities] };
      if (counts.alerts) detail.alerts = counts.alerts;
      if (counts.alertFailures) detail.alertFailures = counts.alertFailures;
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
  const bad = s.errors + s.deferred + s.alertFailures; // an alert that could not be sent is not a clean run
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
    // A link sent by a second person records both senders.
    const submittedBy = item.submittedBy ? mergeList(existing.submittedBy || '', item.submittedBy) : existing.submittedBy || '';
    if (sourceRoute !== existing.sourceRoute || foundIn !== existing.foundIn || submittedBy !== (existing.submittedBy || '')) {
      deps.updateExisting(existing, { 'Source route': sourceRoute, 'Found in': foundIn, ...(submittedBy !== (existing.submittedBy || '') ? { 'Submitted by': submittedBy } : {}), 'Last updated': now });
      index.setRoutes(existing, sourceRoute, foundIn);
      existing.submittedBy = submittedBy;
    }
    index.addKey(key);
    counts.duplicates++;
    return;
  }

  const entry = { url: item.url || '', normalisedUrl: norm || '', title: item.title || '', detectedAt: now, sourceRoute: item.route, foundIn: 'Tool', gmailMessageId: item.gmailMessageId, submittedBy: item.submittedBy || '' };
  // Spec 12: an instant alert is due even when the item goes to review (then it is UNCONFIRMED). Needs a classification to know.
  const alertIfDue = (sheet, rowNumber, coverageId, row, classification, unconfirmed) => {
    if (!deps.sendAlert || !classification || !deps.classifier) return;
    const due = decideAlert({ rules: deps.classifier.rules, classification, unconfirmed });
    if (!due.send) return;
    try {
      if (deps.sendAlert({ sheet, rowNumber, coverageId, row, summary: classification.summary, unconfirmed, reasons: due.reasons })) counts.alerts++;
      else counts.alertFailures++;
    } catch (e) {
      counts.alertFailures++;
    }
  };
  const addReview = (reason, entityName, classification) => {
    const row = { ...toCoverageRow(item, { now, normalisedUrl: norm, classification, threshold: deps.classifier && deps.classifier.threshold }), 'Review reason': reason, Verification: 'Needs verification' };
    if (entityName) row.Entity = entityName; // the gate's candidate wins over the model's guess for an ambiguous match
    const rowNumber = deps.appendReviewRow(row);
    index.add({ ...entry, sheet: 'Review Queue', rowNumber, coverageId: '' });
    counts.reviewRows++;
    alertIfDue('Review Queue', rowNumber, '', row, classification, true);
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
  if (gate.outcome === 'ambiguous') {
    // Still classified, so a possible Critical item is alerted (UNCONFIRMED) instead of waiting unseen for a reviewer.
    let guess = null;
    if (deps.classifier) {
      if (deps.shouldStop()) throw new DeferError('Time budget spent before classification');
      guess = classifyItem(deps.classifier, item, { candidates: gate.candidates, route: item.route, messageId: item.gmailMessageId }).classification;
      counts.classified++;
    }
    addReview('Ambiguous entity match', gate.names.length === 1 ? gate.names[0] : '', guess);
    return;
  }

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
  const rowNumber = deps.appendCoverageRow(row);
  index.add({ ...entry, sheet: 'Coverage', rowNumber, coverageId });
  counts.newRows++;
  alertIfDue('Coverage', rowNumber, coverageId, row, classification, false);
}
