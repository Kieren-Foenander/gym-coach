import { Schema } from "effect"
import { HEALTH_BODY_KINDS, HEALTH_IMPORT_LIMITS, HEALTH_METRICS, HEALTH_VALUE_LIMITS } from "./health"
import { isDay } from "./days"
import { FOOD_LIMITS, TARGET_LIMITS } from "./nutrition"
import { MAX_STREAK_GOALS, MAX_WEEKLY_TARGET, STREAK_ACTIVITIES, STREAK_PERIODS } from "./streaks"
import { MEASUREMENT_KINDS } from "./units"

export { distanceUnit, MEASUREMENT_KINDS, measurementUnit } from "./units"

export const Unit = Schema.Literals(["kg", "lb"])

export type Unit = typeof Unit.Type

const Text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const Name = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(80))
const Int = (min: number, max: number) => Schema.Int.check(Schema.isBetween({ minimum: min, maximum: max }))
const Weight = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 2000 }))
export const Id = Schema.Int.check(Schema.isGreaterThan(0))

export const Credentials = Schema.Struct({
  email: Schema.Trim.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/), Schema.isMaxLength(200)),
  password: Schema.String.check(Schema.isMinLength(10), Schema.isMaxLength(200)),
})

export const SignUpInput = Schema.Struct({
  ...Credentials.fields,
  displayName: Name,
  inviteCode: Schema.optional(Text(200)),
})

/** One streak goal: what counts and how often. A daily goal's target is always 1. */
export const StreakGoal = Schema.Struct({
  activity: Schema.Literals(STREAK_ACTIVITIES).annotate({
    description: "training: any workout except walks. walking: walks only. any: anything logged, walks included.",
  }),
  period: Schema.Literals(STREAK_PERIODS),
  target: Int(1, MAX_WEEKLY_TARGET).annotate({ description: "Days a week with a session that counts. Use 1 for a daily goal." }),
})

export type StreakGoal = typeof StreakGoal.Type

export const StreakGoals = Schema.Array(StreakGoal).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_STREAK_GOALS))

export const ProfilePatch = Schema.Struct({
  displayName: Schema.optional(Name),
  unit: Schema.optional(Unit),
  goal: Schema.optional(Text(2000)),
  trainingContext: Schema.optional(Text(4000)),
  /** Daily targets for the food log. Null clears one. */
  calorieTarget: Schema.optional(Schema.NullOr(Int(TARGET_LIMITS.calories.min, TARGET_LIMITS.calories.max))),
  proteinTarget: Schema.optional(Schema.NullOr(Int(TARGET_LIMITS.protein.min, TARGET_LIMITS.protein.max))),
  /** What the calendar's streaks count, the first one leading. Replaces the saved goals. */
  streakGoals: Schema.optional(StreakGoals),
})

export type ProfilePatch = typeof ProfilePatch.Type

/** The prescription for one exercise on one day of a plan. */
export const ExercisePrescription = Schema.Struct({
  exercise: Name,
  muscleGroup: Schema.optional(Text(40)),
  sets: Int(1, 12),
  repMin: Int(1, 100),
  repMax: Int(1, 100),
  targetWeight: Schema.optional(Schema.NullOr(Weight)),
  increment: Schema.optional(Weight),
  restSeconds: Schema.optional(Int(0, 900)),
  notes: Schema.optional(Text(500)),
  autoProgress: Schema.optional(Schema.Boolean),
})

export type ExercisePrescription = typeof ExercisePrescription.Type

export const PlanInput = Schema.Struct({
  name: Name,
  description: Schema.optional(Text(2000)),
  days: Schema.Array(
    Schema.Struct({ name: Name, exercises: Schema.Array(ExercisePrescription) }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(14)),
})

export type PlanInput = typeof PlanInput.Type

export const PlanExercisePatch = Schema.Struct({
  sets: Schema.optional(Int(1, 12)),
  repMin: Schema.optional(Int(1, 100)),
  repMax: Schema.optional(Int(1, 100)),
  targetWeight: Schema.optional(Schema.NullOr(Weight)),
  increment: Schema.optional(Weight),
  restSeconds: Schema.optional(Int(0, 900)),
  notes: Schema.optional(Text(500)),
  autoProgress: Schema.optional(Schema.Boolean),
})

export type PlanExercisePatch = typeof PlanExercisePatch.Type

/** One logged set. Cardio is logged with weight 0, reps 0 and a duration, with a distance if there is one. */
export const SetInput = Schema.Struct({
  weight: Weight,
  reps: Int(0, 1000),
  rpe: Schema.optional(Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 10 })))),
  durationSeconds: Schema.optional(Schema.NullOr(Int(1, 86_400))),
  distance: Schema.optional(Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1000 })))),
})

