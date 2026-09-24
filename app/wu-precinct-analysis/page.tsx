"use client";

/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useMemo, useRef, useState } from "react";

type ViewMode = "challenger" | "endorsed";
type WuMeasure =
  | "wu_2021_preliminary_share_pct"
  | "wu_2021_final_share_pct"
  | "wu_2025_preliminary_share_pct";

type AnalysisRow = {
  race_id: string;
  district: string;
  precinct_id: string;
  ward: string;
  precinct: string;
  challenger: string;
  incumbent: string;
  endorsed_candidate: string;
  challenger_votes: number;
  incumbent_votes: number;
  extra_candidate_votes: number;
  two_candidate_votes: number;
  contest_ballots: number;
  challenger_share_pct: number;
  endorsed_share_pct: number;
  wu_2021_preliminary_share_pct: number;
  wu_2021_final_share_pct: number;
  wu_2025_preliminary_share_pct: number;
  outcome_note: string;
};

type SummaryRow = {
  view: ViewMode;
  viewLabel: string;
  raceId: string;
  district: string;
  candidate: string;
  wuMeasure: string;
  wuMeasureLabel: string;
  precinctCount: number;
  twoCandidateVotes: number;
  slope: number;
  intercept: number;
  rSquared: number;
  wuWeakShare: number;
  wuStrongShare: number;
  weakToStrongDifferencePp: number;
  candidateShareAtWeak: number;
  candidateShareAtStrong: number;
  rawSlopePpPer10PpWu: number;
};

type Source = {
  id: string;
  title: string;
  url: string;
  downloadUrl: string;
  status: string;
  usedFor: string;
};

type QaReport = {
  generatedOn: string;
  checks: Record<string, boolean>;
  crosswalk: {
    oldPrecinctCount: number;
    currentPrecinctCount: number;
    crosswalkRowCount: number;
    splitOldPrecinctCount: number;
  };
  analysis: {
    rowCount: number;
    racePrecinctCounts: Record<string, number>;
  };
};

type TooltipState = {
  row: AnalysisRow;
  x: number;
  y: number;
} | null;

type PooledModel = {
  slope: number;
  intercept: number;
  rSquared: number;
  wuWeak: number;
  wuStrong: number;
  challengerAtWeak: number;
  challengerAtStrong: number;
  weakToStrongDifference: number;
  adjustedSlope: number;
  adjustedRSquared: number;
};

type SortKey =
  | "district"
  | "precinct"
  | "candidateShare"
  | "candidateVotes"
  | WuMeasure;

const RACE_ORDER = ["first-suffolk", "suffolk-middlesex", "norfolk-suffolk"];
const RACE_SHORT: Record<string, string> = {
  "first-suffolk": "Gayle vs. Collins",
  "suffolk-middlesex": "Lander vs. Brownsberger",
  "norfolk-suffolk": "Yu vs. Rush",
};

const WU_MEASURES: { id: WuMeasure; short: string; label: string }[] = [
  {
    id: "wu_2021_preliminary_share_pct",
    short: "2021 preliminary",
    label: "Wu share, 2021 mayoral preliminary",
  },
  {
    id: "wu_2021_final_share_pct",
    short: "2021 final",
    label: "Wu share, 2021 mayoral final",
  },
  {
    id: "wu_2025_preliminary_share_pct",
    short: "2025 preliminary",
    label: "Wu share, 2025 mayoral preliminary",
  },
];

const SERIES_COLORS: Record<string, string> = {
  "2021 preliminary": "#0072B2",
  "2021 final": "#009E73",
  "2025 preliminary": "#D55E00",
};

