import type { Device } from "@e2e-dev/mobile"

/**
 * Dialogs that the operating system shows over the app. They are not the app's, so they have no test ids,
 * and this file is the one place a test finds an element by its words. test/test-ids.test.ts leaves it out.
 */

const notNow = (device: Device) => device.locator('role=button label="Not Now"')

// The sheet can take a long time to come on a CI runner's simulator (E2E_SLOW_DEVICE, see e2e.config.ts).
const SAVE_PASSWORD_WAIT = process.env.E2E_SLOW_DEVICE ? 120_000 : 15_000

/**
 * iOS offers to save the password after a sign-in, as a sheet over the app. Waits for it and taps
 * "Not Now". Android never offers, so there it does nothing.
 */
export const dismissSavePassword = async (device: Device, within = SAVE_PASSWORD_WAIT) => {
  if (device.unstable_raw.platform !== "ios") return

  try {
    await notNow(device).waitFor({ timeout: within })
  } catch {
    return
  }

  await notNow(device).tap()
}

/** Taps "Not Now" if the save-password sheet is over the app right now, in case it came after the wait. */
export const dismissSavePasswordIfShown = async (device: Device) => {
  if (device.unstable_raw.platform !== "ios") return

  if (await notNow(device).isVisible()) await notNow(device).tap()
}
