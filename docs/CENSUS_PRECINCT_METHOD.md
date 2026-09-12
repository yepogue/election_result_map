# Census-to-precinct dataset methodology

## Purpose

This dataset connects Census geography to the 59 precincts in the Suffolk and
Middlesex Senate district. It supports neutral exploratory analysis: where the
district's residents live, how precincts differ, and where turnout or election
results differ from local demographic context.

It does **not** estimate how any demographic group voted. It also does not show
party enrollment or whether a particular registered voter participated. Those
require election-administration data, not Census data.

## Why a crosswalk is necessary

Election precincts and Census reporting areas do not have the same boundaries.
The 2020 Census publishes population at the block level, while the American
Community Survey (ACS) publishes its smallest-area estimates at the block-group
level. A precinct can contain parts of several block groups, and a block group
can cross precinct lines.

The crosswalk therefore uses 2020 Census blocks as the common building blocks:

1. Assign each Census block to a 2022 MassGIS precinct.
2. Sum direct block counts to precincts.
3. Use the population or housing-unit distribution of the assigned blocks to
   allocate block-group ACS estimates to precincts.

This is the same broad block-to-precinct workflow implemented by the open-source
[`maup`](https://maup.readthedocs.io/en/stable/user/getting_started/) library
maintained by the MGGG Redistricting Lab. `maup` assigns a non-nesting source
polygon to the target with the largest overlapping area. Its documentation also
warns that raw land-area proration is a poor default for population data. This
build therefore uses area only to choose a boundary assignment or as a last
fallback for an empty block group; it uses population and housing units for the
actual ACS allocation weights.

### Existing approaches considered

- **Census block assignment files:** The Census Bureau publishes official
  [block assignment files](https://www.census.gov/programs-surveys/geography/technical-documentation/records-layout/block-assignment-record-layout.html),
  including a block-to-voting-district relationship. That relationship is tied
  to the 2020 Census VTD vintage, not the dashboard's 2022 Massachusetts
  precinct boundaries, so it is not used as the final match.
- **Maximum-overlap block assignment:** This is the transparent `maup` method
  selected here. Census blocks are small enough that it preserves real local
  population patterns much better than simple precinct-area proration.
- **Areal interpolation:** Allocating a block group's people uniformly by land
  area is easy but treats parks, campuses, water, and dense housing alike. It is
  used only as a last fallback when a block group has neither population nor
  housing units.
- **Dasymetric interpolation:** Research such as
  [When Boundaries Collide](https://doi.org/10.1093/poq/nfx001) finds that
  land-cover-informed weighting can improve estimates in severe boundary
  mismatches. It is a reasonable future sensitivity check, but adds external
  land-use inputs and modeling choices that make routine maintenance harder.

## Sources and vintages

| Input | Vintage | Role |
|---|---:|---|
| [Census TIGERweb Census Blocks](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/10) | 2020 | Block polygons, population, housing units, land area |
| [Census TIGERweb Block Groups](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/8) | 2020 | Whole-block-group denominators |
| [MassGIS Wards and Precincts](https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/WardsPrecincts2022/FeatureServer/0) | 2022 | Precinct polygons and published 2020 population check |
| [American Community Survey 5-year](https://www.census.gov/data/developers/data-sets/acs-5year/2024.html) | 2020-2024 | Demographic, social, economic, and housing estimates |

The ACS source values are Census Bureau estimates. The build retrieves them
through the [Census Reporter API](https://github.com/censusreporter/census-api/blob/master/API.md)
because it offers a documented programmatic interface to the same ACS tables.
The exact release metadata and retrieval endpoints are saved in
`census_data_dictionary.json`.

The Census Bureau identifies block groups as the smallest geography for ACS
estimates in its [ACS information guide](https://www.census.gov/programs-surveys/acs/about/information-guide.html).
That is why income, education, tenure, and similar columns below are
modeled precinct estimates rather than exact precinct observations.

## Block assignment

The build downloads every 2022 MassGIS precinct in the four district
municipalities and their five immediate neighbors (Somerville, Newton,
Brookline, Arlington, and Waltham) before assigning blocks. This
neighboring-precinct context is important. If only the district's 59 precincts
were used, a Census block just outside the district could be assigned inward
merely because its true neighboring precinct was missing from the comparison.

Both block and precinct polygons are projected to Massachusetts Mainland CRS
EPSG:26986 before area calculations.

- A block contained by one precinct is marked `covered`.
- A block that crosses a precinct boundary is assigned to the precinct with the
  largest area of overlap and marked `largest_overlap`.
- A block with less than 95% of its polygon area inside the selected precinct is
  marked `boundary_review_flag=TRUE` for inspection.
- Only blocks ultimately assigned to one of the district's 59 precincts enter
  the published crosswalk.

The block file preserves overlap areas, overlap percentages, Census internal
points, and the assignment label, so every decision can be audited.

## Direct counts versus modeled estimates

### Direct 2020 block aggregations

The following precinct columns are sums of whole-block Census 2020 counts:

- `population_2020`
- `housing_units_2020`
- `census_block_count`

They are not ACS estimates. However, where a 2020 block crosses a 2022 precinct
line, the entire block is assigned to its largest-overlap precinct. The dataset
compares each precinct total with MassGIS's published `POP_2020` field and saves
the difference in `population_difference_vs_massgis`.

### Modeled 2020-2024 ACS estimates

For each block group `g` and precinct `p`:

```text
person_weight(g,p) = population in blocks assigned to p / block-group population
household_weight(g,p) = housing units in blocks assigned to p / block-group housing units
```

Person-based ACS counts (age, race/ethnicity, and education) use
`person_weight`. Household-based ACS counts (tenure and household income
ranges) use `household_weight`.

If the primary denominator is zero, the build falls back in this order:

- Person measures: housing units, then land area.
- Household measures: population, then land area.

The basis used for every block-group/precinct contribution is explicit in the
crosswalk. A precinct estimate is the sum of each contributing block-group
estimate multiplied by its weight.

ACS margins of error for allocated counts are scaled by the same weight and
combined with a root-sum-of-squares calculation. This represents reported ACS
sampling uncertainty. It does **not** include extra uncertainty introduced by
the geographic allocation model. Percentage columns are ratios of allocated
estimates and do not claim a separate modeled margin of error.

## ACS tables used

| Table | Measures derived |
|---|---|
| B01001 | Total population; age 18+; age 18-34; age 65+ |
| B03002 | Hispanic; non-Hispanic White, Black, Asian, and other/multiracial |
| B15003 | Population 25+; bachelor's degree or higher |
| B25003 | Occupied households; renter households |
| B19001 | Households; household income below $50,000 |

All derived variables are additive counts before allocation. Median household
income is intentionally omitted because a weighted average of medians is not a
valid precinct median.

## Files

- `public/data/census_block_to_precinct.csv`: one row per assigned Census block.
- `public/data/census_block_group_precinct_crosswalk.csv`: one row per
  block-group/precinct contribution, including the weights.
- `public/data/precinct_demographics.csv`: one row per dashboard precinct.
- `public/data/census_crosswalk_qa.json`: generation counts and validation tests.
- `public/data/census_data_dictionary.json`: source provenance and field notes.

## Quality rules

A build should not be published unless all of these are true:

1. All 59 election precincts are present.
2. Every contributing block group has an ACS record.
3. The sum of weights for the district portion of a block group does not exceed
   1, allowing only a small floating-point tolerance.
4. Direct block population totals are compared with MassGIS precinct population
   totals, and unexplained differences are reviewed.
5. All blocks with `boundary_review_flag=TRUE` are reviewed before using the
   associated precinct estimates for fine-grained claims.

The current version passes all automated checks. It contains 1,819 district
blocks and 158 contributing block groups. All 59 block-summed precinct
populations match MassGIS exactly. Twenty-one boundary blocks are flagged; 18
have no population, while the three populated flagged blocks have a minimum
assigned overlap of 76.326%. These counts are also recorded in the machine-
readable QA file so future rebuilds can be compared.

## Maintenance

On Windows, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/update-census-data.ps1
```

Add `--refresh` after the script path to redownload all official source files.
Without it, the build reuses the local cache for speed and reproducibility.

The generated CSV and JSON files are designed to be committed. Downloaded raw
responses and the local Python environment are ignored by Git. When a Census or
precinct vintage changes, update the constants and source descriptions in the
build script, regenerate the files, inspect the QA report, and record the change
in the dashboard changelog before publishing.

## Limitations and appropriate use

- Precinct boundaries are 2022 while block geometry is 2020; non-nesting edges
  are unavoidable and are disclosed.
- ACS values are multi-year survey estimates, not counts from the 2026 election.
- Population and housing weights assume that people or households represented
  by each block group are distributed like the corresponding 2020 block totals.
- The method does not identify causation or individual voting behavior. Avoid
  conclusions such as “group X supported candidate Y” from precinct-level
  correlations; that would be an ecological inference error.
- Land-cover dasymetric weighting can improve some severe boundary mismatches,
  but it requires additional land-use inputs and modeling choices. The present
  block-weighted method is more transparent and maintainable for this dashboard.
