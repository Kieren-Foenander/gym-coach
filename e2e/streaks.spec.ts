import { DEFAULT_STREAK_GOALS, FREQUENCIES, type StreakGoal } from "../src/domain/streaks"
import { CHOICE_STATES, DAY_STATES, SAVE_STATES } from "../src/domain/test-ids"
import { expect, test, testIds } from "./support"
import type { Page } from "@playwright/test"

/** Streak goals: what counts toward a streak, and how a walk shows when it doesn't. */

const training = DEFAULT_STREAK_GOALS[0]!
const walkDaily: StreakGoal = { activity: "walking", period: "day", target: 1 }
const everyDay = FREQUENCIES.find((frequency) => frequency.period === "day")!

/** Logs a walk today through an open workout, and goes back to Today. */
const logWalk = async (page: Page) => {
  await page.getByTestId(testIds.today.startOpenWorkout).click()
  await page.getByTestId(testIds.workout.addExercise).click()
  await page.getByTestId(testIds.exercisePicker.search).fill("Walk")
  await page.getByTestId(testIds.exercisePicker.option("Walk")).click()

  const card = page.getByTestId(testIds.workout.exercise("Walk"))

  await card.getByTestId(testIds.workout.minutes).getByTestId(testIds.stepper.input).fill("30")
  await card.getByTestId(testIds.workout.logSet).click()
  await expect(card.getByTestId(testIds.workout.set(1))).toBeVisible()

  await page.getByTestId(testIds.workout.finish).click()
  await page.getByTestId(testIds.workout.done).click()
}

test("a walk is ringed under a training goal, and counts once walking is the goal @smoke", async ({ page }) => {
  const today = Date.now()

  await logWalk(page)

  // The default goal counts workouts, so the walk shows but keeps no streak.
  await expect(page.getByTestId(testIds.today.walksThisWeek)).toHaveAttribute("data-value", "1")
  await expect(page.getByTestId(testIds.today.workoutsThisWeek)).toHaveAttribute("data-value", "0")
  await expect(page.getByTestId(testIds.today.weekDay(today))).toHaveAttribute("data-state", DAY_STATES.other)
  await expect(page.getByTestId(testIds.today.streak)).toHaveAttribute("data-value", "0")

  await page.getByTestId(testIds.nav.tab("settings")).click()

  const main = page.getByTestId(testIds.settings.streakGoal("main"))

  await main.getByTestId(testIds.settings.streakActivity("walking")).click()
  await main.getByTestId(testIds.settings.streakFrequency(everyDay)).click()
  await page.getByTestId(testIds.settings.saveStreakGoals).click()
  await expect(page.getByTestId(testIds.settings.saveStreakGoals)).toHaveAttribute("data-state", SAVE_STATES.saved)

  await page.getByTestId(testIds.nav.tab("today")).click()
  await expect(page.getByTestId(testIds.today.weekDay(today))).toHaveAttribute("data-state", DAY_STATES.counted)
  await expect(page.getByTestId(testIds.today.streak)).toHaveAttribute("data-value", "1")

  await page.getByTestId(testIds.today.weekCard).click()
  await expect(page.getByTestId(testIds.calendar.day(today))).toHaveAttribute("data-state", DAY_STATES.counted)
  await expect(page.getByTestId(testIds.calendar.currentStreak(walkDaily))).toHaveAttribute("data-value", "1")
  await expect(page.getByTestId(testIds.calendar.longestStreak(walkDaily))).toHaveAttribute("data-value", "1")
})

test("keeps a second goal after a reload, shows both streaks, and removes it @smoke", async ({ page }) => {
  await page.getByTestId(testIds.nav.tab("settings")).click()
  await page.getByTestId(testIds.settings.addStreakGoal).click()

  // Beside a training goal, the second goal starts as a daily walk.
  const second = page.getByTestId(testIds.settings.streakGoal("second"))

  await expect(second.getByTestId(testIds.settings.streakActivity("walking"))).toHaveAttribute("data-state", CHOICE_STATES.selected)
  await page.getByTestId(testIds.settings.saveStreakGoals).click()
  await expect(page.getByTestId(testIds.settings.saveStreakGoals)).toHaveAttribute("data-state", SAVE_STATES.saved)

  await page.reload()
  await expect(second.getByTestId(testIds.settings.streakActivity("walking"))).toHaveAttribute("data-state", CHOICE_STATES.selected)
  await expect(second.getByTestId(testIds.settings.streakFrequency(everyDay))).toHaveAttribute("data-state", CHOICE_STATES.selected)

  // With two goals the calendar shows the current run of each, and no longest run.
  await page.getByTestId(testIds.nav.tab("today")).click()
  await page.getByTestId(testIds.today.weekCard).click()
  await expect(page.getByTestId(testIds.calendar.currentStreak(training))).toHaveAttribute("data-value", "0")
  await expect(page.getByTestId(testIds.calendar.currentStreak(walkDaily))).toHaveAttribute("data-value", "0")
  await expect(page.getByTestId(testIds.calendar.longestStreak(training))).toHaveCount(0)

  await page.getByTestId(testIds.nav.tab("settings")).click()
  await second.getByTestId(testIds.settings.removeStreakGoal).click()
  await page.getByTestId(testIds.settings.saveStreakGoals).click()
  await expect(page.getByTestId(testIds.settings.saveStreakGoals)).toHaveAttribute("data-state", SAVE_STATES.saved)

  await page.reload()
  await expect(page.getByTestId(testIds.settings.streakGoal("main"))).toBeVisible()
  await expect(second).toHaveCount(0)
})
