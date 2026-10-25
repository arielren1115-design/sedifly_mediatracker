// The only place that sends email. Operations mail goes to OPS_RECIPIENTS and nowhere else (CLAUDE.md rule 4).
import { getProp } from './config.js';

/** @param {string} subject @param {string} body @returns {boolean} true when the mail was handed to Gmail */
export function sendOpsEmail(subject, body) {
  const to = getProp('OPS_RECIPIENTS');
  if (!to || to.startsWith('PLACEHOLDER')) return false;
  MailApp.sendEmail({ to, subject, body });
  return true;
}
