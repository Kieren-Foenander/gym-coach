import type { Device } from "@e2e-dev/mobile"
import { expect } from "e2e"

/**
 * Dialogs that the operating system shows over the app, such as iOS's offer to save the password after a
 * sign-in. They are not the app's, so they have no test ids and the app's screen tree doesn't hold them:
 * `device.alert` reaches them, and agent-device taps the button that says no ("Not Now", "Cancel",
 * "Don't Allow").
 */

/** Dismisses a system dialog over the app if there is one. Answers whether there was. */
export const dismissSystemDialog = async (device: Device): Promise<boolean> => {
  if (device.unstable_raw.platform !== "ios") return false

  try {
    await device.alert("dismiss")

    return true
  } catch {
    return false
  }
}

// The save-password sheet can take a long time to come on a CI runner's simulator (E2E_SLOW_DEVICE, see
// e2e.config.ts).
const SAVE_PASSWORD_WAIT = process.env.E2E_SLOW_DEVICE ? 120_000 : 15_000

/** Waits for iOS's offer to save the password after a sign-in, and dismisses it. Android never offers. */
export const dismissSavePassword = async (device: Device, within = SAVE_PASSWORD_WAIT) => {
  if (device.unstable_raw.platform !== "ios") return

  try {
    await expect.poll(() => dismissSystemDialog(device), { timeout: within }).toBe(true)
  } catch {
    // It never came.
  }
}
