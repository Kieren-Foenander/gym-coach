import { redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { deleteCookie, getCookie, getRequestProtocol, getRequestUrl, setCookie } from "@tanstack/react-start/server"
import { Effect, Schema } from "effect"
import type { SqlClient } from "effect/sql"
import type { SqlError } from "effect/sql/SqlError"
import { CallInputs } from "~/domain/calls"
import { Credentials, SignUpInput } from "~/domain/schema"
import * as Auth from "~/server/auth"
import { Calls } from "~/server/calls"
import type { DomainError } from "~/server/errors"
import type * as Repo from "~/server/repo"
import { CurrentUser } from "~/server/repo"
import { runtime, signupCode, stage } from "~/server/runtime"

/**
 * Every call the web app makes to the server. Each one validates its input with
 * an Effect Schema, resolves the signed-in user from the session cookie, and
 * runs a call from src/server/calls.ts. The native app runs the same calls
 * through the HTTP API in src/server/http.ts.
 */

// ---------------------------------------------------------------- plumbing

type Database = SqlClient.SqlClient

const settle = <A>(effect: Effect.Effect<A, DomainError | SqlError, Database>) =>
  runtime.runPromise(
    effect.pipe(
      Effect.map((value) => ({ ok: true as const, value })),
      Effect.catchTag("Unauthorized", () =>
        Effect.succeed({ ok: false as const, signedOut: true, message: "Not signed in" }),
      ),
      Effect.catchTag("SqlError", (error) =>
        Effect.logError(error).pipe(
          Effect.as({ ok: false as const, signedOut: false, message: "Something went wrong. Try again." }),
        ),
      ),
      Effect.catch((error) => Effect.succeed({ ok: false as const, signedOut: false, message: error.message })),
    ),
  )

/** Runs an effect for a server function. Failures become a redirect to sign-in or an Error with a readable message. */
const run = async <A>(effect: Effect.Effect<A, DomainError | SqlError, Database>): Promise<A> => {
  const outcome = await settle(effect)

  if (outcome.ok) return outcome.value

  if (outcome.signedOut) throw redirect({ to: "/login" })

  throw new Error(outcome.message)
}

const currentUser = Effect.suspend(() => Auth.userFromSession(getCookie(Auth.SESSION_COOKIE)))

const authed = <A>(effect: Effect.Effect<A, DomainError | SqlError, Database | CurrentUser>) =>
  run(Effect.flatMap(currentUser, (user) => Effect.provideService(effect, CurrentUser, user)))

const startSession = (token: string) =>
  setCookie(Auth.SESSION_COOKIE, token, {
    httpOnly: true,
    secure: getRequestProtocol() === "https",
    sameSite: "lax",
    path: "/",
    maxAge: Auth.SESSION_DAYS * 86_400,
  })

const input = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => Schema.toStandardSchemaV1(schema)

// ---------------------------------------------------------------- account

export const getSession = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    currentUser.pipe(
      Effect.map((user): Repo.User | null => user),
      Effect.catch(() => Effect.succeed(null)),
    ),
  ),
)

/** Which copy of the app this is. The AI coach card names the connector after it. */
export const getDeployment = createServerFn({ method: "GET" }).handler(() => ({ stage: stage() }))

export const getSignupStatus = createServerFn({ method: "GET" }).handler(() => run(Auth.signupStatus(signupCode())))

export const signUp = createServerFn({ method: "POST" })
  .validator(input(SignUpInput))
  .handler(async ({ data }) => {
    startSession(await run(Auth.signUp(data, signupCode())))
  })

export const signIn = createServerFn({ method: "POST" })
  .validator(input(Credentials))
  .handler(async ({ data }) => {
    startSession(await run(Auth.signIn(data)))
  })

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  await run(Auth.signOut(getCookie(Auth.SESSION_COOKIE)))
  deleteCookie(Auth.SESSION_COOKIE, { path: "/" })
})

export const updateProfile = createServerFn({ method: "POST" })
  .validator(input(CallInputs.updateProfile))
  .handler(({ data }) => authed(Calls.updateProfile.run(data)))

