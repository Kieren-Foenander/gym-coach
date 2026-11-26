import { slugFor } from "./catalog"
import type { MiniUnit } from "./minis"
import { normaliseGoal, type DayMark, type Frequency, type Ring, type StreakActivity, type StreakGoal } from "./streaks"

/**
 * Every test id in the app, for `data-testid` on the web and `testID` in the native app. Tests
 * find elements by these and nothing else: never by text, role, label, CSS class or structure,
 * which all change when the wording or the design does. CLAUDE.md has the rules; test/test-ids.test.ts
 * enforces them.
 *
 * The format is `<screen>.<element>`, lower-case words joined by hyphens, such as `calendar.next-month`.
 * A shared component's own parts start with the component, such as `stepper.input`.
 * One of many repeated elements adds `:<key>` with a stable key from the data, never a position on
 * screen: `calendar.day:2026-11-19`, `workout.exercise:bench-press`, `plan.template:full-body-3`.
 * Inside a keyed element, its parts use plain ids and a test looks for them inside it.
 *
 * What an element shows as state (a day that was trained) goes in `data-state`, with values from
 * this file, and a number it shows goes in `data-value`, so tests check what it means rather than
 * how it looks or is worded.
 */

const keyed =
  <K extends string | number>(id: string) =>
  (key: K) =>
    `${id}:${key}`

