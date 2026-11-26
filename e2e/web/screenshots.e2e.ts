import { describe } from "@e2e-dev/web"
import { dayKey } from "../../src/domain/test-ids"
import { showMonth } from "./calendar"
import { callsAs, expect, seededTest, seedHistory, signedOutTest, testIds } from "./support"

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

  seededTest("a month of the seed history on the calendar, ringed for two goals", async ({ app, browser, person, screen }) => {
    const call = await callsAs(app.baseUrl, person)

    // A goal for mini workouts beside training, and a few July days with every target done: some on
    // days with a seed workout (two rings), some on their own (one). Fixed days, so the picture never moves.
    await call("updateProfile", {
      streakGoals: [
        { activity: "training", period: "week", target: 1 },
        { activity: "minis", period: "day", target: 1 },
      ],
    })
    await call("updateMinis", {
      day: "2026-07-01",
      settings: {
        targets: [{ exercise: "Push-Up", unit: "reps", daily: 50, chunk: 25, growBy: 0 }],
        nudges: false,
        days: [0, 1, 2, 3, 4],
        startMinute: 540,
        endMinute: 1050,
        gapMinutes: 45,
        timeZone: "Australia/Brisbane",
        pausedUntil: null,
      },
    })

    for (const day of ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-15", "2026-07-20"]) {
      await call("logMini", { day, exercise: "Push-Up", amount: 50 })
    }

    // The screens read the goals when they open, so go to the calendar afresh.
    await screen.getByTestId(testIds.nav.tab("settings")).tap()
    await screen.getByTestId(testIds.nav.tab("today")).tap()
    await screen.getByTestId(testIds.today.weekCard).tap()
    await showMonth(screen, dayKey(Date.parse(seedHistory.workouts.at(-1)!.startedAt)).slice(0, 7))
    await expect(screen.getByTestId(testIds.calendar.day(Date.parse("2026-07-20T12:00:00+10:00"))).getByTestId(testIds.dayRings.ring("minis"))).toBeVisible()
    await expect(screen.getByTestId(testIds.calendar.day(Date.parse("2026-07-20T12:00:00+10:00"))).getByTestId(testIds.dayRings.ring("training"))).toBeVisible()

    // The whole month in one picture: a screen tall enough that nothing scrolls.
    await browser.setViewport({ width: 390, height: 1400 })
    await expect(screen).toHaveScreenshot("calendar-month.png", TOLERANCE)
  })
})
