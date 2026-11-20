import { mobile } from "@e2e-dev/mobile"
import type { E2EConfig } from "e2e"

/**
 * End-to-end tests with e2e (https://e2e.com), one runner for the native app and, as it moves over from
 * Playwright, the web app. Tests are e2e/**\/*.e2e.ts and find elements by test id only: see CLAUDE.md and
 * src/domain/test-ids.ts.
 *
 *   bunx e2e run --target ios       the native tour on a booted iOS Simulator
 *   bunx e2e run --target android   the same on a booted Android emulator
 *
 * A device target needs a build of the Gym Preview app with its JavaScript bundled in, pointed at a server
 * at E2E_SERVER_URL that has the tour account on it (E2E_USER_TOUR_PASSWORD is its password). E2E_APP_PATH
 * names the build, which the tests install first: the .app from apps/mobile/e2e/build-simulator.sh, or a
 * release .apk. Leave it unset when the build is installed already.
 * .github/workflows/ios-tour.yml does all of it.
 */

// A simulator on a CI runner answers slowly: one screenshot there can take 20 s, and typing an email over 30 s.
// The iOS workflow sets E2E_SLOW_DEVICE to give each action and test that long; elsewhere a wrong locator
// still fails fast.
const slow = Boolean(process.env.E2E_SLOW_DEVICE)

const nativeApp = {
  bundleId: "com.kierenfoenander.gym.preview",
  appPath: process.env.E2E_APP_PATH,
} as const

// Gym asks for notifications for its rest alerts. On Android, answer no up front so no prompt covers the
// screen; an iOS Simulator can't have that permission set, and asks only once a rest timer starts.
const androidApp = { ...nativeApp, permissions: { notifications: "deny" } } as const

export default {
  tests: ["e2e/**/*.e2e.ts"],
  targets: [
    { name: "ios", engine: mobile({ platform: "ios", device: process.env.E2E_DEVICE }), app: nativeApp },
    { name: "android", engine: mobile({ platform: "android", device: process.env.E2E_DEVICE }), app: androidApp },
  ],
  workers: 1,
  timeout: slow ? 600_000 : 120_000,
  actionTimeout: slow ? 120_000 : 30_000,
  reporters: ["list", "junit"],
  video: "retain-on-failure",
  credentials: {
    // The account the native tour signs in to. Its password comes from E2E_USER_TOUR_PASSWORD at fill time.
    tour: { username: "tour@example.com", password: () => process.env.E2E_USER_TOUR_PASSWORD ?? "" },
  },
} satisfies E2EConfig
