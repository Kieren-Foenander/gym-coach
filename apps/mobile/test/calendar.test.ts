import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { dayMark, DEFAULT_STREAK_GOALS, goalStreak, workoutKind } from "~/domain/streaks"
import { byDay, monthGrid, shiftMonth } from "~/domain/week"

// The calendar screen reads every finished workout. The seed history is a few years of real training.
const history: {
  readonly workouts: ReadonlyArray<{ readonly startedAt: string; readonly exercises: ReadonlyArray<{ readonly name: string }> }>
} = JSON.parse(
  readFileSync(new URL("../../../seed/training-history.json", import.meta.url), "utf8"),
)

const workouts = history.workouts.map((workout, index) => ({
  id: index + 1,
  startedAt: Date.parse(workout.startedAt),
  kind: workoutKind(workout.exercises.map((exercise) => exercise.name)),
}))

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
    const streak = goalStreak(DEFAULT_STREAK_GOALS[0]!, workouts, now)

    expect(streak.current).toBeGreaterThan(0)
    expect(streak.longest).toBeGreaterThanOrEqual(streak.current)
    expect(streak.currentPeriods.size).toBe(streak.current)
  })

  it("fills every training day with the default goal, and a walk added to the history gets a ring", () => {
    const days = byDay(workouts)

    for (const sessions of days.values()) expect(dayMark(sessions, DEFAULT_STREAK_GOALS)).toBe("counted")

    const lastDay = (workouts.at(-1)?.startedAt ?? 0) + 86_400_000
    const withWalk = byDay([...workouts, { id: 0, startedAt: lastDay, kind: "walk" as const }])

    expect(dayMark([...(withWalk.values())].at(-1) ?? [], DEFAULT_STREAK_GOALS)).toBe("other")
    expect(dayMark([...(withWalk.values())].at(-1) ?? [], [{ activity: "walking", period: "day", target: 1 }])).toBe("counted")
  })

  it("keeps a walk from stretching the weekly training streak", () => {
    const now = (workouts.at(-1)?.startedAt ?? 0) + 86_400_000
    const before = goalStreak(DEFAULT_STREAK_GOALS[0]!, workouts, now)
    // Walks every week for the next month, and no training.
    const walks = [1, 2, 3, 4].map((week) => ({ id: -week, startedAt: now + week * 7 * 86_400_000, kind: "walk" as const }))
    const later = goalStreak(DEFAULT_STREAK_GOALS[0]!, [...workouts, ...walks], now + 5 * 7 * 86_400_000)

    expect(before.longest).toBeGreaterThan(0)
    expect(later.current).toBe(0)
    expect(later.longest).toBe(before.longest)
  })
})
