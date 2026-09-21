# Wu strength and 2026 State Senate candidates

## Purpose

This analysis asks whether support for candidates in three 2026 Democratic State Senate primaries was higher or lower in Boston precincts where Mayor Michelle Wu had previously been stronger.

The three races are:

1. First Suffolk: challenger Latoya Gayle versus incumbent Nicholas Collins. The official ballot also included Juwan Skeens.
2. Suffolk and Middlesex: challenger Daniel Lander versus incumbent Will Brownsberger. Brownsberger won the districtwide recount by 35 votes.
3. Norfolk and Suffolk: challenger Persis Yu versus incumbent Michael Rush. Yu won.

Wu endorsed Gayle and Lander, but endorsed incumbent Rush rather than challenger Yu. The website therefore provides two views:

- **Challenger view:** Gayle, Lander, and Yu.
- **Wu-endorsed view:** Gayle, Lander, and Rush.

The second view is a sensitivity check, not a replacement for the requestor's literal challenger comparison.

## Unit of analysis and scope

One row is one current Boston voting precinct in one of the three 2026 Senate races. Only Boston precincts are included because the three historical Wu elections are City of Boston mayoral elections. The page does not compare non-Boston municipalities in the Suffolk and Middlesex or Norfolk and Suffolk districts.

The Senate result is always from September 1, 2026. The three Wu results are alternative historical measures of local Wu strength:

- September 14, 2021 preliminary mayoral election
- November 2, 2021 final mayoral election
- September 9, 2025 preliminary mayoral recount

This is a comparison of places. It is not a measurement of how a precinct changed from 2021 to 2026 and it does not identify individual voters.

## Candidate vote share

The vertical measure is a two-candidate share:

`candidate votes / (candidate votes + main opponent votes)`

For First Suffolk, the calculation is Gayle versus Collins and excludes Skeens and all other votes. The underlying Skeens count remains in the downloadable data. For the other two races, the two named candidates are the only candidates on the official result.

## Wu vote share

For each mayoral election, Wu strength is:

`Michelle Wu votes / valid votes cast for mayor`

Blank ballots are excluded. Votes for every listed mayoral candidate and “all others” are included in the valid-vote denominator.

## Converting 2021 results to current precincts

Boston used 255 precincts in the 2021 elections and uses 275 precincts in the 2025 and 2026 elections. Directly joining the old and current precinct labels would incorrectly treat split or reshaped precincts as unchanged.

The crosswalk uses a standard small-area geographic allocation approach:

1. Download the City of Boston precinct polygons used in 2021.
2. Download the MassGIS 2022 precinct polygons used for the 2025 and 2026 results.
3. Download official 2020 Census block polygons, population, and housing-unit counts for Suffolk County.
4. Assign each Census block to the old precinct and the current precinct that contains the largest share of its area. Census blocks are much smaller than voting precincts.
5. For each old precinct, calculate the share of its 2020 population located in each current precinct.
6. Allocate both the old Wu vote count and the old valid-vote count with that same weight.
7. Sum the allocated counts within each current precinct, then calculate Wu share.

The method allocates counts before calculating percentages. It never averages old precinct percentages.

Population is the allocation weight for 254 of the 255 old precincts. One zero-population precinct uses land area as a documented fallback. The public crosswalk identifies every weight and its basis.

This is still an estimate. It assumes that the distribution of 2021 voters within an old precinct roughly followed the 2020 population distribution. That assumption matters only where old and current precincts do not match one-to-one.

## Descriptive fitted lines

Each scatterplot includes a weighted ordinary least-squares line:

- Horizontal value: Wu vote share in one historical mayoral election.
- Vertical value: selected candidate's 2026 two-candidate share.
- Weight: total 2026 two-candidate votes in the precinct.

Larger precinct vote totals therefore have more influence than smaller totals. The line is descriptive. The site does not report statistical significance and does not claim that Wu support or an endorsement caused the candidate result.

## Why the headline does not compare raw slopes

A raw slope is the change in candidate share associated with a one-point change in Wu share. The three Wu elections had different spreads. If Wu results are tightly compressed in one election, a small horizontal movement can produce a numerically steep slope even when the precinct ordering looks much like another election.

The public summary instead uses a common, plain-language contrast:

1. Identify the 25th percentile of Wu share among the race's Boston precincts: a “typical Wu-weak precinct.”
2. Identify the 75th percentile: a “typical Wu-strong precinct.”
3. Use the fitted line to estimate candidate share at each point.
4. Report the difference in percentage points.

Example wording: “Candidate support was 6.9 points higher in a typical Wu-strong precinct than in a typical Wu-weak precinct.”

The downloadable technical summary also includes the raw slope, weighted R-squared, fitted intercept, percentile values, and sample size. No bootstrap intervals are used.

## Axes

The default chart view zooms to the observed range so precinct differences remain readable. The same vertical scale is used in all nine panels. Within each Wu election column, all three race panels use the same horizontal scale. A clearly labeled toggle provides full 0–100% axes.

The horizontal 50% reference identifies majority candidate support. The vertical dashed line identifies the median Wu precinct for that race panel. A 50% Wu reference would not have the same meaning in a multi-candidate preliminary and a two-candidate final.

## Quality checks

The build stops if any required check fails. The published QA report confirms:

- all 255 old and 275 current Boston precincts appear in the crosswalk;
- every old-precinct allocation sums to one;
- allocated 2021 Wu votes equal the original citywide Wu total;
- allocated 2021 valid votes equal the original citywide valid-vote total;
- every 2026 analysis precinct has all three Wu measures;
- every published share falls between 0% and 100%.

The 2021 preliminary check conserves 36,060 Wu votes and 107,972 valid mayoral votes. The 2021 final check conserves 91,794 Wu votes and 143,514 valid mayoral votes.

## Limits

- **Ecological inference:** A precinct relationship does not show how an individual voted.
- **Causality:** The patterns can reflect demographics, incumbency, campaign activity, issue positions, turnout, and other factors. They do not isolate an endorsement effect.
- **Boston-only scope:** Results outside Boston are omitted because Wu mayoral results do not exist there. Boston shares can differ substantially from districtwide outcomes.
- **Geographic estimation:** Reallocated 2021 counts are modeled where boundaries changed.
- **First Suffolk third candidate:** The headline share intentionally answers the requested two-candidate question, but the downloadable file retains the third-candidate vote count.

## Files for review

- `public/data/wu_precinct_analysis.csv` — one analysis row per current Boston precinct and Senate race.
- `public/data/wu_precinct_summary.csv` — fitted-line and weak-to-strong summary statistics.
- `public/data/wu_2021_to_2022_precinct_crosswalk.csv` — old-to-current allocation weights.
- `public/data/wu_analysis_qa.json` — automated quality checks and conserved totals.
- `public/data/wu_analysis_sources.json` — original source links and uses.

## Refreshing the analysis

From the project root on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/update-wu-analysis.ps1 --refresh
```

Then review `public/data/wu_analysis_qa.json`, run `npm run lint` and `npm run build`, inspect both desktop and mobile layouts, add a change-log note, and deploy.
