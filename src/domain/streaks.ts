import { startOfDay, startOfWeek, weekdayIndex } from "./week"

/**
 * Streak goals: what the user wants to keep doing and how often, such as "train three times a
 * week" or "walk every day". The calendar and the Today card mark days and count streaks
 * against these, so a walk only keeps a streak alive when walking is the goal.
 */

/**
 * What a goal counts: workouts other than walks, walks only, anything logged, or days every mini
 * workout target was met (src/domain/minis.ts).
 */
export const STREAK_ACTIVITIES = ["training", "walking", "any", "minis"] as const

export type StreakActivity = (typeof STREAK_ACTIVITIES)[number]

export const STREAK_PERIODS = ["day", "week"] as const

export type StreakPeriod = (typeof STREAK_PERIODS)[number]

export interface StreakGoal {
  readonly activity: StreakActivity
  readonly period: StreakPeriod
  /** Days a week with a session that counts. A daily goal is always once a day. */
  readonly target: number
}

export const MAX_STREAK_GOALS = 3
export const MAX_WEEKLY_TARGET = 7

/** What everyone starts with: a workout every week, which is what the streak counted before goals. */
export const DEFAULT_STREAK_GOALS: ReadonlyArray<StreakGoal> = [{ activity: "training", period: "week", target: 1 }]

/**
 * The goals to count against. A saved profile from before goals existed has none, and a
 * daily goal's target is read as once a day whatever was stored.
 */
export const activeGoals = (goals: ReadonlyArray<StreakGoal> | undefined): ReadonlyArray<StreakGoal> => {
  const kept = (goals ?? []).slice(0, MAX_STREAK_GOALS)

  return kept.length === 0 ? DEFAULT_STREAK_GOALS : kept.map(normaliseGoal)
}

export const normaliseGoal = (goal: StreakGoal): StreakGoal => ({
  activity: goal.activity,
  period: goal.period,
  target: goal.period === "day" ? 1 : Math.min(Math.max(Math.round(goal.target), 1), MAX_WEEKLY_TARGET),
})

// ---------------------------------------------------------------- what a workout is

/**
 * Library exercises that make a workout a walk when they are all it has. An incline treadmill
 * walk or a hike is harder work, so those count as training.
 */
const WALKING_EXERCISES: ReadonlySet<string> = new Set(["Walk"])

export type WorkoutKind = "training" | "walk"

/** What a streak counts: a workout, a walk, or a day the mini workout targets were met. */
export type SessionKind = WorkoutKind | "minis"

/** A walk when every exercise in it is a walk; anything else, including an empty workout, is training. */
export const workoutKind = (exerciseNames: ReadonlyArray<string>): WorkoutKind =>
  exerciseNames.length > 0 && exerciseNames.every((name) => WALKING_EXERCISES.has(name)) ? "walk" : "training"

/** Separates the exercise names the database packs into one column for each workout. */
export const EXERCISE_NAME_SEPARATOR = "\u001f"

/** The kind of a workout from its exercise names packed into one text, as the database returns them. */
export const kindFromPackedNames = (packed: string | null): WorkoutKind =>
  workoutKind(packed ? packed.split(EXERCISE_NAME_SEPARATOR) : [])

export const countsToward = (activity: StreakActivity, kind: SessionKind): boolean => {
  if (activity === "minis" || kind === "minis") return activity === "minis" && kind === "minis"

  return activity === "any" || (activity === "walking") === (kind === "walk")
}

// ---------------------------------------------------------------- streaks

export interface StreakSession {
  readonly startedAt: number
  readonly kind: SessionKind
}

export interface GoalStreak {
  readonly goal: StreakGoal
  /** Days or weeks in a row the goal was met, up to now. The day or week still underway does not break the run. */
  readonly current: number
  readonly longest: number
  /** The start (midnight, or Monday at midnight) of every day or week in the current run. */
  readonly currentPeriods: ReadonlySet<number>
  /** Days so far in the day or week underway with a session that counts, and how many it needs. */
  readonly done: number
  readonly target: number
}

const HOUR = 3_600_000

const periodStart = (period: StreakPeriod, time: number) => (period === "day" ? startOfDay(time) : startOfWeek(time))

// A millisecond before midnight is the day before; a day and a half on is the next one, whatever daylight saving does.
const previousPeriod = (period: StreakPeriod, start: number) => periodStart(period, start - 1)
const nextPeriod = (period: StreakPeriod, start: number) => periodStart(period, start + (period === "day" ? 36 : 9 * 24) * HOUR)

