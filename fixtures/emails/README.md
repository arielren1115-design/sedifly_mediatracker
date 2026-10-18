# Email fixtures

Real emails are redacted by script: names and addresses replaced, unsubscribe tokens removed, large images replaced by a 1 pixel PNG.
Each `.eml` has a matching `.expected.json` (the RawItem list the parser must return).

| File | Origin |
|---|---|
| team_forward_link_only, team_forward_link_plus_comment, team_forward_multiple_links, team_forward_screenshot_only | Real, redacted |
| team_forward_of_talkwalker_alert | Real, redacted. A team forward of a Talkwalker alert, not a native Talkwalker email. |
| team_forward_non_team_sender | Real, redacted. A link sent from a personal Gmail. No expected JSON: ingest rejects it before parsing. |
| talkwalker_native, google_alert_joash_lee | Real, redacted native alerts. Routing headers and tracking tokens removed. |
| team_forward_no_url_no_image | **Synthetic.** Copy of link_only with the link removed. |
