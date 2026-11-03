import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { matchTabs, parseTab, planStories, toImportedCoverageRow, toPlacementRow, buildReport, buildPlacementMap, mediaChannel, KNOWN_SAME_POST, OLD_TABS, slugWords } from '../src/core/oldImport.js';
import { COVERAGE_HEADERS, PLACEMENT_HEADERS } from '../src/core/schema.js';
import { makeEnv, goodProps, load, fakeSheet } from './helpers/fakeGas.js';

const [MEDIA, SOCIAL, LISTING] = OLD_TABS;
const mediaRows = (...data) => [['Date', 'Category', 'Media Name ', 'Topic', 'Link '], ['2026', '2026', '2026', '2026', '2026'], ...data];
const PR = (host, id = '884308697') => `https://${host}/pr_news/${id}/sedifly-and-the-assembly-place-mark-milestone-in-a-joint-success-event`;

test('tabs are matched by name ignoring case and stray spaces; extra tabs are listed', () => {
  const m = matchTabs(['Media ', 'social media', 'Non Media Listings', 'Scratch']);
  assert.deepEqual(Object.keys(m.found), ['Media', 'Social Media', 'Non Media Listings']);
  assert.deepEqual(m.extra, ['Scratch']);
  assert.deepEqual(matchTabs(['Media']).missing, ['Social Media', 'Non Media Listings']);
});

test('year headings, blank rows and data rows are each counted; the year comes from the heading above', () => {
  const t = parseTab(MEDIA, [['Date', 'Category', 'Media Name', 'Topic', 'Link'], [2025, '', '', '', ''], ['27 October', 'Brand', 'e27.co', 'Pre-Seed', 'https://e27.co/a-b-c'], ['', '', '', '', ''], ['2026', '2026', '2026', '2026', '2026'], [new Date(2030, 0, 12), 'General', 'Tech', 'AI', 'https://t.com/x']]);
  assert.equal(t.rowsBelowHeader, 5);
  assert.equal(t.yearHeadings, 2);
  assert.equal(t.blankRows, 1);
  assert.equal(t.records.length, 2);
  assert.equal(t.records[0].dateIso, '2025-10-27');
  assert.equal(t.records[0].sheetRow, 3);
  assert.equal(t.records[1].dateIso, '2030-01-12', 'a date cell is kept as it is, never corrected to the heading year');
  assert.equal(t.yearMismatch, 1);
  assert.deepEqual(t.records[1].problems, ['date year differs from the heading above']);
  assert.match(t.records[1].notes[0], /cell says 2030-01-12 but the heading above the row says 2026/);
  assert.equal(t.records[0].ms, Date.UTC(2025, 9, 27, 4, 0, 0), '12:00 Singapore time');
});

test('problems are recorded, never dropped: no date, no link, text in the link cell, a category outside the four, the Catagory typo', () => {
  const t = parseTab(LISTING, [['Date', 'Link', 'Media Name', 'Catagory'], ['2025', '2025', '2025', ''], ['', 'https://crunchbase.com/x', 'Crunchbase', ''], ['4 September', 'see screenshot', 'Odd', 'Event'], ['5 September', '', 'None', 'Press'], ['31 February', 'https://a.com/b', 'Bad date', '']]);
  assert.equal(t.records.length, 4);
  assert.deepEqual(t.records[0].problems, ['no date']);
  assert.deepEqual(t.records[1].problems, ['link is not a web address']);
  assert.equal(t.records[1].category, 'Event');
  assert.deepEqual(t.records[2].problems, ['no link', 'category "Press" is not one of the four']);
  assert.deepEqual(t.records[3].problems, ['impossible date']);
});

