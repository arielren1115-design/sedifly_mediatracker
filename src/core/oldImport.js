// Old tracker import (BUILD_SPEC 16, owner decisions 2026-11-03). Pure: rows in, a plan out. Nothing here touches Google services.
//   - every row of every tab ends as a story, a placement of a story, or a duplicate link, and the report proves it adds up
//   - same headline (5 or more words) within 7 days is one story with every placement kept
//   - imported rows are never Verified, never alert, and keep their Old tab and row number
import { normalizeUrl } from './normalizeUrl.js';
import { parseUrl } from './urlParts.js';
import { channelFromUrl } from './channel.js';
import { CATEGORIES } from './taxonomy.js';

export const SOURCE_ROUTE = 'Backfill: Old tracker';
const DAY_MS = 24 * 3600 * 1000;
export const GROUP_WINDOW_MS = 7 * DAY_MS;
/** One publisher posting the same topic on several platforms happens within a day or two; a week apart is a different post (Ben, 2026-11-04). */
export const SAME_PUBLISHER_WINDOW_MS = 3 * DAY_MS;

/**
 * Stories whose Old category is overridden by an owner decision. The change is written into Notes so it is never silent.
 * Add a line here for any further decision. `pattern` is tested against the Old topic and the link.
 */
export const CATEGORY_OVERRIDES = [
  { pattern: /ameer[\s-]+ibrahim/i, category: 'Brand', reason: 'owner decision 2026-11-04: Ameer Ibrahim coverage is Brand' },
];
const VALID_CATEGORIES = CATEGORIES.map((c) => c.value);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The three tabs of the Old tracker, matched by name ignoring case and stray spaces. */
export const OLD_TABS = [
  { key: 'Media', match: 'media', kind: 'media' },
  { key: 'Social Media', match: 'social media', kind: 'social' },
  { key: 'Non Media Listings', match: 'non media listings', kind: 'listing' },
];

const clean = (v) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
const lower = (v) => clean(v).toLowerCase();

/** @param {string[]} names sheet names @returns {{found: Object<string,string>, missing: string[], extra: string[]}} */
export function matchTabs(names) {
  const found = {};
  for (const t of OLD_TABS) { const n = names.find((x) => lower(x) === t.match); if (n !== undefined) found[t.key] = n; }
  return { found, missing: OLD_TABS.filter((t) => !(t.key in found)).map((t) => t.key), extra: names.filter((n) => !Object.values(found).includes(n)) };
}

const COLUMN_ALIASES = {
  date: ['date'], category: ['category', 'catagory'], outlet: ['media name', 'publisher'], topic: ['topic'], url: ['link'], platform: ['social media'],
};

/** Day and month from a date cell. The year comes from the year heading above the row, because "27 October" carries no reliable year. */
function dayMonth(cell) {
  if (cell && typeof cell.getTime === 'function') return Number.isNaN(cell.getTime()) ? null : { d: cell.getDate(), m: cell.getMonth() + 1, y: cell.getFullYear() };
  const m = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/.exec(clean(cell));
  if (!m) return null;
  const mi = MONTHS.findIndex((x) => x.startsWith(m[2].toLowerCase().slice(0, 3)));
  return mi < 0 ? null : { d: Number(m[1]), m: mi + 1, y: m[3] ? Number(m[3]) : null };
}

/** What a cell shows, with a real date written as YYYY-MM-DD. */
const shown = (v) => (v && typeof v.getTime === 'function' && !Number.isNaN(v.getTime()) ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : clean(v));
const isYear = (v) => /^20\d\d$/.test(clean(v));

/**
 * Reads one tab. Rows are accounted for as headings, blanks or data.
 * @param {{key: string, kind: string}} tab
 * @param {any[][]} rows sheet values, header row included
 */
