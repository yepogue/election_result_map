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

type DemographicRow = {
  precinct_id: string;
  municipality: string;
  ward: string;
  precinct: string;
  population_2020: number;
  housing_units_2020: number;
  acs_population_est: number;
  acs_age_18_34_est: number;
  acs_age_18_34_pct: number;
  acs_age_65_plus_est: number;
  acs_age_65_plus_pct: number;
  acs_bachelors_plus_est: number;
  acs_education_age_25_plus_est: number;
  acs_bachelors_plus_pct: number;
  acs_hispanic_est: number;
  acs_hispanic_pct: number;
  acs_nonhispanic_black_est: number;
  acs_nonhispanic_black_pct: number;
  acs_nonhispanic_asian_est: number;
  acs_nonhispanic_asian_pct: number;
  acs_occupied_households_est: number;
  acs_renter_households_est: number;
  acs_renter_households_pct: number;
  acs_income_households_est: number;
  acs_households_income_below_50k_est: number;
  acs_households_income_below_50k_pct: number;
};

type Source = {
  municipality: string;
  title: string;
  url: string;
  status: string;
  usedFor: string;
};

type ChangeLogEntry = {
  date: string;
  title: string;
  items: string[];
};

type ElectionMeta = {
  data_version: string;
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

type Metric = "lead" | "turnout" | "context";
type ContextMetricKey =
  | "youngAdults"
  | "olderAdults"
  | "collegeDegree"
  | "renters"
  | "incomeBelow50k"
  | "hispanic"
  | "black"
  | "asian";
type ContextMetricDefinition = {
  id: ContextMetricKey;
  label: string;
  legendLabel: string;
  description: string;
  value: (row: DemographicRow) => number;
  numerator: (row: DemographicRow) => number;
  denominator: (row: DemographicRow) => number;
};
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
const CONTEXT_COLORS = ["#F4F1E6", "#CFE2DC", "#91BDB7", "#4D8584", "#174E53"];

const CONTEXT_METRICS: ContextMetricDefinition[] = [
  {
    id: "youngAdults",
    label: "Residents age 18–34",
    legendLabel: "Age 18–34",
    description: "Estimated share of residents age 18 to 34.",
    value: (row) => row.acs_age_18_34_pct,
    numerator: (row) => row.acs_age_18_34_est,
    denominator: (row) => row.acs_population_est,
  },
  {
    id: "olderAdults",
    label: "Residents age 65+",
    legendLabel: "Age 65+",
    description: "Estimated share of residents age 65 or older.",
    value: (row) => row.acs_age_65_plus_pct,
    numerator: (row) => row.acs_age_65_plus_est,
    denominator: (row) => row.acs_population_est,
  },
  {
    id: "collegeDegree",
    label: "Bachelor’s degree or higher",
    legendLabel: "Bachelor’s degree+",
    description: "Estimated share of residents age 25+ with a bachelor’s degree or higher.",
    value: (row) => row.acs_bachelors_plus_pct,
    numerator: (row) => row.acs_bachelors_plus_est,
    denominator: (row) => row.acs_education_age_25_plus_est,
  },
  {
    id: "renters",
    label: "Renter households",
    legendLabel: "Renter households",
    description: "Estimated share of occupied households that rent.",
    value: (row) => row.acs_renter_households_pct,
    numerator: (row) => row.acs_renter_households_est,
    denominator: (row) => row.acs_occupied_households_est,
  },
  {
    id: "incomeBelow50k",
    label: "Household income below $50k",
    legendLabel: "Income below $50k",
    description: "Estimated share of households with annual income below $50,000.",
    value: (row) => row.acs_households_income_below_50k_pct,
    numerator: (row) => row.acs_households_income_below_50k_est,
    denominator: (row) => row.acs_income_households_est,
  },
  {
    id: "hispanic",
    label: "Hispanic residents",
    legendLabel: "Hispanic",
    description: "Estimated share of residents who identify as Hispanic or Latino.",
    value: (row) => row.acs_hispanic_pct,
    numerator: (row) => row.acs_hispanic_est,
    denominator: (row) => row.acs_population_est,
  },
  {
    id: "black",
    label: "Non-Hispanic Black residents",
    legendLabel: "Non-Hispanic Black",
    description: "Estimated share of residents who are non-Hispanic and Black alone.",
    value: (row) => row.acs_nonhispanic_black_pct,
    numerator: (row) => row.acs_nonhispanic_black_est,
    denominator: (row) => row.acs_population_est,
  },
  {
    id: "asian",
    label: "Non-Hispanic Asian residents",
    legendLabel: "Non-Hispanic Asian",
    description: "Estimated share of residents who are non-Hispanic and Asian alone.",
    value: (row) => row.acs_nonhispanic_asian_pct,
    numerator: (row) => row.acs_nonhispanic_asian_est,
    denominator: (row) => row.acs_population_est,
  },
];

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

function parseDemographicCsv(text: string): DemographicRow[] {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  const textFields = new Set(["precinct_id", "municipality", "ward", "precinct"]);

  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(
      headers.map((header, index) => [
        header,
        textFields.has(header) ? values[index] : Number(values[index]),
      ]),
    ) as DemographicRow;
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

function activeContextMetric(key: ContextMetricKey) {
  return CONTEXT_METRICS.find((metric) => metric.id === key) ?? CONTEXT_METRICS[0];
}

function quantile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const position = (values.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

function contextBreaks(rows: DemographicRow[], definition: ContextMetricDefinition) {
  const values = rows
    .map(definition.value)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  return [0.2, 0.4, 0.6, 0.8].map((fraction) => quantile(values, fraction));
}

function contextFill(value: number, breaks: number[]) {
  const bin = breaks.findIndex((breakpoint) => value <= breakpoint);
  return CONTEXT_COLORS[bin === -1 ? CONTEXT_COLORS.length - 1 : bin];
}

function aggregateContext(rows: DemographicRow[], definition: ContextMetricDefinition) {
  const numerator = rows.reduce((sum, row) => sum + definition.numerator(row), 0);
  const denominator = rows.reduce((sum, row) => sum + definition.denominator(row), 0);
  return denominator ? (numerator / denominator) * 100 : 0;
}

function contextComparison(value: number, median: number) {
  const difference = value - median;
  if (Math.abs(difference) < 0.05) return "At the district median";
  return `${Math.abs(difference).toFixed(1)} points ${difference > 0 ? "above" : "below"} the district median`;
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
  const [demographics, setDemographics] = useState<DemographicRow[]>([]);
  const [geo, setGeo] = useState<FeatureCollection | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [election, setElection] = useState<ElectionMeta | null>(null);
  const [changelog, setChangelog] = useState<ChangeLogEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadData = async () => {
      const electionMeta = await fetch("/assets/data/election.json", { cache: "no-store" })
        .then((response) => response.json()) as ElectionMeta;
      const version = encodeURIComponent(electionMeta.data_version);
      const [csv, demographicCsv, geography, sourceList, changeLogEntries] = await Promise.all([
        fetch(`/assets/data/results.csv?v=${version}`, { cache: "no-store" }).then((response) => response.text()),
        fetch(`/assets/data/precinct_demographics.csv?v=${version}`, { cache: "no-store" }).then((response) => response.text()),
        fetch(`/assets/data/district-precincts.geojson?v=${version}`, { cache: "no-store" }).then((response) => response.json()),
        fetch(`/assets/data/sources.json?v=${version}`, { cache: "no-store" }).then((response) => response.json()),
        fetch(`/assets/data/changelog.json?v=${version}`, { cache: "no-store" }).then((response) => response.json()),
      ]);

        setRows(parseCsv(csv));
        setDemographics(parseDemographicCsv(demographicCsv));
        setGeo(geography as FeatureCollection);
        setSources(sourceList as Source[]);
        setElection(electionMeta as ElectionMeta);
        setChangelog(changeLogEntries as ChangeLogEntry[]);
    };

    loadData().catch(() => setError("The dashboard data could not be loaded."));
  }, []);

  return { rows, demographics, geo, sources, election, changelog, error };
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
  demographics,
  geo,
  city,
  metric,
  contextMetric,
  breaks,
  contextMedian,
  selectedId,
  onSelect,
}: {
  rows: ResultRow[];
  demographics: DemographicRow[];
  geo: FeatureCollection;
  city: string;
  metric: Metric;
  contextMetric: ContextMetricDefinition;
  breaks: number[];
  contextMedian: number;
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
  const demographicLookup = useMemo(
    () => new Map(demographics.map((row) => [row.precinct_id, row])),
    [demographics],
  );
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
    if (metric === "context") {
      const demographic = demographicLookup.get(row.id);
      return demographic ? contextFill(contextMetric.value(demographic), breaks) : "#E7E5DF";
    }
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

  const leaderMark = (row: ResultRow) => {
    const candidateVotes = row.brownsberger_votes + row.lander_votes;
    const lead = candidateVotes ? (row.brownsberger_votes - row.lander_votes) / candidateVotes : 0;
    if (Math.abs(lead) < 0.01) return { label: "≈", className: "close" };
    return row.brownsberger_votes > row.lander_votes
      ? { label: "B", className: "brownsberger" }
      : { label: "L", className: "lander" };
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
  const hoveredDemographic = hovered ? demographicLookup.get(hovered.id) : undefined;
  const selectedRow = lookup.get(selectedId);
  const selectedDemographic = demographicLookup.get(selectedId);

  return (
    <div className="map-stage" ref={wrapRef}>
      <svg className="precinct-map" viewBox="0 0 940 610" role="group" aria-labelledby="map-title map-desc">
        <title id="map-title">Precinct-level election result map</title>
        <desc id="map-desc">Official Massachusetts precinct boundaries shaded by candidate lead, primary turnout, or selected Census context.</desc>
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
                aria-label={row ? `${precinctLabel(row)}. Brownsberger ${row.brownsberger_votes} votes, ${percent(brownsbergerShare(row))} of the two-candidate vote. Lander ${row.lander_votes} votes. Turnout ${percent((row.ballots_cast_total / row.registered_voters) * 100)}.${metric === "context" && demographicLookup.get(id) ? ` ${contextMetric.label} ${percent(contextMetric.value(demographicLookup.get(id)!))}.` : ""}` : feature.properties.WP_NAME}
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
          {metric === "context" ? (
            <g className="context-result-markers" aria-hidden="true">
              {geo.features.map((feature) => {
                const row = lookup.get(resultId(feature));
                if (!row || (city !== "All" && row.municipality !== city)) return null;
                const [cx, cy] = featureCenter(feature);
                const marker = leaderMark(row);
                return (
                  <g key={`result-${row.id}`} transform={`translate(${cx} ${cy})`}>
                    <circle r="9.5" />
                    <text className={marker.className} textAnchor="middle" dominantBaseline="central">{marker.label}</text>
                  </g>
                );
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
          {metric === "context" && hoveredDemographic ? (
            <div className="tooltip-context"><span>{contextMetric.legendLabel}</span><b>{percent(contextMetric.value(hoveredDemographic))}</b></div>
          ) : null}
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
          {metric === "context" && selectedDemographic ? (
            <div className="selection-context">
              <span>{contextMetric.label}</span>
              <strong>{percent(contextMetric.value(selectedDemographic))}</strong>
              <small>{contextComparison(contextMetric.value(selectedDemographic), contextMedian)}</small>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const { rows, demographics, geo, sources, election, changelog, error } = useDashboardData();
  const [city, setCity] = useState("All");
  const [metric, setMetric] = useState<Metric>("lead");
  const [contextMetricKey, setContextMetricKey] = useState<ContextMetricKey>("collegeDegree");
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

  const contextDefinition = activeContextMetric(contextMetricKey);
  const demographicBreaks = useMemo(
    () => contextBreaks(demographics, contextDefinition),
    [demographics, contextDefinition],
  );
  const contextMedian = useMemo(() => {
    const values = demographics
      .map(contextDefinition.value)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    return quantile(values, 0.5);
  }, [demographics, contextDefinition]);
  const cityContext = useMemo(
    () => CITY_ORDER.slice(1).map((name) => ({
      name,
      value: aggregateContext(
        demographics.filter((row) => row.municipality === name),
        contextDefinition,
      ),
    })),
    [demographics, contextDefinition],
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

  if (!rows.length || !demographics.length || !geo || !election) {
    return <main className="loading-state"><span className="loader" /><p>Loading precinct returns…</p></main>;
  }

  const finalCandidateVotes = election.brownsberger_votes + election.lander_votes;
  const finalBrownsbergerShare = (election.brownsberger_votes / finalCandidateVotes) * 100;
  const finalLanderShare = (election.lander_votes / finalCandidateVotes) * 100;
  const dataVersion = encodeURIComponent(election.data_version);
  const contextLegendLabels = [
    `≤ ${percent(demographicBreaks[0])}`,
    `${percent(demographicBreaks[0])}–${percent(demographicBreaks[1])}`,
    `${percent(demographicBreaks[1])}–${percent(demographicBreaks[2])}`,
    `${percent(demographicBreaks[2])}–${percent(demographicBreaks[3])}`,
    `> ${percent(demographicBreaks[3])}`,
  ];

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
        <a className="header-download" href={`/assets/data/results.csv?v=${dataVersion}`} download>
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
            <p>Switch between election results, turnout, and community context. On a phone, tap a precinct once to see the result and selected context together.</p>
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
            <button
              className={metric === "context" ? "active" : ""}
              aria-pressed={metric === "context"}
              onClick={() => setMetric("context")}
            >
              Community context
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

        {metric === "context" ? (
          <div className="context-picker">
            <label htmlFor="context-metric">Shade precincts by</label>
            <select
              id="context-metric"
              value={contextMetricKey}
              onChange={(event) => setContextMetricKey(event.target.value as ContextMetricKey)}
            >
              {CONTEXT_METRICS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <p>{contextDefinition.description} Darker shading means a higher value; the letter shows who led the precinct.</p>
          </div>
        ) : null}

        <div className="map-grid">
          <div>
            <ElectionMap
              rows={rows}
              demographics={demographics}
              geo={geo}
              city={city}
              metric={metric}
              contextMetric={contextDefinition}
              breaks={demographicBreaks}
              contextMedian={contextMedian}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
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
              ) : metric === "turnout" ? (
                <>
                  <span className="turnout-bin"><i style={{ background: "#E8EEF2" }} />Under 20%</span>
                  <span className="turnout-bin"><i style={{ background: "#B7CBD6" }} />20–29.9%</span>
                  <span className="turnout-bin"><i style={{ background: "#668FA4" }} />30–39.9%</span>
                  <span className="turnout-bin"><i style={{ background: "#173F53" }} />40%+</span>
                  <small>Total primary ballots ÷ registered voters.</small>
                </>
              ) : (
                <>
                  <div className="legend-thresholds context-thresholds" aria-label={`${contextDefinition.legendLabel} district quintiles`}>
                    {CONTEXT_COLORS.map((color, index) => (
                      <span className="context-key" key={`${contextMetricKey}-${index}`}>
                        <i style={{ background: color }} />{contextLegendLabels[index]}
                      </span>
                    ))}
                  </div>
                  <span className="context-marker-key"><b>B</b><b>L</b><b>≈</b>Precinct leader</span>
                  <small>{contextDefinition.legendLabel}; district quintiles from modeled ACS precinct estimates.</small>
                </>
              )}
            </div>
          </div>

          {metric === "context" ? (
            <aside className="city-summary context-summary">
              <p className="eyebrow">Compare without leaving the map</p>
              <h3>{contextDefinition.legendLabel} by city</h3>
              <p className="context-summary-intro">District median precinct: <strong>{percent(contextMedian)}</strong>. Each city card keeps the election result beside the demographic estimate.</p>
              <div className="context-city-list">
                {cityContext.map((item) => {
                  const electionTotal = cityTotals.find((total) => total.name === item.name)!;
                  const twoCandidateVotes = electionTotal.brownsberger + electionTotal.lander;
                  const bShare = twoCandidateVotes ? (electionTotal.brownsberger / twoCandidateVotes) * 100 : 0;
                  return (
                    <button key={item.name} onClick={() => setCity(item.name)} className={city === item.name ? "selected" : ""}>
                      <div className="city-title"><strong>{item.name}</strong><span>{electionTotal.precincts} precincts</span></div>
                      <div className="context-city-value"><strong>{percent(item.value)}</strong><span>{contextDefinition.legendLabel}</span></div>
                      <div className="context-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, item.value)}%` }} /></div>
                      <div className="context-election-line">
                        <span><i style={{ background: BROWNSBERGER }} />Brownsberger {percent(bShare)}</span>
                        <span>{percent((electionTotal.ballots / electionTotal.registered) * 100)} turnout</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="status-key">
                <InfoIcon />
                <p><strong>Estimated context, certified result.</strong> Demographic values are 2020–2024 ACS estimates allocated from block groups. Election letters and percentages use certified post-recount results.</p>
              </div>
            </aside>
          ) : (
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
                <p><strong>Certified recount snapshot.</strong> All 59 contest rows come from the Secretary of the Commonwealth&apos;s post-recount precinct export. Registration and total-turnout fields come from the municipalities&apos; election-wide precinct reports.</p>
              </div>
            </aside>
          )}
        </div>
      </section>

      <section className="data-section" id="data">
        <div className="section-heading">
          <div>
            <p className="section-number">02 / INSPECT</p>
            <h2>Precinct data</h2>
            <p>Search the certified post-recount rows or download the complete machine-readable dataset.</p>
          </div>
          <div className="download-group">
            <a className="download-primary" href={`/assets/data/results.csv?v=${dataVersion}`} download><DownloadIcon />Results CSV</a>
            <a className="download-secondary" href={`/assets/data/precinct_demographics.csv?v=${dataVersion}`} download><DownloadIcon />Context CSV</a>
            <a className="download-secondary" href={`/assets/data/district-precincts.geojson?v=${dataVersion}`} download><DownloadIcon />Boundaries</a>
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
            <h2>How the context layer works</h2>
            <p>The comparison is built into the map. These notes explain which values are direct counts, which are estimates, and what they cannot tell us.</p>
          </div>
        </div>

        <div className="context-grid">
          <article>
            <span className="context-label">Direct block counts</span>
            <h3>1,819 Census blocks matched to 59 precincts</h3>
            <p>Each 2020 Census block is assigned to the 2022 precinct with the largest geographic overlap. The resulting population total matches MassGIS in every precinct.</p>
            <a href={`/assets/data/census_block_to_precinct.csv?v=${dataVersion}`} download>Download block crosswalk <DownloadIcon /></a>
          </article>
          <article>
            <span className="context-label">Modeled ACS context</span>
            <h3>Block populations become allocation weights</h3>
            <p>Age, race and ethnicity, education, tenure, and household-income values begin as 2020–2024 ACS block-group estimates. Population or housing-unit weights allocate them to precincts.</p>
            <a href={`/assets/data/census_data_dictionary.json?v=${dataVersion}`} target="_blank" rel="noreferrer">Open data dictionary <ExternalIcon /></a>
          </article>
          <article>
            <span className="context-label">Interpret carefully</span>
            <h3>Neighborhood context is not voter behavior</h3>
            <p>A precinct correlation cannot show how an individual or demographic group voted. Published returns also do not split the {number(totals.demBallots)} Democratic ballots between registered Democrats and unenrolled voters.</p>
            <div className="context-links">
              <a href={`/assets/data/precinct_demographics.csv?v=${dataVersion}`} download>Context CSV <DownloadIcon /></a>
              <a href={`/assets/data/census_crosswalk_qa.json?v=${dataVersion}`} target="_blank" rel="noreferrer">QA report <ExternalIcon /></a>
            </div>
          </article>
        </div>
        <p className="context-caution"><InfoIcon /><span><strong>Read the map as an estimate, not a head count.</strong> The context layer uses ACS sampling estimates and a documented geographic allocation. Click any precinct to compare its value with the district median; download the CSV for margins of error and underlying counts.</span></p>
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
            <span>1</span><div><strong>Keep election counts intact</strong><p>Candidate votes and ballots remain official counts. Election percentages are calculated in the browser.</p></div>
          </article>
          <article>
            <span>2</span><div><strong>Build context from blocks</strong><p>2020 Census blocks connect 2020–2024 ACS block-group estimates to the 2022 precinct map.</p></div>
          </article>
          <article>
            <span>3</span><div><strong>Show uncertainty honestly</strong><p>The map labels demographic values as estimates; downloadable files retain margins of error, weights, and QA checks.</p></div>
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
          <p>Routine election updates still use plain data files. Census context is rebuilt with one documented helper, so maintainers do not hand-edit geographic weights.</p>
        </div>
        <ol>
          <li><span>01</span><div><strong>Update results.csv</strong><p>One row per precinct; keep the column names unchanged.</p></div></li>
          <li><span>02</span><div><strong>Refresh Census context when needed</strong><p>Run the one-command helper, then confirm every check in the generated QA report is true.</p></div></li>
          <li><span>03</span><div><strong>Update notes and republish</strong><p>Edit source links and the public change log, then run the documented site build.</p></div></li>
        </ol>
      </section>

      <section className="changelog-section" id="changelog">
        <div className="changelog-heading">
          <p className="section-number">LATEST UPDATES</p>
          <h2>Change log</h2>
          <p>A plain-language record of changes to the published dashboard and its data.</p>
        </div>
        <div className="changelog-list">
          {changelog.map((entry, index) => (
            <article key={`${entry.date}-${entry.title}-${index}`}>
              <time>{entry.date}</time>
              <div>
                <h3>{entry.title}</h3>
                <ul>
                  {entry.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </article>
          ))}
        </div>
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
