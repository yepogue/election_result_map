"use client";

import { useEffect, useMemo, useState } from "react";
import { PageSections, SiteFooter, SiteHeader } from "../components/SiteNavigation";

type EffectEstimate = {
  q25: number;
  q75: number;
  predictionAtQ25: number;
  predictionAtQ75: number;
  differencePp: number;
  standardErrorPp: number;
  ciLowPp: number;
  ciHighPp: number;
};

type FactorResult = {
  id: string;
  field: string;
  label: string;
  shortLabel: string;
  group: string;
  sd: number;
  raw: EffectEstimate;
  adjusted: EffectEstimate;
};

type OutcomeResult = {
  id: "share" | "turnout";
  label: string;
  denominator: string;
  factors: FactorResult[];
};

type Observation = {
  id: string;
  municipality: string;
  ward: string;
  precinct: string;
  registeredVoters: number;
  twoCandidateVotes: number;
  brownsbergerSharePct: number;
  turnoutPct: number;
  factors: Record<string, number>;
};

type AnalysisData = {
  outcomes: {
    share: OutcomeResult;
    turnout: OutcomeResult;
  };
  headline: {
    largestAdjustedShareFactor: string;
    largestAdjustedTurnoutFactor: string;
  };
  observations: Observation[];
  limitations: string[];
};

type OutcomeId = "share" | "turnout";

const CITY_COLORS: Record<string, string> = {
  Boston: "#0072B2",
  Cambridge: "#009E73",
  Watertown: "#D55E00",
  Belmont: "#6C58A6",
};

