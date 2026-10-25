// Chooses the parser for a message from the label it was found under and its sender.
import { parse as parseTeamForward, isTeamSender, extractEmail } from './parsers/teamForward.js';
import { parse as parseGoogleAlerts } from './parsers/googleAlerts.js';
import { parse as parseTalkwalker } from './parsers/talkwalker.js';
import { parse as parseF5Bot } from './parsers/f5bot.js';

export const LABEL_AUTOMATED = 'Monitoring/Automated';
export const LABEL_TEAM_FORWARD = 'Monitoring/Team Forward';

/** Alert vendor sender addresses. These identify public services and are not secrets. */
const ALERT_SENDERS = {
  'googlealerts-noreply@google.com': parseGoogleAlerts,
  'alerts@talkwalker.com': parseTalkwalker,
  'alerts@f5bot.com': parseF5Bot,
};

/**
 * @param {{from:string}} message
 * @param {string} sourceLabel label the message was listed under
 * @param {string} allowlist TEAM_SENDER_ALLOWLIST
 * @returns {{parse: (m: object) => object[]} | {reviewReason: string}}
 */
export function selectParser(message, sourceLabel, allowlist) {
  if (sourceLabel === LABEL_TEAM_FORWARD) {
    return isTeamSender(message.from, allowlist) ? { parse: parseTeamForward } : { reviewReason: 'Sender not on the team allowlist' };
  }
  if (sourceLabel === LABEL_AUTOMATED) {
    const parse = ALERT_SENDERS[extractEmail(message.from)];
    return parse ? { parse } : { reviewReason: 'Unknown alert sender' };
  }
  return { reviewReason: `Unexpected source label: ${sourceLabel}` };
}
