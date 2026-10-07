"""Pool the three Senate challengers' Boston precincts against renter share.

Uses the existing frozen election export and cached Census/MassGIS sources.
Requires the existing Census requirements plus requirements-renter-analysis.txt.
No bootstrap. No changes to the original 59-precinct analysis or its sources.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import geopandas as gpd
import maup
import numpy as np
import pandas as pd
from scipy.stats import t

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
CACHE = ROOT / "data" / "cache"
RACES = ["first-suffolk", "suffolk-middlesex", "norfolk-suffolk"]


def fit(frame: pd.DataFrame, adjusted: bool = False) -> dict:
    x = frame.renterSharePct.to_numpy() / 10
    y = frame.challengerSharePct.to_numpy()
    columns = [np.ones(len(frame)), x]
    if adjusted:
        columns += [(frame.race_id == race).to_numpy(dtype=float) for race in RACES[1:]]
    design = np.column_stack(columns)
    beta, _, rank, _ = np.linalg.lstsq(design, y, rcond=None)
    assert rank == design.shape[1]
    bread = np.linalg.inv(design.T @ design)
    h = np.einsum("ij,jk,ik->i", design, bread, design)
    residuals = y - design @ beta
    scores = design * (residuals / (1 - h))[:, None]
    covariance = bread @ scores.T @ scores @ bread
    se = float(np.sqrt(covariance[1, 1]))
    critical = float(t.ppf(.975, len(frame) - rank))
    return {
        "n": len(frame), "raceAdjusted": adjusted, "intercept": float(beta[0]),
        "differencePp": float(beta[1]), "standardErrorPp": se,
        "ciLowPp": float(beta[1] - critical * se), "ciHighPp": float(beta[1] + critical * se),
        "rSquared": float(1 - np.sum(residuals ** 2) / np.sum((y - y.mean()) ** 2)),
    }


def build() -> None:
    source_paths = {
        "elections": DATA / "wu_precinct_analysis.csv",
        "precincts": CACHE / "wu-analysis" / "boston-precincts-2022.geojson",
        "blocks": CACHE / "wu-analysis" / "suffolk-county-2020-blocks.geojson",
        "acs": CACHE / "census" / "acs2024_5yr_block_groups_25025_B25003.json",
    }
    for path in source_paths.values():
        if not path.exists():
            raise RuntimeError(f"Missing cached source {path.name}; rebuild the Wu and Census source caches first.")
    votes = pd.read_csv(source_paths["elections"], dtype={"ward": str, "precinct": str})
    assert len(votes) == votes.precinct_id.nunique() == 156
    assert votes.groupby("race_id").size().to_dict() == {"first-suffolk": 82, "norfolk-suffolk": 39, "suffolk-middlesex": 35}
    assert (votes.two_candidate_votes == votes.challenger_votes + votes.incumbent_votes).all()
    assert (votes.two_candidate_votes > 0).all()
    precincts = gpd.read_file(source_paths["precincts"]).to_crs("EPSG:26986")
    precincts.geometry = precincts.geometry.make_valid()
    precincts["precinct_id"] = precincts.apply(lambda row: f"BOS-{int(row.WARD):02d}-{str(row.PRECINCT).removesuffix('.0')}", axis=1)
    assert len(precincts) == precincts.precinct_id.nunique() == 275
    assert set(votes.precinct_id) <= set(precincts.precinct_id)
    precincts = precincts.set_index("precinct_id")
    blocks = gpd.read_file(source_paths["blocks"]).to_crs("EPSG:26986")
    blocks.geometry = blocks.geometry.make_valid()
    assert len(blocks) == blocks.GEOID.nunique() == 7280
    for column in ["HU100", "POP100", "AREALAND"]:
        blocks[column] = pd.to_numeric(blocks[column], errors="raise")
        assert blocks[column].ge(0).all()
    blocks["block_group_geoid"] = blocks.GEOID.str[:12]
    # Whole-county block groups supply denominators, including blocks outside
    # the three races. Never renormalize the weights to selected precincts.
    denominators = blocks.groupby("block_group_geoid")[["HU100", "POP100", "AREALAND"]].sum().add_prefix("bg_")
    blocks["precinct_id"] = maup.assign(blocks.geometry, precincts.geometry)
    selected = blocks[blocks.precinct_id.isin(votes.precinct_id)].copy()
    assigned_shapes = precincts.geometry.reindex(selected.precinct_id.to_numpy())
    assigned_shapes.index = selected.index
    selected["overlapPct"] = 100 * selected.geometry.intersection(assigned_shapes).area / selected.geometry.area
    assert selected.overlapPct.notna().all()
    crosswalk = selected.groupby(["precinct_id", "block_group_geoid"]).agg(
        housing_units_2020=("HU100", "sum"), population_2020=("POP100", "sum"),
        land_area_2020=("AREALAND", "sum"), block_count=("GEOID", "size"),
        minimum_overlap_pct=("overlapPct", "min"),
    ).join(denominators, on="block_group_geoid").reset_index()
    crosswalk["household_weight"] = np.where(crosswalk.bg_HU100 > 0,
        crosswalk.housing_units_2020 / crosswalk.bg_HU100,
        np.where(crosswalk.bg_POP100 > 0, crosswalk.population_2020 / crosswalk.bg_POP100,
                 crosswalk.land_area_2020 / crosswalk.bg_AREALAND.replace(0, np.nan)))
    crosswalk["weight_basis"] = np.where(crosswalk.bg_HU100 > 0, "housing units", np.where(crosswalk.bg_POP100 > 0, "population fallback", "land area fallback"))
    empty_bg = (crosswalk.bg_HU100 == 0) & (crosswalk.bg_POP100 == 0) & (crosswalk.bg_AREALAND == 0)
    crosswalk.loc[empty_bg, "household_weight"] = 0.0
    crosswalk.loc[empty_bg, "weight_basis"] = "empty water-only block group"
    assert crosswalk.household_weight.notna().all()
    assert crosswalk.household_weight.between(0, 1 + 1e-8).all()
    assert crosswalk.groupby("block_group_geoid").household_weight.sum().le(1 + 1e-8).all()
    acs = json.loads(source_paths["acs"].read_text(encoding="utf-8"))
    for label, cell in [("occupied", "B25003001"), ("renter", "B25003003")]:
        values = {key.split("US")[-1]: record["B25003"]["estimate"][cell] for key, record in acs["data"].items()}
        crosswalk[f"acs_{label}_bg"] = crosswalk.block_group_geoid.map(values)
        assert crosswalk[f"acs_{label}_bg"].notna().all() and crosswalk[f"acs_{label}_bg"].ge(0).all()
        assert crosswalk.loc[empty_bg, f"acs_{label}_bg"].eq(0).all()
        crosswalk[f"allocated_{label}"] = crosswalk[f"acs_{label}_bg"] * crosswalk.household_weight
    allocated = crosswalk.groupby("precinct_id")[["allocated_occupied", "allocated_renter"]].sum()
    rows = votes.merge(allocated, on="precinct_id", validate="one_to_one")
    assert len(rows) == 156 and rows.allocated_occupied.gt(0).all()
    rows["renterSharePct"] = (100 * rows.allocated_renter / rows.allocated_occupied).round(1)
    rows["challengerSharePct"] = 100 * rows.challenger_votes / rows.two_candidate_votes
    assert rows.renterSharePct.between(0, 100).all()
    assert np.allclose(rows.challengerSharePct, rows.challenger_share_pct, atol=.000051)
    rows["label"] = rows.apply(lambda row: f"Boston · Ward {row.ward}, Precinct {row.precinct}", axis=1)
    rows["renterDeviationPp"] = rows.renterSharePct - rows.groupby("race_id").renterSharePct.transform("mean")
    rows["challengerDeviationPp"] = rows.challengerSharePct - rows.groupby("race_id").challengerSharePct.transform("mean")
    existing = pd.read_csv(DATA / "precinct_demographics.csv", dtype={"precinct": str})
    existing = existing[existing.municipality == "Boston"].copy()
    existing["precinct_id"] = existing.apply(lambda row: f"BOS-{int(row.ward):02d}-{row.precinct}", axis=1)
    match = rows.merge(existing, on="precinct_id", validate="one_to_one")
    assert len(match) == 35
    assert np.allclose(match.renterSharePct, match.acs_renter_households_pct, atol=1e-9), "Renter mapping disagrees with existing Boston snapshot"
    assert np.allclose(match.allocated_occupied.round(1), match.acs_occupied_households_est, atol=1e-8)
    assert np.allclose(match.allocated_renter.round(1), match.acs_renter_households_est, atol=1e-8)
    race_summaries = []
    for race in RACES:
        group = rows[rows.race_id == race]
        race_summaries.append({
            "id": race, "challenger": group.iloc[0].challenger, "incumbent": group.iloc[0].incumbent,
            "n": len(group), "challengerVotes": int(group.challenger_votes.sum()),
            "incumbentVotes": int(group.incumbent_votes.sum()), "twoCandidateVotes": int(group.two_candidate_votes.sum()),
            "renterMeanPct": float(group.renterSharePct.mean()), "renterMinPct": float(group.renterSharePct.min()),
            "renterMaxPct": float(group.renterSharePct.max()), "model": fit(group),
        })
    model, adjusted = fit(rows), fit(rows, True)
    centered = 10 * np.dot(rows.renterDeviationPp, rows.challengerDeviationPp) / np.dot(rows.renterDeviationPp, rows.renterDeviationPp)
    assert np.isclose(centered, adjusted["differencePp"], atol=1e-10)
    columns = ["precinct_id", "label", "ward", "precinct", "race_id", "district", "challenger", "incumbent", "renterSharePct", "allocated_renter", "allocated_occupied", "challenger_votes", "incumbent_votes", "extra_candidate_votes", "two_candidate_votes", "challengerSharePct", "renterDeviationPp", "challengerDeviationPp"]
    election_sources = json.loads((DATA / "wu_analysis_sources.json").read_text(encoding="utf-8"))
    output = {
        "analysisDate": "2026-10-06", "n": len(rows), "bostonPrecinctCount": 275, "incrementPp": 10,
        "scope": "All 156 Boston precincts with votes in the three selected 2026 Senate races; not all of Boston. Includes precincts won by either candidate.",
        "shareDefinition": "Gayle/(Gayle+Collins), Lander/(Lander+Brownsberger), or Yu/(Yu+Rush), multiplied by 100. Skeens, other candidates, and blanks are excluded.",
        "renterDefinition": "Renter-occupied / all occupied households, ACS 2020–2024 B25003; housing-unit-weighted block-group allocation to 2022 precincts, rounded to one decimal. Not voter tenure.",
        "method": "Equal-precinct OLS, challenger share against renter share per 10 percentage points. Pooled line treats the three challengers as one role. Race-adjusted check uses separate race intercepts and a common slope. HC3/t(n-p) intervals are descriptive and omit ACS, allocation, and spatial uncertainty. No bootstrap.",
        "weightingNote": "Each precinct counts equally, not each race or voter. The 82 Gayle, 35 Lander, and 39 Yu precincts all enter once.",
        "model": model, "raceAdjustedModel": adjusted, "races": race_summaries,
        "sources": [source for source in election_sources if source["id"].startswith("race_") or source["id"] in ["precincts_2022", "census_blocks"]] + [{
            "id": "acs_renter", "title": "2020–2024 ACS B25003 household tenure", "url": "https://www.census.gov/data/developers/data-sets/acs-5year/2024.html",
            "downloadUrl": "https://api.censusreporter.org/1.0/data/show/acs2024_5yr?table_ids=B25003&geo_ids=150%7C05000US25025",
        }],
        "sourceHashes": {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in source_paths.items()},
        "qa": {"uniquePrecincts": len(rows), "existingBostonPrecinctsMatched": len(match), "assignedBlocks": len(selected),
            "boundaryReviewBlocks": int(selected.overlapPct.lt(95).sum()), "boundaryReviewHousingUnits": int(selected.loc[selected.overlapPct.lt(95), "HU100"].sum()),
            "crosswalkRows": len(crosswalk), "noMissingRenterEstimates": True, "noDoubleCountedPrecincts": True,
            "maximumBlockGroupWeightSum": float(crosswalk.groupby("block_group_geoid").household_weight.sum().max())},
        "observations": rows[columns].to_dict(orient="records"),
    }
    (DATA / "challenger_renter_analysis.json").write_text(json.dumps(output, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    rows[columns].to_csv(DATA / "challenger_renter_precincts.csv", index=False, float_format="%.8f")
    crosswalk.to_csv(DATA / "challenger_renter_crosswalk.csv", index=False, float_format="%.10f")
    print(json.dumps({key: output[key] for key in ["model", "raceAdjustedModel", "races", "qa"]}, indent=2))


if __name__ == "__main__":
    build()
