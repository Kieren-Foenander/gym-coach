import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { expect, test as base, type Page } from "@playwright/test"
import { testIds } from "../src/domain/test-ids"
import { seedStatements, type History } from "../tools/seed/history"
import { E2E_DATABASE_FILE, E2E_INVITE_CODE } from "../tools/e2e/constants"

/**
 * What the browser tests share. Elements are found by test id only (`page.getByTestId` with an id from
 * src/domain/test-ids.ts), and values are read from `data-state` and `data-value`, never from the words
 * on screen. test/test-ids.test.ts fails the build if a test does otherwise.
 */

export { expect, testIds }

export interface Person {
  readonly email: string
  readonly password: string
}

const PASSWORD = "a long enough password"

let people = 0

/** A new account on the server under test, made through the JSON API. */
const makePerson = async (baseURL: string): Promise<Person> => {
  const email = `e2e-${Date.now()}-${++people}@example.com`

  const response = await fetch(new URL("/api/v1/account/sign-up", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, displayName: "Tester", inviteCode: process.env.E2E_INVITE_CODE ?? E2E_INVITE_CODE }),
  })

  expect(response.status, `Sign-up for ${email}`).toBe(200)

  return { email, password: PASSWORD }
}

/** Signs in through the sign-in screen, and waits for Today. */
export const signIn = async (page: Page, person: Person) => {
  await page.goto("/login")
  // The button turns on once the page is live; anything typed before that is lost when React takes over.
  await expect(page.getByTestId(testIds.login.submit)).toBeEnabled()
  await page.getByTestId(testIds.login.email).fill(person.email)
  await page.getByTestId(testIds.login.password).fill(person.password)
  await page.getByTestId(testIds.login.submit).click()
  await expect(page.getByTestId(testIds.today.weekCard)).toBeVisible()
}

export const seedHistory: History = JSON.parse(readFileSync("seed/training-history.json", "utf8"))

/** Loads the seed training history into an account, straight into the local server's database. */
const seed = (person: Person) => {
  const database = new DatabaseSync(readFileSync(E2E_DATABASE_FILE, "utf8").trim())

  try {
    for (const statement of seedStatements(seedHistory, { email: person.email })) database.exec(statement)
  } finally {
    database.close()
  }
}

/** Tests that start signed out, on a page with nothing loaded. */
export const signedOutTest = base

const withPerson = base.extend<{ readonly person: Person }>({
  person: async ({ baseURL }, use) => {
    await use(await makePerson(baseURL ?? ""))
  },
})

/** Tests that start signed in to a new, empty account, on Today. `person` is that account. */
export const test = withPerson.extend({
  page: async ({ page, person }, use) => {
    await signIn(page, person)
    await use(page)
  },
})

/** Tests that start signed in to a new account holding the seed training history, on Today. */
export const seededTest = withPerson.extend({
  page: async ({ page, person }, use) => {
    seed(person)
    await signIn(page, person)
    await use(page)
  },
})