export function parseTab(tab, rows) {
  const hi = rows.findIndex((r) => r.some((c) => lower(c) === 'link') && r.some((c) => lower(c) === 'date'));
  const out = { tab: tab.key, kind: tab.kind, records: [], headerRow: hi + 1, rowsBelowHeader: 0, yearHeadings: 0, blankRows: 0, unreadable: [], yearMismatch: 0 };
  if (hi < 0) return { ...out, error: `The ${tab.key} tab has no header row with Date and Link` };
  const header = rows[hi].map(lower);
  const col = {};
  for (const [k, names] of Object.entries(COLUMN_ALIASES)) col[k] = header.findIndex((h) => names.includes(h));
  if (tab.kind === 'social') col.outlet = header.indexOf('publisher');
  else col.outlet = header.indexOf('media name');
  let year = null;
  rows.slice(hi + 1).forEach((r, i) => {
    out.rowsBelowHeader++;
    const sheetRow = hi + 2 + i;
    const cells = r.map(clean);
    if (cells.every((c) => !c)) { out.blankRows++; return; }
    if (isYear(r[0]) && !cells.some((c) => /^https?:\/\//i.test(c))) { year = Number(clean(r[0])); out.yearHeadings++; return; }
    const get = (k) => (col[k] >= 0 ? r[col[k]] : '');
    const dm = dayMonth(get('date'));
    const rawUrl = clean(get('url'));
    const rawDate = shown(get('date'));
    const rec = {
      tab: tab.key, kind: tab.kind, sheetRow, key: `${tab.key} row ${sheetRow}`,
      category: clean(get('category')), outlet: clean(get('outlet')), topic: clean(get('topic')), platform: clean(get('platform')),
      url: /^https?:\/\//i.test(rawUrl) ? rawUrl : '', rawLink: rawUrl, rawDate, dateIso: null, ms: null, problems: [], notes: [],
    };
    if (rawDate === '') rec.problems.push('no date');
    else if (!dm) rec.problems.push('unreadable date');
    else {
      // Dates are kept as they are in the cell. The heading year is used only when the cell carries no year, and a cell that
      // disagrees with its heading is flagged for a person, never corrected (Ben, 2026-11-04).
      const y = dm.y || year;
      if (!y) rec.problems.push('no year heading above the row');
      else {
        const check = new Date(Date.UTC(y, dm.m - 1, dm.d));
        if (check.getUTCMonth() !== dm.m - 1 || check.getUTCDate() !== dm.d) rec.problems.push('impossible date');
        else {
          rec.dateIso = `${y}-${String(dm.m).padStart(2, '0')}-${String(dm.d).padStart(2, '0')}`;
          rec.ms = Date.UTC(y, dm.m - 1, dm.d, 4, 0, 0); // 12:00 Singapore time
          if (dm.y && year && dm.y !== year) {
            out.yearMismatch++;
            rec.problems.push('date year differs from the heading above');
            rec.notes.push(`Date check: the date cell says ${rec.dateIso} but the heading above the row says ${year}. Date kept as in the cell, please check`);
          }
        }
      }
    }
    if (!rec.url) rec.problems.push(rawUrl ? 'link is not a web address' : 'no link');
    if (rec.category && !VALID_CATEGORIES.includes(rec.category)) rec.problems.push(`category "${rec.category}" is not one of the four`);
    out.records.push(rec);
  });
  return out;
}

/** Words of the headline carried in the URL path, or [] when the path has no headline. */
export function slugWords(url) {
  const p = parseUrl(url || '');
  if (!p) return [];
  const last = p.pathname.replace(/\/+$/, '').split('/').pop() || '';
  const s = last.replace(/\.(html?|php|aspx?)$/i, '').replace(/^\d+-/, '').replace(/-\d{6,}$/, '');
  return s.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

const sentence = (words) => { const t = words.join(' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

/** The ways a record can join a story: a key, how to describe the match, and how far apart in time the posts may be. */
function groupKeys(rec) {
  const keys = [];
  if (rec.kind === 'media') {
    const w = slugWords(rec.url);
    if (w.length >= 5) keys.push({ key: `h:${w.join('').toLowerCase()}`, rule: 'same headline in the link (5 or more words)', windowMs: GROUP_WINDOW_MS });
  } else if (rec.kind === 'social' && rec.topic) {
    const t = rec.topic.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (t.split(' ').length >= 5) keys.push({ key: `t:${t}`, rule: 'same long topic (5 or more words)', windowMs: GROUP_WINDOW_MS });
    if (rec.outlet) keys.push({ key: `p:${rec.outlet.toLowerCase()}|${t}`, rule: 'same publisher and topic within 3 days (one post on several platforms)', windowMs: SAME_PUBLISHER_WINDOW_MS });
  }
  return keys;
}

/**
 * Groups parsed records into stories with placements.
 * @param {object[]} records from parseTab, all tabs together
 * @returns {{stories: object[], outcomes: {story: number, placement: number, duplicate: number}}}
 */
export function planStories(records) {
  const order = (r) => OLD_TABS.findIndex((t) => t.key === r.tab);
  const sorted = [...records].sort((a, b) => (a.ms === null) - (b.ms === null) || (a.ms || 0) - (b.ms || 0) || order(a) - order(b) || a.sheetRow - b.sheetRow);
  const byUrl = new Map();
  const byKey = new Map();
  const stories = [];
  const outcomes = { story: 0, placement: 0, duplicate: 0 };
  const duplicates = [];
  for (const rec of sorted) {
    const norm = rec.url ? normalizeUrl(rec.url) : null;
    rec.norm = norm || '';
    if (norm && byUrl.has(norm)) {
      const first = byUrl.get(norm);
      (first.alsoAt = first.alsoAt || []).push(rec.key);
      rec.outcome = 'duplicate';
      rec.duplicateOf = first.key;
      duplicates.push(rec);
      outcomes.duplicate++;
      continue;
    }
    let target = null;
    if (rec.ms !== null) {
      for (const k of groupKeys(rec)) {
        target = (byKey.get(k.key) || []).find((s) => s.main.ms !== null && Math.abs(rec.ms - s.main.ms) <= k.windowMs) || null;
        if (target) { rec.matchRule = k.rule; break; }
      }
    }
    if (target) {
      target.placements.push(rec);
      rec.outcome = 'placement';
      outcomes.placement++;
    } else {
      const story = { main: rec, placements: [] };
      stories.push(story);
      rec.outcome = 'story';
      outcomes.story++;
      for (const k of groupKeys(rec)) { if (!byKey.has(k.key)) byKey.set(k.key, []); byKey.get(k.key).push(story); }
    }
    if (norm) byUrl.set(norm, rec);
  }
  return { stories, outcomes, duplicates };
}

const KIND_SOURCE_TYPE = { media: 'Media', social: 'Social Media', listing: 'Non-Media Listings' };

const importSource = (rec) => [rec.key, ...(rec.alsoAt || [])].join('; ');

/**
 * The Coverage row for a story. Imported rows are never Verified and never alerted.
 * @param {{main: object, placements: object[]}} story
 * @param {{coverageId: string, now: Date}} ctx
 */
export function toImportedCoverageRow(story, { coverageId, now }) {
  const r = story.main;
  const words = r.kind === 'media' ? slugWords(r.url) : [];
  const notes = [];
  if (r.topic) notes.push(`Old topic: ${r.topic}`);
  let category = VALID_CATEGORIES.includes(r.category) ? r.category : '';
  if (r.category && !category) notes.push(`Old category: ${r.category}`);
  const override = CATEGORY_OVERRIDES.find((o) => o.pattern.test(`${r.topic} ${r.url}`));
  if (override && category !== override.category) {
    notes.push(`Old category: ${r.category || 'blank'}, changed to ${override.category} (${override.reason})`);
    category = override.category;
  }
  if (r.kind === 'media' && words.length >= 3) notes.push('Title taken from the URL');
  if (r.platform) notes.push(`Platform: ${r.platform}`);
  if (!r.dateIso) notes.push(r.rawDate ? `Old date text: ${r.rawDate}` : 'No date in the Old tracker');
  notes.push(...r.notes);
  if (!r.url) notes.push(r.rawLink ? `Old link text: ${r.rawLink}` : 'No link in the Old tracker');
  let channel = channelFromUrl(r.url) || '';
  if (r.kind === 'social' && /spotify|apple podcast|podcasts\.apple\.com/i.test(`${r.platform} ${r.url}`)) channel = 'Podcast';
  else if (!channel && r.kind === 'social') channel = 'Social'; // for example youtu.be short links, which are not in the spec domain list
  else if (!channel && r.kind === 'listing') channel = 'Listing';
  return {
    'Coverage ID': coverageId,
    'Detected at': r.ms === null ? '' : new Date(r.ms),
    'Published at': r.dateIso || '',
    Channel: channel,
    'Source type': KIND_SOURCE_TYPE[r.kind],
    Outlet: r.outlet,
    Title: r.kind === 'social' && r.topic.split(' ').length >= 5 ? r.topic : words.length >= 3 ? sentence(words) : '',
    URL: r.url,
    'Normalised URL': r.norm,
    Category: category,
    'Archive status': 'Pending',
    'Found in': 'Old',
    Verification: 'Needs verification',
    'Source route': SOURCE_ROUTE,
    'Syndicated copies': story.placements.length || '',
    'Logged by': 'import',
    'Import source': importSource(r),
    Notes: notes.join('. '),
    'Last updated': now,
  };
}

/** One line of the Syndicated Placements tab. */
export function toPlacementRow(story, placement, { coverageId }) {
  const w = placement.kind === 'media' ? slugWords(placement.url) : [];
  return {
    'Story ID': coverageId,
    'Story URL': story.main.norm,
    'Placement URL': placement.url,
    'Placement normalised URL': placement.norm,
    Outlet: placement.outlet,
    Title: w.length >= 3 ? sentence(w) : '',
    'Detected at': placement.ms === null ? '' : new Date(placement.ms),
    'Source route': SOURCE_ROUTE,
    Origin: `Old tracker: ${importSource(placement)}`,
    'Submitted by': '',
    'Gmail message ID': '',
  };
}

/** The key written to `Import source` / `Origin` that identifies an Old row, used to resume without writing anything twice. */
export const rowKeyOf = (rec) => rec.key;

/**
 * Report lines for the Import Report tab, including the proof that every row is accounted for.
 * @returns {{lines: string[][], balanced: boolean}}
 */
export function buildReport({ tabs, missing, extra, plan }) {
  const lines = [['Old tracker import report', '']];
  let balanced = true;
  lines.push(['Tab', 'Rows below header', 'Year headings', 'Blank rows', 'Data rows', 'Stories', 'Placements', 'Duplicate links', 'Adds up']);
  const total = { rows: 0, data: 0, story: 0, placement: 0, duplicate: 0 };
  for (const t of tabs) {
    const mine = t.records;
    const c = (o) => mine.filter((r) => r.outcome === o).length;
    const ok = t.yearHeadings + t.blankRows + mine.length === t.rowsBelowHeader && c('story') + c('placement') + c('duplicate') === mine.length;
    balanced = balanced && ok;
    lines.push([t.tab, t.rowsBelowHeader, t.yearHeadings, t.blankRows, mine.length, c('story'), c('placement'), c('duplicate'), ok ? 'yes' : 'NO']);
    total.rows += t.rowsBelowHeader; total.data += mine.length; total.story += c('story'); total.placement += c('placement'); total.duplicate += c('duplicate');
  }
  lines.push(['All tabs', total.rows, '', '', total.data, total.story, total.placement, total.duplicate, balanced ? 'yes' : 'NO']);
  lines.push(['', '']);
  lines.push(['Tabs not found', missing.join(', ') || 'none']);
  lines.push(['Tabs in the file that are not imported', extra.join(', ') || 'none']);
  lines.push(['', '']);
  lines.push(['Things to look at', 'Rows']);
  const problems = {};
  const norm = (p) => p.replace(/"[^"]*"/, '"..."');
  for (const t of tabs) for (const r of t.records) for (const p of r.problems) (problems[norm(p)] = problems[norm(p)] || []).push(r.key);
  for (const [p, keys] of Object.entries(problems)) lines.push([p, `${keys.length} rows, for example ${keys.slice(0, 5).join(', ')}`]);
  const short = tabs.flatMap((t) => t.records).filter((r) => /^https?:\/\/(lnkd\.in|youtu\.be)\//i.test(r.url));
  if (short.length) lines.push(['Short links (lnkd.in, youtu.be) cannot be matched to the full post link without opening them, so a post may appear twice', `${short.length} rows, for example ${short.slice(0, 5).map((r) => r.key).join(', ')}`]);
  lines.push(['', '']);
  lines.push(['Rows kept for review (nothing is corrected or dropped)', 'Problem', 'Old date text', 'Old link text', 'Outlet', 'Old topic', 'Category in the Old tracker', 'Detail']);
  for (const t of tabs) for (const r of t.records) {
    const flagged = r.problems.filter((p) => !/^category "/.test(p));
    if (flagged.length) lines.push([r.key, flagged.join('; '), r.rawDate, r.rawLink, r.outlet, r.topic, r.category, r.notes.join(' ')]);
  }
  lines.push(['', '']);
  lines.push(['Largest stories', 'Placements', 'First seen', 'Outlet', 'Old topic', 'Link']);
  for (const s of [...plan.stories].sort((a, b) => b.placements.length - a.placements.length).slice(0, 40)) {
    if (!s.placements.length) break;
    lines.push([s.main.key, s.placements.length, s.main.dateIso || '', s.main.outlet, s.main.topic, s.main.url]);
  }
  const social = plan.stories.filter((s) => s.main.kind === 'social' && s.placements.length);
  if (social.length) {
    lines.push(['', '']);
    lines.push(['Social stories grouped (please check)', 'Placements', 'First seen', 'Publisher', 'Old topic', 'Platforms']);
    for (const s of social) lines.push([s.main.key, s.placements.length, s.main.dateIso || '', s.main.outlet, s.main.topic, [s.main, ...s.placements].map((r) => r.platform).join(', ')]);
  }
  return { lines, balanced };
}

/**
 * Every placement and every duplicate link with the story it would join, for the owners to confirm before anything is imported.
 * @returns {string[][]} lines for the Import Placement Map tab
 */
export function buildPlacementMap(plan) {
  const lines = [['Kind', 'Old row', 'Outlet', 'Link', 'Date', 'Joins story (Old row)', 'Story outlet', 'Story link', 'Story date', 'Days from story', 'Why']];
  const days = (a, b) => (a.ms === null || b.ms === null ? '' : Math.round((a.ms - b.ms) / 86400000));
  for (const s of plan.stories) {
    for (const p of s.placements) lines.push(['Placement', p.key, p.outlet, p.url, p.dateIso || '', s.main.key, s.main.outlet, s.main.url, s.main.dateIso || '', days(p, s.main), p.matchRule || '']);
  }
  for (const d of plan.duplicates) lines.push(['Duplicate link', d.key, d.outlet, d.url, d.dateIso || '', d.duplicateOf, '', '', '', '', 'same link as the row on the left (merged, both rows kept in Import source)']);
  return lines;
}
