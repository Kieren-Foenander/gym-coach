import { formatWeight } from "~/domain/progression"

/**
 * The geometry for a trend over time, worked out once so the web and phone charts draw the same thing.
 * Points sit where their date falls, so a month off shows as a gap rather than as the next step.
 */

export interface TrendPoint {
  readonly id: number
  readonly date: number
  readonly value: number
}

export interface PlottedPoint extends TrendPoint {
  readonly x: number
  readonly y: number
}

export interface ValueTick {
  readonly y: number
  readonly label: string
}

export interface DateTick {
  readonly x: number
  readonly label: string
  /** Labels near the edges hang inwards so they are not cut off. */
  readonly anchor: "start" | "middle" | "end"
}

export interface TrendLayout {
  readonly points: ReadonlyArray<PlottedPoint>
  /** The line through every point, oldest first. */
  readonly line: string
  /** The line closed down to the bottom of the plot, for a fill. Null with fewer than two points. */
  readonly area: string | null
  /** A step line of the highest value so far. Null unless asked for, or with fewer than two points. */
  readonly best: string | null
  readonly valueTicks: ReadonlyArray<ValueTick>
  readonly dateTicks: ReadonlyArray<DateTick>
}

export const CHART = {
  width: 320,
  height: 168,
  left: 34,
  right: 312,
  top: 10,
  bottom: 144,
  /** Baseline of the date labels. */
  dateLabelY: 160,
} as const

const DAY = 24 * 60 * 60 * 1000
const MAX_DATE_TICKS = 5
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

const tidy = (value: number) => Math.round(value * 1e6) / 1e6

/** A round step (1, 2, 2.5 or 5 times a power of ten) that splits the range into about four parts. */
const niceStep = (range: number) => {
  const rough = range / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].find((multiple) => multiple * power >= rough) ?? 10

  return step * power
}

/** The value axis: round numbers that cover every point, never dipping below zero for positive data. */
export const valueScale = (values: ReadonlyArray<number>) => {
  let low = Math.min(...values)
  let high = Math.max(...values)

  if (low === high) {
    const pad = Math.max(1, Math.abs(high) * 0.05)
    low = Math.max(0, low - pad)
    high += pad
  }

  const step = niceStep(high - low)
  const min = tidy(Math.floor(low / step) * step)
  let max = tidy(Math.ceil(high / step) * step)

  if (max === min) max = tidy(min + step)

  const ticks: Array<number> = []

  for (let value = min; value <= max + step / 2; value += step) ticks.push(tidy(value))

  return { min, max, ticks }
}

type Interval = { readonly unit: "day" | "month" | "year"; readonly size: number }

const INTERVALS: ReadonlyArray<Interval> = [
  { unit: "day", size: 1 },
  { unit: "day", size: 2 },
  { unit: "day", size: 7 },
  { unit: "day", size: 14 },
  { unit: "month", size: 1 },
  { unit: "month", size: 2 },
  { unit: "month", size: 3 },
  { unit: "month", size: 6 },
  { unit: "year", size: 1 },
  { unit: "year", size: 2 },
  { unit: "year", size: 5 },
  { unit: "year", size: 10 },
]