// ---------------------------------------------------------------- reads

export const getToday = createServerFn({ method: "GET" }).handler(() => authed(Calls.getToday.run({})))

export const getPlan = createServerFn({ method: "GET" }).handler(() => authed(Calls.getPlan.run({})))

export const getWorkout = createServerFn({ method: "GET" })
  .validator(input(CallInputs.getWorkout))
  .handler(({ data }) => authed(Calls.getWorkout.run(data)))

export const getHistory = createServerFn({ method: "GET" }).handler(() => authed(Calls.getHistory.run({})))

export const getCalendar = createServerFn({ method: "GET" }).handler(() => authed(Calls.getCalendar.run({})))

export const getExerciseProgress = createServerFn({ method: "GET" })
  .validator(input(CallInputs.getExerciseProgress))
  .handler(({ data }) => authed(Calls.getExerciseProgress.run(data)))

export const getLibraryExercise = createServerFn({ method: "GET" })
  .validator(input(CallInputs.getLibraryExercise))
  .handler(({ data }) => authed(Calls.getLibraryExercise.run(data)))

export const getExercises = createServerFn({ method: "GET" }).handler(() => authed(Calls.getExercises.run({})))

// ---------------------------------------------------------------- workouts

export const startWorkout = createServerFn({ method: "POST" })
  .validator(input(CallInputs.startWorkout))
  .handler(({ data }) => authed(Calls.startWorkout.run(data)))

export const startOpenWorkout = createServerFn({ method: "POST" }).handler(() => authed(Calls.startOpenWorkout.run({})))

export const addWorkoutExercise = createServerFn({ method: "POST" })
  .validator(input(CallInputs.addWorkoutExercise))
  .handler(({ data }) => authed(Calls.addWorkoutExercise.run(data)))

export const removeWorkoutExercise = createServerFn({ method: "POST" })
  .validator(input(CallInputs.removeWorkoutExercise))
  .handler(({ data }) => authed(Calls.removeWorkoutExercise.run(data)))

export const logSet = createServerFn({ method: "POST" })
  .validator(input(CallInputs.logSet))
  .handler(({ data }) => authed(Calls.logSet.run(data)))

export const swapExercise = createServerFn({ method: "POST" })
  .validator(input(CallInputs.swapExercise))
  .handler(({ data }) => authed(Calls.swapExercise.run(data)))

export const updateSet = createServerFn({ method: "POST" })
  .validator(input(CallInputs.updateSet))
  .handler(({ data }) => authed(Calls.updateSet.run(data)))

export const setExerciseNote = createServerFn({ method: "POST" })
  .validator(input(CallInputs.setExerciseNote))
  .handler(({ data }) => authed(Calls.setExerciseNote.run(data)))

export const deleteSet = createServerFn({ method: "POST" })
  .validator(input(CallInputs.deleteSet))
  .handler(({ data }) => authed(Calls.deleteSet.run(data)))

export const finishWorkout = createServerFn({ method: "POST" })
  .validator(input(CallInputs.finishWorkout))
  .handler(({ data }) => authed(Calls.finishWorkout.run(data)))

export const discardWorkout = createServerFn({ method: "POST" })
  .validator(input(CallInputs.discardWorkout))
  .handler(({ data }) => authed(Calls.discardWorkout.run(data)))

// ---------------------------------------------------------------- plan editing

export const applyTemplate = createServerFn({ method: "POST" })
  .validator(input(CallInputs.applyTemplate))
  .handler(({ data }) => authed(Calls.applyTemplate.run(data)))

export const addPlanDay = createServerFn({ method: "POST" })
  .validator(input(CallInputs.addPlanDay))
  .handler(({ data }) => authed(Calls.addPlanDay.run(data)))

export const removePlanDay = createServerFn({ method: "POST" })
  .validator(input(CallInputs.removePlanDay))
  .handler(({ data }) => authed(Calls.removePlanDay.run(data)))

