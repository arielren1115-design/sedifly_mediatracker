# Sedifly Media Monitoring MVP: Build Spec

Status: DRAFT v0.1 (derived from "Sedifly Media Monitoring MVP: Scope and First Technical Pass Findings")
Spec owner: Ariel
Builder: Claude Code
Last updated: 2026-10-14

> **How to read this doc.** This is the implementation contract. The stakeholder doc explains *why*; this doc says *exactly what to build*.
> Anything marked `TODO(owner)` is an input the team must supply before the related milestone starts. Anything marked `DECISION Dn` is listed in section 3 with a default; the default applies unless the decision log says otherwise.
> If the code and this spec disagree, the spec wins. If this spec is silent or ambiguous, stop and ask; do not guess.

---

## 1. Goal

Automatically find new public coverage of Sedifly and its monitored people, log each item once in the **Book of Truth** Google Sheet, classify it against the existing taxonomy and Monitoring Rules, archive press coverage as a readable PDF in the existing Drive folders, and alert Marketing quickly about Critical / Instant Alert items. The tool must never fail silently.

### 1.1 Acceptance criteria (two week blind run, section 17)

All must pass:

| # | Criterion | Target |
|---|---|---|
| A1 | Critical or Instant Alert items found by the manual baseline but missed by the tool | **0** (absolute) |
| A2 | Auto logged items fully correct (entity, category, priority, URL, date all right) | ≥ 95% |
| A3 | News and web items caught (tool / manual baseline) | ≥ 90% |
| A4 | Items detected within their channel SLA (section 1.2) | ≥ 90% |
| A5 | Archival copies readable | ≥ 95% |
| A6 | Share of items sent to the Review Queue (DECISION D6) | ≤ 20% |
| A7 | Seeded test Critical items, at least one per automated channel, alerted within 15 min of detection (DECISION D6) | 100% |

Social recall has **no target**; it is measured and reported only.

### 1.2 Detection SLAs

| Channel | SLA | Measured from |
|---|---|---|
| Team forwards to media@sedifly.com | 15 min | Gmail receipt time |
| Reddit, Hacker News, forums | 2 h | Publication time of post or comment |
| Major news outlets | 24 h | Publication time |
| Small sites, blogs, directories | 72 h | Publication time |
| Critical / Instant Alert items | Alert email within 15 min of detection | Row `Detected at` |
| Social, podcasts | Out of v1 (covered by the team forward SLA) | |

"Detected" = the timestamp the script writes the row (`Detected at`). This is detection time, not publication time (blocker 6).

---

## 2. Scope

### 2.1 In v1

- Ingest from one Gmail inbox (media@sedifly.com), **only** messages carrying the labels `Monitoring/Automated` or `Monitoring/Team Forward`.
- Parse alerts from Google Alerts, Talkwalker Alerts, F5Bot, and team forwards.
- Normalise URLs, dedupe against the Book of Truth.
- Match entities, classify with the Claude API against the taxonomy and active Monitoring Rules.
- Route low confidence items to a Review Queue tab; sync human approvals back.
- Capture press items as PDF via ScreenshotOne, verify entity name in the PDF text, file to Drive, link in the row.
- Social URLs: log with `Archive status = Screenshot needed`, no capture call.
- Instant alert emails per the Rules tab; a daily digest email.
- Heartbeat (run health monitoring) and a Run Log tab.
- One-off historical backfill and reconciliation into the Book of Truth, with a metrics report.
- A BLIND mode for the validation run, and a merge/cutover routine.

Rules live at v1: MR-003, MR-005, MR-007, MR-008, MR-009, MR-010, MR-011, MR-012, MR-013, MR-014, MR-015, MR-016. Partly working: MR-006 (press coverage of events only). Not built: MR-004.

### 2.2 Out of v1

LinkedIn API, Instagram API, TikTok, podcasts (Podscan), AI answer engine checks, automated social screenshots, MR-004, WhatsApp of any kind, reply drafting (DECISION D1), phone/push alerts (DECISION D7).

### 2.3 Guardrails (hard rules, never violate)