/** A day on the user's device as YYYY-MM-DD, the key for anything that stands for one calendar day. */
export const dayKey = (time: number): string => {
  const date = new Date(time)

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** A streak goal as a key, such as `walking-day-1` or `training-week-3`. */
export const goalKey = (goal: StreakGoal): string => {
  const { activity, period, target } = normaliseGoal(goal)

  return `${activity}-${period}-${target}`
}

/** Which of the user's streak goals a part of the goal editor belongs to. */
export type GoalSlot = "main" | "second" | "third"

export const GOAL_SLOTS: ReadonlyArray<GoalSlot> = ["main", "second", "third"]

export const TABS = ["today", "plan", "exercises", "history", "settings"] as const

export type Tab = (typeof TABS)[number]

export const testIds = {
  nav: {
    tab: keyed<Tab>("nav.tab"),
  },
  login: {
    email: "login.email",
    password: "login.password",
    /** The native app's server address field. */
    server: "login.server",
    submit: "login.submit",
  },
  signup: {
    name: "signup.name",
    email: "signup.email",
    password: "signup.password",
    inviteCode: "signup.invite-code",
    /** The native app's server address field. */
    server: "signup.server",
    submit: "signup.submit",
  },
  today: {
    weekCard: "today.week-card",
    /** One day of this week, keyed by its date. */
    weekDay: (time: number) => `today.week-day:${dayKey(time)}`,
    /** The streak for the main goal; `data-value` is its length. */
    streak: "today.streak",
    workoutsThisWeek: "today.workouts-this-week",
    walksThisWeek: "today.walks-this-week",
    startNextWorkout: "today.start-next-workout",
    /** Start a plan day other than the next one, keyed by its name. */
    startDay: (name: string) => `today.start-day:${slugFor(name)}`,
    startOpenWorkout: "today.start-open-workout",
    /** The mini workouts card, which opens the mini workouts screen. */
    miniCard: "today.mini-card",
    /** One target on the card, keyed by its exercise; `data-value` is what is done today. */
    mini: (exercise: string) => `today.mini:${slugFor(exercise)}`,
  },
  /** The rings round a day, on the calendar and the week card. */
  dayRings: {
    /** One goal's ring, keyed by the ring (src/domain/streaks.ts RINGS). */
    ring: keyed<Ring>("day-rings.ring"),
  },
  minis: {
    /** Back to where the screen was opened from, in the native app. */
    back: "minis.back",
    /** Whether every target is done today, in `data-state` (MINI_DAY_STATES). */
    day: "minis.day",
    /** One target's progress today, keyed by its exercise; `data-value` is what is done. */
    progress: (exercise: string) => `minis.progress:${slugFor(exercise)}`,
    /** Inside a target's progress: the amount to log, and logging it. */
    amount: "minis.amount",
    log: "minis.log",
    /** A logged set, keyed by its id, and removing it. */
    entry: keyed<number>("minis.entry"),
    deleteEntry: "minis.delete-entry",
    /** The nudge a notification opened; `data-state` is its status. */
    nudge: "minis.nudge",
    nudgeDone: "minis.nudge-done",
    nudgeSkip: "minis.nudge-skip",
    /** One target in the editor, keyed by its exercise; its parts below are found inside it. */
    target: (exercise: string) => `minis.target:${slugFor(exercise)}`,
    targetUnit: keyed<MiniUnit>("minis.target-unit"),
    targetDaily: "minis.target-daily",
    targetChunk: "minis.target-chunk",
    targetGrow: "minis.target-grow",
    removeTarget: "minis.remove-target",
    addTarget: "minis.add-target",
    /** Nudges on or off, in `data-state` (TOGGLE_STATES). */
    nudges: "minis.nudges",
    /** A day of the week nudges may come on, 0 for Monday; picked or not in `data-state`. */
    weekday: keyed<number>("minis.weekday"),
    start: "minis.start",
    end: "minis.end",
    gap: "minis.gap",
    save: "minis.save",
    pauseToday: "minis.pause-today",
    resume: "minis.resume",
    /** Whether this browser gets nudges, in `data-state` (PUSH_STATES). */
    push: "minis.push",
    enablePush: "minis.enable-push",
    disablePush: "minis.disable-push",
    testPush: "minis.test-push",
  },
  plan: {
    template: keyed<string>("plan.template"),
  },
  history: {
    /** How many workouts the history holds in all; `data-value` is the count. */
    totalWorkouts: "history.total-workouts",
  },
  exercises: {
    /** A muscle group in the library, keyed by the muscle. */
    muscle: (muscle: string) => `exercises.muscle:${slugFor(muscle)}`,
  },
  muscleGroup: {
    /** Back to every muscle from one muscle's exercises. */
    back: "muscle-group.back",
  },
  workout: {
    finish: "workout.finish",
    discard: "workout.discard",
    /** One exercise's card, keyed by the exercise. Its `data-state` is one of EXERCISE_STATES. */
    exercise: (name: string) => `workout.exercise:${slugFor(name)}`,
    /** The exercise's name in its card, which opens the exercise's page. */
    exerciseName: "workout.exercise-name",
    addExercise: "workout.add-exercise",
    weight: "workout.weight",
    /** A cardio exercise's time and distance, in place of weight and reps. */
    minutes: "workout.minutes",
    distance: "workout.distance",
    reps: "workout.reps",
    logSet: "workout.log-set",
    /** A logged set inside an exercise's card, keyed by its number. */
    set: keyed<number>("workout.set"),
    /** Inside a logged set: change its weight, reps or note. */
    editSet: "workout.edit-set",
    saveSet: "workout.save-set",
    cancelEdit: "workout.cancel-edit",
    /** Opens the note field for the set about to be logged or being changed. */
    addSetNote: "workout.add-set-note",
    setNote: "workout.set-note",
    /** The note on one exercise in this workout: the button that opens it, its field, and saving it. */
    editExerciseNote: "workout.edit-exercise-note",
    exerciseNote: "workout.exercise-note",
    saveExerciseNote: "workout.save-exercise-note",
    /** The rest countdown; `data-value` is the seconds left. */
    rest: "workout.rest",
    restLess: "workout.rest-less",
    restMore: "workout.rest-more",
    /** Shrinks the rest timer to a strip along the bottom. The rest's `data-state` is "open" or "minimised". */
    restMinimise: "workout.rest-minimise",
    /** The minimised strip; tapping it brings the full timer back. */
    restExpand: "workout.rest-expand",
    summary: "workout.summary",
    summarySets: "workout.summary-sets",
    /** Back to Today from a finished workout. */
    done: "workout.done",
  },
  calendar: {
    month: "calendar.month",
    previousMonth: "calendar.previous-month",
    nextMonth: "calendar.next-month",
    /** One day of the month, keyed by its date. */
    day: (time: number) => `calendar.day:${dayKey(time)}`,
    /** A goal's streak, keyed by the goal (goalKey). */
    currentStreak: (goal: StreakGoal) => `calendar.current-streak:${goalKey(goal)}`,
    longestStreak: (goal: StreakGoal) => `calendar.longest-streak:${goalKey(goal)}`,
    workoutsInMonth: "calendar.workouts-in-month",
    /** A workout in the list for a day with more than one, keyed by its id. */
    dayWorkout: keyed<number>("calendar.day-workout"),
  },
  settings: {
    displayName: "settings.display-name",
    goal: "settings.goal",
    saveProfile: "settings.save-profile",
    signOut: "settings.sign-out",
    /** One streak goal in the editor; its parts below are found inside it. */
    streakGoal: keyed<GoalSlot>("settings.streak-goal"),
    streakActivity: keyed<StreakActivity>("settings.streak-activity"),
    /** How often, keyed as `day-1` or `week-3`. */
    streakFrequency: (frequency: Frequency) => `settings.streak-frequency:${frequency.period}-${frequency.target}`,
    removeStreakGoal: "settings.remove-streak-goal",
    addStreakGoal: "settings.add-streak-goal",
    saveStreakGoals: "settings.save-streak-goals",
  },
  exercisePicker: {
    search: "exercise-picker.search",
    /** An exercise to pick, keyed by the exercise. */
    option: (name: string) => `exercise-picker.option:${slugFor(name)}`,
  },
  stepper: {
    input: "stepper.input",
    less: "stepper.less",
    more: "stepper.more",
  },
} as const

/**
 * What a day on the calendar or the week card shows, in its `data-state`: a session that counts
 * toward a streak goal, sessions that count toward none (a walk under a training goal), or nothing.
 */
export const DAY_STATES = { counted: "counted", other: "other", rest: "rest" } as const satisfies Record<
  NonNullable<DayMark> | "rest",
  string
>

export const dayState = (mark: DayMark) => DAY_STATES[mark ?? "rest"]

/** Whether a choice among several is the one picked, in its `data-state`. */
export const CHOICE_STATES = { selected: "selected", unselected: "unselected" } as const

/** Whether a form's changes have been saved, in its save button's `data-state`. */
export const SAVE_STATES = { saved: "saved", unsaved: "unsaved" } as const

/** Whether a switch is on, in its `data-state`. */
export const TOGGLE_STATES = { on: "on", off: "off" } as const

/** Whether a day's mini workout targets, or one of them, are done. */
export const MINI_DAY_STATES = { met: "met", open: "open" } as const

/**
 * Whether this browser gets nudges: it cannot (unsupported), it can once added to the home screen
 * (install), the user refused notifications (blocked), it could but does not (off), or it does (on).
 */
export const PUSH_STATES = { unsupported: "unsupported", install: "install", blocked: "blocked", off: "off", on: "on" } as const

export type PushState = keyof typeof PUSH_STATES
