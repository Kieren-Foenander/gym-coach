import { describe, expect, it } from "vitest"
import { coachSummary, healthSummary, profileSummary, SETTINGS_PAGES, SETTINGS_TITLES, streakSummary } from "~/domain/settings"
import { DEFAULT_STREAK_GOALS, describeGoal } from "~/domain/streaks"

describe("the Settings menu", () => {
  it("has a title for every page", () => {
    for (const page of SETTINGS_PAGES) expect(SETTINGS_TITLES[page]).not.toBe("")
  })

  it("shows the name and the unit under About you", () => {
    expect(profileSummary({ displayName: "Sam", unit: "kg" })).toBe("Sam · weights in kg")
  })

  it("lists each streak goal in order, leading goal first", () => {
    const user = {
      displayName: "Sam",
      unit: "kg",
      streakGoals: [
        { activity: "training", period: "week", target: 3 },
        { activity: "walking", period: "day", target: 1 },
      ],
    } as const

    expect(streakSummary(user)).toBe("Train 3× a week · Walk every day")
  })

  it("falls back to the default goal when none is saved", () => {
    expect(streakSummary({ displayName: "Sam", unit: "kg" })).toBe(DEFAULT_STREAK_GOALS.map(describeGoal).join(" · "))
  })

  it("names more than one AI app under AI coach", () => {
    expect(coachSummary()).toMatch(/Claude, ChatGPT/)
  })

  it("says whether Apple Health is connected", () => {
    expect(healthSummary(true)).toBe("Connected")
    expect(healthSummary(false)).toBe("Not connected")
  })
})
