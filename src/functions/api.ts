import { redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { deleteCookie, getCookie, getRequestProtocol, setCookie } from "@tanstack/react-start/server"
import { Effect, Schema } from "effect"
import type { SqlClient } from "effect/sql"
import type { SqlError } from "effect/sql/SqlError"
import {
  Credentials,
  Direction,
  ExercisePrescription,
  Id,
  MeasurementInput,
  PlanExercisePatch,
  ProfilePatch,
  SetInput,
  SignUpInput,
} from "~/domain/schema"
import { catalogBySlug } from "~/domain/catalog"
import { PLAN_TEMPLATES } from "~/domain/templates"
import * as Auth from "~/server/auth"
import { Invalid, NotFound, type DomainError } from "~/server/errors"
import * as Repo from "~/server/repo"
import { CurrentUser } from "~/server/repo"
import { runtime, signupCode } from "~/server/runtime"

/**
 * Every call the app makes to the server. Each one validates its input with
 * an Effect Schema, resolves the signed-in user from the session cookie, and
 * runs a repository effect. A native client can call the same repository
 * through a thin HTTP layer later.
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
  .validator(input(ProfilePatch))
  .handler(({ data }) => authed(Repo.updateProfile(data)))

// ---------------------------------------------------------------- reads

export const getToday = createServerFn({ method: "GET" }).handler(() =>
  authed(Effect.all({ today: Repo.getToday(), activity: Repo.listActivity(182) })),
)

export const getPlan = createServerFn({ method: "GET" }).handler(() => authed(Repo.getActivePlan()))

export const getWorkout = createServerFn({ method: "GET" })
  .validator(input(Schema.Struct({ workoutId: Id })))
  .handler(({ data }) => authed(Repo.getWorkoutDetail(data.workoutId)))

export const getHistory = createServerFn({ method: "GET" }).handler(() =>
  authed(
    Effect.all({
      workouts: Repo.listWorkouts(100),
      exercises: Repo.listExercises(),
      measurements: Repo.listMeasurements(500),
    }),
  ),
)

export const getExerciseProgress = createServerFn({ method: "GET" })
  .validator(input(Schema.Struct({ exerciseId: Id })))
  .handler(({ data }) =>
    authed(Effect.all({ progress: Repo.getExerciseProgress({ id: data.exerciseId }, 60), plan: Repo.getActivePlan() })),
  )

/** A library exercise, with the user's own progress on it if they have any. */
export const getLibraryExercise = createServerFn({ method: "GET" })
  .validator(input(Schema.Struct({ slug: Schema.String.check(Schema.isMaxLength(100)) })))
  .handler(({ data }) => {
    const entry = catalogBySlug(data.slug)

    return authed(
      entry
        ? Effect.all({ progress: Repo.getProgressByName(entry.name, 60), plan: Repo.getActivePlan() })
        : Effect.fail(new NotFound({ what: "That exercise" })),
    )
  })

// ---------------------------------------------------------------- workouts

export const startWorkout = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ planDayId: Id })))
  .handler(({ data }) => authed(Repo.startWorkout(data.planDayId)))

export const startOpenWorkout = createServerFn({ method: "POST" }).handler(() => authed(Repo.startOpenWorkout()))

const ExerciseName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80))

export const addWorkoutExercise = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ workoutId: Id, exercise: ExerciseName })))
  .handler(({ data }) => authed(Repo.addWorkoutExercise(data.workoutId, data.exercise)))

export const removeWorkoutExercise = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ workoutId: Id, exerciseId: Id })))
  .handler(({ data }) => authed(Repo.removeWorkoutExercise(data.workoutId, data.exerciseId)))

export const logSet = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ workoutId: Id, exerciseId: Id, set: SetInput })))
  .handler(({ data }) => authed(Repo.logSet(data.workoutId, { ...data.set, exerciseId: data.exerciseId })))

export const swapExercise = createServerFn({ method: "POST" })
  .validator(
    input(
      Schema.Struct({
        workoutId: Id,
        planExerciseId: Id,
        exercise: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
      }),
    ),
  )
  .handler(({ data }) => authed(Repo.swapExercise(data.workoutId, data.planExerciseId, data.exercise)))

export const getExercises = createServerFn({ method: "GET" }).handler(() => authed(Repo.listExercises()))

export const updateSet = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ setId: Id, set: SetInput })))
  .handler(({ data }) => authed(Repo.updateSet(data.setId, data.set)))

export const deleteSet = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ setId: Id })))
  .handler(({ data }) => authed(Repo.deleteSet(data.setId)))

export const finishWorkout = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ workoutId: Id })))
  .handler(({ data }) => authed(Repo.finishWorkout(data.workoutId)))

export const discardWorkout = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ workoutId: Id })))
  .handler(({ data }) => authed(Repo.discardWorkout(data.workoutId)))

// ---------------------------------------------------------------- plan editing

export const applyTemplate = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ templateId: Schema.String })))
  .handler(({ data }) => {
    const template = PLAN_TEMPLATES.find((item) => item.id === data.templateId)

    return authed(
      template
        ? Effect.asVoid(Repo.createPlan(template.plan, "user"))
        : Effect.fail(new Invalid({ reason: "That starter plan does not exist" })),
    )
  })

export const addPlanDay = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80)) })))
  .handler(({ data }) => authed(Repo.addPlanDay(data.name)))

export const removePlanDay = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ planDayId: Id })))
  .handler(({ data }) => authed(Repo.removePlanDay(data.planDayId)))

export const movePlanDay = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ planDayId: Id, direction: Direction })))
  .handler(({ data }) => authed(Repo.movePlanDay(data.planDayId, data.direction)))

export const movePlanExercise = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ planExerciseId: Id, direction: Direction })))
  .handler(({ data }) => authed(Repo.movePlanExercise(data.planExerciseId, data.direction)))

export const addPlanExercise = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ planDayId: Id, exercise: ExercisePrescription })))
  .handler(({ data }) => authed(Effect.asVoid(Repo.addPlanExercise(data.planDayId, data.exercise))))

export const updatePlanExercise = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ planExerciseId: Id, changes: PlanExercisePatch })))
  .handler(({ data }) => authed(Effect.asVoid(Repo.updatePlanExercise(data.planExerciseId, data.changes, "user"))))

export const removePlanExercise = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ planExerciseId: Id })))
  .handler(({ data }) => authed(Effect.asVoid(Repo.removePlanExercise(data.planExerciseId))))

export const deleteCoachNote = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ noteId: Id })))
  .handler(({ data }) => authed(Repo.deleteCoachNote(data.noteId)))

// ---------------------------------------------------------------- body

export const logMeasurement = createServerFn({ method: "POST" })
  .validator(input(MeasurementInput))
  .handler(({ data }) => authed(Repo.logMeasurement(data)))

export const deleteMeasurement = createServerFn({ method: "POST" })
  .validator(input(Schema.Struct({ measurementId: Id })))
  .handler(({ data }) => authed(Repo.deleteMeasurement(data.measurementId)))