export const movePlanDay = createServerFn({ method: "POST" })
  .validator(input(CallInputs.movePlanDay))
  .handler(({ data }) => authed(Calls.movePlanDay.run(data)))

export const movePlanExercise = createServerFn({ method: "POST" })
  .validator(input(CallInputs.movePlanExercise))
  .handler(({ data }) => authed(Calls.movePlanExercise.run(data)))

export const addPlanExercise = createServerFn({ method: "POST" })
  .validator(input(CallInputs.addPlanExercise))
  .handler(({ data }) => authed(Calls.addPlanExercise.run(data)))

export const updatePlanExercise = createServerFn({ method: "POST" })
  .validator(input(CallInputs.updatePlanExercise))
  .handler(({ data }) => authed(Calls.updatePlanExercise.run(data)))

export const removePlanExercise = createServerFn({ method: "POST" })
  .validator(input(CallInputs.removePlanExercise))
  .handler(({ data }) => authed(Calls.removePlanExercise.run(data)))

export const deleteCoachNote = createServerFn({ method: "POST" })
  .validator(input(CallInputs.deleteCoachNote))
  .handler(({ data }) => authed(Calls.deleteCoachNote.run(data)))

// ---------------------------------------------------------------- body

export const logMeasurement = createServerFn({ method: "POST" })
  .validator(input(CallInputs.logMeasurement))
  .handler(({ data }) => authed(Calls.logMeasurement.run(data)))

export const deleteMeasurement = createServerFn({ method: "POST" })
  .validator(input(CallInputs.deleteMeasurement))
  .handler(({ data }) => authed(Calls.deleteMeasurement.run(data)))

// ---------------------------------------------------------------- food

export const getNutrition = createServerFn({ method: "GET" })
  .validator(input(CallInputs.getNutrition))
  .handler(({ data }) => authed(Calls.getNutrition.run(data)))

export const logFood = createServerFn({ method: "POST" })
  .validator(input(CallInputs.logFood))
  .handler(({ data }) => authed(Calls.logFood.run(data)))

export const updateFood = createServerFn({ method: "POST" })
  .validator(input(CallInputs.updateFood))
  .handler(({ data }) => authed(Calls.updateFood.run(data)))

export const deleteFood = createServerFn({ method: "POST" })
  .validator(input(CallInputs.deleteFood))
  .handler(({ data }) => authed(Calls.deleteFood.run(data)))

// ---------------------------------------------------------------- mini workouts

export const getMinis = createServerFn({ method: "GET" })
  .validator(input(CallInputs.getMinis))
  .handler(({ data }) => authed(Calls.getMinis.run(data)))

export const updateMinis = createServerFn({ method: "POST" })
  .validator(input(CallInputs.updateMinis))
  .handler(({ data }) => authed(Calls.updateMinis.run(data)))

export const pauseMinis = createServerFn({ method: "POST" })
  .validator(input(CallInputs.pauseMinis))
  .handler(({ data }) => authed(Calls.pauseMinis.run(data)))

export const logMini = createServerFn({ method: "POST" })
  .validator(input(CallInputs.logMini))
  .handler(({ data }) => authed(Calls.logMini.run(data)))

export const deleteMini = createServerFn({ method: "POST" })
  .validator(input(CallInputs.deleteMini))
  .handler(({ data }) => authed(Calls.deleteMini.run(data)))

export const skipNudge = createServerFn({ method: "POST" })
  .validator(input(CallInputs.skipNudge))
  .handler(({ data }) => authed(Calls.skipNudge.run(data)))

// The origin is the address this request came to, whatever the browser sent.
export const subscribePush = createServerFn({ method: "POST" })
  .validator(input(CallInputs.subscribePush))
  .handler(({ data }) => authed(Calls.subscribePush.run({ ...data, origin: getRequestUrl().origin })))

export const unsubscribePush = createServerFn({ method: "POST" })
  .validator(input(CallInputs.unsubscribePush))
  .handler(({ data }) => authed(Calls.unsubscribePush.run(data)))

export const testPush = createServerFn({ method: "POST" }).handler(() => authed(Calls.testPush.run({})))
