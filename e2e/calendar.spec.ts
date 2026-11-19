import { DEFAULT_STREAK_GOALS } from "../src/domain/streaks"
import { DAY_STATES, dayKey } from "../src/domain/test-ids"
import { expect, seededTest as test, seedHistory, testIds } from "./support"

const last = seedHistory.workouts.at(-1)!
const lastDay = Date.parse(last.startedAt)
const dayAfter = lastDay + 86_400_000

test("pages back to the seed history and opens a day that counts", async ({ page }) => {
  await page.getByTestId(testIds.today.weekCard).click()

  const month = page.getByTestId(testIds.calendar.month)
  const target = dayKey(lastDay).slice(0, 7)

  for (let step = 0; step < 36 && (await month.getAttribute("data-value")) !== target; step++) {
    await page.getByTestId(testIds.calendar.previousMonth).click()
  }

  await expect(month).toHaveAttribute("data-value", target)
  await expect(page.getByTestId(testIds.calendar.day(lastDay))).toHaveAttribute("data-state", DAY_STATES.counted)
  await expect(page.getByTestId(testIds.calendar.day(dayAfter))).toHaveAttribute("data-state", DAY_STATES.rest)
  await expect(page.getByTestId(testIds.calendar.longestStreak(DEFAULT_STREAK_GOALS[0]!))).not.toHaveAttribute("data-value", "0")

  await page.getByTestId(testIds.calendar.day(lastDay)).click()
  await expect(page.getByTestId(testIds.workout.summary)).toBeVisible()
})
