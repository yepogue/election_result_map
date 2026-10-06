"""Independent QR-based verification; does not use the production fitter or write files."""
import hashlib
import json
from pathlib import Path
from statistics import median, mean, stdev

import numpy as np
import pandas as pd
from scipy.stats import t

DATA = Path(__file__).resolve().parents[1] / "public" / "data"
analysis = json.loads((DATA / "renter_analysis.json").read_text(encoding="utf-8"))
votes = pd.read_csv(DATA / "results.csv")
dem = pd.read_csv(DATA / "precinct_demographics.csv")
frame = votes.merge(dem[["precinct_id", "acs_renter_households_pct", "acs_renter_households_est", "acs_occupied_households_est"]], left_on="id", right_on="precinct_id", validate="one_to_one")
assert len(frame) == len(analysis["observations"]) == 59
assert frame.id.nunique() == 59
for filename, expected in analysis["sourceHashes"].items():
    assert hashlib.sha256((DATA / filename).read_bytes()).hexdigest() == expected
exported = pd.read_csv(DATA / "renter_precincts.csv").set_index("id")
exported_summaries = pd.read_csv(DATA / "renter_municipality_summary.csv").set_index("municipality")
for row in frame.itertuples():
    out = exported.loc[row.id]
    assert out.renterSharePct == row.acs_renter_households_pct
    assert np.isclose(out.brownsbergerSharePct, 100 * row.brownsberger_votes / (row.brownsberger_votes + row.lander_votes))
    assert out.twoCandidateVotes == row.brownsberger_votes + row.lander_votes
    assert out.registered_voters == row.registered_voters
    assert out.ballots_cast_total == row.ballots_cast_total
    assert np.isclose(out.turnoutPct, 100 * row.ballots_cast_total / row.registered_voters)

checked = 0
def check_model(rows, expected):
    global checked
    renters = rows.acs_renter_households_pct.to_numpy() / 10
    n = len(rows)
    design = np.column_stack([np.ones(n), renters])
    if expected["adjusted"]:
        # Different reference city and ordering from the production implementation.
        indicators = pd.get_dummies(rows.municipality, drop_first=True, dtype=float).to_numpy()
        design = np.column_stack([design, indicators])
    total = (rows.brownsberger_votes + rows.lander_votes).to_numpy()
    y = 100 * rows.brownsberger_votes.to_numpy() / total
    w = total if expected["weighted"] else np.ones(n)
    A, b = design * np.sqrt(w[:, None]), y * np.sqrt(w)
    Q, R = np.linalg.qr(A, mode="reduced")
    inverse_R = np.linalg.inv(R)
    beta = np.linalg.solve(R, Q.T @ b)
    h = (Q ** 2).sum(axis=1)
    residual = b - A @ beta
    middle = Q.T @ np.diag((residual / (1 - h)) ** 2) @ Q
    covariance = inverse_R @ middle @ inverse_R.T
    se = np.sqrt(covariance[1, 1])
    critical = t.ppf(.975, n - A.shape[1])
    assert expected["n"] == n and expected["df"] == n - A.shape[1]
    assert np.isclose(beta[1], expected["differencePp"], atol=1e-10)
    assert np.isclose(se, expected["standardErrorPp"], atol=1e-10)
    assert np.allclose([beta[1] - critical * se, beta[1] + critical * se], [expected["ciLowPp"], expected["ciHighPp"]], atol=1e-10)
    assert np.isclose(2 * t.sf(abs(beta[1] / se), n - A.shape[1]), expected["pValue"], atol=1e-12)
    if expected["adjusted"]:
        sums = pd.DataFrame({"x": renters, "y": y, "w": w, "city": rows.municipality.to_numpy()})
        sums["xw"], sums["yw"] = sums.x * sums.w, sums.y * sums.w
        group_totals = sums.groupby("city")[["w", "xw", "yw"]].transform("sum")
        dx, dy = renters - group_totals.xw / group_totals.w, y - group_totals.yw / group_totals.w
        centered = np.sum(w * dx * dy) / np.sum(w * dx ** 2)
        assert np.isclose(centered, beta[1], atol=1e-10)
    checked += 1

