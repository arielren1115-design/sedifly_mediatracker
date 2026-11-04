# PROGRESS

## M0: Repo, tooling, setup()  (status: done, 2026-10-14)

### Definition of done and how each item was shown

| DoD item | Evidence |
|---|---|
| `npm test` passes | 12 of 12 tests pass locally. They cover the sheet schema, the Script Properties rules, and a run of the real built `setup()` against fake Google services. |
| `clasp push` to DEV works | `npm run push:dev` pushed 4 files (Code.js, Entrypoints.js, DevProps.js, appsscript.json) to the DEV project. |
| `setup()` creates tabs, headers, labels, triggers and validates properties | Run in the DEV editor by Ariel. Tabs and headers in both DEV sheets, four `Monitoring/*` Gmail labels, four triggers. Local test also shows it fails loudly with the full list of missing keys. |
| Running it twice changes nothing | Local test compares a full snapshot (tabs, headers, labels, triggers, properties) before and after a second run. Ariel also ran it twice in DEV. Note: the editor results were reported by Ariel, not read back by the tool. |

### What was built
- Project layout, git, `package.json`, esbuild bundle (`dist/Code.js`, global `App`) plus `dist/Entrypoints.js`.
- `src/core/schema.js` (tabs, headers, labels, trigger plan) and `src/core/properties.js` (Script Properties validation).
- `src/gas/` adapters: config, sheets, gmail (advanced service), triggers, runLog.
- `src/jobs/setup.js` plus stubs for ingest, review sync, digest, backfill, blind, heartbeat so triggers resolve.
- DEV settings live in a git-ignored `dev.properties.json`. `npm run push:dev` turns it into `DevProps.js` with `seedDevProperties()`. PROD builds never include it.
- DEV project: Sedifly Media Monitoring (DEV). Its ID is in the git-ignored `.clasp.json`.

### Choices made where the spec is silent (please confirm)
1. **Review Queue columns**: spec 6.2 says "all columns of Coverage that the classifier produced, plus" four review columns. I used every Coverage column plus the four. Proposed spec wording: "all Coverage columns".
2. **Placeholders**: `setup()` requires every key in 5.1, so DEV uses the value `PLACEHOLDER` for `OLD_TRACKER_FILE_ID`, `ANTHROPIC_API_KEY` and `SCREENSHOTONE_ACCESS_KEY`. `setup()` accepts it and reports it as a warning. Replace before M3, M4 and M7.
3. **Trigger handling**: as in spec 14, `setup()` deletes and recreates its own four triggers. The end state is identical each run, but trigger IDs change.
4. **Blank default tab**: `setup()` removes an empty `Sheet1` from the sheets when other tabs exist.
5. **Dropdown**: the `Decision` column on Review Queue gets an Approve or Reject dropdown for rows 2 to the sheet's last row.
6. **DEV recipients**: all four recipient properties are `ariel@sedifly.com`, allowlist is `@sedifly.com`.

### Open issues and inputs needed for M1
- **DEV mailbox**: spec 5 says DEV uses a test mailbox (`TODO(Ariel)`). The DEV script runs as ariel@sedifly.com, so the four `Monitoring/*` labels were created in that real mailbox. Nothing reads mail yet. Decide the DEV mailbox before M1 so ingest only ever sees test mail.
- Exact alert sender addresses (Google Alerts, Talkwalker, F5Bot) and the Gmail filter definitions.
- Fixture `.eml` files: at least 3 per alert sender and at least 5 team forwards, each with an expected JSON.
- DEV triggers fire the stub functions every 5 minutes. They do nothing and are harmless.
- `clasp` login was done with the no-localhost flow. Credentials are in the home folder, outside the repo.

### Spec changes proposed
- 6.2: reword to "all Coverage columns plus Review reason, Decision, Reviewed by, Synced at".
- 5.1: state that placeholder values are allowed in DEV until the milestone that needs them.

## M1: Ingest and parse  (status: code complete, live DEV test pending)

### Built
- Parsers, all test first from real redacted fixtures: team forward, Google Alerts (HTML microdata, redirect unwrapped), Talkwalker (HTML, direct links, dd/mm/yy dates). **F5Bot is not built**: no real email yet.
- Gmail layer: per message listing and relabelling with the advanced service (one `modify` call adds Processed or Review and removes the source label). Team forwards are read first.
- Sender based routing, sender allowlist, Gmail API to parser message conversion.
- Ingest batch loop with lock, batch size, time budget, and per item idempotency (Gmail message ID plus URL, checked against Coverage and Review Queue).
- Provisional Coverage rows (Coverage ID, Detected at, Published at, Outlet, Title, URL, Excerpt, Source route, Found in = Tool, Verification = Needs verification, Archive status = Pending, Gmail message ID, Logged by, Last updated). Entity, category, priority and normalised URL stay blank until M2 and M3.
- Run Log writer, one row per run. `LAST_SUCCESS_AT` is set after an OK run.
- `setup()` now also sets both sheets to the Asia/Singapore timezone.
- Tests: 50 passing. They include a run of the real built bundle against fake Gmail and Sheets, which reproduces the blocker 2 scenario locally (unrelated mail untouched, bad mail labelled Review, second run writes nothing new).

### Finding worth knowing
Apps Script has no `URL`, `URLSearchParams`, `TextDecoder` or `Buffer`. The wiring test caught `new URL` silently dropping every forwarded link. All URL handling now uses `src/core/urlParts.js`, and a guard test fails if forbidden globals return to `src/`.

### Choices to confirm
1. `RawItem` gets `channelHint` (Social for screenshot-only forwards). Proposed spec change.
2. `parse(message) -> RawItem[]` keeps the spec signature. Sender checks and parser choice live in `ingestRouting.js`.
3. Forwarded alerts yield one item per article link, with no title or snippet (accepted by Ariel, 2026-10-18). Alert vendor links are skipped, and a bare homepage is dropped when a deeper link on the same site is present.
4. Alert vendor sender addresses (Google Alerts, Talkwalker) are constants in `ingestRouting.js`, because they identify public services and are not secrets. Confirmed by Ariel on 2026-10-18 as acceptable under rule 7.
5. Talkwalker dates are read as day/month/year. A different alert language or locale could change that. Published at is stored as a date only, because the email gives no time zone.
6. Provisional rows are written in M1 so the DEV test can show "processed once". They can be cleared from the DEV sheet before M2.
7. The `From` header can be spoofed. Worth checking SPF and DMARC results in a later milestone.
8. A Run Log row is written on every run, including idle ones, which is about 288 rows a day at 5 minute intervals. Revisit if that gets noisy.