/** The streak for one goal over the given sessions. Each day counts once, however many sessions it had. */
export const goalStreak = (goal: StreakGoal, sessions: ReadonlyArray<StreakSession>, now: number): GoalStreak => {
  const { period, target } = normaliseGoal(goal)
  const daysIn = new Map<number, Set<number>>()

  for (const session of sessions) {
    if (!countsToward(goal.activity, session.kind)) continue
    const start = periodStart(period, session.startedAt)
    const days = daysIn.get(start) ?? new Set<number>()

    days.add(startOfDay(session.startedAt))
    daysIn.set(start, days)
  }

  const met = (start: number) => (daysIn.get(start)?.size ?? 0) >= target
  const thisPeriod = periodStart(period, now)
  const currentPeriods = new Set<number>()
  let cursor = met(thisPeriod) ? thisPeriod : previousPeriod(period, thisPeriod)

  while (met(cursor)) {
    currentPeriods.add(cursor)
    cursor = previousPeriod(period, cursor)
  }

  let longest = 0

  for (const start of daysIn.keys()) {
    // Only count from the first period of each run, so every run is walked once.
    if (!met(start) || met(previousPeriod(period, start))) continue

    let length = 0

    for (let next = start; met(next); next = nextPeriod(period, next)) length += 1

    longest = Math.max(longest, length)
  }

  return { goal, current: currentPeriods.size, longest, currentPeriods, done: daysIn.get(thisPeriod)?.size ?? 0, target }
}

// ---------------------------------------------------------------- this week

export interface WeekSession extends StreakSession {
  readonly volume: number
}

export interface WeekSummary {
  /** Monday to Sunday: how each day is marked. */
  readonly days: ReadonlyArray<DayMark>
  /** Monday to Sunday: the rings round each day, one for each goal it counted toward. */
  readonly rings: ReadonlyArray<ReadonlyArray<Ring>>
  /** 0 for Monday through 6 for Sunday. */
  readonly todayIndex: number
  /** Workouts this week other than walks, and walks apart. */
  readonly workouts: number
  readonly walks: number
  readonly volume: number
  /** The streak for the first goal. */
  readonly streak: GoalStreak
}

const WEEK_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const

export const summariseWeek = (
  sessions: ReadonlyArray<WeekSession>,
  goals: ReadonlyArray<StreakGoal>,
  now: number,
): WeekSummary => {
  const thisWeek = startOfWeek(now)
  const current = sessions.filter((session) => startOfWeek(session.startedAt) === thisWeek)
  const primary = goals[0] ?? DEFAULT_STREAK_GOALS[0]!
  const onDay = (index: number) => current.filter((session) => weekdayIndex(session.startedAt) === index)

  return {
    days: WEEK_INDEXES.map((index) => dayMark(onDay(index), goals)),
    rings: WEEK_INDEXES.map((index) => dayRings(onDay(index), goals)),
    todayIndex: weekdayIndex(now),
    workouts: current.filter((session) => session.kind === "training").length,
    walks: current.filter((session) => session.kind === "walk").length,
    volume: current.reduce((total, session) => total + session.volume, 0),
    streak: goalStreak(primary, sessions, now),
  }
}

// ---------------------------------------------------------------- marks and words

/** How a day is marked: filled when it counts toward a goal, a ring when it had sessions that do not. */
export type DayMark = "counted" | "other" | null

export const dayMark = (sessions: ReadonlyArray<StreakSession>, goals: ReadonlyArray<StreakGoal>): DayMark => {
  if (sessions.length === 0) return null

  return sessions.some((session) => goals.some((goal) => countsToward(goal.activity, session.kind))) ? "counted" : "other"
}

// ---------------------------------------------------------------- rings

/**
 * The ring a goal draws round a day it counts on, each in its own colour: training (or anything)
 * in the accent, walks in pink, mini workouts in blue. A day can wear all three.
 */
export const RINGS = ["training", "walking", "minis"] as const

export type Ring = (typeof RINGS)[number]

export const ringFor = (activity: StreakActivity): Ring => (activity === "any" ? "training" : activity)

/** The rings round a day: one for each goal its sessions count toward, in the goals' order, the first outermost. */
export const dayRings = (sessions: ReadonlyArray<StreakSession>, goals: ReadonlyArray<StreakGoal>): ReadonlyArray<Ring> => {
  const rings: Array<Ring> = []

  for (const goal of goals) {
    const ring = ringFor(goal.activity)

    if (!rings.includes(ring) && sessions.some((session) => countsToward(goal.activity, session.kind))) rings.push(ring)
  }

  return rings
}

/** The colour of each ring, for both clients. The stylesheets have the same values as named colours. */
export const RING_COLORS = { training: "#d7ff3e", walking: "#ff6fb5", minis: "#4cc2ff" } as const satisfies Record<Ring, string>

export interface RingLegend {
  readonly ring: Ring
  readonly label: string
}

const RING_NAMES = { training: "Workout", walking: "Walk", minis: "Mini targets" } as const satisfies Record<Ring, string>

/** What each ring on the calendar stands for, one entry for each ring the goals draw. */
export const ringLegend = (goals: ReadonlyArray<StreakGoal>): ReadonlyArray<RingLegend> => {
  const seen = new Map<Ring, string>()

  for (const goal of goals) {
    const ring = ringFor(goal.activity)

    if (!seen.has(ring)) seen.set(ring, goal.activity === "any" ? "Workout or walk" : RING_NAMES[ring])
  }

  return [...seen].map(([ring, label]) => ({ ring, label }))
}

const KIND_NAMES = { training: "Workout", walk: "Walk" } as const satisfies Record<WorkoutKind, string>

/** Each mark in words, for screen readers. */
export const MARK_WORDS = { counted: "Counted", other: "Active, not counted" } as const satisfies Record<NonNullable<DayMark>, string>

