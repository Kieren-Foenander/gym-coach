import { useId } from "react"
import { CHART, layoutTrend, type TrendPoint } from "~/domain/chart"
import { formatWeight } from "~/format"

export type { TrendPoint }

interface TrendChartProps {
  /** Oldest first. */
  readonly points: ReadonlyArray<TrendPoint>
  readonly unit: string
  /** What the line measures, for screen readers. */
  readonly label: string
  /** Also draw the highest value so far, for numbers that should climb. */
  readonly best?: boolean
}

const ACCENT = "#d7ff3e"
const LINE = "#272b33"
const MUTED = "#9299a5"
const FAINT = "#737a86"

/** A line over time with dates along the bottom and values up the side. */
export function TrendChart({ points, unit, label, best = false }: TrendChartProps) {
  const layout = layoutTrend(points, { best })
  // An id per chart, so two charts on one page do not share a fill.
  const fill = `trend-fill-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`
  const first = layout.points[0]
  const last = layout.points.at(-1)

  return (
    <figure>
      {layout.best ? (
        <div className="flex justify-end gap-4 pb-1 text-xs text-faint">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-accent" />
            Each session
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-muted" />
            Best so far
          </span>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        className="w-full"
        role="img"
        aria-label={`${label} over ${points.length} entries, from ${formatWeight(first?.value ?? 0)} to ${formatWeight(last?.value ?? 0)} ${unit}`}
      >
        <defs>
          <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={ACCENT} stopOpacity="0.22" />
            <stop offset="1" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>
        {layout.valueTicks.map((tick) => (
          <g key={tick.label}>
            <line x1={CHART.left} x2={CHART.right} y1={tick.y} y2={tick.y} stroke={LINE} strokeDasharray="3 4" />
            <text x={CHART.left - 6} y={tick.y} dy="0.32em" textAnchor="end" fontSize="10" fill={FAINT} className="tabular">
              {tick.label}
            </text>
          </g>
        ))}
        {layout.dateTicks.map((tick) => (
          <text key={tick.label} x={tick.x} y={CHART.dateLabelY} textAnchor={tick.anchor} fontSize="10" fill={FAINT}>
            {tick.label}
          </text>
        ))}
        {layout.area ? <path d={layout.area} fill={`url(#${fill})`} /> : null}
        {layout.best ? <path d={layout.best} fill="none" stroke={MUTED} strokeWidth="1.5" strokeDasharray="4 3" /> : null}
        <path d={layout.line} fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {layout.points.map((point, index) => (
          <circle key={point.id} cx={point.x} cy={point.y} r={index === layout.points.length - 1 ? 4.5 : 3} fill={ACCENT} />
        ))}
      </svg>
    </figure>
  )
}
