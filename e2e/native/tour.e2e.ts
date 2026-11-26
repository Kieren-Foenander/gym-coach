import { beforeEach } from "@e2e-dev/mobile"
import { credentials, describe, expect } from "e2e"
import { dismissSavePasswordIfShown, serverUrl, test, testIds } from "./support"

/**
 * A tour of the native app's main screens: sign in, then each tab, with a screenshot of each.
 * The tests run in order on one device, each starting where the last one left the app.
 * .github/workflows/ios-tour.yml runs it on an iOS Simulator, signed in to a server with the seed history.
 */

describe("a tour of the main screens", { serial: true, requires: ["device"] }, () => {
  // In case iOS still offers to save the password, over a later screen. Before the first test opens the app
  // there is no screen to read, so it starts checking after that.
  let opened = false

  beforeEach(async ({ screen }) => {
    if (opened) await dismissSavePasswordIfShown(screen)
  })

  test("signs in to Today", async ({ app, device, screen }) => {
    await app.clearState()
    await app.open()
    opened = true

    // Stop here unless the build signs in to the server with the tour account, never the live one.
    await expect(screen.getByTestId(testIds.login.server)).toHaveValue(serverUrl(), { timeout: 120_000 })
    await app.screenshot("01-sign-in")

    const tour = credentials.user("tour")

    await screen.getByTestId(testIds.login.email).fill(tour.username)
    await screen.getByTestId(testIds.login.password).fill(tour.password)
    await device.dismissKeyboard()
    await screen.getByTestId(testIds.login.submit).tap()

    // Sign-in lands on Today. A test build doesn't mark its sign-in fields for autofill, so iOS shouldn't
    // offer to save the password over it; if it does, clear the sheet while waiting.
    const today = screen.getByTestId(testIds.nav.tab("today"))

    await expect
      .poll(
        async () => {
          await dismissSavePasswordIfShown(screen)

          // In the screen tree at all: iOS reports this tab as not visible even when it is on screen, and
          // while the sheet is up the tree holds only the sheet.
          return (await today.count()) > 0
        },
        { timeout: 120_000 },
      )
      .toBe(true)
    await expect(today).toBeSelected()
    await app.screenshot("02-today")
  })

  test("sets a mini workout target, logs a set toward it, and goes back", async ({ app, device, screen }) => {
    await screen.getByTestId(testIds.today.miniCard).tap()
    await expect(screen.getByTestId(testIds.minis.save)).toBeVisible()

    // The tour account keeps its target from an earlier run on the same server.
    if ((await screen.getByTestId(testIds.minis.target("Push-Up")).count()) === 0) {
      await screen.getByTestId(testIds.minis.addTarget).tap()
      await screen.getByTestId(testIds.exercisePicker.search).fill("Push-Up")
      await device.dismissKeyboard()
      await screen.getByTestId(testIds.exercisePicker.option("Push-Up")).tap()
      await expect(screen.getByTestId(testIds.minis.target("Push-Up"))).toBeVisible()
      await screen.getByTestId(testIds.minis.save).tap()
    }

    const progress = screen.getByTestId(testIds.minis.progress("Push-Up"))

    await expect(progress).toBeVisible()

    const logged = await screen.getByTestId(testIds.minis.deleteEntry).count()

    await progress.getByTestId(testIds.minis.log).tap()
    await expect.poll(() => screen.getByTestId(testIds.minis.deleteEntry).count(), { timeout: 30_000 }).toBe(logged + 1)
    await app.screenshot("02b-mini-workouts")

    await screen.getByTestId(testIds.minis.back).tap()
    await expect(screen.getByTestId(testIds.today.mini("Push-Up"))).toBeVisible()
  })

  test("opens the plan", async ({ app, screen }) => {
    await screen.getByTestId(testIds.nav.tab("plan")).tap()

    await expect(screen.getByTestId(testIds.nav.tab("plan"))).toBeSelected()
    await app.screenshot("03-plan")
  })

  test("opens one muscle's exercises, and goes back", async ({ app, screen }) => {
    await screen.getByTestId(testIds.nav.tab("exercises")).tap()
    await expect(screen.getByTestId(testIds.nav.tab("exercises"))).toBeSelected()
    await app.screenshot("04-exercises")

    await screen.getByTestId(testIds.exercises.muscle("Chest")).tap()
    await expect(screen.getByTestId(testIds.muscleGroup.back)).toBeVisible()
    await app.screenshot("05-chest")

    await screen.getByTestId(testIds.muscleGroup.back).tap()
    await expect(screen.getByTestId(testIds.exercises.muscle("Chest"))).toBeVisible()
  })

  test("opens the history", async ({ app, screen }) => {
    await screen.getByTestId(testIds.nav.tab("history")).tap()

    await expect(screen.getByTestId(testIds.nav.tab("history"))).toBeSelected()
    await app.screenshot("06-history")
  })

  test("opens the settings", async ({ app, screen }) => {
    await screen.getByTestId(testIds.nav.tab("settings")).tap()

    await expect(screen.getByTestId(testIds.nav.tab("settings"))).toBeSelected()
    await app.screenshot("07-settings")
  })
})
