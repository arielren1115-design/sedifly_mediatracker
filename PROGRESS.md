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

### Still to do for M1
- F5Bot parser (waiting for the first real F5Bot email).
- Live DEV test in Gmail, then mark M1 done.
