import { dayKey } from "../src/domain/test-ids"
import { expect, seededTest, seedHistory, signedOutTest, testIds } from "./support"

/**
 * Screens compared with an approved screenshot in CI (see playwright.config.ts). Each one shows data
 * that does not change with the date, so it only differs when the screen itself does.
 */

signedOutTest("the sign-in screen", async ({ page }) => {
  await page.goto("/login")
  await expect(page.getByTestId(testIds.login.submit)).toBeEnabled()
  await expect(page).toHaveScreenshot("login.png")
})

seededTest("a month of the seed history on the calendar", async ({ page }) => {
  const target = dayKey(Date.parse(seedHistory.workouts.at(-1)!.startedAt)).slice(0, 7)

  await page.getByTestId(testIds.today.weekCard).click()

  const month = page.getByTestId(testIds.calendar.month)

  for (let step = 0; step < 36 && (await month.getAttribute("data-value")) !== target; step++) {
    await page.getByTestId(testIds.calendar.previousMonth).click()
  }

  await expect(month).toHaveAttribute("data-value", target)
  await expect(page).toHaveScreenshot("calendar-month.png", { fullPage: true })
})