function number(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function percent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

function signedPoints(value: number, digits = 1) {
  if (Math.abs(value) < 0.05) return "0.0 points";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)} points`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function extent(values: number[]) {
  return [Math.min(...values), Math.max(...values)] as const;
}

function paddedDomain(values: number[], fullScale: boolean, pad = 4) {
  if (fullScale) return [0, 100] as const;
  const [minimum, maximum] = extent(values);
  return [
    Math.max(0, Math.floor((minimum - pad) / 5) * 5),
    Math.min(100, Math.ceil((maximum + pad) / 5) * 5),
  ] as const;
}

function ticks(domain: readonly [number, number]) {
  const [minimum, maximum] = domain;
  const middle = (minimum + maximum) / 2;
  return [minimum, middle, maximum];
}

function quantile(values: number[], probability: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function pooledChallengerModel(rows: AnalysisRow[], measure: WuMeasure): PooledModel | null {
  if (!rows.length) return null;
  const weightTotal = rows.reduce((sum, row) => sum + row.two_candidate_votes, 0);
  const xMean = rows.reduce((sum, row) => sum + row.two_candidate_votes * row[measure], 0) / weightTotal;
  const yMean = rows.reduce((sum, row) => sum + row.two_candidate_votes * row.challenger_share_pct, 0) / weightTotal;
  const covariance = rows.reduce(
    (sum, row) => sum + row.two_candidate_votes * (row[measure] - xMean) * (row.challenger_share_pct - yMean),
    0,
  );
  const xVariance = rows.reduce(
    (sum, row) => sum + row.two_candidate_votes * (row[measure] - xMean) ** 2,
    0,
  );
  const slope = xVariance ? covariance / xVariance : 0;
  const intercept = yMean - slope * xMean;
  const fittedError = rows.reduce(
    (sum, row) => sum + row.two_candidate_votes * (row.challenger_share_pct - (intercept + slope * row[measure])) ** 2,
    0,
  );
  const totalError = rows.reduce(
    (sum, row) => sum + row.two_candidate_votes * (row.challenger_share_pct - yMean) ** 2,
    0,
  );
  const wuWeak = quantile(rows.map((row) => row[measure]), 0.25);
  const wuStrong = quantile(rows.map((row) => row[measure]), 0.75);

  const raceMeans = Object.fromEntries(RACE_ORDER.map((raceId) => {
    const raceRows = rows.filter((row) => row.race_id === raceId);
    const raceWeight = raceRows.reduce((sum, row) => sum + row.two_candidate_votes, 0);
    return [raceId, {
      x: raceRows.reduce((sum, row) => sum + row.two_candidate_votes * row[measure], 0) / raceWeight,
      y: raceRows.reduce((sum, row) => sum + row.two_candidate_votes * row.challenger_share_pct, 0) / raceWeight,
    }];
  })) as Record<string, { x: number; y: number }>;
  const adjustedCovariance = rows.reduce((sum, row) => {
    const raceMean = raceMeans[row.race_id];
    return sum + row.two_candidate_votes * (row[measure] - raceMean.x) * (row.challenger_share_pct - raceMean.y);
  }, 0);
  const adjustedXVariance = rows.reduce((sum, row) => {
    const raceMean = raceMeans[row.race_id];
    return sum + row.two_candidate_votes * (row[measure] - raceMean.x) ** 2;
  }, 0);
  const adjustedSlope = adjustedXVariance ? adjustedCovariance / adjustedXVariance : 0;
  const adjustedError = rows.reduce((sum, row) => {
    const raceMean = raceMeans[row.race_id];
    const xDifference = row[measure] - raceMean.x;
    const yDifference = row.challenger_share_pct - raceMean.y;
    return sum + row.two_candidate_votes * (yDifference - adjustedSlope * xDifference) ** 2;
  }, 0);
  const adjustedTotalError = rows.reduce((sum, row) => {
    const raceMean = raceMeans[row.race_id];
    return sum + row.two_candidate_votes * (row.challenger_share_pct - raceMean.y) ** 2;
  }, 0);

  return {
    slope,
    intercept,
    rSquared: totalError ? 1 - fittedError / totalError : 0,
    wuWeak,
    wuStrong,
    challengerAtWeak: intercept + slope * wuWeak,
    challengerAtStrong: intercept + slope * wuStrong,
    weakToStrongDifference: slope * (wuStrong - wuWeak),
    adjustedSlope,
    adjustedRSquared: adjustedTotalError ? 1 - adjustedError / adjustedTotalError : 0,
  };
}

function candidateName(row: AnalysisRow, view: ViewMode) {
  return view === "challenger" ? row.challenger : row.endorsed_candidate;
}

function candidateShare(row: AnalysisRow, view: ViewMode) {
  return view === "challenger" ? row.challenger_share_pct : row.endorsed_share_pct;
}

function candidateVotes(row: AnalysisRow, view: ViewMode) {
  if (view === "challenger" || row.endorsed_candidate === row.challenger) {
    return row.challenger_votes;
  }
  return row.incumbent_votes;
}

function ScatterPlot({
  rows,
  summary,
  measure,
  view,
  xDomain,
  yDomain,
}: {
  rows: AnalysisRow[];
  summary: SummaryRow;
  measure: (typeof WU_MEASURES)[number];
  view: ViewMode;
  xDomain: readonly [number, number];
  yDomain: readonly [number, number];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const width = 420;
  const height = 300;
  const margin = { top: 22, right: 18, bottom: 52, left: 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const xScale = (value: number) =>
    margin.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerWidth;
  const yScale = (value: number) =>
    margin.top + innerHeight - ((value - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerHeight;
  const voteExtent = extent(rows.map((row) => row.two_candidate_votes));
  const radius = (votes: number) => {
    const spread = Math.max(1, voteExtent[1] - voteExtent[0]);
    return 3.2 + Math.sqrt((votes - voteExtent[0]) / spread) * 4.4;
  };
  const candidate = candidateName(rows[0], view);
  const showTooltip = (event: React.MouseEvent<SVGCircleElement>, row: AnalysisRow) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      row,
      x: clamp(event.clientX - rect.left + 12, 8, rect.width - 230),
      y: clamp(event.clientY - rect.top - 10, 8, rect.height - 150),
    });
  };
  const weakX = summary.wuWeakShare * 100;
  const strongX = summary.wuStrongShare * 100;
  const weakY = summary.candidateShareAtWeak * 100;
  const strongY = summary.candidateShareAtStrong * 100;

  return (
    <div className="scatter-subpanel">
      <div className="scatter-subpanel-heading">
        <strong>{measure.short}</strong>
        <span>25th→75th: <b>{signedPoints(summary.weakToStrongDifferencePp)}</b></span>
      </div>
      <div className="scatter-wrap" ref={wrapRef}>
        <svg
          className="scatter-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${candidate} precinct share compared with Michelle Wu's ${measure.short} precinct share in the ${rows[0].district} race. The comparable 25th-to-75th percentile result is ${signedPoints(summary.weakToStrongDifferencePp)}.`}
          onMouseLeave={() => setTooltip(null)}
        >
          <title>{`${candidate} and Wu strength — ${measure.short}`}</title>
          <rect
            className="chart-frame"
            x={margin.left}
            y={margin.top}
            width={innerWidth}
            height={innerHeight}
          />
          {ticks(yDomain).map((tick) => (
            <g key={`y-${tick}`}>
              <line
                className="chart-gridline"
                x1={margin.left}
                x2={width - margin.right}
                y1={yScale(tick)}
                y2={yScale(tick)}
              />
              <text className="chart-tick" x={margin.left - 9} y={yScale(tick) + 4} textAnchor="end">
                {percent(tick, 0)}
              </text>
            </g>
          ))}
          {ticks(xDomain).map((tick) => (
            <g key={`x-${tick}`}>
              <line
                className="chart-gridline"
                x1={xScale(tick)}
                x2={xScale(tick)}
                y1={margin.top}
                y2={height - margin.bottom}
              />
              <text className="chart-tick" x={xScale(tick)} y={height - margin.bottom + 20} textAnchor="middle">
                {percent(tick, 0)}
              </text>
            </g>
          ))}
          {yDomain[0] <= 50 && yDomain[1] >= 50 ? (
            <g>
              <line
                className="chart-half-line"
                x1={margin.left}
                x2={width - margin.right}
                y1={yScale(50)}
                y2={yScale(50)}
              />
              <text className="chart-reference-label" x={width - margin.right - 5} y={yScale(50) - 6} textAnchor="end">
                50% candidate support
              </text>
            </g>
          ) : null}
          {rows.map((row) => (
            <circle
              key={row.precinct_id}
              className="chart-dot"
              cx={xScale(row[measure.id])}
              cy={yScale(candidateShare(row, view))}
              r={radius(row.two_candidate_votes)}
              onMouseEnter={(event) => showTooltip(event, row)}
              onMouseMove={(event) => showTooltip(event, row)}
              onClick={(event) => showTooltip(event, row)}
            >
              <title>{`Ward ${row.ward}, Precinct ${row.precinct}: ${candidate} ${percent(candidateShare(row, view))}; Wu ${percent(row[measure.id])}; ${number(row.two_candidate_votes)} two-candidate votes.`}</title>
            </circle>
          ))}
          <line
            className="chart-standardized-line"
            x1={xScale(weakX)}
            x2={xScale(strongX)}
            y1={yScale(weakY)}
            y2={yScale(strongY)}
          />
          <circle className="chart-standardized-endpoint" cx={xScale(weakX)} cy={yScale(weakY)} r="4.5" />
          <circle className="chart-standardized-endpoint" cx={xScale(strongX)} cy={yScale(strongY)} r="4.5" />
          <text className="chart-axis-title" x={margin.left + innerWidth / 2} y={height - 8} textAnchor="middle">
            Wu vote share
          </text>
          <text
            className="chart-axis-title"
            transform={`translate(15 ${margin.top + innerHeight / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {candidate} two-candidate share
          </text>
        </svg>
        {tooltip ? (
          <div
            className="scatter-tooltip"
            role="status"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <strong>Ward {tooltip.row.ward}, Precinct {tooltip.row.precinct}</strong>
            <span>{candidate}: {percent(candidateShare(tooltip.row, view))} · {number(candidateVotes(tooltip.row, view))} votes</span>
            <span>Wu: {percent(tooltip.row[measure.id])}</span>
            <span>Two-candidate votes: {number(tooltip.row.two_candidate_votes)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PooledChallengerChart({
  rows,
  measure,
  model,
}: {
  rows: AnalysisRow[];
  measure: (typeof WU_MEASURES)[number];
  model: PooledModel;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const width = 960;
  const height = 510;
  const margin = { top: 24, right: 24, bottom: 64, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const xDomain = paddedDomain(rows.map((row) => row[measure.id]), false, 3);
  const yDomain = paddedDomain(rows.map((row) => row.challenger_share_pct), false, 4);
  const xScale = (value: number) => margin.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerWidth;
  const yScale = (value: number) => margin.top + innerHeight - ((value - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerHeight;
  const voteExtent = extent(rows.map((row) => row.two_candidate_votes));
  const radius = (votes: number) => {
    const spread = Math.max(1, voteExtent[1] - voteExtent[0]);
    return 3.5 + Math.sqrt((votes - voteExtent[0]) / spread) * 5;
  };
  const showTooltip = (event: React.MouseEvent<SVGCircleElement>, row: AnalysisRow) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      row,
      x: clamp(event.clientX - rect.left + 12, 8, rect.width - 250),
      y: clamp(event.clientY - rect.top - 10, 8, rect.height - 155),
    });
  };

  return (
    <div className="pooled-chart-wrap" ref={wrapRef}>
      <svg
        className="pooled-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Gayle, Lander, and Yu pooled across ${rows.length} Boston precincts. Between the 25th and 75th percentiles of Wu's ${measure.short} vote, modeled challenger support rises ${model.weakToStrongDifference.toFixed(1)} points.`}
        onMouseLeave={() => setTooltip(null)}
      >
        <title>{`All three challengers compared with Wu's ${measure.short} precinct vote`}</title>
        <rect className="chart-frame" x={margin.left} y={margin.top} width={innerWidth} height={innerHeight} />
        {ticks(yDomain).map((tick) => (
          <g key={`pooled-y-${tick}`}>
            <line className="chart-gridline" x1={margin.left} x2={width - margin.right} y1={yScale(tick)} y2={yScale(tick)} />
            <text className="chart-tick" x={margin.left - 10} y={yScale(tick) + 4} textAnchor="end">{percent(tick, 0)}</text>
          </g>
        ))}
        {ticks(xDomain).map((tick) => (
          <g key={`pooled-x-${tick}`}>
            <line className="chart-gridline" x1={xScale(tick)} x2={xScale(tick)} y1={margin.top} y2={height - margin.bottom} />
            <text className="chart-tick" x={xScale(tick)} y={height - margin.bottom + 22} textAnchor="middle">{percent(tick, 0)}</text>
          </g>
        ))}
        {yDomain[0] <= 50 && yDomain[1] >= 50 ? (
          <g>
            <line className="chart-half-line" x1={margin.left} x2={width - margin.right} y1={yScale(50)} y2={yScale(50)} />
            <text className="chart-reference-label" x={width - margin.right - 6} y={yScale(50) - 7} textAnchor="end">50% challenger support</text>
          </g>
        ) : null}
        {rows.map((row) => (
          <circle
            key={`${row.race_id}-${row.precinct_id}`}
            className="chart-dot pooled-dot"
            cx={xScale(row[measure.id])}
            cy={yScale(row.challenger_share_pct)}
            r={radius(row.two_candidate_votes)}
            onMouseEnter={(event) => showTooltip(event, row)}
            onMouseMove={(event) => showTooltip(event, row)}
            onClick={(event) => showTooltip(event, row)}
          >
            <title>{`${row.challenger}, Ward ${row.ward}, Precinct ${row.precinct}: challenger ${percent(row.challenger_share_pct)}; Wu ${percent(row[measure.id])}.`}</title>
          </circle>
        ))}
        <line
          className="chart-standardized-line"
          x1={xScale(model.wuWeak)}
          x2={xScale(model.wuStrong)}
          y1={yScale(model.challengerAtWeak)}
          y2={yScale(model.challengerAtStrong)}
        />
        <circle className="chart-standardized-endpoint" cx={xScale(model.wuWeak)} cy={yScale(model.challengerAtWeak)} r="5" />
        <circle className="chart-standardized-endpoint" cx={xScale(model.wuStrong)} cy={yScale(model.challengerAtStrong)} r="5" />
        <text className="pooled-line-label" x={xScale(model.wuStrong) - 8} y={yScale(model.challengerAtStrong) - 12} textAnchor="end">
          {signedPoints(model.weakToStrongDifference)}
        </text>
        <text className="chart-axis-title" x={margin.left + innerWidth / 2} y={height - 12} textAnchor="middle">
          Wu vote share — {measure.short}
        </text>
        <text className="chart-axis-title" transform={`translate(17 ${margin.top + innerHeight / 2}) rotate(-90)`} textAnchor="middle">
          Pooled challenger two-candidate share
        </text>
      </svg>
      {tooltip ? (
        <div className="scatter-tooltip pooled-tooltip" role="status" style={{ left: tooltip.x, top: tooltip.y }}>
          <strong>{tooltip.row.challenger} · Ward {tooltip.row.ward}, Precinct {tooltip.row.precinct}</strong>
          <span>{RACE_SHORT[tooltip.row.race_id]}</span>
          <span>Challenger: {percent(tooltip.row.challenger_share_pct)} · {number(tooltip.row.challenger_votes)} votes</span>
          <span>Wu: {percent(tooltip.row[measure.id])}</span>
        </div>
      ) : null}
    </div>
  );
}

