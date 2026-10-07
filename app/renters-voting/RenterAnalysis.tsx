"use client";

import { useState } from "react";
import type snapshot from "../../public/data/renter_analysis.json";
import type sourceSnapshot from "../../public/data/sources.json";
import type censusSnapshot from "../../public/data/census_data_dictionary.json";
import type challengerSnapshot from "../../public/data/challenger_renter_analysis.json";
import ChallengerRenters from "./ChallengerRenters";
import { PageSections, SiteFooter, SiteHeader } from "../components/SiteNavigation";

type AnalysisData = typeof snapshot;
type Observation = AnalysisData["observations"][number];
// Remove binary arithmetic dust before rounding decimal percentage estimates.
const pct = (n: number) => `${(Math.round((n + 1e-9) * 10) / 10).toFixed(1)}%`;
const count = (n: number) => n.toLocaleString("en-US");
const signed = (n: number) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(1)}`;
const colors: Record<string, string> = { Boston: "#0072B2", Cambridge: "#008566", Watertown: "#B64D00", Belmont: "#6C58A6" };

function Mark({ city, x, y }: { city: string; x: number; y: number }) {
  const props = { fill: colors[city], stroke: "white", strokeWidth: 1, fillOpacity: .85 };
  if (city === "Cambridge") return <rect x={x - 5} y={y - 5} width={10} height={10} {...props} />;
  if (city === "Watertown") return <path d={`M${x},${y - 7} L${x + 6},${y + 5} L${x - 6},${y + 5} Z`} {...props} />;
  if (city === "Belmont") return <path d={`M${x},${y - 7} L${x + 6},${y} L${x},${y + 7} L${x - 6},${y} Z`} {...props} />;
  return <circle cx={x} cy={y} r={5.5} {...props} />;
}

function KeyTerms() {
  return <aside className="renter-terms" aria-labelledby="renter-terms-heading">
    <h2 id="renter-terms-heading">A few terms, in plain language</h2>
    <dl>
      <div><dt>Municipality &amp; precinct</dt><dd>A municipality is a city or town: Boston, Cambridge, Watertown, or Belmont here. A precinct is a smaller area used to report votes.</dd></div>
      <div><dt>Renter share</dt><dd>The estimated percentage of occupied homes that are rented. It describes households—not the percentage of voters who rent.</dd></div>
      <div><dt>Brownsberger vote share</dt><dd>His percentage of the votes cast for either Brownsberger or Lander. Blank ballots and other votes are excluded.</dd></div>
      <div><dt>Percentage points</dt><dd>The difference between two percentages. From 40% to 50% is 10 percentage points; from 55% to 52% is 3 points lower.</dd></div>
    </dl>
  </aside>;
}

function ResultComparison({ data }: { data: AnalysisData }) {
  const comparisons = [
    { label: "Without municipality adjustment", note: "Mixes differences between cities/towns with differences among their precincts.", model: data.models.unadjusted },
    { label: "With municipality adjustment", note: "Uses only differences among precincts within the same city or town.", model: data.models.adjusted },
  ];
  return <div className="renter-comparison">
    <p className="renter-comparison-label"><strong>How much smaller is Brownsberger’s vote share in the more renter-heavy precinct?</strong><span>For a comparison of 40% versus 50% renter households</span></p>
    {comparisons.map(({ label, note, model }) => <div className="renter-result-row" key={label}>
      <div><h3>{label}</h3><p>{note}</p></div>
      <strong>{Math.abs(model.differencePp).toFixed(1)} percentage points lower</strong>
    </div>)}
    <p className="renter-note">These estimates summarize the pattern across all {data.n} precincts, counting each precinct equally. They are not the measured difference between two particular precincts, and they do not describe a change over time.</p>
  </div>;
}

function MunicipalityExplanation({ data }: { data: AnalysisData }) {
  return <section className="renter-section" id="method" aria-labelledby="renter-method-heading">
    <h2 id="renter-method-heading">How we account for municipality</h2>
    <p>Boston and Belmont differ in many ways. We want to know whether the renter pattern exists <strong>within the same city or town</strong>, rather than simply reflecting differences between them.</p>
    <ol className="renter-method-steps">
      <li><h3>Find each municipality’s averages</h3><p>Take the average of its precinct renter percentages and, separately, its precinct Brownsberger vote percentages. Each precinct counts equally; only precincts in this district are included.</p></li>
      <li><h3>Compare each precinct with its own municipality</h3><p>Subtract the municipality’s average renter share from the precinct’s renter share. Do the same for Brownsberger’s vote share. Both numbers now show how far above or below its municipality’s average the precinct sits.</p></li>
      <li><h3>Look for the pattern that remains</h3><p>Combine those within-municipality differences and fit one straight line, giving every precinct equal weight. This is where the <strong>{Math.abs(data.models.adjusted.differencePp).toFixed(1)}-point</strong> estimate comes from.</p></li>
    </ol>
    <div className="renter-example">
      <h3>A simple example</h3>
      <p>Made-up numbers to show the calculation—not an actual precinct.</p>
      <table>
        <caption className="sr-only">Subtract the municipality average from both percentages</caption>
        <thead><tr><th scope="col"></th><th scope="col">Renter share</th><th scope="col">Brownsberger share</th></tr></thead>
        <tbody>
          <tr><th scope="row">Municipality average</th><td>60%</td><td>55%</td></tr>
          <tr><th scope="row">One precinct</th><td>70%</td><td>52%</td></tr>
          <tr><th scope="row">Difference used</th><td>+10 points</td><td>−3 points</td></tr>
        </tbody>
      </table>
      <p>This precinct has a higher renter share and a smaller Brownsberger vote share than its municipality’s average. Repeating this for every precinct removes the differences between municipality averages from the renter comparison.</p>
    </div>
    <p className="renter-note"><strong>What is isolated?</strong> The renter relationship after removing city/town average differences—not a causal “municipality effect.” Differences within a municipality, such as age or income, could still help explain the pattern.</p>
  </section>;
}

function MunicipalContext({ data }: { data: AnalysisData }) {
  return <section className="renter-section" id="context" aria-labelledby="renter-context-heading">
    <h2 id="renter-context-heading">Renter share, votes, and turnout by city or town</h2>
    <p><strong>Only this Senate district is included</strong>—the Boston and Cambridge figures do not cover their entire cities. Renter columns describe the precinct percentages; election columns combine the actual counts across those precincts.</p>
    <p className="renter-table-hint">Scroll or swipe sideways if not all columns are visible.</p>
    <div className="renter-table-scroll" role="region" aria-label="Renter share, votes, and turnout by municipality" tabIndex={0}>
      <table className="renter-table renter-context-table" aria-describedby="renter-table-definitions">
        <caption>Renter estimates: 2020–2024 Census survey. Election: September 1, 2026 primary, post-recount.</caption>
        <thead>
          <tr><th scope="col" rowSpan={2}>City or town</th><th scope="col" rowSpan={2}>Precincts</th><th scope="colgroup" colSpan={4}>Renter share across precincts</th><th scope="colgroup" colSpan={2}>Election totals for included precincts</th></tr>
          <tr><th scope="col">Minimum</th><th scope="col">Mean</th><th scope="col">Median</th><th scope="col">Maximum</th><th scope="col">Brownsberger vote share</th><th scope="col">Primary turnout (all parties)</th></tr>
        </thead>
        <tbody>{data.municipalities.map(row => <tr key={row.municipality}>
          <th scope="row">{row.municipality}</th><td>{row.n}</td><td>{pct(row.min)}</td><td>{pct(row.mean)}</td><td className="renter-median">{pct(row.median)}</td><td>{pct(row.max)}</td>
          <td className="renter-rate-cell"><strong>{pct(row.brownsbergerSharePct)}</strong><span>{count(row.brownsbergerVotes)} of {count(row.twoCandidateVotes)} votes</span><small>for Brownsberger + Lander</small></td>
          <td className="renter-rate-cell"><strong>{pct(row.turnoutPct)}</strong><span>{count(row.ballotsCastTotal)} ballots cast</span><small>of {count(row.registeredVoters)} registered voters</small></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div id="renter-table-definitions" className="renter-table-definitions">
      <p><strong>Renter statistics:</strong> mean = average precinct percentage; median = middle percentage when precincts are put in order (average the middle two if needed); minimum / maximum = lowest / highest precinct percentage.</p>
      <p><strong>Vote share:</strong> Brownsberger votes ÷ (Brownsberger + Lander votes). <strong>Turnout:</strong> all parties’ primary ballots ÷ registered voters—not turnout just for Democrats or this Senate race. Both rates use combined counts, not averages of precinct rates.</p>
    </div>
  </section>;
}

function PrecinctExplorer({ data }: { data: AnalysisData }) {
  const cities = data.municipalities.map(row => row.municipality);
  const [within, setWithin] = useState(false);
  const [selected, setSelected] = useState<Observation | null>(null);
  const model = within ? data.models.adjusted : data.models.unadjusted;
  const low = within ? -50 : 0;
  const high = low + 100;
  const x = (v: number) => 65 + (v - low) / 100 * 475;
  const y = (v: number) => 345 - (v - low) / 100 * 305;
  const xv = (row: Observation) => within ? row.renterDeviationPp : row.renterSharePct;
  const yv = (row: Observation) => within ? row.voteDeviationPp : row.brownsbergerSharePct;
  const xmin = Math.min(...data.observations.map(xv));
  const xmax = Math.max(...data.observations.map(xv));
  const prediction = (value: number) => (within ? 0 : model.intercept) + model.differencePp * value / 10;
  return <section className="renter-section" id="precincts" aria-labelledby="renter-explorer-heading">
    <h2 id="renter-explorer-heading">Explore the precincts</h2>
    <details className="reader-details" open>
    <summary>Interactive precinct chart</summary>
    <div className="renter-view-buttons" role="group" aria-label="Precinct comparison view">
      <button aria-pressed={!within} onClick={() => setWithin(false)}>Actual percentages</button>
      <button aria-pressed={within} onClick={() => setWithin(true)}>Relative to city/town average</button>
    </div>
    <div className="renter-explorer-grid">
      <div>
        <p className="renter-chart-caption">{within ? "Each precinct relative to its own municipality’s average" : "Each precinct’s actual renter share and vote share"}</p>
        <svg className="renter-scatter" viewBox="0 0 565 410" aria-label={within ? "Municipality-centered renter share and Brownsberger vote share" : "Renter household share and Brownsberger vote share"}>
          <title>{within ? "Within-municipality comparison" : "Districtwide comparison"}</title>
          <desc>Each symbol represents a precinct. Select a symbol for its values. The solid line summarizes the overall pattern. Both views span 100 percentage points on each axis.</desc>
          {[low, low + 25, low + 50, low + 75, high].map(tick => <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={40} y2={345} stroke="#dce4e8" />
            <line x1={65} x2={540} y1={y(tick)} y2={y(tick)} stroke="#dce4e8" />
            <text x={x(tick)} y={365} textAnchor="middle">{tick}{within ? "" : "%"}</text><text x={56} y={y(tick) + 4} textAnchor="end">{tick}{within ? "" : "%"}</text>
          </g>)}
          {within && <g stroke="#596c77" strokeDasharray="5 5"><line x1={x(0)} x2={x(0)} y1={40} y2={345} /><line x1={65} x2={540} y1={y(0)} y2={y(0)} /></g>}
          <line x1={x(xmin)} y1={y(prediction(xmin))} x2={x(xmax)} y2={y(prediction(xmax))} stroke="#183e52" strokeWidth={3} />
          {data.observations.map(row => <g key={row.id} className="renter-dot" role="button" tabIndex={0} aria-label={`${row.label}; renters ${pct(row.renterSharePct)}; Brownsberger ${pct(row.brownsbergerSharePct)}`} aria-pressed={selected?.id === row.id} onClick={() => setSelected(row)} onFocus={() => setSelected(row)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(row); } }}>
            <title>{`${row.label}: renters ${pct(row.renterSharePct)}, Brownsberger ${pct(row.brownsbergerSharePct)}`}</title>
            <circle cx={x(xv(row))} cy={y(yv(row))} r={10} fill="transparent" stroke={selected?.id === row.id ? "#122e3d" : "none"} strokeWidth={2} />
            <Mark city={row.municipality} x={x(xv(row))} y={y(yv(row))} />
          </g>)}
          <text className="renter-axis-title" x={303} y={397} textAnchor="middle">{within ? "Renter share vs. municipality average (points)" : "Renter households (% of occupied households)"}</text>
          <text className="renter-axis-title" transform="translate(17,192) rotate(-90)" textAnchor="middle">{within ? "Brownsberger vs. municipality average (points)" : "Brownsberger two-candidate vote share (%)"}</text>
        </svg>
        <div className="renter-mobile-axes"><span><b>Horizontal:</b> renter household share.</span><span><b>Vertical:</b> Brownsberger vote share.</span><span>{within ? "Both axes show percentage points above/below the municipality average." : "Both axes show percentages (0–100%)."}</span></div>
        <div className="renter-city-key">{cities.map(city => <span key={city}><svg viewBox="0 0 22 22" aria-hidden="true"><Mark city={city} x={11} y={11} /></svg>{city}</span>)}</div>
        <label className="renter-precinct-picker"><span>Choose a precinct, or select its symbol</span><select value={selected?.id ?? ""} onChange={event => setSelected(data.observations.find(row => row.id === event.target.value) ?? null)}><option value="">Choose a precinct…</option>{data.observations.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
        <div className="renter-selected" aria-live="polite">{selected ? <><strong>{selected.label}</strong><span>Renter share: {pct(selected.renterSharePct)}</span><span>Brownsberger: {pct(selected.brownsbergerSharePct)} ({count(selected.brownsberger_votes)} of {count(selected.twoCandidateVotes)} two-candidate votes)</span><span>Primary turnout, all parties: {pct(selected.turnoutPct)} ({count(selected.ballots_cast_total)} ballots / {count(selected.registered_voters)} registered voters)</span>{within && <span>Difference from municipality average: renter share {signed(selected.renterDeviationPp)} percentage points; Brownsberger vote share {signed(selected.voteDeviationPp)} percentage points</span>}</> : <span>Tap, click, or focus a precinct symbol to read its values.</span>}</div>
      </div>
      <aside className="renter-chart-reading">
        <h3>How to read this chart</h3>
        <p><b>Each symbol is a precinct.</b> Further right means {within ? "a higher renter share relative to its city/town average" : "a higher renter share"}; higher up means {within ? "a larger Brownsberger vote share relative to that average" : "a larger Brownsberger vote share"}.</p>
        <p><b>The solid line summarizes the pattern.</b> It is chosen to stay as close as possible to all the points overall, counting each precinct equally. It is not a change over time.</p>
        {within && <p><b>Dashed zero lines</b> mark the municipality averages. For example, +10 on the horizontal axis means the precinct’s renter share is 10 percentage points above its own municipality’s average.</p>}
        <div className="renter-chart-example"><h4>What does the number mean?</h4>
          <p>Imagine two precincts{within ? " in the same city or town" : " in this district"}: <b>40% of households rent in one, and 50% rent in the other.</b></p>
          <p>The line estimates that Brownsberger’s vote share is <b>{Math.abs(model.differencePp).toFixed(1)} percentage points lower in the 50%-renter precinct</b>.</p>
          <p className="renter-note">{within ? "This comparison removes city/town average differences." : "This view does not account for city/town differences."} It describes the overall pattern, not the exact result for any particular pair of precincts.</p>
        </div>
        <p className="renter-note">Both views use the same scale spacing, so their line angles are comparable.</p>
      </aside>
    </div>
    </details>
  </section>;
}

export default function RenterAnalysis({ data, sources, census, challengers }: { data: AnalysisData; sources: typeof sourceSnapshot; census: typeof censusSnapshot; challengers: typeof challengerSnapshot }) {
  return <main className="renter-page" id="top">
    <SiteHeader active="renters" />
    <PageSections links={[["#comparison", "The result"], ["#method", "How it works"], ["#context", "City/town context"], ["#precincts", "Explore precincts"], ["#challengers", "Three challengers"], ["#sources", "Sources & data"]]} />
    <section className="renter-hero" id="main-content" tabIndex={-1}>
      <p className="kicker">59 precincts · Suffolk &amp; Middlesex Senate primary</p>
      <h1>Renters &amp; voting</h1>
      <p className="renter-question">Did precincts with more renter households give Brownsberger a smaller vote share, even within the same city or town?</p>
      <div className="renter-answer"><strong>Yes. Precincts with a higher renter share tended to give Brownsberger a smaller share of the vote.</strong><p>The relationship is weaker after accounting for city/town differences, but it does not disappear.</p></div>
      <p className="renter-note">This compares places, not individual voters. It does not show that renting caused someone to vote a certain way.</p>
      <p className="renter-note renter-additional-link">Also on this page: <a href="#challengers">renter share and the three challengers combined, in Boston</a>.</p>
      <KeyTerms />
    </section>
    <section className="renter-section" id="comparison" aria-labelledby="renter-comparison-heading"><h2 id="renter-comparison-heading">The result, with and without municipality</h2><p>Imagine one precinct where 40% of households rent and another where 50% rent. The second has a renter share 10 percentage points higher. The numbers below describe its estimated vote-share difference from the first precinct.</p><ResultComparison data={data} /></section>
    <MunicipalityExplanation data={data} />
    <MunicipalContext data={data} />
    <PrecinctExplorer data={data} />
    <ChallengerRenters data={challengers} />
    <section className="renter-section" id="sources" aria-labelledby="renter-sources-heading">
      <h2 id="renter-sources-heading">Sources &amp; downloadable data</h2>
      <p>The Brownsberger analysis uses certified post-recount results for September 1, 2026. The three-challenger comparison uses the same official state election snapshots as the Wu comparisons page, with its race-specific sources listed above. Renter shares are Census American Community Survey (ACS) estimates from 2020–2024, mapped to precinct boundaries—not a survey of this election’s voters.</p>
      <div className="renter-downloads"><a href="/assets/data/renter_precincts.csv" download>Precinct data CSV ↓</a><a href="/assets/data/renter_municipality_summary.csv" download>City/town summaries CSV ↓</a></div>
      <ul className="renter-sources"><li><a href={sources[0].url} target="_blank" rel="noreferrer">Secretary of the Commonwealth: certified post-recount precinct export ↗</a></li><li><a href={census.sources[3].url} target="_blank" rel="noreferrer">U.S. Census Bureau: 2020–2024 ACS five-year data ↗</a> · B25003, retrieved via the <a href={census.sources[3].retrievalUrl} target="_blank" rel="noreferrer">Census Reporter API</a></li><li><a href="/election-map#context">Precinct allocation method and Census crosswalk downloads</a> · <a href="/assets/data/census_data_dictionary.json" download>Data dictionary</a></li></ul>
      <details className="reader-details renter-calculation-notes"><summary>Data &amp; calculation notes</summary>
        <p>Both estimates use a straight-line least-squares calculation, which minimizes the squared vertical distances between the precinct points and the line. The second allows a different starting level for each municipality, but one shared renter relationship. This is equivalent to subtracting the municipality averages as shown above. The shared line is a summary, not evidence that every municipality has exactly the same pattern.</p>
        <p>The approximate 95% uncertainty ranges are {Math.abs(data.models.unadjusted.ciHighPp).toFixed(1)}–{Math.abs(data.models.unadjusted.ciLowPp).toFixed(1)} points lower without adjustment and {Math.abs(data.models.adjusted.ciHighPp).toFixed(1)}–{Math.abs(data.models.adjusted.ciLowPp).toFixed(1)} points lower with adjustment. They describe uncertainty in the estimated relationships under the calculation’s assumptions, not in the certified vote count. They do not include Census-estimate or boundary-mapping uncertainty, or account for neighboring precincts being related, so they may be too narrow.</p>
        <p>Renter household counts from ACS table B25003 are distributed from Census areas to precincts using 2020 housing-unit counts. The calculation uses the published one-decimal renter percentages. The <a href="/precinct-factor-analysis">Community factors</a> page uses a different calculation and comparison size, so its numbers are not directly interchangeable with these.</p>
        <p><a href="/assets/data/renter_analysis.json" download>Download the full calculation record (JSON)</a></p>
      </details>
      <details className="reader-details renter-changelog"><summary>Change log</summary><p><time dateTime="2026-10-06">October 6, 2026</time> — Added a pooled renter-share comparison for the 156 Boston precincts in the Gayle, Lander, and Yu races, with sources and downloadable allocation data. The original Brownsberger analysis is unchanged. Both interactive charts open expanded.</p><p><time dateTime={data.analysisDate}>October 5, 2026</time> — Added the renter analysis and plain-language municipality explanation. Clarified the chart’s precinct comparison and added vote counts, vote share, and all-party turnout to the city/town table and downloads. The renter-analysis estimates and source data are unchanged.</p></details>
    </section>
    <SiteFooter />
  </main>;
}
