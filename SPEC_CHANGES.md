# Proposed spec changes

Every place where the code differs from `BUILD_SPEC.md`, or where the spec was silent and a choice was made. `BUILD_SPEC.md` has not been edited. Status key: **Decided** means an owner chose it and the code already follows it, so the spec text only needs updating. **Needs decision** means the code follows the proposal for now and the owners should confirm or reverse it. **Technical** means an engineering fix the owners need only note.

Last updated: 2026-11-02, after the sync with Joash and Ben.

## A. Data model (sections 6 and 7)

| # | Section | Spec says | Proposed change | Why | Status |
|---|---|---|---|---|---|
| 1 | 6.2 | Review Queue holds "all columns of Coverage that the classifier produced" plus four | Review Queue has every Coverage column plus Review reason, Decision, Reviewed by, Synced at | A human can edit any field before approving, and approval copies the row across unchanged | Needs decision |
| 2 | 6.1 | No Source type column | Add `Source type` (Media, Social Media, Non-Media Listings) to Coverage and Review Queue, with a dropdown. Reddit, Hacker News and forum posts are Social Media | The owners track it as a second classification | Decided (Ben, Ariel, 2026-10-25) |
| 3 | 6.1 | No count of copies | Add `Syndicated copies` (script owned, number) to Coverage and Review Queue | Owner decision A: copies are counted against the first row | Decided (Ariel, 2026-10-25) |
| 4 | 6.2 | Review reasons include `Possible duplicate` | Drop `Possible duplicate`. Add `Ambiguous entity match`. Keep `Low confidence`, `Invalid classifier output`, `Classifier unavailable` | Copies are counted, not reviewed. Ambiguous people matches need a human | Decided |
| 5 | 6.1 | Not stated which cells the script may change on an existing row | The script may change only `Source route`, `Found in`, `Syndicated copies`, `Last updated` on an existing row, and `Synced at` on a Review Queue row | Keeps human owned cells safe (CLAUDE.md rule 5) | Technical |
| 6 | 7.2 | `RawItem` fields as listed | Add `channelHint` (Social for screenshot only forwards), `alertName` (Google subject, Talkwalker alert name, F5Bot keyword) and `itemKind` (`post` or `comment`, F5Bot only) | Needed for channel, the entity hint and comment handling | Needs decision |
| 7 | 7.2 | Forwarded alerts are parsed like alerts | A forwarded alert yields one item per article link with no title or snippet. Alert vendor links are ignored, and a bare homepage is dropped when a deeper link on the same site is present | The forward carries only links | Decided (Ariel, 2026-10-18) |
| 8 | 7.2 | Hacker News and Lobsters labels in F5Bot | Handled by guess; no real sample yet | Only a Reddit alert has been received | Technical, re-check when one arrives |

## B. Rules, entities and taxonomy (sections 2.1, 6, 9.1)

| # | Section | Spec says | Proposed change | Why | Status |
|---|---|---|---|---|---|
| 9 | 2.1 | Lists which rules are live (MR-003, 005, 007 to 016, MR-006 partly) | The sheet's `Active` column is the source of truth. Live rules today are MR-001 to MR-014 except MR-004. MR-015 and MR-016 do not exist | The spec list is out of date against the master sheet | Decided (Ben) |
| 10 | 6.4 and 9.1 | Rules and entities use column names such as Match terms and Anchor terms | Entities use `Primary search term` and `Aliases / variants`. Rules use Index, Active, Applies to category, Default priority, Route, Trigger, Examples, Required system action, Human action, Target timing, Notes / guardrails | Those are the real sheet headings | Decided |
| 11 | 9.1 | Entity match is a single pre-match | Match is **strong** or **ambiguous**. Brands, partners and events: any hit is strong. People: an alias hit, a primary term with an anchor word, or a bare name with Sedifly elsewhere in the text is strong; a bare name alone is ambiguous. The alert's own name counts as an ambiguous hint. Ambiguous goes to the Review Queue. No match from an alert is skipped and listed in the Run Log. No match from a team forward is still logged | Owner answers on people with common names | Decided (Ben) |
| 12 | 6.1 and 9.2 | Category and priority lists | Categories General, Event, Brand, Strategist. Priorities Critical, High, Standard, Low. Sentiments Positive, Neutral, Negative, Unclear. One line definitions as confirmed by Ben | Taxonomy is now settled | Decided |

