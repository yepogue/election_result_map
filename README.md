# Primary Atlas

An interactive, source-linked precinct map for the September 1, 2026 Democratic primary in the Massachusetts Suffolk and Middlesex Senate District.

## What is included

- All 59 district precincts, using official MassGIS 2022 ward and precinct boundaries.
- Precinct-level votes for Will Brownsberger and Max Lander.
- Turnout calculated from ballots cast and registered voters.
- Simultaneous candidate-lead color and turnout-size encoding, plus a turnout-only view.
- Explicit map color thresholds and municipal Brownsberger vote shares.
- Hover, single-tap mobile details, keyboard access, search, municipality filters, and sortable table columns.
- Downloadable CSV results and GeoJSON boundaries.
- Direct links to the original municipal election files and state boundary sources.
- Census ACS/CVAP context links and a documented path for obtaining aggregate primary-voter enrollment splits.
- A plain-language change log at the bottom of the published dashboard.
- A separate `/wu-precinct-analysis` page comparing three 2026 Boston State Senate results with Michelle Wu's 2021 and 2025 precinct strength.
- Downloadable Wu-analysis rows, modeled summaries, the 2021-to-current precinct crosswalk, and an automated QA report.

The headline, map, table, and municipal totals all use the Secretary of the Commonwealth's certified post-recount precinct export. Registration and overall election turnout remain sourced from municipal precinct reports.

## Update the data

1. Open `public/data/results.csv` in Excel or Google Sheets.
2. Keep the header row and precinct IDs unchanged.
3. Replace the numbers or add corrected rows.
4. Update final district totals, status, and dates in `public/data/election.json`.
5. Add a plain-language release note to `public/data/changelog.json`.
6. Export the sheet as a UTF-8 CSV with the same filename.
7. Run the validation and build commands below.

See `MAINTENANCE.md` for the field definitions, expected totals, and a release checklist.

## Refresh the Wu precinct analysis

The Wu analysis is generated from the linked official election and boundary sources. On Windows, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/update-wu-analysis.ps1 --refresh
```

The script creates its own Python environment, rebuilds the public downloads, and writes a QA report. Review `public/data/wu_analysis_qa.json` before publishing. The full allocation and comparison method is in `docs/WU_PRECINCT_ANALYSIS_METHOD.md`.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal.

## Validate a release

```bash
npm run lint
npm run build
```

This project uses the Sites-compatible vinext starter and can be deployed from the production build output.

## Deploy to AI Builder Space

The root `Dockerfile` creates a single-process standalone Node server. It binds to `0.0.0.0`, reads the platform-provided `PORT` environment variable, and defaults to port 8000 for local container testing.

Before deploying:

1. Put this project in a public GitHub repository.
2. Commit and push the deployment files and application source.
3. Choose a unique service name and the branch to deploy.
4. Submit those three values through the AI Builder Space deployment workflow.

No application secrets or custom environment variables are required for this dashboard.