1. **Never write to the Old tracker** (`Sedifly Media Coverage.xlsx`). Read only.
2. The script writes **only** to the Book of Truth spreadsheet (or the scratch spreadsheet in BLIND mode) and to the configured Drive root folder.
3. Never read, move or relabel Gmail messages that do not carry a `Monitoring/*` label.
4. **No scraping** of LinkedIn, Instagram, TikTok, Facebook, X, or WhatsApp, and no unofficial WhatsApp libraries (blocker 4). Fetching a public news URL for capture or text is allowed.
5. Never send a reply, post, or message to anyone outside the configured internal recipients.
6. Never overwrite a human-edited cell. The script may fill empty cells and append to `Found in` / `Source route`; human-owned columns (section 6.1) are never touched after creation.
7. Never renumber, reuse or reorder Monitoring Rule IDs; always reference rules by ID, never by row position.
8. Never hardcode secrets, IDs or email addresses; everything comes from Script Properties (section 5).
9. Never drop an item silently. Every message ends in exactly one of: a tracker row, a Review Queue row, `Monitoring/Review` label, or a Run Log entry with a reason.

---

## 3. Open decisions (defaults apply unless changed)

| ID | Question | Default | Owner |
|---|---|---|---|
| D1 | Does v1 draft replies to negative items? (Stakeholder doc section 4 says "drafts"; scope list omits it.) | **No.** Negative items get flagged in the alert email; no draft. | Ben |
| D2 | Capture PDFs for Reddit / HN / forum items? | **No.** Log link only, `Archive status = Not required`. Capture news, blogs, listings only. | Ben |
| D3 | Which account owns the script, the Gmail inbox and the Drive files? (blocker 2, section 3.3) | Script and triggers owned by the Marketing automation account; External Media Coverage lives in a Shared Drive so file ownership is not tied to a person. | Joash |
| D4 | External dead man's switch (healthchecks.io free tier) in addition to the internal heartbeat? | **Yes.** Only a ping is sent; no data. | Joash |
| D5 | Classifier confidence threshold for the Review Queue | **0.70**, configurable, tuned in M3 against the golden set | Ariel |
| D6 | Adopt the "proposed additions" to the acceptance test (seeded Critical items, ≤ 20% review queue) | **Yes** | Ben |
| D7 | Any phone channel for instant alerts in v1? | **Email only** | Ben |
| D8 | Alert items that match no monitored entity | **Skip**, write a Run Log entry, count in the daily digest. Team forwards are never skipped. | Ariel |
| D9 | Add `Manual` as a `Found in` value for rows Marketing logs directly from week 1 | **Yes** | Ben |
| D10 | Ingest trigger interval | **Every 5 minutes** | Ariel |
| D11 | During the blind run, who receives instant alerts? | **Ariel only** (Marketing must not see tool output) | Ben |
| D12 | Fetch article text before classifying when the alert snippet is thin? | **Yes**, only when first pass confidence < threshold; one fetch, public news URLs only | Ariel |

---

## 4. Architecture and flow

Platform: Google Apps Script (V8), bound to nothing (standalone project), deployed with `clasp`. Timezone `Asia/Singapore`.

```
Gmail (labels: Monitoring/Automated, Monitoring/Team Forward)
  │  runIngest, every 5 min
  ▼
1. List labelled messages (Gmail advanced service, per MESSAGE not thread)
2. Parse  → RawItem[]   (one email can yield many items)
      unparseable → label Monitoring/Review, Run Log
3. Normalise URL, look up Book of Truth
      duplicate → append Found in / Source route on existing row, done
4. Entity pre-match (deterministic)
      no match & route = alert → skip, Run Log (D8)
5. Classify (Claude API, forced tool output)
      invalid / low confidence → Review Queue tab
6. Allocate Coverage ID, write row to Coverage tab
7. Archive
      social URL → Archive status = Screenshot needed
      press URL  → ScreenshotOne PDF → name check → Drive → link
                    fail → PNG fallback / Save by hand
      forward with image attachment → file attachment to Drive
8. Route per Rules tab → instant alert email if required
9. Label message Monitoring/Processed, remove source label
10. Record run in Run Log, update LAST_SUCCESS_AT, ping heartbeat URL

runReviewSync (every 5 min): moves Approved review rows into Coverage
heartbeatCheck (hourly): alerts if last success is stale
dailyDigest (09:00 SGT): counts, flags, skipped items, failures
runBackfill (manual, resumable): section 16
```

Design for later extraction of heavy steps (capture, classification) to an external worker (Option B): each external call sits behind one function in its own module with a plain input/output contract.

---

## 5. Environments and configuration

Two complete environments, selected by which Apps Script project `clasp` pushes to.