/** Calendar boundaries (midnights, month starts or new years) between two times, in local time. */
const boundaries = (start: number, end: number, interval: Interval): ReadonlyArray<number> => {
  const from = new Date(start)
  const times: Array<number> = []

  if (interval.unit === "day") {
    const first = new Date(from.getFullYear(), from.getMonth(), from.getDate())

    if (first.getTime() < start) first.setDate(first.getDate() + 1)

    // Weekly ticks fall on Mondays, the start of a training week.
    if (interval.size >= 7) first.setDate(first.getDate() + ((8 - first.getDay()) % 7))

    for (const day = first; day.getTime() <= end; day.setDate(day.getDate() + interval.size)) times.push(day.getTime())
  } else if (interval.unit === "month") {
    // Counted in months since year 0 and rounded up to a multiple of the step,
    // so three-monthly ticks land on Jan, Apr, Jul and Oct.
    let month = from.getFullYear() * 12 + from.getMonth()

    if (new Date(from.getFullYear(), from.getMonth(), 1).getTime() < start) month += 1
    month = Math.ceil(month / interval.size) * interval.size

    for (let index = month; ; index += interval.size) {
      const time = new Date(Math.floor(index / 12), index % 12, 1).getTime()

      if (time > end) break
      times.push(time)
    }
  } else {
    let year = from.getFullYear()

    if (new Date(year, 0, 1).getTime() < start) year += 1
    const firstYear = Math.ceil(year / interval.size) * interval.size

    for (let year = firstYear; ; year += interval.size) {
      const time = new Date(year, 0, 1).getTime()

      if (time > end) break
      times.push(time)
    }
  }

  return times
}

const dateLabel = (time: number, unit: Interval["unit"], spansYears: boolean) => {
  const date = new Date(time)
  const month = MONTHS[date.getMonth()]

  if (unit === "year") return String(date.getFullYear())

  if (unit === "month") return spansYears ? `${month} ’${String(date.getFullYear()).slice(2)}` : `${month}`

  return `${date.getDate()} ${month}`
}

/** Up to five dates along the bottom, on whole days, months or years depending on how long the line runs. */
export const dateTicks = (start: number, end: number): ReadonlyArray<{ readonly time: number; readonly label: string }> => {
  if (end - start < DAY) return [{ time: start, label: dateLabel(start, "day", false) }]

  const spansYears = new Date(start).getFullYear() !== new Date(end).getFullYear()

  for (const interval of INTERVALS) {
    const times = boundaries(start, end, interval)

    if (times.length <= MAX_DATE_TICKS && times.length > 0) {
      return times.map((time) => ({ time, label: dateLabel(time, interval.unit, spansYears) }))
    }
  }

  return []
}

/** Lays out the points against time and a round-numbered value axis. */
export const layoutTrend = (points: ReadonlyArray<TrendPoint>, options: { readonly best?: boolean } = {}): TrendLayout => {
  const { left, right, top, bottom } = CHART
  const sorted = points.toSorted((a, b) => a.date - b.date)
  const first = sorted[0]
  const last = sorted.at(-1)

  if (!first || !last) return { points: [], line: "", area: null, best: null, valueTicks: [], dateTicks: [] }

  const scale = valueScale(sorted.map((point) => point.value))
  const span = last.date - first.date
  const x = (date: number) => (span === 0 ? (left + right) / 2 : left + ((date - first.date) / span) * (right - left))
  const y = (value: number) => bottom - ((value - scale.min) / (scale.max - scale.min)) * (bottom - top)
  const at = (value: number) => value.toFixed(1)

  const plotted = sorted.map((point) => ({ ...point, x: x(point.date), y: y(point.value) }))
  const line = plotted.map((point, index) => `${index === 0 ? "M" : "L"}${at(point.x)},${at(point.y)}`).join(" ")
  const many = plotted.length > 1

  let best: string | null = null

  if (options.best && many) {
    let high = first.value
    const steps = [`M${at(x(first.date))},${at(y(high))}`]

    for (const point of sorted.slice(1)) {
      steps.push(`H${at(x(point.date))}`)

      if (point.value > high) {
        high = point.value
        steps.push(`V${at(y(high))}`)
      }
    }

    best = steps.join(" ")
  }

  const edge = 16

  return {
    points: plotted,
    line,
    area: many ? `${line} L${at(x(last.date))},${bottom} L${at(x(first.date))},${bottom} Z` : null,
    best,
    valueTicks: scale.ticks.map((value) => ({ y: y(value), label: formatWeight(value) })),
    dateTicks: dateTicks(first.date, last.date).map((tick) => {
      const position = x(tick.time)
      const anchor = position < left + edge ? "start" : position > right - edge ? "end" : "middle"

      return { x: position, label: tick.label, anchor }
    }),
  }
}
