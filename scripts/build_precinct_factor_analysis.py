from __future__ import annotations

import csv
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "public" / "data"


FACTORS = [
    {
        "id": "age18_34",
        "field": "acs_age_18_34_pct",
        "label": "Residents age 18–34",
        "shortLabel": "Age 18–34",
        "group": "Age",
    },
    {
        "id": "age65_plus",
        "field": "acs_age_65_plus_pct",
        "label": "Residents age 65+",
        "shortLabel": "Age 65+",
        "group": "Age",
    },
    {
        "id": "bachelors_plus",
        "field": "acs_bachelors_plus_pct",
        "label": "Bachelor’s degree or higher",
        "shortLabel": "Bachelor’s degree+",
        "group": "Social and economic",
    },
    {
        "id": "renters",
        "field": "acs_renter_households_pct",
        "label": "Renter households",
        "shortLabel": "Renter households",
        "group": "Social and economic",
    },
    {
        "id": "income_below_50k",
        "field": "acs_households_income_below_50k_pct",
        "label": "Household income below $50k",
        "shortLabel": "Income below $50k",
        "group": "Social and economic",
    },
    {
        "id": "hispanic",
        "field": "acs_hispanic_pct",
        "label": "Hispanic residents",
        "shortLabel": "Hispanic",
        "group": "Race and ethnicity",
    },
    {
        "id": "black",
        "field": "acs_nonhispanic_black_pct",
        "label": "Non-Hispanic Black residents",
        "shortLabel": "Non-Hispanic Black",
        "group": "Race and ethnicity",
    },
    {
        "id": "asian",
        "field": "acs_nonhispanic_asian_pct",
        "label": "Non-Hispanic Asian residents",
        "shortLabel": "Non-Hispanic Asian",
        "group": "Race and ethnicity",
    },
]

TURNOUT_FACTOR = {
    "id": "turnout",
    "field": "turnout_pct",
    "label": "Overall primary turnout",
    "shortLabel": "Primary turnout",
    "group": "Participation",
}

CITY_ORDER = ["Boston", "Cambridge", "Watertown", "Belmont"]


def sigmoid(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, -30, 30)
    return 1.0 / (1.0 + np.exp(-clipped))


def normal_two_sided_p(z_value: float) -> float:
    return math.erfc(abs(z_value) / math.sqrt(2.0))


@dataclass
class GlmFit:
    beta: np.ndarray
    covariance: np.ndarray
    predicted: np.ndarray
    converged: bool
    iterations: int
    pseudo_r_squared: float
    deviance_explained: float
    design_columns: list[str]


def fit_grouped_logit(
    design: np.ndarray,
    successes: np.ndarray,
    trials: np.ndarray,
    columns: list[str],
    maximum_iterations: int = 100,
) -> GlmFit:
    proportions = successes / trials
    beta = np.zeros(design.shape[1], dtype=float)
    beta[0] = math.log(max(1e-6, successes.sum() / trials.sum()) / max(1e-6, 1 - successes.sum() / trials.sum()))
    converged = False

    for iteration in range(1, maximum_iterations + 1):
        eta = design @ beta
        predicted = np.clip(sigmoid(eta), 1e-7, 1 - 1e-7)
        variance = predicted * (1 - predicted)
        working_weights = trials * variance
        working_response = eta + (proportions - predicted) / variance
        xtwx = design.T @ (working_weights[:, None] * design)
        xtwz = design.T @ (working_weights * working_response)
        next_beta = np.linalg.pinv(xtwx) @ xtwz
        if float(np.max(np.abs(next_beta - beta))) < 1e-9:
            beta = next_beta
            converged = True
            break
        beta = next_beta

    predicted = np.clip(sigmoid(design @ beta), 1e-7, 1 - 1e-7)
    working_weights = trials * predicted * (1 - predicted)
    bread = np.linalg.pinv(design.T @ (working_weights[:, None] * design))
    leverage = np.einsum("ij,jk,ik->i", design, bread, design) * working_weights
    score_scale = (successes - trials * predicted) / np.clip(1 - leverage, 0.05, None)
    scores = design * score_scale[:, None]
    meat = scores.T @ scores
    covariance = bread @ meat @ bread

    log_likelihood = float(
        np.sum(successes * np.log(predicted) + (trials - successes) * np.log(1 - predicted))
    )
    null_probability = np.clip(successes.sum() / trials.sum(), 1e-7, 1 - 1e-7)
    null_log_likelihood = float(
        np.sum(successes * np.log(null_probability) + (trials - successes) * np.log(1 - null_probability))
    )
    pseudo_r_squared = 1 - log_likelihood / null_log_likelihood

    saturated_log_likelihood = float(
        np.sum(
            np.where(successes > 0, successes * np.log(successes / trials), 0)
            + np.where(
                trials - successes > 0,
                (trials - successes) * np.log((trials - successes) / trials),
                0,
            )
        )
    )
    deviance = 2 * (saturated_log_likelihood - log_likelihood)
    null_deviance = 2 * (saturated_log_likelihood - null_log_likelihood)
    deviance_explained = 1 - deviance / null_deviance if null_deviance else 0

    return GlmFit(
        beta=beta,
        covariance=covariance,
        predicted=predicted,
        converged=converged,
        iterations=iteration,
        pseudo_r_squared=pseudo_r_squared,
        deviance_explained=deviance_explained,
        design_columns=columns,
    )


