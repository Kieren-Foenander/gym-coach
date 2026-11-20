import { beforeEach } from "@e2e-dev/mobile"
import { credentials, describe, expect } from "e2e"
import { dismissSavePassword, dismissSavePasswordIfShown, serverUrl, test, testIds } from "./support"

/**
 * A tour of the native app's main screens: sign in, then each tab, with a screenshot of each.
 * The tests run in order on one device, each starting where the last one left the app.
 * .github/workflows/ios-tour.yml runs it on an iOS Simulator, signed in to a server with the seed history.
 */

describe("a tour of the main screens", { serial: true }, () => {
  // The save-password sheet can come after sign-in has stopped waiting for it, over a later screen. Before
  // the first test opens the app there is no screen to read, so it starts checking after that.
  let opened = false

  beforeEach(async ({ device }) => {
    if (opened) await dismissSavePasswordIfShown(device)
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

    // Sign-in lands on Today, but iOS can lay its save-password sheet over the app before or after that.
    // Clear it whenever it shows while waiting, and wait for it afterwards only if it hasn't come yet.
    const today = screen.getByTestId(testIds.nav.tab("today"))
    let dismissed = false

    await expect
      .poll(
        async () => {
          dismissed = (await dismissSavePasswordIfShown(device)) || dismissed

          return today.isVisible()
        },
        { timeout: 60_000 },
      )
      .toBe(true)
    await expect(today).toBeSelected()

    if (!dismissed) await dismissSavePassword(device)
    await app.screenshot("02-today")
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
