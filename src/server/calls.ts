import { Effect, flow, Schema } from "effect"
import type { SqlClient } from "effect/sql"
import type { SqlError } from "effect/sql/SqlError"
import { CallInputs, type CallName } from "~/domain/calls"
import { catalogBySlug } from "~/domain/catalog"
import { demoFor, RENDERED_SLUGS } from "~/domain/demos"
import { PLAN_TEMPLATES } from "~/domain/templates"
import { Invalid, NotFound, type DomainError } from "./errors"
import * as Health from "./health"
import * as Minis from "./minis"
import * as Nutrition from "./nutrition"
import * as Repo from "./repo"
import { CurrentUser } from "./repo"

/**
 * What each call in src/domain/calls.ts does for the signed-in user. The web app reaches
 * these through its server functions and the native app through the HTTP API, so the two
 * cannot drift apart.
 */

type CallEffect<A> = Effect.Effect<A, DomainError | SqlError, SqlClient.SqlClient | CurrentUser>

/** Anything a call can answer with: it only has to survive being sent as JSON. */
type Answer = {} | null | void

const define = <S extends Schema.ConstraintDecoder<unknown>, A>(input: S, run: (data: S["Type"]) => CallEffect<A>) => ({
  run,
  /** Checks a decoded JSON body against the call's input, then runs the call. */
  handle: flow(Schema.decodeUnknownEffect(input), Effect.flatMap(run)),
})

