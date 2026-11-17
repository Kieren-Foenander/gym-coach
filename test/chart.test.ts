import { describe, expect, it } from "vitest"
import { CHART, dateTicks, layoutTrend, valueScale } from "~/domain/chart"

const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12).getTime()

describe("valueScale", () => {
  it("rounds the axis out to whole steps", () => {
    expect(valueScale([10, 80])).toEqual({ min: 0, max: 80, ticks: [0, 20, 40, 60, 80] })
  })

  it("does not start at zero when the values sit well above it", () => {
    const scale = valueScale([82.4, 85.1])

    expect(scale.min).toBeGreaterThan(80)
    expect(scale.max).toBeGreaterThanOrEqual(85.1)
  })

  it("gives a single value room above and below", () => {
    const scale = valueScale([60])

    expect(scale.min).toBeLessThan(60)
    expect(scale.max).toBeGreaterThan(60)
  })
})

describe("dateTicks", () => {
  it("marks years across a long history", () => {
    expect(dateTicks(at(2022, 11, 29), at(2025, 12, 15)).map((tick) => tick.label)).toEqual(["2023", "2024", "2025"])
  })

  it("marks months across a few months", () => {
    expect(dateTicks(at(2026, 7, 10), at(2026, 10, 20)).map((tick) => tick.label)).toEqual(["Aug", "Sep", "Oct"])
  })

  it("adds the year to months when the line crosses one", () => {
    expect(dateTicks(at(2025, 11, 10), at(2026, 2, 20)).map((tick) => tick.label)).toEqual(["Dec ’25", "Jan ’26", "Feb ’26"])
  })

  it("marks days across a short stretch", () => {
    expect(dateTicks(at(2026, 11, 2), at(2026, 11, 16)).map((tick) => tick.label)).toEqual(["9 Nov", "16 Nov"])
  })

  it("never crowds the axis", () => {
    expect(dateTicks(at(2020, 1, 1), at(2026, 11, 1)).length).toBeLessThanOrEqual(5)
  })
})

describe("layoutTrend", () => {
  const points = [
    { id: 1, date: at(2026, 1, 1), value: 60 },
    { id: 2, date: at(2026, 1, 3), value: 62.5 },
    { id: 3, date: at(2026, 3, 1), value: 57.5 },
    { id: 4, date: at(2026, 3, 3), value: 65 },
  ]

  it("places points by date, so a long break shows as a gap", () => {
    const [first, second, third, fourth] = layoutTrend(points).points

    expect(first?.x).toBe(CHART.left)
    expect(fourth?.x).toBe(CHART.right)
    expect((third?.x ?? 0) - (second?.x ?? 0)).toBeGreaterThan(10 * ((second?.x ?? 0) - (first?.x ?? 0)))
  })

  it("puts higher values higher up", () => {
    const plotted = layoutTrend(points).points

    expect(plotted[3]?.y).toBeLessThan(plotted[0]?.y ?? 0)
  })

  it("draws the best so far as a line that never comes back down", () => {
    const best = layoutTrend(points, { best: true }).best ?? ""
    const heights = [...best.matchAll(/(?:M[\d.]+,|V)([\d.]+)/g)].map((match) => Number(match[1]))

    expect(heights.length).toBe(3)
    expect(heights).toEqual(heights.toSorted((a, b) => b - a))
  })

  it("leaves the best line out unless asked", () => {
    expect(layoutTrend(points).best).toBeNull()
  })

  it("centres a single point", () => {
    const layout = layoutTrend([{ id: 1, date: at(2026, 1, 1), value: 60 }])

    expect(layout.points[0]?.x).toBe((CHART.left + CHART.right) / 2)
    expect(layout.area).toBeNull()
  })

  it("sorts points that arrive out of order", () => {
    expect(layoutTrend(points.toReversed()).points.map((point) => point.id)).toEqual([1, 2, 3, 4])
  })
})