def standardization(frame: pd.DataFrame, factor_fields: list[str]) -> dict[str, dict[str, float]]:
    return {
        field: {
            "mean": float(frame[field].mean()),
            "sd": float(frame[field].std(ddof=1)),
            "q25": float(frame[field].quantile(0.25)),
            "q75": float(frame[field].quantile(0.75)),
            "minimum": float(frame[field].min()),
            "maximum": float(frame[field].max()),
        }
        for field in factor_fields
    }


def make_design(
    frame: pd.DataFrame,
    factors: list[dict[str, str]],
    scaling: dict[str, dict[str, float]],
    include_city: bool,
) -> tuple[np.ndarray, list[str], dict[str, int]]:
    columns = ["Intercept"]
    values: list[np.ndarray] = [np.ones(len(frame))]
    factor_index: dict[str, int] = {}
    for factor in factors:
        field = factor["field"]
        factor_index[factor["id"]] = len(columns)
        columns.append(factor["id"])
        values.append((frame[field].to_numpy(dtype=float) - scaling[field]["mean"]) / scaling[field]["sd"])
    if include_city:
        for city in CITY_ORDER[1:]:
            columns.append(f"municipality_{city.lower()}")
            values.append((frame["municipality"] == city).to_numpy(dtype=float))
    return np.column_stack(values), columns, factor_index


def effect_for_factor(
    fit: GlmFit,
    design: np.ndarray,
    factor_index: int,
    factor_stats: dict[str, float],
    averaging_weights: np.ndarray,
) -> dict[str, float]:
    low_design = design.copy()
    high_design = design.copy()
    low_z = (factor_stats["q25"] - factor_stats["mean"]) / factor_stats["sd"]
    high_z = (factor_stats["q75"] - factor_stats["mean"]) / factor_stats["sd"]
    low_design[:, factor_index] = low_z
    high_design[:, factor_index] = high_z
    low_prediction = sigmoid(low_design @ fit.beta)
    high_prediction = sigmoid(high_design @ fit.beta)
    normalized_weights = averaging_weights / averaging_weights.sum()
    low_average = float(np.sum(normalized_weights * low_prediction))
    high_average = float(np.sum(normalized_weights * high_prediction))
    difference = high_average - low_average

    low_gradient = np.sum(
        normalized_weights[:, None]
        * (low_prediction * (1 - low_prediction))[:, None]
        * low_design,
        axis=0,
    )
    high_gradient = np.sum(
        normalized_weights[:, None]
        * (high_prediction * (1 - high_prediction))[:, None]
        * high_design,
        axis=0,
    )
    difference_gradient = high_gradient - low_gradient
    standard_error = math.sqrt(max(0.0, float(difference_gradient @ fit.covariance @ difference_gradient)))
    return {
        "q25": factor_stats["q25"],
        "q75": factor_stats["q75"],
        "predictionAtQ25": low_average * 100,
        "predictionAtQ75": high_average * 100,
        "differencePp": difference * 100,
        "standardErrorPp": standard_error * 100,
        "ciLowPp": (difference - 1.96 * standard_error) * 100,
        "ciHighPp": (difference + 1.96 * standard_error) * 100,
    }


