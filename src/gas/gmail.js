import { LABELS } from '../core/schema.js';
import { fromGmailApi } from '../core/gmailMessage.js';
import { LABEL_TEAM_FORWARD, LABEL_AUTOMATED } from '../core/ingestRouting.js';

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

// ---- Ingest helpers. Labels are changed per MESSAGE with the advanced service, never per thread. ----
const LABEL_PROCESSED = 'Monitoring/Processed';
const LABEL_REVIEW = 'Monitoring/Review';

/** @returns {Object<string,string>} label name to id for the four Monitoring labels. Throws if one is missing. */
export function labelIdsByName() {
  const map = {};
  for (const l of Gmail.Users.Labels.list('me').labels || []) map[l.name] = l.id;
  const missing = LABELS.filter((n) => !map[n]);
  if (missing.length) throw new Error(`Missing Gmail labels: ${missing.join(', ')}. Run setup().`);
  return map;
}

/**
 * Messages waiting under the two source labels, team forwards first (15 minute SLA), at most `max` in total.
 * @returns {{id:string, sourceLabel:string}[]}
 */
export function listCandidates(labelIds, max) {
  const out = [];
  const seen = new Set();
  for (const name of [LABEL_TEAM_FORWARD, LABEL_AUTOMATED]) {
    if (out.length >= max) break;
    const res = Gmail.Users.Messages.list('me', { labelIds: [labelIds[name]], maxResults: max - out.length });
    for (const m of res.messages || []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ id: m.id, sourceLabel: name });
    }
  }
  return out;
}

const decodeBody = (data, charset) => Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString(charset || 'UTF-8');

/** @param {string} id @returns {object} message in the shape the parsers expect */
export function getMessage(id) {
  return fromGmailApi(Gmail.Users.Messages.get('me', id, { format: 'full' }), decodeBody);
}

function relabel(id, labelIds, sourceLabel, addName) {
  Gmail.Users.Messages.modify({ addLabelIds: [labelIds[addName]], removeLabelIds: [labelIds[sourceLabel]] }, 'me', id);
}

/** Adds Monitoring/Processed and removes the source label in one call. */
export function markProcessed(id, labelIds, sourceLabel) {
  relabel(id, labelIds, sourceLabel, LABEL_PROCESSED);
}

/** Adds Monitoring/Review and removes the source label in one call, so a human looks at it and it is not retried. */
export function markReview(id, labelIds, sourceLabel) {
  relabel(id, labelIds, sourceLabel, LABEL_REVIEW);
}
