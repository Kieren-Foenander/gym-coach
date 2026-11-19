/** What the browser tests and the server they run against agree on (tools/e2e/serve.ts, e2e/support.ts). */
export const E2E_PORT = 4174
export const E2E_INVITE_CODE = "e2e-invite-code"

/** Where serve.ts writes the path of this run's database file. */
export const E2E_DATABASE_FILE = ".alchemy/e2e-database"

/** The time zone the browser and the test code both use, so a day is the same day to each. */
export const E2E_TIME_ZONE = "Australia/Brisbane"