export type SetInput = typeof SetInput.Type

export type AdjustmentSource = "rule" | "ai" | "user"

export const MeasurementKind = Schema.Literals(MEASUREMENT_KINDS)

export type MeasurementKind = typeof MeasurementKind.Type

export const MeasurementInput = Schema.Struct({
  kind: MeasurementKind,
  value: Schema.Finite.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
})

export type MeasurementInput = typeof MeasurementInput.Type

const DAY_PATTERN = Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)
const REAL_DAY = Schema.makeFilter((text: string) => isDay(text) || "Expected a real day as YYYY-MM-DD")

/** A calendar day on the user's device, as YYYY-MM-DD. */
export const Day = Schema.String.check(DAY_PATTERN, REAL_DAY)

/**
 * A day with a description for the coach. The description goes on before the checks, because
 * one put on after a custom check is left out of the JSON Schema the MCP client is shown.
 */
export const describedDay = (description: string) => Schema.String.annotate({ description }).check(DAY_PATTERN, REAL_DAY)

const Grams = Schema.optional(Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: FOOD_LIMITS.grams }))))

/** One entry in the food log: a meal, a snack or a day's total. Macros are in grams and may be left out. */
export const FoodInput = Schema.Struct({
  description: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(FOOD_LIMITS.description)),
  calories: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: FOOD_LIMITS.calories })),
  protein: Grams,
  carbs: Grams,
  fat: Grams,
})

export type FoodInput = typeof FoodInput.Type

export const Direction = Schema.Literals(["up", "down"])

export type Direction = typeof Direction.Type

const HealthId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(HEALTH_VALUE_LIMITS.healthId))
const Time = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 8_640_000_000_000 }))
const Optional = (value: number) => Schema.optional(Schema.NullOr(Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: value }))))

const HealthList = <S extends Schema.Top>(item: S, max: number) => Schema.optional(Schema.Array(item).check(Schema.isMaxLength(max)))

/**
 * What the iPhone app found in Apple Health, in standard units: kilograms, metres, and
 * body fat as a fraction. See src/domain/health.ts for what the server does with each.
 */
export const HealthImport = Schema.Struct({
  /** Ids of records deleted in Health. */
  deleted: HealthList(HealthId, HEALTH_IMPORT_LIMITS.deleted),
  body: HealthList(
    Schema.Struct({
      healthId: HealthId,
      kind: Schema.Literals(HEALTH_BODY_KINDS),
      value: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: HEALTH_VALUE_LIMITS.body })),
      measuredAt: Time,
    }),
    HEALTH_IMPORT_LIMITS.body,
  ),
  workouts: HealthList(
    Schema.Struct({
      healthId: HealthId,
      /** HealthKit's workout type number (HKWorkoutActivityType). */
      activity: Int(0, HEALTH_VALUE_LIMITS.activity),
      indoor: Schema.Boolean,
      startedAt: Time,
      endedAt: Time,
      durationSeconds: Int(0, HEALTH_VALUE_LIMITS.durationSeconds),
      distanceMeters: Optional(HEALTH_VALUE_LIMITS.distanceMeters),
      energyKcal: Optional(HEALTH_VALUE_LIMITS.energyKcal),
      avgHeartRate: Optional(HEALTH_VALUE_LIMITS.avgHeartRate),
    }),
    HEALTH_IMPORT_LIMITS.workouts,
  ),
  daily: HealthList(
    Schema.Struct({
      day: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
      metric: Schema.Literals(HEALTH_METRICS),
      value: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: HEALTH_VALUE_LIMITS.daily })),
    }),
    HEALTH_IMPORT_LIMITS.daily,
  ),
})

export type HealthImport = typeof HealthImport.Type