def coefficient_for_factor(fit: GlmFit, factor_index: int) -> dict[str, float]:
    coefficient = float(fit.beta[factor_index])
    standard_error = math.sqrt(max(0.0, float(fit.covariance[factor_index, factor_index])))
    z_value = coefficient / standard_error if standard_error else 0.0
    return {
        "coefficient": coefficient,
        "standardError": standard_error,
        "ciLow": coefficient - 1.96 * standard_error,
        "ciHigh": coefficient + 1.96 * standard_error,
        "oddsRatio": math.exp(coefficient),
        "pValue": normal_two_sided_p(z_value),
    }


def vif_values(design: np.ndarray, columns: list[str]) -> dict[str, float]:
    output: dict[str, float] = {}
    for index in range(1, design.shape[1]):
        target = design[:, index]
        others = np.delete(design, index, axis=1)
        fitted = others @ np.linalg.lstsq(others, target, rcond=None)[0]
        residual_sum = float(np.sum((target - fitted) ** 2))
        total_sum = float(np.sum((target - target.mean()) ** 2))
        r_squared = 1 - residual_sum / total_sum if total_sum else 0
        output[columns[index]] = float(1 / max(1e-8, 1 - r_squared))
    return output


def factor_results(
    frame: pd.DataFrame,
    factors: list[dict[str, str]],
    successes: np.ndarray,
    trials: np.ndarray,
    averaging_weights: np.ndarray,
    include_city: bool,
) -> tuple[list[dict[str, Any]], GlmFit, np.ndarray, dict[str, dict[str, float]], dict[str, float]]:
    fields = [factor["field"] for factor in factors]
    scaling = standardization(frame, fields)
    design, columns, factor_index = make_design(frame, factors, scaling, include_city=include_city)
    fit = fit_grouped_logit(design, successes, trials, columns)
    output: list[dict[str, Any]] = []

    for factor in factors:
        raw_design, raw_columns, raw_index = make_design(frame, [factor], scaling, include_city=False)
        raw_fit = fit_grouped_logit(raw_design, successes, trials, raw_columns)
        city_design, city_columns, city_index = make_design(frame, [factor], scaling, include_city=True)
        city_fit = fit_grouped_logit(city_design, successes, trials, city_columns)
        joint_adjusted_effect = effect_for_factor(
            fit, design, factor_index[factor["id"]], scaling[factor["field"]], averaging_weights
        )
        municipality_adjusted_effect = effect_for_factor(
            city_fit,
            city_design,
            city_index[factor["id"]],
            scaling[factor["field"]],
            averaging_weights,
        )
        raw_effect = effect_for_factor(
            raw_fit,
            raw_design,
            raw_index[factor["id"]],
            scaling[factor["field"]],
            averaging_weights,
        )
        coefficient = coefficient_for_factor(fit, factor_index[factor["id"]])
        output.append(
            {
                **factor,
                "sd": scaling[factor["field"]]["sd"],
                "raw": raw_effect,
                "adjusted": municipality_adjusted_effect,
                "jointAdjusted": joint_adjusted_effect,
                "coefficient": coefficient,
                "displayedModelChecks": {
                    "unadjustedConverged": raw_fit.converged,
                    "municipalityAdjustedConverged": city_fit.converged,
                    "finiteCovariance": bool(np.isfinite(raw_fit.covariance).all() and np.isfinite(city_fit.covariance).all()),
                },
            }
        )

    vifs = vif_values(design, columns)
    return output, fit, design, scaling, vifs


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def main() -> None:
    results = pd.read_csv(DATA_DIR / "results.csv", dtype={"ward": str, "precinct": str})
    demographics = pd.read_csv(
        DATA_DIR / "precinct_demographics.csv", dtype={"ward": str, "precinct": str}
    )
    frame = results.merge(demographics, left_on="id", right_on="precinct_id", suffixes=("", "_demo"), validate="one_to_one")
    if len(frame) != len(results):
        raise ValueError("Every election precinct must have one demographic match.")

    frame["two_candidate_votes"] = frame["brownsberger_votes"] + frame["lander_votes"]
    frame["brownsberger_share_pct"] = frame["brownsberger_votes"] / frame["two_candidate_votes"] * 100
    frame["turnout_pct"] = frame["ballots_cast_total"] / frame["registered_voters"] * 100
    frame["democratic_participation_pct"] = frame["ballots_cast_dem"] / frame["registered_voters"] * 100

    share_factors = FACTORS + [TURNOUT_FACTOR]
    share_results, share_fit, share_design, share_scaling, share_vifs = factor_results(
        frame,
        share_factors,
        frame["brownsberger_votes"].to_numpy(dtype=float),
        frame["two_candidate_votes"].to_numpy(dtype=float),
        frame["two_candidate_votes"].to_numpy(dtype=float),
        include_city=True,
    )
    share_without_turnout_results, share_without_turnout_fit, _, _, _ = factor_results(
        frame,
        FACTORS,
        frame["brownsberger_votes"].to_numpy(dtype=float),
        frame["two_candidate_votes"].to_numpy(dtype=float),
        frame["two_candidate_votes"].to_numpy(dtype=float),
        include_city=True,
    )
    share_without_turnout_lookup = {row["id"]: row["jointAdjusted"] for row in share_without_turnout_results}
    for row in share_results:
        row["jointAdjustedWithoutTurnout"] = share_without_turnout_lookup.get(row["id"])

    turnout_results, turnout_fit, turnout_design, turnout_scaling, turnout_vifs = factor_results(
        frame,
        FACTORS,
        frame["ballots_cast_total"].to_numpy(dtype=float),
        frame["registered_voters"].to_numpy(dtype=float),
        frame["registered_voters"].to_numpy(dtype=float),
        include_city=True,
    )
    democratic_results, democratic_fit, _, _, _ = factor_results(
        frame,
        FACTORS,
        frame["ballots_cast_dem"].to_numpy(dtype=float),
        frame["registered_voters"].to_numpy(dtype=float),
        frame["registered_voters"].to_numpy(dtype=float),
        include_city=True,
    )
    democratic_lookup = {row["id"]: row["adjusted"] for row in democratic_results}
    for row in turnout_results:
        row["democraticParticipationSensitivity"] = democratic_lookup[row["id"]]

    factor_fields = [factor["field"] for factor in share_factors]
    correlation = frame[factor_fields].corr()
    correlation_rows = [
        {
            "factor": next(factor["id"] for factor in share_factors if factor["field"] == row_field),
            "values": {
                next(factor["id"] for factor in share_factors if factor["field"] == column_field): float(correlation.loc[row_field, column_field])
                for column_field in factor_fields
            },
        }
        for row_field in factor_fields
    ]

    share_without_turnout_effects = {row["id"]: row["jointAdjusted"] for row in share_without_turnout_results}
    observations = []
    for index, row in frame.iterrows():
        observations.append(
            {
                "id": row["id"],
                "municipality": row["municipality"],
                "ward": row["ward"],
                "precinct": row["precinct"],
                "registeredVoters": int(row["registered_voters"]),
                "twoCandidateVotes": int(row["two_candidate_votes"]),
                "brownsbergerSharePct": float(row["brownsberger_share_pct"]),
                "turnoutPct": float(row["turnout_pct"]),
                "democraticParticipationPct": float(row["democratic_participation_pct"]),
                "predictedBrownsbergerSharePct": float(share_fit.predicted[index] * 100),
                "brownsbergerResidualPp": float((row["brownsberger_share_pct"] / 100 - share_fit.predicted[index]) * 100),
                "predictedTurnoutPct": float(turnout_fit.predicted[index] * 100),
                "turnoutResidualPp": float((row["turnout_pct"] / 100 - turnout_fit.predicted[index]) * 100),
                "factors": {
                    factor["id"]: float(row[factor["field"]]) for factor in share_factors
                },
            }
        )

    highest_share_factor = max(share_results, key=lambda row: abs(row["adjusted"]["differencePp"]))
    highest_turnout_factor = max(turnout_results, key=lambda row: abs(row["adjusted"]["differencePp"]))
    turnout_share_row = next(row for row in share_results if row["id"] == "turnout")

    output = {
        "generatedOn": pd.Timestamp.now(tz="UTC").isoformat(),
        "analysisLabel": "Certified September 2026 districtwide recount and 2020–2024 ACS precinct estimates",
        "precinctCount": len(frame),
        "model": {
            "family": "Grouped-binomial logistic regression",
            "uncertainty": "Precinct-level HC3 robust standard errors; model-based 95% intervals; no bootstrap",
            "controls": "Municipality fixed effects with Boston as the reference",
            "standardization": "Factors are standardized internally for computation. The page displays 25th-to-75th-percentile differences in percentage points, not coefficients.",
            "effectScale": "The displayed comparisons use one factor at a time plus municipality. Joint-model diagnostics are retained in this data file for audit, not displayed as independent factor effects.",
        },
        "outcomes": {
            "share": {
                "id": "share",
                "label": "Brownsberger two-candidate vote share",
                "denominator": "Brownsberger plus Lander votes",
                "factors": share_results,
                "diagnostics": {
                    "converged": share_fit.converged,
                    "iterations": share_fit.iterations,
                    "pseudoRSquared": share_fit.pseudo_r_squared,
                    "devianceExplained": share_fit.deviance_explained,
                    "maxVif": max(share_vifs.values()),
                    "vif": share_vifs,
                    "withoutTurnoutPseudoRSquared": share_without_turnout_fit.pseudo_r_squared,
                },
            },
            "turnout": {
                "id": "turnout",
                "label": "Overall primary turnout",
                "denominator": "All registered voters",
                "factors": turnout_results,
                "diagnostics": {
                    "converged": turnout_fit.converged,
                    "iterations": turnout_fit.iterations,
                    "pseudoRSquared": turnout_fit.pseudo_r_squared,
                    "devianceExplained": turnout_fit.deviance_explained,
                    "maxVif": max(turnout_vifs.values()),
                    "vif": turnout_vifs,
                    "democraticParticipationPseudoRSquared": democratic_fit.pseudo_r_squared,
                },
            },
        },
        "headline": {
            "largestAdjustedShareFactor": highest_share_factor["id"],
            "largestAdjustedShareDifferencePp": highest_share_factor["adjusted"]["differencePp"],
            "largestAdjustedTurnoutFactor": highest_turnout_factor["id"],
            "largestAdjustedTurnoutDifferencePp": highest_turnout_factor["adjusted"]["differencePp"],
            "turnoutShareDifferencePp": turnout_share_row["adjusted"]["differencePp"],
            "turnoutShareCiLowPp": turnout_share_row["adjusted"]["ciLowPp"],
            "turnoutShareCiHighPp": turnout_share_row["adjusted"]["ciHighPp"],
        },
        "shareWithoutTurnoutEffects": share_without_turnout_effects,
        "correlation": correlation_rows,
        "observations": observations,
        "sources": [
            {
                "title": "State post-recount candidate counts and municipal election-wide reports",
                "file": "results.csv",
                "use": "State export: candidate votes and Democratic contest ballots. Municipal reports: registered voters and all-party turnout. Original links in sources.json.",
            },
            {
                "title": "2020–2024 ACS precinct allocation",
                "file": "precinct_demographics.csv",
                "use": "Demographic, social, economic, and housing estimates",
            },
        ],
        "limitations": [
            "The analysis describes precinct-level associations and does not identify individual voter behavior or causal effects.",
            "ACS percentages are modeled from block-group estimates; their published margins of error do not include geographic allocation error.",
            "Race and ethnicity percentages are compositional. A higher share for one group necessarily means a lower combined share for other groups.",
            "Only 59 precincts are available, and several characteristics move together, so the analysis cannot cleanly separate every factor.",
            "Intervals do not propagate ACS sampling or allocation error, account for spatial dependence, or adjust for the number of comparisons. Districtwide percentile values can fall outside a municipality's observed range.",
        ],
    }

    qa = {
        "generatedOn": output["generatedOn"],
        "checks": {
            "allElectionRowsMatched": len(frame) == len(results) == 59,
            "uniquePrecinctIds": frame["id"].nunique() == len(frame),
            "allDisplayedModelsConvergedAndFinite": all(all(item["displayedModelChecks"].values()) for item in share_results + turnout_results),
            "positiveOutcomeDenominators": bool((frame["two_candidate_votes"] > 0).all() and (frame["registered_voters"] > 0).all()),
            "shareModelConverged": share_fit.converged,
            "turnoutModelConverged": turnout_fit.converged,
            "allPredictionsInRange": bool(
                ((share_fit.predicted > 0) & (share_fit.predicted < 1)).all()
                and ((turnout_fit.predicted > 0) & (turnout_fit.predicted < 1)).all()
            ),
            "finiteCovariance": bool(
                np.isfinite(share_fit.covariance).all() and np.isfinite(turnout_fit.covariance).all()
            ),
        },
        "totals": {
            "registeredVoters": int(frame["registered_voters"].sum()),
            "ballotsCastTotal": int(frame["ballots_cast_total"].sum()),
            "ballotsCastDem": int(frame["ballots_cast_dem"].sum()),
            "brownsbergerVotes": int(frame["brownsberger_votes"].sum()),
            "landerVotes": int(frame["lander_votes"].sum()),
        },
        "modelDimensions": {
            "shareRows": int(share_design.shape[0]),
            "shareParameters": int(share_design.shape[1]),
            "turnoutRows": int(turnout_design.shape[0]),
            "turnoutParameters": int(turnout_design.shape[1]),
        },
    }

    json_path = DATA_DIR / "precinct_factor_analysis.json"
    qa_path = DATA_DIR / "precinct_factor_analysis_qa.json"
    json_path.write_text(json.dumps(json_safe(output), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    qa_path.write_text(json.dumps(json_safe(qa), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    csv_path = DATA_DIR / "precinct_factor_effects.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        fieldnames = [
            "outcome",
            "factor_id",
            "factor_label",
            "factor_group",
            "q25_pct",
            "q75_pct",
            "raw_difference_pp",
            "raw_ci_low_pp",
            "raw_ci_high_pp",
            "adjusted_difference_pp",
            "adjusted_ci_low_pp",
            "adjusted_ci_high_pp",
        ]
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for outcome_id, rows in (("share", share_results), ("turnout", turnout_results)):
            for row in rows:
                writer.writerow(
                    {
                        "outcome": outcome_id,
                        "factor_id": row["id"],
                        "factor_label": row["label"],
                        "factor_group": row["group"],
                        "q25_pct": round(row["adjusted"]["q25"], 4),
                        "q75_pct": round(row["adjusted"]["q75"], 4),
                        "raw_difference_pp": round(row["raw"]["differencePp"], 6),
                        "raw_ci_low_pp": round(row["raw"]["ciLowPp"], 6),
                        "raw_ci_high_pp": round(row["raw"]["ciHighPp"], 6),
                        "adjusted_difference_pp": round(row["adjusted"]["differencePp"], 6),
                        "adjusted_ci_low_pp": round(row["adjusted"]["ciLowPp"], 6),
                        "adjusted_ci_high_pp": round(row["adjusted"]["ciHighPp"], 6),
                    }
                )

    print(f"Wrote {json_path.relative_to(ROOT)}")
    print(f"Wrote {csv_path.relative_to(ROOT)}")
    print(f"Wrote {qa_path.relative_to(ROOT)}")
    print(json.dumps(qa["checks"], indent=2))


if __name__ == "__main__":
    main()
