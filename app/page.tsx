"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ResultRow = {
  id: string;
  municipality: string;
  ward: string;
  precinct: string;
  registered_voters: number;
  ballots_cast_total: number;
  ballots_cast_dem: number;
  brownsberger_votes: number;
  lander_votes: number;
  other_votes: number;
  blank_votes: number;
  result_status: string;
};

type Source = {
  municipality: string;
  title: string;
  url: string;
  status: string;
  usedFor: string;
};

type Geometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

type PrecinctFeature = {
  type: "Feature";
  properties: {
    WARD: string | null;
    PRECINCT: string;
    WP_DISTRICT: string;
    WP_NAME: string;
    TOWN: string;
  };
  geometry: Geometry;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: PrecinctFeature[];
};

type Metric = "lead" | "turnout";

const CITY_CODES: Record<string, string> = {
  BOSTON: "BOS",
  CAMBRIDGE: "CAM",
  WATERTOWN: "WAT",
  BELMONT: "BEL",
};

const CITY_ORDER = ["All", "Boston", "Cambridge", "Watertown", "Belmont"];
const BROWNSBERGER = "#A33F8C";
const LANDER = "#07827B";
const NEUTRAL = "#C8C6BE";

function parseCsv(text: string): ResultRow[] {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  const numeric = new Set([
    "registered_voters",
    "ballots_cast_total",
    "ballots_cast_dem",
    "brownsberger_votes",
    "lander_votes",
    "other_votes",
    "blank_votes",
  ]);

  return lines.map((line) => {
    const values = line.split(",");
    const row = Object.fromEntries(
      headers.map((header, index) => [
        header,
        numeric.has(header) ? Number(values[index]) : values[index],
      ]),
    );
    return row as ResultRow;
  });
}

function number(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function percent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function precinctLabel(row: ResultRow) {
  return row.ward
    ? `${row.municipality} · Ward ${row.ward}, Precinct ${row.precinct}`
    : `${row.municipality} · Precinct ${row.precinct}`;
}

function resultId(feature: PrecinctFeature) {
  const town = feature.properties.TOWN;
  const code = CITY_CODES[town];
  const ward = (feature.properties.WARD ?? "0").padStart(2, "0");
  const precinct = feature.properties.PRECINCT.padStart(2, "0");
  return `${code}-${ward}-${precinct}`;
}

function allCoordinates(geometry: Geometry): number[][] {
  if (geometry.type === "Polygon") {
    return (geometry.coordinates as number[][][]).flat();
  }
  return (geometry.coordinates as number[][][][]).flat(2);
}

function useDashboardData() {
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [geo, setGeo] = useState<FeatureCollection | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/assets/data/results.csv").then((response) => response.text()),
      fetch("/assets/data/district-precincts.geojson").then((response) => response.json()),
      fetch("/assets/data/sources.json").then((response) => response.json()),
    ])
      .then(([csv, geography, sourceList]) => {
        setRows(parseCsv(csv));
        setGeo(geography as FeatureCollection);
        setSources(sourceList as Source[]);
      })
      .catch(() => setError("The dashboard data could not be loaded."));
  }, []);

  return { rows, geo, sources, error };
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-8 8M18 13v6H5V6h6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6M12 7h.01" />
    </svg>
  );
}

