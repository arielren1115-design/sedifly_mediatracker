// Runs the real built runIngest() against fake Gmail and Sheets, including the "blocker 2" scenario.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeEnv, goodProps, load } from './helpers/fakeGas.js';
import { emlToGmailApi } from './helpers/emlToGmailApi.js';

const dir = new URL('../fixtures/emails/', import.meta.url).pathname;
const run = (sb, code) => vm.runInContext(code, sb);

async function ready(dataFormat = 'bytes') {
  const env = makeEnv(goodProps());
  env.state.dataFormat = dataFormat;
  const sb = await load(env);
  run(sb, 'setup()');
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
  assert.equal(coverageRows(env).length - 1, 1 + 3 + 1 + 1 + 2);
  assert.deepEqual(labelsOf(env, 'f1'), ['INBOX', 'L_Monitoring/Processed']);
  assert.deepEqual(labelsOf(env, 'a1'), ['L_Monitoring/Processed']);
  assert.deepEqual(labelsOf(env, 'bad'), ['L_Monitoring/Review']);
  assert.deepEqual(labelsOf(env, 'out'), ['L_Monitoring/Review']);
  assert.deepEqual(labelsOf(env, 'other'), ['INBOX'], 'unrelated mail is untouched');
  assert.equal(env.store.NEXT_COVERAGE_ID, String(1 + 8));
  assert.ok(env.store.LAST_SUCCESS_AT);

  const headers = coverageRows(env)[0];
  const col = (h) => headers.indexOf(h);
  const urls = coverageRows(env).slice(1).map((r) => r[col('URL')]).sort();
  assert.deepEqual(urls, [
    '', 'https://media.unisba.ac.id/e7cc6231/04877eceNy8XOVQbNB1bNCs', 'https://sequoiacap.com/article/services-the-new-software', 'https://www.campus.sg/us-vs-uk-universities-what-singapore-students-should-consider-before-choosing-campus-sg/',
    'https://www.forbes.com/councils/forbesbusinesscouncil/2026/10/13/why-venture-capital-money-isnt-right-for-every-founder/', 'https://www.nus.edu.sg/', 'https://www.sedifly.com/', 'https://www.sedifly.com/',
  ].sort());
  const ids = coverageRows(env).slice(1).map((r) => r[col('Coverage ID')]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(coverageRows(env).slice(1).every((r) => r[col('Verification')] === 'Needs verification' && r[col('Logged by')] === 'script'));

  const log = runLogRows(env);
  assert.equal(log.length, 2);
  const r = Object.fromEntries(log[0].map((h, i) => [h, log[1][i]]));
  assert.equal(r.Function, 'runIngest');
  assert.equal(r['Messages seen'], 7);
  assert.equal(r['To review'], 2);
  assert.equal(r['New rows'], 8);
  assert.equal(r['Status (OK / PARTIAL / FAILED)'], 'OK');
  assert.ok(JSON.parse(r.Detail).details.some((d) => d.outcome === 'review' && /allowlist/i.test(d.reason)));

  // Second run: nothing to do, nothing new written, still logged.
  const second = run(sb, 'runIngest()');
  assert.equal(second.messagesSeen, 0);
  assert.equal(coverageRows(env).length - 1, 8);
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
