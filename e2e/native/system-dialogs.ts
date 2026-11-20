import { expect, type Screen } from "e2e"

/**
 * Dialogs that the operating system shows over the app, such as iOS's offer to save the password after a
 * sign-in. They are not the app's, so they have no test ids, and `device.alert` doesn't count this one as
 * an alert. It does show in the screen tree, as another app's window, so this file finds its button by its
 * words: the one place a test does, which test/test-ids.test.ts allows.
 */

/** Taps "Not Now" if iOS's save-password sheet is over the app. Answers whether it was. Android never shows it. */
export const dismissSavePasswordIfShown = async (screen: Screen): Promise<boolean> => {
  const notNow = screen.getByRole("button", "Not Now")

  if (!(await notNow.isVisible())) return false

  await notNow.tap()

  return true
}

// The sheet can take a long time to come on a CI runner's simulator (E2E_SLOW_DEVICE, see e2e.config.ts).
const SAVE_PASSWORD_WAIT = process.env.E2E_SLOW_DEVICE ? 120_000 : 15_000

/** Waits for iOS's offer to save the password after a sign-in, and dismisses it. */
export const dismissSavePassword = async (screen: Screen, within = SAVE_PASSWORD_WAIT) => {
  try {
    await expect.poll(() => dismissSavePasswordIfShown(screen), { timeout: within }).toBe(true)
  } catch {
    // It never came, as on Android.
  }
}
