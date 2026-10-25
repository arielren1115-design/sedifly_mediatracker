// What to do with a validated classification (BUILD_SPEC 9.3).

/**
 * @param {{ok: boolean, value?: object}} result from validateClassification
 * @param {{route: string, threshold: number, canRefetch: boolean, alreadyRefetched: boolean}} ctx
 * @returns {{action: 'coverage'|'review'|'skip'|'refetch', reason?: string}}
 */
export function decideOutcome(result, { route, threshold, canRefetch, alreadyRefetched }) {
  if (!result.ok) return { action: 'review', reason: 'Invalid classifier output' };
  const v = result.value;
  if (!v.is_relevant) {
    return route === 'Team forward'
      ? { action: 'review', reason: 'Low confidence' }
      : { action: 'skip', reason: 'Classifier says the item is not about a monitored entity' };
  }
  if (v.confidence < threshold) {
    return canRefetch && !alreadyRefetched ? { action: 'refetch' } : { action: 'review', reason: 'Low confidence' };
  }
  return { action: 'coverage' };
}
