import { describe, expect, it } from "vitest"
import { describeTrainingDay, formatCompact, formatLongDay } from "~/format"

describe("formatCompact", () => {
  it("leaves small numbers alone", () => {
    expect(formatCompact(0)).toBe("0")
    expect(formatCompact(999)).toBe("999")
    expect(formatCompact(12.34)).toBe("12.3")
  })

  it("shortens thousands, millions and billions to one decimal", () => {
    expect(formatCompact(1000)).toBe("1k")
    expect(formatCompact(12_480)).toBe("12.5k")
    expect(formatCompact(1_250_000)).toBe("1.3m")
    expect(formatCompact(2_000_000_000)).toBe("2b")
  })

  it("moves up a step instead of showing 1000k", () => {
    expect(formatCompact(999_960)).toBe("1m")
  })
})

describe("calendar wording", () => {
  it("says how many workouts and walks a calendar day had", () => {
    const day = new Date(2026, 10, 9).getTime()

    expect(describeTrainingDay(day, 0)).toBe(formatLongDay(day))
    expect(describeTrainingDay(day, 1)).toBe(`${formatLongDay(day)}, 1 workout`)
    expect(describeTrainingDay(day, 2)).toBe(`${formatLongDay(day)}, 2 workouts`)
    expect(describeTrainingDay(day, 0, 1)).toBe(`${formatLongDay(day)}, 1 walk`)
    expect(describeTrainingDay(day, 1, 2)).toBe(`${formatLongDay(day)}, 1 workout and 2 walks`)
  })
})