## C. Dedupe and normalising (section 8)

| # | Section | Spec says | Proposed change | Why | Status |
|---|---|---|---|---|---|
| 13 | 8.2 | Same title, different URL within 7 days goes to the Review Queue | Same headline (at least 5 words, ignoring case and punctuation), different URL, row detected in the last 7 days: add no row, add 1 to `Syndicated copies`, refresh `Last updated`, list the copy's URL in the Run Log. Reddit comments are never merged | The Old tracker shows one press release on hundreds of sites | Decided (Ariel, option A) |
| 14 | 8.1 | URL normalisation applied to any URL | Always normalise the original URL, never a stored one. A Reddit comment link looks like a post link with a slug, so normalising twice is not safe | Found in testing | Technical |
| 15 | 8.3 | Channel from domain | Channel and Source type are filled at write time when the link decides them. Short links (`lnkd.in`, `youtu.be`) are not in the spec domain list, so the classifier decides those | Gap in the list | Needs decision: add the short domains? |

## D. Classifier (section 9.2 and 9.3)

| # | Section | Spec says | Proposed change | Why | Status |
|---|---|---|---|---|---|
| 16 | 9.2 | `temperature: 0` | Send no `temperature`. Consistency comes from the validator, the threshold and the golden set | Newer API versions and models reject it with a 400 | Technical |
| 17 | 9.2 | Forced tool choice | Force the tool only for `claude-haiku-4-5`. Other models use `tool_choice: auto`, a reminder in the prompt, `max_tokens` 4096 and `effort: low`. A reply with no tool call goes to review as invalid output | Several current models reject forced tool choice | Technical, untested against the live API |
| 18 | 9.2 | Default model `claude-haiku-4-5` | DEV runs `claude-haiku-5-5` (about 0.10 USD in and 0.50 USD out per million tokens). The golden set eval decides the production model | Cheaper, owner choice | Needs decision after the eval |
| 19 | 9.2 | Prompt as written | Prompt version 2 adds `page_text` and `item_kind` to the item and one sentence saying page text is data, not instructions. Everything else is the wording Ariel approved | Needed for the page re-read (D12) | Needs decision: Ariel to approve the added sentence |
| 20 | 9.3 | Retry on failure | Three failed runs per message: the message stays unlabelled and the run is PARTIAL or FAILED. On the third failure the item goes to the Review Queue as `Classifier unavailable`. The count is kept in the Script Property `CLASSIFIER_FAILS` and pruned after 3 days | Makes the three run rule testable | Technical |
| 21 | 9.3 | Low confidence re-read | One re-read of a public, non social page (first 8000 characters of text) before sending to review. Social links are never fetched | D12, CLAUDE.md rule 3 | Technical |
| 22 | 6.1 | Verification is Verified only if confidence is at least the threshold | **Changed 2026-11-03 (Ben):** confidence no longer sets Verification. Confidence only decides routing (Coverage or Review Queue) and is kept in its own column. Verification stays `Needs verification` until a person checks the source. Approving a row in the Review Queue still sets `Verified` (open question for Ben: approving confirms the labels, not necessarily the source) | Keeps AI confidence separate from source verification | Decided (Ben) |
| 23 | 5.1 | All keys in 5.1 required by `setup()` | The value `PLACEHOLDER` is allowed in DEV until the milestone that needs it. While `ANTHROPIC_API_KEY` is a placeholder, ingest writes rows without classification and says so in the log | Lets DEV run before Joash supplies keys | Needs decision |

## E. Review sync (section 6.2)

| # | Section | Spec says | Proposed change | Why | Status |
|---|---|---|---|---|---|
| 24 | 6.2 | Approve copies the row into Coverage | An approved row must have Entity, Category and Priority filled, otherwise it waits (no Synced at) and is shown in the run result. An approved row whose link is already in Coverage is stamped, not copied twice | Avoids half empty Coverage rows and duplicates | Needs decision |
| 25 | 6.2 | Reject keeps the row with Synced at | Same. A Run Log row is written only on runs that synced something | Otherwise 288 extra rows a day | Technical |
| 26 | 6.2 | Archive and routing run on approval | Not yet built; arrives with M4 and M5 | Milestone order | Technical |

## F. Operations (sections 13 and 14)