test('the same headline within 7 days becomes one story with every placement; 8 days apart, or a short headline, does not group', () => {
  const t = parseTab(MEDIA, mediaRows(
    ['19 January', 'Event', 'EIN Presswire', 'T', PR('world.einnews.com')],
    ['19 January', 'Event', 'Business News Today', 'T', PR('business.einnews.com')],
    ['25 January', 'Event', 'Late copy', 'T', PR('wickedlocal.com')],
    ['28 January', 'Event', 'Too late', 'T', PR('another.com')],
    ['19 January', 'Brand', 'Short', 'T', 'https://a.com/news/short-title'],
    ['19 January', 'Brand', 'Short 2', 'T', 'https://b.com/news/short-title'],
  ));
  const { stories, outcomes } = planStories(t.records);
  assert.deepEqual(outcomes, { story: 4, placement: 2, duplicate: 0 });
  const big = stories.find((s) => s.placements.length === 2);
  assert.equal(big.main.outlet, 'EIN Presswire');
  assert.deepEqual(big.placements.map((p) => p.outlet), ['Business News Today', 'Late copy']);
});

test('the same link twice is one row with both Old rows kept in Import source', () => {
  const t = parseTab(MEDIA, mediaRows(['1 March', 'Brand', 'Forbes', 'T', 'https://forbes.com/a/b-c-d?utm_source=x'], ['2 March', 'Brand', 'Forbes', 'T', 'https://www.forbes.com/a/b-c-d']));
  const { stories, outcomes } = planStories(t.records);
  assert.deepEqual(outcomes, { story: 1, placement: 0, duplicate: 1 });
  assert.equal(toImportedCoverageRow(stories[0], { coverageId: 'COV-1', now: new Date(0) })['Import source'], 'Media row 3; Media row 4');
});

test('social posts group by a long topic, or by the same publisher and topic across platforms; short generic topics stay apart', () => {
  const long = 'How To Get Into Top US Universities From Asia | Joash Lee';
  const rows = [['Date', 'Category', 'Topic', 'Link', 'Publisher', 'Social Media'], ['2025', '', '', '', '', ''],
    ['9 September', 'Brand', long, 'https://www.youtube.com/watch?v=abc', 'Nicole Lee', 'YouTube'],
    ['9 September', 'Brand', long, 'https://open.spotify.com/episode/xyz', 'Nicole Lee', 'Spotify'],
    ['13 September', 'Brand', long, 'https://www.instagram.com/p/AAA/', 'Nicole Lee', 'Instagram'],
    ['6 November', 'General', 'AI', 'https://www.linkedin.com/posts/abc', 'Asia Business Outlook', 'LinkedIn'],
    ['6 November', 'General', 'AI', 'https://x.com/abo/status/1', 'Asia Business Outlook', 'Twitter'],
    ['6 November', 'General', 'AI', 'https://www.linkedin.com/posts/other', 'Someone Else', 'LinkedIn'],
    ['20 January', 'Brand', 'Davos', 'https://www.linkedin.com/posts/d1', 'Karen', 'LinkedIn'],
    ['30 January', 'Brand', 'Davos', 'https://www.linkedin.com/posts/d2', 'Daniel', 'LinkedIn']];
  const t = parseTab(SOCIAL, rows);
  const { stories } = planStories(t.records);
  assert.deepEqual(stories.map((s) => s.placements.length).sort(), [0, 0, 0, 1, 2]);
  const podcast = stories.find((s) => s.placements.length === 2);
  const row = toImportedCoverageRow(podcast, { coverageId: 'COV-2', now: new Date(0) });
  assert.equal(row['Source type'], 'Social Media');
  assert.equal(row.Title, long);
  assert.equal(row['Syndicated copies'], 2);
  const spotify = toPlacementRow(podcast, podcast.placements[0], { coverageId: 'COV-2' });
  assert.equal(spotify['Story ID'], 'COV-2');
  assert.equal(spotify.Origin, 'Old tracker: Social Media row 4');
});