| Thing | DEV | PROD |
|---|---|---|
| Apps Script project | `TODO(Ariel)` | `TODO(Ariel)` |
| Gmail account | test mailbox `TODO(Ariel)` | media@sedifly.com |
| Book of Truth spreadsheet | copy | real |
| Scratch spreadsheet (BLIND) | copy | real |
| Drive root | test folder | External Media Coverage |

### 5.1 Script Properties (all required unless marked optional)

| Key | Example / meaning |
|---|---|
| `MODE` | `PROD` or `BLIND` |
| `BOT_SPREADSHEET_ID` | Book of Truth file ID |
| `SCRATCH_SPREADSHEET_ID` | Blind run target |
| `PR_TRACKER_SPREADSHEET_ID` | PR Activity Tracker (Monitored Entities, Monitoring Rules tabs), read only |
| `OLD_TRACKER_FILE_ID` | Frozen Old tracker, read only, backfill only |
| `DRIVE_ROOT_FOLDER_ID` | External Media Coverage root |
| `DRIVE_SCRATCH_FOLDER_ID` | Blind run captures |
| `ANTHROPIC_API_KEY` | secret |
| `CLAUDE_MODEL` | `claude-haiku-4-5` (confirm exact ID in the Anthropic console) |
| `SCREENSHOTONE_ACCESS_KEY` | secret |
| `HEARTBEAT_PING_URL` | optional, healthchecks.io URL (D4) |
| `ALERT_RECIPIENTS` | comma separated, PROD instant alerts |
| `ALERT_RECIPIENTS_BLIND` | comma separated, BLIND mode (D11) |
| `OPS_RECIPIENTS` | heartbeat and error emails (Ariel + one Marketing owner) |
| `TEAM_SENDER_ALLOWLIST` | comma separated emails or `@sedifly.com` |
| `CONFIDENCE_THRESHOLD` | `0.70` |
| `BATCH_MAX_MESSAGES` | `10` |
| `RUN_TIME_BUDGET_MS` | `270000` (stop starting new work after 4.5 min) |
| `BACKFILL_CAPTURE_LIMIT` | `1500` (max backfill captures per month, stays inside the Basic tier) |
| `NEXT_COVERAGE_ID` | managed by script, do not edit |
| `LAST_SUCCESS_AT` | managed by script |

`setup()` validates that every required key is present and fails loudly with the list of missing keys.

---

## 6. Data model

**Columns are always addressed by header name, never by position.** `setup()` creates missing tabs and headers; it never deletes or reorders existing columns.

### 6.1 Book of Truth → tab `Coverage`

Owner: S = script writes on create, H = human owned (script never edits after create), S+H = script fills if empty, human may edit.

| Column | Type / allowed values | Owner | Notes |
|---|---|---|---|
| Coverage ID | `COV-000001` | S | Permanent, never reused. Rows added by hand get an ID on the next run. |
| Detected at | datetime SGT | S | For manual rows: the time Marketing logged it |
| Published at | date | S+H | Best effort from alert/page; blank if unknown |
| Entity | value from Monitored Entities `Name` | S+H | |
| Channel | `News` `Blog` `Listing` `Reddit` `Hacker News` `Forum` `Social` `Podcast` `Other` | S+H | From route + domain (section 8.3) |
| Outlet | text | S+H | Publication / subreddit / site name |
| Outlet tier | from tier list | S+H | `TODO(Ben)` blocker 3; blank until list exists |
| Title | text | S+H | |
| URL | original URL | S | Unwrapped from redirects |
| Normalised URL | text | S | Dedupe key (section 8) |
| Excerpt | ≤ 500 chars | S | Snippet containing the mention |
| Category | taxonomy value | S+H | `TODO(Ben)` taxonomy export |
| Priority | taxonomy value | S+H | |
| Sentiment | `Positive` `Neutral` `Negative` `Unclear` | S+H | `TODO(Ben)`: confirm if taxonomy already has this |
| Rules matched | `MR-003, MR-009` | S+H | IDs only |
| Instant alert sent | datetime or blank | S | |
| Archive status | `Filed` `Filed (PNG)` `Save by hand` `Screenshot needed` `Not required` `Pending` | S+H | Marketing changes to `Filed` after manual save |
| Archive link | Drive URL | S+H | |
| Found in | multi: `Old` `Tool` `Archive` `Manual` (comma separated) | S (append only) | D9 |
| Verification | `Verified` `Needs verification` | S+H | Tool rows from Coverage flow are `Verified` only if confidence ≥ threshold or human approved |
| Source route | multi: `Google Alerts` `Talkwalker` `F5Bot` `Team forward` `Manual` `Backfill: <source>` | S (append only) | |
| Gmail message ID | text | S | Idempotency |
| Classifier confidence | 0 to 1 | S | |
| Logged by | `script` or person email | S | |
| Notes | text | H | |
| Last updated | datetime | S | |

