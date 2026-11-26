import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { StreakGoals } from "~/domain/schema"
import {
  activeGoals,
  countsToward,
  dayMark,
  dayRings,
  DEFAULT_STREAK_GOALS,
  describeGoal,
  describeGoalStreak,
  EXERCISE_NAME_SEPARATOR,
  goalStreak,
  isInRun,
  kindFromPackedNames,
  markLegend,
  RING_COLORS,
  ringLegend,
  RINGS,
  streakTiles,
  suggestNextGoal,
  summariseWeek,
  workoutKind,
  type SessionKind,
  type StreakGoal,
  type StreakSession,
} from "~/domain/streaks"

const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).getTime()

// Wednesday 11 November 2026.
const now = at(2026, 11, 11)

const weekly: StreakGoal = { activity: "training", period: "week", target: 1 }
const walkDaily: StreakGoal = { activity: "walking", period: "day", target: 1 }
const threeAWeek: StreakGoal = { activity: "training", period: "week", target: 3 }
const minisDaily: StreakGoal = { activity: "minis", period: "day", target: 1 }

const sessions = (kind: SessionKind, ...times: ReadonlyArray<number>): ReadonlyArray<StreakSession> =>
  times.map((startedAt) => ({ startedAt, kind }))

const training = (...times: ReadonlyArray<number>) => sessions("training", ...times)
const walks = (...times: ReadonlyArray<number>) => sessions("walk", ...times)

describe("workoutKind", () => {
  it("calls a workout a walk only when walking is all it has", () => {
    expect(workoutKind(["Walk"])).toBe("walk")
    expect(workoutKind(["Walk", "Walk"])).toBe("walk")
    expect(workoutKind(["Walk", "Squat"])).toBe("training")
    expect(workoutKind(["Incline Treadmill Walk"])).toBe("training")
    expect(workoutKind(["Hike"])).toBe("training")
  })

  it("counts an empty workout as training, as the streak always has", () => {
    expect(workoutKind([])).toBe("training")
    expect(kindFromPackedNames(null)).toBe("training")
  })

  it("reads the names the database packs into one column", () => {
    expect(kindFromPackedNames(["Walk", "Walk"].join(EXERCISE_NAME_SEPARATOR))).toBe("walk")
    expect(kindFromPackedNames(["Walk", "Bench Press"].join(EXERCISE_NAME_SEPARATOR))).toBe("training")
  })
})

describe("goalStreak for a weekly goal", () => {
  it("finds the current run, the longest run, and which weeks are in the current one", () => {
    const streak = goalStreak(
      weekly,
      training(
        // A four week run in September.
        at(2026, 9, 1),
        at(2026, 9, 9),
        at(2026, 9, 9, 18),
        at(2026, 9, 16),
        at(2026, 9, 26),
        // A gap, then the two weeks up to last week.
        at(2026, 10, 27),
        at(2026, 11, 5),
      ),
      now,
    )

    expect(streak.current).toBe(2)
    expect(streak.longest).toBe(4)
    expect([...streak.currentPeriods].toSorted((a, b) => a - b)).toEqual([at(2026, 10, 26, 0), at(2026, 11, 2, 0)])
  })

  it("keeps the streak while this week has no workout yet, and counts it once it has", () => {
    expect(goalStreak(weekly, training(at(2026, 10, 28), at(2026, 11, 3)), now).current).toBe(2)
    expect(goalStreak(weekly, training(at(2026, 10, 28), at(2026, 11, 3), at(2026, 11, 10)), now)).toMatchObject({
      current: 3,
      longest: 3,
    })
  })

  it("ends the streak after a missed week but keeps the longest", () => {
    const streak = goalStreak(weekly, training(at(2026, 10, 14), at(2026, 10, 21)), now)

    expect(streak).toMatchObject({ current: 0, longest: 2 })
    expect(streak.currentPeriods.size).toBe(0)
  })

  it("runs across the end of daylight saving and the new year", () => {
    const history = training(...Array.from({ length: 20 }, (_, index) => at(2026, 10, 1 + index * 7)))

    expect(goalStreak(weekly, history, at(2027, 2, 17)).longest).toBe(20)
  })

  it("does not let walks keep a training streak alive", () => {
    const streak = goalStreak(weekly, [...training(at(2026, 10, 21)), ...walks(at(2026, 10, 28), at(2026, 11, 3))], now)

    expect(streak).toMatchObject({ current: 0, longest: 1 })
  })

  it("needs the target number of different days in a week", () => {
    // Last week: Monday, Wednesday, and twice on Friday, which is three days. The week before: two days.
    const history = training(
      at(2026, 10, 26),
      at(2026, 10, 28),
      at(2026, 11, 2),
      at(2026, 11, 4),
      at(2026, 11, 6),
      at(2026, 11, 6, 18),
    )

    const streak = goalStreak(threeAWeek, history, now)

    expect(streak).toMatchObject({ current: 1, longest: 1 })
  })

  it("says how far this week has come", () => {
    const streak = goalStreak(threeAWeek, training(at(2026, 11, 9), at(2026, 11, 10), at(2026, 11, 10, 18)), now)

    expect(streak).toMatchObject({ done: 2, target: 3, current: 0 })
  })

  it("handles no history", () => {
    expect(goalStreak(weekly, [], now)).toMatchObject({ current: 0, longest: 0, done: 0 })
  })
})

