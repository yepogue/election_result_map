"""Rebuild the renter-share comparison from the existing, frozen source snapshot.

Requires numpy, pandas and scipy. No downloads, bootstrapping or source edits.
Run: python scripts/build_renter_analysis.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import t

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
CITIES = ["Boston", "Cambridge", "Watertown", "Belmont"]


def fit(frame: pd.DataFrame, adjusted: bool, weighted: bool = False) -> dict:
    x = frame.renterSharePct.to_numpy(dtype=float) / 10
    y = frame.brownsbergerSharePct.to_numpy(dtype=float)
    columns = [np.ones(len(frame)), x]
    cities = [city for city in CITIES if city in set(frame.municipality)]
    if adjusted:
        columns += [(frame.municipality == city).to_numpy(dtype=float) for city in cities[1:]]
    design = np.column_stack(columns)
    weights = frame.twoCandidateVotes.to_numpy(dtype=float) if weighted else np.ones(len(frame))
    wx = design * np.sqrt(weights[:, None])
    wy = y * np.sqrt(weights)
    beta, _, rank, _ = np.linalg.lstsq(wx, wy, rcond=None)
    assert rank == design.shape[1]
    bread = np.linalg.inv(wx.T @ wx)
    leverage = np.einsum("ij,jk,ik->i", wx, bread, wx)
    assert np.all(leverage < 1 - 1e-8)
    residual = wy - wx @ beta
    scores = wx * (residual / (1 - leverage))[:, None]
    covariance = bread @ (scores.T @ scores) @ bread
    se = float(np.sqrt(covariance[1, 1]))
    df = len(frame) - int(rank)
    critical = float(t.ppf(.975, df))
    estimate = float(beta[1])
    y_mean = np.average(y, weights=weights)
    sst = np.sum(weights * (y - y_mean) ** 2)
    return {
        "adjusted": adjusted, "weighted": weighted, "n": len(frame), "df": df,
        "differencePp": estimate, "standardErrorPp": se,
        "ciLowPp": estimate - critical * se, "ciHighPp": estimate + critical * se,
        "pValue": float(2 * t.sf(abs(estimate / se), df)),
        "intercept": float(beta[0]), "rSquared": float(1 - np.sum(residual ** 2) / sst),
        "maximumLeverage": float(leverage.max()),
    }


def describe(frame: pd.DataFrame, label: str) -> dict:
    x = frame.renterSharePct
    brownsberger_votes = int(frame.brownsberger_votes.sum())
    lander_votes = int(frame.lander_votes.sum())
    candidate_votes = brownsberger_votes + lander_votes
    registered_voters = int(frame.registered_voters.sum())
    ballots_cast = int(frame.ballots_cast_total.sum())
    return {
        "municipality": label, "n": len(frame),
        "min": float(x.min()), "q25": float(x.quantile(.25)),
        "median": float(x.median()), "mean": float(x.mean()),
        "q75": float(x.quantile(.75)), "max": float(x.max()),
        "sd": float(x.std(ddof=1)),
        "householdWeightedShare": float(100 * frame.renterHouseholdsEst.sum() / frame.occupiedHouseholdsEst.sum()),
        "brownsbergerVotes": brownsberger_votes, "landerVotes": lander_votes,
        "twoCandidateVotes": candidate_votes,
        "brownsbergerSharePct": 100 * brownsberger_votes / candidate_votes,
        "registeredVoters": registered_voters, "ballotsCastTotal": ballots_cast,
        "turnoutPct": 100 * ballots_cast / registered_voters,
    }


def build() -> None:
    results = pd.read_csv(DATA / "results.csv", dtype={"ward": str, "precinct": str}).fillna({"ward": ""})
    context = pd.read_csv(DATA / "precinct_demographics.csv")
    assert len(results) == results.id.nunique() == 59
    assert len(context) == context.precinct_id.nunique() == 59
    assert set(results.id) == set(context.precinct_id)
    joined = results.merge(context, left_on="id", right_on="precinct_id", validate="one_to_one", suffixes=("", "_context"))
    assert (joined.municipality == joined.municipality_context).all()
    joined["twoCandidateVotes"] = joined.brownsberger_votes + joined.lander_votes
    joined["brownsbergerSharePct"] = 100 * joined.brownsberger_votes / joined.twoCandidateVotes
    # Match the public context snapshot's one-decimal precinct percentages.
    joined["renterSharePct"] = joined.acs_renter_households_pct
    joined["renterHouseholdsEst"] = joined.acs_renter_households_est
    joined["occupiedHouseholdsEst"] = joined.acs_occupied_households_est
    assert joined[["renterSharePct", "brownsbergerSharePct"]].notna().all().all()
    assert joined.renterSharePct.between(0, 100).all() and (joined.twoCandidateVotes > 0).all()
    assert joined.occupiedHouseholdsEst.gt(0).all()
    assert joined[["registered_voters", "ballots_cast_total"]].notna().all().all()
    assert joined.registered_voters.gt(0).all()
    assert joined.ballots_cast_total.between(0, joined.registered_voters).all()
    assert (joined.twoCandidateVotes <= joined.ballots_cast_total).all()
    joined["turnoutPct"] = 100 * joined.ballots_cast_total / joined.registered_voters
    assert np.allclose(joined.renterSharePct, 100 * joined.renterHouseholdsEst / joined.occupiedHouseholdsEst, atol=.06)
    metadata = json.loads((DATA / "election.json").read_text(encoding="utf-8"))
    assert int(joined.brownsberger_votes.sum()) == metadata["brownsberger_votes"] == 12293
    assert int(joined.lander_votes.sum()) == metadata["lander_votes"] == 12258
    joined["label"] = joined.apply(lambda row: f'{row.municipality} · ' + (f'Ward {row.ward}, ' if row.ward not in ["", "0"] else "") + f'Precinct {row.precinct}', axis=1)
    joined["renterDeviationPp"] = joined.renterSharePct - joined.groupby("municipality").renterSharePct.transform("mean")
    joined["voteDeviationPp"] = joined.brownsbergerSharePct - joined.groupby("municipality").brownsbergerSharePct.transform("mean")
    primary = {"unadjusted": fit(joined, False), "adjusted": fit(joined, True)}
    vote_weighted = {"unadjusted": fit(joined, False, True), "adjusted": fit(joined, True, True)}
    loo = [{"omitted": row.id, **fit(joined[joined.id != row.id], True)} for row in joined.itertuples()]
    city_checks = []
    within_ss = float(np.sum(joined.renterDeviationPp ** 2))
    for city in CITIES:
        rows = joined[joined.municipality == city]
        city_checks.append({
            "municipality": city, "n": len(rows),
            "withinCity": fit(rows, False),
            "leaveCityOut": fit(joined[joined.municipality != city], True),
            "withinVariationSharePct": float(100 * np.sum(rows.renterDeviationPp ** 2) / within_ss),
        })
    centered_slope = float(np.dot(joined.renterDeviationPp, joined.voteDeviationPp) / within_ss * 10)
    assert np.isclose(centered_slope, primary["adjusted"]["differencePp"], atol=1e-10)
    source_files = ["results.csv", "precinct_demographics.csv", "census_data_dictionary.json"]
    columns = ["id", "label", "municipality", "ward", "precinct", "renterSharePct", "renterHouseholdsEst", "occupiedHouseholdsEst", "brownsberger_votes", "lander_votes", "twoCandidateVotes", "brownsbergerSharePct", "renterDeviationPp", "voteDeviationPp", "registered_voters", "ballots_cast_total", "turnoutPct"]
    observations = joined[columns].to_dict(orient="records")
    descriptive = [describe(joined[joined.municipality == city], city) for city in CITIES]
    output = {
        "analysisDate": "2026-10-05", "n": len(joined), "incrementPp": 10,
        "coverage": "Only the 59 Suffolk & Middlesex Senate district precincts; Boston and Cambridge are not citywide summaries.",
        "renterDefinition": "Renter-occupied households as a share of occupied households; 2020–2024 ACS block-group estimates allocated to precincts using 2020 housing-unit weights.",
        "outcomeDefinition": "Brownsberger votes / (Brownsberger + Lander votes), certified post-recount September 1, 2026 primary.",
        "turnoutDefinition": "All parties' primary ballots cast / all registered voters, for included district precincts. Not Democratic-only or Senate-race turnout. Municipality rates are ratios of summed counts, not averages of precinct rates.",
        "method": "OLS, equal precinct weight; a common renter slope with separate municipality intercepts in the adjusted model. HC3 standard errors with t(n−p) 95% intervals. Sensitivity WLS uses two-candidate vote totals as relative weights, not independent individual observations. No bootstrap.",
        "sourceHashes": {name: hashlib.sha256((DATA / name).read_bytes()).hexdigest() for name in source_files},
        "models": primary, "voteWeighted": vote_weighted,
        "municipalities": descriptive, "district": describe(joined, "All district precincts"),
        "cityChecks": city_checks,
        "leaveOnePrecinctOut": {
            "min": min(item["differencePp"] for item in loo),
            "max": max(item["differencePp"] for item in loo),
            "allNegative": all(item["differencePp"] < 0 for item in loo),
            "largestShift": max(loo, key=lambda item: abs(item["differencePp"] - primary["adjusted"]["differencePp"])),
            "runs": loo,
        },
        "magnitudeReductionPct": 100 * (1 - abs(primary["adjusted"]["differencePp"] / primary["unadjusted"]["differencePp"])),
        "observations": observations,
    }
    (DATA / "renter_analysis.json").write_text(json.dumps(output, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    joined[columns].to_csv(DATA / "renter_precincts.csv", index=False, float_format="%.8f")
    pd.DataFrame(descriptive + [output["district"]]).to_csv(DATA / "renter_municipality_summary.csv", index=False, float_format="%.8f")
    print(json.dumps({key: output[key] for key in ["models", "voteWeighted", "municipalities", "cityChecks", "magnitudeReductionPct"]}, indent=2))


if __name__ == "__main__":
    build()
