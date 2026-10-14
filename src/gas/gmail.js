import { LABELS } from '../core/schema.js';

/** Create any missing Monitoring/* labels with the Gmail advanced service. @returns {string[]} names created */
export function ensureLabels() {
  const existing = new Set((Gmail.Users.Labels.list('me').labels || []).map((l) => l.name));
  const created = [];
  for (const name of LABELS) {
    if (existing.has(name)) continue;
    Gmail.Users.Labels.create({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }, 'me');
    created.push(name);
  }
  return created;
}