### Live DEV test results (2026-10-18, run by Ariel)
- Found and fixed two Apps Script differences that local tests had hidden: no `URL` class, and Gmail body data arrives as a byte array, not base64 text. Each now has a regression test.
- Team forwards: 4 emails processed, 6 rows (link only, screenshot only, link plus comment, three links). Screenshot-only forward has no URL and channel Social.
- Review: 3 emails from a personal Gmail went to `Monitoring/Review` (outside the allowlist), as designed.
- Unrelated email untouched. Verified by Ariel.
- Native alerts: Talkwalker (2 rows, COV-000007 and COV-000008) and Google Alerts (1 row, COV-000009) parsed correctly on real Gmail, matching the fixtures. The redirect link was unwrapped.
- Second run: Run Log shows an idle `OK` run with 0 messages and no new Coverage rows (idempotent).

### Open issues
- The `Detected at`, `Instant alert sent` and `Last updated` columns display as dates only, although the stored value includes the time. Proposed fix: set a datetime number format in `setup()`. Detected at matters for SLA timing.
- Still to do for M1: F5Bot parser and live F5Bot test. Waiting for the first real F5Bot email (the account was set up on 2026-10-18).

## M2: Normalise, dedupe, entity match  (status: in progress, started 2026-10-18)

DoD: (1) URL normalisation table test with at least 25 cases passes. (2) The same article via Google Alerts and Talkwalker is one row with both routes. (3) A person entity without an anchor term is not matched.

### Done
- Datetime display formats applied by `setup()` (Detected at, Instant alert sent, Last updated, Synced at, Started at as `yyyy-mm-dd hh:mm:ss`; Published at as `yyyy-mm-dd`). Re-run `setup` in DEV to apply.
- DoD 1: `normalizeUrl` with 38 table cases plus 4 invalid inputs in `fixtures/urls/cases.json`.
- DoD 2: dedupe by normalised URL. A repeat appends the route to `Source route`, adds `Tool` to `Found in`, and refreshes `Last updated`. No other cell is touched, and the script refuses to write any other column. Same title from a different URL within 7 days goes to the Review Queue as `Possible duplicate` with no Coverage ID. Items with no URL are never merged. Works within one batch and across runs. Tested locally and against the built bundle.
- `Normalised URL` is now written on every new row. Existing rows with a blank value are normalised on the fly from their URL.
- Real config files saved as `fixtures/config/entities.csv` and `fixtures/config/rules.csv`.
- Entity matching engine (`src/core/csv.js`, `src/core/entities.js`), tested against the real entities file. It is **not wired into the live job yet**, so DEV behaviour is unchanged. Defaults, all switchable and pending owner confirmation: a quoted phrase is exact, loose words must all appear, every part of the primary term must be present, aliases are alternative exact phrases, whole words only, case insensitive, `Recent watch` entities stay monitored (option `honourEndDates` turns expiry on).
- Check on the three real alert items: Forbes matches Sedifly and Joash Lee, campus.sg matches Sedifly, and the Unisba video credit matches Joash Lee (very likely a different person, which is open question 2 below).

### Spec notes
- Reddit comment canonical form (`/comments/<id>/<commentId>`) looks the same as a post with a slug, so a Reddit comment cannot be normalised twice. Always normalise the original URL, never a stored one.
- `To review` in the Run Log counts messages sent to `Monitoring/Review` and items sent to the Review Queue.

### Owner decisions received (Ben, via Ariel, 2026-10-25) and how they were applied
- Taxonomy stays as it is. Coverage categories: General, Event, Brand, Strategist. Source types: Media, Social Media, Non-Media Listings. Priorities: Critical, High, Routine, kept separate from the routing decision. Ariel's proposed Press mention / Leadership / Partnership lists and High / Medium / Low priorities were rejected.
- Joash needs identity verification but not necessarily an explicit Sedifly mention. Strategists must be findable without Sedifly. Ambiguous matches go to review. Expired event watches were made inactive in the sheet (no longer `Recent watch`). MR-004 stays inactive for v1.
- Rules now have MR- IDs, an Active column, Applies to category and Default priority in the master sheet (new layout: Index, Active, Applies to category, Default priority, Route, Trigger, Examples, Required system action, Human action, Target timing, Notes / guardrails). The Drive connector only shows each tab's first rows, so the full rules still need a CSV export before M3.
- Applied: matches are now **strong** or **ambiguous**. Brands, partners and events: any hit is strong. People (founder, strategists): an alias hit, a primary term with an anchor word, or a bare name with Sedifly mentioned elsewhere is strong; a bare name alone is ambiguous. Only ambiguous matches go to the Review Queue (reason `Ambiguous entity match`, with the candidate in Entity when there is exactly one). No match from an alert is skipped and listed in the Run Log (`Skipped (no entity)`); no match from a team forward is logged anyway. The alert's own name ("Google Alert - Joash Lee") counts as an ambiguous hint.
- The job now reads the Monitored Entities tab of the PR Activity Tracker (read only) every run that has messages to process. DEV points at Ben's master sheet.

### Spec changes proposed
- 6.2 Review reason: add `Ambiguous entity match`.
- RawItem: add `alertName` and `channelHint`.
- 9.1: replace Match terms and Anchor terms with the Primary search term and Aliases columns the sheet actually has, and add the strong and ambiguous rule above.
- 6.1: the owners keep a second classification, Source type (Media, Social Media, Non-Media Listings), which the Coverage tab has no column for. Decision needed: add a column, or derive it from Channel.

### Still open before M2 is closed
- Live DEV test of the entity gate (steps given to Ariel).
- Original blocked notes kept below for the record.

### Earlier notes on the config files (resolved above unless marked)
**Monitored Entities** columns are: Entity ID, Entity name, Entity type (Brand, Founder, Strategist, Partner, Event), Primary search term, Aliases / variants, Default category, Monitoring status (Active, Recent watch), Alert sensitivity (Critical, High, Standard), Start date, Review / end date, Notes. The spec expected Name, Type, Match terms, Anchor terms, Active, Notes. Row 1 is a title, so headers are on row 2.
1. How should matching work? Proposal: read Primary search term like a search query (quoted text is an exact phrase, loose words must all appear, everything must be present); each alias is an alternative exact phrase.
2. "Joash Lee" alone is the primary term, but the first real Google Alert for that name was a different person (a video crew credit). Should the bare name match, or only with Sedifly, founder or CEO nearby (the aliases)?
3. Several strategists are `"Name" Sedifly`, while a few are name only. The rules say strategist coverage counts even without Sedifly. Is `"Name" Sedifly` a hard requirement?
4. Alert emails only carry a short snippet, which may lack the second word even when the web page has it. Proposal: also treat the alert's own name (Google subject, Talkwalker alert name, F5Bot keyword) as an entity hint, so valid results are not skipped.
5. Events marked `Recent watch` have review dates that are already past (30 Sep 2026, 15 Sep 2026). Still monitor them, or treat them as inactive?
6. Entity type mapping: Brand, Founder, Strategist, Partner, Event versus the spec's Company and Person.

Still needed to finish DoD 3 and wire the engine in: the answers above, plus the Monitored Entities tab pasted into the DEV PR Tracker sheet (the engine reads the live tab, title row included).

