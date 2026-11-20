import { describe } from "@e2e-dev/web"
import { DEFAULT_STREAK_GOALS } from "../../src/domain/streaks"
import { DAY_STATES, dayKey } from "../../src/domain/test-ids"
import { expect, seededTest as test, seedHistory, testIds } from "./support"
import { showMonth } from "./calendar"

const last = seedHistory.workouts.at(-1)!
const lastDay = Date.parse(last.startedAt)
const dayAfter = lastDay + 86_400_000

describe("the calendar", { requires: ["browser"] }, () => {
  test("pages back to the seed history and opens a day that counts", async ({ screen }) => {
    await screen.getByTestId(testIds.today.weekCard).tap()
    await showMonth(screen, dayKey(lastDay).slice(0, 7))

    await expect(screen.getByTestId(testIds.calendar.day(lastDay))).toHaveAttribute("data-state", DAY_STATES.counted)
    await expect(screen.getByTestId(testIds.calendar.day(dayAfter))).toHaveAttribute("data-state", DAY_STATES.rest)
    await expect(screen.getByTestId(testIds.calendar.longestStreak(DEFAULT_STREAK_GOALS[0]!))).not.toHaveAttribute("data-value", "0")

    await screen.getByTestId(testIds.calendar.day(lastDay)).tap()
    await expect(screen.getByTestId(testIds.workout.summary)).toBeVisible()
  })
})
