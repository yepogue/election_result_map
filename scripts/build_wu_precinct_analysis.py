"""Build the Boston precinct dataset for the Wu-strength comparison page.

The public analysis compares three 2026 Democratic State Senate races with
Michelle Wu's precinct-level vote share in the 2021 preliminary, 2021 final,
and 2025 preliminary mayoral elections. Boston changed precinct boundaries
after 2021, so this script allocates 2021 vote numerators and denominators to
the current precinct geography with a 2020 Census-block population crosswalk.

Downloaded source files stay in data/cache/wu-analysis and are not committed.
Generated, reviewable CSV and JSON files are written to public/data.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import geopandas as gpd
import maup
import pandas as pd
import pdfplumber
import requests


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / "data" / "cache" / "wu-analysis"
DEFAULT_OUTPUT = ROOT / "public" / "data"
PROJECTED_CRS = "EPSG:26986"

SOURCES = {
    "wu_2021_preliminary": {
        "title": "City of Boston 2021 preliminary mayor results by ward and precinct",
        "url": "https://search.boston.gov/sites/default/files/file/2021/10/001%20-%202021%20-%2009-14-21%20-%20Mayor.pdf",
        "filename": "boston-2021-preliminary-mayor.pdf",
        "kind": "pdf",
        "status": "Official City of Boston results",
        "used_for": "Michelle Wu votes and valid mayoral votes on the 2021 precinct geography",
    },
    "wu_2021_final": {
        "title": "City of Boston 2021 final mayor results by ward and precinct",
        "url": "https://search.boston.gov/sites/default/files/file/2021/11/2021-11-02-21-Mayor.pdf",
        "filename": "boston-2021-final-mayor.pdf",
        "kind": "pdf",
        "status": "Official City of Boston results",
        "used_for": "Michelle Wu votes and valid mayoral votes on the 2021 precinct geography",
    },
    "wu_2025_preliminary": {
        "title": "City of Boston 2025 preliminary mayor recount results by ward and precinct",
        "url": "https://search.boston.gov/sites/default/files/file/2025/10/001-2025-09-09-25-Mayor-RECOUNT.pdf",
        "filename": "boston-2025-preliminary-mayor-recount.pdf",
        "kind": "pdf",
        "status": "Official City of Boston recount results",
        "used_for": "Michelle Wu votes and valid mayoral votes on the current precinct geography",
    },
    "race_first_suffolk": {
        "title": "Secretary of the Commonwealth 2026 First Suffolk Democratic primary precinct export",
        "url": "https://electionstats.state.ma.us/elections/download/173147/precincts_include:1/",
        "page_url": "https://electionstats.state.ma.us/elections/view/173147/",
        "filename": "first-suffolk-2026.csv",
        "kind": "csv",
        "status": "Official state precinct results",
        "used_for": "Nicholas Collins, Latoya Gayle, and Juwan Skeens precinct votes",
    },
    "race_norfolk_suffolk": {
        "title": "Secretary of the Commonwealth 2026 Norfolk and Suffolk Democratic primary precinct export",
        "url": "https://electionstats.state.ma.us/elections/download/173151/precincts_include:1/",
        "page_url": "https://electionstats.state.ma.us/elections/view/173151/",
        "filename": "norfolk-suffolk-2026.csv",
        "kind": "csv",
        "status": "Official state precinct results",
        "used_for": "Persis Yu and Michael Rush precinct votes",
    },
    "race_suffolk_middlesex": {
        "title": "Secretary of the Commonwealth post-recount Suffolk and Middlesex precinct export",
        "url": "https://electionstats.state.ma.us/elections/download/173087/precincts_include:1/",
        "page_url": "https://electionstats.state.ma.us/elections/view/173087/",
        "filename": "suffolk-middlesex-2026.csv",
        "kind": "csv",
        "status": "Official post-recount state precinct results",
        "used_for": "Will Brownsberger and Daniel Lander precinct votes",
    },
    "precincts_2012": {
        "title": "City of Boston precinct boundaries used for the 2021 elections",
        "url": "https://gisportal.boston.gov/arcgis/rest/services/Planning/OpenData/MapServer/7/query?where=1%3D1&outFields=OBJECTID%2CPRECINCT%2CWARD_PRECINCT&returnGeometry=true&outSR=4326&f=geojson",
        "page_url": "https://gisportal.boston.gov/arcgis/rest/services/Planning/OpenData/MapServer/7",
        "filename": "boston-precincts-2012.geojson",
        "kind": "geojson",
        "status": "Official City of Boston GIS layer; 255 precincts",
        "used_for": "Source side of the 2021-to-current precinct crosswalk",
    },
    "precincts_2022": {
        "title": "MassGIS 2022 wards and precincts",
        "url": "https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/WardsPrecincts2022/FeatureServer/0/query?where=TOWN%3D%27BOSTON%27&outFields=OBJECTID%2CWARD%2CPRECINCT%2CWP_DISTRICT%2CWP_NAME%2CTOWN&returnGeometry=true&outSR=4326&f=geojson",
        "page_url": "https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/WardsPrecincts2022/FeatureServer/0",
        "filename": "boston-precincts-2022.geojson",
        "kind": "geojson",
        "status": "Official MassGIS current precinct layer; 275 Boston precincts",
        "used_for": "Common geography for the 2025 and 2026 results",
    },
    "census_blocks": {
        "title": "2020 Census blocks, Suffolk County, TIGERweb",
        "url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/10/query?where=STATE%3D%2725%27%20AND%20COUNTY%3D%27025%27&outFields=GEOID%2CSTATE%2CCOUNTY%2CTRACT%2CBLOCK%2CBLKGRP%2CPOP100%2CHU100%2CAREALAND%2CAREAWATER%2CINTPTLON%2CINTPTLAT&returnGeometry=true&outSR=4326&f=geojson",
        "page_url": "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/10",
        "filename": "suffolk-county-2020-blocks.geojson",
        "kind": "geojson",
        "status": "Official U.S. Census Bureau geography and counts",
        "used_for": "Population bridge between the old and current precinct boundaries",
    },
}


@dataclass(frozen=True)
class RaceDefinition:
    race_id: str
    district: str
    source_key: str
    challenger: str
    incumbent: str
    challenger_column: str
    incumbent_column: str
    endorsed_candidate: str
    outcome_note: str
    extra_candidate_column: str | None = None


RACES = (
    RaceDefinition(
        race_id="first-suffolk",
        district="First Suffolk",
        source_key="race_first_suffolk",
        challenger="Latoya Gayle",
        incumbent="Nicholas Collins",
        challenger_column="Latoya Sherria Gayle",
        incumbent_column="Nicholas P. Collins",
        endorsed_candidate="Latoya Gayle",
        outcome_note="Collins won; Gayle was endorsed by Mayor Wu.",
        extra_candidate_column="Juwan Khiry Skeens",
    ),
    RaceDefinition(
        race_id="suffolk-middlesex",
        district="Suffolk and Middlesex",
        source_key="race_suffolk_middlesex",
        challenger="Daniel Lander",
        incumbent="Will Brownsberger",
        challenger_column="Daniel Lander",
        incumbent_column="William N. Brownsberger",
        endorsed_candidate="Daniel Lander",
        outcome_note="Brownsberger won the districtwide recount by 35 votes; Lander was endorsed by Mayor Wu.",
    ),
    RaceDefinition(
        race_id="norfolk-suffolk",
        district="Norfolk and Suffolk",
        source_key="race_norfolk_suffolk",
        challenger="Persis Yu",
        incumbent="Michael Rush",
        challenger_column="Persis S. Yu",
        incumbent_column="Michael F. Rush",
        endorsed_candidate="Michael Rush",
        outcome_note="Yu won; Mayor Wu endorsed incumbent Michael Rush, not challenger Persis Yu.",
    ),
)

WU_MEASURES = (
    ("wu_2021_preliminary_share", "2021 preliminary"),
    ("wu_2021_final_share", "2021 final"),
    ("wu_2025_preliminary_share", "2025 preliminary"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Download fresh source files.")
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def clean_label(value: Any) -> str:
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    match = re.fullmatch(r"0*(\d+)([A-Za-z]*)", text)
    if match:
        return f"{int(match.group(1))}{match.group(2).upper()}"
    return text.upper()


def precinct_id(ward: Any, precinct: Any) -> str:
    return f"BOS-{int(clean_label(ward)):02d}-{clean_label(precinct)}"


def download_sources(cache_dir: Path, refresh: bool) -> dict[str, Path]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "PrimaryAtlas Wu precinct analysis; https://github.com/yepogue/election_result_map"
        }
    )
    paths: dict[str, Path] = {}
    for key, source in SOURCES.items():
        path = cache_dir / source["filename"]
        paths[key] = path
        if path.exists() and not refresh:
            continue
        response = session.get(source["url"], timeout=240)
        response.raise_for_status()
        path.write_bytes(response.content)
        if len(response.content) < 100:
            raise RuntimeError(f"Source download is unexpectedly small: {source['url']}")
    return paths


def integer_values(text: str) -> list[int]:
    return [int(value.replace(",", "")) for value in re.findall(r"\d[\d,]*", text)]


def parse_mayor_pdf(path: Path) -> pd.DataFrame:
    records: list[dict[str, Any]] = []
    with pdfplumber.open(path) as pdf:
        if len(pdf.pages) != 23:
            raise RuntimeError(f"Expected 23 pages in {path.name}; found {len(pdf.pages)}")
        for page in pdf.pages[1:]:
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            ward_match = re.search(r"VOTES CAST BY PRECINCT\s+WARD\s*:\s*(\d+)", text)
            if not ward_match:
                raise RuntimeError(f"Could not identify ward on a page of {path.name}")
            ward = int(ward_match.group(1))
            candidates_line = next(
                (line for line in lines if line.startswith("CANDIDATES ") and "%" not in line),
                None,
            )
            if not candidates_line:
                raise RuntimeError(f"Could not identify precinct columns for Ward {ward}")
            precincts = candidates_line.removeprefix("CANDIDATES ").split()
            if precincts[-1] != "TOTAL":
                raise RuntimeError(f"Unexpected precinct header for Ward {ward}: {candidates_line}")
            precincts = precincts[:-1]

            wu_line = next(line for line in lines if line.startswith("MICHELLE WU "))
            votes_line = next(
                line
                for line in lines
                if line.startswith("VOTES CAST ")
                and "BY PRECINCT" not in line
                and "%" not in line
            )
            wu = integer_values(wu_line.removeprefix("MICHELLE WU "))
            valid = integer_values(votes_line.removeprefix("VOTES CAST "))
            if len(wu) != len(precincts) + 1 or len(valid) != len(precincts) + 1:
                raise RuntimeError(
                    f"Column count mismatch in {path.name}, Ward {ward}: "
                    f"{len(precincts)} precincts, {len(wu)} Wu values, {len(valid)} totals"
                )
            if sum(wu[:-1]) != wu[-1] or sum(valid[:-1]) != valid[-1]:
                raise RuntimeError(f"Ward-total check failed in {path.name}, Ward {ward}")
            for precinct, wu_votes, valid_votes in zip(precincts, wu[:-1], valid[:-1]):
                records.append(
                    {
                        "precinct_id": precinct_id(ward, precinct),
                        "ward": str(ward),
                        "precinct": clean_label(precinct),
                        "wu_votes": wu_votes,
                        "valid_votes": valid_votes,
                    }
                )
    frame = pd.DataFrame(records)
    if frame["precinct_id"].duplicated().any():
        raise RuntimeError(f"Duplicate precincts parsed from {path.name}")
    return frame


def parse_state_race(path: Path, race: RaceDefinition) -> pd.DataFrame:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            if row.get("City/Town") != "Boston":
                continue
            challenger_votes = int((row.get(race.challenger_column) or "0").replace(",", ""))
            incumbent_votes = int((row.get(race.incumbent_column) or "0").replace(",", ""))
            if challenger_votes + incumbent_votes == 0:
                continue
            ward = clean_label(row["Ward"])
            precinct = clean_label(row["Pct"])
            extra_votes = (
                int((row.get(race.extra_candidate_column) or "0").replace(",", ""))
                if race.extra_candidate_column
                else 0
            )
            total_votes = int((row.get("Total Votes Cast") or "0").replace(",", ""))
            endorsed_votes = (
                challenger_votes
                if race.endorsed_candidate == race.challenger
                else incumbent_votes
            )
            two_candidate_votes = challenger_votes + incumbent_votes
            records.append(
                {
                    "race_id": race.race_id,
                    "district": race.district,
                    "ward": ward,
                    "precinct": precinct,
                    "precinct_id": precinct_id(ward, precinct),
                    "challenger": race.challenger,
                    "incumbent": race.incumbent,
                    "endorsed_candidate": race.endorsed_candidate,
                    "challenger_votes": challenger_votes,
                    "incumbent_votes": incumbent_votes,
                    "extra_candidate_votes": extra_votes,
                    "two_candidate_votes": two_candidate_votes,
                    "contest_ballots": total_votes,
                    "challenger_share": challenger_votes / two_candidate_votes,
                    "endorsed_share": endorsed_votes / two_candidate_votes,
                    "outcome_note": race.outcome_note,
                }
            )
    frame = pd.DataFrame(records)
    if frame.empty or frame["precinct_id"].duplicated().any():
        raise RuntimeError(f"Missing or duplicate Boston rows in {path.name}")
    return frame


def old_geo_id(value: Any) -> str:
    label = str(value).strip().upper()
    if not re.fullmatch(r"\d{4}[A-Z]?", label):
        raise RuntimeError(f"Unexpected old precinct label: {label}")
    return precinct_id(label[:2], label[2:])


def build_crosswalk(old_path: Path, current_path: Path, blocks_path: Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    old = gpd.read_file(old_path).to_crs(PROJECTED_CRS)
    current = gpd.read_file(current_path).to_crs(PROJECTED_CRS)
    blocks = gpd.read_file(blocks_path).to_crs(PROJECTED_CRS)

    old["old_precinct_id"] = old["WARD_PRECINCT"].map(old_geo_id)
    current["current_precinct_id"] = current.apply(
        lambda row: precinct_id(row["WARD"], row["PRECINCT"]), axis=1
    )
    blocks["block_geoid"] = blocks["GEOID"].astype(str).str.zfill(15)
    for column in ("POP100", "HU100", "AREALAND"):
        blocks[column] = pd.to_numeric(blocks[column], errors="coerce").fillna(0)

    old = old.set_index("old_precinct_id", drop=False)
    current = current.set_index("current_precinct_id", drop=False)
    blocks = blocks.set_index("block_geoid", drop=False)

    blocks["old_precinct_id"] = maup.assign(blocks.geometry, old.geometry)
    blocks["current_precinct_id"] = maup.assign(blocks.geometry, current.geometry)
    boston_blocks = blocks.dropna(subset=["old_precinct_id", "current_precinct_id"]).copy()
    boston_blocks["old_precinct_id"] = boston_blocks["old_precinct_id"].astype(str)
    boston_blocks["current_precinct_id"] = boston_blocks["current_precinct_id"].astype(str)

    crosswalk = (
        boston_blocks.groupby(["old_precinct_id", "current_precinct_id"], as_index=False)
        .agg(
            population_2020=("POP100", "sum"),
            housing_units_2020=("HU100", "sum"),
            land_area_sq_m_2020=("AREALAND", "sum"),
            census_block_count=("block_geoid", "count"),
        )
    )
    old_totals = crosswalk.groupby("old_precinct_id").agg(
        old_population_2020=("population_2020", "sum"),
        old_housing_units_2020=("housing_units_2020", "sum"),
        old_land_area_sq_m_2020=("land_area_sq_m_2020", "sum"),
    )
    crosswalk = crosswalk.merge(old_totals, on="old_precinct_id", validate="many_to_one")

    def allocation(row: pd.Series) -> tuple[float, str]:
        if row["old_population_2020"] > 0:
            return row["population_2020"] / row["old_population_2020"], "2020 population"
        if row["old_housing_units_2020"] > 0:
            return row["housing_units_2020"] / row["old_housing_units_2020"], "2020 housing units"
        return row["land_area_sq_m_2020"] / row["old_land_area_sq_m_2020"], "land area fallback"

    allocation_values = crosswalk.apply(allocation, axis=1)
    crosswalk["allocation_weight"] = [value[0] for value in allocation_values]
    crosswalk["weight_basis"] = [value[1] for value in allocation_values]
    crosswalk["source_piece_count"] = crosswalk.groupby("old_precinct_id")[
        "current_precinct_id"
    ].transform("count")
    crosswalk["target_source_count"] = crosswalk.groupby("current_precinct_id")[
        "old_precinct_id"
    ].transform("count")

    weight_sums = crosswalk.groupby("old_precinct_id")["allocation_weight"].sum()
    missing_old = sorted(set(old.index) - set(crosswalk["old_precinct_id"]))
    missing_current = sorted(set(current.index) - set(crosswalk["current_precinct_id"]))
    qa = {
        "oldPrecinctCount": int(len(old)),
        "currentPrecinctCount": int(len(current)),
        "suffolkCountyBlockCount": int(len(blocks)),
        "blocksAssignedToBothBostonGeographies": int(len(boston_blocks)),
        "crosswalkRowCount": int(len(crosswalk)),
        "splitOldPrecinctCount": int((crosswalk.groupby("old_precinct_id").size() > 1).sum()),
        "combinedCurrentPrecinctCount": int((crosswalk.groupby("current_precinct_id").size() > 1).sum()),
        "missingOldPrecincts": missing_old,
        "missingCurrentPrecincts": missing_current,
        "maximumWeightSumError": float((weight_sums - 1).abs().max()),
        "allOldWeightsSumToOne": bool(((weight_sums - 1).abs() < 1e-9).all()),
        "allocationBasisCounts": {
            str(key): int(value)
            for key, value in crosswalk.groupby("weight_basis")["old_precinct_id"].nunique().items()
        },
    }
    if missing_old or missing_current or not qa["allOldWeightsSumToOne"]:
        raise RuntimeError(f"Crosswalk coverage check failed: {qa}")
    return crosswalk.sort_values(["old_precinct_id", "current_precinct_id"]), qa


def allocate_old_results(old_results: pd.DataFrame, crosswalk: pd.DataFrame, prefix: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    missing = sorted(set(old_results["precinct_id"]) - set(crosswalk["old_precinct_id"]))
    if missing:
        raise RuntimeError(f"Results are missing from the crosswalk: {missing}")
    allocated = old_results.merge(
        crosswalk[["old_precinct_id", "current_precinct_id", "allocation_weight"]],
        left_on="precinct_id",
        right_on="old_precinct_id",
        validate="one_to_many",
    )
    allocated["allocated_wu_votes"] = allocated["wu_votes"] * allocated["allocation_weight"]
    allocated["allocated_valid_votes"] = allocated["valid_votes"] * allocated["allocation_weight"]
    current = (
        allocated.groupby("current_precinct_id", as_index=False)
        .agg(
            wu_votes=("allocated_wu_votes", "sum"),
            valid_votes=("allocated_valid_votes", "sum"),
            contributing_2021_precincts=("old_precinct_id", "nunique"),
        )
        .rename(columns={"current_precinct_id": "precinct_id"})
    )
    current[f"{prefix}_share"] = current["wu_votes"] / current["valid_votes"]
    current = current.rename(
        columns={
            "wu_votes": f"{prefix}_wu_votes_est",
            "valid_votes": f"{prefix}_valid_votes_est",
            "contributing_2021_precincts": f"{prefix}_source_precincts",
        }
    )
    qa = {
        "sourceWuVotes": int(old_results["wu_votes"].sum()),
        "allocatedWuVotes": float(current[f"{prefix}_wu_votes_est"].sum()),
        "sourceValidVotes": int(old_results["valid_votes"].sum()),
        "allocatedValidVotes": float(current[f"{prefix}_valid_votes_est"].sum()),
        "wuVoteConservationError": float(
            current[f"{prefix}_wu_votes_est"].sum() - old_results["wu_votes"].sum()
        ),
        "validVoteConservationError": float(
            current[f"{prefix}_valid_votes_est"].sum() - old_results["valid_votes"].sum()
        ),
    }
    return current, qa


def direct_current_results(results: pd.DataFrame, prefix: str) -> pd.DataFrame:
    current = results[["precinct_id", "wu_votes", "valid_votes"]].copy()
    current[f"{prefix}_share"] = current["wu_votes"] / current["valid_votes"].replace(0, pd.NA)
    return current.rename(
        columns={
            "wu_votes": f"{prefix}_wu_votes",
            "valid_votes": f"{prefix}_valid_votes",
        }
    )


def weighted_quantile(values: pd.Series, quantile: float) -> float:
    return float(values.quantile(quantile))


def regression_summary(frame: pd.DataFrame, x_column: str, y_column: str) -> dict[str, float]:
    x = frame[x_column].astype(float)
    y = frame[y_column].astype(float)
    weights = frame["two_candidate_votes"].astype(float)
    weight_total = weights.sum()
    x_mean = float((weights * x).sum() / weight_total)
    y_mean = float((weights * y).sum() / weight_total)
    covariance = float((weights * (x - x_mean) * (y - y_mean)).sum())
    variance_x = float((weights * (x - x_mean) ** 2).sum())
    slope = covariance / variance_x if variance_x else 0.0
    intercept = y_mean - slope * x_mean
    fitted = intercept + slope * x
    sse = float((weights * (y - fitted) ** 2).sum())
    sst = float((weights * (y - y_mean) ** 2).sum())
    r_squared = 1 - sse / sst if sst else 0.0
    q25 = weighted_quantile(x, 0.25)
    q75 = weighted_quantile(x, 0.75)
    return {
        "slope": slope,
        "intercept": intercept,
        "rSquared": r_squared,
        "wuWeakShare": q25,
        "wuStrongShare": q75,
        "weakToStrongDifferencePp": slope * (q75 - q25) * 100,
        "candidateShareAtWeak": (intercept + slope * q25),
        "candidateShareAtStrong": (intercept + slope * q75),
        "rawSlopePpPer10PpWu": slope * 10,
    }


def build_summaries(analysis: pd.DataFrame) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for view_id, y_column, view_label in (
        ("challenger", "challenger_share", "Challenger share"),
        ("endorsed", "endorsed_share", "Wu-endorsed candidate share"),
    ):
        for race in RACES:
            race_frame = analysis[analysis["race_id"] == race.race_id]
            for x_column, wu_label in WU_MEASURES:
                summary = regression_summary(race_frame, x_column, y_column)
                summaries.append(
                    {
                        "view": view_id,
                        "viewLabel": view_label,
                        "raceId": race.race_id,
                        "district": race.district,
                        "candidate": (
                            race.challenger if view_id == "challenger" else race.endorsed_candidate
                        ),
                        "wuMeasure": x_column,
                        "wuMeasureLabel": wu_label,
                        "precinctCount": int(len(race_frame)),
                        "twoCandidateVotes": int(race_frame["two_candidate_votes"].sum()),
                        **summary,
                    }
                )
    return summaries


def source_public_record(key: str, source: dict[str, str]) -> dict[str, str]:
    return {
        "id": key,
        "title": source["title"],
        "url": source.get("page_url", source["url"]),
        "downloadUrl": source["url"],
        "status": source["status"],
        "usedFor": source["used_for"],
    }


def main() -> None:
    args = parse_args()
    paths = download_sources(args.cache_dir, args.refresh)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    wu_2021_prelim_old = parse_mayor_pdf(paths["wu_2021_preliminary"])
    wu_2021_final_old = parse_mayor_pdf(paths["wu_2021_final"])
    wu_2025_current_raw = parse_mayor_pdf(paths["wu_2025_preliminary"])

    crosswalk, crosswalk_qa = build_crosswalk(
        paths["precincts_2012"], paths["precincts_2022"], paths["census_blocks"]
    )
    wu_2021_prelim, prelim_qa = allocate_old_results(
        wu_2021_prelim_old, crosswalk, "wu_2021_preliminary"
    )
    wu_2021_final, final_qa = allocate_old_results(
        wu_2021_final_old, crosswalk, "wu_2021_final"
    )
    wu_2025_current = direct_current_results(wu_2025_current_raw, "wu_2025_preliminary")

    wu_context = wu_2021_prelim.merge(
        wu_2021_final, on="precinct_id", how="outer", validate="one_to_one"
    ).merge(wu_2025_current, on="precinct_id", how="outer", validate="one_to_one")

    race_frames = [parse_state_race(paths[race.source_key], race) for race in RACES]
    analysis = pd.concat(race_frames, ignore_index=True).merge(
        wu_context, on="precinct_id", how="left", validate="many_to_one"
    )
    required_measures = [measure[0] for measure in WU_MEASURES]
    if analysis[required_measures].isna().any().any():
        missing = analysis.loc[
            analysis[required_measures].isna().any(axis=1),
            ["race_id", "precinct_id"] + required_measures,
        ]
        raise RuntimeError(f"Missing Wu measures for analysis precincts:\n{missing}")

    analysis["challenger_share_pct"] = 100 * analysis["challenger_share"]
    analysis["endorsed_share_pct"] = 100 * analysis["endorsed_share"]
    for column in required_measures:
        analysis[f"{column}_pct"] = 100 * analysis[column]

    summaries = build_summaries(analysis)
    summary_frame = pd.DataFrame(summaries)

    analysis_columns = [
        "race_id",
        "district",
        "precinct_id",
        "ward",
        "precinct",
        "challenger",
        "incumbent",
        "endorsed_candidate",
        "challenger_votes",
        "incumbent_votes",
        "extra_candidate_votes",
        "two_candidate_votes",
        "contest_ballots",
        "challenger_share_pct",
        "endorsed_share_pct",
        "wu_2021_preliminary_share_pct",
        "wu_2021_final_share_pct",
        "wu_2025_preliminary_share_pct",
        "wu_2021_preliminary_wu_votes_est",
        "wu_2021_preliminary_valid_votes_est",
        "wu_2021_final_wu_votes_est",
        "wu_2021_final_valid_votes_est",
        "wu_2025_preliminary_wu_votes",
        "wu_2025_preliminary_valid_votes",
        "outcome_note",
    ]
    analysis_output = analysis[analysis_columns].copy()
    for column in analysis_output.columns:
        if column.endswith("_pct") or column.endswith("_est"):
            analysis_output[column] = analysis_output[column].astype(float).round(4)
    analysis_output = analysis_output.sort_values(["race_id", "ward", "precinct"])
    analysis_output.to_csv(args.output_dir / "wu_precinct_analysis.csv", index=False)
    (args.output_dir / "wu_precinct_analysis.json").write_text(
        analysis_output.to_json(orient="records", indent=2), encoding="utf-8"
    )

    crosswalk_output = crosswalk.copy()
    crosswalk_output["allocation_weight"] = crosswalk_output["allocation_weight"].round(8)
    crosswalk_output.to_csv(
        args.output_dir / "wu_2021_to_2022_precinct_crosswalk.csv", index=False
    )

    summary_frame.to_csv(args.output_dir / "wu_precinct_summary.csv", index=False)
    (args.output_dir / "wu_precinct_summary.json").write_text(
        json.dumps(summaries, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (args.output_dir / "wu_analysis_sources.json").write_text(
        json.dumps(
            [source_public_record(key, source) for key, source in SOURCES.items()],
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    qa = {
        "generatedOn": date.today().isoformat(),
        "checks": {
            "crosswalkCoversAllOldAndCurrentBostonPrecincts": bool(
                not crosswalk_qa["missingOldPrecincts"]
                and not crosswalk_qa["missingCurrentPrecincts"]
            ),
            "crosswalkWeightsSumToOne": crosswalk_qa["allOldWeightsSumToOne"],
            "2021PreliminaryVotesConserved": bool(
                math.isclose(prelim_qa["wuVoteConservationError"], 0, abs_tol=1e-6)
                and math.isclose(prelim_qa["validVoteConservationError"], 0, abs_tol=1e-6)
            ),
            "2021FinalVotesConserved": bool(
                math.isclose(final_qa["wuVoteConservationError"], 0, abs_tol=1e-6)
                and math.isclose(final_qa["validVoteConservationError"], 0, abs_tol=1e-6)
            ),
            "allAnalysisPrecinctsHaveThreeWuMeasures": bool(
                not analysis[required_measures].isna().any().any()
            ),
            "allAnalysisSharesBetweenZeroAndOne": bool(
                analysis[
                    ["challenger_share", "endorsed_share"] + required_measures
                ].apply(lambda column: column.between(0, 1).all()).all()
            ),
        },
        "crosswalk": crosswalk_qa,
        "2021PreliminaryAllocation": prelim_qa,
        "2021FinalAllocation": final_qa,
        "analysis": {
            "rowCount": int(len(analysis)),
            "racePrecinctCounts": {
                str(key): int(value)
                for key, value in analysis.groupby("race_id").size().items()
            },
            "raceTwoCandidateVotes": {
                str(key): int(value)
                for key, value in analysis.groupby("race_id")["two_candidate_votes"].sum().items()
            },
            "summaryRowCount": int(len(summaries)),
        },
        "notes": [
            "The First Suffolk two-candidate share excludes Juwan Skeens and all other votes.",
            "2021 results are allocated as vote numerators and denominators before shares are calculated.",
            "Regression lines are weighted by the two-candidate 2026 vote total in each precinct.",
            "The public summary uses the modeled difference between the 25th- and 75th-percentile Wu precincts; no bootstrap intervals or significance claims are used.",
        ],
    }
    if not all(qa["checks"].values()):
        raise RuntimeError(f"One or more QA checks failed: {qa['checks']}")
    (args.output_dir / "wu_analysis_qa.json").write_text(
        json.dumps(qa, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(
        f"Built {len(analysis_output)} precinct-race rows, {len(summaries)} summaries, "
        f"and {len(crosswalk_output)} crosswalk rows."
    )


if __name__ == "__main__":
    main()