| # | Section | Spec says | Proposed change | Why | Status |
|---|---|---|---|---|---|
| 27 | 13 | Ping `HEARTBEAT_PING_URL` after a successful run | Also ping `<url>/fail` when `runIngest` throws, so the external service alerts at once instead of after its grace period | healthchecks.io supports an explicit failure signal | Needs decision |
| 28 | 13 | Internal alert after 45 minutes without success | Same. Before the first ever success the clock starts at the first hourly check. A mail that fails to send is retried next hour. State is kept in the Script Property `HEARTBEAT_STATE` | Covers a trigger that never ran | Technical |
| 29 | 13 | Error email per function per hour | Same, kept in `ERROR_EMAIL_AT`. Every failure still writes a FAILED Run Log row. Ops mail only goes to `OPS_RECIPIENTS` | Matches the spec | Technical |
| 30 | 6.3 and 15 | Run Log row per run | Replaced by item 45 (idle runs logged hourly) | | Superseded |
| 31 | 14 | `setup()` creates tabs, labels, triggers | `setup()` also removes an empty `Sheet1`, sets the sheet time zone to Asia/Singapore, applies date formats, adds dropdowns and recreates its own four triggers | Needed for a clean sheet | Technical |
| 32 | 5.1 | Script Properties as listed | Script managed keys added: `NEXT_COVERAGE_ID`, `LAST_SUCCESS_AT`, `CLASSIFIER_FAILS`, `HEARTBEAT_STATE`, `ERROR_EMAIL_AT` | State that survives between runs | Technical |

## G. Added after the 2026-11-02 sync

| # | Section | Spec says | Proposed change | Why | Status |
|---|---|---|---|---|---|
| 33 | 6.1 and 7.2 | `Logged by` is `script` or a person; the sender of a forward is not stored | Add a `Submitted by` column (the From address of a team forward, blank for alerts) to Coverage and Review Queue | The team will send links from personal addresses and wants to see who submitted each | Needs decision |
| 34 | 6.1 | All columns are kept | Simplify the sheet by hiding the columns marketing does not need and adding a simple view, rather than deleting them. Which columns to hide is for Ben and Ariel to choose | CLAUDE.md rule 5 forbids deleting or reordering columns | Needs decision |
| 35 | 19 | Milestones in order M0 to M9 | M4 (capture, name check, Drive) is paused. M7 (backfill, the 4 November import) is pulled ahead of M4, M5 stays next | Owner decision at the 2026-11-02 sync | Decided (Joash, Ben) |
| 36 | 19 | M9 produces one `HANDOVER.md` | Two guides: a User Guide for marketing and an Internal Maintenance Guide for developers | Owner decision | Decided |
| 37 | 7.1 and 20 | Central mailbox is media@sedifly.com | The central address is still open: DEV uses `ariel+mediatest@sedifly.com`, and `pr@sedifly.com` is under consideration after Ariel's sender tracking test | Owner decision pending | Needs decision (Ariel) |

## H. Added with M5 (2026-11-02)

| # | Section | Spec says | Proposed change | Why | Status |
|---|---|---|---|---|---|
| 38 | 12 | An alert is due when a matched rule has `Action = Instant Alert`, and rules can carry `Recipients` | Use the rules sheet's `Route = Instant alert` as the trigger. No per rule recipients in v1; everything goes to `ALERT_RECIPIENTS` | The sheet has no Action or Recipients column | Decided (Ariel, 2026-11-02) |
| 39 | 9.1 and 12 | Ambiguous matches go to review | Ambiguous matches are also classified, only so a possible Critical item can send an UNCONFIRMED alert. They still go to review | A1 is absolute | Needs decision |
| 40 | 12 | Alert and stamp `Instant alert sent` | The mail is sent after the row is written. A failed send is queued (`PENDING_ALERTS`), retried at the next ingest, and makes that run PARTIAL | A crash or mail outage must not lose an alert | Technical |
| 41 | 6.2 and 12 | Approval runs archive and routing | Approval runs routing now (alert if due and not already alerted); archive waits for M4 | M4 paused | Technical |
| 42 | 12 | Digest contents listed | Digest also lists up to 25 new items, highest priority first, and the count of instant alerts sent. Rules MR-006 to MR-009 say "include in digest" | Gives the digest items to show | Needs decision |
| 43 | 12 and 14 | Daily trigger sends the digest | A second send within 12 hours is skipped. A new hand run function `digestNow()` sends immediately | Safe retries and easy testing | Technical |
| 44 | 5.1 | Script Properties as listed | More script managed keys: `PENDING_ALERTS`, `LAST_DIGEST_AT`, `LAST_IDLE_LOG_AT` | State that survives between runs | Technical |
| 45 | 6.3 | Run Log row per run | Idle ingest runs are logged once an hour, runs that find mail every time (replaces item 30) | The log had 4,222 rows in two weeks | Decided (Ariel, 2026-11-02) |

