import { describe } from "@e2e-dev/web"
import type { Screen } from "e2e"
import type { StreakGoal } from "../../src/domain/streaks"
import { CHOICE_STATES, DAY_STATES, MINI_DAY_STATES, SAVE_STATES } from "../../src/domain/test-ids"
import { expect, test, testIds } from "./support"

/** Mini workouts: setting a target, logging toward it, and the blue ring a finished day gets. */

const minisDaily: StreakGoal = { activity: "minis", period: "day", target: 1 }

/** Opens mini workouts from Today and saves one target for push-ups, `daily` a day. */
const setUpPushUps = async (screen: Screen, daily: string) => {
  await screen.getByTestId(testIds.today.miniCard).tap()
  await screen.getByTestId(testIds.minis.addTarget).tap()
  await screen.getByTestId(testIds.exercisePicker.search).fill("Push-Up")
  await screen.getByTestId(testIds.exercisePicker.option("Push-Up")).tap()

  const target = screen.getByTestId(testIds.minis.target("Push-Up"))

  await expect(target.getByTestId(testIds.minis.targetUnit("reps"))).toHaveAttribute("data-state", CHOICE_STATES.selected)
  await target.getByTestId(testIds.minis.targetDaily).getByTestId(testIds.stepper.input).fill(daily)
  await screen.getByTestId(testIds.minis.save).tap()
  await expect(screen.getByTestId(testIds.minis.save)).toHaveAttribute("data-state", SAVE_STATES.saved)
}

describe("mini workouts", { requires: ["browser"] }, () => {
  test("logs sets toward a daily target, shows them on Today, and takes one back", { tags: ["smoke"] }, async ({ screen }) => {
    await setUpPushUps(screen, "100")

    const progress = screen.getByTestId(testIds.minis.progress("Push-Up"))

    await expect(progress).toHaveAttribute("data-value", "0")
    // A nudge's worth is offered: 25 for push-ups.
    await expect(progress.getByTestId(testIds.minis.amount).getByTestId(testIds.stepper.input)).toHaveValue("25")

    await progress.getByTestId(testIds.minis.amount).getByTestId(testIds.stepper.input).fill("30")
    await progress.getByTestId(testIds.minis.log).tap()
    await expect(progress).toHaveAttribute("data-value", "30")

    await screen.getByTestId(testIds.minis.deleteEntry).tap()
    await expect(progress).toHaveAttribute("data-value", "0")

    await progress.getByTestId(testIds.minis.amount).getByTestId(testIds.stepper.input).fill("25")
    await progress.getByTestId(testIds.minis.log).tap()
    await expect(progress).toHaveAttribute("data-value", "25")
    await expect(screen.getByTestId(testIds.minis.day)).toHaveAttribute("data-state", MINI_DAY_STATES.open)

    await screen.getByTestId(testIds.nav.tab("today")).tap()
    await expect(screen.getByTestId(testIds.today.mini("Push-Up"))).toHaveAttribute("data-value", "25")
  })

  test("logs a set once when its answer is lost and Log is tapped again", { tags: ["smoke"] }, async ({ browser, screen }) => {
    await setUpPushUps(screen, "100")

    // The first set reaches the server, but its answer never comes back to the page.
    let lost = false

    await browser.route(/_serverFn/, async (route) => {
      if (lost || !(route.request.postData ?? "").includes("clientKey")) return route.fallback()

      lost = true
      await route.fetch()
      await route.abort()
    })

    const progress = screen.getByTestId(testIds.minis.progress("Push-Up"))

    await progress.getByTestId(testIds.minis.amount).getByTestId(testIds.stepper.input).fill("30")
    await progress.getByTestId(testIds.minis.log).tap()
    // Kept under the button it came from, to try again.
    await expect(progress.getByTestId(testIds.minis.retry)).toBeVisible()

    // Tapping Log again sends that set again, which the server already has: 30 done, not 60.
    await progress.getByTestId(testIds.minis.log).tap()
    await expect(progress).toHaveAttribute("data-value", "30")
    await expect(progress.getByTestId(testIds.minis.retry)).toHaveCount(0)
  })

  test("rings a day blue once every target is done and mini workouts are a streak goal", { tags: ["smoke"] }, async ({ screen }) => {
    const today = Date.now()

    await setUpPushUps(screen, "25")
    await screen.getByTestId(testIds.minis.progress("Push-Up")).getByTestId(testIds.minis.log).tap()
    await expect(screen.getByTestId(testIds.minis.day)).toHaveAttribute("data-state", MINI_DAY_STATES.met)

    // Not a goal yet: the calendar shows the day, ringed in grey as counting toward nothing.
    await screen.getByTestId(testIds.nav.tab("today")).tap()
    await screen.getByTestId(testIds.today.weekCard).tap()
    await expect(screen.getByTestId(testIds.calendar.day(today))).toHaveAttribute("data-state", DAY_STATES.other)

    await screen.getByTestId(testIds.nav.tab("settings")).tap()
    await screen.getByTestId(testIds.settings.addStreakGoal).tap()

    const second = screen.getByTestId(testIds.settings.streakGoal("second"))

    await second.getByTestId(testIds.settings.streakActivity("minis")).tap()
    await screen.getByTestId(testIds.settings.saveStreakGoals).tap()
    await expect(screen.getByTestId(testIds.settings.saveStreakGoals)).toHaveAttribute("data-state", SAVE_STATES.saved)

    await screen.getByTestId(testIds.nav.tab("today")).tap()
    await expect(screen.getByTestId(testIds.today.weekDay(today)).getByTestId(testIds.dayRings.ring("minis"))).toBeVisible()

    await screen.getByTestId(testIds.today.weekCard).tap()

    const day = screen.getByTestId(testIds.calendar.day(today))

    await expect(day).toHaveAttribute("data-state", DAY_STATES.counted)
    await expect(day.getByTestId(testIds.dayRings.ring("minis"))).toBeVisible()
    await expect(day.getByTestId(testIds.dayRings.ring("training"))).toHaveCount(0)
    await expect(screen.getByTestId(testIds.calendar.currentStreak(minisDaily))).toHaveAttribute("data-value", "1")
  })
})