test('an imported row is never Verified, never has an alert time, and keeps the old values it cannot place in Notes', () => {
  const t = parseTab(MEDIA, mediaRows(['27 October', 'Press', 'e27.co', 'Pre-Seed Round', 'https://e27.co/sedifly-nets-oversubscribed-funding-to-democratise-access-20251027/']));
  const { stories } = planStories(t.records);
  const row = toImportedCoverageRow(stories[0], { coverageId: 'COV-000007', now: new Date(0) });
  for (const k of Object.keys(row)) assert.ok(COVERAGE_HEADERS.includes(k), `unknown header ${k}`);
  assert.equal(row.Verification, 'Needs verification');
  assert.equal(row['Found in'], 'Old');
  assert.equal(row['Source route'], 'Backfill: Old tracker');
  assert.equal(row['Logged by'], 'import');
  assert.equal('Instant alert sent' in row, false);
  assert.equal(row.Category, '');
  assert.equal(row['Source type'], 'Media');
  assert.match(row.Notes, /Old topic: Pre-Seed Round\. Old category: Press\. Title taken from the URL/);
  assert.equal(row['Published at'], '2026-10-27');
  assert.equal(row['Detected at'].getTime(), Date.UTC(2026, 9, 27, 4));
  assert.match(row.Title, /^Sedifly nets oversubscribed/);
});

test('the report proves every row is accounted for, and says which tabs were not found or not imported', () => {
  const tabs = [parseTab(MEDIA, mediaRows(['19 January', 'Event', 'A', 'T', PR('a.com')], ['19 January', 'Event', 'B', 'T', PR('b.com')], ['', '', '', '', ''])), parseTab(LISTING, [['Date', 'Link', 'Media Name', 'Catagory'], ['', 'https://crunchbase.com/x', 'Crunchbase', '']])];
  const plan = planStories(tabs.flatMap((t) => t.records));
  const { lines, balanced } = buildReport({ tabs, missing: [], extra: ['Scratch'], plan });
  assert.equal(balanced, true);
  const all = lines.find((l) => l[0] === 'All tabs');
  assert.deepEqual([all[4], all[5], all[6], all[7], all[8]], [3, 2, 1, 0, 'yes']);
  assert.ok(lines.some((l) => l[0] === 'Tabs in the file that are not imported' && l[1] === 'Scratch'));
  assert.ok(lines.some((l) => String(l[0]) === 'no date'));
});

test('slug words ignore ids, extensions and query strings', () => {
  assert.deepEqual(slugWords('https://x.com/article/904829828-edtech-startup-sedifly-appoints?utm=1'), ['edtech', 'startup', 'sedifly', 'appoints']);
  assert.deepEqual(slugWords('https://x.com/'), []);
});

test('the same publisher and topic on several platforms groups within 3 days; a week apart stays a separate story', () => {
  const rows = [['Date', 'Category', 'Topic', 'Link', 'Publisher', 'Social Media'], ['2026', '', '', '', '', ''],
    ['28 July', 'Event', 'HBSo Miami Chapter Webinar', 'https://www.linkedin.com/posts/g1', 'Giovanni', 'LinkedIn'],
    ['4 August', 'Event', 'HBSo Miami Chapter Webinar', 'https://www.linkedin.com/posts/g2', 'Giovanni', 'LinkedIn'],
    ['4 September', 'Event', 'Summit', 'https://lnkd.in/p/abc', 'Entrepreneur', 'LinkedIn'],
    ['4 September', 'Event', 'Summit', 'https://www.linkedin.com/posts/e2', 'Entrepreneur', 'LinkedIn'],
    ['5 September', 'Event', 'Summit', 'https://www.facebook.com/e/3', 'Entrepreneur', 'Facebook']];
  const t = parseTab(SOCIAL, rows);
  const { stories } = planStories(t.records);
  assert.deepEqual(stories.map((x) => x.placements.length), [0, 0, 2], 'the two Giovanni posts a week apart are two stories');
  assert.equal(stories[2].placements[0].matchRule, 'same publisher and topic within 3 days (one post on several platforms)');
  const rep = buildReport({ tabs: [t], missing: [], extra: [], plan: planStories(parseTab(SOCIAL, rows).records) });
  assert.ok(rep.lines.some((l) => /Short links/.test(l[0])), 'lnkd.in links are flagged');
});

