import { TRIGGERS } from '../core/schema.js';

/** Delete and recreate only this project's own triggers from the plan (spec 14). */
export function ensureTriggers() {
  const ours = new Set(TRIGGERS.map((t) => t.handler));
  for (const t of ScriptApp.getProjectTriggers()) {
    if (ours.has(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  }
  for (const t of TRIGGERS) {
    const b = ScriptApp.newTrigger(t.handler).timeBased();
    if (t.everyMinutes) b.everyMinutes(t.everyMinutes);
    else if (t.everyHours) b.everyHours(t.everyHours);
    else b.everyDays(1).atHour(t.atHour);
    b.create();
  }
  return TRIGGERS.map((t) => t.handler);
}