### 6.2 Book of Truth → tab `Review Queue`

All columns of `Coverage` that the classifier produced, plus:

| Column | Values |
|---|---|
| Review reason | `Low confidence` `Invalid classifier output` `Classifier unavailable` `Possible duplicate` |
| Decision | blank, `Approve`, `Reject` (data validation dropdown) | 
| Reviewed by | email (human) |
| Synced at | datetime (script) |

`runReviewSync`: for each row with `Decision = Approve` and blank `Synced at`, copy the (possibly human edited) values into `Coverage` with `Verification = Verified`, allocate an ID, run archive and routing, set `Synced at`. `Reject` rows stay in the tab with `Synced at` set (kept for accuracy metrics). Items with any Critical signal are alerted **before** review (section 12).

### 6.3 Book of Truth → tab `Run Log`

`Run ID`, `Function`, `Started at`, `Duration ms`, `Messages seen`, `Items parsed`, `New rows`, `Duplicates`, `To review`, `Skipped (no entity)`, `Capture failures`, `Errors`, `Status (OK / PARTIAL / FAILED)`, `Detail` (JSON, truncated to 5,000 chars). Skipped items are logged here with URL and reason.

### 6.4 Read only inputs (PR Activity Tracker)

Expected columns; `TODO(Ben)`: export both tabs as CSV into `/fixtures/config/` so the parser can be written against the real headers.

**Monitored Entities**: `Name`, `Type` (`Company` `Person` `Partner` ...), `Match terms` (comma separated, e.g. `Sedifly`), `Anchor terms` (required for people, e.g. university, specialism), `Active`, `Notes`.

**Monitoring Rules**: `Rule ID` (MR-xxx), `Active`, `Rule` (plain language condition), `Action` (`Instant Alert` / `Log` / `Digest` / ...), `Priority`, `Recipients` (optional override), `Notes`.

**Taxonomy**: `TODO(Ben)`: where it lives and its values for Category and Priority, each with a one line definition. Define exactly which Priority value(s) mean **Critical**.

---

## 7. Gmail ingestion

### 7.1 Labels and filters

| Label | Set by | Meaning |
|---|---|---|
| `Monitoring/Automated` | Gmail filter on alert senders | To process |
| `Monitoring/Team Forward` | Gmail filter on team sender addresses | To process |
| `Monitoring/Processed` | script | Done |
| `Monitoring/Review` | script | Could not parse; human looks at the email |

Filter definitions `TODO(Ariel)`: list exact sender addresses (e.g. `googlealerts-noreply@google.com`, Talkwalker and F5Bot senders confirmed from real emails).

**Labels are per message.** `GmailApp` labels whole threads, and alerts thread together, so use the **Gmail advanced service** (`Gmail.Users.Messages.list` with `labelIds`, `Gmail.Users.Messages.modify`). Do not use `GmailApp.getUserLabelByName().getThreads()` for processing.

Processing a message is complete only after its items are written; then add `Monitoring/Processed` and remove the source label in one `modify` call. If the run dies before that, the next run reprocesses the message and idempotency (section 15) prevents duplicates.

### 7.2 Parsers

Each parser is a pure function `parse(message) → RawItem[]` where `message = {id, from, subject, date, htmlBody, plainBody, attachments[]}`.

```
RawItem {
  gmailMessageId, route,            // 'Google Alerts' | 'Talkwalker' | 'F5Bot' | 'Team forward'
  url, title, snippet, outlet,
  publishedAt | null, receivedAt,
  forwarderEmail | null, forwarderNote | null,
  attachments: [{name, mimeType, blobRef}]   // team forwards only
}
```