function ElectionMap({
  rows,
  geo,
  city,
  metric,
  selectedId,
  onSelect,
}: {
  rows: ResultRow[];
  geo: FeatureCollection;
  city: string;
  metric: Metric;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{
    id: string;
    x: number;
    y: number;
    maxX: number;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const lookup = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const bounds = useMemo(() => {
    const coords = geo.features.flatMap((feature) => allCoordinates(feature.geometry));
    const meanLat = coords.reduce((sum, point) => sum + point[1], 0) / coords.length;
    const lonScale = Math.cos((meanLat * Math.PI) / 180);
    const xs = coords.map((point) => point[0] * lonScale);
    const ys = coords.map((point) => point[1]);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      lonScale,
    };
  }, [geo]);

  const project = (point: number[]) => {
    const width = 940;
    const height = 610;
    const padding = 24;
    const x = point[0] * bounds.lonScale;
    return [
      padding + ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * (width - padding * 2),
      padding + ((bounds.maxY - point[1]) / (bounds.maxY - bounds.minY)) * (height - padding * 2),
    ];
  };

  const ringPath = (ring: number[][]) =>
    ring
      .map((point, index) => {
        const [x, y] = project(point);
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ") + " Z";

  const featurePath = (geometry: Geometry) => {
    if (geometry.type === "Polygon") {
      return (geometry.coordinates as number[][][]).map(ringPath).join(" ");
    }
    return (geometry.coordinates as number[][][][])
      .flatMap((polygon) => polygon.map(ringPath))
      .join(" ");
  };

  const featureFill = (row: ResultRow | undefined) => {
    if (!row) return "#E7E5DF";
    if (metric === "turnout") {
      const turnout = row.ballots_cast_total / row.registered_voters;
      const lightness = Math.max(34, 82 - turnout * 95);
      return `hsl(35 53% ${lightness}%)`;
    }
    const candidateVotes = row.brownsberger_votes + row.lander_votes;
    const lead = candidateVotes ? (row.brownsberger_votes - row.lander_votes) / candidateVotes : 0;
    if (Math.abs(lead) < 0.002) return NEUTRAL;
    const opacity = Math.min(0.96, 0.34 + Math.abs(lead) * 1.65);
    return row.brownsberger_votes > row.lander_votes
      ? `color-mix(in srgb, ${BROWNSBERGER} ${opacity * 100}%, white)`
      : `color-mix(in srgb, ${LANDER} ${opacity * 100}%, white)`;
  };

  const moveTooltip = (event: React.MouseEvent, id: string) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHovered({
      id,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      maxX: Math.max(12, rect.width - 254),
    });
  };

  const hoveredRow = hovered ? lookup.get(hovered.id) : undefined;
  const selectedRow = lookup.get(selectedId);

  return (
    <div className="map-stage" ref={wrapRef}>
      <svg className="precinct-map" viewBox="0 0 940 610" role="img" aria-labelledby="map-title map-desc">
        <title id="map-title">Precinct-level election result map</title>
        <desc id="map-desc">Official Massachusetts precinct boundaries shaded by candidate lead or primary turnout.</desc>
        <g style={{ transform: `translate(${470 * (1 - zoom)}px, ${305 * (1 - zoom)}px) scale(${zoom})` }}>
          {geo.features.map((feature) => {
            const id = resultId(feature);
            const row = lookup.get(id);
            const faded = city !== "All" && row?.municipality !== city;
            const active = id === selectedId || id === hovered?.id;
            return (
              <path
                key={id}
                d={featurePath(feature.geometry)}
                fill={featureFill(row)}
                className={`precinct-shape${active ? " active" : ""}${faded ? " faded" : ""}`}
                tabIndex={0}
                role="button"
                aria-label={row ? `${precinctLabel(row)}. Brownsberger ${row.brownsberger_votes} votes. Lander ${row.lander_votes} votes.` : feature.properties.WP_NAME}
                onMouseMove={(event) => moveTooltip(event, id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered({ id, x: 470, y: 95, maxX: 546 })}
                onBlur={() => setHovered(null)}
                onClick={() => onSelect(id)}
              />
            );
          })}
        </g>
      </svg>

      <div className="map-tools" aria-label="Map zoom controls">
        <button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.2, value + 0.2))}>+</button>
        <button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.8, value - 0.2))}>−</button>
        <button aria-label="Reset map zoom" className="reset" onClick={() => setZoom(1)}>Reset</button>
      </div>

      {hoveredRow && hovered ? (
        <div
          className="map-tooltip"
          style={{
            left: Math.min(hovered.x + 14, hovered.maxX),
            top: Math.max(12, hovered.y - 118),
          }}
        >
          <strong>{precinctLabel(hoveredRow)}</strong>
          <div><span><i style={{ background: BROWNSBERGER }} />Brownsberger</span><b>{number(hoveredRow.brownsberger_votes)}</b></div>
          <div><span><i style={{ background: LANDER }} />Lander</span><b>{number(hoveredRow.lander_votes)}</b></div>
          <div className="tooltip-rule" />
          <div><span>Total primary turnout</span><b>{percent((hoveredRow.ballots_cast_total / hoveredRow.registered_voters) * 100)}</b></div>
        </div>
      ) : null}

      <div className="map-caption">
        <span>Official MassGIS 2022 precinct boundaries</span>
        <span>Click a precinct to keep its details open</span>
      </div>

      {selectedRow ? (
        <div className="selection-card">
          <div>
            <span className="eyebrow">Selected precinct</span>
            <strong>{precinctLabel(selectedRow)}</strong>
          </div>
          <button onClick={() => onSelect("")} aria-label="Clear selected precinct">×</button>
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const { rows, geo, sources, error } = useDashboardData();
  const [city, setCity] = useState("All");
  const [metric, setMetric] = useState<Metric>("lead");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [showAllRows, setShowAllRows] = useState(false);

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          registered: sum.registered + row.registered_voters,
          ballots: sum.ballots + row.ballots_cast_total,
          demBallots: sum.demBallots + row.ballots_cast_dem,
          brownsberger: sum.brownsberger + row.brownsberger_votes,
          lander: sum.lander + row.lander_votes,
        }),
        { registered: 0, ballots: 0, demBallots: 0, brownsberger: 0, lander: 0 },
      ),
    [rows],
  );

  const cityTotals = useMemo(
    () =>
      CITY_ORDER.slice(1).map((name) => {
        const cityRows = rows.filter((row) => row.municipality === name);
        return cityRows.reduce(
          (sum, row) => ({
            name,
            precincts: cityRows.length,
            brownsberger: sum.brownsberger + row.brownsberger_votes,
            lander: sum.lander + row.lander_votes,
            ballots: sum.ballots + row.ballots_cast_total,
            registered: sum.registered + row.registered_voters,
          }),
          { name, precincts: 0, brownsberger: 0, lander: 0, ballots: 0, registered: 0 },
        );
      }),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      const cityMatches = city === "All" || row.municipality === city;
      const textMatches = !normalized || precinctLabel(row).toLowerCase().includes(normalized);
      return cityMatches && textMatches;
    });
  }, [rows, city, query]);

  const candidateVotes = totals.brownsberger + totals.lander;
  const brownsbergerShare = candidateVotes ? (totals.brownsberger / candidateVotes) * 100 : 0;
  const landerShare = candidateVotes ? (totals.lander / candidateVotes) * 100 : 0;

  if (error) {
    return <main className="loading-state"><p>{error}</p></main>;
  }

  if (!rows.length || !geo) {
    return <main className="loading-state"><span className="loader" /><p>Loading precinct returns…</p></main>;
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Primary Atlas home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>PRIMARY ATLAS</span>
        </a>
        <nav aria-label="Page sections">
          <a href="#map">Map</a>
          <a href="#data">Data</a>
          <a href="#sources">Sources</a>
        </nav>
        <a className="header-download" href="/assets/data/results.csv" download>
          <DownloadIcon /> Download data
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="status-line">
            <span className="live-dot" />
            <span>Pre-recount precinct snapshot</span>
            <span>Updated Sep. 10, 2026</span>
          </div>
          <p className="kicker">Massachusetts State Senate · Democratic primary</p>
          <h1>Brownsberger <span>vs.</span> Lander</h1>
          <p className="district">Suffolk &amp; Middlesex District</p>
          <p className="intro">A precinct-level view of the September 1, 2026 primary across Boston, Cambridge, Watertown, and Belmont.</p>
        </div>

        <aside className="result-card" aria-label="Pre-recount result summary">
          <div className="result-card-top">
            <span>Official pre-recount totals</span>
            <span className="result-chip">59 precincts</span>
          </div>
          <div className="candidate-row">
            <div>
              <i style={{ background: BROWNSBERGER }} />
              <span>William N. Brownsberger</span>
            </div>
            <strong>{number(totals.brownsberger)}</strong>
            <b>{percent(brownsbergerShare, 2)}</b>
          </div>
          <div className="candidate-row">
            <div>
              <i style={{ background: LANDER }} />
              <span>Daniel Lander</span>
            </div>
            <strong>{number(totals.lander)}</strong>
            <b>{percent(landerShare, 2)}</b>
          </div>
          <div className="result-bar" aria-hidden="true">
            <span style={{ width: `${brownsbergerShare}%`, background: BROWNSBERGER }} />
            <span style={{ width: `${landerShare}%`, background: LANDER }} />
          </div>
          <div className="margin-note">
            <strong>Brownsberger +{number(totals.brownsberger - totals.lander)}</strong>
            <span>in the mapped pre-recount data</span>
          </div>
          <div className="recount-note"><InfoIcon /><span>The districtwide recount completed September 10; reporting put the final margin at 35 votes. The map remains tied to the published precinct files.</span></div>
        </aside>
      </section>

      <section className="stat-strip" aria-label="Dataset summary">
        <div><span>Precincts mapped</span><strong>{rows.length}</strong><small>Across 4 municipalities</small></div>
        <div><span>Two-candidate votes</span><strong>{number(candidateVotes)}</strong><small>Official pre-recount snapshot</small></div>
        <div><span>Primary turnout</span><strong>{percent((totals.ballots / totals.registered) * 100)}</strong><small>{number(totals.ballots)} of {number(totals.registered)} registered</small></div>
        <div><span>Closest precincts</span><strong>{rows.filter((row) => Math.abs(row.brownsberger_votes - row.lander_votes) <= 10).length}</strong><small>Separated by 10 votes or fewer</small></div>
      </section>

      <section className="map-section" id="map">
        <div className="section-heading map-heading">
          <div>
            <p className="section-number">01 / EXPLORE</p>
            <h2>Precinct map</h2>
            <p>Hover or focus a precinct for vote counts and turnout. Select a municipality to bring its boundaries forward.</p>
          </div>
          <div className="metric-control" aria-label="Map display metric">
            <button className={metric === "lead" ? "active" : ""} onClick={() => setMetric("lead")}>Candidate lead</button>
            <button className={metric === "turnout" ? "active" : ""} onClick={() => setMetric("turnout")}>Turnout</button>
          </div>
        </div>

        <div className="city-filter" aria-label="Filter by municipality">
          {CITY_ORDER.map((name) => (
            <button
              key={name}
              className={city === name ? "active" : ""}
              onClick={() => {
                setCity(name);
                setSelectedId("");
              }}
            >
              {name}
              {name !== "All" ? <span>{cityTotals.find((item) => item.name === name)?.precincts}</span> : null}
            </button>
          ))}
        </div>

        <div className="map-grid">
          <div>
            <ElectionMap rows={rows} geo={geo} city={city} metric={metric} selectedId={selectedId} onSelect={setSelectedId} />
            <div className="legend" aria-label="Map legend">
              {metric === "lead" ? (
                <>
                  <span><i style={{ background: BROWNSBERGER }} />Brownsberger higher total</span>
                  <span><i style={{ background: NEUTRAL }} />Nearly even</span>
                  <span><i style={{ background: LANDER }} />Lander higher total</span>
                  <small>Darker color indicates a larger two-candidate margin.</small>
                </>
              ) : (
                <>
                  <span className="turnout-ramp" /><span>Lower turnout</span><span>Higher turnout</span>
                  <small>Total ballots cast ÷ registered voters.</small>
                </>
              )}
            </div>
          </div>

          <aside className="city-summary">
            <p className="eyebrow">Municipal totals</p>
            <h3>How the district adds up</h3>
            <div className="city-list">
              {cityTotals.map((item) => {
                const total = item.brownsberger + item.lander;
                const bShare = total ? (item.brownsberger / total) * 100 : 0;
                return (
                  <button key={item.name} onClick={() => setCity(item.name)} className={city === item.name ? "selected" : ""}>
                    <div className="city-title"><strong>{item.name}</strong><span>{item.precincts} precincts</span></div>
                    <div className="mini-bar"><span style={{ width: `${bShare}%`, background: BROWNSBERGER }} /><span style={{ width: `${100 - bShare}%`, background: LANDER }} /></div>
                    <div className="city-numbers">
                      <span><i style={{ background: BROWNSBERGER }} />{number(item.brownsberger)}</span>
                      <span><i style={{ background: LANDER }} />{number(item.lander)}</span>
                      <span>{percent((item.ballots / item.registered) * 100)} turnout</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="status-key">
              <InfoIcon />
              <p><strong>Reading the status.</strong> Belmont, Cambridge, and Watertown publish official precinct returns. Boston&apos;s mapped precinct rows are its amended file, cross-checked to Boston&apos;s official municipal totals.</p>
            </div>
          </aside>
        </div>
      </section>

      <section className="data-section" id="data">
        <div className="section-heading">
          <div>
            <p className="section-number">02 / INSPECT</p>
            <h2>Precinct data</h2>
            <p>Search the published rows or download the complete machine-readable dataset.</p>
          </div>
          <div className="download-group">
            <a className="download-primary" href="/assets/data/results.csv" download><DownloadIcon />Results CSV</a>
            <a className="download-secondary" href="/assets/data/district-precincts.geojson" download><DownloadIcon />Boundaries</a>
          </div>
        </div>

        <div className="table-toolbar">
          <label>
            <span className="sr-only">Search precincts</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search city, ward, or precinct" />
          </label>
          <span>{filteredRows.length} rows</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Precinct</th>
                <th className="numeric">Registered</th>
                <th className="numeric">Total turnout</th>
                <th className="numeric">Brownsberger</th>
                <th className="numeric">Lander</th>
                <th className="numeric">Two-candidate margin</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, showAllRows ? undefined : 12).map((row) => {
                const difference = row.brownsberger_votes - row.lander_votes;
                return (
                  <tr key={row.id} onClick={() => { setSelectedId(row.id); document.querySelector("#map")?.scrollIntoView({ behavior: "smooth" }); }}>
                    <td><strong>{row.ward ? `Ward ${row.ward} · Pct. ${row.precinct}` : `Precinct ${row.precinct}`}</strong><span>{row.municipality}</span></td>
                    <td className="numeric">{number(row.registered_voters)}</td>
                    <td className="numeric"><strong>{percent((row.ballots_cast_total / row.registered_voters) * 100)}</strong><span>{number(row.ballots_cast_total)} ballots</span></td>
                    <td className="numeric candidate-value brownsberger">{number(row.brownsberger_votes)}</td>
                    <td className="numeric candidate-value lander">{number(row.lander_votes)}</td>
                    <td className="numeric">{difference === 0 ? "Even" : `${difference > 0 ? "B" : "L"} +${Math.abs(difference)}`}</td>
                    <td><span className={`status-pill ${row.result_status.startsWith("official") ? "official" : "mixed"}`}>{row.result_status.startsWith("official") ? "Official" : "Boston precinct file"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredRows.length > 12 ? (
          <button className="show-rows" onClick={() => setShowAllRows((value) => !value)}>{showAllRows ? "Show fewer rows" : `Show all ${filteredRows.length} rows`}</button>
        ) : null}
      </section>

      <section className="source-section" id="sources">
        <div className="section-heading">
          <div>
            <p className="section-number">03 / VERIFY</p>
            <h2>Sources &amp; methodology</h2>
            <p>Every result and boundary source used by the dashboard is linked below.</p>
          </div>
        </div>

        <div className="method-grid">
          <article>
            <span>1</span><div><strong>Keep raw units</strong><p>Candidate votes and ballots are stored as counts. Percentages are calculated in the browser.</p></div>
          </article>
          <article>
            <span>2</span><div><strong>Use total primary turnout</strong><p>Turnout is total Democratic and Republican ballots divided by registered voters.</p></div>
          </article>
          <article>
            <span>3</span><div><strong>Separate status from data</strong><p>Boston&apos;s precinct-level publication status is preserved while its totals are cross-checked to the official city result.</p></div>
          </article>
        </div>

        <div className="source-list">
          {sources.map((source, index) => (
            <a href={source.url} target="_blank" rel="noreferrer" key={`${source.title}-${index}`}>
              <div className="source-city">{source.municipality}</div>
              <div><strong>{source.title}</strong><span>{source.usedFor}</span></div>
              <div className="source-status">{source.status}</div>
              <ExternalIcon />
            </a>
          ))}
        </div>
      </section>

      <section className="maintain-section">
        <div>
          <p className="section-number">BUILT FOR HANDOFF</p>
          <h2>Update it without touching the code.</h2>
          <p>The dashboard reads two plain data files. Election staff can open the CSV in Excel, replace values, save it with the same name, and refresh the site.</p>
        </div>
        <ol>
          <li><span>01</span><div><strong>Update results.csv</strong><p>One row per precinct; keep the column names unchanged.</p></div></li>
          <li><span>02</span><div><strong>Check sources.json</strong><p>Add or replace links whenever a municipality publishes a revision.</p></div></li>
          <li><span>03</span><div><strong>Republish</strong><p>Run the documented build command. Boundaries only change after redistricting.</p></div></li>
        </ol>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>PRIMARY ATLAS</span></div>
        <p>Neutral, source-linked reporting for the September 1, 2026 Democratic primary.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}

export default App;