function percent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function signed(value: number, digits = 1, suffix = " pts") {
  if (Math.abs(value) < 0.05) return `0.0${suffix}`;
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}${suffix}`;
}

function extent(values: number[]) {
  return [Math.min(...values), Math.max(...values)] as const;
}

function factorById(outcome: OutcomeResult, id: string) {
  return outcome.factors.find((factor) => factor.id === id);
}

function EffectForest({ outcome, maximum }: { outcome: OutcomeResult; maximum: number }) {
  const x = (value: number) => 12 + ((value + maximum) / (maximum * 2)) * 276;
  return <div className="effect-list">
    <div className="effect-scale"><span>−{maximum} pts</span><span>0</span><span>+{maximum} pts</span></div>
    {outcome.factors.map(factor => <div className="effect-item" key={factor.id}>
      <div className="effect-item-heading"><strong>{factor.shortLabel}</strong><b>{signed(factor.adjusted.differencePp)}</b></div>
      <span>{percent(factor.adjusted.q25)} → {percent(factor.adjusted.q75)} of {factor.id === "turnout" ? "registered voters casting primary ballots" : factor.id === "bachelors_plus" ? "residents age 25+" : ["renters", "income_below_50k"].includes(factor.id) ? "households" : "residents"}</span>
      <svg viewBox="0 0 300 30" role="img" aria-label={`${factor.shortLabel}: ${signed(factor.adjusted.differencePp)}; 95% interval ${signed(factor.adjusted.ciLowPp)} to ${signed(factor.adjusted.ciHighPp)}`}>
        {[-maximum, 0, maximum].map(tick => <line key={tick} className={tick === 0 ? "effect-zero" : "effect-grid"} x1={x(tick)} x2={x(tick)} y1={0} y2={30} />)}
        <line className="effect-interval" x1={x(factor.adjusted.ciLowPp)} x2={x(factor.adjusted.ciHighPp)} y1={15} y2={15} />
        <circle cx={x(factor.adjusted.differencePp)} cy={15} r={5} fill="#075b82" />
      </svg>
      <small>95% interval: {signed(factor.adjusted.ciLowPp)} to {signed(factor.adjusted.ciHighPp)}</small>
    </div>)}
  </div>;
}

function ScatterExplorer({ data }: { data: AnalysisData }) {
  const [outcomeId, setOutcomeId] = useState<OutcomeId>("share");
  const [factorId, setFactorId] = useState("turnout");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const outcome = data.outcomes[outcomeId];
  const availableFactors = outcome.factors;
  const selectedFactorId = availableFactors.some((item) => item.id === factorId)
    ? factorId
    : availableFactors[0].id;
  const factor = factorById(outcome, selectedFactorId) ?? availableFactors[0];

  const width = 640;
  const height = 460;
  const margin = { top: 24, right: 30, bottom: 65, left: 75 };
  const xs = data.observations.map((row) => row.factors[factor.id]);
  const ys = data.observations.map((row) => outcomeId === "share" ? row.brownsbergerSharePct : row.turnoutPct);
  const [xMinimum, xMaximum] = extent(xs);
  const [yMinimum, yMaximum] = extent(ys);
  const xPadding = Math.max(1, (xMaximum - xMinimum) * 0.07);
  const yPadding = Math.max(2, (yMaximum - yMinimum) * 0.1);
  const xDomain = [Math.max(0, xMinimum - xPadding), Math.min(100, xMaximum + xPadding)] as const;
  const yDomain = [Math.max(0, yMinimum - yPadding), Math.min(100, yMaximum + yPadding)] as const;
  const x = (value: number) => margin.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * (width - margin.left - margin.right);
  const y = (value: number) => height - margin.bottom - ((value - yDomain[0]) / (yDomain[1] - yDomain[0])) * (height - margin.top - margin.bottom);
  const xTicks = [xDomain[0], (xDomain[0] + xDomain[1]) / 2, xDomain[1]];
  const yTicks = [yDomain[0], (yDomain[0] + yDomain[1]) / 2, yDomain[1]];

  return (
    <div className="factor-explorer-layout">
      <div>
        <div className="factor-explorer-controls">
          <label>
            <span>Outcome</span>
            <select value={outcomeId} onChange={(event) => setOutcomeId(event.target.value as OutcomeId)}>
              <option value="share">Brownsberger share</option>
              <option value="turnout">Primary turnout</option>
            </select>
          </label>
          <label>
            <span>Factor</span>
            <select value={factor.id} onChange={(event) => setFactorId(event.target.value)}>
              {availableFactors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </div>
        <svg className="factor-scatter" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${factor.label} and ${outcome.label} across precincts`}>
          <title>{factor.label} and {outcome.label}</title>
          <desc>Each dot is an actual precinct, colored by municipality. Select a dot to read its values. No fitted line is shown.</desc>
          <rect className="factor-scatter-frame" x={margin.left} y={margin.top} width={width - margin.left - margin.right} height={height - margin.top - margin.bottom} />
          {xTicks.map((tick) => <g key={`x-${tick}`}><line className="effect-grid" x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} /><text className="factor-axis-tick" x={x(tick)} y={height - 38} textAnchor="middle">{percent(tick)}</text></g>)}
          {yTicks.map((tick) => <g key={`y-${tick}`}><line className="effect-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} /><text className="factor-axis-tick" x={margin.left - 12} y={y(tick) + 4} textAnchor="end">{percent(tick)}</text></g>)}
          {data.observations.map((row) => {
            const outcomeValue = outcomeId === "share" ? row.brownsbergerSharePct : row.turnoutPct;
            const denominator = outcomeId === "share" ? row.twoCandidateVotes : row.registeredVoters;
            const radius = 3.4 + Math.sqrt(denominator / Math.max(...data.observations.map((item) => outcomeId === "share" ? item.twoCandidateVotes : item.registeredVoters))) * 5;
            return (
              <circle key={row.id} cx={x(row.factors[factor.id])} cy={y(outcomeValue)} r={radius} fill={CITY_COLORS[row.municipality]} className={`factor-scatter-dot${selectedId === row.id ? " selected" : ""}`} tabIndex={0} role="button" aria-label={`${row.municipality} ${row.ward ? `Ward ${row.ward}, ` : ""}Precinct ${row.precinct}: ${factor.shortLabel} ${percent(row.factors[factor.id])}; ${outcome.label} ${percent(outcomeValue)}`} onClick={() => setSelectedId(row.id)} onFocus={() => setSelectedId(row.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(row.id); } }}>
                <title>{row.municipality} {row.ward ? `Ward ${row.ward}, ` : ""}Precinct {row.precinct}: {factor.shortLabel} {percent(row.factors[factor.id])}; {outcome.label} {percent(outcomeValue)}</title>
              </circle>
            );
          })}
          <text className="factor-axis-title" x={(margin.left + width - margin.right) / 2} y={height - 7} textAnchor="middle">{factor.shortLabel} (%)</text>
          <text className="factor-axis-title" transform={`translate(20 ${(margin.top + height - margin.bottom) / 2}) rotate(-90)`} textAnchor="middle">{outcomeId === "share" ? "Brownsberger share" : "Primary turnout"} (%)</text>
        </svg>
        <div className="city-legend" aria-label="Municipality legend">
          {Object.entries(CITY_COLORS).map(([city, color]) => <span key={city}><i style={{ background: color }} />{city}</span>)}
        </div>
        <div className="precinct-readout" aria-live="polite">{(() => {
          const row = data.observations.find(item => item.id === selectedId);
          return row ? <><strong>{row.municipality} {row.ward ? `Ward ${row.ward}, ` : ""}Precinct {row.precinct}</strong><span>{factor.shortLabel}: {percent(row.factors[factor.id])} · {outcome.label}: {percent(outcomeId === "share" ? row.brownsbergerSharePct : row.turnoutPct)}</span></> : <span>Tap a dot, or use the keyboard, to read a precinct’s values.</span>;
        })()}</div>
      </div>
      <aside className="factor-reading">
        <p className="eyebrow">Estimated difference · municipality adjusted</p>
        <h3>{factor.shortLabel}</h3>
        <dl>
          <div><dt>Lower-value precinct</dt><dd>{percent(factor.adjusted.q25)} → predicted {percent(factor.adjusted.predictionAtQ25)}</dd></div>
          <div><dt>Higher-value precinct</dt><dd>{percent(factor.adjusted.q75)} → predicted {percent(factor.adjusted.predictionAtQ75)}</dd></div>
        </dl>
        <strong>{signed(factor.adjusted.differencePp)}</strong>
        <p>after accounting for municipality. The 95% interval is {signed(factor.adjusted.ciLowPp)} to {signed(factor.adjusted.ciHighPp)}.</p>
        <small>The dots show actual precincts. This estimate instead compares two factor values using the same mix of municipalities; it is not the difference between two selected dots. Axes are zoomed to the observed ranges.</small>
      </aside>
    </div>
  );
}

