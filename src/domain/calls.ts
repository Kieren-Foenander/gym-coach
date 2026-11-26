import { Schema } from "effect"
import { MINI_LIMITS, MINI_UNITS } from "./minis"
import {
  AppOrigin,
  Day,
  Direction,
  ExercisePrescription,
  FoodInput,
  HealthImport,
  Id,
  MeasurementInput,
  MiniSettingsInput,
  MiniTargetInput,
  PlanExercisePatch,
  ProfilePatch,
  PushSubscriptionInput,
  SetInput,
} from "./schema"

/**
 * What each call a signed-in client can make takes as input. The web app's server
 * functions (src/functions/api.ts) and the HTTP API the native app uses
 * (src/server/http.ts) both validate against these, and src/server/calls.ts says
 * what each one does.
 */

const ExerciseName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80))
const Nothing = Schema.Struct({})

export const CallInputs = {
  // account
  getSession: Nothing,
  updateProfile: ProfilePatch,

  // reads
  getToday: Nothing,
  getPlan: Nothing,
  getWorkout: Schema.Struct({ workoutId: Id }),
  getHistory: Nothing,
  getCalendar: Nothing,
  getExercises: Nothing,
  getExerciseProgress: Schema.Struct({ exerciseId: Id }),
  getLibraryExercise: Schema.Struct({ slug: Schema.String.check(Schema.isMaxLength(100)) }),
  getDemos: Nothing,

  // workouts
  startWorkout: Schema.Struct({ planDayId: Id }),
  startOpenWorkout: Nothing,
  addWorkoutExercise: Schema.Struct({ workoutId: Id, exercise: ExerciseName }),
  removeWorkoutExercise: Schema.Struct({ workoutId: Id, exerciseId: Id }),
  logSet: Schema.Struct({
    workoutId: Id,
    exerciseId: Id,
    set: SetInput,
    /**
     * A key the client makes up for this set. Sending the same set again with the same key
     * logs it once, so a phone can safely resend a set whose reply was lost.
     */
    clientKey: Schema.optional(Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(64))),
  }),
  swapExercise: Schema.Struct({ workoutId: Id, planExerciseId: Id, exercise: ExerciseName }),
  updateSet: Schema.Struct({ setId: Id, set: SetInput }),
  /** A note on one exercise in this workout, such as "seat on 4". An empty note removes it. */
  setExerciseNote: Schema.Struct({ workoutId: Id, exerciseId: Id, note: Schema.Trim.check(Schema.isMaxLength(500)) }),
  deleteSet: Schema.Struct({ setId: Id }),
  finishWorkout: Schema.Struct({ workoutId: Id }),
  discardWorkout: Schema.Struct({ workoutId: Id }),

  // plan editing
  applyTemplate: Schema.Struct({ templateId: Schema.String }),
  addPlanDay: Schema.Struct({ name: ExerciseName }),
  removePlanDay: Schema.Struct({ planDayId: Id }),
  movePlanDay: Schema.Struct({ planDayId: Id, direction: Direction }),
  movePlanExercise: Schema.Struct({ planExerciseId: Id, direction: Direction }),
  addPlanExercise: Schema.Struct({ planDayId: Id, exercise: ExercisePrescription }),
  updatePlanExercise: Schema.Struct({ planExerciseId: Id, changes: PlanExercisePatch }),
  removePlanExercise: Schema.Struct({ planExerciseId: Id }),
  deleteCoachNote: Schema.Struct({ noteId: Id }),

  // body
  logMeasurement: MeasurementInput,
  deleteMeasurement: Schema.Struct({ measurementId: Id }),

  // food
  /** The food log from one day to another, both included, with each day's totals. */
  getNutrition: Schema.Struct({ from: Day, to: Day }),
  logFood: Schema.Struct({ day: Day, food: FoodInput }),
  updateFood: Schema.Struct({ foodId: Id, food: FoodInput }),
  deleteFood: Schema.Struct({ foodId: Id }),

  // Apple Health, from the iPhone app
  importHealth: HealthImport,
  getHealth: Nothing,

  // mini workouts
  /** Mini workouts from one day to another (a phone asks for the days around its today), with the settings. */
  getMinis: Schema.Struct({ from: Day, to: Day }),
  /**
   * Saves the settings. `day` is the phone's today, which takes the new targets at once. `base` is
   * the targets the form was loaded with, so a target sent unchanged keeps one that grew meanwhile.
   */
  updateMinis: Schema.Struct({
    day: Day,
    settings: MiniSettingsInput,
    base: Schema.optional(Schema.Array(MiniTargetInput).check(Schema.isMaxLength(MINI_LIMITS.targets))),
  }),
  logMini: Schema.Struct({
    day: Day,
    exercise: ExerciseName,
    amount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MINI_LIMITS.daily })),
    /** Only needed for an exercise with no target that day. */
    unit: Schema.optional(Schema.Literals(MINI_UNITS)),
    /** The nudge this answers, when it was logged from one. */
    nudgeId: Schema.optional(Id),
    clientKey: Schema.optional(Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(64))),
  }),
  deleteMini: Schema.Struct({ entryId: Id }),
  skipNudge: Schema.Struct({ nudgeId: Id }),
  /**
   * Turns nudges on in this browser. `origin` is filled in by the server from the address the
   * request came to; whatever a client sends there is replaced.
   */
  subscribePush: Schema.Struct({ subscription: PushSubscriptionInput, origin: AppOrigin }),
  unsubscribePush: Schema.Struct({ endpoint: Schema.String.check(Schema.isMaxLength(1000)) }),
  /** Sends a notification to every browser with nudges on, to check they arrive. */
  testPush: Nothing,
} as const

export type CallName = keyof typeof CallInputs
