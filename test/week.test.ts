import { describe, expect, it } from "vitest"
import { byDay, countInMonth, monthGrid, shiftMonth, startOfWeek } from "~/domain/week"

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

describe("monthGrid", () => {
  it("lays a month out Monday first, with blanks around it", () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const grid = monthGrid(now)

    expect(grid.start).toBe(at(2026, 11, 1, 0))
    expect(grid.weeks).toHaveLength(6)
    expect(grid.weeks[0]?.monday).toBe(at(2026, 10, 26, 0))
    expect(grid.weeks[0]?.days).toEqual([null, null, null, null, null, null, at(2026, 11, 1, 0)])
    expect(grid.weeks[5]?.days).toEqual([at(2026, 11, 30, 0), null, null, null, null, null, null])
  })

  it("has every day of the month once, at midnight", () => {
    const days = monthGrid(at(2026, 2, 14)).weeks.flatMap((week) => week.days.filter((day) => day !== null))

    expect(days).toHaveLength(28)
    expect(days.every((day) => new Date(day).getHours() === 0)).toBe(true)
  })

  it("needs only four rows for a February that starts on a Monday", () => {
    expect(monthGrid(at(2021, 2, 10)).weeks).toHaveLength(4)
  })
})

describe("shiftMonth", () => {
  it("moves to the first of another month, across years", () => {
    expect(shiftMonth(at(2026, 11, 30), -1)).toBe(at(2026, 10, 1, 0))
    expect(shiftMonth(at(2026, 12, 31), 1)).toBe(at(2027, 1, 1, 0))
    expect(shiftMonth(at(2026, 1, 31), 0)).toBe(at(2026, 1, 1, 0))
  })
})

describe("byDay", () => {
  it("groups workouts by the day they started", () => {
    const morning = { id: 1, startedAt: at(2026, 11, 9, 7) }
    const evening = { id: 2, startedAt: at(2026, 11, 9, 19) }
    const next = { id: 3, startedAt: at(2026, 11, 10) }
    const days = byDay([morning, evening, next])

    expect(days.get(at(2026, 11, 9, 0))).toEqual([morning, evening])
    expect(days.get(at(2026, 11, 10, 0))).toEqual([next])
    expect(days.size).toBe(2)
  })
})

describe("countInMonth", () => {
  it("counts only the workouts started in that month", () => {
    const workouts = [at(2026, 10, 31, 23), at(2026, 11, 1, 0), at(2026, 11, 30, 23), at(2026, 12, 1)].map((startedAt) => ({ startedAt }))

    expect(countInMonth(workouts, shiftMonth(now, 0))).toBe(2)
    expect(countInMonth([], shiftMonth(now, 0))).toBe(0)
  })
})