for model_set in [analysis["models"], analysis["voteWeighted"]]:
    for model in model_set.values():
        check_model(frame, model)
for city in analysis["cityChecks"]:
    check_model(frame[frame.municipality == city["municipality"]], city["withinCity"])
    check_model(frame[frame.municipality != city["municipality"]], city["leaveCityOut"])
for model in analysis["leaveOnePrecinctOut"]["runs"]:
    check_model(frame[frame.id != model["omitted"]], model)
assert checked == 71

for summary in analysis["municipalities"] + [analysis["district"]]:
    rows = frame if summary["municipality"] == "All district precincts" else frame[frame.municipality == summary["municipality"]]
    values = sorted(rows.acs_renter_households_pct)
    assert summary["n"] == len(values)
    for field, reference in [("min", min(values)), ("max", max(values)), ("mean", mean(values)), ("median", median(values)), ("sd", stdev(values))]:
        assert np.isclose(summary[field], reference, atol=1e-10)
    for key, fraction in [("q25", .25), ("q75", .75)]:
        position = (len(values) - 1) * fraction
        index = int(position)
        interpolation = values[index] + (values[min(index + 1, len(values) - 1)] - values[index]) * (position - index)
        assert np.isclose(summary[key], interpolation, atol=1e-10)
    pooled = 100 * rows.acs_renter_households_est.sum() / rows.acs_occupied_households_est.sum()
    assert np.isclose(summary["householdWeightedShare"], pooled, atol=1e-10)
    totals = {
        "brownsbergerVotes": sum(int(v) for v in rows.brownsberger_votes),
        "landerVotes": sum(int(v) for v in rows.lander_votes),
        "registeredVoters": sum(int(v) for v in rows.registered_voters),
        "ballotsCastTotal": sum(int(v) for v in rows.ballots_cast_total),
    }
    totals["twoCandidateVotes"] = totals["brownsbergerVotes"] + totals["landerVotes"]
    totals["brownsbergerSharePct"] = 100 * totals["brownsbergerVotes"] / totals["twoCandidateVotes"]
    totals["turnoutPct"] = 100 * totals["ballotsCastTotal"] / totals["registeredVoters"]
    for key, reference in totals.items():
        assert np.isclose(summary[key], reference, rtol=0, atol=1e-8), (summary["municipality"], key)
        assert np.isclose(exported_summaries.loc[summary["municipality"], key], reference, rtol=0, atol=1e-8)

for field in ["brownsbergerVotes", "landerVotes", "twoCandidateVotes", "registeredVoters", "ballotsCastTotal"]:
    assert sum(city[field] for city in analysis["municipalities"]) == analysis["district"][field]

means = frame.groupby("municipality").agg(x=("acs_renter_households_pct", "mean"))
frame["vote_share"] = 100 * frame.brownsberger_votes / (frame.brownsberger_votes + frame.lander_votes)
means["y"] = frame.groupby("municipality").vote_share.mean()
for row in analysis["observations"]:
    assert np.isclose(row["renterDeviationPp"], row["renterSharePct"] - means.loc[row["municipality"], "x"])
    assert np.isclose(row["voteDeviationPp"], row["brownsbergerSharePct"] - means.loc[row["municipality"], "y"])
    source = frame.loc[frame.id == row["id"]].iloc[0]
    assert row["registered_voters"] == source.registered_voters
    assert row["ballots_cast_total"] == source.ballots_cast_total
    assert np.isclose(row["turnoutPct"], 100 * source.ballots_cast_total / source.registered_voters)
assert (exported.groupby("municipality")[["renterDeviationPp", "voteDeviationPp"]].sum().abs() < 1e-6).all().all()
print(f"PASS: {checked} fits and HC3/t intervals independently reproduced; all 59 input rows, 5 descriptive summaries including vote/turnout totals and CSV exports, source fingerprints, and centered chart coordinates checked.")
