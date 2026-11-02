// Routing is deterministic code (BUILD_SPEC 12). The classifier says which rules match; the matched rules' Route says what to do.

const INSTANT = 'instant alert';
const split = (text) => String(text || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Whether an instant alert is due. It holds even when the item goes to the Review Queue, in which case the alert is UNCONFIRMED.
 * An item the classifier judged unrelated to any monitored entity never alerts.
 * @param {{rules: object[], classification: {matched_rule_ids: string[], priority: string, critical_signal?: boolean, is_relevant?: boolean}, unconfirmed: boolean}} a
 * @returns {{send: boolean, unconfirmed: boolean, reasons: string[]}}
 */
export function decideAlert({ rules, classification, unconfirmed }) {
  const none = { send: false, unconfirmed, reasons: [] };
  if (!classification || classification.is_relevant === false) return none;
  const reasons = [];
  for (const id of classification.matched_rule_ids || []) {
    const rule = rules.find((r) => r.id === id);
    if (rule && String(rule.route).trim().toLowerCase() === INSTANT) reasons.push(`Matched ${id} (instant alert rule)`);
  }
  if (classification.priority === 'Critical') reasons.push('Priority is Critical');
  if (classification.critical_signal === true) reasons.push('The classifier saw a possible critical signal');
  return { send: reasons.length > 0, unconfirmed, reasons };
}

/** The classification fields routing needs, rebuilt from a sheet row (used when a human approves a review row). */
export function classificationFromRow(values) {
  return { is_relevant: true, priority: values.Priority, critical_signal: false, matched_rule_ids: split(values['Rules matched']) };
}
