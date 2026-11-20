import type { Device } from "@e2e-dev/mobile"

/**
 * Dialogs that the operating system shows over the app. They are not the app's, so they have no test ids,
 * and this file is the one place a test finds an element by its words. test/test-ids.test.ts leaves it out.
 */

/**
 * iOS offers to save the password a few seconds after a sign-in, as a sheet over the app. Waits up to
 * `within` ms for it and taps "Not Now". Android never offers, so there it does nothing.
 */
export const dismissSavePassword = async (device: Device, within = 15_000) => {
  if (device.unstable_raw.platform !== "ios") return

  const notNow = device.locator('role=button label="Not Now"')

  try {
    await notNow.waitFor({ timeout: within })
  } catch {
    return
  }

  await notNow.tap()
}
