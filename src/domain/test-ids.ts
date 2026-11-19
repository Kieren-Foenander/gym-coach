import { slugFor } from "./catalog"

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

export const TABS = ["today", "plan", "exercises", "history", "settings"] as const

export type Tab = (typeof TABS)[number]

export const testIds = {
  nav: {
    tab: keyed<Tab>("nav.tab"),
  },
  login: {
    email: "login.email",
    password: "login.password",
    submit: "login.submit",
  },
  signup: {
    name: "signup.name",
    email: "signup.email",
    password: "signup.password",
    inviteCode: "signup.invite-code",
    submit: "signup.submit",
  },
  today: {
    weekCard: "today.week-card",
    /** One day of this week, keyed by its date. */
    weekDay: (time: number) => `today.week-day:${dayKey(time)}`,
    streak: "today.streak",
    workoutsThisWeek: "today.workouts-this-week",
    startNextWorkout: "today.start-next-workout",
    /** Start a plan day other than the next one, keyed by its name. */
    startDay: (name: string) => `today.start-day:${slugFor(name)}`,
    startOpenWorkout: "today.start-open-workout",
  },
  plan: {
    template: keyed<string>("plan.template"),
  },
  workout: {
    finish: "workout.finish",
    discard: "workout.discard",
    /** One exercise's card, keyed by the exercise. */
    exercise: (name: string) => `workout.exercise:${slugFor(name)}`,
    weight: "workout.weight",
    reps: "workout.reps",
    logSet: "workout.log-set",
    /** A logged set inside an exercise's card, keyed by its number. */
    set: keyed<number>("workout.set"),
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
    currentStreak: "calendar.current-streak",
    longestStreak: "calendar.longest-streak",
    workoutsInMonth: "calendar.workouts-in-month",
    /** A workout in the list for a day with more than one, keyed by its id. */
    dayWorkout: keyed<number>("calendar.day-workout"),
  },
  settings: {
    displayName: "settings.display-name",
    goal: "settings.goal",
    saveProfile: "settings.save-profile",
    signOut: "settings.sign-out",
  },
  stepper: {
    input: "stepper.input",
    less: "stepper.less",
    more: "stepper.more",
  },
} as const

/** What a day on the calendar or the week card shows, in its `data-state`. */
export const DAY_STATES = { trained: "trained", rest: "rest" } as const

/** Whether a form's changes have been saved, in its save button's `data-state`. */
export const SAVE_STATES = { saved: "saved", unsaved: "unsaved" } as const