| Parser | Expected behaviour (confirm against fixtures) |
|---|---|
| Google Alerts | Multiple items per email. Links are `https://www.google.com/url?...&url=<target>&...`; unwrap the `url` param. Title and snippet from the item block; outlet from the source line. |
| Talkwalker | Multiple items per email; unwrap redirect links; title, snippet, source. Covers X results: treat x.com/twitter.com URLs as `Social`. |
| F5Bot | One or more matches per email: keyword, post/comment URL, snippet. Distinguish post vs comment; subreddit as outlet. |
| Team forward | Sender must be in `TEAM_SENDER_ALLOWLIST`, otherwise `Monitoring/Review`. Extract every http(s) URL from the body excluding mailto, signature links, unsubscribe and tracking links; one RawItem per URL. Text the forwarder wrote above the forwarded content → `forwarderNote`. Image attachments are kept. No URL **and** no image → `Monitoring/Review`. Image but no URL → one RawItem with `url = null`, `Channel = Social`, attachment filed as the archive copy. |

`TODO(Ariel)`: put ≥ 3 real `.eml` exports per alert sender and ≥ 5 team forwards (link only, screenshot only, link plus comment, multiple links, a forward from a non team address) into `/fixtures/emails/`, each with an expected `*.expected.json`.

---

## 8. Normalisation and dedupe

### 8.1 URL normalisation (pure function, unit tested)

1. Unwrap known redirectors (Google, Talkwalker, common link shorteners only if resolvable without a fetch).
2. Lowercase scheme and host; force `https`; drop `www.` and `m.` prefixes; drop default ports.
3. Remove fragment.
4. Remove tracking params: `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `ref`, `ref_src`, `igshid`, `si`, `s`, `share_id`. Sort remaining params.
5. Remove trailing slash (except root). Collapse `/amp` suffix and `amp.` subdomain.
6. Reddit: canonicalise to `reddit.com/r/<sub>/comments/<id>` (+ `/<commentId>` for comments); drop slug.

### 8.2 Dedupe

- Key = `Normalised URL`. Look up in `Coverage` and `Review Queue`.
- Match found → do not create a row; append the new route to `Source route`, append `Tool` to `Found in` if missing, update `Last updated`.
- Same title (case/punctuation insensitive) from a different URL within 7 days → create the row but send to Review Queue with reason `Possible duplicate` (syndication). Do not auto merge.
- Items with `url = null` (screenshot only forwards) are never deduped automatically.

### 8.3 Channel from domain

`Social` domains: instagram.com, linkedin.com, tiktok.com, facebook.com, x.com, twitter.com, threads.net, youtube.com. `Reddit`: reddit.com. `Hacker News`: news.ycombinator.com. Forum and listing domains: `TODO(Ben)` list known ones; otherwise the classifier proposes `News` / `Blog` / `Listing` / `Forum` / `Other`.

---

## 9. Entity matching and classification

### 9.1 Deterministic pre-match

For each active entity: case-insensitive whole word match of any `Match terms` in title + snippet + forwarderNote.
- `Company` entities: a match term hit is sufficient.
- `Person` entities: name hit **and** at least one `Anchor terms` hit (names like "Joash Lee" are not unique). Per MR-009, strategist coverage counts even without "Sedifly".
- Output: candidate entity list (may be empty). Empty + alert route → skip (D8). Empty + team forward → classify anyway.

### 9.2 Claude API call

`POST https://api.anthropic.com/v1/messages` via `UrlFetchApp`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`. `temperature: 0`, `max_tokens: 800`. Output is forced through a single tool (`tool_choice: {type: "tool", name: "record_classification"}`) so the response is always structured.

Input (in the user message, as JSON): the RawItem fields, candidate entities, the **full** active entity list with types and anchors, active rules (`Rule ID` + `Rule` text), taxonomy values with definitions, and today's date. The system prompt lives in `src/core/classifyPrompt.js` and is version controlled; `TODO(Ariel)` review the prompt wording before M3 sign-off.

Tool input schema:

```json
{
  "is_relevant": "boolean, false if this is not actually about a monitored entity",
  "entity": "string, exactly one Name from the entity list, or null",
  "channel": "News | Blog | Listing | Reddit | Hacker News | Forum | Social | Podcast | Other",
  "outlet": "string",
  "title": "string",
  "published_date": "YYYY-MM-DD or null",
  "category": "one taxonomy Category value",
  "priority": "one taxonomy Priority value",
  "sentiment": "Positive | Neutral | Negative | Unclear",
  "matched_rule_ids": ["MR-xxx", "only active rule IDs"],
  "critical_signal": "boolean, true if any reading of the item could be Critical / Instant Alert",
  "summary": "≤ 30 words",
  "confidence": "number 0 to 1",
  "reasoning": "≤ 50 words"
}
```

### 9.3 Validation and outcomes