describe("goalStreak for a daily goal", () => {
  it("counts days in a row, and today without a walk yet does not break the run", () => {
    const streak = goalStreak(walkDaily, walks(at(2026, 11, 7), at(2026, 11, 8), at(2026, 11, 9), at(2026, 11, 10)), now)

    expect(streak).toMatchObject({ current: 4, longest: 4, done: 0 })
    expect(isInRun(streak, at(2026, 11, 7, 0))).toBe(true)
    expect(isInRun(streak, at(2026, 11, 11, 0))).toBe(false)
  })

  it("counts today once it has a walk", () => {
    expect(goalStreak(walkDaily, walks(at(2026, 11, 10), at(2026, 11, 11, 7)), now)).toMatchObject({ current: 2, done: 1 })
  })

  it("breaks on a missed day, and ignores workouts that are not walks", () => {
    const history = [...walks(at(2026, 11, 1), at(2026, 11, 2), at(2026, 11, 3)), ...training(at(2026, 11, 9)), ...walks(at(2026, 11, 10))]

    expect(goalStreak(walkDaily, history, now)).toMatchObject({ current: 1, longest: 3 })
  })

  it("walks day by day across the end of daylight saving", () => {
    // Clocks went back on 1 November 2026 in the US and 25 October in Europe; a month covers both.
    const history = walks(...Array.from({ length: 31 }, (_, index) => at(2026, 10, 11 + index, 9)))

    expect(goalStreak(walkDaily, history, at(2026, 11, 10, 20)).current).toBe(31)
  })

  it("counts walks and workouts alike for anything", () => {
    const streak = goalStreak({ activity: "any", period: "day", target: 1 }, [...walks(at(2026, 11, 9)), ...training(at(2026, 11, 10))], now)

    expect(streak.current).toBe(2)
  })
})

describe("activeGoals", () => {
  it("falls back to a workout every week when none are saved", () => {
    expect(activeGoals(undefined)).toEqual(DEFAULT_STREAK_GOALS)
    expect(activeGoals([])).toEqual(DEFAULT_STREAK_GOALS)
  })

  it("keeps at most three, and reads a daily goal as once a day", () => {
    expect(activeGoals([{ activity: "walking", period: "day", target: 5 }, weekly, threeAWeek, minisDaily])).toEqual([
      walkDaily,
      weekly,
      threeAWeek,
    ])
  })
})

describe("the saved goals", () => {
  const decode = Schema.decodeUnknownSync(StreakGoals)

  it("accepts one, two or three goals", () => {
    expect(decode([walkDaily])).toEqual([walkDaily])
    expect(decode([threeAWeek, walkDaily])).toEqual([threeAWeek, walkDaily])
    expect(decode([threeAWeek, walkDaily, minisDaily])).toEqual([threeAWeek, walkDaily, minisDaily])
  })

  it("refuses none, four, or a goal it does not know", () => {
    expect(() => decode([])).toThrow()
    expect(() => decode([weekly, weekly, weekly, weekly])).toThrow()
    expect(() => decode([{ activity: "swimming", period: "day", target: 1 }])).toThrow()
    expect(() => decode([{ activity: "training", period: "week", target: 8 }])).toThrow()
  })
})

describe("day marks", () => {
  it("fills a day that counts toward a goal and rings one that does not", () => {
    expect(dayMark([], [weekly])).toBeNull()
    expect(dayMark(training(now), [weekly])).toBe("counted")
    expect(dayMark(walks(now), [weekly])).toBe("other")
    expect(dayMark(walks(now), [weekly, walkDaily])).toBe("counted")
    expect(dayMark([...walks(now), ...training(now)], [weekly])).toBe("counted")
  })

  it("names the marks after what the goals count", () => {
    expect(markLegend([weekly])).toEqual({ counted: "Workout", other: "Walk" })
    expect(markLegend([walkDaily])).toEqual({ counted: "Walk", other: "Workout" })
    expect(markLegend([weekly, walkDaily])).toEqual({ counted: "Workout or walk", other: null })
    expect(markLegend([{ activity: "any", period: "week", target: 2 }])).toEqual({ counted: "Workout or walk", other: null })
  })
})

describe("mini workout days", () => {
  const miniDay = (...times: ReadonlyArray<number>) => sessions("minis", ...times)

  it("count only toward a goal for mini workouts, and a workout never counts toward one", () => {
    expect(countsToward("minis", "minis")).toBe(true)
    expect(countsToward("minis", "training")).toBe(false)
    expect(countsToward("minis", "walk")).toBe(false)
    expect(countsToward("any", "minis")).toBe(false)
    expect(countsToward("training", "minis")).toBe(false)
    expect(dayMark(miniDay(now), [weekly])).toBe("other")
    expect(dayMark(miniDay(now), [weekly, minisDaily])).toBe("counted")
  })

  it("make a streak of days in a row with every target done", () => {
    const streak = goalStreak(minisDaily, [...miniDay(at(2026, 11, 9), at(2026, 11, 10), at(2026, 11, 11)), ...training(at(2026, 11, 8))], now)

    expect(streak.current).toBe(3)
  })
})

