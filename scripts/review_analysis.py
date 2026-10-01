"""Read-only independent checks of the published data and displayed estimates.

Run: python scripts/review_analysis.py (requires numpy and pandas).
Does not call the production model fitter or change data files.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "public" / "data"
results = pd.read_csv(DATA / "results.csv")
meta = json.loads((DATA / "election.json").read_text(encoding="utf-8"))
assert len(results) == results.id.nunique() == 59
for candidate in ("brownsberger", "lander"):
    assert results[f"{candidate}_votes"].sum() == meta[f"{candidate}_votes"]
assert meta["brownsberger_votes"] - meta["lander_votes"] == meta["margin"]
assert (results.ballots_cast_dem == results[["brownsberger_votes", "lander_votes", "other_votes", "blank_votes"]].sum(axis=1)).all()
assert (results.ballots_cast_dem <= results.ballots_cast_total).all()
assert (results.ballots_cast_total <= results.registered_voters).all()

wu = pd.read_json(DATA / "wu_precinct_analysis.json")
summaries = json.loads((DATA / "wu_precinct_summary.json").read_text())
assert len(wu) == wu.precinct_id.nunique() == 156
def normalized_key(value):
    city, ward, precinct = value.split("-")
    return f"{city}-{int(ward)}-{precinct.lstrip('0') or '0'}"

joined = results[results.municipality == "Boston"].assign(key=lambda x: x.id.map(normalized_key)).merge(wu[wu.race_id == "suffolk-middlesex"].assign(key=lambda x: x.precinct_id.map(normalized_key)), on="key", validate="one_to_one")
assert len(joined) == 35
assert (joined.brownsberger_votes == joined.incumbent_votes).all()
assert (joined.lander_votes == joined.challenger_votes).all()

# Check the cached original state exports where available; never download or
# overwrite a source during an audit. Zero-vote split precincts are not modeled.
archives_checked = []
for race, challenger, incumbent in [
    ("first-suffolk", "Latoya Sherria Gayle", "Nicholas P. Collins"),
    ("norfolk-suffolk", "Persis S. Yu", "Michael F. Rush"),
    ("suffolk-middlesex", "Daniel Lander", "William N. Brownsberger"),
]:
    archive = DATA.parents[1] / "data" / "cache" / "wu-analysis" / f"{race}-2026.csv"
    if not archive.exists():
        continue
    raw = pd.read_csv(archive, dtype=str).fillna("")
    raw = raw[raw["City/Town"] == "Boston"].copy()
    for name in [challenger, incumbent]:
        raw[name] = raw[name].str.replace(",", "").astype(int)
    raw = raw[raw[challenger] + raw[incumbent] > 0]
    raw["key"] = [normalized_key(f"BOS-{ward}-{precinct}") for ward, precinct in zip(raw.Ward, raw.Pct)]
    modeled = wu[wu.race_id == race].assign(key=lambda x: x.precinct_id.map(normalized_key))
    comparison = modeled.merge(raw, on="key", validate="one_to_one")
    assert len(comparison) == len(raw) == len(modeled)
    assert (comparison.challenger_votes == comparison[challenger]).all()
    assert (comparison.incumbent_votes == comparison[incumbent]).all()
    archives_checked.append(race)
    if race == "suffolk-middlesex":
        district_source = pd.read_csv(archive, dtype=str).fillna("")
        district_source = district_source[district_source["City/Town"].isin(results.municipality.unique())].copy()
        city_codes = {"Boston": "BOS", "Cambridge": "CAM", "Watertown": "WAT", "Belmont": "BEL"}
        district_source["key"] = [normalized_key(f"{city_codes[city]}-{ward if ward not in ['', '-'] else '0'}-{precinct}") for city, ward, precinct in zip(district_source["City/Town"], district_source.Ward, district_source.Pct)]
        district_check = results.assign(key=lambda x: x.id.map(normalized_key)).merge(district_source, on="key", validate="one_to_one")
        assert len(district_check) == len(results)
        for local_column, source_column in [("brownsberger_votes", incumbent), ("lander_votes", challenger), ("other_votes", "All Others"), ("blank_votes", "Blanks")]:
            assert (district_check[local_column] == district_check[source_column].str.replace(",", "").astype(int)).all()

pooled_checks = {}
for field in ["wu_2021_preliminary_share_pct", "wu_2021_final_share_pct", "wu_2025_preliminary_share_pct"]:
    x, y, w = wu[field].to_numpy(), wu.challenger_share_pct.to_numpy(), wu.two_candidate_votes.to_numpy()
    design = np.column_stack([np.ones(len(x)), x])
    beta = np.linalg.lstsq(design * np.sqrt(w[:, None]), y * np.sqrt(w), rcond=None)[0]
    adjusted_design = np.column_stack([design, (wu.race_id == "norfolk-suffolk").astype(float), (wu.race_id == "suffolk-middlesex").astype(float)])
    adjusted_beta = np.linalg.lstsq(adjusted_design * np.sqrt(w[:, None]), y * np.sqrt(w), rcond=None)[0]
    iqr = np.quantile(x, .75) - np.quantile(x, .25)
    pooled_checks[field] = {"pooled_difference_pp": round(beta[1] * iqr, 4), "race_adjusted_difference_pp": round(adjusted_beta[1] * iqr, 4)}
for summary in summaries:
    rows = wu[wu.race_id == summary["raceId"]]
    x = rows[summary["wuMeasure"] + "_pct"].to_numpy() / 100
    y = rows[summary["view"] + "_share_pct"].to_numpy() / 100
    w = rows.two_candidate_votes.to_numpy()
    design = np.column_stack([np.ones(len(x)), x])
    beta = np.linalg.lstsq(design * np.sqrt(w[:, None]), y * np.sqrt(w), rcond=None)[0]
    q25, q75 = np.quantile(x, [.25, .75])
    assert abs(beta[1] - summary["slope"]) < 1e-5
    assert abs((q75 - q25) * beta[1] * 100 - summary["weakToStrongDifferencePp"]) < .0002

crosswalk = pd.read_csv(DATA / "wu_2021_to_2022_precinct_crosswalk.csv")
assert np.allclose(crosswalk.groupby("old_precinct_id").allocation_weight.sum(), 1, atol=1e-7)
census = pd.read_csv(DATA / "census_block_group_precinct_crosswalk.csv")
assert (census.groupby("block_group_geoid")[["person_weight", "household_weight"]].sum() <= 1.000001).all().all()
demographics = pd.read_csv(DATA / "precinct_demographics.csv")
assert set(demographics.precinct_id) == set(results.id)
assert (demographics.population_2020 == demographics.massgis_population_2020).all()

factors = json.loads((DATA / "precinct_factor_analysis.json").read_text(encoding="utf-8"))
obs = pd.DataFrame(factors["observations"])
obs_results = obs.merge(results, on="id", validate="one_to_one")
assert np.allclose(obs_results.turnoutPct, obs_results.ballots_cast_total / obs_results.registered_voters * 100)
assert np.allclose(obs_results.brownsbergerSharePct, obs_results.brownsberger_votes / (obs_results.brownsberger_votes + obs_results.lander_votes) * 100)
dem_lookup = demographics.set_index("precinct_id")
for factor in factors["outcomes"]["turnout"]["factors"]:
    assert np.allclose([row["factors"][factor["id"]] for row in factors["observations"]], dem_lookup.loc[obs.id, factor["field"]])

checked_models = 0
for outcome_id, outcome in factors["outcomes"].items():
    trials = obs.twoCandidateVotes.to_numpy() if outcome_id == "share" else obs.registeredVoters.to_numpy()
    proportion = (obs.brownsbergerSharePct if outcome_id == "share" else obs.turnoutPct).to_numpy() / 100
    for factor in outcome["factors"]:
        values = np.array([item[factor["id"]] for item in obs.factors])
        z = (values - values.mean()) / values.std(ddof=1)
        for version in ("raw", "adjusted"):
            columns = [np.ones(len(obs)), z]
            if version == "adjusted":
                columns += [(obs.municipality == city).to_numpy().astype(float) for city in ["Cambridge", "Watertown", "Belmont"]]
            X = np.column_stack(columns)
            beta = np.zeros(X.shape[1])
            for _ in range(100):
                p = 1 / (1 + np.exp(-(X @ beta)))
                W = trials * p * (1 - p)
                step = np.linalg.solve(X.T @ (W[:, None] * X), X.T @ (trials * (proportion - p)))
                beta += step
                if np.max(np.abs(step)) < 1e-10:
                    break
            else:
                raise AssertionError("Independent model did not converge")
            p = 1 / (1 + np.exp(-(X @ beta)))
            W = trials * p * (1 - p)
            bread = np.linalg.inv(X.T @ (W[:, None] * X))
            h = np.sum((X @ bread) * X, axis=1) * W
            assert h.max() < .95, "Check the production leverage cap before calling intervals HC3"
            score = X * (trials * (proportion - p) / np.maximum(1 - h, .05))[:, None]
            covariance = bread @ (score.T @ score) @ bread
            q25, q75 = np.quantile(values, [.25, .75])
            low, high = X.copy(), X.copy()
            low[:, 1], high[:, 1] = (q25 - values.mean()) / values.std(ddof=1), (q75 - values.mean()) / values.std(ddof=1)

            def predictions(b):
                return [np.average(1 / (1 + np.exp(-(design @ b))), weights=trials) * 100 for design in [low, high]]

            def difference(b):
                a, b = predictions(b)
                return b - a

            estimate = factor[version]
            assert np.allclose(predictions(beta), [estimate["predictionAtQ25"], estimate["predictionAtQ75"]], atol=1e-6)
            gradient = np.array([(difference(beta + np.eye(len(beta))[j] * 1e-5) - difference(beta - np.eye(len(beta))[j] * 1e-5)) / 2e-5 for j in range(len(beta))])
            se = np.sqrt(gradient @ covariance @ gradient)
            assert np.isclose(difference(beta), estimate["differencePp"], atol=1e-6)
            assert np.allclose([difference(beta) - 1.96 * se, difference(beta) + 1.96 * se], [estimate["ciLowPp"], estimate["ciHighPp"]], atol=1e-5)
            checked_models += 1

municipal = results.groupby("municipality")[["brownsberger_votes", "lander_votes", "ballots_cast_total", "registered_voters"]].sum()
municipal["brownsberger_share"] = municipal.brownsberger_votes / (municipal.brownsberger_votes + municipal.lander_votes) * 100
municipal["turnout"] = municipal.ballots_cast_total / municipal.registered_voters * 100
print(json.dumps({"status": "passed", "cached_original_exports_checked": archives_checked, "wu_comparisons_checked": len(summaries), "pooled_checks": pooled_checks, "factor_estimates_and_intervals_checked": checked_models, "turnout_pct": results.ballots_cast_total.sum() / results.registered_voters.sum() * 100, "municipal": municipal.round(2).to_dict(orient="index")}, indent=2))
