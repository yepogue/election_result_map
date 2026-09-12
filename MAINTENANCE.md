# Maintenance guide

This site is deliberately file-based. Routine election corrections do not require a database or code edits.

## Files a maintainer may update

- `public/data/results.csv` — the precinct-level values shown on the map and in the table.
- `public/data/election.json` — the final districtwide totals, status, dates, and explanatory note shown at the top.
- `public/data/sources.json` — source titles, URLs, status labels, and notes.
- `public/data/changelog.json` — dated, plain-language notes shown at the bottom of the site.
- `public/data/district-precincts.geojson` — official boundary geometry. Replace only when MassGIS publishes a newer applicable district geography.

## Results CSV data dictionary

| Field | Meaning |
| --- | --- |
| `id` | Stable join key. Format: three-letter municipality code, two-digit ward, two-digit precinct. |
| `municipality` | Boston, Cambridge, Watertown, or Belmont. |
| `ward` | Ward number; `0` where the municipality does not use ward numbers in this source. |
| `precinct` | Precinct number. |
| `registered_voters` | Voters registered for the election precinct. |
| `ballots_cast_total` | All-party ballots cast, used for overall turnout. |
| `ballots_cast_dem` | Democratic ballots cast. |
| `brownsberger_votes` | Votes reported for Will Brownsberger. |
| `lander_votes` | Votes reported for Max Lander. |
| `other_votes` | Write-in or other candidate votes where reported. |
| `blank_votes` | Blank votes in this contest. |
| `result_status` | Short provenance/status label surfaced in the table and tooltip. |

## Release checklist

1. Download the newest official precinct export from the Secretary of the Commonwealth and retain municipal files for turnout fields and cross-checks.
2. Update `results.csv` without changing the precinct IDs.
3. Update `election.json` when the districtwide total, recount status, date, or note changes.
4. Update `sources.json` if a source URL, certification status, or note changed.
5. Add a dated public note to `changelog.json`.
6. Confirm there are exactly 59 result rows and 59 matching map features.
7. Confirm every numeric field is a whole number and no value is negative.
8. Confirm each row satisfies: candidate votes + other votes + blank votes = Democratic ballots cast.
9. Confirm the displayed aggregate totals against the source documents.
10. Run `npm run lint` and `npm run build`.
11. Check the map, downloads, source links, change log, and a narrow mobile viewport before publishing.
12. Check that table sort buttons work in both directions and that the map legend matches the fill thresholds in the code.

## Current published-snapshot checks

- Final districtwide recount: Brownsberger 12,293 / Lander 12,258 (35-vote margin)
- Mapped post-recount precinct snapshot: Brownsberger 12,293 / Lander 12,258
- Belmont: 4,012 / 1,812
- Boston: 3,369 / 5,131
- Cambridge: 1,614 / 1,862
- Watertown: 3,298 / 3,453

The pair on each municipality line is Brownsberger / Lander. The Secretary's post-recount export supplies contest counts for every precinct. Municipal precinct reports supply registered-voter and overall-turnout fields and remain linked for audit comparison.

The Secretary of the Commonwealth's downloadable precinct file is the controlling post-recount snapshot. Its browser-rendered municipality detail may update on a different schedule, so maintainers should validate and archive the downloadable file used for each release.

## Demographic and primary-voter context

- Census ACS and CVAP values are estimates for Census tracts or block groups, not direct measurements for the dashboard's 2022 election precinct polygons.
- Before adding precinct demographics, create a documented population-weighted crosswalk and retain the source estimate's margin of error.
- Published election returns report Democratic ballots cast but do not split those ballots between registered Democrats and unenrolled voters.
- The Secretary of the Commonwealth's registration workbook supplies party enrollment counts by precinct, but those counts describe eligibility, not participation.
- Massachusetts General Laws Chapter 53, Section 37 provides access to marked primary voting lists. If local election offices provide them, aggregate the enrollment split by precinct and do not publish voter names or addresses.

## Common mistakes

- Do not rename IDs or add spaces to them; the map join depends on exact matches.
- Do not paste percentages into numeric fields. Store counts only; the site calculates rates.
- Do not silently replace the geometry with election results. Boundaries and results are separate downloadable files.
- If a recount changes only the district total and no revised precinct canvass is published, keep the mapped precinct snapshot clearly labeled instead of inventing a precinct allocation.