describe("rings", () => {
  it("ring a day once for each goal it counted toward, in the goals' order", () => {
    const day = [...training(now), ...walks(now), ...sessions("minis", now)]

    expect(dayRings(day, [weekly, walkDaily, minisDaily])).toEqual(["training", "walking", "minis"])
    expect(dayRings(day, [minisDaily, weekly])).toEqual(["minis", "training"])
    expect(dayRings(walks(now), [weekly, minisDaily])).toEqual([])
    expect(dayRings(walks(now), [{ activity: "any", period: "day", target: 1 }])).toEqual(["training"])
  })

  it("draw one ring for two goals of the same kind", () => {
    expect(dayRings(training(now), [weekly, threeAWeek])).toEqual(["training"])
    expect(ringLegend([weekly, threeAWeek, minisDaily])).toEqual([
      { ring: "training", label: "Workout" },
      { ring: "minis", label: "Mini targets" },
    ])
  })

  it("give each ring its own colour", () => {
    expect(new Set(RINGS.map((ring) => RING_COLORS[ring])).size).toBe(RINGS.length)
  })

  it("show on each day of the week card", () => {
    const week = summariseWeek(
      [
        { ...training(at(2026, 11, 9))[0]!, volume: 1000 },
        { ...walks(at(2026, 11, 9))[0]!, volume: 0 },
        { ...sessions("minis", at(2026, 11, 10))[0]!, volume: 0 },
      ],
      [weekly, walkDaily, minisDaily],
      now,
    )

    expect(week.rings.slice(0, 3)).toEqual([["training", "walking"], ["minis"], []])
    expect(week.workouts).toBe(1)
  })

  it("suggest a goal that adds a ring the others do not draw", () => {
    expect(suggestNextGoal([weekly])).toEqual(walkDaily)
    expect(suggestNextGoal([weekly, walkDaily])).toEqual(minisDaily)
    expect(suggestNextGoal([walkDaily])).toEqual(threeAWeek)
    expect(describeGoal(minisDaily)).toBe("Hit minis every day")
  })
})

describe("streak wording", () => {
  it("describes a goal in a few words", () => {
    expect(describeGoal(weekly)).toBe("Train every week")
    expect(describeGoal(threeAWeek)).toBe("Train 3× a week")
    expect(describeGoal(walkDaily)).toBe("Walk every day")
    expect(describeGoal({ activity: "any", period: "week", target: 5 })).toBe("Move 5× a week")
  })

  it("names the streak in days or weeks, or says there is none", () => {
    expect(describeGoalStreak(goalStreak(weekly, [], now))).toBe("No streak yet")
    expect(describeGoalStreak(goalStreak(weekly, training(at(2026, 11, 3)), now))).toBe("1 week streak")
    expect(describeGoalStreak(goalStreak(walkDaily, walks(at(2026, 11, 9), at(2026, 11, 10)), now))).toBe("2 day streak")
  })

  it("shows the current and longest run of one goal, or the current run of each of two", () => {
    const one = goalStreak(weekly, training(at(2026, 11, 3)), now)
    const two = goalStreak(walkDaily, walks(at(2026, 11, 10)), now)

    expect(streakTiles([one])).toEqual([
      { goal: weekly, run: "current", label: "Current streak", value: 1, unit: "wk" },
      { goal: weekly, run: "longest", label: "Longest streak", value: 1, unit: "wk" },
    ])
    expect(streakTiles([one, two])).toEqual([
      { goal: weekly, run: "current", label: "Train every week", value: 1, unit: "wk" },
      { goal: walkDaily, run: "current", label: "Walk every day", value: 1, unit: "day" },
    ])
  })
})

describe("summariseWeek", () => {
  it("marks this week's days, counts workouts and walks apart, and totals the volume", () => {
    const week = summariseWeek(
      [
        { startedAt: at(2026, 11, 8), volume: 9000, kind: "training" },
        { startedAt: at(2026, 11, 9), volume: 1000, kind: "training" },
        { startedAt: at(2026, 11, 10), volume: 0, kind: "walk" },
        { startedAt: at(2026, 11, 11, 7), volume: 2500, kind: "training" },
      ],
      [weekly],
      now,
    )

    expect(week.days).toEqual(["counted", "other", "counted", null, null, null, null])
    expect(week.todayIndex).toBe(2)
    expect(week).toMatchObject({ workouts: 2, walks: 1, volume: 3500 })
    expect(week.streak.current).toBe(2)
  })

  it("leads with the first goal's streak", () => {
    const week = summariseWeek(
      [
        { startedAt: at(2026, 11, 9), volume: 0, kind: "walk" },
        { startedAt: at(2026, 11, 10), volume: 0, kind: "walk" },
      ],
      [walkDaily, weekly],
      now,
    )

    expect(week.days.slice(0, 2)).toEqual(["counted", "counted"])
    expect(describeGoalStreak(week.streak)).toBe("2 day streak")
  })
})
