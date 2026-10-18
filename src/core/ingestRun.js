// One ingest batch, with every outside action passed in so it can be tested without Google services.
import { selectParser } from './ingestRouting.js';
import { toCoverageRow, itemKey } from './coverageRow.js';

/**
 * @param {object} deps
 * @param {{id:string, sourceLabel:string}[]} deps.candidates messages to process, already limited to the batch size
 * @param {(id:string) => object} deps.getMessage
 * @param {Set<string>} deps.existingKeys keys of items already in Coverage or Review Queue; updated as rows are written
 * @param {(n:number) => string[]} deps.allocateIds
 * @param {(rows: object[]) => void} deps.appendRows
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
      const fresh = items.filter((i) => !deps.existingKeys.has(itemKey(i)));
      if (fresh.length) {
        const ids = deps.allocateIds(fresh.length);
        const now = deps.now();
        deps.appendRows(fresh.map((item, n) => toCoverageRow(item, { coverageId: ids[n], now })));
        for (const item of fresh) deps.existingKeys.add(itemKey(item));
      }
      s.newRows += fresh.length;
      s.duplicates += items.length - fresh.length;
      deps.markProcessed(id, sourceLabel);
      s.details.push({ id, outcome: 'processed', items: items.length, newRows: fresh.length });
    } catch (e) {
      s.errors++;
      s.details.push({ id, outcome: 'error', reason: String(e.message || e) });
    }
  }
  const done = s.details.filter((d) => d.outcome !== 'error').length;
  s.status = s.errors === 0 ? 'OK' : done > 0 ? 'PARTIAL' : 'FAILED';
  return s;
}
