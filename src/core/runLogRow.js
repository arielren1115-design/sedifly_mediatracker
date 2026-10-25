const DETAIL_LIMIT = 5000;

/**
 * @param {{runId:string, fn:string, startedAt:Date, durationMs:number, summary:object, status:string}} r
 * @returns {Object<string, any>} Run Log row by header name
 */
export function buildRunLogRow({ runId, fn, startedAt, durationMs, summary, status }) {
  const detail = JSON.stringify({ details: summary.details || [], skippedForBudget: summary.skippedForBudget || 0, deferred: summary.deferred || undefined, classified: summary.classified || undefined, note: summary.note || undefined });
  return {
    'Run ID': runId,
    Function: fn,
    'Started at': startedAt,
    'Duration ms': durationMs,
    'Messages seen': summary.messagesSeen || 0,
    'Items parsed': summary.itemsParsed || 0,
    'New rows': summary.newRows || 0,
    Duplicates: summary.duplicates || 0,
    'To review': summary.toReview || 0,
    'Skipped (no entity)': summary.skippedNoEntity || 0,
    'Capture failures': 0,
    Errors: summary.errors || 0,
    'Status (OK / PARTIAL / FAILED)': status,
    Detail: detail.length > DETAIL_LIMIT ? `${detail.slice(0, DETAIL_LIMIT - 15)}...[truncated]` : detail,
  };
}