test('Ameer Ibrahim coverage is Brand whatever the Old tracker said, and the change is written in Notes', () => {
  const t = parseTab(MEDIA, mediaRows(['20 August', 'General', 'KTLA-TV', 'Sedifly Appoints Callian Capital Group Managing Partner Ameer Ibrahim as a Board Advisor', 'https://www.ktla.com/business/press-releases/globenewswire/9813485/sedifly-appoints-callian-capital-group-managing-partner-ameer-ibrahim-as-a-board-advisor'], ['20 August', 'General', 'Other', 'AI', 'https://x.com/news/some-other-story-about-nothing-here']));
  const { stories } = planStories(t.records);
  const ameer = toImportedCoverageRow(stories[0], { coverageId: 'COV-1', now: new Date(0) });
  assert.equal(ameer.Category, 'Brand');
  assert.match(ameer.Notes, /Old category: General, changed to Brand \(owner decision 2026-11-04: Ameer Ibrahim coverage is Brand\)/);
  assert.equal(toImportedCoverageRow(stories[1], { coverageId: 'COV-2', now: new Date(0) }).Category, 'General');
});

test('a date typed after the new year began (cell is the heading year plus one) is corrected to the heading year, with the original kept', () => {
  const t = parseTab(MEDIA, [['Date', 'Category', 'Media Name', 'Topic', 'Link'], [2025, '', '', '', ''], [new Date(2026, 9, 27), 'Brand', 'e27.co', 'Pre-Seed', 'https://e27.co/sedifly-nets-oversubscribed-funding-20251027/'], [new Date(2030, 0, 12), 'Brand', 'Odd', 'T', 'https://odd.com/a-b-c']]);
  const [fixed, odd] = t.records;
  assert.equal(fixed.dateIso, '2025-10-27');
  assert.equal(fixed.ms, Date.UTC(2025, 9, 27, 4));
  assert.deepEqual(fixed.problems, ['date year corrected to the heading year']);
  assert.match(fixed.notes[0], /Original date cell: 2026-10-27\. Year corrected to 2025/);
  assert.equal(odd.dateIso, '2030-01-12', 'any other mismatch is kept as written and only flagged');
  assert.deepEqual(odd.problems, ['date year differs from the heading above']);
  const { stories } = planStories(t.records);
  const row = toImportedCoverageRow(stories[0], { coverageId: 'COV-1', now: new Date(0) });
  assert.equal(row['Published at'], '2025-10-27');
  assert.equal(row.Verification, 'Needs verification');
  assert.match(row.Notes, /Original date cell: 2026-10-27/);
});

test('Media rows default to News; podcasts, blogs and videos are decided by the link; social links stay Social', () => {
  assert.equal(mediaChannel('https://www.forbes.com/councils/x/2026/10/13/some-article/'), 'News');
  assert.equal(mediaChannel('https://www.einpresswire.com/article/1/some-press-release-title'), 'News');
  assert.equal(mediaChannel('https://www.pinevp.com/post/sedifly-the-ai-native-service'), 'Blog');
  assert.equal(mediaChannel('https://blog.example.com/a-b-c'), 'Blog');
  assert.equal(mediaChannel('https://podcasts.apple.com/au/podcast/28-how-to-get-into/id1'), 'Podcast');
  assert.equal(mediaChannel('https://www.yahoo.com/news/videos/democratizing-access-education-sedifly-rethinking-050020446.html'), 'Other');
  assert.equal(mediaChannel('https://wickedlocal.com/press-release/story/97576/edtech-startup-sedifly-appoints'), 'News');
  const t = parseTab(MEDIA, mediaRows(['1 March', 'Brand', 'Forbes', 'T', 'https://forbes.com/a/b-c-d'], ['2 March', 'Brand', 'LinkedIn', 'T', 'https://www.linkedin.com/posts/abc']));
  const { stories } = planStories(t.records);
  assert.deepEqual(stories.map((x) => toImportedCoverageRow(x, { coverageId: 'C', now: new Date(0) }).Channel), ['News', 'Social']);
  const rep = buildReport({ tabs: [t], missing: [], extra: [], plan: planStories(parseTab(MEDIA, mediaRows(['2 March', 'Brand', 'Pine', 'T', 'https://www.pinevp.com/post/a-b-c-d'])).records) });
  assert.ok(rep.lines.some((l) => /^Media channel: News is the default/.test(l[0]) && /Blog 1/.test(l[1])));
  assert.ok(rep.lines.some((l) => l[0] === 'Media channel Blog'));
});

