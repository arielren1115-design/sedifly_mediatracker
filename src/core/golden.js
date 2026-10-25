// Reads the hand labelled golden set (BUILD_SPEC 9.4) into test cases.

const split = (text) => String(text || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/**
 * @param {string[][]} rows CSV rows, first row is the header
 * @returns {{cases: object[], unlabelled: string[]}} rows without an expected_outcome are not cases yet
 */
export function parseGolden(rows) {
  const [header, ...body] = rows.map((r) => r.map((c) => String(c).trim()));
  const col = (r, name) => { const i = header.indexOf(name); return i < 0 ? '' : r[i] || ''; };
  const cases = [];
  const unlabelled = [];
  for (const r of body) {
    const id = col(r, 'id');
    if (!id) continue;
    const outcome = col(r, 'expected_outcome').toLowerCase();
    if (!['coverage', 'review', 'skip'].includes(outcome)) { unlabelled.push(id); continue; }
    const route = col(r, 'route') || 'Google Alerts';
    const forward = route === 'Team forward';
    cases.push({
      id,
      item: {
        gmailMessageId: `golden-${id}`,
        route,
        url: col(r, 'url') || null,
        title: forward ? '' : col(r, 'title'),
        snippet: forward ? '' : col(r, 'snippet'),
        forwarderNote: forward ? col(r, 'snippet') : '',
        outlet: col(r, 'outlet'),
        alertName: col(r, 'alert_name') || null,
        publishedAt: null,
        itemKind: null,
      },
      expected: {
        outcome,
        entity: col(r, 'expected_entity'),
        category: col(r, 'expected_category'),
        source_type: col(r, 'expected_source_type'),
        channel: col(r, 'expected_channel'),
        priority: col(r, 'expected_priority'),
        sentiment: col(r, 'expected_sentiment'),
        ruleIds: split(col(r, 'expected_rule_ids')),
      },
    });
  }
  return { cases, unlabelled };
}
