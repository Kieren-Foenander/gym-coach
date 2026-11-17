import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { byDay, monthGrid, shiftMonth, weeklyStreaks } from "~/domain/week"

// The calendar screen reads every finished workout. The seed history is a few years of real training.
const history: { readonly workouts: ReadonlyArray<{ readonly startedAt: string }> } = JSON.parse(
  readFileSync(new URL("../../../seed/training-history.json", import.meta.url), "utf8"),
)

const workouts = history.workouts.map((workout, index) => ({ id: index + 1, startedAt: Date.parse(workout.startedAt) }))

describe("the calendar over a real training history", () => {
  it("shows every workout on exactly one day as you page through the months", () => {
    const days = byDay(workouts)
    const first = shiftMonth(workouts[0]?.startedAt ?? 0, 0)
    const last = shiftMonth(workouts.at(-1)?.startedAt ?? 0, 0)
    let shown = 0

    for (let month = first; month <= last; month = shiftMonth(month, 1)) {
      for (const week of monthGrid(month).weeks) {
        for (const day of week.days) if (day !== null) shown += days.get(day)?.length ?? 0
      }
    }

    expect(shown).toBe(workouts.length)
  })

  it("never has a longest streak shorter than the current one", () => {
    const now = (workouts.at(-1)?.startedAt ?? 0) + 86_400_000
    const streaks = weeklyStreaks(workouts.map((workout) => workout.startedAt), now)

    expect(streaks.current).toBeGreaterThan(0)
    expect(streaks.longest).toBeGreaterThanOrEqual(streaks.current)
    expect(streaks.currentWeeks.size).toBe(streaks.current)
  })
})
