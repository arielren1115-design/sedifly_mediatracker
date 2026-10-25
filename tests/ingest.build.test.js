// Runs the real built runIngest() against fake Gmail and Sheets, including the "blocker 2" scenario.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeEnv, goodProps, load } from './helpers/fakeGas.js';
import { emlToGmailApi } from './helpers/emlToGmailApi.js';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/core/csv.js';
import { fakeSheet } from './helpers/fakeGas.js';

const dir = new URL('../fixtures/emails/', import.meta.url).pathname;
const run = (sb, code) => vm.runInContext(code, sb);

async function ready(dataFormat = 'bytes') {
  const env = makeEnv(goodProps());
  env.state.dataFormat = dataFormat;
  const sb = await load(env);
  run(sb, 'setup()');
  // the read only PR Activity Tracker, with the real Monitored Entities tab (title row included)
  const prTracker = fakeSheet('Monitored Entities');
  parseCsv(readFileSync(new URL('../fixtures/config/entities.csv', import.meta.url), 'utf8')).forEach((r) => prTracker.rows.push(r));
  env.sheets.x['Monitored Entities'] = prTracker;
  const id = (name) => `L_Monitoring/${name}`;
  const add = async (msgId, file, labelNames) => {
    env.mailbox.push({ id: msgId, labelIds: new Set(labelNames.map((n) => (n.startsWith('Monitoring/') ? `L_${n}` : n))), raw: await emlToGmailApi(`${dir}${file}.eml`, msgId) });
  };
  return { env, sb, id, add };
}
const coverageRows = (env) => env.sheets.x.Coverage.rows;
const runLogRows = (env) => env.sheets.x['Run Log'].rows;
const labelsOf = (env, id) => [...env.mailbox.find((m) => m.id === id).labelIds].sort();

for (const format of ['bytes', 'string']) test(`blocker 2 with ${format} body data: forwards and alerts are processed once, unrelated mail is untouched, bad mail goes to review`, async () => {
  const { env, sb, add } = await ready(format);
  await add('f1', 'team_forward_link_only', ['Monitoring/Team Forward', 'INBOX']);
  await add('f2', 'team_forward_multiple_links', ['Monitoring/Team Forward']);
  await add('f3', 'team_forward_screenshot_only', ['Monitoring/Team Forward']);
  await add('a1', 'google_alert_joash_lee', ['Monitoring/Automated']);
  await add('a2', 'talkwalker_native', ['Monitoring/Automated']);
  await add('bad', 'team_forward_no_url_no_image', ['Monitoring/Team Forward']);
  await add('out', 'team_forward_non_team_sender', ['Monitoring/Team Forward']);
  await add('other', 'team_forward_link_only', ['INBOX']);

  const first = run(sb, 'runIngest()');
  assert.equal(first.status, 'OK');
  assert.equal(coverageRows(env).length - 1, 6, '8 items: one repeated link merged, one ambiguous name sent to review');
  const reviewRows = env.sheets.x['Review Queue'].rows;
  assert.equal(reviewRows.length - 1, 1);
  const rq = (h) => reviewRows[1][reviewRows[0].indexOf(h)];
  assert.equal(rq('Review reason'), 'Ambiguous entity match');
  assert.equal(rq('Entity'), 'Joash Lee');
  assert.equal(rq('Coverage ID'), '');
  assert.deepEqual(labelsOf(env, 'f1'), ['INBOX', 'L_Monitoring/Processed']);
  assert.deepEqual(labelsOf(env, 'a1'), ['L_Monitoring/Processed']);
  assert.deepEqual(labelsOf(env, 'bad'), ['L_Monitoring/Review']);
  assert.deepEqual(labelsOf(env, 'out'), ['L_Monitoring/Review']);
  assert.deepEqual(labelsOf(env, 'other'), ['INBOX'], 'unrelated mail is untouched');
  assert.equal(env.store.NEXT_COVERAGE_ID, String(1 + 6));
  assert.ok(env.store.LAST_SUCCESS_AT);

  const headers = coverageRows(env)[0];
  const col = (h) => headers.indexOf(h);
  const urls = coverageRows(env).slice(1).map((r) => r[col('URL')]).sort();
  assert.deepEqual(urls, [
    '', 'https://sequoiacap.com/article/services-the-new-software', 'https://www.campus.sg/us-vs-uk-universities-what-singapore-students-should-consider-before-choosing-campus-sg/',
    'https://www.forbes.com/councils/forbesbusinesscouncil/2026/10/13/why-venture-capital-money-isnt-right-for-every-founder/', 'https://www.nus.edu.sg/', 'https://www.sedifly.com/',
  ].sort());
  const ids = coverageRows(env).slice(1).map((r) => r[col('Coverage ID')]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(coverageRows(env).slice(1).every((r) => r[col('Verification')] === 'Needs verification' && r[col('Logged by')] === 'script'));

  const log = runLogRows(env);
  assert.equal(log.length, 2);
  const r = Object.fromEntries(log[0].map((h, i) => [h, log[1][i]]));
  assert.equal(r.Function, 'runIngest');
  assert.equal(r['Messages seen'], 7);
  assert.equal(r['To review'], 3, '2 messages labelled Review plus 1 Review Queue row');
  assert.equal(r['New rows'], 6);
  assert.equal(r.Duplicates, 1);
  assert.equal(r['Status (OK / PARTIAL / FAILED)'], 'OK');
  assert.ok(JSON.parse(r.Detail).details.some((d) => d.outcome === 'review' && /allowlist/i.test(d.reason)));

  // Second run: nothing to do, nothing new written, still logged.
  const second = run(sb, 'runIngest()');
  assert.equal(second.messagesSeen, 0);
  assert.equal(coverageRows(env).length - 1, 6);
  assert.equal(runLogRows(env).length, 3);
});

test('a run that finds the lock held exits without touching anything', async () => {
  const { env, sb, add } = await ready();
  await add('f1', 'team_forward_link_only', ['Monitoring/Team Forward']);
  env.state.locked = true;
  const r = run(sb, 'runIngest()');
  assert.equal(r.status, 'SKIPPED');
  assert.deepEqual(labelsOf(env, 'f1'), ['L_Monitoring/Team Forward']);
  assert.equal(coverageRows(env).length, 1);
});

test('missing configuration fails loudly instead of half running', async () => {
  const props = goodProps(); delete props.TEAM_SENDER_ALLOWLIST;
  const env = makeEnv(props);
  const sb = await load(env);
  assert.throws(() => run(sb, 'runIngest()'), /Missing Script Properties: TEAM_SENDER_ALLOWLIST/);
});

const rawPlain = (id, from, text) => ({
  id, internalDate: String(Date.parse('2026-10-18T11:00:00Z')),
  payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: from }, { name: 'Subject', value: 's' }], body: { data: Buffer.from(text).toString('base64url') } },
});

