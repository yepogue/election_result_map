"use client";

import { useState } from "react";
import type snapshot from "../../public/data/challenger_renter_analysis.json";

type Data = typeof snapshot;
const pct = (n: number) => `${n.toFixed(1)}%`;
const count = (n: number) => n.toLocaleString("en-US");
const positive = (n: number) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(1)}`;
const raceColors: Record<string, string> = { "first-suffolk": "#0072B2", "suffolk-middlesex": "#B64D00", "norfolk-suffolk": "#6C58A6" };

function Symbol({ race, x, y }: { race: string; x: number; y: number }) {
  const props = { fill: raceColors[race], stroke: "white", strokeWidth: 1, fillOpacity: .85 };
  if (race === "suffolk-middlesex") return <path d={`M${x},${y - 7} L${x + 6},${y + 5} L${x - 6},${y + 5} Z`} {...props} />;
  if (race === "norfolk-suffolk") return <path d={`M${x},${y - 7} L${x + 6},${y} L${x},${y + 7} L${x - 6},${y} Z`} {...props} />;
  return <circle cx={x} cy={y} r={5.5} {...props} />;
}

export default function ChallengerRenters({ data }: { data: Data }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = data.observations.find(row => row.precinct_id === selectedId);
  const x = (v: number) => 65 + v / 100 * 475;
  const y = (v: number) => 345 - v / 100 * 305;
  const xmin = Math.min(...data.observations.map(row => row.renterSharePct));
  const xmax = Math.max(...data.observations.map(row => row.renterSharePct));
  const prediction = (value: number) => data.model.intercept + data.model.differencePp * value / 10;
  return <section className="renter-section challenger-renters" id="challengers" aria-labelledby="challenger-renter-heading">
    <p className="kicker">Boston only · {data.n} precincts · Three Senate races</p>
    <h2 id="challenger-renter-heading">Renters and the three challengers, combined</h2>
    <p>Did renter-heavy precincts favor challengers? Here we treat <strong>Latoya Gayle, Daniel Lander, and Persis Yu as one “challenger” side</strong>, against Collins, Brownsberger, and Rush respectively. Each symbol is one Boston precinct in one of those races, including precincts won by either side. This is not all of Boston.</p>
    <div className="renter-answer challenger-answer">
      <strong>A modest positive relationship overall, with substantial variation.</strong>
      <p>For example, comparing a precinct where 50% of households rent with one where 60% rent, the combined line estimates <b>{data.model.differencePp.toFixed(1)} percentage points more challenger support</b> in the latter. Renter share alone accounts for only about {(data.model.rSquared * 100).toFixed(0)}% of the precinct-to-precinct variation in challenger share.</p>
      <p>Gayle and Lander show positive relationships separately. Yu’s is nearly flat. The combined pattern is not a description of every race.</p>
    </div>
    <div className="renter-explorer-grid challenger-renter-grid">
      <div>
        <p className="renter-chart-caption">Renter households versus challenger vote share</p>
        <svg className="renter-scatter" viewBox="0 0 565 410" aria-label="Renter household share and combined challenger vote share in 156 Boston precincts" onClick={event => {
          // Choose the nearest symbol, rather than whichever transparent hit area
          // happens to be on top in a dense cluster. Keyboard focus stays direct.
          const bounds = event.currentTarget.getBoundingClientRect();
          const px = (event.clientX - bounds.left) * 565 / bounds.width;
          const py = (event.clientY - bounds.top) * 410 / bounds.height;
          const nearest = data.observations.map(row => ({ row, distance: Math.hypot(x(row.renterSharePct) - px, y(row.challengerSharePct) - py) })).sort((a, b) => a.distance - b.distance)[0];
          if (nearest.distance <= 16) setSelectedId(nearest.row.precinct_id);
        }}>
          <title>Three challengers combined: renter share and challenger vote share</title>
          <desc>Each symbol is one precinct. Circle: Gayle versus Collins. Triangle: Lander versus Brownsberger. Diamond: Yu versus Rush. The solid line summarizes all 156 precincts with equal weight. The dashed horizontal line marks a 50–50 split between the two named candidates. Select a symbol or use the precinct list for values.</desc>
          {[0, 25, 50, 75, 100].map(tick => <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={40} y2={345} stroke="#dce4e8" />
            <line x1={65} x2={540} y1={y(tick)} y2={y(tick)} stroke="#dce4e8" />
            <text x={x(tick)} y={365} textAnchor="middle">{tick}%</text><text x={56} y={y(tick) + 4} textAnchor="end">{tick}%</text>
          </g>)}
          <line x1={65} x2={540} y1={y(50)} y2={y(50)} stroke="#596c77" strokeDasharray="5 5" />
          <line x1={x(xmin)} x2={x(xmax)} y1={y(prediction(xmin))} y2={y(prediction(xmax))} stroke="#183e52" strokeWidth={3} />
          {data.observations.map(row => <g key={row.precinct_id} className="renter-dot" role="button" tabIndex={0} aria-label={`${row.label}; ${row.challenger}; renters ${pct(row.renterSharePct)}; challenger ${pct(row.challengerSharePct)}`} aria-pressed={selectedId === row.precinct_id} onFocus={() => setSelectedId(row.precinct_id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(row.precinct_id); } }}>
            <title>{`${row.label}: ${row.challenger} ${pct(row.challengerSharePct)}, renters ${pct(row.renterSharePct)}`}</title>
            <circle cx={x(row.renterSharePct)} cy={y(row.challengerSharePct)} r={10} fill="transparent" stroke={selectedId === row.precinct_id ? "#122e3d" : "none"} strokeWidth={2} />
            <Symbol race={row.race_id} x={x(row.renterSharePct)} y={y(row.challengerSharePct)} />
          </g>)}
          <text className="renter-axis-title" x={303} y={397} textAnchor="middle">Renter households (% of occupied households)</text>
          <text className="renter-axis-title" transform="translate(17,192) rotate(-90)" textAnchor="middle">Challenger two-candidate vote share (%)</text>
        </svg>
        <div className="renter-mobile-axes"><span><b>Horizontal:</b> renter household share (0–100%).</span><span><b>Vertical:</b> challenger vote share (0–100%).</span></div>
        <div className="renter-city-key challenger-race-key">{data.races.map(race => <span key={race.id}><svg viewBox="0 0 22 22" aria-hidden="true"><Symbol race={race.id} x={11} y={11} /></svg>{race.challenger.split(" ").at(-1)} vs. {race.incumbent.split(" ").at(-1)} · {race.n} precincts</span>)}</div>
        <label className="renter-precinct-picker"><span>Choose a Boston precinct in the three races</span><select value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">Choose a precinct…</option>{data.races.map(race => <optgroup key={race.id} label={`${race.challenger} vs. ${race.incumbent}`}>{data.observations.filter(row => row.race_id === race.id).sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true })).map(row => <option key={row.precinct_id} value={row.precinct_id}>{row.label}</option>)}</optgroup>)}</select></label>
        <div className="renter-selected" aria-live="polite">{selected ? <>
          <strong>{selected.label}</strong><span>{selected.challenger} vs. {selected.incumbent}</span>
          <span>Renter households: {pct(selected.renterSharePct)}</span>
          <span>{selected.challenger}: {pct(selected.challengerSharePct)} ({count(selected.challenger_votes)} of {count(selected.two_candidate_votes)} two-candidate votes)</span>
          <span>{selected.incumbent}: {count(selected.incumbent_votes)} votes</span>
        </> : <span>Tap, click, or focus a symbol to see the precinct and its actual candidate names and votes.</span>}</div>
      </div>
      <aside className="renter-chart-reading">
        <h3>How to read this chart</h3>
        <p><b>Further right</b> means more renter households. <b>Higher up</b> means more support for the challenger named in that precinct’s race.</p>
        <p><b>The solid line</b> is one combined straight-line summary, chosen to stay close to all the points overall. Every precinct counts equally; the candidates are combined by role, not by adding percentages together.</p>
        <p><b>The dashed 50% line</b> marks an even split between the two named candidates. Above it, the challenger received more votes than the incumbent.</p>
        <p><b>Why keep the three symbols?</b> They show which race each precinct belongs to, while the single solid line answers the combined question.</p>
        <p className="renter-note">Renter share describes households, not the percentage of voters who rent. This association does not establish how individual renters voted or what caused the result.</p>
      </aside>
    </div>
    <p className="renter-note">Vote share = challenger votes ÷ (challenger + incumbent votes). In Gayle’s race, Juwan Skeens is excluded so this is a Gayle–Collins comparison. Other votes and blanks are excluded in all three races. Only Boston precincts are included, not the suburban portions of the districts.</p>
    <details className="reader-details renter-calculation-notes">
      <summary>Combined comparison: method, sources &amp; data</summary>
      <p>The calculation uses all {data.n} precincts once: 82 for Gayle, 35 for Lander, and 39 for Yu. It is an equal-precinct least-squares line, not an equal-candidate or vote-weighted comparison. The example compares different precincts, not a change over time.</p>
      <p>All precincts are in Boston, so a municipality adjustment would do nothing here. A separate check removes each race’s average renter share and average challenger share before fitting a common line. That within-race comparison is {positive(data.raceAdjustedModel.differencePp)} percentage points of challenger share for 10 points more renter share. The chart shows the unadjusted pooled line ({positive(data.model.differencePp)}).</p>
      <p>Separate-race comparisons per 10 points more renter share are {data.races.map(race => `${race.challenger.split(" ").at(-1)} ${positive(race.model.differencePp)} points`).join("; ")}. They describe associations, not effects of renting or endorsements.</p>
      <p>Renter counts and occupied-household counts from ACS 2020–2024 table B25003 are allocated from block groups using their shares of 2020 housing units, then divided to get the precinct percentage. Census blocks are assigned to 2022 precincts by containment or largest area overlap. This reproduces all 35 existing Boston renter estimates. Census sampling and boundary-allocation uncertainty remain.</p>
      <p>The pooled 95% interval is {positive(data.model.ciLowPp)} to {positive(data.model.ciHighPp)} points, using HC3 standard errors and a t reference. This does not account for Census-estimate uncertainty, allocation error, or related neighboring precincts. No bootstrap is used.</p>
      <div className="renter-downloads"><a href="/assets/data/challenger_renter_precincts.csv" download>Combined precinct data CSV ↓</a><a href="/assets/data/challenger_renter_crosswalk.csv" download>Census allocation CSV ↓</a><a href="/assets/data/challenger_renter_analysis.json" download>Calculation record JSON ↓</a></div>
      <ul className="renter-sources">{data.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></li>)}</ul>
    </details>
  </section>;
}