| Condition | Outcome |
|---|---|
| Output fails schema, or entity / category / priority / rule ID not in the allowed lists | Review Queue, `Invalid classifier output` |
| `is_relevant = false` and route is alert | Skip, Run Log |
| `is_relevant = false` and route is team forward | Review Queue, `Low confidence` |
| `confidence < threshold` | If D12 and URL is public news: fetch page text (≤ 8,000 chars, tags stripped), reclassify once. Still low → Review Queue |
| Otherwise | Coverage tab |
| API error (429, 5xx, 529, timeout) | Retry twice with backoff (2 s, 8 s). Still failing → leave the Gmail message unprocessed for the next run; after 3 failed runs for the same message (counter in Script Properties), write to Review Queue with `Classifier unavailable` |

### 9.4 Golden set

`TODO(Ben, Ariel)`: 30 to 50 past items hand labelled (entity, category, priority, sentiment, rules) in `/fixtures/golden/golden.csv`. M3 includes an eval script that runs the classifier over the set and reports per field accuracy. Target before blind run: ≥ 95% all fields correct on non-review items, ≤ 20% routed to review.

---

## 10. Archive capture

Applies when `Channel ∈ {News, Blog, Listing}` (D2) and URL is not a social domain.

1. Call ScreenshotOne `GET https://api.screenshotone.com/take` with: `access_key`, `url`, `format=pdf`, `full_page=true`, `block_ads=true`, `block_cookie_banners=true`, `block_banners_by_heuristics=true`, `block_chats=true`, `block_trackers=true`, `cache=false`, `timeout=60`. `TODO(Ariel)`: confirm parameter names against current ScreenshotOne docs in M4.
2. **Name check.** Extract text from the PDF and check that at least one of the entity's match terms appears. Apps Script cannot read PDF text natively; prototype in M4: upload the PDF to Drive as a Google Doc via the Drive advanced service with OCR/convert, read text with `DocumentApp`, then trash the temp doc. If this proves unreliable, propose an alternative before continuing.
3. Pass → file the PDF (section 11), `Archive status = Filed`.
4. PDF render error → retry once, then request `format=png&full_page=true`; file PNG as `Filed (PNG)` (not name checked; counted separately in A5).
5. Name check fails → still file the PDF for reference, `Archive status = Save by hand`.
6. Social or `url = null` → no call. If a team forward carried an image, file it and set `Filed`; else `Screenshot needed`.
7. Capture is wrapped in one function `captureUrl(url) → {blob, format, error}` so the vendor can be swapped (ApiFlash, Urlbox) without touching anything else.

---

## 11. Drive filing

- Root: `DRIVE_ROOT_FOLDER_ID` (or scratch in BLIND).
- Subfolders: `TODO(Ben)` confirm the existing structure in External Media Coverage. Default if none: `<YYYY>/<MM>` by `Detected at`, created on demand.
- File name: `<YYYY-MM-DD>_<Outlet>_<Coverage ID>.<pdf|png>`. Outlet sanitised: ASCII letters, digits, hyphen; spaces → hyphen; max 40 chars.
- Write the file's `webViewLink` into `Archive link`.

---

## 12. Routing and alerts

- Routing is deterministic code. The classifier says **which** rules match; the `Action` column of each matched rule says **what** to do.
- An instant alert is sent when any matched rule has `Action = Instant Alert`, or `Priority` is Critical, or `critical_signal = true`. This holds **even if the item went to the Review Queue**: the alert is marked `UNCONFIRMED` in that case. A1 is absolute, so false positives are acceptable here.
- Recipients: `ALERT_RECIPIENTS` (PROD) or `ALERT_RECIPIENTS_BLIND` (BLIND), plus any rule level `Recipients`.
- Subject: `[Sedifly Media] <PRIORITY>: <Entity> in <Outlet>` (prefix `UNCONFIRMED ` when from review).
- Body: title, URL, outlet, published date, sentiment, summary, matched rule IDs, excerpt, link to the sheet row, Coverage ID. If sentiment is `Negative`, add the line "Negative mention: reply is a human decision."
- Write the send time to `Instant alert sent`. Never send twice for the same Coverage ID.
- **Daily digest** at 09:00 SGT to `OPS_RECIPIENTS` + `ALERT_RECIPIENTS`: new rows by channel, open Review Queue count, `Screenshot needed` and `Save by hand` counts, skipped items, failures, last successful run. Always sent, even on a zero day.

