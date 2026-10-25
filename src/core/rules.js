// Monitoring Rules (read only config). Rules are referenced by MR-nnn id only and never renumbered (CLAUDE.md rule 6).

const HEADERS = {
  id: 'Index', active: 'Active', appliesTo: 'Applies to category', priority: 'Default priority', route: 'Route',
  trigger: 'Trigger', examples: 'Examples', action: 'Required system action', humanAction: 'Human action',
  timing: 'Target timing', notes: 'Notes / guardrails',
};

/**
 * @param {string[][]} rows sheet or CSV rows, with any title rows above the header row
 * @returns {object[]} rules in sheet order
 */
export function loadRules(rows) {
  const trimmed = rows.map((r) => r.map((c) => String(c).trim()));
  const headerAt = trimmed.findIndex((r) => r.includes(HEADERS.id) && r.includes(HEADERS.route));
  if (headerAt < 0) throw new Error(`Monitoring Rules: could not find the header row with "${HEADERS.id}" and "${HEADERS.route}"`);
  const header = trimmed[headerAt];
  const cell = (row, key) => String(row[header.indexOf(HEADERS[key])] ?? '').trim();
  const seen = new Set();
  const rules = [];
  for (const row of trimmed.slice(headerAt + 1)) {
    const id = cell(row, 'id');
    if (!id) continue;
    if (!/^MR-\d{3}$/.test(id)) throw new Error(`Monitoring Rules: "${id}" is not an MR-nnn id`);
    if (seen.has(id)) throw new Error(`Monitoring Rules: duplicate id ${id}`);
    seen.add(id);
    const active = cell(row, 'active');
    if (active !== 'Yes' && active !== 'No') throw new Error(`Monitoring Rules: Active for ${id} must be Yes or No, not "${active}"`);
    rules.push({
      id, active: active === 'Yes', appliesTo: cell(row, 'appliesTo'), priority: cell(row, 'priority'), route: cell(row, 'route'),
      trigger: cell(row, 'trigger'), examples: cell(row, 'examples'), action: cell(row, 'action'), humanAction: cell(row, 'humanAction'),
      timing: cell(row, 'timing'), notes: cell(row, 'notes'),
    });
  }
  return rules;
}

/** @param {object[]} rules @returns {object[]} */
export const activeRules = (rules) => rules.filter((r) => r.active);
