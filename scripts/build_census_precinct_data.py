"""Build an auditable Census-to-precinct crosswalk and precinct estimates.

The script uses 2020 Census blocks as the allocation bridge between Census
block groups and the 2022 Massachusetts ward/precinct boundaries used by the
dashboard. It writes public CSV/JSON files; downloaded source responses remain
in data/cache/census and are intentionally not committed.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
import maup
import pandas as pd
import requests


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "public" / "data"
DEFAULT_CACHE = ROOT / "data" / "cache" / "census"
DISTRICT_PRECINCTS = ROOT / "public" / "data" / "district-precincts.geojson"
RESULTS = ROOT / "public" / "data" / "results.csv"

MASSGIS_LAYER = (
    "https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/"
    "AGOL/WardsPrecincts2022/FeatureServer/0"
)
TIGERWEB_SERVICE = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "TIGERweb/tigerWMS_Census2020/MapServer"
)
CENSUS_REPORTER_API = "https://api.censusreporter.org/1.0/data/show/acs2024_5yr"
USER_AGENT = (
    "PrimaryAtlas election precinct crosswalk; "
    "https://github.com/yepogue/election_result_map"
)
COUNTIES = ("25017", "25025")
CONTEXT_MUNICIPALITIES = (
    "BOSTON",
    "CAMBRIDGE",
    "WATERTOWN",
    "BELMONT",
    "SOMERVILLE",
    "NEWTON",
    "BROOKLINE",
    "ARLINGTON",
    "WALTHAM",
)
PROJECTED_CRS = "EPSG:26986"  # NAD83 / Massachusetts Mainland, metres.

ACS_TABLES = (
    "B01001",  # Age by sex
    "B03002",  # Hispanic origin by race
    "B15003",  # Educational attainment, age 25+
    "B25003",  # Tenure
    "B19001",  # Household income distribution
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Ignore cached source responses and download them again.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE,
        help="Directory for uncommitted source-response cache files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Directory for generated public data files.",
    )
    return parser.parse_args()


def fail(message: str) -> None:
    raise RuntimeError(message)


def fetch_json(
    session: requests.Session,
    url: str,
    params: dict[str, Any],
    cache_path: Path,
    refresh: bool,
) -> dict[str, Any]:
    if cache_path.exists() and not refresh:
        return json.loads(cache_path.read_text(encoding="utf-8"))

    response = session.get(url, params=params, timeout=180)
    response.raise_for_status()
    try:
        payload = response.json()
    except requests.JSONDecodeError as exc:
        preview = response.text[:240].replace("\n", " ")
        fail(f"Expected JSON from {response.url}; received: {preview}")
        raise exc
    if isinstance(payload, dict) and payload.get("error"):
        fail(f"Source API error from {response.url}: {payload['error']}")

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return payload


def arcgis_count(
    session: requests.Session,
    layer_url: str,
    query: dict[str, Any],
) -> int:
    params = dict(query)
    params.update({"returnCountOnly": "true", "returnGeometry": "false", "f": "json"})
    response = session.get(f"{layer_url}/query", params=params, timeout=180)
    response.raise_for_status()
    payload = response.json()
    if payload.get("error"):
        fail(f"ArcGIS count query failed: {payload['error']}")
    return int(payload["count"])


def fetch_arcgis_geojson(
    session: requests.Session,
    layer_url: str,
    query: dict[str, Any],
    out_fields: Iterable[str],
    cache_path: Path,
    refresh: bool,
) -> gpd.GeoDataFrame:
    params = dict(query)
    params.update(
        {
            "outFields": ",".join(out_fields),
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        }
    )
    expected_count: int | None = None
    if refresh or not cache_path.exists():
        expected_count = arcgis_count(session, layer_url, query)
    payload = fetch_json(session, f"{layer_url}/query", params, cache_path, refresh)
    if payload.get("type") != "FeatureCollection":
        fail(f"Expected a GeoJSON FeatureCollection from {layer_url}")
    received_count = len(payload.get("features", []))
    if expected_count is not None and received_count != expected_count:
        # A small number of MassGIS polygons cannot be serialized as GeoJSON by
        # the service even though the count endpoint includes them. The district
        # targets are checked separately below, so warn here but reject a likely
        # transfer-limit truncation.
        if received_count < expected_count * 0.95:
            fail(
                f"Truncated ArcGIS response from {layer_url}: expected "
                f"{expected_count:,} features, received {received_count:,}."
            )
        print(
            f"WARNING: ArcGIS counted {expected_count:,} features but returned "
            f"{received_count:,} GeoJSON geometries from {layer_url}.",
            file=sys.stderr,
        )
    frame = gpd.GeoDataFrame.from_features(payload["features"], crs="EPSG:4326")
    frame.geometry = frame.geometry.make_valid()
    return frame


def clean_number_label(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    try:
        return str(int(text))
    except ValueError:
        return text


def precinct_key(town: Any, wp_district: Any) -> str:
    return f"{str(town).strip().upper()}|{clean_number_label(wp_district)}"


def results_key(municipality: Any, ward: Any, precinct: Any) -> str:
    return "|".join(
        (
            str(municipality).strip().upper(),
            clean_number_label(ward),
            clean_number_label(precinct),
        )
    )


def geo_results_key(town: Any, ward: Any, precinct: Any) -> str:
    return "|".join(
        (
            str(town).strip().upper(),
            clean_number_label(ward),
            clean_number_label(precinct),
        )
    )


def finite_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= -1.0e8:
        return None
    return number


def acs_cells(
    record: dict[str, Any], table: str, cell_numbers: Iterable[int]
) -> tuple[float | None, float | None]:
    table_record = record.get(table, {})
    estimates = table_record.get("estimate", {})
    errors = table_record.get("error", {})
    values: list[float] = []
    moes: list[float] = []
    for cell_number in cell_numbers:
        variable = f"{table}{cell_number:03d}"
        estimate = finite_number(estimates.get(variable))
        moe = finite_number(errors.get(variable))
        if estimate is None:
            return None, None
        values.append(estimate)
        if moe is not None:
            moes.append(moe)
    combined_moe = math.sqrt(sum(value * value for value in moes)) if moes else None
    return sum(values), combined_moe


def derive_acs_metrics(record: dict[str, Any]) -> dict[str, float | None]:
    specs: dict[str, tuple[str, Iterable[int]]] = {
        "acs_population": ("B01001", (1,)),
        "acs_voting_age_18_plus": ("B01001", (*range(7, 26), *range(31, 50))),
        "acs_age_18_34": ("B01001", (*range(7, 13), *range(31, 37))),
        "acs_age_65_plus": ("B01001", (*range(20, 26), *range(44, 50))),
        "acs_hispanic": ("B03002", (12,)),
        "acs_nonhispanic_white": ("B03002", (3,)),
        "acs_nonhispanic_black": ("B03002", (4,)),
        "acs_nonhispanic_asian": ("B03002", (6,)),
        "acs_nonhispanic_other_or_multiracial": ("B03002", (5, 7, 8, 9)),
        "acs_education_age_25_plus": ("B15003", (1,)),
        "acs_bachelors_plus": ("B15003", (22, 23, 24, 25)),
        "acs_occupied_households": ("B25003", (1,)),
        "acs_renter_households": ("B25003", (3,)),
        "acs_income_households": ("B19001", (1,)),
        "acs_households_income_below_50k": ("B19001", tuple(range(2, 11))),
    }
    output: dict[str, float | None] = {}
    for metric, (table, cells) in specs.items():
        estimate, moe = acs_cells(record, table, cells)
        output[f"{metric}_est"] = estimate
        output[f"{metric}_moe"] = moe
    return output


def load_acs_block_groups(
    session: requests.Session,
    cache_dir: Path,
    refresh: bool,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    records_by_geoid: dict[str, dict[str, Any]] = {}
    releases: list[dict[str, Any]] = []
    for county in COUNTIES:
        # Census Reporter rejects very wide county/block-group requests. Fetching
        # one official ACS table at a time is slower but deterministic and easy
        # to cache, inspect, and retry.
        for table in ACS_TABLES:
            params = {
                "table_ids": table,
                "geo_ids": f"150|05000US{county}",
            }
            payload = fetch_json(
                session,
                CENSUS_REPORTER_API,
                params,
                cache_dir / f"acs2024_5yr_block_groups_{county}_{table}.json",
                refresh,
            )
            releases.append(payload.get("release", {}))
            for geography_id, record in payload.get("data", {}).items():
                geoid = geography_id.split("US", 1)[-1]
                if len(geoid) != 12:
                    continue
                records_by_geoid.setdefault(geoid, {}).update(record)
    if not records_by_geoid:
        fail("The ACS source returned no block-group records.")
    records = []
    for geoid, record in records_by_geoid.items():
        row: dict[str, Any] = {"block_group_geoid": geoid}
        row.update(derive_acs_metrics(record))
        records.append(row)
    release = next((item for item in releases if item), {})
    return pd.DataFrame(records).drop_duplicates("block_group_geoid"), release


def percent(numerator: Any, denominator: Any) -> float | None:
    numerator_value = finite_number(numerator)
    denominator_value = finite_number(denominator)
    if numerator_value is None or denominator_value is None or denominator_value == 0:
        return None
    return 100.0 * numerator_value / denominator_value


def make_data_dictionary(generated_at: str, release: dict[str, Any]) -> dict[str, Any]:
    return {
        "datasetVersion": "1.0",
        "generatedAtUtc": generated_at,
        "geographyVintage": {
            "censusBlocks": "2020 Census",
            "precincts": "MassGIS Wards and Precincts 2022",
            "acs": "2020-2024 ACS 5-year",
        },
        "accuracyTiers": {
            "direct": (
                "2020 population and housing units are whole-block counts aggregated "
                "after geographic assignment."
            ),
            "modeled": (
                "ACS block-group counts are allocated with 2020 block population or "
                "housing-unit weights. Percentages are ratios of allocated estimates."
            ),
            "notIncluded": (
                "The files do not infer individual behavior, party registration, or who voted."
            ),
        },
        "sources": [
            {
                "name": "2020 Census TIGERweb Census Blocks",
                "url": f"{TIGERWEB_SERVICE}/10",
                "use": "Block geometry, population, housing units, and land area",
            },
            {
                "name": "2020 Census TIGERweb Block Groups",
                "url": f"{TIGERWEB_SERVICE}/8",
                "use": "Whole-block-group denominators and geometry",
            },
            {
                "name": "MassGIS Wards and Precincts 2022",
                "url": MASSGIS_LAYER,
                "use": "Precinct geometry and published 2020 precinct population check",
            },
            {
                "name": "2020-2024 American Community Survey 5-year",
                "url": "https://www.census.gov/data/developers/data-sets/acs-5year/2024.html",
                "retrievedVia": "Census Reporter API",
                "retrievalUrl": CENSUS_REPORTER_API,
                "releaseMetadata": release,
                "use": "Block-group demographic, social, economic, and housing estimates",
            },
        ],
        "files": {
            "census_block_to_precinct.csv": {
                "grain": "One row per 2020 Census block assigned to a district precinct",
                "importantFields": {
                    "population_2020": "Direct 2020 Census whole-block population count",
                    "housing_units_2020": "Direct 2020 Census whole-block housing-unit count",
                    "overlap_pct_of_block": "Share of block polygon area inside assigned precinct",
                    "boundary_review_flag": "TRUE when overlap is below 95%",
                },
            },
            "census_block_group_precinct_crosswalk.csv": {
                "grain": "One block-group/precinct contribution",
                "importantFields": {
                    "person_weight": "Allocated block population / whole block-group population",
                    "household_weight": "Allocated block housing units / whole block-group housing units",
                    "district_person_weight_share": "Sum of person weights entering all district precincts",
                },
            },
            "precinct_demographics.csv": {
                "grain": "One row per election-dashboard precinct",
                "importantFields": {
                    "population_2020": "Direct block aggregation",
                    "*_est": "Modeled ACS estimate allocated from block groups",
                    "*_moe": "ACS sampling margin of error combined by root-sum-of-squares; allocation-model error is additional and not measured",
                    "*_pct": "Ratio of allocated ACS estimates; no separate modeled margin of error is claimed",
                },
            },
        },
    }


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})

    district = gpd.read_file(DISTRICT_PRECINCTS).to_crs("EPSG:4326")
    district.geometry = district.geometry.make_valid()
    district["target_key"] = district.apply(
        lambda row: precinct_key(row["TOWN"], row["WP_DISTRICT"]), axis=1
    )
    if district["target_key"].duplicated().any():
        fail("District precinct geometry contains duplicate town/precinct identifiers.")

    results = pd.read_csv(RESULTS, dtype=str, keep_default_na=False)
    results["join_key"] = results.apply(
        lambda row: results_key(row["municipality"], row["ward"], row["precinct"]),
        axis=1,
    )
    results_lookup = results.set_index("join_key")["id"].to_dict()
    district["results_join_key"] = district.apply(
        lambda row: geo_results_key(row["TOWN"], row["WARD"], row["PRECINCT"]),
        axis=1,
    )
    district["precinct_id"] = district["results_join_key"].map(results_lookup)
    if district["precinct_id"].isna().any():
        missing = district.loc[district["precinct_id"].isna(), "WP_NAME"].tolist()
        fail(f"District geometry did not match results rows: {missing}")
    if set(district["precinct_id"]) != set(results["id"]):
        fail("The 59 district geometries and election results do not have identical precinct IDs.")

    minx, miny, maxx, maxy = district.total_bounds
    context_where = "TOWN IN (" + ",".join(
        f"'{town}'" for town in CONTEXT_MUNICIPALITIES
    ) + ")"
    precinct_context_query = {"where": context_where}
    municipal_precincts = fetch_arcgis_geojson(
        session,
        MASSGIS_LAYER,
        precinct_context_query,
        (
            "OBJECTID",
            "WARD",
            "PRECINCT",
            "WP_DISTRICT",
            "WP_NAME",
            "TOWN",
            "TOWN_ID",
            "POP_2020",
        ),
        args.cache_dir / "massgis_wards_precincts_2022_nine_municipalities.geojson",
        args.refresh,
    )
    municipal_precincts["target_key"] = municipal_precincts.apply(
        lambda row: precinct_key(row["TOWN"], row["WP_DISTRICT"]), axis=1
    )
    if municipal_precincts["target_key"].duplicated().any():
        fail("MassGIS returned duplicate town/precinct identifiers.")
    missing_targets = sorted(
        set(district["target_key"]) - set(municipal_precincts["target_key"])
    )
    if missing_targets:
        fail(f"MassGIS GeoJSON omitted district precincts: {missing_targets}")

    bbox_query = {
        "where": "STATE='25' AND COUNTY IN ('017','025')",
        "geometry": f"{minx},{miny},{maxx},{maxy}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
    }
    blocks = fetch_arcgis_geojson(
        session,
        f"{TIGERWEB_SERVICE}/10",
        bbox_query,
        (
            "GEOID",
            "STATE",
            "COUNTY",
            "TRACT",
            "BLOCK",
            "BLKGRP",
            "POP100",
            "HU100",
            "AREALAND",
            "AREAWATER",
            "INTPTLON",
            "INTPTLAT",
        ),
        args.cache_dir / "tigerweb_2020_blocks_district_bbox.geojson",
        args.refresh,
    )
    block_groups = fetch_arcgis_geojson(
        session,
        f"{TIGERWEB_SERVICE}/8",
        bbox_query,
        ("GEOID", "POP100", "HU100", "AREALAND", "AREAWATER"),
        args.cache_dir / "tigerweb_2020_block_groups_district_bbox.geojson",
        args.refresh,
    )

    blocks = blocks.rename(
        columns={
            "GEOID": "block_geoid",
            "POP100": "population_2020",
            "HU100": "housing_units_2020",
            "AREALAND": "land_area_sq_m_2020",
            "AREAWATER": "water_area_sq_m_2020",
            "INTPTLON": "internal_lon",
            "INTPTLAT": "internal_lat",
        }
    )
    blocks["block_geoid"] = blocks["block_geoid"].astype(str).str.zfill(15)
    blocks["block_group_geoid"] = blocks["block_geoid"].str[:12]
    for column in (
        "population_2020",
        "housing_units_2020",
        "land_area_sq_m_2020",
        "water_area_sq_m_2020",
    ):
        blocks[column] = pd.to_numeric(blocks[column], errors="coerce").fillna(0)

    blocks_projected = blocks.to_crs(PROJECTED_CRS).set_index("block_geoid", drop=False)
    precincts_projected = municipal_precincts.to_crs(PROJECTED_CRS).set_index(
        "target_key", drop=False
    )
    assignments = maup.assign(blocks_projected.geometry, precincts_projected.geometry)
    blocks_projected["target_key"] = assignments

    assigned_mask = blocks_projected["target_key"].notna()
    assigned_targets = precincts_projected.geometry.reindex(
        blocks_projected.loc[assigned_mask, "target_key"].to_numpy()
    )
    assigned_targets.index = blocks_projected.index[assigned_mask]
    intersections = blocks_projected.loc[assigned_mask].geometry.intersection(assigned_targets)
    blocks_projected.loc[assigned_mask, "overlap_area_sq_m"] = intersections.area
    blocks_projected["block_geometry_area_sq_m"] = blocks_projected.geometry.area
    blocks_projected["overlap_share_of_block"] = (
        blocks_projected["overlap_area_sq_m"]
        / blocks_projected["block_geometry_area_sq_m"].replace(0, pd.NA)
    )

    district_target_to_id = district.set_index("target_key")["precinct_id"].to_dict()
    district_blocks = blocks_projected[
        blocks_projected["target_key"].isin(district_target_to_id)
    ].copy()
    district_blocks["precinct_id"] = district_blocks["target_key"].map(
        district_target_to_id
    )

    target_attributes = municipal_precincts.set_index("target_key")
    for output_name, source_name in (
        ("municipality", "TOWN"),
        ("ward", "WARD"),
        ("precinct", "PRECINCT"),
        ("precinct_name", "WP_NAME"),
    ):
        district_blocks[output_name] = district_blocks["target_key"].map(
            target_attributes[source_name]
        )
    district_blocks["municipality"] = district_blocks["municipality"].str.title()
    district_blocks["ward"] = district_blocks["ward"].map(clean_number_label)
    district_blocks["precinct"] = district_blocks["precinct"].map(clean_number_label)
    district_blocks["assignment_method"] = district_blocks[
        "overlap_share_of_block"
    ].map(lambda value: "covered" if value >= 0.999999 else "largest_overlap")
    district_blocks["boundary_review_flag"] = (
        district_blocks["overlap_share_of_block"] < 0.95
    )
    district_blocks["overlap_pct_of_block"] = (
        100.0 * district_blocks["overlap_share_of_block"]
    )

    block_groups = block_groups.rename(
        columns={
            "GEOID": "block_group_geoid",
            "POP100": "block_group_population_2020",
            "HU100": "block_group_housing_units_2020",
            "AREALAND": "block_group_land_area_sq_m_2020",
            "AREAWATER": "block_group_water_area_sq_m_2020",
        }
    )
    block_groups["block_group_geoid"] = (
        block_groups["block_group_geoid"].astype(str).str.zfill(12)
    )
    for column in (
        "block_group_population_2020",
        "block_group_housing_units_2020",
        "block_group_land_area_sq_m_2020",
        "block_group_water_area_sq_m_2020",
    ):
        block_groups[column] = pd.to_numeric(block_groups[column], errors="coerce").fillna(0)
    bg_denominators = block_groups.drop(columns="geometry").drop_duplicates(
        "block_group_geoid"
    )

    crosswalk = (
        district_blocks.groupby(
            [
                "block_group_geoid",
                "precinct_id",
                "municipality",
                "ward",
                "precinct",
                "precinct_name",
            ],
            dropna=False,
            as_index=False,
        )
        .agg(
            assigned_block_count=("block_geoid", "count"),
            assigned_population_2020=("population_2020", "sum"),
            assigned_housing_units_2020=("housing_units_2020", "sum"),
            assigned_land_area_sq_m_2020=("land_area_sq_m_2020", "sum"),
        )
        .merge(bg_denominators, on="block_group_geoid", how="left", validate="many_to_one")
    )
    if crosswalk["block_group_population_2020"].isna().any():
        missing = crosswalk.loc[
            crosswalk["block_group_population_2020"].isna(), "block_group_geoid"
        ].unique()
        fail(f"Missing TIGERweb block-group denominators for: {missing.tolist()}")

    def person_basis(row: pd.Series) -> tuple[float, str]:
        if row["block_group_population_2020"] > 0:
            return (
                row["assigned_population_2020"] / row["block_group_population_2020"],
                "population_2020",
            )
        if row["block_group_housing_units_2020"] > 0:
            return (
                row["assigned_housing_units_2020"]
                / row["block_group_housing_units_2020"],
                "housing_units_2020_fallback",
            )
        if row["block_group_land_area_sq_m_2020"] > 0:
            return (
                row["assigned_land_area_sq_m_2020"]
                / row["block_group_land_area_sq_m_2020"],
                "land_area_2020_fallback",
            )
        return 0.0, "no_weight_available"

    def household_basis(row: pd.Series) -> tuple[float, str]:
        if row["block_group_housing_units_2020"] > 0:
            return (
                row["assigned_housing_units_2020"]
                / row["block_group_housing_units_2020"],
                "housing_units_2020",
            )
        if row["block_group_population_2020"] > 0:
            return (
                row["assigned_population_2020"] / row["block_group_population_2020"],
                "population_2020_fallback",
            )
        if row["block_group_land_area_sq_m_2020"] > 0:
            return (
                row["assigned_land_area_sq_m_2020"]
                / row["block_group_land_area_sq_m_2020"],
                "land_area_2020_fallback",
            )
        return 0.0, "no_weight_available"

    person_values = crosswalk.apply(person_basis, axis=1)
    household_values = crosswalk.apply(household_basis, axis=1)
    crosswalk["person_weight"] = [item[0] for item in person_values]
    crosswalk["person_weight_basis"] = [item[1] for item in person_values]
    crosswalk["household_weight"] = [item[0] for item in household_values]
    crosswalk["household_weight_basis"] = [item[1] for item in household_values]
    crosswalk["district_person_weight_share"] = crosswalk.groupby(
        "block_group_geoid"
    )["person_weight"].transform("sum")
    crosswalk["district_household_weight_share"] = crosswalk.groupby(
        "block_group_geoid"
    )["household_weight"].transform("sum")

    acs, release = load_acs_block_groups(session, args.cache_dir, args.refresh)
    missing_acs = sorted(set(crosswalk["block_group_geoid"]) - set(acs["block_group_geoid"]))
    if missing_acs:
        fail(f"Missing ACS rows for {len(missing_acs)} block groups: {missing_acs[:10]}")
    crosswalk_acs = crosswalk.merge(
        acs, on="block_group_geoid", how="left", validate="many_to_one"
    )

    household_metrics = {
        "acs_occupied_households",
        "acs_renter_households",
        "acs_income_households",
        "acs_households_income_below_50k",
    }
    metric_bases = sorted(
        {
            column[:-4]
            for column in acs.columns
            if column.endswith("_est") and column != "block_group_geoid"
        }
    )
    for metric in metric_bases:
        weight_column = "household_weight" if metric in household_metrics else "person_weight"
        crosswalk_acs[f"{metric}_weighted_est"] = (
            crosswalk_acs[f"{metric}_est"] * crosswalk_acs[weight_column]
        )
        crosswalk_acs[f"{metric}_weighted_moe_sq"] = (
            crosswalk_acs[f"{metric}_moe"] * crosswalk_acs[weight_column]
        ) ** 2

    precinct_acs = pd.DataFrame({"precinct_id": results["id"]})
    grouped = crosswalk_acs.groupby("precinct_id", as_index=True)
    for metric in metric_bases:
        estimate = grouped[f"{metric}_weighted_est"].sum(min_count=1)
        moe = grouped[f"{metric}_weighted_moe_sq"].sum(min_count=1).map(math.sqrt)
        precinct_acs = precinct_acs.merge(
            pd.DataFrame(
                {
                    "precinct_id": estimate.index,
                    f"{metric}_est": estimate.values,
                    f"{metric}_moe": moe.values,
                }
            ),
            on="precinct_id",
            how="left",
            validate="one_to_one",
        )

    direct = (
        district_blocks.groupby("precinct_id", as_index=False)
        .agg(
            census_block_count=("block_geoid", "count"),
            population_2020=("population_2020", "sum"),
            housing_units_2020=("housing_units_2020", "sum"),
            boundary_review_block_count=("boundary_review_flag", "sum"),
            minimum_block_overlap_pct=("overlap_pct_of_block", "min"),
        )
    )
    massgis_population = district[["precinct_id", "target_key"]].copy()
    massgis_population["massgis_population_2020"] = massgis_population[
        "target_key"
    ].map(target_attributes["POP_2020"])
    massgis_population = massgis_population.drop(columns="target_key")
    massgis_population["massgis_population_2020"] = pd.to_numeric(
        massgis_population["massgis_population_2020"], errors="coerce"
    )

    demographics = results[["id", "municipality", "ward", "precinct"]].rename(
        columns={"id": "precinct_id"}
    )
    demographics = demographics.merge(direct, on="precinct_id", how="left")
    demographics = demographics.merge(
        massgis_population, on="precinct_id", how="left", validate="one_to_one"
    )
    demographics["population_difference_vs_massgis"] = (
        demographics["population_2020"] - demographics["massgis_population_2020"]
    )
    demographics = demographics.merge(
        precinct_acs, on="precinct_id", how="left", validate="one_to_one"
    )
    demographics["contributing_block_group_count"] = demographics["precinct_id"].map(
        grouped["block_group_geoid"].nunique()
    )

    pct_specs = {
        "acs_voting_age_18_plus_pct": (
            "acs_voting_age_18_plus_est",
            "acs_population_est",
        ),
        "acs_age_18_34_pct": ("acs_age_18_34_est", "acs_population_est"),
        "acs_age_65_plus_pct": ("acs_age_65_plus_est", "acs_population_est"),
        "acs_hispanic_pct": ("acs_hispanic_est", "acs_population_est"),
        "acs_nonhispanic_white_pct": (
            "acs_nonhispanic_white_est",
            "acs_population_est",
        ),
        "acs_nonhispanic_black_pct": (
            "acs_nonhispanic_black_est",
            "acs_population_est",
        ),
        "acs_nonhispanic_asian_pct": (
            "acs_nonhispanic_asian_est",
            "acs_population_est",
        ),
        "acs_bachelors_plus_pct": (
            "acs_bachelors_plus_est",
            "acs_education_age_25_plus_est",
        ),
        "acs_renter_households_pct": (
            "acs_renter_households_est",
            "acs_occupied_households_est",
        ),
        "acs_households_income_below_50k_pct": (
            "acs_households_income_below_50k_est",
            "acs_income_households_est",
        ),
    }
    for output, (numerator, denominator) in pct_specs.items():
        demographics[output] = demographics.apply(
            lambda row: percent(row[numerator], row[denominator]), axis=1
        )

    block_output_columns = [
        "block_geoid",
        "block_group_geoid",
        "precinct_id",
        "municipality",
        "ward",
        "precinct",
        "precinct_name",
        "population_2020",
        "housing_units_2020",
        "land_area_sq_m_2020",
        "water_area_sq_m_2020",
        "internal_lon",
        "internal_lat",
        "assignment_method",
        "overlap_area_sq_m",
        "block_geometry_area_sq_m",
        "overlap_pct_of_block",
        "boundary_review_flag",
    ]
    block_output = district_blocks.reset_index(drop=True)[block_output_columns].copy()
    for column in (
        "overlap_area_sq_m",
        "block_geometry_area_sq_m",
        "overlap_pct_of_block",
    ):
        block_output[column] = block_output[column].round(3)
    block_output = block_output.sort_values(["precinct_id", "block_geoid"])

    crosswalk_output = crosswalk.copy()
    for column in (
        "person_weight",
        "household_weight",
        "district_person_weight_share",
        "district_household_weight_share",
    ):
        crosswalk_output[column] = crosswalk_output[column].round(8)
    crosswalk_output = crosswalk_output.sort_values(
        ["precinct_id", "block_group_geoid"]
    )

    for column in demographics.columns:
        if column.endswith("_est") or column.endswith("_moe"):
            demographics[column] = pd.to_numeric(demographics[column], errors="coerce").round(1)
        elif column.endswith("_pct"):
            demographics[column] = pd.to_numeric(demographics[column], errors="coerce").round(1)
    demographics["minimum_block_overlap_pct"] = demographics[
        "minimum_block_overlap_pct"
    ].round(3)

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    qa = {
        "datasetVersion": "1.0",
        "generatedAtUtc": generated_at,
        "expectedDistrictPrecincts": int(len(results)),
        "outputDistrictPrecincts": int(demographics["precinct_id"].nunique()),
        "candidateBlocksInBoundingBox": int(len(blocks_projected)),
        "candidateBlocksUnassignedOutsideContext": int((~assigned_mask).sum()),
        "candidateBlocksAssignedOutsideDistrict": int(
            assigned_mask.sum() - len(district_blocks)
        ),
        "assignedDistrictBlocks": int(len(district_blocks)),
        "districtBlocksUsingLargestOverlap": int(
            (district_blocks["assignment_method"] == "largest_overlap").sum()
        ),
        "districtBlocksFlaggedForBoundaryReview": int(
            district_blocks["boundary_review_flag"].sum()
        ),
        "populatedDistrictBlocksFlaggedForBoundaryReview": int(
            (
                district_blocks["boundary_review_flag"]
                & (district_blocks["population_2020"] > 0)
            ).sum()
        ),
        "populationInFlaggedBoundaryBlocks": int(
            district_blocks.loc[
                district_blocks["boundary_review_flag"], "population_2020"
            ].sum()
        ),
        "minimumOverlapPctAmongDistrictBlocks": round(
            float(district_blocks["overlap_pct_of_block"].min()), 3
        ),
        "minimumOverlapPctAmongPopulatedDistrictBlocks": round(
            float(
                district_blocks.loc[
                    district_blocks["population_2020"] > 0, "overlap_pct_of_block"
                ].min()
            ),
            3,
        ),
        "districtPopulation2020FromBlocks": int(direct["population_2020"].sum()),
        "districtPopulation2020MassGISCheck": int(
            massgis_population["massgis_population_2020"].sum()
        ),
        "populationDifferenceVsMassGIS": int(
            direct["population_2020"].sum()
            - massgis_population["massgis_population_2020"].sum()
        ),
        "precinctsWithExactMassGISPopulationMatch": int(
            (demographics["population_difference_vs_massgis"] == 0).sum()
        ),
        "distinctContributingBlockGroups": int(
            crosswalk["block_group_geoid"].nunique()
        ),
        "acsRelease": release,
        "checks": {
            "allPrecinctsPresent": bool(
                demographics["precinct_id"].nunique() == len(results)
            ),
            "allCrosswalkWeightsAtMostOneWithinTolerance": bool(
                (crosswalk["district_person_weight_share"] <= 1.000001).all()
                and (crosswalk["district_household_weight_share"] <= 1.000001).all()
            ),
            "allAcsBlockGroupsFound": not missing_acs,
            "directPopulationMatchesMassGIS": bool(
                (demographics["population_difference_vs_massgis"] == 0).all()
            ),
        },
    }

    block_output.to_csv(
        args.output_dir / "census_block_to_precinct.csv", index=False, na_rep=""
    )
    crosswalk_output.to_csv(
        args.output_dir / "census_block_group_precinct_crosswalk.csv",
        index=False,
        na_rep="",
    )
    demographics.to_csv(
        args.output_dir / "precinct_demographics.csv", index=False, na_rep=""
    )
    (args.output_dir / "census_crosswalk_qa.json").write_text(
        json.dumps(qa, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (args.output_dir / "census_data_dictionary.json").write_text(
        json.dumps(make_data_dictionary(generated_at, release), indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )

    print(json.dumps(qa, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # Keep one-line maintenance failures easy to spot.
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