test('a confirmed short link merges into the full link as a duplicate; unconfirmed short links stay separate', () => {
  const full = 'https://www.linkedin.com/posts/entrepreneur-asia-pacific_summit-activity-7501596551694258176-57j3';
  const rows = [['Date', 'Category', 'Topic', 'Link', 'Publisher', 'Social Media'], ['2026', '', '', '', '', ''], ['4 September', 'Event', 'Summit', 'https://lnkd.in/p/gd9adJA7', 'Entrepreneur', 'LinkedIn'], ['4 September', 'Event', 'Summit', full, 'Entrepreneur', 'LinkedIn']];
  assert.equal(planStories(parseTab(SOCIAL, rows).records).outcomes.duplicate, 0, 'nothing is assumed');
  KNOWN_SAME_POST.push(['https://lnkd.in/p/gd9adJA7', full]);
  try {
    const plan = planStories(parseTab(SOCIAL, rows).records);
    assert.deepEqual(plan.outcomes, { story: 1, placement: 0, duplicate: 1 });
    assert.equal(toImportedCoverageRow(plan.stories[0], { coverageId: 'C', now: new Date(0) })['Import source'], 'Social Media row 3; Social Media row 4');
  } finally { KNOWN_SAME_POST.pop(); }
});

test('the report counts the rows kept for review once each, with the reasons that add up', () => {
  const t = parseTab(MEDIA, [['Date', 'Category', 'Media Name', 'Topic', 'Link'], [2025, '', '', '', ''], [new Date(2026, 9, 27), 'Brand', 'A', 'T', 'https://a.com/a-b-c'], ['', 'Brand', 'B', 'T', ''], ['soon', 'Brand', 'C', 'T', 'see screenshot'], ['5 May', 'Brand', 'D', 'T', 'https://d.com/d-e-f']]);
  const { lines } = buildReport({ tabs: [t], missing: [], extra: [], plan: planStories(t.records) });
  const total = lines.find((l) => /^Rows kept for review, total/.test(l[0]));
  assert.equal(total[1], 3);
  assert.match(total[2], /1 date year corrected to the heading year/);
  assert.match(total[2], /1 no date \+ no link/);
  assert.match(total[2], /1 unreadable date \+ link is not a web address/);
});

test('missing and unreadable dates and links are kept with their original text, and listed for review', () => {
  const t = parseTab(MEDIA, mediaRows(['soon', 'Brand', 'X', 'T', 'see screenshot'], ['', 'Brand', 'Y', 'T', 'https://y.com/a-b-c']));
  const { stories } = planStories(t.records);
  const notes = stories.map((s) => toImportedCoverageRow(s, { coverageId: 'C', now: new Date(0) }).Notes);
  assert.ok(notes.some((n) => /Old date text: soon/.test(n) && /Old link text: see screenshot/.test(n)));
  assert.ok(notes.some((n) => /No date in the Old tracker/.test(n)));
  const rep = buildReport({ tabs: [t], missing: [], extra: [], plan: planStories(parseTab(MEDIA, mediaRows(['soon', 'Brand', 'X', 'T', 'see screenshot'], ['', 'Brand', 'Y', 'T', 'https://y.com/a-b-c'])).records) });
  const kept = rep.lines.filter((l) => /^Media row/.test(l[0]) && l[1]);
  assert.equal(kept.length, 2);
  assert.ok(kept.some((l) => l[2] === 'soon' && l[3] === 'see screenshot'));
});

