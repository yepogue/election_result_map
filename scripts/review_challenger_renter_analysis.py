"""Independent audit of pooled renter estimates, source votes, joins, and fits.

Read-only. Uses source counts and QR decomposition, not the production builder.
"""
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import t

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
CACHE = ROOT / "data" / "cache"
analysis = json.loads((DATA / "challenger_renter_analysis.json").read_text(encoding="utf-8"))
rows = pd.DataFrame(analysis["observations"])
assert len(rows) == rows.precinct_id.nunique() == analysis["n"] == 156
source_paths = {
    "elections": DATA / "wu_precinct_analysis.csv",
    "precincts": CACHE / "wu-analysis" / "boston-precincts-2022.geojson",
    "blocks": CACHE / "wu-analysis" / "suffolk-county-2020-blocks.geojson",
    "acs": CACHE / "census" / "acs2024_5yr_block_groups_25025_B25003.json",
}
for key, path in source_paths.items():
    assert hashlib.sha256(path.read_bytes()).hexdigest() == analysis["sourceHashes"][key]
raw_races = {
    "first-suffolk": ("Latoya Sherria Gayle", "Nicholas P. Collins", "Juwan Khiry Skeens"),
    "suffolk-middlesex": ("Daniel Lander", "William N. Brownsberger", None),
    "norfolk-suffolk": ("Persis S. Yu", "Michael F. Rush", None),
}
source_votes = {}
for race, (challenger, incumbent, extra) in raw_races.items():
    with (CACHE / "wu-analysis" / f"{race}-2026.csv").open(encoding="utf-8-sig", newline="") as stream:
        for record in csv.DictReader(stream):
            if record["City/Town"] != "Boston":
                continue
            cv, iv = [int((record[name] or "0").replace(",", "")) for name in [challenger, incumbent]]
            if cv + iv == 0:
                continue
            key = f"BOS-{int(record['Ward']):02d}-{record['Pct']}"
            assert key not in source_votes
            source_votes[key] = (race, cv, iv, int(record[extra]) if extra else 0)
assert set(source_votes) == set(rows.precinct_id)
for row in rows.itertuples():
    assert source_votes[row.precinct_id] == (row.race_id, row.challenger_votes, row.incumbent_votes, row.extra_candidate_votes)
    assert row.two_candidate_votes == row.challenger_votes + row.incumbent_votes
    assert np.isclose(row.challengerSharePct, 100 * row.challenger_votes / row.two_candidate_votes)

# Independently reproduce full-block-group denominators and ACS contributions.
bg_totals = defaultdict(lambda: [0, 0, 0])
for feature in json.loads(source_paths["blocks"].read_text(encoding="utf-8"))["features"]:
    p = feature["properties"]
    for i, column in enumerate(["HU100", "POP100", "AREALAND"]):
        bg_totals[p["GEOID"][:12]][i] += p[column]
acs = json.loads(source_paths["acs"].read_text(encoding="utf-8"))["data"]
crosswalk = pd.read_csv(DATA / "challenger_renter_crosswalk.csv", dtype={"block_group_geoid": str})
assert len(crosswalk) == analysis["qa"]["crosswalkRows"]
assert not crosswalk.duplicated(["precinct_id", "block_group_geoid"]).any()
allocations = defaultdict(lambda: [0., 0.])
for item in crosswalk.itertuples():
    hu, pop, land = bg_totals[item.block_group_geoid]
    assert (hu, pop, land) == (item.bg_HU100, item.bg_POP100, item.bg_AREALAND)
    weight = item.housing_units_2020 / hu if hu else item.population_2020 / pop if pop else item.land_area_2020 / land if land else 0
    assert np.isclose(weight, item.household_weight, atol=1e-10)
    cells = acs['15000US' + item.block_group_geoid]['B25003']['estimate']
    assert cells['B25003001'] == item.acs_occupied_bg and cells['B25003003'] == item.acs_renter_bg
    for i, cell in enumerate(['B25003001', 'B25003003']):
        allocations[item.precinct_id][i] += weight * cells[cell]
assert set(allocations) == set(rows.precinct_id)
for row in rows.itertuples():
    occupied, renter = allocations[row.precinct_id]
    assert np.allclose([row.allocated_occupied, row.allocated_renter], [occupied, renter], atol=1e-8)
    assert np.isclose(row.renterSharePct, round(100 * renter / occupied, 1))
assert crosswalk.groupby("block_group_geoid").household_weight.sum().le(1 + 1e-8).all()

checks = 0
def verify_fit(group, expected):
    global checks
    x, y = group.renterSharePct.to_numpy() / 10, group.challengerSharePct.to_numpy()
    design = np.column_stack([np.ones(len(group)), x])
    if expected["raceAdjusted"]:
        # Different reference category from the production code.
        indicators = pd.get_dummies(group.race_id, dtype=float)[['first-suffolk', 'suffolk-middlesex']].to_numpy()
        design = np.column_stack([design, indicators])
    q, r = np.linalg.qr(design)
    b = np.linalg.solve(r, q.T @ y)
    residual = y - design @ b
    h = (q ** 2).sum(axis=1)
    ri = np.linalg.inv(r)
    v = ri @ (q.T @ np.diag((residual / (1 - h)) ** 2) @ q) @ ri.T
    se = np.sqrt(v[1, 1])
    delta = t.ppf(.975, len(group) - design.shape[1]) * se
    assert np.allclose([b[1], se, b[1] - delta, b[1] + delta], [expected['differencePp'], expected['standardErrorPp'], expected['ciLowPp'], expected['ciHighPp']], atol=1e-10)
    assert np.isclose(expected['rSquared'], 1 - np.sum(residual ** 2) / np.sum((y - y.mean()) ** 2))
    checks += 1

verify_fit(rows, analysis['model'])
verify_fit(rows, analysis['raceAdjustedModel'])
for race in analysis['races']:
    group = rows[rows.race_id == race['id']]
    verify_fit(group, race['model'])
    assert len(group) == race['n']
    assert group.challenger_votes.sum() == race['challengerVotes']
    assert group.incumbent_votes.sum() == race['incumbentVotes']
    assert group.two_candidate_votes.sum() == race['twoCandidateVotes']
dx = rows.renterSharePct - rows.groupby('race_id').renterSharePct.transform('mean')
dy = rows.challengerSharePct - rows.groupby('race_id').challengerSharePct.transform('mean')
assert np.allclose(rows.renterDeviationPp, dx) and np.allclose(rows.challengerDeviationPp, dy)
assert np.isclose(10 * np.dot(dx, dy) / np.dot(dx, dx), analysis['raceAdjustedModel']['differencePp'])
export = pd.read_csv(DATA / "challenger_renter_precincts.csv", dtype={"ward": str, "precinct": str})
pd.testing.assert_frame_equal(rows, export, check_dtype=False, rtol=1e-8, atol=1e-8)
print(f"PASS: all 156 precincts match original official vote exports; all {len(crosswalk)} allocation rows reproduce ACS counts and full block-group weights; {checks} fits/HC3 intervals reproduced with independent QR; CSV/JSON and race-centered values agree.")