**Monitoring Rules** has `Index` 1 to 14, `Route` (Instant alert, Digest, Archive only), Trigger, Examples, Required system action, Human action, Target timing and Notes. There are no `MR-xxx` IDs and no Active column, so the spec's live rule list (MR-003, MR-005, ...) cannot be mapped to these rows without guessing. Not needed for M2, but needed before M3 (prompt) and M5 (routing). Needed from Ben: the MR-xxx IDs for each row, which rows are live in v1, and the taxonomy (Category and Priority values).

### Monitoring Rules, as seen in Ariel's screenshot (2026-10-25)
Columns: Index (MR-xxx), Active, Applies to category, Default priority, Route, Trigger, Examples, Required system action, Human action, Target timing, Notes / guardrails. MR-001 was cut off in the screenshot and is not seen.

| Rules | Active | Applies to | Default priority | Route |
|---|---|---|---|---|
| MR-002, MR-005 | Yes | Any | Critical | Instant alert |
| MR-003 | Yes | Any | High | Instant alert |
| MR-004 | **No** | Event | High | Instant alert |
| MR-006 | Yes | Brand | Standard | Digest |
| MR-007 | Yes | Strategist | Standard | Digest |
| MR-008 | Yes | Event | Standard | Digest |
| MR-009 | Yes | Any | Standard | Digest |
| MR-010 to MR-013 | Yes | Any | Low | Archive only |
| MR-014 | Yes | General | Low | Archive only |

Answers received 2026-10-25: follow the sheet's own names (priorities are Critical, High, Standard, Low); the sheet's Active column decides which rules are live; only MR-004 is inactive; there are only MR-001 to MR-014. The full text is saved as `fixtures/config/rules.csv`.

Earlier open questions (now answered, kept for the record):
1. **Priority vocabulary.** The sheet uses Critical, High, Standard, Low. Ben's reply said Critical, High and Routine. Which list is the real taxonomy?
2. **Which rules are live.** Spec 2.1 lists MR-003, 005, 007 to 016 as live (MR-006 partly, MR-004 not built). The sheet has Yes for MR-002 (not in the spec list) and MR-006 (spec says partly), has no MR-015 or MR-016, and MR-001 is unseen. Proposal: the sheet's Active column is the source of truth and the spec list is updated to match.
3. Column names differ from spec 6.4 (Index for Rule ID, Route for Action, Default priority for Priority). The loader will use the sheet's names.
4. A CSV export of the full tab is still needed for the classifier prompt and routing tests (the screenshot truncates long text).

## M3: Classification and Review Queue  (status: code complete 2026-10-25; DoD needs the API key and golden set)

DoD: golden set eval report committed with the 9.4 targets met or gaps explained; invalid output, low confidence and API failure paths each demonstrated; Approve and Reject sync works.

### Built so far (all pure and tested, 173 tests passing; nothing is wired into the live job yet)
- `core/rules.js`: loads the Monitoring Rules by header name, rejects ids that are not MR-nnn, duplicate ids and a bad Active value, and exposes the active rules.
- `core/taxonomy.js`: categories (General, Event, Brand, Strategist), priorities (Critical, High, Standard, Low), sentiments, channels. The one line definitions are drawn from the two sheets and are **DRAFT until Ben confirms them**.
- `core/validateClassification.js`: spec 9.3 validation against the allowed lists (entity names, active rule ids, taxonomy), with word limits applied to summary and reasoning.
- `core/classifyPrompt.js`: versioned system prompt, tool schema, user payload and request builder. `core/channel.js`: channel from domain (spec 8.3).
- `core/classifyOutcome.js`: the decision table (coverage, review, skip, refetch).
- `core/claudeResponse.js` and `gas/claude.js`: the single place that calls the API, with the 2 s and 8 s retries. Tested against a fake UrlFetchApp.

### Deviations from the spec (proposed spec changes)
1. **No `temperature`.** Spec 9.2 says `temperature: 0`. From API version 2026-10-21 every model returns a 400 for it, and several current models already reject non-default values. Consistency has to come from the validator, the confidence threshold and the golden set instead.
2. **Forced tool choice only for `claude-haiku-4-5`.** Several current models return a 400 for it. Other models use `tool_choice: auto`, a reminder in the prompt, a larger `max_tokens` and `effort: low`. A reply without the tool call goes to the Review Queue as invalid output. Not tested against the real API yet.
3. The request uses `anthropic-version: 2023-06-01`, as in the spec. Moving to 2026-10-21 needs no change to this code, because no sampling parameter is sent.

### Inputs still needed before the M3 DoD can be shown
- An Anthropic API key (Joash, billing owner), set as `ANTHROPIC_API_KEY` in DEV.
- The golden set: 30 to 50 hand labelled past items (entity, category, priority, sentiment, rules) in `fixtures/golden/golden.csv`.
- Ben to confirm the taxonomy definitions, and whether the Coverage tab needs a `Source type` column (Media, Social Media, Non-Media Listings), which the owners treat as a second classification.
- Ariel to review the system prompt wording (spec TODO).
- A decision on which model to run. The spec default is `claude-haiku-4-5` (about 1 USD in and 5 USD out per million tokens). The newer `claude-haiku-5-5` is listed at about 0.10 USD in and 0.50 USD out. The golden set eval can compare both.

### Still to build
Wire classification into the ingest flow (after the entity gate, with the D12 page fetch and the three-failure counter), the Review Queue Approve and Reject sync, the eval script, and live demonstrations of the three failure paths.

### 2026-10-25 later: live findings and owner decisions
- Live test of the entity gate: the ambiguous forward (Shaun Chew) went to the Review Queue correctly. The two strong forwards failed with `Header not found: Coverage ID in Coverage`: the Coverage tab's header row had been removed. Nothing was lost; the messages kept their labels. Fixed by re-running `setup()`. New: `runIngest` now checks that every tab and column exists before doing any work, and fails with "Run setup() to restore it". Covered by a test that clears the header row.
- Ben confirmed: the taxonomy definitions are good, and the Coverage tab needs a **Source type** column (Media, Social Media, Non-Media Listings). Added to the Coverage and Review Queue tabs with a dropdown (existing sheets get the column added at the end by `setup()`), and added as a required field in the classifier output. Reddit, Hacker News and forum posts are Social Media (Ariel, 2026-10-25).
- Ariel approved the prompt wording and chose the cheaper model: DEV `CLAUDE_MODEL` is now `claude-haiku-5-5`. Not tested against the real API yet.
- Golden set: Ariel's sheet has 50 rows and no header. 46 are the same press release on different sites, 1 has no URL, only the category is recorded (no entity, priority, sentiment or rules), and the title column holds the outlet name for most rows. Not usable as it stands. `fixtures/golden/golden_template.csv` has the columns and 7 prefilled rows, and `fixtures/golden/README.md` lists the cases needed.
- Two labels conflict with the confirmed category definitions: the Forbes 13 October founder piece and the 20 August press release are General in Ariel's sheet, but the Brand definition says a direct third party mention of Sedifly and founder profile coverage are Brand. Ben to decide which is right.

