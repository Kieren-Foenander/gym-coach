import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { Effect, Layer, ManagedRuntime, Schema, String as Str } from "effect"
import type { SqlClient } from "effect/sql"
import type { CallName } from "~/domain/calls"
import type { CallInput, CallOutput } from "~/server/calls"
import { userById } from "~/server/auth"
import { apiHandlerFor } from "~/server/http"
import { CurrentUser, getHistory, type HistoryWorkout } from "~/server/repo"
import { seedStatements, type History } from "../../tools/seed/history"

/**
 * The real JSON API (src/server/http.ts and everything behind it) on a SQLite database with
 * every migration applied. D1 is SQLite, so the queries run as they do in production. Each
 * server has its own database file, so tests never see each other's data.
 */

export const INVITE_CODE = "test-invite-code"

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .toSorted()
  .map((file) => readFileSync(join("migrations", file), "utf8"))

export const seedHistory: History = JSON.parse(readFileSync("seed/training-history.json", "utf8"))

export interface Answer {
  readonly status: number
  readonly body: { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
}

const SignedIn = Schema.Struct({ token: Schema.String })

export interface Account {
  readonly token: string
  readonly email: string
  /** Runs a call and returns its value, or throws with the server's message. */
  readonly call: <K extends CallName>(name: K, input: CallInput<K>) => Promise<CallOutput<K>>
}

export interface TestServer {
  /** Sends a raw request, for checking status codes and errors. */
  readonly request: (path: string, init?: { readonly body?: unknown; readonly token?: string; readonly method?: string }) => Promise<Answer>
  /** Makes an account and signs it in. */
  readonly signUp: (email?: string) => Promise<Account>
  /** Loads the seed training history (or another) into an account, as tools/seed/load.ts does. */
  readonly seed: (email: string, history?: History) => void
  /** Runs SQL straight on the database, for setting up what no call can, such as a coach note. */
  readonly exec: (sql: string) => void
  /** Reads one text value straight from the database, for checking what is stored rather than what a call shows. */
  readonly readText: (sql: string) => string
  /** Runs server code straight on the database, for what no request starts, such as the cron's nudges. */
  readonly run: <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => Promise<A>
  /** Every finished workout of an account as the AI coach reads it (get_training_history). */
  readonly coachHistory: (email: string) => Promise<ReadonlyArray<HistoryWorkout>>
  readonly close: () => Promise<void>
}

export const makeServer = (): TestServer => {
  const directory = mkdtempSync(join(tmpdir(), "gym-api-"))
  const filename = join(directory, "gym.sqlite")
  const direct = new DatabaseSync(filename)

  for (const migration of MIGRATIONS) direct.exec(migration)

  const runtime = ManagedRuntime.make(
    SqliteClient.layer({ filename, transformResultNames: Str.snakeToCamel }).pipe(Layer.orDie),
  )

  const handle = apiHandlerFor({
    run: (effect) => runtime.runPromise(effect),
    signupCode: () => INVITE_CODE,
    stage: () => "test",
  })

  const request: TestServer["request"] = async (path, init = {}) => {
    const headers = new Headers({ "content-type": "application/json" })

    if (init.token) headers.set("authorization", `Bearer ${init.token}`)

    const method = init.method ?? "POST"
    const body = method === "GET" ? null : JSON.stringify(init.body ?? {})
    const response = await handle(new Request(`http://gym.test/api/v1/${path}`, { method, headers, body }))
    const answer: Answer["body"] = await response.json()

    return { status: response.status, body: answer }
  }

  let accounts = 0

  const signUp: TestServer["signUp"] = async (email = `person${++accounts}@example.com`) => {
    const answer = await request("account/sign-up", {
      body: { email, password: "a long enough password", displayName: email.split("@")[0], inviteCode: INVITE_CODE },
    })

    if (!answer.body.ok) throw new Error(`Sign-up failed: ${answer.body.error.message}`)

    const { token } = Schema.decodeUnknownSync(SignedIn)(answer.body.value)

    const call: Account["call"] = async (name, input) => {
      const result = await request(`call/${name}`, { body: input, token })

      if (!result.body.ok) throw new Error(`${name} failed (${result.status}): ${result.body.error.message}`)

      // SAFETY: the value is the JSON of what Calls[name] answered, whose type CallOutput<K> is.
      return result.body.value as never
    }

    return { token, email, call }
  }

  return {
    request,
    signUp,
    seed: (email, history = seedHistory) => {
      for (const statement of seedStatements(history, { email })) direct.exec(statement)
    },
    exec: (sql) => direct.exec(sql),
    readText: (sql) => Schema.decodeUnknownSync(Schema.String)(Object.values(direct.prepare(sql).get() ?? {})[0]),
    run: (effect) => runtime.runPromise(effect),
    coachHistory: async (email) => {
      const id = Schema.decodeUnknownSync(Schema.String)(direct.prepare("SELECT id FROM users WHERE email = ?").get(email)?.id)

      return runtime.runPromise(
        Effect.gen(function* () {
          const user = yield* userById(id)

          return yield* getHistory({ since: 0, limit: 20 }).pipe(Effect.provideService(CurrentUser, user))
        }),
      )
    },
    close: async () => {
      await runtime.dispose()
      direct.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
