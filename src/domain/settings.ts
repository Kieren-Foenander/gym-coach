import { COACH_APPS } from "./coach-apps"
import { activeGoals, describeGoal, type StreakGoal } from "./streaks"

/**
 * The pages the Settings menu opens. Both apps list them in this order, each with its title and a
 * line saying what is set there now. Apple Health is listed only in the iPhone app.
 */
export const SETTINGS_PAGES = ["profile", "streaks", "coach", "health"] as const

export type SettingsPage = (typeof SETTINGS_PAGES)[number]

export const SETTINGS_TITLES = {
  profile: "About you",
  streaks: "Streak goals",
  coach: "AI coach",
  health: "Apple Health",
} as const satisfies Record<SettingsPage, string>

interface ProfileLike {
  readonly displayName: string
  readonly unit: string
  readonly streakGoals?: ReadonlyArray<StreakGoal> | undefined
}

/** Under About you: the name and the unit, the two things that show everywhere else. */
export const profileSummary = (user: ProfileLike): string => `${user.displayName} · weights in ${user.unit}`

/** Under Streak goals: each goal in order, the leading one first. */
export const streakSummary = (user: ProfileLike): string => activeGoals(user.streakGoals).map(describeGoal).join(" · ")

/** Under AI coach: the apps it has steps for, so it is plain this is not only for Claude. */
export const coachSummary = (): string => {
  const names = COACH_APPS.map((app) => app.name)

  return names.length <= 3 ? `Works with ${names.join(", ")}` : `${names.slice(0, 3).join(", ")} and more`
}

/** Under Apple Health, in the iPhone app. */
export const healthSummary = (connected: boolean): string => (connected ? "Connected" : "Not connected")
