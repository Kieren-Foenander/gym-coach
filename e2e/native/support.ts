import { test as base, type Device } from "@e2e-dev/mobile"
import { testIds } from "../../src/domain/test-ids"
import { dismissSavePassword, dismissSystemDialog } from "./system-dialogs"

/**
 * What the native app's tests share. Elements are found by test id only, from src/domain/test-ids.ts, as
 * in the browser tests (CLAUDE.md, "Test ids"). The system's own dialogs, which have none, are dismissed
 * through ./system-dialogs.ts.
 */

export { testIds }

/** The address the build signs in to, which must be the server with the tour account on it. */
export const serverUrl = (): string => {
  const url = process.env.E2E_SERVER_URL

  if (!url) throw new Error("Set E2E_SERVER_URL to the server the build signs in to, such as http://127.0.0.1:1337")

  return url
}

/**
 * Installs E2E_APP_PATH once per device, before the first test, when it is set; without it the app must be
 * on the device already, as CI does with simctl (a large build can take longer to copy than one e2e action
 * may). The tour clears the app's data itself. An Android emulator does not share the host's network, so
 * its 127.0.0.1 is pointed back at the host's.
 */
const prepare = async (device: Device) => {
  if (process.env.E2E_APP_PATH) await device.installApp()

  if (device.unstable_raw.platform === "android") {
    const { port } = new URL(serverUrl())
    const { execFileSync } = await import("node:child_process")

    execFileSync("adb", ["-s", device.unstable_raw.deviceId, "reverse", `tcp:${port}`, `tcp:${port}`])
  }
}

export const test = base.extend<{}, { installed: void }>({
  installed: [
    async ({ device }, use) => {
      await prepare(device)
      await use()
    },
    { scope: "worker", auto: true },
  ],
})

export { dismissSavePassword, dismissSystemDialog }
