// Spec 9.1 pre-match, with the owners' rule that ambiguous matches go to review. The alert's own name counts as an ambiguous
// hint, so a result whose snippet lacks the name is reviewed instead of skipped.
import { matchEntities } from './entities.js';

/**
 * @param {{entities: object[], entityOptions?: object}} deps
 * @param {object} item RawItem
 * @returns {{outcome: 'strong'|'ambiguous'|'none', ids: string[], names: string[], candidates: {name:string, type:string, strength:string}[]}}
 */
export function entityGate(deps, item) {
  const text = [item.title, item.snippet, item.forwarderNote].filter(Boolean).join(' ');
  const found = new Map(matchEntities(deps.entities, text, deps.entityOptions).map((m) => [m.entity.id, m]));
  if (item.alertName) {
    for (const m of matchEntities(deps.entities, item.alertName, deps.entityOptions)) {
      if (!found.has(m.entity.id)) found.set(m.entity.id, { entity: m.entity, strength: 'ambiguous' });
    }
  }
  const all = [...found.values()];
  const strong = all.some((m) => m.strength === 'strong');
  const ambiguous = all.filter((m) => m.strength === 'ambiguous');
  return {
    outcome: strong ? 'strong' : ambiguous.length ? 'ambiguous' : 'none',
    ids: all.map((m) => m.entity.id),
    names: ambiguous.map((m) => m.entity.name),
    candidates: all.map((m) => ({ name: m.entity.name, type: m.entity.type, strength: m.strength })),
  };
}