---

## 13. Heartbeat and error handling (blocker 1)

- Every successful `runIngest` sets `LAST_SUCCESS_AT` and, if configured, GETs `HEARTBEAT_PING_URL` (D4; the external service emails if pings stop for > 60 min).
- `heartbeatCheck` (hourly trigger): if `now - LAST_SUCCESS_AT > 45 min`, email `OPS_RECIPIENTS` once per 6 h until recovered, then send a recovery email.
- Any uncaught exception in a trigger function: write a `FAILED` Run Log row and email `OPS_RECIPIENTS` with function name, error and stack (rate limited to one email per function per hour).
- ScreenshotOne quota warnings go to the vendor account email; the digest also reports captures used this month.

---

## 14. Run mechanics

- Triggers created by `setup()` (idempotent; deletes and recreates its own triggers only): `runIngest` every 5 min, `runReviewSync` every 5 min, `heartbeatCheck` hourly, `dailyDigest` daily 09:00 SGT.
- `LockService.getScriptLock().tryLock(0)`: if another run holds the lock, exit and log `SKIPPED (locked)`.
- Process at most `BATCH_MAX_MESSAGES` per run; stop starting new messages once `RUN_TIME_BUDGET_MS` has elapsed. Remaining messages wait for the next run.
- Budget check: Workspace allows 6 h/day of trigger runtime; at 5 min intervals an idle run must stay under ~5 s.

## 15. Idempotency

- Before creating a row, check both `Normalised URL` and (`Gmail message ID` + URL) in Coverage and Review Queue.
- Coverage IDs are allocated under the script lock from `NEXT_COVERAGE_ID`; on `setup()` it is initialised to max existing ID + 1.
- Re-running any function on the same input must produce no new rows, no new files, and no repeat alerts.

---

## 16. Historical backfill (one-off, separate from acceptance)

Entry point `runBackfill(step)`, run by hand from the editor, resumable (checkpoint in Script Properties) because of the 6 min limit. Writes into `Coverage` with the same dedupe, never overwriting human columns. Marketing keeps logging manually throughout (`Found in = Manual`).

| Step | What it does |
|---|---|
| `importOld` | Read the Old tracker, map columns per `/fixtures/config/old_tracker_mapping.csv` (`TODO(Ben)`: Old headers → Book of Truth headers), write rows with `Found in = Old`, `Verification = Needs verification` unless the Old row has a URL and date. |
| `scanArchive` | List files under the Drive archive; match to rows by URL or file name; unmatched files become rows with `Found in = Archive`, `Archive link` set. |
| `searchHN` | Query `https://hn.algolia.com/api/v1/search?query=<term>&tags=(story,comment)` for each company match term; paginate full history. |
| `importManualSearch` | Read tab `Backfill Import` (URL, title, date, source) where Ariel pastes results from date ranged web searches and Reddit search (no scraping, blocker 4). |
| `classify` | Classify backfilled rows that lack Category/Priority. No instant alerts during backfill. |
| `capture` | Capture press rows without an archive copy, max `BACKFILL_CAPTURE_LIMIT` per month (ScreenshotOne Basic tier, 17 USD). Dead links → `Needs verification`. |
| `report` | Write tab `Backfill Report`: Recovery rate (Old items also found by Tool, in v1 channels / all Old items in v1 channels), Verified new finds (Tool only and Verified), Archive gaps (Archive only, missing from Old), plus the lists behind each number. |

---

## 17. Blind validation mode

- `MODE = BLIND` → target spreadsheet `SCRATCH_SPREADSHEET_ID`, Drive `DRIVE_SCRATCH_FOLDER_ID`, alerts to `ALERT_RECIPIENTS_BLIND` only.
- Marketing logs in the Book of Truth as normal and must not see the scratch sheet.
- Marketing seeds ≥ 1 test Critical item per automated channel (D6) and records seed details privately with Ariel.
- `compareBlindRun()` produces tab `Blind Results` in the scratch file: matched pairs, tool only, manual only, per item SLA met/missed, A1 to A7 computed.
- `mergeBlindRun({dryRun})` after sign-off: dedupe scratch rows into the Book of Truth (append `Tool` to `Found in` on matches, create rows for tool only items with `Needs verification`), dry run first showing the diff. Then set `MODE = PROD`.

---

## 18. Testing approach

