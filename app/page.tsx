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

type ElectionMeta = {
  dashboard_updated: string;
  status: string;
  recount_completed: string;
  brownsberger_votes: number;
  lander_votes: number;
  margin: number;
  precinct_data_label: string;
  note: string;
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
type SortKey = "precinct" | "registered" | "turnout" | "brownsbergerShare" | "brownsberger" | "lander" | "margin";
type SortDirection = "asc" | "desc";

const CITY_CODES: Record<string, string> = {
  BOSTON: "BOS",
  CAMBRIDGE: "CAM",
  WATERTOWN: "WAT",
  BELMONT: "BEL",
};

const CITY_ORDER = ["All", "Boston", "Cambridge", "Watertown", "Belmont"];
const BROWNSBERGER = "#0072B2";
const BROWNSBERGER_LIGHT = "#8CC8E8";
const LANDER = "#D55E00";
const LANDER_LIGHT = "#F2B176";
const NEUTRAL = "#D6DCE1";

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

function brownsbergerShare(row: ResultRow) {
  const twoCandidateVotes = row.brownsberger_votes + row.lander_votes;
  return twoCandidateVotes ? (row.brownsberger_votes / twoCandidateVotes) * 100 : 0;
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
  const [election, setElection] = useState<ElectionMeta | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/assets/data/results.csv").then((response) => response.text()),
      fetch("/assets/data/district-precincts.geojson").then((response) => response.json()),
      fetch("/assets/data/sources.json").then((response) => response.json()),
      fetch("/assets/data/election.json").then((response) => response.json()),
    ])
      .then(([csv, geography, sourceList, electionMeta]) => {
        setRows(parseCsv(csv));
        setGeo(geography as FeatureCollection);
        setSources(sourceList as Source[]);
        setElection(electionMeta as ElectionMeta);
      })
      .catch(() => setError("The dashboard data could not be loaded."));
  }, []);

  return { rows, geo, sources, election, error };
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
      if (turnout < 0.2) return "#E8EEF2";
      if (turnout < 0.3) return "#B7CBD6";
      if (turnout < 0.4) return "#668FA4";
      return "#173F53";
    }
    const candidateVotes = row.brownsberger_votes + row.lander_votes;
    const lead = candidateVotes ? (row.brownsberger_votes - row.lander_votes) / candidateVotes : 0;
    if (Math.abs(lead) < 0.01) return NEUTRAL;
    const strongLead = Math.abs(lead) >= 0.1;
    return row.brownsberger_votes > row.lander_votes
      ? strongLead ? BROWNSBERGER : BROWNSBERGER_LIGHT
      : strongLead ? LANDER : LANDER_LIGHT;
  };

  const featureCenter = (feature: PrecinctFeature) => {
    const points = allCoordinates(feature.geometry);
    const center = points.reduce(
      (sum, point) => [sum[0] + point[0], sum[1] + point[1]],
      [0, 0],
    );
    return project([center[0] / points.length, center[1] / points.length]);
  };

  const turnoutMarkerRadius = (row: ResultRow) => {
    const turnout = row.ballots_cast_total / row.registered_voters;
    const scaled = Math.max(0, Math.min(1, (turnout - 0.1) / 0.35));
    return 3.5 + scaled * 7.5;
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
                aria-label={row ? `${precinctLabel(row)}. Brownsberger ${row.brownsberger_votes} votes, ${percent(brownsbergerShare(row))} of the two-candidate vote. Lander ${row.lander_votes} votes. Turnout ${percent((row.ballots_cast_total / row.registered_voters) * 100)}.` : feature.properties.WP_NAME}
                onMouseMove={(event) => moveTooltip(event, id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered({ id, x: 470, y: 95, maxX: 546 })}
                onBlur={() => setHovered(null)}
                onClick={() => onSelect(id)}
                onPointerUp={(event) => {
                  if (event.pointerType !== "mouse") {
                    setHovered(null);
                    onSelect(id);
                  }
                }}
              />
            );
          })}
          {metric === "lead" ? (
            <g className="turnout-markers" aria-hidden="true">
              {geo.features.map((feature) => {
                const row = lookup.get(resultId(feature));
                if (!row || (city !== "All" && row.municipality !== city)) return null;
                const [cx, cy] = featureCenter(feature);
                return <circle key={`turnout-${row.id}`} cx={cx} cy={cy} r={turnoutMarkerRadius(row)} />;
              })}
            </g>
          ) : null}
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
            top: Math.max(12, hovered.y - 146),
          }}
        >
          <strong>{precinctLabel(hoveredRow)}</strong>
          <div><span><i style={{ background: BROWNSBERGER }} />Brownsberger</span><b>{number(hoveredRow.brownsberger_votes)}</b></div>
          <div><span><i style={{ background: LANDER }} />Lander</span><b>{number(hoveredRow.lander_votes)}</b></div>
          <div className="tooltip-rule" />
          <div><span>Brownsberger share</span><b>{percent(brownsbergerShare(hoveredRow))}</b></div>
          <div><span>Total primary turnout</span><b>{percent((hoveredRow.ballots_cast_total / hoveredRow.registered_voters) * 100)}</b></div>
        </div>
      ) : null}

      <div className="map-caption">
        <span>Official MassGIS 2022 precinct boundaries</span>
        <span>Click a precinct to keep its details open</span>
      </div>

      {selectedRow ? (
        <div className="selection-card" aria-live="polite">
          <div className="selection-card-head">
            <div>
              <span className="eyebrow">Selected precinct</span>
              <strong>{precinctLabel(selectedRow)}</strong>
            </div>
            <button onClick={() => onSelect("")} aria-label="Clear selected precinct">×</button>
          </div>
          <div className="selection-results">
            <span><b>{number(selectedRow.brownsberger_votes)}</b>Brownsberger</span>
            <span><b>{number(selectedRow.lander_votes)}</b>Lander</span>
            <span><b>{percent(brownsbergerShare(selectedRow))}</b>Brownsberger share</span>
            <span><b>{percent((selectedRow.ballots_cast_total / selectedRow.registered_voters) * 100)}</b>Turnout</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const { rows, geo, sources, election, error } = useDashboardData();
  const [city, setCity] = useState("All");
  const [metric, setMetric] = useState<Metric>("lead");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [showAllRows, setShowAllRows] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "precinct", direction: "asc" });

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

  const sortedRows = useMemo(() => {
    const valueFor = (row: ResultRow): string | number => {
      switch (sort.key) {
        case "registered": return row.registered_voters;
        case "turnout": return row.registered_voters ? row.ballots_cast_total / row.registered_voters : 0;
        case "brownsbergerShare": return brownsbergerShare(row);
        case "brownsberger": return row.brownsberger_votes;
        case "lander": return row.lander_votes;
        case "margin": return Math.abs(row.brownsberger_votes - row.lander_votes);
        default: return precinctLabel(row);
      }
    };

    return [...filteredRows].sort((a, b) => {
      const aValue = valueFor(a);
      const bValue = valueFor(b);
      const comparison = typeof aValue === "string" && typeof bValue === "string"
        ? aValue.localeCompare(bValue, undefined, { numeric: true })
        : Number(aValue) - Number(bValue);
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [filteredRows, sort]);

  const requestSort = (key: SortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "precinct" ? "asc" : "desc" });
  };

  const sortHeader = (key: SortKey, label: string, numeric = false) => {
    const active = sort.key === key;
    const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
    return (
      <th className={numeric ? "numeric" : undefined} aria-sort={ariaSort}>
        <button className={`sort-header${active ? " active" : ""}`} onClick={() => requestSort(key)}>
          <span>{label}</span>
          <span aria-hidden="true">{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
        </button>
      </th>
    );
  };

  const candidateVotes = totals.brownsberger + totals.lander;
  if (error) {
    return <main className="loading-state"><p>{error}</p></main>;
  }

  if (!rows.length || !geo || !election) {
    return <main className="loading-state"><span className="loader" /><p>Loading precinct returns…</p></main>;
  }

  const finalCandidateVotes = election.brownsberger_votes + election.lander_votes;
  const finalBrownsbergerShare = (election.brownsberger_votes / finalCandidateVotes) * 100;
  const finalLanderShare = (election.lander_votes / finalCandidateVotes) * 100;

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
          <a href="#context">Context</a>
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
            <span>{election.status}</span>
            <span>Updated {election.dashboard_updated}</span>
          </div>
          <p className="kicker">Massachusetts State Senate · Democratic primary</p>
          <h1>Brownsberger <span>vs.</span> Lander</h1>
          <p className="district">Suffolk &amp; Middlesex District</p>
          <p className="intro">A precinct-level view of the September 1, 2026 primary across Boston, Cambridge, Watertown, and Belmont.</p>
        </div>

        <aside className="result-card" aria-label="Final recount result summary">
          <div className="result-card-top">
            <span>Final districtwide recount</span>
            <span className="result-chip">Complete {election.recount_completed}</span>
          </div>
          <div className="candidate-row">
            <div>
              <i style={{ background: BROWNSBERGER }} />
              <span>William N. Brownsberger</span>
            </div>
            <strong>{number(election.brownsberger_votes)}</strong>
            <b>{percent(finalBrownsbergerShare, 2)}</b>
          </div>
          <div className="candidate-row">
            <div>
              <i style={{ background: LANDER }} />
              <span>Daniel Lander</span>
            </div>
            <strong>{number(election.lander_votes)}</strong>
            <b>{percent(finalLanderShare, 2)}</b>
          </div>
          <div className="result-bar" aria-hidden="true">
            <span style={{ width: `${finalBrownsbergerShare}%`, background: BROWNSBERGER }} />
            <span style={{ width: `${finalLanderShare}%`, background: LANDER }} />
          </div>
          <div className="margin-note">
            <strong>Brownsberger +{number(election.margin)}</strong>
            <span>after the districtwide recount</span>
          </div>
          <div className="recount-note"><InfoIcon /><span>The final recount totals are {number(election.brownsberger_votes)} to {number(election.lander_votes)}. {election.note}</span></div>
        </aside>
      </section>

      <section className="stat-strip" aria-label="Dataset summary">
        <div><span>Precincts mapped</span><strong>{rows.length}</strong><small>Across 4 municipalities</small></div>
        <div><span>Mapped candidate votes</span><strong>{number(candidateVotes)}</strong><small>{election.precinct_data_label}</small></div>
        <div><span>Primary turnout</span><strong>{percent((totals.ballots / totals.registered) * 100)}</strong><small>{number(totals.ballots)} of {number(totals.registered)} registered</small></div>
        <div><span>Closest precincts</span><strong>{rows.filter((row) => Math.abs(row.brownsberger_votes - row.lander_votes) <= 10).length}</strong><small>Separated by 10 votes or fewer</small></div>
      </section>

      <section className="map-section" id="map">
        <div className="section-heading map-heading">
          <div>
            <p className="section-number">01 / EXPLORE</p>
            <h2>Precinct map</h2>
            <p>Color shows the candidate lead; circle size shows turnout at the same time. On a phone, tap a precinct once to open its full details.</p>
          </div>
          <div className="metric-control" aria-label="Map display metric">
            <button
              className={metric === "lead" ? "active" : ""}
              aria-pressed={metric === "lead"}
              onClick={() => setMetric("lead")}
            >
              Result + turnout
            </button>
            <button
              className={metric === "turnout" ? "active" : ""}
              aria-pressed={metric === "turnout"}
              onClick={() => setMetric("turnout")}
            >
              Turnout only
            </button>
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
                  <div className="legend-thresholds" aria-label="Two-candidate percentage-point lead thresholds">
                    <span className="candidate-key"><b style={{ background: BROWNSBERGER }}>B</b>B lead ≥10 pts</span>
                    <span className="candidate-key"><b style={{ background: BROWNSBERGER_LIGHT, color: "#10212b" }}>B</b>B lead 1–9.9 pts</span>
                    <span className="candidate-key"><b style={{ background: NEUTRAL, color: "#10212b" }}>≈</b>Within 1 pt</span>
                    <span className="candidate-key"><b style={{ background: LANDER_LIGHT, color: "#10212b" }}>L</b>L lead 1–9.9 pts</span>
                    <span className="candidate-key"><b style={{ background: LANDER }}>L</b>L lead ≥10 pts</span>
                  </div>
                  <span className="turnout-size-legend"><i /><i /><i />Larger circle = higher turnout</span>
                  <small>Lead = percentage-point difference in the two-candidate vote.</small>
                </>
              ) : (
                <>
                  <span className="turnout-bin"><i style={{ background: "#E8EEF2" }} />Under 20%</span>
                  <span className="turnout-bin"><i style={{ background: "#B7CBD6" }} />20–29.9%</span>
                  <span className="turnout-bin"><i style={{ background: "#668FA4" }} />30–39.9%</span>
                  <span className="turnout-bin"><i style={{ background: "#173F53" }} />40%+</span>
                  <small>Total primary ballots ÷ registered voters.</small>
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
                      <span><i style={{ background: BROWNSBERGER }} />{number(item.brownsberger)} B votes</span>
                      <span><i style={{ background: LANDER }} />{number(item.lander)} L votes</span>
                      <span className="city-share">{percent(bShare)} Brownsberger</span>
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
                {sortHeader("precinct", "Precinct")}
                {sortHeader("registered", "Registered", true)}
                {sortHeader("turnout", "Total turnout", true)}
                {sortHeader("brownsbergerShare", "Brownsberger %", true)}
                {sortHeader("brownsberger", "Brownsberger", true)}
                {sortHeader("lander", "Lander", true)}
                {sortHeader("margin", "Two-candidate margin", true)}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.slice(0, showAllRows ? undefined : 12).map((row) => {
                const difference = row.brownsberger_votes - row.lander_votes;
                return (
                  <tr key={row.id} onClick={() => { setSelectedId(row.id); document.querySelector("#map")?.scrollIntoView({ behavior: "smooth" }); }}>
                    <td><strong>{row.ward ? `Ward ${row.ward} · Pct. ${row.precinct}` : `Precinct ${row.precinct}`}</strong><span>{row.municipality}</span></td>
                    <td className="numeric">{number(row.registered_voters)}</td>
                    <td className="numeric"><strong>{percent((row.ballots_cast_total / row.registered_voters) * 100)}</strong><span>{number(row.ballots_cast_total)} ballots</span></td>
                    <td className="numeric"><strong>{percent(brownsbergerShare(row))}</strong><span>two-candidate share</span></td>
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

      <section className="context-section" id="context">
        <div className="section-heading">
          <div>
            <p className="section-number">03 / ADD CONTEXT</p>
            <h2>Demographics and primary participation</h2>
            <p>Official sources can add context, but Census geographies and election precincts must be matched carefully.</p>
          </div>
        </div>

        <div className="context-grid">
          <article>
            <span className="context-label">Census profiles</span>
            <h3>Social and economic context</h3>
            <p>The 2020–2024 ACS 5-year data covers income, education, housing, age, race, and other characteristics at tract and block-group levels.</p>
            <a href="https://www.census.gov/acs/www/data/data-tables-and-tools/data-profiles/" target="_blank" rel="noreferrer">Open ACS data profiles <ExternalIcon /></a>
          </article>
          <article>
            <span className="context-label">Voting-age population</span>
            <h3>Citizen voting-age population</h3>
            <p>The Census Bureau&apos;s 2020–2024 CVAP file provides race and ethnicity estimates for tracts, block groups, and legislative districts.</p>
            <a href="https://www.census.gov/programs-surveys/decennial-census/about/voting-rights/cvap/2020-2024-CVAP.html" target="_blank" rel="noreferrer">Open the CVAP dataset <ExternalIcon /></a>
          </article>
          <article>
            <span className="context-label">Primary voter enrollment</span>
            <h3>{number(totals.demBallots)} Democratic ballots in the mapped file</h3>
            <p>Published returns do not split these voters into registered Democrats versus unenrolled voters. State registration statistics show the eligible party mix; marked primary lists are needed to measure who participated. Publish only precinct aggregates, not voter names.</p>
            <div className="context-links">
              <a href="https://www.sec.state.ma.us/divisions/elections/research-and-statistics/statistics-hub.htm" target="_blank" rel="noreferrer">Enrollment data <ExternalIcon /></a>
              <a href="https://malegislature.gov/Laws/GeneralLaws/PartI/TitleVIII/Chapter53/Section37" target="_blank" rel="noreferrer">Marked-list law <ExternalIcon /></a>
              <a href="https://www.sec.state.ma.us/divisions/elections/voting-information/vote-primary.htm" target="_blank" rel="noreferrer">Primary rules <ExternalIcon /></a>
            </div>
          </article>
        </div>
        <p className="context-caution"><InfoIcon /><span><strong>Why no precinct demographic numbers yet?</strong> The dashboard uses 2022 Massachusetts precinct boundaries, while ACS estimates are published for Census tracts and block groups. A defensible precinct estimate needs a documented population-weighted crosswalk and should retain Census margins of error.</span></p>
      </section>

      <section className="source-section" id="sources">
        <div className="section-heading">
          <div>
            <p className="section-number">04 / VERIFY</p>
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
            <span>3</span><div><strong>Separate final totals from precinct detail</strong><p>The recount total is shown at the top, while the map preserves the published precinct rows so no recount changes are assigned to the wrong precinct.</p></div>
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
          <p>The dashboard reads four plain data files. Election staff can update results in Excel and edit the small election summary file in any text editor.</p>
        </div>
        <ol>
          <li><span>01</span><div><strong>Update results.csv</strong><p>One row per precinct; keep the column names unchanged.</p></div></li>
          <li><span>02</span><div><strong>Update election.json and sources.json</strong><p>Change final totals, status text, dates, and source links without editing the application code.</p></div></li>
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