test('the placement map lists every placement with its story, the days apart and the rule, plus every duplicate link', () => {
  const t = parseTab(MEDIA, mediaRows(['19 January', 'Event', 'EIN Presswire', 'T', PR('world.einnews.com')], ['20 January', 'Event', 'Wicked Local', 'T', PR('wickedlocal.com')], ['19 January', 'Event', 'EIN Presswire', 'T', PR('world.einnews.com')]));
  const plan = planStories(t.records);
  const map = buildPlacementMap(plan);
  assert.deepEqual(map[0].slice(0, 2), ['Kind', 'Old row']);
  const place = map.find((l) => l[0] === 'Placement');
  assert.deepEqual([place[1], place[5], place[9], place[10]], ['Media row 4', 'Media row 3', 1, 'same headline in the link (5 or more words)']);
  const dup = map.find((l) => l[0] === 'Duplicate link');
  assert.equal(dup[1], 'Media row 5');
  assert.equal(dup[5], 'Media row 3');
  assert.equal(map.length, 3);
});

// ---- through the built bundle ----
const sheetOf = (name, rows) => { const s = fakeSheet(name); rows.forEach((r) => s.rows.push(r)); return s; };
async function ready(extra = {}) {
  const env = makeEnv({ ...goodProps(), OLD_TRACKER_FILE_ID: 'old', ...extra });
  env.sheets.old = {
    'Media ': sheetOf('Media ', mediaRows(
      ['19 January', 'Event', 'EIN Presswire', 'Assembly', PR('world.einnews.com')],
      ['19 January', 'Event', 'Business News Today', 'Assembly', PR('business.einnews.com')],
      ['20 January', 'Event', 'Wicked Local', 'Assembly', PR('wickedlocal.com')],
      ['12 January', 'General', 'Tech in Asia', 'AI', 'https://www.techinasia.com/ai-unlocks-market-educational-consulting'],
    )),
    'Social Media': sheetOf('Social Media', [['Date', 'Category', 'Topic', 'Link', 'Publisher', 'Social Media', 'Screenshot'], ['2026', '', '', '', '', '', ''], ['5 January', 'Strategist', 'Jeremy', 'https://vt.tiktok.com/ZS55LGhrv/', 'Public', 'TikTok', '']]),
    'Non Media Listings': sheetOf('Non Media Listings', [['Date', 'Link', 'Media Name', 'Catagory'], ['2025', '2025', '2025', ''], ['', 'https://www.crunchbase.com/organization/sedifly', 'Crunchbase', '']]),
  };
  const sb = await load(env);
  vm.runInContext('setup()', sb);
  return { env, sb, run: (c) => vm.runInContext(c, sb) };
}
const col = (sheet, h) => sheet.rows[0].indexOf(h);

test('dry run writes only the Import Report tab; nothing reaches Coverage; the old file is untouched', async () => {
  const { env, run } = await ready();
  const before = JSON.stringify(env.sheets.old);
  const r = run('importOldDryRun()');
  assert.equal(r.status, 'OK');
  assert.equal(env.sheets.x.Coverage.rows.length, 1);
  assert.equal(env.sheets.x['Syndicated Placements'].rows.length, 1);
  assert.ok(env.sheets.x['Import Placement Map'].rows.length > 1, 'the placement map is written for confirmation');
  const rep = env.sheets.x['Import Report'].rows;
  assert.equal(rep[0][0], 'Old tracker import report');
  assert.ok(rep.some((l) => l[0] === 'All tabs' && l[8] === 'yes'));
  assert.ok(rep.some((l) => l[0] === 'Coverage rows already in the sheet before this import' && l[1] === 0));
  assert.equal(JSON.stringify(env.sheets.old), before, 'Old tracker not changed');
});