function SummaryChart({ rows, view }: { rows: SummaryRow[]; view: ViewMode }) {
  const maximum = Math.max(10, Math.ceil(Math.max(...rows.map((row) => Math.abs(row.weakToStrongDifferencePp))) / 5) * 5);
  const width = 950;
  const rowHeight = 34;
  const groupGap = 48;
  const top = 88;
  const left = 190;
  const right = 76;
  const plotWidth = width - left - right;
  const grouped = RACE_ORDER.map((raceId) => rows.filter((row) => row.raceId === raceId));
  const height = top + grouped.length * rowHeight * 3 + (grouped.length - 1) * groupGap + 30;
  const scale = (value: number) => left + ((value + maximum) / (2 * maximum)) * plotWidth;
  const marks = grouped.flatMap((group, groupIndex) => {
    const groupStart = top + groupIndex * (rowHeight * 3 + groupGap);
    return group.map((row, index) => ({ row, y: groupStart + index * rowHeight }));
  });

  return (
    <div className="summary-chart-wrap">
      <svg
        className="summary-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Modeled difference in ${view === "challenger" ? "challenger" : "Wu-endorsed candidate"} support between typical Wu-strong and Wu-weak Boston precincts.`}
      >
        <title>Typical Wu-strong versus Wu-weak precinct comparison</title>
        <line className="summary-zero" x1={scale(0)} x2={scale(0)} y1={36} y2={height - 28} />
        {[-maximum, -maximum / 2, 0, maximum / 2, maximum].map((tick) => (
          <g key={tick}>
            <line className="summary-grid" x1={scale(tick)} x2={scale(tick)} y1={36} y2={height - 28} />
            <text className="summary-tick" x={scale(tick)} y={24} textAnchor="middle">
              {tick > 0 ? "+" : ""}{tick} pts
            </text>
          </g>
        ))}
        {marks.map(({ row, y }, index) => {
          const x0 = scale(0);
          const x1 = scale(row.weakToStrongDifferencePp);
          const firstInGroup = index % 3 === 0;
          return (
            <g key={`${row.raceId}-${row.wuMeasure}`}>
              {firstInGroup ? (
                <>
                  <text className="summary-race" x={0} y={y - 29}>{row.candidate} support</text>
                  <text className="summary-race-context" x={0} y={y - 13}>{RACE_SHORT[row.raceId]}</text>
                </>
              ) : null}
              <line
                className="summary-mark-line"
                style={{ stroke: SERIES_COLORS[row.wuMeasureLabel] }}
                x1={x0}
                x2={x1}
                y1={y}
                y2={y}
              />
              <circle
                className="summary-mark-dot"
                style={{ fill: SERIES_COLORS[row.wuMeasureLabel] }}
                cx={x1}
                cy={y}
                r={6}
              />
              <text
                className="summary-value"
                x={x1 + (row.weakToStrongDifferencePp >= 0 ? 12 : -12)}
                y={y + 4}
                textAnchor={row.weakToStrongDifferencePp >= 0 ? "start" : "end"}
              >
                {signedPoints(row.weakToStrongDifferencePp).replace(" points", "")}
              </text>
              <text className="summary-measure" x={left - 16} y={y + 5} textAnchor="end">
                {row.wuMeasureLabel}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="analysis-legend" aria-label="Wu election legend">
        {WU_MEASURES.map((measure) => (
          <span key={measure.short}><i style={{ background: SERIES_COLORS[measure.short] }} />{measure.short}</span>
        ))}
      </div>
    </div>
  );
}

function sortButton(
  key: SortKey,
  label: string,
  numeric: boolean,
  sortKey: SortKey,
  direction: "asc" | "desc",
  setSort: (key: SortKey) => void,
) {
  const active = sortKey === key;
  return (
    <th className={numeric ? "numeric" : ""}>
      <button
        className={`sort-header${active ? " active" : ""}`}
        onClick={() => setSort(key)}
        aria-label={`Sort by ${label}${active ? `, currently ${direction === "asc" ? "ascending" : "descending"}` : ""}`}
      >
        <span>{label}</span><span>{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

export default function WuPrecinctAnalysisPage() {
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [summaries, setSummaries] = useState<SummaryRow[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [qa, setQa] = useState<QaReport | null>(null);
  const [view, setView] = useState<ViewMode>("challenger");
  const [fullScale, setFullScale] = useState(false);
  const [pooledMeasure, setPooledMeasure] = useState<WuMeasure>("wu_2025_preliminary_share_pct");
  const [mobileRace, setMobileRace] = useState(RACE_ORDER[0]);
  const [mobileMeasure, setMobileMeasure] = useState<WuMeasure>(WU_MEASURES[0].id);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("candidateShare");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [showAllRows, setShowAllRows] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/assets/data/wu_precinct_analysis.json").then((response) => response.json()),
      fetch("/assets/data/wu_precinct_summary.json").then((response) => response.json()),
      fetch("/assets/data/wu_analysis_sources.json").then((response) => response.json()),
      fetch("/assets/data/wu_analysis_qa.json").then((response) => response.json()),
    ])
      .then(([analysisRows, summaryRows, sourceRows, qaReport]) => {
        setRows(analysisRows as AnalysisRow[]);
        setSummaries(summaryRows as SummaryRow[]);
        setSources(sourceRows as Source[]);
        setQa(qaReport as QaReport);
      })
      .catch(() => setError("The analysis data could not be loaded. Please try refreshing the page."));
  }, []);

  const viewSummaries = useMemo(
    () => summaries.filter((summary) => summary.view === view),
    [summaries, view],
  );
  const xDomains = useMemo(
    () => Object.fromEntries(
      WU_MEASURES.map((measure) => [
        measure.id,
        paddedDomain(rows.map((row) => row[measure.id]), fullScale, 3),
      ]),
    ) as Record<WuMeasure, readonly [number, number]>,
    [rows, fullScale],
  );
  const yDomain = useMemo(
    () => paddedDomain(rows.map((row) => candidateShare(row, view)), fullScale, 4),
    [rows, view, fullScale],
  );
  const totals = useMemo(
    () => RACE_ORDER.map((raceId) => {
      const raceRows = rows.filter((row) => row.race_id === raceId);
      const first = raceRows[0];
      return {
        raceId,
        district: first?.district ?? "",
        candidate: first ? candidateName(first, view) : "",
        votes: raceRows.reduce((sum, row) => sum + candidateVotes(row, view), 0),
        twoCandidateVotes: raceRows.reduce((sum, row) => sum + row.two_candidate_votes, 0),
        precincts: raceRows.length,
        note: first?.outcome_note ?? "",
      };
    }),
    [rows, view],
  );
  const strongest = useMemo(
    () => [...viewSummaries].sort((a, b) => b.rSquared - a.rSquared)[0],
    [viewSummaries],
  );
  const workedExample = summaries.find(
    (summary) => summary.view === "challenger"
      && summary.raceId === "suffolk-middlesex"
      && summary.wuMeasure === "wu_2025_preliminary_share",
  );
  const firstSuffolk = viewSummaries.filter((summary) => summary.raceId === "first-suffolk");
  const norfolk = viewSummaries.filter((summary) => summary.raceId === "norfolk-suffolk");
  const pooledMeasureDefinition = WU_MEASURES.find((measure) => measure.id === pooledMeasure) ?? WU_MEASURES[2];
  const pooledModel = useMemo(
    () => pooledChallengerModel(rows, pooledMeasure),
    [rows, pooledMeasure],
  );

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      const name = candidateName(row, view).toLowerCase();
      const searchText = [
        row.district,
        row.race_label,
        `ward ${row.ward}`,
        `precinct ${row.precinct}`,
        `pct ${row.precinct}`,
        `w${row.ward}-p${row.precinct}`,
        name,
      ].join(" ").toLowerCase();
      return !normalized || searchText.includes(normalized);
    });
  }, [rows, query, view]);

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;
      if (sortKey === "district") {
        aValue = a.district;
        bValue = b.district;
      } else if (sortKey === "precinct") {
        aValue = Number(a.ward) * 100 + Number(a.precinct.replace(/\D/g, ""));
        bValue = Number(b.ward) * 100 + Number(b.precinct.replace(/\D/g, ""));
      } else if (sortKey === "candidateShare") {
        aValue = candidateShare(a, view);
        bValue = candidateShare(b, view);
      } else if (sortKey === "candidateVotes") {
        aValue = candidateVotes(a, view);
        bValue = candidateVotes(b, view);
      } else {
        aValue = a[sortKey];
        bValue = b[sortKey];
      }
      const comparison = typeof aValue === "number"
        ? aValue - (bValue as number)
        : String(aValue).localeCompare(String(bValue));
      return direction === "asc" ? comparison : -comparison;
    });
    return sorted;
  }, [filteredRows, sortKey, direction, view]);

  const setSort = (key: SortKey) => {
    if (sortKey === key) {
      setDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(key === "district" || key === "precinct" ? "asc" : "desc");
    }
  };

  if (error) {
    return <main className="analysis-loading"><p role="alert">{error}</p></main>;
  }
  if (!rows.length || !summaries.length || !qa) {
    return <main className="analysis-loading"><span className="loader" /><p>Loading the precinct analysis…</p></main>;
  }

  return (
    <main className="analysis-page">
      <header className="site-header analysis-site-header">
        <a className="brand" href="/" aria-label="Primary Atlas home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>PRIMARY ATLAS</span>
        </a>
        <nav aria-label="Page sections">
          <a href="#summary">Summary</a>
          <a href="#pooled">Pooled view</a>
          <a href="#comparisons">Comparisons</a>
          <a href="#table">Data</a>
          <a href="#method">Method</a>
        </nav>
        <a className="header-download" href="/assets/data/wu_precinct_analysis.csv" download>
          Download data
        </a>
      </header>

      <section className="analysis-hero" id="top">
        <div className="analysis-hero-copy">
          <p className="kicker">Boston precinct analysis · 2026 Democratic primary</p>
          <h1>Where Wu was strong, how did the Senate candidates run?</h1>
          <p className="analysis-deck">
            Three State Senate races, compared with Michelle Wu&apos;s precinct results in the 2021 preliminary,
            2021 final, and 2025 preliminary mayoral elections.
          </p>
          <div className="scope-note">
            <strong>This compares places, not changes over time.</strong>
            <span>Each dot is one Boston precinct. The Senate result is always from 2026; the three Wu elections are alternative historical measures of local Wu strength.</span>
          </div>
        </div>
        <aside className="analysis-question-card">
          <p className="eyebrow">The question</p>
          <h2>Was candidate support higher in precincts where Wu had been stronger?</h2>
          <p>The page starts with challengers, then lets you switch to the candidate Wu endorsed. The two views differ only in the Yu–Rush race.</p>
          <a href="#method">Read how to interpret the charts ↓</a>
        </aside>
      </section>

      <section className="analysis-controls" aria-label="Analysis view">
        <div>
          <span>Candidate shown</span>
          <div className="analysis-segmented">
            <button className={view === "challenger" ? "active" : ""} onClick={() => setView("challenger")} aria-pressed={view === "challenger"}>
              Challengers
            </button>
            <button className={view === "endorsed" ? "active" : ""} onClick={() => setView("endorsed")} aria-pressed={view === "endorsed"}>
              Wu-endorsed candidates
            </button>
          </div>
        </div>
        <p>
          {view === "challenger"
            ? "Gayle, Lander, and Yu. Yu is the non-endorsed comparison case."
            : "Gayle, Lander, and Rush. Wu endorsed Rush rather than challenger Persis Yu."}
        </p>
      </section>

      <section className="race-strip" aria-label="Boston portion of the three races">
        {totals.map((total) => (
          <article key={total.raceId}>
            <p>{total.district}</p>
            <h2>{total.candidate}</h2>
            <strong>{percent((total.votes / total.twoCandidateVotes) * 100)}</strong>
            <span>{number(total.votes)} of {number(total.twoCandidateVotes)} two-candidate votes · {total.precincts} Boston precincts</span>
            <small>{total.note}</small>
          </article>
        ))}
      </section>

      <section className="analysis-summary-section" id="summary">
        <div className="analysis-section-heading">
          <div>
            <p className="section-number">01 / START HERE</p>
            <h2>A consistent comparison across elections</h2>
            <p>
              For each panel, the chart compares a typical precinct where Wu was relatively weaker (25th percentile) with a typical precinct where she was relatively stronger (75th percentile). Using the same two relative positions in every election makes the results easier to compare, even when Wu&apos;s precinct results covered a wider or narrower range.
            </p>
          </div>
          <div className="summary-direction-key">
            <strong>How to read it</strong>
            <span><b>Positive</b> → more support for the candidate named on that chart row in Wu-strong precincts.</span>
            <span><b>Negative</b> → less support for that candidate—and therefore more for their opponent—in Wu-strong precincts.</span>
            <span className="summary-candidate-note">This view measures <b>{view === "challenger" ? "Gayle, Lander, and Yu" : "Gayle, Lander, and Rush"}</b>.</span>
          </div>
        </div>
        <SummaryChart rows={viewSummaries} view={view} />
        <p className="summary-caption">
          These are modeled precinct differences, not individual voter behavior and not a before-and-after change. The fitted estimates are weighted by the number of 2026 two-candidate votes in each precinct.
        </p>

        <div className="finding-grid">
          <article>
            <span>Strongest pattern</span>
            <h3>{strongest?.candidate} · {strongest?.wuMeasureLabel}</h3>
            <p>{strongest ? `${signedPoints(strongest.weakToStrongDifferencePp)} between typical Wu-weak and Wu-strong precincts; the weighted fit explains ${percent(strongest.rSquared * 100, 0)} of precinct variation.` : ""}</p>
          </article>
          <article>
            <span>Gayle comparison</span>
            <h3>The Wu measure matters</h3>
            <p>The Gayle relationship is much weaker using the 2021 preliminary ({signedPoints(firstSuffolk[0]?.weakToStrongDifferencePp ?? 0)}) than using the 2021 final or 2025 preliminary ({signedPoints(firstSuffolk[1]?.weakToStrongDifferencePp ?? 0)} to {signedPoints(firstSuffolk[2]?.weakToStrongDifferencePp ?? 0)}).</p>
          </article>
          <article>
            <span>Endorsement wrinkle</span>
            <h3>{view === "challenger" ? "Yu is the comparison case" : "Rush moves in the opposite direction"}</h3>
            <p>{view === "challenger"
              ? `Yu was not endorsed by Wu, yet her support was about ${Math.abs(norfolk[2]?.weakToStrongDifferencePp ?? 0).toFixed(1)} points higher in typical 2025 Wu-strong precincts.`
              : `Rush was endorsed by Wu, yet his support was about ${Math.abs(norfolk[2]?.weakToStrongDifferencePp ?? 0).toFixed(1)} points lower in typical 2025 Wu-strong precincts.`}</p>
          </article>
        </div>
      </section>

      <section className="analysis-pooled-section" id="pooled">
        <div className="analysis-section-heading pooled-heading">
          <div>
            <p className="section-number">02 / POOL THE CHALLENGERS</p>
            <h2>What if Gayle, Lander, and Yu were one challenger?</h2>
            <p>
              This single chart stacks all 156 Boston precincts and treats the three candidates as one pooled challenger group. Each dot still comes from its original race; the orange segment is one vote-weighted fitted relationship across the combined data.
            </p>
          </div>
          <div className="pooled-measure-control" aria-label="Wu election shown in pooled chart">
            <span>Wu election</span>
            <div className="analysis-segmented">
              {WU_MEASURES.map((measure) => (
                <button
                  key={measure.id}
                  className={pooledMeasure === measure.id ? "active" : ""}
                  onClick={() => setPooledMeasure(measure.id)}
                  aria-pressed={pooledMeasure === measure.id}
                >
                  {measure.short}
                </button>
              ))}
            </div>
          </div>
        </div>
        {pooledModel ? (
          <div className="pooled-analysis-layout">
            <PooledChallengerChart rows={rows} measure={pooledMeasureDefinition} model={pooledModel} />
            <aside className="pooled-reading">
              <p>{pooledMeasureDefinition.short}</p>
              <h3>{signedPoints(pooledModel.weakToStrongDifference)}</h3>
              <span>modeled rise in pooled challenger support</span>
              <dl>
                <div>
                  <dt>Typical Wu-weaker precinct</dt>
                  <dd>Wu {percent(pooledModel.wuWeak)} → challenger {percent(pooledModel.challengerAtWeak)}</dd>
                </div>
                <div>
                  <dt>Typical Wu-stronger precinct</dt>
                  <dd>Wu {percent(pooledModel.wuStrong)} → challenger {percent(pooledModel.challengerAtStrong)}</dd>
                </div>
              </dl>
              <strong>Race-adjusted check</strong>
              <p>
                The simple pooled slope is {signedPoints(pooledModel.slope * 10)} of challenger support per 10-point increase in Wu share. Giving each race its own baseline produces {signedPoints(pooledModel.adjustedSlope * 10)}—almost the same result.
              </p>
              <small>The race-adjusted fit explains {percent(pooledModel.adjustedRSquared * 100, 0)} of the within-race variation. It controls for different average candidate support across the three contests, not for demographics or campaign effects.</small>
            </aside>
          </div>
        ) : null}
        <div className="pooled-conclusion">
          <strong>What the pooled chart adds</strong>
          <p>All three challengers ran better in Wu-stronger precincts, including Yu, whom Wu did not endorse. Pooling therefore strengthens the evidence for a broader geographic alignment with progressive or change-oriented voters; it does not isolate an endorsement effect or show how individual Wu voters cast their Senate ballots.</p>
        </div>
      </section>

      <section className="analysis-comparison-section" id="comparisons">
        <div className="analysis-section-heading comparison-heading">
          <div>
            <p className="section-number">03 / INSPECT THE DOTS</p>
            <h2>Three races, three Wu comparisons each</h2>
            <p>
              Each race now appears once. Inside each race panel, the three compact plots compare the same 2026 candidate result with Wu&apos;s 2021 preliminary, 2021 final, and 2025 preliminary results. Hover or tap a dot for that precinct&apos;s values; dot size represents the 2026 two-candidate vote.
            </p>
          </div>
          <label className="scale-toggle">
            <input type="checkbox" checked={fullScale} onChange={(event) => setFullScale(event.target.checked)} />
            <span>Use full 0–100% axes</span>
          </label>
        </div>
        <div className="comparison-key">
          <strong>Every line is now directly tied to the printed number.</strong>
          <span><i className="comparison-key-segment" aria-hidden="true" /> The orange segment joins the fitted candidate result at the 25th and 75th percentiles of Wu&apos;s vote. Its vertical rise or fall is exactly the point difference printed above the plot.</span>
          <span><i className="comparison-key-half" aria-hidden="true" /> The dashed horizontal line marks 50% candidate support. Light solid lines are ordinary scale guides.{!fullScale ? " The charts enlarge the observed ranges; use the toggle for the full 0–100% view." : " The full 0–100% scale is shown."}</span>
        </div>

        <div className="mobile-panel-picker">
          <label>
            <span>Race</span>
            <select value={mobileRace} onChange={(event) => setMobileRace(event.target.value)}>
              {RACE_ORDER.map((raceId) => <option key={raceId} value={raceId}>{RACE_SHORT[raceId]}</option>)}
            </select>
          </label>
          <label>
            <span>Wu election</span>
            <select value={mobileMeasure} onChange={(event) => setMobileMeasure(event.target.value as WuMeasure)}>
              {WU_MEASURES.map((measure) => <option key={measure.id} value={measure.id}>{measure.short}</option>)}
            </select>
          </label>
        </div>

        <div className="race-panel-stack">
          {RACE_ORDER.map((raceId) => {
            const raceRows = rows.filter((row) => row.race_id === raceId);
            if (!raceRows.length) return null;
            const candidate = candidateName(raceRows[0], view);
            return (
              <article
                className={`race-comparison-panel${mobileRace === raceId ? " mobile-selected-race" : ""}`}
                key={raceId}
                data-race={raceId}
              >
                <div className="race-panel-heading">
                  <div>
                    <p>{RACE_SHORT[raceId]}</p>
                    <h3>{candidate}</h3>
                  </div>
                  <span>{raceRows.length} precincts</span>
                </div>
                <div className="race-scatter-grid">
                  {WU_MEASURES.map((measure) => {
                    const summary = viewSummaries.find(
                      (item) => item.raceId === raceId && item.wuMeasure === measure.id.replace("_pct", ""),
                    );
                    if (!summary) return null;
                    return (
                      <div
                        className={`race-scatter-cell${mobileMeasure === measure.id ? " mobile-selected-measure" : ""}`}
                        key={`${raceId}-${measure.id}`}
                        data-measure={measure.id}
                      >
                        <ScatterPlot
                          rows={raceRows}
                          summary={summary}
                          measure={measure}
                          view={view}
                          xDomain={xDomains[measure.id]}
                          yDomain={yDomain}
                        />
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="analysis-table-section" id="table">
        <div className="analysis-section-heading">
          <div>
            <p className="section-number">04 / CHECK A PRECINCT</p>
            <h2>Analysis dataset</h2>
            <p>Search and sort all Boston precincts used in the charts. All three Wu measures and the candidate&apos;s 2026 two-candidate result are shown together.</p>
          </div>
          <div className="download-group">
            <a className="download-primary" href="/assets/data/wu_precinct_analysis.csv" download>Analysis CSV</a>
            <a className="download-secondary light" href="/assets/data/wu_precinct_summary.csv" download>Summary CSV</a>
            <a className="download-secondary light" href="/assets/data/wu_2021_to_2022_precinct_crosswalk.csv" download>Crosswalk CSV</a>
          </div>
        </div>
        <div className="analysis-table-toolbar">
          <label>
            <span className="sr-only">Search the analysis table</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search district, candidate, ward, or precinct" />
          </label>
          <span>{filteredRows.length} rows</span>
        </div>
        <div className="analysis-table-wrap">
          <table>
            <thead>
              <tr>
                {sortButton("district", "Race", false, sortKey, direction, setSort)}
                {sortButton("precinct", "Precinct", false, sortKey, direction, setSort)}
                <th>Candidate shown</th>
                {sortButton("candidateShare", "Candidate %", true, sortKey, direction, setSort)}
                {sortButton("candidateVotes", "Candidate votes", true, sortKey, direction, setSort)}
                {sortButton("wu_2021_preliminary_share_pct", "Wu ’21 prelim", true, sortKey, direction, setSort)}
                {sortButton("wu_2021_final_share_pct", "Wu ’21 final", true, sortKey, direction, setSort)}
                {sortButton("wu_2025_preliminary_share_pct", "Wu ’25 prelim", true, sortKey, direction, setSort)}
              </tr>
            </thead>
            <tbody>
              {sortedRows.slice(0, showAllRows ? undefined : 18).map((row) => (
                <tr key={`${row.race_id}-${row.precinct_id}`}>
                  <td><strong>{row.district}</strong><span>{RACE_SHORT[row.race_id]}</span></td>
                  <td><strong>Ward {row.ward} · Pct. {row.precinct}</strong><span>{number(row.two_candidate_votes)} two-candidate votes</span></td>
                  <td>{candidateName(row, view)}</td>
                  <td className="numeric"><strong>{percent(candidateShare(row, view))}</strong></td>
                  <td className="numeric">{number(candidateVotes(row, view))}</td>
                  <td className="numeric">{percent(row.wu_2021_preliminary_share_pct)}</td>
                  <td className="numeric">{percent(row.wu_2021_final_share_pct)}</td>
                  <td className="numeric">{percent(row.wu_2025_preliminary_share_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredRows.length > 18 ? (
          <button className="show-rows analysis-show-rows" onClick={() => setShowAllRows((value) => !value)}>
            {showAllRows ? "Show fewer rows" : `Show all ${filteredRows.length} rows`}
          </button>
        ) : null}
      </section>

      <section className="analysis-method-section" id="method">
        <div className="analysis-section-heading">
          <div>
            <p className="section-number">05 / METHOD &amp; LIMITS</p>
            <h2>What the analysis does—and does not—say</h2>
            <p>Everything needed to reproduce or challenge the analysis is downloadable below.</p>
          </div>
        </div>
        <div className="method-explainer-grid">
          <article>
            <span>1</span>
            <h3>Keep the 2026 outcome fixed</h3>
            <p>The vertical value is always the selected candidate&apos;s 2026 two-candidate share. The three Wu elections are separate horizontal comparisons, not years in a time series.</p>
          </article>
          <article>
            <span>2</span>
            <h3>Put 2021 on today&apos;s precincts</h3>
            <p>Boston grew from 255 to 275 precincts. We use 2020 Census blocks to allocate the 2021 Wu vote numerator and valid-vote denominator to current precincts, then calculate the share. No percentage is directly averaged.</p>
          </article>
          <article>
            <span>3</span>
            <h3>Weight by 2026 votes</h3>
            <p>The fitted relationship gives precincts with more two-candidate Senate votes more influence. It is descriptive and does not prove that Wu&apos;s voters supported a candidate.</p>
          </article>
          <article>
            <span>4</span>
            <h3>Compare a typical weak and strong precinct</h3>
            <p>We report the fitted difference from the 25th to 75th percentile of Wu share. Every election therefore answers the same practical question: how much does candidate support differ between a typical Wu-weaker precinct and a typical Wu-stronger precinct?</p>
          </article>
        </div>
        <div className="pooled-method-note">
          <strong>How the pooled chart is checked</strong>
          <p>The visible orange segment comes from one vote-weighted line across all 156 precincts. Because the three contests have different average challenger results and cover different parts of Boston, the page also fits a common Wu slope while giving each race its own baseline. Similar pooled and race-adjusted slopes mean the combined pattern is not merely an artifact of one contest starting at a higher average level.</p>
        </div>
        {workedExample ? (
          <div className="model-detail">
            <article>
              <p className="model-kicker">The fitted model</p>
              <h3>A separate weighted straight line for every comparison</h3>
              <p>Technically, this is a weighted linear regression. For each candidate race and Wu election, it draws the straight line that best summarizes how candidate support and Wu support move together across precincts.</p>
              <dl className="model-spec">
                <div><dt>Outcome</dt><dd>The candidate&apos;s 2026 two-candidate vote share</dd></div>
                <div><dt>Predictor</dt><dd>Wu&apos;s precinct vote share in the selected mayoral election</dd></div>
                <div><dt>Weight</dt><dd>The precinct&apos;s total 2026 two-candidate votes</dd></div>
              </dl>
              <p className="model-formula">Predicted candidate share = intercept + slope × Wu share</p>
              <small>The model is descriptive. It summarizes a precinct-level pattern; it does not identify individual voters or prove causation.</small>
            </article>
            <article>
              <p className="model-kicker">Worked example</p>
              <h3>Lander vs. Brownsberger · 2025 Wu result</h3>
              <p>The model uses all {workedExample.precinctCount} Boston precincts in the race. With shares displayed as percentages, its fitted equation is:</p>
              <p className="example-equation">Predicted Lander share = {workedExample.intercept < 0 ? "−" : "+"}{Math.abs(workedExample.intercept * 100).toFixed(1)} + ({workedExample.slope.toFixed(3)} × Wu share)</p>
              <div className="example-endpoints">
                <div>
                  <span>Typical Wu-weaker precinct · 25th percentile</span>
                  <strong>Wu {percent(workedExample.wuWeakShare * 100)} → Lander {percent(workedExample.candidateShareAtWeak * 100)}</strong>
                </div>
                <div>
                  <span>Typical Wu-stronger precinct · 75th percentile</span>
                  <strong>Wu {percent(workedExample.wuStrongShare * 100)} → Lander {percent(workedExample.candidateShareAtStrong * 100)}</strong>
                </div>
              </div>
              <p className="example-calculation"><span>{percent(workedExample.candidateShareAtStrong * 100)}</span><b>−</b><span>{percent(workedExample.candidateShareAtWeak * 100)}</span><b>=</b><strong>{signedPoints(workedExample.weakToStrongDifferencePp)}</strong></p>
              <p className="example-meaning">Meaning: the model estimates Lander support was {Math.abs(workedExample.weakToStrongDifferencePp).toFixed(1)} points higher in a typical Wu-stronger precinct than in a typical Wu-weaker precinct.</p>
            </article>
          </div>
        ) : null}
        <div className="caution-box">
          <strong>Ecological caution</strong>
          <p>A precinct pattern is not an individual-voter pattern. The analysis can show where support overlapped geographically; it cannot identify who voted for whom, prove an endorsement caused the result, or separate endorsement effects from demographics, incumbency, campaigning, and other local factors.</p>
        </div>
        <div className="qa-strip">
          <article><span>Boundary versions</span><strong>{qa.crosswalk.oldPrecinctCount} → {qa.crosswalk.currentPrecinctCount}</strong><small>Boston precincts, 2021 to current</small></article>
          <article><span>Crosswalk rows</span><strong>{number(qa.crosswalk.crosswalkRowCount)}</strong><small>old-to-current geographic contributions</small></article>
          <article><span>Analysis rows</span><strong>{number(qa.analysis.rowCount)}</strong><small>precinct-race observations</small></article>
          <article><span>Automated checks</span><strong>{Object.values(qa.checks).filter(Boolean).length}/{Object.values(qa.checks).length}</strong><small>coverage, conservation, and range checks passed</small></article>
        </div>
        <div className="method-downloads">
          <a href="/assets/data/wu_analysis_qa.json" download>QA report (JSON)</a>
          <a href="/assets/data/wu_precinct_summary.csv" download>Regression summary (CSV)</a>
          <a href="/assets/data/wu_2021_to_2022_precinct_crosswalk.csv" download>2021-to-current crosswalk (CSV)</a>
          <a href="https://github.com/yepogue/election_result_map/blob/main/docs/WU_PRECINCT_ANALYSIS_METHOD.md" target="_blank" rel="noreferrer">Detailed methodology ↗</a>
        </div>
      </section>

      <section className="analysis-sources-section" id="sources">
        <div className="analysis-section-heading">
          <div>
            <p className="section-number">06 / FACT-CHECK</p>
            <h2>Original sources</h2>
            <p>Official election tables, precinct boundaries, and Census blocks are linked directly. The page never substitutes an unattributed secondary dataset for a source result.</p>
          </div>
        </div>
        <div className="analysis-source-list">
          {sources.map((source) => (
            <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
              <span>{source.status}</span>
              <div><strong>{source.title}</strong><small>{source.usedFor}</small></div>
              <b aria-hidden="true">↗</b>
            </a>
          ))}
        </div>
        <div className="endorsement-note">
          <strong>Endorsement context</strong>
          <p>Gayle&apos;s campaign lists Mayor Wu&apos;s endorsement; contemporary reporting documents Wu&apos;s endorsements of Lander and Rush. The endorsement-aligned view is a sensitivity check because the request&apos;s literal “challenger” definition includes Yu, whom Wu did not endorse.</p>
          <div>
            <a href="https://www.latoyaforsenate.com/endorsements" target="_blank" rel="noreferrer">Gayle campaign ↗</a>
            <a href="https://www.thecrimson.com/article/2026/6/22/wu-endorses-lander/" target="_blank" rel="noreferrer">Lander endorsement report ↗</a>
            <a href="https://www.wgbh.org/news/politics/2026-09-09/wu-upbeat-on-legislative-losses-says-results-show-voters-are-tired-of-the-status-quo" target="_blank" rel="noreferrer">Rush endorsement context ↗</a>
          </div>
        </div>
      </section>

      <section className="analysis-changelog">
        <div>
          <p className="section-number">CHANGE LOG</p>
          <h2>Latest updates</h2>
        </div>
        <ul>
          <li><b>September 24, 2026:</b> Added a one-chart pooled challenger view and a race-adjusted check of the shared Wu relationship.</li>
          <li><b>September 21, 2026:</b> Published the Boston precinct comparison for three 2026 State Senate Democratic primaries using the post-recount Brownsberger–Lander export.</li>
          <li><b>September 21, 2026:</b> Added challenger and Wu-endorsed views, the 2021 boundary crosswalk, QA downloads, and original-source links.</li>
          <li><b>September 21, 2026:</b> Used descriptive weighted fits and a 25th-to-75th-percentile comparison; no bootstrap intervals or causal claims.</li>
          <li><b>September 21, 2026:</b> Consolidated the precinct graphics by race and added a plain-language weighted-model explanation with a Lander–Brownsberger worked example.</li>
        </ul>
      </section>

      <footer className="analysis-footer">
        <a className="brand" href="/">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>PRIMARY ATLAS</span>
        </a>
        <p>Independent, source-linked precinct analysis.</p>
        <a href="/">Return to the election map ↑</a>
      </footer>
    </main>
  );
}
