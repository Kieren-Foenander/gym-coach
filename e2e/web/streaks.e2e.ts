import { describe } from "@e2e-dev/web"
import type { Screen } from "e2e"
import { DEFAULT_STREAK_GOALS, FREQUENCIES, type StreakGoal } from "../../src/domain/streaks"
import { CHOICE_STATES, DAY_STATES, SAVE_STATES } from "../../src/domain/test-ids"
import { expect, test, testIds } from "./support"

/** Streak goals: what counts toward a streak, and how a walk shows when it doesn't. */

const training = DEFAULT_STREAK_GOALS[0]!
const walkDaily: StreakGoal = { activity: "walking", period: "day", target: 1 }
const everyDay = FREQUENCIES.find((frequency) => frequency.period === "day")!

/** Logs a walk today through an open workout, and goes back to Today. */
const logWalk = async (screen: Screen) => {
  await screen.getByTestId(testIds.today.startOpenWorkout).tap()
  await screen.getByTestId(testIds.workout.addExercise).tap()
  await screen.getByTestId(testIds.exercisePicker.search).fill("Walk")
  await screen.getByTestId(testIds.exercisePicker.option("Walk")).tap()

  const card = screen.getByTestId(testIds.workout.exercise("Walk"))

  await card.getByTestId(testIds.workout.minutes).getByTestId(testIds.stepper.input).fill("30")
  await card.getByTestId(testIds.workout.logSet).tap()
  await expect(card.getByTestId(testIds.workout.set(1))).toBeVisible()

  await screen.getByTestId(testIds.workout.finish).tap()
  await screen.getByTestId(testIds.workout.done).tap()
}

describe("streak goals", { requires: ["browser"] }, () => {
  test("a walk is ringed under a training goal, and counts once walking is the goal", { tags: ["smoke"] }, async ({ screen }) => {
    const today = Date.now()

    await logWalk(screen)

    // The default goal counts workouts, so the walk shows but keeps no streak.
    await expect(screen.getByTestId(testIds.today.walksThisWeek)).toHaveAttribute("data-value", "1")
    await expect(screen.getByTestId(testIds.today.workoutsThisWeek)).toHaveAttribute("data-value", "0")
    await expect(screen.getByTestId(testIds.today.weekDay(today))).toHaveAttribute("data-state", DAY_STATES.other)
    await expect(screen.getByTestId(testIds.today.streak)).toHaveAttribute("data-value", "0")

    await screen.getByTestId(testIds.nav.tab("settings")).tap()

    const main = screen.getByTestId(testIds.settings.streakGoal("main"))

    await main.getByTestId(testIds.settings.streakActivity("walking")).tap()
    await main.getByTestId(testIds.settings.streakFrequency(everyDay)).tap()
    await screen.getByTestId(testIds.settings.saveStreakGoals).tap()
    await expect(screen.getByTestId(testIds.settings.saveStreakGoals)).toHaveAttribute("data-state", SAVE_STATES.saved)

    await screen.getByTestId(testIds.nav.tab("today")).tap()
    await expect(screen.getByTestId(testIds.today.weekDay(today))).toHaveAttribute("data-state", DAY_STATES.counted)
    await expect(screen.getByTestId(testIds.today.streak)).toHaveAttribute("data-value", "1")

    await screen.getByTestId(testIds.today.weekCard).tap()
    await expect(screen.getByTestId(testIds.calendar.day(today))).toHaveAttribute("data-state", DAY_STATES.counted)
    await expect(screen.getByTestId(testIds.calendar.currentStreak(walkDaily))).toHaveAttribute("data-value", "1")
    await expect(screen.getByTestId(testIds.calendar.longestStreak(walkDaily))).toHaveAttribute("data-value", "1")
  })

  test("keeps a second goal after a reload, shows both streaks, and removes it", { tags: ["smoke"] }, async ({ browser, screen }) => {
    await screen.getByTestId(testIds.nav.tab("settings")).tap()
    await screen.getByTestId(testIds.settings.addStreakGoal).tap()

    // Beside a training goal, the second goal starts as a daily walk.
    const second = screen.getByTestId(testIds.settings.streakGoal("second"))

    await expect(second.getByTestId(testIds.settings.streakActivity("walking"))).toHaveAttribute("data-state", CHOICE_STATES.selected)
    await screen.getByTestId(testIds.settings.saveStreakGoals).tap()
    await expect(screen.getByTestId(testIds.settings.saveStreakGoals)).toHaveAttribute("data-state", SAVE_STATES.saved)

    await browser.reload()
    await expect(second.getByTestId(testIds.settings.streakActivity("walking"))).toHaveAttribute("data-state", CHOICE_STATES.selected)
    await expect(second.getByTestId(testIds.settings.streakFrequency(everyDay))).toHaveAttribute("data-state", CHOICE_STATES.selected)

    // With two goals the calendar shows the current run of each, and no longest run.
    await screen.getByTestId(testIds.nav.tab("today")).tap()
    await screen.getByTestId(testIds.today.weekCard).tap()
    await expect(screen.getByTestId(testIds.calendar.currentStreak(training))).toHaveAttribute("data-value", "0")
    await expect(screen.getByTestId(testIds.calendar.currentStreak(walkDaily))).toHaveAttribute("data-value", "0")
    await expect(screen.getByTestId(testIds.calendar.longestStreak(training))).toHaveCount(0)

    await screen.getByTestId(testIds.nav.tab("settings")).tap()
    await second.getByTestId(testIds.settings.removeStreakGoal).tap()
    await screen.getByTestId(testIds.settings.saveStreakGoals).tap()
    await expect(screen.getByTestId(testIds.settings.saveStreakGoals)).toHaveAttribute("data-state", SAVE_STATES.saved)

    await browser.reload()
    await expect(screen.getByTestId(testIds.settings.streakGoal("main"))).toBeVisible()
    await expect(second).toHaveCount(0)
  })
})