test('importOld refuses until IMPORT_CONFIRMED is YES', async () => {
  const { env, run } = await ready();
  assert.throws(() => run('importOld()'), /IMPORT_CONFIRMED/);
  assert.equal(env.sheets.x.Coverage.rows.length, 1);
});

test('importOld writes stories and placements, sends no mail and no alerts, and a second run writes nothing', async () => {
  const { env, run } = await ready({ IMPORT_CONFIRMED: 'YES', ALERT_RECIPIENTS: 'alerts@example.com' });
  const r = run('importOld()');
  assert.equal(r.status, 'COMPLETE');
  const cov = env.sheets.x.Coverage;
  const pl = env.sheets.x['Syndicated Placements'];
  assert.equal(cov.rows.length - 1, 4, '3 stories from Media/Social/Listing plus the AI story');
  assert.equal(pl.rows.length - 1, 2);
  const story = cov.rows.find((x) => x[col(cov, 'Outlet')] === 'EIN Presswire');
  assert.equal(story[col(cov, 'Syndicated copies')], 2);
  assert.equal(story[col(cov, 'Verification')], 'Needs verification');
  assert.equal(story[col(cov, 'Found in')], 'Old');
  assert.equal(story[col(cov, 'Import source')], 'Media row 3');
  assert.ok(pl.rows.slice(1).every((x) => x[col(pl, 'Story ID')] === story[col(cov, 'Coverage ID')] && /^Old tracker: Media row/.test(x[col(pl, 'Origin')])));
  assert.ok(cov.rows.slice(1).every((x) => x[col(cov, 'Instant alert sent')] === ''));
  assert.deepEqual(env.mail, []);
  const social = cov.rows.find((x) => x[col(cov, 'Source type')] === 'Social Media');
  assert.equal(social[col(cov, 'Channel')], 'Social');
  const listing = cov.rows.find((x) => x[col(cov, 'Source type')] === 'Non-Media Listings');
  assert.equal(listing[col(cov, 'Channel')], 'Listing');
  const ids = cov.rows.slice(1).map((x) => x[col(cov, 'Coverage ID')]);
  assert.equal(new Set(ids).size, ids.length);
  const again = run('importOld()');
  assert.equal(again.storiesWritten, 0);
  assert.equal(again.placementsWritten, 0);
  assert.equal(cov.rows.length - 1, 4);
  assert.equal(pl.rows.length - 1, 2);
});

test('a half finished import resumes: the story that already has its row only gets the missing placements', async () => {
  const { env, run } = await ready({ IMPORT_CONFIRMED: 'YES' });
  const cov = env.sheets.x.Coverage;
  cov.rows.push(COVERAGE_HEADERS.map((h) => ({ 'Coverage ID': 'COV-000050', 'Import source': 'Media row 3' }[h] ?? '')));
  env.store.NEXT_COVERAGE_ID = '51';
  run('importOld()');
  const pl = env.sheets.x['Syndicated Placements'];
  assert.equal(pl.rows.slice(1).filter((x) => x[col(pl, 'Story ID')] === 'COV-000050').length, 2);
  assert.equal(cov.rows.filter((x) => x[col(cov, 'Import source')] === 'Media row 3').length, 1, 'no second row for the same Old row');
});

test('a missing tab stops the import with a plain message', async () => {
  const { env, run } = await ready({ IMPORT_CONFIRMED: 'YES' });
  delete env.sheets.old['Non Media Listings'];
  assert.throws(() => run('importOldDryRun()'), /no tab named Non Media Listings/);
});