- Core logic (parsers, normalisation, dedupe, entity match, prompt building, output validation, routing, naming, metrics) is pure JS with no Apps Script globals, unit tested in Node against `/fixtures`.
- Apps Script adapters (Gmail, Sheets, Drive, UrlFetch) are thin; tested by integration runs in DEV.
- Every bug found in DEV gets a fixture and a failing test before the fix.

---

## 19. Milestones and definition of done

Do one milestone at a time. A milestone is done only when every DoD item is demonstrated in DEV and noted in `PROGRESS.md`.

| # | Milestone | Week | Definition of done |
|---|---|---|---|
| M0 | Repo, tooling, `setup()` | 1 | `npm test` passes; `clasp push` to DEV works; `setup()` creates tabs, headers, labels, triggers, validates properties; running it twice changes nothing. |
| M1 | Ingest and parse | 1 to 2 | All fixture emails parse to expected JSON. Blocker 2 test passes in DEV: 3 team forwards + 1 alert per service labelled, processed once, moved to `Monitoring/Processed`; one unrelated email untouched. Unparseable fixture lands in `Monitoring/Review`. |
| M2 | Normalise, dedupe, entity match | 2 | URL normalisation table test (≥ 25 cases) passes. Same article via Google Alerts and Talkwalker = one row with both routes. Person entity without anchor term is not matched. |
| M3 | Classification and Review Queue | 3 | Golden set eval report committed; targets in 9.4 met or gaps explained. Invalid output, low confidence and API failure paths each demonstrated. Approve and Reject sync works. |
| M4 | Capture, name check, Drive | 3 | 10 real press URLs filed with correct names and links; a paywalled URL ends as `Save by hand`; a social URL makes no capture call; PDF text extraction approach confirmed. |
| M5 | Routing, alerts, digest | 4 | Seeded Critical item emails within 15 min of arriving in Gmail; UNCONFIRMED path works; no duplicate alerts on rerun; digest sent on a zero item day. |
| M6 | Heartbeat and errors | 4 | Disabling the ingest trigger produces an ops email within 1 h (internal) and from the external ping service; a forced exception is logged and emailed once. |
| M7 | Backfill | 4 | All steps run to completion with resume; Backfill Report populated; no Old file modified (verify revision history). |
| M8 | Blind mode | 5 to 6 | BLIND writes only to scratch, alerts only to Ariel; `compareBlindRun` computes A1 to A7; `mergeBlindRun` dry run diff reviewed. |
| M9 | Handover | 7 | `HANDOVER.md` for Marketing: what each status and flag means, how to approve review items, how to add an entity or rule, what to do on a heartbeat email, how to rotate API keys. |

Meta and LinkedIn API applications start in week 1 in parallel; they are not part of this build.

---

## 20. Inputs checklist (needed before the milestone shown)

| Input | Owner | Needed by |
|---|---|---|
| media@sedifly.com created; account decision (D3) | Joash | M1 |
| Gmail filters and exact alert sender addresses | Ariel, Ben | M1 |
| Google Alerts, Talkwalker, F5Bot alerts configured on the inbox | Ariel | M1 |
| Fixture `.eml` files (section 7.2) | Ariel | M1 |
| Book of Truth created as native Google Sheet; Old frozen (blocker 7) | Ben | M0 |
| Monitored Entities + Monitoring Rules CSV exports, with anchor terms for every person | Ben | M2 |
| Taxonomy values and definitions; which priority = Critical | Ben | M3 |
| Golden set 30 to 50 labelled items | Ben, Ariel | M3 |
| Anthropic API key (billing owner) | Joash | M3 |
| ScreenshotOne account and key | Joash | M4 |
| Drive folder IDs and existing subfolder convention | Ben | M4 |
| Outlet tier list (blocker 3) | Ben | M5 for MR-005 |
| Alert and ops recipient lists | Ben | M5 |
| healthchecks.io check (D4) | Ariel | M6 |
| Old tracker column mapping | Ben | M7 |
| Scraping policy on record (blocker 4) | Joash | M7 |

---

## 21. Glossary

- **Book of Truth**: the canonical native Google Sheet tracker; the only spreadsheet the script writes to in PROD.
- **Old**: the frozen `Sedifly Media Coverage.xlsx`, read only.
- **Route**: how an item reached us (Google Alerts, Talkwalker, F5Bot, Team forward, Manual, Backfill).
- **Channel**: where the item was published (News, Reddit, Social ...).
- **Detected at**: when the script (or Marketing) logged the item; the basis of all SLAs.