export interface MarkLegend {
  /** What a filled day is. */
  readonly counted: string
  /** What a ringed day is, or null when every kind of session counts. */
  readonly other: string | null
}

/** The legend for the two marks: which kinds of session the goals count, and which they leave out. */
export const markLegend = (goals: ReadonlyArray<StreakGoal>): MarkLegend => {
  const kinds = (["training", "walk"] as const).filter((kind) => goals.some((goal) => countsToward(goal.activity, kind)))
  const left = (["training", "walk"] as const).filter((kind) => !kinds.includes(kind))

  return {
    counted: kinds.length === 2 ? "Workout or walk" : KIND_NAMES[kinds[0] ?? "training"],
    other: left[0] ? KIND_NAMES[left[0]] : null,
  }
}

export const ACTIVITY_LABELS = {
  training: "Workouts",
  walking: "Walks",
  any: "Anything",
  minis: "Mini targets",
} as const satisfies Record<StreakActivity, string>

export const ACTIVITY_HINTS = {
  training: "Lifting and cardio. Walks don't count.",
  walking: "Walks you log or Apple Health records.",
  any: "Any workout or walk.",
  minis: "Days you hit every mini workout target.",
} as const satisfies Record<StreakActivity, string>

const VERBS = { training: "Train", walking: "Walk", any: "Move", minis: "Hit minis" } as const satisfies Record<StreakActivity, string>

/** A goal as a short phrase: "Train 3× a week", "Walk every day". */
export const describeGoal = (goal: StreakGoal): string => {
  const { activity, period, target } = normaliseGoal(goal)

  if (period === "day") return `${VERBS[activity]} every day`

  return target === 1 ? `${VERBS[activity]} every week` : `${VERBS[activity]} ${target}× a week`
}

/** The short unit after a streak's length. */
export const streakUnit = (period: StreakPeriod, length: number): string =>
  period === "day" ? (length === 1 ? "day" : "days") : length === 1 ? "wk" : "wks"

/** A streak as a phrase, for the Today card: "23 day streak". */
export const describeGoalStreak = (streak: GoalStreak): string =>
  streak.current > 0 ? `${streak.current} ${streak.goal.period} streak` : "No streak yet"

/** Whether a day falls in the current run of a streak, for the band drawn behind it on the calendar. */
export const isInRun = (streak: GoalStreak, day: number): boolean =>
  streak.currentPeriods.has(periodStart(streak.goal.period, day))

export interface StreakTile {
  readonly goal: StreakGoal
  /** Which run of the goal it shows. */
  readonly run: "current" | "longest"
  readonly label: string
  readonly value: number
  readonly unit: string
}

/** The calendar's streak numbers: the current and longest run of a single goal, or the current run of each of two. */
export const streakTiles = (streaks: ReadonlyArray<GoalStreak>): ReadonlyArray<StreakTile> => {
  const [only, second] = streaks

  if (!only) return []

  if (!second) {
    return [
      { goal: only.goal, run: "current", label: "Current streak", value: only.current, unit: streakUnit(only.goal.period, only.current) },
      { goal: only.goal, run: "longest", label: "Longest streak", value: only.longest, unit: streakUnit(only.goal.period, only.longest) },
    ]
  }

  return streaks.map((streak) => ({
    goal: streak.goal,
    run: "current",
    label: describeGoal(streak.goal),
    value: streak.current,
    unit: streakUnit(streak.goal.period, streak.current),
  }))
}

const COUNT_NOUNS = { training: "Workouts", walking: "Walks", any: "Sessions", minis: "Mini days" } as const satisfies Record<
  StreakActivity,
  string
>

/** What the month's count on the calendar is called, after the leading goal: "Walks in Nov". */
export const countNoun = (activity: StreakActivity): string => COUNT_NOUNS[activity]

// ---------------------------------------------------------------- editing

export interface Frequency {
  readonly period: StreakPeriod
  readonly target: number
  readonly label: string
}

/** The choices for how often, as the goal editor offers them. */
export const FREQUENCIES: ReadonlyArray<Frequency> = [
  { period: "day", target: 1, label: "Every day" },
  ...[1, 2, 3, 4, 5, 6].map((target): Frequency => ({ period: "week", target, label: `${target}× a week` })),
]

export const isFrequency = (goal: StreakGoal, frequency: Frequency): boolean => {
  const { period, target } = normaliseGoal(goal)

  return period === frequency.period && target === frequency.target
}

const SUGGESTIONS: ReadonlyArray<StreakGoal> = [
  { activity: "training", period: "week", target: 3 },
  { activity: "walking", period: "day", target: 1 },
  { activity: "minis", period: "day", target: 1 },
]

/** A goal to add that draws a ring none of the others do: walks beside training, then mini workouts. */
export const suggestNextGoal = (goals: ReadonlyArray<StreakGoal>): StreakGoal => {
  const used = new Set(goals.map((goal) => ringFor(goal.activity)))

  return SUGGESTIONS.find((goal) => !used.has(ringFor(goal.activity))) ?? { activity: "training", period: "week", target: 3 }
}