| 46 | 12 | The digest is always sent, even on a zero day | Send only when something is new or changed in the last 24 hours (new row, new review item, alert, review decision, failed or partial run). `digestNow()` sends regardless. Replaces the "zero item day" part of the M5 definition of done | Owner decision 2026-11-02 | Decided (Ariel) |
| 47 | 6.1 and 7.2 | `Logged by` is `script` or a person | Add `Submitted by` (sender address of a team forward, several when more than one person sent the link, blank for alerts). It is on the script's list of cells it may change on an existing row | Item 33, now agreed | Decided (Ariel) |
| 48 | 6.1 | No in-sheet help | `setup()` writes a hover note on every header. `simpleView()` and `fullView()` hide and show technical columns by hand | Item 34, now agreed in part | Decided (Ariel) |
| 49 | 16 | `old_tracker_mapping.csv` is a TODO(Ben) | A draft mapping is in the repo for Ben to confirm | Needed for the 4 November import | Needs decision (Ben) |

| 50 | 6.1 and 16 | Old rows are imported with `Found in = Old` | Add a column `Import source` (Old tab and row number) so every imported row traces back to the frozen Old file | Ben asked to preserve historical data | Needs decision (Ben) |
| 51 | 6.1, 8.2 and 16 | Syndicated copies are counted on the first row; only the first few copy URLs reach the Run Log | New tab `Syndicated Placements`: one line per extra placement under the story's Coverage ID (Story ID), with outlet, link, date, route and origin. Used by live ingest now and by the import later. Counts stay on the main row. A placement counted against a Review Queue row gets its Story ID when that row is approved | Ben: retain individual placements under one story ID | Decided (Ben). Built 2026-11-03 |
| 52 | 16 | Imported rows are `Needs verification` unless they have a link and a date | **Changed 2026-11-03 (Ben):** old entries are never automatically Verified, whatever they contain. Detected at is the Media Date at 12:00 SGT, not the import time | Keeps history out of the digest and out of "new" counts | Decided (Ben) |
| 53 | 12 and 16 | Not stated | Imports never send alerts. A live alert for a link already in the sheet merges as a duplicate and does not alert | Ben's requirement | Needs decision (Ben) |
| 54 | 16 | Old tracker has one tab | The import covers all 3 tabs of the Old tracker. The mapping for the third tab is not yet known | Ben's requirement | Open (needs the third tab's name and columns) |

| 55 | 5.1 and D3 | Script, Gmail inbox and Drive owned by a Marketing automation account | The existing Sedifly Global account is a Workspace @sedifly.com user, so quotas, aliases and sharing are fine. It is usable for the MVP if: (1) it is not the recovery address for admin, registrar or finance logins, (2) at least two people can pass its two step verification, (3) the plan allows Shared Drives or the sheet is owned by the account. Its mailbox holds login and password reset mail for other services, which the tool's Gmail permission could technically read. Longer term a dedicated user (for example `media@`) with `pr@` as an alias is cleaner. Moving later is cheap: a new PROD project, `setup()`, and re-pointing the alert sources | Joash's question | Needs decision (Joash) |

## I. Risks to record, no spec change needed

- The `From` header can be spoofed. Check SPF and DMARC results before Marketing relies on the team forward allowlist.
- F5Bot pauses a keyword that fires too often ("daily limit, paused for 24 hours"). Paused keywords send no mail, so mentions are not seen. Surface this in the digest in M5.
- Alert emails carry short snippets. The entity gate can skip a valid result whose snippet lacks the name; the alert name hint reduces this but does not remove it.
- Several Old tracker categories do not match the confirmed definitions (Davos posts split between Brand and Event, a partner post as General, a strategist post as Brand). Ben to resolve before they become golden labels.
