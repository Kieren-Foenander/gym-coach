import { describe, expect, it } from "vitest"
import { startOfWeek, summariseWeek } from "~/domain/week"

const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).getTime()

// Wednesday 11 November 2026.
const now = at(2026, 11, 11)

describe("startOfWeek", () => {
  it("returns the Monday at midnight", () => {
    expect(startOfWeek(now)).toBe(at(2026, 11, 9, 0))
  })

  it("treats Sunday as the last day of the week", () => {
    expect(startOfWeek(at(2026, 11, 15, 23))).toBe(at(2026, 11, 9, 0))
  })
})

describe("summariseWeek", () => {
  it("marks the days trained this week and totals them", () => {
    const week = summariseWeek(
      [
        { startedAt: at(2026, 11, 8), volume: 9000 },
        { startedAt: at(2026, 11, 9), volume: 1000 },
        { startedAt: at(2026, 11, 11, 7), volume: 2500 },
      ],
      now,
    )

    expect(week.days).toEqual([true, false, true, false, false, false, false])
    expect(week.todayIndex).toBe(2)
    expect(week.workouts).toBe(2)
    expect(week.volume).toBe(3500)
  })

  it("counts consecutive weeks including the current one", () => {
    const week = summariseWeek(
      [
        { startedAt: at(2026, 10, 28), volume: 1 },
        { startedAt: at(2026, 11, 3), volume: 1 },
        { startedAt: at(2026, 11, 10), volume: 1 },
      ],
      now,
    )

    expect(week.streakWeeks).toBe(3)
  })

  it("keeps the streak while this week has no workout yet", () => {
    const week = summariseWeek(
      [
        { startedAt: at(2026, 10, 28), volume: 1 },
        { startedAt: at(2026, 11, 3), volume: 1 },
      ],
      now,
    )

    expect(week.streakWeeks).toBe(2)
    expect(week.workouts).toBe(0)
  })

  it("ends the streak after a missed week", () => {
    const week = summariseWeek(
      [
        { startedAt: at(2026, 10, 14), volume: 1 },
        { startedAt: at(2026, 10, 28), volume: 1 },
      ],
      now,
    )

    expect(week.streakWeeks).toBe(0)
  })

  it("handles no history", () => {
    expect(summariseWeek([], now)).toMatchObject({ workouts: 0, volume: 0, streakWeeks: 0 })
  })
})
