# Golden set

`golden.csv` is the hand labelled set the classifier is measured against (BUILD_SPEC 9.4). It does not exist yet.
`golden_template.csv` has the columns and 7 prefilled rows from items already seen. Copy it to `golden.csv` and fill it in.

One row per distinct item. Aim for 30 to 50 rows with a spread of cases, not copies of the same article:
- clear brand, strategist, event and general items
- a negative item, and items that should be Critical or High
- a different person with the same name as a monitored person (should not be logged)
- generic education or AI news that should be skipped (MR-014)
- a directory listing, a social post, a Reddit or Hacker News post
- a syndicated copy of an item already in the set (MR-011)

Each row needs the text the tool would have seen (title and snippet), not just the link.
`expected_outcome` is one of: coverage, review, skip.
