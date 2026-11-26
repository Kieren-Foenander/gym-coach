import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { test as base } from "@e2e-dev/web"
import { expect, type App, type Screen } from "e2e"
import { Schema } from "effect"
import type { CallName } from "../../src/domain/calls"
import { testIds } from "../../src/domain/test-ids"
import type { CallInput } from "../../src/server/calls"
import { seedStatements, type History } from "../../tools/seed/history"
import { E2E_DATABASE_FILE, E2E_INVITE_CODE } from "../../tools/e2e/constants"

/**
 * What the browser tests share. Elements are found by test id only (`screen.getByTestId` with an id from
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
const makePerson = async (baseUrl: string): Promise<Person> => {
  const email = `e2e-${Date.now()}-${++people}@example.com`

  const response = await fetch(new URL("/api/v1/account/sign-up", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, displayName: "Tester", inviteCode: process.env.E2E_INVITE_CODE ?? E2E_INVITE_CODE }),
  })

  expect(response.status, `Sign-up for ${email}: ${await response.clone().text()}`).toBe(200)

  return { email, password: PASSWORD }
}

const SignedIn = Schema.Struct({ token: Schema.String })

/**
 * Runs calls as a person through the JSON API, for setting up what a test is not about, such as
 * streak goals before a screenshot. The screen under test is still driven by its test ids.
 */
export const callsAs = async (baseUrl: string, person: Person) => {
  const signIn = await fetch(new URL("/api/v1/account/sign-in", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: person.email, password: person.password }),
  })

  const { token } = Schema.decodeUnknownSync(Schema.Struct({ ok: Schema.Literal(true), value: SignedIn }))(await signIn.json()).value

  return async <K extends CallName>(name: K, input: CallInput<K>): Promise<void> => {
    const response = await fetch(new URL(`/api/v1/call/${name}`, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    })

    expect(response.status, `${name}: ${await response.clone().text()}`).toBe(200)
  }
}

/** Signs in through the sign-in screen, and waits for Today. */
export const signIn = async ({ app, screen }: { readonly app: App; readonly screen: Screen }, person: Person) => {
  await app.open("/login")
  // The button turns on once the page is live; anything typed before that is lost when React takes over.
  await expect(screen.getByTestId(testIds.login.submit)).toBeEnabled()
  await screen.getByTestId(testIds.login.email).fill(person.email)
  await screen.getByTestId(testIds.login.password).fill(person.password)
  await screen.getByTestId(testIds.login.submit).tap()
  await expect(screen.getByTestId(testIds.today.weekCard)).toBeVisible()
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
  person: async ({ app }, use) => {
    await use(await makePerson(app.baseUrl))
  },
})

/** Tests that start signed in to a new, empty account, on Today. `person` is that account. */
export const test = withPerson.extend<{ readonly signedIn: void }>({
  signedIn: [
    async ({ app, screen, person }, use) => {
      await signIn({ app, screen }, person)
      await use()
    },
    { auto: true },
  ],
})

/** Tests that start signed in to a new account holding the seed training history, on Today. */
export const seededTest = withPerson.extend<{ readonly signedIn: void }>({
  signedIn: [
    async ({ app, screen, person }, use) => {
      seed(person)
      await signIn({ app, screen }, person)
      await use()
    },
    { auto: true },
  ],
})
