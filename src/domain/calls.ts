import { Schema } from "effect"
import {
  Day,
  Direction,
  ExercisePrescription,
  FoodInput,
  HealthImport,
  Id,
  MeasurementInput,
  PlanExercisePatch,
  ProfilePatch,
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
} as const

export type CallName = keyof typeof CallInputs
