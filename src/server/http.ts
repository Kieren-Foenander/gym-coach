import { Effect, Schema } from "effect"
import type { SqlClient } from "effect/sql"
import type { SqlError } from "effect/sql/SqlError"
import { Credentials, SignUpInput } from "~/domain/schema"
import * as Auth from "./auth"
import { Calls, isCallName } from "./calls"
import { Invalid, NotFound, type DomainError } from "./errors"
import { CurrentUser } from "./repo"

/**
 * The JSON API the native app uses. Every request is a POST with a JSON body:
 *
 *   /api/v1/account/signup-status   whether sign-up is open
 *   /api/v1/account/sign-up         makes an account, answers with a session token
 *   /api/v1/account/sign-in         answers with a session token
 *   /api/v1/account/sign-out        ends the session whose token was sent
 *   /api/v1/deployment              which copy of the app this is: { stage }
 *   /api/v1/call/<name>             one of the calls in src/domain/calls.ts
 *
 * A call needs `Authorization: Bearer <token>`. Cookies are never read here, so a web page
 * cannot make a signed-in request on someone's behalf.
 *
 * An answer is `{ ok: true, value }`, or `{ ok: false, error: { code, message } }` with a matching status.
 *
 * The handler is made from what the deployment provides (src/server.ts passes the Worker's), so
 * the tests in test/server can run the same handler against a SQLite database.
 */

export const API_PREFIX = "/api/v1/"

const MAX_BODY_CHARACTERS = 64 * 1024

type ErrorCode = "unauthorized" | "not_found" | "invalid" | "server"

const json = <A>(status: number, body: A) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  })

const ok = <A>(value: A) => json(200, { ok: true, value: value ?? null })

const failure = (status: number, code: ErrorCode, message: string) =>
  Effect.succeed(json(status, { ok: false, error: { code, message } }))

const bearerToken = (request: Request) => {
  const header = request.headers.get("authorization") ?? ""

  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined
}

const readBody = (request: Request) =>
  Effect.tryPromise({
    try: () => request.text(),
    catch: () => new Invalid({ reason: "Could not read the request" }),
  }).pipe(
    Effect.filterOrFail(
      (text) => text.length <= MAX_BODY_CHARACTERS,
      () => new Invalid({ reason: "That request is too large" }),
    ),
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text === "" ? "{}" : text),
        catch: () => new Invalid({ reason: "That request is not JSON" }),
      }),
    ),
  )

/** A new session and the account it belongs to, which is what a client needs to start. */
const sessionFor = (token: string) => Effect.map(Auth.userFromSession(token), (user) => ok({ token, user }))

/** What the API needs from the deployment it runs in. */
export interface ApiDeployment {
  /** Runs a request against the database. */
  readonly run: <A>(effect: Effect.Effect<A, never, SqlClient.SqlClient>) => Promise<A>
  readonly signupCode: () => string | undefined
  readonly stage: () => string
}

const route = (request: Request, path: string, { signupCode, stage }: ApiDeployment) => {
  const body = readBody(request)

  if (path === "account/signup-status") return Effect.map(Auth.signupStatus(signupCode()), ok)

  if (path === "deployment") return Effect.succeed(ok({ stage: stage() }))

  if (path === "account/sign-up") {
    return body.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(SignUpInput)),
      Effect.flatMap((input) => Auth.signUp(input, signupCode())),
      Effect.flatMap(sessionFor),
    )
  }

  if (path === "account/sign-in") {
    return body.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Credentials)),
      Effect.flatMap(Auth.signIn),
      Effect.flatMap(sessionFor),
    )
  }

  if (path === "account/sign-out") return Effect.map(Auth.signOut(bearerToken(request)), ok)

  const name = path.startsWith("call/") ? path.slice("call/".length) : ""

  if (!isCallName(name)) return Effect.fail(new NotFound({ what: "API call" }))

  return Effect.gen(function* () {
    const user = yield* Auth.userFromSession(bearerToken(request))
    const call = Effect.flatMap(body, (input) => Calls[name].handle(input))

    return ok(yield* Effect.provideService(call, CurrentUser, user))
  })
}

const settle = (
  effect: Effect.Effect<Response, DomainError | SqlError | Schema.SchemaError, SqlClient.SqlClient>,
  { run }: ApiDeployment,
) =>
  run(
    effect.pipe(
      Effect.catchTags({
        Unauthorized: () => failure(401, "unauthorized", "Not signed in"),
        NotFound: (error) => failure(404, "not_found", error.message),
        Invalid: (error) => failure(400, "invalid", error.message),
        SchemaError: (error) => failure(400, "invalid", `That request is not valid. ${error.message}`),
        SqlError: (error) =>
          Effect.logError(error).pipe(Effect.andThen(failure(500, "server", "Something went wrong. Try again."))),
      }),
    ),
  )

export const apiHandlerFor =
  (deployment: ApiDeployment) =>
  (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return Promise.resolve(
        json(405, { ok: false, error: { code: "invalid" satisfies ErrorCode, message: "Use POST" } }),
      )
    }

    return settle(route(request, new URL(request.url).pathname.slice(API_PREFIX.length), deployment), deployment)
  }
