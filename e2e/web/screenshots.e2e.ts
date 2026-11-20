import { describe } from "@e2e-dev/web"
import { dayKey } from "../../src/domain/test-ids"
import { showMonth } from "./calendar"
import { expect, seededTest, seedHistory, signedOutTest, testIds } from "./support"

/**
 * Screens compared with an approved screenshot. Each one shows data that does not change with the date,
 * so it only differs when the screen itself does. They are recorded in CI's Playwright image (see
 * e2e.config.ts), so they only run with CI set.
 */

const TOLERANCE = { maxDiffPixelRatio: 0.01 }

describe("how the screens look", { requires: ["browser"], skip: process.env.CI ? undefined : "screenshots are compared in CI only" }, () => {
  signedOutTest("the sign-in screen", async ({ app, screen }) => {
    await app.open("/login")
    await expect(screen.getByTestId(testIds.login.submit)).toBeEnabled()
    await expect(screen).toHaveScreenshot("login.png", TOLERANCE)
  })

  seededTest("a month of the seed history on the calendar", async ({ browser, screen }) => {
    await screen.getByTestId(testIds.today.weekCard).tap()
    await showMonth(screen, dayKey(Date.parse(seedHistory.workouts.at(-1)!.startedAt)).slice(0, 7))

    // The whole month in one picture: a screen tall enough that nothing scrolls.
    await browser.setViewport({ width: 390, height: 1400 })
    await expect(screen).toHaveScreenshot("calendar-month.png", TOLERANCE)
  })
})
