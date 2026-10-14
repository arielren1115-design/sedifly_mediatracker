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