export const Calls = {
  // account
  getSession: define(CallInputs.getSession, () =>
    Effect.gen(function* () {
      const user: Repo.User = yield* CurrentUser

      return user
    }),
  ),
  updateProfile: define(CallInputs.updateProfile, (data) => Repo.updateProfile(data)),

  // reads
  getToday: define(CallInputs.getToday, () => Effect.all({ today: Repo.getToday(), activity: Repo.listActivity() })),
  getCalendar: define(CallInputs.getCalendar, () => Repo.listCalendar()),
  getPlan: define(CallInputs.getPlan, () => Repo.getActivePlan()),
  getWorkout: define(CallInputs.getWorkout, (data) => Repo.getWorkoutDetail(data.workoutId)),
  getHistory: define(CallInputs.getHistory, () =>
    Effect.all({
      // The latest workouts to list, and totals over all of them for the figures above the list.
      workouts: Repo.listWorkouts(100),
      totals: Repo.getWorkoutTotals(),
      exercises: Repo.listExercises(),
      measurements: Repo.listMeasurements(500),
    }),
  ),
  getExercises: define(CallInputs.getExercises, () => Repo.listExercises()),
  getExerciseProgress: define(CallInputs.getExerciseProgress, (data) =>
    Effect.all({ progress: Repo.getExerciseProgress({ id: data.exerciseId }, 60), plan: Repo.getActivePlan() }),
  ),
  /** A library exercise, with the user's own progress on it if they have any. */
  getLibraryExercise: define(CallInputs.getLibraryExercise, (data) => {
    const entry = catalogBySlug(data.slug)

    return entry
      ? Effect.all({ progress: Repo.getProgressByName(entry.name, 60), plan: Repo.getActivePlan() })
      : Effect.fail(new NotFound({ what: "That exercise" }))
  }),
  /**
   * The demonstrations that have been rendered. The native app asks for this instead of
   * carrying the list, so a newly rendered exercise shows up without a new build.
   */
  getDemos: define(CallInputs.getDemos, () => Effect.succeed(RENDERED_SLUGS.flatMap((slug) => demoFor(slug) ?? []))),

  // workouts
  startWorkout: define(CallInputs.startWorkout, (data) => Repo.startWorkout(data.planDayId)),
  startOpenWorkout: define(CallInputs.startOpenWorkout, () => Repo.startOpenWorkout()),
  addWorkoutExercise: define(CallInputs.addWorkoutExercise, (data) =>
    Repo.addWorkoutExercise(data.workoutId, data.exercise),
  ),
  removeWorkoutExercise: define(CallInputs.removeWorkoutExercise, (data) =>
    Repo.removeWorkoutExercise(data.workoutId, data.exerciseId),
  ),
  logSet: define(CallInputs.logSet, (data) =>
    Repo.logSet(data.workoutId, { ...data.set, exerciseId: data.exerciseId, clientKey: data.clientKey }),
  ),
  swapExercise: define(CallInputs.swapExercise, (data) =>
    Repo.swapExercise(data.workoutId, data.planExerciseId, data.exercise),
  ),
  updateSet: define(CallInputs.updateSet, (data) => Repo.updateSet(data.setId, data.set)),
  setExerciseNote: define(CallInputs.setExerciseNote, (data) =>
    Repo.setExerciseNote(data.workoutId, data.exerciseId, data.note),
  ),
  deleteSet: define(CallInputs.deleteSet, (data) => Repo.deleteSet(data.setId)),
  finishWorkout: define(CallInputs.finishWorkout, (data) => Repo.finishWorkout(data.workoutId)),
  discardWorkout: define(CallInputs.discardWorkout, (data) => Repo.discardWorkout(data.workoutId)),

  // plan editing
  applyTemplate: define(CallInputs.applyTemplate, (data) => {
    const template = PLAN_TEMPLATES.find((item) => item.id === data.templateId)

    return template
      ? Effect.asVoid(Repo.createPlan(template.plan, "user"))
      : Effect.fail(new Invalid({ reason: "That starter plan does not exist" }))
  }),
  addPlanDay: define(CallInputs.addPlanDay, (data) => Repo.addPlanDay(data.name)),
  removePlanDay: define(CallInputs.removePlanDay, (data) => Repo.removePlanDay(data.planDayId)),
  movePlanDay: define(CallInputs.movePlanDay, (data) => Repo.movePlanDay(data.planDayId, data.direction)),
  movePlanExercise: define(CallInputs.movePlanExercise, (data) =>
    Repo.movePlanExercise(data.planExerciseId, data.direction),
  ),
  addPlanExercise: define(CallInputs.addPlanExercise, (data) =>
    Effect.asVoid(Repo.addPlanExercise(data.planDayId, data.exercise)),
  ),
  updatePlanExercise: define(CallInputs.updatePlanExercise, (data) =>
    Effect.asVoid(Repo.updatePlanExercise(data.planExerciseId, data.changes, "user")),
  ),
  removePlanExercise: define(CallInputs.removePlanExercise, (data) =>
    Effect.asVoid(Repo.removePlanExercise(data.planExerciseId)),
  ),
  deleteCoachNote: define(CallInputs.deleteCoachNote, (data) => Repo.deleteCoachNote(data.noteId)),

  // body
  logMeasurement: define(CallInputs.logMeasurement, (data) => Repo.logMeasurement(data)),
  deleteMeasurement: define(CallInputs.deleteMeasurement, (data) => Repo.deleteMeasurement(data.measurementId)),

  // food
  getNutrition: define(CallInputs.getNutrition, (data) => Nutrition.getNutrition(data.from, data.to)),
  logFood: define(CallInputs.logFood, (data) => Nutrition.logFood(data.day, data.food, "user")),
  updateFood: define(CallInputs.updateFood, (data) => Nutrition.updateFood(data.foodId, data.food)),
  deleteFood: define(CallInputs.deleteFood, (data) => Nutrition.deleteFood(data.foodId)),

  // Apple Health
  importHealth: define(CallInputs.importHealth, (data) => Health.importHealth(data)),
  /** Daily readings from the last five weeks: enough for the latest of each and what is usual. */
  getHealth: define(CallInputs.getHealth, () => Effect.map(Health.listHealthDaily(35), (daily) => ({ daily }))),

  // mini workouts
  getMinis: define(CallInputs.getMinis, (data) => Minis.getMinis(data.from, data.to)),
  updateMinis: define(CallInputs.updateMinis, (data) => Minis.updateMinis(data.day, data.settings)),
  logMini: define(CallInputs.logMini, (data) => Minis.logMini(data)),
  deleteMini: define(CallInputs.deleteMini, (data) => Minis.deleteMini(data.entryId)),
  skipNudge: define(CallInputs.skipNudge, (data) => Minis.skipNudge(data.nudgeId)),
  subscribePush: define(CallInputs.subscribePush, (data) => Minis.subscribePush(data.subscription, data.origin)),
  unsubscribePush: define(CallInputs.unsubscribePush, (data) => Minis.unsubscribePush(data.endpoint)),
  testPush: define(CallInputs.testPush, () => Minis.testPush()),
} satisfies { readonly [K in CallName]: { readonly run: (data: (typeof CallInputs)[K]["Type"]) => CallEffect<Answer> } }

/** What a client sends for a call: its input as JSON, before the server trims or checks it. */
export type CallInput<K extends CallName> = (typeof CallInputs)[K]["Encoded"]

/** What a call answers with. Calls that only change something answer with nothing. */
export type CallOutput<K extends CallName> = Effect.Success<ReturnType<(typeof Calls)[K]["run"]>>

export const isCallName = (name: string): name is CallName => Object.hasOwn(Calls, name)
