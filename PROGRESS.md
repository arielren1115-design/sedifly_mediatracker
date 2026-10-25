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

## M3: Classification and Review Queue  (status: in progress, started 2026-10-25)

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
- Ben confirmed: the taxonomy definitions are good, and the Coverage tab needs a **Source type** column (Media, Social Media, Non-Media Listings). Added to the Coverage and Review Queue tabs with a dropdown (existing sheets get the column added at the end by `setup()`), and added as a required field in the classifier output. Still to confirm with Ben: where Reddit, Hacker News and forum posts belong.
- Ariel approved the prompt wording and chose the cheaper model: DEV `CLAUDE_MODEL` is now `claude-haiku-5-5`. Not tested against the real API yet.
- Golden set: Ariel's sheet has 50 rows and no header. 46 are the same press release on different sites, 1 has no URL, only the category is recorded (no entity, priority, sentiment or rules), and the title column holds the outlet name for most rows. Not usable as it stands. `fixtures/golden/golden_template.csv` has the columns and 7 prefilled rows, and `fixtures/golden/README.md` lists the cases needed.
- Two labels conflict with the confirmed category definitions: the Forbes 13 October founder piece and the 20 August press release are General in Ariel's sheet, but the Brand definition says a direct third party mention of Sedifly and founder profile coverage are Brand. Ben to decide which is right.