test('the same article arriving through a second source is merged into the existing row', async () => {
  const { env, sb, add } = await ready();
  await add('a2', 'talkwalker_native', ['Monitoring/Automated']);
  run(sb, 'runIngest()');
  assert.equal(coverageRows(env).length - 1, 2);
  const headers = coverageRows(env)[0];
  const col = (h) => headers.indexOf(h);
  const forbes = () => coverageRows(env).find((r) => String(r[col('URL')]).includes('forbes.com'));
  assert.equal(forbes()[col('Source route')], 'Talkwalker');
  assert.match(forbes()[col('Normalised URL')], /^https:\/\/forbes\.com\//);
  const humanNote = 'checked by Ben';
  forbes()[col('Notes')] = humanNote;

  env.mailbox.push({ id: 'fw9', labelIds: new Set(['L_Monitoring/Team Forward']), raw: rawPlain('fw9', 'Team <team.member@sedifly.com>', 'Great piece https://www.forbes.com/councils/forbesbusinesscouncil/2026/10/13/why-venture-capital-money-isnt-right-for-every-founder/?utm_source=x') });
  const s = run(sb, 'runIngest()');
  assert.equal(s.duplicates, 1);
  assert.equal(coverageRows(env).length - 1, 2, 'no new row');
  assert.equal(forbes()[col('Source route')], 'Talkwalker, Team forward');
  assert.equal(forbes()[col('Found in')], 'Tool');
  assert.equal(forbes()[col('Notes')], humanNote, 'human cells are untouched');
  assert.deepEqual(labelsOf(env, 'fw9'), ['L_Monitoring/Processed']);
});

test('a sheet with its header row removed fails with a plain message, touches no mail, and setup repairs it', async () => {
  const { env, sb, add } = await ready();
  await add('f1', 'team_forward_link_only', ['Monitoring/Team Forward']);
  env.sheets.x.Coverage.rows.length = 0; // someone cleared the whole tab, header row included
  assert.throws(() => run(sb, 'runIngest()'), /Coverage tab is missing the columns Coverage ID.*Run setup\(\)/);
  assert.deepEqual(labelsOf(env, 'f1'), ['L_Monitoring/Team Forward'], 'the message waits for the next run');
  run(sb, 'setup()');
  assert.equal(env.sheets.x.Coverage.rows[0][0], 'Coverage ID');
  const s = run(sb, 'runIngest()');
  assert.equal(s.status, 'OK');
  assert.deepEqual(labelsOf(env, 'f1'), ['L_Monitoring/Processed']);
});

test('a syndicated copy raises the Syndicated copies cell on the existing row and adds no row', async () => {
  const { env, sb, add } = await ready();
  await add('a2', 'talkwalker_native', ['Monitoring/Automated']);
  run(sb, 'runIngest()');
  const headers = coverageRows(env)[0];
  const col = (h) => headers.indexOf(h);
  const forbes = () => coverageRows(env).find((r) => String(r[col('URL')]).includes('forbes.com'));
  assert.equal(coverageRows(env).length - 1, 2);
  assert.ok(!forbes()[col('Syndicated copies')], 'blank before any copy');

  for (const [id, site] of [['a3', 'https://one.example.com/copy'], ['a4', 'https://two.example.com/copy']]) {
    const raw = await emlToGmailApi(`${dir}talkwalker_native.eml`, id);
    const html = raw.payload.parts.find((p) => p.mimeType === 'text/html');
    const text = Buffer.from(html.body.data, 'base64url').toString('utf8')
      .replaceAll('https://www.forbes.com/councils/forbesbusinesscouncil/2026/10/13/why-venture-capital-money-isnt-right-for-every-founder/', site);
    html.body.data = Buffer.from(text, 'utf8').toString('base64url');
    env.mailbox.push({ id, labelIds: new Set(['L_Monitoring/Automated']), raw });
    const s = run(sb, 'runIngest()');
    assert.equal(s.status, 'OK');
  }
  assert.equal(coverageRows(env).length - 1, 2, 'still two rows');
  assert.equal(forbes()[col('Syndicated copies')], 2);
  assert.equal(forbes()[col('Source route')], 'Talkwalker');
  assert.ok(forbes()[col('Last updated')] instanceof Date || typeof forbes()[col('Last updated')] === 'object');
});
