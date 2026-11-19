import { defineConfig } from "@playwright/test"
import { E2E_PORT, E2E_TIME_ZONE } from "./tools/e2e/constants"

/**
 * Browser tests for the web app (e2e/). They find elements by test id only: see CLAUDE.md and
 * src/domain/test-ids.ts.
 *
 *   bun run e2e                      serves its own copy of the app (tools/e2e/serve.ts) and runs them
 *   E2E_BASE_URL=<url> bun run e2e   runs the smoke tests against a deployed copy, such as a PR preview
 *
 * Screenshot comparisons run in CI only, where the fonts render the same every time. To record new
 * ones after a change to how a screen looks, run the "Update screenshots" workflow on the branch.
 */

// The test workers start after this file runs, so they work out days in the browser's time zone.
process.env.TZ = E2E_TIME_ZONE

const remote = process.env.E2E_BASE_URL
const ci = Boolean(process.env.CI)

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  ignoreSnapshots: !ci,
  snapshotPathTemplate: "e2e/screenshots/{testFilePath}/{arg}{ext}",
  // A deployed copy has no seed history to load, so only the smoke tests run against it.
  grep: remote ? /@smoke/ : undefined,
  use: {
    baseURL: remote ?? `http://localhost:${E2E_PORT}`,
    browserName: "chromium",
    // An iPhone 13's screen, the size the app is designed for.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
    timezoneId: E2E_TIME_ZONE,
    locale: "en-AU",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: remote
    ? undefined
    : {
        command: "bun tools/e2e/serve.ts",
        url: `http://localhost:${E2E_PORT}/login`,
        timeout: 120_000,
        reuseExistingServer: false,
        stdout: "pipe",
      },
})
