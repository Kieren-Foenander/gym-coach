import { mobile } from "@e2e-dev/mobile"
import { web } from "@e2e-dev/web"
import type { E2EConfig } from "e2e"
import { E2E_PORT, E2E_READY_PORT, E2E_TIME_ZONE } from "./tools/e2e/constants"

/**
 * End-to-end tests with e2e (https://e2e.com), one runner for the web app (e2e/web/) and the native app
 * (e2e/native/). Tests are e2e/**\/*.e2e.ts and find elements by test id only: see CLAUDE.md and
 * src/domain/test-ids.ts.
 *
 *   bun run e2e                      the browser tests, against their own copy of the app (tools/e2e/serve.ts)
 *   E2E_BASE_URL=<url> bun run e2e --tag smoke
 *                                    the smoke tests against a deployed copy, such as a PR preview
 *   bunx e2e run --target ios        the native tour on a booted iOS Simulator
 *   bunx e2e run --target android    the same on a booted Android emulator
 *
 * Screenshot comparisons (e2e/web/screenshots.e2e.ts) are recorded in CI's Playwright image, where fonts
 * render the same every time, so they only run with CI set. To record new ones after a change to how a
 * screen looks, run the "Update screenshots" workflow on the branch.
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

// The browser and the test code both work out days in this time zone, so a day is the same day to each.
process.env.TZ = E2E_TIME_ZONE

const remote = process.env.E2E_BASE_URL

/** The web app, at E2E_BASE_URL, or else served by tools/e2e/serve.ts with a fresh database. */
const webApp = remote
  ? { url: remote }
  : {
      url: `http://localhost:${E2E_PORT}`,
      // serve.ts answers here once the app has rendered a page; e2e gives each try of the app itself 2 s.
      readyUrl: `http://127.0.0.1:${E2E_READY_PORT}/`,
      command: { executable: "bun", args: ["tools/e2e/serve.ts"], startupTimeout: 120_000, log: ".e2e/logs/app.log" },
    }

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
    {
      name: "web",
      // An iPhone 13's screen, the size the app is designed for, in its dark look.
      engine: web({ viewport: { width: 390, height: 844 }, colorScheme: "dark", locale: "en-AU", timezoneId: E2E_TIME_ZONE }),
      app: webApp,
    },
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