export default function PrecinctFactorAnalysisPage() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/assets/data/precinct_factor_analysis.json", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("Analysis unavailable"); return response.json(); })
      .then((analysis) => setData(analysis as AnalysisData))
      .catch(() => setError("The precinct factor analysis could not be loaded."));
  }, []);

  const strongestShare = useMemo(() => data ? factorById(data.outcomes.share, "renters") : null, [data]);
  const strongestTurnout = useMemo(() => data ? factorById(data.outcomes.turnout, "age18_34") : null, [data]);
  const turnoutShare = useMemo(() => data ? factorById(data.outcomes.share, "turnout") : null, [data]);

  if (error) return <main className="analysis-loading"><p role="alert">{error}</p></main>;
  if (!data || !strongestShare || !strongestTurnout || !turnoutShare) return <main className="analysis-loading"><span className="loader" /><p>Loading the factor analysis…</p></main>;

  const effectMaximum = Math.max(5, Math.ceil(Math.max(...Object.values(data.outcomes).flatMap(outcome => outcome.factors.flatMap(factor => [Math.abs(factor.adjusted.ciLowPp), Math.abs(factor.adjusted.ciHighPp)]))) / 5) * 5);

  return (
    <main className="analysis-page factor-analysis-page" id="top">
      <SiteHeader active="factors" />
      <PageSections links={[["#effects", "Findings"], ["#explore", "Explore precincts"], ["#method", "Method & downloads"]]} />
      <section className="factor-hero" id="main-content" tabIndex={-1}>
        <div>
          <p className="kicker">Suffolk & Middlesex District · precinct analysis</p>
          <h1>Community patterns in support and turnout</h1>
          <p className="analysis-deck">The analysis compares all 59 district precincts using certified post-recount votes, registered-voter counts, and 2020–2024 ACS demographic estimates.</p>
          <div className="scope-note"><strong>These are geographic associations, not causal effects.</strong><span>Each factor is considered separately, accounting for municipality—not for all the other factors. These are overlapping patterns, not independent explanations.</span></div>
        </div>

      </section>

      <section className="factor-story-strip" aria-label="Main findings">
        <article><p>VOTE SHARE</p><h2>{strongestShare.shortLabel}</h2><strong>{signed(strongestShare.adjusted.differencePp)}</strong><span>higher renter share was associated with less Brownsberger support</span></article>
        <article><p>TURNOUT</p><h2>{strongestTurnout.shortLabel}</h2><strong>{signed(strongestTurnout.adjusted.differencePp)}</strong><span>a larger young-adult population was associated with lower turnout</span></article>
        <article><p>TURNOUT AND SHARE</p><h2>Higher-turnout precincts</h2><strong>{signed(turnoutShare.adjusted.differencePp)}</strong><span>association with Brownsberger share after municipality adjustment</span></article>
      </section>

      <p className="factor-comparison-note">All three figures compare the 25th with the 75th percentile, accounting for municipality. The full comparisons and uncertainty intervals follow.</p>

      <section className="factor-effects-section" id="effects">
        <div className="analysis-section-heading"><div><p className="section-number">01 / MODELED DIFFERENCES</p><h2>What changes between a lower- and higher-value precinct?</h2><p>Each dot estimates the difference between the 25th and 75th percentile of a factor, accounting for municipality. For example, “−6 points” means a lower outcome in the higher-value precinct. Lines show 95% uncertainty intervals; crossing zero means the direction is uncertain under this model.</p></div></div>
        <div className="factor-two-column">
          <article className="factor-chart-panel"><div className="factor-panel-heading"><p>OUTCOME 1</p><h3>Brownsberger vote share</h3><span>Brownsberger ÷ (Brownsberger + Lander)</span></div><EffectForest outcome={data.outcomes.share} maximum={effectMaximum} /></article>
          <article className="factor-chart-panel"><div className="factor-panel-heading"><p>OUTCOME 2</p><h3>Overall primary turnout</h3><span>All primary ballots ÷ all registered voters</span></div><EffectForest outcome={data.outcomes.turnout} maximum={effectMaximum} /></article>
        </div>
        <div className="factor-interpretation-note"><strong>Read the intervals, not just the ranking.</strong><p>Characteristics overlap, so these numbers cannot be added together or treated as separate causes. Intervals do not include Census sampling and allocation uncertainty, spatial dependence, or adjustment for examining multiple factors.</p></div>
      </section>

      <section className="factor-explorer-section" id="explore">
        <div className="analysis-section-heading"><div><p className="section-number">02 / INSPECT A FACTOR</p><h2>See the precincts behind each estimate</h2><p>Choose a factor and tap a dot to read an actual precinct. Larger dots mean more two-candidate votes (share view) or more registered voters (turnout view). The side panel repeats the municipality-adjusted estimate above.</p></div></div>
        <ScatterExplorer data={data} />
      </section>

      <section className="factor-method-section" id="method">
        <div className="analysis-section-heading"><div><p className="section-number">03 / METHOD & LIMITS</p><h2>How the analysis was built</h2><p>The downloadable results contain the reported percentage-point comparisons and uncertainty intervals.</p></div><div className="download-group"><a className="download-primary" href="/assets/data/precinct_factor_effects.csv" download>Results CSV</a><a className="download-secondary" href="/assets/data/precinct_factor_analysis_qa.json" download>QA JSON</a></div></div>
        <div className="method-brief">
          <p><strong>What is counted?</strong> Vote share is Brownsberger ÷ (Brownsberger + Lander), excluding blanks and other candidates. Turnout is <em>all parties’</em> primary ballots ÷ all registered voters—not Democratic-only turnout.</p>
          <p><strong>What is compared?</strong> A lower value (25th percentile) with a higher value (75th percentile) across the 59 precincts. Each factor is examined separately, giving each municipality its own baseline.</p>
          <p><strong>What is estimated?</strong> Census characteristics describe residents or households, not the people who voted. They are allocated from 2020–2024 ACS block groups using 2020 population or housing weights.</p>
        </div>
        <details className="reader-details"><summary>Calculation details and limits</summary>
          <div className="method-brief"><p>For each outcome and factor, a grouped-binomial logistic model uses the underlying counts and municipality indicators. Predictions at the district’s 25th and 75th percentiles are averaged using the same municipality mix, weighted by two-candidate votes for share and registered voters for turnout. The displayed difference is in percentage points.</p>
          <p>The factor is assumed to have a common relationship across municipalities. Districtwide comparison values may fall outside a particular municipality’s observed range. This makes some comparisons more dependent on the model’s assumptions.</p>
          <p>95% intervals use precinct-level HC3 sandwich uncertainty and the delta method; no bootstrap is used. They do not include ACS sampling error, geographic allocation error, or dependence between neighboring precincts. They are individual intervals, not corrected for the many comparisons on this page.</p>
          <ul>{data.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul></div>
        </details>
        <div className="factor-source-links"><a href="/assets/data/results.csv" download><span>ELECTION DATA EXTRACT</span><strong>Certified post-recount precinct results</strong><b>↓</b></a><a href="/assets/data/precinct_demographics.csv" download><span>CENSUS CONTEXT</span><strong>Allocated 2020–2024 ACS precinct estimates</strong><b>↓</b></a><a href="/assets/data/census_data_dictionary.json" target="_blank"><span>DOCUMENTATION</span><strong>Census context data dictionary</strong><b>↗</b></a></div>
        <p className="source-note"><a href="/election-map#sources">Original election and Census sources ↗</a> · The downloads above are this site’s processed datasets.</p>
      </section>

      <SiteFooter />
    </main>
  );
}
