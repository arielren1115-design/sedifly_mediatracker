# CLAUDE.md: Sedifly Media Monitoring

Google Apps Script tool that turns media alert emails into rows in the Sedifly **Book of Truth** Google Sheet, classifies them with the Claude API, archives press as PDF to Drive, and alerts Marketing.

**Read `BUILD_SPEC.md` before any work. It is the contract.** If code and spec disagree, the spec wins. If the spec is silent, ambiguous, or has a `TODO(owner)` you need, stop and ask Ariel; do not invent schemas, rules, taxonomy values, email formats or IDs.

## Stack

- Google Apps Script, V8 runtime, standalone project, timezone `Asia/Singapore`
- `clasp` for push/pull; repo is the source of truth (never edit in the online editor)
- Advanced services: Gmail API, Drive API
- External: Anthropic Messages API (`UrlFetchApp`), ScreenshotOne, optional healthchecks.io ping
- Node 20+ for local unit tests (`node:test`, no test framework dependency)
- Build: ES modules in `src/`, bundled with esbuild into `dist/Code.js` (IIFE, global name `App`); `src/entrypoints.js` declares top level functions (`runIngest`, `runReviewSync`, `heartbeatCheck`, `dailyDigest`, `runBackfill`, `setup`, `compareBlindRun`, `mergeBlindRun`) that call into `App`, because Apps Script triggers need top level function names. You may propose a simpler setup in M0, but core logic must stay testable in Node.

## Layout

```
src/
  core/        pure logic, NO Apps Script globals (GmailApp, SpreadsheetApp, UrlFetchApp, etc.)
    parsers/   googleAlerts.js, talkwalker.js, f5bot.js, teamForward.js
    normalizeUrl.js, dedupe.js, entityMatch.js, classifyPrompt.js,
    validateClassification.js, routing.js, naming.js, metrics.js
  gas/         thin adapters: config.js, gmail.js, sheets.js, drive.js,
               capture.js, claude.js, alerts.js, heartbeat.js, runLog.js
  jobs/        ingest.js, reviewSync.js, digest.js, backfill.js, blind.js, setup.js
  entrypoints.js
tests/         *.test.js, mirrors src/core
fixtures/
  emails/      real .eml exports + *.expected.json
  config/      entities.csv, rules.csv, taxonomy.csv, old_tracker_mapping.csv
  golden/      golden.csv (hand labelled items for classifier eval)
  urls/        normalisation cases
scripts/       eval_classifier.js (runs golden set against the API locally)
PROGRESS.md    milestone log
```

## Commands

```
npm test                 # unit tests on src/core against fixtures
npm run build            # esbuild → dist/
npm run push:dev         # build + clasp push to DEV project
npm run eval             # golden set classifier eval (needs ANTHROPIC_API_KEY in env)
```

Never push to the PROD project. Ariel does PROD deploys.

## Hard rules

1. Never write to the Old tracker. Only write to the Book of Truth (or scratch in BLIND mode) and the configured Drive folder.
2. Only touch Gmail messages carrying a `Monitoring/*` label. Label per **message** with the Gmail advanced service, never per thread with `GmailApp`.
3. No scraping of LinkedIn, Instagram, TikTok, Facebook, X or WhatsApp. No unofficial WhatsApp libraries.
4. Never send email to anyone outside the configured recipient properties. Never post or reply anywhere.
5. Address sheet columns by header name, never by index. Never delete or reorder columns. Never overwrite human owned cells (see spec 6.1).
6. Reference Monitoring Rules by `MR-xxx` ID only. Never renumber.
7. No secrets, IDs or addresses in code. Everything comes from Script Properties via `gas/config.js`. Never commit `.clasprc.json`, API keys, or real fixture emails containing personal addresses without redaction.
8. Never drop an item silently: every message ends as a row, a Review Queue row, a `Monitoring/Review` label, or a Run Log entry with a reason.
9. Every job must be idempotent and must respect the script lock and the run time budget.
10. Do not build anything listed as out of v1 (spec 2.2), even if it looks easy.

## How to work

- Work one milestone at a time, in the order of spec section 19. Start each milestone by restating its DoD and listing the inputs you need; if any `TODO(owner)` input is missing, stop and ask.
- For core logic: write the test from a fixture first, then the code.
- Keep each external call (Claude, ScreenshotOne, heartbeat ping) behind one function in `gas/` with a plain input/output object, so it can be swapped or moved to an external worker later.
- Log through `runLog.js`, not `console.log` alone.
- At the end of a milestone, update `PROGRESS.md`: what was built, how each DoD item was demonstrated, open issues, any spec change proposed (do not edit `BUILD_SPEC.md` decisions yourself; propose the change).

## Style

- Plain modern JS (ES2020), JSDoc types on exported functions, small pure functions.
- Dates stored as Sheets datetimes in SGT; ISO strings in logs.
- User facing text (emails, sheet values, handover docs) uses plain English, no em or en dashes, ranges written as "X to Y".