### 2026-10-25 evening: golden candidates and a design problem found in the Old tracker
- Live test result: `live-test-2` and `live-test-3` became Coverage rows COV-000016 and COV-000017 after `setup()` restored the headers. The Coverage ID column now sits at the far right because the original column was deleted by hand. Everything addresses columns by header name, so this is harmless. Coverage IDs 10 to 15 were reserved by the failed attempts and are not reused. The Source type cells are blank because the classifier is not wired in yet.
- Old tracker (`Sedifly Media Coverage [Master].xlsx`, read only, never changed): the Drive export returned only the first tab, cut off at about row 4,809 (mid July 2026). Columns: Media Date, Category, Media Name, Topic, Link. Categories already match ours (Event 2,543, Brand 1,223, Strategist 1,043, General 4). Other tabs were not read.
- **Syndication volume.** The 4,809 rows are mostly copies of a few press releases on hundreds of sites. By the tracker's own Topic column, the George Baxter appointment has 1,042 rows, Davos 656, YP40 645, THE FUTURE summit coverage about 300 each. Under spec 8.2 (same title, different URL, within 7 days goes to the Review Queue as `Possible duplicate`), one such release would put hundreds of rows into the Review Queue, far above the 20 percent target (A6). MR-011 says syndicated copies are archive only, Low priority, with alerts suppressed. **Decision needed** from Ben and Ariel (not yet built): (A, recommended) when the title matches, add no row and instead count the copy against the existing row (a new script-owned column such as `Syndicated copies`, with the count and the first few URLs); (B) keep spec 8.2 as written; (C) merge only when the outlets are on a known list.
- Golden set: `fixtures/golden/golden_candidates.csv` has 19 rows (5 real alert items and 14 distinct Old tracker stories, one per Topic, with the Old tracker's category as the expected category). A working copy was created in Ariel's Drive as the Google Sheet "Sedifly Golden Set (working copy)". It is not the golden set yet: titles come from the URLs, there are no snippets, and the expected entity, source type, channel, priority, sentiment, rules and outcome are blank. It needs 30 to 50 rows, and the Old tracker only supplies about 14 distinct stories, so the rest must come from new alerts and from hard cases written by Ben and Ariel.

### 2026-10-25 night: syndicated copies (owner decision A) and more golden candidates
- **Syndicated copies implemented** (replaces the "Possible duplicate" Review Queue behaviour of spec 8.2). When an item has the same headline (at least 5 words, ignoring case and punctuation) as a row detected in the last 7 days but a different URL, no row is added. The existing row's new script-owned column `Syndicated copies` goes up by one, and `Last updated` is refreshed. This also works when the existing row is waiting in the Review Queue. Each copy's URL is listed in the Run Log detail (first 5 per message, with a total), so nothing is dropped silently. The script may change only `Source route`, `Found in`, `Syndicated copies` and `Last updated` on an existing row. Headlines under 5 words are never merged, so generic titles cannot be lumped together. 180 tests pass, including a run of the built bundle where two copies leave two rows and a count of 2.
- Proposed spec change: spec 6.1 gets a `Syndicated copies` column (S, number), spec 6.2 loses the `Possible duplicate` reason, and spec 8.2's second bullet is replaced by the rule above. Existing sheets get the column at the end when `setup()` is run.
- Golden candidates: `fixtures/golden/golden_candidates_social.csv` has 22 third party social posts (LinkedIn, Instagram, X, Facebook, TikTok, YouTube) from the Old tracker Social Media tab. They arrive as team forwards, so the forwarder's comment goes in `snippet`. Tracking codes, including the LinkedIn `rcm=` member code, were removed from the links. Created as the Google Sheet "Sedifly Golden Set (social additions)", separate from the working copy because the Drive connector can create files but not edit them.
- The LinkedIn and Instagram trackers Ariel attached list Sedifly's own posts, not third party coverage, so they were not used.
- Flags for the owners found while sampling: the category of several Old tracker rows looks inconsistent with the confirmed definitions (Davos posts split between Brand and Event, a partner post as General, a strategist's post as Brand). `lnkd.in` and `youtu.be` short links are not in the spec 8.3 social domain list, so their channel is left to the classifier.

### 2026-10-25 late: F5Bot parser (closes the last M1 code item)
- Real alert received (`F5Bot Alerts <alerts@f5bot.com>`, subject "F5Bot found something: green tea"; DKIM, SPF and DMARC pass for f5bot.com). Redacted fixture `f5bot_alert_green_tea.eml` (Reddit usernames, Ariel's address and account tokens removed), plus the tips email kept as a "gives no items" case.
- Format learned: one email, many mentions, grouped under `Keyword:` headings. Each mention has a label ("Reddit Comments (/r/tea/):" or "Reddit Posts (...)"), a thread title, a link wrapped in `f5bot.com/url?u=<real link>`, and an excerpt with the keyword in bold. There is no publication date.
- Parser: one RawItem per mention, real link unwrapped (also added to `unwrapRedirect`, so F5Bot-wrapped links in forwards are handled), outlet is the subreddit (`r/tea`), the keyword is the alert name, and the new RawItem field `itemKind` is `post` or `comment` (null for the other routes). Hacker News and Lobsters labels are handled by guess (no real sample yet). The F5Bot advert and footer links are ignored.
- **Rule added: a Reddit comment is never a syndicated copy.** Two comments on one thread share a headline, so the "same headline, different link" rule would have merged them and could hide the one comment that matters. Comments (by `itemKind`, or by a Reddit comment link) are never merged, and a thread post never merges into a comment's row.
- Channel and Source type are now filled when the link decides them (spec 8.3): Reddit, Hacker News and social links get Channel `Reddit`, `Hacker News` or `Social`, and Source type `Social Media`. Other links wait for the classifier.
- Proposed spec change: add `itemKind` to RawItem.
- Open risk: F5Bot can pause a keyword ("Keyword has hit its daily limit and was paused, back in 24 hours"). While paused, mentions are not emailed and so cannot be seen. A broad keyword will hit this; a keyword for a rare name like Sedifly is unlikely to. Worth surfacing in the Run Log or digest later (M5 or M6).
- Live F5Bot test passed (Ariel, 2026-10-25): the alert moved from Monitoring/Automated to Monitoring/Processed. M1 is closed.
- Tests: 194 passing, including a run of the built bundle with a fake Gmail.


### 2026-10-25 end of day: M3 code complete
- **Classification is wired into ingest.** After the entity gate, each item goes through one shared step (`core/classifyStep.js`, also used by the eval). Valid and confident: Coverage row with Entity, Channel, Source type, Outlet, Title, Published at, Category, Priority, Sentiment, Rules matched, Classifier confidence, and Verification `Verified`. Low confidence: one re-read of the public page (never for social links), then Review Queue `Low confidence` with the model's values filled in. Invalid output: Review Queue `Invalid classifier output`. Not relevant: skipped and listed in the Run Log for alerts, Review Queue for team forwards. API failure: the message stays unlabelled and the run shows PARTIAL or FAILED; the third failed run sends the item to the Review Queue as `Classifier unavailable`. The time budget is checked before each call.
- **While `ANTHROPIC_API_KEY` is a placeholder, ingest writes rows without classification** (as in M2) and logs that. DEV is in this state. Once Joash's key is set, the classifier turns on with no code change.
- **Review sync** (`runReviewSync`): Approve copies the possibly edited row into Coverage with a new ID and `Verified`, then stamps `Synced at`. Reject only stamps `Synced at`. Approved rows missing Entity, Category or Priority wait. A row whose link is already in Coverage is stamped, not copied twice. Run twice, nothing is copied twice.
- **Eval script** (`npm run eval`, needs `ANTHROPIC_API_KEY` in your terminal, never in a file): reads `fixtures/golden/golden.csv`, runs each case through the same gate and classifier step as live, and writes `reports/eval_<date>.md` with per field accuracy, share of logged items with every field right (target 95%), review rate (target 20% or less) and every miss. `--dry-run` answers each case with its own labels to prove the harness. Rows with no `expected_outcome` are skipped as unlabelled.
- Prompt version is now 2 (`page_text`, `item_kind`, one sentence that page text is data). Ariel approved the version 1 wording; the added sentence needs a look.
- Tests: 233 passing, including the built bundle with a fake Anthropic API for the success path and the three failure runs.

### How each M3 DoD item stands
| DoD item | State |
|---|---|
| Golden set eval report committed, targets met or explained | Script and report built and tested with a dry run. Needs the API key and 30 to 50 labelled rows. |
| Invalid output path | Demonstrated by tests (unit and built bundle). Live demonstration needs the key. |
| Low confidence path | Same. Includes the page re-read. |
| API failure path | Demonstrated by the built bundle test: unlabelled twice, Review Queue `Classifier unavailable` on the third run. |
| Approve and Reject sync | Demonstrated by tests on the built bundle. Live check: set Decision on a DEV Review Queue row and wait 5 minutes. |

## M6: Heartbeat and errors  (status: done, reported complete by Ariel at the 2026-11-02 sync)

DoD: disabling the ingest trigger produces an ops email within 1 h (internal) and from the external ping service; a forced exception is logged and emailed once.

### Built
- `heartbeatCheck` (hourly): if no successful run for more than 45 minutes, emails `OPS_RECIPIENTS` once, again every 6 hours, and sends one recovery email. Before the first success the clock starts at the first check. If mail cannot be sent the alert is retried next hour.
- Every successful `runIngest` sends a plain GET to `HEARTBEAT_PING_URL` (no data). A failed ping never fails the run. If `runIngest` throws, `<url>/fail` is pinged.
- `guarded()` wraps every trigger function: an uncaught error writes a `FAILED` Run Log row, emails `OPS_RECIPIENTS` the function name, error and stack at most once per function per hour, and is rethrown so Apps Script still shows the failed execution.
- The ping URL lives only in the git-ignored `dev.properties.json`. The example file has a placeholder.
- Tests: heartbeat decisions (alert, quiet, 6 hour repeat, recovery, never-ran), ping on success, ping failure ignored, no ping with a placeholder, a forced exception logged twice but emailed once, a second function emailing separately, and mail only to `OPS_RECIPIENTS`.

### Live DoD check (needs Ariel)
1. Run `seedDevProperties` again after the next push so `HEARTBEAT_PING_URL` is set.
2. In healthchecks.io set the check's Period to 10 minutes and Grace Time to 60 minutes, and add your email as the notification.
3. Wait for two or three runs; the check should show green.
4. In Apps Script, Triggers, delete the `runIngest` trigger. Within about an hour you should get the internal email "Sedifly media monitoring has stopped", and within about 70 minutes the healthchecks.io email.
5. Run `setup()` to put the trigger back. You should get the recovery email at the next hourly check.
6. Forced error: temporarily rename a header in the Coverage tab and wait for a run. Expect a FAILED Run Log row and one email; restore the header or run `setup()`.

## Consolidated spec changes
See `SPEC_CHANGES.md` (45 items with section, current text, proposal, reason and status).

### 2026-10-25: F5Bot live check passed
The F5Bot alert moved from `Monitoring/Automated` to `Monitoring/Processed` in DEV, so all four sources (Google Alerts, Talkwalker, F5Bot, team forwards) are live-tested. M1 is closed.


## 2026-11-02: sync with Joash and Ben, decisions and re-plan

### Decisions
- **MVP goal:** solve the core problem of missing coverage. M1 to M3 and M6 are reported complete. The project stays in Ariel's personal GitHub repo until handover (M9).
- **M4 (screenshot and PDF archiving) is paused.** Not a priority. No ScreenshotOne key is needed for now. Archive status stays `Pending`, and the digest counts for `Screenshot needed` and `Save by hand` stay at 0.
- **Migration on 4 November, in two parts.** First Ben audits the old sheet with a Claude prompt for coverage it missed, immediately before the import so nothing new is missed. Then the clean data is imported into the new tracker. This is the spec's M7 (backfill), now pulled forward, and it is not built yet.
- **Tracker address.** The team sends links from their own email to one central tracker address. DEV uses `ariel+mediatest@sedifly.com`. Ariel will test sender tracking and whether a central inbox such as `pr@sedifly.com` is needed, then decide.
- **Sender tracking.** The aim is to see who submitted each link. The Coverage tab has no column for this yet (see proposal below).
- **Sheet simplification.** Make the Google Sheet friendlier for non technical users by removing unnecessary columns. Constraint from CLAUDE.md: the script never deletes or reorders columns, so the proposal is to hide columns and add a simple view, not delete them (see below).
- **Golden set of rules** from past data to automate categorisation. Needs the labelled golden rows (still pending) and the Anthropic key.
- **Docs (M9):** a User Guide for marketing (daily use, keyword management) and an Internal Maintenance Guide for developers (code and setup).
- **Alert sources:** Ariel to set up strategic keyword monitoring in F5Bot, Google Alerts and Talkwalker.

### Owners of the action items
- Ariel: fix duplicate or new columns in the master sheet, document the label meanings, strategic keywords, email Joash for the Anthropic key (the screenshot key is no longer needed while M4 is paused), test sender tracking and decide `pr@sedifly.com`.
- Ben: Claude prompt for the past coverage audit, run on 4 November with Ariel.
- Joash: set up the keys on receipt.

### Re-plan
1. Next build is M5 (routing, alerts, digest), still blocked on the question of how the rules sheet maps to alert recipients (asked on 2026-11-02).
2. Sender tracking and sheet simplification need an owner decision before code (see SPEC_CHANGES.md items 33 and 34).
3. The 4 November import needs the Old tracker to Book of Truth column mapping from Ben (`fixtures/config/old_tracker_mapping.csv`, still a `TODO(Ben)` in the spec) and a decision on which of the old tracker rows are imported as `Needs verification`.
4. M9 now has two guides instead of one.


## M5: Routing, alerts, digest  (status: code complete 2026-11-02; live DoD check pending)

DoD: a seeded Critical item emails within 15 minutes of arriving in Gmail; the UNCONFIRMED path works; no duplicate alerts on rerun; the digest is sent on a zero item day.

### Built
- **Routing** (`core/routing.js`): an instant alert is due when a matched active rule has Route `Instant alert` (MR-001, 002, 003, 005; MR-004 is inactive), or Priority is Critical, or the classifier's `critical_signal` is true. An item the classifier says is unrelated never alerts. Owner confirmed on 2026-11-02 that the sheet's `Route` column is the spec's `Action`, and that there are no per rule recipients in v1.
- **Alert email** (`core/alertEmail.js`, `gas/alerts.js`): subject `[Sedifly Media] <Priority>: <Entity> in <Outlet>`, `UNCONFIRMED ` prefix for review items; body has title, URL, outlet, published date, sentiment, summary, matched rules, excerpt, a link to the exact sheet row, the Coverage ID, a "why you are getting this" line, and the negative sentiment line when it applies. Sent only to `ALERT_RECIPIENTS` (`ALERT_RECIPIENTS_BLIND` in BLIND mode). The send time is written to `Instant alert sent`, and a row already stamped is never alerted again.
- **Alerts happen at ingest**, right after the row is written, so they are not tied to the 5 minute review sync. The alert fires even when the item goes to the Review Queue (UNCONFIRMED). Ambiguous people matches are now also classified so a possible Critical item is alerted rather than waiting unseen; they still go to review.
- **If the mail fails** (for example no recipients set), the alert is queued in the Script Property `PENDING_ALERTS`, the run is marked PARTIAL (so the health check notices), and the next ingest retries it first. A row is stamped only after the mail is handed to Gmail.
- **Approval routing**: when Review sync copies an approved row into Coverage, an alert is sent if its rules or priority call for one and it was not alerted before. A row already alerted as UNCONFIRMED carries its send time across, so it is not alerted twice.
- **Daily digest** (`dailyDigest`, 09:00 SGT, to `OPS_RECIPIENTS` plus the alert recipients, each address once): new rows in the last 24 hours by channel, instant alerts sent, Review Queue items waiting (and approved rows stuck for missing fields), Screenshot needed and Save by hand counts, skipped alert results, failed and partial runs, last successful run, and a list of up to 25 new items, highest priority first. Always sent, including on a zero day. A second run within 12 hours is skipped so a retried trigger cannot double send. `digestNow()` (run by hand) sends it immediately.
- Tests: 259 passing, including the built bundle for alerts (send once, rerun sends nothing, UNCONFIRMED, queued then retried, BLIND recipients, approval) and the digest.

### Live DoD check (needs Ariel)
The classifier needs the Anthropic key, so a real Critical item cannot be classified in DEV yet. Until then the same code path is shown by approving a review row:
1. Push is done by me. In the Apps Script editor run `setup()` once (clears stray dropdowns).
2. In the Review Queue tab add a row by hand: any Title and URL (a link not already in the sheet), Entity `Sedifly`, Category `Brand`, Priority `Critical`, Rules matched `MR-001`, Decision `Approve`, and a Gmail message ID of `manual-1`.
3. Within 5 minutes the row appears in Coverage with a new ID and an alert email arrives "[Sedifly Media] Critical: Sedifly in ..." with a working link to the row. `Instant alert sent` is filled in. Wait another 10 minutes: no second email.
4. Run `digestNow` from the editor: you should get the digest at ariel@sedifly.com with at least that row listed.
5. Once the Anthropic key is in: a seeded Critical email (a forward about Sedifly with serious wording) should alert within 15 minutes, and a low confidence one should arrive as UNCONFIRMED.


## 2026-11-02 later: digest only on changes, sender tracking, column help and simple view

- **Digest sends only when something is new or changed** (owner decision, replaces "always sent"): a new Coverage row, a new Review Queue item, an instant alert, a review decision processed, or a failed or partial run in the last 24 hours. Items merely waiting, or skipped alert results alone, do not trigger it. `digestNow()` still sends whenever you run it. The health check (M6) is unaffected, so a silent day is not a broken tool.
- **Sender tracking:** new column `Submitted by` on Coverage and Review Queue (added at the end of existing sheets by `setup()`). For a team forward it holds the sender's address, lower case. If a second person sends the same link, both addresses are kept in one cell and no row is added. Automatic alerts leave it blank. It carries across when a review row is approved. Note: a forward from a personal address is only accepted if it is on `TEAM_SENDER_ALLOWLIST` (an address or `@domain`, comma separated); anything else goes to `Monitoring/Review` with "Sender not on the team allowlist".
- **Column help:** `setup()` puts a hover note on every header of the three tabs saying what the column records (text in `core/schema.js`, one place to edit).
- **Simple view (not applied yet):** `simpleView()` hides the technical columns (Outlet tier, Normalised URL, Archive status, Archive link, Found in, Gmail message ID, Classifier confidence on Coverage, Logged by, Last updated; on Review Queue also Synced at). `fullView()` shows everything again. Nothing is deleted or moved. Run by hand when the owners want it.
- **Old tracker mapping draft:** `fixtures/config/old_tracker_mapping.csv`, marked DRAFT, for Ben to confirm before the 4 November import is built.
- Tests: 266 passing.


## 2026-11-03: Ben's update (golden set, import mapping)

### Golden set
- Ben has labelled the 40 examples in the working copy (4 real alert items, 14 distinct Old tracker stories, 22 third party social posts) and flagged 4 for review. The 4 flagged rows I can see are the ones labelled `review`: o002 (AI story, no entity), s002 (Instagram, no topic), s003 (LinkedIn, topic AI) and s005 (TikTok, "Jeremy", which strategist?).
- Not yet in the repo: the Drive connector shows only part of the sheet, so `fixtures/golden/golden.csv` still needs the full sheet exported as CSV. The accuracy check also needs the Anthropic key.
- **Gap in the set**: from the rows I could read there are no `skip` cases, no Critical or High priority negative items, no different person with the same name (the Unisba video credit was left out), no syndicated copy and no Reddit item. The accuracy target is measured on the logged items, so the set cannot yet show that alerts, skips or review routing work. Suggested: add about 10 rows of those kinds.

### Old tracker import (M7), Ben's requirements
Ben said the mapping looks good overall and asked that the import:
1. accounts for all 3 Old tracker tabs (I have only seen the Media Coverage tab and the Social Media tab; the third tab's name and columns are needed),
2. preserves historical data,
3. is excluded from live alerts,
4. groups syndicated coverage without losing individual placements,
and asked how deduplication and verification will work. The answer drafted for Ben, and the revised mapping (`fixtures/config/old_tracker_mapping.csv`, now draft v2), are in this commit. Two corrections to my first draft: Detected at is now the Media Date (so history never shows as new), and Verification follows spec 16 (Verified when the Old row has a link and a date).
- Proposed schema additions, for Ben to approve before anything is built: a column `Import source` (Old tab and row), and a tab `Syndicated Placements` (one line per placement of a grouped story).

### 2026-11-03: golden batches 2 and 3
- `fixtures/golden/golden_batch2.csv` (14 rows): syndicated copies, General rows, wire and repost items, the Unisba same name case, and two Sedifly own content posts. Real items from the two Old trackers, labels blank for Ben.
- `fixtures/golden/golden_batch3_synthetic.csv` (6 rows): invented test cases, clearly marked SYNTHETIC with example.com links. They cover a damaging allegation, a factual error, a mildly critical mention, generic news, an unclear forward and an unverified rumour. Ben sets the labels.
- Finding: because an alert's own name counts as an ambiguous hint, a generic article returned by the Sedifly alert goes to review ("Ambiguous entity match"), not skip. The tool never skips an alert result that carries an alert name unless the classifier says it is unrelated to a strong match. Ben to say whether review or skip is the label he wants for such items.
- Reddit items are left out of the golden set for now (the F5Bot parser has a real fixture).


## 2026-11-03: Ben's review of the design, and the shared account question

### Built from Ben's comments (all tests pass, 268)
- **Placements under one story ID.** New tab `Syndicated Placements`. When the same headline arrives on another site, no new Coverage row is added, the main row's `Syndicated copies` goes up, and one line is added to the tab with `Story ID` (the main row's Coverage ID), `Story URL`, `Placement URL`, outlet, title, detected time, route, origin (`Live`) and sender. A copy counted against a Review Queue row gets its `Story ID` filled in when that row is approved. `setup()` creates the tab. The import will use the same tab with the Old tab and row as the origin.
- **Confidence is separate from verification.** `Classifier confidence` is its own number and only decides routing (Coverage or Review Queue). `Verification` is no longer set from it: every tool row stays `Needs verification` until a person checks the source. Approving a row in the Review Queue still sets `Verified`; open question for Ben whether that should stay, since approving confirms the labels, not necessarily the source.
- **Old entries are never auto Verified.** Mapping draft v3 says every imported row is `Needs verification`.
- Reddit deferred.
- Existing DEV rows keep their values. Run `setup()` after the push to create the new tab.

### Dedicated account for production (Ben's question) and the existing Sedifly Global Gmail (Joash's question)
Answer: yes to a dedicated account (for example `media@sedifly.com`) with `pr@sedifly.com` as an alias. Using the existing Sedifly Global Gmail depends on one fact: is it a free `@gmail.com` address or a Workspace `@sedifly.com` user? Issues and options are in the reply to Joash (copied in SPEC_CHANGES item 55). No code change is needed for either; the actions are for the account owner and Ariel (deployment).


## 2026-11-03 later: M7 import built (dry run first)

Ben agreed with the proposals and sent the Google Sheets copy of the Old tracker plus the details of the other two tabs. The Old tracker has three tabs: **Media** (Date, Category, Media Name, Topic, Link; about 5,800 rows), **Social Media** (Date, Category, Topic, Link, Publisher, Social Media, Screenshot; about 70 rows) and **Non Media Listings** (Date, Link, Media Name, Catagory; 19 rows). Each tab has year heading rows (2025, 2026) above the dates, and dates carry no reliable year, so the heading year is used.

### Built
- `Import source` column on Coverage and Review Queue (Old tab and row). `fixtures/config/old_tracker_mapping.csv` is now the full agreed mapping for all three tabs.
- `importOldDryRun()`: reads the Old copy (read only) and writes only an `Import Report` tab: rows per tab, year headings, blank rows, stories, placements, duplicate links, a check that every row adds up, tabs found or not imported, rows with problems (no date, no link, category outside the four, unreadable date), the largest stories and every grouped social story. Nothing goes into Coverage.
- `importOld()`: needs the Script Property `IMPORT_CONFIRMED` set to `YES` (a deliberate step after the report is reviewed). Writes one Coverage row per story and one Syndicated Placements line per grouped row. Resumable (run again until it says COMPLETE), never writes a row twice, never sends an alert or an email. Every imported row is `Needs verification`, `Found in = Old`, `Source route = Backfill: Old tracker`, `Logged by = import`.
- Grouping: same headline (5 or more words, taken from the URL text) within 7 days for media rows; same long social topic, or same publisher and topic, within 7 days for social rows. Listings are never grouped. The same link twice is one row with both Old rows in `Import source`.
- Trial on the 4,813 Media rows the connector could read: 415 stories, 4,359 placements, 39 duplicate links, and every row accounted for. The biggest stories are the George Baxter appointment (990 placements), the Minister Alvin Tan summit story (865), Davos (645) and the YP40 event (499).
- Tests: 282 passing, including the built bundle with fake Old tabs (dry run changes nothing, refusal without confirmation, no mail, resume after a partial write, missing tab).

### To run it (Ariel)
1. After the push, run `setup()` (adds the `Import source` column).
2. In Project Settings, Script Properties, set `OLD_TRACKER_FILE_ID` to `1OwPXmQv9vGk22mOtey3TJtd1n-MU2iUa_IybwkAE3KQ` (do not re-run `seedDevProperties` for this).
3. Run `importOldDryRun`, open the `Import Report` tab and review it with Ben.
4. When Ben is happy: set `IMPORT_CONFIRMED` to `YES`, run `importOld`, and repeat until the result says COMPLETE.
5. Run it on DEV first. For production, repeat on the production sheet.


## 2026-11-04 (planning): Ben's sign off, the audit file, and the cut-over

### Ben's replies, applied
- **Review approval confirms labels only.** Approving a row in the Review Queue no longer sets `Verified`; it stays `Needs verification` until a person checks the source. Imports and audit rows are never Verified either. `Verified` is now only ever set by hand.
- `Import source` (tab and row): done. Grouping by matching headline within 7 days: done, and the dry run lists every grouped social story so Ben can confirm each is the same story.
- **Cut-off: 4 November, 10:00 SGT, with a snapshot and a separate intake for new coverage.** After 10:00 nobody adds rows to the Old tracker; new coverage comes in through the tool (forward to the tracker address) or is logged by hand in the Book of Truth with `Found in = Manual`. The snapshot is a fresh Google Sheets copy of the Old tracker taken at 10:00; the copy used for the first dry run was taken on 3 November.

### Historical audit (Ben's Claude audit, 10 candidates)
- New, separate functions `importAuditDryRun` and `importAudit` (own `Audit Report` tab). Source: Drive file whose ID is the Script Property `AUDIT_FILE_ID`. Each row becomes a Coverage row with `Needs verification`, `Found in = Audit`, `Source route = Backfill: audit`, `Import source = Audit 2026-11-03 row N`, no alert time, and a note "Found by the historical audit". Links already in the tracker are skipped and listed in the report; the import needs `IMPORT_CONFIRMED = YES` and never sends an alert.
- The file (10 rows: 6 media, 4 company listings with no date) is saved as `fixtures/audit/` for tests.
- The audit file is currently in the Trash of its Shared Drive, so it needs restoring or copying before the script can rely on it.

### Cut-over checklist (4 November)
1. 10:00 SGT: stop adding rows to the Old tracker.
2. Make a fresh Google Sheets copy of the Old tracker (the snapshot). Set `OLD_TRACKER_FILE_ID` to the copy's ID.
3. Run `importOldDryRun`. Ben reviews the `Import Report` tab and approves.
4. On an empty Book of Truth (no live rows yet): set `IMPORT_CONFIRMED = YES`, run `importOld` until COMPLETE.
5. Run `importAuditDryRun`, check, then `importAudit`.
6. Point the alert sources and team forwards at the tracker address.
Production blocker: the production project and account do not exist yet (Joash's account decision). The same steps work on DEV today.

Tests: 288 passing.

### 2026-11-04: dry run reviewed, audit file is now a Google Sheet
- **Old tracker dry run (DEV, copy of 3 November):** 5,891 data rows from the three tabs become 631 stories, 5,221 placements and 39 duplicate links, and the report says every row adds up. Media: 5,806 rows, 564 stories, 5,203 placements. Social Media: 68 rows, 50 stories, 18 placements (the grouped social stories are listed in the report for Ben to confirm). Non Media Listings: 17 rows, 17 stories. The DEV sheet had 11 test rows and none share a link with the Old tracker.
- **Audit:** Ben replaced the CSV with a Google Sheet (`Sedifly Historical Media Audit Findings`, same 10 rows, not in the Trash). The audit import reads either a CSV or a Google Sheet (first tab). Script Property `AUDIT_FILE_ID` = the sheet's ID. Without a date in the file name the Import source reads `Audit row N`.

### 2026-11-04: changes after Ben's review of the dry run
- **Placement mappings for confirmation:** the dry run now also writes an `Import Placement Map` tab: every placement (5,221 in the last run) with the story it joins, both Old rows, links, dates, the days between them and the rule that grouped them, plus every duplicate link and the row it matches.
- **Social groups 59 and 62.**
  - Group 59 (Giovanni Mas Risso, HBSo Miami Chapter Webinar) joined two different LinkedIn posts seven days apart (28 July and 4 August, different post IDs). That is not one post on two platforms, so the same-publisher rule is now 3 days instead of 7. The two posts are now two stories. All the other social groups (same day, or one day apart) are unchanged.
  - Group 62 (Entrepreneur APAC Capital & Scale Summit 2026) joins a `lnkd.in` short link, a full LinkedIn post link and a Facebook post, all on 4 to 5 September. It is grouped by the long topic, so it stays one story. The `lnkd.in` short link may be the same post as the full LinkedIn link, but that cannot be checked without opening the link, so both are kept as placements and the report flags short links. Ben to confirm.
- **Date mismatches are flagged, not corrected.** A date cell is imported as written. The year heading is used only when the cell has no year. When the cell and its heading disagree (12 rows last time) the row is imported with the cell's date, a note "Date check: ... please check" and a line in the report with the original text.
- **Missing links and dates are retained for review.** A row with no link, a link that is not a web address, no date or an unreadable date is imported, with the original text kept in Notes (`Old link text`, `Old date text`) and listed in full in the report section "Rows kept for review" (not only the first few). Short `lnkd.in` and `youtu.be` links are listed too.
- **Ameer Ibrahim coverage is Brand.** Any story whose topic or link names Ameer Ibrahim gets Category Brand, and Notes says "Old category: General, changed to Brand (owner decision 2026-11-04...)". The rule is a one line list (`CATEGORY_OVERRIDES` in `core/oldImport.js`) so further decisions are easy to add.
- Tests: 293 passing. Run `importOldDryRun` again to refresh both report tabs.

### 2026-11-04: Ben's second review
- **Reconciliation, 24 not 30.** The report is right. My message said 30 by mistake. The rows kept for review are 12 (year) + 8 (listings with no date) + 2 (Link Expired) + 1 (date is just "July") + 1 (no link) = 24. The report now prints this total itself, with the reasons, so the number cannot drift again.
- **The 12 dates are corrected to 2025, with the originals kept.** Rule: a date cell exactly one year later than the heading above it (the cell picked up 2026 when typed after New Year) is set to the heading year, the original cell date is written in Notes ("Original date cell: 2026-10-27. Year corrected to 2025..."), and each row is listed in the report. Any other disagreement is still kept as written and flagged. All rows stay Needs verification.
- **Media Channel defaults to News**, with exceptions by link: podcast pages Podcast, blog pages Blog, video pages Other (social, Reddit, Hacker News still decided by the link). On the 564 Media stories that is 562 News, 1 Other (the Yahoo video) and 1 Blog (the Pine Capital post). The report lists every exception.
- **Social group 62 short link.** Opening a LinkedIn short link from the tool would be fetching LinkedIn, which the project rules forbid, so a person checks it by clicking the link. If it is the same post as the full link, the pair is added to `KNOWN_SAME_POST` in `core/oldImport.js`, and the two rows merge as a duplicate link (both Old rows kept in Import source). Until then nothing is assumed and both stay as placements.
- Tests: 297 passing.

### 2026-11-04: Ben's third review
- **The 29 August summit post is its own story.** The `lnkd.in/p/gd9adJA7` link no longer joins or attracts a group (`OWN_STORY_LINKS` in `core/oldImport.js`, with the reason written into that row's Notes). The other summit posts (the full LinkedIn post and the Facebook post) stay grouped without it, so group 62 becomes one story with one placement and the 29 August post is a separate story. Expected totals on the next dry run: 5,891 data rows become 634 stories, 5,218 placements and 39 duplicate links (Social Media: 53 stories, 15 placements). Everything else is unchanged.
- Tests: 298 passing.

### 2026-11-04 (after the cut-off): final dry run
- Snapshot: Google Sheets copy of the Old tracker created 4 November 14:09 SGT, ID `1onBA4NPm5PYv_4CXVMk9plqxbb8H5bgD4j_ujsZc-TM` (set as `OLD_TRACKER_FILE_ID`). The final dry run (14:11 SGT) matches the previous one exactly: 5,891 data rows, 634 stories, 5,218 placements, 39 duplicate links, 24 rows kept for review, every tab adds up, Media channel News 562 / Other 1 / Blog 1; per tab row counts are unchanged from the 3 November copy (Media 5,808, Social 70, Listings 19), so nothing was added to the Old tracker in between. Audit: 10 rows, all new.
- The report now names the source file it read and when the report was written, so an approval always refers to a known file.
- Before the real import: clear the 11 test rows in Coverage and the 1 in the Review Queue (DEV test data), keep the headers.
