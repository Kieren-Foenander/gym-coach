import { describe, expect, it } from "vitest"
import { describeStreak, describeTrainingDay, formatCompact, formatLongDay, weeksUnit } from "~/format"

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

describe("streak and calendar wording", () => {
  it("names the streak, or says there is none", () => {
    expect(describeStreak(0)).toBe("No streak yet")
    expect(describeStreak(1)).toBe("1 week streak")
    expect(describeStreak(12)).toBe("12 week streak")
  })

  it("uses a singular unit for one week", () => {
    expect(weeksUnit(1)).toBe("wk")
    expect(weeksUnit(0)).toBe("wks")
    expect(weeksUnit(22)).toBe("wks")
  })

  it("says how many workouts a calendar day had", () => {
    const day = new Date(2026, 10, 9).getTime()

    expect(describeTrainingDay(day, 0)).toBe(formatLongDay(day))
    expect(describeTrainingDay(day, 1)).toBe(`${formatLongDay(day)}, 1 workout`)
    expect(describeTrainingDay(day, 2)).toBe(`${formatLongDay(day)}, 2 workouts`)
  })
})
