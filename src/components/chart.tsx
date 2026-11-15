import { formatDay, formatWeight } from "~/format"

export interface TrendPoint {
  readonly id: number
  readonly date: number
  readonly value: number
}

interface TrendChartProps {
  /** Oldest first. */
  readonly points: ReadonlyArray<TrendPoint>
  readonly unit: string
  /** What the line measures, for screen readers. */
  readonly label: string
}

const WIDTH = 320
const HEIGHT = 140
const PAD = 8

/** A single line over time, oldest on the left, with the high and low marked. */
export function TrendChart({ points, unit, label }: TrendChartProps) {
  const values = points.map((point) => point.value)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = high - low || 1
  const x = (index: number) => (points.length === 1 ? WIDTH / 2 : PAD + (index * (WIDTH - PAD * 2)) / (points.length - 1))
  const y = (value: number) => HEIGHT - PAD - ((value - low) / span) * (HEIGHT - PAD * 2)
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ")
  const first = points[0]
  const last = points.at(-1)

  return (
    <figure>
      <div className="flex justify-between pb-1 text-xs text-faint">
        <span className="tabular">
          High {formatWeight(high)} {unit}
        </span>
        <span className="tabular">
          Low {formatWeight(low)} {unit}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`${label} over ${points.length} entries, from ${formatWeight(values[0] ?? 0)} to ${formatWeight(values.at(-1) ?? 0)} ${unit}`}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#d7ff3e" stopOpacity="0.28" />
            <stop offset="1" stopColor="#d7ff3e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD} x2={WIDTH - PAD} y1={PAD} y2={PAD} stroke="#272b33" strokeDasharray="3 4" />
        <line x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} stroke="#272b33" strokeDasharray="3 4" />
        {points.length > 1 ? (
          <path d={`${path} L${x(points.length - 1).toFixed(1)},${HEIGHT} L${x(0).toFixed(1)},${HEIGHT} Z`} fill="url(#trend-fill)" />
        ) : null}
        <path d={path} fill="none" stroke="#d7ff3e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => (
          <circle
            key={point.id}
            cx={x(index)}
            cy={y(point.value)}
            r={index === points.length - 1 ? 4.5 : 3}
            fill="#d7ff3e"
          />
        ))}
      </svg>
      <figcaption className="flex justify-between pt-1 text-xs text-faint">
        <span>{first ? formatDay(first.date) : ""}</span>
        <span>{last && points.length > 1 ? formatDay(last.date) : ""}</span>
      </figcaption>
    </figure>
  )
}
